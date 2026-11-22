"use strict";

const byId = id => document.getElementById(id);
const sections = ["overview", "budget"];

function navigate() {
  const section = location.hash === "#budget" ? "budget" : "overview";
  for (const name of sections) {
    byId(name).hidden = name !== section;
    const link = document.querySelector(`nav a[href="#${name}"]`);
    if (name === section) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

window.addEventListener("hashchange", navigate);
navigate();

function calendarMonths(first, last) {
  const months = [];
  const firstOfMonth = new Date(first.slice(0, 7) + "-01T00:00:00Z");
  const end = new Date(last + "T00:00:00Z");
  while (firstOfMonth <= end) {
    months.push(firstOfMonth.toISOString().slice(0, 7));
    firstOfMonth.setUTCMonth(firstOfMonth.getUTCMonth() + 1);
  }
  return months;
}

function start({accounts, transactions, expectedBills = []}) {
  const account = byId("account");
  const period = byId("period");
  const basis = byId("basis");
  const category = byId("category");
  const recurrence = byId("recurrence");
  const accountNames = new Map(accounts.map(item => [item.id, item.name]));
  const format = new Intl.NumberFormat("en-GB", {style: "currency", currency: "NOK", currencyDisplay: "code"});
  const monthFormat = new Intl.DateTimeFormat("en-GB", {month: "short", timeZone: "UTC"});
  const kr = value => format.format(value / 100);
  const sum = rows => rows.reduce((total, row) => total + row.amount, 0);
  const isRecurring = row => row.cadence === "Recurring";
  const isExpense = row => row.flow === "expense";
  const net = rows => sum(account.value ? rows : rows.filter(row => row.flow !== "internal"));
  const firstDate = accounts.map(item => item.firstTransaction).sort()[0];
  const latestSnapshot = accounts.map(item => item.snapshot).sort().at(-1);
  const months = calendarMonths(firstDate, latestSnapshot).reverse();
  const years = [...new Set(months.map(month => month.slice(0, 4)))];
  const pageSize = 50;
  let selected = [];
  let visibleCount = pageSize;
  const sortButtons = document.querySelectorAll("button[data-sort]");
  let sortKey = "monthly";
  let sortOrder = "descending";
  let categoryAmounts = [];
  let categoryEmpty = "";
  let flexibleOnly = false;
  let chartCategories;
  let customChart = false;
  let chartMonth;

  for (const item of accounts) account.add(new Option(item.name, item.id));
  for (const year of years) period.add(new Option(`All of ${year}`, year));
  for (const month of months) period.add(new Option(month, month));
  byId("coverage").textContent = `· Latest export ${latestSnapshot}`;

  function cell(value, className) {
    const element = document.createElement("td");
    if (value instanceof Node) element.append(value);
    else element.textContent = value;
    if (className) element.className = className;
    return element;
  }

  const numberCell = (value, signed = false) => cell(kr(value), signed && value < 0 ? "num negative" : "num");

  function fill(id, rows, span, empty) {
    const table = byId(id);
    table.replaceChildren();
    if (rows.length === 0) {
      const blank = table.insertRow().insertCell();
      blank.colSpan = span;
      blank.textContent = empty;
      return;
    }
    for (const cells of rows) table.insertRow().append(...cells);
  }

  function group(rows, key) {
    const groups = new Map();
    for (const row of rows) {
      const name = key(row);
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(row);
    }
    return [...groups.entries()];
  }

  function updateChart(rows, chartMonths) {
    const series = group(rows, row => row.category).sort((a, b) => sum(a[1]) - sum(b[1]));
    if (!customChart) chartCategories = new Set(series.slice(0, 4).map(([name]) => name));
    const monthTotals = new Map(chartMonths.map(month => [month, new Map()]));
    for (const row of rows) {
      const totals = monthTotals.get(row.date.slice(0, 7));
      if (totals) totals.set(row.category, (totals.get(row.category) || 0) - row.amount);
    }
    const options = byId("chart-choices");
    options.replaceChildren();
    const legendTitle = document.createElement("legend");
    legendTitle.textContent = "Categories to compare";
    options.append(legendTitle);
    for (const [name] of series.slice().sort((a, b) => a[0].localeCompare(b[0], "en"))) {
      const label = document.createElement("label");
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = chartCategories.has(name);
      check.addEventListener("change", () => {
        customChart = true;
        if (check.checked) chartCategories.add(name);
        else chartCategories.delete(name);
        render();
      });
      label.append(check, " " + name);
      options.append(label);
    }

    function render() {
      const names = [...chartCategories].filter(name => series.some(([n]) => name === n));
      const hue = index => String(Math.round((145 + index * 137.51) % 360));
      const legend = byId("chart-legend");
      const bars = byId("chart-bars");
      const detail = byId("chart-detail");
      legend.replaceChildren();
      bars.replaceChildren();
      if (!names.length) {
        detail.textContent = series.length ? "Choose a category with spending in this selection." : "No booked spending in this selection.";
        return;
      }
      names.forEach((name, index) => {
        const label = document.createElement("span");
        const dot = document.createElement("i");
        dot.style.setProperty("--hue", hue(index));
        label.append(dot, name);
        legend.append(label);
      });
      const values = chartMonths.map(month => names.map(name => monthTotals.get(month).get(name) || 0));
      const totals = values.map(parts => parts.reduce((a, b) => a + b, 0));
      const peak = Math.max(...totals, 1);
      const axis = document.createElement("div");
      axis.className = "chart-axis";
      for (const tick of [peak, peak / 2, 0]) {
        const text = document.createElement("span");
        text.textContent = Math.round(tick / 100).toLocaleString("en-GB");
        axis.append(text);
      }
      bars.append(axis);
      if (!chartMonths.includes(chartMonth)) chartMonth = chartMonths.at(-1);
      function inspect(month, index) {
        chartMonth = month;
        for (const bar of bars.querySelectorAll("button")) bar.setAttribute("aria-pressed", String(bar.dataset.month === month));
        detail.textContent = [month, "Total " + kr(totals[index]), ...names.map((name, i) => name + " " + kr(values[index][i]))].join(" · ");
      }
      chartMonths.forEach((month, index) => {
        const bar = document.createElement("button");
        bar.type = "button";
        bar.className = "month-bar";
        bar.dataset.month = month;
        bar.setAttribute("aria-label", month + ", " + kr(totals[index]));
        const stack = document.createElement("span");
        stack.className = "stack";
        names.forEach((name, i) => {
          const segment = document.createElement("i");
          segment.style.setProperty("--hue", hue(i));
          segment.style.height = (100 * values[index][i] / peak) + "%";
          segment.title = month + " · " + name + " · " + kr(values[index][i]);
          stack.append(segment);
        });
        const label = document.createElement("small");
        label.append(monthFormat.format(new Date(month + "-01T00:00:00Z")), document.createElement("br"), month.slice(0, 4));
        bar.append(stack, label);
        bar.addEventListener("click", () => inspect(month, index));
        bars.append(bar);
      });
      if (chartMonth) inspect(chartMonth, chartMonths.indexOf(chartMonth));
    }
    render();
  }

  function billCell(main, detail, className) {
    const td = cell(main, className);
    const note = document.createElement("small");
    note.textContent = detail;
    td.append(note);
    return td;
  }

  function billsForAccount() {
    return expectedBills.filter(bill => !account.value || bill.account === account.value);
  }

  function updateForecast() {
    const scope = billsForAccount();
    const active = scope.filter(bill => bill.monthly !== null);
    const move = active.filter(bill => bill.account !== "faste-utgifter");
    const check = scope.filter(bill => bill.monthly === null);
    const mode = byId("bill-filter").value;
    const shown = mode === "move" ? move : mode === "check" ? check : active;
    byId("forecast-total").textContent = kr(active.reduce((total, bill) => total + bill.monthly, 0));
    byId("forecast-scope").textContent = `Monthly equivalent of current bills as of ${latestSnapshot}. Based on the last paying account. ${check.length} need confirmation and are outside the estimate.`;
    byId("move-count").textContent = `${move.length} to move`;
    fill("bills", shown.map(bill => [
      billCell(bill.name, bill.category),
      cell(accountNames.get(bill.account)),
      billCell(kr(bill.lastAmount), bill.lastDate, "num"),
      billCell(bill.monthly === null ? "—" : kr(bill.monthly), bill.basis, "num"),
    ]), 4, mode === "move" ? "All estimated bills in this selection were last paid from the bills account." :
      mode === "check" ? "No bills need confirmation in this selection." : "No estimated bills for this account.");
  }

  function updateLedger(reset = true) {
    if (reset) visibleCount = pageSize;
    const results = selected.filter(row =>
      (!category.value || row.category === category.value) &&
      (!recurrence.value || isRecurring(row) === (recurrence.value === "recurring"))
    ).reverse();
    fill("transactions", results.slice(0, visibleCount).map(row => [
      cell(row.date), cell(accountNames.get(row.account)), cell(row.description, "desc"),
      cell(row.category), cell(row.cadence), numberCell(row.amount, true),
    ]), 6, "No transactions match the selected filters.");
    byId("ledger-count").textContent = `${Math.min(visibleCount, results.length)} of ${results.length} transactions`;
    const bills = category.value ? results.filter(row => isExpense(row) && isRecurring(row)) : [];
    const detail = byId("payment-detail");
    detail.hidden = !bills.length;
    if (bills.length) {
      const latest = bills[0];
      detail.textContent = `${bills.length} recurring payment${bills.length === 1 ? "" : "s"} in this selection · Average per payment ${kr(-sum(bills) / bills.length)} · Latest payment ${kr(-latest.amount)} on ${latest.date}`;
    }
    byId("more").hidden = visibleCount >= results.length;
  }

  function renderCategories() {
    const sign = sortOrder === "ascending" ? 1 : -1;
    categoryAmounts.sort((a, b) => {
      const byName = a.name.localeCompare(b.name, "en");
      if (sortKey === "name") return sign * byName;
      if ((a[sortKey] === null) !== (b[sortKey] === null)) return a[sortKey] === null ? 1 : -1;
      return sign * (a[sortKey] - b[sortKey]) || byName;
    });
    for (const button of sortButtons) {
      if (button.dataset.sort === sortKey) button.parentElement.setAttribute("aria-sort", sortOrder);
      else button.parentElement.removeAttribute("aria-sort");
    }
    const ranked = flexibleOnly ? categoryAmounts.filter(row => row.periodOther > 0) : categoryAmounts;
    const showYear = !byId("yearly-column").hidden;
    fill("categories", ranked.map(({name, recurring, other, monthly, yearly, total}) => {
      const choose = document.createElement("button");
      choose.className = "category-button";
      choose.type = "button";
      choose.textContent = name;
      choose.addEventListener("click", () => {
        category.value = name;
        recurrence.value = flexibleOnly ? "non-recurring" : "";
        updateLedger();
        byId("ledger-title").focus();
      });
      const cells = [cell(choose), recurring === null ? cell("—", "num") : numberCell(recurring),
        numberCell(other), monthly === null ? cell("—", "num") : numberCell(monthly)];
      if (showYear) cells.push(numberCell(yearly));
      cells.push(numberCell(total));
      return cells;
    }), showYear ? 6 : 5, flexibleOnly && categoryAmounts.length ? "No non-recurring spending in this selection." : categoryEmpty);
  }

  function updateOverview() {
    selected = transactions.filter(row =>
      (!account.value || row.account === account.value) && row.date.startsWith(period.value)
    );
    const coverage = accounts.filter(item => !account.value || item.id === account.value);
    const earliest = coverage.map(item => item.firstTransaction).sort()[0];
    const latest = coverage.map(item => item.bookedThrough).sort().at(-1);
    const reservations = coverage.reduce((total, item) => total + item.reservations, 0);
    const bookedBalance = coverage.reduce((total, item) => total + item.bookedBalance, 0);
    byId("account-coverage").textContent = `Coverage ${earliest} to ${latest} · Latest booked balance ${kr(bookedBalance)} · ${reservations} pending reservations excluded`;
    // A quiet account is still covered through its export, even if its last booking was months ago.
    const commonSnapshot = coverage.map(item => item.snapshot).sort()[0];
    const fullMonths = months.filter(month =>
      month.startsWith(period.value) && month + "-01" >= earliest && month < commonSnapshot.slice(0, 7)
    );
    const count = fullMonths.length;
    const partialOnly = !count && basis.value !== "total";
    const totals = basis.value === "total" || partialOnly;
    const yearly = basis.value === "yearly" && !partialOnly;
    const included = new Set(fullMonths);
    const summaryRows = totals ? selected : selected.filter(row => included.has(row.date.slice(0, 7)));
    const displayed = amount => totals ? amount : amount / count * (yearly ? 12 : 1);
    const summaryMoney = amount => kr(displayed(amount));
    const timeLabel = totals ? "Period" : yearly ? "Estimated yearly" : "Average monthly";
    byId("summary-heading").textContent = totals ? "Booked period totals" : yearly ? "Booked spending, annualized" : "Booked monthly averages";
    byId("category-heading").textContent = "Spending by category";
    byId("category-basis").textContent = `Recurring per month uses the bill estimates as of ${latestSnapshot}, assigned to the last paying account. A dash means no estimate is available. Non-recurring shows ${totals ? "booked totals" : yearly ? "annualized booked spending" : "booked monthly averages"}. Period totals include partial months.`;
    byId("contributors-title").textContent = `${timeLabel} contributions`;
    let note = "Includes all booked activity in the selected period.";
    if (partialOnly) {
      note = "This selection has no complete calendar month. Showing actual booked totals for the available dates.";
    } else if (!totals) {
      const range = count === 1 ? fullMonths[0] : `${fullMonths.at(-1)} to ${fullMonths[0]}`;
      note = `Based on ${count} full calendar month${count === 1 ? "" : "s"} (${range}), including months with no payment.`;
      if (yearly) note += " The yearly estimate is 12 times the monthly average.";
    }
    byId("basis-note").textContent = note;
    const expenses = summaryRows.filter(isExpense);
    const recurring = -sum(expenses.filter(isRecurring));
    const spent = -sum(expenses);
    byId("total-spent").textContent = summaryMoney(spent || 0);
    byId("recurring-spent").textContent = summaryMoney(recurring || 0);
    byId("other-spent").textContent = summaryMoney(spent - recurring);
    byId("net-cash").textContent = summaryMoney(net(summaryRows));

    const currentMonthly = new Map();
    for (const bill of billsForAccount()) {
      if (bill.monthly !== null) {
        currentMonthly.set(bill.category, (currentMonthly.get(bill.category) || 0) + bill.monthly);
      }
    }
    const previousCategory = category.value;
    const names = [...new Set([...selected.map(row => row.category), ...currentMonthly.keys()])].sort();
    category.replaceChildren(new Option("All categories", ""));
    for (const name of names) category.add(new Option(name, name));
    if (names.includes(previousCategory)) category.value = previousCategory;
    byId("review-fees").disabled = !selected.some(row => row.category === "Collections and fees");

    const periodExpenses = selected.filter(isExpense);
    const bookedCategories = new Map(group(periodExpenses, row => row.category));
    const spendingCategories = new Set([...bookedCategories.keys(), ...currentMonthly.keys()]);
    categoryAmounts = [...spendingCategories].map(name => {
      const rows = bookedCategories.get(name) || [];
      const complete = rows.filter(row => included.has(row.date.slice(0, 7)));
      const basisRows = totals ? rows : complete;
      const other = -sum(basisRows.filter(row => !isRecurring(row))) || 0;
      const monthly = count ? (-sum(complete) || 0) / count : null;
      return {name, recurring: currentMonthly.get(name) ?? null, other: displayed(other),
        periodOther: -sum(rows.filter(row => !isRecurring(row))), total: -sum(rows) || 0, monthly, yearly: monthly * 12};
    });
    byId("yearly-column").hidden = !yearly;
    if ((sortKey === "yearly" && !yearly) || (sortKey === "monthly" && !count)) sortKey = "total";
    categoryEmpty = "No spending in this period.";
    renderCategories();
    updateChart(periodExpenses, months.filter(month => month >= earliest.slice(0,7) &&
      month <= latestSnapshot.slice(0,7) && month.startsWith(period.value)).reverse());
    updateForecast();

    const monthly = group(selected, row => row.date.slice(0, 7)).reverse();
    fill("months", monthly.map(([month, rows]) => [
      cell(month), numberCell(-sum(rows.filter(isExpense)) || 0), numberCell(net(rows), true),
    ]), 3, "No activity in this period.");

    const contributions = group(summaryRows.filter(row => row.category === "Contributions"), row => row.contributor || "Unassigned");
    fill("contributors", contributions.map(([name, rows]) => [cell(name), numberCell(displayed(sum(rows)))]), 2,
      "No contributions in this period.");
    updateLedger();
  }

  for (const button of sortButtons) {
    button.addEventListener("click", () => {
      const key = button.dataset.sort;
      if (key === sortKey) sortOrder = sortOrder === "ascending" ? "descending" : "ascending";
      else sortOrder = key === "name" ? "ascending" : "descending";
      sortKey = key;
      renderCategories();
    });
  }
  function chooseSpendingMode(flexible) {
    flexibleOnly = flexible;
    byId("flexible-spending").setAttribute("aria-pressed", String(flexible));
    byId("all-spending").setAttribute("aria-pressed", String(!flexible));
    byId("spending-note").textContent = flexible
      ? "Categories with non-recurring costs. Select one to review those transactions."
      : "Select a category to see individual payments for the selected period.";
    sortKey = flexible ? "other" : "total";
    sortOrder = "descending";
    renderCategories();
  }
  byId("flexible-spending").addEventListener("click", () => chooseSpendingMode(true));
  byId("all-spending").addEventListener("click", () => chooseSpendingMode(false));
  byId("review-fees").addEventListener("click", () => {
    category.value = "Collections and fees";
    recurrence.value = "";
    updateLedger();
    byId("ledger-title").focus();
  });
  byId("bill-filter").addEventListener("change", updateForecast);
  account.addEventListener("change", updateOverview);
  period.addEventListener("change", updateOverview);
  basis.addEventListener("change", updateOverview);
  category.addEventListener("change", () => updateLedger());
  recurrence.addEventListener("change", () => updateLedger());
  byId("more").addEventListener("click", () => {
    visibleCount += pageSize;
    updateLedger(false);
  });
  updateOverview();
  byId("overview-content").hidden = false;
}

if (window.FINANCE_DATA) start(window.FINANCE_DATA);
else byId("load-error").hidden = false;
