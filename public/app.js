const money = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  maximumFractionDigits: 0,
});

const number = new Intl.NumberFormat("tr-TR");

const state = {
  payload: null,
  query: "",
  selectedPayable: null,
  selectedEmployee: null,
  selectedRows: {
    ap: new Set(),
    bank: new Set(),
    paymentInvoices: new Set(),
    instruments: new Set(),
    partners: new Set(),
    employees: new Set(),
    vat: new Set(),
  },
};

function formatMoney(value) {
  return money.format(Number(value || 0));
}

function formatNumber(value) {
  return number.format(Number(value || 0));
}

function formatDate(value) {
  return value ? String(value).slice(0, 10) : "-";
}

function statusLabel(value) {
  const labels = {
    paid: "Ödendi",
    partial: "Kısmi",
    pending: "Bekliyor",
    overdue: "Gecikmiş",
    active: "Aktif",
  };
  return labels[value] || value || "-";
}

function partnerTypeLabel(value) {
  const labels = {
    vendor: "Tedarikçi",
    customer: "Müşteri",
  };
  return labels[value] || value || "-";
}

function bankMatchLabel(value) {
  return value === "matched" ? "Mutabık" : "Bekliyor";
}

function movementTypeLabel(value) {
  const labels = {
    opening_balance: "Açılış bakiyesi",
    invoice: "Fatura",
    payment: "Ödeme / tahsilat",
    collection: "Tahsilat",
    debit_note: "Borç dekontu",
    credit_note: "Alacak dekontu",
    advance: "Avans",
    salary: "Maaş tahakkuku",
    transfer: "Virman",
  };
  return labels[value] || value || "-";
}

function directionLabel(value) {
  return value === "credit" ? "Alacak" : "Borç";
}

function toTurkishTitle(value) {
  const letters = {
    i: "İ",
    ı: "I",
    ğ: "Ğ",
    ü: "Ü",
    ş: "Ş",
    ö: "Ö",
    ç: "Ç",
  };
  return String(value || "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const first = word.slice(0, 1);
      return (letters[first] || first.toLocaleUpperCase("tr-TR")) + word.slice(1);
    })
    .join(" ");
}

function cleanJobTitle(row) {
  const raw = String(row.job_title || row.job_code || "").trim();
  if (!raw) return "";
  const withoutCode = raw.includes("-") ? raw.split("-").slice(1).join("-") : raw;
  return toTurkishTitle(withoutCode.replace(/^[\s.-]+|[\s.-]+$/g, ""));
}

function seniorityLabel(row) {
  if (row.seniority_label) return row.seniority_label;
  if (!row.hire_date) return "";
  const hired = new Date(row.hire_date);
  if (Number.isNaN(hired.getTime())) return "";
  const today = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
  const days = Math.max(Math.floor((today.setHours(0, 0, 0, 0) - hired.setHours(0, 0, 0, 0)) / msPerDay) + 1, 0);
  if (days < 30) return `${days} gün`;
  return `${Math.floor(days / 30)} ay ${days % 30} gün`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
  const blob = new Blob(["\ufeffsep=;\r\n", csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function rowKey(value) {
  return String(value ?? "");
}

function selectionFor(list) {
  if (!state.selectedRows[list]) state.selectedRows[list] = new Set();
  return state.selectedRows[list];
}

function selectedIds(list) {
  return [...selectionFor(list)];
}

function checkboxCell(list, id) {
  const key = rowKey(id);
  return `<td class="select-col"><input type="checkbox" data-select-list="${list}" data-select-id="${escapeHtml(key)}" ${
    selectionFor(list).has(key) ? "checked" : ""
  } aria-label="Satırı seç" /></td>`;
}

function selectColumnEmpty() {
  return `<td class="select-col"></td>`;
}

function syncSelectAll(list, visibleIds = []) {
  const selectAll = document.querySelector(`[data-select-all="${list}"]`);
  if (!selectAll) return;
  const selected = selectionFor(list);
  const keys = visibleIds.map(rowKey);
  const selectedCount = keys.filter((id) => selected.has(id)).length;
  selectAll.checked = keys.length > 0 && selectedCount === keys.length;
  selectAll.indeterminate = selectedCount > 0 && selectedCount < keys.length;
}

function wireSelection(list, visibleIds = []) {
  const selected = selectionFor(list);
  document.querySelectorAll(`[data-select-list="${list}"]`).forEach((input) => {
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("change", () => {
      const id = rowKey(input.dataset.selectId);
      if (input.checked) selected.add(id);
      else selected.delete(id);
      syncSelectAll(list, visibleIds);
      updateBulkToolbar(list);
    });
  });
  syncSelectAll(list, visibleIds);
  updateBulkToolbar(list);
}

function setStatus(text, ok = true) {
  const el = document.querySelector("#serverStatus");
  el.textContent = text;
  el.style.background = ok ? "#eaf4ee" : "#fff1e1";
  el.style.color = ok ? "#2f7a4f" : "#a66a00";
}

async function readJsonResponse(response, fallbackMessage = "İşlem tamamlanamadı") {
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    const preview = text.replace(/\s+/g, " ").slice(0, 120);
    throw new Error(`${fallbackMessage}: Sunucu JSON yerine farklı bir cevap döndü (${response.status}). ${preview}`);
  }
  if (!response.ok) throw new Error(payload.error || fallbackMessage);
  return payload;
}

function includesQuery(row) {
  if (!state.query) return true;
  return JSON.stringify(row).toLocaleLowerCase("tr-TR").includes(state.query);
}

function setGlobalQuery(value) {
  const clean = String(value || "").trim();
  state.query = clean.toLocaleLowerCase("tr-TR");
  const global = document.querySelector("#globalSearch");
  if (global) global.value = clean;
}

function renderKpis(kpis = {}) {
  const items = [
    ["Açık fatura", formatNumber(kpis.pendingInvoices), formatMoney(kpis.invoiceRemaining)],
    ["Fatura toplamı", formatMoney(kpis.invoiceTotal), `${formatNumber(kpis.invoiceCount)} kayıt`],
    ["Banka net", formatMoney(kpis.bankNet), `${formatNumber(kpis.bankLineCount)} ekstre satırı`],
    ["Çek / senet", formatMoney(kpis.paymentInstrumentTotal), `${formatNumber(kpis.paymentInstrumentCount)} portföy kaydı`],
    ["Personel", formatNumber(kpis.employeeCount), "KVKK maskeli ana veri"],
    [
      "Veri uyarısı",
      formatNumber(
        (kpis.duplicateInvoices || 0) +
          (kpis.missingDueDates || 0) +
          (kpis.missingCostCategory || 0) +
          (kpis.duplicateEmployees || 0)
      ),
      "Kapanış öncesi kontrol",
    ],
  ];

  document.querySelector("#kpiStrip").innerHTML = items
    .map(([label, value, hint]) => `<article class="kpi"><span>${label}</span><strong>${value}</strong><small>${hint}</small></article>`)
    .join("");
}

function renderQueue(queue = []) {
  document.querySelector("#workQueue").innerHTML = queue
    .map(
      (item) => `
        <article class="queue-item severity-${item.severity || "normal"}">
          <div>
            <b>${escapeHtml(item.label)}</b>
            <span>${formatNumber(item.count)} kayıt · ${formatMoney(item.amount)}</span>
          </div>
          <button data-go="${item.target}" class="ghost">Aç</button>
        </article>
      `
    )
    .join("");

  document.querySelectorAll("[data-go]").forEach((button) => {
    button.addEventListener("click", () => activateTab(button.dataset.go));
  });
}

function renderBankGroups(groups = []) {
  document.querySelector("#bankGroups").innerHTML = groups
    .slice(0, 8)
    .map(
      (group) => `
        <article class="compact-item">
          <div><b>${escapeHtml(group.name)}</b><span>${formatNumber(group.line_count)} satır</span></div>
          <strong>${formatMoney(group.net_total)}</strong>
        </article>
      `
    )
    .join("");
}

function controlMarkup(control) {
  const severity = control.count ? "high" : "normal";
  return `
    <article class="control-item severity-${severity}">
      <div>
        <b>${escapeHtml(control.name)}</b>
        <span>${escapeHtml(control.owner)} · ${escapeHtml(control.action)}</span>
      </div>
      <strong>${formatNumber(control.count)}</strong>
    </article>
  `;
}

function renderControls(controls = []) {
  const html = controls.map(controlMarkup).join("");
  document.querySelector("#controlPreview").innerHTML = html;
  document.querySelector("#controlRows").innerHTML = html;
}

function renderPayables(rows = []) {
  const filtered = rows.filter(includesQuery);
  document.querySelector("#payableRows").innerHTML = filtered.length
    ? filtered
        .map(
          (row) => `
            <tr data-payable="${row.id}">
              ${checkboxCell("ap", row.id)}
              <td>${formatDate(row.invoice_date)}</td>
              <td>${escapeHtml(row.invoice_no || "-")}</td>
              <td>${escapeHtml(row.partner || "-")}</td>
              <td>${escapeHtml(row.project_site || "-")}</td>
              <td class="amount">${formatMoney(row.gross_total)}</td>
              <td class="amount">${formatMoney(row.remaining_amount)}</td>
              <td><span class="badge ${row.payment_status || "pending"}">${statusLabel(row.payment_status || (row.remaining_amount > 0 ? "pending" : "paid"))}</span></td>
            </tr>
          `
        )
        .join("")
    : `<tr>${selectColumnEmpty()}<td colspan="7">Kayıt bulunamadı.</td></tr>`;

  document.querySelectorAll("[data-payable]").forEach((rowEl) => {
    rowEl.addEventListener("click", () => {
      const id = Number(rowEl.dataset.payable);
      state.selectedPayable = rows.find((row) => row.id === id);
      renderInspector();
    });
  });
  wireSelection("ap", filtered.map((row) => row.id));

  if (!state.selectedPayable && filtered[0]) {
    state.selectedPayable = filtered[0];
  }
  renderInspector();
}

function renderInspector() {
  const row = state.selectedPayable;
  const el = document.querySelector("#apInspector");
  if (!row) {
    el.innerHTML = "<h2>Fatura Detayı</h2><p>Bir fatura seç.</p>";
    return;
  }
  el.innerHTML = `
    <h2>Fatura Detayı</h2>
    <dl>
      <dt>Belge No</dt><dd>${escapeHtml(row.invoice_no || "-")}</dd>
      <dt>Cari</dt><dd>${escapeHtml(row.partner || "-")}</dd>
      <dt>Tarih</dt><dd>${formatDate(row.invoice_date)}</dd>
      <dt>Vade</dt><dd>${formatDate(row.due_date)}</dd>
      <dt>Maliyet Merkezi</dt><dd>${escapeHtml(row.project_site || "-")}</dd>
      <dt>Toplam</dt><dd>${formatMoney(row.gross_total)}</dd>
      <dt>Ödenen</dt><dd>${formatMoney(row.paid_amount)}</dd>
      <dt>Kalan</dt><dd>${formatMoney(row.remaining_amount)}</dd>
    </dl>
    <button class="primary wide" data-action-payment-select>Ödeme için seç</button>
    <button class="ghost wide" data-action-voucher>Muhasebe fişi</button>
  `;
  el.querySelector("[data-action-payment-select]")?.addEventListener("click", () => openPaymentRun(row));
  el.querySelector("[data-action-voucher]")?.addEventListener("click", () => openVoucherPreview(row));
}

function renderBank(rows = []) {
  const filtered = rows.filter(includesQuery);
  document.querySelector("#bankRows").innerHTML = filtered.length
    ? filtered
        .map(
          (row) => `
            <tr>
              ${checkboxCell("bank", row.id)}
              <td>${formatDate(row.transaction_date)}</td>
              <td>${escapeHtml(row.transaction_type || "-")}</td>
              <td>${escapeHtml(row.transaction_group || "-")} / ${escapeHtml(row.sub_category || "-")}</td>
              <td class="amount">${formatMoney(row.net_amount)}</td>
              <td><span class="badge ${row.match_status === "matched" ? "paid" : "pending"}">${bankMatchLabel(row.match_status)}</span></td>
              <td class="row-actions">
                <button class="ghost" data-bank-match="${row.id}">Eşleştir</button>
                <button class="ghost" data-bank-transfer="${row.id}">Virman</button>
              </td>
            </tr>
          `
        )
        .join("")
    : `<tr>${selectColumnEmpty()}<td colspan="6">Kayıt bulunamadı.</td></tr>`;

  document.querySelectorAll("[data-bank-match]").forEach((button) => {
    button.addEventListener("click", () => {
      const row = rows.find((item) => item.id === Number(button.dataset.bankMatch));
      openBankMatch(row);
    });
  });
  document.querySelectorAll("[data-bank-transfer]").forEach((button) => {
    button.addEventListener("click", () => {
      const row = rows.find((item) => item.id === Number(button.dataset.bankTransfer));
      openBankTransferModal(row);
    });
  });
  wireSelection("bank", filtered.map((row) => row.id));
}

function renderPayments(payables = [], instruments = []) {
  const open = payables.filter((row) => Number(row.remaining_amount || 0) > 0).slice(0, 12);
  document.querySelector("#paymentInvoiceRows").innerHTML = open.length
    ? open
        .map(
          (row) => `
            <tr>
              ${checkboxCell("paymentInvoices", row.id)}
              <td>${formatDate(row.due_date)}</td>
              <td>${escapeHtml(row.partner || "-")}</td>
              <td>${escapeHtml(row.invoice_no || "-")}</td>
              <td class="amount">${formatMoney(row.remaining_amount)}</td>
            </tr>
          `
        )
        .join("")
    : `<tr>${selectColumnEmpty()}<td colspan="4">Açık fatura yok.</td></tr>`;

  document.querySelector("#instrumentRows").innerHTML = instruments.length
    ? instruments
        .map(
          (row) => `
            <tr>
              ${checkboxCell("instruments", row.id)}
              <td>${formatDate(row.due_date)}</td>
              <td>${escapeHtml(row.partner || "-")}</td>
              <td>${escapeHtml(row.instrument_no || "-")}</td>
              <td class="amount">${formatMoney(row.amount)}</td>
            </tr>
          `
        )
        .join("")
    : `<tr>${selectColumnEmpty()}<td colspan="4">Portföy kaydı yok.</td></tr>`;
  wireSelection("paymentInvoices", open.map((row) => row.id));
  wireSelection("instruments", instruments.map((row) => row.id));
}

function renderPartners(rows = []) {
  const filtered = rows.filter(includesQuery);
  document.querySelector("#partnerRows").innerHTML = filtered
    .map(
      (row) => `
        <tr data-partner="${row.id}">
          ${checkboxCell("partners", row.id)}
          <td>${escapeHtml(row.name)}</td>
          <td>${escapeHtml(partnerTypeLabel(row.partner_type))}</td>
          <td class="amount">${formatNumber(row.invoice_count)}</td>
          <td class="amount">${formatMoney(row.gross_total)}</td>
          <td class="amount">${formatMoney(row.open_balance)}</td>
          <td class="row-actions">
            <button class="ghost" data-open-partner-summary>Özet</button>
            <button class="ghost" data-open-partner-pdf>PDF</button>
          </td>
        </tr>
      `
    )
    .join("");

  document.querySelectorAll("[data-partner]").forEach((rowEl) => {
    const partner = rows.find((item) => item.id === Number(rowEl.dataset.partner));
    rowEl.querySelector("[data-open-partner-summary]")?.addEventListener("click", () => openAccountSummary("partner", partner));
    rowEl.querySelector("[data-open-partner-pdf]")?.addEventListener("click", () => openAttachmentModal("partner", partner));
  });
  wireSelection("partners", filtered.map((row) => row.id));
}

function renderEmployees(rows = []) {
  const filtered = rows.filter(includesQuery);
  document.querySelector("#employeeRows").innerHTML = filtered
    .map(
      (row) => {
        const jobTitle = cleanJobTitle(row);
        return `
          <tr data-employee="${row.id}">
            ${checkboxCell("employees", row.id)}
            <td>${escapeHtml(row.full_name)}</td>
            <td>${formatDate(row.hire_date)}</td>
            <td>${escapeHtml(jobTitle)}</td>
            <td>${escapeHtml(row.project_site || "")}</td>
            <td class="amount">${formatNumber(row.worked_days)}</td>
            <td class="amount">${formatMoney(row.monthly_salary)}</td>
            <td class="amount">${formatMoney(row.advance_amount)}</td>
            <td class="amount">${formatMoney(row.paid_salary)}</td>
            <td><span class="badge ${row.status}">${statusLabel(row.status)}</span></td>
            <td class="row-actions">
              <button class="ghost" data-open-employee-summary>Özet</button>
              <button class="ghost" data-open-site>Şantiye</button>
              <button class="ghost" data-open-advance>Avans</button>
              <button class="ghost" data-open-employee-pdf>PDF</button>
            </td>
          </tr>
        `;
      }
    )
    .join("");

  document.querySelectorAll("[data-employee]").forEach((rowEl) => {
    rowEl.querySelector("[data-open-advance]").addEventListener("click", () => {
      const employee = rows.find((item) => item.id === Number(rowEl.dataset.employee));
      openAdvanceModal(employee);
    });
    rowEl.querySelector("[data-open-site]").addEventListener("click", () => {
      const employee = rows.find((item) => item.id === Number(rowEl.dataset.employee));
      openSiteModal(employee);
    });
    rowEl.querySelector("[data-open-employee-summary]").addEventListener("click", () => {
      const employee = rows.find((item) => item.id === Number(rowEl.dataset.employee));
      openAccountSummary("employee", employee);
    });
    rowEl.querySelector("[data-open-employee-pdf]").addEventListener("click", () => {
      const employee = rows.find((item) => item.id === Number(rowEl.dataset.employee));
      openAttachmentModal("employee", employee);
    });
  });
  wireSelection("employees", filtered.map((row) => row.id));
}

function openSiteModal(employee) {
  if (!employee) return;
  state.selectedEmployee = employee;
  document.querySelector("#siteEmployeeId").value = employee.id;
  document.querySelector("#siteEmployeeName").textContent = employee.full_name;
  const select = document.querySelector("#siteSelect");
  const sites = state.payload?.projectSites || [];
  select.innerHTML = `<option value="">Atanmadı</option>${sites
    .map((site) => `<option value="${escapeHtml(site.name)}">${escapeHtml(site.name)}</option>`)
    .join("")}`;
  select.value = employee.project_site || "";
  document.querySelector("#siteName").value = "";
  document.querySelector("#siteModal").hidden = false;
  select.focus();
}

function closeSiteModal() {
  document.querySelector("#siteModal").hidden = true;
  state.selectedEmployee = null;
}

async function saveSiteFromModal() {
  const employeeId = Number(document.querySelector("#siteEmployeeId").value);
  const selectedSite = document.querySelector("#siteSelect").value;
  const newSite = document.querySelector("#siteName").value.trim();
  const projectSiteName = newSite || selectedSite;
  const button = document.querySelector("#siteForm button[type='submit']");
  button.disabled = true;
  button.textContent = "Kaydediliyor";
  try {
    const response = await fetch("/api/employees/site", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId, projectSiteName }),
    });
    const payload = await readJsonResponse(response, "Şantiye kaydedilemedi");
    state.payload = payload.dashboard;
    renderAll();
    closeSiteModal();
    setStatus("Şantiye kaydedildi");
  } catch (error) {
    setStatus(error.message, false);
  } finally {
    button.disabled = false;
    button.textContent = "Kaydet";
  }
}

function openAdvanceModal(employee) {
  if (!employee) return;
  state.selectedEmployee = employee;
  document.querySelector("#advanceEmployeeId").value = employee.id;
  document.querySelector("#advanceEmployeeName").textContent = employee.full_name;
  document.querySelector("#advanceMonthlySalary").value = Number(employee.monthly_salary || 0);
  document.querySelector("#advanceAmount").value = Number(employee.advance_amount || 0);
  updateAdvancePreview();
  document.querySelector("#advanceModal").hidden = false;
  document.querySelector("#advanceAmount").focus();
}

function closeAdvanceModal() {
  document.querySelector("#advanceModal").hidden = true;
  state.selectedEmployee = null;
}

function updateAdvancePreview() {
  const salary = Number(document.querySelector("#advanceMonthlySalary").value) || 0;
  const advance = Number(document.querySelector("#advanceAmount").value) || 0;
  document.querySelector("#advancePaidSalary").textContent = formatMoney(Math.max(salary - advance, 0));
}

async function saveCompensationFromModal() {
  const employeeId = Number(document.querySelector("#advanceEmployeeId").value);
  const monthlySalary = document.querySelector("#advanceMonthlySalary").value;
  const advanceAmount = document.querySelector("#advanceAmount").value;
  const button = document.querySelector("#advanceForm button[type='submit']");
  button.disabled = true;
  button.textContent = "Kaydediliyor";
  try {
    const response = await fetch("/api/employees/compensation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId,
        monthlySalary,
        advanceAmount,
      }),
    });
    const payload = await readJsonResponse(response, "Personel kaydedilemedi");
    state.payload = payload.dashboard;
    renderAll();
    closeAdvanceModal();
    setStatus("Maaş kaydedildi");
  } catch (error) {
    setStatus(error.message, false);
  } finally {
    button.disabled = false;
    button.textContent = "Kaydet";
  }
}

function renderVat(rows = []) {
  document.querySelector("#vatRows").innerHTML = rows.length
    ? rows
        .map(
          (row) => `
            <tr>
              ${checkboxCell("vat", row.period || row.id)}
              <td>${escapeHtml(row.period || "-")}</td>
              <td class="amount">${formatMoney(row.purchase_base)}</td>
              <td class="amount">${formatMoney(row.purchase_vat)}</td>
              <td class="amount">${formatMoney(row.sales_base)}</td>
              <td class="amount">${formatMoney(row.withholding)}</td>
              <td class="amount">${formatMoney(row.net_vat)}</td>
            </tr>
          `
        )
        .join("")
    : `<tr>${selectColumnEmpty()}<td colspan="6">KDV hareketi yok.</td></tr>`;
  wireSelection("vat", rows.map((row) => row.period || row.id));
}

function renderReports(payload = {}) {
  const reports = payload.reports || {};
  const kpis = [
    ["Cari borç", formatMoney(reports.partnerDebit), "Borç kolon toplamı"],
    ["Cari alacak", formatMoney(reports.partnerCredit), "Alacak kolon toplamı"],
    ["Açık cari bakiye", formatMoney(reports.partnerOpenBalance), "Alacak eksi borç"],
    ["Personel net", formatMoney(reports.employeeNetPayable), "Maaş eksi avans"],
    ["Mutabakat bekleyen", formatNumber(reports.unmatchedBankLines), "Banka satırı"],
    ["PDF belge", formatNumber(reports.attachmentCount), "Kart içi ek"],
  ];
  const reportKpis = document.querySelector("#reportKpis");
  if (reportKpis) {
    reportKpis.innerHTML = kpis
      .map(([label, value, hint]) => `<article class="kpi"><span>${label}</span><strong>${value}</strong><small>${hint}</small></article>`)
      .join("");
  }

  const partnerRows = [...(payload.partners || [])]
    .sort((a, b) => Math.abs(Number(b.open_balance || 0)) - Math.abs(Number(a.open_balance || 0)))
    .slice(0, 12);
  const partnerTarget = document.querySelector("#reportPartnerRows");
  if (partnerTarget) {
    partnerTarget.innerHTML = partnerRows.length
      ? partnerRows
          .map(
            (row) => `
              <article class="compact-item">
                <div><b>${escapeHtml(row.name)}</b><span>${escapeHtml(partnerTypeLabel(row.partner_type))} · ${formatNumber(row.invoice_count)} fatura · ${formatNumber(row.attachment_count)} PDF</span></div>
                <strong>${formatMoney(row.open_balance)}</strong>
              </article>
            `
          )
          .join("")
      : `<div class="empty-state">Cari raporu için kayıt yok.</div>`;
  }

  const operationRows = [
    ["Açık alış faturaları", payload.kpis?.pendingInvoices || 0, formatMoney(payload.kpis?.invoiceRemaining)],
    ["Mutabakat bekleyen banka", payload.kpis?.unmatchedBankLines || 0, "Eşleştirme bekliyor"],
    ["Tekrarlı fatura no", payload.kpis?.duplicateInvoices || 0, "Kontrol gerekli"],
    ["Tekrarlı personel adı", payload.kpis?.duplicateEmployees || 0, "Kontrol gerekli"],
    ["Virman fişi", (payload.transferVouchers || []).length, formatMoney((payload.transferVouchers || []).reduce((sum, row) => sum + Number(row.amount || 0), 0))],
  ];
  const operationTarget = document.querySelector("#reportOperationRows");
  if (operationTarget) {
    operationTarget.innerHTML = operationRows
      .map(
        ([label, count, hint]) => `
          <article class="compact-item">
            <div><b>${escapeHtml(label)}</b><span>${escapeHtml(hint)}</span></div>
            <strong>${formatNumber(count)}</strong>
          </article>
        `
      )
      .join("");
  }
}

function renderImportInfo(payload = {}) {
  const latest = payload.latestImport;
  const log = document.querySelector("#lastImportLog");
  const time = document.querySelector("#lastImportTime");
  if (!latest) {
    time.textContent = "Henüz yok";
    log.textContent = "";
    return;
  }
  time.textContent = latest.imported_at;
  try {
    log.textContent = JSON.stringify(JSON.parse(latest.summary_json), null, 2);
  } catch {
    log.textContent = latest.summary_json || "";
  }
}

function activeTab() {
  return document.querySelector(".view.active")?.id || "home";
}

function defaultRecordType() {
  const tab = activeTab();
  if (tab === "partners") return "partner";
  if (tab === "employees") return "employee";
  return "invoice";
}

function showToast(message, ok = true) {
  setStatus(message, ok);
  let toast = document.querySelector("#actionToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "actionToast";
    toast.className = "action-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.toggle("error", !ok);
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.hidden = true;
  }, 3200);
}

function ensureActionModal() {
  let modal = document.querySelector("#actionModal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "actionModal";
  modal.className = "modal-backdrop";
  modal.hidden = true;
  modal.innerHTML = `
    <section class="modal action-modal" role="dialog" aria-modal="true" aria-labelledby="actionModalTitle">
      <header class="modal-head">
        <div>
          <h2 id="actionModalTitle"></h2>
          <p id="actionModalSubtitle"></p>
        </div>
        <button type="button" class="icon-button" id="closeActionModal" aria-label="Kapat">×</button>
      </header>
      <div id="actionModalBody" class="modal-body"></div>
    </section>
  `;
  document.body.appendChild(modal);
  modal.querySelector("#closeActionModal").addEventListener("click", closeActionModal);
  modal.addEventListener("click", (event) => {
    if (event.target.id === "actionModal") closeActionModal();
  });
  return modal;
}

function openActionModal(title, subtitle, bodyHtml) {
  const modal = ensureActionModal();
  modal.querySelector("#actionModalTitle").textContent = title;
  modal.querySelector("#actionModalSubtitle").textContent = subtitle || "";
  modal.querySelector("#actionModalBody").innerHTML = bodyHtml;
  modal.hidden = false;
}

function closeActionModal() {
  const modal = document.querySelector("#actionModal");
  if (modal) modal.hidden = true;
}

function recordFields(type) {
  if (type === "partner") {
    return `
      <label>Cari adı<input name="name" required /></label>
      <label>Tip
        <select name="partnerType">
          <option value="vendor">Tedarikçi</option>
          <option value="customer">Müşteri</option>
        </select>
      </label>
    `;
  }
  if (type === "employee") {
    return `
      <label>Ad soyad<input name="fullName" required /></label>
      <label>İşe giriş<input name="hireDate" type="date" /></label>
      <label>Kıdem / meslek<input name="jobTitle" placeholder="Betonarme Demircisi" /></label>
      <label>Şantiye<input name="projectSite" /></label>
      <label>Çalıştığı gün<input name="workedDays" type="number" min="0" step="1" value="0" /></label>
      <label>Aylık maaş<input name="monthlySalary" type="number" min="0" step="0.01" value="0" /></label>
      <label>Avans<input name="advanceAmount" type="number" min="0" step="0.01" value="0" /></label>
    `;
  }
  return `
    <label>Cari<input name="partnerName" required /></label>
    <label>Fatura no<input name="invoiceNo" /></label>
    <label>Fatura tarihi<input name="invoiceDate" type="date" /></label>
    <label>Vade tarihi<input name="dueDate" type="date" required /></label>
    <label>Şantiye / maliyet merkezi<input name="projectSite" /></label>
    <label>Gider kategorisi<input name="costCategory" /></label>
    <label>KDV oranı<input name="vatRate" type="number" min="0" step="0.01" value="20" /></label>
    <label>Genel toplam<input name="grossTotal" type="number" min="0" step="0.01" required /></label>
    <label>Ödenen<input name="paidAmount" type="number" min="0" step="0.01" value="0" /></label>
    <label>Açıklama<input name="description" /></label>
  `;
}

function openNewRecordModal(type = defaultRecordType()) {
  openActionModal(
    "Yeni kayıt",
    "Manuel veri girişi doğrudan ERP veritabanına kaydedilir.",
    `
      <form id="newRecordForm" class="record-form">
        <label>Kayıt tipi
          <select id="recordType" name="recordType">
            <option value="invoice">Alış faturası</option>
            <option value="partner">Cari</option>
            <option value="employee">Personel</option>
          </select>
        </label>
        <div id="recordFields" class="record-grid"></div>
        <footer class="modal-actions">
          <button type="button" class="ghost" id="cancelActionModal">Vazgeç</button>
          <button type="submit" class="primary">Kaydet</button>
        </footer>
      </form>
    `
  );
  const select = document.querySelector("#recordType");
  const fields = document.querySelector("#recordFields");
  select.value = type;
  fields.innerHTML = recordFields(type);
  select.addEventListener("change", () => {
    fields.innerHTML = recordFields(select.value);
  });
  document.querySelector("#cancelActionModal").addEventListener("click", closeActionModal);
  document.querySelector("#newRecordForm").addEventListener("submit", saveNewRecord);
  fields.querySelector("input, select")?.focus();
}

async function saveNewRecord(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const type = form.querySelector("[name='recordType']").value;
  const endpoint = {
    invoice: "/api/purchase-invoices",
    partner: "/api/partners",
    employee: "/api/employees",
  }[type];
  const payload = Object.fromEntries(new FormData(form).entries());
  delete payload.recordType;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "Kaydediliyor";
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await readJsonResponse(response, "Kayıt kaydedilemedi");
    state.payload = result.dashboard;
    state.selectedPayable = null;
    if (type === "employee") {
      activateTab("employees");
      setGlobalQuery(payload.fullName);
    } else if (type === "partner") {
      activateTab("partners");
      setGlobalQuery(payload.name);
    } else {
      activateTab("ap");
      setGlobalQuery(payload.invoiceNo || payload.partnerName);
    }
    renderAll();
    closeActionModal();
    showToast("Kayıt kaydedildi");
  } catch (error) {
    showToast(error.message, false);
  } finally {
    button.disabled = false;
    button.textContent = "Kaydet";
  }
}

function accountDisplayName(kind, row) {
  if (!row) return "-";
  return kind === "employee" ? row.full_name : row.name;
}

function attachmentsFor(kind, id) {
  return (state.payload?.attachments || []).filter((item) => item.entity_type === kind && Number(item.entity_id) === Number(id));
}

function employeeSyntheticMovements(row) {
  if (!row) return [];
  const movementDate = new Date().toISOString().slice(0, 10);
  const rows = [];
  if (Number(row.monthly_salary || 0) > 0) {
    rows.push({
      id: `salary-${row.id}`,
      account_kind: "employee",
      account_id: row.id,
      movement_date: movementDate,
      movement_type: "salary",
      direction: "credit",
      amount: Number(row.monthly_salary || 0),
      document_no: "BORDRO",
      description: "Aylık maaş tahakkuku",
      source_table: "employees",
    });
  }
  if (Number(row.advance_amount || 0) > 0) {
    rows.push({
      id: `advance-${row.id}`,
      account_kind: "employee",
      account_id: row.id,
      movement_date: movementDate,
      movement_type: "advance",
      direction: "debit",
      amount: Number(row.advance_amount || 0),
      document_no: "AVANS",
      description: "Maaştan mahsup edilen avans",
      source_table: "employees",
    });
  }
  return rows;
}

function movementsFor(kind, row) {
  const persisted = (state.payload?.accountMovements || []).filter(
    (item) => item.account_kind === kind && Number(item.account_id) === Number(row?.id)
  );
  const synthetic = kind === "employee" ? employeeSyntheticMovements(row) : [];
  return [...persisted, ...synthetic].sort((a, b) => {
    const dateCompare = String(a.movement_date || "").localeCompare(String(b.movement_date || ""));
    if (dateCompare !== 0) return dateCompare;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
}

function movementTotals(movements = []) {
  const debit = movements.reduce((sum, item) => sum + (item.direction === "debit" ? Number(item.amount || 0) : 0), 0);
  const credit = movements.reduce((sum, item) => sum + (item.direction === "credit" ? Number(item.amount || 0) : 0), 0);
  return { debit, credit, balance: credit - debit };
}

function ledgerRowsHtml(movements = []) {
  if (!movements.length) {
    return `<tr><td colspan="7">Hareket yok.</td></tr>`;
  }
  let balance = 0;
  return movements
    .map((item) => {
      const amount = Number(item.amount || 0);
      const debit = item.direction === "debit" ? amount : 0;
      const credit = item.direction === "credit" ? amount : 0;
      balance += credit - debit;
      return `
        <tr>
          <td>${formatDate(item.movement_date)}</td>
          <td>${escapeHtml(movementTypeLabel(item.movement_type))}</td>
          <td>${escapeHtml(item.document_no || "-")}</td>
          <td>${escapeHtml(item.description || "-")}</td>
          <td class="amount">${debit ? formatMoney(debit) : "-"}</td>
          <td class="amount">${credit ? formatMoney(credit) : "-"}</td>
          <td class="amount">${formatMoney(balance)}</td>
        </tr>
      `;
    })
    .join("");
}

function attachmentListHtml(kind, id) {
  const files = attachmentsFor(kind, id);
  if (!files.length) return `<div class="empty-state">Bu karta bağlı PDF yok.</div>`;
  return `<div class="compact-list">${files
    .map(
      (file) => `
        <article class="compact-item">
          <div><b>${escapeHtml(file.file_name)}</b><span>${formatDate(file.uploaded_at)} · ${formatNumber(Math.ceil(Number(file.file_size || 0) / 1024))} KB</span></div>
          <a class="ghost link-button" href="/api/attachments/${file.id}" target="_blank" rel="noopener">Aç</a>
        </article>
      `
    )
    .join("")}</div>`;
}

function openAccountSummary(kind, row) {
  if (!row) return;
  const movements = movementsFor(kind, row);
  const totals = movementTotals(movements);
  const title = kind === "employee" ? "Personel cari özeti" : "Cari özeti";
  const name = accountDisplayName(kind, row);
  openActionModal(
    title,
    name,
    `
      <div class="ledger-actions">
        <button class="ghost" data-account-action="opening_balance">Açılış</button>
        <button class="ghost" data-account-action="debit_note">Borç Dekontu</button>
        <button class="ghost" data-account-action="credit_note">Alacak Dekontu</button>
        <button class="ghost" data-upload-pdf>PDF Yükle</button>
      </div>
      <div class="result-grid ledger-summary">
        <div><span>Borç</span><b>${formatMoney(totals.debit)}</b></div>
        <div><span>Alacak</span><b>${formatMoney(totals.credit)}</b></div>
        <div><span>Bakiye</span><b>${formatMoney(totals.balance)}</b></div>
        <div><span>PDF</span><b>${formatNumber(attachmentsFor(kind, row.id).length)}</b></div>
      </div>
      <div class="ledger-table-wrap">
        <table class="ledger-table">
          <thead><tr><th>Tarih</th><th>Hareket</th><th>Belge</th><th>Açıklama</th><th>Borç</th><th>Alacak</th><th>Bakiye</th></tr></thead>
          <tbody>${ledgerRowsHtml(movements)}</tbody>
        </table>
      </div>
      <section class="attachment-panel">
        <div class="block-head"><h2>Ekli Belgeler</h2></div>
        ${attachmentListHtml(kind, row.id)}
      </section>
    `
  );
  document.querySelectorAll("[data-account-action]").forEach((button) => {
    button.addEventListener("click", () => openMovementModal(kind, row, button.dataset.accountAction));
  });
  document.querySelector("[data-upload-pdf]")?.addEventListener("click", () => openAttachmentModal(kind, row));
}

function openMovementModal(kind, row, movementType = "debit_note") {
  if (!row) return;
  const defaultDirection = movementType === "credit_note" || movementType === "opening_balance" ? "credit" : "debit";
  openActionModal(
    movementTypeLabel(movementType),
    accountDisplayName(kind, row),
    `
      <form id="accountMovementForm" class="record-form">
        <input type="hidden" name="accountKind" value="${escapeHtml(kind)}" />
        <input type="hidden" name="accountId" value="${escapeHtml(row.id)}" />
        <input type="hidden" name="movementType" value="${escapeHtml(movementType)}" />
        <div class="record-grid">
          <label>Tarih<input name="movementDate" type="date" value="${new Date().toISOString().slice(0, 10)}" required /></label>
          <label>Yön
            <select name="direction">
              <option value="debit" ${defaultDirection === "debit" ? "selected" : ""}>Borç</option>
              <option value="credit" ${defaultDirection === "credit" ? "selected" : ""}>Alacak</option>
            </select>
          </label>
          <label>Tutar<input name="amount" type="number" min="0.01" step="0.01" required /></label>
          <label>Belge No<input name="documentNo" /></label>
        </div>
        <label>Açıklama<input name="description" placeholder="${escapeHtml(movementTypeLabel(movementType))}" /></label>
        <footer class="modal-actions">
          <button type="button" class="ghost" id="cancelActionModal">Vazgeç</button>
          <button type="submit" class="primary">Kaydet</button>
        </footer>
      </form>
    `
  );
  document.querySelector("#cancelActionModal").addEventListener("click", () => openAccountSummary(kind, row));
  document.querySelector("#accountMovementForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type='submit']");
    const payload = Object.fromEntries(new FormData(form).entries());
    button.disabled = true;
    button.textContent = "Kaydediliyor";
    try {
      const response = await fetch("/api/account-movements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await readJsonResponse(response, "Hareket kaydedilemedi");
      state.payload = result.dashboard;
      renderAll();
      const fresh = (kind === "employee" ? state.payload.employees : state.payload.partners).find((item) => Number(item.id) === Number(row.id));
      openAccountSummary(kind, fresh || row);
      showToast("Hareket kaydedildi");
    } catch (error) {
      showToast(error.message, false);
    } finally {
      button.disabled = false;
      button.textContent = "Kaydet";
    }
  });
}

function openAttachmentModal(kind, row) {
  if (!row) return;
  openActionModal(
    "PDF yükle",
    accountDisplayName(kind, row),
    `
      <form id="attachmentForm" class="record-form">
        <input type="hidden" name="entityType" value="${escapeHtml(kind)}" />
        <input type="hidden" name="entityId" value="${escapeHtml(row.id)}" />
        <label>PDF dosyası<input name="file" type="file" accept=".pdf,application/pdf" required /></label>
        <footer class="modal-actions">
          <button type="button" class="ghost" id="cancelActionModal">Vazgeç</button>
          <button type="submit" class="primary">Yükle</button>
        </footer>
      </form>
    `
  );
  document.querySelector("#cancelActionModal").addEventListener("click", () => openAccountSummary(kind, row));
  document.querySelector("#attachmentForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type='submit']");
    const formData = new FormData(form);
    button.disabled = true;
    button.textContent = "Yükleniyor";
    try {
      const response = await fetch("/api/attachments", { method: "POST", body: formData });
      const result = await readJsonResponse(response, "PDF yüklenemedi");
      state.payload = result.dashboard;
      renderAll();
      const fresh = (kind === "employee" ? state.payload.employees : state.payload.partners).find((item) => Number(item.id) === Number(row.id));
      openAccountSummary(kind, fresh || row);
      showToast("PDF karta eklendi");
    } catch (error) {
      showToast(error.message, false);
    } finally {
      button.disabled = false;
      button.textContent = "Yükle";
    }
  });
}

function runValidation() {
  const controls = state.payload?.controls || [];
  const risky = controls.filter((control) => Number(control.count || 0) > 0);
  activateTab("controls");
  openActionModal(
    "Doğrulama sonucu",
    risky.length ? "Kapanıştan önce ilgilenilmesi gereken başlıklar var." : "Bloklayıcı kontrol bulunmadı.",
    risky.length
      ? `<div class="control-list">${risky.map(controlMarkup).join("")}</div>`
      : `<div class="empty-state">Kritik veri uyarısı yok.</div>`
  );
  showToast("Doğrulama çalıştırıldı", risky.length === 0);
}

function runSimulation() {
  const payables = state.payload?.payables || [];
  const open = payables.filter((row) => Number(row.remaining_amount || 0) > 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const inSevenDays = new Date(today);
  inSevenDays.setDate(today.getDate() + 7);
  const inThirtyDays = new Date(today);
  inThirtyDays.setDate(today.getDate() + 30);
  const datedOpen = open.map((row) => ({ ...row, due: row.due_date ? new Date(String(row.due_date).slice(0, 10)) : null }));
  const overdue = datedOpen.filter((row) => row.due && row.due < today).reduce((sum, row) => sum + Number(row.remaining_amount || 0), 0);
  const dueSeven = datedOpen
    .filter((row) => row.due && row.due >= today && row.due <= inSevenDays)
    .reduce((sum, row) => sum + Number(row.remaining_amount || 0), 0);
  const dueThirty = datedOpen
    .filter((row) => row.due && row.due > inSevenDays && row.due <= inThirtyDays)
    .reduce((sum, row) => sum + Number(row.remaining_amount || 0), 0);
  const noDue = datedOpen.filter((row) => !row.due).reduce((sum, row) => sum + Number(row.remaining_amount || 0), 0);
  const employeePayable = (state.payload?.employees || []).reduce((sum, row) => sum + Number(row.paid_salary || 0), 0);
  const totalNeed = overdue + dueSeven + employeePayable;
  const bankNet = Number(state.payload?.kpis?.bankNet || 0);
  openActionModal(
    "Nakit simülasyonu",
    "Vadesi gelen ödeme, yakın dönem yükü ve personel maaşı üzerinden hızlı görünüm.",
    `
      <div class="result-grid">
        <div><span>Geciken</span><b>${formatMoney(overdue)}</b></div>
        <div><span>7 gün</span><b>${formatMoney(dueSeven)}</b></div>
        <div><span>8-30 gün</span><b>${formatMoney(dueThirty)}</b></div>
        <div><span>Vadesiz açık</span><b>${formatMoney(noDue)}</b></div>
        <div><span>Personel net</span><b>${formatMoney(employeePayable)}</b></div>
        <div><span>Banka net</span><b>${formatMoney(bankNet)}</b></div>
        <div><span>Bugün ihtiyaç</span><b>${formatMoney(totalNeed)}</b></div>
        <div><span>Simüle bakiye</span><b>${formatMoney(bankNet - totalNeed)}</b></div>
        <div><span>Açık kayıt</span><b>${formatNumber(open.length)}</b></div>
      </div>
    `
  );
  showToast("Simülasyon hazır");
}

function openPaymentRun(row = null) {
  const payables = row ? [row] : (state.payload?.payables || []).filter((item) => Number(item.remaining_amount || 0) > 0).slice(0, 10);
  const total = payables.reduce((sum, item) => sum + Number(item.remaining_amount || 0), 0);
  openActionModal(
    "Ödeme run",
    `${formatNumber(payables.length)} kayıt için toplam ${formatMoney(total)} ödeme hazırlığı.`,
    `<div class="compact-list">${payables
      .map((item) => `<article class="compact-item"><div><b>${escapeHtml(item.partner || "-")}</b><span>${escapeHtml(item.invoice_no || "-")}</span></div><strong>${formatMoney(item.remaining_amount)}</strong></article>`)
      .join("") || '<div class="empty-state">Açık fatura yok.</div>'}</div>`
  );
}

function openVoucherPreview(row) {
  const vatAmount = Number(row.vat_amount || 0);
  const expenseAmount = Number(row.purchase_amount || 0) || Math.max(Number(row.gross_total || 0) - vatAmount, 0);
  const grossTotal = Number(row.gross_total || 0);
  openActionModal(
    "Muhasebe fişi",
    "Alış faturası için borç/alacak dengeli ön izleme.",
    `
      <div class="compact-list">
        <article class="compact-item"><div><b>Borç · 770/740 Gider</b><span>${escapeHtml(row.invoice_no || "-")}</span></div><strong>${formatMoney(expenseAmount)}</strong></article>
        <article class="compact-item"><div><b>Borç · 191 İndirilecek KDV</b><span>${escapeHtml(row.partner || "-")}</span></div><strong>${formatMoney(vatAmount)}</strong></article>
        <article class="compact-item"><div><b>Alacak · 320 Satıcılar</b><span>${escapeHtml(row.partner || "-")}</span></div><strong>${formatMoney(grossTotal)}</strong></article>
      </div>
      <footer class="modal-actions">
        <button type="button" class="ghost" id="printVoucherButton">Yazdır</button>
        <button type="button" class="primary" id="closeVoucherButton">Tamam</button>
      </footer>
    `
  );
  document.querySelector("#printVoucherButton")?.addEventListener("click", () => window.print());
  document.querySelector("#closeVoucherButton")?.addEventListener("click", closeActionModal);
}

function openBankMatch(row) {
  if (!row) return;
  const partners = state.payload?.partners || [];
  const invoices = (state.payload?.payables || []).filter((item) => Number(item.remaining_amount || 0) > 0);
  openActionModal(
    "Banka eşleştirme",
    "Ekstre satırı için kalıcı mutabakat kaydı oluştur.",
    `
      <form id="bankMatchForm" class="record-form">
        <input type="hidden" name="lineId" value="${escapeHtml(row.id)}" />
        <div class="compact-list">
          <article class="compact-item"><div><b>${escapeHtml(row.transaction_type || "Ekstre")}</b><span>${escapeHtml(row.transaction_group || "-")}</span></div><strong>${formatMoney(row.net_amount)}</strong></article>
        </div>
        <div class="record-grid">
          <label>İşlem türü
            <select name="matchType" id="bankMatchType">
              <option value="expense">Masraf</option>
              <option value="invoice">Fatura</option>
              <option value="partner">Cari hareket</option>
              <option value="transfer">Virman</option>
              <option value="payroll">Personel / maaş</option>
            </select>
          </label>
          <label>Hesap kodu<input name="accountCode" value="${escapeHtml(row.account_code || suggestedAccountCode(row))}" /></label>
          <label>Cari
            <select name="partnerId">
              <option value="">Seçilmedi</option>
              ${partners.map((partner) => `<option value="${partner.id}">${escapeHtml(partner.name)}</option>`).join("")}
            </select>
          </label>
          <label>Fatura
            <select name="invoiceId">
              <option value="">Seçilmedi</option>
              ${invoices.map((invoice) => `<option value="${invoice.id}">${escapeHtml(invoice.invoice_no || "-")} · ${escapeHtml(invoice.partner || "-")} · ${formatMoney(invoice.remaining_amount)}</option>`).join("")}
            </select>
          </label>
        </div>
        <label>Not<input name="matchNote" value="${escapeHtml(row.match_note || "")}" placeholder="Eşleştirme açıklaması" /></label>
        <footer class="modal-actions">
          <button type="button" class="ghost" id="cancelActionModal">Vazgeç</button>
          <button type="submit" class="primary">Mutabıklaştır</button>
        </footer>
      </form>
    `
  );
  document.querySelector("#cancelActionModal").addEventListener("click", closeActionModal);
  document.querySelector("#bankMatchForm").addEventListener("submit", saveBankMatch);
}

function suggestedAccountCode(row) {
  const text = `${row.transaction_group || ""} ${row.sub_category || ""} ${row.transaction_type || ""}`.toLocaleLowerCase("tr-TR");
  if (text.includes("personel") || text.includes("maaş") || text.includes("avans")) return "335";
  if (text.includes("vergi")) return "360";
  if (text.includes("virman") || text.includes("hesaplar arası")) return "102";
  if (Number(row.net_amount || 0) > 0) return "120";
  return "770";
}

async function saveBankMatch(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  const payload = Object.fromEntries(new FormData(form).entries());
  button.disabled = true;
  button.textContent = "Kaydediliyor";
  try {
    const response = await fetch("/api/bank/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await readJsonResponse(response, "Banka satırı eşleştirilemedi");
    state.payload = result.dashboard;
    renderAll();
    closeActionModal();
    showToast("Banka satırı mutabıklaştırıldı");
  } catch (error) {
    showToast(error.message, false);
  } finally {
    button.disabled = false;
    button.textContent = "Mutabıklaştır";
  }
}

function openBankTransferModal(row = null) {
  const defaultAmount = row ? Math.abs(Number(row.net_amount || 0)) : "";
  openActionModal(
    "Virman fişi",
    row ? `${formatDate(row.transaction_date)} · ${formatMoney(row.net_amount)}` : "Banka hesapları arası transfer kaydı.",
    `
      <form id="bankTransferForm" class="record-form">
        <input type="hidden" name="sourceBankLineId" value="${escapeHtml(row?.id || "")}" />
        <div class="record-grid">
          <label>Tarih<input name="transferDate" type="date" value="${new Date().toISOString().slice(0, 10)}" required /></label>
          <label>Tutar<input name="amount" type="number" min="0.01" step="0.01" value="${escapeHtml(defaultAmount)}" required /></label>
          <label>Çıkış hesabı<input name="fromAccountCode" placeholder="102.01" required /></label>
          <label>Giriş hesabı<input name="toAccountCode" placeholder="102.02" required /></label>
        </div>
        <label>Açıklama<input name="description" value="${escapeHtml(row?.transaction_type || "")}" placeholder="Banka hesapları arası virman" /></label>
        <footer class="modal-actions">
          <button type="button" class="ghost" id="cancelActionModal">Vazgeç</button>
          <button type="submit" class="primary">Fişi Kaydet</button>
        </footer>
      </form>
    `
  );
  document.querySelector("#cancelActionModal").addEventListener("click", closeActionModal);
  document.querySelector("#bankTransferForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type='submit']");
    const payload = Object.fromEntries(new FormData(form).entries());
    button.disabled = true;
    button.textContent = "Kaydediliyor";
    try {
      const response = await fetch("/api/bank/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await readJsonResponse(response, "Virman fişi kaydedilemedi");
      state.payload = result.dashboard;
      renderAll();
      closeActionModal();
      showToast("Virman fişi kaydedildi");
    } catch (error) {
      showToast(error.message, false);
    } finally {
      button.disabled = false;
      button.textContent = "Fişi Kaydet";
    }
  });
}

function focusImport() {
  activateTab("import");
  document.querySelector("#fileInput")?.focus();
  showToast("Import Center açıldı");
}

function downloadTemplate() {
  downloadCsv("erp_import_sablonu.csv", [
    ["Tip", "Cari", "Ad Soyad", "Fatura No", "Tarih", "Vade", "Genel Toplam", "Ödenen", "Maaş", "Avans", "Şantiye"],
    ["Fatura", "ABC Tedarik", "", "FTR-001", "2026-07-30", "2026-08-15", "10000", "0", "", "", "Merkez"],
    ["Personel", "", "Ali Veli", "", "", "", "", "", "30000", "5000", "Merkez"],
  ]);
  showToast("Şablon indirildi");
}

function exportReport(kind) {
  const rows =
    kind === "partners"
      ? state.payload?.partners || []
      : [
          state.payload?.reports || {},
          ...(state.payload?.controls || []).map((item) => ({
            name: item.name,
            count: item.count,
            owner: item.owner,
            action: item.action,
          })),
        ];
  if (!rows.length) {
    showToast("Dışa aktarılacak rapor verisi yok.", false);
    return;
  }
  const columns = Object.keys(rows[0] || {});
  downloadCsv(`rapor-${kind}.csv`, [columns, ...rows.map((row) => columns.map((key) => row[key]))]);
  showToast("Rapor dışa aktarıldı");
}

const bulkToolbarConfig = {
  ap: [
    ["paymentRun", "Ödeme run"],
    ["markPaid", "Ödendi işaretle"],
    ["voucher", "Fiş önizle"],
    ["export", "Dışa aktar"],
  ],
  bank: [
    ["bankMatch", "Eşleştir"],
    ["bankTransfer", "Virman fişi"],
    ["bankExpense", "Masraf yaz"],
    ["export", "Dışa aktar"],
  ],
  paymentInvoices: [
    ["paymentRun", "Ödeme run"],
    ["markPaid", "Ödendi işaretle"],
    ["export", "Dışa aktar"],
  ],
  instruments: [
    ["instrumentSummary", "Portföy özeti"],
    ["export", "Dışa aktar"],
  ],
  partners: [
    ["partnerSummary", "Cari özeti"],
    ["partnerOpening", "Açılış"],
    ["partnerDebit", "Borç dekontu"],
    ["partnerCredit", "Alacak dekontu"],
    ["partnerPdf", "PDF yükle"],
    ["export", "Dışa aktar"],
  ],
  employees: [
    ["employeeSummary", "Personel özeti"],
    ["bulkAdvance", "Avans gir"],
    ["bulkSite", "Şantiye ata"],
    ["employeePdf", "PDF yükle"],
    ["export", "Dışa aktar"],
  ],
  vat: [
    ["vatCheck", "Beyan kontrol"],
    ["export", "Dışa aktar"],
  ],
};

function listRows(list) {
  const payload = state.payload || {};
  if (list === "ap") return payload.payables || [];
  if (list === "bank") return payload.recentBankLines || [];
  if (list === "paymentInvoices") return (payload.payables || []).filter((row) => Number(row.remaining_amount || 0) > 0).slice(0, 12);
  if (list === "instruments") return payload.paymentInstruments || [];
  if (list === "partners") return payload.partners || [];
  if (list === "employees") return payload.employees || [];
  if (list === "vat") return payload.vatSummary || [];
  return [];
}

function idForListRow(list, row) {
  return rowKey(list === "vat" ? row.period || row.id : row.id);
}

function selectedRowsForList(list) {
  const selected = selectionFor(list);
  return listRows(list).filter((row) => selected.has(idForListRow(list, row)));
}

function mountBulkToolbar(list, bodySelector) {
  const body = document.querySelector(bodySelector);
  const card = body?.closest(".table-card");
  if (!card || card.querySelector(`[data-toolbar="${list}"]`)) return;
  const actions = bulkToolbarConfig[list] || [];
  const toolbar = document.createElement("div");
  toolbar.className = "list-toolbar";
  toolbar.dataset.toolbar = list;
  toolbar.innerHTML = `
    <span data-selection-count>0 seçili</span>
    <div>
      ${actions.map(([action, label]) => `<button type="button" class="ghost" data-bulk-action="${action}" data-bulk-list="${list}">${label}</button>`).join("")}
    </div>
  `;
  card.prepend(toolbar);
  toolbar.querySelectorAll("[data-bulk-action]").forEach((button) => {
    button.addEventListener("click", () => handleBulkAction(button.dataset.bulkList, button.dataset.bulkAction));
  });
  updateBulkToolbar(list);
}

function updateBulkToolbar(list) {
  const toolbar = document.querySelector(`[data-toolbar="${list}"]`);
  if (!toolbar) return;
  const count = selectedIds(list).length;
  toolbar.querySelector("[data-selection-count]").textContent = count ? `${formatNumber(count)} seçili` : "Seçim yok";
  toolbar.querySelectorAll("[data-bulk-action]").forEach((button) => {
    button.disabled = count === 0;
  });
}

function updateAllBulkToolbars() {
  Object.keys(bulkToolbarConfig).forEach(updateBulkToolbar);
}

function wireSelectAllControls() {
  document.querySelectorAll("[data-select-all]").forEach((input) => {
    input.addEventListener("change", () => {
      const list = input.dataset.selectAll;
      const selected = selectionFor(list);
      document.querySelectorAll(`[data-select-list="${list}"]`).forEach((rowInput) => {
        const id = rowKey(rowInput.dataset.selectId);
        rowInput.checked = input.checked;
        if (input.checked) selected.add(id);
        else selected.delete(id);
      });
      input.indeterminate = false;
      updateBulkToolbar(list);
    });
  });
}

function wireBulkToolbars() {
  mountBulkToolbar("ap", "#payableRows");
  mountBulkToolbar("bank", "#bankRows");
  mountBulkToolbar("paymentInvoices", "#paymentInvoiceRows");
  mountBulkToolbar("instruments", "#instrumentRows");
  mountBulkToolbar("partners", "#partnerRows");
  mountBulkToolbar("employees", "#employeeRows");
  mountBulkToolbar("vat", "#vatRows");
  wireSelectAllControls();
}

function requireSelection(list) {
  const rows = selectedRowsForList(list);
  if (!rows.length) {
    showToast("Önce listeden kayıt seç.", false);
    return null;
  }
  return rows;
}

function requireSingleSelection(list) {
  const rows = requireSelection(list);
  if (!rows) return null;
  if (rows.length !== 1) {
    showToast("Bu işlem için tek kayıt seç.", false);
    return null;
  }
  return rows[0];
}

async function postBulk(url, payload, successMessage) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await readJsonResponse(response, "Toplu işlem tamamlanamadı");
  state.payload = result.dashboard;
  renderAll();
  showToast(successMessage);
}

async function markSelectedPaid(list) {
  const rows = requireSelection(list);
  if (!rows) return;
  try {
    await postBulk(
      "/api/purchase-invoices/mark-paid",
      { ids: rows.map((row) => row.id) },
      "Seçili faturalar ödenmiş işaretlendi"
    );
    selectionFor(list).clear();
    if (list !== "ap") selectionFor("ap").clear();
    if (list !== "paymentInvoices") selectionFor("paymentInvoices").clear();
    renderAll();
    updateAllBulkToolbars();
  } catch (error) {
    showToast(error.message, false);
  }
}

function exportRows(list) {
  const rows = requireSelection(list);
  if (!rows) return;
  const columns = Object.keys(rows[0] || {});
  downloadCsv(`${list}-secili-kayitlar.csv`, [columns, ...rows.map((row) => columns.map((key) => row[key]))]);
  showToast("Seçili kayıtlar dışa aktarıldı");
}

function openBulkPaymentRun(list) {
  const rows = requireSelection(list);
  if (!rows) return;
  const total = rows.reduce((sum, item) => sum + Number(item.remaining_amount || 0), 0);
  openActionModal(
    "Toplu ödeme run",
    `${formatNumber(rows.length)} seçili kayıt için toplam ${formatMoney(total)} ödeme hazırlığı.`,
    `<div class="compact-list">${rows
      .map((item) => `<article class="compact-item"><div><b>${escapeHtml(item.partner || "-")}</b><span>${escapeHtml(item.invoice_no || "-")}</span></div><strong>${formatMoney(item.remaining_amount)}</strong></article>`)
      .join("")}</div>`
  );
}

function openBulkVoucher(list) {
  const rows = requireSelection(list);
  if (!rows) return;
  const total = rows.reduce((sum, row) => sum + Number(row.gross_total || 0), 0);
  const vat = rows.reduce((sum, row) => sum + Number(row.vat_amount || 0), 0);
  const expense = rows.reduce((sum, row) => {
    const vatAmount = Number(row.vat_amount || 0);
    return sum + (Number(row.purchase_amount || 0) || Math.max(Number(row.gross_total || 0) - vatAmount, 0));
  }, 0);
  openActionModal(
    "Toplu fiş önizleme",
    `${formatNumber(rows.length)} kayıt için dengeli özet fiş.`,
    `<div class="result-grid">
      <div><span>Kayıt</span><b>${formatNumber(rows.length)}</b></div>
      <div><span>Borç gider</span><b>${formatMoney(expense)}</b></div>
      <div><span>Borç KDV</span><b>${formatMoney(vat)}</b></div>
      <div><span>Alacak satıcı</span><b>${formatMoney(total)}</b></div>
    </div>`
  );
}

function openBulkBankMatch(list, expense = false) {
  const rows = requireSelection(list);
  if (!rows) return;
  const total = rows.reduce((sum, row) => sum + Number(row.net_amount || 0), 0);
  openActionModal(
    expense ? "Toplu masraf yaz" : "Toplu banka eşleştirme",
    "Seçili ekstre satırları için işlem ön izlemesi.",
    `<div class="result-grid">
      <div><span>Satır</span><b>${formatNumber(rows.length)}</b></div>
      <div><span>Net tutar</span><b>${formatMoney(total)}</b></div>
      <div><span>İşlem</span><b>${expense ? "Masraf" : "Eşleştirme"}</b></div>
    </div>`
  );
}

function openBulkEmployeeSite() {
  const rows = requireSelection("employees");
  if (!rows) return;
  const sites = state.payload?.projectSites || [];
  openActionModal(
    "Toplu şantiye ata",
    `${formatNumber(rows.length)} personel güncellenecek.`,
    `
      <form id="bulkSiteForm" class="record-form">
        <label>Mevcut şantiye
          <select name="projectSiteName">
            <option value="">Atanmadı</option>
            ${sites.map((site) => `<option value="${escapeHtml(site.name)}">${escapeHtml(site.name)}</option>`).join("")}
          </select>
        </label>
        <label>Yeni şantiye<input name="newProjectSiteName" /></label>
        <footer class="modal-actions">
          <button type="button" class="ghost" id="cancelActionModal">Vazgeç</button>
          <button type="submit" class="primary">Kaydet</button>
        </footer>
      </form>
    `
  );
  document.querySelector("#cancelActionModal").addEventListener("click", closeActionModal);
  document.querySelector("#bulkSiteForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const projectSiteName = data.newProjectSiteName.trim() || data.projectSiteName;
    try {
      await postBulk("/api/employees/bulk-site", { ids: rows.map((row) => row.id), projectSiteName }, "Şantiye ataması kaydedildi");
      selectionFor("employees").clear();
      renderAll();
      updateAllBulkToolbars();
      closeActionModal();
    } catch (error) {
      showToast(error.message, false);
    }
  });
}

function openBulkAdvance() {
  const rows = requireSelection("employees");
  if (!rows) return;
  openActionModal(
    "Toplu avans gir",
    `${formatNumber(rows.length)} personel için aynı avans tutarı yazılır.`,
    `
      <form id="bulkAdvanceForm" class="record-form">
        <label>Avans tutarı<input name="advanceAmount" type="number" min="0" step="0.01" required /></label>
        <footer class="modal-actions">
          <button type="button" class="ghost" id="cancelActionModal">Vazgeç</button>
          <button type="submit" class="primary">Kaydet</button>
        </footer>
      </form>
    `
  );
  document.querySelector("#cancelActionModal").addEventListener("click", closeActionModal);
  document.querySelector("#bulkAdvanceForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      await postBulk("/api/employees/bulk-advance", { ids: rows.map((row) => row.id), advanceAmount: data.advanceAmount }, "Avanslar kaydedildi");
      selectionFor("employees").clear();
      renderAll();
      updateAllBulkToolbars();
      closeActionModal();
    } catch (error) {
      showToast(error.message, false);
    }
  });
}

function openSimpleSummary(list, title) {
  const rows = requireSelection(list);
  if (!rows) return;
  const total = rows.reduce((sum, row) => sum + Number(row.amount || row.open_balance || row.net_vat || 0), 0);
  openActionModal(
    title,
    "Seçili kayıt özeti.",
    `<div class="result-grid">
      <div><span>Kayıt</span><b>${formatNumber(rows.length)}</b></div>
      <div><span>Toplam</span><b>${formatMoney(total)}</b></div>
    </div>`
  );
}

function openSelectedAccountSummary(kind, list) {
  const row = requireSingleSelection(list);
  if (!row) return;
  openAccountSummary(kind, row);
}

function openSelectedMovement(kind, list, movementType) {
  const row = requireSingleSelection(list);
  if (!row) return;
  openMovementModal(kind, row, movementType);
}

function openSelectedAttachment(kind, list) {
  const row = requireSingleSelection(list);
  if (!row) return;
  openAttachmentModal(kind, row);
}

function handleBulkAction(list, action) {
  if (action === "paymentRun") return openBulkPaymentRun(list);
  if (action === "markPaid") return markSelectedPaid(list);
  if (action === "voucher") return openBulkVoucher(list);
  if (action === "bankMatch") return openBulkBankMatch(list);
  if (action === "bankTransfer") {
    const row = requireSingleSelection(list);
    return row ? openBankTransferModal(row) : undefined;
  }
  if (action === "bankExpense") return openBulkBankMatch(list, true);
  if (action === "bulkAdvance") return openBulkAdvance();
  if (action === "bulkSite") return openBulkEmployeeSite();
  if (action === "employeeSummary") return openSelectedAccountSummary("employee", list);
  if (action === "employeePdf") return openSelectedAttachment("employee", list);
  if (action === "instrumentSummary") return openSimpleSummary(list, "Portföy özeti");
  if (action === "partnerSummary") return openSelectedAccountSummary("partner", list);
  if (action === "partnerOpening") return openSelectedMovement("partner", list, "opening_balance");
  if (action === "partnerDebit") return openSelectedMovement("partner", list, "debit_note");
  if (action === "partnerCredit") return openSelectedMovement("partner", list, "credit_note");
  if (action === "partnerPdf") return openSelectedAttachment("partner", list);
  if (action === "vatCheck") return runValidation();
  if (action === "export") return exportRows(list);
}

function wireCommandButtons() {
  const topButtons = document.querySelectorAll(".app-actions button:not(#logoutButton)");
  topButtons[0]?.addEventListener("click", runSimulation);
  topButtons[1]?.addEventListener("click", runValidation);
  topButtons[2]?.addEventListener("click", () => openNewRecordModal());

  document.querySelector("#ap .page-head .primary")?.addEventListener("click", () => openNewRecordModal("invoice"));
  document.querySelector("#bankTransferButton")?.addEventListener("click", () => openBankTransferModal());
  document.querySelector("#bank .page-head .primary")?.addEventListener("click", focusImport);
  document.querySelector("#payments .page-head .primary")?.addEventListener("click", () => openPaymentRun());
  document.querySelector("#partners .page-head .primary")?.addEventListener("click", () => openNewRecordModal("partner"));
  document.querySelector("#employees .page-head .primary")?.addEventListener("click", () => openNewRecordModal("employee"));
  document.querySelector("#tax .page-head .primary")?.addEventListener("click", runValidation);
  document.querySelector("#controls .page-head .primary")?.addEventListener("click", runValidation);
  document.querySelector("#reports .page-head .primary")?.addEventListener("click", () => {
    renderReports(state.payload || {});
    showToast("Rapor yenilendi");
  });
  document.querySelector("#import .page-head .ghost")?.addEventListener("click", downloadTemplate);
  document.querySelectorAll("[data-report-export]").forEach((button) => {
    button.addEventListener("click", () => exportReport(button.dataset.reportExport));
  });

  document.querySelectorAll("#home .block-head .text-button").forEach((button) => {
    button.addEventListener("click", runValidation);
  });
  document.querySelector("#ap .filterbar .ghost:last-child")?.addEventListener("click", downloadTemplate);
}

function renderAll() {
  const payload = state.payload || {};
  renderKpis(payload.kpis);
  renderQueue(payload.workQueue);
  renderBankGroups(payload.bankGroups);
  renderControls(payload.controls);
  renderPayables(payload.payables || []);
  renderBank(payload.recentBankLines || []);
  renderPayments(payload.payables || [], payload.paymentInstruments || []);
  renderPartners(payload.partners || []);
  renderEmployees(payload.employees || []);
  renderVat(payload.vatSummary || []);
  renderReports(payload);
  renderImportInfo(payload);
  updateAllBulkToolbars();
}

async function loadDashboard() {
  const response = await fetch("/api/dashboard");
  if (response.status === 401) {
    window.location.href = "/login";
    return;
  }
  state.payload = await readJsonResponse(response, "Dashboard alınamadı");
  renderAll();
  setStatus("Hazır");
}

async function loadCurrentUser() {
  const response = await fetch("/api/me");
  if (response.status === 401) {
    window.location.href = "/login";
    return;
  }
  const payload = await readJsonResponse(response, "Kullanıcı bilgisi alınamadı");
  const user = payload.user;
  document.querySelector("#userChip").textContent = `${user.full_name} · ${user.role}`;
}

function activateTab(tab) {
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.tab === tab));
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === tab));
}

function wireNavigation() {
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", () => activateTab(item.dataset.tab));
  });
}

function wireSearch() {
  const global = document.querySelector("#globalSearch");
  global.addEventListener("input", () => {
    state.query = global.value.trim().toLocaleLowerCase("tr-TR");
    renderAll();
  });

  document.querySelectorAll("[data-filter]").forEach((input) => {
    input.addEventListener("input", () => {
      state.query = input.value.trim().toLocaleLowerCase("tr-TR");
      renderAll();
    });
  });
}

function renderImportResult(summary) {
  const records = summary.records || {};
  document.querySelector("#importResult").innerHTML = `
    <div class="result-grid">
      <div><span>Sayfa</span><b>${formatNumber(summary.sheetCount || 0)}</b></div>
      <div><span>Fatura</span><b>${formatNumber(records.purchaseInvoices || 0)}</b></div>
      <div><span>Banka</span><b>${formatNumber(records.bankLines || 0)}</b></div>
      <div><span>Personel</span><b>${formatNumber(records.employees || 0)}</b></div>
      <div><span>Çek/Senet</span><b>${formatNumber(records.paymentInstruments || 0)}</b></div>
    </div>
    <pre class="log">${escapeHtml(JSON.stringify({ sheets: summary.sheets, warnings: summary.warnings }, null, 2))}</pre>
  `;
}

function wireUpload() {
  const form = document.querySelector("#uploadForm");
  const fileInput = document.querySelector("#fileInput");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = fileInput.files[0];
    if (!file) {
      document.querySelector("#importResult").textContent = "Lütfen bir Excel dosyası seç.";
      return;
    }

    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    button.textContent = "Aktarılıyor";

    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/import", { method: "POST", body: formData });
      const payload = await readJsonResponse(response, "Aktarım başarısız");
      state.payload = payload.dashboard;
      state.selectedPayable = null;
      renderImportResult(payload.summary);
      renderAll();
      setStatus("Aktarım tamam");
    } catch (error) {
      document.querySelector("#importResult").textContent = error.message;
      setStatus("Hata", false);
    } finally {
      button.disabled = false;
      button.textContent = "Aktarımı Başlat";
    }
  });
}

function wireLogout() {
  document.querySelector("#logoutButton").addEventListener("click", async () => {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  });
}

function wireAdvanceModal() {
  document.querySelector("#closeAdvanceModal").addEventListener("click", closeAdvanceModal);
  document.querySelector("#cancelAdvanceModal").addEventListener("click", closeAdvanceModal);
  document.querySelector("#advanceMonthlySalary").addEventListener("input", updateAdvancePreview);
  document.querySelector("#advanceAmount").addEventListener("input", updateAdvancePreview);
  document.querySelector("#advanceModal").addEventListener("click", (event) => {
    if (event.target.id === "advanceModal") closeAdvanceModal();
  });
  document.querySelector("#advanceForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveCompensationFromModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !document.querySelector("#advanceModal").hidden) {
      closeAdvanceModal();
    }
  });
}

function wireSiteModal() {
  document.querySelector("#closeSiteModal").addEventListener("click", closeSiteModal);
  document.querySelector("#cancelSiteModal").addEventListener("click", closeSiteModal);
  document.querySelector("#siteModal").addEventListener("click", (event) => {
    if (event.target.id === "siteModal") closeSiteModal();
  });
  document.querySelector("#siteForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveSiteFromModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !document.querySelector("#siteModal").hidden) {
      closeSiteModal();
    }
  });
}

async function boot() {
  wireNavigation();
  wireSearch();
  wireCommandButtons();
  wireBulkToolbars();
  wireUpload();
  wireLogout();
  wireAdvanceModal();
  wireSiteModal();
  try {
    await loadCurrentUser();
    await loadDashboard();
  } catch {
    setStatus("Backend yok", false);
  }
}

boot();
