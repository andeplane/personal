/* Local-only planning state. No booking requests, accounts or analytics. */
(() => {
  "use strict";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [
    ...root.querySelectorAll(selector),
  ];
  const storageKey = "mexico-couple-plan-v1";
  const taskIds = ["wedding", "arrival", "hotels", "extension", "diving"];
  const activities = {
    diving: {
      name: "Beginner diving for two",
      price: 5500,
      note: "Xico reference price · 4 December if wedding events allow; 6 December is the fallback.",
    },
    ruins: {
      name: "Ek’ Balam + an optional Xcanché swim",
      price: 0,
      note: "2 December · entry and local driver still to quote.",
    },
    kayak: {
      name: "Holbox sunrise kayak for two",
      price: 2000,
      note: "Three hours · weather dependent; followed by a very slow day.",
    },
  };
  const hotels = {
    caracol: "Villas Caracol · Holbox",
    zentik: "Zentik Project · Valladolid",
  };
  const state = {
    arrival: "direct",
    activities: { diving: true, ruins: true, kayak: false },
    hotels: { caracol: false, zentik: false },
    tasks: {},
    notes: "",
  };
  let storageAvailable = true;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (saved && typeof saved === "object") {
      state.arrival = saved.arrival === "gentle" ? "gentle" : "direct";
      for (const key of ["activities", "hotels"])
        for (const id of Object.keys(state[key]))
          if (typeof saved[key]?.[id] === "boolean")
            state[key][id] = saved[key][id];
      for (const id of taskIds) state.tasks[id] = saved.tasks?.[id] === true;
      if (typeof saved.notes === "string")
        state.notes = saved.notes.slice(0, 3000);
    }
  } catch {
    storageAvailable = false;
  }
  const esc = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (ch) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[ch],
    );
  const money = (value) => `MXN ${value.toLocaleString("en-US")}`;
  const active = (id) =>
    state.activities[id] && !(id === "ruins" && state.arrival === "gentle");
  const selectedActivities = () => Object.keys(activities).filter(active);
  function save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      storageAvailable = false;
    }
    $("#storage-status").textContent = storageAvailable
      ? "Your choices save in this browser. They are not shared or booked."
      : "Browser storage is unavailable. Your choices work for this visit; download the plan to keep them.";
  }
  function announce(message) {
    $("#action-status").textContent = message;
  }

  const dates = [
    ["Sat", "28", "Nov", "Saturday 28 November"],
    ["Sun", "29", "Nov", "Sunday 29 November"],
    ["Mon", "30", "Nov", "Monday 30 November"],
    ["Tue", "1", "Dec", "Tuesday 1 December"],
    ["Wed", "2", "Dec", "Wednesday 2 December"],
    ["Thu", "3", "Dec", "Thursday 3 December"],
    ["Fri", "4", "Dec", "Friday 4 December"],
    ["Sat", "5", "Dec", "Saturday 5 December"],
    ["Sun", "6", "Dec", "Sunday 6 December"],
    ["Mon", "7", "Dec", "Monday 7 December"],
    ["Tue", "8", "Dec", "Tuesday 8 December"],
  ];
  let dayIndex = 1;
  let placeId = "holbox";
  let map;
  let mapMarkers = {};
  function makeDay(place, title, sleep, morning, afternoon, evening) {
    return {
      place,
      title,
      sleep,
      periods: [
        ["Morning", morning],
        ["Afternoon", afternoon],
        ["Evening", evening],
      ],
    };
  }
  function days() {
    const gentle = state.arrival === "gentle";
    const paddle = active("kayak");
    const dive = active("diving");
    return [
      gentle
        ? makeDay(
            "Oslo → Cancún",
            "Land, eat, sleep.",
            "Cancún · suggested airport-area overnight",
            "KLM from Oslo 06:05, via Amsterdam. A long travel day; keep the rest very simple.",
            "Scheduled Cancún arrival 15:05. Clear immigration, collect bags and take a prearranged short transfer to an airport-area hotel.",
            "An easy dinner and an early night. Confirm tomorrow’s Holbox transfer and ferry arrangements with the hotel.",
          )
        : makeDay(
            "Oslo → Holbox",
            "A long journey to a slow place.",
            "Holbox · night 1 of 3",
            "KLM from Oslo 06:05, via Amsterdam. Keep essentials and a change of clothes in your cabin bag.",
            "Scheduled Cancún arrival 15:05. Immigration and bags first, then a hotel-arranged 2–3 hour road transfer to Chiquilá and a 20–30 minute ferry.",
            "Likely a late arrival once you include the island taxi. Arrange dinner or a snack with the hotel. Confirm a delayed-flight fallback; do not rely on making a particular ferry.",
          ),
      gentle
        ? makeDay(
            "Cancún → Holbox",
            "Now, island time.",
            "Holbox · night 1 of 3",
            "Breakfast, then a prebooked transfer to Chiquilá. Take a ferry with plenty of slack rather than racing the clock.",
            "Island taxi to the hotel. Settle in, have lunch and make your first visit to the beach.",
            "A quiet drink and dinner by the water. Nothing else to organise tonight.",
          )
        : makeDay(
            "Holbox",
            "Our first barefoot day.",
            "Holbox · night 2 of 3",
            "Sleep until you wake up. Breakfast without a departure time, then a beach wander near the hotel.",
            "Find a comfortable spot, swim if conditions are good, read, nap and spend time together. Leave the phone in the room for a while.",
            "Head towards Punta Cocos for sunset if you feel like an outing, with a golf-cart taxi back if needed. Or simply stay at the hotel for dinner.",
          ),
      makeDay(
        "Holbox",
        paddle
          ? "Sunrise, then absolutely nothing."
          : "No reservations, no rush.",
        gentle ? "Holbox · night 2 of 3" : "Holbox · night 3 of 3",
        paddle
          ? "Optional guided sunrise kayak, about 06:00–09:00. Confirm the meeting point, weather and what to bring. Breakfast afterwards."
          : "A slow breakfast and a beach walk. If you want a bicycle, ask the hotel about conditions and a short easy route.",
        "A long lunch, some shade and a private afternoon together. This is deliberately empty.",
        "Choose a place for a drink and let dinner take its time. No need to chase a bioluminescence trip; visibility depends on conditions and the moon.",
      ),
      gentle
        ? makeDay(
            "Holbox",
            "One more island morning.",
            "Holbox · night 3 of 3",
            "Enjoy a final full island day. Breakfast, beach and a short walk or bicycle ride if the streets are in good condition.",
            "Stay close to the hotel. A swim, a nap and perhaps a relaxed lunch with a view.",
            "A sunset drink and an early dinner. Confirm tomorrow’s ferry and onward shuttle; keep the morning easy.",
          )
        : makeDay(
            "Holbox → Valladolid",
            "From sea air to the garden.",
            "Valladolid · night 1 of 2",
            "Breakfast, then ferry to Chiquilá and a reserved onward shuttle. Leave time between the ferry and shuttle; do not plan a tight connection.",
            "Check in to the suggested Zentik Project, unpack and spend time in the garden or cave pool. Valladolid’s clock is one hour behind Holbox.",
            "A gentle wander in town if you want it, followed by dinner. Save the ruins for tomorrow rather than adding a stop on transfer day.",
          ),
      gentle
        ? makeDay(
            "Holbox → Valladolid",
            "A small inland interlude.",
            "Valladolid · one suggested night",
            "Ferry to Chiquilá, then the prebooked shuttle to Valladolid. Check the time zone used on your ticket.",
            "Settle into the hotel. With just one inland night, choose the cave pool and perhaps a gentle town walk instead of a ruins excursion.",
            "A long dinner and time together. There is no full sightseeing day in this version; keep tomorrow’s wedding transfer straightforward.",
          )
        : active("ruins")
          ? makeDay(
              "Valladolid · Ek’ Balam",
              "A little history. A cool dip.",
              "Valladolid · night 2 of 2",
              "Arrange a local driver for Ek’ Balam near the 08:00 opening. Bring water and comfortable shoes; take the ruins at your own pace.",
              "If you feel like it, follow the path to nearby Xcanché for a swim. Return to Valladolid without adding another ruin site or cenote.",
              "Hotel time, a relaxed dinner and perhaps a dip in Zentik’s warm cave pool. Leave the evening entirely yours.",
            )
          : makeDay(
              "Valladolid",
              "Stay in the garden.",
              "Valladolid · night 2 of 2",
              "Breakfast, a gentle town walk and a coffee. There is no outing to make it to today.",
              "Hotel pool, shade and time together. Zentik’s cave pool is a good reason to do very little.",
              "A slow dinner and an early night, or simply stay at the hotel. You have made space by leaving out the ruins.",
            ),
      makeDay(
        "Valladolid → Playa del Carmen",
        "Settle in for the wedding.",
        "The Fives Beach · provisional start of wedding stay",
        "Breakfast, then a prebooked road transfer to The Fives Beach. Confirm travel time and the check-in arrangement; Playa’s clock is one hour ahead.",
        "Check in, unpack and leave space for any welcome events. The exact 3–6 December stay dates still need confirming.",
        "Catch up with the wedding crowd, or find a little time for the two of you if the programme is quiet.",
      ),
      makeDay(
        "Playa del Carmen",
        dive ? "A first look under the surface?" : "A slow day by the sea.",
        "The Fives Beach · wedding stay assumed",
        dive
          ? "Only if wedding events allow: Xico’s beginner introduction, normally starting around 09:30. Arrange the transfer from the hotel and complete medical screening in advance."
          : "Breakfast, a beach walk and no fixed activity. Keep this day available for the wedding programme.",
        dive
          ? "Confined-water practice and two ocean dives. The introduction lasts about 5–6 hours, so treat it as a substantial day out. If it conflicts with events, ask about Sunday 6 instead."
          : "Pool time, a long lunch and time together. You do not need to replace diving with another excursion.",
        "An easy evening with space for wedding events. If you dive today, leave the rest of the day light.",
      ),
      makeDay(
        "The wedding · Saturday 5 December",
        "A day for love.",
        "The Fives Beach · wedding stay assumed",
        "A slow start and plenty of time to get ready. Follow the couple’s programme; no excursion today.",
        "Celebrate the wedding. Keep transfers, sightseeing and diving out of the schedule.",
        "Dinner, dancing and a beautiful evening. The only plan is to enjoy it.",
      ),
      makeDay(
        "Playa del Carmen",
        "Stay a little longer.",
        "Coast · suggested extension, not booked",
        "Sleep in. If The Fives can extend the stay, avoid packing and changing hotels. Otherwise arrange the next two nights nearby.",
        dive
          ? "A recovery day by default. Sunday is a fallback dive day only if Friday did not work, you are well rested, and the operator confirms a suitable schedule. No need to dive twice."
          : "An unplanned afternoon for the pool, beach and a long lunch.",
        "A quiet dinner for two after the wedding festivities. Monday and Tuesday remain free of scuba.",
      ),
      makeDay(
        "Playa del Carmen",
        "One last completely free day.",
        "Coast · final suggested night",
        "Breakfast and a beach walk. No scuba today; preserve a generous interval before tomorrow’s flight.",
        "Swim, read, nap and spend time together. Resist a long excursion just because it is the final full day.",
        "Choose a lovely final dinner, pack a little and confirm tomorrow’s airport transfer.",
      ),
      makeDay(
        "Playa del Carmen → Oslo",
        "One more breakfast together.",
        "Overnight flight · Oslo arrival Wednesday 9 December",
        "An easy breakfast and check-out. Book the airport transfer with a generous buffer for road traffic and KLM’s check-in requirements.",
        "Scheduled KLM departure from Cancún at 16:55, via Amsterdam. Keep essentials and warm clothes accessible.",
        "Overnight flight. Ticket schedule: Amsterdam 08:30 on Wednesday, onward 09:55, Oslo arrival 11:45. Recheck the airline’s latest schedule before travelling.",
      ),
    ];
  }
  function stopData() {
    return state.arrival === "direct"
      ? [
          [
            "Holbox",
            "28 Nov – 1 Dec · 3 nights",
            "Barefoot days, beach & drinks",
          ],
          ["Valladolid", "1–3 Dec · 2 nights", "Garden, ruins & a cenote"],
          [
            "Wedding coast",
            "3–8 Dec · 5 nights",
            "3 wedding nights + 2 to arrange",
          ],
        ]
      : [
          ["Cancún", "28–29 Nov · 1 night", "A gentle first evening"],
          ["Holbox", "29 Nov – 2 Dec · 3 nights", "Three island nights, still"],
          ["Valladolid", "2–3 Dec · 1 night", "Hotel pool & an easy evening"],
          [
            "Wedding coast",
            "3–8 Dec · 5 nights",
            "3 wedding nights + 2 to arrange",
          ],
        ];
  }
  const placeData = {
    holbox: {
      title: "A few days without a car.",
      coords: [21.523, -87.377],
      zoom: 12,
      copy: "Beach, shallow sea, long lunches and sunset at Punta Cocos. Walk or take a golf-cart taxi; use a bicycle for a small outing if the streets are in good shape.",
      note: "Car-free for private visitor cars, with golf-cart traffic. A Holbox stay is for switching off; diving fits better from the wedding coast.",
      query: "Isla Holbox Mexico",
    },
    valladolid: {
      title: "A little Yucatán, inland.",
      coords: [20.689, -88.202],
      zoom: 11,
      copy: "A small hotel, a warm cave pool and time together. With two nights, add Ek’ Balam and an optional Xcanché swim. With one night, enjoy the hotel and keep the outing for another trip.",
      note: "A local driver makes the outing simple. If you prefer a rental car, confirm pickup and drop-off arrangements before depending on them.",
      query: "Valladolid Yucatan Mexico",
    },
    playa: {
      title: "The wedding, then stay put.",
      coords: [20.652, -87.042],
      zoom: 12,
      copy: "The Fives Beach is the wedding base in your email thread. The proposed plan arrives Thursday 3 December, celebrates on Saturday 5, then stays on the coast until Tuesday.",
      note: "Confirm the exact booked dates. A two-night extension for 6–8 December is a suggestion and still needs arranging.",
      query: "The Fives Beach Hotel Playa del Carmen Mexico",
    },
  };
  function renderPlace() {
    const p = placeData[placeId];
    const d = stopData().find(
      (x) =>
        x[0] ===
        { holbox: "Holbox", valladolid: "Valladolid", playa: "Wedding coast" }[
          placeId
        ],
    );
    for (const tab of $$("[data-place]")) {
      const on = tab.dataset.place === placeId;
      tab.setAttribute("aria-selected", on);
      tab.tabIndex = on ? 0 : -1;
    }
    $("#place-detail").setAttribute("aria-labelledby", `place-tab-${placeId}`);
    $("#place-detail").innerHTML =
      `<h3>${p.title}</h3><p class="place-dates">${esc(d[1])}${placeId === "playa" ? " · dates provisional" : " · suggested"}</p><p>${p.copy}</p><p class="place-detail-note">${p.note}</p><a class="map-link" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.query)}" target="_blank" rel="noopener noreferrer">Open this area in Maps ↗</a>`;
  }
  function selectPlace(id, pan = true) {
    placeId = id;
    renderPlace();
    decorateIcons();
    if (map && pan)
      map.setView(placeData[id].coords, placeData[id].zoom, {
        animate: !matchMedia("(prefers-reduced-motion: reduce)").matches,
      });
  }
  function setupMap() {
    if (!window.L) return;
    const root = $("#trip-map");
    root.innerHTML = "";
    map = L.map(root, { scrollWheelZoom: false, zoomControl: true }).setView(
      [21.08, -87.55],
      8,
    );
    map.zoomControl.setPosition("topright");
    const tiles = L.tileLayer(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 18,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    ).addTo(map);
    let tileError = false;
    tiles.on("tileerror", () => {
      if (!tileError) {
        tileError = true;
        $(".map-caption").textContent =
          "Base map unavailable. Place tabs and Maps links still work; lines only connect the stops.";
      }
    });
    const points = [
      placeData.holbox.coords,
      [21.399, -87.339],
      placeData.valladolid.coords,
      placeData.playa.coords,
    ];
    L.polyline(points, {
      color: "#127d8c",
      weight: 3,
      opacity: 0.85,
      dashArray: "7 8",
    }).addTo(map);
    for (const [id, p] of Object.entries(placeData)) {
      const index = ["holbox", "valladolid", "playa"].indexOf(id) + 1;
      const icon = L.divIcon({
        className: "",
        html: `<span class="map-pin ${id === "holbox" ? "island" : id === "valladolid" ? "inland" : ""}">${index}</span>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });
      mapMarkers[id] = L.marker(p.coords, {
        icon,
        title: p.query,
        alt: p.query,
      })
        .addTo(map)
        .bindPopup(
          `<strong>${esc(p.query)}</strong><br>Explore this base in the panel.`,
        )
        .on("click", () => selectPlace(id, false));
    }
    L.circleMarker([21.0365, -86.8771], {
      radius: 5,
      color: "#0f2f44",
      fillOpacity: 0.8,
      weight: 1,
    })
      .addTo(map)
      .bindTooltip("Cancún airport");
    map.fitBounds(
      [
        [20.55, -88.3],
        [21.62, -86.78],
      ],
      { padding: [25, 25] },
    );
  }
  function renderRoute() {
    $$("input[name=arrival]").forEach((input) => {
      input.checked = input.value === state.arrival;
    });
    $("#arrival-note").innerHTML =
      state.arrival === "direct"
        ? 'The fuller route, with two inland nights. After the 15:05 landing, the transfer and ferry make this a long evening. Ask the Holbox hotel to arrange the complete journey and a delayed-flight fallback. <a href="https://www.holboxexpressferry.com/fares-departures" target="_blank" rel="noopener noreferrer">Check ferry times ↗</a>'
        : "The gentler arrival: one airport-area night, then Holbox. To keep three island nights and reach the wedding on Thursday, Valladolid becomes one night. The ruins outing is left out.";
    $("#route-stops").innerHTML = stopData()
      .map(
        ([name, date, desc]) =>
          `<div class="route-stop${name === "Cancún" ? " optional" : ""}"><strong>${esc(name)}</strong><span class="stop-dates">${esc(date)}</span><span class="stop-description">${esc(desc)}</span></div>`,
      )
      .join("");
    $("[data-stay-dates=caracol]").textContent =
      `Suggested enquiry: ${state.arrival === "direct" ? "28 November–1 December" : "29 November–2 December"} · 3 nights · availability and rate to check.`;
    $("[data-stay-dates=zentik]").textContent =
      `Suggested enquiry: ${state.arrival === "direct" ? "1–3 December · 2 nights" : "2–3 December · 1 night"} · availability and rate to check.`;
    $("#ruins-availability").textContent =
      state.arrival === "direct"
        ? "Fits the two-night Valladolid stay. Chichén Itzá is an alternative if you especially want the famous pyramid; choose one ruin site."
        : "Left out with a one-night Valladolid stay. Switch to “Straight to Holbox” to make room for a full inland outing.";
    renderPlace();
  }
  function renderDay() {
    const day = days()[dayIndex];
    const date = dates[dayIndex];
    for (const tab of $$(".day-tab")) {
      const on = Number(tab.dataset.day) === dayIndex;
      tab.setAttribute("aria-selected", on);
      tab.tabIndex = on ? 0 : -1;
    }
    $("#day-panel").setAttribute("aria-labelledby", `day-${dayIndex}`);
    $("#day-panel").innerHTML =
      `<div><h3>${esc(day.title)}</h3><p class="day-location">${esc(day.place)}</p><p class="day-sleep">${esc(day.sleep)}</p></div><div>${day.periods.map(([time, copy]) => `<div class="day-time"><strong>${time}</strong><p>${esc(copy)}</p></div>`).join("")}</div>`;
    $("#previous-day").disabled = dayIndex === 0;
    $("#next-day").disabled = dayIndex === dates.length - 1;
    $("#day-position").textContent =
      `${date[0]} ${date[1]} ${date[2]} · ${dayIndex + 1} of 11`;
  }
  function chooseDay(index, focus = false) {
    dayIndex = Math.max(0, Math.min(dates.length - 1, index));
    renderDay();
    const tab = $(`#day-${dayIndex}`);
    if (focus) tab.focus({ preventScroll: true });
    if ($("#day-tabs").scrollWidth > $("#day-tabs").clientWidth)
      $("#day-tabs").scrollTo({
        left: Math.max(0, tab.offsetLeft - $("#day-tabs").offsetLeft - 65),
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
  }
  function renderChoices() {
    for (const button of $$("[data-activity]")) {
      const id = button.dataset.activity;
      button.disabled = id === "ruins" && state.arrival === "gentle";
      const on = active(id);
      button.setAttribute("aria-pressed", on);
      $(".choice-symbol", button).innerHTML = icon(on ? "✓" : "+");
      $(".choice-label", button).textContent = button.disabled
        ? "Needs two inland nights"
        : on
          ? "In our plan"
          : "Add to our plan";
      button.setAttribute(
        "aria-label",
        `${button.disabled ? "Unavailable with one inland night" : on ? "Remove from our plan" : "Add to our plan"}: ${activities[id].name}`,
      );
    }
    for (const button of $$("[data-hotel]")) {
      const on = state.hotels[button.dataset.hotel];
      button.setAttribute("aria-pressed", on);
      $("span", button).textContent = on ? "Hotel saved" : "Save hotel";
      button.setAttribute(
        "aria-label",
        `${on ? "Remove saved hotel" : "Save hotel"}: ${hotels[button.dataset.hotel]}`,
      );
    }
  }
  function printMarkup() {
    const selected = selectedActivities();
    const itinerary = days();
    return `<h2>28 November–8 December 2026</h2><p class="print-meta">${stopData()
      .map((x) => `${esc(x[0])}: ${esc(x[1])}`)
      .join(
        "<br>",
      )}<br>Wedding 5 December. Wedding hotel dates are provisional. Extra coastal nights are not booked. Oslo arrival 9 December 11:45, from ticket schedule.</p><h2>Our days</h2>${itinerary.map((day, i) => `<div class="print-day"><h3>${dates[i][3]} · ${esc(day.title)}</h3><p><strong>${esc(day.place)}</strong> · ${esc(day.sleep)}</p>${day.periods.map(([t, c]) => `<p><strong>${t}:</strong> ${esc(c)}</p>`).join("")}</div>`).join("")}<h2>Shortlist</h2><p>${selected.length ? selected.map((id) => `${esc(activities[id].name)}${activities[id].price ? ` (${money(activities[id].price)})` : " (quote needed)"}`).join("<br>") : "Beach, time together and the wedding; no optional outings selected."}</p><p>Hotels saved: ${
      Object.keys(hotels)
        .filter((id) => state.hotels[id])
        .map((id) => esc(hotels[id]))
        .join("; ") || "none yet"
    }. Hotel quotes and availability not checked.</p>${state.notes ? `<h2>Our notes</h2><p style="white-space:pre-wrap">${esc(state.notes)}</p>` : ""}<h2>Things still to settle</h2><ul>${taskIds.map((id) => `<li>${state.tasks[id] ? "Done: " : "To do: "}${esc($(`[data-task=${id}]`).nextElementSibling.textContent)}</li>`).join("")}</ul><p class="print-meta">Research checked 4 November 2026. Prices are published references in MXN, not confirmed quotes. No scuba on 7–8 December; allow at least 24 hours before flying, or longer if instructed. Sources: mexicancaribbean.travel · villascaracol.com · hotelzentik.com · lugares.inah.gob.mx · yucatan.travel · xicodivecenter.com · kayakingholbox.com · dan.org. Full links are in the local guide.</p>`;
  }
  function renderPlan() {
    $("#selected-route").textContent = stopData()
      .map((x) => `${x[0]} · ${x[1]}`)
      .join(" → ");
    const selected = selectedActivities();
    $("#selected-activities").innerHTML = selected.length
      ? selected
          .map(
            (id) =>
              `<li>${esc(activities[id].name)}<small>${esc(activities[id].note)}</small></li>`,
          )
          .join("")
      : '<li class="empty-state">Just the beach, time together and the wedding. That works too.</li>';
    const total = selected.reduce((sum, id) => sum + activities[id].price, 0);
    $("#activity-total").textContent = total
      ? `Priced activities: ${money(total)} for two${active("ruins") ? ", plus ruins entry and a driver to quote" : ""}. This is not the total trip budget; hotels, meals and transfers are extra.`
      : active("ruins")
        ? "Ruins entry and a driver still need quotes. No other priced activities selected."
        : "No priced activities selected. Hotels, meals and transfers still need budgeting.";
    const savedHotels = Object.keys(hotels).filter((id) => state.hotels[id]);
    $("#selected-hotels").innerHTML = savedHotels.length
      ? savedHotels
          .map(
            (id) =>
              `<li>${hotels[id]}<small>Shortlisted only · direct quote and availability still to check.</small></li>`,
          )
          .join("")
      : '<li class="empty-state">No hotel saved yet. Use “Save hotel” above to keep a favourite here.</li>';
    $("#print-itinerary").innerHTML = printMarkup();
  }
  function planText() {
    const lines = [
      "MEXICO, JUST US — Anders & Ingrid",
      "28 November–8 December 2026 · Oslo arrival 9 December",
      "",
      "SUGGESTED ROUTE",
      ...stopData().map((x) => `${x[0]}: ${x[1]}`),
      "Wedding 5 December. Wedding stay 3–6 December is provisional; 6–8 December extension not booked.",
      "",
      "DAY BY DAY",
    ];
    days().forEach((day, i) => {
      lines.push(
        "",
        `${dates[i][3]} — ${day.title}`,
        `${day.place}. Sleep: ${day.sleep}`,
        ...day.periods.map(([t, c]) => `${t}: ${c}`),
      );
    });
    lines.push(
      "",
      "OPTIONAL ACTIVITIES",
      ...(selectedActivities().length
        ? selectedActivities().map(
            (id) =>
              `${activities[id].name}${activities[id].price ? ` — ${money(activities[id].price)} for two` : " — quote needed"}. ${activities[id].note}`,
          )
        : ["None selected. Beach, time together and the wedding."]),
      $("#activity-total").textContent,
      "",
      "SAVED HOTELS",
      ...(Object.keys(hotels)
        .filter((id) => state.hotels[id])
        .map((id) => hotels[id]).length
        ? Object.keys(hotels)
            .filter((id) => state.hotels[id])
            .map((id) => hotels[id])
        : ["None yet."]),
      "",
      "TO SETTLE",
      ...taskIds.map(
        (id) =>
          `[${state.tasks[id] ? "x" : " "}] ${$(`[data-task=${id}]`).nextElementSibling.textContent}`,
      ),
      "",
      "OUR NOTES",
      state.notes || "(none yet)",
      "",
      "Research checked 4 November 2026. Reference prices, not quotes. Hotel availability unchecked.",
      "Ticket schedule: OSL 28 Nov 06:05 → AMS 08:05; AMS 09:50 → CUN 15:05. Return 8 Dec CUN 16:55 → AMS 9 Dec 08:30; AMS 09:55 → OSL 11:45. Recheck with KLM.",
      "No scuba on 7–8 December. Allow at least 24 hours after the last dive before flying, or longer if instructed.",
      "",
      "SOURCES",
      ...new Set($$('.sources a[href^="http"]').map((a) => a.href)),
    );
    return lines.join("\n");
  }
  const iconPaths = {
    "↗": "M5 19 19 5M5 5h14v14",
    "↓": "M12 4v16M5 13l7 7 7-7",
    "←": "M20 12H4m7-7-7 7 7 7",
    "→": "M4 12h16m-7-7 7 7-7 7",
    "+": "M5 12h14M12 5v14",
    "✓": "m5 12 4 4L19 6",
  };
  function icon(symbol) {
    return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${iconPaths[symbol]}"/></svg>`;
  }
  function decorateIcons() {
    for (const element of $$("a,button")) {
      if (element.closest(".leaflet-container")) continue;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode())
        if (/[↗↓←→]/.test(walker.currentNode.textContent))
          nodes.push(walker.currentNode);
      for (const node of nodes) {
        const replacement = document.createElement("span");
        replacement.innerHTML = esc(node.textContent).replace(
          /[↗↓←→]/g,
          (symbol) => icon(symbol),
        );
        node.replaceWith(replacement);
      }
    }
  }
  function refresh() {
    renderRoute();
    renderDay();
    renderChoices();
    renderPlan();
    decorateIcons();
    save();
  }

  $("#day-tabs").innerHTML = dates
    .map(
      (date, i) =>
        `<button class="day-tab" id="day-${i}" type="button" role="tab" data-day="${i}" aria-controls="day-panel" aria-label="${date[3]}" aria-selected="${i === dayIndex}" tabindex="${i === dayIndex ? 0 : -1}"><span>${date[0]}</span><strong>${date[1]}</strong><span>${date[2]}</span></button>`,
    )
    .join("");
  for (const radio of $$("input[name=arrival]"))
    radio.addEventListener("change", () => {
      state.arrival = radio.value;
      refresh();
      announce("Arrival plan updated across the route, days and shortlist.");
    });
  for (const tab of $$("[data-day]"))
    tab.addEventListener("click", () => chooseDay(Number(tab.dataset.day)));
  $("#day-tabs").addEventListener("keydown", (event) => {
    const keys = {
      ArrowRight: dayIndex + 1,
      ArrowLeft: dayIndex - 1,
      Home: 0,
      End: 10,
    };
    if (Object.hasOwn(keys, event.key)) {
      event.preventDefault();
      chooseDay(keys[event.key], true);
    }
  });
  $("#previous-day").addEventListener("click", () => chooseDay(dayIndex - 1));
  $("#next-day").addEventListener("click", () => chooseDay(dayIndex + 1));
  for (const tab of $$("[data-place]"))
    tab.addEventListener("click", () => selectPlace(tab.dataset.place));
  $(".place-tabs").addEventListener("keydown", (event) => {
    const ids = ["holbox", "valladolid", "playa"];
    const index = ids.indexOf(placeId);
    const target = {
      ArrowRight: (index + 1) % 3,
      ArrowLeft: (index + 2) % 3,
      Home: 0,
      End: 2,
    }[event.key];
    if (target !== undefined) {
      event.preventDefault();
      selectPlace(ids[target]);
      $(`#place-tab-${ids[target]}`).focus();
    }
  });
  for (const button of $$("[data-activity]"))
    button.addEventListener("click", () => {
      const id = button.dataset.activity;
      state.activities[id] = !state.activities[id];
      refresh();
      announce(
        `${activities[id].name} ${active(id) ? "added to" : "removed from"} our plan.`,
      );
    });
  for (const button of $$("[data-hotel]"))
    button.addEventListener("click", () => {
      const id = button.dataset.hotel;
      state.hotels[id] = !state.hotels[id];
      renderChoices();
      renderPlan();
      save();
      announce(`${hotels[id]} ${state.hotels[id] ? "saved" : "removed"}.`);
    });
  for (const input of $$("[data-task]")) {
    input.checked = state.tasks[input.dataset.task] === true;
    input.addEventListener("change", () => {
      state.tasks[input.dataset.task] = input.checked;
      renderPlan();
      save();
    });
  }
  $("#trip-notes").value = state.notes;
  $("#trip-notes").addEventListener("input", (event) => {
    state.notes = event.target.value.slice(0, 3000);
    save();
  });
  $("#copy-plan").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(planText());
      announce("Itinerary copied. Paste it into a message or a note.");
    } catch {
      announce(
        "Clipboard access was unavailable. Use “Download text” to keep the itinerary.",
      );
    }
  });
  $("#download-plan").addEventListener("click", () => {
    const url = URL.createObjectURL(
      new Blob([planText()], { type: "text/plain;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "Mexico-Anders-Ingrid-2026.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    announce("Itinerary downloaded as a text file.");
  });
  $("#print-plan").addEventListener("click", () => {
    renderPlan();
    window.print();
  });
  window.addEventListener("beforeprint", renderPlan);
  refresh();
  setupMap();
})();
