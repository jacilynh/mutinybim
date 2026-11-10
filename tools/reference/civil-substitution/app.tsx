import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Alert, AlertDescription, Badge, Button, Card, CardTitle, Field, Label,
  MutinyThemeProvider, NativeSelect, Textarea, ThemeToggle, TooltipProvider,
} from "@permitzip/bim-ui";
import "./style.css";

type Role = "contractor" | "owner" | "engineer";
type Decision = "revise_and_resubmit" | "rejected";
interface Schedule {
  revision: number;
  fields: { id: string; label: string; value: string }[];
}
interface Evidence {
  document: { title: string; href: string };
  gasketResponse: string;
}
interface Review {
  outcome: Decision;
  reason: string;
  reviewer: string;
  submissionRevision: number;
  evidence: Evidence | null;
}
interface State {
  submission: { revision: number; digest: string; evidence: Evidence | null } | null;
  reviews: Review[];
  accepted: Schedule;
  proposal: Schedule | null;
  copy: { parentRevision: number } | null;
  delta: { digest: string; changedIds: string[] } | null;
  review: (Review & { current: boolean }) | null;
}
const decisions = {
  revise_and_resubmit: "Revise and resubmit",
  rejected: "Reject substitution",
};

function Demo() {
  const [role, setRole] = useState<Role>("contractor");
  const [state, setState] = useState<State | null>(null);
  const [outcome, setOutcome] = useState<Decision>("revise_and_resubmit");
  const [reason, setReason] = useState("");
  const [gasketResponse, setGasketResponse] = useState("ECC-FC600-S has no gasket option. Please confirm whether the project requires a gasket.");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load(asRole: Role) {
    const response = await fetch(`/api/state?role=${asRole}`);
    if (!response.ok) throw new Error("Could not load the structure schedules");
    setState(await response.json());
  }

  useEffect(() => {
    void load(role).catch((problem: Error) => setError(problem.message));
  }, [role]);

  async function act(action: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, action, outcome, reason, gasketResponse, digest: state?.delta?.digest, submissionDigest: state?.submission?.digest }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setMessage(body.message);
      if (action === "review" && body.result?.type === "lineage_act_recorded") setReason("");
      await load(role);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setBusy(false);
    }
  }

  const hasChange = Boolean(state?.delta?.changedIds.length);
  const submission = state?.submission;
  const firstReview = state?.reviews[0];
  const canResubmit = role === "contractor" && submission?.revision === 1
    && state?.review?.current && state.review.outcome === "revise_and_resubmit";
  const proposalFields = new Map(state?.proposal?.fields.map(({ id, value }) => [id, value]));
  return (
    <main className="review-demo">
      <header>
        <div>
          <h1>MH1 frame-and-cover substitution</h1>
          <p>Compare the contractor’s solid-cover proposal with the accepted structure schedule.</p>
        </div>
        <ThemeToggle />
      </header>
      <Alert><AlertDescription>Synthetic catalog and simulated local identities. Review decisions are recorded on the submittal.</AlertDescription></Alert>
      <Card>
        <Field>
          <Label htmlFor="role">View as</Label>
          <NativeSelect id="role" value={role} disabled={busy} onChange={(event) => {
            setRole(event.target.value as Role);
            setMessage("");
            setError("");
          }}>
            <option value="contractor">Contractor</option>
            <option value="owner">Owner</option>
            <option value="engineer">Civil reviewer</option>
          </NativeSelect>
        </Field>
        {role === "contractor" && (
          <div className="actions">
            <Button disabled={busy || !state || !!state.copy} onClick={() => void act("create")}>Create submittal</Button>
            <Button disabled={busy || !state?.copy || hasChange} onClick={() => void act("propose")}>Propose ECC-FC600-S</Button>
          </div>
        )}
        <p role="status">{busy ? "Working…" : message}</p>
        {error && <Alert><AlertDescription>{error}</AlertDescription></Alert>}
      </Card>
      {state && (
        <Card>
          <CardTitle>Structure schedule</CardTitle>
          <div className="schedule-scroll">
            <table>
              <thead><tr><th scope="col">Specification</th><th scope="col">Accepted design · rev {state.accepted.revision}</th><th scope="col">Contractor submittal{state.proposal && ` · rev ${state.proposal.revision}`}</th></tr></thead>
              <tbody>
                {state.accepted.fields.map((field) => {
                  const proposed = proposalFields.get(field.id);
                  return (
                    <tr key={field.id}>
                      <th scope="row">{field.label}</th>
                      <td>{field.value}</td>
                      <td>{proposed ?? "—"} {proposed !== undefined && proposed !== field.value && <Badge variant="outline">Changed</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {hasChange && <p>The proposed variant removes the gasket option. Scheduled dimensions match. The source leaves the load rating unspecified for both variants.</p>}
        </Card>
      )}
      {canResubmit && (
        <Card>
          <CardTitle>Respond to the review</CardTitle>
          <p>{state.review?.reason}</p>
          <p>Synthetic load-rating document ECC-LR-FC600-S · Rev A</p>
          <Field>
            <Label htmlFor="gasket-response">Gasket response</Label>
            <Textarea id="gasket-response" value={gasketResponse} maxLength={500} disabled={busy} onChange={(event) => setGasketResponse(event.target.value)} />
          </Field>
          <Button disabled={busy || !gasketResponse.trim()} onClick={() => void act("resubmit")}>Send submission 2</Button>
        </Card>
      )}
      {submission?.evidence && (
        <Card>
          <CardTitle>Changes since the first review</CardTitle>
          <p>Submission 1 had no supplemental evidence. Submission 2 adds the document and response below. The proposed part is ECC-FC600-S in both submissions.</p>
          <p><a href={submission.evidence.document.href} download>{submission.evidence.document.title} · Download synthetic load-rating document</a></p>
          <p><strong>Gasket response</strong> · {submission.evidence.gasketResponse}</p>
        </Card>
      )}
      {hasChange && (
        <Card>
          <CardTitle>Review decisions</CardTitle>
          {state?.reviews.map((review) => (
            <div key={review.submissionRevision}>
              <p><strong>Submission {review.submissionRevision} · {decisions[review.outcome]}</strong> · {review.reviewer}</p>
              <p>{review.reason}</p>
              <p>{review.evidence ? `Evidence reviewed: ${review.evidence.document.title} and gasket response.` : "Evidence reviewed: original catalog schedule."}</p>
            </div>
          ))}
          {firstReview && submission?.revision === 2 && !state?.review?.current && <p>Submission 2 is awaiting a new decision.</p>}
          {role === "engineer" && !state?.review?.current && (
            <>
              <Field>
                <Label htmlFor="outcome">Decision</Label>
                <NativeSelect id="outcome" value={outcome} disabled={busy} onChange={(event) => setOutcome(event.target.value as Decision)}>
                  <option value="revise_and_resubmit">Revise and resubmit</option>
                  <option value="rejected">Reject substitution</option>
                </NativeSelect>
              </Field>
              <Field>
                <Label htmlFor="reason">Reason</Label>
                <Textarea id="reason" value={reason} maxLength={500} disabled={busy} onChange={(event) => setReason(event.target.value)} placeholder="Confirm the gasket requirement and provide the applicable load rating." />
              </Field>
              <Button disabled={busy || !reason.trim()} onClick={() => void act("review")}>Record decision for submission {submission?.revision}</Button>
            </>
          )}
          {!state?.review && role !== "engineer" && <p>Awaiting a decision from the civil reviewer.</p>}
        </Card>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <MutinyThemeProvider presentation="standalone" applyToDocument>
    <TooltipProvider><Demo /></TooltipProvider>
  </MutinyThemeProvider>,
);
