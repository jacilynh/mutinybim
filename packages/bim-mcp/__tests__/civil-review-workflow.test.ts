/** @jest-environment node */
import { toScriptRunResult } from "../../bim-script-runner/src/result";
import { bindModelPacks, unbindModelPacks, PackSet } from "@permitzip/bim-kernel/packs";
import { DEFAULT_SETTINGS, asRevision, gatedRecordFeatures } from "@permitzip/bim-kernel";
import { checkScriptOutput, defineScript, runScript, sliceModel } from "@permitzip/bim-script";
import { PROTOCOL_FEATURES } from "@permitzip/bim-sync";
import { Log } from "../../bim-kernel/__tests__/a13a-fixtures";
import { withPackSet } from "@permitzip/bim-kernel/packs";
import { CIVIL_PACK } from "../../bim-pack-civil/src/pack";
import { resolve } from "node:path";
import { runExample } from "../src/examples";
import { importLandXml } from "../../bim-pack-civil/src/landxml";
import { cutFillBetween } from "../../bim-pack-civil/src/tin-volume";
import { to } from "@permitzip/bim-units";

const repoRoot = resolve(__dirname, "../../..");

function surface(name: string, x0: number, x1: number, elevation: (x: number) => number, offset = 0): string {
  const points = [[x0, 0], [x1, 0], [x1, 10], [x0, 10]];
  return `<Surface name="${name}"><Definition surfType="TIN"><Pnts>${points.map(([x, y], i) =>
    `<P id="${i + 1}">${y! + offset} ${x! + offset} ${elevation(x!)}</P>`).join("")}</Pnts><Faces><F>1 2 3</F><F>1 3 4</F></Faces></Definition></Surface>`;
}

function site(proposed: (x: number) => number, unit = "meter", offset = 0, x0 = 0, x1 = 10): string {
  const family = unit === "USSurveyFoot" ? "Imperial" : "Metric";
  return `<LandXML version="1.2"><Units><${family} linearUnit="${unit}"/></Units><Surfaces>${surface("Existing", 0, 10, () => 100, offset)}${surface("Proposed", x0, x1, proposed, offset)}</Surfaces></LandXML>`;
}

function source(xml: string): string {
  return `import { defineScript } from "@permitzip/bim-script";
export default defineScript({
  kind: "layout", reads: { levels: true }, parameters: {},
  run(ctx) {
    ctx.edit({ type: "civil.import_landxml_surfaces", landXml: ${JSON.stringify(xml)} });
    const result = ctx.calc({ calc: "civil.surface_cut_fill", inputs: { existingId: "gs-existing", proposedId: "gs-proposed" } });
    if (!result.ok) throw new Error(result.reason);
    const errors = result.run.issues.filter(issue => issue.severity === "error");
    if (errors.length) throw new Error(errors.map(issue => issue.message).join(" "));
    const value = (key: string) => result.run.values.find(value => value.key === key)?.value;
    const review = result.run.issues.some(issue => /licensed civil engineer/.test(issue.message));
    ctx.label("cut=" + value("cut_m3") + " fill=" + value("fill_m3") + " area=" + value("overlap_area_m2") + " review=" + review);
  }
});`;
}

const scenarios = [
  ["flat fill", site(() => 101), 0, 100, 100],
  ["mixed cut and fill", site(x => 99 + x / 5), 25, 25, 100],
  ["partial overlap", site(() => 101, "meter", 0, 5, 15), 0, 50, 50],
  ["survey coordinates", site(() => 101, "meter", 2000000), 0, 100, 100],
  ["US survey feet", site(() => 101, "USSurveyFoot"), 0, 100 * (1200 / 3937) ** 3, 100 * (1200 / 3937) ** 2],
] as const;

it.each(scenarios)("%s through the in-process script and model commit", async (name, xml, cut, fill, area) => {
  const modelId = "direct-" + name;
  const packs = PackSet.create([CIVIL_PACK]);
  bindModelPacks(modelId, packs);
  try {
    const log = new Log({ modelId, revision: asRevision(0), elements: {}, connections: [], settings: DEFAULT_SETTINGS });
    const definition = defineScript({
      kind: "layout", reads: { levels: true }, parameters: {},
      run(ctx) {
        ctx.edit({ type: "civil.import_landxml_surfaces", landXml: xml });
        const result = ctx.calc({ calc: "civil.surface_cut_fill", inputs: { existingId: "gs-existing", proposedId: "gs-proposed" } });
        if (!result.ok) throw new Error(result.reason);
        const value = (key: string) => Number(result.run.values.find(v => v.key === key)?.value);
        expect(value("cut_m3")).toBeCloseTo(cut, 6);
        expect(value("fill_m3")).toBeCloseTo(fill, 6);
        expect(value("overlap_area_m2")).toBeCloseTo(area, 6);
        expect(result.run.issues.some(issue => /licensed civil engineer/.test(issue.message))).toBe(true);
        ctx.label("Imported and calculated " + name);
      },
    });
    const features = [...Object.values(PROTOCOL_FEATURES), ...gatedRecordFeatures()];
    const output = await runScript(definition, { slice: sliceModel(log.head, definition.manifest.reads, [], features), values: {}, scriptHash: "sha256:civil-review", packs });
    if (output.kind !== "edits") throw new Error("Expected edits");
    withPackSet(packs, () => { for (const batch of output.batches) log.ok(batch); });
    expect(Object.values(log.head.elements).filter(element => String(element.kind) === "civil.grading_surface")).toHaveLength(2);
  } finally {
    unbindModelPacks(modelId);
  }
});

it.each(scenarios)("%s through check, preview, apply, and calculation", async (name, xml, cut, fill, area) => {
  bindModelPacks(name, PackSet.create([CIVIL_PACK]));
  let result;
  try {
    result = await runExample(source(xml), { repoRoot, modelId: name });
  } finally {
    unbindModelPacks(name);
  }
  const match = /cut=(\S+) fill=(\S+) area=(\S+) review=true/.exec(result.label);
  expect(match).not.toBeNull();
  expect(Number(match?.[1])).toBeCloseTo(cut, 6);
  expect(Number(match?.[2])).toBeCloseTo(fill, 6);
  expect(Number(match?.[3])).toBeCloseTo(area, 6);
  expect(result.kinds["civil.grading_surface"]).toBe(2);
}, 120000);

it.each(["Surfaces", "Pnts"])("accepts a valid XML comment before closing %s", (tag) => {
  const xml = site(() => 101).replace("</" + tag + ">", "<!-- exported data --></" + tag + ">");
  const result = importLandXml(xml);
  expect(result.problems).toEqual([]);
  expect(result.surfaces).toHaveLength(2);
});

it("flags a duplicate triangle instead of silently reporting inflated earthwork", () => {
  const xml = site(() => 101).replace("<F>1 2 3</F>", "<F>1 2 3</F><F>1 2 3</F>");
  const imported = importLandXml(xml);
  const [existing, proposed] = imported.surfaces;
  if (!existing || !proposed) throw new Error(imported.problems.join(" "));
  const result = cutFillBetween(existing, proposed);
  expect(to(result.fill, "m3")).toBeCloseTo(100, 6);
  expect(result.issues.join(" ")).toMatch(/duplicate|overlap/i);
});

it.each([
  ["missing units", site(() => 101).replace(/<Units>.*?<\/Units>/, ""), /doesn't say its units/],
  ["missing face point", site(() => 101).replace("<F>1 2 3</F>", "<F>1 2 missing</F>"), /names point missing/],
] as const)("stops a %s import with an actionable error through the tool runner", async (name, xml, pattern) => {
  const modelId = "invalid-" + name;
  bindModelPacks(modelId, PackSet.create([CIVIL_PACK]));
  try {
    await expect(runExample(source(xml), { repoRoot, modelId })).rejects.toThrow(pattern);
  } finally {
    unbindModelPacks(modelId);
  }
}, 120000);

it("does not enable civil edits on another model after a successful civil run", async () => {
  const civilId = "isolated-civil";
  bindModelPacks(civilId, PackSet.create([CIVIL_PACK]));
  try {
    const result = await runExample(source(site(() => 101)), { repoRoot, modelId: civilId });
    expect(result.kinds["civil.grading_surface"]).toBe(2);
    await expect(runExample(source(site(() => 101)), { repoRoot, modelId: "without-civil" })).rejects.toThrow(/isn't a valid edit/);
  } finally {
    unbindModelPacks(civilId);
  }
}, 120000);

it("keeps two concurrent models' civil add-on settings isolated", async () => {
  const civilId = "concurrent-civil";
  bindModelPacks(civilId, PackSet.create([CIVIL_PACK]));
  try {
    const [enabled, disabled] = await Promise.allSettled([
      runExample(source(site(() => 101)), { repoRoot, modelId: civilId }),
      runExample(source(site(() => 101)), { repoRoot, modelId: "concurrent-without-civil" }),
    ]);
    expect(enabled.status).toBe("fulfilled");
    expect(disabled.status).toBe("rejected");
    if (enabled.status === "fulfilled") expect(enabled.value.kinds["civil.grading_surface"]).toBe(2);
    if (disabled.status === "rejected") expect(String(disabled.reason)).toMatch(/isn't a valid edit/);
  } finally {
    unbindModelPacks(civilId);
  }
}, 120000);

it("validates a returned batch under its model and still rejects it for a model without civil", () => {
  const modelId = "returned-batch";
  const model = { modelId, revision: asRevision(0), elements: {}, connections: [], settings: DEFAULT_SETTINGS };
  const plain = { ...model, modelId: "plain-returned-batch" };
  const output = { kind: "edits", label: "Import surfaces", steps: 1, batches: [{
    type: "batch_edits", label: "Import surfaces", commands: [{ type: "civil.import_landxml_surfaces", landXml: site(() => 101) }],
  }] };
  const line = { ok: true as const, output, bytes: 100, ms: 1 };
  bindModelPacks(modelId, PackSet.create([CIVIL_PACK]));
  try {
    expect(toScriptRunResult(line, () => 1, sliceModel(model, {})).ok).toBe(true);
    expect(toScriptRunResult(line, () => 1, sliceModel(plain, {})).ok).toBe(false);
    expect(checkScriptOutput(model, output, { features: [...Object.values(PROTOCOL_FEATURES), ...gatedRecordFeatures()] }).ok).toBe(true);
    expect(() => checkScriptOutput(plain, output)).toThrow(/valid batch_edits/);
    expect(model.elements).toEqual({});
  } finally {
    unbindModelPacks(modelId);
  }
});


it("validates against the submitted add-on snapshot even after the live model binding changes", () => {
  const modelId = "snapshot-model";
  const model = { modelId, revision: asRevision(0), elements: {}, connections: [], settings: DEFAULT_SETTINGS };
  bindModelPacks(modelId, PackSet.create([CIVIL_PACK]));
  const slice = sliceModel(model, {});
  unbindModelPacks(modelId);
  const output = { kind: "edits", label: "Import surfaces", steps: 1, batches: [{
    type: "batch_edits", label: "Import surfaces", commands: [{ type: "civil.import_landxml_surfaces", landXml: site(() => 101) }],
  }] };
  expect(toScriptRunResult({ ok: true, output, bytes: 100, ms: 1 }, () => 1, slice).ok).toBe(true);
  expect(toScriptRunResult({ ok: true, output, bytes: 100, ms: 1 }, () => 1, sliceModel(model, {})).ok).toBe(false);
});
