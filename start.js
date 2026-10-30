#!/usr/bin/env node
/**
 * start.js — V3 (AUTO QUICK TUNNEL)
 * - Cek & install dependency
 * - LANGSUNG pakai Quick Tunnel (tanpa prompt)
 * - Jalankan server.js + tunnel
 *
 * Jalankan:  npm start   atau   node start.js
 */

const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

let serverProc = null;
let tunnelProc = null;
let tunnelUrl = null;
let shuttingDown = false;

function log(tag, msg) {
  const t = new Date().toLocaleTimeString("id-ID");
  console.log(`[${t}] ${tag} ${msg}`);
}

function ensureDependencies() {
  const nm = path.join(ROOT, "node_modules");
  const need = ["ws", "tiktok-live-connector", "youtubei.js"];

  let missing = false;
  if (!fs.existsSync(nm)) missing = true;
  else {
    for (const p of need) {
      if (!fs.existsSync(path.join(nm, p))) { missing = true; break; }
    }
  }

  if (missing) {
    log("📦", "Dependency belum lengkap. Menjalankan npm install...");
    try {
      execSync("npm install", { stdio: "inherit", cwd: ROOT });
      log("✅", "npm install selesai.");
    } catch (e) {
      log("❌", "npm install gagal. Cek koneksi internet / Node.js.");
      process.exit(1);
    }
  } else {
    log("✅", "Semua dependency tersedia.");
  }
}

// BINARY CLOUDFLARED
function findCloudflared() {
  const portable = process.platform === "win32"
    ? path.join(ROOT, "cloudflared.exe")
    : path.join(ROOT, "cloudflared");
  if (fs.existsSync(portable)) return portable;

  try {
    const mod = require("cloudflared");
    const bin = mod.bin || mod.default?.bin;
    if (bin && fs.existsSync(bin)) return bin;
  } catch {}

  try {
    const cmd = process.platform === "win32" ? "where cloudflared" : "which cloudflared";
    const out = execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim().split(/\r?\n/)[0];
    if (out && fs.existsSync(out)) return out;
  } catch {}

  return null;
}

function ensureCloudflaredBinary() {
  const existing = findCloudflared();
  if (existing) {
    log("✅", `cloudflared ditemukan: ${existing}`);
    return existing;
  }

  log("📦", "cloudflared belum ada. Mendownload binary...");

  const os = process.platform;
  const arch = process.arch;
  let url = "", outFile = "";

  if (os === "win32" && arch === "x64") {
    url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";
    outFile = path.join(ROOT, "cloudflared.exe");
  } else if (os === "win32" && arch === "arm64") {
    url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-arm64.exe";
    outFile = path.join(ROOT, "cloudflared.exe");
  } else if (os === "darwin" && arch === "arm64") {
    url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz";
    outFile = path.join(ROOT, "cloudflared.tgz");
  } else if (os === "darwin" && arch === "x64") {
    url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz";
    outFile = path.join(ROOT, "cloudflared.tgz");
  } else if (os === "linux" && arch === "x64") {
    url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64";
    outFile = path.join(ROOT, "cloudflared");
  } else if (os === "linux" && arch === "arm64") {
    url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64";
    outFile = path.join(ROOT, "cloudflared");
  } else {
    log("⚠️", `Platform ${os}/${arch} belum didukung auto-download.`);
    return null;
  }

  try {
    if (os === "win32") {
      execSync(`powershell -NoProfile -Command "Invoke-WebRequest -Uri '${url}' -OutFile '${outFile}'"`, { stdio: "inherit", cwd: ROOT });
    } else if (os === "darwin") {
      execSync(`curl -L "${url}" -o "${outFile}" && tar -xzf "${outFile}" && rm "${outFile}"`, { stdio: "inherit", cwd: ROOT });
      outFile = path.join(ROOT, "cloudflared");
      try { fs.chmodSync(outFile, 0o755); } catch {}
    } else {
      execSync(`curl -L "${url}" -o "${outFile}" && chmod +x "${outFile}"`, { stdio: "inherit", cwd: ROOT });
    }
    if (fs.existsSync(outFile)) {
      log("✅", "cloudflared siap.");
      return outFile;
    }
  } catch (e) {
    log("❌", "Download cloudflared gagal:", e.message);
    log("💡", "Download manual: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/");
  }
  return null;
}



function startServer() {
  log("🚀", `Menjalankan server.js di port ${PORT}...`);
  serverProc = spawn("node", ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: "inherit",
    shell: process.platform === "win32"
  });

  serverProc.on("exit", code => {
    if (shuttingDown) return;
    log("⚠️", `Server berhenti (exit code ${code}).`);
    shutdown(code ?? 0);
  });
}

function startQuickTunnel() {
  const bin = findCloudflared();

  if (!bin) {
    log("⚠️", "cloudflared tidak ditemukan — tunnel dilewati.");
    printLocalBanner();
    return;
  }

  log("🌐", `Menjalankan Cloudflare Quick Tunnel via: ${bin}`);
  tunnelProc = spawn(bin, [
    "tunnel",
    "--url", `http://localhost:${PORT}`,
    "--no-autoupdate"
  ], { stdio: ["ignore", "pipe", "pipe"] });

  watchTunnelOutput(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i, url => {
    tunnelUrl = url;
    printPublicBanner(url);
  });

  tunnelProc.on("exit", code => {
    if (shuttingDown) return;
    log("⚠️", `Tunnel berhenti (exit code ${code}).`);
    tunnelUrl = null;
  });
}

function watchTunnelOutput(regex, onMatch) {
  const seen = { done: false };
  const handle = (chunk, isErr) => {
    const s = chunk.toString();
    s.split("\n").forEach(l => {
      if (!l.trim()) return;
      (isErr ? console.error : console.log)("  [tunnel]", l.trim());
    });
    if (!seen.done) {
      const m = s.match(regex);
      if (m) { seen.done = true; onMatch(m[0]); }
    }
  };
  tunnelProc.stdout.on("data", d => handle(d, false));
  tunnelProc.stderr.on("data", d => handle(d, true));
}

function printLocalBanner() {
  console.log(`
==========================================
🏠  LOCAL URL
==========================================
🏠  Index   : http://localhost:${PORT}/
📝  Editor  : http://localhost:${PORT}/editor
🖥️   Display : http://localhost:${PORT}/display
==========================================`);
}

function printPublicBanner(url) {
  console.log(`
==========================================
🌍  PUBLIC URL (Quick Tunnel)
==========================================
🏠  Index   : ${url}/
📝  Editor  : ${url}/editor
🖥️   Display : ${url}/display
==========================================
⚠️  JANGAN tutup jendela ini.
    Tutup jendela = aplikasi mati.
==========================================
`);
}

//  SHUTDOWN
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("🛑", "Menghentikan semua proses...");

  if (tunnelProc) { try { tunnelProc.kill("SIGTERM"); } catch {} }
  if (serverProc) { try { serverProc.kill("SIGTERM"); } catch {} }

  setTimeout(() => process.exit(code), 1500);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("uncaughtException", e => {
  console.error("💥 Uncaught exception:", e);
  shutdown(1);
});

(async function main() {
  console.log(`
==========================================
🚀  CHAT WIDGET + CLOUDFLARE QUICK TUNNEL
    (auto — tanpa prompt)
==========================================`);

  ensureDependencies();
  ensureCloudflaredBinary();

  startServer();
  setTimeout(() => startQuickTunnel(), 3000);
})();