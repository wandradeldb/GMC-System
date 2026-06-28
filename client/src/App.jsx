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

const SCHEDULE_LABELS = {
  '1':  'Sch 1 — Preliminaries Fixed',
  '1A': 'Sch 1A — Preliminaries Time',
  '2':  'Sch 2 — WW Pump Stations',
};

const NAV = [
  { id: 'dashboard', label: 'Dashboard',        icon: '📈' },
  { id: 'tracker',   label: 'Cost Tracker',     icon: '📊' },
  { id: 'boq',       label: 'Revenue Generator',icon: '📄' },
  { id: 'sub',       label: 'Subcontracts',     icon: '🤝' },
  { id: 'qscosts',   label: 'QS Costs',         icon: '💰' },
  { id: 'payapp',    label: 'Applications',     icon: '🧾' },
  { id: 'das',       label: 'Daily Allocation', icon: '📋' },
];

function getToken() { return localStorage.getItem('gmc_token'); }
function authHeaders() { return { Authorization: `Bearer ${getToken()}` }; }

export default function App() {
  const [token,     setToken]    = useState(getToken);
  const [project,   setProject]  = useState(null);
  const [summary,   setSummary]  = useState([]);
  const [activeNav, setActiveNav]   = useState('dashboard');
  const [activeSchedule, setActiveSchedule] = useState('all');
  const [subDeepLink, setSubDeepLink] = useState(null);

  function handleLogin(tok) {
    setToken(tok);
  }

  function handleLogout() {
    localStorage.removeItem('gmc_token');
    localStorage.removeItem('gmc_user');
    setToken(null);
    setProject(null);
  }

  useEffect(() => {
    if (!token) return;
    Promise.all([
      fetch('/api/v1/projects/1', { headers: authHeaders() }).then(r => r.json()),
      fetch('/api/v1/projects/1/boq', { headers: authHeaders() }).then(r => r.json()),
    ]).then(([proj, boq]) => {
      setProject(proj);
      setSummary(boq.summary || []);
    });
  }, [token]);

  if (!token) return <LoginView onLogin={handleLogin} />;

  const fmt = n => new Intl.NumberFormat('en-IE', { minimumFractionDigits: 2 }).format(n);
  const scheduleTotal = sch =>
    summary.filter(s => sch === 'all' || s.schedule === sch)
           .reduce((a, s) => a + s.subtotal, 0);
  const scheduleCount = sch =>
    summary.filter(s => sch === 'all' || s.schedule === sch)
           .reduce((a, s) => a + s.item_count, 0);

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
        </div>
        <button className="topbar-logout-btn" onClick={handleLogout} title="Sign out">⏻</button>
      </header>

      <div className="main">
        <main className="content">
          {project && ['boq-legacy'].includes(activeNav) && (
            <div className="project-card">
              <div>
                <h1>{project.name}</h1>
                <div className="meta">{project.ref} · {project.client} · {project.status}</div>
              </div>
              <div className="spacer" />
              <div className="kpi">
                <div className="kpi-label">Contract Value</div>
                <div className="kpi-value">€{fmt(project.contract_value)}</div>
                <div className="kpi-sub">BOQ: €{fmt(scheduleTotal('all'))}</div>
              </div>
            </div>
          )}

          {activeNav === 'boq' && <RevenueGenerationView projectId={1} />}

          {activeNav === 'dashboard' && <DashboardView projectId={1} onNavigate={setActiveNav} />}
          {activeNav === 'sub'     && <SubcontractView projectId={1} deepLinkSubName={subDeepLink?.subName} onDeepLinkConsumed={() => setSubDeepLink(null)} />}
          {activeNav === 'das'     && <DASView projectId={1} />}
          {activeNav === 'tracker' && <TrackerView projectId={1} onSubCellClick={subName => { setSubDeepLink({ subName }); setActiveNav('sub'); }} />}
          {activeNav === 'payapp'  && <PayAppView projectId={1} />}
          {activeNav === 'qscosts' && <QSCostsView projectId={1} />}
        </main>
      </div>
    </div>
  );
}
