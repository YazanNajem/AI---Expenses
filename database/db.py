import sqlite3
from pathlib import Path

DB_DIR = Path(__file__).parent
DB_PATH = DB_DIR / 'finance.db'

def get_db():
    conn = sqlite3.connect(str(DB_PATH))
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

def _seed_categories(conn):
    categories = [
        'Food', 'Transport', 'Utilities', 'Entertainment',
        'Healthcare', 'Education', 'Clothing', 'Housing',
        'Gold/Investments', 'Other'
    ]
    existing = conn.execute("SELECT COUNT(*) FROM categories").fetchone()[0]
    if existing == 0:
        for c in categories:
            conn.execute("INSERT INTO categories (name) VALUES (?)", (c,))
        conn.commit()
    conn.execute("INSERT OR IGNORE INTO wallet (id, personal_balance, students_balance) VALUES (1, 0.0, 0.0)")
    conn.commit()
    _migrate_session_subject(conn)
