import type { ExplorerData } from "../civil-explorer/data";
export type DemoRole = "owner" | "contractor" | "engineer";
export interface Summary {
  revision: number;
  digest: string;
  invert: number | null;
  pipe: ExplorerData["pipes"][number];
  findings: ExplorerData["findings"];
}
export interface DemoState {
  accepted: Summary;
  proposal: Summary | null;
  copy: { id: string; name: string; role: string; parentRevision: number } | null;
  delta: { digest: string; headRevision: number; changedIds: string[] } | null;
  review: { outcome: string; digest: string; reviewer: string; sequence: number; current: boolean } | null;
  acts: unknown[];
}
