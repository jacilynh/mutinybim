import { renderToStaticMarkup } from "react-dom/server";
import { Observations, Profile, type State } from "./survey-view.tsx";

const paperStyle = `
  @page { margin: 15mm; }
  body { color: black; background: white; font: 11pt system-ui, sans-serif; max-width: 48rem; margin: 2rem auto; padding: 0 1rem; }
  h1 { margin-bottom: .25rem; }
  h2 { font-size: 14pt; margin-top: 1.5rem; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: .4rem; border-bottom: 1px solid black; }
  a { color: inherit; }
  .schedule-scroll { overflow-x: auto; }
  .profile { display: block; width: 100%; max-width: 38rem; }
  .profile text { fill: black; font-size: 16px; }
  .design-line { fill: none; stroke: black; stroke-width: 2; }
  .survey-point { fill: black; stroke: white; stroke-width: 2; }
  @media print {
    body { margin: 0; padding: 0; }
    .schedule-scroll { overflow: visible; }
    .download { display: none; }
    section, tr { break-inside: avoid; }
  }
`;

export function renderCloseout(state: State, csvHref: string): string | null {
  if (!state.recordEntry || !state.observations) return null;
  return "<!doctype html>" + renderToStaticMarkup(
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>MH1 survey closeout</title>
        <style>{paperStyle}</style>
      </head>
      <body>
        <main>
          <h1>MH1 survey closeout</h1>
          <p>Synthetic survey · Design revision {state.designRevision} · Record revision {state.recordRevision}</p>
          <section>
            <h2>Accepted outlet invert</h2>
            <p>{state.recordEntry}</p>
          </section>
          <section>
            <h2>Survey observations</h2>
            <p>Vertical datum {state.datum} · Source mh1-survey.csv · Elevations in mm</p>
            <Observations state={state} />
          </section>
          <section>
            <h2>Invert profile</h2>
            <p>Schematic of governing design inverts with the outlet survey shot marked.</p>
            <Profile state={state} />
          </section>
          <p className="download"><a href={csvHref} download="mh1-survey.csv">Download source CSV</a></p>
        </main>
      </body>
    </html>,
  );
}
