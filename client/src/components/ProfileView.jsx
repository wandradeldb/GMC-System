import { useState } from 'react';
import { apiFetch } from '../apiFetch.js';

export default function ProfileView({ username, role }) {
  const [form,    setForm]    = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [saving,  setSaving]  = useState(false);
  const [success, setSuccess] = useState(false);
  const [error,   setError]   = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError(''); setSuccess(false);
    if (form.new_password !== form.confirm_password) {
      setError('New passwords do not match.'); return;
    }
    if (form.new_password.length < 6) {
      setError('New password must be at least 6 characters.'); return;
    }
    setSaving(true);
    const r = await apiFetch('/api/v1/auth/me/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: form.current_password, new_password: form.new_password }),
    });
    setSaving(false);
    if (!r.ok) {
      const d = await r.json();
      setError(d.error || 'Error updating password.');
      return;
    }
    setSuccess(true);
    setForm({ current_password: '', new_password: '', confirm_password: '' });
  }

  const initials = username ? username.slice(0, 2).toUpperCase() : '?';
  const roleLabel = role === 'admin' ? 'Administrator' : 'User';

  return (
    <div className="profile-page">
      <div className="profile-card">
        <div className="profile-avatar-lg">{initials}</div>
        <div className="profile-info">
          <div className="profile-username">{username}</div>
          <span className={`profile-role-badge${role === 'admin' ? ' admin' : ''}`}>{roleLabel}</span>
        </div>
      </div>

      <div className="profile-section">
        <h2 className="profile-section-title">Change Password</h2>
        <form onSubmit={handleSubmit} className="profile-form">
          <div className="form-row">
            <label>Current Password</label>
            <input
              type="password"
              autoComplete="current-password"
              value={form.current_password}
              onChange={e => setForm(f => ({ ...f, current_password: e.target.value }))}
              required
            />
          </div>
          <div className="form-row">
            <label>New Password</label>
            <input
              type="password"
              autoComplete="new-password"
              value={form.new_password}
              onChange={e => setForm(f => ({ ...f, new_password: e.target.value }))}
              required
            />
          </div>
          <div className="form-row">
            <label>Confirm New Password</label>
            <input
              type="password"
              autoComplete="new-password"
              value={form.confirm_password}
              onChange={e => setForm(f => ({ ...f, confirm_password: e.target.value }))}
              required
            />
          </div>
          {error   && <p className="form-error">{error}</p>}
          {success && <p className="form-success">Password updated successfully.</p>}
          <div className="profile-form-footer">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Update Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
