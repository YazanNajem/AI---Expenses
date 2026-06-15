import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Sparkles } from 'lucide-react';

export default function Register() {
  const navigate = useNavigate();
  return (
    <div className="d-flex align-items-center justify-content-center" style={{ minHeight: '100vh', padding: '24px' }}>
      <div className="premium-clean-form-card" style={{ maxWidth: '420px', width: '100%', padding: '40px 36px', borderRadius: '24px' }}>
        <div className="text-center mb-4">
          <div className="landing-access-icon" style={{ margin: '0 auto 16px auto' }}><Sparkles size={24} strokeWidth={1.5} /></div>
          <h4 className="fw-bold mb-1" style={{ color: 'inherit' }}>Registration</h4>
          <p className="text-muted small" style={{ fontSize: '0.8rem' }}>Create your VaultTrack account</p>
        </div>
        <div className="mb-3">
          <label className="form-label small text-muted" style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Full Name</label>
          <input className="form-control" type="text" placeholder="John Doe" />
        </div>
        <div className="mb-3">
          <label className="form-label small text-muted" style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Email</label>
          <input className="form-control" type="email" placeholder="you@example.com" />
        </div>
        <div className="mb-4">
          <label className="form-label small text-muted" style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Password</label>
          <input className="form-control" type="password" placeholder="••••••••" />
        </div>
        <button className="landing-glow-btn w-100 justify-content-center mb-3" onClick={() => navigate('/dashboard')}>Create Account</button>
        <p className="text-center mb-3" style={{ fontSize: '0.8rem', color: 'var(--text-muted, #6c757d)' }}>
          Already have an account?{' '}
          <Link to="/login" replace style={{ color: 'inherit', fontWeight: 600, textDecoration: 'none', transition: 'color 0.3s' }}
            onMouseEnter={e => e.target.style.color = '#f59e0b'}
            onMouseLeave={e => e.target.style.color = 'inherit'}>
            Login
          </Link>
        </p>
        <button className="btn btn-sm btn-link w-100 text-muted" onClick={() => navigate('/')} style={{ textDecoration: 'none' }}><ArrowLeft size={14} className="me-1" /> Back to Home</button>
      </div>
    </div>
  );
}