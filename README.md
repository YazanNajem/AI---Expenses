# Personal Finance Manager

Local web application for managing personal finances and tutoring sessions with AI-powered features.

## Stack

- **Backend:** Python 3.9+ / Flask
- **Frontend:** Bootstrap 5 + Vanilla JS
- **Database:** SQLite (WAL mode)
- **AI:** Google Gemini 2.0 Flash API
- **Currency:** AED (Emirati Dirham)

## Features

### Page 1: AI-Powered Expenses
- Natural language input (Arabic/English) → auto-fills form via Gemini
- Invoice image scanning with AI Vision
- Manual expense entry with date picker, notes, optional image
- Asset/Investment toggle (auto-detected by AI for gold, real estate, etc.)
- Monthly summary: regular expenses, assets, total deducted
- Category breakdown with progress bars
- Month filter and transaction history

### Page 2: Tutoring Dashboard
- Session recording with auto-calculated amount (hours + minutes)
- Payment status toggle per session
- Cumulative student reports: total time, due, paid, remaining
- Inline add-student modal
- AI chatbot for financial queries across all data

## Quick Start

```bash
# 1. Clone / navigate to project
cd /path/to/finance_app

# 2. Install dependencies
pip3 install -r requirements.txt

# 3. Set your Gemini API key
echo "GEMINI_API_KEY=your_key_here" > .env

# 4. Run the application
python3 app.py

# 5. Open in browser
open http://127.0.0.1:5000
```

Get a Gemini API key: https://aistudio.google.com/app/apikey

## Project Structure

```
├── app.py                 # Flask routes + API endpoints
├── database/
│   ├── db.py              # SQLite connection + init
│   ├── schema.sql         # Table definitions
│   ├── backup.py          # Auto-backup on shutdown
│   ├── backups/           # Created automatically
│   └── finance.db         # Created automatically
├── services/
│   └── ai_service.py      # Gemini API wrapper
├── templates/
│   ├── base.html          # Layout
│   ├── expenses.html      # Page 1
│   └── tutoring.html      # Page 2
├── static/
│   ├── css/style.css
│   └── js/main.js
├── uploads/invoices/      # Uploaded invoice images
├── .env                   # GEMINI_API_KEY
├── requirements.txt
├── SYSTEM_BLUEPRINT.md    # Architecture document
└── README.md
```

## Backup & Restore

The database is backed up automatically (non-blocking) on application shutdown.

**Backup location:** `database/backups/finance_YYYYMMDD_HHMMSS.db`

**To restore:**
```bash
# Stop the app, then:
cp database/backups/finance_20260513_120000.db database/finance.db
# Restart the app
python3 app.py
```

The last 15 backups are retained; older ones are cleaned up automatically.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/expenses` | Expenses page (with `?month=YYYY-MM` filter) |
| POST | `/expenses/add` | Save new expense |
| GET | `/tutoring` | Tutoring dashboard |
| POST | `/tutoring/add` | Save new session |
| POST | `/tutoring/add-student` | Add student (AJAX) |
| POST | `/api/analyze-nl` | Parse natural language → expense fields |
| POST | `/api/analyze-invoice` | Scan invoice image → expense fields |
| POST | `/api/chat` | Ask financial question → AI answer |

## Security Notes

- All user inputs are validated server-side (length limits, type checks, range checks)
- File uploads: sanitized filenames, extension whitelist (images only)
- SQLite uses parameterized queries throughout (no SQL injection risk)
- Local-only, no authentication (single-user desktop app)
- Gemini API key stored in `.env` (add to `.gitignore`)
