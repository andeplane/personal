// One synthetic event through the deployed service; remove precisely its event,
// unique memberships and aggregate contribution afterwards. Pass an operator's
// short-lived GCP OAuth token on stdin. No credentials or identities are logged.
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { Firestore } from "firebase-admin/firestore";
import { OAuth2Client } from "google-auth-library";
import { digest } from "../src/events.js";
import { API_ORIGIN } from "../../stats/config.js";
let token = "";
for await (const chunk of process.stdin) token += chunk;
token = token.trim();
if (token.length < 20)
  throw new Error("Operator OAuth token required on stdin");
const authClient = new OAuth2Client();
authClient.setCredentials({ access_token: token });
const db = new Firestore({
  projectId: "andershaf-87",
  databaseId: "personal-analytics",
  authClient,
});
const id = randomUUID(),
  appId = "atomify";
const ref = db.collection("events").doc(digest(`${appId}\0${id}`));
assert.equal((await ref.get()).exists, false);
let accepted = false,
  verified = false,
  cleaned = false;
try {
  const response = await fetch(new URL("/v1/events", API_ORIGIN), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      v: 1,
      appId,
      events: [
        {
          id,
          userId: randomUUID(),
          sessionId: randomUUID(),
          name: "Diagnostics.IngestCheck",
          occurredAt: Date.now(),
          properties: { diagnostic: true },
        },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).accepted, [id]);
  accepted = true;
  const event = (await ref.get()).data();
  assert.equal(event.name, "Diagnostics.IngestCheck");
  assert.equal(event.properties.diagnostic, true);
  verified = true;
} finally {
  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) {
      cleaned = true;
      return;
    }
    const event = snapshot.data();
    assert.equal(event.clientId, id);
    assert.equal(event.name, "Diagnostics.IngestCheck");
    const iso = new Date(event.occurredAt).toISOString();
    const summaries = ["day", "month"].map(
      (period) =>
        `${appId}_${period}_${iso.slice(0, period === "day" ? 10 : 7)}`,
    );
    const summaryRefs = summaries.map((key) =>
      db.collection("summaries").doc(key),
    );
    const memberRefs = summaries.flatMap((key) => [
      db.collection("memberships").doc(digest(`${key}:user:${event.userId}`)),
      db
        .collection("memberships")
        .doc(digest(`${key}:session:${event.sessionId}`)),
    ]);
    const docs = await tx.getAll(...summaryRefs, ...memberRefs);
    for (let i = 0; i < summaries.length; i++) {
      const counts = docs[i].data();
      assert.ok(
        counts &&
          counts.events >= 1 &&
          counts.users >= 1 &&
          counts.sessions >= 1,
      );
      assert.ok(
        docs[summaries.length + i * 2].exists &&
          docs[summaries.length + i * 2 + 1].exists,
      );
      if (counts.events === 1) {
        assert.equal(counts.users, 1);
        assert.equal(counts.sessions, 1);
        tx.delete(summaryRefs[i]);
      } else
        tx.update(summaryRefs[i], {
          events: counts.events - 1,
          users: counts.users - 1,
          sessions: counts.sessions - 1,
        });
    }
    for (const member of memberRefs) tx.delete(member);
    tx.delete(ref);
    cleaned = true;
  });
  await db.terminate();
  token = "";
  console.log(
    JSON.stringify({
      checkedAt: new Date().toISOString(),
      api: API_ORIGIN,
      accepted,
      persistedAndVerified: verified,
      removedSyntheticEventMembershipsAndCounts: cleaned,
      quotaAttemptRetainedUntilTTL: true,
    }),
  );
}
