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

function start({accounts, transactions}) {
  const account = byId("account");
  const period = byId("period");
  const basis = byId("basis");
  const category = byId("category");
  const recurrence = byId("recurrence");
  const accountNames = new Map(accounts.map(item => [item.id, item.name]));
  const format = new Intl.NumberFormat("en-GB", {style: "currency", currency: "NOK", currencyDisplay: "code"});
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
    byId("more").hidden = visibleCount >= results.length;
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
    const totals = basis.value === "total";
    const yearly = basis.value === "yearly";
    const included = new Set(fullMonths);
    const summaryRows = totals ? selected : selected.filter(row => included.has(row.date.slice(0, 7)));
    const count = fullMonths.length;
    const hasBasis = totals || count > 0;
    const displayed = amount => totals ? amount : amount / count * (yearly ? 12 : 1);
    const summaryMoney = amount => hasBasis ? kr(displayed(amount)) : "—";
    const timeLabel = totals ? "Period" : yearly ? "Estimated yearly" : "Average monthly";
    byId("summary-heading").textContent = totals ? "Period totals" : yearly ? "Yearly estimates" : "Monthly averages";
    byId("category-heading").textContent = `${timeLabel} spending by category`;
    byId("contributors-title").textContent = `${timeLabel} contributions`;
    let note = "Includes all booked activity in the selected period.";
    if (!totals) {
      if (count) {
        const range = count === 1 ? fullMonths[0] : `${fullMonths.at(-1)} to ${fullMonths[0]}`;
        note = `Based on ${count} full calendar month${count === 1 ? "" : "s"} (${range}).`;
        if (yearly) note += " The yearly estimate is 12 times the monthly average.";
      } else {
        note = "No complete month in this selection. Choose Period total to see booked amounts.";
      }
    }
    byId("basis-note").textContent = note;
    const expenses = summaryRows.filter(isExpense);
    const recurring = -sum(expenses.filter(isRecurring));
    const spent = -sum(expenses);
    byId("total-spent").textContent = summaryMoney(spent || 0);
    byId("recurring-spent").textContent = summaryMoney(recurring || 0);
    byId("other-spent").textContent = summaryMoney(spent - recurring);
    byId("net-cash").textContent = summaryMoney(net(summaryRows));

    const previousCategory = category.value;
    const names = [...new Set(selected.map(row => row.category))].sort();
    category.replaceChildren(new Option("All categories", ""));
    for (const name of names) category.add(new Option(name, name));
    if (names.includes(previousCategory)) category.value = previousCategory;

    const ranked = group(expenses, row => row.category).sort((a, b) => sum(a[1]) - sum(b[1]));
    fill("categories", ranked.map(([name, rows]) => {
      const choose = document.createElement("button");
      choose.className = "category-button";
      choose.type = "button";
      choose.textContent = name;
      choose.addEventListener("click", () => {
        category.value = name;
        recurrence.value = "";
        updateLedger();
        byId("ledger-title").focus();
      });
      const fixed = sum(rows.filter(isRecurring));
      const total = sum(rows);
      return [cell(choose), numberCell(displayed(-fixed || 0)), numberCell(displayed(fixed - total)), numberCell(displayed(-total))];
    }), 4, hasBasis ? "No spending in this period." : "No complete month in this selection.");

    const monthly = group(selected, row => row.date.slice(0, 7)).reverse();
    fill("months", monthly.map(([month, rows]) => [
      cell(month), numberCell(-sum(rows.filter(isExpense)) || 0), numberCell(net(rows), true),
    ]), 3, "No activity in this period.");

    const contributions = group(summaryRows.filter(row => row.category === "Contributions"), row => row.contributor || "Unassigned");
    fill("contributors", contributions.map(([name, rows]) => [cell(name), numberCell(displayed(sum(rows)))]), 2,
      hasBasis ? "No contributions in this period." : "No complete month in this selection.");
    updateLedger();
  }

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
