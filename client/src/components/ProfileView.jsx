import { useState, useEffect } from 'react';
import { apiFetch } from '../apiFetch.js';

export default function ProfileView({ username, role }) {
  const [profile, setProfile] = useState({ full_name: '', email: '', phone: '' });
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
      .then(d => setProfile({ full_name: d.full_name || '', email: d.email || '', phone: d.phone || '' }))
      .catch(() => {});
  }, []);

  async function handleProfileSave(e) {
    e.preventDefault();
    setProfileError(''); setProfileSuccess(false);
    setProfileSaving(true);
    const r = await apiFetch('/api/v1/auth/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile),
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
              <input
                value={profile.phone}
                onChange={e => setProfile(p => ({ ...p, phone: e.target.value }))}
                placeholder="e.g. +353 87 123 4567"
              />
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
