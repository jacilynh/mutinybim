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
  } finally {
    workflow.close();
  }
});
