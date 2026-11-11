import { defineScript, units } from "@permitzip/bim-script";

export default defineScript({
  kind: "route",
  reads: { ids: ["P103-s1", "MH1"] },
  parameters: {
    elevation: { type: "quantity", kind: "length", unit: "mm", label: "Surveyed invert" },
  },
  run(ctx, { elevation }) {
    const pipe = ctx.model.get("P103-s1");
    if (pipe.kind !== "run_segment" || ctx.model.get("MH1").kind !== "part") {
      throw new Error("Expected the MH1 outlet pipe in the record copy");
    }
    ctx.edit({
      type: "set_project_parameters",
      define: [{ key: "mh1_outlet_record_invert", label: "MH1 outlet record invert", valueType: "text" }],
      values: { mh1_outlet_record_invert: `${units.in_(elevation, "mm")} mm · DEMO-BM1 · P103-s1/MH1/out · mh1-survey.csv#MH1-02` },
    });
    ctx.label("Record the surveyed MH1 outlet invert");
  },
});
