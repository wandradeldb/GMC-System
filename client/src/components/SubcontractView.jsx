import { apiFetch } from '../apiFetch.js';
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

export default function SubcontractView({ projectId, readOnly, deepLinkSubName, onDeepLinkConsumed }) {
  const [list,       setList]       = useState([]);
  const [selected,   setSelected]   = useState(null);
  const [assessment, setAssessment] = useState(null); // { id, ref, name, contract_value }
  const [showNew,    setShowNew]    = useState(false);
  const [editing,    setEditing]    = useState(null); // sc object being edited
  const deepLinkDoneRef = useRef(null); // tracks which deepLinkSubName was already handled

  const load = useCallback(() => {
    apiFetch(`/api/v1/projects/${projectId}/subcontracts`).then(r => r.json()).then(setList);
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
        {!readOnly && <button className="btn-primary" onClick={() => setShowNew(true)}>+ New Subcontract</button>}
      </div>

      {list.length === 0 ? (
        <div className="state-box">
          <div className="icon">🤝</div>
          <p>No subcontracts yet. Click "New Subcontract" to begin.</p>
        </div>
      ) : (
        <>
        {['main','misc'].map(type => {
          const group = list.filter(sc => (sc.sub_type || 'main') === type);
          if (group.length === 0) return null;
          return (
            <div key={type}>
              <div style={{ fontWeight:700, fontSize:13, color:'#6b7280', textTransform:'uppercase', letterSpacing:'.06em', margin:'18px 0 8px', paddingBottom:4, borderBottom:'1px solid #e5e7eb' }}>
                {type === 'main' ? 'Main Subcontracts' : 'MISC'}
              </div>
              <div className="sc-grid">
              {group.map(sc => (
            <div key={sc.id} className="sc-card" onClick={() => setSelected(sc.id)}
              style={{ cursor:'pointer' }} title="Open details">
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
                <button onClick={(e) => { e.stopPropagation(); setAssessment({ id: sc.id, ref: sc.ref, name: sc.subcontractor_name, contract_value: sc.contract_value }); }}
                  style={{ flex:1, padding:'5px 0', borderRadius:6, border:'none',
                    background:'#1a1a2e', cursor:'pointer', fontSize:12, color:'#fff', fontWeight:600 }}>
                  📋 Assessment
                </button>
                {!readOnly && <button onClick={(e) => { e.stopPropagation(); setEditing(sc); }}
                  style={{ padding:'4px 10px', borderRadius:4, border:'1px solid #bfdbfe',
                    background:'#eff6ff', cursor:'pointer', fontSize:11, color:'#1e40af',
                    fontWeight:600, letterSpacing:'.03em' }}>
                  edit
                </button>}
                {!readOnly && <button onClick={async (e) => {
                  e.stopPropagation();
                  if (!window.confirm(`Delete ${sc.ref} — ${sc.subcontractor_name}?\nThis also removes all its applications and BOQ items.`)) return;
                  await apiFetch(`/api/v1/projects/${projectId}/subcontracts/${sc.id}`, { method:'DELETE' });
                  load();
                }} style={{ padding:'5px 8px', borderRadius:6, border:'1px solid #fca5a5',
                    background:'#fff5f5', cursor:'pointer', fontSize:12, color:'#dc2626' }}>
                  ✕
                </button>}
              </div>
            </div>
              ))}
              </div>
            </div>
          );
        })}
        </>
      )}

      {showNew && (
        <NewSubcontractModal
          projectId={projectId}
          onClose={() => setShowNew(false)}
          onCreated={(sc) => { setShowNew(false); load(); setSelected(sc.id); }}
        />
      )}

      {editing && (
        <EditSubcontractModal
          projectId={projectId}
          sc={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function EditSubcontractModal({ projectId, sc, onClose, onSaved }) {
  const [form, setForm] = useState({
    description:      sc.description      || '',
    contract_value:   sc.contract_value   ?? '',
    retention_pct:    sc.retention_pct    ?? 5,
    start_date:       sc.start_date       || '',
    end_date:         sc.end_date         || '',
    status:           sc.status           || 'active',
    sub_type:         sc.sub_type         || 'main',
    has_contract:     sc.has_contract     ? 1 : 0,
    has_insurance:    sc.has_insurance    ? 1 : 0,
    responsible_name: sc.responsible_name || '',
    phone:            sc.phone            || '',
    email:            sc.email            || '',
    pricing_lumpsum:  sc.pricing_lumpsum  ? 1 : 0,
    mat_by:           sc.mat_by           || 'sub',
    plant_by:         sc.plant_by         || 'sub',
  });
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true); setErr('');
    const res = await apiFetch(`/api/v1/projects/${projectId}/subcontracts/${sc.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description:      form.description   || null,
        contract_value:   parseFloat(form.contract_value) || null,
        retention_pct:    parseFloat(form.retention_pct)  || null,
        start_date:       form.start_date || null,
        end_date:         form.end_date   || null,
        status:           form.status     || null,
        sub_type:         form.sub_type   || 'main',
        has_contract:     form.has_contract  ? 1 : 0,
        has_insurance:    form.has_insurance ? 1 : 0,
        responsible_name: form.responsible_name || null,
        phone:            form.phone  || null,
        email:            form.email  || null,
        pricing_lumpsum:  form.pricing_lumpsum ? 1 : 0,
        mat_by:           form.mat_by   || 'sub',
        plant_by:         form.plant_by || 'sub',
      }),
    });
    setSaving(false);
    if (res.ok) onSaved();
    else setErr('Error saving — check server.');
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Edit {sc.ref}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ padding:'8px 12px', background:'#f0fdf4', borderRadius:6, fontSize:13, color:'#166534', fontWeight:600, marginBottom:12 }}>
            {sc.subcontractor_name}
          </div>
          <div className="section-grid">
            <div className="field span2">
              <label className="field-label">Description / Scope</label>
              <input value={form.description} onChange={e => set('description', e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">Contract Value (€)</label>
              <input type="number" step="0.01" value={form.contract_value} onChange={e => set('contract_value', e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">Retention %</label>
              <input type="number" step="0.5" min="0" max="10" value={form.retention_pct} onChange={e => set('retention_pct', e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">Start Date</label>
              <input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">End Date</label>
              <input type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value)}
                style={{ padding:'7px 10px', border:'1px solid #d1d5db', borderRadius:6, fontSize:13 }}>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="terminated">Terminated</option>
              </select>
            </div>
            <div className="field">
              <label className="field-label">Type</label>
              <select value={form.sub_type} onChange={e => set('sub_type', e.target.value)}
                style={{ padding:'7px 10px', border:'1px solid #d1d5db', borderRadius:6, fontSize:13 }}>
                <option value="main">Main</option>
                <option value="misc">MISC</option>
              </select>
            </div>
          </div>

          <div style={{ fontWeight:700, fontSize:12, color:'#6b7280', textTransform:'uppercase', letterSpacing:'.05em', margin:'14px 0 8px', paddingBottom:4, borderBottom:'1px solid #e5e7eb' }}>
            Compliance
          </div>
          <div style={{ display:'flex', gap:24, marginBottom:12 }}>
            <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, cursor:'pointer' }}>
              <input type="checkbox" checked={!!form.has_contract} onChange={e => set('has_contract', e.target.checked ? 1 : 0)}
                style={{ width:16, height:16, cursor:'pointer' }} />
              Contract signed
            </label>
            <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, cursor:'pointer' }}>
              <input type="checkbox" checked={!!form.has_insurance} onChange={e => set('has_insurance', e.target.checked ? 1 : 0)}
                style={{ width:16, height:16, cursor:'pointer' }} />
              Insurance in place
            </label>
          </div>

          <div style={{ fontWeight:700, fontSize:12, color:'#6b7280', textTransform:'uppercase', letterSpacing:'.05em', margin:'14px 0 8px', paddingBottom:4, borderBottom:'1px solid #e5e7eb' }}>
            Pricing
          </div>
          <div style={{ display:'flex', alignItems:'center', flexWrap:'wrap', gap:28, marginBottom:12 }}>
            <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, cursor:'pointer' }}>
              <input type="checkbox" checked={!!form.pricing_lumpsum} onChange={e => set('pricing_lumpsum', e.target.checked ? 1 : 0)}
                style={{ width:16, height:16, cursor:'pointer' }} />
              Lumpsum
            </label>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <span style={{ fontWeight:700, fontSize:14, color:'#1e3a8a' }}>Materials:</span>
              {['gmc','sub'].map(v => (
                <label key={v} style={{ display:'flex', alignItems:'center', gap:5, fontSize:13, cursor:'pointer' }}>
                  <input type="radio" name="mat_by" value={v} checked={form.mat_by === v} onChange={() => set('mat_by', v)} />
                  {v.toUpperCase()}
                </label>
              ))}
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginLeft:24 }}>
              <span style={{ fontWeight:700, fontSize:14, color:'#1e3a8a' }}>Plant:</span>
              {['gmc','sub'].map(v => (
                <label key={v} style={{ display:'flex', alignItems:'center', gap:5, fontSize:13, cursor:'pointer' }}>
                  <input type="radio" name="plant_by" value={v} checked={form.plant_by === v} onChange={() => set('plant_by', v)} />
                  {v.toUpperCase()}
                </label>
              ))}
            </div>
          </div>

          <div style={{ fontWeight:700, fontSize:12, color:'#6b7280', textTransform:'uppercase', letterSpacing:'.05em', margin:'14px 0 8px', paddingBottom:4, borderBottom:'1px solid #e5e7eb' }}>
            Contact
          </div>
          <div className="section-grid">
            <div className="field">
              <label className="field-label">Responsible</label>
              <input value={form.responsible_name} onChange={e => set('responsible_name', e.target.value)} placeholder="Name" />
            </div>
            <div className="field">
              <label className="field-label">Phone</label>
              <input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+353..." />
            </div>
            <div className="field span2">
              <label className="field-label">Email</label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="email@..." />
            </div>
          </div>
          {err && <div style={{ color:'#dc2626', fontSize:13, marginTop:8 }}>{err}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
