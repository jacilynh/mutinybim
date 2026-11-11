import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "tsx/esm/api";
register();
const { createWorkflow } = await import("./workflow.mjs");
const { buildEditorDemo } = await import("../../../packages/bim-editor/demo/build.ts");
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "../../../mutinybim-examples/civil-substitution-field/dist");
const workflow = await createWorkflow();
if (process.argv.includes("--field-demo")) await workflow.prepareFieldDemo();
let pending = Promise.resolve();
await buildEditorDemo({ entry: path.join(here, "app.tsx"), outDir });
const types = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png" };
const server = createServer(async (req, res) => {

  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/action" && req.method === "POST") {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) { res.writeHead(403).end(); return; }
      if (!req.headers["content-type"]?.startsWith("application/json")) { res.writeHead(415).end(); return; }
      let raw = "";
      for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 8192) { res.writeHead(413).end(); return; } }
      const input = JSON.parse(raw);
      if (!["owner", "contractor", "engineer", "inspector"].includes(input.role)) throw new Error("Choose a known demo identity");
      const execute = async () => {
        let result;
        switch (input.action) {
          case "create": result = await workflow.createSubmittal(input.role); break;
          case "propose": result = await workflow.propose(input.role); break;
          case "attempt-design-edit": result = await workflow.attemptDesignEdit(input.role); break;
          case "resubmit": result = await workflow.resubmit(input.role, input.submissionDigest, input.gasketResponse); break;
          case "assess":
            result = await workflow.assessRequirement(input.role, input.submissionDigest, input.itemId, input.status, input.note);
            break;
          case "preview-handoff": result = await workflow.previewHandoff(input.role); break;
          case "apply-handoff": result = await workflow.applyHandoff(input.role, input.previewId); break;
          case "observe": result = await workflow.recordObservation(input.role, input.stage); break;
          case "review":
            if (typeof input.digest !== "string" || !/^[0-9a-f]{64}$/.test(input.digest)) throw new Error("Refresh the proposal before reviewing");
            result = await workflow.review(input.role, input.digest, input.outcome, input.reason, input.submissionDigest); break;
          default: throw new Error("Unknown demonstration action");
        }
        const message = result.type === "lineage_act_recorded" ? "Review recorded against the displayed proposal."
          : result.message ?? result.reason ?? (result.status === "committed" ? "Script preview checked and applied to the contractor submittal. Accepted design unchanged." : JSON.stringify(result));
        return { result, message };
      };
      const next = pending.then(execute);
      pending = next.catch(() => {});
      res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(await next)); return;
    }
    if (req.method !== "GET") { res.writeHead(405).end(); return; }
    if (["/load-rating.txt", "/load-rating-rev-b.txt"].includes(url.pathname)) {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(workflow.loadRatingDocument(url.pathname === "/load-rating-rev-b.txt"));
      return;
    }
    if (url.pathname === "/api/state") { await pending; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(await workflow.state(url.searchParams.get("role") ?? "owner"))); return; }
    if (url.pathname === "/mh1-delivery.jpg") {
      const photo = await readFile(path.join(here, "sample/mh1-delivery.jpg"));
      res.writeHead(200, { "Content-Type": "image/jpeg" }).end(photo);
      return;
    }
    if (url.pathname === "/") { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>MutinyBIM contractor substitution</title><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>'); return; }
    const file = path.resolve(outDir, `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(outDir + path.sep)) { res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream");
    res.end(await readFile(file));
  } catch (error) { if (!res.headersSent) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); } }
});
const port = Number(process.env.CIVIL_SUBSTITUTION_PORT ?? 3203);
server.listen(port, "127.0.0.1", () => console.log(`Civil substitution: http://127.0.0.1:${server.address().port}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { workflow.close(); server.close(); });
