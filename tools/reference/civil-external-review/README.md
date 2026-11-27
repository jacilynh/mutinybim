# Civil external review: a proposal, not a design edit

A local product demonstration joining the existing copy permissions, civil
solver results and digest-bound lineage reviews. Uses the civil invert
reference's first proposal as the accepted **demo** snapshot.

```sh
node tools/reference/civil-external-review/server.mjs
```

Open http://127.0.0.1:3198. The server binds to loopback only; change the port
with `CIVIL_REVIEW_PORT`. It builds the existing civil reference in a temporary
folder, then loads its first proposal as the demo's accepted state. The local
browser build lives under the ignored `mutinybim-examples` directory. Restart
to reset the in-memory demonstration. No database or account is required.

## Show the workflow

1. As **Contractor**, try editing the accepted design. The model server
   refuses the edit. OF1 remains at 93.80 ft.
2. Create a **submittal** copy, then propose OF1 at 94.50 ft. The trusted local
   example script is run, checked and previewed, then applied as the contractor
   only on their copy. Main stays pinned at the accepted revision.
3. Switch to **Owner** to inspect both states. Owner has an explicit read
   grant on the submittal. Design edits, copy edits and reviews are refused.
4. Switch to **Civil reviewer / EOR**. P103's calculated slope changes from
   about 0.612% to 0.255%, below the fixture's 0.50% criterion, even though
   only OF1's governing structure invert record changed.
5. Record **Revise and resubmit**. The existing lineage-review service
   records the outcome against the exact proposal digest. An outdated digest
   is refused. Nothing changes on Main.

## What is real here

- `NativeModelAuthorizer`, per-copy grants, `authorizeConnection` and the
  model server enforce the permissions for the simulated identities.
- `lineage_create`, `lineage_delta` and `lineage_review` use the existing
  sync service and its content checks. The configured reviewer holds a named
  review grant, not an inferred or verified professional license.
- The contractor runs the existing kit script in the local script runner;
  a checked output batch is applied through the authenticated-as-fixture sync
  session. The UI button authorizes running and applying this known script
  on the contractor copy; the runner does not accept uploaded scripts.
- The view uses the existing civil solver and shared MutinyBIM components.

The role selector deliberately simulates identities on a local machine; it
is not sign-in or protection from another person on that machine. Review
acts are held in memory, not durable or cryptographically certified. The
prototype offers no accept-back, merge or publishing action. A production
host would need real identity, persistent review records, invitation and
disclosure policy, and an agreed EOR authorization rule for acceptance.

The civil model is synthetic. The invert changes governing metadata, not
pipe-end geometry. The existing calculation is not an HGL, tailwater or
constructability assessment; the receiving connection is illustrative.
No engineering methods or defaults change.

## Verify

```sh
node --test tools/reference/civil-external-review/workflow.test.mjs
npx tsc -p tools/reference/civil-external-review/tsconfig.json
npx eslint tools/reference/civil-external-review
```

The tests exercise actual server refusals, not just disabled browser buttons.
Discuss integration with maintainers before proposing an upstream PR.
