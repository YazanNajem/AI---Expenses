from pathlib import Path
from datetime import date, datetime
import requests
import re

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

from database.db import get_db, init_db
from database.backup import backup_async
from services.autopilot import scenario_a_student_session, scenario_b_expense_reconcile

app = Flask(__name__)
CORS(app)

init_db()

# ── Schema migration: add completed_month to reminders ──
try:
    _db = get_db()
    _db.execute("ALTER TABLE reminders ADD COLUMN completed_month TEXT DEFAULT NULL")
    _db.commit()
    _db.close()
except Exception:
    pass

# ── Schema migration: create portfolio_assets table ──
try:
    _db = get_db()
    _db.execute("""
        CREATE TABLE IF NOT EXISTS portfolio_assets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            asset_type TEXT NOT NULL,
            name TEXT NOT NULL,
            quantity REAL NOT NULL DEFAULT 1,
            unit TEXT DEFAULT '',
            value_per_unit REAL NOT NULL DEFAULT 0,
            total_value REAL NOT NULL DEFAULT 0,
            notes TEXT DEFAULT '',
            purchase_date TEXT DEFAULT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)
    _db.commit()
    _db.close()
except Exception:
    pass

# ── Schema migration: add current_value to portfolio_assets ──
try:
    _db = get_db()
    _db.execute("ALTER TABLE portfolio_assets ADD COLUMN current_value REAL DEFAULT NULL")
    _db.commit()
    _db.close()
except Exception:
    pass

# ── Schema migration: add granular asset columns ──
try:
    _db = get_db()
    _db.execute("ALTER TABLE portfolio_assets ADD COLUMN weight_g REAL DEFAULT NULL")
    _db.commit()
    _db.close()
except Exception:
    pass
for _col in ['purity', 'location', 'ticker']:
    try:
        _db = get_db()
        _db.execute(f"ALTER TABLE portfolio_assets ADD COLUMN {_col} TEXT DEFAULT ''")
        _db.commit()
        _db.close()
    except Exception:
        pass

# ── Schema migration: add savings_balance to wallet ──
try:
    _db = get_db()
    _db.execute("ALTER TABLE wallet ADD COLUMN savings_balance REAL NOT NULL DEFAULT 0.0")
    _db.commit()
    _db.close()
except Exception:
    pass

# ── Schema migration: add is_income flag to expenses ──
try:
    _db = get_db()
    _db.execute("ALTER TABLE expenses ADD COLUMN is_income INTEGER NOT NULL DEFAULT 0")
    _db.commit()
    _db.close()
except Exception:
    pass

# ── Schema migration: add monthly_spent to wallet (hybrid independent column) ──
try:
    _db = get_db()
    _db.execute("ALTER TABLE wallet ADD COLUMN monthly_spent REAL DEFAULT 0")
    _db.commit()
    _db.close()
except Exception:
    pass
# Initialize monthly_spent from current computed total if still zero
try:
    _db = get_db()
    cur = _db.execute("SELECT monthly_spent FROM wallet WHERE id=1").fetchone()
    if cur and not cur['monthly_spent']:
        s = _db.execute(
            "SELECT COALESCE(SUM(CASE WHEN e.is_asset=0 AND e.is_income=0 THEN e.amount ELSE 0 END),0) "
            "FROM expenses e JOIN categories c ON c.id = e.category_id "
            "WHERE c.name NOT IN ('Internal Transfer','Savings Deposit','Cash Withdrawal') AND COALESCE(e.payment_method,'bank')='bank'"
        ).fetchone()
        init_val = s[0] if s else 0
        _db.execute("UPDATE wallet SET monthly_spent=? WHERE id=1", (init_val,))
        _db.commit()
    _db.close()
except Exception:
    pass

# ── Seed: ensure Internal Transfer and Savings Deposit categories exist ──
try:
    _db = get_db()
    _db.execute("INSERT OR IGNORE INTO categories (name) VALUES ('Internal Transfer')")
    _db.execute("INSERT OR IGNORE INTO categories (name) VALUES ('Savings Deposit')")
    _db.execute("INSERT OR IGNORE INTO categories (name) VALUES ('Groceries')")
    _db.execute("INSERT OR IGNORE INTO categories (name) VALUES ('Telecom')")
    _db.execute("UPDATE categories SET name='Patrol' WHERE name='Transport'")
    _db.execute("INSERT OR IGNORE INTO categories (name) VALUES ('Smoking')")
    _db.execute("INSERT OR IGNORE INTO categories (name) VALUES ('Cash Withdrawal')")
    _db.commit()
    _db.close()
except Exception:
    pass

# Register non-blocking backup on shutdown
import atexit
DB_PATH = Path(__file__).parent / 'database' / 'finance.db'
atexit.register(backup_async, str(DB_PATH))

MAX_STRING_LEN = 500


def fmt(amount):
    return f"AED {amount:,.2f}"


def today_str():
    return date.today().strftime('%Y-%m-%d')


def current_month():
    return date.today().strftime('%Y-%m')

# ─── Gold Price ───

_GOLD_PRICE_CACHE = {'aed_per_gram': None, 'timestamp': 0}
_OZ_TO_GRAM = 31.1035
_GOLD_API_URL = 'https://api.gold-api.com/price/XAU'

def get_gold_price_aed_per_gram(force_refresh=False):
    import time
    now = time.time()
    if not force_refresh and _GOLD_PRICE_CACHE['aed_per_gram'] is not None and (now - _GOLD_PRICE_CACHE['timestamp']) < 300:
        return _GOLD_PRICE_CACHE['aed_per_gram']
    try:
        r = requests.get(_GOLD_API_URL, timeout=8, headers={'User-Agent': 'Mozilla/5.0'})
        if r.status_code == 200:
            data = r.json()
            price_usd_per_oz = float(data.get('price', 0))
            if price_usd_per_oz > 0:
                usd_to_aed = 3.6725
                aed_per_gram = (price_usd_per_oz * usd_to_aed) / _OZ_TO_GRAM
                _GOLD_PRICE_CACHE['aed_per_gram'] = round(aed_per_gram, 2)
                _GOLD_PRICE_CACHE['timestamp'] = now
                return _GOLD_PRICE_CACHE['aed_per_gram']
    except Exception:
        pass
    if _GOLD_PRICE_CACHE['aed_per_gram'] is not None:
        return _GOLD_PRICE_CACHE['aed_per_gram']
    return 0


@app.route('/api/gold-price')
def api_gold_price():
    price = get_gold_price_aed_per_gram()
    return jsonify({'aed_per_gram': price, 'updated_at': _GOLD_PRICE_CACHE['timestamp']})


@app.route('/api/portfolio/summary')
def api_portfolio_summary():
    try:
        price_per_gram = get_gold_price_aed_per_gram()
    except Exception:
        price_per_gram = 0
    db = get_db()
    rows = db.execute(
        "SELECT asset_type, current_value, weight_g, purity, total_value FROM portfolio_assets"
    ).fetchall()
    gold = 0.0
    real_estate = 0.0
    stocks = 0.0
    crypto = 0.0
    for r in rows:
        t = r['asset_type']
        if t == 'gold' and r['weight_g'] and price_per_gram:
            val = compute_gold_live_value(r['weight_g'], r['purity'], None)
        else:
            val = r['current_value']
        v = float(val or 0)
        if t == 'gold': gold += v
        elif t == 'real_estate': real_estate += v
        elif t == 'stocks': stocks += v
        elif t == 'crypto': crypto += v
    legacy_total = 0.0
    legacy_rows = db.execute(
        "SELECT e.amount, e.item_name, e.transaction_date FROM expenses e "
        "JOIN categories c ON c.id = e.category_id "
        "WHERE c.name = 'Gold/Investments'"
    ).fetchall()
    for lr in legacy_rows:
        legacy_total += float(lr['amount'] or 0)
    db.close()
    grand = round(gold + real_estate + stocks + crypto + legacy_total, 2)
    return jsonify({
        'total': grand,
        'gold': round(gold + legacy_total, 2),
        'real_estate': round(real_estate, 2),
        'stocks': round(stocks, 2),
        'crypto': round(crypto, 2)
    })


@app.route('/api/portfolio/assets')
def api_portfolio_assets():
    try:
        db = get_db()
        rows = db.execute("SELECT * FROM portfolio_assets ORDER BY id DESC").fetchall()
        items = [dict(r) for r in rows]
        # Append legacy Gold/Investments expenses as read-only items
        legacy = db.execute(
            "SELECT e.id, e.amount, e.item_name, e.transaction_date FROM expenses e "
            "JOIN categories c ON c.id = e.category_id "
            "WHERE c.name = 'Gold/Investments'"
        ).fetchall()
        for lr in legacy:
            parsed_w = extract_gold_weight(lr['item_name'])
            items.append({
                'id': f"legacy_{lr['id']}",
                'asset_type': 'gold',
                'name': lr['item_name'],
                'quantity': float(parsed_w or 1), 'unit': '24K' if parsed_w else '',
                'total_value': float(lr['amount'] or 0),
                'current_value': float(lr['amount'] or 0),
                'weight_g': parsed_w, 'purity': '24' if parsed_w else 'Legacy',
                'location': '', 'ticker': '',
                'purchase_date': lr['transaction_date'],
                'notes': 'Legacy investment from expenses',
                'is_legacy': True
            })
        db.close()
        return jsonify(items)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/portfolio/assets', methods=['POST'])
def api_portfolio_add_asset():
    try:
        data = request.get_json(silent=True) or {}
        asset_type = data.get('asset_type', 'gold')
        name = (data.get('name') or '').strip()
        quantity = float(data.get('quantity', 1))
        unit = (data.get('unit') or '').strip()
        total_value = float(data.get('total_value', 0))
        current_value = data.get('current_value')
        weight_g = float(data['weight_g']) if data.get('weight_g') else None
        if data.get('purity') is not None:
            pv = data['purity']
            purity = str(int(pv)) if pv and str(pv).strip() else ''
        elif data.get('asset_type') == 'gold' and data.get('unit'):
            k = data['unit'].replace('K', '').replace('k', '').strip()
            purity = str(int(k)) if k.isdigit() else None
        else:
            purity = None
        if weight_g is None and data.get('asset_type') == 'gold' and data.get('quantity'):
            weight_g = float(data['quantity'])
        location = data.get('location', '')
        ticker = data.get('ticker', '')
        purchase_date = data.get('purchase_date', '')
        notes = (data.get('notes') or '').strip()
        if not name:
            return jsonify({'error': 'Name required'}), 400
        db = get_db()
        cur = db.execute(
            "INSERT INTO portfolio_assets (asset_type, name, quantity, unit, total_value, current_value, weight_g, purity, location, ticker, purchase_date, notes) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (asset_type, name, quantity, unit, total_value,
             float(current_value) if current_value else None,
             weight_g,
             purity, location, ticker,
             purchase_date or None, notes)
        )
        db.commit()
        db.close()
        return jsonify({'success': True, 'id': cur.lastrowid})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/portfolio/assets/<int:asset_id>')
def api_portfolio_get_asset(asset_id):
    try:
        db = get_db()
        row = db.execute("SELECT * FROM portfolio_assets WHERE id=?", (asset_id,)).fetchone()
        db.close()
        if not row:
            return jsonify({'error': 'Not found'}), 404
        return jsonify(dict(row))
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/portfolio/assets/<int:asset_id>', methods=['PUT'])
def api_portfolio_update_asset(asset_id):
    try:
        data = request.get_json(silent=True) or {}
        fields = []
        vals = []
        if 'weight_g' in data:
            fields.append('weight_g=?')
            wv = data['weight_g']
            vals.append(float(wv) if wv is not None else None)
        if 'purity' in data:
            fields.append('purity=?')
            pv = data['purity']
            vals.append(str(int(pv)) if pv and str(pv).strip() else '')
        if 'quantity' in data:
            fields.append('quantity=?')
            qv = data['quantity']
            vals.append(float(qv) if qv is not None else None)
        if 'unit' in data:
            fields.append('unit=?')
            vals.append(data['unit'])
        if 'current_value' in data:
            fields.append('current_value=?')
            vals.append(float(data['current_value']) if data['current_value'] else None)
        if 'total_value' in data:
            fields.append('total_value=?')
            vals.append(float(data['total_value']) if data['total_value'] else None)
        if 'name' in data:
            fields.append('name=?')
            vals.append(data['name'])
        if 'notes' in data:
            fields.append('notes=?')
            vals.append(data['notes'])
        if not fields:
            return jsonify({'error': 'No fields to update'}), 400
        vals.append(asset_id)
        db = get_db()
        db.execute(f"UPDATE portfolio_assets SET {', '.join(fields)} WHERE id=?", vals)
        db.commit()
        db.close()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/portfolio/assets/<int:asset_id>', methods=['DELETE'])
def api_portfolio_delete_asset(asset_id):
    try:
        db = get_db()
        db.execute("DELETE FROM portfolio_assets WHERE id=?", (asset_id,))
        db.commit()
        db.close()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def compute_gold_live_value(weight_g, purity_str, fallback=0):
    price_per_gram = get_gold_price_aed_per_gram()
    if not price_per_gram or not weight_g:
        return fallback
    karat = 24
    if purity_str and purity_str.replace('K', '').replace('k', '').isdigit():
        karat = int(purity_str.replace('K', '').replace('k', ''))
    live = weight_g * (karat / 24) * price_per_gram
    return round(live, 2)

def extract_gold_weight(name):
    """Parse weight in grams from legacy gold item names like 'Gold Bar 50g'."""
    m = re.search(r'(\d+\.?\d*)\s*g', str(name or ''), re.IGNORECASE)
    return float(m.group(1)) if m else None


# ─── Wallet ───

def compute_portfolio_live_total():
    """Aggregates current_value per row: live calc for weight-bearing gold,
    stored cv otherwise. Uses quantity+unit as canonical source, falling
    back to weight_g+purity for backward compatibility. Legacy expense items
    contribute their amount as their current_value."""
    try:
        price_per_gram = get_gold_price_aed_per_gram()
    except Exception:
        price_per_gram = 0
    db = get_db()
    rows = db.execute(
        "SELECT asset_type, current_value, weight_g, purity, quantity, unit "
        "FROM portfolio_assets"
    ).fetchall()
    total = 0.0
    for r in rows:
        if r['asset_type'] == 'gold' and price_per_gram:
            w = r['weight_g'] or r['quantity'] or 0
            if w and w > 0:
                p = r['purity'] or ''
                if r['unit']:
                    k = r['unit'].replace('K', '').replace('k', '').strip()
                    p = k if k.isdigit() else p
                val = compute_gold_live_value(w, p, None)
            else:
                val = r['current_value']
        else:
            val = r['current_value']
        total += float(val or 0)
    legacy_rows = db.execute(
        "SELECT e.amount, e.item_name FROM expenses e "
        "JOIN categories c ON c.id = e.category_id "
        "WHERE c.name = 'Gold/Investments'"
    ).fetchall()
    for lr in legacy_rows:
        parsed_w = extract_gold_weight(lr['item_name'])
        if parsed_w and price_per_gram:
            total += compute_gold_live_value(parsed_w, '24', 0)
        else:
            total += float(lr['amount'] or 0)
    db.close()
    return round(total, 2)

def compute_portfolio_invested():
    """Sum of purchase prices (total_value) for all portfolio assets + legacy gold expenses."""
    try:
        db = get_db()
        row = db.execute("SELECT COALESCE(SUM(total_value),0) FROM portfolio_assets").fetchone()
        total = float(row[0] or 0)
        legacy = db.execute(
            "SELECT COALESCE(SUM(e.amount),0) FROM expenses e "
            "JOIN categories c ON c.id = e.category_id "
            "WHERE c.name = 'Gold/Investments'"
        ).fetchone()
        total += float(legacy[0] or 0)
        db.close()
        return round(total, 2)
    except Exception:
        return 0.0

def wallet_op():
    db = get_db()
    w = db.execute("SELECT personal_balance, students_balance, savings_balance FROM wallet WHERE id=1").fetchone()
    db.close()
    portfolio_total = compute_portfolio_live_total()
    return {
        'personal_balance': w['personal_balance'],
        'students_balance': w['students_balance'],
        'gold_assets_value': portfolio_total,
        'savings_balance': w['savings_balance'] or 0
    }

def wallet_add_personal(delta):
    db = get_db()
    db.execute("UPDATE wallet SET personal_balance = personal_balance + ? WHERE id=1", (delta,))
    db.commit()
    db.close()

def wallet_add_monthly_spent(delta):
    db = get_db()
    db.execute("UPDATE wallet SET monthly_spent = monthly_spent + ? WHERE id=1", (delta,))
    db.commit()
    db.close()

def wallet_add_students(delta):
    db = get_db()
    db.execute("UPDATE wallet SET students_balance = students_balance + ? WHERE id=1", (delta,))
    db.commit()
    db.close()

def wallet_add_savings(delta):
    db = get_db()
    db.execute("UPDATE wallet SET savings_balance = savings_balance + ? WHERE id=1", (delta,))
    db.commit()
    db.close()


@app.route('/api/wallet/status')
def api_wallet_status():
    try:
        w = wallet_op()
        db = get_db()
        row = db.execute("SELECT monthly_spent FROM wallet WHERE id=1").fetchone()
        db.close()
        monthly_spent = float(row['monthly_spent']) if row and row['monthly_spent'] else 0
        personal = float(w['personal_balance'] or 0)
        savings = float(w['savings_balance'] or 0)
        assets = float(w['gold_assets_value'] or 0)
        gold_price = 0
        total_gold_weight = 0
        gold_item_count = 0
        other_investments = 0
        try:
            gold_price = get_gold_price_aed_per_gram()
            dp = get_db()
            g_items = dp.execute("SELECT weight_g FROM portfolio_assets WHERE asset_type='gold' AND weight_g IS NOT NULL").fetchall()
            total_gold_weight = sum(float(r['weight_g'] or 0) for r in g_items)
            gold_item_count = len(g_items)
            oi = dp.execute("SELECT COALESCE(SUM(COALESCE(current_value,0)),0) FROM portfolio_assets WHERE asset_type!='gold'").fetchone()
            other_investments = oi[0] if oi else 0
            dp.close()
        except Exception:
            try: dp.close()
            except: pass
        total_assets_current = compute_portfolio_live_total()
        total_assets_invested = compute_portfolio_invested()
        total_assets_pl_value = round(total_assets_current - total_assets_invested, 2)
        return jsonify({
            'personal_balance': personal,
            'students_balance': float(w['students_balance'] or 0),
            'grand_total': personal + float(w['students_balance'] or 0),
            'gold_assets_value': assets,
            'savings_balance': savings,
            'monthly_spent': monthly_spent,
            'available_balance': personal,
            'total_money': personal + savings,
            'master_portfolio_validated_current_total': assets,
            'total_combined_master_funds': personal + savings + assets,
            'gold_live_price': gold_price,
            'portfolio_gold_weight': total_gold_weight,
            'portfolio_gold_count': gold_item_count,
            'portfolio_other_investments': other_investments,
            'total_assets_current': total_assets_current,
            'total_assets_invested': total_assets_invested,
            'total_assets_pl_value': total_assets_pl_value
        })
    except Exception:
        return jsonify({
            'personal_balance': 0, 'students_balance': 0, 'grand_total': 0,
            'gold_assets_value': 0, 'savings_balance': 0, 'monthly_spent': 0,
            'available_balance': 0, 'total_money': 0,
            'master_portfolio_validated_current_total': 0,
            'total_combined_master_funds': 0,
            'gold_live_price': 0, 'portfolio_gold_weight': 0,
            'portfolio_gold_count': 0, 'portfolio_other_investments': 0,
            'total_assets_current': 0, 'total_assets_invested': 0, 'total_assets_pl_value': 0
        })


@app.route('/api/wallet/transfer', methods=['POST'])
def api_wallet_transfer():
    try:
        data = request.get_json(silent=True) or {}
        amount = float(data.get('amount', 0))
        mode = data.get('type', 'withdraw')
        if amount <= 0:
            return jsonify({'error': 'Amount must be positive'}), 400
        if mode not in ('add', 'withdraw'):
            return jsonify({'error': 'Type must be "add" or "withdraw"'}), 400
        db = get_db()
        if mode == 'withdraw':
            savings = db.execute("SELECT savings_balance FROM wallet WHERE id=1").fetchone()['savings_balance']
            if amount > savings:
                db.close()
                return jsonify({'error': 'Insufficient savings balance'}), 400
            cat = db.execute("SELECT id FROM categories WHERE name='Internal Transfer'").fetchone()
            if not cat:
                db.close()
                return jsonify({'error': 'Internal Transfer category missing'}), 500
            cat_id = cat['id']
            today = date.today().isoformat()
            db.execute("UPDATE wallet SET personal_balance = personal_balance + ?, savings_balance = savings_balance - ? WHERE id=1", (amount, amount))
            db.execute(
                "INSERT INTO expenses (item_name, amount, category_id, transaction_date, notes, is_asset) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (f"Withdraw from Savings — AED {amount:,.2f}", amount, cat_id, today, 'Savings withdrawal to salary', 0)
            )
        else:  # 'add'
            cat = db.execute("SELECT id FROM categories WHERE name='Savings Deposit'").fetchone()
            if not cat:
                db.close()
                return jsonify({'error': 'Savings Deposit category missing'}), 500
            cat_id = cat['id']
            today = date.today().isoformat()
            db.execute("UPDATE wallet SET personal_balance = personal_balance - ?, savings_balance = savings_balance + ? WHERE id=1", (amount, amount))
            db.execute(
                "INSERT INTO expenses (item_name, amount, category_id, transaction_date, notes, is_asset) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (f"Deposit to Savings — AED {amount:,.2f}", amount, cat_id, today, 'Direct savings deposit', 0)
            )
        db.commit()
        db.close()
        w = wallet_op()
        gav = w.get('gold_assets_value', 0)
        return jsonify({'success': True, 'wallet': {
            'personal_balance': w['personal_balance'],
            'savings_balance': w['savings_balance'],
            'students_balance': w['students_balance'],
            'grand_total': w['personal_balance'] + w['students_balance'],
            'gold_assets_value': gav,
            'master_portfolio_validated_current_total': w['gold_assets_value'],
            'total_money': w['personal_balance'] + (w['savings_balance'] or 0),
            'total_combined_master_funds': float(w['personal_balance'] or 0) + float(w['savings_balance'] or 0) + float(gav or 0)
        }})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


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
        if 'monthly_spent' in data:
            ms = float(data['monthly_spent'])
            db = get_db()
            db.execute("UPDATE wallet SET monthly_spent=? WHERE id=1", (ms,))
            db.commit()
            db.close()
        w2 = wallet_op()
        gav = w2.get('gold_assets_value', 0)
        return jsonify({
            'personal_balance': w2['personal_balance'],
            'students_balance': w2['students_balance'],
            'grand_total': w2['personal_balance'] + w2['students_balance'],
            'savings_balance': w2['savings_balance'],
            'total_money': w2['personal_balance'] + w2['savings_balance'],
            'total_combined_master_funds': float(w2['personal_balance'] or 0) + float(w2['savings_balance'] or 0) + float(gav or 0)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/wallet/update_gold', methods=['POST'])
def api_wallet_update_gold():
    try:
        data = request.get_json(silent=True) or {}
        new_value = float(data.get('new_value', 0))
        if new_value < 0 or new_value > 999999999:
            return jsonify({'error': 'Invalid value'}), 400
        db = get_db()
        db.execute("UPDATE wallet SET gold_assets_value = ? WHERE id=1", (new_value,))
        db.commit()
        w = db.execute("SELECT personal_balance, students_balance, gold_assets_value, savings_balance FROM wallet WHERE id=1").fetchone()
        db.close()
        gav = w['gold_assets_value']
        return jsonify({
            'personal_balance': w['personal_balance'],
            'students_balance': w['students_balance'],
            'grand_total': w['personal_balance'] + w['students_balance'],
            'gold_assets_value': gav,
            'savings_balance': w['savings_balance'] or 0,
            'total_money': w['personal_balance'] + (w['savings_balance'] or 0),
            'total_combined_master_funds': float(w['personal_balance'] or 0) + float(w['savings_balance'] or 0) + float(gav or 0)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/wallet/update_savings', methods=['POST'])
def api_wallet_update_savings():
    try:
        data = request.get_json(silent=True) or {}
        new_val = float(data.get('new_value', 0))
        if new_val < 0 or new_val > 999999999:
            return jsonify({'error': 'Invalid value'}), 400
        db = get_db()
        db.execute("UPDATE wallet SET savings_balance = ? WHERE id=1", (new_val,))
        db.commit()
        w = wallet_op()
        db.close()
        gav = w.get('gold_assets_value', 0)
        return jsonify({
            'savings_balance': w['savings_balance'],
            'personal_balance': w['personal_balance'],
            'grand_total': w['personal_balance'] + w['students_balance'],
            'total_money': w['personal_balance'] + w['savings_balance'],
            'total_combined_master_funds': float(w['personal_balance'] or 0) + float(w['savings_balance'] or 0) + float(gav or 0)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


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


@app.route('/api/expenses/<int:expense_id>/delete', methods=['POST'])
def api_delete_expense(expense_id):
    try:
        body = request.get_json(silent=True) or {}
        month = body.get('month', current_month())
        db = get_db()
        w = db.execute("SELECT personal_balance, savings_balance FROM wallet WHERE id=1").fetchone()
        current_personal = float(w['personal_balance'] or 0)
        current_savings = float(w['savings_balance'] or 0)
        all_rows = db.execute(
            "SELECT e.amount, c.name AS cat_name, e.is_income, COALESCE(e.payment_method,'bank') AS payment_method FROM expenses e "
            "JOIN categories c ON c.id = e.category_id"
        ).fetchall()
        pre_total_normal = 0.0
        pre_total_add = 0.0
        pre_total_withdraw = 0.0
        pre_total_income = 0.0
        pre_total_cash = 0.0
        for r in all_rows:
            amt = abs(float(r['amount']))
            pm = (r['payment_method'] or 'bank').strip().lower()
            if pm == 'cash':
                continue
            if r['is_income']:
                pre_total_income += amt
                continue
            cn = (r['cat_name'] or '').strip().lower()
            if cn in ('cash withdrawal',):
                pre_total_cash += amt
            elif cn in ('internal transfer', 'withdraw'):
                pre_total_withdraw += amt
            elif cn in ('savings deposit', 'add'):
                pre_total_add += amt
            else:
                pre_total_normal += amt
        base_personal = current_personal + pre_total_normal + pre_total_add + pre_total_cash - pre_total_withdraw - pre_total_income
        base_savings = current_savings - pre_total_add + pre_total_withdraw
        del_row = db.execute("SELECT e.amount, e.is_income, c.name AS cat_name, COALESCE(e.payment_method,'bank') AS payment_method FROM expenses e JOIN categories c ON c.id = e.category_id WHERE e.id=?", (expense_id,)).fetchone()
        db.execute("DELETE FROM expenses WHERE id=?", (expense_id,))
        db.commit()
        if del_row:
            del_amt = abs(float(del_row['amount']))
            del_is_income = del_row['is_income']
            del_pm = (del_row['payment_method'] or 'bank').strip().lower()
            del_cat = (del_row['cat_name'] or '').strip().lower()
            if not del_is_income and del_pm != 'cash' and del_cat not in ('internal transfer', 'savings deposit', 'cash withdrawal'):
                wallet_add_monthly_spent(-del_amt)
        s = db.execute(
            "SELECT COALESCE(SUM(CASE WHEN e.is_asset=0 AND e.is_income=0 THEN e.amount ELSE 0 END),0) AS total_expenses, "
            "COALESCE(SUM(CASE WHEN e.is_asset=1 THEN e.amount ELSE 0 END),0) AS total_assets, "
            "COALESCE(SUM(CASE WHEN e.is_income=0 THEN e.amount ELSE 0 END),0) AS total_deducted "
            "FROM expenses e JOIN categories c ON c.id = e.category_id "
            "WHERE c.name NOT IN ('Internal Transfer','Savings Deposit','Cash Withdrawal') AND COALESCE(e.payment_method,'bank')='bank' AND strftime('%Y-%m',e.transaction_date)=?", (month,)
        ).fetchone()
        remaining = db.execute(
            "SELECT e.amount, c.name AS cat_name, e.is_income, COALESCE(e.payment_method,'bank') AS payment_method FROM expenses e "
            "JOIN categories c ON c.id = e.category_id"
        ).fetchall()
        post_total_normal = 0.0
        post_total_add = 0.0
        post_total_withdraw = 0.0
        post_total_income = 0.0
        post_total_cash = 0.0
        for r in remaining:
            amt = abs(float(r['amount']))
            pm = (r['payment_method'] or 'bank').strip().lower()
            if pm == 'cash':
                continue
            if r['is_income']:
                post_total_income += amt
                continue
            cn = (r['cat_name'] or '').strip().lower()
            if cn in ('cash withdrawal',):
                post_total_cash += amt
            elif cn in ('internal transfer', 'withdraw'):
                post_total_withdraw += amt
            elif cn in ('savings deposit', 'add'):
                post_total_add += amt
            else:
                post_total_normal += amt
        new_personal = base_personal - post_total_normal - post_total_add - post_total_cash + post_total_withdraw + post_total_income
        new_savings = base_savings + post_total_add - post_total_withdraw
        db.execute("UPDATE wallet SET personal_balance = ?, savings_balance = ? WHERE id=1", (new_personal, new_savings))
        db.commit()
        w2 = db.execute("SELECT personal_balance, savings_balance, students_balance, gold_assets_value, monthly_spent FROM wallet WHERE id=1").fetchone()
        db.close()
        gav = float(w2['gold_assets_value'] or 0)
        spent_val = float(w2['monthly_spent'] or 0)
        return jsonify({'success': True, 'summary': {
            'total_expenses': spent_val,
            'total_assets': s['total_assets'],
            'total_deducted': s['total_deducted']
        }, 'wallet': {
            'personal_balance': float(w2['personal_balance'] or 0),
            'savings_balance': float(w2['savings_balance'] or 0),
            'students_balance': float(w2['students_balance'] or 0),
            'grand_total': float(w2['personal_balance'] or 0) + float(w2['students_balance'] or 0),
            'gold_assets_value': gav,
            'total_combined_master_funds': float(w2['personal_balance'] or 0) + float(w2['savings_balance'] or 0) + gav
        }})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/expenses')
def api_expenses():
    try:
        month = request.args.get('month')
        db = get_db()
        if month:
            rows = db.execute(
                "SELECT e.id, e.item_name, e.amount, e.category_id, "
                "c.name AS category_name, e.transaction_date, e.notes, e.is_asset, COALESCE(e.payment_method,'bank') AS payment_method "
                "FROM expenses e JOIN categories c ON c.id = e.category_id "
                "WHERE strftime('%Y-%m', e.transaction_date)=? "
                "ORDER BY e.id DESC", (month,)
            ).fetchall()
            s = db.execute(
                "SELECT COALESCE(SUM(CASE WHEN e.is_asset=0 AND e.is_income=0 THEN e.amount ELSE 0 END),0) AS total_expenses, "
                "COALESCE(SUM(CASE WHEN e.is_asset=1 THEN e.amount ELSE 0 END),0) AS total_assets, "
                "COALESCE(SUM(CASE WHEN e.is_income=0 THEN e.amount ELSE 0 END),0) AS total_deducted "
                "FROM expenses e JOIN categories c ON c.id = e.category_id "
                "WHERE c.name NOT IN ('Internal Transfer','Savings Deposit','Cash Withdrawal') AND COALESCE(e.payment_method,'bank')='bank' AND strftime('%Y-%m',e.transaction_date)=?", (month,)
            ).fetchone()
        else:
            rows = db.execute(
                "SELECT e.id, e.item_name, e.amount, e.category_id, "
                "c.name AS category_name, e.transaction_date, e.notes, e.is_asset, COALESCE(e.payment_method,'bank') AS payment_method "
                "FROM expenses e JOIN categories c ON c.id = e.category_id "
                "ORDER BY e.id DESC"
            ).fetchall()
            s = db.execute(
                "SELECT COALESCE(SUM(CASE WHEN e.is_asset=0 AND e.is_income=0 THEN e.amount ELSE 0 END),0) AS total_expenses, "
                "COALESCE(SUM(CASE WHEN e.is_asset=1 THEN e.amount ELSE 0 END),0) AS total_assets, "
                "COALESCE(SUM(CASE WHEN e.is_income=0 THEN e.amount ELSE 0 END),0) AS total_deducted "
                "FROM expenses e JOIN categories c ON c.id = e.category_id "
                "WHERE c.name NOT IN ('Internal Transfer','Savings Deposit','Cash Withdrawal') AND COALESCE(e.payment_method,'bank')='bank'"
            ).fetchone()
        cats = db.execute("SELECT * FROM categories ORDER BY name").fetchall()
        months_rows = db.execute(
            "SELECT DISTINCT strftime('%Y-%m', transaction_date) AS month "
            "FROM expenses ORDER BY month DESC"
        ).fetchall()
        db.close()
        bd = {}
        for r in rows:
            cat = r['category_name'] or 'Uncategorized'
            if cat not in bd:
                bd[cat] = {'name': cat, 'total': 0, 'is_asset': False}
            bd[cat]['total'] += r['amount']
            if r['is_asset']:
                bd[cat]['is_asset'] = True
        grand = s['total_deducted'] or 1
        breakdown = []
        for v in bd.values():
            v['percentage'] = round((v['total'] / grand) * 100, 1)
            breakdown.append(v)
        transactions = [{
            'id': r['id'], 'item_name': r['item_name'],
            'amount': r['amount'], 'category_id': r['category_id'],
            'category_name': r['category_name'],
            'transaction_date': r['transaction_date'],
            'notes': r['notes'] or '', 'is_asset': r['is_asset'],
            'payment_method': r['payment_method']
        } for r in rows]
        wallet_db = get_db()
        w_row = wallet_db.execute("SELECT monthly_spent FROM wallet WHERE id=1").fetchone()
        ms_from_wallet = float(w_row['monthly_spent']) if w_row and w_row['monthly_spent'] else 0
        wallet_db.close()
        return jsonify({
            'summary': {
                'total_expenses': ms_from_wallet,
                'total_assets': s['total_assets'],
                'total_deducted': s['total_deducted']
            },
            'transactions': transactions,
            'categories': [{'id': c['id'], 'name': c['name']} for c in cats],
            'breakdown': breakdown,
            'months': [r['month'] for r in months_rows],
            'month': month or 'All'
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/cash/withdraw', methods=['POST'])
def api_cash_withdraw():
    try:
        data = request.get_json(silent=True) or {}
        amount = float(data.get('amount', 0))
        item_name = (data.get('item_name') or 'Cash Withdrawal').strip()
        transaction_date = (data.get('transaction_date') or '').strip()
        if amount <= 0 or not transaction_date:
            return jsonify({'error': 'Invalid amount or date'}), 400
        db = get_db()
        cr = db.execute("SELECT id FROM categories WHERE name='Cash Withdrawal'").fetchone()
        if not cr:
            db.execute("INSERT INTO categories (name) VALUES ('Cash Withdrawal')")
            db.commit()
            cr = db.execute("SELECT id FROM categories WHERE name='Cash Withdrawal'").fetchone()
        cat_id = cr['id']
        cur = db.execute(
            "INSERT INTO expenses (item_name, amount, category_id, transaction_date, notes, is_asset, is_income) VALUES (?,?,?,?,?,?,?)",
            (item_name, amount, cat_id, transaction_date, 'Cash withdrawal', 0, 0)
        )
        expense_id = cur.lastrowid
        db.commit()
        db.close()
        wallet_add_personal(-amount)
        w = wallet_op()
        gav = w.get('gold_assets_value', 0)
        return jsonify({
            'success': True, 'id': expense_id,
            'wallet': {
                'personal_balance': w['personal_balance'],
                'savings_balance': w.get('savings_balance', 0),
                'students_balance': w['students_balance'],
                'grand_total': w['personal_balance'] + w['students_balance'],
                'gold_assets_value': gav,
                'total_combined_master_funds': float(w['personal_balance'] or 0) + float(w.get('savings_balance', 0) or 0) + float(gav or 0)
            }
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/expenses/add', methods=['POST'])
def api_add_expense():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({'error': 'No data'}), 400
        item_name = (data.get('item_name') or '').strip()
        amount = float(data.get('amount', 0))
        category_id = int(data.get('category_id', 0))
        transaction_date = (data.get('transaction_date') or '').strip()
        notes = (data.get('notes') or '').strip()
        is_asset = bool(data.get('is_asset', False))
        custom_category = (data.get('custom_category') or '').strip()
        payment_method = (data.get('payment_method') or 'bank').strip().lower()
        if not item_name or amount <= 0 or not transaction_date:
            return jsonify({'error': 'Invalid input'}), 400
        is_income = 1 if custom_category.lower() == 'proxy purchase' else 0
        db = get_db()
        cr = db.execute("SELECT id, name FROM categories WHERE id=?", (category_id,)).fetchone()
        if not cr and category_id == 0:
            cr = db.execute("SELECT id, name FROM categories WHERE name='Cash Withdrawal'").fetchone()
            if not cr:
                db.execute("INSERT INTO categories (name) VALUES ('Cash Withdrawal')")
                db.commit()
                cr = db.execute("SELECT id, name FROM categories WHERE name='Cash Withdrawal'").fetchone()
            if cr:
                category_id = cr['id']
        cur = db.execute(
            "INSERT INTO expenses (item_name, amount, category_id, transaction_date, notes, is_asset, is_income, payment_method) VALUES (?,?,?,?,?,?,?,?)",
            (item_name, amount, category_id, transaction_date, notes, 1 if is_asset else 0, is_income, payment_method)
        )
        cat_name = "unknown"
        if cr:
            cat_name = (cr['name'] or '').strip().lower()
        db.commit()
        db.close()
        is_cash = payment_method == 'cash'
        if is_income:
            wallet_add_personal(amount)
        elif not is_cash:
            wallet_add_personal(-amount)
        if not is_income and not is_cash and cat_name not in ('internal transfer', 'savings deposit', 'cash withdrawal'):
            wallet_add_monthly_spent(amount)
        w = wallet_op()
        gav = w.get('gold_assets_value', 0)
        month = transaction_date[:7]
        db2 = get_db()
        s = db2.execute(
            "SELECT COALESCE(SUM(CASE WHEN e.is_asset=1 THEN e.amount ELSE 0 END),0) AS total_assets, "
            "COALESCE(SUM(CASE WHEN e.is_income=0 THEN e.amount ELSE 0 END),0) AS total_deducted "
            "FROM expenses e JOIN categories c ON c.id = e.category_id "
            "WHERE c.name NOT IN ('Internal Transfer','Savings Deposit','Cash Withdrawal') AND COALESCE(e.payment_method,'bank')='bank' AND strftime('%Y-%m',e.transaction_date)=?", (month,)
        ).fetchone()
        wr = db2.execute("SELECT monthly_spent FROM wallet WHERE id=1").fetchone()
        ms_val = float(wr['monthly_spent']) if wr and wr['monthly_spent'] else 0
        db2.close()
        return jsonify({'success': True, 'id': cur.lastrowid, 'wallet': {
            'personal_balance': w['personal_balance'],
            'students_balance': w['students_balance'],
            'grand_total': w['personal_balance'] + w['students_balance'],
            'gold_assets_value': gav,
            'savings_balance': w.get('savings_balance', 0),
            'total_combined_master_funds': float(w['personal_balance'] or 0) + float(w.get('savings_balance', 0) or 0) + float(gav or 0)
        }, 'summary': {
            'total_expenses': ms_val,
            'total_assets': s['total_assets'],
            'total_deducted': s['total_deducted']
        }})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/expenses/<int:expense_id>/edit', methods=['PUT'])
def api_edit_expense(expense_id):
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({'error': 'No data'}), 400
        item_name = (data.get('item_name') or '').strip()
        amount = float(data.get('amount', 0))
        category_id = int(data.get('category_id', 0))
        transaction_date = (data.get('transaction_date') or '').strip()
        notes = (data.get('notes') or '').strip()
        is_asset = bool(data.get('is_asset', False))
        payment_method = (data.get('payment_method') or 'bank').strip().lower()
        if not item_name or amount <= 0 or not transaction_date:
            return jsonify({'error': 'Invalid input'}), 400
        db = get_db()
        old_row = db.execute("SELECT e.amount, e.is_income, c.name AS cat_name, COALESCE(e.payment_method,'bank') AS payment_method FROM expenses e JOIN categories c ON c.id = e.category_id WHERE e.id=?", (expense_id,)).fetchone()
        if not old_row:
            db.close()
            return jsonify({'error': 'Not found'}), 404
        old_amount = old_row['amount']
        old_is_income = old_row['is_income']
        old_cat = (old_row['cat_name'] or '').strip().lower()
        old_pm = (old_row['payment_method'] or 'bank').strip().lower()
        old_was_standard = not old_is_income and old_pm != 'cash' and old_cat not in ('internal transfer', 'savings deposit', 'cash withdrawal')
        custom_category = (data.get('custom_category') or '').strip()
        new_is_income = 1 if custom_category.lower() == 'proxy purchase' else 0
        new_cat_row = db.execute("SELECT name FROM categories WHERE id=?", (category_id,)).fetchone()
        new_cat = (new_cat_row['name'] or '').strip().lower() if new_cat_row else ''
        new_is_standard = not new_is_income and payment_method != 'cash' and new_cat not in ('internal transfer', 'savings deposit', 'cash withdrawal')
        db.execute(
            "UPDATE expenses SET item_name=?, amount=?, category_id=?, transaction_date=?, notes=?, is_asset=?, is_income=?, payment_method=? WHERE id=?",
            (item_name, amount, category_id, transaction_date, notes, 1 if is_asset else 0, new_is_income, payment_method, expense_id)
        )
        db.commit()
        db.close()
        old_balance_impact = 0 if old_pm == 'cash' else (old_amount if old_is_income else -old_amount)
        new_balance_impact = 0 if payment_method == 'cash' else (amount if new_is_income else -amount)
        wallet_add_personal(old_balance_impact - new_balance_impact)
        monthly_spent_delta = 0.0
        if old_was_standard:
            monthly_spent_delta -= old_amount
        if new_is_standard:
            monthly_spent_delta += amount
        if monthly_spent_delta != 0:
            wallet_add_monthly_spent(monthly_spent_delta)
        w = wallet_op()
        gav = w.get('gold_assets_value', 0)
        month = transaction_date[:7]
        db2 = get_db()
        s = db2.execute(
            "SELECT COALESCE(SUM(CASE WHEN e.is_asset=1 THEN e.amount ELSE 0 END),0) AS total_assets, "
            "COALESCE(SUM(CASE WHEN e.is_income=0 THEN e.amount ELSE 0 END),0) AS total_deducted "
            "FROM expenses e JOIN categories c ON c.id = e.category_id "
            "WHERE c.name NOT IN ('Internal Transfer','Savings Deposit','Cash Withdrawal') AND COALESCE(e.payment_method,'bank')='bank' AND strftime('%Y-%m',e.transaction_date)=?", (month,)
        ).fetchone()
        wr = db2.execute("SELECT monthly_spent FROM wallet WHERE id=1").fetchone()
        ms_val = float(wr['monthly_spent']) if wr and wr['monthly_spent'] else 0
        db2.close()
        return jsonify({'success': True, 'wallet': {
            'personal_balance': w['personal_balance'],
            'students_balance': w['students_balance'],
            'grand_total': w['personal_balance'] + w['students_balance'],
            'gold_assets_value': gav,
            'savings_balance': w.get('savings_balance', 0),
            'total_combined_master_funds': float(w['personal_balance'] or 0) + float(w.get('savings_balance', 0) or 0) + float(gav or 0)
        }, 'summary': {
            'total_expenses': ms_val,
            'total_assets': s['total_assets'],
            'total_deducted': s['total_deducted']
        }})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/tutoring/data')
def api_tutoring_data():
    try:
        month = request.args.get('month')
        db = get_db()
        students = db.execute("SELECT id, name, subject, phone_number, notes, is_archived FROM students ORDER BY name").fetchall()
        students_list = [dict(r) for r in students]
        active_students = [s for s in students_list if not s['is_archived']]
        if month:
            sessions = db.execute(
                "SELECT ts.*, s.name AS student_name, s.phone_number AS student_phone "
                "FROM tutoring_sessions ts JOIN students s ON s.id=ts.student_id "
                "WHERE ts.session_date LIKE ? ORDER BY ts.session_date DESC",
                (month + '%',)
            ).fetchall()
        else:
            sessions = db.execute(
                "SELECT ts.*, s.name AS student_name, s.phone_number AS student_phone "
                "FROM tutoring_sessions ts JOIN students s ON s.id=ts.student_id "
                "ORDER BY ts.session_date DESC"
            ).fetchall()
        student_totals = {}
        for r in sessions:
            sid = r['student_id']
            if sid not in student_totals:
                student_totals[sid] = {'total_hours': 0, 'total_due': 0.0, 'total_paid': 0.0}
            student_totals[sid]['total_hours'] += float(r['hours'] or 0) + float(r['minutes'] or 0) / 60
            student_totals[sid]['total_due'] += float(r['amount_due'] or 0)
            student_totals[sid]['total_paid'] += float(r['amount_paid'] or 0)
        student_map = {s['id']: s for s in students_list}
        reports = []
        for sid, totals in student_totals.items():
            s = student_map.get(sid)
            if not s: continue
            remaining = round(totals['total_due'] - totals['total_paid'], 2)
            total_sessions = sum(1 for r in sessions if r['student_id'] == sid)
            if remaining <= 0: health = 'healthy'
            elif total_sessions <= 2: health = 'churn_risk'
            else: health = 'payment_risk'
            reports.append({
                'id': sid, 'name': s['name'], 'phone_number': s.get('phone_number') or '',
                'subject': s.get('subject') or '', 'total_hours': round(totals['total_hours'], 1),
                'total_due': totals['total_due'], 'total_paid': totals['total_paid'],
                'total_remaining': remaining, 'health': health
            })
        reports.sort(key=lambda x: x['name'].lower())
        if month:
            monthly_paid = sum(float(r['amount_paid'] or 0) for r in sessions)
            monthly_unpaid = sum(float(r['amount_due'] or 0) - float(r['amount_paid'] or 0) for r in sessions)
        else:
            monthly_paid = sum(s['total_paid'] for s in reports)
            monthly_unpaid = sum(s['total_remaining'] for s in reports)
        monthly_revenue = db.execute(
            "SELECT substr(session_date, 1, 7) AS month, SUM(amount_due) AS total "
            "FROM tutoring_sessions WHERE session_date >= date('now', '-12 months') "
            "GROUP BY month ORDER BY month"
        ).fetchall()
        sessions_by_subject = db.execute(
            "SELECT COALESCE(NULLIF(subject,''), 'General') AS subject, COUNT(*) AS sessions "
            "FROM tutoring_sessions GROUP BY subject ORDER BY sessions DESC"
        ).fetchall()
        db.close()
        return jsonify({
            'students': active_students,
            'sessions': [{
                'id': r['id'], 'student_id': r['student_id'], 'student_name': r['student_name'],
                'student_phone': r['student_phone'] or '', 'subject': r['subject'],
                'hourly_rate': r['hourly_rate'], 'hours': r['hours'], 'minutes': r['minutes'],
                'amount_due': r['amount_due'], 'amount_paid': r['amount_paid'],
                'session_date': r['session_date'], 'notes': r['notes'] or ''
            } for r in sessions],
            'reports': reports,
            'monthly_paid': monthly_paid,
            'monthly_unpaid': monthly_unpaid,
            'monthly_revenue': [{'month': r['month'], 'revenue': r['total']} for r in monthly_revenue],
            'sessions_by_subject': [{'subject': r['subject'], 'sessions': r['sessions']} for r in sessions_by_subject]
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/tutoring/sessions/<int:session_id>/edit', methods=['POST'])
def api_edit_session(session_id):
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({'error': 'No data'}), 400
        student_id = int(data.get('student_id', 0))
        if student_id <= 0:
            return jsonify({'error': 'Invalid student'}), 400
        hourly_rate = float(data.get('hourly_rate', 0))
        if hourly_rate <= 0:
            return jsonify({'error': 'Invalid rate'}), 400
        hours = int(data.get('hours', 0))
        minutes = int(data.get('minutes', 0))
        if hours < 0 or minutes < 0 or minutes > 59:
            return jsonify({'error': 'Invalid time'}), 400
        session_date = (data.get('session_date') or '').strip()
        amount_paid = float(data.get('amount_paid', 0) or 0)
        if amount_paid < 0:
            return jsonify({'error': 'Invalid amount paid'}), 400
        notes = (data.get('notes') or '').strip()
        subject = (data.get('subject') or '').strip()[:200]

        amount_due = round(hourly_rate * (hours + minutes / 60), 2)
        amount_paid = min(amount_paid, amount_due)

        db = get_db()
        student_name = (data.get('student_name') or '').strip()[:200]
        if student_name:
            db.execute("UPDATE students SET name=? WHERE id=?", (student_name, student_id))
        student_phone = (data.get('student_phone') or '').strip()[:20] or None
        db.execute("UPDATE students SET phone_number=? WHERE id=?", (student_phone, student_id))
        old = db.execute("SELECT amount_paid, amount_due FROM tutoring_sessions WHERE id=?", (session_id,)).fetchone()
        if not old:
            db.close()
            return jsonify({'error': 'Not found'}), 404
        old_amount_paid = old['amount_paid']
        old_amount_due = old['amount_due']

        db.execute(
            "UPDATE tutoring_sessions SET student_id=?,hourly_rate=?,hours=?,minutes=?,amount_due=?,amount_paid=?,session_date=?,subject=?,notes=? WHERE id=?",
            (student_id, hourly_rate, hours, minutes, amount_due, amount_paid, session_date, subject or None, notes, session_id)
        )
        db.commit()

        old_remaining = old_amount_due - old_amount_paid
        new_remaining = amount_due - amount_paid
        wallet_add_savings(amount_paid - old_amount_paid)
        wallet_add_students(new_remaining - old_remaining)

        row = db.execute(
            "SELECT ts.*, s.name AS student_name, s.phone_number AS student_phone "
            "FROM tutoring_sessions ts JOIN students s ON s.id=ts.student_id WHERE ts.id=?",
            (session_id,)
        ).fetchone()
        db.close()

        w = wallet_op()
        return jsonify({'success': True, 'session': {
            'id': row['id'],
            'student_id': row['student_id'],
            'student_name': row['student_name'],
            'student_phone': row['student_phone'] or '',
            'subject': row['subject'],
            'hourly_rate': row['hourly_rate'],
            'hours': row['hours'],
            'minutes': row['minutes'],
            'amount_due': row['amount_due'],
            'amount_paid': row['amount_paid'],
            'session_date': row['session_date'],
            'notes': row['notes'] or ''
        }, 'wallet': {
            'personal_balance': w['personal_balance'],
            'students_balance': w['students_balance'],
            'savings_balance': w['savings_balance'],
            'grand_total': w['personal_balance'] + w['students_balance'],
            'gold_assets_value': w.get('gold_assets_value', 0),
            'total_combined_master_funds': float(w['personal_balance'] or 0) + float(w['savings_balance'] or 0) + float(w.get('gold_assets_value', 0) or 0)
        }})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/tutoring/students/<int:student_id>/delete', methods=['POST'])
def api_delete_student(student_id):
    try:
        db = get_db()
        paid = db.execute(
            "SELECT COALESCE(SUM(amount_paid),0) AS total FROM tutoring_sessions WHERE student_id=?",
            (student_id,)
        ).fetchone()['total']
        remaining = db.execute(
            "SELECT COALESCE(SUM(amount_due - amount_paid),0) AS total FROM tutoring_sessions WHERE student_id=?",
            (student_id,)
        ).fetchone()['total']
        db.execute("DELETE FROM tutoring_sessions WHERE student_id=?", (student_id,))
        db.execute("DELETE FROM students WHERE id=?", (student_id,))
        empty_students = db.execute("SELECT COUNT(*) AS cnt FROM students").fetchone()['cnt']
        if empty_students == 0:
            db.execute("DELETE FROM sqlite_sequence WHERE name='students'")
        empty_sessions = db.execute("SELECT COUNT(*) AS cnt FROM tutoring_sessions").fetchone()['cnt']
        if empty_sessions == 0:
            db.execute("DELETE FROM sqlite_sequence WHERE name='tutoring_sessions'")
        if paid > 0:
            db.execute("UPDATE wallet SET savings_balance = savings_balance - ? WHERE id=1", (paid,))
        if remaining > 0:
            db.execute("UPDATE wallet SET students_balance = students_balance - ? WHERE id=1", (remaining,))
        db.commit()
        total_unpaid = db.execute(
            "SELECT COALESCE(SUM(amount_due - amount_paid),0) AS total FROM tutoring_sessions"
        ).fetchone()['total']
        db.close()
        w = wallet_op()
        gav = w.get('gold_assets_value', 0)
        return jsonify({'success': True, 'wallet': {
            'personal_balance': w['personal_balance'],
            'students_balance': w['students_balance'],
            'savings_balance': w['savings_balance'],
            'grand_total': w['personal_balance'] + w['students_balance'],
            'gold_assets_value': gav,
            'total_combined_master_funds': float(w['personal_balance'] or 0) + float(w['savings_balance'] or 0) + float(gav or 0)
        }, 'total_unpaid': total_unpaid})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ─── Archive / Unarchive API ───

@app.route('/api/students/<int:student_id>/archive', methods=['POST'])
def api_archive_student(student_id):
    try:
        data = request.get_json(silent=True) or {}
        archived = 1 if data.get('archive', True) else 0
        db = get_db()
        db.execute("UPDATE students SET is_archived=? WHERE id=?", (archived, student_id))
        db.commit()
        db.close()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/autopilot/logs', methods=['GET'])
def api_autopilot_logs():
    try:
        db = get_db()
        rows = db.execute(
            "SELECT * FROM autopilot_logs ORDER BY timestamp DESC LIMIT 50"
        ).fetchall()
        db.close()
        return jsonify([dict(r) for r in rows])
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/autopilot/reconcile', methods=['POST'])
def api_autopilot_reconcile():
    try:
        data = request.get_json(silent=True) or {}
        expense_id = data.get('expense_id')
        if not expense_id:
            return jsonify({'error': 'expense_id required'}), 400
        db = get_db()
        expense = db.execute("SELECT id, amount, item_name FROM expenses WHERE id=?", (expense_id,)).fetchone()
        if not expense:
            db.close()
            return jsonify({'error': 'Expense not found'}), 404
        scenario_b_expense_reconcile(db, expense['id'], expense['amount'], expense['item_name'])
        db.close()
        return jsonify({
            'status': 'success',
            'automation_executed': True,
            'workflow': 'EXPENSE_AUTO_RECONCILE',
            'details': {}
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ─── Edit Student API ───

@app.route('/api/students/<int:student_id>/edit', methods=['POST'])
def api_edit_student(student_id):
    try:
        data = request.get_json(silent=True) or {}
        name = (data.get('name') or '').strip()[:200]
        if not name:
            return jsonify({'error': 'Name required'}), 400
        subject = (data.get('subject') or '').strip()[:200]
        phone_number = (data.get('phone_number') or '').strip()[:20] or None
        notes = (data.get('notes') or '').strip()[:500] or None
        db = get_db()
        db.execute(
            "UPDATE students SET name=?, subject=?, phone_number=?, notes=? WHERE id=?",
            (name, subject, phone_number, notes, student_id)
        )
        db.commit()
        db.close()
        return jsonify({'success': True, 'name': name, 'subject': subject, 'phone_number': phone_number or ''})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/students/<int:student_id>/data')
def api_student_data(student_id):
    db = get_db()
    student = db.execute("SELECT * FROM students WHERE id=?", (student_id,)).fetchone()
    db.close()
    if not student:
        return jsonify({'error': 'Not found'}), 404
    return jsonify({
        'id': student['id'],
        'name': student['name'],
        'subject': student['subject'] or '',
        'phone_number': student['phone_number'] or '',
        'notes': student['notes'] or ''
    })


# ─── Student Sessions API (for detailed PDF) ───

@app.route('/api/students/<int:student_id>/sessions')
def api_student_sessions(student_id):
    db = get_db()
    student = db.execute("SELECT * FROM students WHERE id=?", (student_id,)).fetchone()
    if not student:
        db.close()
        return jsonify({'error': 'Not found'}), 404
    sessions = db.execute(
        "SELECT * FROM tutoring_sessions WHERE student_id=? ORDER BY session_date DESC",
        (student_id,)
    ).fetchall()
    db.close()
    return jsonify({
        'student': {'id': student['id'], 'name': student['name'], 'subject': student['subject']},
        'sessions': [{
            'id': r['id'],
            'session_date': r['session_date'],
            'subject': r['subject'] or '',
            'hours': r['hours'],
            'minutes': r['minutes'],
            'amount_due': r['amount_due'],
            'amount_paid': r['amount_paid']
        } for r in sessions]
    })


@app.route('/tutoring/add-student', methods=['POST'])
def add_student():
    name = (request.form.get('name') or '').strip()[:200]
    if not name:
        return jsonify({'error': 'Name required'}), 400
    subject = (request.form.get('subject') or '').strip()[:200]
    phone_number = (request.form.get('phone_number') or '').strip()[:20] or None
    notes = (request.form.get('notes') or '').strip()[:MAX_STRING_LEN]

    db = get_db()
    cur = db.execute("INSERT INTO students (name,subject,phone_number,notes) VALUES (?,?,?,?)",
                     (name, subject, phone_number, notes))
    db.commit()
    sid = cur.lastrowid
    db.close()
    return jsonify({'id': sid, 'name': name, 'subject': subject, 'phone_number': phone_number or ''})

@app.route('/tutoring/add', methods=['POST'])
def add_session():
    student_id = request.form.get('student_id', type=int)
    if not student_id:
        return jsonify({'error': 'Student ID required'}), 400
    hourly_rate = request.form.get('hourly_rate', type=float) or 0
    hours = request.form.get('hours', type=float) or 0
    minutes = request.form.get('minutes', type=float) or 0
    session_date = (request.form.get('session_date') or '').strip()
    amount_paid = request.form.get('amount_paid', type=float) or 0
    notes = (request.form.get('notes') or '').strip()[:MAX_STRING_LEN]
    subject = (request.form.get('subject') or '').strip()[:200]
    amount_due = round(hourly_rate * (hours + minutes / 60), 2)

    db = get_db()
    cur = db.execute(
        "INSERT INTO tutoring_sessions (student_id, hourly_rate, hours, minutes, amount_due, amount_paid, session_date, subject, notes) VALUES (?,?,?,?,?,?,?,?,?)",
        (student_id, hourly_rate, hours, minutes, amount_due, min(amount_paid, amount_due), session_date, subject or None, notes)
    )
    db.commit()
    session_id = cur.lastrowid
    db.close()

    return jsonify({'success': True, 'session_id': session_id})


# ─── Dashboard Stats API (single source of truth) ───

@app.route('/api/dashboard-stats')
def api_dashboard_stats():
    db = get_db()
    total_unpaid = db.execute(
        "SELECT COALESCE(SUM(amount_due - amount_paid),0) AS total FROM tutoring_sessions"
    ).fetchone()['total']

    monthly = db.execute(
        "SELECT strftime('%Y-%m', session_date) AS month, "
        "COALESCE(SUM(amount_paid),0) AS revenue "
        "FROM tutoring_sessions GROUP BY month ORDER BY month ASC"
    ).fetchall()

    by_subject = db.execute(
        "SELECT COALESCE(subject, 'N/A') AS subject, "
        "COUNT(*) AS sessions "
        "FROM tutoring_sessions GROUP BY subject ORDER BY sessions DESC"
    ).fetchall()

    db.close()
    return jsonify({
        'total_unpaid': total_unpaid,
        'monthly_revenue': [{'month': r['month'], 'revenue': r['revenue']} for r in monthly],
        'sessions_by_subject': [{'subject': r['subject'], 'sessions': r['sessions']} for r in by_subject]
    })


# ─── Analytics API ───

@app.route('/api/analytics')
def api_analytics():
    db = get_db()
    monthly = db.execute(
        "SELECT strftime('%Y-%m', session_date) AS month, "
        "COALESCE(SUM(amount_paid),0) AS revenue "
        "FROM tutoring_sessions "
        "GROUP BY month ORDER BY month ASC"
    ).fetchall()

    by_subject = db.execute(
        "SELECT COALESCE(subject, 'N/A') AS subject, "
        "COUNT(*) AS sessions, "
        "COALESCE(SUM(amount_paid),0) AS revenue "
        "FROM tutoring_sessions "
        "GROUP BY subject ORDER BY revenue DESC"
    ).fetchall()

    students_data = db.execute(
        "SELECT s.id, s.name, "
        "COALESCE(SUM(ts.amount_paid),0) AS total_paid, "
        "COALESCE(SUM(ts.amount_due - ts.amount_paid),0) AS total_remaining "
        "FROM students s LEFT JOIN tutoring_sessions ts ON ts.student_id=s.id "
        "GROUP BY s.id HAVING (total_paid + total_remaining) > 0 "
        "ORDER BY total_remaining DESC"
    ).fetchall()
    db.close()

    return jsonify({
        'monthly_revenue': [{
            'month': r['month'],
            'revenue': r['revenue']
        } for r in monthly],
        'by_subject': [{
            'subject': r['subject'],
            'sessions': r['sessions'],
            'revenue': r['revenue']
        } for r in by_subject],
        'students': [{
            'id': r['id'],
            'name': r['name'],
            'total_paid': r['total_paid'],
            'total_remaining': r['total_remaining']
        } for r in students_data]
    })

# ─── Export API ───

@app.route('/api/export/tutoring')
def api_export_tutoring():
    db = get_db()
    rows = db.execute(
        "SELECT ts.id, s.name AS student_name, ts.subject, ts.hourly_rate, "
        "ts.hours, ts.minutes, ts.amount_due, ts.amount_paid, ts.session_date, ts.notes "
        "FROM tutoring_sessions ts JOIN students s ON s.id=ts.student_id "
        "ORDER BY ts.session_date DESC, ts.created_at DESC"
    ).fetchall()
    db.close()
    data = []
    for r in rows:
        remaining = r['amount_due'] - r['amount_paid']
        data.append({
            'ID': r['id'],
            'Student': r['student_name'],
            'Subject': r['subject'] or '',
            'Rate (AED/hr)': r['hourly_rate'],
            'Hours': r['hours'],
            'Minutes': r['minutes'],
            'Amount Due': r['amount_due'],
            'Amount Paid': r['amount_paid'],
            'Remaining': round(remaining, 2),
            'Status': 'Paid' if remaining <= 0 else 'Partial' if r['amount_paid'] > 0 else 'Unpaid',
            'Date': r['session_date'],
            'Notes': r['notes'] or ''
        })
    return jsonify(data)


@app.route('/api/export/expenses')
def api_export_expenses():
    month = request.args.get('month', 'All')
    db = get_db()
    where_clause = "" if month == 'All' else " WHERE strftime('%Y-%m',e.transaction_date)=?"
    params = () if month == 'All' else (month,)
    rows = db.execute(
        "SELECT e.id, e.item_name, e.amount, c.name AS category_name, "
        "e.transaction_date, e.is_asset, e.notes "
        "FROM expenses e JOIN categories c ON c.id=e.category_id"
        + where_clause +
        " ORDER BY e.transaction_date DESC, e.created_at DESC",
        params
    ).fetchall()
    db.close()
    data = []
    for r in rows:
        data.append({
            'ID': r['id'],
            'Item': r['item_name'],
            'Amount (AED)': r['amount'],
            'Category': r['category_name'],
            'Date': r['transaction_date'],
            'Type': 'Asset' if r['is_asset'] else 'Expense',
            'Notes': r['notes'] or ''
        })
    return jsonify(data)


@app.route('/api/reminders', methods=['GET', 'POST'])
def api_reminders():
    if request.method == 'GET':
        db = get_db()
        rows = db.execute("SELECT * FROM reminders WHERE is_active=1 ORDER BY day_of_month").fetchall()
        db.close()
        return jsonify([dict(r) for r in rows])

    data = request.get_json()
    if not data or not data.get('title') or not data.get('dayOfMonth') or not data.get('amount'):
        return jsonify({'error': 'Title, day of month, and amount are required.'}), 400

    db = get_db()
    cursor = db.execute(
        "INSERT INTO reminders (title, day_of_month, time, amount, recurrence, category) VALUES (?, ?, ?, ?, ?, ?)",
        (data['title'], int(data['dayOfMonth']), data.get('time', '09:00'), float(data['amount']), data.get('recurrence', 'Monthly'), data.get('category', 'Bills'))
    )
    db.commit()
    reminder_id = cursor.lastrowid
    row = db.execute("SELECT * FROM reminders WHERE id=?", (reminder_id,)).fetchone()
    db.close()
    return jsonify({'success': True, 'reminder': dict(row)})


@app.route('/api/reminders/upcoming', methods=['GET'])
def api_reminders_upcoming():
    db = get_db()
    rows = db.execute("""
        SELECT r.id, r.title, r.amount, r.day_of_month, r.category,
               DATE(strftime('%Y-%m', 'now', 'localtime') || '-' || printf('%02d', r.day_of_month)) AS computed_due_date,
               CAST(ROUND(julianday(DATE(strftime('%Y-%m', 'now', 'localtime') || '-' || printf('%02d', r.day_of_month))) - julianday(DATE('now', 'localtime'))) AS INTEGER) AS days_remaining
        FROM reminders r
        WHERE r.is_active = 1
          AND (r.completed_month IS NULL OR r.completed_month != strftime('%Y-%m', 'now', 'localtime'))
        ORDER BY computed_due_date ASC
    """).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/commitments/<int:id>/complete', methods=['POST'])
def api_commitment_complete(id):
    try:
        db = get_db()
        row = db.execute("SELECT id FROM reminders WHERE id=? AND is_active=1", (id,)).fetchone()
        if not row:
            db.close()
            return jsonify({'error': 'Commitment not found'}), 404
        db.execute(
            "UPDATE reminders SET completed_month = strftime('%Y-%m', 'now', 'localtime') WHERE id=?",
            (id,)
        )
        db.commit()
        db.close()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/reminders/<int:reminder_id>/edit', methods=['POST'])
def api_edit_reminder(reminder_id):
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided.'}), 400
    db = get_db()
    db.execute(
        "UPDATE reminders SET title=?, day_of_month=?, time=?, amount=?, recurrence=?, category=? WHERE id=?",
        (data['title'], int(data['dayOfMonth']), data.get('time', '09:00'), float(data['amount']), data.get('recurrence', 'Monthly'), data.get('category', 'Bills'), reminder_id)
    )
    db.commit()
    row = db.execute("SELECT * FROM reminders WHERE id=?", (reminder_id,)).fetchone()
    db.close()
    return jsonify({'success': True, 'reminder': dict(row)})


@app.route('/api/reminders/<int:reminder_id>/delete', methods=['POST'])
def api_delete_reminder(reminder_id):
    db = get_db()
    db.execute("DELETE FROM reminders WHERE id=?", (reminder_id,))
    db.commit()
    db.close()
    return jsonify({'success': True})


# ─── AI Chatbot ───

@app.route('/api/chat', methods=['POST'])
def db_integrated_chat():
    try:
        user_data = request.json
        user_message = str(user_data.get('message', '')).strip()

        if not user_message:
            return jsonify({'reply': 'Please send a message.'}), 400

        db = get_db()

        w = wallet_op()
        live_salary = float(w['personal_balance'] or 0)
        live_gold_assets = float(w['gold_assets_value'] or 0)
        live_student_income = float(w['students_balance'] or 0)
        live_savings = float(w['savings_balance'] or 0)
        live_combined_funds = live_salary + live_gold_assets + live_student_income + live_savings

        current_month_str = date.today().strftime('%Y-%m')
        exp_total_row = db.execute("SELECT COALESCE(SUM(amount),0) AS t FROM expenses WHERE is_asset=0 AND COALESCE(payment_method,'bank')='bank'").fetchone()
        live_expenses_total = exp_total_row['t'] if exp_total_row else 0

        cat_rows = db.execute(
            "SELECT c.name, SUM(e.amount) AS total FROM expenses e JOIN categories c ON c.id=e.category_id "
            "WHERE e.is_asset=0 AND COALESCE(e.payment_method,'bank')='bank' GROUP BY c.id ORDER BY total DESC"
        ).fetchall()
        expense_cat_lines = [f"{r['name']}: AED {r['total']:,.2f}" for r in cat_rows]
        expense_breakdown_string = "; ".join(expense_cat_lines) if expense_cat_lines else "No expense data"

        student_balances_rows = db.execute("""
            SELECT s.id, s.name, s.subject, s.phone_number,
                   COUNT(ts.id) AS session_count,
                   COALESCE(SUM(ts.amount_due), 0) AS total_due,
                   COALESCE(SUM(ts.amount_paid), 0) AS total_paid,
                   COALESCE(SUM(ts.amount_due - ts.amount_paid), 0) AS unpaid
            FROM students s
            LEFT JOIN tutoring_sessions ts ON ts.student_id = s.id
            WHERE s.is_archived = 0
            GROUP BY s.id, s.name
            ORDER BY unpaid DESC
        """).fetchall()

        student_ledger_lines = []
        for r in student_balances_rows:
            subject_str = r['subject'] if r['subject'] else 'No subject'
            phone_str = r['phone_number'] if r['phone_number'] else 'No phone'
            if r['session_count'] > 0:
                if r['unpaid'] > 0:
                    student_ledger_lines.append(
                        f"Student: {r['name']}, Subject: {subject_str}, Phone: {phone_str}, Sessions: {r['session_count']}, "
                        f"Total Due: AED {r['total_due']:,.2f}, Paid: AED {r['total_paid']:,.2f}, Unpaid: AED {r['unpaid']:,.2f}"
                    )
                else:
                    student_ledger_lines.append(
                        f"Student: {r['name']}, Subject: {subject_str}, Phone: {phone_str}, Sessions: {r['session_count']}, "
                        f"Fully Paid (total paid: AED {r['total_paid']:,.2f})"
                    )
            else:
                student_ledger_lines.append(
                    f"Student: {r['name']}, Subject: {subject_str}, Phone: {phone_str}, No sessions recorded yet"
                )

        students_ledger_string = "\n".join(student_ledger_lines) if student_ledger_lines else "No active students found"

        db.close()

        system_instruction = f"""
        You are Yazan's Finance Assistant with live database access.

        LANGUAGE RULE - STRICT MIRRORING:
        - Detect the language of the user's question. Reply in EXACTLY the same language.
        - English question → 100% pure English answer. No Arabic words.
        - Arabic question → 100% pure Arabic answer. No English words.
        - NEVER mix languages. NEVER add Arabic words to an English reply.
        - Keep answers concise: 1-2 short sentences max.
        - Good example for English: "Student Eisa22 has an unpaid balance of AED 500 from his Math sessions."
        - Good example for Arabic: "عليها 500 درهم غير مدفوعة من جلسات الرياضيات."

        [LIVE DATABASE DUMP]

        === FINANCIAL OVERVIEW ===
        Total Combined Wealth: AED {live_combined_funds:,.2f}
        Core Salary: AED {live_salary:,.2f}
        Gold & Assets Value: AED {live_gold_assets:,.2f}
        Student Income Pool: AED {live_student_income:,.2f}
        Total Expenses (lifetime): AED {live_expenses_total:,.2f}

        === EXPENSES BY CATEGORY ===
        {expense_breakdown_string}

        === STUDENTS LEDGER ===
        {students_ledger_string}
        """

        ollama_payload = {
            'model': 'llama3.2:latest',
            'prompt': f"System Context:\n{system_instruction}\n\nUser Question: {user_message}\n\nAssistant:",
            'stream': False,
            'options': {
                'temperature': 0.1,
                'num_ctx': 1024,
                'num_thread': 4
            }
        }

        session = requests.Session()
        response = session.post('http://127.0.0.1:11434/api/generate', json=ollama_payload, timeout=15)

        if response.status_code == 200:
            reply = response.json().get('response', '').strip()
            return jsonify({'reply': reply or '...'})
        else:
            return jsonify({'reply': 'Local AI core is temporarily unavailable.'})

    except Exception as e:
        return jsonify({'reply': f'Could not reach the local AI engine.'})


# ─── Serve React SPA ───

REACT_DIST = Path(__file__).parent / 'react-frontend' / 'dist'

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_react_app(path):
    if path and (REACT_DIST / path).is_file():
        return send_from_directory(str(REACT_DIST), path)
    return send_from_directory(str(REACT_DIST), 'index.html')

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({'error': 'Method not allowed', 'code': 405}), 405


if __name__ == '__main__':
    app.run(debug=False, host='127.0.0.1', port=8080)
