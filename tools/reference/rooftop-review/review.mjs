import { changedElements, digest } from "./packet.mjs";

// Conservative whole-record scope for this single-unit fixture. This is not
// the production merge-approval evaluator or a general dependency analysis.
const kinds = ["part", "part_type", "run_segment", "run_fitting", "mep_system"];
const covered = (model, id) => kinds.includes(model.elements[id]?.kind);

export function sampleReview(model) {
  return {
    format: "mutinybim-reference-sample-review", version: 1,
    reviewer: "Sample mechanical reviewer (fictional)",
    decision: "Example walkthrough reviewed; engineering approval not given",
    scope: { kinds: [...kinds], description: "All equipment, equipment types, duct segments, fittings and systems in this tiny fixture; whole-record comparison." },
    reviewed: { modelId: model.modelId, revision: model.revision, digest: digest(model) },
    note: "Sample record for demonstrating review freshness only. Does not enter the production approval system or authorize a merge.",
  };
}

export function assessReview(review, reviewed, current) {
  if (review.format !== "mutinybim-reference-sample-review" || digest(review.scope.kinds) !== digest(kinds)) throw new Error("Unsupported sample review scope");
  if (review.reviewed.modelId !== reviewed.modelId || review.reviewed.revision !== reviewed.revision || review.reviewed.digest !== digest(reviewed)) throw new Error("The reviewed snapshot does not match the sample review record");
  if (current.modelId !== reviewed.modelId) throw new Error("Review comparison must stay on the same branch");
  if (current.revision < reviewed.revision) throw new Error("Current snapshot predates the reviewed revision");
  const changes = changedElements(reviewed, current);
  const affected = changes.filter(({ id }) => covered(reviewed, id) || covered(current, id));
  return {
    status: affected.length ? "needs_another_look" : "unchanged_in_scope",
    explanation: affected.length
      ? `Equipment or routing records covered by the sample review changed after revision ${reviewed.revision}. Review the listed changes before relying on that earlier review.`
      : "No covered records changed. This does not establish engineering approval or validate dependencies outside the sample scope.",
    reviewed: review.reviewed,
    current: { modelId: current.modelId, revision: current.revision, digest: digest(current) },
    changesSinceReview: changes,
    affected,
    limitations: "Offline whole-record comparison on a declared fixture scope. Recomputed when generated; no live notifications, dependency inference or production approval invalidation.",
  };
}

export function revisionMarkdown(review, assessment, since, full) {
  const a = since.quantities.ductCentreline.baseline;
  const b = since.quantities.ductCentreline.proposed;
  const checks = since.checks.map((c) => `- **${c.status}** — ${c.name}${c.reason ? `: ${c.reason}` : ""}`).join("\n");
  return `# What changed since the first review?\n\n**Earlier sample review: needs another look.**\n\n${assessment.explanation}\n\n## The story\n\n- Accepted baseline: revision ${full.baseline.revision}, RTU at (30, 15) ft.\n- First proposal / sample review: revision ${review.reviewed.revision}, RTU at (38, 15) ft.\n- Second proposal: revision ${assessment.current.revision}, RTU at (42, 15) ft.\n- Follow-up request: move another 4 ft east for a revised solar layout. Solar geometry remains unmodeled.\n\nSee since-review.png for the first and second proposals side by side. Main remains at the accepted baseline.\n\n## Since the sample review\n\n${assessment.affected.map((c) => `- ${c.change}: ${c.kind} — ${c.id}`).join("\n")}\n\n| Duct system | Reviewed (ft) | Current (ft) | Change since review (ft) |\n| --- | ---: | ---: | ---: |\n${Object.keys(a).map((id) => `| ${id} | ${a[id].value} | ${b[id].value} | ${Math.round((b[id].value - a[id].value) * 1000) / 1000} |`).join("\n")}\n\nThe aggregate kernel quantity delta is ${since.quantities.deltas.length ? "listed in since-review.json" : "zero: opposing route changes cancel"}. The duct routes still changed. Centreline totals exclude fittings.\n\n## Checks rerun on the second proposal\n\n${checks}\n\nChecks from the first packet remain evidence about the first proposal only. These freshly generated checks describe the second proposal; they do not renew the sample person's review.\n\n## Sample review record\n\n- Reviewer: ${review.reviewer}\n- Decision: ${review.decision}\n- Scope: ${review.scope.description}\n- Reviewed snapshot: ${review.reviewed.digest}\n- Current snapshot: ${assessment.current.digest}\n\n${review.note}\n\n## Two comparison ranges\n\n- Full proposal against accepted baseline: review-packet-v2.md.\n- Second proposal against reviewed first proposal: since-review.json and this document.\n- Original packet and first proposed snapshot are preserved.\n\n${assessment.limitations}\n\nStructural, electrical, access, solar clearance and system performance still need review. No professional approval or merge has occurred.\n`;
}
