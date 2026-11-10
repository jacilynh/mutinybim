import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Alert, AlertDescription, Badge, Button, Card, CardTitle, Field, Label, MutinyThemeProvider, NativeSelect, ThemeToggle, TooltipProvider } from "@permitzip/bim-ui";
import { traceSelection, type ExplorerData } from "./data";
import "./style.css";

const number = (n: number | null, unit: string) => n == null ? "Not available" : `${n.toFixed(2)} ${unit}`;

function Explorer({ data }: { data: ExplorerData }) {
  const [selected, select] = useState("I1");
  const trace = traceSelection(data, selected);
  const active = new Set(trace.ids);
  const structure = data.structures.find((s) => s.id === selected);
  const catchment = data.catchments.find((c) => c.id === selected);
  const pipe = data.pipes.find((p) => p.id === selected);
  const localFindings = data.findings.filter((f) => f.elementIds.some((id) => active.has(id)));
  const x = (v: number) => 45 + (v + 100) * 1.05;
  const y = (v: number) => 390 - (v + 75) * 0.8;
  const location = (id: string) => data.structures.find((s) => s.id === id);
  const options = [...data.structures, ...data.catchments, ...data.pipes.map((p) => ({ ...p, name: `${p.id}: ${p.from} → ${p.to}` }))];
  return <main className="explorer">
    <header><div><p className="eyebrow">MutinyBIM · Civil reference prototype</p><h1>Follow the water.</h1><p>Select an inlet, catchment or pipe to trace its downstream connections.</p></div><ThemeToggle /></header>
    <Alert><AlertDescription>Synthetic site · Existing civil-pack calculations · {number(data.intensity, "in/h")} rainfall intensity · {number(data.minimumSlope, "%")} minimum slope. These are example inputs, not project design criteria.</AlertDescription></Alert>
    <div className="workspace">
      <Card><CardTitle>Explore the storm network</CardTitle><Field><Label htmlFor="element">Selected element</Label><NativeSelect id="element" value={selected} onChange={(e) => select(e.target.value)}>{options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</NativeSelect></Field>
        <svg viewBox="0 0 690 455" role="img" aria-label={`Site plan highlighting the downstream path from ${selected}`}>
          <defs><marker id="flow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" className="arrow" /></marker></defs>
          {data.catchments.map((c) => <g key={c.id} className={active.has(c.id) ? "active" : "inactive"}><polygon className="catchment" points={c.outline.map((p) => `${x(p.x)},${y(p.y)}`).join(" ")} /><text x={x(c.outline[0]?.x ?? 0) + 10} y={y(Math.max(...c.outline.map((p) => p.y))) + 25}>{c.name}</text></g>)}
          {data.pipes.map((p) => { const a = location(p.from), b = location(p.to); return a && b ? <g key={p.id} className={active.has(p.id) ? "active" : "inactive"}><line className="pipe" x1={x(a.x)} y1={y(a.y)} x2={x(b.x)} y2={y(b.y)} markerEnd="url(#flow-arrow)"/><text x={(x(a.x) + x(b.x)) / 2} y={(y(a.y) + y(b.y)) / 2 - 14}>{p.id}</text></g> : null; })}
          {data.structures.map((s) => <g key={s.id} className={active.has(s.id) ? "active" : "inactive"}><circle className="structure" cx={x(s.x)} cy={y(s.y)} r="9"/><text x={x(s.x)} y={y(s.y) + 28} textAnchor="middle">{s.id}</text></g>)}
          <text x="45" y="440">Schematic plan · feet in local model coordinates · arrows follow network flow</text>
        </svg>
        <p className="muted">Highlight shows the selected element’s downstream route and its contributing catchments. The selected catchment’s assignment is listed separately; overland flow paths are not modeled.</p>
        <div className="choices">{options.map((o) => <Button key={o.id} variant={selected === o.id ? "default" : "outline"} onClick={() => select(o.id)} aria-pressed={selected === o.id}>{o.id}</Button>)}</div>
      </Card>
      <aside><Card><div className="title-row"><CardTitle>{selected}</CardTitle><Badge variant="outline">{structure?.kind.replaceAll("_", " ") ?? (catchment ? "catchment" : "storm pipe")}</Badge></div>
        <dl>
          {structure && <><dt>Accumulated modeled runoff</dt><dd>{number(structure.runoff, "cfs")}</dd><dt>Structure invert</dt><dd>{number(structure.invert, "ft")}</dd><dt>Rim elevation</dt><dd>{number(structure.rim, "ft")}</dd>{structure.kind === "storm_inlet" && <><dt>Stated inlet capacity</dt><dd>{number(structure.inletCapacity, "cfs")}</dd></>}</>}
          {catchment && <><dt>Area</dt><dd>{number(catchment.area, "ac")}</dd><dt>Runoff coefficient C</dt><dd>{number(catchment.coefficient, "")} · source: {catchment.coefficientSource}</dd><dt>Modeled runoff</dt><dd>{number(catchment.runoff, "cfs")}</dd><dt>Assigned inlet</dt><dd>{catchment.drainsTo ?? "Not assigned"} · {catchment.assignment === "inside" ? "inlet inside catchment" : catchment.assignment === "served_by" ? "explicit assignment" : "unresolved"}</dd></>}
          {pipe && <><dt>Downstream direction</dt><dd>{pipe.from} → {pipe.to}</dd><dt>Routed pipe length</dt><dd>{number(pipe.length, "ft")}</dd><dt>Modeled runoff</dt><dd>{number(pipe.runoff, "cfs")}</dd><dt>Structure-invert slope</dt><dd>{number(pipe.slope, "%")} · {pipe.status}</dd><dt>Manning full-flow reference capacity</dt><dd>{number(pipe.fullFlowCapacity, "cfs")}</dd></>}
        </dl>
        <h3>Downstream path</h3><p>{[...(catchment ? [catchment.id] : []), ...trace.path].join(" → ") || "Unresolved"}</p>
        {trace.problem && <Alert><AlertDescription>{trace.problem}</AlertDescription></Alert>}
        <h3>Contributing catchments</h3><div className="choices">{trace.catchmentIds.map((id) => <Button variant="outline" key={id} onClick={() => select(id)}>{id}</Button>)}</div>
      </Card><Card><CardTitle>Findings on this route</CardTitle>{localFindings.length ? localFindings.map((f) => <Alert key={f.rule + f.elementIds.join(",")}><AlertDescription><strong>{f.message}</strong><p>{f.fix}</p></AlertDescription></Alert>) : <p>No findings from the two enabled civil checks on this route.</p>}</Card></aside>
    </div>
    <Card><CardTitle>What this model does—and what needs more information</CardTitle><p>Runoff and pipe results come from MutinyBIM’s existing civil pack. It uses one rainfall intensity and adds catchment peaks without time of concentration. Catchment assignments do not prove terrain drainage. Inlet capacity is a stated input, not a grate-interception calculation. Pipe slopes use structure inverts; Manning full-flow capacity is not an HGL or surcharge analysis.</p><p>Terrain, overland bypass, inlet capture, tailwater, HGL, detention routing and design-storm selection are not evaluated. This explorer adds no calculation methods.</p>{data.problems.map((p) => <Alert key={p}><AlertDescription>{p}</AlertDescription></Alert>)}<p className="muted">Read-only snapshot · {data.modelId} · revision {data.revision}. Select I2 to see that flow direction comes from connectivity even though its pipe was drawn in the opposite direction.</p></Card>
  </main>;
}

function App() {
  const [data, setData] = useState<ExplorerData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { fetch("/api/site").then((r) => { if (!r.ok) throw new Error("Could not load the synthetic site"); return r.json(); }).then(setData).catch((e: Error) => setError(e.message)); }, []);
  return <MutinyThemeProvider presentation="standalone" applyToDocument><TooltipProvider>{error ? <Alert><AlertDescription>{error}</AlertDescription></Alert> : data ? <Explorer data={data} /> : <p>Loading the civil model…</p>}</TooltipProvider></MutinyThemeProvider>;
}
createRoot(document.getElementById("root")!).render(<App />);
