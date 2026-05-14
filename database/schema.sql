CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_name TEXT NOT NULL,
    amount REAL NOT NULL CHECK(amount > 0),
    category_id INTEGER NOT NULL,
    transaction_date TEXT NOT NULL,
    notes TEXT DEFAULT NULL,
    is_asset INTEGER NOT NULL DEFAULT 0 CHECK(is_asset IN (0,1)),
    invoice_path TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    subject TEXT DEFAULT NULL,
    notes TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tutoring_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    hourly_rate REAL NOT NULL CHECK(hourly_rate > 0),
    hours INTEGER NOT NULL DEFAULT 0 CHECK(hours >= 0),
    minutes INTEGER NOT NULL DEFAULT 0 CHECK(minutes >= 0 AND minutes < 60),
    amount_due REAL NOT NULL CHECK(amount_due > 0),
    is_paid INTEGER NOT NULL DEFAULT 0 CHECK(is_paid IN (0,1)),
    session_date TEXT NOT NULL,
    notes TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS wallet (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    personal_balance REAL NOT NULL DEFAULT 0.0,
    students_balance REAL NOT NULL DEFAULT 0.0
);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
