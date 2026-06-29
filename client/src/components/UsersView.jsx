import { useState, useEffect } from 'react';
import { apiFetch } from '../apiFetch.js';

export default function UsersView() {
  const [users,      setUsers]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [resetUser,  setResetUser]  = useState(null); // { id, username }
  const [form,       setForm]       = useState({ username: '', password: '', role: 'viewer' });
  const [newPass,    setNewPass]    = useState('');
  const [error,      setError]      = useState('');
  const [saving,     setSaving]     = useState(false);

  async function load() {
    setLoading(true);
    const r = await apiFetch('/api/v1/auth/users');
    if (r.ok) setUsers(await r.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setError(''); setSaving(true);
    const r = await apiFetch('/api/v1/auth/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await r.json();
    setSaving(false);
    if (!r.ok) { setError(data.error); return; }
    setShowCreate(false);
    setForm({ username: '', password: '', role: 'viewer' });
    load();
  }

  async function handleReset(e) {
    e.preventDefault();
    setSaving(true);
    const r = await apiFetch(`/api/v1/auth/users/${resetUser.id}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPass }),
    });
    setSaving(false);
    if (r.ok) { setResetUser(null); setNewPass(''); }
  }

  async function handleDelete(id, username) {
    if (!confirm(`Delete user "${username}"?`)) return;
    await apiFetch(`/api/v1/auth/users/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div style={{ padding: '24px 32px', maxWidth: 700 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 22, color: '#1a1a2e' }}>User Management</h2>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>+ New User</button>
      </div>

      {loading ? <p style={{ color: '#6b7280' }}>Loading…</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#f3f4f6' }}>
              <th style={th}>Username</th>
              <th style={th}>Role</th>
              <th style={th}>Created</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={td}><strong>{u.username}</strong></td>
                <td style={td}>
                  <span style={{
                    background: u.role === 'admin' ? '#1a1a2e' : '#e0f2fe',
                    color: u.role === 'admin' ? '#fff' : '#0369a1',
                    padding: '2px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600
                  }}>{u.role}</span>
                </td>
                <td style={{ ...td, color: '#6b7280' }}>{u.created_at?.slice(0, 10)}</td>
                <td style={{ ...td, display: 'flex', gap: 8 }}>
                  <button className="btn-secondary" style={{ padding: '4px 12px', fontSize: 12 }}
                    onClick={() => { setResetUser({ id: u.id, username: u.username }); setNewPass(''); }}>
                    Reset Password
                  </button>
                  {u.username !== 'admin' && (
                    <button onClick={() => handleDelete(u.id, u.username)}
                      style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 18 }}>
                      ×
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Create User Modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
            <h3 style={{ margin: '0 0 20px', color: '#1a1a2e' }}>New User</h3>
            <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input className="login-input" placeholder="Username" required
                value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
              <input className="login-input" type="password" placeholder="Password" required
                value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
              <select className="login-input" value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                <option value="viewer">Viewer (read-only)</option>
                <option value="admin">Admin (full access)</option>
              </select>
              {error && <div style={{ color: '#dc2626', fontSize: 13 }}>{error}</div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="login-btn" style={{ width: 'auto', padding: '10px 24px' }} disabled={saving}>
                  {saving ? 'Creating…' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetUser && (
        <div className="modal-overlay" onClick={() => setResetUser(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 360 }}>
            <h3 style={{ margin: '0 0 8px', color: '#1a1a2e' }}>Reset Password</h3>
            <p style={{ margin: '0 0 16px', color: '#6b7280', fontSize: 14 }}>User: <strong>{resetUser.username}</strong></p>
            <form onSubmit={handleReset} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input className="login-input" type="password" placeholder="New password" required autoFocus
                value={newPass} onChange={e => setNewPass(e.target.value)} />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="btn-secondary" onClick={() => setResetUser(null)}>Cancel</button>
                <button type="submit" className="login-btn" style={{ width: 'auto', padding: '10px 24px' }} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const th = { padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: 12 };
const td = { padding: '12px 12px' };
