const money = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  maximumFractionDigits: 0,
});

const number = new Intl.NumberFormat("tr-TR");

const state = {
  payload: null,
  user: null,
  companies: [],
  companyId: null,
  permissions: {},
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

const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  const url = typeof input === "string" ? input : input?.url || "";
  if (state.companyId && url.startsWith("/api/")) {
    const headers = new Headers(init.headers || (typeof input !== "string" ? input.headers : undefined));
    headers.set("X-Company-Id", String(state.companyId));
    init = { ...init, headers };
  }
  return nativeFetch(input, init);
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

function instrumentTypeLabel(value) {
  const labels = {
    cek: "Çek",
    çek: "Çek",
    senet: "Senet",
    check: "Çek",
    note: "Senet",
  };
  return labels[String(value || "").toLocaleLowerCase("tr-TR")] || value || "-";
}

function bankMatchLabel(value) {
  return value === "matched" ? "Mutabık" : "Bekliyor";
}

function matchTypeLabel(value) {
  const labels = {
    invoice: "Fatura",
    partner: "Cari hareket",
    expense: "Masraf",
    transfer: "Virman",
    payroll: "Personel / maaş",
  };
  return labels[value] || value || "-";
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
    overtime: "Mesai tahakkuku",
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

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function columnName(index) {
  let name = "";
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

function worksheetXml(rows) {
  const rowCount = Math.max(rows.length, 1);
  const colCount = Math.max(...rows.map((row) => row.length), 1);
  const lastCell = `${columnName(colCount - 1)}${rowCount}`;
  const colWidths = Array.from({ length: colCount }, (_, index) => {
    const maxLength = Math.min(
      Math.max(...rows.map((row) => String(row[index] ?? "").length), 10) + 2,
      42
    );
    return `<col min="${index + 1}" max="${index + 1}" width="${maxLength}" customWidth="1"/>`;
  }).join("");
  const sheetRows = rows
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map((value, colIndex) => {
            const ref = `${columnName(colIndex)}${rowIndex + 1}`;
            if (typeof value === "number" && Number.isFinite(value)) {
              return `<c r="${ref}"><v>${value}</v></c>`;
            }
            return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
          })
          .join("")}</row>`
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastCell}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${colWidths}</cols><sheetData>${sheetRows}</sheetData><autoFilter ref="A1:${lastCell}"/></worksheet>`;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pushU16(target, value) {
  target.push(value & 0xff, (value >>> 8) & 0xff);
}

function pushU32(target, value) {
  target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function createZip(files) {
  const encoder = new TextEncoder();
  const output = [];
  const centralDirectory = [];
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  Object.entries(files).forEach(([name, content]) => {
    const nameBytes = encoder.encode(name);
    const contentBytes = encoder.encode(content);
    const checksum = crc32(contentBytes);
    const offset = output.length;

    pushU32(output, 0x04034b50);
    pushU16(output, 20);
    pushU16(output, 0);
    pushU16(output, 0);
    pushU16(output, dosTime);
    pushU16(output, dosDate);
    pushU32(output, checksum);
    pushU32(output, contentBytes.length);
    pushU32(output, contentBytes.length);
    pushU16(output, nameBytes.length);
    pushU16(output, 0);
    output.push(...nameBytes, ...contentBytes);

    pushU32(centralDirectory, 0x02014b50);
    pushU16(centralDirectory, 20);
    pushU16(centralDirectory, 20);
    pushU16(centralDirectory, 0);
    pushU16(centralDirectory, 0);
    pushU16(centralDirectory, dosTime);
    pushU16(centralDirectory, dosDate);
    pushU32(centralDirectory, checksum);
    pushU32(centralDirectory, contentBytes.length);
    pushU32(centralDirectory, contentBytes.length);
    pushU16(centralDirectory, nameBytes.length);
    pushU16(centralDirectory, 0);
    pushU16(centralDirectory, 0);
    pushU16(centralDirectory, 0);
    pushU16(centralDirectory, 0);
    pushU32(centralDirectory, 0);
    pushU32(centralDirectory, offset);
    centralDirectory.push(...nameBytes);
  });

  const centralOffset = output.length;
  output.push(...centralDirectory);
  pushU32(output, 0x06054b50);
  pushU16(output, 0);
  pushU16(output, 0);
  pushU16(output, Object.keys(files).length);
  pushU16(output, Object.keys(files).length);
  pushU32(output, centralDirectory.length);
  pushU32(output, centralOffset);
  pushU16(output, 0);
  return new Uint8Array(output);
}

function createXlsx(rows) {
  return createZip({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Rapor" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": worksheetXml(rows),
  });
}

function downloadSpreadsheet(filename, rows) {
  const outputName = filename.replace(/\.csv$/i, ".xlsx");
  const blob = new Blob([createXlsx(rows)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = outputName;
  link.click();
  URL.revokeObjectURL(link.href);
}

function asNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

const exportSchemas = {
  ap: [
    ["Fatura Tarihi", (row) => formatDate(row.invoice_date)],
    ["Vade Tarihi", (row) => formatDate(row.due_date)],
    ["Belge No", (row) => row.invoice_no || ""],
    ["Cari", (row) => row.partner || ""],
    ["Maliyet Merkezi", (row) => row.project_site || ""],
    ["Alış Tutarı", (row) => asNumber(row.purchase_amount)],
    ["KDV Tutarı", (row) => asNumber(row.vat_amount)],
    ["Genel Toplam", (row) => asNumber(row.gross_total)],
    ["Ödenen", (row) => asNumber(row.paid_amount)],
    ["Kalan", (row) => asNumber(row.remaining_amount)],
    ["Durum", (row) => statusLabel(row.payment_status || (asNumber(row.remaining_amount) > 0 ? "pending" : "paid"))],
  ],
  bank: [
    ["Tarih", (row) => formatDate(row.transaction_date)],
    ["Açıklama", (row) => row.transaction_type || ""],
    ["Grup", (row) => row.transaction_group || ""],
    ["Alt Kategori", (row) => row.sub_category || ""],
    ["Net Tutar", (row) => asNumber(row.net_amount)],
    ["Mutabakat Durumu", (row) => bankMatchLabel(row.match_status)],
    ["Eşleşme Türü", (row) => matchTypeLabel(row.match_type)],
    ["Hesap Kodu", (row) => row.account_code || ""],
    ["Not", (row) => row.match_note || ""],
  ],
  paymentInvoices: [
    ["Vade Tarihi", (row) => formatDate(row.due_date)],
    ["Cari", (row) => row.partner || ""],
    ["Fatura No", (row) => row.invoice_no || ""],
    ["Kalan Tutar", (row) => asNumber(row.remaining_amount)],
    ["Durum", (row) => statusLabel(row.payment_status)],
  ],
  instruments: [
    ["Vade Tarihi", (row) => formatDate(row.due_date)],
    ["Cari", (row) => row.partner || ""],
    ["Evrak Tipi", (row) => instrumentTypeLabel(row.instrument_type)],
    ["Evrak No", (row) => row.instrument_no || ""],
    ["Banka", (row) => row.bank_name || ""],
    ["Tutar", (row) => asNumber(row.amount)],
    ["Durum", (row) => statusLabel(row.status)],
  ],
  partners: [
    ["Cari ID", (row) => asNumber(row.id)],
    ["Cari", (row) => row.name || ""],
    ["Tip", (row) => partnerTypeLabel(row.partner_type)],
    ["Fatura Sayısı", (row) => asNumber(row.invoice_count)],
    ["Fatura Toplamı", (row) => asNumber(row.gross_total)],
    ["Borç Toplamı", (row) => asNumber(row.debit_total)],
    ["Alacak Toplamı", (row) => asNumber(row.credit_total)],
    ["PDF Sayısı", (row) => asNumber(row.attachment_count)],
    ["Açık Bakiye", (row) => asNumber(row.open_balance)],
  ],
  employees: [
    ["Personel ID", (row) => asNumber(row.id)],
    ["Ad Soyad", (row) => row.full_name || ""],
    ["İşe Giriş", (row) => formatDate(row.hire_date)],
    ["İşten Çıkış", (row) => formatDate(row.leave_date)],
    ["Kıdem / Meslek", (row) => cleanJobTitle(row)],
    ["Şantiye", (row) => row.project_site || ""],
    ["Aktif Gün", (row) => asNumber(row.payroll_days || row.worked_days)],
    ["Aylık Maaş", (row) => asNumber(row.monthly_salary)],
    ["Tahakkuk Maaşı", (row) => asNumber(row.base_salary)],
    ["Mesai Saati", (row) => asNumber(row.overtime_hours)],
    ["Mesai Tutarı", (row) => asNumber(row.overtime_total)],
    ["Avans", (row) => asNumber(row.advance_amount)],
    ["Ödenecek Maaş", (row) => asNumber(row.paid_salary)],
    ["IBAN", (row) => row.iban_masked || ""],
    ["Durum", (row) => statusLabel(row.status)],
    ["PDF Sayısı", (row) => asNumber(row.attachment_count)],
  ],
  vat: [
    ["Dönem", (row) => row.period || ""],
    ["Alış Matrah", (row) => asNumber(row.purchase_base)],
    ["Alış KDV", (row) => asNumber(row.purchase_vat)],
    ["Satış Matrah", (row) => asNumber(row.sales_base)],
    ["Tevkifat", (row) => asNumber(row.withholding)],
    ["Net KDV", (row) => asNumber(row.net_vat)],
  ],
};

const exportFileNames = {
  ap: "alis-faturalari",
  bank: "banka-mutabakati",
  paymentInvoices: "odeme-faturalari",
  instruments: "cek-senet-portfoyu",
  partners: "cariler",
  employees: "personel",
  vat: "kdv-tevkifat",
};

function buildExportRows(schema, rows) {
  return [
    schema.map(([header]) => header),
    ...rows.map((row) => schema.map(([, getter]) => getter(row))),
  ];
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
            <td class="amount">${formatNumber(row.payroll_days || row.worked_days)}</td>
            <td class="amount">${formatMoney(row.monthly_salary)}</td>
            <td class="amount">${formatMoney(row.overtime_total)}</td>
            <td class="amount">${formatMoney(row.advance_amount)}</td>
            <td class="amount">${formatMoney(row.paid_salary)}</td>
            <td>${escapeHtml(row.iban_masked || "-")}</td>
            <td><span class="badge ${row.status}">${statusLabel(row.status)}</span></td>
            <td class="row-actions">
              <button class="ghost" data-open-employee-summary>Özet</button>
              <button class="ghost" data-open-site>Şantiye</button>
              <button class="ghost" data-open-advance>Avans</button>
              <button class="ghost" data-open-overtime>Mesai</button>
              <button class="ghost" data-open-payroll>Fiş</button>
              <button class="ghost danger-action" data-delete-employee>Sil</button>
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
    rowEl.querySelector("[data-open-overtime]").addEventListener("click", () => {
      const employee = rows.find((item) => item.id === Number(rowEl.dataset.employee));
      openOvertimeModal(employee);
    });
    rowEl.querySelector("[data-open-payroll]").addEventListener("click", () => {
      const employee = rows.find((item) => item.id === Number(rowEl.dataset.employee));
      openPayrollVoucher(employee);
    });
    rowEl.querySelector("[data-delete-employee]").addEventListener("click", () => {
      const employee = rows.find((item) => item.id === Number(rowEl.dataset.employee));
      deleteEmployees([employee]);
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
  document.querySelector("#advanceLeaveDate").value = employee.leave_date ? String(employee.leave_date).slice(0, 10) : "";
  document.querySelector("#advanceIban").value = employee.iban_masked || "";
  document.querySelector("#advanceDate").value = new Date().toISOString().slice(0, 10);
  document.querySelector("#advanceAmount").value = "";
  document.querySelector("#advanceNote").value = "";
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
  const currentAdvance = Number(state.selectedEmployee?.advance_amount || 0);
  const overtime = Number(state.selectedEmployee?.overtime_total || 0);
  document.querySelector("#advancePaidSalary").textContent = formatMoney(Math.max(salary + overtime - currentAdvance - advance, 0));
}

async function saveCompensationFromModal() {
  const employeeId = Number(document.querySelector("#advanceEmployeeId").value);
  const monthlySalary = document.querySelector("#advanceMonthlySalary").value;
  const advanceAmount = document.querySelector("#advanceAmount").value;
  const advanceDate = document.querySelector("#advanceDate").value;
  const advanceNote = document.querySelector("#advanceNote").value;
  const iban = document.querySelector("#advanceIban").value;
  const leaveDate = document.querySelector("#advanceLeaveDate").value;
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
        advanceDate,
        advanceNote,
        iban,
        leaveDate,
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

function openOvertimeModal(employee) {
  if (!employee) return;
  openActionModal(
    "Mesai girişi",
    employee.full_name,
    `
      <form id="overtimeForm" class="record-form">
        <input type="hidden" name="employeeId" value="${escapeHtml(employee.id)}" />
        <div class="record-grid">
          <label>Mesai Tarihi<input name="overtimeDate" type="date" value="${new Date().toISOString().slice(0, 10)}" required /></label>
          <label>Saat<input name="hours" type="number" min="0" step="0.01" required /></label>
          <label>Saat Ücreti<input name="hourlyRate" type="number" min="0" step="0.01" required /></label>
          <label>Tutar<input name="amount" type="number" min="0" step="0.01" placeholder="Otomatik hesaplanır" /></label>
        </div>
        <label>Not<input name="note" placeholder="Mesai açıklaması" /></label>
        <footer class="modal-actions">
          <button type="button" class="ghost" id="cancelActionModal">Vazgeç</button>
          <button type="submit" class="primary">Kaydet</button>
        </footer>
      </form>
    `
  );
  const form = document.querySelector("#overtimeForm");
  const hours = form.querySelector("[name='hours']");
  const hourlyRate = form.querySelector("[name='hourlyRate']");
  const amount = form.querySelector("[name='amount']");
  const updateAmount = () => {
    if (document.activeElement === amount && amount.value) return;
    amount.value = ((Number(hours.value) || 0) * (Number(hourlyRate.value) || 0)).toFixed(2);
  };
  hours.addEventListener("input", updateAmount);
  hourlyRate.addEventListener("input", updateAmount);
  document.querySelector("#cancelActionModal").addEventListener("click", closeActionModal);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button[type='submit']");
    const payload = Object.fromEntries(new FormData(form).entries());
    button.disabled = true;
    button.textContent = "Kaydediliyor";
    try {
      const response = await fetch("/api/employees/overtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await readJsonResponse(response, "Mesai kaydedilemedi");
      state.payload = result.dashboard;
      renderAll();
      closeActionModal();
      showToast("Mesai kaydedildi");
    } catch (error) {
      showToast(error.message, false);
    } finally {
      button.disabled = false;
      button.textContent = "Kaydet";
    }
  });
}

function openPayrollVoucher(employee) {
  if (!employee) return;
  const salary = Number(employee.base_salary || employee.monthly_salary || 0);
  const overtime = Number(employee.overtime_total || 0);
  const advance = Number(employee.advance_amount || 0);
  const payable = Number(employee.paid_salary || 0);
  openActionModal(
    "Maaş tahakkuk fişi",
    `${employee.full_name} · ${employee.payroll_period || ""}`,
    `
      <div class="result-grid">
        <div><span>Aktif Gün</span><b>${formatNumber(employee.payroll_days || 0)}</b></div>
        <div><span>Tahakkuk Maaşı</span><b>${formatMoney(salary)}</b></div>
        <div><span>Mesai</span><b>${formatMoney(overtime)}</b></div>
        <div><span>Avans</span><b>${formatMoney(advance)}</b></div>
        <div><span>Ödenecek</span><b>${formatMoney(payable)}</b></div>
      </div>
      <div class="compact-list">
        <article class="compact-item"><div><b>Borç · Personel ücret gideri</b><span>${escapeHtml(employee.full_name)}</span></div><strong>${formatMoney(salary + overtime)}</strong></article>
        <article class="compact-item"><div><b>Alacak · Verilen avans mahsubu</b><span>${formatDate(employee.hire_date)} / ${formatDate(employee.leave_date)}</span></div><strong>${formatMoney(advance)}</strong></article>
        <article class="compact-item"><div><b>Alacak · Ödenecek maaş</b><span>${escapeHtml(employee.iban_masked || "IBAN yok")}</span></div><strong>${formatMoney(payable)}</strong></article>
      </div>
      <footer class="modal-actions">
        <button type="button" class="ghost" id="printPayrollVoucher">Yazdır</button>
        <button type="button" class="primary" id="closePayrollVoucher">Tamam</button>
      </footer>
    `
  );
  document.querySelector("#printPayrollVoucher")?.addEventListener("click", () => window.print());
  document.querySelector("#closePayrollVoucher")?.addEventListener("click", closeActionModal);
}

async function deleteEmployees(rows) {
  const validRows = (rows || []).filter(Boolean);
  if (!validRows.length) return;
  const label = validRows.length === 1 ? validRows[0].full_name : `${formatNumber(validRows.length)} personel`;
  if (!window.confirm(`${label} silinsin mi? Bu işlem kartı listeden kaldırır.`)) return;
  try {
    const response = await fetch("/api/employees/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: validRows.map((row) => row.id) }),
    });
    const result = await readJsonResponse(response, "Personel silinemedi");
    state.payload = result.dashboard;
    selectionFor("employees").clear();
    renderAll();
    showToast("Personel silindi");
  } catch (error) {
    showToast(error.message, false);
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

function renderCompanySelector() {
  const select = document.querySelector("#companySelect");
  if (!select) return;
  const companies = state.companies.length ? state.companies : state.payload?.companies || [];
  const selected = state.companyId || state.payload?.selectedCompany?.id || companies[0]?.id;
  select.innerHTML = companies
    .map((company) => `<option value="${company.id}" ${Number(company.id) === Number(selected) ? "selected" : ""}>${escapeHtml(company.name)}${company.status === "archived" ? " (Arşiv)" : ""}</option>`)
    .join("");
  select.disabled = !state.permissions?.canSwitchCompany;
  document.querySelectorAll('[data-permission="logs"]').forEach((item) => {
    item.hidden = !state.permissions?.canViewLogs;
  });
  document.querySelectorAll('[data-permission="admin"]').forEach((item) => {
    item.hidden = !state.permissions?.canManageUsers;
  });
  const createCompanyButton = document.querySelector("#createCompanyButton");
  if (createCompanyButton) createCompanyButton.hidden = !state.permissions?.canSwitchCompany;
}

function roleLabel(value) {
  const labels = {
    admin: "Admin",
    owner: "Şirket sahibi",
    accountant: "Muhasebeci",
  };
  return labels[value] || value || "-";
}

function compactJson(value) {
  if (!value) return "-";
  try {
    const parsed = JSON.parse(value);
    return Object.entries(parsed)
      .slice(0, 4)
      .map(([key, item]) => `${key}: ${typeof item === "object" ? JSON.stringify(item) : item}`)
      .join(" · ");
  } catch {
    return value;
  }
}

function renderAuditLogs(rows = []) {
  const body = document.querySelector("#auditRows");
  if (!body) return;
  if (!state.permissions?.canViewLogs) {
    body.innerHTML = `<tr><td colspan="5" class="empty-state">Bu ekran için yetki gerekli.</td></tr>`;
    return;
  }
  body.innerHTML =
    rows
      .map(
        (row) => `
          <tr>
            <td>${formatDate(row.created_at)}</td>
            <td>${escapeHtml(row.actor || "-")}</td>
            <td>${escapeHtml(row.action || "-")}</td>
            <td>${escapeHtml(row.entity_name || "-")} #${escapeHtml(row.entity_id || "-")}</td>
            <td>${escapeHtml(compactJson(row.new_value || row.old_value))}</td>
          </tr>
        `
      )
      .join("") || `<tr><td colspan="5" class="empty-state">Bu firma için log yok.</td></tr>`;
}

function wireCompanySelector() {
  const select = document.querySelector("#companySelect");
  select?.addEventListener("change", async () => {
    state.companyId = Number(select.value);
    setStatus("Firma değiştiriliyor");
    await loadDashboard();
  });
  document.querySelector("#createCompanyButton")?.addEventListener("click", () => {
    openActionModal(
      "Firma aç",
      "Yeni firma ayrı muhasebe datası ile başlar.",
      `
        <form id="companyForm" class="record-form">
          <label>Firma adı<input name="name" required /></label>
          <label>Vergi no<input name="taxNumber" /></label>
          <footer class="modal-actions">
            <button type="button" class="ghost" id="cancelActionModal">Vazgeç</button>
            <button type="submit" class="primary">Kaydet</button>
          </footer>
        </form>
      `
    );
    document.querySelector("#cancelActionModal").addEventListener("click", closeActionModal);
    document.querySelector("#companyForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget).entries());
      try {
        const response = await fetch("/api/companies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        state.payload = (await readJsonResponse(response, "Firma oluşturulamadı")).dashboard;
        state.companyId = state.payload?.selectedCompany?.id || state.companyId;
        state.companies = state.payload?.companies || state.companies;
        renderAll();
        closeActionModal();
        showToast("Firma oluşturuldu");
      } catch (error) {
        showToast(error.message, false);
      }
    });
  });
}

function renderAdminDashboard() {
  const userBody = document.querySelector("#adminUserRows");
  const companyBody = document.querySelector("#adminCompanyRows");
  if (!userBody || !companyBody) return;
  if (!state.permissions?.canManageUsers) {
    userBody.innerHTML = `<tr><td colspan="5" class="empty-state">Admin yetkisi gerekli.</td></tr>`;
    companyBody.innerHTML = `<div class="empty-state">Admin yetkisi gerekli.</div>`;
    return;
  }
  const companies = state.payload?.companies || state.companies || [];
  const users = state.payload?.adminUsers || [];
  const companyOptions = (selectedId) =>
    `<option value="">Atama bekliyor</option>${companies
      .map((company) => `<option value="${company.id}" ${Number(company.id) === Number(selectedId) ? "selected" : ""}>${escapeHtml(company.name)}</option>`)
      .join("")}`;
  userBody.innerHTML =
    users
      .map(
        (user) => `
          <tr data-admin-user="${user.id}">
            <td>
              <input data-user-full-name value="${escapeHtml(user.full_name || "")}" />
              <input data-user-email type="email" value="${escapeHtml(user.email || "")}" />
            </td>
            <td><select data-user-company>${companyOptions(user.company_id)}</select></td>
            <td>
              <select data-user-role>
                <option value="accountant" ${user.role === "accountant" ? "selected" : ""}>Muhasebeci</option>
                <option value="owner" ${user.role === "owner" ? "selected" : ""}>Şirket sahibi</option>
                <option value="admin" ${user.role === "admin" ? "selected" : ""}>Admin</option>
              </select>
            </td>
            <td><label class="inline-check"><input type="checkbox" data-user-active ${Number(user.is_active) ? "checked" : ""} /> Aktif</label></td>
            <td><button type="button" class="ghost" data-save-user="${user.id}">Kaydet</button></td>
          </tr>
        `
      )
      .join("") || `<tr><td colspan="5" class="empty-state">Kullanıcı yok.</td></tr>`;
  companyBody.innerHTML =
    companies
      .map(
        (company) => `
          <article class="compact-item admin-company-row" data-admin-company="${company.id}">
            <div>
              <input data-company-name value="${escapeHtml(company.name || "")}" />
              <input data-company-tax value="${escapeHtml(company.tax_number || "")}" placeholder="Vergi no" />
            </div>
            <div class="admin-row-actions">
              <select data-company-status>
                <option value="active" ${company.status !== "archived" ? "selected" : ""}>Aktif</option>
                <option value="archived" ${company.status === "archived" ? "selected" : ""}>Arşivli</option>
              </select>
              <button type="button" class="ghost" data-save-company="${company.id}">Kaydet</button>
            </div>
          </article>
        `
      )
      .join("") || `<div class="empty-state">Firma yok.</div>`;
  userBody.querySelectorAll("[data-save-user]").forEach((button) => {
    button.addEventListener("click", () => saveUserAssignment(button.dataset.saveUser));
  });
  companyBody.querySelectorAll("[data-save-company]").forEach((button) => {
    button.addEventListener("click", () => saveCompany(button.dataset.saveCompany));
  });
}

async function saveUserAssignment(userId) {
  const row = document.querySelector(`[data-admin-user="${userId}"]`);
  if (!row) return;
  const payload = {
    userId: Number(userId),
    fullName: row.querySelector("[data-user-full-name]").value,
    email: row.querySelector("[data-user-email]").value,
    companyId: row.querySelector("[data-user-company]").value || null,
    role: row.querySelector("[data-user-role]").value,
    isActive: row.querySelector("[data-user-active]").checked,
  };
  try {
    const response = await fetch("/api/admin/users/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    state.payload = (await readJsonResponse(response, "Kullanıcı güncellenemedi")).dashboard;
    state.companies = state.payload?.companies || state.companies;
    renderAll();
    showToast("Kullanıcı yetkisi güncellendi");
  } catch (error) {
    showToast(error.message, false);
  }
}

async function saveCompany(companyId) {
  const row = document.querySelector(`[data-admin-company="${companyId}"]`);
  if (!row) return;
  const payload = {
    companyId: Number(companyId),
    name: row.querySelector("[data-company-name]").value,
    taxNumber: row.querySelector("[data-company-tax]").value,
    status: row.querySelector("[data-company-status]").value,
  };
  try {
    const response = await fetch("/api/admin/companies/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    state.payload = (await readJsonResponse(response, "Firma güncellenemedi")).dashboard;
    state.companyId = state.payload?.selectedCompany?.id || state.companyId;
    state.companies = state.payload?.companies || state.companies;
    renderAll();
    showToast("Firma güncellendi");
  } catch (error) {
    showToast(error.message, false);
  }
}

function openCreateCompanyModal() {
  document.querySelector("#createCompanyButton")?.click();
}

function wireAdminDashboard() {
  document.querySelector("#adminCreateCompanyButton")?.addEventListener("click", openCreateCompanyModal);
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
      <label>İşten çıkış<input name="leaveDate" type="date" /></label>
      <label>Kıdem / meslek<input name="jobTitle" placeholder="Betonarme Demircisi" /></label>
      <label>Şantiye<input name="projectSite" /></label>
      <label>Çalıştığı gün<input name="workedDays" type="number" min="0" step="1" value="0" /></label>
      <label>Aylık maaş<input name="monthlySalary" type="number" min="0" step="0.01" value="0" /></label>
      <label>Avans<input name="advanceAmount" type="number" min="0" step="0.01" value="0" /></label>
      <label>IBAN<input name="iban" placeholder="TR..." /></label>
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
  if (Number(row.base_salary || row.monthly_salary || 0) > 0) {
    rows.push({
      id: `salary-${row.id}`,
      account_kind: "employee",
      account_id: row.id,
      movement_date: movementDate,
      movement_type: "salary",
      direction: "credit",
      amount: Number(row.base_salary || row.monthly_salary || 0),
      document_no: "BORDRO",
      description: "Aylık maaş tahakkuku",
      source_table: "employees",
    });
  }
  if (Number(row.overtime_total || 0) > 0) {
    rows.push({
      id: `overtime-${row.id}`,
      account_kind: "employee",
      account_id: row.id,
      movement_date: movementDate,
      movement_type: "overtime",
      direction: "credit",
      amount: Number(row.overtime_total || 0),
      document_no: "MESAİ",
      description: "Ay içi mesai tahakkuku",
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
          <a class="ghost link-button" href="/api/attachments/${file.id}?companyId=${state.companyId || ""}" target="_blank" rel="noopener">Aç</a>
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
  downloadSpreadsheet("erp_import_sablonu.xlsx", [
    ["Tip", "Cari", "Ad Soyad", "Fatura No", "Tarih", "Vade", "Genel Toplam", "Ödenen", "Maaş", "Avans", "Şantiye"],
    ["Fatura", "ABC Tedarik", "", "FTR-001", "2026-07-30", "2026-08-15", "10000", "0", "", "", "Merkez"],
    ["Personel", "", "Ali Veli", "", "", "", "", "", "30000", "5000", "Merkez"],
  ]);
  showToast("Şablon indirildi");
}

function exportReport(kind) {
  if (kind === "partners") {
    const rows = state.payload?.partners || [];
    if (!rows.length) {
      showToast("Dışa aktarılacak rapor verisi yok.", false);
      return;
    }
    downloadSpreadsheet("rapor-cariler.xlsx", buildExportRows(exportSchemas.partners, rows));
    showToast("Rapor dışa aktarıldı");
    return;
  }

  const reports = state.payload?.reports || {};
  const controls = state.payload?.controls || [];
  const kpis = state.payload?.kpis || {};
  const rows = [
    ["Borç / Alacak", asNumber(reports.partnerOpenBalance), "Açık cari bakiye"],
    ["Borç Toplamı", asNumber(reports.partnerDebit), "Cari borç kolon toplamı"],
    ["Alacak Toplamı", asNumber(reports.partnerCredit), "Cari alacak kolon toplamı"],
    ["Stok", 0, "Stok modülü henüz aktif değil"],
    ["Maliyet", asNumber(kpis.invoiceTotal), "Alış faturaları toplamı"],
    ["Finans", asNumber(kpis.bankNet), "Banka net pozisyonu"],
    ["Alış / Satış", asNumber(kpis.invoiceTotal), "Alış faturası toplamı; satış modülü sonraki faz"],
    ["Personel Net Ödeme", asNumber(reports.employeeNetPayable), "Maaş + mesai - avans"],
    ["Mutabakat Bekleyen Banka Satırı", asNumber(reports.unmatchedBankLines), "Banka eşleştirme bekleyen satır"],
    ["PDF Belge Sayısı", asNumber(reports.attachmentCount), "Cari/personel kartı ekleri"],
    ...controls.map((item) => [item.name, asNumber(item.count), `${item.owner || ""} · ${item.action || ""}`]),
  ];
  if (!rows.length) {
    showToast("Dışa aktarılacak rapor verisi yok.", false);
    return;
  }
  downloadSpreadsheet("rapor-operasyon.xlsx", [["Başlık", "Değer", "Açıklama"], ...rows]);
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
    ["bulkOvertime", "Mesai gir"],
    ["payrollVoucher", "Tahakkuk fişi"],
    ["bulkSite", "Şantiye ata"],
    ["employeePdf", "PDF yükle"],
    ["deleteEmployees", "Sil"],
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
  const schema = exportSchemas[list] || Object.keys(rows[0] || {}).map((key) => [key, (row) => row[key]]);
  downloadSpreadsheet(`${exportFileNames[list] || list}-secili-kayitlar.xlsx`, buildExportRows(schema, rows));
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
        <label>Avans tarihi<input name="advanceDate" type="date" value="${new Date().toISOString().slice(0, 10)}" required /></label>
        <label>Avans tutarı<input name="advanceAmount" type="number" min="0" step="0.01" required /></label>
        <label>Not<input name="note" /></label>
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
      await postBulk(
        "/api/employees/bulk-advance",
        { ids: rows.map((row) => row.id), advanceAmount: data.advanceAmount, advanceDate: data.advanceDate, note: data.note },
        "Avanslar kaydedildi"
      );
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
  if (action === "bulkOvertime") {
    const row = requireSingleSelection(list);
    return row ? openOvertimeModal(row) : undefined;
  }
  if (action === "payrollVoucher") {
    const row = requireSingleSelection(list);
    return row ? openPayrollVoucher(row) : undefined;
  }
  if (action === "bulkSite") return openBulkEmployeeSite();
  if (action === "employeeSummary") return openSelectedAccountSummary("employee", list);
  if (action === "employeePdf") return openSelectedAttachment("employee", list);
  if (action === "deleteEmployees") return deleteEmployees(requireSelection("employees"));
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
  renderAuditLogs(payload.auditLogs || []);
  renderAdminDashboard();
  state.companies = payload.companies || state.companies;
  state.permissions = payload.permissions || state.permissions;
  state.companyId = payload.selectedCompany?.id || state.companyId;
  renderCompanySelector();
  updateAllBulkToolbars();
}

async function loadDashboard() {
  const response = await fetch("/api/dashboard");
  if (response.status === 401) {
    window.location.href = "/login";
    return;
  }
  if (response.status === 403) {
    const payload = await response.json().catch(() => ({ error: "Bu hesap için firma ataması gerekli." }));
    state.payload = {
      kpis: {},
      workQueue: [],
      bankGroups: [],
      controls: [],
      payables: [],
      recentBankLines: [],
      paymentInstruments: [],
      partners: [],
      employees: [],
      vatSummary: [],
      reports: {},
      auditLogs: [],
      companies: state.companies,
      permissions: state.permissions,
      selectedCompany: null,
    };
    renderAll();
    setStatus(payload.error || "Bu hesap için firma ataması gerekli.", false);
    return;
  }
  state.payload = await readJsonResponse(response, "Dashboard alınamadı");
  state.companies = state.payload.companies || state.companies;
  state.permissions = state.payload.permissions || state.permissions;
  state.companyId = state.payload.selectedCompany?.id || state.companyId;
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
  state.user = user;
  state.companies = payload.companies || [];
  state.permissions = payload.permissions || {};
  state.companyId = payload.selectedCompany?.id || state.companies[0]?.id || null;
  renderCompanySelector();
  document.querySelector("#userChip").textContent = `${user.full_name} · ${user.role}`;
}

function activateTab(tab) {
  if (tab === "audit" && !state.permissions?.canViewLogs) tab = "home";
  if (tab === "admin" && !state.permissions?.canManageUsers) tab = "home";
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
  document.querySelector("#advanceLeaveDate").addEventListener("input", updateAdvancePreview);
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
  wireCompanySelector();
  wireAdminDashboard();
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
