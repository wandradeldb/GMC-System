import { useState, useEffect, useRef } from 'react';

function initials(username) {
  if (!username) return '?';
  return username.slice(0, 2).toUpperCase();
}

export default function UserMenu({ username, role, onLogout, onAdmin, onProfile }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const isAdmin = role === 'admin';
  const roleLabel = isAdmin ? 'Administrator' : 'User';

  return (
    <div className="user-menu" ref={ref}>
      <button className="user-avatar-btn" onClick={() => setOpen(o => !o)} title={username}>
        <span className="user-avatar">{initials(username)}</span>
      </button>

      {open && (
        <div className="user-dropdown">
          <div className="user-dropdown-header">
            <span className="user-dropdown-avatar">{initials(username)}</span>
            <div>
              <div className="user-dropdown-name">{username}</div>
              <div className="user-dropdown-role">{roleLabel}</div>
            </div>
          </div>
          <div className="user-dropdown-divider" />
          {isAdmin && (
            <button className="user-dropdown-item" onClick={() => { setOpen(false); onAdmin(); }}>
              ⚙️ Admin Panel
            </button>
          )}
          <button className="user-dropdown-item user-dropdown-logout" onClick={() => { setOpen(false); onLogout(); }}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
