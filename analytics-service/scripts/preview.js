import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createAnalyticsServer } from "../src/http.js";
import { DAY } from "../src/events.js";
import { analyze, activeSummary } from "../src/analysis.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const today = Date.parse(new Date().toISOString().slice(0, 10));
const hash = (value) =>
  createHash("sha256").update(value).digest("hex").slice(0, 32);
const events = [];
for (let day = 0; day < 28; day++) {
  for (let user = 0; user < 22; user++) {
    if ((user * 3 + day * 7) % 11 > 5 + Math.floor(day / 7)) continue;
    const appId = ["atomify", "fuse-games", "homepage"][user % 3];
    const names =
      appId === "atomify"
        ? ["Page.Load", "Project.Open", "Simulation.Start", "Simulation.Stop"]
        : appId === "fuse-games"
          ? ["fuse.App Opened", "fuse.Round Started", "fuse.Round Ended"]
          : ["Homepage.Page Viewed", "Homepage.Demo Opened"];
    names.forEach((name, step) => {
      if (step === names.length - 1 && (user + day) % 4 === 0) return;
      events.push({
        id: hash(`${day}:${user}:${step}`),
        appId,
        userId: hash(`${appId}:${user}`),
        sessionId: hash(`${appId}:${user}:${day}`),
        name,
        occurredAt:
          today -
          (27 - day) * DAY +
          9 * 3_600_000 +
          user * 300_000 +
          step * 30_000,
        properties: {
          feature: ["editor", "examples", "library"][user % 3],
          platform: user % 4 === 0 ? "mobile" : "desktop",
          durationSeconds: step === names.length - 1 ? 40 + user * 12 : null,
          ...(appId === "atomify"
            ? {
                numAtoms: 1024 * (user + 1),
                timestepsPerSecond: 100 + user * 12,
                stopReason: user % 5 === 0 ? "failed" : "completed",
                exampleId: ["lj-liquid", "water", "crystal"][user % 3],
              }
            : {}),
          ...(appId === "fuse-games"
            ? { gameId: ["fusemania", "fuse-riders"][user % 2], played: true }
            : {}),
        },
      });
    });
  }
}
const store = {
  async query(range) {
    return {
      events: events.filter(
        (e) => e.occurredAt >= range.start && e.occurredAt < range.end,
      ),
      complete: true,
    };
  },
  async session(appId, sessionId, range) {
    const result = await this.query(range);
    return {
      ...result,
      events: result.events
        .filter((e) => e.appId === appId && e.sessionId === sessionId)
        .sort((a, b) => a.occurredAt - b.occurredAt),
    };
  },
  async ready() {},
  async ingest() {
    throw new Error("The preview never accepts telemetry");
  },
};
const api = createAnalyticsServer({
  store,
  warehouse: {
    async analyze(range, filters) {
      const selected = await store.query(range),
        month = await store.query({
          ...range,
          start: Date.parse(range.to.slice(0, 7) + "-01"),
        });
      const data = analyze(selected.events, {
        range,
        complete: true,
        ...filters,
      });
      const rows = selected.events.filter((row) => row.appId === "atomify"),
        stops = rows.filter((row) => row.name === "Simulation.Stop");
      const count = (name) => rows.filter((row) => row.name === name).length;
      const groups = (values, key) =>
        [...new Set(values.map(key))].map((label) => ({
          label,
          events: values.filter((row) => key(row) === label).length,
          users: new Set(
            values.filter((row) => key(row) === label).map((row) => row.userId),
          ).size,
        }));
      return {
        ...data,
        engine: "warehouse",
        active: activeSummary({ selected, month, range, ...filters }),
        inferredSessions: 0,
        sources: [
          {
            source: "synthetic",
            projectId: "preview-only",
            events: selected.events.length,
            firstDay: range.from,
            lastDay: range.to,
          },
        ],
        atomify:
          filters.appId === "atomify"
            ? {
                usage: {
                  simulationStarts: count("Simulation.Start"),
                  simulationStops: stops.length,
                  runStarts: 0,
                  runFinishes: 0,
                  projectsCreated: 0,
                  examplesAdopted: 0,
                  quickRuns: 0,
                  sweeps: 0,
                },
                outcomes: groups(stops, (row) => row.properties.stopReason),
                performance: {
                  stops: stops.length,
                  durationSamples: stops.length,
                  averageDuration: stops.length
                    ? stops.reduce(
                        (sum, row) => sum + row.properties.durationSeconds,
                        0,
                      ) / stops.length
                    : null,
                  medianDuration: 148,
                  p95Duration: 280,
                  atomSamples: stops.length,
                  maxAtoms: 22528,
                  speedSamples: stops.length,
                  medianSpeed: 244,
                  p95Speed: 352,
                },
                daily: data.days.map((day) => ({
                  ...day,
                  starts: rows.filter(
                    (row) =>
                      row.name === "Simulation.Start" &&
                      new Date(row.occurredAt)
                        .toISOString()
                        .startsWith(day.day),
                  ).length,
                  stops: stops.filter((row) =>
                    new Date(row.occurredAt).toISOString().startsWith(day.day),
                  ).length,
                  failures: 0,
                })),
                examples: groups(rows, (row) => row.properties.exampleId),
                features: groups(rows, (row) => row.name.split(".")[0]),
                durations: [
                  {
                    label: "Under 1m",
                    count: stops.filter(
                      (row) => row.properties.durationSeconds < 60,
                    ).length,
                  },
                  {
                    label: "1–4m",
                    count: stops.filter(
                      (row) =>
                        row.properties.durationSeconds >= 60 &&
                        row.properties.durationSeconds < 300,
                    ).length,
                  },
                  {
                    label: "5m+",
                    count: stops.filter(
                      (row) => row.properties.durationSeconds >= 300,
                    ).length,
                  },
                ],
                sizes: [
                  {
                    label: "Under 10k",
                    count: stops.filter(
                      (row) => row.properties.numAtoms < 10000,
                    ).length,
                  },
                  {
                    label: "10k+",
                    count: stops.filter(
                      (row) => row.properties.numAtoms >= 10000,
                    ).length,
                  },
                ],
              }
            : null,
      };
    },
    session: (...args) => store.session(...args),
  },
  verifyToken: async (token) => {
    if (token !== "synthetic-owner-token-for-local-preview")
      throw new Error("Invalid preview token");
    return {
      uid: "synthetic-owner",
      email: "andershaf@gmail.com",
      email_verified: true,
      firebase: { sign_in_provider: "google.com" },
    };
  },
  secret: "synthetic-preview-only-never-used-in-production",
  origins: new Set(),
  firebaseConfig: {},
});
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/__analytics_preview") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ synthetic: true }));
    return;
  }
  if (url.pathname.startsWith("/v1/")) {
    api.emit("request", req, res);
    return;
  }
  let path = decodeURIComponent(url.pathname);
  if (path === "/") {
    res.writeHead(302, { Location: "/stats/" });
    res.end();
    return;
  }
  if (path.endsWith("/")) path += "index.html";
  const file = resolve(root, `.${path}`);
  if (!(
    file.startsWith(resolve(root, "stats") + "/") ||
    file.startsWith(resolve(root, "assets") + "/")
  )) {
    res.writeHead(404);
    res.end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type":
        { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[
          extname(file)
        ] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
server.listen(0, "127.0.0.1", () =>
  console.log(
    `Synthetic analytics preview: http://127.0.0.1:${server.address().port}/stats/`,
  ),
);
