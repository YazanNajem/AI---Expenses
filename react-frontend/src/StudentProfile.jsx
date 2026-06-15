import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from 'chart.js';
import { fetchStudentData, fetchStudentSessions, archiveStudent } from './api';
import { fmtAED, sendWhatsApp, generateInvoice } from './helpers';
import { Archive, MessageCircle, FileText } from 'lucide-react';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

export default function StudentProfile({ effectiveTheme, showToast }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [student, setStudent] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [archived, setArchived] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [sd, ss] = await Promise.all([
      fetchStudentData(id),
      fetchStudentSessions(id)
    ]);
    if (sd.error) { navigate('/tutoring'); return; }
    setStudent(sd);
    setSessions(ss.sessions || []);
    setArchived(sd.is_archived || false);
    setLoading(false);
  }, [id, navigate]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleArchive = async () => {
    if (!confirm(`${archived ? 'Restore' : 'Archive'} "${student.name}"?`)) return;
    const result = await archiveStudent(id, !archived);
    if (result.error) { showToast(result.error, 'error'); return; }
    setArchived(!archived);
  };

  const totalHours = sessions.reduce((sum, s) => sum + (s.hours || 0) + (s.minutes || 0) / 60, 0);
  const totalPaid = sessions.reduce((sum, s) => sum + (s.amount_paid || 0), 0);
  const totalDue = sessions.reduce((sum, s) => sum + (s.amount_due || 0), 0);
  const totalRemaining = totalDue - totalPaid;

  const monthly = sessions.reduce((acc, s) => {
    const month = s.session_date?.slice(0, 7) || 'Unknown';
    if (!acc[month]) acc[month] = { revenue: 0, hours: 0 };
    acc[month].revenue += s.amount_due || 0;
    acc[month].hours += (s.hours || 0) + (s.minutes || 0) / 60;
    return acc;
  }, {});
  const monthlyData = Object.entries(monthly).sort(([a], [b]) => a.localeCompare(b));

  const isDark = effectiveTheme === 'dark';
  const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
  const tickColor = isDark ? '#bbb' : '#666';
  const legendColor = isDark ? '#ccc' : '#666';

  const chartData = monthlyData.length ? {
    labels: monthlyData.map(([m]) => m),
    datasets: [
      { label: 'Revenue (AED)', data: monthlyData.map(([, d]) => d.revenue), backgroundColor: isDark ? 'rgba(40,167,69,0.5)' : 'rgba(40,167,69,0.7)', borderColor: '#28a745', borderWidth: 1, yAxisID: 'y' },
      { label: 'Hours', data: monthlyData.map(([, d]) => +d.hours.toFixed(1)), backgroundColor: isDark ? 'rgba(13,202,240,0.5)' : 'rgba(13,202,240,0.7)', borderColor: '#0dcaf0', borderWidth: 1, yAxisID: 'y1' }
    ]
  } : null;

  const chartOptions = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 }, color: legendColor } } },
    scales: {
      y: { beginAtZero: true, position: 'left', title: { display: true, text: 'AED', color: tickColor }, grid: { color: gridColor }, ticks: { color: tickColor } },
      y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Hours', color: tickColor }, ticks: { color: tickColor } },
      x: { grid: { color: gridColor }, ticks: { color: tickColor } }
    }
  };

  if (loading) return <div className="container mt-5 text-center"><div className="spinner-border"></div><p className="mt-2">Loading...</p></div>;
  if (!student) return null;

  return (
    <div className="container">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h3>{student.name} {archived && <span className="badge bg-secondary ms-2">Archived</span>}</h3>
        <div>
          <button className={`btn btn-sm me-1 ${archived ? 'btn-outline-warning' : 'btn-outline-secondary'}`} onClick={handleArchive}>
            <Archive size={16} strokeWidth={2} className="me-1" /> {archived ? 'Restore' : 'Archive'}
          </button>
          <Link to="/tutoring" className="btn btn-outline-secondary btn-sm">&larr; Back</Link>
        </div>
      </div>

      <div className="row g-3 mb-4">
        <div className="col-md-4"><div className="card border-primary h-100"><div className="card-body text-center"><h6 className="card-subtitle text-muted">Total Hours</h6><h2 className="card-title text-primary mt-2 mb-0">{totalHours.toFixed(1)} hrs</h2></div></div></div>
        <div className="col-md-4"><div className="card border-success h-100"><div className="card-body text-center"><h6 className="card-subtitle text-muted">Amount Paid</h6><h2 className="card-title text-success mt-2 mb-0">{fmtAED(totalPaid)}</h2></div></div></div>
        <div className="col-md-4"><div className="card border-danger h-100"><div className="card-body text-center"><h6 className="card-subtitle text-muted">Remaining</h6><h2 className="card-title text-danger mt-2 mb-0">{fmtAED(totalRemaining)}</h2></div></div></div>
      </div>

      <div className="row g-3 mb-4">
        <div className="col-md-6">
          <div className="card h-100">
            <div className="card-header"><strong>Monthly Progress</strong></div>
            <div className="card-body">{chartData && <Bar data={chartData} options={chartOptions} height={200} />}</div>
          </div>
        </div>
        <div className="col-md-6">
          <div className="card h-100">
            <div className="card-header"><strong>Summary</strong></div>
            <div className="card-body">
              <table className="table table-sm mb-0">
                <tbody>
                  <tr><td><strong>Subject</strong></td><td>{student.subject || 'N/A'}</td></tr>
                  <tr><td><strong>WhatsApp</strong></td><td>{student.phone_number ? <a href={`https://wa.me/${student.phone_number.replace(/\+/g, '')}`} target="_blank" rel="noreferrer" className="text-decoration-none">{student.phone_number}</a> : 'Not set'}</td></tr>
                  <tr><td><strong>Total Due</strong></td><td>{fmtAED(totalDue)}</td></tr>
                  <tr><td><strong>Total Paid</strong></td><td className="text-success fw-bold">{fmtAED(totalPaid)}</td></tr>
                  <tr><td><strong>Remaining</strong></td><td className="text-danger fw-bold">{fmtAED(totalRemaining)}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-header d-flex align-items-center justify-content-between">
          <strong>Session History</strong>
          <div className="d-flex gap-2">
            {totalRemaining > 0 && student.phone_number && <button className="btn btn-sm btn-success" onClick={() => sendWhatsApp(student.phone_number, student.name, totalRemaining)}><MessageCircle size={16} strokeWidth={2} className="me-1" /> WhatsApp</button>}
            <button className="btn btn-sm btn-outline-success" onClick={() => generateInvoice(id)}><FileText size={16} strokeWidth={2} className="me-1" /> PDF</button>
          </div>
        </div>
        <div className="card-body p-0">
          {sessions.length === 0 ? <div className="card-body"><p className="text-muted mb-0">No sessions recorded.</p></div> : (
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead className="table-dark"><tr><th>#</th><th>Subject</th><th>Time</th><th>Due</th><th>Paid</th><th>Status</th><th>Date</th></tr></thead>
                <tbody>
                  {sessions.map((s, i) => {
                    const rem = s.amount_due - s.amount_paid;
                    const status = rem <= 0 ? 'Paid' : s.amount_paid > 0 ? 'Partial' : 'Unpaid';
                    const cls = status === 'Paid' ? 'badge-glass-paid' : status === 'Partial' ? 'badge-glass-partial' : 'badge-glass-unpaid';
                    return (
                      <tr key={s.id}>
                        <td>{i + 1}</td><td>{s.subject || '---'}</td><td>{s.hours}h {s.minutes}m</td>
                        <td>{fmtAED(s.amount_due)}</td><td>{fmtAED(s.amount_paid)}</td>
                        <td><span className={cls}>{status}</span></td><td>{s.session_date}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
