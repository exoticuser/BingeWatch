const fs = require("fs");
const path = require("path");

const socketUrl = process.env.BINGEWATCH_SOCKET_URL || "";
const outputPath = path.join(__dirname, "..", "public", "js", "netlify-env.js");

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(
  outputPath,
  `window.BINGEWATCH_SOCKET_URL = ${JSON.stringify(socketUrl)};\n`,
);
