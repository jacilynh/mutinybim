import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Alert, AlertDescription, Badge, Button, Card, CardTitle, MutinyThemeProvider, ThemeToggle, TooltipProvider } from "@permitzip/bim-ui";
import "./style.css";

import { Observations, Profile, type State } from "./survey-view";

function App() {
  const [state, setState] = useState<State>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function update(action?: string) {
    setBusy(true);
    setError("");
    try {
      const response = action ? await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, previewId: state?.preview?.id }),
      }) : await fetch("/api/state");
      const next = await response.json();
      if (!response.ok) throw new Error(next.error);
      setState(next);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void update(); }, []);
  return (
    <main className="review-demo">
      <header><h1>MH1 survey review</h1><ThemeToggle /></header>
      {error && <Alert><AlertDescription>{error}</AlertDescription></Alert>}
      {state && (
        <>
          <Card>
            <CardTitle>Survey source</CardTitle>
            <p><a href="/mh1-survey.csv" download>mh1-survey.csv</a> · Synthetic field shots in metres · Vertical datum {state.datum}</p>
            {!state.observations && <Button disabled={busy} onClick={() => void update("import")}>Import sample survey</Button>}
          </Card>
          <Card>
            <CardTitle>Pipe-end observations</CardTitle>
            <p>Design revision {state.designRevision} · Record copy revision {state.recordRevision} · Elevations in mm</p>
            {state.observations ? (
              <Observations state={state} />
            ) : <p>Import the sample survey to compare the two MH1 pipe ends.</p>}
          </Card>
          <Card>
            <CardTitle>Invert profile</CardTitle>
            <p>Schematic using governing structure inverts as the design reference. The dot marks the outlet survey shot.</p>
            <Profile state={state} />
          </Card>
          {state.observations && (
            <Card>
              <CardTitle>Record model review</CardTitle>
              {state.recordEntry ? (
                <><Badge variant="outline">Accepted in record revision {state.recordRevision}</Badge><p>{state.recordEntry}</p><p><a href="/closeout">Open printable closeout</a> · <a href="/closeout?download" download>Download closeout HTML</a> · <a href="/closeout.zip" download>Download closeout packet (ZIP)</a></p></>
              ) : state.preview ? (
                <>
                  <p>{state.preview.outlet.pipe} · {state.preview.outlet.shot} · {state.preview.outlet.measuredMm} mm on {state.datum}</p>
                  <p>The checked edit saves the surveyed invert as metadata in the record copy.</p>
                  <Button disabled={busy} onClick={() => void update("accept")}>Accept outlet invert</Button>
                </>
              ) : <Button disabled={busy} onClick={() => void update("preview")}>Preview outlet record edit</Button>}
            </Card>
          )}
        </>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <MutinyThemeProvider presentation="standalone" applyToDocument>
    <TooltipProvider><App /></TooltipProvider>
  </MutinyThemeProvider>,
);
