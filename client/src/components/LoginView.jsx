import { apiFetch } from '../apiFetch.js';
import { useState, useEffect } from 'react';

export default function LoginView({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  // Random per-mount field names so the browser's saved-password manager can't match this
  // form to a previously stored credential and silently pre-fill the last user who logged
  // in on this device -- this tool is shared across people on the same machine, so that
  // auto-fill meant everyone had to notice, clear, and retype the username every time.
  const [fieldSuffix] = useState(() => Math.random().toString(36).slice(2));
  // apiFetch sets this right before it force-reloads on an expired/invalid token (see
  // apiFetch.js) -- without surfacing it, that reload just dumps the user back here with no
  // explanation, which reads as the app randomly breaking rather than a normal session expiry.
  const [sessionExpired, setSessionExpired] = useState(false);
  useEffect(() => {
    if (localStorage.getItem('gmc_session_expired')) {
      localStorage.removeItem('gmc_session_expired');
      setSessionExpired(true);
    }
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const r = await apiFetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error || 'Login failed'); return; }
      localStorage.setItem('gmc_token', data.token);
      localStorage.setItem('gmc_user', data.username);
      localStorage.setItem('gmc_role', data.role || 'viewer');
      onLogin(data.token, data.role || 'viewer');
    } catch {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-overlay">
      <div className="login-box">
        <img src="/gmc-logo.png" alt="GMC" style={{ height: 48, marginBottom: 24 }} />
        <h2 style={{ margin: '0 0 24px', color: '#1a1a2e', fontSize: 20 }}>GMC System</h2>
        {sessionExpired && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', padding: '9px 12px', borderRadius: 6, fontSize: 13, marginBottom: 16 }}>
            Sua sessão expirou. Faça login novamente.
          </div>
        )}
        <form onSubmit={handleSubmit} autoComplete="off" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            type="text"
            name={`user_${fieldSuffix}`}
            placeholder="Username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            className="login-input"
            autoComplete="off"
            autoFocus
            required
          />
          <input
            type="password"
            name={`pass_${fieldSuffix}`}
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="login-input"
            autoComplete="new-password"
            required
          />
          {error && <div style={{ color: '#dc2626', fontSize: 13 }}>{error}</div>}
          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
