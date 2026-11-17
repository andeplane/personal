import { test } from "node:test";
import assert from "node:assert/strict";
import { FuseSource } from "../src/fuse-source.js";
import { digest } from "../src/events.js";

test("read-only Fuse bridge normalizes identities, drops expired rows and deduplicates dual delivery", async () => {
  const now = Date.now(),
    row = {
      id: "source-event",
      userId: "anonymous-browser",
      sessionId: "anonymous-session",
      name: "fuse.Round Started",
      gameId: "fusemania",
      occurredAt: now,
      receivedAt: now,
      expiresAt: now + 1000,
      properties: { played: true, email: "private@example.com" },
    };
  const calls = [];
  const query = {
    where() {
      return this;
    },
    orderBy() {
      return this;
    },
    limit() {
      return this;
    },
    async get() {
      return {
        size: 2,
        docs: [
          { data: () => row },
          { data: () => ({ ...row, id: "expired", expiresAt: now - 1 }) },
        ],
      };
    },
  };
  const db = {
    collection(name) {
      calls.push(name);
      return query;
    },
  };
  const primary = {
    query: async () => ({
      complete: true,
      events: [
        {
          appId: "fuse-games",
          id: digest("fuse-games\0source-event"),
          occurredAt: now,
        },
      ],
    }),
    activity: async () => ({ dau: 2 }),
  };
  const source = new FuseSource({
    db,
    primary,
    secret: "a-test-secret-with-more-than-32-characters",
    clock: () => now,
  });
  const mapped = await source.sourceQuery({
    start: now - 1000,
    end: now + 1000,
  });
  assert.equal(mapped.events.length, 1);
  assert.notEqual(mapped.events[0].userId, row.userId);
  assert.deepEqual(mapped.events[0].properties, {
    played: true,
    gameId: "fusemania",
  });
  const combined = await source.query({ start: now - 1000, end: now + 1000 });
  assert.equal(combined.events.length, 1);
  assert.ok(calls.every((name) => name === "fuse-production-telemetry-events"));
  assert.equal(await source.activity("", "2026-11-17", now), null);
  assert.deepEqual(await source.activity("atomify", "2026-11-17", now), {
    dau: 2,
  });
});
