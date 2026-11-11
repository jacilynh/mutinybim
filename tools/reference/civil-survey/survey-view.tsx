interface Observation {
  shot: string;
  label: string;
  pipe: string;
  port: string;
  designMm: number;
  measuredMm: number;
  deltaMm: number;
}
export interface State {
  datum: string;
  designRevision: number;
  recordRevision: number;
  observations: Observation[] | null;
  preview: { id: string; outlet: Observation; revision: number } | null;
  recordEntry: string | null;
  profile: { upstreamMm: number; mh1Mm: number; downstreamMm: number };
}

export function Profile({ state }: { state: State }) {
  const { upstreamMm, mh1Mm, downstreamMm } = state.profile;
  const outlet = state.observations?.find(({ port }) => port === "out");
  const points = [upstreamMm, mh1Mm, downstreamMm, outlet?.measuredMm ?? mh1Mm];
  const min = Math.min(...points);
  const range = Math.max(...points) - min || 1;
  const y = (mm: number) => 155 - (mm - min) / range * 108;
  return (
    <svg className="profile" viewBox="0 0 640 205" role="img" aria-label={outlet ? `MH1 outlet survey shot is ${outlet.deltaMm} millimetres above the design reference.` : "Design reference profile from I1 through MH1 to OF1."}>
      <path className="design-line" d={`M 64 ${y(upstreamMm)} L 285 ${y(mh1Mm)} L 578 ${y(downstreamMm)}`} />
      <text x="64" y="186" textAnchor="middle">I1</text>
      <text x="285" y="186" textAnchor="middle">MH1</text>
      <text x="578" y="186" textAnchor="middle">OF1</text>
      {outlet && (
        <>
          <circle className="survey-point" cx="285" cy={y(outlet.measuredMm)} r="5" />
          <text x="302" y={y(outlet.measuredMm) - 12}>{outlet.deltaMm > 0 ? "+" : ""}{outlet.deltaMm} mm · Outlet shot</text>
        </>
      )}
    </svg>
  );
}

export function Observations({ state }: { state: State }) {
  return (
    <div className="schedule-scroll">
      <table>
        <thead><tr><th scope="col">Pipe end</th><th scope="col">Shot</th><th scope="col">Design reference</th><th scope="col">Surveyed</th><th scope="col">Difference</th><th scope="col">Accepted record</th></tr></thead>
        <tbody>{state.observations?.map((row) => (
          <tr key={row.shot}>
            <th scope="row">{row.label}<br />{row.pipe} · {row.port}</th>
            <td>{row.shot}</td><td>{row.designMm}</td><td>{row.measuredMm}</td>
            <td>{row.deltaMm > 0 ? "+" : ""}{row.deltaMm} mm</td>
            <td>{state.recordEntry && row.port === "out" ? Number(state.recordEntry.split(" ")[0]) : "—"}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
