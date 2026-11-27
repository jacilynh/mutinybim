import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Alert, AlertDescription, Badge, Button, Card, CardTitle, Field, Label, MutinyThemeProvider, NativeSelect, ThemeToggle, TooltipProvider } from "@permitzip/bim-ui";
import type { DemoRole, DemoState } from "./types";
import "./style.css";

function Demo() {
  const [role, setRole] = useState<DemoRole>("contractor");
  const [state, setState] = useState<DemoState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const load = async () => {
    const r = await fetch(`/api/state?role=${role}`);
    if (!r.ok) throw new Error("Could not load the civil review demonstration");
    setState(await r.json());
  };
  useEffect(() => { void load().catch((e: Error) => setError(e.message)); }, [role]);
  const act = async (action: string) => {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role, action, digest: state?.delta?.digest }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "The action failed");
      setMessage(body.message);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const fmt = (n: number | null | undefined) => n == null ? "Unknown" : n.toFixed(3);
  return <main className="review-demo">
    <header><div><p className="muted">MutinyBIM · Civil external-review prototype</p><h1>A proposal, not a design edit.</h1><p>A contractor requests a different receiving invert. The civil reviewer sees what it means.</p></div><ThemeToggle /></header>
    <Alert><AlertDescription>Local demonstration with simulated identities, not production sign-in or verified professional credentials. Copy edits and review rights are checked by the existing model server. All project data is synthetic.</AlertDescription></Alert>
    <Card><CardTitle>Choose a demonstration perspective</CardTitle><Field><Label htmlFor="role">Act as (demo)</Label><NativeSelect id="role" value={role} disabled={busy} onChange={(e) => { setRole(e.target.value as DemoRole); setMessage(""); setError(""); }}><option value="contractor">Contractor — edit own submittal</option><option value="owner">Owner — view only</option><option value="engineer">Civil reviewer / EOR — review the proposal</option></NativeSelect></Field>
      <div className="actions"><Button disabled={busy || role !== "contractor" || !!state?.copy} onClick={() => void act("create")}>1. Create contractor submittal</Button><Button disabled={busy || role !== "contractor" || !state?.copy || !!state?.delta?.changedIds.length} onClick={() => void act("propose")}>2. Propose OF1 at 94.50 ft</Button><Button disabled={busy || role !== "engineer" || !state?.delta?.changedIds.length || !!state?.review?.current} onClick={() => void act("review")}>3. Record “Revise and resubmit”</Button></div>
      {role !== "engineer" && <div><Button variant="outline" disabled={busy || !state} onClick={() => void act("attempt-design-edit")}>Test: try editing the accepted design</Button><p className="muted">This deliberately sends an edit so you can see the server refuse it.</p></div>}
      {role === "owner" && <p>The owner can inspect both states but cannot edit the design, edit this submittal or record its review.</p>}
      <div role="status" aria-live="polite">{busy ? "Running the selected action…" : message}</div>
      {error && <Alert><AlertDescription>{error}</AlertDescription></Alert>}
    </Card>
    {state && <>
      <div className="columns"><Card><div className="title"><CardTitle>Accepted design</CardTitle><Badge variant="outline">Pinned · unchanged</Badge></div><p>Revision {state.accepted.revision} · OF1 invert {fmt(state.accepted.invert)} ft</p><p>P103 slope: <strong>{fmt(state.accepted.pipe.slope)}%</strong> · {state.accepted.pipe.status}</p><p className="hash">Snapshot: {state.accepted.digest}</p></Card>
      <Card><div className="title"><CardTitle>Contractor submittal</CardTitle><Badge variant="secondary">Not accepted into design</Badge></div>{state.proposal ? <><p>Revision {state.proposal.revision} · OF1 invert {fmt(state.proposal.invert)} ft</p><p>P103 slope: <strong>{fmt(state.proposal.pipe.slope)}%</strong> · {state.proposal.pipe.status}</p><p>Copied from accepted revision {state.copy?.parentRevision}. Changed records: {state.delta?.changedIds.join(", ") || "None yet"}.</p><p className="hash">Proposal delta: {state.delta?.digest}</p></> : <p>No contractor submittal yet. Create one above; the accepted snapshot will stay pinned.</p>}</Card></div>
      {state.proposal && <Card><CardTitle>What the civil reviewer needs to see</CardTitle><p>Raising the outfall invert changes P103’s governing slope, even though the pipe record stays unchanged. The fixture minimum is 0.50%. Flow remains {fmt(state.proposal.pipe.runoff)} cfs.</p>{state.proposal.findings.map((f) => <Alert key={f.rule + f.elementIds.join(",")}><AlertDescription><strong>{f.message}</strong><p>{f.rule === "civil.inlet_overloaded" ? "Inherited finding: this inlet overload was already present in the accepted fixture." : "New relative to the accepted fixture: the proposed invert brings back the low-slope warning."}</p></AlertDescription></Alert>)}</Card>}
      <Card><CardTitle>Recorded review</CardTitle>{state.review ? <><Badge variant="outline">Revise and resubmit</Badge><p>{state.review.reviewer} · record {state.review.sequence} · {state.review.current ? "Matches the current proposal delta" : "Proposal changed; review needs another look"}</p><p className="hash">Reviewed delta: {state.review.digest}</p><p>This is a recorded demonstration review act. It does not change or approve the accepted design.</p></> : <p>No review recorded. Only the configured civil reviewer holds review rights on this submittal.</p>}</Card>
    </>}
    <Card><CardTitle>Scope of this demonstration</CardTitle><p>No accept-back, merge or publication action is offered. Recorded review and acceptance are separate. Design acceptance needs an agreed EOR authorization policy before integration.</p><p>The existing civil solver uses structure inverts; this is not a pipe-end geometry change. No tailwater, hydraulic-grade-line, cover or utility-crossing analysis is performed. The receiving-connection request is illustrative and needs field verification.</p></Card>
  </main>;
}
createRoot(document.getElementById("root")!).render(<MutinyThemeProvider presentation="standalone" applyToDocument><TooltipProvider><Demo /></TooltipProvider></MutinyThemeProvider>);
