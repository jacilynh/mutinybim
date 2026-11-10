import { defineScript, equipment, units } from "@permitzip/bim-script";

export default defineScript({
  kind: "route",
  reads: { levels: true, ids: ["MH1", "MH1-COVER"], partTypes: ["example.civil.ecc-fc600-*"] },
  parameters: {},
  run(ctx) {
    const cover = ctx.model.get("MH1-COVER");
    if (cover.kind !== "part" || cover.typeId !== "example.civil.ecc-fc600-g" || cover.values.structure_mark !== "MH1") {
      throw new Error("Expected the gasket variant installed at MH1");
    }
    ctx.edit({ type: "delete_elements", ids: [cover.id], policy: "refuse" });
    equipment.place(ctx, {
      id: cover.id,
      mark: cover.mark,
      level: cover.levelId,
      type: "example.civil.ecc-fc600-s",
      at: { x: units.mm(cover.position.x), y: units.mm(cover.position.y) },
      height: units.mm(cover.offsetMm),
      rotationDeg: cover.rotationDeg,
      values: cover.values,
    });
    ctx.label("Propose the ECC-FC600-S solid cover at MH1");
  },
});
