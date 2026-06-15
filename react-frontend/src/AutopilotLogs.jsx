import { useState, useEffect } from 'react';

export default function AutopilotLogs({ effectiveTheme }) {
  const [logs, setLogs] = useState([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    fetch('/api/autopilot/logs')
      .then(r => r.json())
      .then(setLogs)
      .catch(() => {});
  }, [expanded]);

  const isDark = effectiveTheme === 'dark';

  return (
    <div className={`mt-4 rounded-xl shadow-2xl ${isDark ? 'bg-slate-900 border border-slate-800/80' : 'bg-white border'}`} style={{ padding: '1.25rem' }}>
      <div
        className="d-flex align-items-center justify-content-between pb-3 mb-3"
        style={{ borderBottom: `1px solid ${isDark ? 'rgba(30,41,59,0.8)' : '#dee2e6'}` }}
      >
        <h3
          className="d-flex align-items-center gap-2 fw-semibold"
          style={{ fontSize: '0.75rem', letterSpacing: '0.05em', color: isDark ? '#94a3b8' : '#6c757d', cursor: 'pointer' }}
          onClick={() => setExpanded(e => !e)}
        >
          <span className="d-inline-block rounded-circle" style={{ width: 8, height: 8, backgroundColor: '#10b981', animation: expanded ? 'pulse 2s infinite' : 'none' }}></span>
          Autopilot Engine Logs
          <span className="ms-1" style={{ fontSize: '0.65rem', opacity: 0.5 }}>{expanded ? '▲' : '▼'}</span>
        </h3>
      </div>
      {expanded && (
        <div style={{ maxHeight: 208, overflowY: 'auto' }} className="d-flex flex-column gap-2 pr-2">
          {logs.length === 0 ? (
            <div className="small text-muted text-center py-3">No autopilot events recorded yet.</div>
          ) : (
            logs.map(log => (
              <div
                key={log.id}
                className="d-flex align-items-start gap-2 p-2 rounded"
                style={{ backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : '#f8f9fa', border: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : '#e9ecef'}` }}
              >
                <span className="d-inline-block rounded-circle mt-1 flex-shrink-0" style={{
                  width: 6, height: 6,
                  backgroundColor: log.event_type === 'AUTOPILOT_RECONCILE_EXPENSE' ? '#10b981' : '#3b82f6'
                }}></span>
                <div className="d-flex flex-column" style={{ minWidth: 0 }}>
                  <span style={{ fontSize: '0.78rem', color: isDark ? '#e2e8f0' : '#212529', wordBreak: 'break-word' }}>
                    {log.description}
                  </span>
                  <span style={{ fontSize: '0.65rem', color: isDark ? '#64748b' : '#999' }}>
                    {log.timestamp}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
