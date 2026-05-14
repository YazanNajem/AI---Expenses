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
    })
    .catch(function (err) { alert(err.message); });
});

document.addEventListener('click', function (e) {
    var btn = e.target.closest('.delete-student-btn');
    if (!btn) return;
    if (!confirm('Delete student "' + btn.dataset.name + '" and all their sessions?')) return;
    var tr = btn.closest('tr');
    fetch('/api/tutoring/students/' + btn.dataset.id + '/delete', {
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
        // Also remove all session rows for this student
        var sid = btn.dataset.id;
        var sessionRows = document.querySelectorAll('.table-hover tbody tr[data-student="' + sid + '"]');
        sessionRows.forEach(function (row) { row.remove(); });
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
document.addEventListener('click', function (e) {
    var btn = e.target.closest('.edit-session-btn');
    if (!btn) return;
    var tr = btn.closest('tr');
    document.getElementById('edit-session-id').value = tr.dataset.id;
    document.getElementById('edit-session-student').value = tr.dataset.student;
    document.getElementById('edit-session-rate').value = tr.dataset.rate;
    document.getElementById('edit-session-hours').value = tr.dataset.hours;
    document.getElementById('edit-session-minutes').value = tr.dataset.minutes;
    document.getElementById('edit-session-date').value = tr.dataset.date;
    document.getElementById('edit-session-notes').value = tr.dataset.notes;
    document.getElementById('edit-session-paid').checked = tr.dataset.paid === '1';
    document.getElementById('edit-session-form').action = '/tutoring/edit-session/' + tr.dataset.id;
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

// ─── Add New Student ───
function addNewStudent() {
    var name = document.getElementById('new-student-name').value.trim();
    if (!name) { alert('Student name is required'); return; }
    fetch('/tutoring/add-student', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            name: name,
            subject: document.getElementById('new-student-subject').value,
            notes: document.getElementById('new-student-notes').value
        })
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
        var select = document.querySelector('select[name="student_id"]');
        var opt = document.createElement('option');
        opt.value = data.id;
        opt.textContent = data.name + (data.subject ? ' (' + data.subject + ')' : '');
        select.insertBefore(opt, select.querySelector('option[value="__new__"]'));
        select.value = data.id;
        bootstrap.Modal.getInstance(document.getElementById('addStudentModal')).hide();
        document.getElementById('new-student-name').value = '';
        document.getElementById('new-student-subject').value = '';
        document.getElementById('new-student-notes').value = '';
    });
}
