/** Synthetic civil fixture only; set a governing structure invert, not pipe geometry. */
import { defineScript, units } from "@permitzip/bim-script";
export default defineScript({
  kind: "route",
  reads: { levels: true, kinds: ["part", "part_type", "run_segment", "mep_system", "zone"] },
  parameters: {},
  run(ctx) {
    ctx.edit({ type: "set_element_values", elementIds: ["OF1"], values: { "civil.invert_elevation": units.in_(units.ft(94.5), "mm") } });
    ctx.label("Raise OF1 invert following a revised receiving-connection assumption");
  },
});
