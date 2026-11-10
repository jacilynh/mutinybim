#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "tsx/esm/api";
import { Resvg } from "@resvg/resvg-js";
register();

const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
const { InMemoryBranchHost } = await import("@permitzip/bim-sync");
const { declaredReads } = await import("../../../packages/bim-mcp/src/examples.ts");
const { createLocalHost, LOCAL_RUNS_WHERE } = await import("../../../packages/bim-mcp/src/local/index.ts");
const { LOCAL_SCHEMAS } = await import("../../../packages/bim-mcp/src/schemas.ts");
const { createBimToolServer } = await import("../../../packages/bim-mcp/src/server.ts");
const { civilPacket, civilMarkdown, profileSvg } = await import("./packet.mjs");

const { syntheticSiteModel, CIVIL_SET } = await import("../../../packages/bim-pack-civil/__tests__/fixtures/synthetic-site.ts");
const { bindModelPacks } = await import("@permitzip/bim-pack");

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const args = process.argv.slice(2);
if (args.length && (args[0] !== "--out" || args.length !== 2)) throw new Error("Usage: node tools/reference/civil-review/run.mjs [--out folder]");
const out = path.resolve(args[1] ?? path.join(repoRoot, "mutinybim-examples/civil-review"));
const baseline = syntheticSiteModel("civil-invert-reference");
const original = JSON.stringify(baseline);
const branches = await InMemoryBranchHost.start(baseline);
// Fixture setup uses the real branch registry, pinned to the accepted baseline.
const branch = await branches.registry.create({ baseModelId: baseline.modelId, name: "OF1 invert revision", baseRevision: baseline.revision, createdBy: "reference-author" });
bindModelPacks(branch.modelId, CIVIL_SET);
const served = await branches.open(branch.modelId);
assert.ok(served, "The proposal branch must open");

// Adapt the branch host to the existing local MCP host contract. No network listener.
const models = {
  url: "memory://rooftop-reference/sync",
  models: () => [baseline.modelId, branch.modelId],
  seed: async () => { throw new Error("The reference host is already seeded"); },
  head: async (id) => (await branches.open(id))?.store.head() ?? null,
  close: async () => {},
  socketFactory(url, handlers) {
    let joined;
    let closed = false;
    const ready = (async () => {
      const model = await branches.open(new URL(url).searchParams.get("model"));
      if (!model) throw new Error("Unknown reference model");
      const conn = { id: randomUUID(), send: (data) => setTimeout(() => !closed && handlers.onMessage(data), 0) };
      joined = { hub: model.hub, conn };
      model.hub.join(conn);
      handlers.onOpen();
    })();
    ready.catch((err) => handlers.onClose(String(err)));
    return {
      send: (data) => { void ready.then(() => joined.hub.handle(joined.conn, data)).catch((err) => handlers.onClose(String(err))); },
      close: () => { closed = true; void ready.then(() => joined?.hub.leave(joined.conn)); handlers.onClose("closed"); },
    };
  },
};
const client = new Client({ name: "rooftop-reference", version: "0.1.0" });
const host = createLocalHost({ server: models, repoRoot, approve: "auto" });
const server = createBimToolServer({ host, schemas: LOCAL_SCHEMAS, runsWhere: LOCAL_RUNS_WHERE });
try {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);
  const call = async (name, parameters) => {
    const response = await client.callTool({ name, arguments: parameters });
    const body = response.content?.find((c) => c.type === "text")?.text ?? "";
    try { return JSON.parse(body); } catch { throw new Error(`${name}: ${body}`); }
  };
  const applyScript = async (filename) => {
    const beforePreview = JSON.stringify(await served.store.head());
    const source = await readFile(path.join(here, filename), "utf8");
    const script = { source, reads: declaredReads(source) };
    const checked = await call("bim_check_output", { script });
    assert.deepEqual(checked.findings, [], JSON.stringify(checked));
    const preview = await call("bim_run_script", { model_id: branch.modelId, script });
    assert.equal(preview.status, "previewed", JSON.stringify(preview));
    assert.equal(JSON.stringify(await served.store.head()), beforePreview, "Preview must not save changes");
    const applied = await call("bim_apply_output", preview.apply_with.args);
    assert.equal(applied.status, "saved", JSON.stringify(applied));
    assert.equal(JSON.stringify(await branches.main.store.head()), original, "Main must remain unchanged");
  };
  await applyScript("lower-outfall.ts");
  const first = await served.store.head();
  await applyScript("revise-outfall.ts");
  const second = await served.store.head();
  const packet = civilPacket(baseline, first, second, branch);
  assert.equal(packet.review.status, "needs_another_look");
  await mkdir(out, { recursive: true });
  for (const [name, value] of Object.entries({
    "baseline.model.json": baseline, "reviewed.model.json": first,
    "revised.model.json": second, "review-packet.json": packet,
    "host-snapshot.json": await branches.snapshot(),
  })) await writeFile(path.join(out, name), `${JSON.stringify(value, null, 2)}\n`);
  await writeFile(path.join(out, "review-packet.md"), civilMarkdown(packet));
  const svg = profileSvg(packet);
  await writeFile(path.join(out, "since-review.svg"), svg);
  await writeFile(path.join(out, "since-review.png"), new Resvg(svg).render().asPng());
  console.log(`Civil invert reference built: ${out}\nMain unchanged; two script edits on one branch.\nEarlier fictional review: ${packet.review.status}.`);
} finally {
  await client.close();
  await server.close();
}
