import { useState, useEffect, useRef, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import 'bootstrap/dist/css/bootstrap.min.css';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend } from 'chart.js';
import { Pie } from 'react-chartjs-2';
import { fetchTutoringData, addSession, editSession, deleteSession, addStudent, editStudent, deleteStudent, fetchStudentData } from './api';
import { AuthProvider, ProtectedRoute } from './AuthContext';
import { fmtAED, sendWhatsApp, generateInvoice } from './helpers';
import ExpensesDashboard from './ExpensesDashboard';
import LandingPage from './LandingPage';
import Login from './Login';
import Register from './Register';
import PortfolioDashboard from './PortfolioDashboard';
import StudentProfile from './StudentProfile';
import AccountSettings from './AccountSettings';
import NotFoundPage from './NotFoundPage';
import LoadingScreen from './LoadingScreen';
import { useUndo } from './hooks/useUndo';
import SmartStudentSelector from './SmartStudentSelector';
import { Eye, EyeOff, Pencil, Trash2, FileText, MessageCircle, FileSpreadsheet, Sun, Moon, Monitor, Plus, RotateCcw, Settings as SettingsIcon } from 'lucide-react';
import logoImage from './assets/logo.png';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend);

/* ─── Helpers ─── */
function useDebounce(val, ms = 200) {
  const [d, s] = useState(val);
  useEffect(() => { const t = setTimeout(() => s(val), ms); return () => clearTimeout(t); }, [val, ms]);
  return d;
}

/* ─── useTheme Hook ─── */
function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'system');
  const getEffective = useCallback((t) => {
    if (t === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    return t;
  }, []);
  const [effectiveTheme, setEffectiveTheme] = useState(() => getEffective(theme));
  useEffect(() => {
    const eff = getEffective(theme);
    setEffectiveTheme(eff);
    document.documentElement.classList.toggle('dark', eff === 'dark');
    localStorage.setItem('theme', theme);
  }, [theme, getEffective]);
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => {
      const eff = e.matches ? 'dark' : 'light';
      setEffectiveTheme(eff);
      document.documentElement.classList.toggle('dark', eff === 'dark');
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);
  return { theme, setTheme, effectiveTheme };
}

/* ─── Toast Component ─── */
/* ─── Liquid Glass Toast ─── */
function ToastItem({ toast, onClose }) {
  const [removing, setRemoving] = useState(false);
  const timerRef = useRef(null);
  useEffect(() => {
    if (!toast.msg) return;
    timerRef.current = setTimeout(() => {
      setRemoving(true);
      setTimeout(() => onClose(toast.id), 250);
    }, 5000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [toast, onClose]);
  if (!toast.msg) return null;
  const icons = { success: '\u2713', error: '\u2715', warning: '!' };
  const handleUndo = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    toast.onUndo && toast.onUndo();
    setRemoving(true);
    setTimeout(() => onClose(toast.id), 250);
  };
  return (
    <div className={`toast-glass toast-${toast.type || 'success'}${removing ? ' removing' : ''}`}>
      <span style={{ fontWeight: 700, fontSize: '0.8rem', width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 9999, background: toast.type === 'error' ? 'rgba(239,68,68,0.3)' : toast.type === 'warning' ? 'rgba(245,158,11,0.3)' : 'rgba(5,150,105,0.3)' }}>{icons[toast.type || 'success']}</span>
      <span className="flex-grow-1">{toast.msg}</span>
      {toast.onUndo && (
        <button className="toast-close-btn" onClick={handleUndo} title="Undo" style={{ width: 26, height: 26 }}>
          <RotateCcw size={14} strokeWidth={2} />
        </button>
      )}
      <button className="toast-close-btn" onClick={() => { setRemoving(true); setTimeout(() => onClose(toast.id), 250); }}><span style={{ fontSize: '0.9rem', lineHeight: 1 }}>&times;</span></button>
    </div>
  );
}

function ToastContainer({ toasts, onClose }) {
  if (!toasts || toasts.length === 0) return null;
  return (
    <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 1060, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, pointerEvents: 'none', maxWidth: 420, width: 'max-content' }}>
      {toasts.map(t => <ToastItem key={t.id} toast={t} onClose={onClose} />)}
    </div>
  );
}

/* ─── Undo Toast ─── */
function UndoToast({ message, onUndo, duration = 5000 }) {
  const [progress, setProgress] = useState(100);
  const startRef = useRef(Date.now());
  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
      setProgress(remaining);
      if (remaining <= 0) clearInterval(interval);
    }, 50);
    return () => clearInterval(interval);
  }, [duration]);
  return (
    <div style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 9999, minWidth: 340 }}>
      <div className="toast show align-items-center border-0 shadow" style={{ backgroundColor: 'var(--bg-card, #fff)', border: '1px solid var(--border-color, #dee2e6)', borderRadius: 12 }}>
        <div className="d-flex align-items-center p-3">
          <Trash2 size={20} strokeWidth={2} className="text-danger me-2" />
          <span className="flex-grow-1" style={{ color: 'var(--text-body, #212529)', fontSize: 14, fontWeight: 500 }}>{message}</span>
          <button className="btn btn-sm px-3 me-1" onClick={onUndo} style={{ fontWeight: 700, color: 'var(--btn-undo-color, #0d6efd)', backgroundColor: 'var(--btn-undo-bg, transparent)', border: '2px solid var(--btn-undo-border, #0d6efd)', borderRadius: 8 }}>Undo</button>
          <button type="button" className="btn-close btn-close-sm" onClick={onUndo}></button>
        </div>
        <div style={{ height: 4, backgroundColor: 'var(--border-color, #e9ecef)', borderRadius: '0 0 12px 12px' }}>
          <div style={{ height: '100%', width: progress + '%', backgroundColor: '#0d6efd', transition: 'width 0.05s linear', borderRadius: '0 0 12px 0' }}></div>
        </div>
      </div>
    </div>
  );
}

/* ─── Wallet Cards ─── */
function WalletCards({ effectiveTheme, blurStudents, totalPaid, totalUnpaid }) {
  const isDark = effectiveTheme === 'dark';
  const blur = blurStudents ? 'blur(6px)' : 'none';
  const blurStyle = { filter: blur, transition: 'filter 0.3s ease', userSelect: blurStudents ? 'none' : 'auto' };
  return (
    <div className="row g-3 mb-4">
      <div className="col-md-4"><div className={`card border-0 h-100 ${isDark ? 'bg-dark text-white border-secondary' : ''}`} style={{ ...(isDark ? {} : { background: '#ffffff' }) }}><div className="card-body text-center p-0"><h6 className={`card-subtitle ${isDark ? 'text-white-50' : ''}`} style={{ fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', fontSize: '0.7rem' }}>Total Unpaid</h6><h2 className="card-title mt-2 mb-0" style={{ fontWeight: 600, letterSpacing: '-0.02em', color: '#dc3545', ...blurStyle }}>{fmtAED(totalUnpaid)}</h2></div></div></div>
      <div className="col-md-4"><div className={`card border-0 h-100 ${isDark ? 'bg-dark text-white border-secondary' : ''}`} style={{ ...(isDark ? {} : { background: '#ffffff' }) }}><div className="card-body text-center p-0"><h6 className={`card-subtitle ${isDark ? 'text-white-50' : ''}`} style={{ fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', fontSize: '0.7rem' }}>Total Paid</h6><h2 className="card-title mt-2 mb-0" style={{ fontWeight: 600, letterSpacing: '-0.02em', color: '#28a745', ...blurStyle }}>{fmtAED(totalPaid)}</h2></div></div></div>
      <div className="col-md-4"><div className={`card border-0 h-100 ${isDark ? 'bg-dark text-white border-secondary' : ''}`} style={{ ...(isDark ? {} : { background: '#ffffff' }) }}><div className="card-body text-center p-0"><h6 className={`card-subtitle ${isDark ? 'text-white-50' : ''}`} style={{ fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', fontSize: '0.7rem' }}>Total</h6><h2 className="card-title mt-2 mb-0" style={{ fontWeight: 600, letterSpacing: '-0.02em', color: '#0d6efd', ...blurStyle }}>{fmtAED(Number(totalUnpaid) + Number(totalPaid))}</h2></div></div></div>
    </div>
  );
}

/* ─── Dashboard Stats (Charts) ─── */
function DashboardStats({ sessionsBySubject, effectiveTheme, blurStudents }) {
  const isDark = effectiveTheme === 'dark';
  const legendColor = isDark ? '#ccc' : '#666';
  const subData = sessionsBySubject?.length ? {
    labels: sessionsBySubject.map(r => r.subject),
    datasets: [{ data: sessionsBySubject.map(r => r.sessions), backgroundColor: ['#28a745','#ffc107','#dc3545','#0dcaf0','#6f42c1','#fd7e14','#20c997','#e83e8c'] }]
  } : null;
  const pieOptions = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 }, color: legendColor } } } };
  return (
    <>
      <div className="row g-3 mb-4">
        <div className="col-md-12"><div className={`card h-100 ${isDark ? 'bg-dark text-white border-secondary' : ''}`} style={{ ...(isDark ? {} : { background: '#ffffff' }) }}><div className={`card-header ${isDark ? 'bg-secondary text-white border-secondary' : ''}`} style={{ borderBottom: isDark ? '1px solid rgba(255,255,255,0.1)' : '1px solid #e2e8f0', padding: '16px 20px', background: isDark ? '#1f2937' : '#ffffff' }}><strong>Sessions by Subject</strong></div><div className="card-body p-0" style={{ height: '220px' }}>{subData && <Pie data={subData} options={pieOptions} height={200} />}</div></div></div>
      </div>
    </>
  );
}

/* ─── Recent Sessions Table ─── */
function RecentSessionsTable({ sessions, onEdit, onDeleteSession, effectiveTheme, blurSessions, setBlurSessions }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const debouncedSearch = useDebounce(search);
  const isDark = effectiveTheme === 'dark';
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;
  const blurStyle = { filter: blurSessions ? 'blur(6px)' : 'none', transition: 'filter 0.3s ease', userSelect: blurSessions ? 'none' : 'auto' };
  const filtered = sessions.filter(s => {
    if (debouncedSearch && !s.student_name.toLowerCase().includes(debouncedSearch.toLowerCase())) return false;
    const rem = s.amount_due - s.amount_paid;
    if (filter === 'paid' && rem > 0) return false;
    if (filter === 'partial' && !(s.amount_paid > 0 && rem > 0)) return false;
    if (filter === 'unpaid' && s.amount_paid > 0) return false;
    return true;
  });
  useEffect(() => { setCurrentPage(1); }, [debouncedSearch, filter]);
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentSessions = filtered.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  return (
    <div className={`card mb-4 shadow-sm ${isDark ? 'bg-dark text-white border-secondary' : 'bg-white text-dark'}`}>
      <div className={`card-header d-flex align-items-center justify-content-between flex-wrap gap-2 ${isDark ? 'bg-secondary text-white border-secondary' : 'bg-light'}`} style={{ borderBottom: isDark ? '1px solid rgba(255,255,255,0.1)' : '1px solid #e2e8f0', padding: '16px 20px', background: isDark ? '#1f2937' : '#ffffff' }}>
        <strong>Recent Sessions</strong>
        <div className="d-flex align-items-center gap-2">
          <input type="text" className={`form-control form-control-sm ${isDark ? 'bg-dark text-white border-secondary' : ''}`} placeholder="Search sessions..." style={{ width: 180 }} value={search} onChange={e => setSearch(e.target.value)} />
          <select className={`form-select form-select-sm ${isDark ? 'bg-dark text-white border-secondary' : ''}`} value={filter} onChange={e => setFilter(e.target.value)} style={{ width: 'auto' }}>
            <option value="all">All</option><option value="paid">Paid</option><option value="partial">Partial</option><option value="unpaid">Unpaid</option>
          </select>
          <button className="btn btn-sm btn-outline-secondary" title="Toggle amounts visibility" onClick={setBlurSessions}>{blurSessions ? <EyeOff size={16} strokeWidth={2} /> : <Eye size={16} strokeWidth={2} />}</button>
        </div>
      </div>
      <div className={`card-body p-0 ${isDark ? 'bg-dark' : ''}`}>
        {filtered.length === 0 ? <div className={`card-body ${isDark ? 'text-white-50' : 'text-muted'}`}><p className="mb-0">No sessions recorded yet.</p></div> : (
          <div className="table-responsive">
            <table className={`table table-hover mb-0 ${isDark ? 'table-dark table-borderless' : 'table-bordered'}`}>
              <thead style={{ fontWeight: 600, fontSize: '0.8rem', letterSpacing: '0.03em' }}>
                <tr>
                  <th style={{ fontWeight: 600, letterSpacing: '0.03em' }}>#</th><th style={{ fontWeight: 600, letterSpacing: '0.03em' }}>Student</th><th style={{ fontWeight: 600, letterSpacing: '0.03em' }}>Subject</th><th style={{ fontWeight: 600, letterSpacing: '0.03em' }}>Rate</th><th style={{ fontWeight: 600, letterSpacing: '0.03em' }}>Time</th><th style={{ fontWeight: 600, letterSpacing: '0.03em' }}>Due</th><th style={{ fontWeight: 600, letterSpacing: '0.03em' }}>Paid</th><th style={{ fontWeight: 600, letterSpacing: '0.03em' }}>Status</th><th style={{ fontWeight: 600, letterSpacing: '0.03em' }}>Date</th><th className="text-end" style={{ fontWeight: 600, letterSpacing: '0.03em' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {currentSessions.map((s, i) => {
                  const rem = s.amount_due - s.amount_paid;
                  const status = rem <= 0 ? 'Paid' : s.amount_paid > 0 ? 'Partial' : 'Unpaid';
                  const cls = status === 'Paid' ? 'badge-glass-paid' : status === 'Partial' ? 'badge-glass-partial' : 'badge-glass-unpaid';
                  return (
                    <tr key={s.id}>
                      <td>{indexOfFirstItem + i + 1}</td><td><Link to={`/student/${s.student_id}`} className="text-decoration-none">{s.student_name}</Link></td>
                      <td>{s.subject || '---'}</td>
                      <td><span style={blurStyle}>{fmtAED(s.hourly_rate) + '/hr'}</span></td>
                      <td>{s.hours}h {s.minutes}m</td>
                      <td><span style={blurStyle}>{fmtAED(s.amount_due)}</span></td>
                      <td><span style={blurStyle}>{fmtAED(s.amount_paid)}</span></td>
                      <td><span className={cls}>{status}</span></td><td>{s.session_date}</td>
                      <td className="text-end">
                        <div className="d-flex gap-1 justify-content-end">
                          <button className="action-btn action-btn-edit" title="Edit Session" onClick={() => onEdit(s)}><Pencil size={16} strokeWidth={2} /></button>
                          <button className="action-btn action-btn-delete" title="Delete Session" onClick={() => onDeleteSession(s)}><Trash2 size={16} strokeWidth={2} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {filtered.length > itemsPerPage && (
        <div className="d-flex justify-content-between align-items-center px-3 py-2 border-top" style={{ borderColor: isDark ? 'rgba(255,255,255,0.1)' : '#e2e8f0' }}>
          <span className="small text-muted">Showing {indexOfFirstItem + 1}–{Math.min(indexOfLastItem, filtered.length)} of {filtered.length}</span>
          <nav className="d-flex align-items-center gap-2">
            <button className="btn btn-sm btn-outline-secondary" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}>&laquo; Prev</button>
            <span className="small text-muted">Page {currentPage} of {totalPages}</span>
            <button className="btn btn-sm btn-outline-secondary" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)}>Next &raquo;</button>
          </nav>
        </div>
      )}
    </div>
  );
}

/* ─── Student Reports Table ─── */
function StudentReportsTable({ reports, onEditStudent, onDeleteStudent, effectiveTheme, blurReports, setBlurReports }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const debouncedSearch = useDebounce(search);
  const isDark = effectiveTheme === 'dark';
  const blurStyle = { filter: blurReports ? 'blur(6px)' : 'none', transition: 'filter 0.3s ease', userSelect: blurReports ? 'none' : 'auto' };
  const filtered = reports
    .filter(r => {
      if (debouncedSearch && !r.name.toLowerCase().includes(debouncedSearch.toLowerCase())) return false;
      if (filter === 'outstanding' && r.total_remaining <= 0) return false;
      if (filter === 'paid' && r.total_remaining > 0) return false;
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 5);
  return (
    <div className={`card mb-4 shadow-sm ${isDark ? 'bg-dark text-white border-secondary' : 'bg-white text-dark'}`}>
      <div className={`card-header d-flex align-items-center justify-content-between flex-wrap gap-2 ${isDark ? 'bg-secondary text-white border-secondary' : 'bg-light'}`} style={{ borderBottom: isDark ? '1px solid rgba(255,255,255,0.1)' : '1px solid #e2e8f0', padding: '16px 20px', background: isDark ? '#1f2937' : '#ffffff' }}>
        <strong>Student Reports</strong>
        <div className="d-flex align-items-center gap-2">
          <input type="text" className={`form-control form-control-sm ${isDark ? 'bg-dark text-white border-secondary' : ''}`} placeholder="Search students..." style={{ width: 180 }} value={search} onChange={e => setSearch(e.target.value)} />
          <select className={`form-select form-select-sm ${isDark ? 'bg-dark text-white border-secondary' : ''}`} value={filter} onChange={e => setFilter(e.target.value)} style={{ width: 'auto' }}>
            <option value="all">All</option><option value="outstanding">Outstanding</option><option value="paid">Fully Paid</option>
          </select>
          <button className="btn btn-sm btn-outline-secondary" title="Toggle amounts visibility" onClick={setBlurReports}>{blurReports ? <EyeOff size={16} strokeWidth={2} /> : <Eye size={16} strokeWidth={2} />}</button>
        </div>
      </div>
      <div className={`card-body p-0 ${isDark ? 'bg-dark' : ''}`}>
        {filtered.length === 0 ? <div className={`card-body ${isDark ? 'text-white-50' : 'text-muted'}`}><p className="mb-0">No reports available.</p></div> : (
          <div className="table-responsive">
            <table className={`table table-striped mb-0 ${isDark ? 'table-dark table-borderless' : ''}`}>
              <thead style={{ fontWeight: 600, fontSize: '0.8rem', letterSpacing: '0.03em' }}>
                <tr><th style={{ fontWeight: 600, letterSpacing: '0.03em' }}>#</th><th style={{ fontWeight: 600, letterSpacing: '0.03em' }}>Student</th><th style={{ fontWeight: 600, letterSpacing: '0.03em' }}>Phone</th><th style={{ fontWeight: 600, letterSpacing: '0.03em' }}>Time</th><th style={{ fontWeight: 600, letterSpacing: '0.03em' }}>Due</th><th style={{ fontWeight: 600, letterSpacing: '0.03em' }}>Paid</th><th style={{ fontWeight: 600, letterSpacing: '0.03em' }}>Remaining</th><th style={{ fontWeight: 600, letterSpacing: '0.03em' }}>Health</th><th className="text-end" style={{ fontWeight: 600, letterSpacing: '0.03em' }}>Actions</th></tr></thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr key={r.id}>
                    <td>{i + 1}</td><td><Link to={`/student/${r.id}`} className="text-decoration-none fw-bold">{r.name}</Link></td>
                    <td>{r.phone_number ? <a href={`https://wa.me/${r.phone_number.replace(/\+/g, '')}`} target="_blank" rel="noreferrer" className="text-decoration-none">{r.phone_number}</a> : <span className="text-muted">---</span>}</td>
                    <td>{r.total_hours} hrs</td><td><span style={blurStyle}>{fmtAED(r.total_due)}</span></td>                    <td className="fw-bold text-success"><span style={blurStyle}>{fmtAED(r.total_paid)}</span></td>
                    <td className={r.total_remaining > 0 ? 'text-danger fw-bold' : ''}><span style={blurStyle}>{fmtAED(r.total_remaining)}</span></td>
                    <td>
                      {r.health === 'healthy' && <span className="badge-glass-healthy" title="Good payment and attendance">Healthy</span>}
                      {r.health === 'payment_risk' && <span className="badge-glass-payment-risk" title="High payment risk">Payment Risk</span>}
                      {r.health === 'churn_risk' && <span className="badge-glass-churn-risk" title="Reduced frequency">Churn Risk</span>}
                    </td>
                    <td className="text-end">
                        <div className="d-flex gap-1 justify-content-end">
                          <button className="action-btn action-btn-success" title="Download PDF" onClick={() => generateInvoice(r.id)}><FileText size={16} strokeWidth={2} /></button>
                          {r.total_remaining > 0 && <button className="action-btn action-btn-success" title="WhatsApp" onClick={() => sendWhatsApp(r.phone_number, r.name, r.total_remaining)}><MessageCircle size={16} strokeWidth={2} /></button>}
                          <button className="action-btn action-btn-edit" title="Edit Student" onClick={() => onEditStudent(r)}><Pencil size={16} strokeWidth={2} /></button>
                          <button className="action-btn action-btn-delete" title="Delete Student" onClick={() => onDeleteStudent(r)}><Trash2 size={16} strokeWidth={2} /></button>
                        </div>
                      </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Edit Session Modal ─── */
function EditSessionModal({ session, students, onSave, onClose, effectiveTheme }) {
  const isDark = effectiveTheme === 'dark';
  const [studentId, setStudentId] = useState('');
  const [studentName, setStudentName] = useState('');
  const [studentPhone, setStudentPhone] = useState('');
  const [subject, setSubject] = useState('');
  const [rate, setRate] = useState('');
  const [hours, setHours] = useState('0');
  const [minutes, setMinutes] = useState('0');
  const [sessionDate, setSessionDate] = useState('');
  const [amountPaid, setAmountPaid] = useState('0');
  const [notes, setNotes] = useState('');
  useEffect(() => {
    if (!session) return;
    setStudentId(session.student_id?.toString() || '');
    setStudentName(session.student_name || '');
    setStudentPhone(session.student_phone || '');
    setSubject(session.subject || '');
    setRate(session.hourly_rate?.toString() || '');
    setHours(session.hours?.toString() || '0');
    setMinutes(session.minutes?.toString() || '0');
    setSessionDate(session.session_date || '');
    setAmountPaid(session.amount_paid?.toString() || '0');
    setNotes(session.notes || '');
  }, [session]);
  if (!session) return null;
  const h = parseFloat(hours) || 0;
  const m = parseFloat(minutes) || 0;
  const r = parseFloat(rate) || 0;
  const amountDue = r * (h + m / 60);
  const handleSave = () => {
    onSave(session.id, { student_id: studentId, student_name: studentName, student_phone: studentPhone, subject, hourly_rate: rate, hours, minutes, session_date: sessionDate, notes, amount_paid: parseFloat(amountPaid) || 0 });
  };
  return (
    <div className="modal d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="modal-dialog">
        <div className={`modal-content ${isDark ? 'bg-dark text-white border-secondary' : ''}`}>
          <div className={`modal-header ${isDark ? 'bg-secondary text-white border-secondary' : ''}`}><h5 className="modal-title">Edit Session</h5><button type="button" className={`btn-close ${isDark ? 'btn-close-white' : ''}`} onClick={onClose}></button></div>
          <div className="modal-body">
            <div className="row mb-3"><div className="col-6"><label className="form-label">Student Name</label><input className={`form-control ${isDark ? 'bg-dark text-white border-secondary' : ''}`} value={studentName} onChange={e => setStudentName(e.target.value)} /></div><div className="col-6"><label className="form-label">Student Phone</label><input className={`form-control ${isDark ? 'bg-dark text-white border-secondary' : ''}`} value={studentPhone} onChange={e => setStudentPhone(e.target.value)} placeholder="971501234567" /></div></div>
            <div className="row mb-3"><div className="col-6"><label className="form-label">Subject</label><input className={`form-control ${isDark ? 'bg-dark text-white border-secondary' : ''}`} value={subject} onChange={e => setSubject(e.target.value)} /></div></div>
            <div className="mb-3"><label className="form-label">Assign to Existing Student</label><select className={`form-select ${isDark ? 'bg-dark text-white border-secondary' : ''}`} value={studentId} onChange={e => setStudentId(e.target.value)}>{students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div className="row mb-3"><div className="col-6"><label className="form-label">Rate per Hour (AED)</label><input type="number" className={`form-control ${isDark ? 'bg-dark text-white border-secondary' : ''}`} step="0.01" value={rate} onChange={e => setRate(e.target.value)} /></div><div className="col-3"><label className="form-label">Hours</label><input type="number" className={`form-control ${isDark ? 'bg-dark text-white border-secondary' : ''}`} min="0" value={hours} onChange={e => setHours(e.target.value)} /></div><div className="col-3"><label className="form-label">Minutes</label><input type="number" className={`form-control ${isDark ? 'bg-dark text-white border-secondary' : ''}`} min="0" max="59" value={minutes} onChange={e => setMinutes(e.target.value)} /></div></div>
            <div className="mb-3"><label className="form-label">Amount Due</label><input className={`form-control ${isDark ? 'bg-dark text-white border-secondary' : ''}`} value={fmtAED(amountDue)} readOnly style={{ fontWeight: 'bold', background: isDark ? '#343a40' : '#e9ecef' }} /></div>
            <div className="mb-3"><label className="form-label">Date</label><input type="date" className={`form-control ${isDark ? 'bg-dark text-white border-secondary' : ''}`} value={sessionDate} onChange={e => setSessionDate(e.target.value)} /></div>
            <div className="mb-3"><label className="form-label">Notes</label><input className={`form-control ${isDark ? 'bg-dark text-white border-secondary' : ''}`} value={notes} onChange={e => setNotes(e.target.value)} /></div>
            <div className="mb-3"><label className="form-label">Amount Paid (AED)</label><input type="number" className={`form-control ${isDark ? 'bg-dark text-white border-secondary' : ''}`} step="0.01" min="0" value={amountPaid} onChange={e => setAmountPaid(e.target.value)} /></div>
          </div>
          <div className="modal-footer"><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={handleSave}>Save Changes</button></div>
        </div>
      </div>
    </div>
  );
}

/* ─── Edit Student Modal ─── */
function EditStudentModal({ student, onSave, onClose, effectiveTheme }) {
  const isDark = effectiveTheme === 'dark';
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [subject, setSubject] = useState('');
  const [notes, setNotes] = useState('');
  useEffect(() => {
    if (!student) return;
    setName(student.name || '');
    setPhone(student.phone_number || '');
    setSubject(student.subject || '');
    setNotes('');
    fetchStudentData(student.id).then(d => { if (!d.error) { setPhone(d.phone_number || ''); setNotes(d.notes || ''); } });
  }, [student]);
  if (!student) return null;
  const handleSave = async () => {
    if (!name.trim()) return;
    const data = await editStudent(student.id, { name: name.trim(), phone_number: phone.trim(), subject: subject.trim(), notes: notes.trim() });
    if (data.success) { onSave(data); onClose(); }
  };
  return (
    <div className="modal d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="modal-dialog">
        <div className={`modal-content ${isDark ? 'bg-dark text-white border-secondary' : ''}`}>
          <div className={`modal-header ${isDark ? 'bg-secondary text-white border-secondary' : ''}`}><h5 className="modal-title">Edit Student</h5><button type="button" className={`btn-close ${isDark ? 'btn-close-white' : ''}`} onClick={onClose}></button></div>
          <div className="modal-body">
            <div className="mb-3"><label className="form-label">Student Name</label><input className={`form-control ${isDark ? 'bg-dark text-white border-secondary' : ''}`} value={name} onChange={e => setName(e.target.value)} /></div>
            <div className="mb-3"><label className="form-label">WhatsApp Number (optional)</label><input className={`form-control ${isDark ? 'bg-dark text-white border-secondary' : ''}`} value={phone} onChange={e => setPhone(e.target.value)} placeholder="971501234567" /></div>
            <div className="mb-3"><label className="form-label">Subject</label><input className={`form-control ${isDark ? 'bg-dark text-white border-secondary' : ''}`} value={subject} onChange={e => setSubject(e.target.value)} /></div>
            <div className="mb-3"><label className="form-label">Notes</label><textarea className={`form-control ${isDark ? 'bg-dark text-white border-secondary' : ''}`} rows="2" value={notes} onChange={e => setNotes(e.target.value)}></textarea></div>
          </div>
          <div className="modal-footer"><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={handleSave}>Save Changes</button></div>
        </div>
      </div>
    </div>
  );
}

/* ─── Theme Toggle ─── */
function ThemeToggle({ theme, setTheme }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const cb = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', cb);
    return () => document.removeEventListener('mousedown', cb);
  }, []);
  const icon = theme === 'light' ? <Sun size={16} strokeWidth={2} /> : theme === 'dark' ? <Moon size={16} strokeWidth={2} /> : <Monitor size={16} strokeWidth={2} />;
  return (
    <div className="capsule-theme-wrapper" ref={ref}>
      <button className="capsule-theme-btn" onClick={() => setOpen(o => !o)}>{icon}</button>
      {open && (
        <div className="capsule-theme-dropdown">
          <button className={`capsule-theme-option ${theme === 'light' ? 'active' : ''}`} onClick={() => { setTheme('light'); setOpen(false); }}><Sun size={14} strokeWidth={2} /> Light</button>
          <button className={`capsule-theme-option ${theme === 'dark' ? 'active' : ''}`} onClick={() => { setTheme('dark'); setOpen(false); }}><Moon size={14} strokeWidth={2} /> Dark</button>
          <div className="capsule-theme-divider" />
          <button className={`capsule-theme-option ${theme === 'system' ? 'active' : ''}`} onClick={() => { setTheme('system'); setOpen(false); }}><Monitor size={14} strokeWidth={2} /> System</button>
        </div>
      )}
    </div>
  );
}

/* ─── Floating Capsule Navbar (Dock) ─── */
function AppNavbar({ theme, setTheme, onExport, showExport }) {
  const location = useLocation();
  const path = location.pathname;
  const linksRef = useRef(null);
  const [indicator, setIndicator] = useState({ w: 0, l: 0 });

  const updateIndicator = useCallback(() => {
    if (!linksRef.current) return;
    const el = linksRef.current.querySelector('.nav-link.active');
    if (!el) { setIndicator({ w: 0, l: 0 }); return; }
    setIndicator({ w: el.offsetWidth, l: el.offsetLeft });
  }, []);

  useEffect(() => { updateIndicator(); }, [path, updateIndicator]);

  useEffect(() => {
    const ro = new ResizeObserver(updateIndicator);
    if (linksRef.current) ro.observe(linksRef.current);
    return () => ro.disconnect();
  }, [updateIndicator]);

  return (
    <nav className="capsule-nav">
      {/* Brand pill — home link */}
      <Link to="/" className="capsule-brand" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.375rem', padding: '0.25rem 0.5rem 0.25rem 0.25rem', borderRadius: '9999px', transition: 'background 0.2s' }}>
        <img src={logoImage} alt="VaultTrack Logo" style={{ height: 22, width: 'auto', objectFit: 'contain' }} />
        <span style={{ fontWeight: 700, fontSize: '0.85rem', letterSpacing: '-0.02em', lineHeight: 1 }}>
          <span className="capsule-brand-text">Vault</span>
          <span style={{ color: '#10B981' }}>Track</span>
        </span>
      </Link>

      <div className="capsule-divider" />

      {/* Nav links + sliding indicator */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <div className="capsule-indicator" style={{
          width: indicator.w + 'px',
          left: indicator.l + 'px',
          opacity: indicator.w > 0 ? 1 : 0,
        }} />
        <div ref={linksRef} style={{ display: 'flex', gap: '0.125rem', position: 'relative', zIndex: 1 }}>
          <Link className={`nav-link ${path === '/expenses' ? 'active' : ''}`} to="/expenses">Expenses</Link>
          <Link className={`nav-link ${path === '/tutoring' ? 'active' : ''}`} to="/tutoring">Tutoring</Link>
          <Link className={`nav-link ${path === '/settings' ? 'active' : ''}`} to="/settings"><SettingsIcon size={14} strokeWidth={2} style={{ marginRight: 4 }} />Settings</Link>
        </div>
      </div>

      <div className="capsule-divider" />

      {/* Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
        <ThemeToggle theme={theme} setTheme={setTheme} />
        {showExport && (
          <button className="btn btn-sm" onClick={onExport} style={{ borderRadius: '9999px', padding: '0.25rem 0.625rem', fontSize: '0.75rem', lineHeight: 1.5, border: '1px solid var(--card-glass-border)', background: 'var(--card-glass-bg)', color: 'var(--text-body)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <FileSpreadsheet size={14} strokeWidth={2} />
            <span>Download</span>
          </button>
        )}
      </div>
    </nav>
  );
}

/* ─── Tutoring Dashboard ─── */
function TutoringDashboard({ wallet, setWallet, effectiveTheme, blurStudents, toggleBlurStudents, showToast }) {
  const isDark = effectiveTheme === 'dark';
  const [data, setData] = useState(null);
  const [editingSession, setEditingSession] = useState(null);
  const [editingStudent, setEditingStudent] = useState(null);
  const [totalUnpaid, setTotalUnpaid] = useState(0);
  const [showSessionForm, setShowSessionForm] = useState(false);
  const [sStudentId, setSStudentId] = useState('');

  const [sSubject, setSSubject] = useState('');
  const [sRate, setSRate] = useState('');
  const [sHours, setSHours] = useState('0');
  const [sMinutes, setSMinutes] = useState('0');
  const [sDate, setSDate] = useState(new Date().toISOString().split('T')[0]);
  const [sPaid, setSPaid] = useState('0');
  const sPaidTouched = useRef(false);

  useEffect(() => {
    const h = parseFloat(sHours) || 0;
    const m = parseFloat(sMinutes) || 0;
    const r = parseFloat(sRate) || 0;
    if (h > 0 || m > 0) {
      const total = (h + m / 60) * r;
      if (!isNaN(total) && total > 0 && !sPaidTouched.current) {
        setSPaid(total.toFixed(2));
      }
    }
  }, [sHours, sMinutes, sRate]);

  const [sNotes, setSNotes] = useState('');
  const { triggerUndo, UndoToastUI } = useUndo();
  const [blurSessions, setBlurSessions] = useState(() => localStorage.getItem('privacy_blurSessions') === 'true');
  const [blurReports, setBlurReports] = useState(() => localStorage.getItem('privacy_blurReports') === 'true');
  const toggleBlurSessions = () => setBlurSessions(prev => { const v = !prev; localStorage.setItem('privacy_blurSessions', v); return v; });
  const toggleBlurReports = () => setBlurReports(prev => { const v = !prev; localStorage.setItem('privacy_blurReports', v); return v; });
  const [selectedMonth, setSelectedMonth] = useState('All');
  const availableMonths = [...new Set((data?.sessions || []).map(s => s.session_date?.slice(0, 7)).filter(Boolean))].sort();
  const filteredSessions = selectedMonth === 'All' ? (data?.sessions || []) : (data?.sessions || []).filter(s => s.session_date?.startsWith(selectedMonth));
  const showToastMsg = (msg) => showToast(msg, 'success');
  const loadData = useCallback(async () => {
    const d = await fetchTutoringData();
    setData(d);
    setTotalUnpaid(d.monthly_unpaid || 0);
    try { const wr = await fetch('/api/wallet/status').then(r => r.json()); setWallet(wr); } catch {}
  }, [setWallet]);
  useEffect(() => { loadData(); }, [loadData]);
  const handleEditSession = async (sessionId, payload) => {
    const result = await editSession(sessionId, payload);
    if (result.success) { showToastMsg('Session updated.'); setEditingSession(null); loadData(); }
    else showToastMsg(result.error || 'Save failed');
  };
const handleEditStudent = async () => { showToastMsg('Student updated.'); loadData(); };
  const handleSessionAdded = () => { showToastMsg('Session saved.'); loadData(); };
  const handleSessionSubmit = async (e) => {
    e.preventDefault();
    if (!sStudentId || !sRate) return;
    const student = (data?.students || []).find(s => s.id === Number(sStudentId));
    try {
      const result = await addSession({ student_id: sStudentId, student_name: student?.name || '', subject: sSubject, hourly_rate: sRate, hours: sHours, minutes: sMinutes, session_date: sDate, amount_paid: sPaid, notes: sNotes });
      if (result.error) { showToastMsg(result.error); return; }
      showToast('Session saved.', 'success', () => {
        fetch(`/api/tutoring/sessions/${result.id}/delete`, { method: 'POST' }).then(r => r.json()).then(d => { if (d.wallet) setWallet(d.wallet); loadData(); }).catch(() => {});
      });
      setShowSessionForm(false);
      setSStudentId(''); setSSubject(''); setSRate(''); setSHours('0'); setSMinutes('0'); setSPaid('0'); sPaidTouched.current = false; setSNotes('');
      loadData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };
  const handleFormSubmit = async (e) => {
    e.preventDefault();
    if (!formName.trim()) return;
    const res = await fetch('/tutoring/add-student', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ name: formName, phone_number: formPhone, subject: formSubject, notes: formNotes })
    });
    const data = await res.json();
    if (data.id) {
      showToast(`"${data.name}" added.`, 'success', () => {
        fetch(`/api/tutoring/students/${data.id}/delete`, { method: 'POST' }).then(r => r.json()).then(d2 => { if (d2.wallet) setWallet(d2.wallet); loadData(); }).catch(() => {});
      });
      loadData();
      setShowAddForm(false);
      setFormName(''); setFormPhone(''); setFormSubject(''); setFormNotes('');
    }
  };
  const handleDeleteRequest = (student) => {
    triggerUndo(
      `Deleted: ${student.name}`,
      () => setData(prev => ({ ...prev, reports: prev.reports.filter(r => r.id !== student.id) })),
      () => {
        fetch(`/api/tutoring/students/${student.id}/delete`, { method: 'POST' })
          .then(res => res.json())
          .then(data => {
            if (data.success) {
              setWallet(data.wallet);
              setTotalUnpaid(data.total_unpaid);
            }
          }).catch(err => console.error("API Error:", err));
      },
      () => setData(prev => ({ ...prev, reports: [...prev.reports, student] }))
    );
  };
  const handleDeleteSessionRequest = (session) => {
    triggerUndo(
      `Deleted: ${session.subject || 'Session'}`,
      () => setData(prev => ({ ...prev, sessions: prev.sessions.filter(s => s.id !== session.id) })),
      () => {
        fetch(`/api/tutoring/sessions/${session.id}/delete`, { method: 'POST' })
          .then(res => res.json())
          .then(data => {
            if (data.success) {
              setWallet(data.wallet);
              setTotalUnpaid(data.total_unpaid);
              if (data.report) {
                setData(prev => ({ ...prev, reports: prev.reports.map(r => r.id === data.report.id ? data.report : r) }));
              }
            }
          }).catch(err => console.error("API Error:", err));
      },
      () => setData(prev => ({ ...prev, sessions: [session, ...prev.sessions].sort((a, b) => new Date(b.session_date) - new Date(a.session_date)) }))
    );
  };
  const exportData = async () => {
    const resp = await fetch('/api/export/tutoring');
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'tutoring_data.xlsx'; a.click();
    URL.revokeObjectURL(url);
  };
  if (!data) return <LoadingScreen />;
  return (
    <div className="container">
      <div className="d-flex justify-content-end mb-3">
        <button className="btn btn-sm glass-btn px-2 py-1 rounded-2 d-inline-flex align-items-center justify-content-center gap-1" onClick={toggleBlurStudents} title="Toggle amounts visibility">
          {blurStudents ? <EyeOff size={16} /> : <Eye size={16} />}
          <span style={{ fontSize: '0.7rem', fontWeight: 500, letterSpacing: '0.03em' }}>{blurStudents ? 'Show Balance' : 'Hide Balance'}</span>
        </button>
      </div>
      <WalletCards effectiveTheme={effectiveTheme} blurStudents={blurStudents} totalPaid={filteredSessions.reduce((sum, s) => sum + (parseFloat(s.amount_paid) || 0), 0)} totalUnpaid={filteredSessions.reduce((sum, s) => sum + ((parseFloat(s.amount_due) || 0) - (parseFloat(s.amount_paid) || 0)), 0)} />
      <DashboardStats sessionsBySubject={data.sessions_by_subject || []} effectiveTheme={effectiveTheme} blurStudents={blurStudents} />
      {showSessionForm && (
        <div id="session-form-target" className={`card mb-4 shadow-sm ${isDark ? 'bg-dark text-white border-secondary' : 'bg-white text-dark'}`} style={{ ...(isDark ? {} : { background: '#ffffff' }) }}>
          <div className={`card-header d-flex justify-content-between align-items-center flex-wrap gap-2 ${isDark ? 'bg-secondary text-white border-secondary' : 'bg-light text-dark border-bottom'}`} style={{ borderBottom: isDark ? '1px solid rgba(255,255,255,0.1)' : '1px solid #e2e8f0', padding: '16px 20px', background: isDark ? '#1f2937' : '#ffffff' }}>
            <strong>Record New Session</strong>
            <button type="button" className={`btn-close ${isDark ? 'btn-close-white' : ''}`} aria-label="Close" onClick={() => setShowSessionForm(false)}></button>
          </div>
          <div className="card-body p-4">
            <form onSubmit={handleSessionSubmit}>
              <div className="row g-4">
                <div className="col-md-4">
                  <SmartStudentSelector
                    students={data.students || []}
                    effectiveTheme={effectiveTheme}
                    onSelectStudent={(id) => setSStudentId(id)}
                    onStudentAdded={(newStudent) => setData(prev => ({ ...prev, students: [...prev.students, newStudent] }))}
                    onDeleteStudent={async (student) => {
                      try {
                        const res = await fetch(`/api/tutoring/students/${student.id}/delete`, { method: 'POST' });
                        const result = await res.json();
                        if (result.success) {
                          setData(prev => ({ ...prev, students: prev.students.filter(s => s.id !== student.id), reports: prev.reports.filter(r => r.id !== student.id) }));
                          if (result.wallet) setWallet(result.wallet);
                          if (result.total_unpaid !== undefined) setTotalUnpaid(result.total_unpaid);
                          showToastMsg('Student deleted.');
                        } else showToastMsg('Delete failed');
                      } catch { showToastMsg('Delete failed'); }
                    }}
                    onStudentRestore={(student) => setData(prev => ({ ...prev, students: [...prev.students, student] }))}
                    triggerUndo={triggerUndo}
                    
                  />
                </div>
                <div className="col-md-4"><label className="form-label">Subject</label><input type="text" className="form-control" value={sSubject} onChange={e => setSSubject(e.target.value)} placeholder="e.g. Algorithm" /></div>
                <div className="col-md-4"><label className="form-label">Rate per Hour (AED)</label><input type="number" className="form-control" step="0.01" min="0.01" value={sRate} onChange={e => setSRate(e.target.value)} required /></div>
                <div className="col-md-2"><label className="form-label">Hours</label><input type="number" className="form-control" min="0" value={sHours} onChange={e => setSHours(e.target.value)} /></div>
                <div className="col-md-2"><label className="form-label">Minutes</label><input type="number" className="form-control" min="0" max="59" value={sMinutes} onChange={e => setSMinutes(e.target.value)} /></div>
                <div className="col-md-2"><label className="form-label">Date</label><input type="date" className="form-control" value={sDate} onChange={e => setSDate(e.target.value)} /></div>
                <div className="col-md-2"><label className="form-label">Amount Paid</label><input type="number" className="form-control" step="0.01" min="0" value={sPaid} onChange={e => { sPaidTouched.current = true; setSPaid(e.target.value); }} /></div>
                <div className="col-md-4"><label className="form-label">Notes</label><input type="text" className="form-control" value={sNotes} onChange={e => setSNotes(e.target.value)} placeholder="Optional notes..." /></div>
              </div>
              <div className="mt-4 d-flex justify-content-end">
                <button type="submit" className="btn btn-primary px-4">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3 mt-2">
        <div className="d-flex align-items-center gap-2">
          <label className="small text-nowrap m-0" style={{ fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', fontSize: '0.7rem' }}>Filter by Month:</label>
          <select
            className={`form-select form-select-sm ${isDark ? 'bg-dark text-white border-secondary' : ''}`}
            style={{ width: '160px' }}
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
          >
            <option value="All">All Months</option>
            {availableMonths.map(m => (
              <option key={m} value={m}>{new Date(m + '-01').toLocaleString('en-US', { year: 'numeric', month: 'long' })}</option>
            ))}
          </select>
        </div>
        <button className="btn btn-sm btn-success d-flex align-items-center gap-1 px-3" onClick={exportData}>
          <FileSpreadsheet size={16} strokeWidth={2} /> Export to Excel
        </button>
      </div>
      <RecentSessionsTable sessions={filteredSessions} onEdit={(s) => setEditingSession(s)} onDeleteSession={handleDeleteSessionRequest} effectiveTheme={effectiveTheme} blurSessions={blurSessions} setBlurSessions={toggleBlurSessions} />
      <StudentReportsTable reports={data.reports || []} onEditStudent={(r) => setEditingStudent(r)} onDeleteStudent={handleDeleteRequest} effectiveTheme={effectiveTheme} blurReports={blurReports} setBlurReports={toggleBlurReports} />
      {UndoToastUI}
      {editingSession && <EditSessionModal session={editingSession} students={data.students || []} onSave={handleEditSession} onClose={() => setEditingSession(null)} effectiveTheme={effectiveTheme} />}
      {editingStudent && <EditStudentModal student={editingStudent} onSave={handleEditStudent} onClose={() => setEditingStudent(null)} effectiveTheme={effectiveTheme} />}
      {!showSessionForm && (
        <button className="fab-btn" onClick={() => { setShowSessionForm(true); setTimeout(() => { const el = document.getElementById('session-form-target'); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); const parent = el.closest('.container') || el.parentElement; if (parent) { const top = el.getBoundingClientRect().top + parent.scrollTop - parent.getBoundingClientRect().top - 20; parent.scrollTo({ top, behavior: 'smooth' }); } el.querySelector('input,textarea,select')?.focus(); } }, 300); }} style={{ bottom: '100px', right: '24px' }}>
          <Plus size={20} strokeWidth={2} />
          <span>Add Session</span>
        </button>
      )}
    </div>
  );
}

function Main() {
  const { theme, setTheme, effectiveTheme } = useTheme();
  const location = useLocation();
  const [wallet, setWallet] = useState(null);
  const [toasts, setToasts] = useState([]);
  const toastId = useRef(0);
  const showToast = useCallback((msg, type, onUndo) => {
    const id = ++toastId.current;
    setToasts(prev => [...prev, { id, msg, type: type || 'success', onUndo }]);
  }, []);
  const [reminderVersion, setReminderVersion] = useState(0);
  const [isReminderModalOpen, setIsReminderModalOpen] = useState(false);
  const [editingReminderId, setEditingReminderId] = useState(null);
  const [reminderForm, setReminderForm] = useState({ title: '', dayOfMonth: '', time: '09:00', amount: '', recurrence: 'Monthly', category: 'Bills' });
  const reminderModalRef = useRef(null);
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState([
    { role: 'bot', text: 'Ask me about your finances or students' }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [blurStudents, setBlurStudents] = useState(() => localStorage.getItem('privacy_blur') === 'true');
  const toggleBlurStudents = () => setBlurStudents(prev => { const v = !prev; localStorage.setItem('privacy_blur', v); return v; });
  const [blurExpenses, setBlurExpenses] = useState(() => localStorage.getItem('privacy_blurExpenses') === 'true');
  const toggleBlurExpenses = () => setBlurExpenses(prev => { const v = !prev; localStorage.setItem('privacy_blurExpenses', v); return v; });

  const handleChatSubmit = async (e) => {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text || isChatLoading) return;
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', text }]);
    setIsChatLoading(true);
    try {
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text }) });
      const data = await res.json();
      setChatMessages(prev => [...prev, { role: 'bot', text: data.reply }]);
    } catch {
      setChatMessages(prev => [...prev, { role: 'bot', text: 'Error reaching AI core.' }]);
    } finally { setIsChatLoading(false); }
  };

  const handleReminderSubmit = async (e) => {
    e.preventDefault();
    try {
      const isEditing = editingReminderId !== null;
      const url = isEditing ? `/api/reminders/${editingReminderId}/edit` : '/api/reminders';
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reminderForm) });
      const result = r.ok ? await r.json() : null;
      if (result && result.success) {
        setReminderVersion(v => v + 1);
        setIsReminderModalOpen(false);
        setEditingReminderId(null);
        setReminderForm({ title: '', dayOfMonth: '', time: '09:00', amount: '', recurrence: 'Monthly', category: 'Bills' });
        showToast(isEditing ? 'Reminder updated.' : 'Reminder saved.', 'success');
      } else {
        showToast(result?.error || (r.status === 404 ? 'API route not found' : `Request failed (HTTP ${r.status})`), 'error');
      }
    } catch (err) { showToast('Failed to save reminder', 'error'); }
  };

  const handleEditReminderClick = (rem) => {
    setReminderForm({ title: rem.title, dayOfMonth: rem.day_of_month, time: rem.time, amount: rem.amount, recurrence: rem.recurrence || 'Monthly', category: rem.category || 'Bills' });
    setEditingReminderId(rem.id);
    setIsReminderModalOpen(true);
  };

  useEffect(() => {
    const runStrictClickAnalysis = (event) => {
      if (isReminderModalOpen && reminderModalRef.current && !reminderModalRef.current.contains(event.target)) {
        const isTrigger = event.target.closest('.floating-action-trigger') || event.target.closest('.btn-outline-primary');
        if (!isTrigger) {
          setIsReminderModalOpen(false);
          setEditingReminderId(null);
          setReminderForm({ title: '', dayOfMonth: '', time: '09:00', amount: '', recurrence: 'Monthly', category: 'Bills' });
        }
      }
    };
    document.addEventListener('mousedown', runStrictClickAnalysis);
    return () => document.removeEventListener('mousedown', runStrictClickAnalysis);
  }, [isReminderModalOpen]);

  const validPaths = ['/', '/dashboard', '/tutoring', '/expenses', '/portfolio', '/settings'];
  const isKnownRoute = validPaths.includes(location.pathname) || /^\/student\/\d+$/.test(location.pathname);
  return (
    <div className={`min-vh-100 ${effectiveTheme === 'dark' ? 'theme-dark bg-dark text-white' : 'theme-light bg-light text-dark'}`} style={{ paddingTop: isKnownRoute ? 96 : 0 }}>
      {isKnownRoute && <AppNavbar theme={theme} setTheme={setTheme} onExport={() => {}} showExport={false} />}
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/dashboard" element={<ProtectedRoute><ExpensesDashboard wallet={wallet} setWallet={setWallet} showToast={showToast} effectiveTheme={effectiveTheme} reminderVersion={reminderVersion} setIsReminderModalOpen={setIsReminderModalOpen} onEditReminder={handleEditReminderClick} blurExpenses={blurExpenses} toggleBlurExpenses={toggleBlurExpenses} /></ProtectedRoute>} />
        <Route path="/tutoring" element={<ProtectedRoute><TutoringDashboard wallet={wallet} setWallet={setWallet} effectiveTheme={effectiveTheme} blurStudents={blurStudents} toggleBlurStudents={toggleBlurStudents} showToast={showToast} /></ProtectedRoute>} />
        <Route path="/student/:id" element={<ProtectedRoute><StudentProfile effectiveTheme={effectiveTheme} showToast={showToast} /></ProtectedRoute>} />
        <Route path="/expenses" element={<ProtectedRoute><ExpensesDashboard wallet={wallet} setWallet={setWallet} showToast={showToast} effectiveTheme={effectiveTheme} reminderVersion={reminderVersion} setIsReminderModalOpen={setIsReminderModalOpen} onEditReminder={handleEditReminderClick} blurExpenses={blurExpenses} toggleBlurExpenses={toggleBlurExpenses} /></ProtectedRoute>} />
        <Route path="/portfolio" element={<ProtectedRoute><PortfolioDashboard effectiveTheme={effectiveTheme} blurExpenses={blurExpenses} toggleBlurExpenses={toggleBlurExpenses} /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><AccountSettings effectiveTheme={effectiveTheme} theme={theme} setTheme={setTheme} showToast={showToast} /></ProtectedRoute>} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <ToastContainer toasts={toasts} onClose={(id) => setToasts(prev => prev.filter(t => t.id !== id))} />
      {isKnownRoute && (
        <>
          <button className="btn btn-primary rounded-circle shadow-lg d-flex align-items-center justify-content-center" style={{ position: 'fixed', bottom: '30px', right: '30px', width: '56px', height: '56px', zIndex: 1050, border: 'none' }} onClick={() => setShowChat(c => !c)}>
            <MessageCircle size={24} strokeWidth={2} />
          </button>
          {showChat && (
            <div className={`card shadow-lg ${effectiveTheme === 'dark' ? 'bg-dark text-white border-secondary' : ''}`} style={{ position: 'fixed', bottom: '100px', right: '30px', width: '340px', height: '480px', zIndex: 1050, display: 'flex', flexDirection: 'column', overflow: 'hidden', backdropFilter: 'blur(16px)', backgroundColor: effectiveTheme === 'dark' ? 'rgba(20,20,23,0.95)' : 'rgba(255,255,255,0.95)' }}>
              <div className="d-flex justify-content-between align-items-center px-3 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <span className="fw-bold" style={{ fontSize: '0.85rem' }}>AI Assistant</span>
                <button className="btn btn-sm p-0 text-muted" onClick={() => setShowChat(false)} style={{ background: 'none', border: 'none' }}><span style={{ fontSize: '1.2rem' }}>&times;</span></button>
              </div>
              <div className="flex-grow-1 p-3" style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {chatMessages.map((m, i) => (
                  <div key={i} className={`d-flex ${m.role === 'user' ? 'justify-content-end' : 'justify-content-start'}`}>
                    <div className="px-3 py-2" style={{ maxWidth: '80%', borderRadius: '14px', fontSize: '0.82rem', lineHeight: 1.4, backgroundColor: m.role === 'user' ? '#3b82f6' : (effectiveTheme === 'dark' ? 'rgba(255,255,255,0.08)' : '#f0f0f0'), color: m.role === 'user' ? '#fff' : (effectiveTheme === 'dark' ? '#e0e0e0' : '#1a1a1a') }}>{m.text}</div>
                  </div>
                ))}
                {isChatLoading && <div className="text-muted small px-1" style={{ fontSize: '0.75rem' }}>Thinking...</div>}
              </div>
              <form onSubmit={handleChatSubmit} className="d-flex gap-2 p-3" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <input type="text" className={`form-control form-control-sm ${effectiveTheme === 'dark' ? 'bg-dark text-white border-secondary' : ''}`} placeholder="Ask anything..." value={chatInput} onChange={e => setChatInput(e.target.value)} style={{ fontSize: '0.82rem', borderRadius: '10px' }} />
                <button type="submit" className="btn btn-primary btn-sm px-3" style={{ borderRadius: '10px', fontSize: '0.82rem' }} disabled={isChatLoading}>Send</button>
              </form>
            </div>
          )}
        </>
      )}
      {isReminderModalOpen && (
        <div className="force-click-reminder-overlay">
          <div ref={reminderModalRef} className="premium-clean-form-card">
            <div className="d-flex justify-content-between align-items-center mb-4">
              <h5 className="m-0 fw-bold reminder-modal-title">{editingReminderId !== null ? 'Edit Bill Reminder' : 'Add Bill Reminder'}</h5>
              <button className="reminder-close-btn" onClick={() => { setIsReminderModalOpen(false); setEditingReminderId(null); setReminderForm({ title: '', dayOfMonth: '', time: '09:00', amount: '', recurrence: 'Monthly', category: 'Bills' }); }}><span>&times;</span></button>
            </div>
            <form onSubmit={handleReminderSubmit} className="d-flex flex-column gap-3">
              <div><label className="small text-muted mb-1">Reminder Name</label><input type="text" className="form-control" placeholder="Add Reminder" required value={reminderForm.title} onChange={e => setReminderForm({...reminderForm, title: e.target.value})} /></div>
              <div className="row g-2">
                <div className="col-6"><label className="small text-muted mb-1">Day of Month</label><input type="number" min="1" max="31" className="form-control" placeholder="1 - 31" required value={reminderForm.dayOfMonth} onChange={e => setReminderForm({...reminderForm, dayOfMonth: e.target.value})} /></div>
                <div className="col-6"><label className="small text-muted mb-1">Alert Time</label><input type="time" className="form-control" required value={reminderForm.time} onChange={e => setReminderForm({...reminderForm, time: e.target.value})} /></div>
              </div>
              <div className="row g-2">
                <div className="col-6"><label className="small text-muted mb-1">Amount (AED)</label><input type="number" step="0.01" className="form-control" placeholder="0.00" required value={reminderForm.amount} onChange={e => setReminderForm({...reminderForm, amount: e.target.value})} /></div>
                <div className="col-6"><label className="small text-muted mb-1">Recurrence</label><select className="form-select" value={reminderForm.recurrence} onChange={e => setReminderForm({...reminderForm, recurrence: e.target.value})}><option value="Monthly">Every Month</option><option value="Once">One Time</option></select></div>
              </div>
              <div className="row g-2">
                <div className="col-6"><label className="small text-muted mb-1">Category</label><select className="form-select" value={reminderForm.category} onChange={e => setReminderForm({...reminderForm, category: e.target.value})}><option value="Housing">Housing</option><option value="Bills">Bills</option><option value="Car">Car</option><option value="Subscriptions">Subscriptions</option><option value="Groceries">Groceries</option><option value="Telecom">Telecom</option><option value="Smoking">Smoking</option><option value="Patrol">Patrol</option></select></div>
              </div>
              <button type="submit" className="btn btn-primary w-100 mt-2 fw-bold py-2">Save Reminder</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Main />
      </AuthProvider>
    </BrowserRouter>
  );
}
