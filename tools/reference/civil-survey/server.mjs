import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "tsx/esm/api";

register();
const { renderCloseout } = await import("./closeout.tsx");
const { createSurveyWorkflow } = await import("./workflow.mjs");
const { buildEditorDemo } = await import("../../../packages/bim-editor/demo/build.ts");
const outDir = fileURLToPath(new URL("../../../mutinybim-examples/civil-survey/dist", import.meta.url));
await buildEditorDemo({ entry: fileURLToPath(new URL("./app.tsx", import.meta.url)), outDir });
const workflow = await createSurveyWorkflow();
const types = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
let pending = Promise.resolve();
const json = (res, data, status = 200) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(data));

async function closeoutArchive(state, html, csv) {
  const files = {
    "mh1-survey-closeout.html": html,
    "mh1-survey.csv": csv,
  };
  const manifest = {
    version: 1,
    structure: "MH1",
    designRevision: state.designRevision,
    recordRevision: state.recordRevision,
    acceptedRecord: state.recordEntry,
    files: Object.entries(files).map(([name, contents]) => ({
      name,
      sha256: createHash("sha256").update(contents, "utf8").digest("hex"),
    })),
  };
  files["manifest.json"] = JSON.stringify(manifest, null, 2) + "\n";
  const folder = await mkdtemp(path.join(tmpdir(), "mh1-closeout-"));
  try {
    for (const [name, contents] of Object.entries(files)) await writeFile(path.join(folder, name), contents);
    const { stdout } = await promisify(execFile)("zip", ["-q", "-", ...Object.keys(files)], {
      cwd: folder, encoding: "buffer", timeout: 5000,
    });
    return stdout;
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, "http://localhost");
    if (pathname === "/api/action" && req.method === "POST") {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return res.writeHead(403).end();
      if (!req.headers["content-type"]?.startsWith("application/json")) return res.writeHead(415).end();
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 1024) return res.writeHead(413).end();
      }
      const { action, previewId } = JSON.parse(body);
      const operation = pending.then(async () => {
        await workflow.act(action, previewId);
        return workflow.state();
      });
      pending = operation.catch(() => {});
      return json(res, await operation);
    }
    if (req.method !== "GET") return res.writeHead(405).end();
    if (pathname === "/api/state") {
      await pending;
      return json(res, await workflow.state());
    }
    if (pathname === "/closeout" || pathname === "/closeout.zip") {
      await pending;
      const csvHref = `data:text/csv;base64,${Buffer.from(workflow.csv).toString("base64")}`;
      const state = await workflow.state();
      const html = renderCloseout(state, csvHref);
      if (!html) return json(res, { error: "Accept the outlet invert before opening the closeout." }, 409);
      if (pathname === "/closeout.zip") {
        const archive = await closeoutArchive(state, html, workflow.csv);
        return res.writeHead(200, {
          "Content-Type": "application/zip",
          "Content-Disposition": 'attachment; filename="mh1-survey-closeout.zip"',
          "Cache-Control": "no-store",
        }).end(archive);
      }
      const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" };
      if (new URL(req.url, "http://localhost").searchParams.has("download")) {
        headers["Content-Disposition"] = 'attachment; filename="mh1-survey-closeout.html"';
      }
      return res.writeHead(200, headers).end(html);
    }
    if (pathname === "/mh1-survey.csv") return res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8" }).end(workflow.csv);
    if (pathname === "/") {
      return res.writeHead(200, { "Content-Type": "text/html" }).end(
        '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>MH1 survey review</title><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/app.css"><div id="root"></div><script type="module" src="/app.js"></script></html>',
      );
    }
    const asset = path.resolve(outDir, `.${decodeURIComponent(pathname)}`);
    if (!asset.startsWith(outDir + path.sep) || !types[path.extname(asset)]) return res.writeHead(404).end();
    const bytes = await readFile(asset);
    return res.writeHead(200, { "Content-Type": types[path.extname(asset)] }).end(bytes);
  } catch (error) {
    return json(res, { error: error.message }, error.code === "ENOENT" ? 404 : 400);
  }
}).listen(Number(process.env.CIVIL_SURVEY_PORT ?? 3204), "127.0.0.1", () => {
  console.log(`MH1 survey review at http://127.0.0.1:${process.env.CIVIL_SURVEY_PORT ?? 3204}`);
});
