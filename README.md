# Burns & McDonnell Piping Workflow PoC

A Databricks App PoC modeling an EPC piping-design approval workflow: Estimators
enter line-list data, Lead Engineers confirm it, Design Leads true-up routed
quantities against the estimate (preliminary and final), and Lead Engineers
confirm each true-up. Built as a Databricks Asset Bundle (DABs) — Databricks App
(AppKit/React) + Lakebase (OBO human data entry) + CDC into Unity Catalog +
AI/BI dashboard + ML stage-duration model + per-project Genie agents.

See `docs/ARCHITECTURE.md` for the full design and `docs/DEMO_SCRIPT.md` for how
to run a live demo (simulate new data, observe it flow through, reset).

## Environment

| Item | Value |
|---|---|
| Databricks profile | `fevm-css-demo` |
| UC catalog.schema | `css_fevm.burns_piping_poc` |
| Lakebase project | `burns-piping-poc` (branch `production`, database `databricks-postgres`) |
| SQL Warehouse | `cssSQL` (`a4e59a1f13ab8b9a`) |
| Workspace groups | `Estimator`, `Lead Engineer`, `Design Lead`, `piping_admin` (in-app role label: "Admin") |

## Deploying

```bash
databricks bundle validate --strict -t dev --profile fevm-css-demo
databricks bundle deploy -t dev --profile fevm-css-demo
```

The bundle's `dev` target uses `mode: production` (not `development`) deliberately —
this is a single stable environment, not a multi-developer sandbox, and
`development` mode's automatic resource-name prefixing (e.g. `dev_<user>_...`)
would rename the UC schema away from the literal name every other resource in
this repo references.

## Status

- [x] Phase 0 — UC schema, Lakebase project + Postgres schema (REPLICA IDENTITY
      FULL confirmed on all 6 tables), live/historical/gold Delta tables + union
      views, workspace groups + membership
- [ ] Phase 1 — synthetic historical data (20-30 closed projects) + live seed
- [ ] Phase 2-3 — app skeleton, auth, stage-action forms
- [ ] Phase 4 — Lakebase → Delta CDC wiring
- [ ] Phase 5 — dashboard
- [ ] Phase 6 — ML model
- [ ] Phase 7 — Genie agents
- [ ] Phase 8 — simulate/reset jobs
- [ ] Phase 9 — polish
