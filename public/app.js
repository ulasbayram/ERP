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

function setStatus(text, ok = true) {
  const el = document.querySelector("#serverStatus");
  el.textContent = text;
  el.style.background = ok ? "#eaf4ee" : "#fff1e1";
  el.style.color = ok ? "#2f7a4f" : "#a66a00";
}

function includesQuery(row) {
  if (!state.query) return true;
  return JSON.stringify(row).toLocaleLowerCase("tr-TR").includes(state.query);
}

function renderKpis(kpis = {}) {
  const items = [
    ["Açık fatura", formatNumber(kpis.pendingInvoices), formatMoney(kpis.invoiceRemaining)],
    ["Fatura toplamı", formatMoney(kpis.invoiceTotal), `${formatNumber(kpis.invoiceCount)} kayıt`],
    ["Banka net", formatMoney(kpis.bankNet), `${formatNumber(kpis.bankLineCount)} ekstre satırı`],
    ["Çek / senet", formatMoney(kpis.paymentInstrumentTotal), `${formatNumber(kpis.paymentInstrumentCount)} portföy kaydı`],
    ["Personel", formatNumber(kpis.employeeCount), "KVKK maskeli ana veri"],
    ["Veri uyarısı", formatNumber((kpis.duplicateInvoices || 0) + (kpis.missingDueDates || 0) + (kpis.missingCostCategory || 0)), "Kapanış öncesi kontrol"],
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
    : `<tr><td colspan="7">Kayıt bulunamadı.</td></tr>`;

  document.querySelectorAll("[data-payable]").forEach((rowEl) => {
    rowEl.addEventListener("click", () => {
      const id = Number(rowEl.dataset.payable);
      state.selectedPayable = rows.find((row) => row.id === id);
      renderInspector();
    });
  });

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
    <button class="primary wide">Ödeme için seç</button>
    <button class="ghost wide">Muhasebe fişi</button>
  `;
}

function renderBank(rows = []) {
  const filtered = rows.filter(includesQuery);
  document.querySelector("#bankRows").innerHTML = filtered.length
    ? filtered
        .map(
          (row) => `
            <tr>
              <td>${formatDate(row.transaction_date)}</td>
              <td>${escapeHtml(row.transaction_type || "-")}</td>
              <td>${escapeHtml(row.transaction_group || "-")} / ${escapeHtml(row.sub_category || "-")}</td>
              <td class="amount">${formatMoney(row.net_amount)}</td>
              <td><button class="ghost">Eşleştir</button></td>
            </tr>
          `
        )
        .join("")
    : `<tr><td colspan="5">Kayıt bulunamadı.</td></tr>`;
}

function renderPayments(payables = [], instruments = []) {
  const open = payables.filter((row) => Number(row.remaining_amount || 0) > 0).slice(0, 12);
  document.querySelector("#paymentInvoiceRows").innerHTML = open.length
    ? open
        .map(
          (row) => `
            <tr>
              <td>${formatDate(row.due_date)}</td>
              <td>${escapeHtml(row.partner || "-")}</td>
              <td>${escapeHtml(row.invoice_no || "-")}</td>
              <td class="amount">${formatMoney(row.remaining_amount)}</td>
            </tr>
          `
        )
        .join("")
    : `<tr><td colspan="4">Açık fatura yok.</td></tr>`;

  document.querySelector("#instrumentRows").innerHTML = instruments.length
    ? instruments
        .map(
          (row) => `
            <tr>
              <td>${formatDate(row.due_date)}</td>
              <td>${escapeHtml(row.partner || "-")}</td>
              <td>${escapeHtml(row.instrument_no || "-")}</td>
              <td class="amount">${formatMoney(row.amount)}</td>
            </tr>
          `
        )
        .join("")
    : `<tr><td colspan="4">Portföy kaydı yok.</td></tr>`;
}

function renderPartners(rows = []) {
  const filtered = rows.filter(includesQuery);
  document.querySelector("#partnerRows").innerHTML = filtered
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.name)}</td>
          <td>${escapeHtml(row.partner_type)}</td>
          <td class="amount">${formatNumber(row.invoice_count)}</td>
          <td class="amount">${formatMoney(row.gross_total)}</td>
          <td class="amount">${formatMoney(row.open_balance)}</td>
        </tr>
      `
    )
    .join("");
}

function renderEmployees(rows = []) {
  const filtered = rows.filter(includesQuery);
  document.querySelector("#employeeRows").innerHTML = filtered
    .map(
      (row) => {
        const jobTitle = cleanJobTitle(row);
        return `
          <tr data-employee="${row.id}">
            <td>${escapeHtml(row.full_name)}</td>
            <td>${formatDate(row.hire_date)}</td>
            <td>${escapeHtml(jobTitle)}</td>
            <td>${escapeHtml(row.project_site || "")}</td>
            <td class="amount">${formatNumber(row.worked_days)}</td>
            <td class="amount">${formatMoney(row.monthly_salary)}</td>
            <td class="amount">${formatMoney(row.advance_amount)}</td>
            <td class="amount">${formatMoney(row.paid_salary)}</td>
            <td><span class="badge ${row.status}">${statusLabel(row.status)}</span></td>
            <td class="row-actions"><button class="ghost" data-open-site>Şantiye</button><button class="ghost" data-open-advance>Avans</button></td>
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
  });
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
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Şantiye kaydedilemedi");
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
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Personel kaydedilemedi");
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
    : `<tr><td colspan="6">KDV hareketi yok.</td></tr>`;
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
  renderImportInfo(payload);
}

async function loadDashboard() {
  const response = await fetch("/api/dashboard");
  if (response.status === 401) {
    window.location.href = "/login";
    return;
  }
  if (!response.ok) throw new Error("Dashboard alınamadı");
  state.payload = await response.json();
  renderAll();
  setStatus("Hazır");
}

async function loadCurrentUser() {
  const response = await fetch("/api/me");
  if (response.status === 401) {
    window.location.href = "/login";
    return;
  }
  const payload = await response.json();
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
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Aktarım başarısız");
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
