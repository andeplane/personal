import { BigQuery } from "@google-cloud/bigquery";
import { OAuth2Client } from "google-auth-library";
import {
  EVENT_SCHEMA,
  WAREHOUSE_DATASET,
  WAREHOUSE_LOCATION,
  deduplicatedViewSql,
} from "../src/warehouse-schema.js";
let token = "";
for await (const chunk of process.stdin) token += chunk;
token = token.trim();
if (token.length < 20)
  throw new Error("Operator OAuth token required on stdin");
const authClient = new OAuth2Client();
authClient.setCredentials({ access_token: token });
const bq = new BigQuery({
  projectId: "andershaf-87",
  authClient,
  location: WAREHOUSE_LOCATION,
});
const dataset = bq.dataset(WAREHOUSE_DATASET);
if (!(await dataset.exists())[0])
  await dataset.create({
    location: WAREHOUSE_LOCATION,
    description:
      "Private first-party and retained Mixpanel event history. No event-age expiration.",
  });
const table = dataset.table("event_log");
if (!(await table.exists())[0])
  await table.create({
    schema: EVENT_SCHEMA,
    timePartitioning: { type: "DAY", field: "event_date" },
    clustering: { fields: ["app_id", "name", "user_id", "source"] },
    requirePartitionFilter: true,
    description:
      "Append-only normalized event batches; events view removes retry/overlap duplicates by canonical event ID.",
  });
const [tableMetadata] = await table.getMetadata();
const fields = [...tableMetadata.schema.fields];
for (const field of EVENT_SCHEMA)
  if (!fields.some((existing) => existing.name === field.name))
    fields.push(field);
if (fields.length !== tableMetadata.schema.fields.length)
  await table.setMetadata({ schema: { fields } });
const view = dataset.table("events");
if (!(await view.exists())[0])
  await view.create({
    view: { query: deduplicatedViewSql("andershaf-87"), useLegacySql: false },
  });
else
  await view.setMetadata({
    view: { query: deduplicatedViewSql("andershaf-87"), useLegacySql: false },
  });
const [metadata] = await dataset.getMetadata();
const additions = [
  {
    role: "READER",
    userByEmail:
      "personal-analytics-runtime@andershaf-87.iam.gserviceaccount.com",
  },
  {
    role: "WRITER",
    userByEmail:
      "personal-analytics-importer@andershaf-87.iam.gserviceaccount.com",
  },
];
const access = [...(metadata.access ?? [])];
for (const addition of additions)
  if (
    !access.some(
      (entry) =>
        entry.role === addition.role &&
        entry.userByEmail === addition.userByEmail,
    )
  )
    access.push(addition);
await dataset.setMetadata({ access });
token = "";
console.log(
  JSON.stringify({
    dataset: metadata.id,
    location: metadata.location,
    table: "event_log",
    view: "events",
    partition: "event_date",
    clusters: ["app_id", "name", "user_id", "source"],
    eventExpiration: null,
  }),
);
