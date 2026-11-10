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
import { fieldProviderRegistry } from "@permitzip/bim-kernel";
import { openSchedule } from "@permitzip/bim-kernel/schedules";
import { fromCanonical, to } from "@permitzip/bim-units";
import { digest } from "../rooftop-review/packet.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
export const identities = {
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
  const acceptedDigest = digest(accepted);
  const members = new InMemoryModelMemberStore();
  const copies = new InMemoryLineageMemberStore();
  for (const [key, actor] of Object.entries(identities)) members.set(accepted.modelId, actor.id, key === "engineer" ? "editor" : "viewer");
  const authorizer = new NativeModelAuthorizer(members, copies);
  const acts = new InMemoryLineageActs();
  const host = await InMemoryBranchHost.start(accepted, {}, null, { acts });
  const runner = new LocalScriptRunner({ repoRoot });
  const clients = new Set();
  let submittal = null;
  let lastReview = null;

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
      edit: (command) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Demo edit timed out")), 10_000);
        finishEdit = (result) => { clearTimeout(timer); finishEdit = null; resolve(result.status === "rejected" ? { status: result.status, message: result.error.message } : { status: result.status }); };
        const submitted = client.submit(command);
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
    assert.equal(digest(main), acceptedDigest, "Accepted design must remain pinned");
    const proposal = submittal ? await (await host.open(`${accepted.modelId}~${submittal.id}`)).store.head() : null;
    const delta = proposal ? result(await deltaFor(role), "lineage_delta_result") : null;
    return {
      accepted: summary(main), proposal: proposal ? summary(proposal) : null,
      copy: submittal ? { id: submittal.id, name: submittal.name, role: submittal.role, parentRevision: submittal.parent.revision } : null,
      delta: delta ? { digest: delta.deltaDigest, headRevision: delta.headRevision, changedIds: delta.changedIds } : null,
      review: lastReview ? { ...lastReview, current: lastReview.digest === delta?.deltaDigest } : null,
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
      copies.grant(accepted.modelId, submittal.id, identities.engineer.id, "review");
      return { status: "created", message: "Submittal created from the pinned accepted revision. Owner can view; designated civil reviewer can review." };
    } finally { s.close(); }
  }
  async function propose(role) {
    if (!submittal) throw new Error("Create a submittal first");
    const modelId = `${accepted.modelId}~${submittal.id}`;
    const model = await (await host.open(modelId)).store.head();
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
    assert.equal(digest(await (await host.open(modelId)).store.head()), digest(model), "Script preview must not save changes");
    const s = await session(role, modelId);
    try { return await s.edit(parsed.batches[0]); } finally { s.close(); }
  }
  async function review(role, deltaDigest, outcome, reason) {
    if (!["revise_and_resubmit", "rejected"].includes(outcome)) throw new Error("Choose a review decision");
    if (typeof reason !== "string" || !reason.trim() || reason.length > 500) throw new Error("Enter a review reason of up to 500 characters");
    if (!submittal) throw new Error("Create a submittal first");
    const s = await session(role, `${accepted.modelId}~${submittal.id}`);
    try {
      const answer = await s.ask({ type: "lineage_review", lineageId: submittal.id, outcome, reason, deltaDigest });
      if (answer.type === "lineage_act_recorded") lastReview = { outcome: answer.act.outcome, digest: answer.act.deltaDigest, reviewer: identities[role].name, reason: answer.act.reason, sequence: answer.seq };
      return answer;
    } finally { s.close(); }
  }
  async function attemptDesignEdit(role) {
    if (role === "engineer") throw new Error("Accepted-design editing is outside this demonstration");
    const s = await session(role, accepted.modelId);
    try { return await s.edit({ type: "set_parameters", id: "MH1-COVER", scope: "instance", mark: "MH1-COVER-EDIT" }); }
    finally { s.close(); }
  }
  return { state, createSubmittal, propose, review, attemptDesignEdit, close() { for (const client of clients) client.dispose(); clients.clear(); } };
}
