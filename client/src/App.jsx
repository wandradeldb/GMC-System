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
import UserMenu from './components/UserMenu.jsx';
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
function getUsername() { return localStorage.getItem('gmc_user'); }
function getRole()     { return localStorage.getItem('gmc_role'); }

export default function App() {
  const [token,       setToken]      = useState(getToken);
  const [username,    setUsername]   = useState(getUsername);
  const [role,        setRole]       = useState(getRole);
  const [project,     setProject]    = useState(null);
  const [activeNav,   setActiveNav]  = useState('dashboard');
  const [showAdmin,   setShowAdmin]  = useState(false);
  const [subDeepLink, setSubDeepLink] = useState(null);

  function handleLogin(tok, userRole, user) {
    setToken(tok);
    setRole(userRole);
    setUsername(user || localStorage.getItem('gmc_user'));
    setProject(null);
  }

  function handleLogout() {
    localStorage.removeItem('gmc_token');
    localStorage.removeItem('gmc_user');
    localStorage.removeItem('gmc_role');
    setToken(null); setRole(null); setUsername(null); setProject(null);
  }

  function handleSelectProject(proj) {
    setProject(proj);
    setActiveNav('dashboard');
    setShowAdmin(false);
  }

  function handleBackToProjects() {
    setProject(null);
    setActiveNav('dashboard');
    setShowAdmin(false);
  }

  if (!token) return <LoginView onLogin={handleLogin} />;

  const isAdmin = role === 'admin';
  const user = username || getUsername();

  const topbar = (subtitle, showNav) => (
    <header className="topbar">
      <img src="/gmc-logo.png" alt="GMC" style={{ height: 36, width: 'auto', flexShrink: 0 }} />
      <span className="topbar-sep" />
      {project ? (
        <button className="topbar-project topbar-project-btn" onClick={handleBackToProjects} title="Back to projects">
          {project.name} — {project.ref} — {project.client} ▾
        </button>
      ) : (
        <span className="topbar-project">{subtitle}</span>
      )}
      {project?.access_role === 'viewer' && <span className="topbar-readonly-badge">View only</span>}
      <div className="topbar-nav">
        {showNav && NAV.map(n => (
          <button key={n.id}
            className={`topbar-nav-btn${activeNav === n.id ? ' active' : ''}`}
            onClick={() => { setActiveNav(n.id); setShowAdmin(false); }}>
            {n.icon} {n.label}
          </button>
        ))}
      </div>
      <UserMenu
        username={user}
        role={role}
        onLogout={handleLogout}
        onAdmin={() => { setShowAdmin(true); setProject(null); }}
      />
    </header>
  );

  // Admin panel
  if (showAdmin && isAdmin) {
    return (
      <div className="app">
        {topbar('Admin Panel', false)}
        <div className="main">
          <main className="content">
            <div className="admin-panel">
              <div className="admin-panel-header">
                <h1 className="projects-title">Admin Panel</h1>
              </div>
              <UsersView />
            </div>
          </main>
        </div>
      </div>
    );
  }

  // Project selector
  if (!project) {
    return (
      <div className="app">
        {topbar('My Projects', false)}
        <div className="main">
          <main className="content">
            <ProjectsView onSelectProject={handleSelectProject} />
          </main>
        </div>
      </div>
    );
  }

  // Project workspace
  const projectId = project.id;
  const readOnly = project.access_role === 'viewer';

  return (
    <div className="app">
      {topbar(null, true)}
      <div className="main">
        <main className="content">
          {activeNav === 'dashboard' && <DashboardView projectId={projectId} onNavigate={setActiveNav} />}
          {activeNav === 'boq'       && <RevenueGenerationView projectId={projectId} readOnly={readOnly} />}
          {activeNav === 'sub'       && <SubcontractView projectId={projectId} readOnly={readOnly} deepLinkSubName={subDeepLink?.subName} onDeepLinkConsumed={() => setSubDeepLink(null)} />}
          {activeNav === 'das'       && <DASView projectId={projectId} readOnly={readOnly} />}
          {activeNav === 'tracker'   && <TrackerView projectId={projectId} readOnly={readOnly} onSubCellClick={subName => { setSubDeepLink({ subName }); setActiveNav('sub'); }} />}
          {activeNav === 'payapp'    && <PayAppView projectId={projectId} readOnly={readOnly} />}
          {activeNav === 'qscosts'   && <QSCostsView projectId={projectId} readOnly={readOnly} />}
        </main>
      </div>
    </div>
  );
}
