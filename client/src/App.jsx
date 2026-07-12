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
import ProfileView from './components/ProfileView.jsx';
import ProjectSettingsView from './components/ProjectSettingsView.jsx';
import UsersView from './components/UsersView.jsx';
import ProjectsView from './components/ProjectsView.jsx';
import { apiFetch } from './apiFetch.js';
import { ZoomContext } from './zoomContext.js';

const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [{ id: 'dashboard', label: 'Dashboard', icon: 'ti-layout-dashboard' }],
  },
  {
    label: 'Contract',
    items: [
      { id: 'boqlist', label: 'Bill of Quantities', icon: 'ti-list' },
      { id: 'boq',     label: 'Revenue Generator',  icon: 'ti-file-text' },
      { id: 'payapp',  label: 'Client Application',  icon: 'ti-receipt' },
    ],
  },
  {
    label: 'Costs',
    items: [
      { id: 'tracker', label: 'Cost Tracker',  icon: 'ti-chart-bar' },
      { id: 'qscosts', label: 'QS Costs',      icon: 'ti-calculator' },
      { id: 'sub',     label: 'Subcontracts',  icon: 'ti-users' },
    ],
  },
  {
    label: 'Field',
    items: [{ id: 'das', label: 'Daily Allocation', icon: 'ti-clipboard-list' }],
  },
  {
    label: 'Settings',
    items: [{ id: 'settings', label: 'Project Settings', icon: 'ti-settings', ownerOnly: true }],
  },
];

function getToken()    { return localStorage.getItem('gmc_token'); }
function getUsername() { return localStorage.getItem('gmc_user'); }
function getRole()     { return localStorage.getItem('gmc_role'); }
function initials(u)   { return u ? u.slice(0, 2).toUpperCase() : '?'; }

export default function App() {
  const [token,       setToken]      = useState(getToken);
  const [username,    setUsername]   = useState(getUsername);
  const [role,        setRole]       = useState(getRole);
  const [project,     setProject]    = useState(null);
  const [activeNav,   setActiveNav]  = useState('dashboard');
  const [showAdmin,   setShowAdmin]  = useState(false);
  const [subDeepLink, setSubDeepLink] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [zoom, setZoom] = useState(() => Number(localStorage.getItem('gmc_zoom')) || 100);

  useEffect(() => { localStorage.setItem('gmc_zoom', String(zoom)); }, [zoom]);
  const zoomOut   = () => setZoom(z => Math.max(70, z - 10));
  const zoomIn    = () => setZoom(z => Math.min(150, z + 10));
  const zoomReset = () => setZoom(100);

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
    setActiveNav(proj.access_role === 'site' ? 'das' : 'dashboard');
    setShowAdmin(false);
    setShowProfile(false);
    setSidebarOpen(false);
  }

  function handleBackToProjects() {
    setProject(null);
    setActiveNav('dashboard');
    setShowAdmin(false);
    setShowProfile(false);
    setSidebarOpen(false);
  }

  if (!token) return <LoginView onLogin={handleLogin} />;

  const isAdmin  = role === 'admin';
  const user     = username || getUsername();
  const readOnly = project?.access_role === 'viewer';

  // breadcrumb label for current view
  const currentNavLabel = showAdmin
    ? 'Admin Panel'
    : showProfile
    ? 'My Profile'
    : !project
    ? 'My Projects'
    : NAV_GROUPS.flatMap(g => g.items).find(n => n.id === activeNav)?.label ?? '';

  const sidebar = (
    <aside className={`app-sidebar${sidebarOpen ? ' open' : ''}`}>
      {/* Logo */}
      <button className="sidebar-logo-btn" onClick={handleBackToProjects}>
        <img src="/gmc-logo.png" alt="GMC" style={{ height: 30, width: 'auto' }} />
        <div className="sidebar-brand-text">
          <span className="sidebar-brand-name">GMC System</span>
          <span className="sidebar-brand-sub">Construction Management</span>
        </div>
      </button>

      {/* Project pill */}
      {project && (
        <button className="sidebar-project-pill" onClick={handleBackToProjects}>
          <div className="sidebar-pill-label">Active project</div>
          <div className="sidebar-pill-name">{project.name}</div>
          <div className="sidebar-pill-ref">{project.ref}{project.client ? ` · ${project.client}` : ''}</div>
          <div className="sidebar-pill-switch">
            <i className="ti ti-switch-horizontal" aria-hidden="true" /> Switch project
          </div>
        </button>
      )}

      {/* Nav — only inside a project */}
      {project && (
        <nav className="sidebar-nav">
          {NAV_GROUPS.map(group => {
            const items = group.items.filter(item => {
              if (project.access_role === 'site') return item.id === 'das'; // field team: diary only, no financial modules
              return !item.ownerOnly || project.access_role === 'owner';
            });
            if (!items.length) return null;
            return (
              <div key={group.label}>
                <div className="sidebar-nav-section">{group.label}</div>
                {items.map(item => (
                  <button
                    key={item.id}
                    className={`sidebar-nav-item${activeNav === item.id && !showAdmin && !showProfile ? ' active' : ''}`}
                    onClick={() => { setActiveNav(item.id); setShowAdmin(false); setShowProfile(false); setSidebarOpen(false); }}
                  >
                    <i className={`ti ${item.icon}`} aria-hidden="true" />
                    {item.label}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>
      )}

      <div className="sidebar-spacer" />

      {/* Footer */}
      <div className="sidebar-footer">
        <div className="sidebar-footer-user">
          <div className="sidebar-avatar">{initials(user)}</div>
          <div className="sidebar-user-info">
            <div className="sidebar-username">{user}</div>
            <div className="sidebar-userrole">{isAdmin ? 'Administrator' : 'User'}</div>
          </div>
        </div>
        <div className="sidebar-footer-actions">
          <button
            className="sidebar-action-btn"
            onClick={() => { setShowProfile(true); setShowAdmin(false); setProject(null); setSidebarOpen(false); }}
          >
            My Profile
          </button>
          {isAdmin && (
            <button
              className="sidebar-action-btn"
              onClick={() => { setShowAdmin(true); setShowProfile(false); setProject(null); setSidebarOpen(false); }}
            >
              Admin Panel
            </button>
          )}
          <button className="sidebar-action-btn sidebar-action-logout" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );

  const slimTopbar = (
    <header className="slim-topbar">
      {/* Mobile hamburger */}
      <button className="sidebar-hamburger" onClick={() => setSidebarOpen(o => !o)} aria-label="Open menu">
        ☰
      </button>

      <nav className="breadcrumb-nav" aria-label="breadcrumb">
        <span className="bc-item bc-link" onClick={handleBackToProjects}>My Projects</span>
        {showProfile && <><span className="bc-sep">›</span><span className="bc-item bc-current">My Profile</span></>}
        {showAdmin && !showProfile && <><span className="bc-sep">›</span><span className="bc-item bc-current">Admin Panel</span></>}
        {project && !showProfile && !showAdmin && (
          <>
            <span className="bc-sep">›</span>
            <span className="bc-item bc-link" onClick={handleBackToProjects}>{project.name}</span>
            {currentNavLabel && <><span className="bc-sep">›</span><span className="bc-item bc-current">{currentNavLabel}</span></>}
          </>
        )}
      </nav>

      {readOnly && <span className="topbar-readonly-badge">View only</span>}
    </header>
  );

  // Main content
  let content;
  if (showProfile) {
    content = <ProfileView username={user} role={role} />;
  } else if (showAdmin && isAdmin) {
    content = (
      <div className="admin-panel">
        <div className="admin-panel-header">
          <h1 className="projects-title">Admin Panel</h1>
        </div>
        <UsersView />
      </div>
    );
  } else if (!project) {
    content = <ProjectsView onSelectProject={handleSelectProject} />;
  } else if (project.access_role === 'site') {
    // Field team: Daily Allocation Sheet only, regardless of whatever activeNav might be set to
    content = <DASView projectId={project.id} readOnly={false} />;
  } else {
    const projectId = project.id;
    content = (
      <>
        {activeNav === 'dashboard' && <DashboardView projectId={projectId} onNavigate={setActiveNav} />}
        {activeNav === 'boqlist'   && <BOQView projectId={projectId} readOnly={readOnly} />}
        {activeNav === 'boq'       && <RevenueGenerationView projectId={projectId} project={project} readOnly={readOnly} />}
        {activeNav === 'sub'       && <SubcontractView projectId={projectId} readOnly={readOnly} deepLinkSubName={subDeepLink?.subName} onDeepLinkConsumed={() => setSubDeepLink(null)} />}
        {activeNav === 'das'       && <DASView projectId={projectId} readOnly={readOnly} />}
        {activeNav === 'tracker'   && <TrackerView projectId={projectId} readOnly={readOnly} onSubCellClick={subName => { setSubDeepLink({ subName }); setActiveNav('sub'); }} />}
        {activeNav === 'payapp'    && <PayAppView projectId={projectId} readOnly={readOnly} />}
        {activeNav === 'qscosts'   && <QSCostsView projectId={projectId} readOnly={readOnly} />}
        {activeNav === 'settings'  && <ProjectSettingsView project={project} onProjectUpdated={p => setProject(p)} />}
      </>
    );
  }

  return (
    <div className="app">
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
      {sidebar}
      <div className="app-body">
        {slimTopbar}
        <main className="app-content">
          <ZoomContext.Provider value={zoom}>
            {content}
          </ZoomContext.Provider>
        </main>
      </div>
      <div className="zoom-control">
        <button onClick={zoomOut} disabled={zoom <= 70} aria-label="Zoom out">−</button>
        <span className="zoom-level" onClick={zoomReset} title="Reset zoom">{zoom}%</span>
        <button onClick={zoomIn} disabled={zoom >= 150} aria-label="Zoom in">+</button>
      </div>
    </div>
  );
}
