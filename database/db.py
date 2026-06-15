import sqlite3
from pathlib import Path

DB_DIR = Path(__file__).parent
DB_PATH = DB_DIR / 'finance.db'

def get_db():
    conn = sqlite3.connect(str(DB_PATH), timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn

def init_db():
    DB_DIR.mkdir(parents=True, exist_ok=True)
    schema_path = DB_DIR / 'schema.sql'
    conn = get_db()
    with open(schema_path) as f:
        conn.executescript(f.read())
    _seed_categories(conn)
    conn.close()

def _migrate_session_subject(conn):
    try:
        conn.execute("ALTER TABLE tutoring_sessions ADD COLUMN subject TEXT DEFAULT NULL")
    except sqlite3.OperationalError:
        pass
    conn.execute("""
        UPDATE tutoring_sessions SET subject = (SELECT subject FROM students WHERE students.id = tutoring_sessions.student_id)
        WHERE subject IS NULL AND EXISTS (SELECT 1 FROM students WHERE students.id = tutoring_sessions.student_id)
    """)
    conn.commit()

def _migrate_is_archived(conn):
    try:
        conn.execute("ALTER TABLE students ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0")
    except sqlite3.OperationalError:
        pass
    conn.commit()

def _migrate_phone_number(conn):
    try:
        conn.execute("ALTER TABLE students ADD COLUMN phone_number TEXT DEFAULT NULL")
    except sqlite3.OperationalError:
        pass
    conn.commit()

def _migrate_reminders(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS reminders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            day_of_month INTEGER NOT NULL CHECK(day_of_month >= 1 AND day_of_month <= 31),
            time TEXT NOT NULL DEFAULT '09:00',
            amount REAL NOT NULL CHECK(amount > 0),
            recurrence TEXT NOT NULL DEFAULT 'Monthly',
            category TEXT NOT NULL DEFAULT 'Bills',
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)
    try:
        conn.execute("ALTER TABLE reminders ADD COLUMN time TEXT NOT NULL DEFAULT '09:00'")
    except sqlite3.OperationalError:
        pass
    conn.commit()

def _migrate_amount_paid(conn):
    try:
        conn.execute("ALTER TABLE tutoring_sessions ADD COLUMN amount_paid REAL NOT NULL DEFAULT 0.0")
    except sqlite3.OperationalError:
        pass
    conn.execute("""
        UPDATE tutoring_sessions SET amount_paid = amount_due WHERE is_paid = 1 AND amount_paid = 0
    """)
    conn.commit()

def _migrate_payment_method(conn):
    try:
        conn.execute("ALTER TABLE expenses ADD COLUMN payment_method TEXT DEFAULT 'bank'")
    except sqlite3.OperationalError:
        pass
    conn.commit()

def _seed_categories(conn):
    categories = [
        'Food', 'Patrol', 'Utilities', 'Entertainment',
        'Healthcare', 'Education', 'Clothing', 'Housing',
        'Gold/Investments', 'Groceries', 'Telecom', 'Smoking', 'Other',
        'Internal Transfer', 'Savings Deposit', 'Cash Withdrawal'
    ]
    existing = conn.execute("SELECT COUNT(*) FROM categories").fetchone()[0]
    if existing == 0:
        for c in categories:
            conn.execute("INSERT INTO categories (name) VALUES (?)", (c,))
        conn.commit()
    conn.execute("INSERT OR IGNORE INTO wallet (id, personal_balance, students_balance) VALUES (1, 0.0, 0.0)")
    conn.commit()
    _migrate_session_subject(conn)
    _migrate_amount_paid(conn)
    _migrate_is_archived(conn)
    _migrate_phone_number(conn)
    _migrate_reminders(conn)
    _migrate_gold_assets(conn)
    _migrate_autopilot(conn)
    _migrate_payment_method(conn)
    for name in ['Internal Transfer', 'Savings Deposit', 'Cash Withdrawal']:
        conn.execute("INSERT OR IGNORE INTO categories (name) VALUES (?)", (name,))
    conn.commit()

def _migrate_gold_assets(conn):
    try:
        conn.execute("ALTER TABLE wallet ADD COLUMN gold_assets_value REAL NOT NULL DEFAULT 0.0")
    except sqlite3.OperationalError:
        pass

def _migrate_autopilot(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS autopilot_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL,
            description TEXT NOT NULL,
            triggered_by_table TEXT NOT NULL,
            affected_record_id INTEGER NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    for col in ['source_event', 'calculated_liquidity_snapshot']:
        try:
            conn.execute(f"ALTER TABLE reminders ADD COLUMN {col} TEXT DEFAULT NULL")
        except sqlite3.OperationalError:
            pass
    try:
        conn.execute("ALTER TABLE reminders ADD COLUMN calculated_liquidity_snapshot REAL DEFAULT 0.0")
    except sqlite3.OperationalError:
        pass
    conn.execute("CREATE INDEX IF NOT EXISTS idx_reminders_source_event ON reminders(source_event)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_reminders_is_active_source ON reminders(is_active, source_event)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_autopilot_logs_timestamp ON autopilot_logs(timestamp DESC)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_autopilot_logs_event_type ON autopilot_logs(event_type)")
    conn.commit()
