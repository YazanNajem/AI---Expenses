from datetime import datetime, timedelta
from database.db import get_db


def _log_event(db, event_type, description, triggered_by_table, affected_record_id):
    db.execute(
        "INSERT INTO autopilot_logs (event_type, description, triggered_by_table, affected_record_id) VALUES (?, ?, ?, ?)",
        (event_type, description, triggered_by_table, affected_record_id)
    )
    db.commit()


def _calculate_liquidity_forecast(db):
    w = db.execute("SELECT personal_balance, students_balance, gold_assets_value FROM wallet WHERE id=1").fetchone()
    cash = (w['personal_balance'] if w else 0) + (w['students_balance'] if w else 0)
    pending = db.execute("SELECT COALESCE(SUM(amount),0) AS t FROM reminders WHERE source_event IS NOT NULL AND is_active=1").fetchone()
    pending_sum = pending['t'] if pending else 0
    fixed = db.execute("SELECT COALESCE(SUM(amount),0) AS t FROM expenses WHERE is_asset=0").fetchone()
    fixed_sum = fixed['t'] if fixed else 0
    return round(cash + pending_sum - fixed_sum, 2)


def scenario_a_student_session(db, student_id, session_id):
    try:
        student = db.execute("SELECT id, name, subject FROM students WHERE id=?", (student_id,)).fetchone()
        if not student:
            return
        source_key = f"AUTOPILOT_STUDENT_{student_id}"
        existing = db.execute(
            "SELECT id FROM reminders WHERE source_event=? AND is_active=1",
            (source_key,)
        ).fetchone()
        if existing:
            return
        latest_rate = db.execute(
            "SELECT hourly_rate FROM tutoring_sessions WHERE student_id=? ORDER BY session_date DESC LIMIT 1",
            (student_id,)
        ).fetchone()
        package_rate = latest_rate['hourly_rate'] if latest_rate else 0
        if package_rate <= 0:
            return
        due_date = (datetime.now() + timedelta(days=3)).strftime('%Y-%m-%d')
        due_day = int(datetime.now().day) + 3
        if due_day > 31:
            due_day = 31
        forecast = _calculate_liquidity_forecast(db)
        title = f"[Autopilot] Student Package Renewal: {student['name']}"
        db.execute(
            "INSERT INTO reminders (title, day_of_month, time, amount, recurrence, category, is_active, source_event, calculated_liquidity_snapshot) "
            "VALUES (?, ?, '09:00', ?, 'Monthly', 'Education', 1, ?, ?)",
            (title, due_day, package_rate, source_key, forecast)
        )
        db.commit()
        rem_id = db.execute("SELECT last_insert_rowid() AS id").fetchone()['id']
        _log_event(
            db, 'AUTOPILOT_REMINDER_CREATED',
            f"Student '{student['name']}' package renewed. Amount: AED {package_rate:,.2f}. Forecast: AED {forecast:,.2f}",
            'sessions', session_id
        )
    except Exception:
        db.rollback()


def scenario_b_expense_reconcile(db, expense_id, expense_amount, expense_item_name):
    try:
        candidates = db.execute(
            "SELECT id, title, amount, source_event FROM reminders WHERE is_active=1 AND source_event IS NOT NULL"
        ).fetchall()
        matched = None
        for r in candidates:
            amount_diff = abs(r['amount'] - expense_amount) / max(r['amount'], 1)
            if amount_diff > 0.05:
                continue
            kw_score = 0
            title_lower = r['title'].lower()
            name_lower = expense_item_name.lower()
            for kw in title_lower.split():
                if kw in name_lower:
                    kw_score += 1
            if kw_score > 0 or amount_diff <= 0.02:
                matched = r
                break
        if not matched:
            return
        db.execute("UPDATE reminders SET is_active=0 WHERE id=?", (matched['id'],))
        db.commit()
        _log_event(
            db, 'AUTOPILOT_RECONCILE_EXPENSE',
            f"Reminder '{matched['title']}' (AED {matched['amount']:,.2f}) reconciled with expense '{expense_item_name}' (AED {expense_amount:,.2f})",
            'expenses', expense_id
        )
    except Exception:
        db.rollback()
