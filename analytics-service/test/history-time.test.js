import test from "node:test";
import assert from "node:assert/strict";
import { historyTime, monthlyWindows } from "../src/history-time.js";
const project = { legacyLocalTime: true, timezone: "Europe/Oslo" };
test("legacy Oslo offsets follow daylight saving; repeated hour remains explicit", () => {
  assert.equal(
    historyTime(Date.parse("2025-07-01T12:00:00Z"), project).time,
    Date.parse("2025-07-01T10:00:00Z"),
  );
  assert.equal(
    historyTime(Date.parse("2025-01-01T12:00:00Z"), project).time,
    Date.parse("2025-01-01T11:00:00Z"),
  );
  assert.deepEqual(historyTime(Date.parse("2025-10-26T02:30:00Z"), project), {
    time: Date.parse("2025-10-26T00:30:00Z"),
    ambiguous: true,
  });
  assert.throws(
    () => historyTime(Date.parse("2025-03-30T02:30:00Z"), project),
    /Nonexistent/,
  );
  assert.deepEqual(historyTime(1234567890000, {}), {
    time: 1234567890000,
    ambiguous: false,
  });
});
test("monthly exports cover every inclusive day exactly once including leap day", () => {
  assert.deepEqual(monthlyWindows("2024-02-28", "2024-04-01"), [
    { from: "2024-02-28", to: "2024-02-29" },
    { from: "2024-03-01", to: "2024-03-31" },
    { from: "2024-04-01", to: "2024-04-01" },
  ]);
});
