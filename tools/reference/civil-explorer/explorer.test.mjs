import assert from "node:assert/strict";
import test from "node:test";
import { register } from "tsx/esm/api";
register();
const { syntheticSiteModel } = await import("../../../packages/bim-pack-civil/__tests__/fixtures/synthetic-site.ts");
const { CIVIL_PARAM } = await import("@permitzip/bim-pack-civil");
const { explorerData, traceSelection } = await import("./data.ts");
const model = syntheticSiteModel("civil-explorer-test");
const before = JSON.stringify(model);
const data = explorerData(model);

test("existing fixture remains untouched and retains its reference totals", () => {
  assert.equal(JSON.stringify(model), before);
  assert.equal(data.catchments.length, 3);
  assert.equal(data.structures.length, 4);
  assert.equal(data.pipes.length, 3);
  assert.ok(Math.abs(data.structures.find((s) => s.id === "OF1").runoff - 4.501111) < 1e-6);
  assert.equal(data.intensity, 4);
  assert.equal(data.minimumSlope, 0.5);
});
test("inlet trace uses oriented network despite P102 being drawn backwards", () => {
  const trace = traceSelection(data, "I2");
  assert.deepEqual(trace.path, ["I2", "MH1", "OF1"]);
  assert.deepEqual(trace.catchmentIds, ["C2", "C3"]);
  assert.deepEqual(trace.pipeIds.sort(), ["P102-s1", "P103-s1"]);
  assert.equal(trace.problem, null);
});
test("selecting a catchment does not claim its neighboring catchment as a contributor", () => {
  const trace = traceSelection(data, "C2");
  assert.deepEqual(trace.catchmentIds, ["C2"]);
  assert.deepEqual(trace.path, ["I2", "MH1", "OF1"]);
  assert.ok(!trace.ids.includes("C3"));
});
test("outfall and pipe inspection show all actual upstream catchments", () => {
  assert.deepEqual(traceSelection(data, "OF1").catchmentIds, ["C1", "C2", "C3"]);
  assert.deepEqual(traceSelection(data, "P103-s1").catchmentIds, ["C1", "C2", "C3"]);
  assert.deepEqual(traceSelection(data, "OF1").pipeIds, []);
});
test("existing findings and dimensional values are preserved", () => {
  assert.deepEqual(data.findings.map((f) => f.rule).sort(), ["civil.inlet_overloaded", "civil.slope_below_minimum"]);
  assert.match(data.findings[0].message, /2\.64 cfs.*2\.50 cfs/);
  assert.equal(data.pipes.find((p) => p.id === "P103-s1").status, "too_flat");
  assert.ok(Math.abs(data.structures.find((s) => s.id === "I2").invert - 96.5) < 1e-8);
});
test("unknown selections are rejected, unresolved paths and cycles terminate visibly", () => {
  assert.throws(() => traceSelection(data, "missing"), /known civil element/);
  assert.match(traceSelection({ ...data, downstream: { I1: "MH1", MH1: "I1" } }, "I1").problem, /Cycle/);
  assert.match(traceSelection({ ...data, downstream: {} }, "I1").problem, /no resolved downstream path/);
  const unassigned = { ...data, catchments: data.catchments.map((c) => ({ ...c, drainsTo: null })) };
  assert.match(traceSelection(unassigned, "C1").problem, /no assigned inlet/);
});
test("missing rainfall intensity stays unknown rather than becoming zero runoff", () => {
  const missing = JSON.parse(JSON.stringify(model));
  delete missing.elements["sys-storm"].values[CIVIL_PARAM.designIntensity];
  const unknown = explorerData(missing);
  assert.equal(unknown.intensity, null);
  assert.equal(unknown.structures.find((s) => s.id === "OF1").runoff, null);
  assert.ok(unknown.problems.some((p) => /rainfall intensity/.test(p)));
});
