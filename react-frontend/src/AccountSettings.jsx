import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Shield, Sliders, Download, Fingerprint, Camera, CheckCircle, Eye, EyeOff, Smartphone, Monitor, Globe, LogOut, Trash2, RotateCcw } from 'lucide-react';
import Cropper from 'react-easy-crop';
import 'react-easy-crop/react-easy-crop.css';
import { useAuth } from './AuthContext';

const TABS = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'preferences', label: 'Preferences', icon: Sliders },
  { id: 'data', label: 'Data & Export', icon: Download },
];

function iOSSwitch({ checked, onChange, label, textColor }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', justifyContent: 'space-between', width: '100%' }}>
      <span style={{ fontSize: '0.875rem', color: textColor }}>{label}</span>
      <div style={{ position: 'relative', width: '51px', height: '31px', flexShrink: 0 }}>
        <input type="checkbox" checked={checked} onChange={onChange} style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }} />
        <div style={{
          width: '100%', height: '100%', borderRadius: '9999px',
          backgroundColor: checked ? '#22c55e' : 'rgba(128,128,128,0.35)',
          transition: 'background-color 0.25s ease',
          display: 'flex', alignItems: 'center',
          padding: checked ? '0 0 0 2px' : '0 2px 0 0',
          justifyContent: checked ? 'flex-start' : 'flex-end',
          boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.2)',
        }}>
          <div style={{
            width: '27px', height: '27px', borderRadius: '50%',
            backgroundColor: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
            transition: 'transform 0.25s ease',
          }} />
        </div>
      </div>
    </label>
  );
}

function createCroppedImage(imageSrc, pixelCrop) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('No 2d context')); return; }
      canvas.width = pixelCrop.width;
      canvas.height = pixelCrop.height;
      ctx.drawImage(
        image,
        pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height,
        0, 0, pixelCrop.width, pixelCrop.height
      );
      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    image.onerror = reject;
    image.src = imageSrc;
  });
}

export default function AccountSettings({ effectiveTheme, theme, setTheme, showToast }) {
  const isDark = effectiveTheme === 'dark';
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('profile');

  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [nameFocused, setNameFocused] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [sessions] = useState([
    { id: 1, device: 'MacBook Pro — Safari', ip: '192.168.1.42', lastActive: 'Active now', current: true },
    { id: 2, device: 'iPhone 16 — iOS App', ip: '192.168.1.101', lastActive: '2 min ago', current: false },
    { id: 3, device: 'Windows PC — Chrome', ip: '86.75.30.9', lastActive: '3 hours ago', current: false },
  ]);
  const [passkeys, setPasskeys] = useState([]);

  const [privacyMode, setPrivacyMode] = useState(() => localStorage.getItem('privacy_blur') === 'true');

  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [avatarPreview, setAvatarPreview] = useState(() => localStorage.getItem('user_avatar') || null);
  const fileInputRef = useRef(null);

  const [originalImageSrc, setOriginalImageSrc] = useState(null);
  const [isCropModalOpen, setIsCropModalOpen] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);

  const [savingProfile, setSavingProfile] = useState(false);

  const cardBg = 'var(--card-glass-bg)';
  const borderColor = 'var(--card-glass-border)';
  const textColor = isDark ? '#cbd5e1' : '#475569';
  const headingColor = isDark ? '#ffffff' : '#0f172a';
  const textMuted = isDark ? '#64748b' : '#94a3b8';
  const inputBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';

  function handlePrivacyToggle(e) {
    const v = e.target.checked;
    setPrivacyMode(v);
    localStorage.setItem('privacy_blur', String(v));
  }

  function handleLogout() {
    logout();
    navigate('/login');
  }

  function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setOriginalImageSrc(ev.target.result);
      setIsCropModalOpen(true);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  const onCropComplete = useCallback((croppedArea, croppedAreaPx) => {
    setCroppedAreaPixels(croppedAreaPx);
  }, []);

  async function handleCropSave() {
    if (!originalImageSrc || !croppedAreaPixels) return;
    try {
      const cropped = await createCroppedImage(originalImageSrc, croppedAreaPixels);
      setAvatarPreview(cropped);
      localStorage.setItem('user_avatar', cropped);
      setIsCropModalOpen(false);
      setOriginalImageSrc(null);
    } catch {
      alert('Failed to crop image.');
    }
  }

  function handleCropCancel() {
    setIsCropModalOpen(false);
    setOriginalImageSrc(null);
  }

  function handleSaveProfile() {
    setSavingProfile(true);
    setTimeout(() => {
      setSavingProfile(false);
      showToast('Profile updated successfully.', 'success');
    }, 600);
  }

  function handleChangePassword(e) {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match.');
      return;
    }
    if (newPassword.length < 12) {
      setPasswordError('Password must be at least 12 characters.');
      return;
    }
    setTimeout(() => {
      setPasswordSuccess('Password changed successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPasswordSuccess(''), 2500);
    }, 600);
  }

  async function handleRegisterPasskey() {
    if (!window.PublicKeyCredential) {
      alert('Passkeys are not supported on this browser.');
      return;
    }
    try {
      const resp = await fetch('/api/auth/webauthn/register/begin', { method: 'POST', credentials: 'include' });
      const options = await resp.json();
      const credential = await navigator.credentials.create({ publicKey: options });
      const result = await fetch('/api/auth/webauthn/register/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id: credential.id, response: { publicKey: '' } }),
      });
      const data = await result.json();
      if (data.success) {
        setPasskeys(p => [...p, { id: credential.id, device: 'Current Device', registeredAt: new Date().toISOString() }]);
      }
    } catch (err) {
      alert('Failed to register passkey.');
    }
  }

  const labelStyle = (focused, hasValue) => ({
    position: 'absolute', left: '14px', pointerEvents: 'none', lineHeight: 1.2,
    top: (focused || hasValue) ? '6px' : '50%',
    transform: (focused || hasValue) ? 'translateY(0)' : 'translateY(-50%)',
    fontSize: (focused || hasValue) ? '0.6rem' : '0.8rem',
    color: focused ? '#3b82f6' : textMuted,
    transition: 'all 0.2s ease', fontWeight: (focused || hasValue) ? 600 : 400,
  });

  function renderFloatingInput({ id, label, type, value, setValue, focused, setFocused }) {
    const hasValue = !!value;
    return (
      <div style={{ position: 'relative', marginBottom: '18px' }}>
        <input
          id={id} type={type} value={value} placeholder=" "
          onChange={e => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            width: '100%', height: '52px', padding: '18px 14px 4px', fontSize: '0.85rem',
            borderRadius: '12px', border: focused ? '1px solid rgba(59,130,246,0.4)' : `1px solid ${borderColor}`,
            backgroundColor: inputBg, color: textColor, outline: 'none',
            boxShadow: focused ? '0 0 0 2px rgba(59,130,246,0.15)' : 'none',
            transition: 'all 0.2s ease',
          }}
        />
        <span style={labelStyle(focused, hasValue)}>{label}</span>
        {hasValue && id === 'settings-email' && email.includes('@') && (
          <CheckCircle size={14} style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', color: '#22c55e' }} />
        )}
      </div>
    );
  }

  const tabContent = {
    profile: (
      <div>
        <h5 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '24px', color: headingColor }}>Profile Information</h5>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '28px' }}>
          <div style={{ position: 'relative', display: 'inline-block', flexShrink: 0, lineHeight: 0 }}>
            <div onClick={() => fileInputRef.current?.click()} style={{ width: '72px', height: '72px', borderRadius: '50%', overflow: 'hidden', backgroundColor: inputBg, border: `2px solid ${borderColor}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', position: 'relative' }}>
              {avatarPreview ? (
                <img src={avatarPreview} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span style={{ fontSize: '1.6rem', fontWeight: 600, color: textMuted }}>
                  {(user?.name || 'U')[0].toUpperCase()}
                </span>
              )}
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)', opacity: 0, transition: 'opacity 0.2s', borderRadius: '50%' }}
                   onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                   onMouseLeave={e => e.currentTarget.style.opacity = '0'}>
                <Camera size={18} color="#fff" strokeWidth={2} />
              </div>
            </div>
            {avatarPreview && (
              <button onClick={e => { e.stopPropagation(); setAvatarPreview(null); localStorage.removeItem('user_avatar'); showToast('Profile photo removed.', 'success'); }} style={{
                position: 'absolute', top: '0', right: '0', zIndex: 20,
                transform: 'translate(25%, -25%)',
                width: '28px', height: '28px', borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '1px solid rgba(239,68,68,0.4)',
                backgroundColor: 'rgba(239,68,68,0.2)', color: '#f87171', cursor: 'pointer',
                backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.2)', transition: 'all 0.3s',
              }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.4)'; e.currentTarget.style.color = '#fca5a5'; e.currentTarget.style.transform = 'translate(25%, -25%) scale(1.1)'; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.2)'; e.currentTarget.style.color = '#f87171'; e.currentTarget.style.transform = 'translate(25%, -25%)'; }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarChange} style={{ display: 'none' }} />
          <div>
            <div style={{ fontSize: '0.95rem', fontWeight: 600, color: textColor }}>{user?.name || 'User'}</div>
            <div style={{ fontSize: '0.78rem', color: textMuted }}>{user?.email || ''}</div>
          </div>
        </div>

        {renderFloatingInput({ id: 'settings-name', label: 'Full Name', type: 'text', value: name, setValue: setName, focused: nameFocused, setFocused: setNameFocused })}
        {renderFloatingInput({ id: 'settings-email', label: 'Email Address', type: 'email', value: email, setValue: setEmail, focused: emailFocused, setFocused: setEmailFocused })}
        <button onClick={handleSaveProfile} disabled={savingProfile} style={{
          width: '100%', padding: '12px', borderRadius: '12px', border: 'none', fontSize: '0.85rem', fontWeight: 600,
          color: '#fff', background: 'linear-gradient(135deg, #3b82f6, #2563eb)', cursor: 'pointer', opacity: savingProfile ? 0.6 : 1,
        }}>{savingProfile ? 'Saving…' : 'Save Changes'}</button>
      </div>
    ),
    security: (
      <div>
        <h5 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', color: headingColor }}>Change Password</h5>
        <form onSubmit={handleChangePassword}>
          <div style={{ position: 'relative', marginBottom: '12px' }}>
            <input type={showCurrent ? 'text' : 'password'} placeholder="Current Password" value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              style={{ width: '100%', height: '44px', padding: '0 38px 0 14px', fontSize: '0.85rem', borderRadius: '10px', border: `1px solid ${borderColor}`, backgroundColor: inputBg, color: textColor, outline: 'none' }} />
            <button type="button" onClick={() => setShowCurrent(s => !s)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: textMuted, cursor: 'pointer', padding: 0 }}>
              {showCurrent ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <div style={{ position: 'relative', marginBottom: '12px' }}>
            <input type={showNew ? 'text' : 'password'} placeholder="New Password" value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              style={{ width: '100%', height: '44px', padding: '0 38px 0 14px', fontSize: '0.85rem', borderRadius: '10px', border: `1px solid ${borderColor}`, backgroundColor: inputBg, color: textColor, outline: 'none' }} />
            <button type="button" onClick={() => setShowNew(s => !s)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: textMuted, cursor: 'pointer', padding: 0 }}>
              {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <div style={{ position: 'relative', marginBottom: '14px' }}>
            <input type={showConfirm ? 'text' : 'password'} placeholder="Confirm New Password" value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              style={{ width: '100%', height: '44px', padding: '0 38px 0 14px', fontSize: '0.85rem', borderRadius: '10px', border: `1px solid ${borderColor}`, backgroundColor: inputBg, color: textColor, outline: 'none' }} />
            <button type="button" onClick={() => setShowConfirm(s => !s)} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: textMuted, cursor: 'pointer', padding: 0 }}>
              {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {passwordError && <div style={{ fontSize: '0.78rem', color: '#ef4444', marginBottom: '10px' }}>{passwordError}</div>}
          {passwordSuccess && <div style={{ fontSize: '0.78rem', color: '#22c55e', marginBottom: '10px' }}>{passwordSuccess}</div>}
          <button type="submit" style={{
            width: '100%', padding: '11px', borderRadius: '10px', border: 'none', fontSize: '0.85rem', fontWeight: 600,
            color: '#fff', background: 'linear-gradient(135deg, #3b82f6, #2563eb)', cursor: 'pointer',
          }}>Update Password</button>
        </form>

        <hr style={{ borderColor, margin: '28px 0' }} />

        <h5 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '8px', color: headingColor }}>Passkeys & Biometric Devices</h5>
        <p style={{ fontSize: '0.78rem', color: textMuted, marginBottom: '16px' }}>Use Face ID, Touch ID, or Windows Hello for password-free login.</p>
        {passkeys.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
            {passkeys.map((pk, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: '10px', backgroundColor: inputBg, border: `1px solid ${borderColor}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Fingerprint size={16} style={{ color: '#3b82f6' }} />
                  <div><div style={{ fontSize: '0.82rem', color: textColor }}>{pk.device}</div><div style={{ fontSize: '0.7rem', color: textMuted }}>Registered {new Date(pk.registeredAt).toLocaleDateString()}</div></div>
                </div>
                <button style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px', fontSize: '0.75rem' }}>Remove</button>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ padding: '16px', borderRadius: '12px', backgroundColor: inputBg, border: `1px dashed ${borderColor}`, textAlign: 'center', marginBottom: '16px' }}>
            <Fingerprint size={28} style={{ color: textMuted, marginBottom: '8px', opacity: 0.5 }} />
            <div style={{ fontSize: '0.82rem', color: textMuted }}>No passkeys registered yet</div>
          </div>
        )}
        <button onClick={handleRegisterPasskey} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '100%',
          padding: '12px', borderRadius: '12px', border: '1px solid rgba(59,130,246,0.3)', fontSize: '0.85rem', fontWeight: 600,
          color: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.08)', cursor: 'pointer',
        }}>
          <Fingerprint size={16} /> Register New Device
        </button>

        <hr style={{ borderColor, margin: '28px 0' }} />

        <h5 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '12px', color: headingColor }}>Active Sessions</h5>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
          {sessions.map(s => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: '10px', backgroundColor: inputBg, border: `1px solid ${borderColor}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {s.device.includes('Mac') ? <Monitor size={16} style={{ color: textMuted }} /> : s.device.includes('iPhone') ? <Smartphone size={16} style={{ color: textMuted }} /> : <Globe size={16} style={{ color: textMuted }} />}
                <div>
                  <div style={{ fontSize: '0.82rem', color: textColor, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {s.device}
                    {s.current && <span style={{ fontSize: '0.65rem', color: '#22c55e', backgroundColor: 'rgba(34,197,94,0.12)', padding: '1px 6px', borderRadius: '4px' }}>Current</span>}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: textMuted }}>{s.ip} — {s.lastActive}</div>
                </div>
              </div>
              {!s.current && (
                <button style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px', fontSize: '0.75rem' }}>Revoke</button>
              )}
            </div>
          ))}
        </div>
      </div>
    ),
    preferences: (
      <div>
        <h5 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '20px', color: headingColor }}>App Preferences</h5>
        <div style={{ marginBottom: '24px' }}>
          <label style={{ fontSize: '0.82rem', fontWeight: 500, color: textColor, display: 'block', marginBottom: '8px' }}>Theme</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            {['light', 'dark', 'system'].map(t => (
              <button key={t} onClick={() => setTheme(t)} style={{
                flex: 1, padding: '10px', borderRadius: '10px', border: theme === t ? '1px solid rgba(59,130,246,0.4)' : `1px solid ${borderColor}`,
                backgroundColor: theme === t ? 'rgba(59,130,246,0.1)' : inputBg, color: textColor, cursor: 'pointer', fontSize: '0.78rem', fontWeight: theme === t ? 600 : 400,
                transition: 'all 0.2s',
              }}>
                {t === 'light' ? '☀️ Light' : t === 'dark' ? '🌙 Dark' : '💻 System'}
              </button>
            ))}
          </div>
        </div>
        <div style={{ padding: '14px 16px', borderRadius: '12px', backgroundColor: inputBg, border: `1px solid ${borderColor}`, marginBottom: '16px' }}>
          <iOSSwitch checked={privacyMode} onChange={handlePrivacyToggle} textColor={textColor} label="Privacy Mode (blur financial numbers)" />
        </div>
        <p style={{ fontSize: '0.75rem', color: textMuted, lineHeight: 1.5 }}>
          Privacy Mode hides all financial figures behind blurred overlays across the app. Toggle this on when using VaultTrack in public or shared spaces.
        </p>
      </div>
    ),
    data: (
      <div>
        <h5 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '8px', color: headingColor }}>Your Data</h5>
        <p style={{ fontSize: '0.82rem', color: textMuted, lineHeight: 1.6, marginBottom: '20px' }}>
          You own all your data. VaultTrack stores your financial records, tutoring sessions, and preferences locally in your database. You can export a complete archive of your data at any time.
        </p>
        <div style={{ padding: '20px', borderRadius: '12px', backgroundColor: inputBg, border: `1px solid ${borderColor}`, marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '12px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '10px', backgroundColor: 'rgba(34,197,94,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Download size={18} style={{ color: '#22c55e' }} />
            </div>
            <div>
              <div style={{ fontSize: '0.9rem', fontWeight: 600, color: textColor }}>Download Data Archive</div>
              <div style={{ fontSize: '0.75rem', color: textMuted }}>Export all transactions, sessions, and portfolio data as CSV files</div>
            </div>
          </div>
          <button style={{
            width: '100%', padding: '12px', borderRadius: '12px', border: 'none', fontSize: '0.85rem', fontWeight: 600,
            color: '#fff', background: 'linear-gradient(135deg, #22c55e, #16a34a)', cursor: 'pointer',
          }}>Download Archive</button>
        </div>

        <div style={{ padding: '20px', borderRadius: '12px', backgroundColor: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '12px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '10px', backgroundColor: 'rgba(239,68,68,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Trash2 size={18} style={{ color: '#ef4444' }} />
            </div>
            <div>
              <div style={{ fontSize: '0.9rem', fontWeight: 600, color: textColor }}>Delete Account</div>
              <div style={{ fontSize: '0.75rem', color: textMuted }}>Permanently remove all your data and account</div>
            </div>
          </div>
          <button style={{
            width: '100%', padding: '12px', borderRadius: '12px', border: '1px solid rgba(239,68,68,0.3)', fontSize: '0.85rem', fontWeight: 600,
            color: '#ef4444', backgroundColor: 'transparent', cursor: 'pointer',
          }}>Delete My Account</button>
        </div>
      </div>
    ),
  };

  const mainStyle = {
    minHeight: 'calc(100vh - 120px)',
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
    padding: '32px 24px',
  };

  const glassCard = {
    display: 'flex', gap: '24px', width: '100%', maxWidth: '860px',
    borderRadius: '24px', backdropFilter: 'blur(24px) saturate(185%)',
    WebkitBackdropFilter: 'blur(24px) saturate(185%)',
    backgroundColor: cardBg, border: `1px solid ${borderColor}`,
    boxShadow: 'var(--card-glass-inset), var(--card-glass-shadow)',
    padding: '24px',
  };

  return (
    <div style={mainStyle}>
      <div style={glassCard}>
        {/* Sidebar */}
        <div style={{
          width: '200px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '4px',
          paddingRight: '24px', borderRight: `1px solid ${borderColor}`, background: 'transparent',
        }}>
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '10px 12px',
                borderRadius: '10px', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: '0.82rem', fontWeight: isActive ? 600 : 400,
                backgroundColor: isActive ? 'rgba(59,130,246,0.1)' : 'transparent',
                color: isActive ? '#3b82f6' : textColor,
                transition: 'all 0.2s',
              }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.backgroundColor = inputBg; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'; }}>
                <Icon size={16} strokeWidth={isActive ? 2.5 : 2} />
                {tab.label}
              </button>
            );
          })}
          <div style={{ flex: 1 }} />
          <button onClick={handleLogout} style={{
            display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '10px 12px',
            borderRadius: '10px', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: '0.82rem',
            color: textMuted, backgroundColor: 'transparent', transition: 'all 0.2s', marginTop: '8px',
          }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = inputBg; e.currentTarget.style.color = '#ef4444'; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = textMuted; }}>
            <LogOut size={16} />
            Sign Out
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0, background: 'transparent' }}>
          {tabContent[activeTab]}
        </div>
      </div>

      {/* ─── Crop Modal ─── */}
      {isCropModalOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          backgroundColor: 'rgba(0,0,0,0.55)',
          backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '24px',
        }} onClick={handleCropCancel}>
          <div onClick={e => e.stopPropagation()} style={{
            width: '100%', maxWidth: '480px',
            borderRadius: '24px',
            backdropFilter: 'blur(32px)',
            backgroundColor: isDark ? 'rgba(18,18,24,0.92)' : 'rgba(255,255,255,0.92)',
            border: `1px solid ${borderColor}`,
            boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
            overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{
              padding: '20px 24px 0',
              fontSize: '1.05rem', fontWeight: 600, color: textColor,
            }}>
              Crop Profile Photo
            </div>

            {/* Cropper */}
            <div style={{ position: 'relative', width: '100%', height: '340px', marginTop: '16px', backgroundColor: '#000' }}>
              {originalImageSrc && (
                <Cropper
                  image={originalImageSrc}
                  crop={crop}
                  zoom={zoom}
                  aspect={1}
                  cropShape="round"
                  showGrid={false}
                  onCropChange={setCrop}
                  onZoomChange={setZoom}
                  onCropComplete={onCropComplete}
                  style={{
                    containerStyle: { backgroundColor: '#000' },
                  }}
                />
              )}
            </div>

            {/* Zoom slider */}
            <div style={{ padding: '16px 24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '0.7rem', color: textMuted }}>−</span>
              <input
                type="range"
                min={1}
                max={3}
                step={0.01}
                value={zoom}
                onChange={e => setZoom(Number(e.target.value))}
                style={{
                  flex: 1, height: '4px', appearance: 'none', cursor: 'pointer',
                  background: `linear-gradient(to right, #3b82f6 ${((zoom - 1) / 2) * 100}%, ${borderColor} ${((zoom - 1) / 2) * 100}%)`,
                  borderRadius: '2px', outline: 'none',
                }}
              />
              <span style={{ fontSize: '0.7rem', color: textMuted }}>+</span>
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', gap: '10px', padding: '4px 24px 20px' }}>
              <button onClick={handleCropCancel} style={{
                flex: 1, padding: '12px', borderRadius: '12px', border: `1px solid ${borderColor}`,
                fontSize: '0.85rem', fontWeight: 600, color: textColor, backgroundColor: 'transparent', cursor: 'pointer',
              }}>
                Cancel
              </button>
              <button onClick={handleCropSave} style={{
                flex: 1, padding: '12px', borderRadius: '12px', border: 'none', fontSize: '0.85rem', fontWeight: 600,
                color: '#fff', background: 'linear-gradient(135deg, #3b82f6, #2563eb)', cursor: 'pointer',
              }}>
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
