const WebSocket = require("ws");

const WS_URL = "ws://localhost:3000";

let ws;
let reconnectTimer;

// ============================================================
// ANSI COLORS
// ============================================================

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",

  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",

  brightRed: "\x1b[91m",
  brightCyan: "\x1b[96m",
  brightMagenta: "\x1b[95m",
  brightWhite: "\x1b[97m"
};

// ============================================================
// PLATFORM STYLE + LOGO
// ============================================================

const PLATFORM_STYLE = {
  tiktok: {
    // Logo TikTok: musical note (karakter asli logo TikTok)
    logo: "♪",
    logoColor: "\x1b[38;5;213m", // pink terang
    label: "TikTok",
    labelColor: "\x1b[38;5;213m"
  },

  youtube: {
    // Logo YouTube: segitiga play dalam kotak
    logo: "▶",
    logoColor: "\x1b[38;5;196m", // merah terang
    label: "YouTube",
    labelColor: "\x1b[38;5;196m"
  },

  twitch: {
    logo: "⌁",
    logoColor: "\x1b[38;5;141m", // ungu
    label: "Twitch",
    labelColor: "\x1b[38;5;141m"
  },

  instagram: {
    logo: "◉",
    logoColor: "\x1b[38;5;205m", // pink instagram
    label: "Instagram",
    labelColor: "\x1b[38;5;205m"
  },

  default: {
    logo: "●",
    logoColor: "\x1b[36m",
    label: "Chat",
    labelColor: "\x1b[36m"
  }
};

// ============================================================
// STATE
// ============================================================

let totalChat = 0;
let sessionStart = Date.now();
let lastPlatform = null;

// ============================================================
// HELPERS
// ============================================================

function pad(str, len) {
  str = String(str);
  if (str.length >= len) return str.slice(0, len);
  return str + " ".repeat(len - str.length);
}

function padCenter(str, len) {
  str = String(str);
  if (str.length >= len) return str.slice(0, len);

  const total = len - str.length;
  const left = Math.floor(total / 2);
  const right = total - left;

  return " ".repeat(left) + str + " ".repeat(right);
}

function truncate(str, len) {
  str = String(str);
  if (str.length <= len) return str;
  return str.slice(0, len - 1) + "…";
}

function time() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function uptime() {
  const s = Math.floor((Date.now() - sessionStart) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;

  if (h > 0) return `${h}j ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function terminalWidth() {
  return Math.min(process.stdout.columns || 60, 80);
}

// ============================================================
// BANNER
// ============================================================

function printBanner() {
  const W = terminalWidth();
  const line = "─".repeat(W - 2);

  console.log("");
  console.log(`${C.cyan}┌${line}┐${C.reset}`);

  // Title dengan logo TikTok & YouTube di kiri-kanan
  const titleRaw = "LIVE CHAT MONITOR";
  const titleColored =
    `\x1b[38;5;213m♪\x1b[0m  ` +
    `${C.bold}${C.brightWhite}${titleRaw}${C.reset}` +
    `  \x1b[38;5;196m▶\x1b[0m`;

  // Hitung panjang visual (tanpa ANSI)
  const titleVisualLen = `♪  ${titleRaw}  ▶`.length;
  const padTotal = (W - 2) - titleVisualLen;
  const padLeft = Math.floor(padTotal / 2);
  const padRight = padTotal - padLeft;

  console.log(
    `${C.cyan}│${C.reset}` +
      " ".repeat(padLeft) +
      titleColored +
      " ".repeat(padRight) +
      `${C.cyan}│${C.reset}`
  );

  console.log(`${C.cyan}├${line}┤${C.reset}`);

  const status = `🟢 Connected  •  📡 Menunggu chat...`;
  console.log(
    `${C.cyan}│${C.reset} ${C.green}${pad(status, W - 4)}${C.reset} ${C.cyan}│${C.reset}`
  );

  const info = `📊 Total: ${totalChat}  •  ⏱️  Uptime: ${uptime()}`;
  console.log(
    `${C.cyan}│${C.reset} ${C.gray}${pad(info, W - 4)}${C.reset} ${C.cyan}│${C.reset}`
  );

  console.log(`${C.cyan}└${line}┘${C.reset}`);
  console.log("");
}

// ============================================================
// CONNECT
// ============================================================

function connect() {
  ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    console.clear();
    sessionStart = Date.now();
    totalChat = 0;
    lastPlatform = null;

    printBanner();
  });

  ws.on("message", raw => {
    try {
      const data = JSON.parse(raw.toString());

      if (data.type !== "chat") return;

      totalChat++;
      showChat(data);
    } catch {
      // Abaikan data yang bukan JSON
    }
  });

  ws.on("close", () => {
    console.log("");
    console.log(`${C.red}🔴 Server terputus.${C.reset}`);
    console.log(`${C.yellow}🔄 Mencoba reconnect dalam 3 detik...${C.reset}`);

    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 3000);
  });

  ws.on("error", () => {
    // Error tidak perlu memenuhi console
  });
}

// ============================================================
// SHOW CHAT
// ============================================================

function showChat(data) {
  const platformKey = String(data.platform || "").toLowerCase();

  const style =
    PLATFORM_STYLE[platformKey] || PLATFORM_STYLE.default;

  const W = terminalWidth();

  const nickname = String(data.nickname || data.username || "unknown");
  const username = String(data.username || "unknown");
  const comment = String(data.comment || "").replace(/\s+/g, " ").trim();

  // --------------------------------------------------------
  // Separator kalau platform berubah
  // --------------------------------------------------------

  if (lastPlatform && lastPlatform !== platformKey) {
    const line = "·".repeat(W);
    console.log(`${C.gray}${line}${C.reset}`);
  }

  lastPlatform = platformKey;

  // --------------------------------------------------------
  // Header baris — pakai LOGO platform
  // --------------------------------------------------------

  const logo = `${style.logoColor}${style.logo}${C.reset}`;
  const label = `${C.bold}${style.labelColor}${style.label}${C.reset}`;

  const header =
    `${logo} ${label}` +
    `${C.gray} │ ${C.reset}` +
    `${C.bold}${C.brightWhite}${truncate(nickname, 20)}${C.reset}` +
    `${C.gray} @${truncate(username, 15)}${C.reset}` +
    `${C.gray}  •  ${time()}${C.reset}`;

  console.log(header);

  // --------------------------------------------------------
  // Isi chat — word wrap
  // --------------------------------------------------------

  const prefix = "   ";
  const maxLen = W - prefix.length - 2;

  const words = comment.split(" ");
  const lines = [];
  let current = "";

  for (const word of words) {
    if ((current + " " + word).trim().length <= maxLen) {
      current = (current + " " + word).trim();
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);

  if (!lines.length) lines.push("(kosong)");

  for (const line of lines) {
    console.log(`${C.gray}${prefix}${C.reset}${C.white}${line}${C.reset}`);
  }

  console.log("");
}

// ============================================================
// SIGINT
// ============================================================

process.on("SIGINT", () => {
  console.log("");
  console.log(`${C.yellow}👋 Chat Monitor ditutup.${C.reset}`);
  console.log("");

  if (ws) {
    try {
      ws.close();
    } catch {
      // ignore
    }
  }

  process.exit(0);
});

connect();