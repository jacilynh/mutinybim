/** Run only against the baseline made by this reference scenario. */
import { defineScript, units } from "@permitzip/bim-script";

export default defineScript({
  kind: "route",
  reads: { levels: true, kinds: ["part", "part_type", "run_segment", "run_fitting", "mep_system"] },
  parameters: {},
  run(ctx) {
    const unitsOnRoof = ctx.model.ofKind("part").filter((el) => el.kind === "part" && el.mark === "RTU-1");
    if (unitsOnRoof.length !== 1) throw new Error("This example needs exactly one RTU-1.");
    const unit = unitsOnRoof[0]!;
    // The command uses canonical millimetres. The kit's units make that conversion explicit.
    ctx.edit({ type: "move_elements", ids: [unit.id], delta: { x: units.in_(units.ft(8), "mm"), y: 0 } });
    // The kernel carries connected runs; this script does not rewrite model records.
    ctx.label("Move RTU-1 8 ft east to reserve its original location for a proposed solar array");
  },
});
