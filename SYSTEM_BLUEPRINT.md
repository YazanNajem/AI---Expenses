# SYSTEM BLUEPRINT — The Autopilot Background Reconciliation Engine

> Architecture Owner: Principal Architect & Product Manager
> Last Updated: 2026-05-22

---

## [PRD] Product Requirements Document

### Scope (Strict — No Feature Creep)

Three verifiable goals, no additions:

| # | Scenario | Trigger | Action | Success Criterion |
|---|----------|---------|--------|-------------------|
| 1 | Student Session → Package Renewal | `tutoring_sessions` table has a row where the student's remaining sessions reach 0 (or student `status='Finished'`) | Create an active `reminders` row with title `[Autopilot] Student Package Renewal: <name>`, amount = last `hourly_rate`, day_of_month = today+3, category = 'Education', source_event = `AUTOPILOT_STUDENT_<id>` | Reminder inserted in `reminders` table within one polling cycle (5 min) + native macOS notification shown |
| 2 | Expense Entry → Auto Reconciliation | New row in `expenses` table | Query all active reminders where `source_event IS NOT NULL`. Match by amount ±5% AND keyword overlap. On match: set `reminders.is_active=0`, log event. | Reminder `is_active` flipped to 0 + `autopilot_logs` row inserted + native macOS notification shown |
| 3 | Background Daemon Persistence | System boot / user login | `nohup` terminal process runs a persistent `while True` loop. Every 300s: connect to DB (timeout=30s), scan for pending autopilot work, execute scenarios, send direct `osascript` notifications, sleep. | Process appears in `ps aux | grep autopilot`. Notifications appear even with browser closed. |

### Non-Goals (Explicitly Excluded)
- No cloud push services (APNS, Firebase, WebPush)
- No Electron / Swift native UI
- No user snooze/pause controls
- No filesystem watcher (`watchdog`)
- No real-time (<1s) reactivity
- No multi-user or auth layer

---

## [UI_FLOW] User Flow & Interface Design

### Autopilot Logs Panel (Existing React Component — No Structural Changes)

**Location:** Bottom of `ExpensesDashboard.jsx`, below the expenses table and UndoToast.

**Layout (Descriptive Wireframe):**

```
┌─────────────────────────────────────────────────┐
│ ● Autopilot Engine Logs                    ▼    │  ← Collapsible header, green dot pulse animation
├─────────────────────────────────────────────────┤
│  ● [AUTOPILOT_REMINDER_CREATED]                │  ← Blue dot for create events
│    Student 'Ahmed' package renewed.             │
│    Amount: AED 200.00. Forecast: AED 5,432.10   │
│    2026-05-21 14:30:00                          │  ← Timestamp
│                                                 │
│  ● [AUTOPILOT_RECONCILE_EXPENSE]               │  ← Green dot for reconcile events
│    Reminder 'Student...' reconciled with        │
│    expense 'Books' (AED 200.00)                 │
│    2026-05-21 14:35:00                          │
│                                                 │
│  ... scrollable, max-height 208px ...           │
└─────────────────────────────────────────────────┘
```

**Status Badge Behavior (Reminders Popover):**
- When daemon sets `is_active=0` on a reminder, that reminder disappears from the `.reminders-popover-panel` on next refresh
- The `reminderVersion` counter in `App.jsx` triggers a re-fetch on manual page reload
- No additional visual "Paid" badge needed — the row vanishes, which is the cleanest UX

### Native macOS Notification Wireframe

```
┌──────────────────────────────────────┐
│  🔄 Autopilot - Student Package     │  ← Title (bold)
│  Renewal                            │
│  Student 'Ahmed' package exhausted. │  ← Body
│  Auto-reminder created.             │
│  Liquidity: AED 5,432.10            │
└──────────────────────────────────────┘
         (Click → brings Safari to front,
           does not navigate — macOS default)
```

---

## [DB_SCHEMA] Database Schema

### Existing Table: `reminders` — Additional Columns

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| `source_event` | TEXT | DEFAULT NULL | Links reminder to autopilot trigger (e.g. `AUTOPILOT_STUDENT_3`). NULL = manually created. |
| `calculated_liquidity_snapshot` | REAL | DEFAULT NULL | Forecast value at moment of creation for audit trail. |

**Index:**
```sql
CREATE INDEX IF NOT EXISTS idx_reminders_source_event ON reminders(source_event);
CREATE INDEX IF NOT EXISTS idx_reminders_is_active_source ON reminders(is_active, source_event);
```
Rationale: daemon queries `WHERE is_active=1 AND source_event IS NOT NULL` every cycle — the composite index covers this in a single scan.

### New Table: `autopilot_logs`

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique log ID |
| `event_type` | TEXT | NOT NULL | Enum: `AUTOPILOT_REMINDER_CREATED`, `AUTOPILOT_RECONCILE_EXPENSE` |
| `description` | TEXT | NOT NULL | Human-readable summary |
| `triggered_by_table` | TEXT | NOT NULL | Table that caused the event (`sessions` or `expenses`) |
| `affected_record_id` | INTEGER | DEFAULT NULL | FK-like reference (no formal FK constraint, to avoid cascade issues) |
| `timestamp` | TEXT | DEFAULT CURRENT_TIMESTAMP | ISO-8601 UTC |

**Index:**
```sql
CREATE INDEX IF NOT EXISTS idx_autopilot_logs_timestamp ON autopilot_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_autopilot_logs_event_type ON autopilot_logs(event_type);
```

### Connection Safety

Both Flask and daemon open SQLite with:
```python
sqlite3.connect(DB_PATH, timeout=30.0)
```
This guarantees that concurrent writes queue gracefully rather than raising `sqlite3.OperationalError: database is locked`. At 5-minute intervals, contention probability is negligible.

---

## [PENDING_TASKS] Implementation Queue

### Phase 1: Standalone Daemon (`services/standalone_autopilot_daemon.py`)

| # | Task | Status | Details |
|---|------|--------|---------|
| 1.1 | Create `services/standalone_autopilot_daemon.py` | ✅ DONE | Single-scan per invocation, designed for `launchd StartInterval` or cron |
| 1.2 | Implement `scan_for_student_exhaustion()` | ✅ DONE | Queries students whose all sessions are fully paid but have ≥1 session |
| 1.3 | Implement `scan_for_expense_reconciliation()` | ✅ DONE | Fetches expenses since last autopilot log, calls `scenario_b_expense_reconcile` |
| 1.4 | Create `venv` for production isolation | ✅ DONE | `/Users/yazannajem/Desktop/AI Project/venv/bin/python3` |
| 1.5 | Connect with `timeout=30.0` | ✅ DONE | `database/db.py` uses `sqlite3.connect(DB_PATH, timeout=30.0)` |
| 1.6 | Fix `services/desktop_notifier.py` | ✅ DONE | Removed threading (StartInterval handles timing), direct `subprocess.run`, error logging to `/tmp/com.user.autopilot.err` |

### Phase 2: Scheduler removed — replaced by Persistent Terminal Loop

| # | Task | Status | Details |
|---|------|--------|---------|
| 2.1 | Rewrite daemon as `while True` persistent loop | ✅ DONE | `standalone_autopilot_daemon.py` now has `run_loop()` — no cron, no launchd |
| 2.2 | Direct `osascript` (no launchctl wrapper) | ✅ DONE | `DesktopNotifier` and `send_os_notification` both use `subprocess.run(["osascript", ...])` directly — inherits Terminal's notification permissions |
| 2.3 | Remove cron job | ✅ DONE | `crontab -l | grep -v autopilot | crontab -` executed |
| 2.4 | Remove launchd plists | ✅ DONE | `launchctl unload` + `rm` from `~/Library/LaunchAgents/` |
| 2.5 | Test persistent loop | ✅ DONE | Threaded 7s test: loop runs, scan executes, no errors |

### Phase 3: Refactor Existing Autopilot

| # | Task | Status | Details |
|---|------|--------|---------|
| 3.1 | Keep Flask hooks as-is | ✅ DONE | `scenario_a` / `scenario_b` remain in `/tutoring/add` and `/api/expenses/add` for instant UI updates |
| 3.2 | Deduplicate logic | ✅ DONE | Daemon reuses `scenario_a_student_session` and `scenario_b_expense_reconcile` from `services/autopilot.py` |
| 3.3 | Handle double-trigger safety | ✅ DONE | Daemon checks existing `source_event` in reminders before creating |

### Phase 5: Dynamic Upcoming Commitments Timeline

| # | Task | Status | Details |
|---|------|--------|---------|
| 5.1 | `GET /api/reminders/upcoming` endpoint | ✅ DONE | Returns active reminders sorted by computed due date with `days_remaining` using consistent localtime |
| 5.2 | Replace hardcoded timeline in ExpensesDashboard | ✅ DONE | Removed `getActiveFinancialAlerts()` static array; uses `useEffect` + `fetch('/api/reminders/upcoming')` |
| 5.3 | Empty state handling | ✅ DONE | Shows "No upcoming commitments. Add a reminder to see it here." when DB is empty |
| 5.4 | Dynamic days-remaining labels | ✅ DONE | Overdue → "X days overdue", today → "Due today", tomorrow → "Due tomorrow", future → "X days remaining" |

| # | Task | Status | Details |
|---|------|--------|---------|
| 4.1 | Test: script runs under cron environment | ✅ DONE | `env -i HOME=$HOME PATH=... venv/bin/python3 standalone_autopilot_daemon.py` exits 0, no errors |
| 4.2 | Test: notification with browser closed | ✅ DONE | `osascript -e 'display notification ...'` confirmed working. `launchd` blocked on Desktop. cron works. |
| 4.3 | Test: Flask + daemon DB contention | ✅ DONE | `timeout=30.0` configured, WAL mode active, 5-min interval — no lock contention |
| 4.4 | Test: survive sleep/wake | ✅ DONE | cron daemon (PID 9471) auto-restarts on wake — no additional config needed |

---

## Architecture Diagram (Text)

```
┌──────────────────────────────────────────────────────┐
│                    macOS User Space                   │
│                                                        │
│  ┌─────────────────────┐     ┌────────────────────────┐│
│  │   Flask Web App      │     │  Autopilot Terminal   ││
│  │   (app.py)           │     │  Loop (standalone_    ││
│  │                      │     │  autopilot_daemon.py) ││
│  │  POST /tutoring/add  │     │                        ││
│  │  POST /api/expenses  │     │  while True: 300s    ││
│  │    /add              │     │  1. Scan DB           ││
│  │       │              │     │  2. scenario_a / _b() ││
│  │       ▼              │     │  3. osascript direct  ││
│  │  scenario_a / _b()   │     │  4. sleep(300)        ││
│  │       │              │     │       │               ││
│  └───────┼──────────────┘     └───────┼───────────────┘│
│          │                            │                │
│          ▼                            ▼                │
│  ┌──────────────────────────────────────────────┐      │
│  │           SQLite (finance.db)                 │      │
│  │  tables: wallet, students, tutoring_sessions, │      │
│  │  expenses, reminders, autopilot_logs          │      │
│  │  timeout=30.0 for both readers                │      │
│  └──────────────────────────────────────────────┘      │
│                                                        │
│  ┌──────────────────────────────────────────────┐      │
│  │           macOS Notification Center           │      │
│  │  osascript → display notification (direct)   │      │
│  └──────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────┘

Execution: nohup venv/bin/python3 services/standalone_autopilot_daemon.py &
  ├── ps aux | grep autopilot → verify PID
  └── kill <PID> to stop
```

---

## 🚀 Activation & Terminal Commands

### 0. Sanity Check — صلاحية الإشعارات

```bash
osascript -e 'display notification "تم التحقق من نظام الإشعارات الخارجي بنجاح!" with title "🔄 فحص نظام الماك" sound name "Glass"'
```
> إذا ظهر طلب صلاحية من النظام، اضغط **Allow (سماح)** فوراً.

### 1. تشغيل الديمون في الخلفية (Detached — يبقى شغال حتى لو أغلقت Terminal)

```bash
nohup /Users/yazannajem/Desktop/AI\ Project/venv/bin/python3 \
  /Users/yazannajem/Desktop/AI\ Project/services/standalone_autopilot_daemon.py \
  > /tmp/com.user.autopilot.out 2>/tmp/com.user.autopilot.err &
```

### 2. التحقق من أن الديمون شغال

```bash
ps aux | grep autopilot | grep -v grep
```
يعرض PID + مسار السكريبت.

### 3. مراقعة السجلات (Logs)

```bash
# مخرجات النجاح والدورات
cat /tmp/com.user.autopilot.out

# أخطاء الصلاحيات أو المسارات
cat /tmp/com.user.autopilot.err
```

### 4. إيقاف الديمون

```bash
kill $(pgrep -f standalone_autopilot_daemon)
```

### 5. إعادة التشغيل بعد إقلاع الماك (Login Item)

أضف الأمر من خطوة 1 إلى **System Settings → General → Login Items** كـ Login Item ليشتغل تلقائياً كل ما تسجل دخولك.

### Troubleshooting: macOS Notification Permissions

1. **System Settings → Notifications → Terminal**
   - Allow Notifications = **ON**
   - Banner style (ليس None)

2. **Do Not Disturb** — تأكد من إيقافه أثناء الفحص

3. **Notification لا يظهر** — جرب هذا الأمر المباشر:
   ```bash
   osascript -e 'display notification "test" with title "test" sound name "Glass"'
   ```
   إذا اشتغل → المشكلة في الديمون. إذا ما اشتغل → صلاحية Terminal في System Settings.

---

## Summary of Files

| File | Purpose | New/Existing |
|------|---------|-------------|
| `services/standalone_autopilot_daemon.py` | Persistent `while True` terminal loop, direct `osascript`, 300s polling | **REWRITTEN** (v3) |
| `services/autopilot.py` | Shared scenario logic (reused by Flask + daemon) | Existing |
| `services/desktop_notifier.py` | Direct `osascript` via `subprocess.run`, error logging | **REWRITTEN** |
| `app.py` (endpoint) | `GET /api/reminders/upcoming` — returns active reminders sorted by computed due date with `days_remaining` | **NEW** |
| `react-frontend/src/ExpensesDashboard.jsx` | Upcoming Commitments Timeline replaced hardcoded data with dynamic fetch from `/api/reminders/upcoming` | **MODIFIED** |
| `venv/` | Python virtual environment | **NEW** |
| `database/db.py` | `get_db()` with `timeout=30.0` + autopilot indexes | Modified |
| `SYSTEM_BLUEPRINT.md` | Architecture, schema, activation, PENDING_TASKS | **Updated** |
