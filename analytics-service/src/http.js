import { createServer } from "node:http";
import { apps, appIds } from "./catalog.js";
import { analyze, activeSummary } from "./analysis.js";
import {
  HttpError,
  dateRange,
  pseudonym,
  requireOwner,
  validateBatch,
} from "./events.js";

async function readBody(req) {
  if (req.headers["content-type"]?.split(";")[0].trim() !== "application/json")
    throw new HttpError(415, "Use application/json");
  if (Number(req.headers["content-length"]) > 65_536)
    throw new HttpError(413, "Body exceeds 64 KiB");
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65_536) throw new HttpError(413, "Body exceeds 64 KiB");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

export function createAnalyticsServer({
  store,
  verifyToken,
  secret,
  origins,
  firebaseConfig,
  warehouse,
  clock = Date.now,
}) {
  if (!secret || secret.length < 32)
    throw new Error("A durable 32+ character privacy secret is required");
  // Bounded process-local admission is the first guard. Durable ingest quotas
  // below enforce a shared ceiling across revisions and instances.
  const admission = new Map();
  const server = createServer(async (req, res) => {
    const now = clock();
    const headers = {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      Vary: "Origin",
    };
    const send = (status, body) => {
      res.writeHead(status, headers);
      res.end(JSON.stringify(body));
    };
    try {
      const origin = req.headers.origin;
      if (origin && !origins.has(origin))
        throw new HttpError(403, "Origin is not allowed");
      if (origin) headers["Access-Control-Allow-Origin"] = origin;
      if (req.method === "OPTIONS") {
        headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
        headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
        res.writeHead(204, headers);
        res.end();
        return;
      }
      const url = new URL(req.url, "http://analytics");
      if (
        ["/health", "/healthz"].includes(url.pathname) &&
        req.method === "GET"
      ) {
        send(200, { ok: true });
        return;
      }
      // Do not trust a caller-supplied X-Forwarded-For. Cloud Run appends the
      // client address as its last value; the socket is used outside Cloud Run.
      const forwarded =
        typeof req.headers["x-forwarded-for"] === "string"
          ? req.headers["x-forwarded-for"].split(",").at(-1).trim()
          : "";
      const address =
        process.env.K_SERVICE && forwarded
          ? forwarded
          : (req.socket.remoteAddress ?? "unknown");
      const addressKey = pseudonym(secret, "admission", address);
      const minute = Math.floor(now / 60_000),
        current = admission.get(addressKey);
      if (current?.minute === minute && current.count >= 120)
        throw new HttpError(429, "Too many requests; retry in a minute");
      if (admission.size >= 4096) {
        for (const [key, entry] of admission)
          if (entry.minute !== minute) admission.delete(key);
        if (admission.size >= 4096 && !current)
          throw new HttpError(429, "Service is busy; retry later");
      }
      admission.set(addressKey, {
        minute,
        count: current?.minute === minute ? current.count + 1 : 1,
      });
      if (url.pathname === "/v1/config" && req.method === "GET") {
        send(200, { firebase: firebaseConfig });
        return;
      }
      if (url.pathname === "/v1/events" && req.method === "POST") {
        const events = validateBatch(await readBody(req), { now, secret });
        send(200, await store.ingest(events, addressKey, now));
        return;
      }
      const token = /^Bearer ([^\s]{20,8192})$/.exec(
        req.headers.authorization ?? "",
      )?.[1];
      if (!token)
        throw new HttpError(401, "Sign in with Google to read analytics");
      let claims;
      try {
        claims = await verifyToken(token);
      } catch {
        throw new HttpError(401, "Your sign-in expired; sign in again");
      }
      const owner = requireOwner(claims);
      if (req.method !== "GET")
        throw new HttpError(405, "Use GET for dashboard reads");
      if (url.pathname === "/readyz") {
        await store.ready();
        send(200, { ok: true });
        return;
      }
      if (url.pathname === "/v1/me") {
        send(200, owner);
        return;
      }
      if (url.pathname === "/v1/apps") {
        send(200, { apps });
        return;
      }
      if (!["/v1/query", "/v1/session"].includes(url.pathname))
        throw new HttpError(404, "Route not found");
      const allowed = new Set([
        "from",
        "to",
        "appId",
        "event",
        "property",
        "value",
        "breakdown",
        "step",
        "sessionId",
      ]);
      for (const key of url.searchParams.keys())
        if (
          !allowed.has(key) ||
          (key !== "step" && url.searchParams.getAll(key).length > 1)
        )
          throw new HttpError(400, "Invalid query parameters");
      const range = dateRange(url.searchParams, now, warehouse ? 3660 : 90),
        appId = url.searchParams.get("appId") ?? "";
      if (appId && !appIds.has(appId)) throw new HttpError(400, "Unknown app");
      const text = (key) => {
        const value = url.searchParams.get(key) ?? "";
        if (value.length > 160)
          throw new HttpError(400, "Query value is too long");
        return value;
      };
      if (url.pathname === "/v1/session") {
        const sessionId = text("sessionId");
        if (!appId || !/^[a-f0-9]{32}$/.test(sessionId))
          throw new HttpError(400, "Choose an app and session");
        send(200, await (warehouse ?? store).session(appId, sessionId, range));
        return;
      }
      const funnel = url.searchParams.getAll("step");
      if (funnel.length > 5 || funnel.some((step) => step.length > 96))
        throw new HttpError(400, "Use up to five bounded funnel steps");
      if (warehouse) {
        send(
          200,
          await warehouse.analyze(range, {
            appId,
            eventName: text("event"),
            property: text("property"),
            value: text("value"),
            breakdown: text("breakdown") || "name",
            funnel,
          }),
        );
        return;
      }
      const result = await store.query(range, appId);
      const monthStart = Date.parse(range.to.slice(0, 7) + "-01");
      const unfiltered = !text("event") && !text("property");
      const aggregated =
        unfiltered && store.activity
          ? await store.activity(appId, range.to, now)
          : null;
      const month =
        !aggregated?.monthlyAvailable && range.start > monthStart
          ? await store.query({ ...range, start: monthStart }, appId)
          : result;
      const filters = {
        appId,
        eventName: text("event"),
        property: text("property"),
        value: text("value"),
      };
      const active = activeSummary({
        selected: result,
        month,
        range,
        ...filters,
      });
      if (aggregated) {
        active.dau = aggregated.dau;
        if (aggregated.monthlyAvailable) active.mau = aggregated.mau;
      }
      send(200, {
        ...analyze(result.events, {
          range,
          complete: result.complete,
          ...filters,
          breakdown: text("breakdown") || "name",
          funnel,
          now,
        }),
        active,
      });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 503;
      if (status === 429) headers["Retry-After"] = "60";
      if (status === 503)
        console.error("analytics_request_failed", {
          code: String(error?.code ?? "unknown").slice(0, 60),
        });
      send(status, {
        error:
          status === 503
            ? "Analytics storage is temporarily unavailable; try again"
            : error.message,
      });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return server;
}
