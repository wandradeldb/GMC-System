import { useState, useEffect, useCallback } from 'react';
import SubcontractDetail from './SubcontractDetail.jsx';
import NewSubcontractModal from './NewSubcontractModal.jsx';

const STATUS_COLOR = { active:'#166534', completed:'#1e40af', terminated:'#991b1b' };
const STATUS_BG    = { active:'#dcfce7', completed:'#dbeafe', terminated:'#fee2e2' };

function fmt(n) {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-IE', { minimumFractionDigits: 2 }).format(n);
}

export default function SubcontractView({ projectId }) {
  const [list,     setList]     = useState([]);
  const [selected, setSelected] = useState(null);
  const [showNew,  setShowNew]  = useState(false);

  const load = useCallback(() => {
    fetch(`/api/v1/projects/${projectId}/subcontracts`).then(r => r.json()).then(setList);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

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
            <div key={sc.id} className="sc-card" onClick={() => setSelected(sc.id)}>
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
