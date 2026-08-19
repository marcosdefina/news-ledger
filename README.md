# News Ledger

News Ledger is a provenance-first public record of news articles, revisions,
reception, and evidence-backed classifications. It preserves what a publisher
made available, when it was observed, and how it changed without turning
automated labels into allegations or verdicts.

## Initial Scope

The first source register covers England/UK and Ireland through reviewed official
feeds:

| Country | Publisher | Feed boundary |
|---|---|---|
| England / UK | The Guardian | Official UK RSS |
| England / UK | BBC News England | Official England RSS |
| Ireland | The Irish Times | Official outbound RSS |
| Ireland | RTÉ News | Official news RSS |

These sources provide broad public-interest coverage, stable article URLs, and
machine-readable metadata. Feed availability is not permission to republish an
article. Public pages therefore expose titles, bylines, source timestamps,
short source-provided excerpts, version fingerprints, and capture provenance.
Full feed payloads and body text remain private evidence.

## Evidence Model

- `feed_captures` stores each retrieval timestamp, response metadata, compressed
	payload, SHA-256 fingerprint, parser result, and collector version.
- `articles` identifies the publisher URL and points to its current observation.
- `article_versions` is append-only and links every changed observation to its
	predecessor.
- `classifications` records publisher, machine, or human origin and the method
	used. Initial machine rules flag only observable wording and content format.
- `reception_snapshots` separately records reviewed comment/reaction evidence.
	No source is estimated when a lawful collection method is unavailable.

SQLite triggers reject updates and deletes to captures, versions,
classifications, and reception snapshots.

The initial production-data bootstrap is identified as
`news-ledger-bootstrap-20260817T212626Z`. Its database file has SHA-256
`c8097ccfa821278bf56c115dc5574a4245394b66f4ccd302b7845c0087180d62`.
The runtime preservation gate verifies the original 324 article versions and
all four decompressed raw-feed payload hashes before and after each staging
collection. The database itself remains outside Git and is transferred only to
the canonical production data volume.

## Local Development

```bash
npm ci
npm test
npm run db:init
npm run collect
npm start
```

The service listens on `8080` by default and exposes `/health`. For local data:

```bash
LEDGER_DB_PATH=./data/news-ledger.db npm run db:init
LEDGER_DB_PATH=./data/news-ledger.db npm run collect
LEDGER_DB_PATH=./data/news-ledger.db node src/cli.mjs verify-bootstrap
LEDGER_DB_PATH=./data/news-ledger.db npm start
```

## Data Ownership

The collector is the only writable database owner. Staging and production web
containers mount the same production data volume read-only. Staging therefore
shows live production-backed records without running a separate database,
fixtures, or a copied data set. Every collector write is a production-data
write and is append-only.

The recurring collector uses conditional feed requests, a 12 MiB response
limit, a 30-second timeout, HTTPS-only same-host redirects, and sequential
source collection. It runs every 15 minutes by default.

## Delivery

| Environment | Branch | Route |
|---|---|---|
| Staging | `staging` | `https://staging.news.stillwaters.cz` |
| Production | `master` | `https://news.stillwaters.cz` |

Staging uses production-backed data directly. Production promotion requires a signed staging receipt and fresh Jenkins approval for the exact image ID. Public route activation requires the authoritative production receipt.

Initial registration activates staging only. The production route stays absent
until the exact staged image is explicitly approved after the staging report.

See [SERVICE_CONTEXT.md](SERVICE_CONTEXT.md) for the agent and delivery contract.
