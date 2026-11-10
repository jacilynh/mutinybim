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
const { runExample, declaredReads } = await import("../../../packages/bim-mcp/src/examples.ts");
const { createLocalHost, LOCAL_RUNS_WHERE } = await import("../../../packages/bim-mcp/src/local/index.ts");
const { LOCAL_SCHEMAS } = await import("../../../packages/bim-mcp/src/schemas.ts");
const { createBimToolServer } = await import("../../../packages/bim-mcp/src/server.ts");
const { buildPacket, markdownPacket, comparisonSvg } = await import("./packet.mjs");

const { sampleReview, assessReview, revisionMarkdown } = await import("./review.mjs");

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const args = process.argv.slice(2);
if (args.length && (args[0] !== "--out" || args.length !== 2)) throw new Error("Usage: node tools/reference/rooftop-review/run.mjs [--out folder]");
const out = path.resolve(args[1] ?? path.join(repoRoot, "mutinybim-examples/rooftop-review"));
const source = await readFile(path.join(here, "baseline.ts"), "utf8");
const { model: baseline } = await runExample(source, { repoRoot, modelId: "reference-office" });
const original = JSON.stringify(baseline);
const branches = await InMemoryBranchHost.start(baseline);
// Fixture setup uses the real branch registry, pinned to the accepted baseline.
const branch = await branches.registry.create({ baseModelId: baseline.modelId, name: "RTU relocation for solar", baseRevision: baseline.revision, createdBy: "reference-author" });
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
  await applyScript("relocate.ts");
  const proposed = await served.store.head();
  assert.equal(JSON.stringify(await branches.main.store.head()), original, "Main must remain unchanged");
  const packet = buildPacket(baseline, proposed, branch);
  await mkdir(out, { recursive: true });
  for (const [name, value] of Object.entries({ "baseline.model.json": baseline, "proposed.model.json": proposed, "review-packet.json": packet, "host-snapshot.json": await branches.snapshot() })) {
    await writeFile(path.join(out, name), `${JSON.stringify(value, null, 2)}\n`);
  }
  await writeFile(path.join(out, "review-packet.md"), markdownPacket(packet));
  const svg = comparisonSvg(baseline, proposed);
  await writeFile(path.join(out, "comparison.svg"), svg);
  await writeFile(path.join(out, "comparison.png"), new Resvg(svg).render().asPng());
  const review = sampleReview(proposed);
  assert.equal(assessReview(review, proposed, proposed).status, "unchanged_in_scope");
  await applyScript("relocate-again.ts");
  const second = await served.store.head();
  const assessment = assessReview(review, proposed, second);
  assert.equal(assessment.status, "needs_another_look");
  const since = buildPacket(proposed, second, branch);
  const full = buildPacket(baseline, second, branch);
  for (const [name, value] of Object.entries({
    "proposed-v2.model.json": second,
    "sample-review.json": review,
    "review-freshness.json": assessment,
    "since-review.json": since,
    "review-packet-v2.json": full,
    "host-snapshot-v2.json": await branches.snapshot(),
  })) await writeFile(path.join(out, name), `${JSON.stringify(value, null, 2)}\n`);
  await writeFile(path.join(out, "since-review.md"), revisionMarkdown(review, assessment, since, full));
  await writeFile(path.join(out, "review-packet-v2.md"), markdownPacket(full));
  const nextSvg = comparisonSvg(proposed, second, ["First reviewed", "Second proposal"]);
  await writeFile(path.join(out, "since-review.svg"), nextSvg);
  await writeFile(path.join(out, "since-review.png"), new Resvg(nextSvg).render().asPng());
  console.log(`Reference scenario built: ${out}\nMain unchanged. Two proposals on the same branch.\nEarlier sample review: ${assessment.status}.\nOpen since-review.md and since-review.png.\nFixture script edits were automatically approved locally; no professional approval or merge occurred.`);
} finally {
  await client.close();
  await server.close();
}
