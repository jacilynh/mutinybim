import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "tsx/esm/api";
register();

const { fromCanonical, to } = await import("@permitzip/bim-units");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
const { syntheticSiteModel } = await import("../../../packages/bim-pack-civil/__tests__/fixtures/synthetic-site.ts");
const { declaredReads } = await import("../../../packages/bim-mcp/src/examples.ts");
const { createLocalHost, startInMemoryModelServer, LOCAL_RUNS_WHERE } = await import("../../../packages/bim-mcp/src/local/index.ts");
const { LOCAL_SCHEMAS } = await import("../../../packages/bim-mcp/src/schemas.ts");
const { createBimToolServer } = await import("../../../packages/bim-mcp/src/server.ts");

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const [flag, directory, ...extra] = process.argv.slice(2);
if ((flag && (flag !== "--out" || !directory)) || extra.length) {
  throw new Error("Usage: node tools/reference/civil-cover-catalog/run.mjs [--out directory]");
}
const out = directory ? path.resolve(directory) : path.join(repoRoot, "mutinybim-examples/civil-cover-catalog");
const sheet = JSON.parse(await readFile(path.join(here, "cut-sheet.json"), "utf8"));
const template = await readFile(path.join(here, "install.ts"), "utf8");
const source = template.replace('"__CUT_SHEET__"', () => JSON.stringify(JSON.stringify(sheet)));
const baseline = syntheticSiteModel("civil-cover-catalog");
const models = startInMemoryModelServer();
await models.seed(baseline);
const host = createLocalHost({ server: models, repoRoot, approve: "auto" });
const server = createBimToolServer({ host, schemas: LOCAL_SCHEMAS, runsWhere: LOCAL_RUNS_WHERE });
const client = new Client({ name: "civil-cover-catalog", version: "0.1.0" });

try {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(a), server.connect(b)]);
  const call = async (name, args) => {
    const response = await client.callTool({ name, arguments: args });
    return JSON.parse(response.content.find((item) => item.type === "text").text);
  };
  const script = { source, reads: declaredReads(source) };
  const preview = await call("bim_run_script", { model_id: baseline.modelId, script });
  assert.equal(preview.status, "previewed", JSON.stringify(preview));
  const checked = await call("bim_check_output", { script });
  assert.deepEqual(checked.findings, [], JSON.stringify(checked));
  assert.deepEqual(await models.head(baseline.modelId), baseline);
  const applied = await call("bim_apply_output", preview.apply_with.args);
  assert.equal(applied.status, "saved", JSON.stringify(applied));
  const model = await models.head(baseline.modelId);
  assert.ok(model);
  for (const [id, record] of Object.entries(baseline.elements)) assert.deepEqual(model.elements[id], record);
  assert.deepEqual(model.connections, baseline.connections);
  const schedule = preview.report.find((item) => item.label === "Structure schedule").value;
  assert.equal(schedule.totalRows, 1);
  const row = schedule.rows[0];
  assert.equal(row.element, "MH1-COVER");
  assert.equal(row.cells.structure_mark, "MH1");
  assert.equal(row.cells.order_code, "ECC-FC600-G");
  assert.equal(row.cells.spec_source, "ECC-FC600, Rev A, p. 1");
  assert.equal(model.elements["MH1-COVER"].typeId, "example.civil.ecc-fc600-g");
  assert.equal(model.elements["example.civil.ecc-fc600-s"].kind, "part_type");
  assert.equal(model.elements["civil-cover-schedule"].viewType, "schedule");
  const chosen = sheet.variants.find((variant) => variant.orderCode === row.cells.order_code);
  assert.ok(chosen);
  assert.equal(row.cells.cover_code, chosen.cover);
  assert.equal(row.cells.frame_code, sheet.frame);
  for (const [key, dimension] of [
    ["clear_opening", sheet.clearOpeningMm],
    ["frame_outer_diameter", sheet.frameOuterDiameterMm],
    ["frame_depth", sheet.frameDepthMm],
    ["cover_diameter", sheet.coverDiameterMm],
    ["cover_thickness", sheet.coverThicknessMm],
  ]) {
    assert.equal(to(fromCanonical("length", row.cells[key]), "mm"), dimension);
  }
  const fields = schedule.columns.map((column) => {
    const value = row.cells[column.id];
    const shown = column.quantityKind === "length"
      ? `${to(fromCanonical("length", value), "mm")} mm`
      : value;
    return `| ${column.heading} | ${shown} |`;
  });
  const scheduleMarkdown = [
    "# Storm structure schedule", "",
    `Model revision ${model.revision}. Installed assembly MH1-COVER on structure MH1.`, "",
    "| Field | Scheduled value |", "| --- | --- |", ...fields, "",
    "Source document: [Synthetic cut sheet](cut-sheet.md).", "",
  ].join("\n");
  const cutSheetMarkdown = [
    `# ${sheet.document} · Revision ${sheet.revision} · Page ${sheet.page}`, "",
    `**${sheet.manufacturer}**`, "",
    `${sheet.family}. Synthetic product data for the MutinyBIM pilot.`, "",
    "| Order code | Frame | Cover | Configuration |", "| --- | --- | --- | --- |",
    ...sheet.variants.map((variant) => `| ${variant.orderCode} | ${sheet.frame} | ${variant.cover} | ${variant.option} |`), "",
    "Both variants share these dimensions and specifications.", "",
    "| Specification | Value |", "| --- | --- |",
    `| Clear opening | ${sheet.clearOpeningMm} mm |`,
    `| Frame outside diameter | ${sheet.frameOuterDiameterMm} mm |`,
    `| Frame depth | ${sheet.frameDepthMm} mm |`,
    `| Cover diameter | ${sheet.coverDiameterMm} mm |`,
    `| Cover thickness | ${sheet.coverThicknessMm} mm |`,
    `| Material | ${sheet.material} |`,
    "| Load rating | Not stated |", "",
  ].join("\n");
  await mkdir(out, { recursive: true });
  const write = (name, body) => writeFile(path.join(out, name), body);
  await Promise.all([
    write("cut-sheet.md", cutSheetMarkdown),
    write("structure-schedule.md", scheduleMarkdown),
    write("site.model.json", JSON.stringify(model, null, 2) + "\n"),
    write("structure-schedule.json", JSON.stringify(schedule, null, 2) + "\n"),
    write("install.generated.ts", source),
  ]);
  console.log(JSON.stringify(row.cells, null, 2));
  console.log(`Saved model and schedule in ${out}`);
} finally {
  await client.close();
  await server.close();
  await models.close();
}
