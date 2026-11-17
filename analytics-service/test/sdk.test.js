import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createAnalytics } from "../../stats/sdk/analytics.js";

function browser({
  dnt = false,
  storageBlocked = false,
  hostname = "example.com",
  fail = false,
} = {}) {
  const storage = new Map(),
    requests = [],
    timers = new Map();
  let timer = 0;
  const environment = {
    crypto: { randomUUID },
    location: { hostname },
    navigator: { doNotTrack: dnt ? "1" : "0" },
    localStorage: {
      getItem(key) {
        if (storageBlocked) throw new Error("blocked");
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        if (storageBlocked) throw new Error("blocked");
        storage.set(key, value);
      },
    },
    setTimeout(callback) {
      timers.set(++timer, callback);
      return timer;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    async fetch(url, options) {
      const batch = JSON.parse(options.body);
      requests.push(batch);
      return {
        ok: !fail,
        json: async () => ({ accepted: batch.events.map((e) => e.id) }),
      };
    },
  };
  return { environment, storage, requests, timers };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("SDK acknowledges only delivery receipts and retries preserve the same event identity", async () => {
  const fake = browser({ fail: true });
  const client = createAnalytics({
    appId: "atomify",
    endpoint: "https://analytics.example.com",
    environment: fake.environment,
  });
  await settle();
  await client.track("Simulation.Start", {
    iterations: 200,
    email: "private@example.com",
    generated_code: "private",
    roomCode: "ABCDEF",
  });
  await settle();
  assert.equal(fake.requests.length, 1);
  assert.deepEqual(fake.requests[0].events[0].properties, { iterations: 200 });
  assert.equal(
    JSON.parse(fake.storage.get("personal.analytics.atomify")).events.length,
    1,
  );
  const firstId = fake.requests[0].events[0].id;
  fake.environment.fetch = async (url, options) => {
    const batch = JSON.parse(options.body);
    fake.requests.push(batch);
    return {
      ok: true,
      json: async () => ({ accepted: batch.events.map((e) => e.id) }),
    };
  };
  await client.flush();
  await settle();
  assert.equal(fake.requests[1].events[0].id, firstId);
  assert.equal(
    JSON.parse(fake.storage.get("personal.analytics.atomify")).events.length,
    0,
  );
  client.destroy();
});

test("SDK respects Do Not Track, local development and opt-out without creating identities", async () => {
  for (const config of [{ dnt: true }, { hostname: "localhost" }]) {
    const fake = browser(config),
      client = createAnalytics({
        appId: "atomify",
        endpoint: "https://analytics.example.com",
        environment: fake.environment,
      });
    await settle();
    await client.track("Open");
    await settle();
    assert.equal(fake.requests.length, 0);
    assert.equal(
      JSON.parse(fake.storage.get("personal.analytics.atomify")).userId,
      undefined,
    );
    client.destroy();
  }
  const fake = browser({ storageBlocked: true }),
    client = createAnalytics({
      appId: "atomify",
      endpoint: "https://analytics.example.com",
      environment: fake.environment,
    });
  await settle();
  await client.setOptOut(true);
  await client.track("Open");
  await client.flush();
  assert.equal(fake.requests.length, 0);
  client.destroy();
});

test("SDK bounds an offline outbox and starts a new session after inactivity", async () => {
  const fake = browser({ fail: true }),
    client = createAnalytics({
      appId: "atomify",
      endpoint: "https://analytics.example.com",
      environment: fake.environment,
    });
  await settle();
  await client.track("Open");
  await settle();
  const first = JSON.parse(fake.storage.get("personal.analytics.atomify"));
  first.activeAt = Date.now() - 31 * 60_000;
  fake.storage.set("personal.analytics.atomify", JSON.stringify(first));
  await client.track("Next");
  await settle();
  const next = JSON.parse(fake.storage.get("personal.analytics.atomify"));
  assert.notEqual(first.sessionId, next.sessionId);
  assert.equal(first.userId, next.userId);
  for (let i = 0; i < 210; i++) await client.track("Offline");
  assert.equal(
    JSON.parse(fake.storage.get("personal.analytics.atomify")).events.length,
    200,
  );
  client.destroy();
});
