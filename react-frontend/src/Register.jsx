import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Sparkles, CheckCircle, Fingerprint, Eye, EyeOff, Lock } from 'lucide-react';
import { useAuth } from './AuthContext';

function b64toUint(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

function uintToB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  bytes.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin);
}

export default function Register() {
  const navigate = useNavigate();
  const { register } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [focused, setFocused] = useState(null);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function migrateLegacyData() {
    const metaKeys = [
      'customCategoryMeta', 'expenses_spent_override', 'loanMeta',
      'cashPaymentTxns', 'cashWithdrawalTxns', 'portfolio_weight_overrides',
      'theme',
    ];
    const legacyMetadata = {};
    for (const k of metaKeys) {
      const v = localStorage.getItem(k);
      if (v !== null) legacyMetadata[k] = v;
    }
    if (Object.keys(legacyMetadata).length) {
      try {
        await fetch('/api/auth/migrate-legacy', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ legacyMetadata }),
        });
      } catch {}
    }
    const cleanupKeys = ['daily_tasks_list', 'lastKnownCryptoPrice'];
    cleanupKeys.forEach(k => localStorage.removeItem(k));
  }

  async function handleRegister() {
    setError('');
    if (!name || !email || !password) { setError('Please fill in all fields'); return; }
    if (!email.includes('@')) { setError('Invalid email address'); return; }
    if (password.length < 12) { setError('Password must be at least 12 characters'); return; }
    setIsSubmitting(true);
    try {
      await register(name, email, password);
      await migrateLegacyData();
      navigate('/dashboard', { replace: true });
    } catch (e) {
      setError(e.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handlePasskeyRegister() {
    setError('');
    if (!name || !email || !password) { setError('Fill in all fields first to register a passkey'); return; }
    try {
      const loginRes = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      if (!loginRes.ok) {
        const loginErr = await loginRes.json();
        throw new Error(loginErr.error || 'Login failed before passkey registration');
      }
      const beginRes = await fetch('/api/auth/webauthn/register/begin', {
        method: 'POST', credentials: 'include',
      });
      if (!beginRes.ok) {
        const err = await beginRes.json();
        throw new Error(err.error || 'Passkey registration unavailable');
      }
      const opts = await beginRes.json();
      const pubKey = {
        ...opts,
        challenge: b64toUint(opts.challenge).buffer,
        user: { ...opts.user, id: b64toUint(opts.user.id).buffer },
      };
      const cred = await navigator.credentials.create({ publicKey: pubKey });
      const completeRes = await fetch('/api/auth/webauthn/register/complete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          id: cred.id,
          response: { publicKey: uintToB64(cred.response.getPublicKey()) },
        }),
      });
      const result = await completeRes.json();
      if (!completeRes.ok) throw new Error(result.error || 'Passkey registration failed');
      navigate('/dashboard', { replace: true });
    } catch (e) {
      if (e.name === 'NotAllowedError') return;
      setError(e.message);
    }
  }

  return (
    <div style={{ position: 'relative', minHeight: '100vh', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', width: '600px', height: '600px', top: '-15%', left: '-12%', borderRadius: '50%', filter: 'blur(100px)', opacity: 0.12, background: '#f59e0b' }} />
        <div style={{ position: 'absolute', width: '500px', height: '500px', bottom: '-15%', right: '-12%', borderRadius: '50%', filter: 'blur(100px)', opacity: 0.10, background: '#3b82f6' }} />
        <div style={{ position: 'absolute', width: '350px', height: '350px', top: '35%', left: '45%', borderRadius: '50%', filter: 'blur(100px)', opacity: 0.08, background: '#8b5cf6' }} />
        <div style={{ position: 'absolute', width: '280px', height: '280px', bottom: '15%', left: '10%', borderRadius: '50%', filter: 'blur(100px)', opacity: 0.08, background: '#10b981' }} />
      </div>
      <div className="premium-clean-form-card" style={{ maxWidth: '420px', width: '100%', padding: '36px 32px', borderRadius: '24px', position: 'relative', zIndex: 1 }}>
        <div className="text-center mb-3">
          <div className="landing-access-icon" style={{ margin: '0 auto 14px auto' }}><Sparkles size={22} strokeWidth={1.5} /></div>
          <h4 className="fw-bold mb-1" style={{ color: 'inherit', fontSize: '1.15rem' }}>Registration</h4>
          <p className="text-muted small" style={{ fontSize: '0.75rem' }}>Create your VaultTrack account</p>
        </div>
        <div style={{ position: 'relative', marginBottom: '18px' }}>
          <input className="form-control" type="text" value={name} onChange={e => { setName(e.target.value); setError(''); }} onFocus={() => setFocused('name')} onBlur={() => setFocused(null)} placeholder=" " style={{ width: '100%', height: '52px', padding: '18px 36px 6px 14px', fontSize: '0.85rem', backgroundColor: 'transparent', border: '1px solid rgba(128,128,128,0.2)', borderRadius: '12px', color: 'inherit', outline: 'none', transition: 'border-color 0.2s, box-shadow 0.2s', boxShadow: focused === 'name' ? '0 0 0 2px rgba(245,158,11,0.25)' : 'none', borderColor: focused === 'name' ? '#f59e0b' : 'rgba(128,128,128,0.2)' }} />
          <span style={{ position: 'absolute', left: '14px', top: (focused === 'name' || name) ? '6px' : '50%', transform: (focused === 'name' || name) ? 'translateY(0)' : 'translateY(-50%)', fontSize: (focused === 'name' || name) ? '0.6rem' : '0.8rem', color: focused === 'name' ? '#f59e0b' : 'var(--text-muted)', transition: 'all 0.2s ease', pointerEvents: 'none', fontWeight: (focused === 'name' || name) ? 600 : 400, lineHeight: 1.2 }}>Full Name</span>
          {name && name.length > 0 && <CheckCircle size={14} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: '#10b981', pointerEvents: 'none' }} />}
        </div>
        <div style={{ position: 'relative', marginBottom: '18px' }}>
          <input className="form-control" type="email" value={email} onChange={e => { setEmail(e.target.value); setError(''); }} onFocus={() => setFocused('email')} onBlur={() => setFocused(null)} placeholder=" " style={{ width: '100%', height: '52px', padding: '18px 36px 6px 14px', fontSize: '0.85rem', backgroundColor: 'transparent', border: '1px solid rgba(128,128,128,0.2)', borderRadius: '12px', color: 'inherit', outline: 'none', transition: 'border-color 0.2s, box-shadow 0.2s', boxShadow: focused === 'email' ? '0 0 0 2px rgba(245,158,11,0.25)' : 'none', borderColor: focused === 'email' ? '#f59e0b' : 'rgba(128,128,128,0.2)' }} />
          <span style={{ position: 'absolute', left: '14px', top: (focused === 'email' || email) ? '6px' : '50%', transform: (focused === 'email' || email) ? 'translateY(0)' : 'translateY(-50%)', fontSize: (focused === 'email' || email) ? '0.6rem' : '0.8rem', color: focused === 'email' ? '#f59e0b' : 'var(--text-muted)', transition: 'all 0.2s ease', pointerEvents: 'none', fontWeight: (focused === 'email' || email) ? 600 : 400, lineHeight: 1.2 }}>Email Address</span>
          {email && email.includes('@') && <CheckCircle size={14} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: '#10b981', pointerEvents: 'none' }} />}
        </div>
        <div style={{ position: 'relative', marginBottom: '18px' }}>
          <input className="form-control" type={showPassword ? 'text' : 'password'} value={password} onChange={e => { setPassword(e.target.value); setError(''); }} onFocus={() => setFocused('password')} onBlur={() => setFocused(null)} placeholder=" " style={{ width: '100%', height: '52px', padding: '18px 36px 6px 14px', fontSize: '0.85rem', backgroundColor: 'transparent', border: '1px solid rgba(128,128,128,0.2)', borderRadius: '12px', color: 'inherit', outline: 'none', transition: 'border-color 0.2s, box-shadow 0.2s', boxShadow: focused === 'password' ? '0 0 0 2px rgba(245,158,11,0.25)' : 'none', borderColor: focused === 'password' ? '#f59e0b' : 'rgba(128,128,128,0.2)' }} />
          <span style={{ position: 'absolute', left: '14px', top: (focused === 'password' || password) ? '6px' : '50%', transform: (focused === 'password' || password) ? 'translateY(0)' : 'translateY(-50%)', fontSize: (focused === 'password' || password) ? '0.6rem' : '0.8rem', color: focused === 'password' ? '#f59e0b' : 'var(--text-muted)', transition: 'all 0.2s ease', pointerEvents: 'none', fontWeight: (focused === 'password' || password) ? 600 : 400, lineHeight: 1.2 }}>Password</span>
          <div onClick={() => setShowPassword(!showPassword)} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', color: password.length >= 8 ? '#10b981' : 'var(--text-muted)', opacity: 0.5 }}>{showPassword ? <EyeOff size={14} /> : <Eye size={14} />}</div>
        </div>
        {error && <div style={{ color: '#ef4444', fontSize: '0.75rem', textAlign: 'center', marginBottom: '12px', padding: '6px 12px', backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: '8px' }}>{error}</div>}
        <button type="button" className="landing-glow-btn w-100 justify-content-center mb-2" onClick={handleRegister} disabled={isSubmitting} style={{ opacity: isSubmitting ? 0.6 : 1 }}>{isSubmitting ? 'Creating account…' : 'Create Account'}</button>
        <button style={{ width: '100%', padding: '11px', borderRadius: '12px', backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(128,128,128,0.12)', backdropFilter: 'blur(8px)', color: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer', transition: 'all 0.3s', marginBottom: '18px', fontSize: '0.8rem', fontWeight: 500, opacity: 0.75 }}
          onClick={handlePasskeyRegister}
          onMouseEnter={e => { e.target.style.borderColor = 'rgba(245,158,11,0.4)'; e.target.style.boxShadow = '0 0 12px rgba(245,158,11,0.12)'; e.target.style.opacity = '1'; }}
          onMouseLeave={e => { e.target.style.borderColor = 'rgba(128,128,128,0.12)'; e.target.style.boxShadow = 'none'; e.target.style.opacity = '0.75'; }}>
          <Fingerprint size={17} />
          Register with Passkey
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <div style={{ flex: 1, height: '1px', backgroundColor: 'rgba(128,128,128,0.12)' }} />
          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', opacity: 0.4, letterSpacing: '0.05em' }}>OR</span>
          <div style={{ flex: 1, height: '1px', backgroundColor: 'rgba(128,128,128,0.12)' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '2px' }}>
          <button style={{ width: '100%', padding: '9px 16px', borderRadius: '10px', backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(128,128,128,0.08)', backdropFilter: 'blur(8px)', color: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', cursor: 'pointer', transition: 'all 0.3s', fontSize: '0.75rem', fontWeight: 500, opacity: 0.75 }}
            onMouseEnter={e => { e.target.style.borderColor = 'rgba(128,128,128,0.25)'; e.target.style.opacity = '1'; }}
            onMouseLeave={e => { e.target.style.borderColor = 'rgba(128,128,128,0.08)'; e.target.style.opacity = '0.75'; }}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>
            Sign up with Apple
          </button>
          <button style={{ width: '100%', padding: '9px 16px', borderRadius: '10px', backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(128,128,128,0.08)', backdropFilter: 'blur(8px)', color: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', cursor: 'pointer', transition: 'all 0.3s', fontSize: '0.75rem', fontWeight: 500, opacity: 0.75 }}
            onMouseEnter={e => { e.target.style.borderColor = 'rgba(128,128,128,0.25)'; e.target.style.opacity = '1'; }}
            onMouseLeave={e => { e.target.style.borderColor = 'rgba(128,128,128,0.08)'; e.target.style.opacity = '0.75'; }}>
            <svg viewBox="0 0 24 24" width="15" height="15"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            Sign up with Google
          </button>
        </div>
        <p className="text-center mb-0" style={{ fontSize: '0.75rem', color: 'var(--text-muted, #6c757d)', marginTop: '14px' }}>
          Already have an account?{' '}
          <Link to="/login" replace style={{ color: 'inherit', fontWeight: 600, textDecoration: 'none', transition: 'color 0.3s' }}
            onMouseEnter={e => e.target.style.color = '#f59e0b'}
            onMouseLeave={e => e.target.style.color = 'inherit'}>
            Login
          </Link>
        </p>
        <button className="btn btn-sm btn-link w-100 text-muted" onClick={() => navigate('/')} style={{ textDecoration: 'none', marginTop: '2px', fontSize: '0.7rem' }}><ArrowLeft size={13} className="me-1" /> Back to Home</button>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px', marginTop: '18px', opacity: 0.5, fontSize: '0.6rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          <Lock size={9} />
          Secured by AES-256 Encryption
        </div>
      </div>
    </div>
  );
}
