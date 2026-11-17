import { FieldPath } from "firebase-admin/firestore";
import { digest, pseudonym, scrubProperties } from "./events.js";
import { READ_LIMIT } from "./store.js";

/** Read-only bridge to the existing first-party metrics collection. */
export class FuseSource {
  constructor({ db, primary, secret, clock = Date.now }) {
    Object.assign(this, { db, primary, secret, clock });
  }
  async sourceQuery(range) {
    const snapshot = await this.db
      .collection("fuse-production-telemetry-events")
      .where("occurredAt", ">=", range.start)
      .where("occurredAt", "<", range.end)
      .orderBy("occurredAt", "desc")
      .orderBy(FieldPath.documentId(), "desc")
      .limit(READ_LIMIT + 1)
      .get();
    const events = [];
    for (const doc of snapshot.docs.slice(0, READ_LIMIT)) {
      const row = doc.data();
      if (
        !row ||
        typeof row.id !== "string" ||
        typeof row.userId !== "string" ||
        typeof row.sessionId !== "string" ||
        typeof row.name !== "string" ||
        !Number.isSafeInteger(row.occurredAt)
      )
        continue;
      if (typeof row.expiresAt !== "number" || row.expiresAt <= this.clock())
        continue;
      events.push({
        id: digest(`fuse-games\0${row.id}`),
        appId: "fuse-games",
        userId: pseudonym(this.secret, "fuse-games", row.userId),
        sessionId: pseudonym(this.secret, "fuse-games", row.sessionId),
        name: row.name.slice(0, 96),
        occurredAt: row.occurredAt,
        receivedAt: Number.isSafeInteger(row.receivedAt)
          ? row.receivedAt
          : row.occurredAt,
        expiresAt: row.expiresAt,
        properties: scrubProperties({ ...row.properties, gameId: row.gameId }),
        source: "fuse-games-first-party",
      });
    }
    return { events, complete: snapshot.size <= READ_LIMIT };
  }
  async query(range, appId = "") {
    if (appId && appId !== "fuse-games") return this.primary.query(range);
    const [primary, source] = await Promise.all([
      this.primary.query(range),
      this.sourceQuery(range),
    ]);
    const byId = new Map(
      [...source.events, ...primary.events].map((event) => [event.id, event]),
    );
    const events = [...byId.values()].sort(
      (a, b) => b.occurredAt - a.occurredAt || b.id.localeCompare(a.id),
    );
    return {
      events: events.slice(0, READ_LIMIT),
      complete:
        primary.complete && source.complete && events.length <= READ_LIMIT,
    };
  }
  async activity(appId, to, now) {
    // Summing source and destination uniques would double count a future dual
    // delivery. Federated scopes deliberately use the exact union of raw rows.
    if (!appId || appId === "fuse-games") return null;
    return this.primary.activity(appId, to, now);
  }
  async session(appId, sessionId, range) {
    const result = await this.query(range, appId);
    return {
      ...result,
      events: result.events
        .filter(
          (event) => event.appId === appId && event.sessionId === sessionId,
        )
        .sort(
          (a, b) => a.occurredAt - b.occurredAt || a.id.localeCompare(b.id),
        ),
    };
  }
  ingest(...args) {
    return this.primary.ingest(...args);
  }
  async ready() {
    await Promise.all([
      this.primary.ready(),
      this.db.collection("fuse-production-telemetry-events").limit(1).get(),
    ]);
  }
}
