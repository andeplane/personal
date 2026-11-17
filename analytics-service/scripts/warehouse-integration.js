// Explicitly disposable synthetic dataset. Never writes fixtures to production.
import assert from "node:assert/strict";
import { OAuth2Client } from "google-auth-library";
import { BigQuery } from "@google-cloud/bigquery";
import { Warehouse } from "../src/warehouse.js";
import { EVENT_SCHEMA, deduplicatedViewSql } from "../src/warehouse-schema.js";
let token = "";
for await (const chunk of process.stdin) token += chunk;
const authClient = new OAuth2Client();
authClient.setCredentials({ access_token: token.trim() });
token = "";
const bq = new BigQuery({
  projectId: "andershaf-87",
  authClient,
  location: "europe-west1",
});
const name = `personal_analytics_test_${Date.now()}`,
  dataset = bq.dataset(name);
await dataset.create({
  location: "europe-west1",
  defaultTableExpirationMs: 3600000,
  description: "Disposable synthetic analytics integration fixtures",
});
try {
  const table = dataset.table("event_log");
  await table.create({
    schema: EVENT_SCHEMA,
    timePartitioning: { type: "DAY", field: "event_date" },
    requirePartitionFilter: true,
  });
  const sql = `INSERT INTO \`andershaf-87.${name}.event_log\` (id,app_id,event_date,name,occurred_at,user_id,reported_session_id,source,properties,archive_ref,imported_at,schema_version)
    SELECT CAST(i AS STRING),'atomify',DATE '2026-11-01','Other.Event',TIMESTAMP_ADD(TIMESTAMP '2026-11-01 02:00:00 UTC',INTERVAL i MILLISECOND),'u3',REPEAT('c',32),'synthetic',JSON '{}','synthetic-only',CURRENT_TIMESTAMP(),1 FROM UNNEST(GENERATE_ARRAY(1,10001)) i
    UNION ALL SELECT 'start','atomify',DATE '2026-11-01','Simulation.Start',TIMESTAMP '2026-11-01 00:00:00 UTC','u1',NULL,'synthetic',JSON '{}','synthetic-only',CURRENT_TIMESTAMP(),1
    UNION ALL SELECT 'start','atomify',DATE '2026-11-01','Simulation.Start',TIMESTAMP '2026-11-01 00:00:00 UTC','u1',NULL,'synthetic',JSON '{}','synthetic-only',TIMESTAMP_SUB(CURRENT_TIMESTAMP(),INTERVAL 1 HOUR),1
    UNION ALL SELECT 'stop','atomify',DATE '2026-11-01','Simulation.Stop',TIMESTAMP '2026-11-01 00:10:00 UTC','u1',NULL,'synthetic',JSON '{"durationSeconds":600,"numAtoms":1000,"timestepsPerSecond":100,"stopReason":"completed"}','synthetic-only',CURRENT_TIMESTAMP(),1
    UNION ALL SELECT 'later','atomify',DATE '2026-11-01','Other.Event',TIMESTAMP '2026-11-01 00:45:00 UTC','u1',NULL,'synthetic',JSON '{}','synthetic-only',CURRENT_TIMESTAMP(),1
    UNION ALL SELECT 'return','atomify',DATE '2026-11-02','Page.Load',TIMESTAMP '2026-11-02 12:00:00 UTC','u1',NULL,'synthetic',JSON '{}','synthetic-only',CURRENT_TIMESTAMP(),1
    UNION ALL SELECT 'anonymous','atomify',DATE '2026-11-01','Page.Load',TIMESTAMP '2026-11-01 01:00:00 UTC',NULL,NULL,'synthetic',JSON '{}','synthetic-only',CURRENT_TIMESTAMP(),1`;
  await bq.query({ query: sql });
  await dataset.table("events").create({
    view: {
      query: deduplicatedViewSql("andershaf-87").replaceAll(
        "personal_analytics.",
        `${name}.`,
      ),
      useLegacySql: false,
    },
  });
  const wrapper = {
    createQueryJob(options) {
      return bq.createQueryJob({
        ...options,
        query: options.query.replaceAll(
          "personal_analytics.events",
          `${name}.events`,
        ),
      });
    },
  };
  const warehouse = new Warehouse({ bq: wrapper });
  const range = {
    from: "2026-11-01",
    to: "2026-11-02",
    start: Date.parse("2026-11-01"),
    end: Date.parse("2026-11-03"),
  };
  const data = await warehouse.analyze(range, {
    appId: "atomify",
    funnel: ["Simulation.Start", "Simulation.Stop"],
  });
  assert.equal(data.summary.events, 10006);
  assert.equal(data.summary.users, 2);
  assert.equal(data.summary.eventsWithoutIdentity, 1);
  assert.equal(data.summary.sessions, 4);
  assert.equal(data.active.dau, 1);
  assert.equal(data.active.mau, 2);
  assert.deepEqual(
    data.funnel.map((row) => row.users),
    [1, 1],
  );
  assert.equal(data.retention.find((row) => row.day === 1).returned, 1);
  assert.equal(data.atomify.performance.durationSamples, 1);
  assert.equal(data.atomify.performance.averageDuration, 600);
  const session = data.sessions.find((row) => row.events === 2);
  assert(session?.inferred);
  const detail = await warehouse.session("atomify", session.sessionId, range);
  assert.deepEqual(
    detail.events.map((row) => row.name),
    ["Simulation.Start", "Simulation.Stop"],
  );
  const filtered = await warehouse.analyze(range, {
    appId: "atomify",
    property: "stopReason",
    value: "completed",
  });
  assert.equal(filtered.summary.events, 1);
  assert.equal(filtered.active.mau, 1);
  assert.equal(filtered.atomify.usage.simulationStarts, 1);
  console.log(
    JSON.stringify({
      passed: true,
      syntheticDataset: name,
      eventsBeyondOldCap: data.summary.events,
      deduplication: true,
      inferredSessions: true,
      sessionTimeline: true,
      retention: true,
      exactFilteredMau: true,
      atomify: true,
    }),
  );
} finally {
  await dataset.delete({ force: true });
}
