PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  tax_number TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'accountant',
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  user_agent TEXT,
  ip_address TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS project_sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  code TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS business_partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  partner_type TEXT NOT NULL DEFAULT 'vendor',
  tax_number TEXT,
  iban TEXT,
  phone TEXT,
  normalized_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  national_id_masked TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  hire_date TEXT,
  leave_date TEXT,
  job_code TEXT,
  worked_days INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  project_site_id INTEGER,
  monthly_salary REAL,
  advance_amount REAL,
  iban_masked TEXT,
  phone_masked TEXT,
  FOREIGN KEY (project_site_id) REFERENCES project_sites(id)
);

CREATE TABLE IF NOT EXISTS bank_statement_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_date TEXT,
  transaction_type TEXT,
  description TEXT,
  transaction_group TEXT,
  sub_category TEXT,
  debit_amount REAL NOT NULL DEFAULT 0,
  credit_amount REAL NOT NULL DEFAULT 0,
  balance_amount REAL,
  direction TEXT,
  net_amount REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS purchase_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_date TEXT,
  document_type TEXT NOT NULL DEFAULT 'purchase',
  invoice_no TEXT,
  partner_id INTEGER,
  description TEXT,
  purchase_amount REAL NOT NULL DEFAULT 0,
  sales_amount REAL NOT NULL DEFAULT 0,
  vat_rate REAL NOT NULL DEFAULT 0,
  withholding_code TEXT,
  project_site_id INTEGER,
  cost_category TEXT,
  payment_status TEXT,
  due_date TEXT,
  vat_amount REAL NOT NULL DEFAULT 0,
  withholding_amount REAL NOT NULL DEFAULT 0,
  gross_total REAL NOT NULL DEFAULT 0,
  paid_amount REAL NOT NULL DEFAULT 0,
  remaining_amount REAL NOT NULL DEFAULT 0,
  delay_status TEXT,
  FOREIGN KEY (partner_id) REFERENCES business_partners(id),
  FOREIGN KEY (project_site_id) REFERENCES project_sites(id)
);

CREATE TABLE IF NOT EXISTS payment_instruments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instrument_type TEXT,
  partner_id INTEGER,
  instrument_no TEXT,
  bank_name TEXT,
  issue_date TEXT,
  due_date TEXT,
  amount REAL NOT NULL DEFAULT 0,
  status TEXT,
  settlement_date TEXT,
  note TEXT,
  FOREIGN KEY (partner_id) REFERENCES business_partners(id)
);

CREATE TABLE IF NOT EXISTS reference_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference_group TEXT NOT NULL,
  value TEXT NOT NULL,
  description TEXT,
  example_keyword TEXT,
  UNIQUE(reference_group, value)
);

CREATE TABLE IF NOT EXISTS import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name TEXT NOT NULL,
  sheet_count INTEGER NOT NULL DEFAULT 0,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'completed',
  summary_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL DEFAULT 'local-admin',
  action TEXT NOT NULL,
  entity_name TEXT NOT NULL,
  entity_id TEXT,
  old_value TEXT,
  new_value TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
