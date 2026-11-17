import { createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip, createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { BigQuery } from "@google-cloud/bigquery";
import { Storage } from "@google-cloud/storage";
import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { normalizeMixpanel, stableJson } from "./history-normalize.js";
import { monthlyWindows } from "./history-time.js";
import { digest } from "./events.js";
import {
  ARCHIVE_BUCKET,
  WAREHOUSE_DATASET,
  WAREHOUSE_LOCATION,
  EVENT_SCHEMA,
} from "./warehouse-schema.js";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function exportResponse(
  project,
  credential,
  window,
  request = fetch,
) {
  const hosts = {
    us: "data.mixpanel.com",
    eu: "data-eu.mixpanel.com",
    in: "data-in.mixpanel.com",
  };
  if (!hosts[project.region] || !/^\d+$/.test(String(project.id)))
    throw new Error("Invalid project/region");
  const url = new URL(`https://${hosts[project.region]}/api/2.0/export`);
  for (const [key, value] of Object.entries({
    project_id: project.id,
    from_date: window.from,
    to_date: window.to,
    time_in_ms: "true",
  }))
    url.searchParams.set(key, value);
  // No event filter and no limit: the archive includes every retained event.
  const basic = Buffer.from(
    `${credential.username}:${credential.secret}`,
  ).toString("base64");
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await request(url, {
      headers: { Authorization: `Basic ${basic}`, Accept: "text/plain" },
      signal: AbortSignal.timeout(1800000),
    });
    if (response.ok) return response;
    await response.body?.cancel();
    if (response.status !== 429 && response.status < 500)
      throw new Error(`Mixpanel export HTTP ${response.status}`);
    if (attempt === 4)
      throw new Error(`Mixpanel export unavailable HTTP ${response.status}`);
    await pause(
      Math.max(65000, Number(response.headers.get("retry-after") ?? 0) * 1000),
    );
  }
}

export async function importWindow({
  project,
  credential,
  window,
  bucket,
  bq,
  secret,
  request = fetch,
}) {
  const prefix = `mixpanel/${project.id}/${window.from}_${window.to}`;
  const raw = bucket.file(`${prefix}/raw.jsonl.gz`),
    rawRef = `gs://${bucket.name}/${raw.name}`;
  const manifest = bucket.file(`${prefix}/manifest.json`);
  if ((await manifest.exists())[0]) {
    const prior = JSON.parse((await manifest.download())[0]);
    if (prior.state === "loaded" && prior.schemaVersion === 1)
      return { ...prior, resumed: true };
  }
  if (!(await raw.exists())[0]) {
    const response = await exportResponse(project, credential, window, request);
    const hash = createHash("sha256");
    let bytes = 0;
    const hashing = new Transform({
      transform(chunk, encoding, callback) {
        hash.update(chunk);
        bytes += chunk.length;
        callback(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(response.body),
      hashing,
      createGzip(),
      raw.createWriteStream({
        resumable: true,
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: { contentType: "application/gzip" },
      }),
    );
    await raw.setMetadata({
      metadata: {
        sha256: hash.digest("hex"),
        uncompressedBytes: String(bytes),
        projectId: String(project.id),
        from: window.from,
        to: window.to,
      },
    });
  }
  const [rawMetadata] = await raw.getMetadata();
  const importedAt = new Date().toISOString();
  // Each normalization attempt gets its own immutable object. Failed loads do
  // not leave a success checkpoint; BigQuery's stable load-job ID makes retry safe.
  const normalized = bucket.file(
    `${prefix}/normalized-v1-${digest(rawMetadata.generation).slice(0, 16)}.jsonl.gz`,
  );
  const occurrences = new Map();
  let rawCount = 0,
    normalizedCount = 0,
    rejectedCount = 0,
    ambiguousCount = 0;
  const errors = [];
  async function* rows() {
    const input = raw.createReadStream().pipe(createGunzip());
    const lines = createInterface({ input, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (!line.trim()) continue;
        rawCount++;
        try {
          const row = JSON.parse(line);
          let occurrence = 0;
          if (row.properties?.$insert_id === undefined) {
            const key = digest(stableJson(row));
            occurrence = occurrences.get(key) ?? 0;
            occurrences.set(key, occurrence + 1);
          }
          const event = normalizeMixpanel(row, {
            project,
            secret,
            archiveRef: rawRef,
            importedAt,
            occurrence,
          });
          normalizedCount++;
          if (event.timestamp_ambiguous) ambiguousCount++;
          yield JSON.stringify(event) + "\n";
        } catch (error) {
          rejectedCount++;
          if (errors.length < 10)
            errors.push({
              line: rawCount,
              reason:
                error instanceof SyntaxError
                  ? "Invalid JSON"
                  : String(error.message).slice(0, 160),
            });
        }
      }
    } finally {
      input.destroy();
      lines.close();
    }
  }
  // Regenerate from the original private archive on retries, without a new
  // Mixpanel query. This is a derived file; GCS versioning preserves revisions.
  await pipeline(
    Readable.from(rows()),
    createGzip(),
    normalized.createWriteStream({
      resumable: true,
      metadata: { contentType: "application/gzip" },
    }),
  );
  const result = {
    schemaVersion: 1,
    state: "archived",
    projectId: String(project.id),
    ...window,
    rawRef,
    rawGeneration: rawMetadata.generation,
    rawSha256: rawMetadata.metadata?.sha256 ?? null,
    rawCount,
    normalizedCount,
    rejectedCount,
    ambiguousCount,
    timezone: project.legacyLocalTime ? project.timezone : "UTC",
    completedAt: importedAt,
    errors,
  };
  if (rejectedCount) {
    result.state = "needs-attention";
    await manifest.save(JSON.stringify(result, null, 2), {
      contentType: "application/json",
    });
    throw new Error(
      `Project ${project.id} ${window.from}: ${rejectedCount} rejected rows; original archive retained`,
    );
  }
  if (normalizedCount) {
    const jobId = `mixpanel_${project.id}_${window.from.replaceAll("-", "")}_${window.to.replaceAll("-", "")}_${digest(rawMetadata.generation).slice(0, 16)}_v1`;
    const table = bq.dataset(WAREHOUSE_DATASET).table("event_log");
    let job;
    try {
      [job] = await table.createLoadJob(normalized, {
        jobId,
        location: WAREHOUSE_LOCATION,
        sourceFormat: "NEWLINE_DELIMITED_JSON",
        schema: EVENT_SCHEMA,
        writeDisposition: "WRITE_APPEND",
        maxBadRecords: 0,
        ignoreUnknownValues: false,
      });
    } catch (error) {
      if (error.code !== 409) throw error;
      job = bq.job(jobId, { location: WAREHOUSE_LOCATION });
    }
    const [metadata] = await job.getMetadata();
    if (metadata.status?.state !== "DONE") await job.promise();
    const [done] = await job.getMetadata();
    if (done.status?.errorResult)
      throw new Error(
        `BigQuery load failed: ${done.status.errorResult.reason}`,
      );
    if (Number(done.statistics?.load?.outputRows) !== normalizedCount)
      throw new Error("BigQuery output count differs from normalized count");
    result.loadJob = jobId;
    result.loadedCount = normalizedCount;
  } else result.loadedCount = 0;
  result.state = "loaded";
  await manifest.save(JSON.stringify(result, null, 2), {
    contentType: "application/json",
  });
  return result;
}

export async function runImport({
  authClient,
  manifestPath = process.env.IMPORT_MANIFEST,
}) {
  if (!manifestPath?.startsWith(`gs://${ARCHIVE_BUCKET}/config/`))
    throw new Error("Private import manifest required");
  const projectId = "andershaf-87";
  const storage = new Storage({ projectId, authClient }),
    bucket = storage.bucket(ARCHIVE_BUCKET);
  const bq = new BigQuery({
    projectId,
    authClient,
    location: WAREHOUSE_LOCATION,
  });
  const config = JSON.parse(
    (
      await bucket
        .file(manifestPath.slice(`gs://${ARCHIVE_BUCKET}/`.length))
        .download()
    )[0],
  );
  const readSecret = async (resource) => {
    if (
      !/^projects\/andershaf-87\/secrets\/personal-analytics-[a-z0-9-]+\/versions\/(?:\d+|latest)$/.test(
        resource,
      )
    )
      throw new Error("Invalid credential reference");
    const response = await authClient.request({
      url: `https://secretmanager.googleapis.com/v1/${resource}:access`,
    });
    return Buffer.from(response.data.payload.data, "base64").toString("utf8");
  };
  const secret = await readSecret(
    "projects/andershaf-87/secrets/personal-analytics-privacy/versions/1",
  );
  const credentials = new Map(),
    results = [];
  for (const project of config.projects) {
    if (!credentials.has(project.credentialSecret))
      credentials.set(
        project.credentialSecret,
        JSON.parse(await readSecret(project.credentialSecret)),
      );
    let lastRequest = 0;
    for (const window of monthlyWindows(project.from, project.to)) {
      // Strictly below the shared 60-query/hour project ceiling. Resume skips
      // completed monthly manifests; credentials/raw rows never enter logs.
      if (lastRequest)
        await pause(Math.max(0, 65000 - (Date.now() - lastRequest)));
      lastRequest = Date.now();
      const result = await importWindow({
        project,
        credential: credentials.get(project.credentialSecret),
        window,
        bucket,
        bq,
        secret,
      });
      results.push(result);
      console.log(
        JSON.stringify({
          projectId: result.projectId,
          from: result.from,
          to: result.to,
          state: result.state,
          rawCount: result.rawCount,
          loadedCount: result.loadedCount,
          resumed: result.resumed ?? false,
        }),
      );
    }
  }
  await bucket
    .file("reports/latest-import.json")
    .save(
      JSON.stringify(
        { completedAt: new Date().toISOString(), results },
        null,
        2,
      ),
      { contentType: "application/json" },
    );
  return results;
}
if (import.meta.url === `file://${process.argv[1]}`) {
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
  await runImport({ authClient });
}
