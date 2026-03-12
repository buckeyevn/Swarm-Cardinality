/**
 * dashboard/serve.js
 * Tiny static server for the dashboard HTML.
 * Run: node src/dashboard/serve.js
 */

import { createServer } from "http";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.DASH_PORT ?? 8080;

const server = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(readFileSync(join(__dirname, "index.html")));
});

server.listen(PORT, () => {
  console.log(`\n🖥  Dashboard → http://localhost:${PORT}\n`);
});
