/** First-party browser telemetry. Import this module; never put credentials in it. */
export function createAnalytics({
  appId,
  endpoint,
  allowLocal = false,
  environment = globalThis,
}) {
  if (!/^[a-z][a-z0-9-]{1,47}$/.test(appId))
    throw new Error("Choose a registered appId");
  const base = new URL(endpoint);
  if (
    base.protocol !== "https:" &&
    !(allowLocal && ["localhost", "127.0.0.1"].includes(base.hostname))
  )
    throw new Error("Analytics requires HTTPS");
  const key = `personal.analytics.${appId}`,
    preferenceKey = `${key}.disabled`;
  const DAY = 86_400_000;
  let memory = { events: [] },
    pending = Promise.resolve(),
    sending = false,
    retry = null,
    delay = 1000,
    destroyed = false,
    memoryDisabled = false;
  const timers = new Map();
  const now = () => Date.now();
  const read = () => {
    try {
      const parsed = JSON.parse(environment.localStorage.getItem(key));
      if (parsed && Array.isArray(parsed.events)) return parsed;
    } catch {}
    return memory;
  };
  const write = (state) => {
    memory = state;
    try {
      environment.localStorage.setItem(key, JSON.stringify(state));
    } catch {}
  };
  const uuid = () => environment.crypto.randomUUID();
  const disabled = () => {
    let preference = false;
    try {
      preference = environment.localStorage.getItem(preferenceKey) === "1";
    } catch {}
    const host = environment.location?.hostname ?? "";
    return (
      memoryDisabled ||
      preference ||
      environment.navigator?.doNotTrack === "1" ||
      environment.doNotTrack === "1" ||
      (!allowLocal &&
        (["localhost", "127.0.0.1", "::1", "[::1]"].includes(host) ||
          host.endsWith(".localhost")))
    );
  };
  const mutate = (operation) => {
    const execute = async () => {
      const run = async () => {
        const state = read();
        state.events = state.events
          .filter((e) => e.occurredAt >= now() - 7 * DAY)
          .slice(-200);
        const result = await operation(state);
        write(state);
        return result;
      };
      return environment.navigator?.locks
        ? environment.navigator.locks.request(key, run)
        : run();
    };
    const result = pending.then(execute, execute);
    pending = result.catch(() => {});
    return result;
  };
  const schedule = () => {
    if (destroyed || retry || disabled()) return;
    retry = environment.setTimeout(() => {
      retry = null;
      void flush();
    }, delay);
    delay = Math.min(60_000, delay * 2);
  };
  async function flush() {
    if (sending || destroyed) return;
    if (disabled()) {
      await mutate((state) => {
        state.events = [];
        delete state.userId;
        delete state.sessionId;
        delete state.activeAt;
      });
      return;
    }
    sending = true;
    try {
      const batch = await mutate((state) => {
        const selected = [];
        for (const event of state.events.slice(0, 20)) {
          const candidate = [...selected, event];
          if (
            new TextEncoder().encode(
              JSON.stringify({ v: 1, appId, events: candidate }),
            ).length > 60_000
          )
            break;
          selected.push(event);
        }
        return selected;
      });
      if (!batch.length || disabled()) return;
      const response = await environment.fetch(new URL("/v1/events", base), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ v: 1, appId, events: batch }),
        keepalive: true,
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) {
        schedule();
        return;
      }
      const { accepted } = await response.json();
      if (!Array.isArray(accepted)) {
        schedule();
        return;
      }
      const sent = new Set(batch.map((e) => e.id));
      const acknowledged = new Set(accepted.filter((id) => sent.has(id)));
      if (!acknowledged.size) {
        schedule();
        return;
      }
      await mutate((state) => {
        state.events = state.events.filter((e) => !acknowledged.has(e.id));
      });
      delay = 1000;
      if ((await mutate((state) => state.events.length)) > 0) schedule();
    } catch {
      schedule();
    } finally {
      sending = false;
    }
  }
  // This is a defensive client scrub; the server independently applies its
  // stricter authoritative policy. Arbitrary objects are never serialized.
  const scrub = (properties) =>
    Object.fromEntries(
      Object.entries(properties ?? {})
        .slice(0, 40)
        .filter(
          ([name, value]) =>
            !/email|password|secret|token|authorization|cookie|transcript|prompt|message|text|url|query|path|name|roomcode|invite|script|code|question|argument|dataframe/i.test(
              name,
            ) &&
            (value === null ||
              typeof value === "boolean" ||
              (typeof value === "number" && Number.isFinite(value)) ||
              (typeof value === "string" &&
                value.length <= 160 &&
                !/https?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]{2,}|bearer\s|(?:sk|ghp|gho)_[a-z0-9]+|[\r\n]/i.test(
                  value,
                ))),
        ),
    );
  async function track(name, properties = {}) {
    if (
      destroyed ||
      disabled() ||
      typeof name !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9 ._:/()-]{0,95}$/.test(name)
    )
      return;
    try {
      await mutate((state) => {
        if (disabled()) {
          state.events = [];
          return;
        }
        const time = now();
        state.userId ??= uuid();
        if (!state.sessionId || time - (state.activeAt ?? 0) >= 30 * 60_000)
          state.sessionId = uuid();
        state.activeAt = time;
        const started = timers.get(name);
        timers.delete(name);
        state.events.push({
          id: uuid(),
          name,
          userId: state.userId,
          sessionId: state.sessionId,
          occurredAt: time,
          properties: scrub({
            ...properties,
            ...(started === undefined
              ? {}
              : { durationSeconds: Math.max(0, (time - started) / 1000) }),
          }),
        });
        state.events = state.events.slice(-200);
      });
      void flush();
    } catch {
      /* Telemetry must never interrupt the app. */
    }
  }
  const wake = () => {
    void flush();
  };
  const storageChanged = (event) => {
    if (event.key === preferenceKey) wake();
  };
  environment.addEventListener?.("online", wake);
  environment.addEventListener?.("pagehide", wake);
  environment.addEventListener?.("storage", storageChanged);
  environment.document?.addEventListener("visibilitychange", wake);
  // An existing outbox may be from a previous visit. Disabled visits clear it
  // before any delivery and create no new identity.
  void flush();
  return {
    track,
    timeEvent(name) {
      if (!disabled()) timers.set(name, now());
    },
    async reset() {
      timers.clear();
      await mutate((state) => {
        state.events = [];
        delete state.userId;
        delete state.sessionId;
        delete state.activeAt;
      });
    },
    async setOptOut(value) {
      memoryDisabled = value;
      try {
        environment.localStorage.setItem(preferenceKey, value ? "1" : "0");
      } catch {}
      if (value) await this.reset();
    },
    flush,
    destroy() {
      destroyed = true;
      if (retry) environment.clearTimeout(retry);
      environment.removeEventListener?.("online", wake);
      environment.removeEventListener?.("pagehide", wake);
      environment.removeEventListener?.("storage", storageChanged);
      environment.document?.removeEventListener("visibilitychange", wake);
    },
  };
}
