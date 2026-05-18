const fs = require("fs");
const path = require("path");
const SOCKET_URL_ENV_VAR = "BINGEWATCH_SOCKET_URL";

function normalizeSocketUrl(value) {
  const raw = (value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

const OUTPUT_DIR = path.join(__dirname, "..", "public", "js");
const OUTPUT_FILE = "netlify-env.js";
const socketUrl = normalizeSocketUrl(process.env[SOCKET_URL_ENV_VAR]);
const outputPath = path.join(OUTPUT_DIR, OUTPUT_FILE);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
try {
  fs.writeFileSync(
    outputPath,
    `window.BINGEWATCH_SOCKET_URL = ${JSON.stringify(socketUrl)};\n`,
  );
  console.log(`Generated ${outputPath}`);
} catch (err) {
  console.error(`Failed to generate ${outputPath}:`, err);
  process.exit(1);
}
