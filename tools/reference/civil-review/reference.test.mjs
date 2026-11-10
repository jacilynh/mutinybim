import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { register } from "tsx/esm/api";
register();
const { sampleReview, assessReview } = await import("./packet.mjs");
const { digest } = await import("../rooftop-review/packet.mjs");
const here = path.dirname(fileURLToPath(import.meta.url));
const clone = (x) => JSON.parse(JSON.stringify(x));

test("civil invert review: scripts, two branch revisions, derived impact and evidence", { timeout: 120_000 }, async (t) => {
  const out = await mkdtemp(path.join(os.tmpdir(), "mutiny-civil-review-"));
  try {
    await promisify(execFile)(process.execPath, [path.join(here, "run.mjs"), "--out", out], { timeout: 100_000 });
    const read = async (name) => JSON.parse(await readFile(path.join(out, name), "utf8"));
    const [base, first, second, packet] = await Promise.all(["baseline.model.json", "reviewed.model.json", "revised.model.json", "review-packet.json"].map(read));
    await t.test("changes only OF1's governing invert; pipe geometry and catchments remain intact", () => {
      assert.equal(first.modelId, second.modelId);
      assert.equal(first.revision, base.revision + 1);
      assert.equal(second.revision, first.revision + 1);
      assert.deepEqual(packet.comparisons.sinceReview.map((c) => c.id), ["OF1"]);
      for (const el of Object.values(base.elements).filter((e) => e.id !== "OF1")) {
        assert.deepEqual(first.elements[el.id], el);
        assert.deepEqual(second.elements[el.id], el);
      }
      assert.ok(Math.abs(first.elements.OF1.values["civil.invert_elevation"] - 93.8 * 304.8) < 1e-6);
      assert.ok(Math.abs(second.elements.OF1.values["civil.invert_elevation"] - 94.5 * 304.8) < 1e-6);
    });
    await t.test("recomputes expected slopes across both edits and retains runoff", () => {
      const [a, b, c] = packet.snapshots;
      assert.deepEqual([a.pipe.status, b.pipe.status, c.pipe.status], ["too_flat", "ok", "too_flat"]);
      const length = 200 - 1200 / 304.8;
      assert.ok(Math.abs(b.pipe.slope - 1.2 / length * 100) < 1e-8);
      assert.ok(Math.abs(c.pipe.slope - 0.5 / length * 100) < 1e-8);
      assert.ok(Math.abs(c.pipe.runoff - 4.501111) < 1e-6);
      assert.equal(a.pipe.runoff, b.pipe.runoff);
      assert.equal(b.pipe.runoff, c.pipe.runoff);
      assert.ok(b.pipe.fullFlowCapacity > c.pipe.fullFlowCapacity);
    });
    await t.test("flags a changed dependency even though the pipe record was not edited", () => {
      assert.equal(packet.review.status, "needs_another_look");
      assert.equal(packet.derivedImpact.pipeRecordChanged, false);
      assert.equal(packet.derivedImpact.governingInputChanged, true);
      assert.equal(packet.findings.newSinceReview.length, 1);
      assert.equal(packet.findings.newSinceReview[0].rule, "civil.slope_below_minimum");
      assert.equal(packet.findings.inherited.length, 1);
      assert.equal(packet.findings.inherited[0].rule, "civil.inlet_overloaded");
    });
    await t.test("pins both comparison ranges to the correct saved snapshots", () => {
      for (const [i, model] of [base, first, second].entries()) assert.equal(packet.snapshots[i].digest, digest(model));
      assert.equal(packet.reviewRecord.snapshotDigest, digest(first));
      assert.equal(packet.branch.baseRevision, base.revision);
    });
    await t.test("does not flag unrelated records, but recognizes system and upstream invert dependencies", () => {
      const review = sampleReview(first);
      assert.equal(assessReview(review, first, first).status, "unchanged_in_scope");
      const unrelated = clone(first);
      unrelated.revision += 1;
      unrelated.elements.I1.version += 1;
      assert.equal(assessReview(review, first, unrelated).status, "unchanged_in_scope");
      for (const id of ["MH1", "sys-storm", "P103-s1"]) {
        const affected = clone(first);
        affected.elements[id].version += 1;
        assert.equal(assessReview(review, first, affected).status, "needs_another_look");
      }
    });
    await t.test("rejects mismatched evidence, scopes, branches and backwards comparisons", () => {
      const review = sampleReview(first);
      assert.throws(() => assessReview(review, base, second), /does not match/);
      assert.throws(() => assessReview({ ...review, scope: [] }, first, second), /scope/);
      assert.throws(() => assessReview(review, first, { ...second, modelId: "other" }), /reviewed branch/);
      assert.throws(() => assessReview(review, first, { ...second, revision: 0 }), /current revision/);
      const tampered = clone(first);
      tampered.elements.OF1.values["civil.invert_elevation"] += 1;
      assert.throws(() => assessReview(review, tampered, second), /does not match/);
    });
    await t.test("restores the branch while accepted Main stays unchanged", async () => {
      const { InMemoryBranchHost } = await import("@permitzip/bim-sync");
      const { bindModelPacks } = await import("@permitzip/bim-pack");
      const { CIVIL_SET } = await import("../../../packages/bim-pack-civil/__tests__/fixtures/synthetic-site.ts");
      bindModelPacks(base.modelId, CIVIL_SET);
      bindModelPacks(second.modelId, CIVIL_SET);
      const restored = await InMemoryBranchHost.start(base, {}, null, {}, await read("host-snapshot.json"));
      assert.deepEqual(await restored.main.store.head(), base);
      assert.deepEqual(await (await restored.open(second.modelId)).store.head(), second);
    });
    await t.test("outputs readable evidence and labels the schematic and fictional review honestly", async () => {
      const report = await readFile(path.join(out, "review-packet.md"), "utf8");
      assert.match(report, /Earlier fictional review: needs another look/);
      assert.match(report, /pipe record and plan geometry did not change/);
      assert.match(report, /not pipe-end geometry/);
      assert.match(report, /No HGL/);
      assert.equal((await readFile(path.join(out, "since-review.png"))).subarray(1, 4).toString(), "PNG");
    });
  } finally { await rm(out, { recursive: true, force: true }); }
});
