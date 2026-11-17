import { Timestamp, FieldPath } from "firebase-admin/firestore";
import { HttpError, digest, DAY } from "./events.js";
import { apps } from "./catalog.js";

export const READ_LIMIT = 10_000;
export class FirestoreStore {
  constructor(db) {
    this.db = db;
  }
  async ingest(events, addressKey, now) {
    const refs = events.map((e) => this.db.collection("events").doc(e.id));
    const quotaSpecs = [
      [`global-day-${Math.floor(now / DAY)}`, 50_000, DAY * 2],
      [`global-minute-${Math.floor(now / 60_000)}`, 2_000, 120_000],
      [`client-${addressKey}-${Math.floor(now / 60_000)}`, 200, 120_000],
    ];
    const quotaRefs = quotaSpecs.map(([id]) =>
      this.db.collection("limits").doc(digest(id)),
    );
    const entries = events.flatMap((event) =>
      ["day", "month"].map((period) => {
        const iso = new Date(event.occurredAt).toISOString();
        const bucket = period === "day" ? iso.slice(0, 10) : iso.slice(0, 7);
        const summary = `${event.appId}_${period}_${bucket}`;
        return {
          event,
          period,
          bucket,
          summary,
          user: digest(`${summary}:user:${event.userId}`),
          session: digest(`${summary}:session:${event.sessionId}`),
        };
      }),
    );
    const summaryIds = [...new Set(entries.map((entry) => entry.summary))];
    const memberIds = [
      ...new Set(entries.flatMap((entry) => [entry.user, entry.session])),
    ];
    const summaryRefs = summaryIds.map((id) =>
      this.db.collection("summaries").doc(id),
    );
    const memberRefs = memberIds.map((id) =>
      this.db.collection("memberships").doc(id),
    );
    await this.db.runTransaction(async (tx) => {
      const docs = await tx.getAll(
        ...refs,
        ...quotaRefs,
        ...summaryRefs,
        ...memberRefs,
      );
      const quotas = docs.slice(refs.length, refs.length + quotaRefs.length);
      const summaryDocs = docs.slice(
        refs.length + quotaRefs.length,
        refs.length + quotaRefs.length + summaryRefs.length,
      );
      const memberDocs = docs.slice(
        refs.length + quotaRefs.length + summaryRefs.length,
      );
      const counters = new Map(
        summaryIds.map((id, index) => [
          id,
          { events: 0, users: 0, sessions: 0, ...summaryDocs[index].data() },
        ]),
      );
      const members = new Set(
        memberIds.filter((id, index) => memberDocs[index].exists),
      );
      const newEvents = new Set();
      // Charge attempts too. Replaying duplicates must not provide unlimited reads.
      quotaSpecs.forEach(([, max], index) => {
        if ((quotas[index].data()?.count ?? 0) + events.length > max)
          throw new HttpError(429, "Telemetry budget reached; retry later");
      });
      events.forEach((event, index) => {
        const fingerprint = digest(
          JSON.stringify([
            event.appId,
            event.id,
            event.userId,
            event.sessionId,
            event.name,
            event.occurredAt,
            Object.entries(event.properties).sort(([a], [b]) =>
              a.localeCompare(b),
            ),
          ]),
        );
        if (
          docs[index].exists &&
          docs[index].data().fingerprint !== fingerprint
        )
          throw new HttpError(409, "Event id already has different content");
        if (!docs[index].exists) {
          newEvents.add(event.id);
          tx.create(refs[index], {
            ...event,
            fingerprint,
            cleanupAt: Timestamp.fromMillis(event.expiresAt),
          });
        }
      });
      const changed = new Set();
      for (const entry of entries) {
        if (!newEvents.has(entry.event.id)) continue;
        const counter = counters.get(entry.summary);
        changed.add(entry.summary);
        counter.events++;
        for (const [id, field] of [
          [entry.user, "users"],
          [entry.session, "sessions"],
        ]) {
          if (!members.has(id)) {
            members.add(id);
            counter[field]++;
            tx.create(this.db.collection("memberships").doc(id), {
              cleanupAt: Timestamp.fromMillis(now + 430 * DAY),
            });
          }
        }
        Object.assign(counter, {
          appId: entry.event.appId,
          period: entry.period,
          bucket: entry.bucket,
          cleanupAt: Timestamp.fromMillis(now + 400 * DAY),
        });
      }
      for (const id of changed)
        tx.set(this.db.collection("summaries").doc(id), counters.get(id));
      quotaSpecs.forEach(([, , ttl], index) =>
        tx.set(quotaRefs[index], {
          count: (quotas[index].data()?.count ?? 0) + events.length,
          cleanupAt: Timestamp.fromMillis(now + ttl),
        }),
      );
    });
    return { accepted: events.map((e) => e.clientId) };
  }
  async query(range) {
    // One-field range and matching stable sort require no composite index.
    const snapshot = await this.db
      .collection("events")
      .where("occurredAt", ">=", range.start)
      .where("occurredAt", "<", range.end)
      .orderBy("occurredAt", "desc")
      .orderBy(FieldPath.documentId(), "desc")
      .limit(READ_LIMIT + 1)
      .get();
    return {
      events: snapshot.docs.slice(0, READ_LIMIT).map((doc) => {
        const { cleanupAt, clientId, fingerprint, ...event } = doc.data();
        return event;
      }),
      complete: snapshot.size <= READ_LIMIT,
    };
  }
  async activity(appId, to, now) {
    const ids = appId ? [appId] : apps.map((app) => app.id);
    const month = to.slice(0, 7),
      end = Date.parse(to) + DAY;
    const monthEnd = new Date(
      Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)), 1),
    ).getTime();
    const currentDay = new Date(now).toISOString().slice(0, 10);
    // A client may be five minutes ahead. Near UTC midnight, a current-month
    // counter can already contain tomorrow's first activity. Use the bounded
    // exact raw window until the date rolls over rather than overstate MAU.
    const mayUseMonth =
      end === monthEnd || (to === currentDay && end > now + 300_000);
    const refs = ids.flatMap((id) => [
      this.db.collection("summaries").doc(`${id}_day_${to}`),
      this.db.collection("summaries").doc(`${id}_month_${month}`),
    ]);
    const docs = await this.db.getAll(...refs);
    return {
      dau: docs
        .filter((doc, index) => index % 2 === 0)
        .reduce((sum, doc) => sum + (doc.data()?.users ?? 0), 0),
      mau: mayUseMonth
        ? docs
            .filter((doc, index) => index % 2 === 1)
            .reduce((sum, doc) => sum + (doc.data()?.users ?? 0), 0)
        : null,
      monthlyAvailable: mayUseMonth,
    };
  }
  async session(appId, sessionId, range) {
    // Index-free bounded window; retain the same completeness disclosure.
    const result = await this.query(range);
    return {
      ...result,
      events: result.events
        .filter((e) => e.appId === appId && e.sessionId === sessionId)
        .sort(
          (a, b) => a.occurredAt - b.occurredAt || a.id.localeCompare(b.id),
        ),
    };
  }
  async ready() {
    await this.db.collection("events").limit(1).get();
  }
}
