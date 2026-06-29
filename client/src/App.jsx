import { useState, useEffect } from 'react';
import BOQView from './components/BOQView.jsx';
import DASView from './components/DASView.jsx';
import SubcontractView from './components/SubcontractView.jsx';
import TrackerView from './components/TrackerView.jsx';
import PayAppView from './components/PayAppView.jsx';
import QSCostsView from './components/QSCostsView.jsx';
import DashboardView from './components/DashboardView.jsx';
import RevenueGenerationView from './components/RevenueGenerationView.jsx';
import LoginView from './components/LoginView.jsx';
import UsersView from './components/UsersView.jsx';
import { apiFetch } from './apiFetch.js';

const NAV = [
  { id: 'dashboard', label: 'Dashboard',         icon: '📈' },
  { id: 'tracker',   label: 'Cost Tracker',      icon: '📊' },
  { id: 'boq',       label: 'Revenue Generator', icon: '📄' },
  { id: 'sub',       label: 'Subcontracts',      icon: '🤝' },
  { id: 'qscosts',   label: 'QS Costs',          icon: '💰' },
  { id: 'payapp',    label: 'Applications',      icon: '🧾' },
  { id: 'das',       label: 'Daily Allocation',  icon: '📋' },
];

function getToken()    { return localStorage.getItem('gmc_token'); }
function getRole()     { return localStorage.getItem('gmc_role'); }

export default function App() {
  const [token,     setToken]    = useState(getToken);
  const [role,      setRole]     = useState(getRole);
  const [project,   setProject]  = useState(null);
  const [summary,   setSummary]  = useState([]);
  const [activeNav, setActiveNav]   = useState('dashboard');
  const [subDeepLink, setSubDeepLink] = useState(null);

  function handleLogin(tok, userRole) {
    setToken(tok);
    setRole(userRole);
  }

  function handleLogout() {
    localStorage.removeItem('gmc_token');
    localStorage.removeItem('gmc_user');
    localStorage.removeItem('gmc_role');
    setToken(null);
    setRole(null);
    setProject(null);
  }

  useEffect(() => {
    if (!token) return;
    Promise.all([
      apiFetch('/api/v1/projects/1').then(r => r.json()),
      apiFetch('/api/v1/projects/1/boq').then(r => r.json()),
    ]).then(([proj, boq]) => {
      setProject(proj);
      setSummary(boq.summary || []);
    }).catch(() => handleLogout());
  }, [token]);

  if (!token) return <LoginView onLogin={handleLogin} />;

  const isAdmin = role === 'admin';
  const fmt = n => new Intl.NumberFormat('en-IE', { minimumFractionDigits: 2 }).format(n);

  return (
    <div className="app">
      <header className="topbar">
        <img src="/gmc-logo.png" alt="GMC" style={{ height: 36, width: 'auto', flexShrink: 0 }} />
        <span className="topbar-sep" />
        <span className="topbar-project">
          {project ? `${project.name} — ${project.ref} — ${project.client}` : 'Loading…'}
        </span>
        <div className="topbar-nav">
          {NAV.map(n => (
            <button key={n.id}
              className={`topbar-nav-btn${activeNav === n.id ? ' active' : ''}`}
              onClick={() => setActiveNav(n.id)}>
              {n.icon} {n.label}
            </button>
          ))}
          {isAdmin && (
            <button
              className={`topbar-nav-btn${activeNav === 'users' ? ' active' : ''}`}
              onClick={() => setActiveNav('users')}>
              👥 Users
            </button>
          )}
        </div>
        <button className="topbar-logout-btn" onClick={handleLogout} title="Sign out">⏻</button>
      </header>

      <div className="main">
        <main className="content">
          {activeNav === 'dashboard' && <DashboardView projectId={1} onNavigate={setActiveNav} />}
          {activeNav === 'boq'       && <RevenueGenerationView projectId={1} />}
          {activeNav === 'sub'       && <SubcontractView projectId={1} deepLinkSubName={subDeepLink?.subName} onDeepLinkConsumed={() => setSubDeepLink(null)} />}
          {activeNav === 'das'       && <DASView projectId={1} />}
          {activeNav === 'tracker'   && <TrackerView projectId={1} onSubCellClick={subName => { setSubDeepLink({ subName }); setActiveNav('sub'); }} />}
          {activeNav === 'payapp'    && <PayAppView projectId={1} />}
          {activeNav === 'qscosts'   && <QSCostsView projectId={1} />}
          {activeNav === 'users' && isAdmin && <UsersView />}
        </main>
      </div>
    </div>
  );
}
