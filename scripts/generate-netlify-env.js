const fs = require("fs");
const path = require("path");

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

const socketUrl = normalizeSocketUrl(process.env.BINGEWATCH_SOCKET_URL);
const outputPath = path.join(__dirname, "..", "public", "js", "netlify-env.js");

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
