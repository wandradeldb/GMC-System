import { useState, useEffect } from 'react';
import BOQView from './components/BOQView.jsx';
import DASView from './components/DASView.jsx';
import SubcontractView from './components/SubcontractView.jsx';
import TrackerView from './components/TrackerView.jsx';
import PayAppView from './components/PayAppView.jsx';

const SCHEDULE_LABELS = {
  '1':  'Sch 1 — Preliminaries Fixed',
  '1A': 'Sch 1A — Preliminaries Time',
  '2':  'Sch 2 — WW Pump Stations',
};

const NAV = [
  { id: 'boq', label: 'Contract BOQ',     icon: '📄' },
  { id: 'sub', label: 'Subcontracts',     icon: '🤝' },
  { id: 'das',     label: 'Daily Allocation', icon: '📋' },
  { id: 'tracker', label: 'Cost Tracker',     icon: '📊' },
  { id: 'payapp',  label: 'Applications',     icon: '🧾' },
];

export default function App() {
  const [project,  setProject]  = useState(null);
  const [summary,  setSummary]  = useState([]);
  const [activeNav, setActiveNav]   = useState('boq');
  const [activeSchedule, setActiveSchedule] = useState('all');

  useEffect(() => {
    Promise.all([
      fetch('/api/v1/projects/1').then(r => r.json()),
      fetch('/api/v1/projects/1/boq').then(r => r.json()),
    ]).then(([proj, boq]) => {
      setProject(proj);
      setSummary(boq.summary || []);
    });
  }, []);

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
      </header>

      <div className="main">
        {/* Sidebar — only for BOQ */}
        {activeNav === 'boq' && (
          <nav className="sidebar">
            <div className="sidebar-section" style={{ marginBottom: 8 }}>Schedules</div>
            {['all', '1', '1A', '2'].map(sch => (
              <button key={sch} className={`sidebar-item ${activeSchedule === sch ? 'active' : ''}`}
                onClick={() => setActiveSchedule(sch)}>
                <span>{sch === 'all' ? 'All Schedules' : SCHEDULE_LABELS[sch]}</span>
                <span className="sidebar-badge">{scheduleCount(sch)}</span>
              </button>
            ))}
          </nav>
        )}

        <main className="content">
          {project && activeNav !== 'tracker' && (
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

          {activeNav === 'boq' && (
            <BOQView
              projectId={1}
              schedule={activeSchedule === 'all' ? null : activeSchedule}
              scheduleLabels={SCHEDULE_LABELS}
            />
          )}

          {activeNav === 'sub'     && <SubcontractView projectId={1} />}
          {activeNav === 'das'     && <DASView projectId={1} />}
          {activeNav === 'tracker' && <TrackerView projectId={1} />}
          {activeNav === 'payapp'  && <PayAppView projectId={1} />}
        </main>
      </div>
    </div>
  );
}
