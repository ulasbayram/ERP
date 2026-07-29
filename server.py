from __future__ import annotations

import cgi
import hashlib
import hmac
import json
import os
import shutil
import sqlite3
import sys
import secrets
import time
from datetime import date, datetime, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from http import cookies
from urllib.parse import urlparse

import openpyxl


ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
DATA = ROOT / "data"
UPLOADS = DATA / "uploads"
DB_PATH = DATA / "erp.sqlite3"
SCHEMA = ROOT / "schema.sql"
SESSION_COOKIE = "akim_erp_session"
PASSWORD_ITERATIONS = 600_000
SESSION_DAYS = int(os.environ.get("ERP_SESSION_DAYS", "7"))
COOKIE_SECURE_MODE = os.environ.get("ERP_COOKIE_SECURE", "auto").strip().lower()
INVITE_CODE = os.environ.get("ERP_INVITE_CODE", "")
ALLOW_OPEN_REGISTRATION = os.environ.get("ERP_ALLOW_OPEN_REGISTRATION", "false").lower() == "true"
HOST = os.environ.get("ERP_HOST", "127.0.0.1")
MAX_UPLOAD_BYTES = int(os.environ.get("ERP_MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
RATE_LIMITS: dict[str, list[float]] = {}


def normalize_text(value) -> str:
    if value is None:
        return ""
    return " ".join(str(value).strip().split())


def normalize_key(value) -> str:
    return normalize_text(value).casefold()


def normalize_status(value) -> str:
    raw = normalize_text(value)
    if not raw:
        return ""
    text = raw.casefold()
    if "ödendi" in text or "odendi" in text:
        return "paid"
    if "kısmi" in text or "kismi" in text:
        return "partial"
    if "bek" in text:
        return "pending"
    if "gec" in text:
        return "overdue"
    return raw.lower()


def turkish_title(value: str) -> str:
    lower_map = str.maketrans("IİĞÜŞÖÇ", "ıiğüşöç")
    upper_map = str.maketrans("ıiğüşöç", "IİĞÜŞÖÇ")
    text = normalize_text(value).translate(lower_map).lower()
    return " ".join(word[:1].translate(upper_map).upper() + word[1:] for word in text.split())


def clean_job_title(value: str) -> str:
    text = normalize_text(value)
    if not text:
        return ""
    if "-" in text:
        text = text.split("-", 1)[1]
    text = text.strip(" -.")
    return turkish_title(text)


def to_iso(value) -> str | None:
    if isinstance(value, datetime):
        return value.isoformat(timespec="seconds")
    if isinstance(value, date):
        return value.isoformat()
    text = normalize_text(value)
    return text or None


def to_float(value) -> float:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    if value is None:
        return 0.0
    text = normalize_text(value).replace("₺", "").replace(" ", "")
    if not text:
        return 0.0
    if "," in text and "." in text:
        text = text.replace(".", "").replace(",", ".")
    else:
        text = text.replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return 0.0


def read_json_body(handler) -> dict:
    length = int(handler.headers.get("content-length", "0") or 0)
    if length <= 0:
        return {}
    raw = handler.rfile.read(length).decode("utf-8")
    return json.loads(raw or "{}")


def hash_password(password: str, salt: bytes | None = None, iterations: int = PASSWORD_ITERATIONS) -> tuple[str, str, int]:
    salt = salt or secrets.token_bytes(32)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return digest.hex(), salt.hex(), iterations


def verify_password(password: str, stored_hash: str, stored_salt: str, iterations: int) -> bool:
    digest, _, _ = hash_password(password, bytes.fromhex(stored_salt), iterations)
    return hmac.compare_digest(digest, stored_hash)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def rate_limited(key: str, limit: int, window_seconds: int) -> bool:
    now = time.time()
    bucket = RATE_LIMITS.setdefault(key, [])
    RATE_LIMITS[key] = [stamp for stamp in bucket if now - stamp < window_seconds]
    if len(RATE_LIMITS[key]) >= limit:
        return True
    RATE_LIMITS[key].append(now)
    return False


def user_count(conn: sqlite3.Connection) -> int:
    return int(conn.execute("SELECT COUNT(*) AS count FROM users").fetchone()["count"])


def registration_allowed(conn: sqlite3.Connection) -> bool:
    if user_count(conn) == 0:
        return True
    return ALLOW_OPEN_REGISTRATION or bool(INVITE_CODE)


def create_session(conn: sqlite3.Connection, user_id: int, user_agent: str, ip_address: str) -> str:
    token = secrets.token_urlsafe(48)
    expires = datetime.utcnow() + timedelta(days=SESSION_DAYS)
    conn.execute(
        """
        INSERT INTO auth_sessions(user_id, token_hash, expires_at, user_agent, ip_address)
        VALUES (?, ?, ?, ?, ?)
        """,
        (user_id, hash_token(token), expires.isoformat(timespec="seconds"), user_agent[:400], ip_address),
    )
    return token


def current_user_from_cookie(cookie_header: str | None) -> dict | None:
    if not cookie_header:
        return None
    jar = cookies.SimpleCookie()
    try:
        jar.load(cookie_header)
    except cookies.CookieError:
        return None
    morsel = jar.get(SESSION_COOKIE)
    if not morsel:
        return None
    token_digest = hash_token(morsel.value)
    now = datetime.utcnow().isoformat(timespec="seconds")
    with connect() as conn:
        conn.execute("DELETE FROM auth_sessions WHERE expires_at < ?", (now,))
        row = conn.execute(
            """
            SELECT u.id, u.email, u.full_name, u.role
            FROM auth_sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = ? AND s.expires_at >= ? AND u.is_active = 1
            """,
            (token_digest, now),
        ).fetchone()
        return dict(row) if row else None


def mask_identifier(value: str, visible: int = 4) -> str:
    text = normalize_text(value)
    if not text:
        return ""
    if len(text) <= visible:
        return "*" * len(text)
    return "*" * (len(text) - visible) + text[-visible:]


def connect() -> sqlite3.Connection:
    DATA.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def backup_database(reason: str) -> str | None:
    if not DB_PATH.exists():
        return None
    backup_dir = DATA / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = backup_dir / f"{stamp}_{reason}.sqlite3"
    shutil.copy2(DB_PATH, backup_path)
    return str(backup_path)


def same_origin_allowed(headers) -> bool:
    origin = headers.get("Origin")
    if not origin:
        return True
    host = headers.get("Host", "")
    return origin in {f"http://{host}", f"https://{host}"}


def should_send_secure_cookie(headers) -> bool:
    if COOKIE_SECURE_MODE in {"1", "true", "yes", "on"}:
        return True
    if COOKIE_SECURE_MODE in {"0", "false", "no", "off"}:
        return False

    forwarded_proto = headers.get("X-Forwarded-Proto", "").split(",", 1)[0].strip().lower()
    forwarded = headers.get("Forwarded", "").lower()
    cf_visitor = headers.get("Cf-Visitor", "").lower()
    return (
        forwarded_proto == "https"
        or "proto=https" in forwarded
        or '"scheme":"https"' in cf_visitor
        or "'scheme':'https'" in cf_visitor
    )


def init_db() -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    UPLOADS.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        conn.executescript(SCHEMA.read_text(encoding="utf-8"))
        conn.execute(
            "INSERT OR IGNORE INTO companies(name) VALUES (?)",
            ("AKIM Yapı ERP Taslak",),
        )


def header_map(ws) -> dict[str, int]:
    return {
        normalize_text(ws.cell(1, col).value): col
        for col in range(1, ws.max_column + 1)
        if normalize_text(ws.cell(1, col).value)
    }


def value(ws, row: int, headers: dict[str, int], name: str):
    col = headers.get(name)
    if not col:
        return None
    return ws.cell(row, col).value


def get_or_create_partner(conn: sqlite3.Connection, name: str, partner_type: str = "vendor") -> int | None:
    clean = normalize_text(name)
    if not clean:
        return None
    normalized = normalize_key(clean)
    row = conn.execute(
        "SELECT id FROM business_partners WHERE normalized_name = ?",
        (normalized,),
    ).fetchone()
    if row:
        return int(row["id"])
    cur = conn.execute(
        """
        INSERT INTO business_partners(name, partner_type, normalized_name)
        VALUES (?, ?, ?)
        """,
        (clean, partner_type, normalized),
    )
    return int(cur.lastrowid)


def get_or_create_site(conn: sqlite3.Connection, name: str) -> int | None:
    clean = normalize_text(name)
    if not clean:
        return None
    row = conn.execute("SELECT id FROM project_sites WHERE name = ?", (clean,)).fetchone()
    if row:
        return int(row["id"])
    cur = conn.execute("INSERT INTO project_sites(name) VALUES (?)", (clean,))
    return int(cur.lastrowid)


def reset_operational_tables(conn: sqlite3.Connection) -> None:
    for table in [
        "bank_statement_lines",
        "purchase_invoices",
        "payment_instruments",
        "employees",
        "reference_values",
        "business_partners",
        "project_sites",
    ]:
        conn.execute(f"DELETE FROM {table}")


def preserved_employee_overrides(conn: sqlite3.Connection) -> dict:
    rows = conn.execute(
        """
        SELECT e.national_id_masked, e.full_name, e.monthly_salary, e.advance_amount,
               COALESCE(s.name, '') AS project_site
        FROM employees e
        LEFT JOIN project_sites s ON s.id = e.project_site_id
        WHERE COALESCE(e.monthly_salary, 0) <> 0
           OR COALESCE(e.advance_amount, 0) <> 0
           OR COALESCE(s.name, '') <> ''
        """
    ).fetchall()
    preserved = {}
    for row in rows:
        item = dict(row)
        for key in [item.get("national_id_masked"), item.get("full_name")]:
            if key:
                preserved[key] = item
    return preserved


def restore_employee_overrides(conn: sqlite3.Connection, overrides: dict) -> int:
    restored = 0
    if not overrides:
        return restored
    rows = conn.execute("SELECT id, national_id_masked, full_name FROM employees").fetchall()
    for row in rows:
        item = overrides.get(row["national_id_masked"]) or overrides.get(row["full_name"])
        if not item:
            continue
        site_id = get_or_create_site(conn, item.get("project_site", "")) if item.get("project_site") else None
        conn.execute(
            """
            UPDATE employees
            SET monthly_salary = ?, advance_amount = ?, project_site_id = ?
            WHERE id = ?
            """,
            (
                to_float(item.get("monthly_salary")),
                to_float(item.get("advance_amount")),
                site_id,
                row["id"],
            ),
        )
        restored += 1
    return restored


def import_workbook(path: Path, original_name: str) -> dict:
    wb = openpyxl.load_workbook(path, data_only=True)
    summary = {
        "fileName": original_name,
        "sheetCount": len(wb.sheetnames),
        "sheets": {},
        "records": {
            "bankLines": 0,
            "purchaseInvoices": 0,
            "employees": 0,
            "paymentInstruments": 0,
            "partners": 0,
        },
        "warnings": [],
    }
    backup_path = backup_database("pre_import")
    if backup_path:
        summary["backupCreated"] = True
        summary["backupFile"] = Path(backup_path).name

    with connect() as conn:
        employee_overrides = preserved_employee_overrides(conn)
        reset_operational_tables(conn)

        if "Tanimlar" in wb.sheetnames:
            ws = wb["Tanimlar"]
            headers = header_map(ws)
            pairs = [
                ("Ana Grup", "bank_group"),
                ("Alt Kategori", "bank_sub_category"),
                ("Durum", "status"),
                ("Ödeme Yöntemi", "payment_method"),
                ("Çek Türü", "instrument_type"),
                ("Fatura Belge Türü", "invoice_document_type"),
                ("Ödeme Durumu", "payment_status"),
                ("KDV Oranı", "vat_rate"),
                ("Tevkifat", "withholding"),
            ]
            for row in range(2, ws.max_row + 1):
                for excel_col, group in pairs:
                    item = normalize_text(value(ws, row, headers, excel_col))
                    if item:
                        conn.execute(
                            """
                            INSERT OR IGNORE INTO reference_values(reference_group, value)
                            VALUES (?, ?)
                            """,
                            (group, item),
                        )

        if "Personel" in wb.sheetnames:
            ws = wb["Personel"]
            headers = header_map(ws)
            rows = 0
            for row in range(2, ws.max_row + 1):
                first = normalize_text(value(ws, row, headers, "Adı"))
                last = normalize_text(value(ws, row, headers, "Soyadı"))
                if not first and not last:
                    continue
                site_id = get_or_create_site(conn, normalize_text(value(ws, row, headers, "Şantiye")))
                full_name = normalize_text(value(ws, row, headers, "Ad Soyad")) or f"{first} {last}".strip()
                conn.execute(
                    """
                    INSERT INTO employees(
                      national_id_masked, first_name, last_name, full_name, hire_date, leave_date,
                      job_code, worked_days, status, project_site_id, monthly_salary,
                      advance_amount, iban_masked, phone_masked
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        mask_identifier(value(ws, row, headers, "T.C. Kimlik No")),
                        first,
                        last,
                        full_name,
                        to_iso(value(ws, row, headers, "İşe Giriş Tarihi")),
                        to_iso(value(ws, row, headers, "İşe Çıkış Tarihi")),
                        normalize_text(value(ws, row, headers, "SGK Meslek Kodu")),
                        int(to_float(value(ws, row, headers, "Çalışılan Gün"))),
                        normalize_status(value(ws, row, headers, "Durum")) or "active",
                        site_id,
                        to_float(value(ws, row, headers, "Aylık Maaş (₺)")),
                        to_float(value(ws, row, headers, "Avans (₺)")),
                        mask_identifier(value(ws, row, headers, "IBAN")),
                        mask_identifier(value(ws, row, headers, "Telefon")),
                    ),
                )
                rows += 1
            summary["records"]["employees"] = rows
            summary["sheets"]["Personel"] = {"importedRows": rows, "target": "employees"}
            restored = restore_employee_overrides(conn, employee_overrides)
            if restored:
                summary["sheets"]["Personel"]["restoredManualOverrides"] = restored

        if "Banka_Ekstresi" in wb.sheetnames:
            ws = wb["Banka_Ekstresi"]
            headers = header_map(ws)
            rows = 0
            for row in range(2, ws.max_row + 1):
                if not value(ws, row, headers, "Tarih"):
                    continue
                conn.execute(
                    """
                    INSERT INTO bank_statement_lines(
                      transaction_date, transaction_type, description, transaction_group,
                      sub_category, debit_amount, credit_amount, balance_amount, direction, net_amount
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        to_iso(value(ws, row, headers, "Tarih")),
                        normalize_text(value(ws, row, headers, "İşlem")),
                        normalize_text(value(ws, row, headers, "Açıklama")),
                        normalize_text(value(ws, row, headers, "Grup")),
                        normalize_text(value(ws, row, headers, "Alt Kategori")),
                        to_float(value(ws, row, headers, "Borç (₺)")),
                        to_float(value(ws, row, headers, "Alacak (₺)")),
                        to_float(value(ws, row, headers, "Bakiye (₺)")),
                        normalize_text(value(ws, row, headers, "B/A")),
                        to_float(value(ws, row, headers, "Net Tutar (₺)")),
                    ),
                )
                rows += 1
            summary["records"]["bankLines"] = rows
            summary["sheets"]["Banka_Ekstresi"] = {"importedRows": rows, "target": "bank_statement_lines"}

        if "Gunluk_Fatura_Hareketleri" in wb.sheetnames:
            ws = wb["Gunluk_Fatura_Hareketleri"]
            headers = header_map(ws)
            invoice_numbers = {}
            rows = 0
            for row in range(2, ws.max_row + 1):
                if not value(ws, row, headers, "Tarih"):
                    continue
                partner_id = get_or_create_partner(conn, normalize_text(value(ws, row, headers, "Cari")))
                site_id = get_or_create_site(conn, normalize_text(value(ws, row, headers, "Şantiye")))
                invoice_no = normalize_text(value(ws, row, headers, "Fatura No"))
                if invoice_no:
                    invoice_numbers[invoice_no] = invoice_numbers.get(invoice_no, 0) + 1
                conn.execute(
                    """
                    INSERT INTO purchase_invoices(
                      invoice_date, document_type, invoice_no, partner_id, description,
                      purchase_amount, sales_amount, vat_rate, withholding_code, project_site_id,
                      cost_category, payment_status, due_date, vat_amount, withholding_amount,
                      gross_total, paid_amount, remaining_amount, delay_status
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        to_iso(value(ws, row, headers, "Tarih")),
                        normalize_text(value(ws, row, headers, "Belge Türü")) or "Alış",
                        invoice_no,
                        partner_id,
                        normalize_text(value(ws, row, headers, "Açıklama")),
                        to_float(value(ws, row, headers, "Alış")),
                        to_float(value(ws, row, headers, "Satış")),
                        to_float(value(ws, row, headers, "KDV")),
                        normalize_text(value(ws, row, headers, "Tevkifat")),
                        site_id,
                        normalize_text(value(ws, row, headers, "Kategori")),
                        normalize_status(value(ws, row, headers, "Ödeme Durumu")),
                        to_iso(value(ws, row, headers, "Vade")),
                        to_float(value(ws, row, headers, "KDV Tutarı")),
                        to_float(value(ws, row, headers, "Tevkifat Tutarı")),
                        to_float(value(ws, row, headers, "Genel Toplam")),
                        to_float(value(ws, row, headers, "Ödenen Tutar")),
                        to_float(value(ws, row, headers, "Kalan Tutar")),
                        normalize_status(value(ws, row, headers, "Gecikme Durumu")),
                    ),
                )
                rows += 1
            duplicates = [key for key, count in invoice_numbers.items() if count > 1]
            if duplicates:
                summary["warnings"].append(f"{len(duplicates)} fatura numarası tekrarlı görünüyor.")
            summary["records"]["purchaseInvoices"] = rows
            summary["sheets"]["Gunluk_Fatura_Hareketleri"] = {
                "importedRows": rows,
                "target": "purchase_invoices",
                "duplicateInvoiceNoCount": len(duplicates),
            }

        if "Cek_Senet_Takibi" in wb.sheetnames:
            ws = wb["Cek_Senet_Takibi"]
            headers = header_map(ws)
            rows = 0
            for row in range(2, ws.max_row + 1):
                amount = to_float(value(ws, row, headers, "Tutar (₺)"))
                due = value(ws, row, headers, "Vade Tarihi")
                if not amount and not due:
                    continue
                partner_id = get_or_create_partner(conn, normalize_text(value(ws, row, headers, "Cari / Firma")))
                conn.execute(
                    """
                    INSERT INTO payment_instruments(
                      instrument_type, partner_id, instrument_no, bank_name, issue_date,
                      due_date, amount, status, settlement_date, note
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        normalize_text(value(ws, row, headers, "Tür")),
                        partner_id,
                        normalize_text(value(ws, row, headers, "Çek / Senet No")),
                        normalize_text(value(ws, row, headers, "Banka")),
                        to_iso(value(ws, row, headers, "Keşide Tarihi")),
                        to_iso(due),
                        amount,
                        normalize_status(value(ws, row, headers, "Durum")),
                        to_iso(value(ws, row, headers, "Tahsil / Ödeme Tarihi")),
                        normalize_text(value(ws, row, headers, "Not")),
                    ),
                )
                rows += 1
            summary["records"]["paymentInstruments"] = rows
            summary["sheets"]["Cek_Senet_Takibi"] = {"importedRows": rows, "target": "payment_instruments"}

        partner_count = conn.execute("SELECT COUNT(*) AS count FROM business_partners").fetchone()["count"]
        site_count = conn.execute("SELECT COUNT(*) AS count FROM project_sites").fetchone()["count"]
        summary["records"]["partners"] = partner_count
        summary["records"]["projectSites"] = site_count

        conn.execute(
            """
            INSERT INTO import_batches(file_name, sheet_count, summary_json)
            VALUES (?, ?, ?)
            """,
            (original_name, len(wb.sheetnames), json.dumps(summary, ensure_ascii=False)),
        )
        conn.execute(
            """
            INSERT INTO audit_events(action, entity_name, new_value)
            VALUES (?, ?, ?)
            """,
            ("import_workbook", "import_batches", json.dumps(summary, ensure_ascii=False)),
        )

    return summary


def dashboard_payload() -> dict:
    init_db()
    with connect() as conn:
        def scalar(sql: str, params=()):
            row = conn.execute(sql, params).fetchone()
            return list(row)[0] if row else 0

        invoice_total = scalar("SELECT COALESCE(SUM(gross_total), 0) FROM purchase_invoices")
        invoice_remaining = scalar("SELECT COALESCE(SUM(remaining_amount), 0) FROM purchase_invoices")
        bank_net = scalar("SELECT COALESCE(SUM(net_amount), 0) FROM bank_statement_lines")
        instrument_total = scalar("SELECT COALESCE(SUM(amount), 0) FROM payment_instruments")
        duplicate_invoices = scalar(
            """
            SELECT COUNT(*) FROM (
              SELECT invoice_no
              FROM purchase_invoices
              WHERE invoice_no IS NOT NULL AND invoice_no <> ''
              GROUP BY invoice_no
              HAVING COUNT(*) > 1
            )
            """
        )
        missing_due_dates = scalar(
            "SELECT COUNT(*) FROM purchase_invoices WHERE remaining_amount > 0 AND (due_date IS NULL OR due_date = '')"
        )
        missing_cost_category = scalar(
            "SELECT COUNT(*) FROM purchase_invoices WHERE cost_category IS NULL OR cost_category = ''"
        )
        pending_invoices = scalar("SELECT COUNT(*) FROM purchase_invoices WHERE remaining_amount > 0")

        latest_import = conn.execute(
            "SELECT file_name, imported_at, summary_json FROM import_batches ORDER BY id DESC LIMIT 1"
        ).fetchone()

        invoice_rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT p.invoice_date, p.invoice_no, b.name AS partner, p.gross_total,
                       p.remaining_amount, p.payment_status, p.delay_status
                FROM purchase_invoices p
                LEFT JOIN business_partners b ON b.id = p.partner_id
                ORDER BY p.invoice_date DESC
                LIMIT 8
                """
            )
        ]

        bank_rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT transaction_date, transaction_type, transaction_group, sub_category, net_amount
                FROM bank_statement_lines
                ORDER BY transaction_date DESC
                LIMIT 8
                """
            )
        ]

        payable_rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT p.id, p.invoice_date, p.due_date, p.invoice_no, b.name AS partner,
                       p.gross_total, p.paid_amount, p.remaining_amount, p.payment_status,
                       COALESCE(s.name, 'Atanmadı') AS project_site
                FROM purchase_invoices p
                LEFT JOIN business_partners b ON b.id = p.partner_id
                LEFT JOIN project_sites s ON s.id = p.project_site_id
                ORDER BY p.remaining_amount DESC, p.invoice_date DESC
                LIMIT 40
                """
            )
        ]

        partner_rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT b.id, b.name, b.partner_type,
                       COUNT(p.id) AS invoice_count,
                       COALESCE(SUM(p.gross_total), 0) AS gross_total,
                       COALESCE(SUM(p.remaining_amount), 0) AS open_balance
                FROM business_partners b
                LEFT JOIN purchase_invoices p ON p.partner_id = b.id
                GROUP BY b.id
                ORDER BY open_balance DESC, gross_total DESC
                LIMIT 40
                """
            )
        ]

        employee_rows = []
        for row in conn.execute(
            """
            SELECT e.id, e.full_name, e.job_code, e.hire_date, e.worked_days, e.status,
                   e.monthly_salary, e.advance_amount, COALESCE(s.name, '') AS project_site,
                   CASE
                     WHEN e.monthly_salary - e.advance_amount < 0 THEN 0
                     ELSE e.monthly_salary - e.advance_amount
                   END AS paid_salary
            FROM employees e
            LEFT JOIN project_sites s ON s.id = e.project_site_id
            ORDER BY e.full_name
            LIMIT 80
            """
        ):
            item = dict(row)
            item["seniority_days"] = 0
            item["seniority_label"] = ""
            item["job_title"] = clean_job_title(item.get("job_code", ""))
            try:
                hired = datetime.fromisoformat(str(item["hire_date"])[:19]).date()
                days = max((date.today() - hired).days + 1, 0)
                item["seniority_days"] = days
                if days < 30:
                    item["seniority_label"] = f"{days} gün"
                else:
                    item["seniority_label"] = f"{days // 30} ay {days % 30} gün"
            except Exception:
                pass
            employee_rows.append(item)

        instrument_rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT i.id, i.instrument_type, b.name AS partner, i.instrument_no, i.bank_name,
                       i.due_date, i.amount, i.status
                FROM payment_instruments i
                LEFT JOIN business_partners b ON b.id = i.partner_id
                ORDER BY i.due_date, i.amount DESC
                LIMIT 40
                """
            )
        ]

        vat_rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT substr(invoice_date, 1, 7) AS period,
                       COALESCE(SUM(purchase_amount), 0) AS purchase_base,
                       COALESCE(SUM(vat_amount), 0) AS purchase_vat,
                       COALESCE(SUM(sales_amount), 0) AS sales_base,
                       COALESCE(SUM(withholding_amount), 0) AS withholding,
                       COALESCE(SUM(vat_amount - withholding_amount), 0) AS net_vat
                FROM purchase_invoices
                WHERE invoice_date IS NOT NULL AND invoice_date <> ''
                GROUP BY substr(invoice_date, 1, 7)
                ORDER BY period DESC
                """
            )
        ]

        bank_group_rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT COALESCE(transaction_group, 'Sınıfsız') AS name,
                       COUNT(*) AS line_count,
                       COALESCE(SUM(debit_amount), 0) AS debit_total,
                       COALESCE(SUM(credit_amount), 0) AS credit_total,
                       COALESCE(SUM(net_amount), 0) AS net_total
                FROM bank_statement_lines
                GROUP BY COALESCE(transaction_group, 'Sınıfsız')
                ORDER BY ABS(net_total) DESC, line_count DESC
                """
            )
        ]

        project_site_rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT id, name, status
                FROM project_sites
                ORDER BY name
                """
            )
        ]

        open_invoice_sum = scalar("SELECT COALESCE(SUM(remaining_amount), 0) FROM purchase_invoices WHERE remaining_amount > 0")
        due_instrument_sum = scalar("SELECT COALESCE(SUM(amount), 0) FROM payment_instruments")

        return {
            "kpis": {
                "invoiceCount": scalar("SELECT COUNT(*) FROM purchase_invoices"),
                "invoiceTotal": invoice_total,
                "invoiceRemaining": invoice_remaining,
                "bankLineCount": scalar("SELECT COUNT(*) FROM bank_statement_lines"),
                "bankNet": bank_net,
                "employeeCount": scalar("SELECT COUNT(*) FROM employees"),
                "paymentInstrumentCount": scalar("SELECT COUNT(*) FROM payment_instruments"),
                "paymentInstrumentTotal": instrument_total,
                "partnerCount": scalar("SELECT COUNT(*) FROM business_partners"),
                "pendingInvoices": pending_invoices,
                "duplicateInvoices": duplicate_invoices,
                "missingDueDates": missing_due_dates,
                "missingCostCategory": missing_cost_category,
            },
            "workQueue": [
                {
                    "label": "Ödeme bekleyen faturalar",
                    "count": pending_invoices,
                    "amount": open_invoice_sum,
                    "severity": "high" if open_invoice_sum else "normal",
                    "target": "ap",
                },
                {
                    "label": "Mutabakat bekleyen banka satırları",
                    "count": scalar("SELECT COUNT(*) FROM bank_statement_lines"),
                    "amount": bank_net,
                    "severity": "normal",
                    "target": "bank",
                },
                {
                    "label": "Vadesi net olmayan açık faturalar",
                    "count": missing_due_dates,
                    "amount": 0,
                    "severity": "high" if missing_due_dates else "normal",
                    "target": "controls",
                },
                {
                    "label": "Çek / senet portföyü",
                    "count": scalar("SELECT COUNT(*) FROM payment_instruments"),
                    "amount": due_instrument_sum,
                    "severity": "medium",
                    "target": "payments",
                },
            ],
            "controls": [
                {
                    "name": "Tekrarlı fatura numarası",
                    "count": duplicate_invoices,
                    "owner": "Muhasebe",
                    "action": "Fatura kayıtlarını belge no ve cari bazında doğrula.",
                },
                {
                    "name": "Eksik vade",
                    "count": missing_due_dates,
                    "owner": "Finans",
                    "action": "Açık faturalar için vade zorunlu hale getir.",
                },
                {
                    "name": "Eksik maliyet kategorisi",
                    "count": missing_cost_category,
                    "owner": "Maliyet kontrol",
                    "action": "Gider kategorisini fatura girişinde zorunlu yap.",
                },
                {
                    "name": "Maaş bilgisi eksik personel",
                    "count": scalar("SELECT COUNT(*) FROM employees WHERE monthly_salary IS NULL OR monthly_salary = 0"),
                    "owner": "Muhasebe",
                    "action": "Personel maaş kartlarını tamamla; avans düşümü ödenecek maaşa otomatik yansır.",
                },
            ],
            "latestImport": dict(latest_import) if latest_import else None,
            "recentInvoices": invoice_rows,
            "recentBankLines": bank_rows,
            "payables": payable_rows,
            "partners": partner_rows,
            "employees": employee_rows,
            "paymentInstruments": instrument_rows,
            "vatSummary": vat_rows,
            "bankGroups": bank_group_rows,
            "projectSites": project_site_rows,
        }


class ERPHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC), **kwargs)

    def end_headers(self) -> None:
        static_path = urlparse(self.path).path
        if static_path.endswith((".html", ".js", ".css")) or static_path in {"/", "/login"}:
            self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
            "connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
        )
        super().end_headers()

    def current_user(self) -> dict | None:
        return current_user_from_cookie(self.headers.get("Cookie"))

    def send_redirect(self, location: str) -> None:
        self.send_response(302)
        self.send_header("Location", location)
        self.end_headers()

    def send_auth_cookie(self, token: str) -> None:
        parts = [
            f"{SESSION_COOKIE}={token}",
            "Path=/",
            "HttpOnly",
            "SameSite=Lax",
            f"Max-Age={SESSION_DAYS * 24 * 60 * 60}",
        ]
        if should_send_secure_cookie(self.headers):
            parts.append("Secure")
        self.send_header("Set-Cookie", "; ".join(parts))

    def clear_auth_cookie(self) -> None:
        parts = [f"{SESSION_COOKIE}=", "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"]
        if should_send_secure_cookie(self.headers):
            parts.append("Secure")
        self.send_header("Set-Cookie", "; ".join(parts))

    def send_json(self, payload: dict, status: int = 200) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path in ("/login", "/login.html"):
            if self.current_user():
                self.send_redirect("/")
                return
            self.path = "/login.html"
            return super().do_GET()
        if parsed.path == "/api/auth/config":
            with connect() as conn:
                self.send_json(
                    {
                        "registrationAllowed": registration_allowed(conn),
                        "firstUser": user_count(conn) == 0,
                        "inviteRequired": user_count(conn) > 0 and bool(INVITE_CODE) and not ALLOW_OPEN_REGISTRATION,
                    }
                )
            return
        if parsed.path == "/api/me":
            user = self.current_user()
            if not user:
                self.send_json({"authenticated": False}, 401)
                return
            self.send_json({"authenticated": True, "user": user})
            return
        if parsed.path == "/api/dashboard":
            if not self.current_user():
                self.send_json({"error": "Oturum gerekli."}, 401)
                return
            self.send_json(dashboard_payload())
            return
        if parsed.path == "/api/health":
            self.send_json({"status": "ok"})
            return
        if parsed.path in ("/", "/index.html"):
            if not self.current_user():
                self.send_redirect("/login")
                return
            self.path = "/index.html"
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if not same_origin_allowed(self.headers):
            self.send_json({"error": "İstek kaynağı reddedildi."}, 403)
            return

        if parsed.path == "/api/register":
            try:
                payload = read_json_body(self)
                email = normalize_text(payload.get("email")).casefold()
                if rate_limited(f"register:{self.client_address[0]}:{email}", 5, 15 * 60):
                    self.send_json({"error": "Çok fazla kayıt denemesi. Bir süre sonra tekrar dene."}, 429)
                    return
                full_name = normalize_text(payload.get("fullName"))
                password = str(payload.get("password") or "")
                invite_code = str(payload.get("inviteCode") or "")
                if "@" not in email or "." not in email:
                    self.send_json({"error": "Geçerli e-posta gir."}, 400)
                    return
                if not full_name:
                    self.send_json({"error": "Ad soyad zorunlu."}, 400)
                    return
                if len(password) < 10:
                    self.send_json({"error": "Parola en az 10 karakter olmalı."}, 400)
                    return
                with connect() as conn:
                    count = user_count(conn)
                    if count > 0 and not ALLOW_OPEN_REGISTRATION:
                        if not INVITE_CODE or not hmac.compare_digest(invite_code, INVITE_CODE):
                            self.send_json({"error": "Kayıt için geçerli davet kodu gerekli."}, 403)
                            return
                    password_hash, salt, iterations = hash_password(password)
                    role = "admin" if count == 0 else "accountant"
                    cur = conn.execute(
                        """
                        INSERT INTO users(email, full_name, role, password_hash, password_salt, password_iterations)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (email, full_name, role, password_hash, salt, iterations),
                    )
                    token = create_session(
                        conn,
                        int(cur.lastrowid),
                        self.headers.get("User-Agent", ""),
                        self.client_address[0],
                    )
                    conn.execute(
                        "INSERT INTO audit_events(actor, action, entity_name, entity_id, new_value) VALUES (?, ?, ?, ?, ?)",
                        (email, "register_user", "users", str(cur.lastrowid), json.dumps({"role": role}, ensure_ascii=False)),
                    )
                body = json.dumps({"ok": True}, ensure_ascii=False).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_auth_cookie(token)
                self.end_headers()
                self.wfile.write(body)
            except sqlite3.IntegrityError:
                self.send_json({"error": "Bu e-posta zaten kayıtlı."}, 409)
            except json.JSONDecodeError:
                self.send_json({"error": "Geçersiz JSON."}, 400)
            except Exception as exc:
                self.send_json({"error": f"Kayıt oluşturulamadı: {exc}"}, 500)
            return

        if parsed.path == "/api/login":
            try:
                payload = read_json_body(self)
                email = normalize_text(payload.get("email")).casefold()
                password = str(payload.get("password") or "")
                if rate_limited(f"login:{self.client_address[0]}:{email}", 10, 15 * 60):
                    self.send_json({"error": "Çok fazla giriş denemesi. Bir süre sonra tekrar dene."}, 429)
                    return
                with connect() as conn:
                    row = conn.execute(
                        """
                        SELECT id, email, full_name, role, password_hash, password_salt, password_iterations
                        FROM users
                        WHERE email = ? AND is_active = 1
                        """,
                        (email,),
                    ).fetchone()
                    if not row or not verify_password(password, row["password_hash"], row["password_salt"], int(row["password_iterations"])):
                        self.send_json({"error": "E-posta veya parola hatalı."}, 401)
                        return
                    token = create_session(
                        conn,
                        int(row["id"]),
                        self.headers.get("User-Agent", ""),
                        self.client_address[0],
                    )
                    conn.execute("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?", (row["id"],))
                body = json.dumps({"ok": True}, ensure_ascii=False).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_auth_cookie(token)
                self.end_headers()
                self.wfile.write(body)
            except json.JSONDecodeError:
                self.send_json({"error": "Geçersiz JSON."}, 400)
            except Exception as exc:
                self.send_json({"error": f"Giriş yapılamadı: {exc}"}, 500)
            return

        if parsed.path == "/api/logout":
            jar = cookies.SimpleCookie()
            try:
                jar.load(self.headers.get("Cookie", ""))
            except cookies.CookieError:
                pass
            morsel = jar.get(SESSION_COOKIE)
            if morsel:
                with connect() as conn:
                    conn.execute("DELETE FROM auth_sessions WHERE token_hash = ?", (hash_token(morsel.value),))
            body = b'{"ok":true}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.clear_auth_cookie()
            self.end_headers()
            self.wfile.write(body)
            return

        if parsed.path.startswith("/api/") and not self.current_user():
            self.send_json({"error": "Oturum gerekli."}, 401)
            return

        if parsed.path == "/api/partners":
            try:
                payload = read_json_body(self)
                name = normalize_text(payload.get("name"))
                partner_type = normalize_text(payload.get("partnerType")) or "vendor"
                if not name:
                    self.send_json({"error": "Cari adı zorunlu."}, 400)
                    return
                with connect() as conn:
                    partner_id = get_or_create_partner(conn, name, partner_type)
                    conn.execute(
                        "INSERT INTO audit_events(actor, action, entity_name, entity_id, new_value) VALUES (?, ?, ?, ?, ?)",
                        (
                            self.current_user()["email"],
                            "create_partner",
                            "business_partners",
                            str(partner_id),
                            json.dumps({"name": name, "partner_type": partner_type}, ensure_ascii=False),
                        ),
                    )
                self.send_json({"dashboard": dashboard_payload()})
            except json.JSONDecodeError:
                self.send_json({"error": "Geçersiz JSON."}, 400)
            except Exception as exc:
                self.send_json({"error": f"Cari kaydedilemedi: {exc}"}, 500)
            return

        if parsed.path == "/api/employees":
            try:
                payload = read_json_body(self)
                full_name = normalize_text(payload.get("fullName"))
                if not full_name:
                    self.send_json({"error": "Personel adı zorunlu."}, 400)
                    return
                parts = full_name.split()
                first_name = parts[0]
                last_name = " ".join(parts[1:]) if len(parts) > 1 else ""
                monthly_salary = to_float(payload.get("monthlySalary"))
                advance_amount = to_float(payload.get("advanceAmount"))
                worked_days = int(to_float(payload.get("workedDays")))
                if monthly_salary < 0 or advance_amount < 0 or worked_days < 0:
                    self.send_json({"error": "Maaş, avans ve gün negatif olamaz."}, 400)
                    return
                with connect() as conn:
                    site_id = get_or_create_site(conn, payload.get("projectSite"))
                    cur = conn.execute(
                        """
                        INSERT INTO employees(
                          first_name, last_name, full_name, hire_date, job_code,
                          worked_days, project_site_id, monthly_salary, advance_amount, status
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
                        """,
                        (
                            first_name,
                            last_name,
                            full_name,
                            normalize_text(payload.get("hireDate")) or None,
                            normalize_text(payload.get("jobTitle")) or None,
                            worked_days,
                            site_id,
                            monthly_salary,
                            advance_amount,
                        ),
                    )
                    conn.execute(
                        "INSERT INTO audit_events(actor, action, entity_name, entity_id, new_value) VALUES (?, ?, ?, ?, ?)",
                        (
                            self.current_user()["email"],
                            "create_employee",
                            "employees",
                            str(cur.lastrowid),
                            json.dumps({"full_name": full_name}, ensure_ascii=False),
                        ),
                    )
                self.send_json({"dashboard": dashboard_payload()})
            except json.JSONDecodeError:
                self.send_json({"error": "Geçersiz JSON."}, 400)
            except Exception as exc:
                self.send_json({"error": f"Personel kaydedilemedi: {exc}"}, 500)
            return

        if parsed.path == "/api/purchase-invoices":
            try:
                payload = read_json_body(self)
                partner_name = normalize_text(payload.get("partnerName"))
                if not partner_name:
                    self.send_json({"error": "Cari adı zorunlu."}, 400)
                    return
                gross_total = to_float(payload.get("grossTotal"))
                paid_amount = to_float(payload.get("paidAmount"))
                vat_rate = to_float(payload.get("vatRate"))
                if gross_total < 0 or paid_amount < 0 or vat_rate < 0:
                    self.send_json({"error": "Tutarlar negatif olamaz."}, 400)
                    return
                remaining_amount = max(gross_total - paid_amount, 0)
                payment_status = "paid" if remaining_amount == 0 else ("partial" if paid_amount > 0 else "pending")
                due_date = normalize_text(payload.get("dueDate")) or None
                if due_date and remaining_amount > 0:
                    try:
                        if datetime.fromisoformat(due_date[:10]).date() < date.today():
                            payment_status = "overdue"
                    except ValueError:
                        pass
                vat_amount = gross_total * vat_rate / (100 + vat_rate) if vat_rate else 0
                purchase_amount = gross_total - vat_amount
                with connect() as conn:
                    partner_id = get_or_create_partner(conn, partner_name, "vendor")
                    site_id = get_or_create_site(conn, payload.get("projectSite"))
                    cur = conn.execute(
                        """
                        INSERT INTO purchase_invoices(
                          invoice_date, invoice_no, partner_id, description, purchase_amount,
                          vat_rate, project_site_id, cost_category, payment_status, due_date,
                          vat_amount, gross_total, paid_amount, remaining_amount
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            normalize_text(payload.get("invoiceDate")) or None,
                            normalize_text(payload.get("invoiceNo")) or None,
                            partner_id,
                            normalize_text(payload.get("description")) or None,
                            purchase_amount,
                            vat_rate,
                            site_id,
                            normalize_text(payload.get("costCategory")) or None,
                            payment_status,
                            due_date,
                            vat_amount,
                            gross_total,
                            paid_amount,
                            remaining_amount,
                        ),
                    )
                    conn.execute(
                        "INSERT INTO audit_events(actor, action, entity_name, entity_id, new_value) VALUES (?, ?, ?, ?, ?)",
                        (
                            self.current_user()["email"],
                            "create_purchase_invoice",
                            "purchase_invoices",
                            str(cur.lastrowid),
                            json.dumps({"partner": partner_name, "gross_total": gross_total}, ensure_ascii=False),
                        ),
                    )
                self.send_json({"dashboard": dashboard_payload()})
            except json.JSONDecodeError:
                self.send_json({"error": "Geçersiz JSON."}, 400)
            except Exception as exc:
                self.send_json({"error": f"Fatura kaydedilemedi: {exc}"}, 500)
            return

        if parsed.path == "/api/purchase-invoices/mark-paid":
            try:
                payload = read_json_body(self)
                ids = [int(item) for item in payload.get("ids", []) if int(item) > 0]
                if not ids:
                    self.send_json({"error": "Seçili fatura yok."}, 400)
                    return
                placeholders = ",".join("?" for _ in ids)
                with connect() as conn:
                    conn.execute(
                        f"""
                        UPDATE purchase_invoices
                        SET paid_amount = gross_total,
                            remaining_amount = 0,
                            payment_status = 'paid'
                        WHERE id IN ({placeholders})
                        """,
                        ids,
                    )
                    conn.execute(
                        "INSERT INTO audit_events(actor, action, entity_name, new_value) VALUES (?, ?, ?, ?)",
                        (
                            self.current_user()["email"],
                            "bulk_mark_paid",
                            "purchase_invoices",
                            json.dumps({"ids": ids}, ensure_ascii=False),
                        ),
                    )
                self.send_json({"dashboard": dashboard_payload()})
            except json.JSONDecodeError:
                self.send_json({"error": "Geçersiz JSON."}, 400)
            except Exception as exc:
                self.send_json({"error": f"Faturalar güncellenemedi: {exc}"}, 500)
            return

        if parsed.path == "/api/employees/bulk-site":
            try:
                payload = read_json_body(self)
                ids = [int(item) for item in payload.get("ids", []) if int(item) > 0]
                site_name = normalize_text(payload.get("projectSiteName"))
                if not ids:
                    self.send_json({"error": "Seçili personel yok."}, 400)
                    return
                placeholders = ",".join("?" for _ in ids)
                with connect() as conn:
                    site_id = get_or_create_site(conn, site_name) if site_name else None
                    conn.execute(
                        f"UPDATE employees SET project_site_id = ? WHERE id IN ({placeholders})",
                        [site_id, *ids],
                    )
                    conn.execute(
                        "INSERT INTO audit_events(actor, action, entity_name, new_value) VALUES (?, ?, ?, ?)",
                        (
                            self.current_user()["email"],
                            "bulk_update_employee_site",
                            "employees",
                            json.dumps({"ids": ids, "project_site": site_name}, ensure_ascii=False),
                        ),
                    )
                self.send_json({"dashboard": dashboard_payload()})
            except json.JSONDecodeError:
                self.send_json({"error": "Geçersiz JSON."}, 400)
            except Exception as exc:
                self.send_json({"error": f"Şantiye güncellenemedi: {exc}"}, 500)
            return

        if parsed.path == "/api/employees/bulk-advance":
            try:
                payload = read_json_body(self)
                ids = [int(item) for item in payload.get("ids", []) if int(item) > 0]
                advance_amount = to_float(payload.get("advanceAmount"))
                if not ids:
                    self.send_json({"error": "Seçili personel yok."}, 400)
                    return
                if advance_amount < 0:
                    self.send_json({"error": "Avans negatif olamaz."}, 400)
                    return
                placeholders = ",".join("?" for _ in ids)
                with connect() as conn:
                    conn.execute(
                        f"UPDATE employees SET advance_amount = ? WHERE id IN ({placeholders})",
                        [advance_amount, *ids],
                    )
                    conn.execute(
                        "INSERT INTO audit_events(actor, action, entity_name, new_value) VALUES (?, ?, ?, ?)",
                        (
                            self.current_user()["email"],
                            "bulk_update_employee_advance",
                            "employees",
                            json.dumps({"ids": ids, "advance_amount": advance_amount}, ensure_ascii=False),
                        ),
                    )
                self.send_json({"dashboard": dashboard_payload()})
            except json.JSONDecodeError:
                self.send_json({"error": "Geçersiz JSON."}, 400)
            except Exception as exc:
                self.send_json({"error": f"Avans güncellenemedi: {exc}"}, 500)
            return

        if parsed.path == "/api/employees/site":
            try:
                payload = read_json_body(self)
                employee_id = int(payload.get("employeeId", 0))
                site_name = normalize_text(payload.get("projectSiteName"))
                if employee_id <= 0:
                    self.send_json({"error": "Geçerli personel seçilmedi."}, 400)
                    return
                with connect() as conn:
                    before = conn.execute(
                        """
                        SELECT e.project_site_id, COALESCE(s.name, '') AS project_site
                        FROM employees e
                        LEFT JOIN project_sites s ON s.id = e.project_site_id
                        WHERE e.id = ?
                        """,
                        (employee_id,),
                    ).fetchone()
                    if not before:
                        self.send_json({"error": "Personel bulunamadı."}, 404)
                        return
                    site_id = get_or_create_site(conn, site_name) if site_name else None
                    conn.execute(
                        "UPDATE employees SET project_site_id = ? WHERE id = ?",
                        (site_id, employee_id),
                    )
                    conn.execute(
                        """
                        INSERT INTO audit_events(action, entity_name, entity_id, old_value, new_value)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (
                            "update_employee_site",
                            "employees",
                            str(employee_id),
                            json.dumps(dict(before), ensure_ascii=False),
                            json.dumps({"project_site": site_name}, ensure_ascii=False),
                        ),
                    )
                self.send_json({"dashboard": dashboard_payload()})
            except json.JSONDecodeError:
                self.send_json({"error": "Geçersiz JSON."}, 400)
            except Exception as exc:
                self.send_json({"error": f"Şantiye güncellenemedi: {exc}"}, 500)
            return

        if parsed.path == "/api/employees/compensation":
            try:
                payload = read_json_body(self)
                employee_id = int(payload.get("employeeId", 0))
                monthly_salary = to_float(payload.get("monthlySalary"))
                advance_amount = to_float(payload.get("advanceAmount"))
                if employee_id <= 0:
                    self.send_json({"error": "Geçerli personel seçilmedi."}, 400)
                    return
                if monthly_salary < 0 or advance_amount < 0:
                    self.send_json({"error": "Maaş ve avans negatif olamaz."}, 400)
                    return
                with connect() as conn:
                    before = conn.execute(
                        "SELECT monthly_salary, advance_amount FROM employees WHERE id = ?",
                        (employee_id,),
                    ).fetchone()
                    if not before:
                        self.send_json({"error": "Personel bulunamadı."}, 404)
                        return
                    conn.execute(
                        """
                        UPDATE employees
                        SET monthly_salary = ?, advance_amount = ?
                        WHERE id = ?
                        """,
                        (monthly_salary, advance_amount, employee_id),
                    )
                    conn.execute(
                        """
                        INSERT INTO audit_events(action, entity_name, entity_id, old_value, new_value)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (
                            "update_compensation",
                            "employees",
                            str(employee_id),
                            json.dumps(dict(before), ensure_ascii=False),
                            json.dumps(
                                {"monthly_salary": monthly_salary, "advance_amount": advance_amount},
                                ensure_ascii=False,
                            ),
                        ),
                    )
                self.send_json({"dashboard": dashboard_payload()})
            except json.JSONDecodeError:
                self.send_json({"error": "Geçersiz JSON."}, 400)
            except Exception as exc:
                self.send_json({"error": f"Personel güncellenemedi: {exc}"}, 500)
            return

        if parsed.path != "/api/import":
            self.send_json({"error": "Not found"}, 404)
            return

        ctype, pdict = cgi.parse_header(self.headers.get("content-type"))
        if ctype != "multipart/form-data":
            self.send_json({"error": "Excel dosyası multipart/form-data olarak gönderilmeli."}, 400)
            return
        content_length = int(self.headers.get("content-length", "0") or 0)
        if content_length > MAX_UPLOAD_BYTES:
            self.send_json({"error": "Dosya boyutu izin verilen sınırı aşıyor."}, 413)
            return

        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": self.headers.get("content-type"),
            },
        )
        file_item = form["file"] if "file" in form else None
        if file_item is None or not getattr(file_item, "filename", ""):
            self.send_json({"error": "Dosya seçilmedi."}, 400)
            return

        original_name = Path(file_item.filename).name
        if not original_name.lower().endswith(".xlsx"):
            self.send_json({"error": "Şimdilik yalnızca .xlsx dosyası destekleniyor."}, 400)
            return

        UPLOADS.mkdir(parents=True, exist_ok=True)
        saved = UPLOADS / f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{original_name}"
        with saved.open("wb") as handle:
            shutil.copyfileobj(file_item.file, handle)

        try:
            summary = import_workbook(saved, original_name)
        except Exception as exc:
            self.send_json({"error": f"Import sırasında hata oluştu: {exc}"}, 500)
            return

        self.send_json({"summary": summary, "dashboard": dashboard_payload()})


def main() -> int:
    init_db()
    port = int(os.environ.get("ERP_PORT", "8088"))
    server = ThreadingHTTPServer((HOST, port), ERPHandler)
    shown_host = "127.0.0.1" if HOST in ("0.0.0.0", "::") else HOST
    print(f"ERP taslak sunucusu hazır: http://{shown_host}:{port}")
    print("Kapatmak için Ctrl+C")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nSunucu kapatıldı.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
