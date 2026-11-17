import { createHmac, createHash } from "node:crypto";
import { appIds } from "./catalog.js";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const DAY = 86_400_000;
export const RAW_RETENTION_DAYS = 400;
const forbiddenKey =
  /email|password|secret|token|authorization|cookie|transcript|prompt|message|text|url|query|path|name|roomcode|invite|script|code|question|argument|dataframe/i;
const unsafeValue =
  /https?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]{2,}|bearer\s|(?:sk|ghp|gho)_[a-z0-9]+|[\r\n]/i;

export function scrubProperties(input) {
  const clean = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return clean;
  for (const [key, value] of Object.entries(input).slice(0, 40)) {
    if (
      !/^[a-zA-Z_$][a-zA-Z0-9_.$-]{0,47}$/.test(key) ||
      forbiddenKey.test(key)
    )
      continue;
    if (
      value === null ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    )
      clean[key] = value;
    else if (
      typeof value === "string" &&
      value.length <= 160 &&
      !unsafeValue.test(value)
    )
      clean[key] = value;
  }
  return clean;
}

export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export const pseudonym = (secret, appId, value) =>
  createHmac("sha256", secret)
    .update(`${appId}\0${value}`)
    .digest("hex")
    .slice(0, 32);

export function validateBatch(body, { now, secret }) {
  if (
    !body ||
    body.v !== 1 ||
    !appIds.has(body.appId) ||
    !Array.isArray(body.events) ||
    body.events.length < 1 ||
    body.events.length > 20
  )
    throw new HttpError(400, "Use v:1, a registered appId and 1–20 events");
  const seen = new Set();
  return body.events.map((event) => {
    if (!event || typeof event !== "object")
      throw new HttpError(400, "Invalid event");
    for (const key of ["id", "userId", "sessionId"])
      if (
        typeof event[key] !== "string" ||
        !/^[a-zA-Z0-9_-]{8,128}$/.test(event[key])
      )
        throw new HttpError(400, `Invalid ${key}`);
    if (seen.has(event.id))
      throw new HttpError(400, "Duplicate event id in batch");
    seen.add(event.id);
    if (
      typeof event.name !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9 ._:/()-]{0,95}$/.test(event.name) ||
      unsafeValue.test(event.name)
    )
      throw new HttpError(400, "Invalid event name");
    if (
      !Number.isSafeInteger(event.occurredAt) ||
      event.occurredAt < now - 7 * DAY ||
      event.occurredAt > now + 300_000
    )
      throw new HttpError(
        400,
        "Events must be within seven days and five minutes ahead",
      );
    return {
      id: digest(`${body.appId}\0${event.id}`),
      clientId: event.id,
      appId: body.appId,
      name: event.name,
      userId: pseudonym(secret, body.appId, event.userId),
      sessionId: pseudonym(secret, body.appId, event.sessionId),
      occurredAt: event.occurredAt,
      receivedAt: now,
      expiresAt: now + RAW_RETENTION_DAYS * DAY,
      properties: scrubProperties(event.properties),
    };
  });
}

export function requireOwner(claims) {
  if (
    claims?.email !== "andershaf@gmail.com" ||
    claims.email_verified !== true ||
    claims.firebase?.sign_in_provider !== "google.com"
  )
    throw new HttpError(
      403,
      "This dashboard is only available to andershaf@gmail.com signed in with Google",
    );
  return { email: claims.email, uid: claims.uid };
}

export function dateRange(params, now, maxDays = 90) {
  const from =
    params.get("from") ?? new Date(now - 27 * DAY).toISOString().slice(0, 10);
  const to = params.get("to") ?? new Date(now).toISOString().slice(0, 10);
  const valid = (s) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s;
  if (!valid(from) || !valid(to))
    throw new HttpError(400, "Use valid YYYY-MM-DD dates");
  const start = Date.parse(from),
    end = Date.parse(to) + DAY;
  if (start >= end || end - start > maxDays * DAY || end > now + DAY)
    throw new HttpError(
      400,
      `Choose a past date range of at most ${maxDays} days`,
    );
  return { from, to, start, end };
}
