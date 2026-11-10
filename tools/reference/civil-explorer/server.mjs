import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "tsx/esm/api";
register();
const { syntheticSiteModel } = await import("../../../packages/bim-pack-civil/__tests__/fixtures/synthetic-site.ts");
const { explorerData } = await import("./data.ts");
const { buildEditorDemo } = await import("../../../packages/bim-editor/demo/build.ts");
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "../../../mutinybim-examples/civil-explorer/dist");
const data = explorerData(syntheticSiteModel("civil-explorer-site"));
await buildEditorDemo({ entry: path.join(here, "app.tsx"), outDir });
const types = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png" };
const server = createServer(async (req, res) => {
  if (req.method !== "GET") { res.writeHead(405).end(); return; }
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/site") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(data)); return; }
    if (url.pathname === "/") { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>MutinyBIM civil connection explorer</title><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>'); return; }
    const file = path.resolve(outDir, `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(outDir + path.sep)) { res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream");
    res.end(await readFile(file));
  } catch { res.writeHead(404).end("Not found"); }
});
const port = Number(process.env.CIVIL_EXPLORER_PORT ?? 3197);
server.listen(port, "127.0.0.1", () => console.log(`Civil network explorer: http://127.0.0.1:${server.address().port}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close());
