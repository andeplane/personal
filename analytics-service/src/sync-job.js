import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { Firestore, FieldPath } from "firebase-admin/firestore";
import { BigQuery } from "@google-cloud/bigquery";
import { Storage } from "@google-cloud/storage";
import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { normalizeFirstParty } from "./history-normalize.js";
import { withLease } from "./job-lease.js";
import {
  ARCHIVE_BUCKET,
  WAREHOUSE_DATASET,
  WAREHOUSE_LOCATION,
  EVENT_SCHEMA,
} from "./warehouse-schema.js";

export async function syncSources({ authClient }) {
  const projectId = "andershaf-87",
    storage = new Storage({ projectId, authClient }),
    bucket = storage.bucket(ARCHIVE_BUCKET);
  const bq = new BigQuery({
    projectId,
    authClient,
    location: WAREHOUSE_LOCATION,
  });
  const privacy = await authClient.request({
    url: "https://secretmanager.googleapis.com/v1/projects/andershaf-87/secrets/personal-analytics-privacy/versions/1:access",
  });
  const secret = Buffer.from(privacy.data.payload.data, "base64").toString(
    "utf8",
  );
  const reports = [];
  for (const source of [
    { id: "first-party", database: "personal-analytics", collection: "events" },
    {
      id: "fuse-games",
      database: "fuse-riders",
      collection: "fuse-production-telemetry-events",
    },
  ]) {
    const checkpoint = bucket.file(`checkpoints/${source.id}.json`);
    let previous = null,
      generation = 0;
    if ((await checkpoint.exists())[0]) {
      const [metadata] = await checkpoint.getMetadata();
      generation = metadata.generation;
      previous = JSON.parse((await checkpoint.download({ generation }))[0]);
    }
    const cutoff = Date.now() - 60000,
      runId = `${cutoff}-${Math.random().toString(36).slice(2, 10)}`,
      importedAt = new Date().toISOString();
    const db = new Firestore({
      projectId,
      databaseId: source.database,
      authClient,
    });
    let cursor = null,
      batch = 0,
      total = 0;
    try {
      while (true) {
        let query = db.collection(source.collection);
        if (previous)
          query = query
            .where("receivedAt", ">=", previous.through - 300000)
            .where("receivedAt", "<", cutoff)
            .orderBy("receivedAt")
            .orderBy(FieldPath.documentId());
        else query = query.orderBy(FieldPath.documentId());
        if (cursor) query = query.startAfter(cursor);
        const snapshot = await query.limit(1000).get();
        if (!snapshot.size) break;
        const eligible = snapshot.docs.filter((doc) =>
          !previous ? (doc.data().receivedAt ?? 0) < cutoff : true,
        );
        const raw = bucket.file(
          `first-party/${source.id}/${runId}/batch-${batch}.original.jsonl.gz`,
        );
        const rawRef = `gs://${bucket.name}/${raw.name}`;
        // A source validation failure fails this batch and leaves the checkpoint
        // unchanged. Never silently discard malformed retained source events.
        const rows = eligible.map((doc) => {
          const event = doc.data();
          if (
            typeof event.id !== "string" ||
            typeof event.name !== "string" ||
            typeof event.userId !== "string" ||
            typeof event.sessionId !== "string" ||
            !Number.isSafeInteger(event.occurredAt)
          )
            throw new Error(`Invalid ${source.id} event envelope`);
          return normalizeFirstParty(event, {
            source: source.id,
            secret,
            archiveRef: rawRef,
            importedAt,
          });
        });
        if (rows.length) {
          await pipeline(
            Readable.from(
              eligible.map((doc) => JSON.stringify(doc.data()) + "\n"),
            ),
            createGzip(),
            raw.createWriteStream({
              metadata: { contentType: "application/gzip" },
              preconditionOpts: { ifGenerationMatch: 0 },
            }),
          );
          const file = bucket.file(
            `first-party/${source.id}/${runId}/batch-${batch}.normalized.jsonl.gz`,
          );
          await pipeline(
            Readable.from(rows.map((row) => JSON.stringify(row) + "\n")),
            createGzip(),
            file.createWriteStream({
              metadata: { contentType: "application/gzip" },
              preconditionOpts: { ifGenerationMatch: 0 },
            }),
          );
          const [job] = await bq
            .dataset(WAREHOUSE_DATASET)
            .table("event_log")
            .createLoadJob(file, {
              location: WAREHOUSE_LOCATION,
              sourceFormat: "NEWLINE_DELIMITED_JSON",
              schema: { fields: EVENT_SCHEMA },
              writeDisposition: "WRITE_APPEND",
              maxBadRecords: 0,
            });
          await job.promise();
          const [metadata] = await job.getMetadata();
          if (
            metadata.status?.errorResult ||
            Number(metadata.statistics?.load?.outputRows) !== rows.length
          )
            throw new Error("Source sync load failed or count mismatch");
          total += rows.length;
        }
        cursor = snapshot.docs.at(-1);
        batch++;
        if (snapshot.size < 1000) break;
      }
    } finally {
      await db.terminate();
    }
    const report = {
      source: source.id,
      through: cutoff,
      completedAt: new Date().toISOString(),
      rows: total,
      batches: batch,
      initial: !previous,
    };
    await checkpoint.save(JSON.stringify(report), {
      contentType: "application/json",
      preconditionOpts: { ifGenerationMatch: generation },
    });
    reports.push(report);
    console.log(JSON.stringify(report));
  }
  return reports;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    let authClient;
    if (process.env.OPERATOR_TOKEN_STDIN === "1") {
      let token = "";
      for await (const chunk of process.stdin) token += chunk;
      authClient = new OAuth2Client();
      authClient.setCredentials({ access_token: token.trim() });
      token = "";
    } else
      authClient = await new GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      }).getClient();
    const bucket = new Storage({
      projectId: "andershaf-87",
      authClient,
    }).bucket(ARCHIVE_BUCKET);
    const result = await withLease(bucket, "source-sync", 70 * 60000, () =>
      syncSources({ authClient }),
    );
    if (result?.skipped) console.log(JSON.stringify(result));
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "analytics_job_failed",
        code: String(error?.code ?? "unknown"),
        reason: String(
          error?.errors?.[0]?.reason ?? error?.status ?? "job-failed",
        ),
      }),
    );
    process.exitCode = 1;
  }
}
