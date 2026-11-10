import type { ModelState } from "@permitzip/bim-kernel";
import { solveStormNetwork, inletOverloadFindings, slopeFindings } from "@permitzip/bim-pack-civil";
import { fromCanonical, qty, to } from "@permitzip/bim-units";

export function explorerData(model: ModelState) {
  const net = solveStormNetwork(model.elements);
  const cfs = (q: Parameters<typeof to>[0] | null | undefined) => q == null ? null : to(q, "cfs");
  const ft = (n: number) => to(qty("length", n, "mm"), "ft");
  return {
    modelId: model.modelId, revision: model.revision,
    intensity: net.intensity ? to(net.intensity, "in/h") : null,
    minimumSlope: to(net.minSlope, "%"),
    structures: net.site.structures.map((s) => ({ id: s.id, name: s.name, kind: s.classId.replace("civil.", ""), x: ft(s.position.x), y: ft(s.position.y), rim: s.rim ? to(s.rim, "ft") : null, invert: s.invert ? to(s.invert, "ft") : null, inletCapacity: cfs(s.capacity), runoff: cfs(net.totalRunoff.get(s.id)) })),
    catchments: net.site.catchments.map((c) => ({ id: c.id, name: c.name, area: to(c.area, "acre"), coefficient: c.c, coefficientSource: c.cFrom, drainsTo: c.drainsTo, assignment: c.drainsToFrom, runoff: cfs(net.catchmentRunoff.get(c.id)), outline: c.outline.map((p) => ({ x: ft(p.x), y: ft(p.y) })) })),
    pipes: net.pipes.map((p) => ({ id: p.id, from: p.from, to: p.to, length: to(p.length, "ft"), runoff: cfs(p.flow), fullFlowCapacity: cfs(p.capacity), slope: p.gravity?.slope == null ? null : to(fromCanonical("slope", p.gravity.slope), "%"), status: p.gravity?.status ?? "unknown" })),
    downstream: Object.fromEntries(net.downstream),
    findings: [...inletOverloadFindings(net), ...slopeFindings(net)],
    problems: [...net.problems],
  };
}
export type ExplorerData = ReturnType<typeof explorerData>;

/** Bounded read of the pack's oriented downstream graph, never drawing direction. */
export function traceSelection(data: ExplorerData, selected: string) {
  const catchment = data.catchments.find((c) => c.id === selected);
  const pipe = data.pipes.find((p) => p.id === selected);
  if (!catchment && !pipe && !data.structures.some((s) => s.id === selected)) throw new Error("Select a known civil element");
  const start = catchment ? catchment.drainsTo : pipe ? pipe.from : selected;
  const path: string[] = [];
  const seen = new Set<string>();
  let at: string | null | undefined = start;
  let problem: string | null = null;
  while (at != null) {
    if (seen.has(at)) { problem = `Cycle at ${at}; trace stopped`; break; }
    seen.add(at);
    path.push(at);
    if (!(at in data.downstream)) { problem = `${at} has no resolved downstream path`; break; }
    at = data.downstream[at];
  }
  if (start == null) problem = "This catchment has no assigned inlet";
  const contributes = (inlet: string | null) => {
    const visited = new Set<string>();
    let next = inlet;
    while (next != null && !visited.has(next)) {
      if (next === start) return true;
      visited.add(next);
      next = data.downstream[next] ?? null;
    }
    return false;
  };
  const catchmentIds = catchment ? [catchment.id] : data.catchments.filter((c) => contributes(c.drainsTo)).map((c) => c.id);
  const pipeIds = data.pipes.filter((p) => path.some((id, i) => id === p.from && path[i + 1] === p.to)).map((p) => p.id);
  const ids = [...new Set([...path, ...pipeIds, ...catchmentIds])];
  return { path, pipeIds, catchmentIds, ids, problem };
}
