import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Alert, AlertDescription, Badge, Button, Card, CardTitle, Field, Label,
  MutinyThemeProvider, NativeSelect, Textarea, ThemeToggle, TooltipProvider,
} from "@permitzip/bim-ui";
import "./style.css";

type Role = "contractor" | "owner" | "engineer" | "inspector";
type Decision = "revise_and_resubmit" | "rejected" | "approved";
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
  sequence: number;
  acceptedRevision: number;
  reason: string;
  reviewer: string;
  submissionRevision: number;
  evidence: Evidence | null;
}
const statuses = {
  resolved: "Resolved",
  needs_clarification: "Needs clarification",
  still_missing: "Still missing",
};
type RequirementStatus = keyof typeof statuses;
interface ChecklistItem {
  id: string;
  label: string;
  assessment: { status: RequirementStatus; note: string; reviewer: string } | null;
}
interface Observation {
  stage: "delivery" | "installation";
  observed: string;
  expected: string;
  matches: boolean;
  revision: number;
  inspector: string;
  photo: string | null;
  note: string;
}
interface State {
  observations: Observation[];
  approvalStale: boolean;
  preview: { id: string; revision: number; changes: { label: string; before: string; after: string }[] } | null;
  handoff: { before: Schedule; revision: number; approvalSequence: number; submissionRevision: number; evidence: Evidence } | null;
  checklist: ChecklistItem[];
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
  approved: "Approve substitution",
};

function Requirement({ item, evidence, editable, busy, save }: {
  item: ChecklistItem;
  evidence: Evidence;
  editable: boolean;
  busy: boolean;
  save: (status: RequirementStatus, note: string) => void;
}) {
  const [status, setStatus] = useState<RequirementStatus>(item.assessment?.status ?? "needs_clarification");
  const [note, setNote] = useState(item.assessment?.note ?? "");
  return (
    <Card>
      <CardTitle>{item.label}</CardTitle>
      <p>{item.id === "gasket" ? evidence.gasketResponse : (
        <><a href={evidence.document.href} download>{evidence.document.title}</a>{evidence.document.href === "/load-rating-rev-b.txt" ? " states the fictional Demo Vehicular Service classification." : " reports a synthetic proof load. The service load classification is unspecified."}</>
      )}</p>
      <p><strong>{item.assessment ? statuses[item.assessment.status] : "Awaiting assessment"}</strong>{item.assessment && ` · ${item.assessment.reviewer}`}</p>
      {item.assessment && <p>{item.assessment.note}</p>}
      {editable && (
        <>
          <Field>
            <Label htmlFor={`status-${item.id}`}>Status</Label>
            <NativeSelect id={`status-${item.id}`} value={status} disabled={busy} onChange={(event) => setStatus(event.target.value as RequirementStatus)}>
              {Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </NativeSelect>
          </Field>
          <Field>
            <Label htmlFor={`note-${item.id}`}>Review note</Label>
            <Textarea id={`note-${item.id}`} value={note} maxLength={500} disabled={busy} onChange={(event) => setNote(event.target.value)} />
          </Field>
          <Button disabled={busy || !note.trim()} onClick={() => save(status, note)}>Save assessment</Button>
        </>
      )}
    </Card>
  );
}

function Demo() {
  const [role, setRole] = useState<Role>(new URLSearchParams(window.location.search).has("field") ? "inspector" : "contractor");
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

  async function act(action: string, details: Record<string, string> = {}) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, action, outcome, reason, gasketResponse, digest: state?.delta?.digest, submissionDigest: state?.submission?.digest, ...details }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      if (body.result?.type === "request_refused") throw new Error(body.message);
      setMessage(body.message);
      if (action === "review" && body.result?.type === "lineage_act_recorded") { setReason(""); setOutcome("revise_and_resubmit"); }
      await load(role);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setBusy(false);
    }
  }

  const hasChange = Boolean(state?.delta?.changedIds.length);
  const submission = state?.submission;
  const canApprove = submission?.revision === 3 && state?.checklist.every((item) => item.assessment?.status === "resolved");
  const approved = state?.review?.current && state.review.outcome === "approved";
  const canReview = role === "engineer" && (!state?.review?.current || state.approvalStale);
  const canResubmit = role === "contractor" && submission && submission.revision < 3
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
            <option value="inspector">Field inspector</option>
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
      {state?.handoff && (role === "inspector" || role === "owner") && (
        <Card>
          <CardTitle>{role === "owner" ? "MH1 closeout" : "MH1 field verification"}</CardTitle>
          <p>Accepted assembly · <strong>{state.accepted.fields.find((field) => field.id === "order_code")?.value}</strong> · Revision {state.accepted.revision}</p>
          <p><a href={`#review-${state.handoff.approvalSequence}`}>Submission {state.handoff.submissionRevision} approval</a></p>
          <Badge variant="outline">{state.observations.at(-1)?.matches ? "Installation verified" : state.observations.length ? "Open discrepancy" : "Awaiting field observation"}</Badge>
          {state.observations.map((observation) => (
            <section key={observation.stage}>
              <h3>{observation.stage === "delivery" ? "1. Delivery mismatch" : "2. Installation verified"}</h3>
              <p>Observed <strong>{observation.observed}</strong> · Expected {observation.expected} at revision {observation.revision}</p>
              <p>{observation.note} · {observation.inspector}</p>
              {observation.photo && (
                <figure className="field-photo">
                  <a href={observation.photo}><img src={observation.photo} alt="Staged storm manhole cover with an MH1 delivery tag marked ECC-FC600-G" /></a>
                  <figcaption>Synthetic sample photo · Delivery tag</figcaption>
                </figure>
              )}
            </section>
          ))}
          {role === "inspector" && state.observations.length < 2 && (
            <Button disabled={busy} onClick={() => void act("observe", { stage: state.observations.length === 0 ? "delivery" : "installation" })}>
              {state.observations.length === 0 ? "Record sample delivery · ECC-FC600-G" : "Verify sample installation · ECC-FC600-S"}
            </Button>
          )}
        </Card>
      )}
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
        </Card>
      )}
      {canResubmit && (
        <Card>
          <CardTitle>Respond to the review</CardTitle>
          <p>{state.review?.reason}</p>
          {submission.revision === 1 ? <>
            <p>Synthetic load-rating document ECC-LR-FC600-S · Rev A</p>
            <Field>
              <Label htmlFor="gasket-response">Gasket response</Label>
              <Textarea id="gasket-response" value={gasketResponse} maxLength={500} disabled={busy} onChange={(event) => setGasketResponse(event.target.value)} />
            </Field>
          </> : <p>Submission 3 includes the synthetic Rev B service classification and the reviewer’s gasket confirmation.</p>}
          <Button disabled={busy || (submission.revision === 1 && !gasketResponse.trim())} onClick={() => void act("resubmit")}>Send submission {submission.revision + 1}</Button>
        </Card>
      )}
      {submission?.evidence && (
        <Card>
          <CardTitle>Submission {submission.revision} evidence</CardTitle>
          <p><a href={submission.evidence.document.href} download>{submission.evidence.document.title} · Download synthetic load-rating document</a></p>
          <p><strong>Gasket response</strong> · {submission.evidence.gasketResponse}</p>
        </Card>
      )}
      {submission?.evidence && state && (
        <Card>
          <CardTitle>Submission {submission.revision} requirements checklist</CardTitle>
          {state.checklist.map((item) => (
            <Requirement key={`${submission.digest}-${item.id}`} item={item} evidence={submission.evidence!}
              editable={role === "engineer" && !state.reviews.some((entry) => entry.submissionRevision === submission.revision && entry.outcome === "approved")} busy={busy}
              save={(status, note) => void act("assess", { itemId: item.id, status, note })} />
          ))}
        </Card>
      )}
      {hasChange && (
        <Card>
          <CardTitle>Review decisions</CardTitle>
          {state?.reviews.map((review) => (
            <div key={review.sequence} id={`review-${review.sequence}`}>
              <p><strong>Submission {review.submissionRevision} · {decisions[review.outcome]}</strong> · {review.reviewer}</p>
              <p>{review.reason}</p>
              {review.evidence ? <p>Evidence reviewed · <a href={review.evidence.document.href}>{review.evidence.document.title}</a> · {review.evidence.gasketResponse}</p> : <p>Evidence reviewed · Original catalog schedule</p>}
              {review.outcome === "approved" && <p>Accepted design reviewed · rev {review.acceptedRevision}</p>}
            </div>
          ))}
          {state?.approvalStale && <Alert><AlertDescription>The accepted design changed after approval. Record a fresh review before applying.</AlertDescription></Alert>}
          {canReview && (
            <>
              <Field>
                <Label htmlFor="outcome">Decision</Label>
                <NativeSelect id="outcome" value={outcome} disabled={busy} onChange={(event) => setOutcome(event.target.value as Decision)}>
                  <option value="revise_and_resubmit">Revise and resubmit</option>
                  <option value="rejected">Reject substitution</option>
                  {canApprove && <option value="approved">Approve substitution</option>}
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
      {approved && role === "engineer" && !state?.approvalStale && !state?.handoff && (
        <Card>
          <CardTitle>Apply approved substitution</CardTitle>
          <Button disabled={busy} onClick={() => void act("preview-handoff")}>Preview accepted schedule change</Button>
          {state?.preview && (
            <>
              <p>MH1 · Accepted revision {state.preview.revision}</p>
              <table>
                <thead><tr><th scope="col">Specification</th><th scope="col">Accepted</th><th scope="col">After apply</th></tr></thead>
                <tbody>{state.preview.changes.map((change) => (
                  <tr key={change.label}><th scope="row">{change.label}</th><td>{change.before}</td><td>{change.after}</td></tr>
                ))}</tbody>
              </table>
              <Button disabled={busy} onClick={() => void act("apply-handoff", { previewId: state.preview!.id })}>Apply ECC-FC600-S</Button>
            </>
          )}
        </Card>
      )}
      {state?.handoff && (
        <Card>
          <CardTitle>Accepted schedule handoff</CardTitle>
          <p>MH1 · ECC-FC600-S applied in revision {state.handoff.revision}.</p>
          <p><a href={`#review-${state.handoff.approvalSequence}`}>Submission {state.handoff.submissionRevision} approval</a> · <a href={state.handoff.evidence.document.href}>Load classification evidence</a></p>
          <details>
            <summary>Prior accepted schedule · rev {state.handoff.before.revision}</summary>
            <dl>{state.handoff.before.fields.map((field) => <div key={field.id}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>
          </details>
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
