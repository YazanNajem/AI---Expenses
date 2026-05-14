# SYSTEM_BLUEPRINT.md — Personal Finance Manager (Local Web App)

> **Last Updated:** 2026-05-13
> **Stack:** Python 3.10+ / Flask + Bootstrap 5 + Jinja2 / SQLite / Google Gemini API
> **Currency:** AED (درهم إماراتي)

---

## [PRD] — Product Requirements Document

### Scope (Strict — No Feature Creep)

| Feature ID | Feature | Verification |
|-----------|---------|-------------|
| F1.1 | Natural Language Input → AI parses → fills form | Enter Arabic sentence → item name, amount, category, asset flag extracted |
| F1.2 | AI Vision — upload invoice image → extract total + category | Upload image → total + category auto-filled in form |
| F1.3 | Manual entry form (date picker, notes, optional image) | Form saves to `expenses` table with all fields |
| F1.4 | Asset/Sunk Cost toggle per transaction | Toggle state persisted; AI auto-enables for gold/real-estate keywords |
| F1.5 | Monthly summary dashboard (dropdown filter) | 3 counters + category breakdown update on month change |
| F2.1 | Tutoring session form with auto-calculated amount | Hours + minutes → amount_due auto-calculated on input |
| F2.2 | Payment status checkbox per session | Checkbox toggles `is_paid` in `tutoring_sessions` |
| F2.3 | Cumulative student reports table | Per-student: total time, total due, paid, remaining |
| F2.4 | AI Chatbot — queries full SQLite DB via Gemini | Natural language Q → query DB → natural language A |

### Out of Scope
- No auth/login
- No cloud backup
- No PDF/Excel export
- No multi-currency
- No notifications
- No third-party APIs except Gemini

---

## [UI_FLOW] — User Interface & Navigation

### Page Structure
```
/expenses   → AI-Powered Expenses (default)
/tutoring   → Tutoring Dashboard
```

### Page 1: Expenses (`/expenses`)

```
NAVBAR: [Logo]  المصروفات  |  الدروس الخصوصية
─────────────────────────────────────────────────────
Month Dropdown: [ماي 2026 ▼]

[Card: مصاريف عادية]  [Card: أصول واستثمارات]  [Card: الإجمالي المخصوم]

Category Breakdown (horizontal bars with %)

── AI Natural Language Input ──
[Textarea: "اكتب مصروفك..."]  [Analyze Button]  [Scan Invoice Button]

── Expense Form ──
Item Name:     [text input]
Amount (AED):  [number input]
Category:      [dropdown: Food, Transport, Gold, ...]
Date:          [date picker, default=today]
Notes:         [textarea]
Invoice Image: [file upload, optional]

[Toggle: ○ Asset/Investment  ● Expense]

[💾 Save Expense Button]

── Transaction History Table ──
# | Item | Amount | Category | Date | Asset? | Actions
```

### Page 2: Tutoring (`/tutoring`)

```
NAVBAR: [Logo]  المصروفات  |  الدروس الخصوصية

── Session Form ──
Student: [dropdown: select or add new]
Subject: [text input]
Rate/hr: [number input, AED]
Time:    [hours]h  [minutes]m  →  Amount Due: [auto-calculated, read-only]
Date:    [date picker]
Notes:   [textarea]
Paid:    [checkbox ✓]

[💾 Save Session Button]

── Student Reports Table ──
# | Name | Total Time | Total Due | Paid | Remaining

── AI Chatbot ──
[Chat message area - scrollable]
[Input: "اسأل عن مصروفاتك أو دروسك..."]  [Send ▶]
```

---

## [DB_SCHEMA] — SQLite Database Design

### Entity Relationship

```
categories ──< expenses
students   ──< tutoring_sessions
```

### Table: `categories`
| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | INTEGER | PK AUTOINCREMENT | |
| name | TEXT | NOT NULL UNIQUE | e.g., Food, Transport, Gold |
| icon | TEXT | DEFAULT NULL | Emoji/icon reference |

### Table: `expenses`
| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | INTEGER | PK AUTOINCREMENT | |
| item_name | TEXT | NOT NULL | |
| amount | REAL | NOT NULL CHECK(>0) | Amount in AED |
| category_id | INTEGER | NOT NULL FK→categories.id | |
| transaction_date | TEXT | NOT NULL | ISO format YYYY-MM-DD |
| notes | TEXT | DEFAULT NULL | |
| is_asset | INTEGER | NOT NULL DEFAULT 0, CHECK(IN 0,1) | 1=Asset/Investment |
| invoice_path | TEXT | DEFAULT NULL | Relative path to uploaded image |
| created_at | TEXT | NOT NULL DEFAULT datetime('now') | |

### Table: `students`
| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | INTEGER | PK AUTOINCREMENT | |
| name | TEXT | NOT NULL | Student full name |
| subject | TEXT | DEFAULT NULL | Subject taught |
| notes | TEXT | DEFAULT NULL | |
| created_at | TEXT | NOT NULL DEFAULT datetime('now') | |

### Table: `tutoring_sessions`
| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | INTEGER | PK AUTOINCREMENT | |
| student_id | INTEGER | NOT NULL FK→students.id | |
| hourly_rate | REAL | NOT NULL CHECK(>0) | Rate per hour in AED |
| hours | INTEGER | NOT NULL DEFAULT 0, CHECK(>=0) | Whole hours |
| minutes | INTEGER | NOT NULL DEFAULT 0, CHECK(0-59) | Additional minutes |
| amount_due | REAL | NOT NULL CHECK(>0) | Computed: rate * (hours + minutes/60) |
| is_paid | INTEGER | NOT NULL DEFAULT 0, CHECK(IN 0,1) | 1=Paid |
| session_date | TEXT | NOT NULL | ISO format |
| notes | TEXT | DEFAULT NULL | |
| created_at | TEXT | NOT NULL DEFAULT datetime('now') | |

### Table: `app_settings`
| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| key | TEXT | PK | Setting name |
| value | TEXT | NOT NULL | Setting value |

### Key Analytical Queries

```sql
-- Monthly expense summary
SELECT
    strftime('%Y-%m', transaction_date) AS month,
    SUM(CASE WHEN is_asset = 0 THEN amount ELSE 0 END) AS total_expenses,
    SUM(CASE WHEN is_asset = 1 THEN amount ELSE 0 END) AS total_assets,
    SUM(amount) AS total_deducted
FROM expenses
WHERE strftime('%Y-%m', transaction_date) = ?
GROUP BY month;

-- Category breakdown for a month
SELECT c.name, SUM(e.amount) AS total, e.is_asset
FROM expenses e JOIN categories c ON c.id = e.category_id
WHERE strftime('%Y-%m', e.transaction_date) = ?
GROUP BY c.id, e.is_asset;

-- Cumulative student report
SELECT s.id, s.name,
    ROUND(SUM(ts.hours + ts.minutes/60.0), 2) AS total_hours,
    SUM(ts.amount_due) AS total_due,
    SUM(CASE WHEN ts.is_paid = 1 THEN ts.amount_due ELSE 0 END) AS total_paid,
    SUM(CASE WHEN ts.is_paid = 0 THEN ts.amount_due ELSE 0 END) AS total_remaining
FROM students s LEFT JOIN tutoring_sessions ts ON ts.student_id = s.id
GROUP BY s.id;
```

---

## [AI_SERVICE] — Gemini API Integration

### 1. Natural Language Parsing (F1.1)
```
Input:  Arabic sentence
Prompt: Extract (item_name, amount, category, is_asset) from text.
        Categories must match DB. Asset detection: keywords like "ذهب", "سبيكة", "عقار".
Output: JSON → {item_name, amount, category_id, is_asset}
```

### 2. Invoice Vision (F1.2)
```
Input:  Image file (JPEG/PNG)
Prompt: "Extract total amount and categorize this expense. Return JSON."
Output: JSON → {item_name, amount, category_id}
```

### 3. Financial Chatbot (F2.4)
```
Input:  User question + DB schema + current data context
Prompt: "Answer the user's financial question using the provided data."
Output: Natural language answer (Arabic supported)
```

### Architecture Note
- `services/ai_service.py` wraps all Gemini API calls
- API key loaded from `.env` via `python-dotenv`
- Model: `gemini-2.0-flash` (or latest available)

---

## [PROJECT_STRUCTURE] — Files & Directories

```
finance_app/
├── .env                      # GEMINI_API_KEY=...
├── requirements.txt          # flask, python-dotenv, google-genai, Pillow
├── app.py                    # Flask entry point + routes
├── database/
│   ├── schema.sql            # CREATE TABLE statements
│   └── db.py                 # SQLite connection helpers
├── services/
│   ├── ai_service.py         # Gemini API wrapper (NL, Vision, Chat)
│   └── expense_service.py    # Expense CRUD + summary logic
├── templates/
│   ├── base.html             # Navbar + layout
│   ├── expenses.html         # Page 1
│   └── tutoring.html         # Page 2
├── static/
│   ├── css/style.css
│   └── js/main.js
└── uploads/
    └── invoices/             # Uploaded invoice images
```

---

## [PENDING_TASKS] — ✅ All Complete

| Phase | Status |
|-------|--------|
| Phase 1: Foundation (Flask + DB + base template) | ✅ **DONE** |
| Phase 2: Expenses Page (form, summary, breakdown, table) | ✅ **DONE** |
| Phase 3: AI Features (NL parsing, Vision, auto asset toggle) | ✅ **DONE** |
| Phase 4: Tutoring Page (session form, auto-calc, reports, add student) | ✅ **DONE** |
| Phase 5: AI Chatbot (chat endpoint, DB context, Gemini Q&A) | ✅ **DONE** |
| Phase 6: Polish (file upload, error handling, requirements.txt) | ✅ **DONE** |
| Phase 7: QA & Security (backup, validation, DRY refactor, README) | ✅ **DONE** |

### Files Created (14 files)
| File | Lines | Purpose |
|------|-------|---------|
| `app.py` | ~320 | Flask routes + API endpoints + validation |
| `database/schema.sql` | 42 | SQLite schema (5 tables) |
| `database/db.py` | 33 | DB connection, init, category seeding |
| `database/backup.py` | 23 | Async SQLite backup on shutdown |
| `services/ai_service.py` | 85 | Gemini API wrapper (NL, Vision, Chat) |
| `templates/base.html` | 24 | Layout with Bootstrap 5 navbar |
| `templates/expenses.html` | 114 | AI-Powered Expenses page |
| `templates/tutoring.html` | 123 | Tutoring Dashboard page |
| `static/css/style.css` | 40 | Custom styling |
| `static/js/main.js` | 169 | Client-side JS (validation, DRY helpers, chat, auto-calc) |
| `.env` | 2 | Environment template |
| `requirements.txt` | 4 | Python dependencies |
| `README.md` | ~100 | Professional doc with backup/restore guide |

### QA & Security Summary
| Measure | Detail |
|---------|--------|
| Auto-backup | `database/backup.py` — async copy on shutdown, keeps last 15 |
| Input validation | All POST routes: type checks, range checks, length limits |
| File upload safety | Sanitized filenames, extension whitelist, 10MB limit |
| Client-side validation | JS guards on both forms before submit |
| String limits | `maxlength` attributes on all text inputs (200–500 chars) |
| DRY refactoring | `setCategoryFromName()`, `escHtml()`, `statusMsg()`, `appendChatMessage()` helpers extracted |
| FK integrity | Student existence verified before session insert |
| Tested | 15/15 QA tests passing (pages, CRUD, edge cases, APIs, persistence) |

### How to Run
```bash
# 1. Set your Gemini API key
echo "GEMINI_API_KEY=your_key_here" > .env

# 2. Run the app
python3 app.py

# 3. Open browser at http://127.0.0.1:5000
```
