import { apiFetch } from '../apiFetch.js';
import { useState, useEffect, useCallback, useRef } from 'react';
import PaymentCalendar from './PaymentCalendar.jsx';
import { useZoom } from '../zoomContext.js';

const STATUS_COLOR = { draft:'#92400e', assessed:'#1e40af', approved:'#166534', invoiced:'#7c3aed', paid:'#065f46' };
const STATUS_BG    = { draft:'#fef9c3', assessed:'#dbeafe', approved:'#dcfce7', invoiced:'#ede9fe', paid:'#d1fae5' };

function fmt(n, decimals=2) {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-IE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T12:00:00').toLocaleDateString('en-IE', { day:'numeric', month:'short', year:'numeric' });
}

export default function SubcontractDetail({ projectId, subcontractId, onBack, onOpenAssessment }) {
  const [data,       setData]       = useState(null);
  const [tab,        setTab]        = useState('overview');
  const [boqCertified, setBoqCertified] = useState([]);

  const load = useCallback(() => {
    apiFetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}`)
      .then(r => r.json()).then(setData);
    apiFetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/boq`)
      .then(r => r.json()).then(setBoqCertified).catch(() => {});
  }, [projectId, subcontractId]);

  useEffect(() => { load(); }, [load]);

  if (!data) return <div className="state-box"><div className="icon">⏳</div><p>Loading…</p></div>;

  const { subcontract: sc, boq_items, applications, compensation_events } = data;
  const variations = compensation_events.filter(c => c.type !== 'daywork');
  const dayworks    = compensation_events.filter(c => c.type === 'daywork');

  const totalCertified = applications.filter(a => a.status !== 'draft')
                                     .reduce((s, a) => s + (a.value_gmc || 0), 0);
  const totalPaid      = applications.filter(a => a.status === 'paid')
                                     .reduce((s, a) => s + (a.net_payable || 0), 0);
  const retention      = Math.round(totalCertified * (sc.retention_pct / 100) * 100) / 100;

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', minHeight:0 }}>
      {/* Back + Header */}
      <div className="detail-nav" style={{ marginBottom: 2 }}>
        <button className="btn-back" onClick={onBack}>← Subcontracts</button>
      </div>

      <div className="sc-detail-header">
        <div style={{ display:'flex', alignItems:'baseline', gap:8, flexWrap:'wrap' }}>
          <span className="sc-detail-ref">{sc.ref}</span>
          <span className="sc-detail-name">{sc.subcontractor_name}</span>
          <span className="sc-detail-desc">{sc.description}</span>
          <span className="sc-detail-meta" style={{ display:'flex', alignItems:'center', gap:6 }}>
            · {fmtDate(sc.start_date)} – {fmtDate(sc.end_date)} ·
            <RetentionField projectId={projectId} subcontractId={subcontractId} value={sc.retention_pct} onSaved={load} />
          </span>
        </div>
        <div className="sc-detail-kpis">
          {[
            { label: 'Contract Value', value: `€${fmt(sc.contract_value)}`, cls: '' },
            { label: 'Certified to Date', value: `€${fmt(totalCertified)}`, cls: 'certified' },
            { label: 'Retention Held', value: `€${fmt(retention)}`, cls: 'retention' },
            { label: 'Paid to Date', value: `€${fmt(totalPaid)}`, cls: 'paid' },
          ].map(k => (
            <div key={k.label} className="detail-kpi">
              <div className="kpi-label">{k.label}</div>
              <div className={`kpi-value ${k.cls}`}>{k.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Progress bar */}
      <div className="sc-progress-bar large">
        <div className="sc-progress-fill" style={{ width: `${Math.min(100, sc.contract_value > 0 ? (totalCertified / sc.contract_value) * 100 : 0)}%` }} />
      </div>

      {/* Tabs */}
      <div className="das-tabs" style={{ marginTop: 4 }}>
        {[
          { id:'overview',    label:`Applications (${applications.length})` },
          { id:'daywork',     label:`Daywork (${dayworks.length})` },
          { id:'ces',         label:`Variation (${variations.length})` },
          { id:'payments',    label:'Tracker Invoices' },
          { id:'boq',         label:`Sub BOQ (${boq_items.length})` },
        ].map(t => (
          <button key={t.id} className={`das-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="das-tab-content" style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column' }}>
        {tab === 'overview' && (
          <ApplicationsTab
            applications={applications}
            onView={appId => onOpenAssessment(sc, appId)}
            retention_pct={sc.retention_pct}
            onNewAssessment={() => onOpenAssessment(sc)}
            projectId={projectId}
            subcontractId={subcontractId}
            onRefresh={load}
          />
        )}
        {tab === 'boq' && <BOQTab boqItems={boq_items} boqCertified={boqCertified} projectId={projectId} subcontractId={subcontractId} onRefresh={load} />}
        {tab === 'daywork' && (
          <CELikeTab ces={dayworks} applications={applications} subcontractId={sc.id} projectId={projectId}
            onRefresh={load} type="daywork" showRef={false} onViewApp={appId => onOpenAssessment(sc, appId)} />
        )}
        {tab === 'ces'  && (
          <CELikeTab ces={variations} applications={applications} subcontractId={sc.id} projectId={projectId}
            onRefresh={load} type="variation" showRef={true} onViewApp={appId => onOpenAssessment(sc, appId)} />
        )}
        {tab === 'payments' && (
          <PaymentCalendar
            projectId={projectId}
            subcontractId={subcontractId}
            applications={applications}
            retentionPct={sc.retention_pct}
            onRefresh={load}
          />
        )}
      </div>
    </div>
  );
}

// Week endings on this project are always the Friday closing a week (matches Cost Tracker,
// Revenue Generator, etc.) — offering a free date picker here let an off-cycle date (e.g. Thursday)
/* ── Applications Tab ───────────────────────────────────────────────────── */
// "+ New Application" and "Ver detalhe" both open SubAssessmentView (via onNewAssessment /
// onView, wired up in SubcontractView.jsx) instead of this tab's own local form + read-only
// AppDetailView. Those used to be a separate, more limited path: the create form had no way to
// enter item-level % data, and AppDetailView could advance status but had no Approve-with-cut,
// no Payment Certificate, and no invoice recording -- all of which only exist on SubAssessmentView.
function ApplicationsTab({ applications, onView, retention_pct, onNewAssessment, projectId, subcontractId, onRefresh }) {
  const zoom = useZoom();

  const deleteApp = async (a) => {
    if (!window.confirm(`Delete App ${a.application_number} (WE ${fmtDate(a.week_ending)})?`)) return;
    await apiFetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/applications/${a.id}`, { method: 'DELETE' });
    onRefresh();
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', minHeight:0 }}>
      <div className="section-toolbar">
        <span className="section-stat">{applications.length} assessments</span>
        <button className="btn-primary" onClick={onNewAssessment}>+ New Assessment</button>
      </div>

      {applications.length === 0 ? (
        <div className="empty-hint">No assessments yet.</div>
      ) : (
        <div style={{ flex:1, minHeight:0, overflow:'auto' }}>
        <table className="boq-table" style={{ zoom: `${zoom}%` }}>
          <thead>
            <tr>
              <th style={{position:'sticky', top:0, background:'#f9fafb', zIndex:2}}>No.</th>
              <th style={{position:'sticky', top:0, background:'#f9fafb', zIndex:2}}>Week Ending</th>
              <th style={{textAlign:'right', position:'sticky', top:0, background:'#f9fafb', zIndex:2}}>Sub Claim (€)</th>
              <th style={{textAlign:'right', position:'sticky', top:0, background:'#f9fafb', zIndex:2}}>GMC Assessed (€)</th>
              <th style={{textAlign:'right', position:'sticky', top:0, background:'#f9fafb', zIndex:2}}>Cumulative (€)</th>
              <th style={{textAlign:'right', position:'sticky', top:0, background:'#f9fafb', zIndex:2}}>Retention (€)</th>
              <th style={{textAlign:'right', position:'sticky', top:0, background:'#f9fafb', zIndex:2}}>Net Payable (€)</th>
              <th style={{position:'sticky', top:0, background:'#f9fafb', zIndex:2}}>Status</th>
              <th style={{position:'sticky', top:0, background:'#f9fafb', zIndex:2}}></th>
            </tr>
          </thead>
          <tbody>
            {applications.map(a => {
              const retHeld = Math.round((a.cumulative_gmc || 0) * (retention_pct / 100) * 100) / 100;
              return (
                <tr key={a.id}>
                  <td style={{ fontWeight: 700 }}>#{a.application_number}</td>
                  <td>{fmtDate(a.week_ending)}</td>
                  <td style={{textAlign:'right'}}>{fmt(a.value_sub)}</td>
                  <td style={{textAlign:'right', fontWeight: 600, color:'#166534'}}>{fmt(a.value_gmc)}</td>
                  <td style={{textAlign:'right', color:'#1e40af'}}>{fmt(a.cumulative_gmc)}</td>
                  <td style={{textAlign:'right', color: '#7c3aed' }}>{fmt(retHeld)}</td>
                  <td style={{textAlign:'right', fontWeight: 700 }}>{fmt(a.net_payable)}</td>
                  <td>
                    <span className="status-badge" style={{ background: STATUS_BG[a.status], color: STATUS_COLOR[a.status] }}>
                      {a.status}
                    </span>
                  </td>
                  <td style={{ display:'flex', gap:4, alignItems:'center' }}>
                    <button className="btn-link" onClick={() => onView(a.id)}>Ver detalhe →</button>
                    <button onClick={() => deleteApp(a)} title="Delete application"
                      style={{ background:'none', border:'1px solid #fca5a5', borderRadius:6, padding:'3px 8px', cursor:'pointer', fontSize:12, color:'#dc2626' }}>
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}

/* ── BOQ Tab ────────────────────────────────────────────────────────────── */
const stickyTh = { position:'sticky', top:0, zIndex:4, background:'#1a1a2e', color:'#fff' };

function BOQTab({ boqItems, boqCertified, projectId, subcontractId, onRefresh }) {
  const zoom = useZoom();
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');

  const certMap = {};
  boqCertified.forEach(c => { certMap[c.id] = c; });

  const totalContract  = boqItems.reduce((s, i) => s + (i.qty || 0) * (i.rate || 0), 0);
  const totalCertified = boqCertified.reduce((s, i) => s + (i.value_certified || 0), 0);
  const totalRemaining = boqCertified.reduce((s, i) => s + (i.value_remaining || 0), 0);

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImporting(true); setImportMsg('');
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = ev.target.result.split(',')[1];
      const mode = boqItems.length > 0 && window.confirm('Já existem itens no BOQ.\n\nOK = Substituir tudo\nCancelar = Adicionar aos existentes')
        ? 'replace' : boqItems.length > 0 ? 'append' : 'replace';
      const res = await apiFetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/boq/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: base64, mode }),
      });
      const json = await res.json();
      setImporting(false);
      if (res.ok) { setImportMsg(`✓ ${json.imported} items imported (${json.total} total)`); onRefresh(); }
      else setImportMsg(`Error: ${json.error}`);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', minHeight:0 }}>
      <div className="section-toolbar">
        <span className="section-stat">
          {boqItems.length} items · Contract: €{fmt(totalContract)} · Certified: €{fmt(totalCertified)} · Remaining: €{fmt(totalRemaining)}
        </span>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          {importMsg && <span style={{ fontSize:11, color: importMsg.startsWith('✓') ? '#166534' : '#dc2626' }}>{importMsg}</span>}
          <label style={{ padding:'4px 10px', borderRadius:6, border:'1px solid #bfdbfe', background:'#eff6ff',
            cursor:'pointer', fontSize:11, color:'#1e40af', fontWeight:600 }}>
            {importing ? 'Importing…' : '⬆ Import BOQ (Excel)'}
            <input type="file" accept=".xlsx,.xls,.csv" style={{ display:'none' }} onChange={handleFile} disabled={importing} />
          </label>
        </div>
      </div>
      {boqItems.length === 0 ? (
        <div className="empty-hint">No sub BOQ items defined.</div>
      ) : (
        <div style={{ overflow:'auto', flex:1, minHeight:0, zoom: `${zoom}%` }}>
          <table className="boq-table">
            <thead>
              <tr>
                <th style={stickyTh}>Ref</th><th style={stickyTh}>Description</th>
                <th style={{...stickyTh, textAlign:'right'}}>Qty</th>
                <th style={stickyTh}>Unit</th>
                <th style={{...stickyTh, textAlign:'right'}}>Rate (€)</th>
                <th style={{...stickyTh, textAlign:'right'}}>Contract (€)</th>
                <th style={{...stickyTh, textAlign:'right', color:'#1e40af'}}>% Cert.</th>
                <th style={{...stickyTh, textAlign:'right', color:'#166534'}}>Certified (€)</th>
                <th style={{...stickyTh, textAlign:'right', color:'#dc2626'}}>Remaining (€)</th>
              </tr>
            </thead>
            <tbody>
              {boqItems.map((i, idx) => {
                const c = certMap[i.id] || {};
                const cv = (i.qty || 0) * (i.rate || 0);
                return (
                  <tr key={i.id} style={{ background: idx%2===0 ? '#f8fafc' : '#fff' }}>
                    <td style={{fontFamily:'monospace', fontSize:12, whiteSpace:'nowrap'}}>{i.item_ref}</td>
                    <td style={{maxWidth:300, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:12}} title={i.description}>{i.description}</td>
                    <td style={{textAlign:'right', fontSize:12}}>{fmt(i.qty, 3)}</td>
                    <td style={{fontSize:12, color:'#6b7280'}}>{i.unit}</td>
                    <td style={{textAlign:'right', fontSize:12}}>€{fmt(i.rate)}</td>
                    <td style={{textAlign:'right', fontWeight:600, fontSize:12}}>€{fmt(cv)}</td>
                    <td style={{textAlign:'right', color: c.pct_certified > 0 ? '#1e40af' : '#d1d5db', fontSize:12}}>
                      {c.pct_certified != null ? `${Number(c.pct_certified).toFixed(1)}%` : '—'}
                    </td>
                    <td style={{textAlign:'right', color:'#166534', fontWeight:600, fontSize:12}}>
                      {c.value_certified > 0 ? `€${fmt(c.value_certified)}` : <span style={{color:'#d1d5db'}}>—</span>}
                    </td>
                    <td style={{textAlign:'right', color: c.value_remaining > 0 ? '#dc2626' : '#16a34a', fontSize:12}}>
                      €{fmt(c.value_remaining ?? cv)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{background:'#1a1a2e', color:'#fff', fontWeight:700, position:'sticky', bottom:0, zIndex:5}}>
                <td colSpan={5} style={{textAlign:'right', paddingRight:8, padding:'8px 10px'}}>TOTAL</td>
                <td style={{textAlign:'right', padding:'8px 10px'}}>€{fmt(totalContract)}</td>
                <td></td>
                <td style={{textAlign:'right', color:'#4ade80', padding:'8px 10px'}}>€{fmt(totalCertified)}</td>
                <td style={{textAlign:'right', color:'#f87171', padding:'8px 10px'}}>€{fmt(totalRemaining || totalContract - totalCertified)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Variation / Daywork Tab ───────────────────────────────────────────────
   Both are compensation_event rows distinguished only by `type`; Daywork has no
   Ref field (a running charge doesn't need one the way a numbered variation does).
   Either kind can optionally link to an Application, which sums its agreed GMC
   value into that application's total (server-side, see recalcApplicationGmc). */
function CELikeTab({ ces, applications, subcontractId, projectId, onRefresh, type, showRef, onViewApp }) {
  const zoom = useZoom();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ce_ref:'', description:'', sub_value:'', gmc_value:'', status:'submitted', notes:'', sub_application_id:'' });
  const [saving, setSaving] = useState(false);

  const label = type === 'daywork' ? 'Daywork' : 'CE';
  const noun  = type === 'daywork' ? 'daywork charges' : 'compensation events';

  const submit = async () => {
    setSaving(true);
    await apiFetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/ces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form, type,
        sub_value: parseFloat(form.sub_value)||0,
        gmc_value: parseFloat(form.gmc_value)||0,
        sub_application_id: form.sub_application_id ? Number(form.sub_application_id) : null,
      }),
    });
    setSaving(false);
    setShowForm(false);
    setForm({ ce_ref:'', description:'', sub_value:'', gmc_value:'', status:'submitted', notes:'', sub_application_id:'' });
    onRefresh();
  };

  const CE_STATUS_COLOR = { submitted:'#92400e', assessed:'#1e40af', agreed:'#166534', rejected:'#991b1b' };
  const CE_STATUS_BG    = { submitted:'#fef9c3', assessed:'#dbeafe', agreed:'#dcfce7', rejected:'#fee2e2' };

  const changeCEStatus = async (ceId, status) => {
    await apiFetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/ces/${ceId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    });
    onRefresh();
  };

  const appLabel = id => {
    const a = applications.find(x => x.id === id);
    return a ? `App #${a.application_number}` : `App #${id}`;
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', minHeight:0 }}>
      <div className="section-toolbar">
        <span className="section-stat">{ces.length} {noun} · GMC agreed: €{fmt(ces.filter(c=>c.status==='agreed').reduce((s,c)=>s+c.gmc_value,0))}</span>
        <button className="btn-primary" onClick={() => setShowForm(s => !s)}>+ New {label}</button>
      </div>

      {showForm && (
        <div className="inline-form">
          <div className="section-grid">
            {showRef && (
              <div className="field"><label className="field-label">CE Ref *</label>
                <input value={form.ce_ref} onChange={e => setForm(f=>({...f,ce_ref:e.target.value}))} placeholder="CE-001" /></div>
            )}
            <div className="field"><label className="field-label">Status</label>
              <select value={form.status} onChange={e => setForm(f=>({...f,status:e.target.value}))}>
                {['submitted','assessed','agreed','rejected'].map(s=><option key={s}>{s}</option>)}
              </select></div>
            <div className="field"><label className="field-label">Application</label>
              <select value={form.sub_application_id} onChange={e => setForm(f=>({...f,sub_application_id:e.target.value}))}>
                <option value="">— Not linked —</option>
                {applications.map(a => <option key={a.id} value={a.id}>App #{a.application_number} ({fmtDate(a.week_ending)})</option>)}
              </select></div>
            <div className="field span2"><label className="field-label">Description *</label>
              <input value={form.description} onChange={e => setForm(f=>({...f,description:e.target.value}))}
                placeholder={type === 'daywork' ? 'Describe the daywork charge…' : 'Describe the variation / extra work…'} /></div>
            <div className="field"><label className="field-label">Sub Claim (€)</label>
              <input type="number" step="0.01" value={form.sub_value} onChange={e => setForm(f=>({...f,sub_value:e.target.value}))} /></div>
            <div className="field"><label className="field-label">GMC Assessed (€)</label>
              <input type="number" step="0.01" value={form.gmc_value} onChange={e => setForm(f=>({...f,gmc_value:e.target.value}))} /></div>
          </div>
          <div style={{ display:'flex', gap:8, marginTop:12 }}>
            <button className="btn-primary" onClick={submit} disabled={saving}>{saving?'Saving…':`Save ${label}`}</button>
            <button className="btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {ces.length === 0 && !showForm ? (
        <div className="empty-hint">No {noun} raised.</div>
      ) : (
        <div style={{ flex:1, minHeight:0, overflow:'auto' }}>
        <table className="boq-table" style={{ marginTop: 12, zoom: `${zoom}%` }}>
          <thead>
            <tr>
              {showRef && <th style={{position:'sticky', top:0, background:'#f9fafb', zIndex:2}}>Ref</th>}
              <th style={{position:'sticky', top:0, background:'#f9fafb', zIndex:2}}>Description</th>
              <th className="col-num" style={{position:'sticky', top:0, background:'#f9fafb', zIndex:2}}>Sub Claim (€)</th>
              <th className="col-num" style={{position:'sticky', top:0, background:'#f9fafb', zIndex:2}}>GMC Value (€)</th>
              <th className="col-num" style={{position:'sticky', top:0, background:'#f9fafb', zIndex:2}}>Delta (€)</th>
              <th style={{position:'sticky', top:0, background:'#f9fafb', zIndex:2}}>Status</th>
              <th style={{position:'sticky', top:0, background:'#f9fafb', zIndex:2}}>Application</th>
              <th style={{position:'sticky', top:0, background:'#f9fafb', zIndex:2}}>Approved</th>
            </tr>
          </thead>
          <tbody>
            {ces.map(ce => (
              <tr key={ce.id}>
                {showRef && <td style={{ fontFamily:'monospace', fontSize:12 }}>{ce.ce_ref}</td>}
                <td>{ce.description}</td>
                <td className="col-num">{fmt(ce.sub_value)}</td>
                <td className="col-num" style={{ fontWeight: 600 }}>{fmt(ce.gmc_value)}</td>
                <td className="col-num" style={{ color: ce.gmc_value >= ce.sub_value ? '#166534' : '#dc2626' }}>
                  {ce.gmc_value - ce.sub_value >= 0 ? '+' : ''}{fmt(ce.gmc_value - ce.sub_value)}
                </td>
                <td>
                  <select value={ce.status} onChange={e => changeCEStatus(ce.id, e.target.value)}
                    style={{ background: CE_STATUS_BG[ce.status], color: CE_STATUS_COLOR[ce.status], border:'none', borderRadius:12,
                      padding:'2px 8px', fontSize:12, fontWeight:600, cursor:'pointer' }}>
                    {Object.keys(CE_STATUS_BG).map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td style={{ fontSize:12 }}>
                  {ce.sub_application_id
                    ? <button className="btn-link" onClick={() => onViewApp(ce.sub_application_id)}>{appLabel(ce.sub_application_id)} →</button>
                    : <span style={{ color:'#9ca3af' }}>—</span>}
                </td>
                <td style={{ fontSize:12 }}>{ce.approved_date ? new Date(ce.approved_date+'T12:00:00').toLocaleDateString('en-IE',{day:'numeric',month:'short',year:'numeric'}) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}

// ── Inline editable retention % ────────────────────────────────────────────────
function RetentionField({ projectId, subcontractId, value, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);
  const save = async () => {
    const pct = Math.min(100, Math.max(0, parseFloat(val) || 0));
    await apiFetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/retention`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ retention_pct: pct }) });
    setEditing(false);
    if (onSaved) onSaved();
  };
  if (editing) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        Retention
        <input type="number" min={0} max={100} step={0.5} value={val} autoFocus
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
          style={{ width: 56, padding: '1px 4px', fontSize: 13, borderRadius: 4, border: '1px solid #6366f1' }} />%
        <button onClick={save}
          style={{ border: 'none', background: '#16a34a', color: '#fff', borderRadius: 4, padding: '1px 7px', cursor: 'pointer', fontSize: 12 }}>✓</button>
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      Retention {value}%
      <button onClick={() => { setVal(value); setEditing(true); }} title="Edit retention %"
        style={{ border: '1px solid #c7d2fe', background: '#eef2ff', color: '#4338ca', borderRadius: 4, padding: '0 6px', cursor: 'pointer', fontSize: 11 }}>✎</button>
    </span>
  );
}
