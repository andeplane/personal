// Old Mixpanel projects store local wall time in an epoch-shaped field.
// Preserve that source time in the archive. Resolve fall-back ambiguity to the
// earlier instant and record it explicitly, since the export cannot disambiguate.
export function historyTime(raw, project) {
  if (!project.legacyLocalTime || project.timezone === "UTC")
    return { time: raw, ambiguous: false };
  if (!project.timezone)
    throw new Error("Legacy project requires its ingestion timezone");
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: project.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const wall = (instant) => {
    const p = Object.fromEntries(
      formatter.formatToParts(new Date(instant)).map((v) => [v.type, v.value]),
    );
    return (
      Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) +
      (((instant % 1000) + 1000) % 1000)
    );
  };
  const offsets = new Set(
    [-2, -1, 0, 1, 2].map((day) => {
      const instant = raw + day * 86400000;
      return wall(instant) - instant;
    }),
  );
  const candidates = [...offsets]
    .map((offset) => raw - offset)
    .filter((instant) => wall(instant) === raw)
    .sort((a, b) => a - b);
  if (!candidates.length) throw new Error("Nonexistent legacy local timestamp");
  return { time: candidates[0], ambiguous: candidates.length > 1 };
}

export function monthlyWindows(from, to) {
  const valid = (date) =>
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    new Date(date).toISOString().slice(0, 10) === date;
  if (!valid(from) || !valid(to) || from > to)
    throw new Error("Invalid export dates");
  const windows = [];
  for (let current = from; current <= to;) {
    const start = new Date(current),
      next = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1);
    const end = new Date(Math.min(next - 86400000, Date.parse(to)))
      .toISOString()
      .slice(0, 10);
    windows.push({ from: current, to: end });
    current = new Date(Date.parse(end) + 86400000).toISOString().slice(0, 10);
  }
  return windows;
}
