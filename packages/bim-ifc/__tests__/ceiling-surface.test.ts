/** @jest-environment node */
import { asElementId, type Ceiling } from "@permitzip/bim-kernel";
import { exportIfc, importIfc, readStep } from "../src";
import { syntheticModel, PROJECT_ID, TIME_STAMP } from "./c5i-model";
import { ofType, ref, refs, text } from "./a13a-ifc-support";

const ceiling: Ceiling = {
  id: asElementId("ceiling"), kind: "ceiling", version: 1, authoredRev: {},
  levelId: asElementId("lvl-2"), form: "sloped", heightMm: 2700,
  reference: { x: 0, y: 0 }, slope: { directionDeg: 0, pitch: 0.1 },
  outline: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }, { x: 0, y: 0 }],
  holes: [[{ x: 1000, y: 1000 }, { x: 2000, y: 1000 }, { x: 2000, y: 2000 }, { x: 1000, y: 2000 }]],
};

it("preserves the sloped plane, hole, and upper-storey placement without adding thickness", () => {
  const out = exportIfc({ model: syntheticModel([ceiling]), project: { id: PROJECT_ID, name: "Synthetic ceiling" }, timeStamp: TIME_STAMP });
  const file = readStep(out.text);
  const covering = ofType(file, "IFCCOVERING").find((e) => text(e, 0) === out.report.globalIds[ceiling.id]);
  if (!covering) throw new Error("Missing ceiling");
  const placement = file.entities.get(ref(covering, 5));
  if (!placement) throw new Error("Missing placement");
  const parent = ref(placement, 0);
  const storey = ofType(file, "IFCBUILDINGSTOREY").find((s) => text(s, 2) === "Level 2");
  expect(storey && ref(storey, 5)).toBe(parent);
  const outer = ofType(file, "IFCFACEOUTERBOUND");
  const inner = ofType(file, "IFCFACEBOUND");
  expect(outer).toHaveLength(1);
  expect(inner).toHaveLength(1);
  for (const bound of [...outer, ...inner]) {
    const loop = file.entities.get(ref(bound, 0));
    if (!loop) throw new Error("Missing loop");
    expect(refs(loop, 0)).toHaveLength(4);
    for (const point of refs(loop, 0).map((id) => file.entities.get(id))) {
      const coords = point?.args[0];
      const xyz = coords?.kind === "list" ? coords.items.map((v) => v.kind === "number" ? v.value : NaN) : [];
      expect(xyz[2]).toBeCloseTo(2700 + (xyz[0] ?? NaN) * 0.1, 6);
    }
  }
  const back = importIfc(out.text, {
    model: syntheticModel(), referenceId: "ceiling-ref", sourceKey: "ceiling-ref", sourceId: "v1",
    label: "Ceiling surfaces", disciplines: ["architecture"],
  });
  const report = back.report.classes.find((entry) => entry.label === "Ceilings");
  expect(report).toMatchObject({ converted: 0 });
  expect(report?.linked.reduce((sum, entry) => sum + entry.count, 0)).toBe(1);
  expect(ofType(file, "IFCSHELLBASEDSURFACEMODEL")).toHaveLength(1);
});

it("keeps an open-to-structure ceiling as a named placement and reports the missing physical surface", () => {
  const out = exportIfc({ model: syntheticModel([{ ...ceiling, form: "open_to_structure" }]),
    project: { id: PROJECT_ID, name: "Synthetic opening" }, timeStamp: TIME_STAMP });
  const file = readStep(out.text);
  const covering = ofType(file, "IFCCOVERING").find((e) => text(e, 0) === out.report.globalIds[ceiling.id]);
  expect(covering?.args[5]?.kind).toBe("ref");
  expect(covering?.args[6]?.kind).toBe("null");
  expect(out.report.warnings).toContain("ceiling: its ceiling has no physical surface to write");
});

it.each([false, true])("keeps multiple holes and consistent winding when input is reversed=%s", (reverse) => {
  const orient = (points: Ceiling["outline"]) => reverse ? [...points].reverse() : points;
  const outer = ceiling.outline;
  const shape: Ceiling = {
    ...ceiling, spaceId: asElementId("missing-space"), reference: { x: 1000, y: 1000 },
    slope: { directionDeg: 90, pitch: -0.2 },
    outline: orient([outer[0]!, outer[0]!, ...outer.slice(1)]),
    holes: [
      orient(ceiling.holes?.[0] ?? []),
      orient([{ x: 2500, y: 1000 }, { x: 3000, y: 1000 }, { x: 3000, y: 2000 }, { x: 2500, y: 2000 }]),
    ],
  };
  const out = exportIfc({ model: syntheticModel([shape]), project: { id: PROJECT_ID, name: "Synthetic holes" }, timeStamp: TIME_STAMP });
  const file = readStep(out.text);
  expect(ofType(file, "IFCFACEBOUND")).toHaveLength(2);
  const bounds = [...ofType(file, "IFCFACEOUTERBOUND"), ...ofType(file, "IFCFACEBOUND")];
  for (const bound of bounds) {
    const loop = file.entities.get(ref(bound, 0));
    if (!loop) throw new Error("Missing loop");
    const points = refs(loop, 0).map((id) => {
      const coordinates = file.entities.get(id)?.args[0];
      if (coordinates?.kind !== "list") throw new Error("Missing coordinates");
      return coordinates.items.map((value) => value.kind === "number" ? value.value : NaN);
    });
    expect(points).toHaveLength(4);
    for (const point of points) expect(point[2]).toBeCloseTo(2700 - ((point[1] ?? NaN) - 1000) * 0.2, 6);
    const area = points.reduce((sum, point, i) => {
      const next = points[(i + 1) % points.length]!;
      return sum + point[0]! * next[1]! - next[0]! * point[1]!;
    }, 0) / 2;
    expect(area).toBe(bound.type === "IFCFACEOUTERBOUND" ? 12000000 : -Math.abs(area));
    expect(Math.abs(area)).toBeGreaterThan(0);
  }
  const covering = ofType(file, "IFCCOVERING").find((e) => text(e, 0) === out.report.globalIds[shape.id]);
  if (!covering) throw new Error("Missing ceiling");
  const container = ofType(file, "IFCRELCONTAINEDINSPATIALSTRUCTURE").find((rel) => refs(rel, 4).includes(covering.id));
  const storey = ofType(file, "IFCBUILDINGSTOREY").find((s) => text(s, 2) === "Level 2");
  expect(container && ref(container, 5)).toBe(storey?.id);
});

it("reports a malformed opening instead of filling it in", () => {
  const out = exportIfc({ model: syntheticModel([{ ...ceiling, holes: [[{ x: 100, y: 100 }, { x: 200, y: 100 }]] }]),
    project: { id: PROJECT_ID, name: "Synthetic malformed opening" }, timeStamp: TIME_STAMP });
  const file = readStep(out.text);
  const covering = ofType(file, "IFCCOVERING").find((e) => text(e, 0) === out.report.globalIds[ceiling.id]);
  expect(covering?.args[6]?.kind).toBe("null");
  expect(out.report.warnings).toContain("ceiling: its ceiling boundary could not be written; check its outline and openings");
});
