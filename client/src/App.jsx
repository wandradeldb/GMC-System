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
import ProjectsView from './components/ProjectsView.jsx';
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
  const [token,       setToken]      = useState(getToken);
  const [role,        setRole]       = useState(getRole);
  const [project,     setProject]    = useState(null);   // selected project object
  const [summary,     setSummary]    = useState([]);
  const [activeNav,   setActiveNav]  = useState('dashboard');
  const [subDeepLink, setSubDeepLink] = useState(null);

  function handleLogin(tok, userRole) {
    setToken(tok);
    setRole(userRole);
    setProject(null); // go to project selector on login
  }

  function handleLogout() {
    localStorage.removeItem('gmc_token');
    localStorage.removeItem('gmc_user');
    localStorage.removeItem('gmc_role');
    setToken(null);
    setRole(null);
    setProject(null);
  }

  function handleSelectProject(proj) {
    setProject(proj);
    setActiveNav('dashboard');
    // load BOQ summary for topbar
    apiFetch(`/api/v1/projects/${proj.id}/boq`)
      .then(r => r.json())
      .then(boq => setSummary(boq.summary || []))
      .catch(() => {});
  }

  function handleBackToProjects() {
    setProject(null);
    setSummary([]);
    setActiveNav('dashboard');
  }

  if (!token) return <LoginView onLogin={handleLogin} />;

  // No project selected → show project selector
  if (!project) {
    return (
      <div className="app">
        <header className="topbar">
          <img src="/gmc-logo.png" alt="GMC" style={{ height: 36, width: 'auto', flexShrink: 0 }} />
          <span className="topbar-sep" />
          <span className="topbar-project">Select a project</span>
          <div className="topbar-nav" />
          <button className="topbar-logout-btn" onClick={handleLogout} title="Sign out">⏻</button>
        </header>
        <div className="main">
          <main className="content">
            <ProjectsView onSelectProject={handleSelectProject} />
          </main>
        </div>
      </div>
    );
  }

  const isAdmin = role === 'admin';
  const projectId = project.id;

  return (
    <div className="app">
      <header className="topbar">
        <img src="/gmc-logo.png" alt="GMC" style={{ height: 36, width: 'auto', flexShrink: 0 }} />
        <span className="topbar-sep" />
        <button className="topbar-project topbar-project-btn" onClick={handleBackToProjects} title="Back to projects">
          {project.name} — {project.ref} — {project.client} ▾
        </button>
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
          {activeNav === 'dashboard' && <DashboardView projectId={projectId} onNavigate={setActiveNav} />}
          {activeNav === 'boq'       && <RevenueGenerationView projectId={projectId} />}
          {activeNav === 'sub'       && <SubcontractView projectId={projectId} deepLinkSubName={subDeepLink?.subName} onDeepLinkConsumed={() => setSubDeepLink(null)} />}
          {activeNav === 'das'       && <DASView projectId={projectId} />}
          {activeNav === 'tracker'   && <TrackerView projectId={projectId} onSubCellClick={subName => { setSubDeepLink({ subName }); setActiveNav('sub'); }} />}
          {activeNav === 'payapp'    && <PayAppView projectId={projectId} />}
          {activeNav === 'qscosts'   && <QSCostsView projectId={projectId} />}
          {activeNav === 'users' && isAdmin && <UsersView />}
        </main>
      </div>
    </div>
  );
}
