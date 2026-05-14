// ─── Helpers ───
function escHtml(t) {
    var d = document.createElement('div');
    d.textContent = t;
    return d.innerHTML;
}

function setCategoryFromName(catSelect, name) {
    if (!catSelect || !name) return;
    for (var i = 0; i < catSelect.options.length; i++) {
        if (catSelect.options[i].text === name) {
            catSelect.value = catSelect.options[i].value;
            break;
        }
    }
}

function statusMsg(text, isError) {
    var el = document.getElementById('ai-status');
    if (el) el.textContent = (isError ? 'Error: ' : '') + text;
}

function validateFileSize(file, maxMB) {
    if (file && file.size > maxMB * 1024 * 1024) {
        statusMsg('File exceeds ' + maxMB + 'MB limit', true);
        return false;
    }
    return true;
}

function fmtAED(n) {
    return 'AED ' + Number(n).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
}

function updateWalletCards(wallet) {
    var el = document.getElementById('wallet-personal');
    if (el) el.textContent = fmtAED(wallet.personal_balance);
    el = document.getElementById('wallet-students');
    if (el) el.textContent = fmtAED(wallet.students_balance);
    el = document.getElementById('wallet-total');
    if (el) el.textContent = fmtAED(wallet.grand_total);
}

document.addEventListener('click', function (e) {
    var btn = e.target.closest('#btn-edit-personal');
    if (!btn) return;
    var el = document.getElementById('wallet-personal');
    var raw = el ? el.textContent.replace(/[^0-9.]/g, '') : '0';
    document.getElementById('edit-personal-input').value = parseFloat(raw) || 0;
    new bootstrap.Modal(document.getElementById('editPersonalModal')).show();
});

document.getElementById('btn-save-personal')?.addEventListener('click', function () {
    var input = document.getElementById('edit-personal-input');
    var val = parseFloat(input.value);
    if (isNaN(val) || val < 0) { alert('Enter a valid positive number'); return; }
    fetch('/api/wallet/update_personal', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({new_balance: val})
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
        if (data.error) { alert(data.error); return; }
        updateWalletCards(data);
        bootstrap.Modal.getInstance(document.getElementById('editPersonalModal')).hide();
    })
    .catch(function (err) { alert(err.message); });
});

function updateSummaryCards(summary) {
    var el = document.getElementById('summary-expenses');
    if (el) el.querySelector('h3').textContent = fmtAED(summary.total_expenses);
    el = document.getElementById('summary-assets');
    if (el) el.querySelector('h3').textContent = fmtAED(summary.total_assets);
    el = document.getElementById('summary-deducted');
    if (el) el.querySelector('h3').textContent = fmtAED(summary.total_deducted);
}

// ─── AI fetch with safe response handling ───
function aiFetch(url, body, onSuccess) {
    var status = document.getElementById('ai-status');
    fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    })
    .then(function (r) {
        if (!r.ok) { throw new Error('Server error (' + r.status + ')'); }
        return r.json();
    })
    .then(function (data) {
        if (data.error) { statusMsg(data.error, true); return; }
        onSuccess(data);
    })
    .catch(function (err) { statusMsg(err.message, true); });
}

// ─── AJAX Delete ───
document.addEventListener('click', function (e) {
    var btn = e.target.closest('.delete-expense-btn');
    if (!btn) return;
    if (!confirm('Delete this expense?')) return;
    var tr = btn.closest('tr');
    var monthSelect = document.querySelector('select[name="month"]');
    var month = monthSelect ? monthSelect.value : '';
    fetch('/api/expenses/' + btn.dataset.id + '/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: month })
    })
    .then(function (r) {
        if (!r.ok) throw new Error('Delete failed');
        return r.json();
    })
    .then(function (data) {
        if (data.error) { alert(data.error); return; }
        if (tr) tr.remove();
        if (data.summary) updateSummaryCards(data.summary);
        if (data.wallet) updateWalletCards(data.wallet);
        var tbody = document.querySelector('.table-hover tbody');
        if (tbody && tbody.rows.length === 0) {
            var card = document.querySelector('.card:last-child .card-body.p-0');
            if (card) card.innerHTML = '<div class="card-body"><p class="text-muted mb-0">No transactions for this month.</p></div>';
        }
    })
    .catch(function (err) { alert(err.message); });
});

function updateTotalUnpaid(val) {
    var el = document.getElementById('total-unpaid');
    if (el) el.textContent = fmtAED(val);
}

function updateReportRow(report) {
    if (!report) return;
    var tr = document.querySelector('#reports-tbody tr[data-id="' + report.id + '"]');
    if (!tr) return;
    if (report.total_due === 0 && report.total_paid === 0 && report.total_remaining === 0) {
        tr.remove();
        return;
    }
    var cells = tr.querySelectorAll('td');
    if (cells.length >= 7) {
        cells[2].textContent = report.total_hours + ' hrs';
        cells[3].textContent = fmtAED(report.total_due);
        cells[4].textContent = fmtAED(report.total_paid);
        var remCell = cells[5];
        remCell.textContent = fmtAED(report.total_remaining);
        remCell.className = 'rep-amounts' + (report.total_remaining > 0 ? ' text-danger fw-bold' : '');
    }
}

document.addEventListener('click', function (e) {
    var btn = e.target.closest('.delete-session-btn');
    if (!btn) return;
    if (!confirm('Delete this session?')) return;
    var tr = btn.closest('tr');
    fetch('/api/tutoring/sessions/' + btn.dataset.id + '/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
    })
    .then(function (r) {
        if (!r.ok) throw new Error('Delete failed');
        return r.json();
    })
    .then(function (data) {
        if (data.error) { alert(data.error); return; }
        if (tr) tr.remove();
        if (data.wallet) updateWalletCards(data.wallet);
        if (data.total_unpaid !== undefined) updateTotalUnpaid(data.total_unpaid);
        if (data.report) updateReportRow(data.report);
        initSessionsPagination();
    })
    .catch(function (err) { alert(err.message); });
});

document.addEventListener('click', function (e) {
    var btn = e.target.closest('.delete-student-btn');
    if (!btn) return;
    if (!confirm('Delete student "' + btn.dataset.name + '" and all their sessions?')) return;
    var tr = btn.closest('tr');
    var sid = btn.dataset.id;
    fetch('/api/tutoring/students/' + sid + '/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
    })
    .then(function (r) {
        if (!r.ok) throw new Error('Delete failed');
        return r.json();
    })
    .then(function (data) {
        if (data.error) { alert(data.error); return; }
        if (tr) tr.remove();
        if (data.wallet) updateWalletCards(data.wallet);
        if (data.total_unpaid !== undefined) updateTotalUnpaid(data.total_unpaid);
        // Remove student from select dropdown
        var opt = document.querySelector('select[name="student_id"] option[value="' + sid + '"]');
        if (opt) opt.remove();
        // Also remove all session rows for this student
        var sessionRows = document.querySelectorAll('#sessions-tbody tr[data-student="' + sid + '"]');
        sessionRows.forEach(function (row) { row.remove(); });
        initSessionsPagination();
    })
    .catch(function (err) { alert(err.message); });
});

// ─── AI Natural Language Analysis ───
document.getElementById('btn-analyze')?.addEventListener('click', function () {
    var text = document.getElementById('nl-input').value.trim();
    if (!text) return;
    var status = document.getElementById('ai-status');
    status.textContent = 'Analyzing with AI...';
    aiFetch('/api/analyze-nl', { text: text }, function (data) {
        document.getElementById('field-item_name').value = data.item_name || '';
        document.getElementById('field-amount').value = data.amount || '';
        setCategoryFromName(document.getElementById('field-category'), data.category);
        document.getElementById('asset-toggle').checked = data.is_asset === true;
        status.textContent = 'Form auto-filled by AI. Review and save.';
    });
});

// ─── Invoice Scan ───
document.getElementById('btn-scan-invoice')?.addEventListener('click', function () {
    document.getElementById('invoice-file-input').click();
});
document.getElementById('invoice-file-input')?.addEventListener('change', function () {
    if (!this.files || !this.files[0]) return;
    if (!validateFileSize(this.files[0], 10)) return;
    var fd = new FormData();
    fd.append('image', this.files[0]);
    var status = document.getElementById('ai-status');
    status.textContent = 'Scanning invoice with AI...';
    fetch('/api/analyze-invoice', { method: 'POST', body: fd })
    .then(function (r) {
        if (!r.ok) throw new Error('Server error (' + r.status + ')');
        return r.json();
    })
    .then(function (data) {
        if (data.error) { statusMsg(data.error, true); return; }
        document.getElementById('field-item_name').value = data.item_name || 'Invoice';
        document.getElementById('field-amount').value = data.amount || '';
        setCategoryFromName(document.getElementById('field-category'), data.category);
        status.textContent = 'Invoice scanned. Review and save.';
    })
    .catch(function (err) { statusMsg(err.message, true); });
});

// ─── Default Date: Today ───
(function () {
    var dateField = document.querySelector('input[name="transaction_date"]');
    if (dateField && !dateField.value) {
        dateField.value = new Date().toISOString().split('T')[0];
    }
})();

// ─── Edit Expense Modal ───
document.addEventListener('click', function (e) {
    var btn = e.target.closest('.edit-expense-btn');
    if (!btn) return;
    var tr = btn.closest('tr');
    document.getElementById('edit-expense-id').value = tr.dataset.id;
    document.getElementById('edit-item-name').value = tr.dataset.item;
    document.getElementById('edit-amount').value = tr.dataset.amount;
    document.getElementById('edit-category').value = tr.dataset.category;
    document.getElementById('edit-date').value = tr.dataset.date;
    document.getElementById('edit-notes').value = tr.dataset.notes;
    document.getElementById('edit-asset-toggle').checked = tr.dataset.asset === '1';
    document.getElementById('edit-expense-form').action = '/expenses/edit/' + tr.dataset.id;
});

// ─── Edit Session Modal ───
function calcEditAmountDue() {
    var rate = parseFloat(document.getElementById('edit-session-rate').value) || 0;
    var hrs = parseInt(document.getElementById('edit-session-hours').value) || 0;
    var mins = parseInt(document.getElementById('edit-session-minutes').value) || 0;
    var total = rate * (hrs + mins / 60);
    document.getElementById('edit-session-amount-due').value = 'AED ' + total.toFixed(2);
}

document.addEventListener('click', function (e) {
    var btn = e.target.closest('.edit-session-btn');
    if (!btn) return;
    var tr = btn.closest('tr');
    document.getElementById('edit-session-id').value = tr.dataset.id;
    document.getElementById('edit-session-student').value = tr.dataset.student;
    document.getElementById('edit-session-student-name').value = tr.dataset.studentName || tr.querySelector('td:nth-child(2)').textContent;
    document.getElementById('edit-session-subject').value = tr.dataset.subject || '';
    document.getElementById('edit-session-rate').value = tr.dataset.rate;
    document.getElementById('edit-session-hours').value = tr.dataset.hours;
    document.getElementById('edit-session-minutes').value = tr.dataset.minutes;
    document.getElementById('edit-session-date').value = tr.dataset.date;
    document.getElementById('edit-session-notes').value = tr.dataset.notes;
    document.getElementById('edit-session-paid').checked = tr.dataset.paid === '1';
    calcEditAmountDue();
});

document.getElementById('edit-session-rate')?.addEventListener('input', calcEditAmountDue);
document.getElementById('edit-session-hours')?.addEventListener('input', calcEditAmountDue);
document.getElementById('edit-session-minutes')?.addEventListener('input', calcEditAmountDue);

document.getElementById('edit-session-form')?.addEventListener('submit', function (e) {
    e.preventDefault();
    var sid = document.getElementById('edit-session-id').value;
    var data = {
        student_id: document.getElementById('edit-session-student').value,
        student_name: document.getElementById('edit-session-student-name').value.trim(),
        subject: document.getElementById('edit-session-subject').value.trim(),
        hourly_rate: document.getElementById('edit-session-rate').value,
        hours: document.getElementById('edit-session-hours').value,
        minutes: document.getElementById('edit-session-minutes').value,
        session_date: document.getElementById('edit-session-date').value,
        notes: document.getElementById('edit-session-notes').value,
        is_paid: document.getElementById('edit-session-paid').checked ? 1 : 0
    };
    fetch('/api/tutoring/sessions/' + sid + '/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
        if (data.error) { alert(data.error); return; }
        var s = data.session;
        var tr = document.querySelector('#sessions-tbody tr[data-id="' + s.id + '"]');
        if (tr) {
            tr.dataset.student = s.student_id;
            tr.dataset.studentName = s.student_name;
            tr.dataset.subject = s.subject;
            tr.dataset.rate = s.hourly_rate;
            tr.dataset.hours = s.hours;
            tr.dataset.minutes = s.minutes;
            tr.dataset.date = s.session_date;
            tr.dataset.notes = s.notes;
            tr.dataset.paid = s.is_paid;
            tr.innerHTML =
                '<td>' + tr.rowIndex + '</td>' +
                '<td>' + escHtml(s.student_name) + '</td>' +
                '<td>' + escHtml(s.subject || '---') + '</td>' +
                '<td class="sess-rate-due">' + fmtAED(s.hourly_rate) + '/hr</td>' +
                '<td>' + s.hours + 'h ' + s.minutes + 'm</td>' +
                '<td class="sess-rate-due">' + fmtAED(s.amount_due) + '</td>' +
                '<td>' + (s.is_paid ? '<span class="badge bg-success">Paid</span>' : '<span class="badge bg-warning text-dark">Unpaid</span>') + '</td>' +
                '<td>' + s.session_date + '</td>' +
                '<td class="text-end">' +
                '<button class="btn btn-sm btn-outline-primary edit-session-btn" data-bs-toggle="modal" data-bs-target="#editSessionModal">Edit</button> ' +
                '<button class="btn btn-sm btn-outline-danger delete-session-btn" data-id="' + s.id + '">Delete</button>' +
                '</td>';
        }
        if (data.wallet) updateWalletCards(data.wallet);
        bootstrap.Modal.getInstance(document.getElementById('editSessionModal')).hide();
    })
    .catch(function (err) { alert(err.message); });
});

// ─── Chatbot (Floating Widget) ───
document.addEventListener('DOMContentLoaded', function () {
    var toggleBtn = document.getElementById('chat-toggle-btn');
    var closeBtn = document.getElementById('chat-close');
    var popup = document.getElementById('chat-popup');
    if (toggleBtn && popup) {
        toggleBtn.addEventListener('click', function () {
            var isHidden = popup.style.display === 'none' || popup.style.display === '';
            popup.style.display = isHidden ? 'flex' : 'none';
            popup.style.flexDirection = 'column';
        });
    }
    if (closeBtn && popup) {
        closeBtn.addEventListener('click', function () {
            popup.style.display = 'none';
        });
    }
});

document.getElementById('btn-chat-send')?.addEventListener('click', sendChatMessage);
document.getElementById('chat-input')?.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') sendChatMessage();
});

function appendChatMessage(msgDiv, text, isUser) {
    var cls = isUser ? 'bg-primary text-end' : 'bg-secondary text-start';
    var align = isUser ? 'text-end' : 'text-start';
    msgDiv.innerHTML += '<div class="' + align + ' mb-2"><span class="badge ' + cls + '" style="white-space:normal;max-width:80%;display:inline-block;text-align:left;padding:8px 12px;">' + escHtml(text) + '</span></div>';
}

function sendChatMessage() {
    var input = document.getElementById('chat-input');
    var msgDiv = document.getElementById('chat-messages');
    var q = input.value.trim();
    if (!q) return;
    appendChatMessage(msgDiv, q, true);
    msgDiv.innerHTML += '<div class="text-start mb-2 text-muted" id="chat-thinking"><em>Thinking...</em></div>';
    msgDiv.scrollTop = msgDiv.scrollHeight;
    input.value = '';
    fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q })
    })
    .then(function (r) {
        if (!r.ok) throw new Error('Server error (' + r.status + ')');
        return r.json();
    })
    .then(function (data) {
        var th = document.getElementById('chat-thinking');
        if (th) th.remove();
        appendChatMessage(msgDiv, data.response || data.error || 'Sorry, could not process that.', false);
        msgDiv.scrollTop = msgDiv.scrollHeight;
    })
    .catch(function (err) {
        var th = document.getElementById('chat-thinking');
        if (th) th.remove();
        msgDiv.innerHTML += '<div class="text-start mb-2 text-danger">Error: ' + escHtml(err.message) + '</div>';
    });
}

// ─── Tutoring auto-calculate ───
(function () {
    var rate = document.getElementById('field-rate');
    var hrs = document.getElementById('field-hours');
    var mins = document.getElementById('field-minutes');
    var el = document.getElementById('field-amount-due');
    function calc() {
        var r = parseFloat(rate ? rate.value : 0) || 0;
        var h = parseInt(hrs ? hrs.value : 0) || 0;
        var m = parseInt(mins ? mins.value : 0) || 0;
        var due = r * (h + m / 60);
        if (el) el.value = 'AED ' + due.toFixed(2);
    }
    if (rate) rate.addEventListener('input', calc);
    if (hrs) hrs.addEventListener('input', calc);
    if (mins) mins.addEventListener('input', calc);
})();

// ─── Form validation (client-side guard) ───
(function () {
    var expForm = document.querySelector('form[action="/expenses/add"]');
    if (expForm) {
        expForm.addEventListener('submit', function (e) {
            var name = this.querySelector('[name="item_name"]');
            var amt = this.querySelector('[name="amount"]');
            if (!name.value.trim()) { alert('Item name is required'); e.preventDefault(); return; }
            if (!amt.value || parseFloat(amt.value) <= 0) { alert('Amount must be greater than 0'); e.preventDefault(); return; }
        });
    }
    var sesForm = document.querySelector('form[action="/tutoring/add"]');
    if (sesForm) {
        sesForm.addEventListener('submit', function (e) {
            var sid = this.querySelector('[name="student_id"]');
            var rate = this.querySelector('[name="hourly_rate"]');
            if (!sid.value || sid.value === '__new__') { alert('Please select a student'); e.preventDefault(); return; }
            if (!rate.value || parseFloat(rate.value) <= 0) { alert('Rate must be greater than 0'); e.preventDefault(); return; }
        });
    }
})();

// ─── Sessions Pagination ───
var PER_PAGE = 5;

function initSessionsPagination() {
    var tbody = document.getElementById('sessions-tbody');
    var nav = document.getElementById('sessions-pagination-nav');
    var pag = document.getElementById('sessions-pagination');
    if (!tbody || !nav || !pag) return;
    var rows = Array.from(tbody.querySelectorAll('tr'));
    var total = rows.length;
    var pages = Math.max(1, Math.ceil(total / PER_PAGE));

    if (total <= PER_PAGE) {
        nav.classList.add('d-none');
        rows.forEach(function (r) { r.style.display = ''; });
        return;
    }
    nav.classList.remove('d-none');

    function showPage(p) {
        var start = (p - 1) * PER_PAGE;
        var end = start + PER_PAGE;
        rows.forEach(function (r, i) {
            r.style.display = (i >= start && i < end) ? '' : 'none';
        });
        var btns = pag.querySelectorAll('.page-item');
        btns.forEach(function (item, i) {
            var a = item.querySelector('a');
            if (!a) return;
            var num = parseInt(a.dataset.page);
            if (num === p) item.classList.add('active');
            else item.classList.remove('active');
        });
    }

    function buildPages(current) {
        pag.innerHTML = '';
        var prevLi = document.createElement('li');
        prevLi.className = 'page-item' + (current <= 1 ? ' disabled' : '');
        prevLi.innerHTML = '<a class="page-link" href="#" data-page="prev">&laquo; Previous</a>';
        pag.appendChild(prevLi);

        for (var i = 1; i <= pages; i++) {
            var li = document.createElement('li');
            li.className = 'page-item' + (i === current ? ' active' : '');
            li.innerHTML = '<a class="page-link" href="#" data-page="' + i + '">' + i + '</a>';
            pag.appendChild(li);
        }

        var nextLi = document.createElement('li');
        nextLi.className = 'page-item' + (current >= pages ? ' disabled' : '');
        nextLi.innerHTML = '<a class="page-link" href="#" data-page="next">Next &raquo;</a>';
        pag.appendChild(nextLi);
    }

    buildPages(1);
    showPage(1);

    pag.addEventListener('click', function (e) {
        var a = e.target.closest('a');
        if (!a) return;
        e.preventDefault();
        var dp = a.dataset.page;
        var cur = pag.querySelector('.page-item.active a');
        var curPage = cur ? parseInt(cur.dataset.page) : 1;
        var next;
        if (dp === 'prev') next = Math.max(1, curPage - 1);
        else if (dp === 'next') next = Math.min(pages, curPage + 1);
        else next = parseInt(dp);
        if (next === curPage) return;
        buildPages(next);
        showPage(next);
    });
}

document.addEventListener('DOMContentLoaded', initSessionsPagination);

// ─── Section Privacy Toggles ───
function setupSectionToggle(btnClass, cardId, blurClass) {
    var btn = document.querySelector('.' + btnClass);
    var card = document.getElementById(cardId);
    if (!btn || !card) return;
    var icon = btn.querySelector('i');
    btn.addEventListener('click', function () {
        var active = card.classList.toggle(blurClass);
        if (icon) icon.className = active ? 'bi bi-eye-slash' : 'bi bi-eye';
    });
}

document.addEventListener('DOMContentLoaded', function () {
    setupSectionToggle('session-privacy-toggle', 'sessions-card', 'sessions-blur');
    setupSectionToggle('reports-privacy-toggle', 'reports-card', 'reports-blur');
});

// ─── Global Privacy Mode Toggle ───
(function () {
    var toggle = document.getElementById('privacy-toggle');
    var icon = toggle ? toggle.querySelector('i') : null;
    var row = document.getElementById('wallet-row');

    function applyBlur(active) {
        if (active) {
            if (row) row.classList.add('wallet-blur');
            var extra = document.getElementById('total-unpaid');
            if (extra) extra.closest('.card')?.classList.add('wallet-blur');
            if (icon) { icon.className = 'bi bi-eye-slash'; }
        } else {
            if (row) row.classList.remove('wallet-blur');
            var extra = document.getElementById('total-unpaid');
            if (extra) extra.closest('.card')?.classList.remove('wallet-blur');
            if (icon) { icon.className = 'bi bi-eye'; }
        }
    }

    var saved = localStorage.getItem('privacyMode');
    if (saved === '1') applyBlur(true);

    if (toggle) {
        toggle.addEventListener('click', function () {
            var active = localStorage.getItem('privacyMode') === '1';
            var next = active ? '0' : '1';
            localStorage.setItem('privacyMode', next);
            applyBlur(next === '1');
        });
    }
})();

// ─── Quick Add Student (inline) ───
document.getElementById('btn-quick-add-student')?.addEventListener('click', addQuickStudent);
document.getElementById('quick-student-name')?.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') addQuickStudent();
});

function addQuickStudent() {
    var input = document.getElementById('quick-student-name');
    var name = input.value.trim();
    if (!name) { alert('Student name is required'); input.focus(); return; }
    fetch('/tutoring/add-student', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ name: name })
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
        if (data.error) { alert(data.error); return; }
        var select = document.querySelector('select[name="student_id"]');
        var opt = document.createElement('option');
        opt.value = data.id;
        opt.textContent = data.name;
        select.insertBefore(opt, select.querySelector('option[value="__new__"]'));
        select.value = data.id;
        input.value = '';
        input.focus();
    });
}

// ─── Add New Student (modal) ───
function addNewStudent() {
    var studentName = document.getElementById('new-student-name').value.trim();
    if (!studentName) { alert('Student name is required'); return; }
    var subjectName = document.getElementById('new-student-subject').value.trim();
    fetch('/tutoring/add-student', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            name: studentName,
            subject: subjectName,
            notes: document.getElementById('new-student-notes').value
        })
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
        var select = document.querySelector('select[name="student_id"]');
        var opt = document.createElement('option');
        opt.value = data.id;
        opt.textContent = data.name;
        select.insertBefore(opt, select.querySelector('option[value="__new__"]'));
        select.value = data.id;
        bootstrap.Modal.getInstance(document.getElementById('addStudentModal')).hide();
        document.getElementById('new-student-name').value = '';
        document.getElementById('new-student-subject').value = '';
        document.getElementById('new-student-notes').value = '';
    });
}
