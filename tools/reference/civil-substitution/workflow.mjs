import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { InMemoryBranchHost, InMemoryLineageActs, InMemoryModelMemberStore, InMemoryLineageMemberStore, NativeModelAuthorizer, authorizeConnection, SyncClient } from "@permitzip/bim-sync";
import { bindModelPacks } from "@permitzip/bim-pack";
import { CIVIL_SET } from "../../../packages/bim-pack-civil/__tests__/fixtures/synthetic-site.ts";
import { LocalScriptRunner } from "@permitzip/bim-script-runner/local";
import { sliceModel, checkScriptOutput, parseScriptOutput } from "@permitzip/bim-script";
import { declaredReads } from "../../../packages/bim-mcp/src/examples.ts";
import { executeCommand, fieldProviderRegistry, withUpgradePolicy } from "@permitzip/bim-kernel";
import { openSchedule } from "@permitzip/bim-kernel/schedules";
import { fromCanonical, to } from "@permitzip/bim-units";
import { digest } from "../rooftop-review/packet.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
export const identities = {
  inspector: { id: "demo-inspector", name: "Field inspector (demo)", kind: "human" },
  contractor: { id: "demo-contractor", name: "Contractor (demo)", kind: "human" },
  owner: { id: "demo-owner", name: "Owner (demo)", kind: "human" },
  engineer: { id: "demo-engineer", name: "Civil reviewer / EOR (demo)", kind: "human" },
};
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise(setImmediate); };

export async function createWorkflow() {
  // Build the accepted fixture using the catalog pilot and its native schedule.
  const temp = await mkdtemp(path.join(os.tmpdir(), "civil-substitution-"));
  let accepted;
  try {
    await promisify(execFile)(process.execPath, [path.join(here, "../civil-cover-catalog/run.mjs"), "--out", temp], { timeout: 100_000 });
    accepted = JSON.parse(await readFile(path.join(temp, "site.model.json"), "utf8"));
  } finally { await rm(temp, { recursive: true, force: true }); }
  accepted.modelId = "civil-substitution-reference";
  bindModelPacks(accepted.modelId, CIVIL_SET);
  const members = new InMemoryModelMemberStore();
  const copies = new InMemoryLineageMemberStore();
  for (const [key, actor] of Object.entries(identities)) members.set(accepted.modelId, actor.id, key === "engineer" ? "editor" : "viewer");
  const authorizer = new NativeModelAuthorizer(members, copies);
  const acts = new InMemoryLineageActs();
  const host = await InMemoryBranchHost.start(accepted, {}, null, { acts });
  const runner = new LocalScriptRunner({ repoRoot });
  const clients = new Set();
  let submittal = null;
  let evidence = null;
  let revision = 1;
  let preview = null;
  let handoff = null;
  const observations = [];
  const reviews = [];
  const requirements = [
    { id: "gasket", label: "Confirm whether the project requires a gasket" },
    { id: "load", label: "Provide the applicable service load classification" },
  ];
  const assessments = new Map();
  const loadRating = await readFile(path.join(here, "load-rating.txt"), "utf8");
  const revisedLoadRating = await readFile(path.join(here, "load-rating-rev-b.txt"), "utf8");
  const submissionFor = (deltaDigest) => {
    return { revision, digest: digest({ deltaDigest, revision, evidence }), evidence };
  };

  async function session(role, modelId) {
    const actor = Object.hasOwn(identities, role) ? identities[role] : null;
    if (!actor) throw new Error("Choose a known demo identity");
    const lineage = await host.connectionLineage(modelId, actor.id);
    if (!lineage) throw new Error("No such demo model");
    const auth = await authorizeConnection(authorizer, { actor, verifiedUserId: actor.id, modelId, token: `local-fixture-${role}`, lineage });
    if (!auth.ok) throw new Error(auth.reason);
    const served = await host.open(modelId);
    const hub = served.hub;
    const requests = new Map();
    let finishEdit;
    const conn = { id: randomUUID(), send(data) {
      const message = JSON.parse(data);
      const pending = requests.get(message.requestId);
      if (pending) { requests.delete(message.requestId); pending(message); }
      else client.receive(data);
    } };
    const client = new SyncClient({ send: (data) => { void hub.handle(conn, data); }, close: () => hub.leave(conn) }, actor,
      { onOutcome: (_request, outcome) => finishEdit?.(outcome) }, 60_000,
      { clientSessionId: conn.id, meter: null, modelId });
    hub.join(conn, auth.principal);
    client.opened();
    clients.add(client);
    await settle();
    return {
      features: client.serverProtocolOf()?.features ?? [],
      ask: (message) => new Promise((resolve, reject) => {
        const requestId = randomUUID();
        const timer = setTimeout(() => { requests.delete(requestId); reject(new Error("Demo request timed out")); }, 10_000);
        requests.set(requestId, (answer) => { clearTimeout(timer); resolve(answer); });
        void hub.handle(conn, JSON.stringify({ ...message, requestId }));
      }),
      edit: (command, baseRevision) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Demo edit timed out")), 10_000);
        finishEdit = (result) => { clearTimeout(timer); finishEdit = null; resolve(result.status === "rejected" ? { status: result.status, message: result.error.message } : { status: result.status }); };
        const submitted = client.submit(command, { baseRevision });
        if (!submitted.ok) { clearTimeout(timer); resolve({ status: "rejected", message: submitted.error.message }); }
      }),
      close() { client.dispose(); clients.delete(client); },
    };
  }

  const result = (answer, type) => { if (answer.type !== type) throw new Error(answer.reason ?? `Expected ${type}`); return answer; };
  async function deltaFor(role) {
    if (!submittal) throw new Error("Create the contractor submittal first");
    const s = await session(role, `${accepted.modelId}~${submittal.id}`);
    try { return await s.ask({ type: "lineage_delta", lineageId: submittal.id }); }
    finally { s.close(); }
  }
  const summary = (model) => {
    const view = model.elements["civil-cover-schedule"];
    const schedule = openSchedule(model, view.props.scheduleV2, {
      viewId: view.id,
      revision: model.revision,
      registry: fieldProviderRegistry(),
    }).window(0, 2);
    assert.equal(schedule.rowCount, 1, "Expected one MH1 assembly in the structure schedule");
    const fields = schedule.columns.map((column) => {
      const value = schedule.values.get(column.id)?.values[0];
      assert.ok(value !== undefined && value !== null, `Missing schedule value for ${column.id}`);
      const display = column.quantityKind === "length"
        ? `${to(fromCanonical("length", value), "mm")} mm`
        : String(value);
      return { id: column.id, label: column.heading, value: display };
    });
    return { revision: model.revision, fields };
  };
  async function state(role = "owner") {
    const reader = await session(role, accepted.modelId);
    reader.close();
    const main = await host.main.store.head();

    const proposal = submittal ? await (await host.open(`${accepted.modelId}~${submittal.id}`)).store.head() : null;
    const delta = proposal ? result(await deltaFor(role), "lineage_delta_result") : null;
    const submission = delta?.changedIds.length ? submissionFor(delta.deltaDigest) : null;
    const lastReview = reviews.at(-1);
    return {
      submission,
      handoff,
      observations: [...observations],
      preview: preview?.acceptedDigest === digest(main) ? preview.display : null,
      approvalStale: lastReview?.outcome === "approved" && !handoff && lastReview.acceptedDigest !== digest(main),
      checklist: submission?.evidence ? requirements.map((item) => ({
        ...item,
        assessment: assessments.get(submission.digest)?.get(item.id) ?? null,
      })) : [],
      reviews: [...reviews],
      accepted: summary(main), proposal: proposal ? summary(proposal) : null,
      copy: submittal ? { id: submittal.id, name: submittal.name, role: submittal.role, parentRevision: submittal.parent.revision } : null,
      delta: delta ? { digest: delta.deltaDigest, headRevision: delta.headRevision, changedIds: delta.changedIds } : null,
      review: lastReview ? { ...lastReview, current: lastReview.submissionDigest === submission?.digest } : null,
      acts: await acts.list(),
    };
  }
  async function createSubmittal(role) {
    // Product action is offered only to the contractor. Copy editing rights are enforced by the engine.
    if (role !== "contractor") throw new Error("Only the contractor creates this demonstration submittal");
    if (submittal) throw new Error("The demonstration submittal already exists");
    const s = await session(role, accepted.modelId);
    try {
      submittal = result(await s.ask({ type: "lineage_create", fromRevision: accepted.revision, role: "submittal", name: "MH1 frame-and-cover substitution", owner: { party: "Sample Civil Contractor" } }), "lineage_saved").lineage;
      bindModelPacks(`${accepted.modelId}~${submittal.id}`, CIVIL_SET);
      // Explicit fixture invitations; neither grants edit on the accepted design.
      copies.grant(accepted.modelId, submittal.id, identities.owner.id, "read");
      copies.grant(accepted.modelId, submittal.id, identities.inspector.id, "read");
      copies.grant(accepted.modelId, submittal.id, identities.engineer.id, "review");
      return { status: "created", message: "Submittal created from the pinned accepted revision. Owner can view; designated civil reviewer can review." };
    } finally { s.close(); }
  }
  async function checkedSubstitution(role, model) {
    const modelId = model.modelId;
    const source = await readFile(path.join(here, "./substitute.ts"), "utf8");
    const connection = await session(role, modelId);
    const features = connection.features;
    connection.close();
    const output = await runner.run({ source, scriptHash: createHash("sha256").update(source).digest("hex"), values: {}, slice: sliceModel(model, declaredReads(source), [], features) });
    if (!output.ok) throw new Error(output.message);
    const checked = checkScriptOutput(model, output.output, { features });
    if (!checked.ok) throw new Error("The substitution script did not pass its output checks");
    const parsed = parseScriptOutput(output.output);
    if (parsed.kind !== "edits" || parsed.batches.length !== 1) throw new Error("Expected one checked edit batch");
    return { batch: parsed.batches[0], features };
  }

  async function propose(role) {
    if (!submittal) throw new Error("Create a submittal first");
    const modelId = `${accepted.modelId}~${submittal.id}`;
    const model = await (await host.open(modelId)).store.head();
    const { batch } = await checkedSubstitution(role, { ...model, modelId });
    const s = await session(role, modelId);
    try { return await s.edit(batch); } finally { s.close(); }
  }
  async function resubmit(role, submissionDigest, gasketResponse) {
    if (role !== "contractor") throw new Error("Only the contractor can resubmit");
    const delta = result(await deltaFor(role), "lineage_delta_result");
    const current = submissionFor(delta.deltaDigest);
    const previous = reviews.at(-1);
    if (revision >= 3 || !previous || previous.outcome !== "revise_and_resubmit" || previous.submissionDigest !== current.digest || submissionDigest !== current.digest) {
      throw new Error("Resubmission requires a current revise-and-resubmit decision on the first submission");
    }
    if (revision === 2) {
      evidence = {
        document: { title: "ECC-LR-FC600-S · Rev B", text: revisedLoadRating, href: "/load-rating-rev-b.txt" },
        gasketResponse: "For this synthetic MH1 scenario, the civil reviewer confirmed a gasket is optional.",
      };
      revision = 3;
      return { message: "Submission 3 sent with the revised load classification and gasket confirmation." };
    }
    if (typeof gasketResponse !== "string" || !gasketResponse.trim() || gasketResponse.length > 500) {
      throw new Error("Enter a gasket response of up to 500 characters");
    }
    evidence = {
      document: { title: "ECC-LR-FC600-S · Rev A", text: loadRating, href: "/load-rating.txt" },
      gasketResponse: gasketResponse.trim(),
    };
    revision = 2;
    return { message: "Submission 2 sent for review with the load-rating document and gasket response." };
  }

  async function assessRequirement(role, submissionDigest, itemId, status, note) {
    if (role !== "engineer") throw new Error("Only the civil reviewer can assess requirements");
    if (!requirements.some((item) => item.id === itemId)) throw new Error("Choose a checklist item");
    if (!["resolved", "needs_clarification", "still_missing"].includes(status)) {
      throw new Error("Choose a checklist status");
    }
    if (typeof note !== "string" || !note.trim() || note.length > 500) {
      throw new Error("Enter a review note of up to 500 characters");
    }
    const delta = result(await deltaFor(role), "lineage_delta_result");
    const submission = submissionFor(delta.deltaDigest);
    if (!submission.evidence || submission.digest !== submissionDigest) {
      throw new Error("Refresh and review the current submission before assessing a requirement.");
    }
    if (reviews.some((entry) => entry.submissionDigest === submissionDigest && entry.outcome === "approved")) {
      throw new Error("The approved checklist is part of the review record.");
    }
    const items = assessments.get(submissionDigest) ?? new Map();
    items.set(itemId, {
      status, note: note.trim(), submissionDigest, reviewer: identities[role].name,
    });
    assessments.set(submissionDigest, items);
    return { message: "Checklist assessment saved." };
  }

  async function review(role, deltaDigest, outcome, reason, submissionDigest) {
    if (!["revise_and_resubmit", "rejected", "approved"].includes(outcome)) throw new Error("Choose a review decision");
    if (typeof reason !== "string" || !reason.trim() || reason.length > 500) throw new Error("Enter a review reason of up to 500 characters");
    if (!submittal) throw new Error("Create a submittal first");
    const s = await session(role, `${accepted.modelId}~${submittal.id}`);
    try {
      const delta = result(await s.ask({ type: "lineage_delta", lineageId: submittal.id }), "lineage_delta_result");
      const submission = submissionFor(delta.deltaDigest);
      if (!delta.changedIds.length || submissionDigest !== submission.digest || deltaDigest !== delta.deltaDigest) {
        return { type: "request_refused", reason: "Refresh and review the current submission before recording a decision." };
      }
      const main = await host.main.store.head();
      const acceptedDigest = digest(main);
      const prior = reviews.at(-1);
      const needsFreshReview = prior?.outcome === "approved" && prior.acceptedDigest !== acceptedDigest && !handoff;
      if (outcome === "approved" && (submission.revision !== 3 ||
        !requirements.every(({ id }) => assessments.get(submission.digest)?.get(id)?.status === "resolved"))) {
        return { type: "request_refused", reason: "Resolve both requirements on submission 3 before approving." };
      }
      if (prior?.submissionDigest === submission.digest && !needsFreshReview) {
        return { type: "request_refused", reason: "This submission already has a recorded decision." };
      }
      const answer = await s.ask({ type: "lineage_review", lineageId: submittal.id, outcome, reason: `${reason.trim()} [Submission ${submission.revision}: ${submission.digest}; accepted revision ${main.revision}: ${acceptedDigest}]`, deltaDigest });
      if (answer.type === "lineage_act_recorded") {
        reviews.push({
          outcome: answer.act.outcome,
          digest: answer.act.deltaDigest,
          submissionDigest: submission.digest,
          submissionRevision: submission.revision,
          evidence: submission.evidence,
          acceptedDigest,
          acceptedRevision: main.revision,
          reviewer: identities[role].name,
          reason: reason.trim(),
          sequence: answer.seq,
        });
      }
      return answer;
    } finally { s.close(); }
  }

  async function approvedTarget(role) {
    if (role !== "engineer") throw new Error("Only the civil reviewer can apply the approved substitution.");
    if (handoff) throw new Error("The approved substitution has already been applied.");
    const approval = reviews.at(-1);
    const delta = result(await deltaFor(role), "lineage_delta_result");
    if (approval?.outcome !== "approved" || approval.submissionDigest !== submissionFor(delta.deltaDigest).digest) {
      throw new Error("Approve the current submission before applying the substitution.");
    }
    const model = await host.main.store.head();
    if (approval.acceptedDigest !== digest(model)) {
      throw new Error("The accepted design changed after approval. Record a fresh review before applying.");
    }
    return { model, approval };
  }

  async function previewHandoff(role) {
    const { model, approval } = await approvedTarget(role);
    const { batch, features } = await checkedSubstitution(role, model);
    const applied = withUpgradePolicy((feature) => features.includes(feature), () => executeCommand(model, batch));
    if (!applied.ok) throw new Error(applied.error.message);
    const before = summary(model);
    const after = summary(applied.model);
    const changes = before.fields.flatMap((field, index) => {
      const value = after.fields[index].value;
      return value === field.value ? [] : [{ label: field.label, before: field.value, after: value }];
    });
    const display = { id: randomUUID(), revision: before.revision, changes };
    preview = { display, batch, before, acceptedDigest: approval.acceptedDigest, sequence: approval.sequence };
    return { message: "Checked the MH1 schedule preview. Apply it to update the accepted design." };
  }

  async function applyHandoff(role, previewId) {
    const { model, approval } = await approvedTarget(role);
    if (!preview || preview.display.id !== previewId || preview.sequence !== approval.sequence) {
      throw new Error("Preview the currently approved substitution before applying it.");
    }
    const s = await session(role, accepted.modelId);
    try {
      const outcome = await s.edit(preview.batch, model.revision);
      if (outcome.status !== "committed") throw new Error(outcome.message ?? "The substitution was not committed.");
      handoff = {
        before: preview.before,
        revision: (await host.main.store.head()).revision,
        approvalSequence: approval.sequence,
        submissionRevision: approval.submissionRevision,
        evidence: approval.evidence,
      };
      preview = null;
      return { message: "ECC-FC600-S applied to the accepted MH1 schedule." };
    } finally { s.close(); }
  }

  async function recordObservation(role, stage) {
    if (role !== "inspector") throw new Error("Only the field inspector can record an observation.");
    if (!handoff) throw new Error("Apply the approved substitution before field verification.");
    const model = await host.main.store.head();
    if (model.revision !== handoff.revision) throw new Error("The accepted schedule changed. Review the current revision before recording an observation.");
    const expectedStage = ["delivery", "installation"][observations.length];
    if (!expectedStage || stage !== expectedStage) throw new Error("Record each field observation in order and only once.");
    const delivery = stage === "delivery";
    const observed = delivery ? "ECC-FC600-G" : "ECC-FC600-S";
    const expected = summary(model).fields.find(({ id }) => id === "order_code").value;
    const matches = observed === expected;
    observations.push({
      stage, observed, expected, matches,
      revision: model.revision,
      inspector: identities.inspector.name,
      photo: delivery ? "/mh1-delivery.jpg" : null,
      note: delivery ? "Delivery tag on the staged assembly." : "Inspector checked the replacement assembly installed at MH1.",
    });
    return { message: matches ? "Installation verified against the accepted schedule." : "Delivery mismatch recorded for MH1." };
  }

  async function prepareFieldDemo() {
    await createSubmittal("contractor");
    const proposal = await propose("contractor");
    if (proposal.status !== "committed") throw new Error(proposal.message ?? "Could not prepare the MH1 proposal.");
    for (const reason of ["Provide load and gasket evidence.", "Confirm the gasket requirement and service load classification."]) {
      const { delta, submission } = await state("engineer");
      result(await review("engineer", delta.digest, "revise_and_resubmit", reason, submission.digest), "lineage_act_recorded");
      await resubmit("contractor", submission.digest, "The proposed cover has no gasket option.");
    }
    const { delta, submission } = await state("engineer");
    await assessRequirement("engineer", submission.digest, "gasket", "resolved", "Gasket confirmed optional for synthetic MH1.");
    await assessRequirement("engineer", submission.digest, "load", "resolved", "Rev B confirms the fictional service classification.");
    result(await review("engineer", delta.digest, "approved", "Both submission 3 requirements are satisfied.", submission.digest), "lineage_act_recorded");
    await previewHandoff("engineer");
    await applyHandoff("engineer", preview.display.id);
  }

  // Exercise a real accepted-model edit in the stale-approval regression.
  async function simulateLaterMh1Edit() {
    const s = await session("engineer", accepted.modelId);
    try { return await s.edit({ type: "move_elements", ids: ["MH1-COVER"], delta: { x: 0, y: 0 }, dzMm: 10 }); }
    finally { s.close(); }
  }

  async function attemptDesignEdit(role) {
    if (role === "engineer") throw new Error("Accepted-design editing is outside this demonstration");
    const s = await session(role, accepted.modelId);
    try { return await s.edit({ type: "set_parameters", id: "MH1-COVER", scope: "instance", mark: "MH1-COVER-EDIT" }); }
    finally { s.close(); }
  }
  return { state, recordObservation, prepareFieldDemo, loadRatingDocument: (revised) => revised ? revisedLoadRating : loadRating, previewHandoff, applyHandoff, simulateLaterMh1Edit, createSubmittal, propose, resubmit, assessRequirement, review, attemptDesignEdit, close() { for (const client of clients) client.dispose(); clients.clear(); } };
}
