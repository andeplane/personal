import { digest, pseudonym, scrubProperties } from "./events.js";
import { historyTime } from "./history-time.js";

// Kept apart from the public seven-day live-ingest validator. Imports retain
// their original age and never receive an event-age TTL.
export function classifyEvent(name, properties, project) {
  const prefixes = [
    ["Homepage.", "homepage"],
    ["ParticleDefence.", "particle-defence"],
    ["TeslaCode.", "teslacode-legacy"],
    ["fuse.", "fuse-games"],
    ["FuseRiders.", "fuse-games"],
    ["Fuse Riders.", "fuse-games"],
  ];
  for (const [prefix, app] of prefixes) if (name.startsWith(prefix)) return app;
  if (
    /^(Simulation[.A-Z]|Settings\.|Project\.|Run\.|QuickRun\.|Sweep\.|WASM\.|Modifier\.|UIUpdateFrequency\.|Examples\.|Example\.|Notebook\.|InputScript\.|File\.|Tour\.|Theme\.)/.test(
      name,
    )
  )
    return "atomify";
  if (
    [
      "llm_call",
      "tool_call",
      "tool_error",
      "llm_error",
      "chat_message",
      "file_upload",
      "example_click",
      "new_conversation",
      "remove_dataframe",
    ].includes(name)
  )
    return "ai-data-analytics";
  const rawUrl = properties.$current_url ?? properties.url;
  if (typeof rawUrl === "string") {
    try {
      const url = new URL(rawUrl);
      if (url.hostname.endsWith("teslacode.dev")) return "teslacode-legacy";
      if (url.pathname.startsWith("/atomify")) return "atomify";
      if (url.pathname.includes("particle-defence")) return "particle-defence";
      if (
        url.hostname === "atomify.org" ||
        url.hostname.endsWith(".atomify.org")
      )
        return "atomify";
    } catch {}
  }
  return project.defaultAppId ?? "unassigned";
}

const numericMetrics =
  /^(?:input_?tokens|output_?tokens|total_?tokens(?:sofar)?|time_to_first_token_ms)$/i;
export function historyProperties(properties) {
  const custom = Object.fromEntries(
    Object.entries(properties).filter(
      ([key]) =>
        ![
          "distinct_id",
          "$distinct_id",
          "$device_id",
          "$user_id",
          "$insert_id",
          "time",
          "token",
        ].includes(key),
    ),
  );
  // Prefer product metrics over transport/device metadata when bounding keys.
  const ordered = Object.fromEntries(
    Object.entries(custom).sort(
      ([a], [b]) => Number(a.startsWith("$")) - Number(b.startsWith("$")),
    ),
  );
  const safe = scrubProperties(ordered);
  for (const [key, value] of Object.entries(custom))
    if (
      numericMetrics.test(key) &&
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0
    )
      safe[key] = value;
  const duration =
    properties.durationSeconds ??
    properties.wallSeconds ??
    properties.$duration;
  if (
    typeof duration === "number" &&
    Number.isFinite(duration) &&
    duration >= 0
  )
    safe.durationSeconds = duration;
  for (const key of ["numAtoms", "timesteps", "timestepsPerSecond"]) {
    const value = properties[key];
    if (
      (typeof value === "number" ||
        (typeof value === "string" && /^\d+(\.\d+)?$/.test(value))) &&
      Number.isFinite(Number(value))
    )
      safe[key] = Number(value);
  }
  return safe;
}

export function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  return (
    "{" +
    Object.keys(value)
      .sort()
      .map((key) => JSON.stringify(key) + ":" + stableJson(value[key]))
      .join(",") +
    "}"
  );
}

export function normalizeMixpanel(
  row,
  { project, secret, archiveRef, importedAt, occurrence = 0, convertTime },
) {
  if (
    !row ||
    typeof row.event !== "string" ||
    !row.event ||
    !row.properties ||
    typeof row.properties !== "object"
  )
    throw new Error("Invalid Mixpanel event envelope");
  const props = row.properties,
    rawTime = props.time;
  if (typeof rawTime !== "number" || !Number.isFinite(rawTime))
    throw new Error("Missing Mixpanel event timestamp");
  const time = rawTime < 100_000_000_000 ? rawTime * 1000 : rawTime;
  const resolved = convertTime
    ? { time: convertTime(time, project), ambiguous: false }
    : historyTime(time, project);
  const occurredAt = resolved.time;
  if (
    !Number.isSafeInteger(occurredAt) ||
    occurredAt < 0 ||
    occurredAt > Date.now() + 86_400_000
  )
    throw new Error("Invalid normalized timestamp");
  const name = row.event,
    appId = classifyEvent(name, props, project);
  const distinct =
    props.distinct_id ??
    props.$distinct_id ??
    props.$user_id ??
    props.$device_id;
  const identity =
    distinct === undefined || distinct === null ? null : String(distinct);
  const insertId =
    props.$insert_id === undefined ? null : String(props.$insert_id);
  const key =
    insertId === null
      ? ["mixpanel", String(project.id), stableJson(row), occurrence]
      : ["mixpanel", String(project.id), name, identity, rawTime, insertId];
  const session = props.sessionId ?? props.session_id ?? props.$session_id;
  const timestamp = new Date(occurredAt).toISOString();
  return {
    id: digest(JSON.stringify(key)),
    app_id: appId,
    event_date: timestamp.slice(0, 10),
    name,
    occurred_at: timestamp,
    received_at: null,
    user_id: identity === null ? null : pseudonym(secret, appId, identity),
    reported_session_id:
      session === undefined || session === null
        ? null
        : pseudonym(secret, appId, String(session)),
    source: "mixpanel",
    source_project: String(project.id),
    source_insert_id: insertId,
    source_time_zone: project.legacyLocalTime ? project.timezone : "UTC",
    timestamp_ambiguous: resolved.ambiguous,
    properties: historyProperties(props),
    archive_ref: archiveRef,
    imported_at: importedAt,
    schema_version: 1,
  };
}

export function normalizeFirstParty(
  event,
  { source, archiveRef, importedAt, secret },
) {
  const fuse = source === "fuse-games";
  const appId = fuse ? "fuse-games" : event.appId;
  const timestamp = new Date(event.occurredAt).toISOString();
  return {
    id: fuse ? digest(`fuse-games\0${event.id}`) : event.id,
    app_id: appId,
    event_date: timestamp.slice(0, 10),
    name: event.name,
    occurred_at: timestamp,
    received_at: new Date(event.receivedAt ?? event.occurredAt).toISOString(),
    user_id: fuse ? pseudonym(secret, appId, event.userId) : event.userId,
    reported_session_id: fuse
      ? pseudonym(secret, appId, event.sessionId)
      : event.sessionId,
    source: fuse ? "fuse-first-party" : "first-party",
    source_project: "andershaf-87",
    source_insert_id: null,
    properties: historyProperties({
      ...event.properties,
      ...(fuse ? { gameId: event.gameId } : {}),
    }),
    archive_ref: archiveRef,
    imported_at: importedAt,
    schema_version: 1,
  };
}
