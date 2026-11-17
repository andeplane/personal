import { test } from "node:test";
import assert from "node:assert/strict";
import { FirestoreStore } from "../src/store.js";
import { validateBatch } from "../src/events.js";

class Database {
  documents = new Map();
  collection(name) {
    return { doc: (id) => `${name}/${id}` };
  }
  async getAll(...refs) {
    return refs.map((ref) => ({
      exists: this.documents.has(ref),
      data: () => this.documents.get(ref),
    }));
  }
  async runTransaction(operation) {
    const pending = new Map();
    await operation({
      getAll: (...refs) => this.getAll(...refs),
      create: (ref, value) => {
        assert.ok(!this.documents.has(ref));
        pending.set(ref, value);
      },
      set: (ref, value) => pending.set(ref, value),
    });
    for (const [key, value] of pending) this.documents.set(key, value);
  }
}
const now = Date.parse("2026-11-17T12:00:00Z"),
  secret = "a-long-durable-test-secret-more-than-32-chars";
const makeEvent = (id, user = "browser-one", session = "session-one") =>
  validateBatch(
    {
      v: 1,
      appId: "atomify",
      events: [
        {
          id,
          userId: user,
          sessionId: session,
          name: "Simulation.Start",
          occurredAt: now,
          properties: { iterations: 12 },
        },
      ],
    },
    { now, secret },
  )[0];

test("duplicate delivery and multiple events in a batch preserve exact daily/monthly uniques", async () => {
  const db = new Database(),
    store = new FirestoreStore(db);
  const events = [
    makeEvent("event-one"),
    makeEvent("event-two"),
    makeEvent("event-three", "browser-two", "session-two"),
  ];
  await store.ingest(events, "address", now);
  await store.ingest(events, "address", now + 1000);
  assert.equal(
    [...db.documents.keys()].filter((key) => key.startsWith("events/")).length,
    3,
  );
  for (const period of ["day_2026-11-17", "month_2026-11"]) {
    const summary = db.documents.get(`summaries/atomify_${period}`);
    assert.equal(summary.events, 3);
    assert.equal(summary.users, 2);
    assert.equal(summary.sessions, 2);
  }
  const activity = await store.activity("atomify", "2026-11-17", now);
  assert.deepEqual(activity, { dau: 2, mau: 2, monthlyAvailable: true });
  assert.equal(
    (await store.activity("atomify", "2026-11-16", now)).monthlyAvailable,
    false,
  );
  assert.equal(
    (
      await store.activity(
        "atomify",
        "2026-11-17",
        Date.parse("2026-11-17T23:59:00Z"),
      )
    ).monthlyAvailable,
    false,
  );
  assert.equal(
    (
      await store.activity(
        "atomify",
        "2026-11-30",
        Date.parse("2026-11-30T23:59:00Z"),
      )
    ).monthlyAvailable,
    true,
  );
});

test("reused event id with changed content is rejected before committing quotas or aggregates", async () => {
  const db = new Database(),
    store = new FirestoreStore(db),
    event = makeEvent("event-one");
  await store.ingest([event], "address", now);
  const before = JSON.stringify([...db.documents]);
  await assert.rejects(
    store.ingest([{ ...event, name: "Changed" }], "address", now),
    { status: 409 },
  );
  assert.equal(JSON.stringify([...db.documents]), before);
});

test("durable request budgets also charge repeated events", async () => {
  const db = new Database(),
    store = new FirestoreStore(db),
    event = makeEvent("event-one");
  for (let i = 0; i < 200; i++) await store.ingest([event], "address", now);
  await assert.rejects(store.ingest([event], "address", now), { status: 429 });
  assert.equal(db.documents.get("summaries/atomify_day_2026-11-17").events, 1);
});
