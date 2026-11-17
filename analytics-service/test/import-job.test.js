import test from "node:test";
import assert from "node:assert/strict";
import { exportResponse } from "../src/import-job.js";
test("full historical export uses regional endpoint and service account, without event or row limits", async () => {
  let seen;
  const response = await exportResponse(
    { id: "2817655", region: "us" },
    { username: "test-user", secret: "test-secret" },
    { from: "2022-10-10", to: "2022-10-31" },
    async (url, options) => {
      seen = { url, options };
      return new Response('{"event":"test"}\n');
    },
  );
  assert.equal(response.status, 200);
  assert.equal(seen.url.hostname, "data.mixpanel.com");
  assert.equal(seen.url.searchParams.get("project_id"), "2817655");
  assert.equal(seen.url.searchParams.get("time_in_ms"), "true");
  assert.equal(seen.url.searchParams.has("limit"), false);
  assert.equal(seen.url.searchParams.has("event"), false);
  assert.equal(
    seen.options.headers.Authorization,
    "Basic " + Buffer.from("test-user:test-secret").toString("base64"),
  );
  await assert.rejects(
    () =>
      exportResponse(
        { id: "1", region: "us" },
        { username: "u", secret: "s" },
        { from: "2022-01-01", to: "2022-01-02" },
        async () => new Response("private error", { status: 401 }),
      ),
    /^Error: Mixpanel export HTTP 401$/,
  );
});
