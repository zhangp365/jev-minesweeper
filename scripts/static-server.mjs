#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(process.argv[2]);
const port = Number(process.argv[3]);
const mimeTypes = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".png": "image/png" };

createServer(async (request, response) => {
  try {
    const pathname = request.url === "/" ? "/index.html" : decodeURIComponent(request.url.split("?")[0]);
    const filename = normalize(join(root, pathname));
    if (!filename.startsWith(root)) throw new Error("outside project root");
    const data = await readFile(filename);
    // The persistent Chrome profile caches without validators; a stale
    // index.html would silently revert UI changes between runs.
    response.writeHead(200, { "content-type": mimeTypes[extname(filename)] || "application/octet-stream", "cache-control": "no-store" });
    response.end(data);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(port, "127.0.0.1");
