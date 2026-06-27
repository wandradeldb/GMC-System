import { useState, useEffect, useCallback, useRef } from 'react';
import SubcontractDetail from './SubcontractDetail.jsx';
import NewSubcontractModal from './NewSubcontractModal.jsx';
import SubAssessmentView from './SubAssessmentView.jsx';

const STATUS_COLOR = { active:'#166534', completed:'#1e40af', terminated:'#991b1b' };
const STATUS_BG    = { active:'#dcfce7', completed:'#dbeafe', terminated:'#fee2e2' };

function fmt(n) {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-IE', { minimumFractionDigits: 2 }).format(n);
}

export default function SubcontractView({ projectId, deepLinkSubName, onDeepLinkConsumed }) {
  const [list,       setList]       = useState([]);
  const [selected,   setSelected]   = useState(null);
  const [assessment, setAssessment] = useState(null); // { id, ref, name, contract_value }
  const [showNew,    setShowNew]    = useState(false);
  const deepLinkDoneRef = useRef(null); // tracks which deepLinkSubName was already handled

  const load = useCallback(() => {
    fetch(`/api/v1/projects/${projectId}/subcontracts`).then(r => r.json()).then(setList);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  // Deep-link from tracker: open assessment for the named sub
  useEffect(() => {
    if (!deepLinkSubName || list.length === 0) return;
    if (deepLinkDoneRef.current === deepLinkSubName) return; // already handled this deepLink
    const norm = deepLinkSubName.toLowerCase();
    const sc = list.find(s => {
      const n = s.name.toLowerCase();
      return n === norm || n.includes(norm) || norm.includes(n.split(' ')[0]);
    });
    if (sc) {
      deepLinkDoneRef.current = deepLinkSubName;
      setAssessment({ id: sc.id, ref: sc.ref, name: sc.name, contract_value: sc.contract_value });
      onDeepLinkConsumed?.();
    }
  }, [deepLinkSubName, list]);

  if (assessment) return (
    <SubAssessmentView
      projectId={projectId}
      subcontractId={assessment.id}
      subRef={assessment.ref}
      subName={assessment.name}
      contractValue={assessment.contract_value}
      onBack={() => { setAssessment(null); load(); }}
    />
  );

  if (selected) return (
    <SubcontractDetail
      projectId={projectId}
      subcontractId={selected}
      onBack={() => { setSelected(null); load(); }}
    />
  );

  return (
    <div>
      <div className="sc-toolbar">
        <h2 className="sc-title">Subcontracts</h2>
        <button className="btn-primary" onClick={() => setShowNew(true)}>+ New Subcontract</button>
      </div>

      {list.length === 0 ? (
        <div className="state-box">
          <div className="icon">🤝</div>
          <p>No subcontracts yet. Click "New Subcontract" to begin.</p>
        </div>
      ) : (
        <div className="sc-grid">
          {list.map(sc => (
            <div key={sc.id} className="sc-card">
              <div className="sc-card-header">
                <span className="sc-ref">{sc.ref}</span>
                <span className="status-badge"
                  style={{ background: STATUS_BG[sc.status], color: STATUS_COLOR[sc.status] }}>
                  {sc.status}
                </span>
              </div>
              <div className="sc-card-name">{sc.subcontractor_name}</div>
              <div className="sc-card-desc">{sc.description}</div>
              <div className="sc-card-stats">
                <div className="sc-stat">
                  <span className="sc-stat-label">Contract Value</span>
                  <span className="sc-stat-value">€{fmt(sc.contract_value)}</span>
                </div>
                <div className="sc-stat">
                  <span className="sc-stat-label">Certified</span>
                  <span className="sc-stat-value certified">€{fmt(sc.total_certified)}</span>
                </div>
                <div className="sc-stat">
                  <span className="sc-stat-label">Applications</span>
                  <span className="sc-stat-value">{sc.application_count}</span>
                </div>
              </div>
              {sc.contract_value > 0 && (
                <div className="sc-progress-bar">
                  <div className="sc-progress-fill"
                    style={{ width: `${Math.min(100, (sc.total_certified / sc.contract_value) * 100)}%` }} />
                </div>
              )}
              <div style={{ display:'flex', gap:8, marginTop:10 }}>
                <button onClick={() => setSelected(sc.id)}
                  style={{ flex:1, padding:'5px 0', borderRadius:6, border:'1px solid #d1d5db',
                    background:'#f9fafb', cursor:'pointer', fontSize:12, color:'#374151' }}>
                  Details
                </button>
                <button onClick={() => setAssessment({ id: sc.id, ref: sc.ref, name: sc.subcontractor_name, contract_value: sc.contract_value })}
                  style={{ flex:2, padding:'5px 0', borderRadius:6, border:'none',
                    background:'#1a1a2e', cursor:'pointer', fontSize:12, color:'#fff', fontWeight:600 }}>
                  📋 Assessment
                </button>
                <button onClick={async () => {
                  if (!window.confirm(`Delete ${sc.ref} — ${sc.subcontractor_name}?\nThis also removes all its applications and BOQ items.`)) return;
                  await fetch(`/api/v1/projects/${projectId}/subcontracts/${sc.id}`, { method:'DELETE' });
                  load();
                }} style={{ padding:'5px 8px', borderRadius:6, border:'1px solid #fca5a5',
                    background:'#fff5f5', cursor:'pointer', fontSize:12, color:'#dc2626' }}>
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showNew && (
        <NewSubcontractModal
          projectId={projectId}
          onClose={() => setShowNew(false)}
          onCreated={(sc) => { setShowNew(false); load(); setSelected(sc.id); }}
        />
      )}
    </div>
  );
}
