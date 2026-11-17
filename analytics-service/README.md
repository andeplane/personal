# First-party fleet analytics

The public dashboard shell lives at `/personal/stats/`. Every data read goes to
the separate `personal-analytics` Cloud Run service and requires a Firebase ID
token issued by the existing `andershaf-87` project. Firebase Admin verifies the
signature, issuer, audience, expiry and revocation; the application additionally
requires `email_verified: true`, Google as the sign-in provider and the exact email
`andershaf@gmail.com`. The frontend uses in-memory authentication persistence.
No private telemetry is embedded in the static site or source repository.

## Components and deployment

- Personal GCP project: `andershaf-87`, region `europe-west1`.
- Dedicated database: `personal-analytics`, Native mode, deletion protection enabled.
- Runtime: `personal-analytics-runtime`, write access scoped to this database;
  read-only access to the existing `fuse-riders` database. Code only reads the
  `fuse-production-telemetry-events` collection there, never playtest reports,
  screenshots, recordings, accounts or transcripts. Firestore IAM cannot restrict
  this server role to one collection; database-level read access is the boundary.
- Browser Firestore rules deny all access. Only the service account uses Firestore.
- The existing Firebase Google provider and authorized GitHub Pages origin are reused.
- Privacy HMAC key: Secret Manager `personal-analytics-privacy`, pinned version 1;
  no value is committed. Changing it creates new pseudonymous identities and is a
  deliberate migration, not routine deployment.
- Cloud Run scales to zero, caps at two instances, uses 256 MiB/one vCPU and a
  30-second request timeout. The dedicated named database is billed separately;
  this does not promise a free tier. Durable admission caps ingestion at 50,000
  attempted events/day, 2,000/minute globally and 200/minute per client address.
- Reuses the existing Artifact Registry repository, build bucket and restricted
  Cloud Build account. No keys, unrelated credentials or source `.env` files enter
  the image. Build input is allowlisted by `.gcloudignore` and `.dockerignore`.

After tests, format and lint, commit the source and run `bash scripts/deploy.sh`
from this directory. The script builds on Cloud Build, then deploys that committed
image. Retain its build ID and serving revision. Pages publication is independent
and goes through the repository PR workflow. Its artifact excludes this backend.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run format
npm run lint
node scripts/preview.js
```

The preview binds an ephemeral loopback port and uses explicitly synthetic data.
Its fake owner and memory store are excluded from the production image. It never
accepts telemetry. Local quick tests use injected storage, clock and token-verifier
boundaries; production has no synthetic store or token bypass.

## Ingestion

`POST /v1/events`, JSON, maximum 64 KiB, one registered app and 1–20 events:

```json
{
  "v": 1,
  "appId": "atomify",
  "events": [{
    "id": "a-random-event-uuid",
    "userId": "a-random-installation-uuid",
    "sessionId": "a-random-session-uuid",
    "name": "Simulation.Start",
    "occurredAt": 1794916800000,
    "properties": { "feature": "examples", "iterations": 200 }
  }]
}
```

IDs are 8–128 alphanumeric/underscore/hyphen characters. Time is Unix milliseconds,
within seven days of receipt and no more than five minutes ahead. The example time
must be replaced by current time. The response `accepted` array acknowledges the
original event IDs. Retries preserve IDs; conflicting content returns 409.
Client identities are app-scoped HMAC pseudonyms in storage, never account emails.
Telemetry is client reported, not proof of a person, authoritative play or payment.

The service keeps bounded primitive properties. It drops credential, URL, email,
free-text, prompt, code, query, room/invite, filename and similar fields. Do not
rely on heuristics as permission to pass private content: integrations should send
only predefined product dimensions. No IP or derived location is stored in event
data; a keyed IP digest exists briefly in quota documents. Hosting infrastructure
still processes ordinary request metadata.

`stats/sdk/analytics.js` is the browser SDK: random installation identity, 30-minute
inactivity sessions, a 200-event/seven-day outbox, acknowledged delivery, bounded
backoff, DNT/opt-out and local-development suppression. It supports `track`,
`timeEvent`, `flush`, `reset`, `setOptOut` and `destroy`. Storage refusal falls back
to memory. Web Locks serialize outbox mutations across tabs when available;
without them persisted delivery is best effort. SDK sessions advance on observed
events; the observed span is not attention time. Native apps can use the same JSON
contract with their own bounded durable outbox and privacy controls.

```js
import { createAnalytics } from 'https://andeplane.github.io/personal/stats/sdk/analytics.js';
const analytics = createAnalytics({
  appId: 'atomify',
  endpoint: 'https://personal-analytics-oaaqztec5a-ew.a.run.app',
});
analytics.track('Simulation.Start', { feature: 'examples' });
```

Browser project IDs and the ingestion endpoint are public, not credentials. Events
can be spoofed by clients. Exact browser-origin checks and shared rate budgets limit
abuse, but are not user authentication. Query access always requires the owner token.

## Metrics and limits

- DAU: distinct app-scoped installations on the selected end date, UTC.
- MAU: distinct app-scoped installations from that calendar month's first day
  through the selected end date. Never a sum of DAU or an unlabeled rolling month.
- Sessions/events and all distributions describe the selected date window.
- Exact daily/monthly counters and user/session memberships are updated in the
  same transaction as accepted events, so duplicate retries never inflate them.
- Directly ingested apps use exact unfiltered DAU and current/full-month MAU
  aggregates even when a raw read is too large. Historical partial months,
  property/event filters and federated Fuse scopes use complete bounded raw reads.
- Deepdives read at most 10,000 rows plus one overflow sentinel per source/window.
  Aggregate counts/charts are withheld when their source is incomplete. Raw event
  lists show the newest 200 matches; session lists show the newest 100 observed
  sessions. They are labeled as samples when the source is incomplete. Reduce the
  date window rather than treating a truncated scan as a full count.
- Date windows are at most 90 days. Raw central events have 400-day TTL; summary
  and membership retention is 400/430 days. Source Fuse data keeps its existing
  retention (currently 90 days). TTL deletion is asynchronous housekeeping.
- Return cohorts mean first observed activity in the selected window, not lifetime
  acquisition. Only fully elapsed follow-up days count. Funnels are ordered events
  for the same app/installation, inside seven days and the selected window.
- The Fuse bridge is read only and normalizes its existing product events into
  the central contract. IDs deduplicate dual delivery. Its uniques are computed
  as a union, never by adding source and destination aggregates.

## API

Public: `GET /healthz`, `GET /v1/config`, `POST /v1/events`.
Authenticated: `GET /v1/me`, `/readyz`, `/v1/apps`, `/v1/query`, `/v1/session`.
`/v1/query` accepts `from`, `to`, `appId`, `event`, `property`, `value`, `breakdown`
and up to five repeated `step` parameters. Sessions additionally require `appId`
and the pseudonymous `sessionId`. Unknown/duplicate parameters are rejected.
Responses are `no-store`. Startup proves both configured stores are readable
before the service accepts requests. New storage never falls back to memory.

## Inventory and migration

See [inventory.json](inventory.json) for source evidence and unresolved next steps.
Literal public Atomify call sites are in [atomify-events.json](atomify-events.json).
`scripts/inventory.py` regenerates literal call sites from an exact Git revision
without storing property payloads or reading environment files. Computed names
require manual review. Detailed private-repository inventory is kept in the
operator's local output record, not published in this public repository.

Fuse Games is federated now. Atomify Web, the homepage and AI Data Analytics still
need their Mixpanel transports replaced and app-specific validation/release.
The native Atomify app and pirate games have published no-analytics statements;
their product behavior and disclosure must be reconciled before enabling events.
Workalong's legacy TeslaCode web-client metrics are a separate retired product,
not evidence of instrumentation in the new native/task platform. Swarmbell's
usage charts are local product features, not evidence of fleet telemetry.

Historical Mixpanel export requires the correct project/service-account export
credentials and an explicit per-project mapping. No history was imported or
deleted, no Mixpanel account was canceled, and no app is marked migrated merely
because it appears in the catalog. The inventory retains blockers and next actions.
