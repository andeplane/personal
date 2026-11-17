import { API_ORIGIN } from "./config.js";

const $ = (selector) => document.querySelector(selector);
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const number = (value) => Number(value ?? 0).toLocaleString("en-GB");
const date = (time) =>
  new Date(time).toLocaleString("en-GB", {
    timeZone: "UTC",
    dateStyle: "medium",
    timeStyle: "short",
  });
const DAY = 86_400_000;
const saved = new URLSearchParams(location.search);
const state = {
  appId: saved.get("app") ?? "",
  tab: saved.get("tab") ?? "overview",
  event: "",
  property: "",
  value: "",
  breakdown: "name",
  chartMetric: "events",
  funnel: [],
  catalog: [],
  data: null,
  generation: 0,
};
let apiOrigin = API_ORIGIN,
  tokenProvider,
  signOut,
  authUser = null;

function setWindow(days) {
  $("#to").value = new Date().toISOString().slice(0, 10);
  $("#from").value = new Date(Date.now() - (days - 1) * DAY)
    .toISOString()
    .slice(0, 10);
}
setWindow(28);
if (/^\d{4}-\d{2}-\d{2}$/.test(saved.get("from")))
  $("#from").value = saved.get("from");
if (/^\d{4}-\d{2}-\d{2}$/.test(saved.get("to")))
  $("#to").value = saved.get("to");
$("#from").max = $("#to").max = new Date().toISOString().slice(0, 10);

function notify(text = "", error = false) {
  $("#query-status").textContent = text;
  $("#query-status").hidden = !text;
  $("#query-status").classList.toggle("error", error);
}
function updateUrl() {
  const params = new URLSearchParams({
    from: $("#from").value,
    to: $("#to").value,
    tab: state.tab,
  });
  if (state.appId) params.set("app", state.appId);
  history.replaceState(null, "", `?${params}`);
}
async function api(path, params) {
  const url = new URL(path, apiOrigin);
  if (params) url.search = params;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${await tokenProvider()}` },
    credentials: "omit",
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}
function parameters() {
  const params = new URLSearchParams({
    from: $("#from").value,
    to: $("#to").value,
  });
  for (const key of ["appId", "event", "property", "value", "breakdown"])
    if (state[key]) params.set(key, state[key]);
  state.funnel.filter(Boolean).forEach((step) => params.append("step", step));
  return params;
}
async function load() {
  if (!authUser) return;
  const generation = ++state.generation;
  $("#view").setAttribute("aria-busy", "true");
  $("#view").inert = true;
  notify("Loading the selected window…");
  try {
    const data = await api("/v1/query", parameters());
    if (generation !== state.generation || !authUser) return;
    state.data = data;
    updateUrl();
    render();
    $("#freshness").textContent =
      `${data.range.from} – ${data.range.to} · UTC · Read at ${new Date().toLocaleTimeString("en-GB", { timeZone: "UTC" })} UTC`;
    notify(
      data.complete
        ? ""
        : `This window exceeds the 10,000-event query limit. Counts and charts are withheld. The event and session lists are samples of the newest scanned events. Shorten the date window to get complete results.`,
      !data.complete,
    );
  } catch (error) {
    if (generation !== state.generation || !authUser) return;
    state.data = null;
    $("#view").innerHTML =
      '<div class="empty"><h2>The query did not finish.</h2><p>Try a shorter date window, or press Apply dates to retry. No old results are shown for this selection.</p></div>';
    notify(error.message, true);
  } finally {
    if (generation === state.generation) {
      $("#view").setAttribute("aria-busy", "false");
      $("#view").inert = false;
    }
  }
}
function appName(id) {
  return state.catalog.find((app) => app.id === id)?.label ?? id;
}
function options(values, selected, blank = "All events") {
  return `<option value="">${escape(blank)}</option>${values.map((value) => `<option value="${escape(value)}"${value === selected ? " selected" : ""}>${escape(value)}</option>`).join("")}`;
}
function table(headers, rows) {
  return `<div class="table-scroll"><table><thead><tr>${headers.map((h) => `<th scope="col">${escape(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}
function empty(title, text) {
  return `<div class="empty"><h2>${escape(title)}</h2><p>${escape(text)}</p></div>`;
}
function section(title, extra = "") {
  return `<div class="section-head"><h2>${escape(title)}</h2>${extra}</div>`;
}

function chart(days, metric) {
  const width = 880,
    height = 240,
    left = 45,
    right = 15,
    top = 15,
    bottom = 40;
  const max = Math.max(1, ...days.map((day) => day[metric]));
  const x = (i) =>
    left + (i / Math.max(1, days.length - 1)) * (width - left - right);
  const y = (value) => top + (1 - value / max) * (height - top - bottom);
  const points = days.map((day, i) => `${x(i)},${y(day[metric])}`).join(" ");
  const ticks = [0, 0.5, 1]
    .map(
      (part) =>
        `<line x1="${left}" x2="${width - right}" y1="${y(max * part)}" y2="${y(max * part)}"/><text x="${left - 10}" y="${y(max * part) + 4}" text-anchor="end">${number(Math.round(max * part))}</text>`,
    )
    .join("");
  const labels = [
    ...new Set([0, Math.floor((days.length - 1) / 2), days.length - 1]),
  ]
    .map(
      (i) =>
        `<text x="${x(i)}" y="${height - 12}" text-anchor="${i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"}">${escape(days[i].day.slice(5))}</text>`,
    )
    .join("");
  return `<div class="chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily ${escape(metric)} counts. Exact values are available in the daily data table below.">${ticks}<polygon class="area" points="${left},${y(0)} ${points} ${x(days.length - 1)},${y(0)}"/><polyline class="line" points="${points}"/>${labels}</svg></div>`;
}
function overview(data) {
  const summary = `<dl class="summary">${[
    [`DAU · ${data.active.dauDate}`, data.active.dau],
    [`MAU · ${data.active.mauFrom.slice(0, 7)}`, data.active.mau],
    ["Sessions · selected window", data.summary?.sessions ?? null],
    ["Events · selected window", data.summary?.events ?? null],
  ]
    .map(
      ([label, value]) =>
        `<div><dt>${escape(label)}</dt><dd>${value === null ? "Unavailable" : number(value)}</dd></div>`,
    )
    .join(
      "",
    )}</dl><p class="hint">MAU: ${data.active.mauFrom} through ${data.active.mauTo}. Counts represent anonymous installations, scoped to each app.${data.active.mau === null ? " The monthly read exceeded the query limit; shorten the date scope before interpreting MAU." : ""}</p>`;
  if (!data.complete)
    return (
      summary +
      empty(
        "This window needs a closer look.",
        "Shorten the date window. Charts and window totals are only shown when the complete query fits within the read budget. Unfiltered DAU and current/full-month MAU use exact aggregates for directly ingested apps; federated Fuse Games scopes require a complete raw read.",
      )
    );
  if (!data.summary.events)
    return (
      summary +
      empty(
        "No activity in this selection yet.",
        "The backend is ready to receive events. Open Coverage to see which apps still need their transport migrated. Existing Mixpanel history is not included automatically.",
      )
    );
  const breakdown = `<label>Break down by<select id="breakdown">${["name", "appId", ...data.dimensions].map((key) => `<option value="${escape(key)}"${key === state.breakdown ? " selected" : ""}>${escape(key === "name" ? "Event" : key === "appId" ? "Application" : key)}</option>`).join("")}</select></label>`;
  const max = Math.max(1, ...data.groups.map((group) => group.events));
  const groups = table(
    ["Dimension", "Events", "Installations", "Sessions"],
    data.groups.map(
      (group) =>
        `<tr><td>${escape(state.breakdown === "appId" ? appName(group.label) : group.label)}</td><td class="bar-cell">${number(group.events)}<div class="bar"><span style="width:${(group.events / max) * 100}%"></span></div></td><td>${number(group.users)}</td><td>${number(group.sessions)}</td></tr>`,
    ),
  );
  const distributions = Object.entries(data.distributions)
    .map(([key, bins]) => {
      const total = bins.reduce((sum, bin) => sum + bin.count, 0);
      return `<div>${section(key === "eventsPerSession" ? "Events per session" : "Observed session span")}${table(
        [
          key === "eventsPerSession" ? "Events" : "Minutes",
          "Sessions",
          "Share",
        ],
        bins.map(
          (bin) =>
            `<tr><td>${escape(bin.label)}</td><td class="bar-cell">${number(bin.count)}<div class="bar"><span style="width:${total ? (bin.count / total) * 100 : 0}%"></span></div></td><td>${total ? ((bin.count / total) * 100).toFixed(1) : "0.0"}%</td></tr>`,
        ),
      )}</div>`;
    })
    .join("");
  const metricPicker = `<label>Daily measure<select id="chart-metric">${[
    ["events", "Events"],
    ["users", "Active installations"],
    ["sessions", "Sessions"],
  ]
    .map(
      ([value, label]) =>
        `<option value="${value}"${value === state.chartMetric ? " selected" : ""}>${label}</option>`,
    )
    .join("")}</select></label>`;
  return `${summary}${section("Activity over time", metricPicker)}<p class="hint">Counts per UTC day. Active installations and sessions are distinct counts over the selected window, not a sum of daily uniques.</p>${chart(data.days, state.chartMetric)}<details><summary>Show exact daily data</summary>${table(
    ["UTC day", "Events", "Installations", "Sessions"],
    data.days.map(
      (day) =>
        `<tr><td>${day.day}</td><td>${number(day.events)}</td><td>${number(day.users)}</td><td>${number(day.sessions)}</td></tr>`,
    ),
  )}</details><div class="distributions">${distributions}</div><p class="hint">Session span measures time between matching events in the window, not attention or total app runtime. Single-event sessions have a zero observed span.</p>${section("What people use", breakdown)}${groups}${section("Across the fleet")}${table(
    ["Application", "Events", "Installations", "Sessions", "Last event"],
    data.apps.map(
      (app) =>
        `<tr><td><button class="row-link" data-open-app="${escape(app.appId)}">${escape(appName(app.appId))}</button></td><td>${number(app.events)}</td><td>${number(app.users)}</td><td>${number(app.sessions)}</td><td>${date(app.lastSeen)}</td></tr>`,
    ),
  )}`;
}
function retention(data) {
  return `${section("Do installations come back?")}<p class="hint">${escape(data.retentionScope)} Event and property filters do not scope these cohorts; the application and dates do.</p>${
    data.retention
      ? table(
          ["Return day", "Eligible installations", "Returned", "Return rate"],
          data.retention.map(
            (row) =>
              `<tr><td>Day ${row.day}</td><td>${number(row.eligible)}</td><td>${number(row.returned)}</td><td>${row.rate === null ? "Not enough follow-up" : `${(row.rate * 100).toFixed(1)}%`}</td></tr>`,
          ),
        )
      : empty(
          "Return cohorts are unavailable.",
          "Shorten the window to obtain a complete read.",
        )
  }<p class="hint">A different browser or device is a different installation. Days that have not fully elapsed never count as failures to return.</p>`;
}
function funnels(data) {
  const currentApp = state.catalog.find((app) => app.id === state.appId);
  const defaults = state.funnel.length
    ? state.funnel
    : [currentApp?.start ?? "", currentApp?.finish ?? "", ""];
  const form = `<form id="funnel-form" class="inline-form">${[0, 1, 2].map((index) => `<label>Step ${index + 1}<select name="step">${options(data.eventNames, defaults[index], index > 1 ? "Optional next step" : "Choose an event")}</select></label>`).join("")}<button class="primary">Calculate funnel</button></form>`;
  const first = data.funnel?.[0]?.users ?? 0;
  return `${section("Where does the journey stop?")}<p class="hint">${escape(data.funnelScope)}</p>${form}${
    data.funnel?.length
      ? table(
          ["Step", "Installations", "Of first step"],
          data.funnel.map(
            (step, index) =>
              `<tr><td>${index + 1}. ${escape(step.name)}</td><td>${number(step.users)}</td><td>${first ? `${((step.users / first) * 100).toFixed(1)}%` : "No starts"}</td></tr>`,
          ),
        )
      : empty(
          "Choose the journey to investigate.",
          "For Atomify, try Simulation.Start → Simulation.Stop. Fuse Games uses fuse.Round Started → fuse.Round Ended. Select an app first to keep the interpretation clear.",
        )
  }`;
}
function sessionList(data) {
  return `${section("Sessions worth a closer look")}<p class="hint">Newest 100 sessions containing events that match this selection. The span is time between observed events, not measured attention or total app runtime.</p>${
    data.sessions.length
      ? table(
          [
            "Application / installation",
            "First seen in window",
            "Last seen",
            "Observed span",
            "Events",
            "",
          ],
          data.sessions.map(
            (row) =>
              `<tr><td>${escape(appName(row.appId))}<br><code>${escape(row.userId.slice(0, 12))}</code></td><td>${date(row.first)}</td><td>${date(row.last)}</td><td>${Math.round((row.last - row.first) / 60_000)} min</td><td>${number(row.events)}</td><td><button class="row-action" data-session="${escape(row.sessionId)}" data-session-app="${escape(row.appId)}">Open timeline</button></td></tr>`,
          ),
        )
      : empty(
          "No matching sessions.",
          "Change the date window or choose another app.",
        )
  }`;
}
function eventFilters(data) {
  return `<form id="event-filter" class="filter-row"><label>Event<select name="event">${options(data.eventNames, state.event)}</select></label><label>Property<select name="property">${options(data.dimensions, state.property, "Any property")}</select></label><label>Equals<input name="value" maxlength="160" value="${escape(state.value)}" placeholder="Exact property value"></label><button class="primary">Apply event filters</button><button type="button" id="clear-event-filter">Clear</button></form>`;
}
function rawEvents(data) {
  return `${section("The events behind the numbers", '<button id="export-events">Export these events</button>')}${eventFilters(data)}<p class="hint">Showing the newest ${number(data.events.length)} matching events${data.complete ? ` of ${number(data.selectedCount)}` : " within the scanned sample"}. Narrow the app, dates or event/property filters to inspect other slices.</p>${
    data.events.length
      ? table(
          ["UTC time", "Application", "Event", "Installation", "Properties"],
          data.events.map(
            (row) =>
              `<tr><td>${date(row.occurredAt)}</td><td>${escape(appName(row.appId))}</td><td>${escape(row.name)}</td><td><code>${escape(row.userId.slice(0, 12))}</code></td><td><details><summary>${Object.keys(row.properties).length} properties</summary><pre class="properties">${escape(JSON.stringify(row.properties, null, 2))}</pre></details></td></tr>`,
          ),
        )
      : empty(
          "No matching events.",
          "Clear the event filters or widen the date window.",
        )
  }`;
}
function coverage() {
  const labels = {
    "migration-pending": "Mixpanel migration pending",
    "instrumentation-pending": "Instrumentation pending",
    "existing-first-party": "Existing first-party service",
    "no-analytics-promise": "Published no-analytics promise",
    "inventory-pending": "Inventory pending",
  };
  return `${section("What is connected?")}<p class="hint">A catalog entry is not evidence of delivery. Fuse Games is read directly from its existing first-party metrics collection; other apps appear here as their transports are migrated. Historical Mixpanel data has not been imported.</p>${table(
    ["Application", "Family", "Migration state", "Observed events in window"],
    state.catalog.map((app) => {
      const observed = state.data?.apps?.find((row) => row.appId === app.id);
      return `<tr><td><button class="row-link" data-open-app="${escape(app.id)}">${escape(app.label)}</button></td><td>${escape(app.family)}</td><td><span class="status-label">${escape(labels[app.status] ?? app.status)}</span></td><td>${observed ? number(observed.events) : "Not observed in window"}</td></tr>`;
    }),
  )}<p class="hint">The pirate games currently publish a no-analytics privacy promise. Adding telemetry requires updating that product behavior and its disclosure together. Workalong is the rebranded TeslaCode product; legacy Mixpanel instrumentation is not treated as current coverage.</p>`;
}
function render() {
  const data = state.data;
  if (!data) return;
  if (
    ![
      "overview",
      "retention",
      "funnels",
      "sessions",
      "events",
      "coverage",
    ].includes(state.tab)
  )
    state.tab = "overview";
  $("#page-title").textContent = state.appId
    ? appName(state.appId)
    : "All applications";
  $("#apps").innerHTML = state.catalog
    .map(
      (app) =>
        `<button class="app-choice${app.id === state.appId ? " selected" : ""}" data-app="${escape(app.id)}">${escape(app.label)}</button>`,
    )
    .join("");
  document
    .querySelector('.app-choice[data-app=""]')
    .classList.toggle("selected", !state.appId);
  document.querySelectorAll("[data-tab]").forEach((button) => {
    if (button.dataset.tab === state.tab)
      button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  const views = {
    overview,
    retention,
    funnels,
    sessions: sessionList,
    events: rawEvents,
    coverage,
  };
  $("#view").innerHTML = views[state.tab](data);
}
async function openSession(appId, sessionId) {
  const generation = ++state.generation;
  notify("Loading the session timeline…");
  try {
    const params = new URLSearchParams({
      from: $("#from").value,
      to: $("#to").value,
      appId,
      sessionId,
    });
    const result = await api("/v1/session", params);
    if (generation !== state.generation || !authUser) return;
    $("#view").innerHTML =
      `<button id="back-sessions">Back to sessions</button>${section(`${appName(appId)} · Session timeline`)}<p class="hint">${result.complete ? "All events for this session within the selected UTC window." : "Partial timeline from the newest scanned events. Shorten the date window."} Installation ${escape(result.events[0]?.userId.slice(0, 12) ?? "unknown")}.</p><ol class="timeline">${result.events.map((event) => `<li><time datetime="${new Date(event.occurredAt).toISOString()}">${new Date(event.occurredAt).toISOString().slice(11, 19)}<br>${new Date(event.occurredAt).toISOString().slice(0, 10)}</time><div><strong>${escape(event.name)}</strong><pre class="properties">${escape(JSON.stringify(event.properties, null, 2))}</pre></div></li>`).join("")}</ol>`;
    notify(
      result.complete
        ? ""
        : "This timeline is incomplete because the window exceeds the read limit.",
      !result.complete,
    );
  } catch (error) {
    if (generation === state.generation) notify(error.message, true);
  }
}
function chooseApp(id) {
  state.appId = id;
  state.event = state.property = state.value = "";
  state.funnel = [];
  void load();
}
$(".fleet").addEventListener("click", (event) => {
  const target = event.target.closest("[data-app]");
  if (target) chooseApp(target.dataset.app);
});
$(".tabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-tab]");
  if (button) {
    state.tab = button.dataset.tab;
    if (state.data) {
      render();
      updateUrl();
    }
  }
});
$("#filters").addEventListener("submit", (event) => {
  event.preventDefault();
  state.event = state.property = state.value = "";
  void load();
});
$("#last-week").addEventListener("click", () => {
  setWindow(7);
  void load();
});
$("#last-month").addEventListener("click", () => {
  setWindow(28);
  void load();
});
$("#view").addEventListener("change", (event) => {
  if (event.target.id === "breakdown") {
    state.breakdown = event.target.value;
    void load();
  }
  if (event.target.id === "chart-metric") {
    state.chartMetric = event.target.value;
    render();
    $("#chart-metric").focus();
  }
});
$("#view").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  if (event.target.id === "event-filter")
    for (const key of ["event", "property", "value"])
      state[key] = String(form.get(key) ?? "");
  if (event.target.id === "funnel-form")
    state.funnel = form.getAll("step").map(String).filter(Boolean);
  void load();
});
$("#view").addEventListener("click", (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  if (target.dataset.openApp) chooseApp(target.dataset.openApp);
  if (target.dataset.session)
    void openSession(target.dataset.sessionApp, target.dataset.session);
  if (target.id === "back-sessions") {
    state.tab = "sessions";
    render();
  }
  if (target.id === "clear-event-filter") {
    state.event = state.property = state.value = "";
    void load();
  }
  if (target.id === "export-events" && state.data) {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            range: state.data.range,
            complete: state.data.complete,
            scope:
              "Newest displayed matching events, maximum 200; not a full-history export",
            events: state.data.events,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `analytics-${$("#from").value}-${$("#to").value}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
});
async function authenticated(user) {
  authUser = user;
  if (!user) {
    state.generation++;
    state.data = null;
    $("#view").replaceChildren();
    $("#apps").replaceChildren();
    $("#workspace").hidden = true;
    $("#sign-in-panel").hidden = false;
    $("#sign-out").hidden = true;
    $("#account-label").textContent = "Private workspace";
    return;
  }
  try {
    const me = await api("/v1/me");
    const { apps } = await api("/v1/apps");
    if (authUser !== user) return;
    state.catalog = apps;
    if (!apps.some((app) => app.id === state.appId)) state.appId = "";
    $("#account-label").textContent = me.email;
    $("#workspace").hidden = false;
    $("#sign-in-panel").hidden = true;
    $("#sign-out").hidden = false;
    await load();
  } catch (error) {
    $("#auth-status").textContent = error.message;
    await signOut();
  }
}
$("#sign-out").addEventListener("click", () => {
  void signOut();
});
async function boot() {
  // The synthetic fixture handshake exists only in the loopback-only QA server,
  // which is excluded from the deployable image. No production auth bypass.
  if (["127.0.0.1", "localhost"].includes(location.hostname)) {
    try {
      const response = await fetch("/__analytics_preview");
      if (response.ok && (await response.json()).synthetic === true) {
        apiOrigin = location.origin;
        tokenProvider = async () => "synthetic-owner-token-for-local-preview";
        signOut = async () => authenticated(null);
        $("#account-label").textContent = "Synthetic preview";
        $("#auth-status").textContent =
          "Synthetic fixture data. Local preview only.";
        const banner = document.createElement("div");
        banner.className = "notice";
        banner.textContent =
          "Synthetic preview · All activity shown here is generated test data.";
        $("#content").prepend(banner);
        $("#sign-in").addEventListener("click", () => {
          void authenticated({ preview: true });
        });
        await authenticated({ preview: true });
        return;
      }
    } catch {
      /* A normal local static server still requires real Google auth. */
    }
  }
  const response = await fetch(new URL("/v1/config", apiOrigin), {
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok)
    throw new Error(
      "The analytics service could not load. Refresh to try again.",
    );
  const config = await response.json();
  const [{ initializeApp }, auth] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js"),
  ]);
  const instance = auth.getAuth(initializeApp(config.firebase));
  await auth.setPersistence(instance, auth.inMemoryPersistence);
  tokenProvider = () => {
    if (!instance.currentUser) throw new Error("Sign in again");
    return instance.currentUser.getIdToken();
  };
  signOut = () => auth.signOut(instance);
  const provider = new auth.GoogleAuthProvider();
  provider.setCustomParameters({
    login_hint: "andershaf@gmail.com",
    prompt: "select_account",
  });
  $("#sign-in").addEventListener("click", async () => {
    $("#sign-in").disabled = true;
    $("#auth-status").textContent = "Waiting for Google sign-in…";
    try {
      await auth.signInWithPopup(instance, provider);
    } catch (error) {
      $("#auth-status").textContent = error.message;
    } finally {
      $("#sign-in").disabled = false;
    }
  });
  auth.onAuthStateChanged(instance, (user) => {
    void authenticated(user);
  });
}
boot().catch((error) => {
  $("#auth-status").textContent = error.message;
  $("#sign-in").disabled = true;
});
