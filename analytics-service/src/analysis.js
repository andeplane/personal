import { DAY } from "./events.js";
const unique = (values) => new Set(values).size;
const dayOf = (time) => new Date(time).toISOString().slice(0, 10);
const userKey = (event) => `${event.appId}:${event.userId}`;
const sessionKey = (event) => `${event.appId}:${event.sessionId}`;

// All statistics are exact for the loaded window or explicitly unavailable.
// A bounded read is never presented as the complete product history.
export function analyze(
  events,
  {
    range,
    complete,
    appId = "",
    eventName = "",
    property = "",
    value = "",
    breakdown = "name",
    funnel = [],
    now = Date.now(),
  },
) {
  const scoped = events.filter(
    (e) => e.occurredAt >= range.start && e.occurredAt < range.end,
  );
  const base = scoped.filter((e) => !appId || e.appId === appId);
  const selected = base.filter(
    (e) =>
      (!eventName || e.name === eventName) &&
      (!property || String(e.properties[property]) === value),
  );
  const days = [];
  for (let time = range.start; time < range.end; time += DAY) {
    const subset = selected.filter((e) => dayOf(e.occurredAt) === dayOf(time));
    days.push({
      day: dayOf(time),
      events: subset.length,
      users: unique(subset.map(userKey)),
      sessions: unique(subset.map(sessionKey)),
    });
  }
  const counts = new Map();
  for (const event of selected) {
    const dimension =
      breakdown === "appId"
        ? event.appId
        : breakdown === "name"
          ? event.name
          : event.properties[breakdown];
    const label =
      dimension === undefined || dimension === null
        ? "(not set)"
        : String(dimension);
    const group = counts.get(label) ?? [];
    group.push(event);
    counts.set(label, group);
  }
  const groups = [...counts]
    .map(([label, rows]) => ({
      label,
      events: rows.length,
      users: unique(rows.map(userKey)),
      sessions: unique(rows.map(sessionKey)),
    }))
    .sort((a, b) => b.events - a.events)
    .slice(0, 50);
  const sessions = new Map();
  for (const event of selected) {
    const key = sessionKey(event),
      previous = sessions.get(key);
    sessions.set(key, {
      appId: event.appId,
      sessionId: event.sessionId,
      userId: event.userId,
      first: Math.min(previous?.first ?? Infinity, event.occurredAt),
      last: Math.max(previous?.last ?? 0, event.occurredAt),
      events: (previous?.events ?? 0) + 1,
    });
  }
  // First OBSERVED activity in the queried window is a cohort, not lifetime acquisition.
  const activity = new Map();
  for (const event of base) {
    const key = userKey(event);
    const set = activity.get(key) ?? new Set();
    set.add(dayOf(event.occurredAt));
    activity.set(key, set);
  }
  const retention = [1, 7, 28].map((offset) => {
    let eligible = 0,
      returned = 0;
    for (const dates of activity.values()) {
      const first = [...dates].sort()[0];
      const target = Date.parse(first) + offset * DAY;
      if (target + DAY > Math.min(range.end, now)) continue;
      eligible++;
      if (dates.has(dayOf(target))) returned++;
    }
    return {
      day: offset,
      eligible,
      returned,
      rate: eligible ? returned / eligible : null,
    };
  });
  // Ordered, same-app/browser steps; each user contributes once. All steps must
  // occur within the selected window and seven days of their first step.
  const funnelUsers = new Map();
  for (const event of [...base].sort(
    (a, b) => a.occurredAt - b.occurredAt || a.id.localeCompare(b.id),
  )) {
    const key = userKey(event),
      state = funnelUsers.get(key) ?? { step: 0, first: 0 };
    if (
      state.step < funnel.length &&
      event.name === funnel[state.step] &&
      (state.step === 0 || event.occurredAt - state.first <= 7 * DAY)
    ) {
      if (state.step === 0) state.first = event.occurredAt;
      state.step++;
      funnelUsers.set(key, state);
    }
  }
  const funnelSteps = funnel.map((name, index) => ({
    name,
    users: [...funnelUsers.values()].filter((s) => s.step > index).length,
  }));
  const dimensions = [
    ...new Set(base.flatMap((e) => Object.keys(e.properties))),
  ].sort();
  const appGroups = [...new Set(scoped.map((e) => e.appId))].map((id) => {
    const rows = scoped.filter((e) => e.appId === id);
    return {
      appId: id,
      events: rows.length,
      users: unique(rows.map(userKey)),
      sessions: unique(rows.map(sessionKey)),
      lastSeen: Math.max(...rows.map((e) => e.occurredAt)),
    };
  });
  const histogram = (values, bins) =>
    bins.map(([label, low, high]) => ({
      label,
      count: values.filter((value) => value >= low && value < high).length,
    }));
  const distributions = complete
    ? {
        eventsPerSession: histogram(
          [...sessions.values()].map((session) => session.events),
          [
            ["1", 1, 2],
            ["2–4", 2, 5],
            ["5–9", 5, 10],
            ["10–19", 10, 20],
            ["20–49", 20, 50],
            ["50+", 50, Infinity],
          ],
        ),
        sessionSpan: histogram(
          [...sessions.values()].map(
            (session) => (session.last - session.first) / 60_000,
          ),
          [
            ["Under 1m", 0, 1],
            ["1–4m", 1, 5],
            ["5–14m", 5, 15],
            ["15–29m", 15, 30],
            ["30–59m", 30, 60],
            ["60m+", 60, Infinity],
          ],
        ),
      }
    : null;
  return {
    range: { from: range.from, to: range.to },
    complete,
    scanned: events.length,
    scope:
      "Anonymous installations; identities are scoped to each app. All dates are UTC.",
    summary: complete
      ? {
          events: selected.length,
          users: unique(selected.map(userKey)),
          sessions: sessions.size,
          activeDays: days.filter((d) => d.events).length,
        }
      : null,
    days: complete ? days : null,
    distributions,
    groups: complete ? groups : null,
    apps: complete ? appGroups : null,
    retention: complete ? retention : null,
    funnel: complete ? funnelSteps : null,
    dimensions,
    eventNames: [...new Set(base.map((e) => e.name))].sort(),
    sessions: [...sessions.values()]
      .sort((a, b) => b.last - a.last)
      .slice(0, 100),
    events: [...selected]
      .sort((a, b) => b.occurredAt - a.occurredAt || b.id.localeCompare(a.id))
      .slice(0, 200),
    selectedCount: complete ? selected.length : null,
    retentionScope:
      "Day N return to the same app after first observed activity in this window; only fully observed follow-up days are eligible. Not lifetime acquisition retention.",
    funnelScope:
      "Ordered events from the same app and anonymous installation, within seven days of the first step and inside this window. Uses the app selection, independently of event/property filters.",
  };
}

export function activeSummary({
  selected,
  month,
  range,
  appId = "",
  eventName = "",
  property = "",
  value = "",
}) {
  const dayStart = range.end - DAY,
    monthStart = Date.parse(range.to.slice(0, 7) + "-01");
  const matches = (event) =>
    (!appId || event.appId === appId) &&
    (!eventName || event.name === eventName) &&
    (!property || String(event.properties[property]) === value);
  const count = (rows, start) =>
    unique(
      rows
        .filter(
          (event) =>
            event.occurredAt >= start &&
            event.occurredAt < range.end &&
            matches(event),
        )
        .map(userKey),
    );
  return {
    dau: selected.complete ? count(selected.events, dayStart) : null,
    dauDate: range.to,
    mau: month.complete ? count(month.events, monthStart) : null,
    mauFrom: range.to.slice(0, 7) + "-01",
    mauTo: range.to,
    scope:
      "Distinct app-scoped anonymous installations with a matching event. MAU is calendar month to selected end date, not a rolling 30-day sum.",
  };
}
