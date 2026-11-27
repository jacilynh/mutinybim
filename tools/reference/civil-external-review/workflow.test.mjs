import assert from "node:assert/strict";
import test from "node:test";
import { register } from "tsx/esm/api";
register();
const { createWorkflow } = await import("./workflow.mjs");

test("external civil handoff through the real copy authorization and review service", { timeout: 120_000 }, async (t) => {
  const demo = await createWorkflow();
  try {
    const start = await demo.state("owner");
    assert.equal(start.proposal, null);
    assert.equal(start.accepted.pipe.status, "ok");
    await t.test("owner and contractor direct design edits are refused by the server", async () => {
      for (const role of ["owner", "contractor"]) {
        const refusal = await demo.attemptDesignEdit(role);
        assert.equal(refusal.status, "rejected");
        assert.match(refusal.message, /view the design but not edit/);
      }
      assert.deepEqual((await demo.state("owner")).accepted, start.accepted);
    });
    await t.test("contractor creates a real submittal pinned to the accepted revision", async () => {
      assert.equal((await demo.createSubmittal("contractor")).status, "created");
      const state = await demo.state("owner");
      assert.equal(state.copy.role, "submittal");
      assert.equal(state.copy.parentRevision, start.accepted.revision);
      assert.deepEqual(state.delta.changedIds, []);
      assert.equal(state.proposal.invert, start.accepted.invert);
    });
    const old = (await demo.state("engineer")).delta;
    await t.test("owner cannot edit the copy; contractor's checked script affects only the copy", async () => {
      assert.equal((await demo.propose("owner")).status, "rejected");
      assert.deepEqual((await demo.state("owner")).delta, old);
      assert.equal((await demo.propose("contractor")).status, "committed");
      const state = await demo.state("owner");
      assert.deepEqual(state.delta.changedIds, ["OF1"]);
      assert.deepEqual(state.accepted, start.accepted);
      assert.equal(state.proposal.pipe.status, "too_flat");
      assert.ok(Math.abs(state.proposal.invert - 94.5) < 1e-8);
      assert.ok(Math.abs(state.proposal.pipe.slope - 0.255) < 0.001);
      assert.equal(state.proposal.pipe.runoff, start.accepted.pipe.runoff);
    });
    const current = (await demo.state("engineer")).delta;
    await t.test("owner and contractor cannot record the proposal review", async () => {
      for (const role of ["owner", "contractor"]) {
        const refusal = await demo.review(role, current.digest);
        assert.equal(refusal.type, "request_refused");
        assert.match(refusal.reason, /sent to for review/);
      }
      assert.equal((await demo.state()).acts.length, 0);
    });
    await t.test("reviewer cannot use a digest captured before the proposal changed", async () => {
      assert.notEqual(current.digest, old.digest);
      const refusal = await demo.review("engineer", old.digest);
      assert.equal(refusal.type, "request_refused");
      assert.equal((await demo.state()).acts.length, 0);
    });
    await t.test("reviewer records Revise and resubmit against the current digest without landing anything", async () => {
      const answer = await demo.review("engineer", current.digest);
      assert.equal(answer.type, "lineage_act_recorded");
      assert.equal(answer.act.outcome, "revise_and_resubmit");
      assert.equal(answer.act.deltaDigest, current.digest);
      const state = await demo.state("owner");
      assert.equal(state.acts.length, 1);
      assert.equal(state.review.current, true);
      assert.deepEqual(state.accepted, start.accepted);
      assert.equal(state.delta.headRevision, current.headRevision);
    });
  } finally { demo.close(); }
});
