import os
import sys
import time
import subprocess
import sqlite3
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from database.db import get_db
from services.autopilot import scenario_a_student_session, scenario_b_expense_reconcile
from services.desktop_notifier import send_os_notification

ERROR_LOG = "/tmp/com.user.autopilot.err"
OUTPUT_LOG = "/tmp/com.user.autopilot.out"
TRACKING_FILE = "/tmp/com.user.autopilot.last_expense_id"
POLL_INTERVAL = 300


def log(msg):
    try:
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open(OUTPUT_LOG, "a") as f:
            f.write(f"[{ts}] {msg}\n")
    except Exception:
        pass


def scan():
    db = None
    try:
        db = get_db()
        db.execute("SELECT 1").fetchone()
        log(f"CYCLE START | DB connection OK")

        # ------- STUDENT SCAN -------
        try:
            unpaid = db.execute(
                "SELECT s.id, s.name FROM students s "
                "WHERE s.id IN (SELECT DISTINCT student_id FROM tutoring_sessions) "
                "AND s.id NOT IN ("
                "  SELECT DISTINCT student_id FROM tutoring_sessions "
                "  WHERE is_paid=0 OR amount_due > amount_paid"
                ")"
            ).fetchall()
            log(f"Students exhausted: {len(unpaid)}")
            for s in unpaid:
                exists = db.execute(
                    "SELECT id FROM reminders WHERE source_event=? AND is_active=1",
                    (f"AUTOPILOT_STUDENT_{s['id']}",)
                ).fetchone()
                if exists:
                    continue
                scenario_a_student_session(db, s['id'], -1)
                send_os_notification("🔄 Renewal", f"Student '{s['name']}' package exhausted.")
                log(f"Renewal sent: {s['name']}")
                time.sleep(1.5)
        except Exception as e:
            log(f"STUDENT SCAN ERROR: {e}")

        # ------- EXPENSE SCAN -------
        try:
            last_seen = 0
            try:
                with open(TRACKING_FILE) as f:
                    last_seen = int(f.read().strip())
            except (FileNotFoundError, ValueError):
                last_seen = db.execute("SELECT COALESCE(MAX(id), 0) FROM expenses").fetchone()[0]
            new_exp = db.execute(
                "SELECT id, amount, item_name FROM expenses WHERE id > ? ORDER BY id",
                (last_seen,)
            ).fetchall()
            log(f"New expenses: {len(new_exp)}")
            for e in new_exp:
                scenario_b_expense_reconcile(db, e['id'], e['amount'], e['item_name'])
                send_os_notification("✅ Reconciled", f"'{e['item_name']}' AED {e['amount']}")
                last_seen = e['id']
                with open(TRACKING_FILE, "w") as f:
                    f.write(str(last_seen))
                time.sleep(1.5)
        except Exception as e:
            log(f"EXPENSE SCAN ERROR: {e}")

        # ------- BILL SCAN (EXTERNAL NOTIFICATIONS ONLY) -------
        try:
            all_bills = db.execute("""
                SELECT r.id, r.title, r.amount, r.day_of_month, r.category,
                       DATE(strftime('%Y-%m', 'now', 'localtime') || '-' || printf('%02d', r.day_of_month)) AS computed_due_date,
                       CAST(ROUND(julianday(DATE(strftime('%Y-%m', 'now', 'localtime') || '-' || printf('%02d', r.day_of_month))) - julianday(DATE('now', 'localtime'))) AS INTEGER) AS days_remaining
                FROM reminders r
                WHERE r.is_active = 1
                ORDER BY r.day_of_month ASC
            """).fetchall()

            due_bills = [b for b in all_bills if b['days_remaining'] <= 1]
            log(f"Active bills: {len(all_bills)} | Due/overdue: {len(due_bills)}")

            notified_today = set()
            try:
                notified_today = set(
                    r['affected_record_id'] for r in db.execute(
                        "SELECT affected_record_id FROM autopilot_logs "
                        "WHERE event_type='REAL_ALARM_NOTIFIED' AND DATE(timestamp, 'localtime') = DATE('now', 'localtime')"
                    ).fetchall()
                )
            except Exception:
                pass
            log(f"Already notified today: {notified_today}")

            for bill in due_bills:
                if bill['id'] in notified_today:
                    log(f"SKIP (notified): {bill['title']}")
                    continue

                safe_title = bill['title'].replace('"', '\\"').replace("'", '"')
                safe_msg = f"Bill: {bill['title']} AED {bill['amount']}"
                log(f">> SENDING: {bill['title']}")
                send_os_notification("⚠️ Bill Payment Due!", safe_msg)
                log(f">> SENT: {bill['title']}")

                try:
                    db.execute(
                        "INSERT INTO autopilot_logs (event_type, description, triggered_by_table, affected_record_id) "
                        "VALUES ('REAL_ALARM_NOTIFIED', ?, 'reminders', ?)",
                        (f"External: {bill['title']} AED {bill['amount']}", bill['id'])
                    )
                    db.commit()
                    log(f">> ANTI-SPAM LOGGED: id={bill['id']}")
                except Exception as e:
                    log(f"ANTI-SPAM ERROR: {e}")

                time.sleep(2)
        except Exception as e:
            log(f"BILL SCAN ERROR: {e}")

        log(f"CYCLE DONE")

    except Exception as e:
        log(f"CYCLE FATAL ERROR: {e}")
        try:
            with open(ERROR_LOG, "a") as f:
                f.write(f"[{datetime.now()}] FATAL: {e}\n")
        except Exception:
            pass
    finally:
        if db:
            try:
                db.close()
                log("DB closed")
            except Exception:
                pass


def run_loop():
    try:
        send_os_notification("🚀 Autopilot Engine Started", f"Daemon active — {POLL_INTERVAL}s polling")
    except Exception as e:
        log(f"STARTUP NOTIFICATION ERROR: {e}")
    log("DAEMON STARTED")

    while True:
        try:
            scan()
        except Exception as e:
            log(f"LOOP FATAL ERROR: {e}")
            try:
                with open(ERROR_LOG, "a") as f:
                    f.write(f"[{datetime.now()}] LOOP FATAL: {e}\n")
            except Exception:
                pass
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    run_loop()
