/**
 * Upload store-frontend/dist contents to Hostinger public_html via FTP.
 *
 * Required env (from environment or .env.deploy):
 *   HOSTINGER_FTP_HOST
 *   HOSTINGER_FTP_USER
 *   HOSTINGER_FTP_PASSWORD
 *
 * Optional:
 *   HOSTINGER_FTP_REMOTE_DIR  (default: public_html)
 *   HOSTINGER_FTP_PORT        (default: 21)
 *   HOSTINGER_FTP_SECURE      (true|false — FTPS; default false)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "basic-ftp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const distDir = path.join(rootDir, "dist");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(path.join(rootDir, ".env.deploy"));
loadEnvFile(path.join(rootDir, ".env"));

const host = process.env.HOSTINGER_FTP_HOST;
const user = process.env.HOSTINGER_FTP_USER;
const password = process.env.HOSTINGER_FTP_PASSWORD;
const remoteDir = process.env.HOSTINGER_FTP_REMOTE_DIR || "public_html";
const port = Number(process.env.HOSTINGER_FTP_PORT || 21);
const secure =
  String(process.env.HOSTINGER_FTP_SECURE || "false").toLowerCase() === "true";

function requireEnv() {
  const missing = [];
  if (!host) missing.push("HOSTINGER_FTP_HOST");
  if (!user) missing.push("HOSTINGER_FTP_USER");
  if (!password) missing.push("HOSTINGER_FTP_PASSWORD");
  if (missing.length) {
    console.error(
      `Missing FTP credentials: ${missing.join(", ")}\n` +
        `Copy .env.deploy.example → .env.deploy and fill values, or set GitHub Actions secrets.`
    );
    process.exit(1);
  }
}

async function main() {
  requireEnv();

  if (!fs.existsSync(distDir)) {
    console.error(`Missing dist/ at ${distDir}. Run npm run build first.`);
    process.exit(1);
  }

  const sitemapPath = path.join(distDir, "sitemap.xml");
  if (fs.existsSync(sitemapPath)) {
    const xml = fs.readFileSync(sitemapPath, "utf8");
    const productCount = (xml.match(/\/products\//g) || []).length;
    console.log(`dist/sitemap.xml product URL refs: ${productCount}`);
  } else {
    console.warn("Warning: dist/sitemap.xml not found — build may have skipped prebuild");
  }

  const client = new Client(60_000);
  client.ftp.verbose = process.env.FTP_VERBOSE === "1";

  console.log(`Connecting to ${host}:${port} as ${user} (secure=${secure})...`);
  await client.access({
    host,
    port,
    user,
    password,
    secure,
  });

  console.log(`Ensuring remote dir: ${remoteDir}`);
  await client.ensureDir(remoteDir);
  await client.cd(remoteDir);

  console.log(`Uploading ${distDir} → ${remoteDir}/ ...`);
  await client.uploadFromDir(distDir);

  console.log("Deploy complete.");
  client.close();
}

main().catch((err) => {
  console.error("Deploy failed:", err.message || err);
  process.exit(1);
});
