import os
import re
from pathlib import Path
from datetime import date, datetime

from flask import Flask, render_template, request, jsonify, redirect, url_for

from database.db import get_db, init_db
from database.backup import backup_async
from services.ai_service import analyze_nl, analyze_invoice, get_chat_response

app = Flask(__name__)

UPLOAD_DIR = Path(__file__).parent / 'uploads' / 'invoices'
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

init_db()

# Register non-blocking backup on shutdown
import atexit
DB_PATH = Path(__file__).parent / 'database' / 'finance.db'
atexit.register(backup_async, str(DB_PATH))

ALLOWED_IMAGE_EXT = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
MAX_STRING_LEN = 500


def fmt(amount):
    return f"AED {amount:,.2f}"


def today_str():
    return date.today().strftime('%Y-%m-%d')


def current_month():
    return date.today().strftime('%Y-%m')


# ─── Wallet ───

def wallet_op():
    db = get_db()
    w = db.execute("SELECT personal_balance, students_balance FROM wallet WHERE id=1").fetchone()
    db.close()
    return {'personal_balance': w['personal_balance'], 'students_balance': w['students_balance']}

def wallet_add_personal(delta):
    db = get_db()
    db.execute("UPDATE wallet SET personal_balance = personal_balance + ? WHERE id=1", (delta,))
    db.commit()
    db.close()

def wallet_add_students(delta):
    db = get_db()
    db.execute("UPDATE wallet SET students_balance = students_balance + ? WHERE id=1", (delta,))
    db.commit()
    db.close()


@app.context_processor
def inject_wallet():
    try:
        w = wallet_op()
        p = w['personal_balance']
        s = w['students_balance']
        return {
            'wallet_personal': f"AED {p:,.2f}",
            'wallet_personal_raw': p,
            'wallet_students': f"AED {s:,.2f}",
            'wallet_total': f"AED {p + s:,.2f}",
            'wallet_total_raw': p + s
        }
    except Exception:
        return {'wallet_personal': 'AED 0.00', 'wallet_personal_raw': 0,
                'wallet_students': 'AED 0.00', 'wallet_total': 'AED 0.00', 'wallet_total_raw': 0}


@app.route('/api/wallet/status')
def api_wallet_status():
    w = wallet_op()
    return jsonify({
        'personal_balance': w['personal_balance'],
        'students_balance': w['students_balance'],
        'grand_total': w['personal_balance'] + w['students_balance']
    })


@app.route('/api/wallet/update_personal', methods=['POST'])
def api_wallet_update_personal():
    try:
        data = request.get_json(silent=True) or {}
        new_balance = float(data.get('new_balance', 0))
        if new_balance < 0 or new_balance > 999999999:
            return jsonify({'error': 'Invalid balance'}), 400
        w = wallet_op()
        delta = new_balance - w['personal_balance']
        wallet_add_personal(delta)
        w2 = wallet_op()
        return jsonify({
            'personal_balance': w2['personal_balance'],
            'students_balance': w2['students_balance'],
            'grand_total': w2['personal_balance'] + w2['students_balance']
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ─── Pages ───

@app.route('/')
def index():
    return redirect(url_for('expenses'))


@app.route('/expenses')
def expenses():
    selected_month = request.args.get('month', current_month())
    db = get_db()

    months = db.execute(
        "SELECT DISTINCT strftime('%Y-%m', transaction_date) AS m "
        "FROM expenses ORDER BY m DESC"
    ).fetchall()
    months = [r['m'] for r in months]
    if current_month() not in months:
        months.insert(0, current_month())

    summary = db.execute(
        "SELECT "
        "COALESCE(SUM(CASE WHEN is_asset=0 THEN amount ELSE 0 END),0) AS total_expenses, "
        "COALESCE(SUM(CASE WHEN is_asset=1 THEN amount ELSE 0 END),0) AS total_assets, "
        "COALESCE(SUM(amount),0) AS total_deducted "
        "FROM expenses WHERE strftime('%Y-%m',transaction_date)=?",
        (selected_month,)
    ).fetchone()

    breakdown = db.execute(
        "SELECT c.name, SUM(e.amount) AS total, e.is_asset "
        "FROM expenses e JOIN categories c ON c.id=e.category_id "
        "WHERE strftime('%Y-%m',e.transaction_date)=? "
        "GROUP BY c.id, e.is_asset ORDER BY total DESC",
        (selected_month,)
    ).fetchall()

    total_sum = summary['total_deducted'] or 1
    breakdown_data = []
    for row in breakdown:
        pct = (row['total'] / total_sum * 100) if total_sum > 0 else 0
        breakdown_data.append({
            'name': row['name'],
            'total': row['total'],
            'is_asset': row['is_asset'],
            'percentage': round(pct, 1)
        })

    transactions = db.execute(
        "SELECT e.*, c.name AS category_name "
        "FROM expenses e JOIN categories c ON c.id=e.category_id "
        "WHERE strftime('%Y-%m',e.transaction_date)=? "
        "ORDER BY e.transaction_date DESC, e.created_at DESC",
        (selected_month,)
    ).fetchall()

    categories = db.execute("SELECT * FROM categories ORDER BY name").fetchall()
    db.close()

    return render_template('expenses.html',
                           selected_month=selected_month,
                           months=months,
                           summary=summary,
                           breakdown=breakdown_data,
                           transactions=transactions,
                           categories=categories,
                           format_currency=fmt,
                           today=today_str())


@app.route('/expenses/add', methods=['POST'])
def add_expense():
    item_name = (request.form.get('item_name') or '').strip()[:200]
    amount_str = (request.form.get('amount') or '').strip()
    category_id_str = (request.form.get('category_id') or '').strip()
    transaction_date = (request.form.get('transaction_date') or '').strip()
    notes = (request.form.get('notes') or '').strip()[:MAX_STRING_LEN]
    is_asset = 1 if request.form.get('is_asset') == '1' else 0

    page_redirect = redirect(url_for('expenses', month=current_month()))

    if not item_name:
        return page_redirect
    try:
        amount = float(amount_str)
        if amount <= 0 or amount > 999999999:
            return page_redirect
    except (ValueError, TypeError):
        return page_redirect
    try:
        category_id = int(category_id_str)
    except (ValueError, TypeError):
        return page_redirect
    if not transaction_date:
        transaction_date = today_str()

    invoice_path = None
    if 'invoice' in request.files:
        f = request.files['invoice']
        if f and f.filename:
            raw_name = Path(f.filename).name
            ext = (Path(raw_name).suffix or '.jpg').lower()
            if ext not in ALLOWED_IMAGE_EXT:
                ext = '.jpg'
            safe_name = re.sub(r'[^\w\-]', '_', Path(raw_name).stem)[:60] or 'invoice'
            name = f"{safe_name}_{datetime.now().strftime('%Y%m%d%H%M%S')}{ext}"
            path = UPLOAD_DIR / name
            f.save(str(path))
            invoice_path = f"uploads/invoices/{name}"

    db = get_db()
    db.execute(
        "INSERT INTO expenses (item_name,amount,category_id,transaction_date,notes,is_asset,invoice_path) "
        "VALUES (?,?,?,?,?,?,?)",
        (item_name, amount, category_id, transaction_date, notes, is_asset, invoice_path)
    )
    db.commit()
    db.close()
    wallet_add_personal(-amount)
    return redirect(url_for('expenses', month=transaction_date[:7]))


@app.route('/api/expense/<int:expense_id>')
def get_expense_api(expense_id):
    db = get_db()
    row = db.execute("SELECT * FROM expenses WHERE id=?", (expense_id,)).fetchone()
    db.close()
    if not row:
        return jsonify({'error': 'Not found'}), 404
    return jsonify({
        'id': row['id'],
        'item_name': row['item_name'],
        'amount': row['amount'],
        'category_id': row['category_id'],
        'transaction_date': row['transaction_date'],
        'notes': row['notes'] or '',
        'is_asset': row['is_asset']
    })


@app.route('/expenses/edit/<int:expense_id>', methods=['POST'])
def edit_expense(expense_id):
    item_name = (request.form.get('item_name') or '').strip()[:200]
    amount_str = (request.form.get('amount') or '').strip()
    category_id_str = (request.form.get('category_id') or '').strip()
    transaction_date = (request.form.get('transaction_date') or '').strip()
    notes = (request.form.get('notes') or '').strip()[:MAX_STRING_LEN]
    is_asset = 1 if request.form.get('is_asset') == '1' else 0

    back = redirect(url_for('expenses', month=current_month()))
    if not item_name:
        return back
    try:
        amount = float(amount_str)
        if amount <= 0:
            return back
    except (ValueError, TypeError):
        return back
    try:
        category_id = int(category_id_str)
    except (ValueError, TypeError):
        return back
    if not transaction_date:
        transaction_date = today_str()

    db = get_db()
    old = db.execute("SELECT amount FROM expenses WHERE id=?", (expense_id,)).fetchone()
    old_amount = old['amount'] if old else amount
    db.execute(
        "UPDATE expenses SET item_name=?,amount=?,category_id=?,transaction_date=?,notes=?,is_asset=? WHERE id=?",
        (item_name, amount, category_id, transaction_date, notes, is_asset, expense_id)
    )
    db.commit()
    db.close()
    wallet_add_personal(old_amount - amount)
    return redirect(url_for('expenses', month=transaction_date[:7]))


@app.route('/expenses/delete/<int:expense_id>', methods=['POST'])
def delete_expense(expense_id):
    db = get_db()
    db.execute("DELETE FROM expenses WHERE id=?", (expense_id,))
    db.commit()
    db.close()
    return redirect(url_for('expenses', month=current_month()))


@app.route('/api/expenses/<int:expense_id>/delete', methods=['POST'])
def api_delete_expense(expense_id):
    try:
        body = request.get_json(silent=True) or {}
        month = body.get('month', current_month())
        db = get_db()
        row = db.execute("SELECT amount FROM expenses WHERE id=?", (expense_id,)).fetchone()
        amount = row['amount'] if row else 0
        db.execute("DELETE FROM expenses WHERE id=?", (expense_id,))
        db.commit()
        s = db.execute(
            "SELECT COALESCE(SUM(CASE WHEN is_asset=0 THEN amount ELSE 0 END),0) AS total_expenses, "
            "COALESCE(SUM(CASE WHEN is_asset=1 THEN amount ELSE 0 END),0) AS total_assets, "
            "COALESCE(SUM(amount),0) AS total_deducted "
            "FROM expenses WHERE strftime('%Y-%m',transaction_date)=?", (month,)
        ).fetchone()
        db.close()
        wallet_add_personal(amount)
        w = wallet_op()
        return jsonify({'success': True, 'summary': {
            'total_expenses': s['total_expenses'],
            'total_assets': s['total_assets'],
            'total_deducted': s['total_deducted']
        }, 'wallet': {
            'personal_balance': w['personal_balance'],
            'students_balance': w['students_balance'],
            'grand_total': w['personal_balance'] + w['students_balance']
        }})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/tutoring')
def tutoring():
    db = get_db()
    students = db.execute("SELECT * FROM students ORDER BY name").fetchall()

    sessions = db.execute(
        "SELECT ts.*, s.name AS student_name "
        "FROM tutoring_sessions ts JOIN students s ON s.id=ts.student_id "
        "ORDER BY ts.session_date DESC, ts.created_at DESC LIMIT 50"
    ).fetchall()

    reports = db.execute(
        "SELECT s.id, s.name, s.subject, "
        "COALESCE(ROUND(SUM(ts.hours+ts.minutes/60.0),2),0) AS total_hours, "
        "COALESCE(SUM(ts.amount_due),0) AS total_due, "
        "COALESCE(SUM(CASE WHEN ts.is_paid=1 THEN ts.amount_due ELSE 0 END),0) AS total_paid, "
        "COALESCE(SUM(CASE WHEN ts.is_paid=0 THEN ts.amount_due ELSE 0 END),0) AS total_remaining "
        "FROM students s LEFT JOIN tutoring_sessions ts ON ts.student_id=s.id "
        "GROUP BY s.id ORDER BY total_remaining DESC"
    ).fetchall()

    db.close()

    return render_template('tutoring.html',
                           students=students,
                           sessions=sessions,
                           reports=reports,
                           format_currency=fmt,
                           today=today_str())


@app.route('/tutoring/add', methods=['POST'])
def add_session():
    page_redirect = redirect(url_for('tutoring'))
    try:
        student_id = int(request.form.get('student_id', 0))
        if student_id <= 0:
            return page_redirect
        hourly_rate_str = (request.form.get('hourly_rate') or '').strip()
        if not hourly_rate_str:
            return page_redirect
        hourly_rate = float(hourly_rate_str)
        if hourly_rate <= 0 or hourly_rate > 99999:
            return page_redirect
    except (ValueError, TypeError):
        return page_redirect

    db = get_db()
    exists = db.execute("SELECT 1 FROM students WHERE id=?", (student_id,)).fetchone()
    if not exists:
        db.close()
        return page_redirect

    hours = int(request.form.get('hours', 0))
    minutes = int(request.form.get('minutes', 0))
    if hours < 0 or minutes < 0 or minutes > 59:
        db.close()
        return page_redirect
    session_date = (request.form.get('session_date') or today_str()).strip()
    is_paid = 1 if request.form.get('is_paid') == '1' else 0
    notes = (request.form.get('notes') or '').strip()[:MAX_STRING_LEN]

    amount_due = round(hourly_rate * (hours + minutes / 60), 2)

    db.execute(
        "INSERT INTO tutoring_sessions (student_id,hourly_rate,hours,minutes,amount_due,is_paid,session_date,notes) "
        "VALUES (?,?,?,?,?,?,?,?)",
        (student_id, hourly_rate, hours, minutes, amount_due, is_paid, session_date, notes)
    )
    db.commit()
    db.close()
    if is_paid:
        wallet_add_students(amount_due)
    return redirect(url_for('tutoring'))


@app.route('/api/session/<int:session_id>')
def get_session_api(session_id):
    db = get_db()
    row = db.execute(
        "SELECT ts.*, s.name AS student_name FROM tutoring_sessions ts "
        "JOIN students s ON s.id=ts.student_id WHERE ts.id=?",
        (session_id,)
    ).fetchone()
    db.close()
    if not row:
        return jsonify({'error': 'Not found'}), 404
    return jsonify({
        'id': row['id'],
        'student_id': row['student_id'],
        'student_name': row['student_name'],
        'hourly_rate': row['hourly_rate'],
        'hours': row['hours'],
        'minutes': row['minutes'],
        'session_date': row['session_date'],
        'is_paid': row['is_paid'],
        'notes': row['notes'] or ''
    })


@app.route('/tutoring/edit-session/<int:session_id>', methods=['POST'])
def edit_session(session_id):
    back = redirect(url_for('tutoring'))
    try:
        student_id = int(request.form.get('student_id', 0))
        if student_id <= 0:
            return back
        hourly_rate = float(request.form.get('hourly_rate', 0))
        if hourly_rate <= 0:
            return back
    except (ValueError, TypeError):
        return back

    hours = int(request.form.get('hours', 0))
    minutes = int(request.form.get('minutes', 0))
    if hours < 0 or minutes < 0 or minutes > 59:
        return back
    session_date = (request.form.get('session_date') or today_str()).strip()
    is_paid = 1 if request.form.get('is_paid') == '1' else 0
    notes = (request.form.get('notes') or '').strip()[:MAX_STRING_LEN]

    amount_due = round(hourly_rate * (hours + minutes / 60), 2)

    db = get_db()
    old = db.execute("SELECT is_paid, amount_due FROM tutoring_sessions WHERE id=?", (session_id,)).fetchone()
    old_is_paid = old['is_paid'] if old else 0
    old_amount = old['amount_due'] if old else 0

    db.execute(
        "UPDATE tutoring_sessions SET student_id=?,hourly_rate=?,hours=?,minutes=?,amount_due=?,is_paid=?,session_date=?,notes=? WHERE id=?",
        (student_id, hourly_rate, hours, minutes, amount_due, is_paid, session_date, notes, session_id)
    )
    db.commit()
    db.close()

    if old_is_paid and not is_paid:
        wallet_add_students(-old_amount)
    elif not old_is_paid and is_paid:
        wallet_add_students(amount_due)
    elif old_is_paid and is_paid:
        wallet_add_students(amount_due - old_amount)

    return redirect(url_for('tutoring'))


@app.route('/tutoring/delete-session/<int:session_id>', methods=['POST'])
def delete_session(session_id):
    db = get_db()
    row = db.execute("SELECT is_paid, amount_due FROM tutoring_sessions WHERE id=?", (session_id,)).fetchone()
    if row and row['is_paid']:
        wallet_add_students(-row['amount_due'])
    db.execute("DELETE FROM tutoring_sessions WHERE id=?", (session_id,))
    db.commit()
    db.close()
    return redirect(url_for('tutoring'))


@app.route('/api/tutoring/sessions/<int:session_id>/delete', methods=['POST'])
def api_delete_session(session_id):
    try:
        db = get_db()
        row = db.execute("SELECT is_paid, amount_due FROM tutoring_sessions WHERE id=?", (session_id,)).fetchone()
        if row and row['is_paid']:
            wallet_add_students(-row['amount_due'])
        db.execute("DELETE FROM tutoring_sessions WHERE id=?", (session_id,))
        db.commit()
        db.close()
        w = wallet_op()
        return jsonify({'success': True, 'wallet': {
            'personal_balance': w['personal_balance'],
            'students_balance': w['students_balance'],
            'grand_total': w['personal_balance'] + w['students_balance']
        }})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/tutoring/students/<int:student_id>/delete', methods=['POST'])
def api_delete_student(student_id):
    try:
        db = get_db()
        paid = db.execute(
            "SELECT COALESCE(SUM(amount_due),0) AS total FROM tutoring_sessions WHERE student_id=? AND is_paid=1",
            (student_id,)
        ).fetchone()['total']
        db.execute("DELETE FROM students WHERE id=?", (student_id,))
        db.commit()
        db.close()
        if paid > 0:
            wallet_add_students(-paid)
        w = wallet_op()
        return jsonify({'success': True, 'wallet': {
            'personal_balance': w['personal_balance'],
            'students_balance': w['students_balance'],
            'grand_total': w['personal_balance'] + w['students_balance']
        }})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/tutoring/add-student', methods=['POST'])
def add_student():
    name = (request.form.get('name') or '').strip()[:200]
    if not name:
        return jsonify({'error': 'Name required'}), 400
    subject = (request.form.get('subject') or '').strip()[:200]
    notes = (request.form.get('notes') or '').strip()[:MAX_STRING_LEN]

    db = get_db()
    cur = db.execute("INSERT INTO students (name,subject,notes) VALUES (?,?,?)",
                     (name, subject, notes))
    db.commit()
    sid = cur.lastrowid
    db.close()
    return jsonify({'id': sid, 'name': name, 'subject': subject})


# ─── AI API ───

@app.route('/api/analyze-nl', methods=['POST'])
def api_analyze_nl():
    try:
        data = request.get_json(silent=True)
        if not data or not data.get('text', '').strip():
            return jsonify({'error': 'No text provided'}), 400
        return jsonify(analyze_nl(data['text'].strip()))
    except Exception as e:
        return jsonify({'error': 'AI analysis failed: ' + str(e)}), 500


@app.route('/api/analyze-invoice', methods=['POST'])
def api_analyze_invoice():
    try:
        if 'image' not in request.files:
            return jsonify({'error': 'No image provided'}), 400
        image = request.files['image']
        return jsonify(analyze_invoice(image.read()))
    except Exception as e:
        return jsonify({'error': 'AI vision failed: ' + str(e)}), 500


@app.route('/api/chat', methods=['POST'])
def api_chat():
    data = request.get_json(silent=True)
    if not data or not data.get('question', '').strip():
        return jsonify({'error': 'No question provided'}), 400

    db = get_db()

    expenses_summary = db.execute(
        "SELECT strftime('%Y-%m',transaction_date) AS m, "
        "SUM(CASE WHEN is_asset=0 THEN amount ELSE 0 END) AS exp, "
        "SUM(CASE WHEN is_asset=1 THEN amount ELSE 0 END) AS ast "
        "FROM expenses GROUP BY m ORDER BY m DESC LIMIT 6"
    ).fetchall()

    recent = db.execute(
        "SELECT e.item_name, e.amount, c.name AS cat, e.is_asset "
        "FROM expenses e JOIN categories c ON c.id=e.category_id "
        "ORDER BY e.created_at DESC LIMIT 15"
    ).fetchall()

    students_report = db.execute(
        "SELECT s.name, "
        "COALESCE(SUM(ts.amount_due),0) AS due, "
        "COALESCE(SUM(CASE WHEN ts.is_paid=1 THEN ts.amount_due ELSE 0 END),0) AS paid, "
        "COALESCE(SUM(CASE WHEN ts.is_paid=0 THEN ts.amount_due ELSE 0 END),0) AS remaining "
        "FROM students s LEFT JOIN tutoring_sessions ts ON ts.student_id=s.id "
        "GROUP BY s.id ORDER BY remaining DESC"
    ).fetchall()

    db.close()

    lines = []
    lines.append("=== MONTHLY SUMMARY ===")
    for r in expenses_summary:
        lines.append(f"{r['m']} – Expenses: AED {r['exp']:.2f}, Assets: AED {r['ast']:.2f}")

    if recent:
        lines.append("\n=== RECENT EXPENSES ===")
        for r in recent:
            tag = " [ASSET]" if r['is_asset'] else ""
            lines.append(f"- {r['item_name']}: AED {r['amount']:.2f} ({r['cat']}){tag}")

    if students_report:
        lines.append("\n=== STUDENT FINANCES ===")
        for r in students_report:
            lines.append(f"- {r['name']}: Due AED {r['due']:.2f}, Paid AED {r['paid']:.2f}, Remaining AED {r['remaining']:.2f}")

    context = '\n'.join(lines)
    try:
        answer = get_chat_response(data['question'].strip(), context)
        return jsonify({'response': answer})
    except Exception as e:
        return jsonify({'error': 'Chat failed: ' + str(e)}), 500


if __name__ == '__main__':
    app.run(debug=True, host='127.0.0.1', port=5001)
