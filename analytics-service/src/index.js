import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { FirestoreStore } from "./store.js";
import { createAnalyticsServer } from "./http.js";
import { FuseSource } from "./fuse-source.js";
import { Warehouse } from "./warehouse.js";

const projectId = process.env.GOOGLE_CLOUD_PROJECT ?? "andershaf-87";
const app = initializeApp({ projectId, credential: applicationDefault() });
const db = getFirestore(
  app,
  process.env.FIRESTORE_DATABASE_ID ?? "personal-analytics",
);
db.settings({ ignoreUndefinedProperties: false });
const primary = new FirestoreStore(db);
const store =
  process.env.FUSE_SOURCE_ENABLED === "1"
    ? new FuseSource({
        db: getFirestore(app, "fuse-riders"),
        primary,
        secret: process.env.ANALYTICS_PRIVACY_SECRET,
      })
    : primary;
const server = createAnalyticsServer({
  store,
  warehouse:
    process.env.WAREHOUSE_ENABLED === "1"
      ? new Warehouse({ projectId })
      : undefined,
  verifyToken: (token) => getAuth(app).verifyIdToken(token, true),
  secret: process.env.ANALYTICS_PRIVACY_SECRET,
  origins: new Set(
    (process.env.ALLOWED_ORIGINS ?? "https://andeplane.github.io").split(","),
  ),
  firebaseConfig: {
    apiKey: "AIzaSyDmK4ZmjGHZl4ImAoEAFLbQ5Vp1wkc0Wyk",
    authDomain: "andershaf-87.firebaseapp.com",
    projectId: "andershaf-87",
    appId: "1:867594018708:web:4444ada96e29685f063981",
  },
});
store
  .ready()
  .then(() => {
    console.log("analytics_storage_ready");
    server.listen(Number(process.env.PORT ?? 8080), "0.0.0.0", () =>
      console.log("analytics_listening"),
    );
  })
  .catch((error) => {
    console.error("analytics_startup_failed", {
      code: String(error?.code ?? "unknown").slice(0, 60),
    });
    process.exit(1);
  });
process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
});
