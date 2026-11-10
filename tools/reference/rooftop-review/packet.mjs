import { createHash } from "node:crypto";
import { canonicalJson, elementIntegrityIssues, quantityDeltasBetween } from "@permitzip/bim-kernel";
import { measureIn, measure } from "@permitzip/bim-units";

export const digest = (value) => `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
const elements = (model) => Object.values(model.elements);
const rtu = (model) => {
  const found = elements(model).filter((el) => el.kind === "part" && el.mark === "RTU-1");
  if (found.length !== 1) throw new Error("Expected exactly one RTU-1");
  return found[0];
};
const feet = (mm) => measureIn(measure("length", mm, "mm"), "ft");
const round = (value) => Math.round(value * 1000) / 1000;

export function changedElements(before, after) {
  return [...new Set([...Object.keys(before.elements), ...Object.keys(after.elements)])].sort().flatMap((id) => {
    const a = before.elements[id];
    const b = after.elements[id];
    return canonicalJson(a ?? null) === canonicalJson(b ?? null) ? [] : [{ id, kind: (b ?? a).kind, change: !a ? "added" : !b ? "removed" : "modified" }];
  });
}

function integrity(model) {
  const records = elements(model);
  const findings = new Map();
  // Deliberately exhaustive for this tiny offline fixture, not a production hot path.
  const near = () => records.map((el) => el.id);
  for (const el of records) {
    for (const finding of elementIntegrityIssues(model.elements, el, near)) {
      findings.set(digest({ check: finding.check, ports: finding.ports }), finding);
    }
  }
  return findings;
}

export function buildPacket(baseline, proposed, branch) {
  const before = rtu(baseline);
  const after = rtu(proposed);
  const changes = changedElements(baseline, proposed);
  const priorFindings = integrity(baseline);
  const nextFindings = integrity(proposed);
  const newFindings = [...nextFindings].filter(([key]) => !priorFindings.has(key)).map(([, value]) => value);
  const ductTotals = (model) => {
    const totals = {};
    for (const el of elements(model).filter((el) => el.kind === "run_segment" && el.domain === "duct")) {
      const length = Math.hypot(el.end.x - el.start.x, el.end.y - el.start.y, el.end.z - el.start.z);
      const key = el.systemId;
      totals[key] = (totals[key] ?? 0) + length;
    }
    return Object.fromEntries(Object.entries(totals).sort().map(([id, mm]) => [id, { value: round(feet(mm)), unit: "ft" }]));
  };
  const fixedKinds = new Set(["wall", "space", "level", "part_type"]);
  const fixed = changes.filter((el) => fixedKinds.has(el.kind));
  const endpoints = (model) => elements(model).filter((el) => el.kind === "run_segment" && !el.links.end).map((el) => ({ id: el.id, end: el.end })).sort((a, b) => a.id.localeCompare(b.id));
  const checks = [
    { name: "Equipment identity and selection retained", status: before.id === after.id && before.typeId === after.typeId ? "passed" : "failed" },
    { name: "Walls, spaces, levels and equipment type unchanged", status: fixed.length === 0 ? "passed" : "failed", changedIds: fixed.map((el) => el.id) },
    { name: "Open duct endpoint locations retained", status: canonicalJson(endpoints(baseline)) === canonicalJson(endpoints(proposed)) ? "passed" : "failed" },
    { name: "New kernel connector-integrity findings", status: newFindings.length ? "findings" : "none_found", baselineCount: priorFindings.size, proposedCount: nextFindings.size, newFindings, remainingFindings: [...nextFindings.values()] },
    { name: "Structural capacity, electrical effects, service access and solar clearance", status: "not_evaluated", reason: "This fixture has no structural analysis, electrical route, service-access study or modeled solar array." },
    { name: "Airflow delivery and pressure loss", status: "not_evaluated", reason: "The inherited example sizes ducts from nominal airflow; this relocation does not run a system performance analysis." },
  ];
  return {
    format: "mutinybim-reference-review", version: 1,
    title: "RTU-1 relocation for proposed rooftop solar",
    reason: "Reserve the original equipment location for a proposed solar array; retain equipment selection and served office spaces.",
    mode: "Local synthetic reference; real branch edits, automatically approved fixture execution; no professional approval or merge.",
    baseline: { modelId: baseline.modelId, revision: baseline.revision, digest: digest(baseline) },
    proposed: { modelId: proposed.modelId, revision: proposed.revision, digest: digest(proposed) },
    branch: { id: branch.branchId, name: branch.name, baseRevision: branch.baseRevision },
    relocation: { from: { x: round(feet(before.position.x)), y: round(feet(before.position.y)), unit: "ft" }, to: { x: round(feet(after.position.x)), y: round(feet(after.position.y)), unit: "ft" } },
    changes,
    quantities: { source: "Kernel quantityDeltasBetween; all supported measures. Duct totals separately sum 3D segment centreline lengths, excluding fittings.", deltas: quantityDeltasBetween(baseline.elements, proposed.elements, changes.map((el) => el.id), { all: true }), ductCentreline: { baseline: ductTotals(baseline), proposed: ductTotals(proposed) } },
    checks,
    reviewQuestions: [
      "Mechanical: review the revised supply/return routes and system performance.",
      "Structural: confirm the relocated unit's support and roof capacity.",
      "Electrical: determine whether power and controls need rerouting.",
      "Coordination: confirm solar layout, access, penetrations and maintenance space.",
    ],
    decision: "Awaiting team discussion; no reviewers assigned and no merge performed.",
  };
}

export function markdownPacket(p) {
  const totals = p.quantities.ductCentreline;
  const ids = [...new Set([...Object.keys(totals.baseline), ...Object.keys(totals.proposed)])];
  return `# ${p.title}\n\n${p.mode}\n\n${p.reason}\n\n## Exact comparison\n\n- Baseline: ${p.baseline.modelId}, revision ${p.baseline.revision}\n- Proposed: ${p.proposed.modelId}, revision ${p.proposed.revision}\n- Branch: ${p.branch.name} (fork revision ${p.branch.baseRevision})\n- Baseline fingerprint: ${p.baseline.digest}\n- Proposed fingerprint: ${p.proposed.digest}\n\nThe fingerprints pin these saved snapshots. This offline packet does not monitor later edits; regenerate it after changes.\n\n## What changed\n\nRTU-1 moves from (${p.relocation.from.x}, ${p.relocation.from.y}) ft to (${p.relocation.to.x}, ${p.relocation.to.y}) ft. The kernel carries connected ductwork. See comparison.svg (schematic, both states at the same scale).\n\n${p.changes.map((el) => `- ${el.change}: ${el.kind} — ${el.id}`).join("\n")}\n\n## Measured quantities\n\n${p.quantities.source}\n\n| System | Before (ft) | After (ft) | Difference (ft) |\n| --- | ---: | ---: | ---: |\n${ids.map((id) => { const a = totals.baseline[id]?.value ?? 0; const b = totals.proposed[id]?.value ?? 0; return `| ${id} | ${a} | ${b} | ${round(b - a)} |`; }).join("\n")}\n\nKernel quantity differences:\n${p.quantities.deltas.length ? p.quantities.deltas.map((q) => `- ${q.label} (${q.measure}; raw delta ${q.delta} ${q.unit})`).join("\n") : "- No net change in supported measured quantities. Opposing changes can cancel; consult the per-system totals and changed elements above."}\n\n## Checks against these snapshots\n\n${p.checks.map((c) => `- **${c.status}** — ${c.name}${c.reason ? `: ${c.reason}` : ""}${c.baselineCount !== undefined ? `: ${c.baselineCount} baseline / ${c.proposedCount} proposed findings. Full details in review-packet.json.` : ""}`).join("\n")}\n\nA completed script edit is not an engineering approval. No general clash check or code-compliance review is claimed.\n\n## Questions for reviewers\n\n${p.reviewQuestions.map((q) => `- ${q}`).join("\n")}\n\n## Decision\n\n${p.decision}\n`;
}

export function comparisonSvg(baseline, proposed, labels = ["Baseline", "Proposed"]) {
  // A printable black-on-white schematic; equipment symbols are not exact footprints.
  const panel = (model, offset, title) => {
    const xy = (p) => `${round(feet(p.x) * 7)},${round((30 - feet(p.y)) * 7)}`;
    const records = elements(model);
    const walls = records.filter((el) => el.kind === "wall").map((el) => `<polyline points="${xy(el.start)} ${xy(el.end)}" fill="none" stroke="black" stroke-width="2"/>`).join("");
    const ducts = records.filter((el) => el.kind === "run_segment").map((el) => `<polyline points="${xy(el.start)} ${xy(el.end)}" fill="none" stroke="black" stroke-width="3" ${el.systemId === "ra-1" ? 'stroke-dasharray="6 4"' : ""}/>`).join("");
    const unit = rtu(model);
    const x = feet(unit.position.x) * 7;
    const y = (30 - feet(unit.position.y)) * 7;
    return `<g transform="translate(${offset} 100)"><text y="-30" font-size="20">${title}</text>${walls}${ducts}<rect x="${x - 12}" y="${y - 8}" width="24" height="16" fill="white" stroke="black"/><text x="${x}" y="${y - 18}" text-anchor="middle">RTU-1</text><text x="90" y="185">Office 101</text><text x="300" y="185">Office 102</text><text y="240">60 ft × 30 ft • equipment elevation unchanged</text></g>`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1040" height="480" viewBox="0 0 1040 480"><rect width="1040" height="480" fill="white"/><g fill="black" font-family="sans-serif" font-size="14"><text x="40" y="30" font-size="24">RTU relocation — design-change reference</text>${panel(baseline, 40, `${labels[0]} · RTU at (${round(feet(rtu(baseline).position.x))}, ${round(feet(rtu(baseline).position.y))}) ft`)}${panel(proposed, 560, `${labels[1]} · RTU at (${round(feet(rtu(proposed).position.x))}, ${round(feet(rtu(proposed).position.y))}) ft`)}<text x="40" y="390">Solid: supply duct · Dashed: return duct · Unit shown as a location symbol</text><text x="40" y="420">Schematic plan: vertical ducts overlap in plan. Solar area is explanatory, not modeled.</text><text x="40" y="450">Synthetic local prototype · See review-packet.md for quantities, check results and unresolved reviews.</text></g></svg>\n`;
}
