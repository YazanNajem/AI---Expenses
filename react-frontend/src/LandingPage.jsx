import { useNavigate } from 'react-router-dom';
import { ArrowRight, Shield, BarChart3, Bell, Wallet, Sparkles } from 'lucide-react';

const features = [
  { icon: <BarChart3 size={28} strokeWidth={1.5} />, title: 'Smart Expense Tracking', desc: 'Categorize, filter, and monitor every transaction. Visual charts give you a clear picture of where your money goes each month.' },
  { icon: <Bell size={28} strokeWidth={1.5} />, title: 'Upcoming Commitments', desc: 'Never miss a bill again. Our timeline shows exactly what is due, when, and how much — with a 2-day smart lookahead.' },
  { icon: <Shield size={28} strokeWidth={1.5} />, title: 'Absolute Privacy', desc: 'Toggle amount visibility on any page. Your financial data stays yours — no prying eyes, no shared screenshots.' },
  { icon: <Wallet size={28} strokeWidth={1.5} />, title: 'Combined Wealth View', desc: 'See your total net worth at a glance. Salary, savings, gold, stocks, crypto — all unified in one dashboard.' },
];

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="landing-wrapper" style={{ fontFamily: "'Urbanist', system-ui, -apple-system, sans-serif" }}>
      {/* ── Ambient BG Gradients ── */}
      <div className="landing-ambient" />
      <div className="landing-ambient-2" />

      {/* ── Hero ── */}
      <section className="landing-section">
        <div className="landing-section-inner" style={{ display: 'flex', alignItems: 'center', gap: '60px', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 400px' }}>
            <h1 className="landing-hero-title">
              Master Your<br /><span className="landing-gradient-text">Financial Future</span>
            </h1>
            <p className="landing-hero-sub">
              One vault. Total clarity.
            </p>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button className="landing-glow-btn" onClick={() => navigate('/login')}>
                Login
              </button>
              <button className="landing-ghost-btn" onClick={() => navigate('/register')}>
                Register
              </button>
            </div>
          </div>
          <div style={{ flex: '1 1 400px', display: 'flex', justifyContent: 'center' }}>
            <div className="landing-hero-card">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="landing-hero-label">Core Balance</span>
                  <span className="landing-hero-value">AED 18,450.00</span>
                </div>
                <div className="landing-divider" />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="landing-hero-label">Monthly Spent</span>
                  <span className="landing-hero-value" style={{ color: '#f87171' }}>AED 3,220.00</span>
                </div>
                <div className="landing-divider" />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="landing-hero-label">Savings</span>
                  <span className="landing-hero-value" style={{ color: '#4ade80' }}>AED 12,800.00</span>
                </div>
                <div className="landing-divider" />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="landing-hero-label">Gold Portfolio</span>
                  <span className="landing-hero-value" style={{ color: '#3b82f6' }}>AED 9,450.00</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="landing-section" style={{ paddingTop: '40px' }}>
        <div className="landing-section-inner">
          <h2 className="landing-section-title">
          One vault. <span className="landing-gradient-text">Total clarity</span>
          </h2>
          <div className="landing-features-grid">
            {features.map(f => (
              <div key={f.title} className="landing-feature-card">
                <div className="landing-feature-icon">{f.icon}</div>
                <h3 className="landing-feature-title">{f.title}</h3>
                <p className="landing-feature-desc" dir="auto" style={{ textAlign: 'start' }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Access Portal ── */}
      <section className="landing-section">
        <div className="landing-section-inner" style={{ display: 'flex', justifyContent: 'center' }}>
          <div className="landing-access-card">
            <div className="landing-access-icon"><Sparkles size={24} strokeWidth={1.5} /></div>
            <h2 className="landing-access-title">Ready to take control?</h2>
            <p className="landing-access-desc">Your financial command center is one click away. Zero setup, instant access.</p>
            <button className="landing-glow-btn" onClick={() => navigate('/dashboard')} style={{ width: '100%', justifyContent: 'center' }}>
              Enter the Vault <ArrowRight size={16} strokeWidth={2} style={{ marginLeft: 8 }} />
            </button>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <span className="landing-footer-copy">&copy; 2026 VaultTrack. All rights reserved.</span>
          <div style={{ display: 'flex', gap: '20px' }}>
            <span className="landing-footer-link">Privacy Policy</span>
            <span className="landing-footer-link">Terms of Service</span>
            <span className="landing-footer-link">Contact</span>
          </div>
        </div>
      </footer>
    </div>
  );
}