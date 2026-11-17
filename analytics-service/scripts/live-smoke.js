// Pass the explicitly selected owner's short-lived Google OAuth token on stdin.
// Nothing credential-bearing is printed or persisted. No events are generated.
import { API_ORIGIN } from "../../stats/config.js";
import assert from "node:assert/strict";
let oauth = "";
for await (const chunk of process.stdin) oauth += chunk;
oauth = oauth.trim();
if (oauth.length < 20)
  throw new Error("A short-lived operator token is required on stdin");
const report = {
  checkedAt: new Date().toISOString(),
  api: API_ORIGIN,
  checks: {},
};
const request = (path, options) =>
  fetch(new URL(path, API_ORIGIN), {
    ...options,
    signal: AbortSignal.timeout(30_000),
  });
assert.equal((await request("/health")).status, 200);
report.checks.health = "passed";
for (const path of [
  "/v1/me",
  "/v1/apps",
  "/v1/query",
  "/v1/session",
  "/readyz",
])
  assert.equal((await request(path)).status, 401);
report.checks.unauthenticatedReadsDenied = "passed";
assert.equal(
  (
    await request("/v1/me", {
      headers: { Authorization: "Bearer invalid-signature-token-long-enough" },
    })
  ).status,
  401,
);
report.checks.invalidTokenDenied = "passed";
assert.equal(
  (
    await request("/v1/config", {
      headers: { Origin: "https://untrusted.example" },
    })
  ).status,
  403,
);
report.checks.foreignOriginDenied = "passed";
const config = await (await request("/v1/config")).json();
const response = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${encodeURIComponent(config.firebase.apiKey)}`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://andeplane.github.io",
      Referer: "https://andeplane.github.io/personal/stats/",
    },
    body: JSON.stringify({
      postBody: new URLSearchParams({
        providerId: "google.com",
        access_token: oauth,
      }).toString(),
      requestUri: "https://andeplane.github.io/personal/stats/",
      returnSecureToken: true,
      returnIdpCredential: false,
    }),
    signal: AbortSignal.timeout(30_000),
  },
);
oauth = "";
const identity = await response.json();
if (
  !response.ok ||
  !identity.idToken ||
  identity.email !== "andershaf@gmail.com"
)
  throw new Error(
    `Google owner exchange did not succeed (${identity.error?.message?.match(/^[A-Z_]+/)?.[0] ?? "NO_OWNER_TOKEN"}); no credential response was logged`,
  );
const headers = { Authorization: `Bearer ${identity.idToken}` };
const me = await request("/v1/me", { headers });
assert.equal(me.status, 200);
assert.equal((await me.json()).email, "andershaf@gmail.com");
report.checks.googleOwner = "passed";
assert.equal((await request("/readyz", { headers })).status, 200);
report.checks.runtimeStorageAccess = "passed";
const params = new URLSearchParams({
  from: new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10),
  to: new Date().toISOString().slice(0, 10),
  appId: "fuse-games",
});
const query = await request(`/v1/query?${params}`, { headers });
assert.equal(query.status, 200);
const data = await query.json();
report.checks.fuseQuery = "passed";
report.fuse = {
  range: data.range,
  complete: data.complete,
  active: data.active,
  summary: data.summary,
  scanned: data.scanned,
};
identity.idToken = "";
delete headers.Authorization;
console.log(JSON.stringify(report, null, 2));
