import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { projectParametersOf } from "@permitzip/bim-kernel";
import { bindModelPacks } from "@permitzip/bim-pack";
import { checkScriptOutput, parseScriptOutput, sliceModel } from "@permitzip/bim-script";
import { LocalScriptRunner } from "@permitzip/bim-script-runner/local";
import { InMemoryBranchHost, SERVER_FEATURES } from "@permitzip/bim-sync";
import { qty, to } from "@permitzip/bim-units";
import { declaredReads } from "../../../packages/bim-mcp/src/examples.ts";
import { syntheticSiteModel, CIVIL_SET } from "../../../packages/bim-pack-civil/__tests__/fixtures/synthetic-site.ts";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const actor = { id: "demo-survey-reviewer", name: "Civil reviewer (demo)", kind: "human" };
const datum = "DEMO-BM1";
const header = "shot,pipe,structure,port,datum,unit,elevation";
const endpoints = [
  { pipe: "P101-s1", structure: "MH1", port: "in_e", label: "MH1 inlet" },
  { pipe: "P103-s1", structure: "MH1", port: "out", label: "MH1 outlet" },
];

function invert(model, id) {
  return model.elements[id].values["civil.invert_elevation"];
}

export function readSurvey(csv, model) {
  const [columns, ...lines] = csv.trim().split(/\r?\n/);
  if (columns !== header || lines.length !== endpoints.length) throw new Error("Expected the two MH1 shots in the sample CSV format.");
  const shots = lines.map((line) => {
    const [shot, pipe, structure, port, verticalDatum, unit, elevation, ...extra] = line.split(",");
    const endpoint = endpoints.find((entry) => entry.pipe === pipe && entry.structure === structure && entry.port === port);
    const segment = model.elements[pipe];
    const linked = segment?.kind === "run_segment" && Object.values(segment.links ?? {}).some((link) => link.elementId === structure && link.port === port);
    if (!endpoint || !linked) throw new Error("A survey shot does not match an MH1 pipe and connector.");
    if (verticalDatum !== datum || unit !== "m") throw new Error("Survey shots must use metres on the DEMO-BM1 datum.");
    if (extra.length || !/^[\w-]+$/.test(shot) || !/^-?\d+(?:\.\d{1,3})?$/.test(elevation ?? "") || !Number.isFinite(Number(elevation))) {
      throw new Error("Invalid survey shot ID or elevation.");
    }
    const measuredMm = Math.round(to(qty("length", Number(elevation), "m"), "mm"));
    if (!Number.isSafeInteger(measuredMm)) throw new Error("Survey elevation is out of range.");
    const designMm = invert(model, structure);
    return { ...endpoint, shot, designMm, measuredMm, deltaMm: measuredMm - designMm };
  });
  if (new Set(shots.map(({ pipe }) => pipe)).size !== 2 || new Set(shots.map(({ shot }) => shot)).size !== 2) {
    throw new Error("Each pipe end and shot ID must occur once.");
  }
  return endpoints.map(({ pipe }) => shots.find((shot) => shot.pipe === pipe));
}

export async function createSurveyWorkflow() {
  const design = syntheticSiteModel("mh1-survey-design");
  const host = await InMemoryBranchHost.start(design);
  const branch = await host.registry.create({ baseModelId: design.modelId, name: "MH1 survey record", baseRevision: design.revision, createdBy: actor.id });
  bindModelPacks(branch.modelId, CIVIL_SET);
  const record = await host.open(branch.modelId);
  const runner = new LocalScriptRunner({ repoRoot });
  const source = await readFile(new URL("./accept-invert.ts", import.meta.url), "utf8");
  const csv = await readFile(new URL("./mh1-survey.csv", import.meta.url), "utf8");
  let observations = null;
  let preview = null;
  let acceptedPreviewId = null;

  return {
    csv,
    async state() {
      const head = await record.store.head();
      return {
        datum, designRevision: design.revision, recordRevision: head.revision,
        observations, preview: preview?.display ?? null,
        recordEntry: projectParametersOf(head).values.mh1_outlet_record_invert ?? null,
        profile: { upstreamMm: invert(design, "I1"), mh1Mm: invert(design, "MH1"), downstreamMm: invert(design, "OF1") },
      };
    },
    async recordModel() { return record.store.head(); },
    async designModel() { return host.main.store.head(); },
    async act(action, previewId) {
      if (action === "import") {
        observations = readSurvey(csv, design);
        preview = null;
        return;
      }
      if (!observations) throw new Error("Import the survey shots first.");
      if (action === "accept" && acceptedPreviewId !== null && previewId === acceptedPreviewId) return;
      const head = await record.store.head();
      if (projectParametersOf(head).values.mh1_outlet_record_invert) throw new Error("This survey has already been recorded.");
      if (action === "preview") {
        const outlet = observations.find(({ port }) => port === "out");
        const output = await runner.run({
          source, scriptHash: createHash("sha256").update(source).digest("hex"),
          values: { elevation: to(qty("length", outlet.measuredMm, "mm"), "m") },
          slice: sliceModel(head, declaredReads(source), [], SERVER_FEATURES),
        });
        if (!output.ok) throw new Error(output.message);
        if (!checkScriptOutput(head, output.output, { features: SERVER_FEATURES }).ok) throw new Error("The record edit failed its checks.");
        const parsed = parseScriptOutput(output.output);
        if (parsed.kind !== "edits" || parsed.batches.length !== 1) throw new Error("Expected one record edit.");
        preview = { batch: parsed.batches[0], display: { id: randomUUID(), revision: head.revision, outlet } };
        return;
      }
      if (action !== "accept") throw new Error("Unknown survey action.");
      if (!preview || preview.display.id !== previewId || preview.display.revision !== head.revision) throw new Error("Preview the survey edit against the current record revision.");
      const outcome = await record.sequencer.submit({
        idempotencyKey: previewId, baseRevision: head.revision, actor, command: preview.batch,
      });
      if (outcome.status !== "committed") throw new Error(outcome.error?.message ?? "Could not save the record edit.");
      acceptedPreviewId = previewId;
      preview = null;
    },
  };
}
