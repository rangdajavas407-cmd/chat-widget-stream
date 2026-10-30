const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const WebSocket = require("ws");
const { TikTokLiveConnection, WebcastEvent } = require("tiktok-live-connector");
const { createViewerKhusus } = require("./viewer-khusus");

const viewerKhusus = createViewerKhusus();
const PORT = 3000;
const tiktok = new Map();   // username -> connection
const youtube = new Map();  // videoId  -> state
const clients = new Set();

// ============================================================
// AUTO BUKA CHAT MONITOR (jendela terminal baru)
// Matikan dengan: NO_MONITOR=1 node server.js
// ============================================================
const monitorPath = path.join(__dirname, "chat-monitor.js");

function openMonitor() {
  if (process.env.NO_MONITOR === "1") return;

  const run = (cmd, args) => {
    const c = spawn(cmd, args, { detached: true, stdio: "ignore", cwd: __dirname });
    c.unref();
    return c;
  };

  try {
    if (process.platform === "win32") {
      run("cmd", ["/c", "start", "Chat Monitor", "cmd", "/k", "node", monitorPath])
        .on("error", e => console.error("Gagal membuka monitor:", e.message));
    } else if (process.platform === "darwin") {
      run("osascript", ["-e",
        `tell application "Terminal" to do script "cd '${__dirname}' && node chat-monitor.js"`,
        "-e", `tell application "Terminal" to activate`])
        .on("error", e => console.error("Gagal membuka monitor:", e.message));
    } else {
      const cands = [
        ["gnome-terminal", ["--", "node", monitorPath]],
        ["x-terminal-emulator", ["-e", "node", monitorPath]],
        ["konsole", ["-e", "node", monitorPath]],
        ["xterm", ["-e", "node", monitorPath]]
      ];
      const tryNext = i => {
        if (i >= cands.length) return console.log("ℹ️ Terminal tidak ditemukan. Jalankan manual: node chat-monitor.js");
        run(cands[i][0], cands[i][1]).on("error", () => tryNext(i + 1));
      };
      tryNext(0);
    }
  } catch (e) {
    console.error("Gagal membuka chat-monitor.js:", e.message);
  }
}

// ============================================================
// WIDGET CONFIG
// ============================================================
// State penuh dari editor: { S, roles, css }.
// Disimpan di MEMORI server -> setiap display baru / reconnect langsung menerimanya.
// Mau tetap tersimpan setelah server restart? ubah SAVE_TO_FILE jadi true
// (akan menulis widget-state.json di folder ini).
const SAVE_TO_FILE = false;
const STATE_FILE = path.join(__dirname, "widget-state.json");
let widgetState = null;
if (SAVE_TO_FILE) {
  try { widgetState = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch {}
}

const validState = s => s && typeof s === "object" && s.S && typeof s.S === "object" && Array.isArray(s.roles);

let saveTimer = null;
function persistState() {
  if (!SAVE_TO_FILE) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(STATE_FILE, JSON.stringify(widgetState), err => {
      if (err) console.error("Gagal simpan widget-state.json:", err.message);
    });
  }, 500);
}

// ============================================================
// HELPERS
// ============================================================
function broadcast(data, except) {
  const msg = JSON.stringify(data);
  for (const ws of clients) {
    if (ws === except) continue;
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(msg); } catch (e) { console.error("WS send error:", e.message); }
    }
  }
}

const ytSource = s => (s.channelUsername ? `@${s.channelUsername}` : s.videoId);

function getActiveConnections() {
  return {
    tiktok: [...tiktok.keys()],
    youtube: [...youtube.values()].map(ytSource),
    twitch: [],
    instagram: []
  };
}

const broadcastStatus = () =>
  broadcast({ type: "status", status: "connections", connections: getActiveConnections() });

const sourceStatus = (platform, source, status, extra = {}) =>
  broadcast({ type: "source_status", platform, source, status, ...extra });

const errMsg = e => e?.message || String(e);

// ============================================================
// HTTP SERVER
// ============================================================
const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".ico": "image/x-icon"
};

function serveFile(res, name) {
  const file = path.join(__dirname, name);
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("404 - File tidak ditemukan: " + name);
    }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
}

// /display = template display.html + engine render (CSS & JS) yang diambil langsung dari editor.html,
// jadi tampilan display selalu sama dengan editor tanpa menyalin kode.
function between(src, a, b) {
  const i = src.indexOf(a), j = src.indexOf(b);
  return i < 0 || j < 0 || j < i ? null : src.slice(i + a.length, j);
}

// Penyesuaian agar bubble di display TIDAK kepotong (sayap, api, tetesan, mahkota, telinga, dll
// menjorok keluar dari bubble). Lebar konten ~500px sama seperti preview editor.
const DISPLAY_FIX = `
#chat{overflow:visible!important;width:100%!important;max-width:620px!important;padding:56px 52px 40px 52px!important}
.msg{max-width:100%!important}
html,body{overflow:hidden!important}
`;

function serveDisplay(res) {
  fs.readFile(path.join(__dirname, "editor.html"), "utf8", (e1, editor) => {
    fs.readFile(path.join(__dirname, "display.html"), "utf8", (e2, tpl) => {
      const fail = (code, msg) => { res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8" }); res.end(msg); };
      if (e1 || e2) return fail(404, "404 - editor.html / display.html tidak ditemukan");
      const css = between(editor, "/*ENGINE-CSS-START*/", "/*ENGINE-CSS-END*/");
      const js = between(editor, "/*ENGINE-JS-START*/", "/*ENGINE-JS-END*/");
      if (css === null || js === null) return fail(500, "Penanda ENGINE-CSS / ENGINE-JS di editor.html hilang.");
      const html = tpl
        .replace("/*__ENGINE_CSS__*/", () => css)
        .replace("/*__ENGINE_JS__*/", () => js)
        .replace("</head>", () => `<style>${DISPLAY_FIX}</style></head>`);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(html);
    });
  });
}

function sendJSON(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data));
}

function readBody(req, handler) {
  let body = "";
  req.on("data", c => { body += c; });
  req.on("end", () => handler(body));
}

const PAGES = {
  "/": "index.html", "/index": "index.html", "/home": "index.html", "/index.html": "index.html",
  "/editor": "editor.html", "/editor.html": "editor.html",
  "/display": "display.html", "/display.html": "display.html"
};

const server = http.createServer((req, res) => {
  const urlPath = req.url.split("?")[0].split("#")[0];

  if (req.method === "GET" && (urlPath === "/display" || urlPath === "/display.html")) return serveDisplay(res);
  if (req.method === "GET" && PAGES[urlPath]) return serveFile(res, PAGES[urlPath]);
  if (req.method === "GET" && urlPath === "/status") {
    return sendJSON(res, 200, { success: true, connections: getActiveConnections() });
  }
  // lihat state tema yang sedang tersimpan di server (untuk cek/debug)
  if (req.method === "GET" && urlPath === "/state") {
    return sendJSON(res, 200, { success: true, saved: !!widgetState, state: widgetState });
  }

  // kirim chat tes ke display + monitor (tanpa live). Body: {platform, nickname, comment, roles:[...]}
  if (req.method === "POST" && urlPath === "/test") {
    return readBody(req, body => {
      try {
        const d = JSON.parse(body || "{}");
        const nick = String(d.nickname || "tester");
        broadcast({
          type: "chat",
          platform: String(d.platform || "").toLowerCase() === "youtube" ? "YouTube" : "TikTok",
          source: "test", username: nick, nickname: nick,
          comment: String(d.comment || "Tes chat"),
          roles: [].concat(d.roles || []), avatar: null, timestamp: Date.now()
        });
        sendJSON(res, 200, { success: true });
      } catch (e) {
        sendJSON(res, 400, { success: false, error: errMsg(e) });
      }
    });
  }

  if (req.method === "POST" && (urlPath === "/connect" || urlPath === "/disconnect")) {
    return readBody(req, async body => {
      try {
        const data = JSON.parse(body || "{}");
        const platform = String(data.platform || "").trim().toLowerCase();
        const input = String(data.username || data.input || data.source || "").trim();

        if (urlPath === "/disconnect") {
          if (platform === "tiktok") await disconnectTikTok(input);
          if (platform === "youtube") disconnectYouTube(input);
          return sendJSON(res, 200, { success: true, platform, username: input });
        }

        if (!platform) return sendJSON(res, 400, { success: false, error: "Platform tidak diberikan." });
        if (!input) return sendJSON(res, 400, { success: false, error: "Username / URL / Video ID tidak diberikan." });

        console.log(`\n== CONNECT == ${platform} | ${input}`);

        if (platform === "tiktok") {
          const r = await connectTikTok(input);
          return sendJSON(res, 200, { success: true, platform, username: input, source: r?.source || null });
        }
        if (platform === "youtube") {
          const r = await connectYouTube(input);
          return sendJSON(res, 200, {
            success: true, platform, username: input,
            source: r?.source || null, videoId: r?.videoId || null, channel: r?.channel || null
          });
        }
        if (platform === "twitch" || platform === "instagram") {
          return sendJSON(res, 400, { success: false, error: `${platform} belum diaktifkan.` });
        }
        return sendJSON(res, 400, { success: false, error: `Platform "${platform}" belum didukung.` });
      } catch (e) {
        console.error("❌ Request error:", e);
        sendJSON(res, 500, { success: false, error: errMsg(e) || "Gagal memproses permintaan." });
      }
    });
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("404 - Not Found");
});

// ============================================================
// TIKTOK
// ============================================================
function cleanTikTokUsername(input) {
  const v = String(input || "").trim();
  try {
    if (/^https?:\/\//i.test(v)) {
      const p = new URL(v).pathname.split("/").filter(Boolean)[0];
      if (p) return p.replace(/^@/, "").trim();
    }
  } catch {}
  return v.replace(/^@/, "").split(/[/?#]/)[0].trim();
}

const tiktokAvatar = u =>
  u.avatarThumb?.urlList?.[0] || u.avatarLarger?.urlList?.[0] || u.profilePictureUrl || null;

async function connectTikTok(input) {
  const username = cleanTikTokUsername(input);
  if (!username) throw new Error("Username TikTok tidak valid.");

  if (tiktok.has(username)) {
    console.log(`⚠️ TikTok @${username} sudah terdaftar.`);
    return { source: username, username, existing: true };
  }

  console.log(`🔄 Menghubungkan TikTok @${username}...`);
  const conn = new TikTokLiveConnection(username, {
    processInitialData: false,
    fetchRoomInfoOnConnect: true
  });
  tiktok.set(username, conn);

  const alive = () => tiktok.get(username) === conn;

  // kirim chat ke widget (dipakai chat & gift)
  const pushChat = (data, comment) => {
    const u = data?.user || {};
    const uname = u.displayId || u.uniqueId || u.unique_id || u.nickname || "unknown";
    let roles = [];
    try { roles = viewerKhusus.getTikTokRoles(data); } catch (e) { console.error("Role error:", e.message); }
    broadcast({
      type: "chat", platform: "TikTok", source: username,
      username: String(uname), nickname: String(u.nickname || u.displayName || uname),
      comment: String(comment), roles, avatar: tiktokAvatar(u), timestamp: Date.now()
    });
    return roles;
  };

  conn.on(WebcastEvent.CONNECTED, state => {
    if (!alive()) return;
    viewerKhusus.reset();
    console.log(`✅ TikTok @${username} terhubung. Room: ${state?.roomId ?? conn.roomId ?? "-"}`);
    sourceStatus("TikTok", username, "connected", { roomId: state?.roomId ?? conn.roomId ?? null });
    broadcastStatus();
  });

  conn.on(WebcastEvent.CHAT, data => {
    if (!alive()) return;
    const comment = data?.comment ?? data?.content ?? data?.message ?? data?.text ?? "";
    if (!String(comment).trim()) return;
    const roles = pushChat(data, comment);
    console.log(`📨 ${data?.user?.nickname} | roles:`, roles);
  });

  conn.on(WebcastEvent.GIFT, data => {
    if (!alive()) return;
    try {
      viewerKhusus.handleTikTokGift(data);
      const giftName = data?.giftName || data?.gift?.name || data?.giftDetails?.giftName || "gift";
      const qty = data?.repeatCount || data?.repeat_count || 1;
      pushChat(data, `💎 Mengirim ${giftName} ×${qty}`);
    } catch (e) { console.error("Gift error:", e.message); }
  });

  conn.on(WebcastEvent.LIKE, data => {
    if (!alive()) return;
    try { viewerKhusus.handleTikTokLike(data); } catch (e) { console.error("Like error:", e.message); }
  });

  conn.on(WebcastEvent.DISCONNECTED || "disconnected", () => {
    console.log(`🔌 TikTok @${username} terputus.`);
    if (!alive()) return;
    tiktok.delete(username);
    sourceStatus("TikTok", username, "disconnected");
    broadcastStatus();
  });

  conn.on(WebcastEvent.ERROR, e => {
    console.error(`❌ TikTok @${username} error:`, errMsg(e));
    sourceStatus("TikTok", username, "error", { error: errMsg(e) });
  });

  try {
    const state = await conn.connect();
    if (!alive()) return { source: username, username, connected: false };
    broadcastStatus();
    return { source: username, username, roomId: state?.roomId ?? conn.roomId ?? null, connected: true };
  } catch (e) {
    if (alive()) tiktok.delete(username);
    try { conn.disconnect(); } catch {}
    sourceStatus("TikTok", username, "error", { error: errMsg(e) });
    broadcastStatus();
    throw new Error(`TikTok @${username} gagal terhubung: ${errMsg(e)}`);
  }
}

async function disconnectTikTok(input) {
  const username = cleanTikTokUsername(input);
  const conn = tiktok.get(username);
  if (!conn) return console.log(`⚠️ TikTok @${username} tidak sedang terhubung.`);

  tiktok.delete(username);
  try { await conn.disconnect(); } catch (e) { console.error("TikTok disconnect error:", errMsg(e)); }
  sourceStatus("TikTok", username, "disconnected");
  broadcastStatus();
  console.log(`🔌 TikTok @${username} dilepas.`);
}

// ============================================================
// YOUTUBE
// ============================================================
let Innertube = null, YTNodes = null;

async function loadYouTube() {
  if (Innertube) return;
  try {
    const m = await import("youtubei.js");
    Innertube = m.Innertube;
    YTNodes = m.YTNodes;
    if (!Innertube) throw new Error("Innertube tidak ditemukan");
    console.log("✅ youtubei.js dimuat");
  } catch (e) {
    console.error("❌ Gagal memuat youtubei.js:", e);
    throw new Error("youtubei.js belum terinstall. Jalankan: npm install youtubei.js");
  }
}

const VID = /^[A-Za-z0-9_-]{11}$/;

function parseYouTubeInput(input) {
  const raw = String(input || "").trim();
  if (!raw) return { type: "error", value: "" };

  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();

    if (host === "youtu.be") {
      const id = url.pathname.replace(/^\/+/, "").split("/")[0];
      if (VID.test(id)) return { type: "video", value: id };
    }
    if (host === "youtube.com" || host === "m.youtube.com") {
      const v = url.searchParams.get("v");
      if (v && VID.test(v)) return { type: "video", value: v };

      const vid = url.pathname.match(/^\/(?:live|embed|shorts)\/([A-Za-z0-9_-]{11})(?:\/|$)/i);
      if (vid) return { type: "video", value: vid[1] };

      const handle = url.pathname.match(/^\/@([^/]+)/i);
      if (handle) return { type: "channel", value: decodeURIComponent(handle[1]) };

      const ch = url.pathname.match(/^\/channel\/([^/]+)/i);
      if (ch) return { type: "channelId", value: ch[1] };

      const user = url.pathname.match(/^\/user\/([^/]+)/i);
      if (user) return { type: "channel", value: decodeURIComponent(user[1]) };
    }
  } catch {}

  if (VID.test(raw)) return { type: "video", value: raw };
  return { type: "channel", value: raw.replace(/^@/, "").split(/[/?#]/)[0] };
}

async function connectYouTube(input) {
  await loadYouTube();
  const p = parseYouTubeInput(input);
  console.log(`🔎 YouTube input: ${p.type} → ${p.value}`);

  if (p.type === "video") return connectYouTubeVideo(p.value, input);
  if (p.type === "channelId") return connectYouTubeChannel({ channelId: p.value }, input);
  if (p.type === "channel") return connectYouTubeChannel({ username: p.value }, input);
  throw new Error("Input YouTube tidak valid.");
}

async function connectYouTubeVideo(videoId, originalInput, ch = {}) {
  await loadYouTube();

  const old = youtube.get(videoId);
  if (old) {
    console.log(`⚠️ YouTube ${videoId} sudah terhubung.`);
    return { source: ytSource(old), videoId, channel: old.channelUsername || null };
  }

  let innertube, info, liveChat;
  try {
    innertube = await Innertube.create();
    info = await innertube.getInfo(videoId);
  } catch (e) {
    throw new Error(`YouTube ${videoId} gagal mendapatkan info: ${errMsg(e)}`);
  }

  console.log(`📺 YouTube: ${info?.basic_info?.title || videoId}`);

  try { liveChat = info.getLiveChat(); } catch (e) {
    throw new Error(`Video ${videoId} tidak punya Live Chat: ${errMsg(e)}`);
  }
  if (!liveChat) throw new Error(`Live Chat untuk ${videoId} tidak tersedia.`);

  const state = {
    platform: "YouTube", input: originalInput, videoId, innertube, liveChat,
    channelUsername: ch.channelUsername || null, channelId: ch.channelId || null
  };
  youtube.set(videoId, state);

  liveChat.on("chat-update", action => {
    try {
      if (!(action?.is && YTNodes?.AddChatItemAction && action.is(YTNodes.AddChatItemAction))) return;
      const item = action.item;
      if (!item?.is) return;

      const isText = YTNodes.LiveChatTextMessage && item.is(YTNodes.LiveChatTextMessage);
      const isPaid = YTNodes.LiveChatPaidMessage && item.is(YTNodes.LiveChatPaidMessage);
      if (!isText && !isPaid) return;

      const username = item.author?.id || item.author?.name || "unknown";
      let roles = [];
      try { roles = viewerKhusus.getYouTubeRoles(item); } catch (e) { console.error("YT role error:", e.message); }

      broadcast({
        type: "chat", platform: "YouTube", source: ytSource(state),
        username: String(username), nickname: String(item.author?.name || username),
        comment: String(item.message?.toString?.() || ""), roles,
        avatar: item.author?.thumbnails?.[0]?.url || null, timestamp: Date.now()
      });
    } catch (e) {
      console.error("❌ Parse YouTube chat:", errMsg(e));
    }
  });

  liveChat.on("error", e => {
    console.error(`❌ YouTube error (${videoId}):`, errMsg(e));
    sourceStatus("YouTube", ytSource(state), "error", { error: errMsg(e) });
  });

  liveChat.on("end", () => {
    console.log(`🔴 YouTube Live selesai: ${videoId}`);
    youtube.delete(videoId);
    sourceStatus("YouTube", ytSource(state), "ended", { message: "YouTube Live selesai", videoId });
    broadcastStatus();
  });

  try {
    await liveChat.start();
  } catch (e) {
    youtube.delete(videoId);
    throw new Error(`Gagal memulai Live Chat ${videoId}: ${errMsg(e)}`);
  }

  sourceStatus("YouTube", ytSource(state), "connected", { message: `Connected to YouTube Live ${videoId}`, videoId });
  broadcastStatus();
  console.log(`✅ YouTube LIVE terhubung: ${videoId}`);

  return { source: ytSource(state), videoId, channel: state.channelUsername };
}

// cari channel ID dari handle: resolveURL → baca halaman → search
async function resolveYouTubeChannelId(handle, innertube) {
  try {
    const ep = await innertube.resolveURL(`https://www.youtube.com/@${handle}`);
    const id = ep?.payload?.browseEndpoint?.browseId || ep?.payload?.browseEndpoint?.browse_id;
    if (id) return id;
  } catch (e) { console.log(`⚠️ resolveURL gagal: ${errMsg(e)}`); }

  try {
    const r = await fetch(`https://www.youtube.com/@${encodeURIComponent(handle)}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36", "Accept-Language": "en-US,en;q=0.9" }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const html = await r.text();
    const m = html.match(/"(?:channelId|externalId|browseId)":"(UC[A-Za-z0-9_-]+)"/) ||
              html.match(/itemprop=["']channelId["'][^>]+content=["'](UC[A-Za-z0-9_-]+)["']/i);
    if (m) return m[1];
  } catch (e) { console.log(`⚠️ Fallback halaman gagal: ${errMsg(e)}`); }

  try {
    const s = await innertube.search(handle, { type: "channel" });
    for (const it of s?.contents || []) {
      const id = it?.id || it?.channel_id || it?.endpoint?.payload?.browseEndpoint?.browseId;
      if (id && /^UC[A-Za-z0-9_-]+$/.test(id)) return id;
    }
  } catch (e) { console.log(`⚠️ Search channel gagal: ${errMsg(e)}`); }

  return null;
}

async function findActiveYouTubeLive(innertube, channel, label) {
  let streams;
  try { streams = await channel.getLiveStreams(); } catch (e) {
    throw new Error(`Gagal mendapatkan daftar LIVE ${label}: ${errMsg(e)}`);
  }

  const items = streams?.videos?.length ? streams.videos : (streams?.contents || []);
  console.log(`📺 Kandidat LIVE: ${items.length}`);
  if (!items.length) throw new Error(`${label} tidak memiliki kandidat LIVE.`);

  const ids = items
    .map(it => ({ it, id: (it?.video || it)?.id || (it?.video || it)?.video_id }))
    .filter(x => x.id);

  // 1) dari flag
  for (const { it, id } of ids) {
    const v = it?.video || it;
    if (v?.is_live === true || v?.is_live_content === true || it?.is_live === true) return { videoId: id };
  }

  // 2) cek satu per satu via getInfo()
  for (const { id } of ids) {
    try {
      const info = await innertube.getInfo(id);
      let chat = null;
      try { chat = info.getLiveChat(); } catch {}
      if (info?.basic_info?.is_live === true || chat) return { videoId: id };
    } catch (e) { console.log(`   ⚠️ ${id} dilewati: ${errMsg(e)}`); }
  }
  return null;
}

async function connectYouTubeChannel({ username, channelId }, originalInput) {
  const label = username ? `@${username}` : channelId;

  if (username) {
    for (const s of youtube.values()) {
      if (s.channelUsername?.toLowerCase() === username.toLowerCase()) {
        console.log(`⚠️ YouTube ${label} sudah terhubung.`);
        return { source: ytSource(s), videoId: s.videoId, channel: s.channelUsername };
      }
    }
  }

  try {
    await loadYouTube();
    const innertube = await Innertube.create();

    const id = channelId || await resolveYouTubeChannelId(username, innertube);
    if (!id) throw new Error(`Channel ${label} tidak ditemukan.`);

    const channel = await innertube.getChannel(id);
    if (!channel) throw new Error(`Channel ID ${id} gagal dibuka.`);

    const live = await findActiveYouTubeLive(innertube, channel, label);
    if (!live) throw new Error(`${label} tidak sedang LIVE dengan Live Chat aktif.`);

    const r = await connectYouTubeVideo(live.videoId, originalInput, { channelUsername: username || null, channelId: id });
    broadcastStatus();
    return { source: r.source, videoId: live.videoId, channel: username || null, channelId: id };
  } catch (e) {
    throw new Error(`YouTube ${label} gagal terhubung: ${errMsg(e)}`);
  }
}

function stopYouTube(videoId, state) {
  try { state.liveChat?.stop?.(); } catch (e) { console.error("YouTube stop error:", e.message); }
  youtube.delete(videoId);
  sourceStatus("YouTube", ytSource(state), "disconnected", { videoId });
  broadcastStatus();
}

function disconnectYouTube(input) {
  const p = parseYouTubeInput(input);
  if (p.type === "error") return console.log("⚠️ Input YouTube untuk disconnect tidak valid.");

  if (p.type === "video") {
    const s = youtube.get(p.value);
    return s ? stopYouTube(p.value, s) : console.log(`⚠️ YouTube ${p.value} tidak sedang terhubung.`);
  }

  const v = p.value.replace(/^@/, "").toLowerCase();
  for (const [id, s] of youtube) {
    if (s.channelUsername?.toLowerCase() === v || s.channelId?.toLowerCase() === v) return stopYouTube(id, s);
  }
  console.log(`⚠️ YouTube @${v} tidak sedang terhubung.`);
}

// ============================================================
// WEBSOCKET
// ============================================================
const wss = new WebSocket.Server({ server });

wss.on("connection", ws => {
  clients.add(ws);
  console.log(`🔌 WS client connected. Total: ${clients.size}`);

  // client baru (display / editor / index) langsung dapat tema terakhir + status koneksi
  if (widgetState) ws.send(JSON.stringify({ type: "state", state: widgetState }));
  ws.send(JSON.stringify({ type: "status", status: "connections", connections: getActiveConnections() }));

  ws.on("message", raw => {
    try {
      const data = JSON.parse(raw.toString());
      if (data.type === "state" && validState(data.state)) {
        widgetState = data.state;                  // simpan di memori server
        broadcast({ type: "state", state: widgetState }, ws);  // teruskan ke display (dan client lain)
        persistState();                            // hanya menulis file jika SAVE_TO_FILE = true
        console.log("🎨 Tema dari editor disimpan & dikirim ke display (roles:", widgetState.roles.length + ")");
      }
    } catch (e) {
      console.error("WS message error:", e.message);
    }
  });

  ws.on("close", () => { clients.delete(ws); console.log(`🔌 WS client disconnected. Total: ${clients.size}`); });
  ws.on("error", e => { console.error("WS error:", e.message); clients.delete(ws); });
});

// ============================================================
// START & SHUTDOWN
// ============================================================
server.listen(PORT, () => {
  console.log(`
==========================================
🚀 CHAT WIDGET SERVER
==========================================
🏠 Index   : http://localhost:${PORT}/
📝 Editor  : http://localhost:${PORT}/editor
🖥️  Display : http://localhost:${PORT}/display
🧪 State   : http://localhost:${PORT}/state
==========================================
✅ TikTok: ENABLED
✅ YouTube: ENABLED (tanpa API key)
⚪ Twitch: DISABLED (Masih Bug)
⚪ Instagram: DISABLED (Coming soon)
===========================================`);
  openMonitor();   // server sudah listen -> buka jendela chat-monitor
});

function shutdown() {
  console.log("\n🛑 Menghentikan server...");

  for (const [name, conn] of tiktok) {
    try { conn.disconnect?.(); } catch {}
    console.log(`🔌 TikTok @${name} disconnected`);
  }
  for (const [id, s] of youtube) {
    try { s.liveChat?.stop?.(); } catch {}
    console.log(`🔌 YouTube ${id} disconnected`);
  }
  tiktok.clear();
  youtube.clear();

  for (const ws of clients) { try { ws.close(); } catch {} }
  server.close(() => { console.log("✅ Server berhenti."); process.exit(0); });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);