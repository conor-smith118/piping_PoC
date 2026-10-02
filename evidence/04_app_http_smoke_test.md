# App HTTP smoke test — real requests, 2026-10-02

Real `curl` requests against the **deployed, running** Databricks App at
`https://burns-piping-poc-7405608145506562.2.azure.databricksapps.com`,
authenticated with a real OAuth bearer token (`databricks auth token`).
This is the exact same backend a real browser session hits — these
responses are not mocked, and the app's own server-side authorization
logic (`getEffectiveRole`, `getRequestIdentity` — see `ARCHITECTURE.md`)
genuinely ran to produce them.

## `GET /api/config?projectId=BM-L-001`

```
$ curl -H "Authorization: Bearer $TOKEN" ".../api/config?projectId=BM-L-001"
{"dashboardId":"01f1bc2d96af1c5d89b8da06e2ba6785","embedBaseUrl":"https://adb-7405608145506562.2.azuredatabricks.net/embed/dashboardsv3/01f1bc2d96af1c5d89b8da06e2ba6785?o=7405608145506562"}
HTTP_STATUS:200
```

Confirms the app correctly resolves BM-L-001's real, deployed dashboard ID
and constructs a real embeddable dashboard URL.

## `GET /api/me`

```
$ curl -H "Authorization: Bearer $TOKEN" ".../api/me"
{"email":"conor.smith@databricks.com","eligibleRoles":["Estimator","Lead Engineer","Design Lead","Admin"],"viewAsRole":null,"isDevFallback":false}
HTTP_STATUS:200
```

Confirms the OBO SCIM group-membership lookup (`auth.ts`) ran for real
against this account and correctly resolved all 4 group memberships to
their role labels — `isDevFallback: false` proves this went through the
real forwarded-auth path, not the local-dev fallback.

## `GET /api/projects`

```
$ curl -H "Authorization: Bearer $TOKEN" ".../api/projects"
[
  {"projectId":"BM-L-005", ..., "yourRole":"Admin", "totalLines":16, "linesComplete":3, "pctComplete":0.1875, ...},
  {"projectId":"BM-L-001", ..., "yourRole":"Estimator", "totalLines":22, "linesComplete":2, "pctComplete":0.0909, ...},
  {"projectId":"BM-L-003", ..., "yourRole":"Design Lead", "totalLines":18, "linesComplete":1, "pctComplete":0.0556, ...},
  {"projectId":"BM-L-004", ..., "yourRole":"Admin", "totalLines":20, "linesComplete":1, "pctComplete":0.05, ...},
  {"projectId":"BM-L-002", ..., "yourRole":"Lead Engineer", "totalLines":20, "linesComplete":5, "pctComplete":0.25, ...}
]
HTTP_STATUS:200
```
(full response is one unbroken JSON line in the actual capture; shown
reformatted here for readability — every field value is verbatim)

**This is the strongest single piece of evidence that `getEffectiveRole`
genuinely works**: 5 different projects, 4 different resolved roles
(`Admin`, `Estimator`, `Design Lead`, `Lead Engineer`) for the *same*
authenticated identity on *different* projects — exactly the per-project
`user_project_role` assignment behavior described in `ARCHITECTURE.md`,
confirmed live over real HTTP, not asserted from source code reading.
Each project's `totalLines`/`linesComplete`/`pctComplete` also matches
`03_query_results.md`'s `gold_project_rollup` numbers exactly — the app's
API and the direct SQL query agree, because they're reading the same real
data.
