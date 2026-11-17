import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeMixpanel,
  normalizeFirstParty,
  classifyEvent,
  historyProperties,
} from "../src/history-normalize.js";
const options = {
  project: { id: 2817655, defaultAppId: "unassigned" },
  secret: "test-history-privacy-secret-long-enough",
  archiveRef: "gs://private/fixture.jsonl.gz",
  importedAt: "2026-11-17T15:00:00Z",
};
const row = {
  event: "Simulation.Stop",
  properties: {
    time: 1700000000,
    distinct_id: "browser-uuid",
    $insert_id: "source-id",
    $duration: 12.4,
    numAtoms: 1000,
    timesteps: 200,
    timestepsPerSecond: "16.129",
    email: "private@example.com",
    token: "credential",
    prompt: "private content",
  },
};
test("history preserves old event age, source provenance, canonical identity and Atomify performance", () => {
  const event = normalizeMixpanel(row, options);
  assert.equal(event.app_id, "atomify");
  assert.equal(event.occurred_at, "2023-11-14T22:13:20.000Z");
  assert.equal(event.event_date, "2023-11-14");
  assert.equal(event.name, row.event);
  assert.equal(event.properties.durationSeconds, 12.4);
  assert.equal(event.properties.timestepsPerSecond, 16.129);
  assert.equal(event.properties.numAtoms, 1000);
  assert.equal(event.source_project, "2817655");
  assert.equal(event.archive_ref, options.archiveRef);
  assert.equal(event.user_id.length, 32);
  assert.equal("cleanupAt" in event, false);
  assert.equal(event.properties.email, undefined);
  assert.equal(event.properties.token, undefined);
  assert.equal(event.properties.prompt, undefined);
  assert.equal(
    normalizeMixpanel(
      { ...row, properties: { ...row.properties, numAtoms: 2000 } },
      options,
    ).id,
    event.id,
  );
});
test("shared-project prefixes and source URLs classify apps; unknown events remain retained", () => {
  for (const [name, app] of [
    ["Homepage.Page Viewed", "homepage"],
    ["ParticleDefence.Game.Started", "particle-defence"],
    ["TeslaCode.Page.Loaded", "teslacode-legacy"],
    ["fuse.Round Started", "fuse-games"],
    ["tool_call", "ai-data-analytics"],
  ])
    assert.equal(classifyEvent(name, {}, options.project), app);
  assert.equal(
    classifyEvent(
      "Page.Load",
      { $current_url: "https://andeplane.github.io/atomify/" },
      options.project,
    ),
    "atomify",
  );
  assert.equal(
    normalizeMixpanel({ ...row, event: "Unknown.New.Event" }, options).app_id,
    "unassigned",
  );
});
test("events without insert IDs preserve occurrence multiplicity and unknown identity stays unknown", () => {
  const props = { ...row.properties };
  delete props.$insert_id;
  delete props.distinct_id;
  const first = normalizeMixpanel(
    { ...row, properties: props },
    { ...options, occurrence: 0 },
  );
  const second = normalizeMixpanel(
    { ...row, properties: props },
    { ...options, occurrence: 1 },
  );
  assert.notEqual(first.id, second.id);
  assert.equal(first.user_id, null);
  assert.equal(first.reported_session_id, null);
});
test("numeric token usage is retained while free-text and credential fields are excluded", () => {
  assert.deepEqual(
    historyProperties({
      input_tokens: 23,
      output_tokens: 12,
      total_tokens: 35,
      access_token: "secret",
      generated_code: "print(private)",
      time_to_first_token_ms: 40,
    }),
    {
      input_tokens: 23,
      output_tokens: 12,
      total_tokens: 35,
      time_to_first_token_ms: 40,
    },
  );
});
test("first-party warehouse rows use the existing event and pseudonym IDs", () => {
  const event = {
    id: "event-existing",
    appId: "atomify",
    userId: "already-pseudonymous-user",
    sessionId: "already-pseudonymous-session",
    name: "Simulation.Start",
    occurredAt: 1700000000000,
    properties: { feature: "examples" },
  };
  const mapped = normalizeFirstParty(event, {
    ...options,
    source: "first-party",
  });
  assert.equal(mapped.id, event.id);
  assert.equal(mapped.user_id, event.userId);
  assert.equal(mapped.reported_session_id, event.sessionId);
  const fuse = normalizeFirstParty(
    { ...event, gameId: "fusemania" },
    { ...options, source: "fuse-games" },
  );
  assert.equal(fuse.app_id, "fuse-games");
  assert.equal(fuse.properties.gameId, "fusemania");
  assert.notEqual(fuse.user_id, event.userId);
});
