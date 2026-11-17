export const WAREHOUSE_DATASET = "personal_analytics";
export const WAREHOUSE_LOCATION = "europe-west1";
export const ARCHIVE_BUCKET = "andershaf-87-personal-analytics-archive";
export const MAX_QUERY_BYTES = "1000000000";
export const EVENT_SCHEMA = [
  { name: "id", type: "STRING", mode: "REQUIRED" },
  { name: "app_id", type: "STRING", mode: "REQUIRED" },
  { name: "event_date", type: "DATE", mode: "REQUIRED" },
  { name: "name", type: "STRING", mode: "REQUIRED" },
  { name: "occurred_at", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "received_at", type: "TIMESTAMP" },
  { name: "user_id", type: "STRING" },
  { name: "reported_session_id", type: "STRING" },
  { name: "source", type: "STRING", mode: "REQUIRED" },
  { name: "source_project", type: "STRING" },
  { name: "source_insert_id", type: "STRING" },
  { name: "source_time_zone", type: "STRING" },
  { name: "timestamp_ambiguous", type: "BOOLEAN" },
  { name: "properties", type: "JSON" },
  { name: "archive_ref", type: "STRING", mode: "REQUIRED" },
  { name: "imported_at", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "schema_version", type: "INTEGER", mode: "REQUIRED" },
];
export function warehouseTable(projectId, name) {
  if (
    !/^[a-z][a-z0-9-]{4,62}$/.test(projectId) ||
    !["event_log", "events"].includes(name)
  )
    throw new Error("Invalid warehouse table");
  return `\`${projectId}.${WAREHOUSE_DATASET}.${name}\``;
}
export function deduplicatedViewSql(projectId) {
  return `SELECT * FROM ${warehouseTable(projectId, "event_log")}
    QUALIFY ROW_NUMBER() OVER (PARTITION BY event_date, id ORDER BY imported_at DESC, archive_ref DESC) = 1`;
}
