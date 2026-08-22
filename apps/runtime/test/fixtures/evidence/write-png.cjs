/* oxlint-disable no-undef, typescript/no-require-imports */
const fs = require("node:fs");

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
fs.writeFileSync(process.env.OH_MY_BUG_EVIDENCE_PATH, png);
