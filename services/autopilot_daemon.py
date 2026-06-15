import os
import sys
import time
import signal
import atexit
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from database.db import get_db
from services.autopilot import scenario_a_student_session, scenario_b_expense_reconcile
from services.desktop_notifier import DesktopNotifier

PID_FILE = Path("/tmp/autopilot_daemon.pid")
POLL_INTERVAL = 300
PROJECT_ROOT = Path(__file__).resolve().parent.parent


def write_pid():
    PID_FILE.write_text(str(os.getpid()))


def remove_pid():
    if PID_FILE.exists():
        PID_FILE.unlink()


def handle_exit(signum, frame):
    remove_pid()
    sys.exit(0)


def scan_for_student_exhaustion():
    db = get_db()
    try:
        finished_students = db.execute(
            "SELECT s.id, s.name FROM students s "
            "WHERE s.id IN (SELECT DISTINCT student_id FROM tutoring_sessions) "
            "AND s.id NOT IN ("
            "  SELECT DISTINCT student_id FROM tutoring_sessions "
            "  WHERE is_paid=0 OR amount_due > amount_paid"
            ")"
        ).fetchall()
        for student in finished_students:
            existing = db.execute(
                "SELECT id FROM reminders WHERE source_event=? AND is_active=1",
                (f"AUTOPILOT_STUDENT_{student['id']}",)
            ).fetchone()
            if existing:
                continue
            dummy_session_id = -1
            scenario_a_student_session(db, student['id'], dummy_session_id)
            db.commit()
    except Exception as e:
        print(f"[DAEMON] scan students error: {e}", file=sys.stderr)
    finally:
        db.close()


def scan_for_expense_reconciliation():
    db = get_db()
    try:
        last_id_row = db.execute(
            "SELECT MAX(affected_record_id) AS max_id FROM autopilot_logs WHERE triggered_by_table='expenses'"
        ).fetchone()
        last_id = last_id_row['max_id'] if last_id_row['max_id'] else 0
        new_expenses = db.execute(
            "SELECT id, amount, item_name FROM expenses WHERE id > ? ORDER BY id",
            (last_id,)
        ).fetchall()
        for expense in new_expenses:
            scenario_b_expense_reconcile(db, expense['id'], expense['amount'], expense['item_name'])
            db.commit()
    except Exception as e:
        print(f"[DAEMON] scan expenses error: {e}", file=sys.stderr)
    finally:
        db.close()


def health_check():
    db = get_db()
    try:
        db.execute("SELECT 1").fetchone()
    except Exception as e:
        print(f"[DAEMON] health check failed: {e}", file=sys.stderr)
        DesktopNotifier.send_notification(
            title="⚠️ Autopilot Daemon - Health Check Failed",
            message=f"Database unreachable: {e}. Daemon will retry in {POLL_INTERVAL}s."
        )
    finally:
        db.close()


def main():
    if "--run-once" in sys.argv:
        DesktopNotifier.send_notification(
            title="⏰ Autopilot Cron Cycle",
            message="Daemon checking for student exhaustion and expense reconciliation."
        )
        health_check()
        scan_for_student_exhaustion()
        scan_for_expense_reconciliation()
        return

    write_pid()
    atexit.register(remove_pid)
    signal.signal(signal.SIGTERM, handle_exit)
    signal.signal(signal.SIGINT, handle_exit)

    DesktopNotifier.send_notification(
        title="🚀 Autopilot Daemon Started",
        message=f"Background reconciliation engine is now active. Polling every {POLL_INTERVAL}s."
    )

    while True:
        health_check()
        scan_for_student_exhaustion()
        scan_for_expense_reconciliation()
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
