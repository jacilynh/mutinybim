import assert from "node:assert/strict";
import test from "node:test";
import { register } from "tsx/esm/api";
register();

const { createWorkflow } = await import("./workflow.mjs");
const field = (schedule, id) => schedule.fields.find((entry) => entry.id === id)?.value;

test("MH1 substitution stays on the contractor copy and review cites its exact delta", async () => {
  const workflow = await createWorkflow();
  try {
    const initial = await workflow.state("owner");
    assert.equal(field(initial.accepted, "order_code"), "ECC-FC600-G");
    assert.equal((await workflow.attemptDesignEdit("contractor")).status, "rejected");
    await workflow.createSubmittal("contractor");
    const before = await workflow.state("engineer");

    assert.equal((await workflow.propose("owner")).status, "rejected");
    assert.equal((await workflow.propose("contractor")).status, "committed");
    const proposed = await workflow.state("engineer");
    assert.deepEqual(proposed.delta.changedIds, ["MH1-COVER"]);
    assert.equal(field(proposed.proposal, "order_code"), "ECC-FC600-S");
    assert.equal(field(proposed.proposal, "cover_option"), "Solid cover");
    assert.equal(field(proposed.proposal, "stated_rating"), "Not stated");
    assert.deepEqual(proposed.accepted, initial.accepted);
    assert.deepEqual(
      proposed.accepted.fields.filter((entry, i) => entry.value !== proposed.proposal.fields[i].value).map((entry) => entry.id),
      ["order_code", "cover_code", "cover_option"],
    );

    const reason = "Confirm the gasket requirement and provide the applicable load rating.";
    assert.equal((await workflow.review("contractor", proposed.delta.digest, "rejected", reason, proposed.submission.digest)).type, "request_refused");
    assert.equal((await workflow.review("engineer", before.delta.digest, "rejected", reason, proposed.submission.digest)).type, "request_refused");
    const decision = await workflow.review("engineer", proposed.delta.digest, "revise_and_resubmit", reason, proposed.submission.digest);
    assert.equal(decision.type, "lineage_act_recorded");
    assert.equal(decision.act.deltaDigest, proposed.delta.digest);

    const reviewed = await workflow.state("owner");
    assert.equal(reviewed.review.outcome, "revise_and_resubmit");
    assert.equal(reviewed.review.reason, reason);
    assert.equal(reviewed.review.current, true);
    assert.equal(reviewed.acts.length, 1);
    assert.deepEqual(reviewed.accepted, initial.accepted);
    assert.deepEqual(reviewed.proposal, proposed.proposal);
    await assert.rejects(workflow.resubmit("owner", proposed.submission.digest, "Gasket response"), /Only the contractor/);
    await workflow.resubmit("contractor", proposed.submission.digest, "The proposed cover has no gasket option.");
    const revised = await workflow.state("engineer");
    assert.equal(revised.submission.revision, 2);
    assert.equal(revised.delta.digest, proposed.delta.digest);
    assert.deepEqual(revised.proposal, proposed.proposal);
    assert.notEqual(revised.submission.digest, proposed.submission.digest);
    assert.match(revised.submission.evidence.document.text, /ECC-FC600-S/);
    assert.equal(revised.review.current, false);
    assert.equal((await workflow.review("engineer", revised.delta.digest, "revise_and_resubmit", reason, proposed.submission.digest)).type, "request_refused");
    const note = "Project gasket requirement still needs confirmation.";
    await assert.rejects(workflow.assessRequirement("contractor", revised.submission.digest, "gasket", "resolved", note), /Only the civil reviewer/);
    await assert.rejects(workflow.assessRequirement("engineer", proposed.submission.digest, "gasket", "resolved", note), /current submission/);
    await workflow.assessRequirement("engineer", revised.submission.digest, "gasket", "needs_clarification", note);
    await workflow.assessRequirement("engineer", revised.submission.digest, "load", "still_missing", "Service classification not stated.");
    const assessed = await workflow.state("owner");
    assert.deepEqual(assessed.checklist.map((item) => item.assessment.status), ["needs_clarification", "still_missing"]);
    assert.equal(assessed.checklist[0].assessment.note, note);
    assert.equal(assessed.review.current, false);
    // Even the same reviewer, outcome and reason are a separate act on the new evidence.
    assert.equal((await workflow.review("engineer", revised.delta.digest, "revise_and_resubmit", reason, revised.submission.digest)).type, "lineage_act_recorded");
    const final = await workflow.state("owner");
    assert.equal(final.acts.length, 2);
    assert.deepEqual(final.reviews.map((entry) => entry.submissionRevision), [1, 2]);
    assert.equal(final.reviews[0].evidence, null);
    assert.deepEqual(final.reviews[1].evidence, revised.submission.evidence);
    assert.equal(final.review.current, true);
    assert.deepEqual(final.accepted, initial.accepted);

    await workflow.resubmit("contractor", revised.submission.digest);
    const third = await workflow.state("engineer");
    assert.equal(third.submission.revision, 3);
    assert.match(third.submission.evidence.document.text, /Demo Vehicular Service/);
    assert.ok(third.checklist.every((item) => item.assessment === null));
    const approve = () => workflow.review("engineer", third.delta.digest, "approved", "Both synthetic requirements are satisfied.", third.submission.digest);
    assert.equal((await approve()).type, "request_refused");
    for (const item of third.checklist) {
      await workflow.assessRequirement("engineer", third.submission.digest, item.id, "resolved", "Verified against submission 3 evidence.");
    }
    assert.equal((await approve()).type, "lineage_act_recorded");
    await assert.rejects(workflow.previewHandoff("contractor"), /Only the civil reviewer/);
    await assert.rejects(workflow.applyHandoff("engineer"), /Preview/);
    await workflow.previewHandoff("engineer");
    const previewed = await workflow.state("engineer");
    assert.deepEqual(previewed.accepted, initial.accepted);
    assert.deepEqual(previewed.preview.changes.map(({ before, after }) => [before, after]), [
      ["ECC-FC600-G", "ECC-FC600-S"],
      ["C600-G", "C600-S"],
      ["Solid cover with gasket option", "Solid cover"],
    ]);

    assert.equal((await workflow.simulateLaterMh1Edit()).status, "committed");
    await assert.rejects(workflow.applyHandoff("engineer", previewed.preview.id), /fresh review/);
    await assert.rejects(workflow.previewHandoff("engineer"), /fresh review/);
    const stale = await workflow.state("owner");
    assert.equal(stale.approvalStale, true);
    assert.equal(stale.preview, null);
    assert.equal(field(stale.accepted, "order_code"), "ECC-FC600-G");

    const renewed = await approve();
    assert.equal(renewed.type, "lineage_act_recorded");
    assert.notEqual(renewed.seq, previewed.review.sequence);
    await assert.rejects(workflow.applyHandoff("engineer", previewed.preview.id), /Preview/);
    await workflow.previewHandoff("engineer");
    const refreshed = await workflow.state("engineer");
    await workflow.applyHandoff("engineer", refreshed.preview.id);
    await assert.rejects(workflow.applyHandoff("engineer", refreshed.preview.id), /already been applied/);
    const applied = await workflow.state("owner");
    assert.equal(field(applied.accepted, "order_code"), "ECC-FC600-S");
    assert.equal(applied.handoff.revision, applied.accepted.revision);
    assert.equal(applied.handoff.approvalSequence, renewed.seq);
    assert.deepEqual(applied.handoff.before, stale.accepted);
    assert.deepEqual(applied.handoff.evidence, third.submission.evidence);
    await assert.rejects(workflow.recordObservation("owner", "delivery"), /Only the field inspector/);
    await assert.rejects(workflow.recordObservation("inspector", "installation"), /in order/);
    await workflow.recordObservation("inspector", "delivery");
    const mismatch = await workflow.state("owner");
    assert.equal(mismatch.observations[0].photo, "/mh1-delivery.jpg");
    await assert.rejects(workflow.recordObservation("inspector", "delivery"), /only once/);
    await workflow.recordObservation("inspector", "installation");
    const closeout = await workflow.state("owner");
    assert.deepEqual(closeout.observations.map(({ observed, matches }) => [observed, matches]), [
      ["ECC-FC600-G", false], ["ECC-FC600-S", true],
    ]);
    assert.ok(closeout.observations.every(({ revision }) => revision === applied.handoff.revision));
    assert.deepEqual(closeout.accepted, applied.accepted);
  } finally {
    workflow.close();
  }
});
