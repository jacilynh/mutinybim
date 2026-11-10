import { defineScript, documents, equipment, parts, units } from "@permitzip/bim-script";

interface CutSheet {
  manufacturer: string;
  document: string;
  revision: string;
  page: number;
  family: string;
  frame: string;
  clearOpeningMm: number;
  frameOuterDiameterMm: number;
  frameDepthMm: number;
  coverDiameterMm: number;
  coverThicknessMm: number;
  material: string;
  variants: { orderCode: string; cover: string; option: string }[];
}

// The local runner embeds the reviewed synthetic sheet before preview.
const sheet = JSON.parse("__CUT_SHEET__") as CutSheet;
const mm = units.mm;
const typeId = (orderCode: string) => `example.civil.${orderCode.toLowerCase()}`;
const selected = "ECC-FC600-G";

export default defineScript({
  kind: "route",
  reads: { levels: true, ids: ["MH1"] },
  parameters: {},
  run(ctx) {
    const mh = ctx.model.get("MH1");
    if (mh.kind !== "part" || mh.classId !== "civil.manhole") throw new Error("Expected the synthetic MH1 manhole");
    const rim = mh.values["civil.rim_elevation"];
    if (typeof rim !== "number") throw new Error("MH1 needs a modeled rim elevation");
    const level = ctx.model.get(mh.levelId);
    if (level.kind !== "level") throw new Error("MH1 needs a site level");
    const source = `${sheet.document}, Rev ${sheet.revision}, p. ${sheet.page}`;
    const types = sheet.variants.map((variant) => {
      const part = parts.part(sheet.family, { type: variant.orderCode, category: "pipe_accessory" });
      const dimensions = [
        ["clear_opening", "Clear opening", sheet.clearOpeningMm],
        ["frame_outer_diameter", "Frame OD", sheet.frameOuterDiameterMm],
        ["frame_depth", "Frame depth", sheet.frameDepthMm],
        ["cover_diameter", "Cover diameter", sheet.coverDiameterMm],
        ["cover_thickness", "Cover thickness", sheet.coverThicknessMm],
      ] as const;
      for (const [key, label, value] of dimensions) part.param(key, { label, value: mm(value) });
      const specs = [
        ["manufacturer", "Manufacturer", sheet.manufacturer],
        ["order_code", "Order code", variant.orderCode],
        ["frame_code", "Frame code", sheet.frame],
        ["cover_code", "Cover code", variant.cover],
        ["cover_option", "Option", variant.option],
        ["material_spec", "Material", sheet.material],
        ["spec_source", "Source", source],
        ["stated_rating", "Stated load rating", "Not stated"],
      ] as const;
      for (const [key, label, value] of specs) part.param(key, { label, value });
      part.instanceParam("structure_mark", { kind: "text", label: "Structure" });
      const seat = mm(sheet.frameDepthMm - sheet.coverThicknessMm);
      const depth = mm(sheet.frameDepthMm);
      part.extrude(parts.circle(mm(sheet.frameOuterDiameterMm)), { to: depth });
      part.cut(parts.circle(mm(sheet.clearOpeningMm)), { to: depth });
      part.cut(parts.circle(mm(sheet.coverDiameterMm)), { from: seat, to: depth });
      part.extrude(parts.circle(mm(sheet.coverDiameterMm)), { from: seat, to: depth });
      return { typeId: typeId(variant.orderCode), definition: part.build() };
    });
    ctx.edit({ type: "save_part_types", label: "Save two synthetic FC600 variants", types });
    equipment.place(ctx, {
      id: "MH1-COVER", mark: "MH1-COVER", level: mh.levelId, type: typeId(selected),
      at: { x: mm(mh.position.x), y: mm(mh.position.y) },
      height: mm(rim - level.elevationMm - sheet.frameDepthMm),
      values: { structure_mark: mh.mark ?? mh.id },
    });
    const columns = [
      ["structure_mark", "Structure"], ["manufacturer", "Manufacturer"], ["order_code", "Order code"],
      ["frame_code", "Frame code"], ["cover_code", "Cover code"], ["cover_option", "Option"],
      ["clear_opening", "Clear opening"], ["frame_outer_diameter", "Frame OD"], ["frame_depth", "Frame depth"],
      ["cover_diameter", "Cover diameter"], ["cover_thickness", "Cover thickness"],
      ["material_spec", "Material"], ["stated_rating", "Stated load rating"], ["spec_source", "Source"],
    ] as const;
    const schedule = documents.schedule(ctx, {
      id: "civil-cover-schedule", name: "Storm structure schedule · frame and cover",
      classes: ["mep.pipe_accessory"],
      filters: [{ path: "mark", op: "equals", value: "MH1-COVER" }],
      columns: columns.map(([path, heading]) => ({ id: path, kind: "parameter", path, heading })),
    });
    ctx.report("Structure schedule", documents.scheduleRows(ctx, schedule));
    ctx.label("Place the FC600 gasket variant on MH1 and schedule its source specifications");
  },
});
