import { useState, useEffect } from 'react';
import { apiFetch } from '../apiFetch.js';

const DDI_OPTIONS = [
  { code: '+353', flag: '🇮🇪', label: 'Ireland' },
  { code: '+44',  flag: '🇬🇧', label: 'United Kingdom' },
  { code: '+49',  flag: '🇩🇪', label: 'Germany' },
  { code: '+33',  flag: '🇫🇷', label: 'France' },
  { code: '+34',  flag: '🇪🇸', label: 'Spain' },
  { code: '+351', flag: '🇵🇹', label: 'Portugal' },
  { code: '+39',  flag: '🇮🇹', label: 'Italy' },
  { code: '+31',  flag: '🇳🇱', label: 'Netherlands' },
  { code: '+32',  flag: '🇧🇪', label: 'Belgium' },
  { code: '+41',  flag: '🇨🇭', label: 'Switzerland' },
  { code: '+43',  flag: '🇦🇹', label: 'Austria' },
  { code: '+48',  flag: '🇵🇱', label: 'Poland' },
  { code: '+55',  flag: '🇧🇷', label: 'Brazil' },
];

function splitPhone(phone) {
  const match = DDI_OPTIONS.find(d => phone.startsWith(d.code));
  if (match) return { ddi: match.code, number: phone.slice(match.code.length).trim() };
  return { ddi: '+353', number: phone };
}

export default function ProfileView({ username, role }) {
  const [profile, setProfile] = useState({ full_name: '', email: '', phone: '' });
  const [ddi, setDdi] = useState('+353');
  const [phoneNum, setPhoneNum] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [profileError, setProfileError] = useState('');

  const [pwForm, setPwForm] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwError, setPwError] = useState('');

  useEffect(() => {
    apiFetch('/api/v1/auth/me')
      .then(r => r.json())
      .then(d => {
        const { ddi: savedDdi, number } = splitPhone(d.phone || '');
        setDdi(savedDdi);
        setPhoneNum(number);
        setProfile({ full_name: d.full_name || '', email: d.email || '', phone: d.phone || '' });
      })
      .catch(() => {});
  }, []);

  async function handleProfileSave(e) {
    e.preventDefault();
    setProfileError(''); setProfileSuccess(false);
    setProfileSaving(true);
    const fullPhone = phoneNum.trim() ? `${ddi} ${phoneNum.trim()}` : '';
    const r = await apiFetch('/api/v1/auth/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...profile, phone: fullPhone }),
    });
    setProfileSaving(false);
    if (!r.ok) { const d = await r.json(); setProfileError(d.error || 'Error saving profile.'); return; }
    setProfileSuccess(true);
  }

  async function handlePasswordSave(e) {
    e.preventDefault();
    setPwError(''); setPwSuccess(false);
    if (pwForm.new_password !== pwForm.confirm_password) { setPwError('New passwords do not match.'); return; }
    if (pwForm.new_password.length < 6) { setPwError('New password must be at least 6 characters.'); return; }
    setPwSaving(true);
    const r = await apiFetch('/api/v1/auth/me/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: pwForm.current_password, new_password: pwForm.new_password }),
    });
    setPwSaving(false);
    if (!r.ok) { const d = await r.json(); setPwError(d.error || 'Error updating password.'); return; }
    setPwSuccess(true);
    setPwForm({ current_password: '', new_password: '', confirm_password: '' });
  }

  const initials  = username ? username.slice(0, 2).toUpperCase() : '?';
  const roleLabel = role === 'admin' ? 'Administrator' : 'User';

  return (
    <div className="profile-page">

      {/* Identity card */}
      <div className="profile-card">
        <div className="profile-avatar-lg">{initials}</div>
        <div className="profile-info">
          <div className="profile-username">{profile.full_name || username}</div>
          {profile.full_name && <div className="profile-handle">@{username}</div>}
          <span className={`profile-role-badge${role === 'admin' ? ' admin' : ''}`}>{roleLabel}</span>
        </div>
      </div>

      {/* Profile details */}
      <div className="profile-section">
        <h2 className="profile-section-title">Profile Information</h2>
        <form onSubmit={handleProfileSave} className="profile-form">
          <div className="form-row-2col">
            <div className="form-row">
              <label>Full Name</label>
              <input
                value={profile.full_name}
                onChange={e => setProfile(p => ({ ...p, full_name: e.target.value }))}
                placeholder="e.g. John Murphy"
              />
            </div>
            <div className="form-row">
              <label>Username</label>
              <input value={username} disabled style={{ background: '#f1f5f9', color: '#94a3b8' }} />
            </div>
          </div>
          <div className="form-row-2col">
            <div className="form-row">
              <label>Email</label>
              <input
                type="email"
                value={profile.email}
                onChange={e => setProfile(p => ({ ...p, email: e.target.value }))}
                placeholder="e.g. john@gmc.ie"
              />
            </div>
            <div className="form-row">
              <label>Phone</label>
              <div className="phone-input-row">
                <select
                  className="phone-ddi-select"
                  value={ddi}
                  onChange={e => setDdi(e.target.value)}
                >
                  {DDI_OPTIONS.map(d => (
                    <option key={d.code} value={d.code}>
                      {d.flag} {d.code}
                    </option>
                  ))}
                </select>
                <input
                  className="phone-number-input"
                  value={phoneNum}
                  onChange={e => setPhoneNum(e.target.value)}
                  placeholder="87 123 4567"
                />
              </div>
            </div>
          </div>
          {profileError   && <p className="form-error">{profileError}</p>}
          {profileSuccess && <p className="form-success">Profile saved.</p>}
          <div className="profile-form-footer">
            <button type="submit" className="btn-primary" disabled={profileSaving}>
              {profileSaving ? 'Saving…' : 'Save Profile'}
            </button>
          </div>
        </form>
      </div>

      {/* Password */}
      <div className="profile-section" style={{ marginTop: 20 }}>
        <h2 className="profile-section-title">Change Password</h2>
        <form onSubmit={handlePasswordSave} className="profile-form">
          <div className="form-row">
            <label>Current Password</label>
            <input type="password" autoComplete="current-password"
              value={pwForm.current_password}
              onChange={e => setPwForm(f => ({ ...f, current_password: e.target.value }))} required />
          </div>
          <div className="form-row-2col">
            <div className="form-row">
              <label>New Password</label>
              <input type="password" autoComplete="new-password"
                value={pwForm.new_password}
                onChange={e => setPwForm(f => ({ ...f, new_password: e.target.value }))} required />
            </div>
            <div className="form-row">
              <label>Confirm New Password</label>
              <input type="password" autoComplete="new-password"
                value={pwForm.confirm_password}
                onChange={e => setPwForm(f => ({ ...f, confirm_password: e.target.value }))} required />
            </div>
          </div>
          {pwError   && <p className="form-error">{pwError}</p>}
          {pwSuccess && <p className="form-success">Password updated successfully.</p>}
          <div className="profile-form-footer">
            <button type="submit" className="btn-primary" disabled={pwSaving}>
              {pwSaving ? 'Saving…' : 'Update Password'}
            </button>
          </div>
        </form>
      </div>

    </div>
  );
}
