import { OAuth2Client } from "google-auth-library";
import { BigQuery } from "@google-cloud/bigquery";
import { Warehouse } from "../src/warehouse.js";
let token = "";
for await (const chunk of process.stdin) token += chunk;
const authClient = new OAuth2Client();
authClient.setCredentials({ access_token: token.trim() });
token = "";
const warehouse = new Warehouse({
  bq: new BigQuery({
    projectId: "andershaf-87",
    authClient,
    location: "europe-west1",
  }),
});
const from = "2026-11-01",
  to = "2026-11-17",
  range = { from, to, start: Date.parse(from), end: Date.parse(to) + 86400000 };
try {
  const result = await warehouse.analyze(range, {
    appId: "atomify",
    funnel: ["Simulation.Start", "Simulation.Stop"],
  });
  console.log(
    JSON.stringify({
      engine: result.engine,
      summary: result.summary,
      days: result.days.length,
      funnel: result.funnel,
      sourceCount: result.sources.length,
    }),
  );
  const session = await warehouse.session("atomify", "a".repeat(32), range);
  console.log(
    JSON.stringify({
      sessionComplete: session.complete,
      sessionEvents: session.events.length,
    }),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
