import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { register } from "tsx/esm/api";
register();
const { digest, changedElements } = await import("./packet.mjs");
const { sampleReview, assessReview } = await import("./review.mjs");
const { installFirstPartyAddOns } = await import("@permitzip/bim-first-party");
const { InMemoryBranchHost } = await import("@permitzip/bim-sync");
const here = path.dirname(fileURLToPath(import.meta.url));
const run = promisify(execFile);

test("rooftop reference: real scripts, isolated branch, measured packet and restart", { timeout: 120_000 }, async (t) => {
  const out = await mkdtemp(path.join(os.tmpdir(), "mutinybim-rtu-review-"));
  try {
    await run(process.execPath, [path.join(here, "run.mjs"), "--out", out], { timeout: 100_000 });
    const json = async (name) => JSON.parse(await readFile(path.join(out, name), "utf8"));
    const baseline = await json("baseline.model.json");
    const proposed = await json("proposed.model.json");
    const packet = await json("review-packet.json");
    const unit = (m) => Object.values(m.elements).find((el) => el.kind === "part" && el.mark === "RTU-1");
    await t.test("moves the same unit exactly 8 ft east, retaining its type and elevation", () => {
      const a = unit(baseline), b = unit(proposed);
      assert.equal(b.id, a.id);
      assert.equal(b.typeId, a.typeId);
      assert.ok(Math.abs((b.position.x - a.position.x) - 8 * 304.8) < 1e-6);
      assert.equal(b.position.y, a.position.y);
      assert.equal(b.offsetMm, a.offsetMm);
    });
    await t.test("preserves walls, spaces, documents and equipment types", () => {
      for (const el of Object.values(baseline.elements).filter((el) => !["part", "run_segment", "run_fitting"].includes(el.kind))) {
        assert.deepEqual(proposed.elements[el.id], el);
      }
      assert.equal(Object.keys(proposed.elements).length, Object.keys(baseline.elements).length);
    });
    await t.test("retains both equipment connections and remote duct endpoints", () => {
      const b = unit(proposed);
      for (const port of ["supply", "return"]) {
        const link = b.links[port];
        assert.ok(link, `${port} remains linked`);
        const run = proposed.elements[link.elementId];
        assert.deepEqual(run.links[link.port], { elementId: b.id, port });
      }
      for (const el of Object.values(baseline.elements).filter((el) => el.kind === "run_segment" && !el.links.end)) {
        assert.deepEqual(proposed.elements[el.id].end, el.end);
      }
    });
    await t.test("reports opposing route changes rather than hiding them in the net total", () => {
      assert.deepEqual(packet.quantities.ductCentreline, {
        baseline: { "ra-1": { value: 22.5, unit: "ft" }, "sa-1": { value: 22.5, unit: "ft" } },
        proposed: { "ra-1": { value: 14.5, unit: "ft" }, "sa-1": { value: 30.5, unit: "ft" } },
      });
      assert.deepEqual(packet.quantities.deltas, []);
      assert.equal(packet.changes.length, 7);
    });
    await t.test("pins evidence to snapshots and detects modified snapshot content", () => {
      assert.equal(packet.baseline.digest, digest(baseline));
      assert.equal(packet.proposed.digest, digest(proposed));
      const tampered = structuredClone(proposed);
      unit(tampered).position.x += 1;
      assert.notEqual(digest(tampered), packet.proposed.digest);
      assert.deepEqual(changedElements(baseline, proposed), packet.changes);
    });
    await t.test("distinguishes completed fixture checks from unperformed engineering reviews", async () => {
      assert.ok(packet.checks.slice(0, 3).every((c) => c.status === "passed"));
      assert.equal(packet.checks[3].status, "none_found");
      assert.equal(packet.checks.filter((c) => c.status === "not_evaluated").length, 2);
      const report = await readFile(path.join(out, "review-packet.md"), "utf8");
      assert.match(report, /no professional approval or merge/);
      assert.match(report, /No net change/);
      assert.match(report, /not_evaluated/);
      const image = await readFile(path.join(out, "comparison.png"));
      assert.equal(image.subarray(1, 4).toString(), "PNG");
    });
    const second = await json("proposed-v2.model.json");
    const review = await json("sample-review.json");
    const freshness = await json("review-freshness.json");
    await t.test("second proposal adds 4 ft east on the same branch, with a separate comparison range", async () => {
      assert.equal(second.modelId, proposed.modelId);
      assert.equal(second.revision, proposed.revision + 1);
      assert.ok(Math.abs(unit(second).position.x - unit(proposed).position.x - 4 * 304.8) < 1e-6);
      const since = await json("since-review.json");
      const full = await json("review-packet-v2.json");
      assert.equal(since.baseline.digest, digest(proposed));
      assert.equal(full.baseline.digest, digest(baseline));
      assert.equal(since.proposed.digest, digest(second));
      assert.deepEqual(since.quantities.ductCentreline.proposed, {
        "ra-1": { value: 10.5, unit: "ft" }, "sa-1": { value: 34.5, unit: "ft" },
      });
      assert.deepEqual(since.quantities.deltas, []);
      assert.ok(since.checks.slice(0, 3).every((c) => c.status === "passed"));
      assert.equal(since.checks[3].status, "none_found");
    });
    await t.test("flags the actual covered edits despite a zero aggregate quantity delta", () => {
      assert.equal(freshness.status, "needs_another_look");
      assert.equal(freshness.affected.length, 7);
      assert.deepEqual(freshness.changesSinceReview, changedElements(proposed, second));
      assert.deepEqual(assessReview(review, proposed, second), freshness);
      assert.equal(review.reviewed.digest, digest(proposed));
      assert.match(review.reviewer, /fictional/);
    });
    await t.test("unchanged covered records stay current across unrelated edits and revision changes", () => {
      assert.equal(assessReview(review, proposed, proposed).status, "unchanged_in_scope");
      const unrelated = structuredClone(proposed);
      unrelated.revision += 1;
      const wall = Object.values(unrelated.elements).find((el) => el.kind === "wall");
      wall.version += 1;
      const assessed = assessReview(review, proposed, unrelated);
      assert.equal(assessed.status, "unchanged_in_scope");
      assert.equal(assessed.changesSinceReview.length, 1);
      assert.equal(assessed.affected.length, 0);
    });
    await t.test("adding or removing a covered record requires another look", () => {
      const removed = structuredClone(proposed);
      delete removed.elements[unit(proposed).id];
      assert.equal(assessReview(review, proposed, removed).status, "needs_another_look");
      const added = structuredClone(proposed);
      added.elements["fixture-extra"] = { ...unit(proposed), id: "fixture-extra" };
      assert.equal(assessReview(review, proposed, added).status, "needs_another_look");
    });
    await t.test("refuses mismatched evidence, another branch, a backwards comparison and an unsupported scope", () => {
      assert.throws(() => assessReview(review, baseline, second), /does not match/);
      assert.throws(() => assessReview(review, proposed, { ...second, modelId: "other" }), /same branch/);
      assert.throws(() => assessReview(review, proposed, { ...second, revision: 0 }), /predates/);
      assert.throws(() => assessReview({ ...review, scope: { kinds: [] } }, proposed, second), /scope/);
      const tampered = structuredClone(proposed);
      unit(tampered).position.x += 1;
      assert.throws(() => assessReview(review, tampered, second), /does not match/);
      assert.equal(assessReview(sampleReview(second), second, second).status, "unchanged_in_scope");
    });
    await t.test("restores both proposal revisions without changing Main", async () => {
      installFirstPartyAddOns();
      const restored = await InMemoryBranchHost.start(baseline, {}, null, {}, await json("host-snapshot-v2.json"));
      assert.deepEqual(await restored.main.store.head(), baseline);
      const opened = await restored.open(second.modelId);
      assert.deepEqual(await opened.store.head(), second);
      const md = await readFile(path.join(out, "since-review.md"), "utf8");
      assert.match(md, /Earlier sample review: needs another look/);
      assert.match(md, /no professional approval/i);
      assert.match(md, /Current snapshot: sha256:/);
      assert.equal((await readFile(path.join(out, "since-review.png"))).subarray(1, 4).toString(), "PNG");
    });
    await t.test("restores the real branch with its edits while Main stays at baseline", async () => {
      installFirstPartyAddOns();
      const restored = await InMemoryBranchHost.start(baseline, {}, null, {}, await json("host-snapshot.json"));
      assert.deepEqual(await restored.main.store.head(), baseline);
      const opened = await restored.open(proposed.modelId);
      assert.ok(opened);
      assert.deepEqual(await opened.store.head(), proposed);
    });
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
