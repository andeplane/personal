# Historical analytics

Firestore `personal-analytics` remains the durable live ingestion store. A private
archive in Cloud Storage retains original Mixpanel JSONL and first-party batches.
BigQuery `personal_analytics.event_log` stores a normalized projection partitioned
by UTC event date and clustered by application, event, identity and source. The
`events` view removes repeated deliveries by canonical event ID. No history table
or archive event-age expiration is configured. The public live ingestion endpoint
still rejects events older than seven days; privileged imports use a separate job.

New event names require no database migration. Primitive analytical properties
live in a JSON column; original nested properties remain in the private archive.
Free text, URLs, credentials and direct identities are excluded from the dashboard
projection. Identities are HMAC pseudonyms scoped to an application. Numeric token
usage is allowed without allowing credential-token fields. New applications must
be registered in the catalog and reconcile their privacy disclosure.

## Import operation

The importer uses an existing Mixpanel account with a read-only Consumer role.
Credentials belong in Google Cloud Secret Manager, never the repository, command
arguments or logs. A private manifest in
`gs://andershaf-87-personal-analytics-archive/config/` describes each project:

```json
{"projects":[{"id":"PROJECT_ID","region":"us","from":"2022-10-10","to":"2026-11-17","timezone":"Europe/Oslo","legacyLocalTime":true,"credentialSecret":"projects/andershaf-87/secrets/personal-analytics-mixpanel/versions/1"}]}
```

Set `IMPORT_MANIFEST` on the `personal-analytics-import` Cloud Run job to that GCS
URI. Run the job and inspect its actual completion status and private
`reports/latest-import.json`. Each monthly window archives the unlimited raw
response before projection. A manifest records raw/normalized/rejected/loaded
counts, source generation, hash and load job. Any rejected row fails that window;
the original is retained and the checkpoint is not marked successful. A completed
manifest permits resuming without another API call. Stable load job IDs and the
deduplication view protect retries and overlapping deliveries.

Only data Mixpanel still retains can be exported. Start at the project's creation
date to include every retained day, and reconcile every project before declaring
the fleet import complete. Record inaccessible projects and missing retention
explicitly; visible report CSVs are not full-history exports. Project routing
uses event prefixes, observed source URLs and an explicit project default; unknown
events stay in `unassigned` rather than being discarded or guessed into Atomify.

Projects created before 2023 may export local wall-clock timestamps. Set the
ingestion timezone deliberately. Oslo DST conversion is tested; an ambiguous
fall-back timestamp uses the earlier possible instant and is flagged. If the
project changed ingestion timezone historically, split/reprocess with the known
timezone periods. Original exported timestamps remain available in the archive.

## Live synchronization

`personal-analytics-sync` copies retained source events from the new Firestore
database and the existing Fuse telemetry collection. It is read-only on both
sources. The first successful run copies retained rows; later runs use received
time with a five-minute overlap. Checkpoints move only after every batch loads
and its row count matches. Conditional checkpoint writes prevent concurrent runs
from silently overwriting a newer checkpoint. Replayed batches deduplicate in the
view. The archive bucket is private with uniform access, public access prevention,
object versioning and soft deletion.

Enable the warehouse API only after initial source synchronization and validation:
`ENABLE_WAREHOUSE=1 scripts/deploy.sh`, or set `WAREHOUSE_ENABLED=1` on the existing
service. A periodic Cloud Scheduler job may invoke source synchronization. Track
the actual job's successful completion and freshness separately from API health.

## Queries and definitions

Warehouse queries require an event-date partition filter, parameterize inputs,
and cap billed bytes at 1 GB per job. They return complete aggregates independently
of the newest 200 displayed raw rows and newest 100 sessions. The date window is
bounded to ten years. A query exceeding its budget fails visibly instead of
presenting sampled counts as totals.

DAU is the selected UTC end date. MAU is the calendar month through that date,
with the same event/property filters. Anonymous identities remain app-scoped;
events without identity count as events but not users or inferred sessions.
Reported session IDs are retained. Where absent, sessions use a 30-minute
inactivity rule, scoped to the queried month/window, and are explicitly labeled
inferred. Session spans are observed event spans, not attention. Return cohorts
are first observed within the window, not lifetime acquisition. Atomify reports
use app/dates independently of event/property filters; approximate performance
percentiles and missing measurements are labeled. Starts and stops are distinct
event counts, not a paired completion rate.

## Validation

Run `npm test`, then `npm run format` and `npm run lint`. For a real BigQuery check,
pipe an operator token (not logged) into `scripts/warehouse-integration.js`.
It creates a disposable synthetic dataset, checks more than 10,000 events,
deduplication, exact DAU/MAU, inferred sessions/timelines, retention, filters and
Atomify metrics, and removes the dataset in `finally`. No synthetic event is
inserted in production. `scripts/warehouse-probe.js` is a read-only production
query smoke test. The loopback preview contains clearly labeled synthetic data
and is excluded from the production image.
