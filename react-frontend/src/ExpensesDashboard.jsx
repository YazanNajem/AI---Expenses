import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend } from 'chart.js';
import { Bar, Pie } from 'react-chartjs-2';
import { useUndo } from './hooks/useUndo';
import LoadingScreen from './LoadingScreen';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Plus, Pencil, Trash2, FileSpreadsheet, FileText, Eye, EyeOff, Check, ArrowRightLeft, X, Search, ClipboardList, ChevronDown, Bell, CalendarDays, ChevronLeft, ChevronRight, GripVertical } from 'lucide-react';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend);

function fmtAED(v) {
  const n = parseFloat(v) || 0;
  return 'AED ' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const playNotificationChime = () => {
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const audioCtx = new AudioContextClass();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const triggerTone = (freq, delay, duration, volume) => {
            setTimeout(() => {
                const osc = audioCtx.createOscillator();
                const gainNode = audioCtx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
                gainNode.gain.setValueAtTime(volume, audioCtx.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
                osc.connect(gainNode);
                gainNode.connect(audioCtx.destination);
                osc.start();
                osc.stop(audioCtx.currentTime + duration);
            }, delay);
        };
        triggerTone(659.25, 0, 0.25, 0.15);
        triggerTone(783.99, 80, 0.25, 0.15);
        triggerTone(1046.50, 160, 0.35, 0.20);
    } catch (err) {
        console.error("High-Fidelity audio hardware block:", err);
    }
};

const requestNotificationPermission = async () => {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
        try { await Notification.requestPermission(); } catch {}
    }
};

const sendNativeNotification = (title, body) => {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    if (!document.hidden) return;
    const options = { body, icon: '/logo.png', badge: '/icons.svg', requireInteraction: true };
    try {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.ready.then((reg) => {
                reg.showNotification(title, options);
            }).catch(() => {
                new Notification(title, options);
            });
        } else {
            new Notification(title, options);
        }
    } catch {}
};


export default function ExpensesDashboard({ wallet, setWallet, showToast, effectiveTheme, reminderVersion, setIsReminderModalOpen, onEditReminder, blurExpenses, toggleBlurExpenses }) {
  const isDark = effectiveTheme === 'dark';
  const { triggerUndo, UndoToastUI } = useUndo();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const dataLoadedRef = useRef(false);
  const [remindersList, setRemindersList] = useState([]);
  const [activeLiveAlerts, setActiveLiveAlerts] = useState([]);
  const [snoozedAlerts, setSnoozedAlerts] = useState({});
  const [dismissedAlertsKeys, setDismissedAlertsKeys] = useState({});
  const [showPopover, setShowPopover] = useState(false);
  const popoverRef = useRef(null);
  useEffect(() => {
    const handleClick = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target) && !e.target.closest('.floating-action-trigger')) {
        setShowPopover(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);
  const [isEditingSalary, setIsEditingSalary] = useState(false);
  const [salaryInputValue, setSalaryInputValue] = useState(wallet ? (wallet.personal_balance ?? 0).toString() : '18000');
  const [isEditingSpent, setIsEditingSpent] = useState(false);
  const salaryFormRef = useRef(null);
  const savingsFormRef = useRef(null);
  const [spentInputValue, setSpentInputValue] = useState(wallet ? (parseFloat(localStorage.getItem('expenses_spent_override')) || wallet.monthly_spent || 0).toString() : '0');
  const [isEditingSavings, setIsEditingSavings] = useState(false);
  const [savingsInputValue, setSavingsInputValue] = useState(wallet ? wallet.savings_balance?.toString() || '0' : '0');
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferAmount, setTransferAmount] = useState('');
  const [transferError, setTransferError] = useState('');
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferMode, setTransferMode] = useState('add');
  const [upcomingCommitments, setUpcomingCommitments] = useState([]);
  const [hideTotals, setHideTotals] = useState(() => localStorage.getItem('expenses_blur_totals') === 'true');
  const [hideCoreAssets, setHideCoreAssets] = useState(() => localStorage.getItem('expenses_blur_core') === 'true');
  const [hideTimeline, setHideTimeline] = useState(() => localStorage.getItem('expenses_blur_timeline') === 'true');
  const [breakdownCollapsed, setBreakdownCollapsed] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('bank');
  const [cashPaymentTxns, setCashPaymentTxns] = useState(() => { try { return JSON.parse(localStorage.getItem('cashPaymentTxns') || '{}'); } catch { return {}; } });
  const [cashWithdrawalTxns, setCashWithdrawalTxns] = useState(() => { try { return JSON.parse(localStorage.getItem('cashWithdrawalTxns') || '{}'); } catch { return {}; } });
  const navigate = useNavigate();

  const [portfolioAssets, setPortfolioAssets] = useState([]);
  const [cryptoUnitPrice, setCryptoUnitPrice] = useState(() => Number(localStorage.getItem('lastKnownCryptoPrice')) || null);
  const [portfolioLoaded, setPortfolioLoaded] = useState(false);

  useEffect(() => {
    const loadAssets = async () => {
      try {
        const aRes = await fetch('/api/portfolio/assets');
        const aData = await aRes.json();
        setPortfolioAssets(Array.isArray(aData) ? aData : []);
      } catch (e) { console.error('Portfolio assets fetch:', e); }
      finally { setPortfolioLoaded(true); }
    };
    loadAssets();
  }, []);

  useEffect(() => {
    const fetchCrypto = async () => {
      try {
        const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=aed');
        const d = await r.json();
        if (d?.bitcoin?.aed) {
          setCryptoUnitPrice(d.bitcoin.aed);
          localStorage.setItem('lastKnownCryptoPrice', String(d.bitcoin.aed));
        }
      } catch (e) { console.error('Crypto price fetch:', e); }
    };
    fetchCrypto();
    const iv = setInterval(fetchCrypto, 60000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => { localStorage.setItem('cashPaymentTxns', JSON.stringify(cashPaymentTxns)); }, [cashPaymentTxns]);
  useEffect(() => { localStorage.setItem('cashWithdrawalTxns', JSON.stringify(cashWithdrawalTxns)); }, [cashWithdrawalTxns]);

  useEffect(() => { localStorage.setItem('expenses_blur_totals', hideTotals); }, [hideTotals]);
  useEffect(() => { localStorage.setItem('expenses_blur_core', hideCoreAssets); }, [hideCoreAssets]);
  useEffect(() => { localStorage.setItem('expenses_blur_timeline', hideTimeline); }, [hideTimeline]);

  const handleSalaryUpdateSubmit = async (e) => {
    e.preventDefault();
    const parsedAmount = parseFloat(salaryInputValue);
    if (!isNaN(parsedAmount)) {
      try {
        const spentOverride = parseFloat(spentInputValue);
        const body = { new_balance: parsedAmount };
        if (!isNaN(spentOverride)) {
          body.monthly_spent = spentOverride;
        }
        const res = await fetch('/api/wallet/update_personal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!isNaN(spentOverride)) {
          localStorage.setItem('expenses_spent_override', spentOverride.toString());
          setData(prev => prev ? { ...prev, summary: { ...(prev.summary || {}), total_expenses: spentOverride } } : null);
        }
        setWallet(prev => ({ ...prev, ...data }));
        setIsEditingSalary(false);
      } catch (err) {
        console.error('Failed to persist salary configuration update:', err);
      }
    }
  };

  const handleSavingsUpdateSubmit = async (e) => {
    e.preventDefault();
    const parsedAmount = parseFloat(savingsInputValue);
    if (!isNaN(parsedAmount)) {
      try {
        const res = await fetch('/api/wallet/update_savings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ new_value: parsedAmount })
        });
        const data = await res.json();
        setWallet(prev => ({ ...prev, ...data }));
        setIsEditingSavings(false);
      } catch (err) {
        console.error('Failed to update savings:', err);
      }
    }
  };

  const fetchReminders = useCallback(async () => {
    try {
      const r = await fetch('/api/reminders');
      const d = await r.json();
      setRemindersList(d);
    } catch (_) {}
  }, []);

  useEffect(() => { fetchReminders(); }, [fetchReminders, reminderVersion]);

  const fetchUpcoming = useCallback(async () => {
    try {
      const r = await fetch('/api/reminders/upcoming');
      const d = await r.json();
      setUpcomingCommitments(d);
    } catch (_) {}
  }, []);

  useEffect(() => { fetchUpcoming(); }, [fetchUpcoming, reminderVersion]);

  const handleComplete = useCallback(async (id) => {
    try {
      const r = await fetch(`/api/commitments/${id}/complete`, { method: 'POST' });
      const d = await r.json();
      if (d.success) {
        setUpcomingCommitments(prev => prev.filter(c => c.id !== id));
      }
    } catch (_) {}
  }, []);

  // ── Wallet fetch on mount: survives hard refresh to /expenses ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/wallet/status');
        const d = await r.json();
        if (!cancelled && d && d.personal_balance !== undefined) setWallet(d);
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, []);

  // ── In-app live alerts (dual channel: in-app + daemon macOS + native OS) ──
  useEffect(() => {
    requestNotificationPermission();
  }, []);
  useEffect(() => {
    const runMasterAlarmClockCheck = () => {
      try {
        const now = new Date();
        const currentDay = Number(now.getDate());
        const currentHourMinute = now.toTimeString().substring(0, 5);
        const currentTimeStamp = now.getTime();

        setActiveLiveAlerts(prevVisibleAlerts => {
          try {
            let updatedVisibleAlerts = [...prevVisibleAlerts];
            remindersList.forEach(rem => {
              const targetDay = Number(rem.day_of_month);
              const targetTime = String(rem.time).trim();
              const uniqueSlotKey = `${currentDay}-${targetTime}`;
              const uniqueDismissKey = `${rem.id}-${uniqueSlotKey}`;
              const isExactMinuteStruck = (currentDay === targetDay && currentHourMinute === targetTime);
              const snoozeUntil = snoozedAlerts[rem.id] || 0;
              const isSnoozeActive = currentTimeStamp < snoozeUntil;
              const isAlreadyDismissed = dismissedAlertsKeys[uniqueDismissKey];

              if (isExactMinuteStruck && !isAlreadyDismissed && !isSnoozeActive) {
                const alreadyExists = updatedVisibleAlerts.some(a => a.id === rem.id);
                  if (!alreadyExists) {
                    updatedVisibleAlerts.push(rem);
                    playNotificationChime();
                    sendNativeNotification('Bill Reminder', `"${rem.title}" of AED ${Number(rem.amount).toFixed(0)} is due.`);
                  }
              }

              if (snoozeUntil > 0 && currentTimeStamp >= snoozeUntil && !isAlreadyDismissed) {
                const alreadyExists = updatedVisibleAlerts.some(a => a.id === rem.id);
                if (!alreadyExists) {
                    updatedVisibleAlerts.push(rem);
                    playNotificationChime();
                    sendNativeNotification('Bill Reminder (Snoozed)', `"${rem.title}" of AED ${Number(rem.amount).toFixed(0)} is due.`);
                    setSnoozedAlerts(prev => {
                      const copy = { ...prev };
                      delete copy[rem.id];
                      return copy;
                    });
                  }
              }
            });
            return updatedVisibleAlerts;
          } catch (_) {
            return prevVisibleAlerts;
          }
        });
      } catch (_) {}
    };

    runMasterAlarmClockCheck();
    const mainClockInterval = setInterval(runMasterAlarmClockCheck, 1000);
    return () => clearInterval(mainClockInterval);
  }, [remindersList, snoozedAlerts, dismissedAlertsKeys]);

  const handleSnoozeAlert = (reminderId) => {
    try {
      const fiveMinutesFromNow = Date.now() + 5 * 60 * 1000;
      setSnoozedAlerts(prev => ({ ...prev, [reminderId]: fiveMinutesFromNow }));
      setActiveLiveAlerts(prev => prev.filter(a => a.id !== reminderId));
    } catch (_) {}
  };

  const handleManualDismissAlert = (reminderId) => {
    try {
      const now = new Date();
      const currentDay = now.getDate();
      const currentHourMinute = now.toTimeString().substring(0, 5);
      const uniqueDismissKey = `${reminderId}-${currentDay}-${currentHourMinute}`;
      setDismissedAlertsKeys(prev => ({ ...prev, [uniqueDismissKey]: true }));
      setActiveLiveAlerts(prev => prev.filter(a => a.id !== reminderId));
    } catch (_) {}
  };

  const handleEnableNotifications = async () => {
    if (!('Notification' in window)) return;
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted' && 'serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification('System Connected', {
          body: 'macOS notifications are now active.',
          icon: '/logo.png',
          requireInteraction: true
        });
      }
    } catch {}
  };

  const handleEditReminderClick = (rem) => {
    onEditReminder(rem);
    setShowPopover(false);
  };

  const [selectedMonth, setSelectedMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [showAddForm, setShowAddForm] = useState(false);
  const expenseFormRef = useRef(null);
  const [editingExpense, setEditingExpense] = useState(null);
  const [form, setForm] = useState({ item_name: '', amount: '', category_id: '', transaction_date: new Date().toISOString().split('T')[0], notes: '', is_asset: false });
  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarViewDate, setCalendarViewDate] = useState(new Date());
  const [calRect, setCalRect] = useState({ top: 0, left: 0, width: 0 });
  const [mounted, setMounted] = useState(false);
  const calendarRef = useRef(null);
  const triggerRef = useRef(null);
  useEffect(() => setMounted(true), []);
  const [loanMeta, setLoanMeta] = useState(() => { try { return JSON.parse(localStorage.getItem('loanMeta') || '{}'); } catch { return {}; } });
  const [customCategoryMeta, setCustomCategoryMeta] = useState(() => { try { return JSON.parse(localStorage.getItem('customCategoryMeta') || '{}'); } catch { return {}; } });
  useEffect(() => { localStorage.setItem('loanMeta', JSON.stringify(loanMeta)); }, [loanMeta]);
  useEffect(() => { localStorage.setItem('customCategoryMeta', JSON.stringify(customCategoryMeta)); }, [customCategoryMeta]);
  useEffect(() => {
    const handler = e => {
      if (!showCalendar) return;
      if (!calendarRef.current || calendarRef.current.contains(e.target)) return;
      if (!triggerRef.current || triggerRef.current.contains(e.target)) return;
      setShowCalendar(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showCalendar]);
  useEffect(() => {
    if (!showCalendar) return;
    const sy = () => {
      if (triggerRef.current) {
        const r = triggerRef.current.getBoundingClientRect();
        setCalRect({ top: r.bottom + 8, left: r.left, width: r.width });
      }
    };
    sy();
    window.addEventListener('scroll', sy, true);
    window.addEventListener('resize', sy);
    return () => { window.removeEventListener('scroll', sy, true); window.removeEventListener('resize', sy); };
  }, [showCalendar]);
  const [editCategory, setEditCategory] = useState('');
  const [customCategory, setCustomCategory] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = selectedMonth === 'All' ? '' : '?month=' + selectedMonth;
      const [r, wrRes] = await Promise.all([
        fetch('/api/expenses' + params),
        fetch('/api/wallet/status')
      ]);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      if (d.error) { showToast(d.error, 'error'); return; }
      setData(d);
      dataLoadedRef.current = true;
      if (selectedMonth !== 'All') setSelectedMonth(d.month || selectedMonth);
      try { const wr = await wrRes.json(); if (!wr.error) setWallet(wr); } catch {}
    } catch (err) {
      console.error('Failed to load expenses:', err);
      if (!dataLoadedRef.current) setData({ summary: { total_expenses: 0, total_assets: 0, total_deducted: 0 }, breakdown: [], transactions: [], categories: [], months: [] });
    } finally {
      setLoading(false);
    }
  }, [selectedMonth, showToast, setWallet]);

  useEffect(() => { loadData(); }, [selectedMonth]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.item_name.trim() || !form.amount || !editCategory) return;

    if (editCategory === 'cash_withdrawal') {
      const amount = parseFloat(form.amount);
      if (!amount || amount <= 0) return;
      const r = await fetch('/api/cash/withdraw', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, item_name: form.item_name || 'Cash Withdrawal', transaction_date: form.transaction_date })
      });
      if (!r.ok) { const err = await r.json().catch(() => ({ error: r.statusText })); showToast(err.error || 'Server rejected the request', 'error'); return; }
      const d = await r.json();
      if (d.error) { showToast(d.error, 'error'); return; }
      if (d.wallet) setWallet(d.wallet);
      const withdrawalId = d.transaction?.id || d.id || d.expense?.id;
      if (withdrawalId) setCashWithdrawalTxns(prev => ({ ...prev, [withdrawalId]: true }));
      showToast(`Cash withdrawn: AED ${amount.toFixed(2)}`, 'success');
      setForm({ item_name: '', amount: '', category_id: '', transaction_date: new Date().toISOString().split('T')[0], notes: '', is_asset: false });
      setEditCategory(''); setCustomCategory(''); setCustomCategoryName('');
      setShowAddForm(false);
      await loadData();
      return;
    }

    const effectiveCat = editCategory;
    const catLower = effectiveCat.toLowerCase();
    if ((catLower === 'savings deposit' || catLower === 'add') && parseFloat(form.amount) > (wallet?.personal_balance || 0)) {
      showToast('المبلغ غير كافي في الراتب الأساسي لإتمام عملية الإيداع!', 'error');
      return;
    }
    const isLoan = effectiveCat === 'loan';
    const isCustom = ['sadaqa', 'instalments', 'barber', 'subscriptions', 'Proxy Purchase', 'others'].includes(effectiveCat);
    const catMatch = categories?.find(c => c.name === effectiveCat);
    const categoryId = isLoan ? (categories?.[0]?.id || 0) : isCustom ? (categories?.[0]?.id || 0) : (catMatch?.id || 0);
    const customText = editingExpense ? customCategory : customCategoryName;
    const resolvedCategory = effectiveCat === 'others' ? customText.trim() : (effectiveCat === 'loan' ? 'Loan / Lent Money' : effectiveCat);
    const url = editingExpense ? `/api/expenses/${editingExpense.id}/edit` : '/api/expenses/add';
    const method = editingExpense ? 'PUT' : 'POST';
    const tid = editingExpense?.id;
    const r = await fetch(url, {
      method, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, is_loan: isLoan, amount: parseFloat(form.amount), category_id: categoryId, custom_category: isCustom ? resolvedCategory : undefined, payment_method: paymentMethod })
    });
    const d = await r.json();
    if (d.error) { showToast(d.error, 'error'); return; }
    if (d.wallet) setWallet(d.wallet);
    if (d.summary) setData(prev => prev ? { ...prev, summary: d.summary } : null);
    const savedId = d.transaction?.id || d.id || d.expense?.id || tid;
    if (paymentMethod === 'cash' && !editingExpense && savedId) {
      setCashPaymentTxns(prev => ({ ...prev, [savedId]: true }));
    }
    if (isLoan && (d.transaction?.id || d.id || tid)) {
      setLoanMeta(prev => ({ ...prev, [d.transaction?.id || d.id || tid]: { isLoan: true, isSettled: false } }));
    }
    if (isCustom && !isLoan && savedId) {
      setCustomCategoryMeta(prev => ({ ...prev, [savedId]: { displayName: resolvedCategory } }));
    }
    // Cleanup stale customCategoryMeta if the edit changed the category
    if (tid && tid !== savedId) {
      setCustomCategoryMeta(prev => { const n = { ...prev }; delete n[tid]; return n; });
      setLoanMeta(prev => { const n = { ...prev }; delete n[tid]; return n; });
      setCashPaymentTxns(prev => { const n = { ...prev }; delete n[tid]; return n; });
    }
    showToast(editingExpense ? 'Expense updated.' : 'Expense added.', 'success', editingExpense ? undefined : () => {
      fetch(`/api/expenses/${savedId}/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month: selectedMonth === 'All' ? new Date().toISOString().slice(0, 7) : selectedMonth }) }).then(r => r.json()).then(d2 => { if (d2.wallet) setWallet(d2.wallet); if (paymentMethod === 'cash' && savedId) { setCashPaymentTxns(prev => { const n = { ...prev }; delete n[savedId]; return n; }); } loadData(); }).catch(() => {});
    });
    setForm({ item_name: '', amount: '', category_id: '', transaction_date: new Date().toISOString().split('T')[0], notes: '', is_asset: false });
    setCustomCategoryName(''); setEditCategory(''); setCustomCategory('');
    setEditingExpense(null);
    setShowAddForm(false);
    setPaymentMethod('bank');
    await loadData();
  };

  const handleSilentDeleteExpense = async (expense) => {
    const monthForApi = selectedMonth === 'All' ? new Date().toISOString().slice(0, 7) : selectedMonth;
    const deletedExpense = expense;
    const wasCash = !!cashPaymentTxns[expense.id];
    try {
      const res = await fetch(`/api/expenses/${expense.id}/delete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: monthForApi })
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      if (d.wallet) setWallet(d.wallet);
      setCustomCategoryMeta(prev => { const n = { ...prev }; delete n[expense.id]; return n; });
      setLoanMeta(prev => { const n = { ...prev }; delete n[expense.id]; return n; });
      setCashPaymentTxns(prev => { const n = { ...prev }; delete n[expense.id]; return n; });
      setCashWithdrawalTxns(prev => { const n = { ...prev }; delete n[expense.id]; return n; });
      showToast('Expense deleted.', 'success', () => {
        if (wasCash) {
          setCashPaymentTxns(prev => ({ ...prev, [deletedExpense.id]: true }));
        }
        const catName = deletedExpense.category_name || '';
        const isLoan = catName.toLowerCase() === 'loan';
        const isCustom = ['sadaqa', 'instalments', 'barber', 'subscriptions', 'Proxy Purchase', 'others'].includes(catName);
        fetch('/api/expenses/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item_name: deletedExpense.item_name, amount: parseFloat(deletedExpense.amount), category_id: deletedExpense.category_id, transaction_date: deletedExpense.transaction_date, notes: deletedExpense.notes || '', is_asset: !!deletedExpense.is_asset, is_loan: isLoan, custom_category: isCustom ? catName : undefined, payment_method: wasCash ? 'cash' : 'bank' }) }).then(r => r.json()).then(d2 => { if (d2.wallet) setWallet(d2.wallet); loadData(); }).catch(() => {});
      });
      await loadData();
    } catch (err) {
      console.error('Delete failed:', err);
      showToast('Failed to delete expense. Please try again.', 'error');
    }
  };

  const handleMarkLoanPaid = (expense) => {
    setLoanMeta(prev => {
      const next = { ...prev, [expense.id]: { ...(prev[expense.id] || {}), isLoan: true, isSettled: true } };
      localStorage.setItem('loanMeta', JSON.stringify(next));
      return next;
    });
    setWallet(prev => {
      if (!prev) return prev;
      return { ...prev, savings_balance: (parseFloat(prev.savings_balance) || 0) + (parseFloat(expense.amount) || 0) };
    });
    showToast(`Loan "${expense.item_name}" marked as paid. AED ${parseFloat(expense.amount).toFixed(2)} refunded.`, 'success');
  };

  const startEdit = (t) => {
    setEditingExpense(t);
    const cm = customCategoryMeta; const lm = loanMeta;
    const catOverride = cm[t.id]?.displayName || '';
    const predefined = ['loan', 'sadaqa', 'instalments', 'barber', 'subscriptions', 'Proxy Purchase', 'others'];
    if (lm[t.id]?.isLoan) {
      setEditCategory('loan');
      setCustomCategory('');
    } else if (catOverride && predefined.includes(catOverride)) {
      setEditCategory(catOverride);
      setCustomCategory('');
    } else if (catOverride) {
      setEditCategory('others');
      setCustomCategory(catOverride);
    } else {
      setEditCategory(t.category_name || String(t.category_id));
      setCustomCategory('');
    }
    setForm({ item_name: t.item_name, amount: t.amount.toString(), category_id: t.category_id, transaction_date: t.transaction_date, notes: t.notes || '', is_asset: !!t.is_asset });
    setPaymentMethod((t.payment_method || 'bank') === 'cash' ? 'cash' : 'bank');
    setShowAddForm(true);
  };

  const exportData = async () => {
    const monthForApi = selectedMonth === 'All' ? '' : selectedMonth;
    const resp = await fetch('/api/export/expenses' + (monthForApi ? '?month=' + monthForApi : ''));
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'expenses_' + (monthForApi || 'all') + '.xlsx'; a.click();
    URL.revokeObjectURL(url);
  };

  const handleSilentDeleteReminder = (rem) => {
    triggerUndo(
      `Deleted: ${rem.title}`,
      () => setRemindersList(prev => prev.filter(r => r.id !== rem.id)),
      () => {
        fetch(`/api/reminders/${rem.id}/delete`, { method: 'POST' })
          .catch(err => console.error('Delete reminder failed:', err));
      },
      () => setRemindersList(prev => [...prev, rem].sort((a, b) => a.day_of_month - b.day_of_month))
    );
  };

  const { summary, breakdown: backendBreakdown, transactions, categories, months } = data || {};
  const effectiveSpentTotal = useMemo(() => {
    if (!transactions || transactions.length === 0) return 0;
    return transactions
      .filter(t => {
        if (selectedMonth === 'All') return true;
        return t.transaction_date?.startsWith(selectedMonth);
      })
      .reduce((sum, t) => {
        const rawCat = (t.category_name || '').toLowerCase();
        if (rawCat === 'internal transfer' || rawCat === 'savings deposit' || rawCat === 'withdraw' || rawCat === 'add') return sum;
        return sum + (Number(t.amount) || 0);
      }, 0);
  }, [transactions, selectedMonth]);
  const cashBalance = useMemo(() => {
    if (!transactions) return 0;
    const withdrawals = transactions.filter(t => cashWithdrawalTxns[t.id]).reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const cashSpends = transactions.filter(t => cashPaymentTxns[t.id]).reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const bal = withdrawals - cashSpends;
    return Math.abs(bal) < 0.001 ? 0 : Number(bal.toFixed(2));
  }, [transactions, cashWithdrawalTxns, cashPaymentTxns]);
  const breakdown = useMemo(() => {
    if (!transactions || transactions.length === 0) return backendBreakdown || [];
    const bd = {};
    transactions.forEach(t => {
      const rawCat = (t.category_name || '').toLowerCase();
      if (rawCat === 'internal transfer' || rawCat === 'savings deposit' || rawCat === 'withdraw' || rawCat === 'add') return;
      const catMetaDisplay = (customCategoryMeta[t.id]?.displayName || '').toLowerCase();
      if (catMetaDisplay === 'proxy purchase') return;
      const isLoan = loanMeta[t.id]?.isLoan || t.is_loan || rawCat.includes('loan');
      const displayName = isLoan ? 'Loan / Lent Money' : (customCategoryMeta[t.id]?.displayName ? customCategoryMeta[t.id].displayName.charAt(0).toUpperCase() + customCategoryMeta[t.id].displayName.slice(1) : t.category_name);
      if (!bd[displayName]) bd[displayName] = { name: displayName, total: 0, is_asset: false };
      bd[displayName].total += t.amount;
      if (t.is_asset) bd[displayName].is_asset = true;
    });
    const grand = Object.values(bd).reduce((sum, b) => sum + b.total, 0) || 1;
    return Object.values(bd).map(b => ({ ...b, percentage: parseFloat(((b.total / grand) * 100).toFixed(1)) }));
  }, [transactions, backendBreakdown, loanMeta, customCategoryMeta]);
  const currentMonthStr = new Date().toISOString().slice(0, 7);
  const availableExpensesMonths = [...new Set([currentMonthStr, ...(months || [])])];

  const currentMonthKey = new Date().toISOString().slice(0, 7);
  const storageKey = `dismissed_commitments_${currentMonthKey}`;
  const [dismissedIds, setDismissedIds] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(dismissedIds));
  }, [dismissedIds, storageKey]);

  const handleDismiss = (id) => {
    setDismissedIds(prev => {
      if (prev.includes(id)) return prev;
      return [...prev, id];
    });
  };

  const [txPage, setTxPage] = useState(1);
  const [txSearch, setTxSearch] = useState('');
  const itemsPerPage = 5;
  const [tasks, setTasks] = useState(() => {
    try { return JSON.parse(localStorage.getItem('daily_tasks_list')) || []; } catch { return []; }
  });
  const [deleteMode, setDeleteMode] = useState(false);
  const [selectedForDeletion, setSelectedForDeletion] = useState([]);
  const [taskInput, setTaskInput] = useState('');
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [customCategoryName, setCustomCategoryName] = useState('');
  const [isTasksOpen, setIsTasksOpen] = useState(false);
  const tasksRef = useRef(null);
  const tasksTriggerRef = useRef(null);
  useEffect(() => { localStorage.setItem('daily_tasks_list', JSON.stringify(tasks)); }, [tasks]);
  useEffect(() => {
    if (!isTasksOpen) return;
    const cb = (e) => {
      if (tasksRef.current && !tasksRef.current.contains(e.target) && tasksTriggerRef.current && !tasksTriggerRef.current.contains(e.target)) {
        setIsTasksOpen(false);
      }
    };
    document.addEventListener('mousedown', cb);
    return () => document.removeEventListener('mousedown', cb);
  }, [isTasksOpen]);
  useEffect(() => { setTxPage(1); }, [selectedMonth]);

  if (loading && !data) return <LoadingScreen />;
  if (!data) return null;

  const filteredExpensesList = (transactions || []).filter(t => {
    if (selectedMonth === 'All') return true;
    return t.transaction_date?.startsWith(selectedMonth);
  });
  const searchedList = filteredExpensesList.filter(t => {
    if (!txSearch) return true;
    const q = txSearch.toLowerCase();
    return (t.item_name || '').toLowerCase().includes(q) || (t.category_name || '').toLowerCase().includes(q);
  });
  const filteredExpensesTotal = filteredExpensesList.reduce((sum, t) => {
    const meta = loanMeta[t.id];
    if (meta?.isLoan && meta?.isSettled) return sum;
    if (cashPaymentTxns[t.id]) return sum;
    const rawCat = (t.category_name || '').toLowerCase();
    const catMeta = (customCategoryMeta[t.id]?.displayName || '').toLowerCase();
    if (rawCat === 'internal transfer' || rawCat === 'savings deposit' || rawCat === 'withdraw' || rawCat === 'add' || catMeta === 'proxy purchase') return sum;
    return sum + (Number(t.amount) || 0);
  }, 0);
  const searchedTotal = searchedList.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  const indexOfLastItem = txPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentTransactions = searchedList.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(searchedList.length / itemsPerPage);
  const exportTransactions = () => {
    const header = 'Item,Category,Amount,Type,Date\n';
    const rows = filteredExpensesList.map(t => {
      const type = cashWithdrawalTxns[t.id] ? 'Cash Withdrawal' : t.category_name === 'Internal Transfer' ? 'Withdraw' : t.category_name === 'Savings Deposit' ? 'Deposit' : t.is_asset ? 'Asset' : 'Expense';
      return `"${t.item_name}","${t.category_name}",${t.amount},"${type}",${t.transaction_date}`;
    }).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `transactions_${selectedMonth === 'All' ? 'all' : selectedMonth}.csv`; a.click();
    URL.revokeObjectURL(url);
  };
  const exportTransactionsPDF = () => {
    try {
      const doc = new jsPDF();
      const savings = parseFloat(wallet?.savings_balance) || 0;
      const totalSpent = parseFloat(filteredExpensesTotal) || 0;
      const BASE_SALARY = 4500;
      const spentFromSalary = Math.min(totalSpent, BASE_SALARY);
      const spentFromSavings = Math.max(0, totalSpent - BASE_SALARY);

      doc.setFontSize(18);
      doc.text('VaultTrack Expense Report', 14, 20);
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.text(`Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, 14, 28);

      const rows = filteredExpensesList.map(t => {
        const type = cashWithdrawalTxns[t.id] ? 'Cash Withdrawal' : t.category_name === 'Internal Transfer' ? 'Withdraw' : t.category_name === 'Savings Deposit' ? 'Deposit' : t.is_asset ? 'Asset' : 'Expense';
        return [t.transaction_date, t.item_name, t.category_name, `AED ${Number(t.amount).toFixed(2)}`, type];
      });

      autoTable(doc, {
        startY: 36,
        head: [['Date', 'Title', 'Category', 'Amount', 'Type']],
        body: rows,
        theme: 'striped',
        headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontSize: 9 },
        bodyStyles: { fontSize: 8 },
        columnStyles: { 3: { halign: 'right' } },
        margin: { left: 14, right: 14 }
      });

      const finalY = doc.lastAutoTable.finalY + 12;
      doc.setDrawColor(200);
      doc.line(14, finalY, 196, finalY);
      doc.setFontSize(12);
      doc.setTextColor(30, 30, 30);
      doc.text('Summary', 14, finalY + 8);
      doc.setFontSize(10);
      doc.text(`Total Spent This Month: AED ${totalSpent.toFixed(2)}`, 14, finalY + 16);
      doc.text(`Spent from Salary: AED ${spentFromSalary.toFixed(2)}`, 14, finalY + 23);
      doc.text(`Spent from Savings: AED ${spentFromSavings.toFixed(2)}`, 14, finalY + 30);
      doc.text(`Current Savings Balance: AED ${savings.toFixed(2)}`, 14, finalY + 37);

      const pdfName = selectedMonth === 'All' ? 'Expense_Report_All_Months.pdf' : `Expense_Report_${new Date(selectedMonth + '-01').toLocaleString('en-US', { year: 'numeric', month: 'long' }).replace(/\s+/g, '_')}.pdf`;
      doc.save(pdfName);
    } catch (err) {
      console.error('PDF Generation Failed:', err);
      showToast('PDF Error: ' + err.message, 'error');
    }
  };

  const barData = (breakdown || []).length ? {
    labels: breakdown.map(b => b.name + (b.is_asset ? ' (A)' : '')),
    datasets: [{ label: 'Amount (AED)', data: breakdown.map(b => b.total), backgroundColor: breakdown.map((_, i) => ['#28a745','#ffc107','#dc3545','#0dcaf0','#6f42c1','#fd7e14','#20c997','#e83e8c'][i % 8]), borderWidth: 1 }]
  } : null;

  const pieData = (breakdown || []).length ? {
    labels: breakdown.map(b => b.name),
    datasets: [{ data: breakdown.map(b => b.total), backgroundColor: ['#28a745','#ffc107','#dc3545','#0dcaf0','#6f42c1','#fd7e14','#20c997','#e83e8c'] }]
  } : null;

  const todayDay = new Date().getDate();
  const sorted = [...upcomingCommitments]
    .map(c => {
      const now = new Date();
      const normalizedNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const day = Number(c.day_of_month);
      if (day > 0) {
        let targetYear = now.getFullYear();
        let targetMonth = now.getMonth();
        let due = new Date(targetYear, targetMonth, day);
        if (due < normalizedNow) {
          targetMonth++;
          if (targetMonth > 11) { targetMonth = 0; targetYear++; }
          due = new Date(targetYear, targetMonth, day);
        }
        return { ...c, days_remaining: Math.round((due - normalizedNow) / (1000 * 60 * 60 * 24)) };
      }
      return { ...c, days_remaining: Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - normalizedNow) / (1000 * 60 * 60 * 24)) };
    })
    .filter(c => c.days_remaining <= 2)
    .sort((a, b) => a.days_remaining - b.days_remaining);
  const activeCommitments = sorted.filter(c => !dismissedIds.includes(c.id));

  let cryptoQty = 0;
  let goldQty = 0;
  for (const a of portfolioAssets) {
    if (a.asset_type === 'crypto') cryptoQty += parseFloat(a?.quantity || 0);
    if (a.asset_type === 'gold') goldQty += Number(a?.weight_g || a?.quantity || 0);
  }
  const tcf = Number(wallet?.personal_balance ?? 0) + Number(wallet?.savings_balance ?? 0) + (Number(cryptoQty || 0) * Number(cryptoUnitPrice || 0)) + (Number(goldQty || 0) * Number(wallet?.gold_live_price || 0));
  const liveAssetsCurrentValue = (Number(cryptoQty || 0) * Number(cryptoUnitPrice || 0)) + (Number(goldQty || 0) * Number(wallet?.gold_live_price || 0));

  return (
    <div className="container pb-4">
      {activeLiveAlerts.length > 0 && (
        <div className="ios-notification-container">
          {activeLiveAlerts.map(alert => (
            <div key={alert.id} className="ios-neon-toast">
              <div className="d-flex align-items-center gap-4">
                <div className="toast-icon-receptacle">
                  <Bell size={18} strokeWidth={1.5} />
                </div>
                <div className="d-flex flex-column">
                  <div className="toast-title-text">{alert.title}</div>
                  <div className="toast-subtitle-text">Due on day {alert.day_of_month} at {alert.time}</div>
                </div>
                <div className="toast-right-col">
                  <span className="toast-amount-text">AED {Number(alert.amount).toFixed(0)}</span>
                  <button className="toast-snooze-btn" onClick={() => handleSnoozeAlert(alert.id)}>Snooze</button>
                  <button className="toast-glass-close" onClick={() => handleManualDismissAlert(alert.id)}>
                    <X size={14} strokeWidth={2} />
                  </button>
                </div>
              </div>
              <div className="toast-progress-bar" />
            </div>
          ))}
        </div>
      )}

      {/* ── Savings Hub Modal (Add / Withdraw) ── */}
      {showTransferModal && (
        <div className="transfer-modal-overlay" onClick={() => setShowTransferModal(false)}>
          <div className="transfer-modal-card" onClick={e => e.stopPropagation()}>
            <div className="d-flex justify-content-between align-items-center mb-3">
              <span style={{ fontSize: '0.85rem', fontWeight: 700, letterSpacing: '0.03em' }}>
                {transferMode === 'add' ? 'Add to Savings' : 'Withdraw from Savings'}
              </span>
              <button
                className="btn btn-link p-0 text-muted"
                onClick={() => setShowTransferModal(false)}
                style={{ background: 'none', border: 'none', textDecoration: 'none' }}
              >
                <X size={18} />
              </button>
            </div>
            {/* Mode toggle */}
            <div className="d-flex mb-3" style={{ background: 'rgba(128,128,128,0.1)', borderRadius: '8px', padding: '3px' }}>
              <button
                className="btn btn-sm flex-fill"
                style={{
                  fontSize: '0.7rem', fontWeight: 600, borderRadius: '6px',
                  background: transferMode === 'add' ? '#22c55e' : 'transparent',
                  border: 'none', color: transferMode === 'add' ? '#fff' : '#aaa',
                  transition: 'all 0.2s'
                }}
                onClick={() => { setTransferMode('add'); setTransferError(''); }}
              >
                Add
              </button>
              <button
                className="btn btn-sm flex-fill"
                style={{
                  fontSize: '0.7rem', fontWeight: 600, borderRadius: '6px',
                  background: transferMode === 'withdraw' ? '#dc3545' : 'transparent',
                  border: 'none', color: transferMode === 'withdraw' ? '#fff' : '#aaa',
                  transition: 'all 0.2s'
                }}
                onClick={() => { setTransferMode('withdraw'); setTransferError(''); }}
              >
                Withdraw
              </button>
            </div>
            <div className="mb-3">
              <div style={{ fontSize: '0.65rem', color: '#6c757d', marginBottom: '6px' }}>
                Savings Balance: {fmtAED(Number(wallet.savings_balance || 0))}
              </div>
              <input
                type="number"
                step="0.01"
                min="0"
                className="form-control form-control-lg text-center"
                style={{ fontSize: '1.1rem', fontWeight: 600 }}
                placeholder="0.00"
                value={transferAmount}
                onChange={e => { setTransferAmount(e.target.value); setTransferError(''); }}
                autoFocus
              />
              {transferError && (
                <div style={{ fontSize: '0.7rem', color: '#ff4444', marginTop: '6px' }}>{transferError}</div>
              )}
            </div>
            <div className="d-flex gap-2">
              <button
                className="btn btn-secondary flex-fill"
                style={{ fontSize: '0.75rem', fontWeight: 600 }}
                onClick={() => setShowTransferModal(false)}
              >
                Cancel
              </button>
              <button
                className="btn flex-fill"
                style={{
                  fontSize: '0.75rem', fontWeight: 700, border: 'none', color: '#fff',
                  background: transferMode === 'add'
                    ? 'linear-gradient(135deg, #22c55e, #16a34a)'
                    : 'linear-gradient(135deg, #f59e0b, #dc3545)'
                }}
                disabled={isTransferring}
                onClick={async () => {
                  const amt = parseFloat(transferAmount);
                  if (isNaN(amt) || amt <= 0) { setTransferError('Enter a positive amount'); return; }
                  if (transferMode === 'withdraw' && amt > (wallet.savings_balance || 0)) { setTransferError('Insufficient savings'); return; }
                  if (transferMode === 'add' && amt > (wallet.personal_balance || 0)) { setTransferError('Not Enough Balance Available!'); return; }
                  setIsTransferring(true);
                  try {
                    const r = await fetch('/api/wallet/transfer', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ amount: amt, type: transferMode })
                    });
                    const d = await r.json();
                    if (d.error) { setTransferError(d.error); setIsTransferring(false); return; }
                    if (d.wallet) setWallet(prev => ({ ...prev, ...d.wallet }));
                    setShowTransferModal(false);
                    loadData();
                  } catch (e) {
                    setTransferError('Operation failed. Try again.');
                  }
                  setIsTransferring(false);
                }}
              >
                {isTransferring ? 'Processing…' : transferMode === 'add' ? 'Add' : 'Withdraw'}
              </button>
            </div>
          </div>
        </div>
      )}

      {wallet && (
        <div className="w-100 mb-4">
          <div className="d-flex align-items-center justify-content-between w-100 mb-3">
            <span className="small text-muted fw-bold" style={{ letterSpacing: '0.05em', textTransform: 'uppercase' }}>Totals</span>
          <button
            className="btn btn-sm glass-btn px-2 py-1 rounded-2 d-inline-flex align-items-center justify-content-center gap-1"
            onClick={toggleBlurExpenses}
            title="Toggle amounts visibility"
          >
            {blurExpenses ? <EyeOff size={16} /> : <Eye size={16} />}
            <span style={{ fontSize: '0.7rem', fontWeight: 500, letterSpacing: '0.03em' }}>{blurExpenses ? 'Show Balance' : 'Hide Balance'}</span>
          </button>
          </div>
          <div className="expenses-balance-card">
            <div className="d-flex flex-column gap-1">
              <span style={{ fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#6c757d', fontSize: '0.7rem' }}>Total Combined Funds</span>
              <div className={`balance-glow-amount ${blurExpenses || hideTotals ? 'blur-md pointer-events-none select-none' : ''}`} style={{ transition: 'filter 0.3s', fontSize: '1.5rem', fontWeight: 700 }}>
                {fmtAED(tcf)}
              </div>
              <div style={{ fontSize: '0.7rem', letterSpacing: '0.02em', color: '#6c757d' }}>
                Core Salary + Savings:{' '}
                <span className={`${blurExpenses || hideTotals ? 'blur-md pointer-events-none select-none' : ''}`} style={{ transition: 'filter 0.3s', color: '#28a745', fontWeight: 600 }}>
                  AED {fmtAED(Number(wallet?.personal_balance ?? 0) + Number(wallet?.savings_balance ?? 0))}
                </span>
              </div>
            </div>
            <div className="d-flex flex-column align-items-end justify-content-center">
              <span className="badge bg-success bg-opacity-10 text-success border border-success border-opacity-25 px-3 py-1.5 rounded-pill fw-bold" style={{ fontSize: '0.75rem' }}>
                Portfolio Sync Active
              </span>
            </div>
          </div>
          <div className="w-100" style={{ height: '1.25rem' }} />
          <div className="d-flex align-items-center justify-content-between w-100 mb-2">
            <span className="small text-muted fw-bold" style={{ letterSpacing: '0.05em', textTransform: 'uppercase' }}>Core Assets</span>
          <button
            className="btn btn-sm glass-btn px-2 py-1 rounded-2 d-inline-flex align-items-center justify-content-center"
            onClick={() => setHideCoreAssets(p => !p)}
            title="Toggle amounts visibility"
          >
            {hideCoreAssets ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
          </div>
          <div className="asset-sub-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {/* Card 1: Core Salary Balance */}
            <div className="asset-mini-card" style={{ position: 'relative' }}>
              <div className="d-flex justify-content-between align-items-center">
                <span style={{ color: '#6c757d', fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Core Salary Balance</span>
                {!isEditingSalary && (
                  <button
                    className="btn btn-link p-0 text-muted hover-white"
                    title="Edit Salary Value"
                    onClick={() => { setSalaryInputValue((wallet.personal_balance ?? 0).toString()); setSpentInputValue((wallet.monthly_spent || 0).toString()); setIsEditingSalary(true); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    <Pencil size={12} />
                  </button>
                )}
              </div>
              {isEditingSalary ? (
                <form ref={salaryFormRef} onSubmit={handleSalaryUpdateSubmit} className="d-flex flex-column gap-2 mt-2">
                  <div className="d-flex align-items-center gap-2">
                    <span style={{ fontSize: '0.65rem', color: '#6c757d', minWidth: '50px' }}>Salary</span>
                    <input type="number" step="0.01" className="form-control form-control-sm text-white bg-dark border-secondary py-0.5 px-2" style={{ fontSize: '0.85rem', flex: 1 }} value={salaryInputValue} required onChange={e => setSalaryInputValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} onBlur={() => { if (salaryFormRef.current) salaryFormRef.current.requestSubmit(); }} autoFocus />
                  </div>
                  <div className="d-flex align-items-center gap-2">
                    <span style={{ fontSize: '0.65rem', color: '#6c757d', minWidth: '50px' }}>Spent</span>
                    <input type="number" step="0.01" className="form-control form-control-sm text-white bg-dark border-secondary py-0.5 px-2" style={{ fontSize: '0.85rem', flex: 1 }} value={spentInputValue} onChange={e => setSpentInputValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} onBlur={() => { if (salaryFormRef.current) salaryFormRef.current.requestSubmit(); }} />
                  </div>
                  <div className="d-flex gap-2">
                    <button type="submit" className="btn btn-sm btn-primary py-0.5 px-2.5 fw-bold" style={{ fontSize: '0.75rem' }} onMouseDown={e => e.preventDefault()}>Save</button>
                    <button type="button" className="btn btn-sm btn-outline-secondary py-0.5 px-2" style={{ fontSize: '0.75rem' }} onClick={() => setIsEditingSalary(false)}>X</button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="d-flex justify-content-between align-items-center mt-1">
                    <span style={{ fontSize: '0.65rem', color: '#6c757d' }}>Gross Salary</span>
                    <div className={`${hideCoreAssets ? 'blur-md pointer-events-none select-none' : ''}`} style={{ transition: 'filter 0.3s', fontWeight: 700 }}>
                      AED {fmtAED(Math.abs(Number(wallet?.personal_balance ?? 0)) < 0.01 ? 0 : Number(wallet?.personal_balance ?? 0))}
                    </div>
                  </div>
                  <div className="d-flex justify-content-between align-items-center mt-1">
                    <span style={{ fontSize: '0.65rem', color: '#f87171' }}>Spent This Month</span>
                    <div className={`${hideCoreAssets ? 'blur-md pointer-events-none select-none' : ''}`} style={{ transition: 'filter 0.3s', color: '#f87171' }}>
                      {fmtAED(effectiveSpentTotal)}
                    </div>
                  </div>
                </>
              )}
              <span style={{ fontSize: '0.65rem', color: '#6c757d' }} className="mt-auto">Excludes additional teaching/lesson income</span>
            </div>

            {/* Card 2: Savings */}
            <div className="asset-mini-card" style={{ position: 'relative' }}>
              <div className="d-flex justify-content-between align-items-center">
                <span style={{ color: '#6c757d', fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Savings</span>
                <div className="d-flex gap-1">
                  {!isEditingSavings && (
                    <button
                      className="btn btn-link p-0 text-muted hover-white"
                      title="Add or Withdraw Savings"
                      onClick={() => { setShowTransferModal(true); setTransferAmount(''); setTransferError(''); setTransferMode('add'); }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                      <ArrowRightLeft size={12} />
                    </button>
                  )}
                  {!isEditingSavings && (
                    <button
                      className="btn btn-link p-0 text-muted hover-white"
                      title="Edit Savings"
                      onClick={() => { setSavingsInputValue((wallet.savings_balance || 0).toString()); setIsEditingSavings(true); }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                      <Pencil size={12} />
                    </button>
                  )}
                </div>
              </div>
              {isEditingSavings ? (
                <form ref={savingsFormRef} onSubmit={handleSavingsUpdateSubmit} className="d-flex gap-2 mt-2">
                  <input type="number" step="0.01" className="form-control form-control-sm text-white bg-dark border-secondary py-0.5 px-2" style={{ fontSize: '0.85rem', flex: 1 }} value={savingsInputValue} required onChange={e => setSavingsInputValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} onBlur={() => { if (savingsFormRef.current) savingsFormRef.current.requestSubmit(); }} autoFocus />
                  <div className="d-flex gap-1">
                    <button type="submit" className="btn btn-sm btn-primary py-0.5 px-2.5 fw-bold" style={{ fontSize: '0.75rem' }} onMouseDown={e => e.preventDefault()}>Save</button>
                    <button type="button" className="btn btn-sm btn-outline-secondary py-0.5 px-2" style={{ fontSize: '0.75rem' }} onClick={() => setIsEditingSavings(false)}>X</button>
                  </div>
                </form>
              ) : (
                <div className={`mt-1 ${hideCoreAssets ? 'blur-md pointer-events-none select-none' : ''}`} style={{ transition: 'filter 0.3s', color: '#28a745', fontWeight: 700, fontSize: '1rem' }}>
                  AED {fmtAED(Number(wallet.savings_balance || 0))}
                </div>
              )}
              <span style={{ fontSize: '0.65rem', color: '#6c757d' }} className="mt-auto">Accumulated savings</span>
            </div>

            {/* Card 3: Total Combined Funds */}
            <div className="asset-mini-card" style={{ borderLeft: '3px solid #22c55e' }}>
              <div className="d-flex align-items-center gap-2">
                <span className="text-muted fw-bold" style={{ fontSize: '0.7rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Total Combined Funds</span>
              </div>
              <div className={`mt-1 ${hideCoreAssets ? 'blur-md pointer-events-none select-none' : ''}`} style={{ transition: 'filter 0.3s', fontWeight: 700, fontSize: '1.1rem' }}>
                {fmtAED(tcf)}
              </div>
              <span style={{ fontSize: '0.65rem', color: '#6c757d', display: 'block', marginBottom: '4px' }}>Salary + Savings + Assets</span>

              {/* NEW SUB-TOTAL INJECTED HERE */}
              <div className="mt-1 pt-1" style={{ borderTop: '1px dashed #e2e8f0' }}>
                <span style={{ fontSize: '0.7rem', color: '#6c757d', fontWeight: 600 }}>Salary + Savings: </span>
                <span className={`${hideCoreAssets ? 'blur-md pointer-events-none select-none' : ''}`} style={{ transition: 'filter 0.3s', fontSize: '0.75rem', fontWeight: 700, color: '#28a745' }}>
                  AED {fmtAED(Number((Number(wallet?.personal_balance ?? 0) || 0) + (Number(wallet?.savings_balance ?? 0) || 0)))}
                </span>
              </div>
            </div>

            {/* Gold & Assets (full width below cards) */}
            <div className="asset-mini-card" style={{ gridColumn: '1 / -1', borderLeft: '3px solid #f59e0b', cursor: 'pointer', transition: 'transform 0.2s, background 0.2s' }} onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.01)'; e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }} onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.background = 'transparent'; }} onClick={() => navigate('/portfolio')}>
              <div className="d-flex align-items-center gap-2">
                <span className="text-muted fw-bold" style={{ fontSize: '0.7rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Gold & Assets Value</span>
                {(wallet?.gold_live_price || 0) > 0 && (
                  <div className="d-flex align-items-center gap-1 ms-auto">
                    <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#22c55e', display: 'inline-block', animation: 'pulse 2s infinite' }}></span>
                    <span style={{ fontSize: '0.6rem', color: '#22c55e', fontWeight: 600 }}>24K {fmtAED(wallet?.gold_live_price || 0)}/g</span>
                  </div>
                )}
              </div>
              <div className={`d-flex flex-wrap align-items-baseline gap-4 mt-1 ${hideCoreAssets ? 'blur-md pointer-events-none select-none' : ''}`} style={{ transition: 'filter 0.3s' }}>
                <div>
                  <span style={{ fontSize: '0.65rem', color: '#6c757d', display: 'block' }}>Purchase Price</span>
                  <span className="text-gold-glow" style={{ fontSize: '1.6rem', fontWeight: 700 }}>
                    AED {fmtAED(Number(wallet?.total_assets_invested || 0))}
                  </span>
                </div>
                <div>
                  <span style={{ fontSize: '0.65rem', color: '#6c757d', display: 'block' }}>Current Value</span>
                  <span style={{ fontSize: '1.6rem', fontWeight: 700, color: '#f59e0b' }}>
                    AED {fmtAED(portfolioAssets.length > 0 ? liveAssetsCurrentValue : Number(wallet?.total_assets_invested ?? 0))}
                  </span>
                </div>
              </div>
              <div className={`d-flex flex-wrap gap-3 mt-1 ${hideCoreAssets ? 'blur-md pointer-events-none select-none' : ''}`} style={{ transition: 'filter 0.3s' }}>
                {wallet?.total_assets_invested > 0 && (
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: portfolioAssets.length > 0 ? (liveAssetsCurrentValue > (wallet?.total_assets_invested || 0) ? '#22c55e' : liveAssetsCurrentValue < (wallet?.total_assets_invested || 0) ? '#dc3545' : '#6c757d') : '#6c757d' }}>
                    P&L: {portfolioAssets.length > 0 ? ((liveAssetsCurrentValue - (wallet?.total_assets_invested || 0)) >= 0 ? '+' : '') : ''}AED {fmtAED(portfolioAssets.length > 0 ? Math.abs(liveAssetsCurrentValue - (wallet?.total_assets_invested || 0)) : 0)}
                    {portfolioAssets.length > 0 && (wallet?.total_assets_invested || 0) > 0 && (
                      <> ({(liveAssetsCurrentValue - (wallet?.total_assets_invested || 0)) >= 0 ? '+' : ''}{((liveAssetsCurrentValue - (wallet?.total_assets_invested || 0)) / (wallet?.total_assets_invested || 1) * 100).toFixed(1)}%)</>
                    )}
                  </span>
                )}
              </div>
              <div className="d-flex flex-wrap gap-3 mt-1">
                {(wallet?.portfolio_gold_count || 0) > 0 && (
                  <span style={{ fontSize: '0.65rem', color: '#6c757d' }}>
                    {wallet?.portfolio_gold_count || 0} item{(wallet?.portfolio_gold_count || 0) !== 1 ? 's' : ''} · {(wallet?.portfolio_gold_weight || 0).toFixed(2)}g
                  </span>
                )}
                {(wallet?.total_assets_invested || 0) > 0 && (
                  <span style={{ fontSize: '0.65rem', color: '#f59e0b' }}>
                    Investments: {fmtAED(Number(wallet?.total_assets_invested || 0))}
                  </span>
                )}
              </div>
              <span style={{ fontSize: '0.65rem', color: '#6c757d' }}>Click to view ledger</span>
            </div>
          </div>
        </div>
      )}
      <div className="d-flex align-items-center justify-content-between w-100 mb-3">
        <div style={{ color: '#6c757d', fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Upcoming Commitments Timeline</div>
        <button
            className="btn btn-sm glass-btn px-2 py-1 rounded-2 d-inline-flex align-items-center justify-content-center"
            onClick={() => setHideTimeline(p => !p)}
          >
            {hideTimeline ? <EyeOff size={16} /> : <Eye size={16} />}
            <span style={{ fontSize: '0.7rem', fontWeight: 500, letterSpacing: '0.03em' }}></span>
          </button>
      </div>
      <div className={`glass-timeline mb-4 d-flex flex-column gap-3 ${activeCommitments.length === 0 ? 'opacity-50' : ''}`} style={{ transition: 'filter 0.3s, opacity 0.3s' }}>
        <div className={`${hideTimeline ? 'blur-md pointer-events-none select-none' : ''}`} style={{ transition: 'filter 0.3s' }}>
        {activeCommitments.length > 0 ? (
            <div className="row g-3">
              {activeCommitments.map(c => {
                const isOverdue = c.days_remaining < 0;
                const isSoon = c.days_remaining <= 2;
                const label = isOverdue
                  ? `${Math.abs(c.days_remaining)} day${Math.abs(c.days_remaining) !== 1 ? 's' : ''} overdue`
                  : c.days_remaining === 0
                    ? 'Due today'
                    : c.days_remaining === 1
                      ? 'Due tomorrow'
                      : `${c.days_remaining} days remaining`;
                return (
                  <div key={c.id} className="col-md-3">
                    <div className={`timeline-node ${isOverdue || c.days_remaining === 0 ? 'node-active-alert' : ''}`}>
                      <div className="d-flex justify-content-between align-items-center">
                        <div style={{ fontWeight: 700, fontSize: '0.875rem' }}>{c.title}</div>
                        <span className="badge" style={{ fontSize: '0.6rem', background: c.category === 'Bills' ? 'rgba(220,53,69,0.15)' : 'rgba(13,202,240,0.15)', color: c.category === 'Bills' ? '#dc3545' : '#0dcaf0' }}>{c.category}</span>
                      </div>
                      <div className="mt-1" style={{ fontSize: '0.85rem', color: '#28a745', fontWeight: 600 }}>
                        {fmtAED(Number(c.amount))}
                      </div>
                      <div className={`fw-bold small mt-1 ${isOverdue || c.days_remaining === 0 ? 'text-danger' : 'text-muted'}`}>
                        {label}
                      </div>
                      <div className="mt-2">
                        <button className="done-btn" onClick={() => handleDismiss(c.id)}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Done
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-5" style={{ color: '#64748b', fontSize: '0.85rem' }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '8px', opacity: 0.5 }}>
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
                <line x1="9" y1="16" x2="15" y2="16"/>
              </svg>
              <div>No upcoming reminders at this time.</div>
              <div style={{ color: '#94a3b8', fontSize: '0.75rem', marginTop: '4px' }}>Add a reminder to see it here.</div>
            </div>
          )}
        </div>
        </div>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3 mt-2">
        <div className="d-flex align-items-center gap-3 flex-wrap">
          <div className="d-flex align-items-center gap-2">
            <label className="small fw-bold text-muted text-nowrap m-0">Filter by Month:</label>
            <select className={`form-select form-select-sm ${isDark ? 'bg-dark text-white border-secondary' : ''}`} value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} style={{ width: '160px' }}>
              <option value="All">All Months</option>
              {availableExpensesMonths.map(m => (
                <option key={m} value={m}>{new Date(m + '-01').toLocaleString('en-US', { year: 'numeric', month: 'long' })}</option>
              ))}
            </select>
          </div>
          <div className="d-flex align-items-center gap-1">
            <Search size={15} strokeWidth={2} className="text-muted" />
            <input type="text" className={`form-control form-control-sm ${isDark ? 'bg-dark text-white border-secondary' : ''}`} placeholder="Search transactions..." value={txSearch} onChange={e => { setTxSearch(e.target.value); setTxPage(1); }} style={{ width: '190px' }} />
          </div>
          <div className={`badge p-2 rounded ${isDark ? 'bg-secondary text-white' : 'bg-light text-dark'}`} style={{ fontSize: '0.85rem', border: '1px solid rgba(255,255,255,0.1)' }}>
            <span className="text-muted me-1">Total Expenses:</span>
            <span className="fw-bold text-danger">{fmtAED(filteredExpensesTotal)}</span>
          </div>
          </div>
        <div className="d-flex gap-2">
          <button className="btn btn-success btn-sm" onClick={exportData}><FileSpreadsheet size={16} strokeWidth={2} className="me-1" /> Export</button>
          <button className="btn btn-outline-secondary btn-sm" onClick={exportTransactionsPDF}><FileText size={16} strokeWidth={2} className="me-1" /> PDF</button>
        </div>
      </div>

      <div className="row g-3 mb-4">
        <div className="col-md-4"><div className="card border-danger h-100"><div className="card-body text-center">
            <h6 className="card-subtitle text-muted" style={{ color: '#6c757d' }}>Total Expenses</h6>
        <h2 className={`card-title text-danger mt-2 mb-0 ${hideTotals ? 'blur-md pointer-events-none select-none' : ''}`} style={{ transition: 'filter 0.3s' }}>{fmtAED(effectiveSpentTotal)}</h2></div></div></div>
        <div className="col-md-4"><div className="card border-info h-100"><div className="card-body text-center">
          <h6 className="card-subtitle text-muted" style={{ color: '#6c757d' }}>Total Assets</h6>
        <h2 className={`card-title text-info mt-2 mb-0 ${hideTotals ? 'blur-md pointer-events-none select-none' : ''}`} style={{ transition: 'filter 0.3s' }}>{fmtAED(summary?.total_assets || 0)}</h2></div></div></div>
        <div className="col-md-4"><div className="card border-dark h-100"><div className="card-body text-center">
          <h6 className="card-subtitle text-muted" style={{ color: '#6c757d' }}>Total Deducted</h6>
        <h2 className={`card-title mt-2 mb-0 ${hideTotals ? 'blur-md pointer-events-none select-none' : ''}`} style={{ transition: 'filter 0.3s' }}>{fmtAED(summary?.total_deducted || 0)}</h2></div></div></div>
      </div>

      {showAddForm && (
        <div ref={expenseFormRef} id="expense-form-target" className="card mb-4">
          <div className="card-header d-flex justify-content-between align-items-center">
            <strong>{editingExpense ? 'Edit Expense' : 'Add New Expense'}</strong>
            <button className={`btn-close ${isDark ? 'btn-close-white' : ''}`} onClick={() => { setShowAddForm(false); setEditingExpense(null); setEditCategory(''); setCustomCategory(''); setCustomCategoryName(''); }}></button>
          </div>
          <div className="card-body">
            <form onSubmit={handleSubmit}>
              <div className="row g-4">
                <div className="col-md-4"><label className="form-label">Item Name</label><input className="form-control" value={form.item_name} onChange={e => setForm({...form, item_name: e.target.value})} required /></div>
                <div className="col-md-3"><label className="form-label">Amount (AED)</label><input type="number" className="form-control" step="0.01" min="0.01" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} required /></div>
                <div className="col-md-3"><label className="form-label">Category</label>
                  <select className="form-select" value={editCategory} onChange={e => { const v = e.target.value; setEditCategory(v); setForm({...form, category_id: v}); if (v !== 'others') { setCustomCategory(''); setCustomCategoryName(''); } if (v === 'cash_withdrawal') setPaymentMethod('bank'); }} required>
                    <option value="" disabled>Select a category...</option>
                    <option value="loan">Loan / Lent Money</option>
                    <option value="sadaqa">Sadaqa</option>
                    <option value="instalments">Instalments</option>
                    <option value="barber">Barber</option>
                    <option value="subscriptions">Subscriptions</option>
                    <option value="cash_withdrawal">Cash Withdrawal</option>
                    <option value="Proxy Purchase">Proxy Purchase</option>
                    {(categories || []).filter(c => c.name !== 'Loan' && c.name !== 'Cash Withdrawal').map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                    <option value="others">Others</option>
                  </select>
                  {editCategory === 'others' && (
                    <input className="form-control mt-2" placeholder="Enter custom category..." value={editingExpense ? customCategory : customCategoryName} onChange={e => { const v = e.target.value; setCustomCategory(v); setCustomCategoryName(v); }} required />
                  )}
                </div>
                <div className="col-md-2" style={{ position: 'relative' }}>
                  <label className="form-label">Date</label>
                  <div className="calendar-trigger" ref={triggerRef} onClick={() => setShowCalendar(p => !p)}>
                    <CalendarDays size={16} className="calendar-trigger-icon" />
                    <span className="calendar-trigger-text">
                      {form.transaction_date
                        ? new Date(form.transaction_date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                        : 'Select date'}
                    </span>
                    <ChevronDown size={14} className={`calendar-trigger-chevron ${showCalendar ? 'open' : ''}`} />
                  </div>
                  {showCalendar && mounted && createPortal(
                    <div className="glass-calendar" ref={calendarRef} onClick={e => { if (e && e.stopPropagation) e.stopPropagation(); }} style={{ position: 'fixed', top: calRect.top, left: calRect.left }}>
                      {(() => {
                        const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
                        const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
                        const calDate = new Date(calendarViewDate);
                        const year = calDate.getFullYear();
                        const month = calDate.getMonth();
                        const daysInMonth = new Date(year, month + 1, 0).getDate();
                        const firstDay = new Date(year, month, 1).getDay();
                        const today = new Date();
                        const todayStr = today.toISOString().split('T')[0];
                        const curSel = form.transaction_date;
                        const go = d => { const ds = year+'-'+String(month+1).padStart(2,'0')+'-'+String(d).padStart(2,'0'); setForm({...form, transaction_date: ds}); setShowCalendar(false); };
                        const cells = [];
                        for (let i = 0; i < firstDay; i++) cells.push(<div key={'e'+i} className="cal-day cal-day-empty" />);
                        for (let d = 1; d <= daysInMonth; d++) {
                          const ds = year+'-'+String(month+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
                          const isSel = ds === curSel;
                          const isToday = ds === todayStr;
                          cells.push(
                            <div key={d} className={`cal-day${isSel ? ' cal-day-selected' : ''}${isToday ? ' cal-day-today' : ''}`} onClick={() => go(d)}>
                              {d}
                            </div>
                          );
                        }
                        return (
                          <>
                            <div className="cal-header">
                              <button className="cal-nav-btn" onClick={() => setCalendarViewDate(new Date(year, month - 1, 1))}><ChevronLeft size={16} /></button>
                              <span className="cal-header-title">{monthNames[month]} {year}</span>
                              <button className="cal-nav-btn" onClick={() => setCalendarViewDate(new Date(year, month + 1, 1))}><ChevronRight size={16} /></button>
                            </div>
                            <div className="cal-day-names">
                              {dayNames.map(n => <div key={n} className="cal-day-name">{n}</div>)}
                            </div>
                            <div className="cal-days-grid">
                              {cells}
                            </div>
                          </>
                        );
                      })()}
                    </div>,
                    document.body
                  )}
                </div>
                <div className="col-md-6"><label className="form-label">Notes</label><input className="form-control" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} placeholder="Optional..." /></div>
                <div className="col-md-2 d-flex align-items-end gap-2"><div className="form-check"><input className="form-check-input" type="checkbox" id="asset-toggle" checked={form.is_asset} onChange={e => setForm({...form, is_asset: e.target.checked})} /><label className="form-check-label" htmlFor="asset-toggle">Asset</label></div>
                  <select className="form-select form-select-sm" value={editCategory === 'Withdraw Cash' ? 'bank' : paymentMethod} onChange={e => setPaymentMethod(e.target.value)} style={{ width: 'auto', fontSize: '0.75rem' }} disabled={editCategory === 'Withdraw Cash'}>
                    <option value="bank">Bank</option>
                    <option value="cash">Cash</option>
                  </select>
                </div>
                <div className="col-md-4 d-flex align-items-end"><button type="submit" className="btn btn-primary">{editingExpense ? 'Update' : 'Save'}</button></div>
              </div>
            </form>
          </div>
        </div>
      )}

      {(breakdown || []).length > 0 && (
        <div className="row g-3 mb-4">
          <div className="col-md-6">
            {/* ... existing content ... */}
          </div>
        </div>
      )}

      {(breakdown || []).length > 0 && (
        <div className="card mb-4">
          <div className="card-header d-flex align-items-center justify-content-between">
            <div className="d-flex align-items-center gap-3">
              <strong>Category Breakdown</strong>
              <div className="cash-wallet-badge">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="cash-wallet-icon"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>
                <span className="cash-wallet-label">Cash Wallet:</span>
                <span className="cash-wallet-value">{fmtAED(cashBalance)}</span>
              </div>
            </div>
            <button
              className="breakdown-toggle"
              onClick={() => setBreakdownCollapsed(c => !c)}
              aria-label="Toggle category breakdown"
            >
              <ChevronDown size={18} strokeWidth={2} className={`chevron ${breakdownCollapsed ? '' : 'rotated'}`} />
            </button>
          </div>
          <div className={`collapse-wrap ${breakdownCollapsed ? 'collapsed' : ''}`}>
            <div className="card-body">
              {breakdown.map((b, i) => (
                <div key={i} className="mb-2">
                  <div className="d-flex justify-content-between small"><span>{b.name} {b.is_asset ? '(Asset)' : ''}</span><span>{fmtAED(b.total)} ({b.percentage}%)</span></div>
                  <div className="progress" style={{ height: 8 }}><div className="progress-bar" style={{ width: b.percentage + '%' }}></div></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className={`card mb-4 ${isDark ? 'bg-dark text-white border-secondary' : ''}`}>
        <div className={`card-header d-flex align-items-center justify-content-between ${isDark ? 'bg-secondary text-white border-secondary' : ''}`}><strong>Transactions</strong>
          <button className="btn btn-sm btn-success d-flex align-items-center gap-1 px-3" onClick={exportTransactions}><FileSpreadsheet size={16} strokeWidth={2} /> Export to Excel</button>
        </div>
        <div className={`card-body p-0 ${isDark ? 'bg-dark' : ''}`}>
          {searchedList.length === 0 ? <div className={`p-3 ${isDark ? 'text-white-50' : 'text-muted'}`}>{txSearch ? `No transactions matching "${txSearch}".` : 'No transactions for this filter.'}</div> : (
            <div className="table-responsive">
              <table className={`table table-hover mb-0 ${isDark ? 'table-dark table-borderless' : ''}`}>
                <thead className={isDark ? 'border-bottom border-secondary' : 'table-light'}>
                  <tr><th>#</th><th>Item</th><th>Category</th><th>Amount</th><th>Type</th><th>Date</th><th className="text-end">Actions</th></tr>
                </thead>
                <tbody>
                    {currentTransactions.map((t, i) => {
                    const isWithdraw = t.category_name === 'Internal Transfer' && !cashWithdrawalTxns[t.id];
                    const isCashWithdrawal = cashWithdrawalTxns[t.id];
                    const isDeposit = t.category_name === 'Savings Deposit';
                    const isLoan = loanMeta[t.id]?.isLoan || t.is_loan || t.category_name?.toLowerCase().includes('loan');
                    const isSettled = loanMeta[t.id]?.isSettled;
                    const displayCat = isCashWithdrawal ? 'Cash Withdrawal' : isLoan ? 'Loan / Lent Money' : (customCategoryMeta[t.id]?.displayName ? customCategoryMeta[t.id].displayName.charAt(0).toUpperCase() + customCategoryMeta[t.id].displayName.slice(1) : t.category_name);
                    const isProxyPurchase = displayCat === 'Proxy Purchase';
                    const isCashPayment = cashPaymentTxns[t.id];
                    const rowStyle = isCashWithdrawal ? { color: '#16a34a', background: 'rgba(22,163,74,0.06)' } : isProxyPurchase ? { color: '#16a34a', background: 'rgba(22,163,74,0.08)' } : isWithdraw ? { color: '#ff4444', background: 'rgba(220,53,69,0.06)' } : isDeposit ? { color: '#22c55e', background: 'rgba(34,197,94,0.06)' } : isLoan ? (isSettled ? { color: '#6b7280', background: 'rgba(107,114,128,0.06)', textDecoration: 'line-through' } : { color: '#dc2626', background: 'rgba(220,38,38,0.06)' }) : {};
                    const cellStyle = isCashWithdrawal ? { color: '#16a34a' } : isProxyPurchase ? { color: '#16a34a' } : isWithdraw ? { color: '#ff4444' } : isDeposit ? { color: '#22c55e' } : isLoan ? (isSettled ? { color: '#6b7280', textDecoration: 'line-through' } : { color: '#dc2626' }) : {};
                    return (
                      <tr key={t.id} style={rowStyle}>
                        <td style={cellStyle}>{indexOfFirstItem + i + 1}</td>
                        <td style={cellStyle}>{t.item_name}</td>
                        <td style={cellStyle}>{displayCat}</td>
                        <td className="fw-bold" style={cellStyle}>{fmtAED(t.amount)}</td>
                        <td>{isCashWithdrawal
                          ? <span className="badge-glass-deposit">Cash Withdrawal</span>
                          : isWithdraw
                            ? <span className="badge-glass-expense">Withdraw</span>
                            : isDeposit
                              ? <span className="badge-glass-deposit">Deposit</span>
                              : t.is_asset
                                ? <span className="badge-glass-other">Asset</span>
                                : isLoan
                                  ? <span className={isSettled ? 'badge-glass-other' : 'badge-glass-expense'}>{isSettled ? 'Settled' : 'Loan'}</span>
                                  : <span className="badge-glass-expense">Expense</span>
                        }{isCashPayment && <span className="badge-glass-cash ms-1">Cash</span>}</td>
                        <td style={cellStyle}>{t.transaction_date}</td>
                        <td className="text-end">
                          <div className="d-flex gap-1 justify-content-end">
                            {isLoan && !isSettled && (
                              <button className="btn btn-sm btn-outline-success" title="Mark as Paid" onClick={() => handleMarkLoanPaid(t)} style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem' }}>Paid</button>
                            )}
                            {isLoan && isSettled && (
                              <span className="badge bg-secondary" style={{ fontSize: '0.7rem' }}>Settled</span>
                            )}
                            <button className="action-btn action-btn-edit" title="Edit Expense" onClick={() => startEdit(t)}><Pencil size={16} strokeWidth={2} /></button>
                            <button className="action-btn action-btn-delete" title="Delete Expense" onClick={() => handleSilentDeleteExpense(t)}><Trash2 size={16} strokeWidth={2} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {searchedList.length > itemsPerPage && (
            <div className="d-flex justify-content-between align-items-center px-3 py-2 border-top" style={{ borderColor: isDark ? 'rgba(255,255,255,0.1)' : '#e2e8f0' }}>
              <span className="small text-muted">Showing {indexOfFirstItem + 1}–{Math.min(indexOfLastItem, searchedList.length)} of {searchedList.length}</span>
              <nav className="d-flex align-items-center gap-2">
                <button className="btn btn-sm btn-outline-secondary" disabled={txPage === 1} onClick={() => setTxPage(p => p - 1)}>&laquo; Prev</button>
                <span className="small text-muted">Page {txPage} of {totalPages}</span>
                <button className="btn btn-sm btn-outline-secondary" disabled={txPage >= totalPages} onClick={() => setTxPage(p => p + 1)}>Next &raquo;</button>
              </nav>
            </div>
          )}
        </div>
      </div>

      <button ref={tasksTriggerRef} className="tasks-trigger-btn" onClick={() => setIsTasksOpen(o => !o)} title="Toggle Tasks">
        <ClipboardList size={20} strokeWidth={1.5} />
      </button>
      {isTasksOpen && (
      <div ref={tasksRef} className="tasks-panel">
        <div className="tasks-card">
          <div className="tasks-header">
            <span className="tasks-title">Daily Tasks</span>
            <button className={`btn btn-sm ${deleteMode ? 'btn-danger' : 'btn-outline-secondary'} border-0 p-1`} onClick={() => {
              if (deleteMode && selectedForDeletion.length > 0) {
                setTasks(prev => prev.filter(t => !selectedForDeletion.includes(t.id)));
                setSelectedForDeletion([]);
                setDeleteMode(false);
              } else {
                setDeleteMode(!deleteMode);
                if (deleteMode) setSelectedForDeletion([]);
              }
            }} title={deleteMode ? 'Confirm Delete' : 'Delete Tasks'}>
              <Trash2 size={15} strokeWidth={2} />
            </button>
          </div>
          <div className="tasks-body">
            {tasks.length === 0 && !deleteMode && (
              <div className="text-muted small text-center py-3" style={{ fontSize: '0.75rem' }}>No tasks yet. Add one below.</div>
            )}
            {tasks.map((task, idx) => {
              const isSelected = selectedForDeletion.includes(task.id);
              const isEditing = editingTaskId === task.id;
              return (
                <div key={task.id} className={`task-item-row ${isSelected ? 'task-item-selected' : ''} ${isEditing ? 'task-item-editing' : ''} ${dragIndex === idx ? 'task-dragging' : ''} ${dragOverIndex === idx ? 'task-drag-over' : ''}`} draggable={!isEditing} onDragStart={e => { setDragIndex(idx); e.dataTransfer.effectAllowed = 'move'; }} onDragEnter={e => { e.preventDefault(); setDragOverIndex(idx); }} onDragOver={e => e.preventDefault()} onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); }} onDrop={e => { e.preventDefault(); if (dragIndex === null || dragIndex === idx) { setDragIndex(null); setDragOverIndex(null); return; } setTasks(prev => { const a = [...prev]; const [m] = a.splice(dragIndex, 1); a.splice(idx, 0, m); return a; }); setDragIndex(null); setDragOverIndex(null); }}>
                  {!isEditing && (
                    <span className="task-drag-handle"><GripVertical size={13} strokeWidth={1.5} /></span>
                  )}
                  {!isEditing && (
                    <span className={`task-check-circle ${task.completed ? 'task-checked' : ''}`} onClick={() => {
                      if (!deleteMode) setTasks(prev => prev.map(t => t.id === task.id ? { ...t, completed: !t.completed } : t));
                    }}>
                      {task.completed && <Check size={11} strokeWidth={3} color="#fff" />}
                    </span>
                  )}
                  {isEditing ? (
                    <div className="task-edit-wrap">
                      <textarea
                        className="task-edit-input"
                        rows={2}
                        dir="auto"
                        value={editingText}
                        onChange={e => setEditingText(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey && editingText.trim()) {
                            e.preventDefault();
                            setTasks(prev => prev.map(t => t.id === task.id ? { ...t, text: editingText.trim() } : t));
                            setEditingTaskId(null);
                          }
                          if (e.key === 'Escape') setEditingTaskId(null);
                        }}
                        autoFocus
                      />
                      <div className="task-edit-actions">
                        <button className="task-edit-save" onClick={() => { if (editingText.trim()) { setTasks(prev => prev.map(t => t.id === task.id ? { ...t, text: editingText.trim() } : t)); setEditingTaskId(null); } }} title="Save">
                          <Check size={14} strokeWidth={2.5} />
                        </button>
                        <button className="task-edit-cancel" onClick={() => setEditingTaskId(null)} title="Cancel">
                          <X size={14} strokeWidth={2.5} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span className={`task-text ${task.completed ? 'task-text-done' : ''}`} dir="auto" onClick={() => {
                        if (deleteMode) {
                          setSelectedForDeletion(prev => prev.includes(task.id) ? prev.filter(id => id !== task.id) : [...prev, task.id]);
                        }
                      }}>{task.text}</span>
                      {!deleteMode && (
                        <button className="task-edit-btn" onClick={e => { e.stopPropagation(); setEditingTaskId(task.id); setEditingText(task.text); }} title="Edit">
                          <Pencil size={12} strokeWidth={2} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              );
            })}
            {!deleteMode && (
              <textarea
                className="task-input resize-none"
                rows={2}
                dir="auto"
                placeholder="+ Add a task..."
                value={taskInput}
                onChange={e => setTaskInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey && taskInput.trim()) {
                    e.preventDefault();
                    setTasks(prev => [...prev, { id: Date.now(), text: taskInput.trim(), completed: false }]);
                    setTaskInput('');
                  }
                }}
              />
            )}
          </div>
        </div>
      </div>)}
      {UndoToastUI}

      {!showAddForm && (
        <button className="fab-btn" onClick={() => { setShowAddForm(true); setEditingExpense(null); setEditCategory(''); setCustomCategory(''); setForm({ item_name: '', amount: '', category_id: '', transaction_date: new Date().toISOString().split('T')[0], notes: '', is_asset: false }); setTimeout(() => { const el = document.getElementById('expense-form-target'); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); const parent = el.closest('.container') || el.parentElement; if (parent) { const top = el.getBoundingClientRect().top + parent.scrollTop - parent.getBoundingClientRect().top - 20; parent.scrollTo({ top, behavior: 'smooth' }); } el.querySelector('input,textarea,select')?.focus(); } }, 300); }}>
          <Plus size={20} strokeWidth={2} />
          <span>Add Expense</span>
        </button>
      )}

      <div className="reminder-widget-container" onClick={(e) => e.stopPropagation()}>
        <button className="floating-action-trigger" title="Toggle Managed Reminders" onClick={(e) => { e.stopPropagation(); setShowPopover(!showPopover); }}>
          <Plus size={24} strokeWidth={2.5} />
        </button>
        {showPopover && (
          <div ref={popoverRef} className="reminders-popover-panel">
            <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
              <span className="small text-muted fw-bold" style={{ letterSpacing: '0.05em', textTransform: 'uppercase' }}>Active Alarms</span>
              <div className="d-flex align-items-center gap-2">
                <button className="desktop-alert-btn" onClick={handleEnableNotifications}>Enable Desktop Alerts</button>
                <button className="btn btn-sm btn-outline-primary px-2 py-1 rounded" style={{ fontSize: '0.75rem' }} onClick={(e) => { e.stopPropagation(); setIsReminderModalOpen(true); setShowPopover(false); }}>
                  + New Alert
                </button>
              </div>
            </div>
            <div className="d-flex flex-column gap-2" style={{ maxHeight: '260px', overflowY: 'auto' }}>
              {remindersList.length === 0 ? (
                <div className="text-muted small p-2 text-center">No active billing alarms set.</div>
              ) : (
                remindersList.map(rem => {
                  const sev = rem.category === 'Housing' || rem.category === 'Bills' || rem.category === 'Car' ? 'critical' : rem.category === 'Subscriptions' || rem.category === 'Telecom' || rem.category === 'Smoking' || rem.category === 'Patrol' ? 'warning' : 'info';
                  return (
                  <div key={rem.id} className={`alarm-item-row ${sev}`}>
                    <div className="d-flex flex-column">
                      <span className="fw-bold alarm-title" style={{ fontSize: '0.85rem' }}>{rem.title}</span>
                      <span className="text-muted" style={{ fontSize: '0.7rem' }}>Day {rem.day_of_month} at {rem.time}</span>
                    </div>
                    <div className="d-flex align-items-center gap-2">
                      <span className="text-danger fw-bold small" style={{ fontSize: '0.8rem' }}>AED {Number(rem.amount).toFixed(0)}</span>
                      <button className="action-btn action-btn-edit p-1" title="Edit Alarm Parameters" onClick={() => handleEditReminderClick(rem)}>
                        <Pencil size={13} />
                      </button>
                      <button className="action-btn action-btn-delete p-1" title="Delete" onClick={() => handleSilentDeleteReminder(rem)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

    </div>
  );
}