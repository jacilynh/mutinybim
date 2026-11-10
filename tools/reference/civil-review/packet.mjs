import { digest, changedElements } from "../rooftop-review/packet.mjs";
import { explorerData } from "../civil-explorer/data.ts";

const scope = ["OF1", "MH1", "P103-s1", "sys-storm"];
const evidence = (model) => Object.fromEntries(scope.map((id) => [id, model.elements[id] ?? null]));

export function sampleReview(model) {
  return {
    reviewer: "Fictional civil reviewer", decision: "Example slope walkthrough reviewed; no engineering approval",
    modelId: model.modelId, revision: model.revision, snapshotDigest: digest(model),
    scope: [...scope], evidenceDigest: digest(evidence(model)),
    description: "Whole records for OF1, MH1, P103-s1 and the storm-system settings. Explicit fixture dependency scope, not inferred engineering dependencies.",
  };
}

export function assessReview(review, reviewed, current) {
  if (digest(review.scope) !== digest(scope)) throw new Error("Unsupported sample scope");
  if (review.snapshotDigest !== digest(reviewed) || review.evidenceDigest !== digest(evidence(reviewed)) || review.modelId !== reviewed.modelId || review.revision !== reviewed.revision) throw new Error("Reviewed evidence does not match");
  if (current.modelId !== reviewed.modelId || current.revision < reviewed.revision) throw new Error("Expected a current revision on the reviewed branch");
  const changed = changedElements(reviewed, current);
  const affected = changed.filter((c) => scope.includes(c.id));
  return { status: digest(evidence(current)) === review.evidenceDigest ? "unchanged_in_scope" : "needs_another_look", affected, scope: review.description, reviewedDigest: review.snapshotDigest, currentDigest: digest(current) };
}

export function civilPacket(baseline, first, second, branch) {
  const summaries = [baseline, first, second].map((model) => {
    const data = explorerData(model);
    const outfall = data.structures.find((s) => s.id === "OF1");
    const pipe = data.pipes.find((p) => p.id === "P103-s1");
    if (!outfall || !pipe) throw new Error("The civil reference requires OF1 and P103-s1");
    return { modelId: model.modelId, revision: model.revision, digest: digest(model), invertFt: outfall.invert, pipe, findings: data.findings, problems: data.problems };
  });
  const reviewRecord = sampleReview(first);
  const review = assessReview(reviewRecord, first, second);
  const fullChanges = changedElements(baseline, second);
  const sinceChanges = changedElements(first, second);
  const reviewed = summaries[1], revised = summaries[2];
  return {
    format: "mutinybim-civil-invert-review", version: 1,
    title: "OF1 invert revision: what changed since review?",
    branch: { id: branch.branchId, name: branch.name, baseRevision: branch.baseRevision },
    story: "First lower the outfall structure invert to address a flat pipe. Then raise it following a revised receiving-connection assumption. The receiving connection is explanatory, not modeled or field verified.",
    snapshots: summaries, reviewRecord, review,
    comparisons: { fullProposal: fullChanges, sinceReview: sinceChanges },
    derivedImpact: {
      elementId: revised.pipe.id,
      pipeRecordChanged: sinceChanges.some((c) => c.id === revised.pipe.id),
      governingInputChanged: review.affected.some((c) => c.id === "OF1"),
      priorStatus: reviewed.pipe.status, currentStatus: revised.pipe.status,
      explanation: "The pipe record and plan geometry did not change. The existing civil solver uses structure inverts: changing OF1 changes P103-s1's derived slope and Manning full-flow reference capacity.",
    },
    findings: {
      newSinceReview: revised.findings.filter((f) => !reviewed.findings.some((old) => old.rule === f.rule && digest(old.elementIds) === digest(f.elementIds))),
      inherited: revised.findings.filter((f) => reviewed.findings.some((old) => old.rule === f.rule && digest(old.elementIds) === digest(f.elementIds))),
    },
    limits: "Synthetic fixture; governing structure invert metadata only, not pipe-end geometry or a construction profile. Existing pack calculations, no new engineering methods. No HGL, tailwater, cover, utility conflicts, inlet capture or permit review. Full-flow capacity is a reference, not a complete hydraulic analysis. Earlier sample review is fictional; no professional approval, merge or production approval invalidation occurs.",
  };
}

const n = (value) => value == null ? "Unknown" : value.toFixed(3);
export function civilMarkdown(p) {
  const [base, first, second] = p.snapshots;
  return `# ${p.title}\n\n**Earlier fictional review: needs another look.**\n\n${p.story}\n\n## Before, reviewed, revised\n\n| State | Revision | OF1 invert (ft) | P103 slope (%) | Existing slope check | Full-flow reference capacity (cfs) |\n| --- | ---: | ---: | ---: | --- | ---: |\n${p.snapshots.map((s, i) => `| ${["Accepted baseline", "First proposal / reviewed", "Second proposal"][i]} | ${s.revision} | ${n(s.invertFt)} | ${n(s.pipe.slope)} | ${s.pipe.status} | ${n(s.pipe.fullFlowCapacity)} |`).join("\n")}\n\nExisting fixture minimum slope: 0.50%. Pipe length is ${n(second.pipe.length)} ft between routed connectors. Modeled runoff remains ${n(second.pipe.runoff)} cfs. See since-review.png for the schematic input comparison.\n\n## What changed since the review?\n\n${p.comparisons.sinceReview.map((c) => `- ${c.change}: ${c.kind} ${c.id}`).join("\n")}\n\n${p.derivedImpact.explanation}\n\n**Why revisit the review:** OF1 is explicitly included in the sample review's dependency scope. Its invert rose from ${n(first.invertFt)} to ${n(second.invertFt)} ft; the pipe's slope check changed from **${first.pipe.status}** to **${second.pipe.status}**. A list of changed pipe records alone would miss this effect.\n\n## Existing checks rerun\n\nNewly present since the reviewed proposal:\n${p.findings.newSinceReview.map((f) => `- ${f.message}`).join("\n") || "- None."}\n\nFindings already present at the reviewed proposal:\n${p.findings.inherited.map((f) => `- ${f.message}`).join("\n") || "- None."}\n\nThe inlet overload remains unresolved; clearing the slope warning in the first proposal did not approve the overall drainage design.\n\n## Evidence and comparison ranges\n\n- Full proposal: accepted revision ${base.revision} → revised branch revision ${second.revision}.\n- Since review: branch revision ${first.revision} → ${second.revision}.\n- Reviewer: ${p.reviewRecord.reviewer}.\n- Review scope: ${p.review.scope}\n- Reviewed snapshot: ${first.digest}\n- Revised snapshot: ${second.digest}\n\nMain stays at the baseline. Both edits run through script check, preview and apply tools on one real in-memory branch. Fixture execution is automatically approved locally; the sample human review is separate from that script execution. Regenerate this offline packet after further edits.\n\n## Remaining review questions\n\n- Confirm the receiving connection and survey datum before adopting the revised invert.\n- Evaluate cover, constructability, utility crossings, tailwater and hydraulic grade line with appropriate project data.\n- Resolve the inherited inlet-capacity finding.\n\n${p.limits}\n`;
}

export function profileSvg(p) {
  const first = p.snapshots[1], second = p.snapshots[2];
  const panel = (s, x, title) => `<g transform="translate(${x} 0)"><text x="0" y="95" font-size="21">${title}</text><text x="0" y="130">MH1 invert: 95.000 ft</text><text x="0" y="165">OF1 invert: ${n(s.invertFt)} ft</text><text x="0" y="200">P103 slope: ${n(s.pipe.slope)}%</text><text x="0" y="235">Existing slope check: ${s.pipe.status}</text><line x1="20" y1="285" x2="370" y2="${s.pipe.status === "ok" ? 365 : 320}" stroke="black" stroke-width="3"/><circle cx="20" cy="285" r="7" fill="white" stroke="black"/><text x="0" y="275">MH1</text><text x="340" y="${s.pipe.status === "ok" ? 390 : 345}">OF1</text></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1040" height="500" viewBox="0 0 1040 500"><rect width="1040" height="500" fill="white"/><g fill="black" font-family="sans-serif" font-size="17"><text x="40" y="40" font-size="26">Storm invert revision — earlier review needs another look</text>${panel(first, 40, "First proposal · sample reviewed")}${panel(second, 570, "Second proposal · revised invert")}<text x="40" y="445">Governing-invert schematic only · not to scale · pipe-end geometry is unchanged</text><text x="40" y="478">Synthetic civil example · existing pack checks · no engineering approval or hydraulic-grade analysis</text></g></svg>\n`;
}
