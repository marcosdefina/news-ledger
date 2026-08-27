# News Ledger Troubleshooting

Start here for News Ledger route, runtime, collection, and delivery failures. Repository state describes intent; confirm current public ingress on `gateway` and containers on `mainframe` before applying a recorded fix.

## 2026-08-27: Production hostname served the wrong application

**Status:** Resolved
**Environment:** Production and staging with shared production data

### Symptoms

- `https://news.stillwaters.cz` failed certificate hostname validation.
- Ignoring TLS validation returned the Ancestors Atlas application.
- Neither News Ledger hostname had an enabled Nginx virtual host.
- `news-ledger-production` did not exist; only the staging web and collector containers were running.
- After staging ingress was enabled, the first homepage request could block for minutes and make `/health` time out.

### Impact and scope

- News Ledger production was not publicly available.
- Staging data remained intact in `news-ledger-production-data`; the collector continued append-only collection.
- During the first gateway reconciliation, existing Cifra virtual hosts were removed because their active routes were absent from the gateway host-only environment. They were restored immediately and verified before continuing.

### Evidence

- Gateway inventory had no `news.stillwaters.cz` or `staging.news.stillwaters.cz` site.
- Mainframe port `18111` served the staging health response; port `18110` had no listener.
- On current production data, `ledgerCounts` took about 3 ms and `listArticles` about 75 ms, while `listSourceStats` took about 168 seconds.
- Jenkins staging builds exposed untested receipt-path assumptions: unset `GIT_COMMIT`, optional `BUILD_URL`, Groovy-escaped Python newlines, and a `curl | grep -q` broken pipe under `pipefail`.
- The first production job load also exposed a Groovy-invalid `\.` sequence before any deployment stage.

### Root cause

Initial catalog registration stopped after internal staging bootstrap. Production had never been promoted, and neither public route had been reconciled. Independently, `listSourceStats` joined all articles with all feed captures for each source before aggregation, creating an `articles x captures` cross product that blocked Node's synchronous SQLite request path as the production ledger grew. The generated promotion pipelines had never completed their receipt paths against this Jenkins controller.

### Resolution

- Registered and reconciled staging ingress, including valid TLS.
- Replaced the source-statistics cross product with separate per-source article and capture aggregates in `src/database.mjs`.
- Added a 1,500-article and 1,500-capture regression plus internal and public homepage staging checks.
- Corrected staging and production receipt validation for checkout identity, shell `pipefail`, Groovy/Python escaping, and canonical Jenkins build URLs.
- Added solo-maintainer-aware GitHub delivery gates: pull requests remain mandatory, while an external approval is required only when another eligible maintainer exists.
- Promoted immutable image `sha256:77c064ed0c77eadc528c4b6a032f05ba0e354a3f87b6d4d2556a8e07c8e13003` from signed staging build `news-ledger-staging/10` through approved production build `news-ledger-production/3`.
- Registered production route evidence in wrapper commit `dd3d844559bdcf61d9533060ecea495526c69121` and reconciled the gateway.
- Added Cifra production and staging flags to the gateway environment and configured a dedicated Jenkins verifier with read-only permissions.

### Verification

- News Ledger tests: 13 passed.
- Container test build: passed.
- Service catalog tests: 32 passed.
- Jenkins declarative linter: staging and production Jenkinsfiles passed.
- Signed staging build 10: success for commit `ad4861ca56068f16d85c89c2601f42c328eca2bd`, tree `2aaa4547f5d7c2c75d132b9746a4365c7f7ca756`, and the image above.
- Approved production build 3: success with an archived signed production receipt.
- Five public production homepage requests returned `200` in 0.20-0.27 seconds, followed by a healthy `/health` response.
- Production runs the approved image with the production data volume mounted read-only; recent application logs contained no request errors.
- Nginx syntax, production and staging TLS, both News Ledger routes, and both restored Cifra routes passed after reconciliation.

### Prevention and follow-up

- Keep the source-statistics scale regression and homepage staging checks mandatory.
- Validate generated Bash, embedded Python, and both real Jenkinsfiles before promotion; use Jenkins's declarative linter for Groovy parsing.
- Keep production route activation dependent on archived Jenkins evidence and exact live image verification.
- Keep active legacy gateway routes represented in the host-only environment before any catalog reconciliation.
- Treat staging collection as production-data writes; do not trigger staging builds solely for cleanup or route probes.
