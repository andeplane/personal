import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { analyze, activeSummary } from "../src/analysis.js";
import {
  DAY,
  dateRange,
  requireOwner,
  scrubProperties,
  validateBatch,
} from "../src/events.js";
import { createAnalyticsServer } from "../src/http.js";

const now = Date.parse("2026-11-17T12:00:00Z");
const secret = "test-secret-with-more-than-thirty-two-characters";
const range = {
  from: "2026-11-01",
  to: "2026-11-17",
  start: Date.parse("2026-11-01"),
  end: Date.parse("2026-11-18"),
};
const owner = {
  email: "andershaf@gmail.com",
  email_verified: true,
  uid: "owner",
  firebase: { sign_in_provider: "google.com" },
};
const event = (
  id,
  day,
  name = "Open",
  userId = "browser1",
  appId = "atomify",
) => ({
  id,
  appId,
  userId,
  sessionId: `session-${day}`,
  occurredAt: Date.parse(`2026-11-${String(day).padStart(2, "0")}T10:00:00Z`),
  name,
  properties: { feature: "editor" },
});

test("owner access requires verified exact email and Google provider", () => {
  assert.equal(requireOwner(owner).email, owner.email);
  for (const claims of [
    null,
    { ...owner, email: "other@gmail.com" },
    { ...owner, email_verified: false },
    { ...owner, firebase: { sign_in_provider: "password" } },
  ])
    assert.throws(() => requireOwner(claims), { status: 403 });
});

test("ingestion validates an entire batch, pseudonymizes app-scoped identity and scrubs secrets", () => {
  const body = {
    v: 1,
    appId: "atomify",
    events: [
      {
        id: "event-1234",
        userId: "browser-1234",
        sessionId: "session-1234",
        name: "Simulation.Start",
        occurredAt: now,
        properties: {
          email: "private@example.com",
          roomCode: "12345",
          url: "https://example.com",
          prompt: "private content",
          feature: "editor",
          bad: "someone@example.com",
          object: { secret: "abc" },
          iterations: 100,
        },
      },
    ],
  };
  const [normalized] = validateBatch(body, { now, secret });
  assert.notEqual(normalized.userId, body.events[0].userId);
  assert.equal(normalized.userId.length, 32);
  assert.deepEqual(normalized.properties, {
    feature: "editor",
    iterations: 100,
  });
  assert.notEqual(
    validateBatch({ ...body, appId: "homepage" }, { now, secret })[0].userId,
    normalized.userId,
  );
  for (const change of [
    { events: [] },
    { appId: "unknown" },
    { events: [body.events[0], body.events[0]] },
    { events: [{ ...body.events[0], occurredAt: now - 8 * DAY }] },
  ])
    assert.throws(
      () => validateBatch({ ...body, ...change }, { now, secret }),
      { status: 400 },
    );
  assert.deepEqual(
    scrubProperties({
      a: Infinity,
      b: ["x"],
      c: "\nsecret",
      filename: "private",
      valid: true,
    }),
    { valid: true },
  );
});

test("calendar dates, inclusive end and bounded window are validated", () => {
  const result = dateRange(
    new URLSearchParams("from=2026-11-01&to=2026-11-17"),
    now,
  );
  assert.equal(result.end, range.end);
  for (const value of [
    "from=2026-02-30",
    "from=2026-01-01",
    "from=2026-11-18&to=2026-11-17",
    "to=2027-01-01",
  ])
    assert.throws(() => dateRange(new URLSearchParams(value), now), {
      status: 400,
    });
});

test("DAU and calendar-month MAU use independent full scopes and never sum daily uniques", () => {
  const selectedRange = {
    ...range,
    from: "2026-11-11",
    start: Date.parse("2026-11-11"),
  };
  const early = event("1", 1, "Open", "early-user"),
    recent = event("2", 17);
  const result = activeSummary({
    selected: { events: [recent], complete: true },
    month: { events: [early, recent, event("3", 16)], complete: true },
    range: selectedRange,
  });
  assert.equal(result.dau, 1);
  assert.equal(result.mau, 2);
  const partial = activeSummary({
    selected: { events: [recent], complete: true },
    month: { events: [recent], complete: false },
    range: selectedRange,
  });
  assert.equal(partial.dau, 1);
  assert.equal(partial.mau, null);
});

test("uniques use app-scoped identities; session count is not summed daily", () => {
  const events = [
    event("1", 1),
    event("2", 2),
    event("3", 2, "Open", "browser1", "homepage"),
  ];
  events[1].sessionId = events[0].sessionId;
  const result = analyze(events, { range, complete: true, now });
  assert.deepEqual(result.summary, {
    events: 3,
    users: 2,
    sessions: 2,
    activeDays: 2,
  });
  assert.equal(result.days[1].users, 2);
  assert.equal(
    analyze(events, {
      range,
      complete: true,
      appId: "atomify",
      property: "feature",
      value: "editor",
      now,
    }).summary.events,
    2,
  );
});

test("incomplete reads withhold counts, charts, retention and funnels", () => {
  const result = analyze([event("1", 1)], {
    range,
    complete: false,
    funnel: ["Open"],
    now,
  });
  for (const key of [
    "summary",
    "days",
    "groups",
    "apps",
    "retention",
    "funnel",
    "selectedCount",
  ])
    assert.equal(result[key], null);
  assert.equal(result.events.length, 1);
  assert.equal(result.complete, false);
});

test("return cohorts exclude immature followup; first-seen is explicitly window scoped", () => {
  const events = [
    event("1", 1),
    event("2", 2),
    event("3", 8),
    event("4", 17, "Open", "new-browser"),
  ];
  const result = analyze(events, { range, complete: true, now });
  assert.deepEqual(result.retention[0], {
    day: 1,
    eligible: 1,
    returned: 1,
    rate: 1,
  });
  assert.deepEqual(result.retention[1], {
    day: 7,
    eligible: 1,
    returned: 1,
    rate: 1,
  });
  assert.equal(result.retention[2].rate, null);
});

test("funnel is ordered, app scoped and cannot count a completion before its start", () => {
  const events = [
    event("1", 1, "Finish"),
    event("2", 2, "Start"),
    event("3", 3, "Finish"),
    event("4", 2, "Start", "browser1", "homepage"),
    event("5", 1, "Start", "slow"),
    event("6", 10, "Finish", "slow"),
  ];
  const result = analyze(events, {
    range,
    complete: true,
    funnel: ["Start", "Finish"],
    now,
  });
  assert.deepEqual(
    result.funnel.map((s) => s.users),
    [3, 1],
  );
});

test("HTTP boundary protects every read, handles CORS, validates bodies and acknowledges ingestion", async (t) => {
  let reads = 0;
  const ingested = [];
  const store = {
    query: async () => {
      reads++;
      return { events: [], complete: true };
    },
    session: async () => ({ events: [], complete: true }),
    ready: async () => {},
    ingest: async (events) => {
      ingested.push(...events);
      return { accepted: events.map((e) => e.clientId) };
    },
  };
  const server = createAnalyticsServer({
    store,
    secret,
    clock: () => now,
    origins: new Set(["https://andeplane.github.io"]),
    firebaseConfig: {},
    verifyToken: async (token) => {
      if (token === "bad-token-with-enough-length") throw new Error("bad");
      return token === "other-user-token-long-enough"
        ? { ...owner, email: "other@gmail.com" }
        : owner;
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, options) => fetch(base + path, options);
  for (const path of [
    "/v1/apps",
    "/v1/query",
    "/v1/session",
    "/readyz",
    "/v1/me",
  ])
    assert.equal((await request(path)).status, 401);
  assert.equal(reads, 0);
  assert.equal(
    (
      await request("/v1/query", {
        headers: { Authorization: "Bearer other-user-token-long-enough" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/v1/query", {
        headers: { Authorization: "Bearer bad-token-with-enough-length" },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request("/v1/config", {
        headers: { Origin: "https://evil.example" },
      })
    ).status,
    403,
  );
  const preflight = await request("/v1/events", {
    method: "OPTIONS",
    headers: { Origin: "https://andeplane.github.io" },
  });
  assert.equal(preflight.status, 204);
  assert.equal(
    preflight.headers.get("access-control-allow-origin"),
    "https://andeplane.github.io",
  );
  const auth = { Authorization: "Bearer owner-token-with-enough-length" };
  assert.equal(
    (
      await request("/v1/query?from=2026-11-01&to=2026-11-17", {
        headers: auth,
      })
    ).status,
    200,
  );
  assert.equal(reads, 1);
  assert.equal(
    (await request("/v1/query?appId=atomify&appId=homepage", { headers: auth }))
      .status,
    400,
  );
  assert.equal(
    (await request("/v1/events", { method: "POST", body: "{}" })).status,
    415,
  );
  const body = {
    v: 1,
    appId: "atomify",
    events: [
      {
        id: "event-1234",
        userId: "browser-1234",
        sessionId: "session-1234",
        name: "Simulation.Start",
        occurredAt: now,
      },
    ],
  };
  const accepted = await request("/v1/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.deepEqual(await accepted.json(), { accepted: ["event-1234"] });
  assert.equal(ingested.length, 1);
});
