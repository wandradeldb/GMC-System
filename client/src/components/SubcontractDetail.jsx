import { apiFetch } from '../apiFetch.js';
import { useState, useEffect, useCallback, useRef } from 'react';
import PaymentCalendar from './PaymentCalendar.jsx';
import SubcontractStatement from './SubcontractStatement.jsx';
import BackButton from './BackButton.jsx';
import { useBackHandler } from '../useBackHandler.js';
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

export default function SubcontractDetail({ projectId, subcontractId, readOnly, onBack, onOpenAssessment }) {
  const [data,       setData]       = useState(null);
  const [tab,        setTab]        = useState('overview');
  const [boqCertified, setBoqCertified] = useState([]);
  const [statementData, setStatementData] = useState(null);

  const load = useCallback(() => {
    apiFetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}`)
      .then(r => r.json()).then(setData);
    apiFetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/boq`)
      .then(r => r.json()).then(setBoqCertified).catch(() => {});
  }, [projectId, subcontractId]);

  useEffect(() => { load(); }, [load]);

  useBackHandler(onBack, true);
  useBackHandler(() => setStatementData(null), !!statementData);

  // Full-history statement across every application on this subcontract, for reviewing
  // accumulated cuts/Daywork/Variation/Contra Charge divergences with the sub in a meeting.
  const openStatement = async () => {
    const res = await apiFetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/statement`);
    setStatementData(await res.json());
  };

  if (statementData) {
    return <SubcontractStatement data={statementData} onBack={() => setStatementData(null)} />;
  }

  if (!data) return <div className="state-box"><div className="icon">⏳</div><p>Loading…</p></div>;

  const { subcontract: sc, boq_items, applications, compensation_events } = data;
  const dayworks      = compensation_events.filter(c => c.type === 'daywork');
  const variations    = compensation_events.filter(c => c.type === 'variation');
  const contraCharges = compensation_events.filter(c => c.type === 'contra_charge');

  const totalCertified = applications.filter(a => a.status !== 'draft')
                                     .reduce((s, a) => s + (a.value_gmc || 0), 0);
  const totalPaid      = applications.filter(a => a.status === 'paid')
                                     .reduce((s, a) => s + (a.net_payable || 0), 0);
  const retention      = Math.round(totalCertified * (sc.retention_pct / 100) * 100) / 100;

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', minHeight:0 }}>
      {/* Back + Header */}
      <div className="detail-nav" style={{ marginBottom: 2 }}>
        <BackButton label="Subcontracts" onClick={onBack} />
      </div>

      <div className="sc-detail-header">
        <div style={{ display:'flex', alignItems:'baseline', gap:8, flexWrap:'wrap' }}>
          <span className="sc-detail-ref">{sc.ref}</span>
          <span className="sc-detail-name">{sc.subcontractor_name}</span>
          <span className="sc-detail-desc">{sc.description}</span>
          <span className="sc-detail-meta" style={{ display:'flex', alignItems:'center', gap:6 }}>
            · {fmtDate(sc.start_date)} – {fmtDate(sc.end_date)} ·
            <RetentionField projectId={projectId} subcontractId={subcontractId} value={sc.retention_pct} onSaved={load} readOnly={readOnly} />
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
          { id:'contra',      label:`Contra Charge (${contraCharges.length})` },
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
            dayworks={dayworks}
            variations={variations}
            contraCharges={contraCharges}
            onView={appId => onOpenAssessment(sc, appId)}
            retention_pct={sc.retention_pct}
            onNewAssessment={() => onOpenAssessment(sc)}
            onStatement={openStatement}
            projectId={projectId}
            subcontractId={subcontractId}
            onRefresh={load}
            readOnly={readOnly}
          />
        )}
        {tab === 'boq' && <BOQTab boqItems={boq_items} boqCertified={boqCertified} projectId={projectId} subcontractId={subcontractId} onRefresh={load} readOnly={readOnly} />}
        {tab === 'daywork' && (
          <CELikeTab ces={dayworks} applications={applications} subcontractId={sc.id} projectId={projectId}
            onRefresh={load} type="daywork" onViewApp={appId => onOpenAssessment(sc, appId)} readOnly={readOnly} />
        )}
        {tab === 'ces'  && (
          <CELikeTab ces={variations} applications={applications} subcontractId={sc.id} projectId={projectId}
            onRefresh={load} type="variation" onViewApp={appId => onOpenAssessment(sc, appId)} readOnly={readOnly} />
        )}
        {tab === 'contra' && (
          <CELikeTab ces={contraCharges} applications={applications} subcontractId={sc.id} projectId={projectId}
            onRefresh={load} type="contra_charge" onViewApp={appId => onOpenAssessment(sc, appId)} readOnly={readOnly} />
        )}
        {tab === 'payments' && (
          <PaymentCalendar
            projectId={projectId}
            subcontractId={subcontractId}
            applications={applications}
            retentionPct={sc.retention_pct}
            onRefresh={load}
            readOnly={readOnly}
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
function ApplicationsTab({ applications, dayworks, variations, contraCharges, onView, retention_pct, onNewAssessment, onStatement, projectId, subcontractId, onRefresh, readOnly }) {
  const zoom = useZoom();

  const deleteApp = async (a) => {
    if (!window.confirm(`Delete App ${a.application_number} (WE ${fmtDate(a.week_ending)})?`)) return;
    await apiFetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/applications/${a.id}`, { method: 'DELETE' });
    onRefresh();
  };

  // Only 'agreed' CEs actually count toward the application's GMC total (see recalcApplicationGmc
  // server-side), so these per-app breakdowns must filter the same way to stay consistent with GMC Assessed.
  const sumFor = (list, appId) => list.filter(c => c.sub_application_id === appId && c.status === 'agreed')
                                       .reduce((s, c) => s + (c.gmc_value || 0), 0);

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', minHeight:0 }}>
      <div className="section-toolbar">
        <span className="section-stat">{applications.length} assessments</span>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onStatement}
            style={{ padding:'4px 12px', borderRadius:6, border:'1px solid #3b82f6', background:'#eff6ff',
              color:'#1e40af', cursor:'pointer', fontSize:12, fontWeight:600 }}>
            📊 Statement
          </button>
          {!readOnly && <button className="btn-primary" onClick={onNewAssessment}>+ New Assessment</button>}
        </div>
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
              <th style={{textAlign:'right', position:'sticky', top:0, background:'#f9fafb', zIndex:2}}>Daywork (€)</th>
              <th style={{textAlign:'right', position:'sticky', top:0, background:'#f9fafb', zIndex:2}}>Variation (€)</th>
              <th style={{textAlign:'right', position:'sticky', top:0, background:'#f9fafb', zIndex:2}}>Contra Charge (€)</th>
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
              const retHeld  = Math.round((a.cumulative_gmc || 0) * (retention_pct / 100) * 100) / 100;
              const daySum   = sumFor(dayworks, a.id);
              const varSum   = sumFor(variations, a.id);
              const ccSum    = sumFor(contraCharges, a.id);
              return (
                <tr key={a.id}>
                  <td style={{ fontWeight: 700 }}>#{a.application_number}</td>
                  <td>{fmtDate(a.week_ending)}</td>
                  <td style={{textAlign:'right'}}>{fmt(a.value_sub)}</td>
                  <td style={{textAlign:'right', color: daySum > 0 ? '#7c3aed' : '#d1d5db'}}>{daySum > 0 ? fmt(daySum) : '—'}</td>
                  <td style={{textAlign:'right', color: varSum > 0 ? '#7c3aed' : '#d1d5db'}}>{varSum > 0 ? fmt(varSum) : '—'}</td>
                  <td style={{textAlign:'right', color: ccSum > 0 ? '#dc2626' : '#d1d5db'}}>{ccSum > 0 ? `−${fmt(ccSum)}` : '—'}</td>
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
                    {!readOnly && <button onClick={() => deleteApp(a)} title="Delete application"
                      style={{ background:'none', border:'1px solid #fca5a5', borderRadius:6, padding:'3px 8px', cursor:'pointer', fontSize:12, color:'#dc2626' }}>
                      ✕
                    </button>}
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

function BOQTab({ boqItems, boqCertified, projectId, subcontractId, onRefresh, readOnly }) {
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
          {!readOnly && (
            <label style={{ padding:'4px 10px', borderRadius:6, border:'1px solid #bfdbfe', background:'#eff6ff',
              cursor:'pointer', fontSize:11, color:'#1e40af', fontWeight:600 }}>
              {importing ? 'Importing…' : '⬆ Import BOQ (Excel)'}
              <input type="file" accept=".xlsx,.xls,.csv" style={{ display:'none' }} onChange={handleFile} disabled={importing} />
            </label>
          )}
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

/* ── Variation / Daywork / Contra Charge Tab ───────────────────────────────
   All three are compensation_event rows distinguished only by `type`; none has a Ref field in
   the UI -- the server auto-generates one (DW-N / CE-N / CC-N, see POST /ces) just to satisfy the
   DB's NOT NULL + UNIQUE(subcontract_id, ce_ref). Any of the three can optionally link to an
   Application: Daywork/Variation ADD their agreed GMC value to that application's total,
   Contra Charge SUBTRACTS it (a deduction charged back to the sub) -- server-side in
   recalcApplicationGmc. Contra Charge has no "Sub Claim" (the sub isn't claiming anything, GMC is
   charging them), so that field/column and the Delta column are hidden for it. */
function CELikeTab({ ces, applications, subcontractId, projectId, onRefresh, type, onViewApp, readOnly }) {
  const zoom = useZoom();
  const emptyForm = { description:'', sub_value:'', gmc_value:'', status:'submitted', notes:'', sub_application_id:'' };
  const [showForm,  setShowForm]  = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const isContra = type === 'contra_charge';
  const label = type === 'daywork' ? 'Daywork' : isContra ? 'Contra Charge' : 'CE';
  const noun  = type === 'daywork' ? 'daywork charges' : isContra ? 'contra charges' : 'compensation events';
  const valueLabel = isContra ? 'Deduction (€)' : 'GMC Assessed (€)';

  const openNew = () => { setEditingId(null); setForm(emptyForm); setShowForm(true); };
  const openEdit = (ce) => {
    setEditingId(ce.id);
    setForm({
      description: ce.description || '',
      sub_value: ce.sub_value ?? '',
      gmc_value: ce.gmc_value ?? '',
      status: ce.status || 'submitted',
      notes: ce.notes || '',
      sub_application_id: ce.sub_application_id ? String(ce.sub_application_id) : '',
    });
    setShowForm(true);
  };
  const cancelForm = () => { setShowForm(false); setEditingId(null); setForm(emptyForm); };

  const submit = async () => {
    setSaving(true);
    const payload = {
      ...form, type,
      sub_value: parseFloat(form.sub_value)||0,
      gmc_value: parseFloat(form.gmc_value)||0,
      sub_application_id: form.sub_application_id ? Number(form.sub_application_id) : null,
    };
    const url = `/api/v1/projects/${projectId}/subcontracts/${subcontractId}/ces` + (editingId ? `/${editingId}` : '');
    await apiFetch(url, {
      method: editingId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    cancelForm();
    onRefresh();
  };

  const deleteCE = async (ce) => {
    if (!window.confirm(`Delete "${ce.description}"?`)) return;
    await apiFetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/ces/${ce.id}`, { method: 'DELETE' });
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
        <span className="section-stat">{ces.length} {noun} · {isContra ? 'Deducted' : 'GMC'} agreed: €{fmt(ces.filter(c=>c.status==='agreed').reduce((s,c)=>s+c.gmc_value,0))}</span>
        {!readOnly && <button className="btn-primary" onClick={openNew}>+ New {label}</button>}
      </div>

      {showForm && !readOnly && (
        <div className="inline-form">
          <div className="section-grid">
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
                placeholder={type === 'daywork' ? 'Describe the daywork charge…' : isContra ? 'Describe the reason for the deduction…' : 'Describe the variation / extra work…'} /></div>
            {!isContra && (
              <div className="field"><label className="field-label">Sub Claim (€)</label>
                <input type="number" step="0.01" value={form.sub_value} onChange={e => setForm(f=>({...f,sub_value:e.target.value}))} /></div>
            )}
            <div className="field"><label className="field-label">{valueLabel}</label>
              <input type="number" step="0.01" value={form.gmc_value} onChange={e => setForm(f=>({...f,gmc_value:e.target.value}))} /></div>
          </div>
          <div style={{ display:'flex', gap:8, marginTop:12 }}>
            <button className="btn-primary" onClick={submit} disabled={saving}>{saving?'Saving…':(editingId?`Update ${label}`:`Save ${label}`)}</button>
            <button className="btn-ghost" onClick={cancelForm}>Cancel</button>
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
              <th style={{position:'sticky', top:0, background:'#f9fafb', zIndex:2}}>Description</th>
              {!isContra && <th className="col-num" style={{position:'sticky', top:0, background:'#f9fafb', zIndex:2}}>Sub Claim (€)</th>}
              <th className="col-num" style={{position:'sticky', top:0, background:'#f9fafb', zIndex:2}}>{valueLabel}</th>
              {!isContra && <th className="col-num" style={{position:'sticky', top:0, background:'#f9fafb', zIndex:2}}>Delta (€)</th>}
              <th style={{position:'sticky', top:0, background:'#f9fafb', zIndex:2}}>Status</th>
              <th style={{position:'sticky', top:0, background:'#f9fafb', zIndex:2}}>Application</th>
              <th style={{position:'sticky', top:0, background:'#f9fafb', zIndex:2}}>Approved</th>
              <th style={{position:'sticky', top:0, background:'#f9fafb', zIndex:2}}></th>
            </tr>
          </thead>
          <tbody>
            {ces.map(ce => (
              <tr key={ce.id}>
                <td>{ce.description}</td>
                {!isContra && <td className="col-num">{fmt(ce.sub_value)}</td>}
                <td className="col-num" style={{ fontWeight: 600, color: isContra ? '#dc2626' : 'inherit' }}>
                  {isContra ? '−' : ''}{fmt(ce.gmc_value)}
                </td>
                {!isContra && (
                  <td className="col-num" style={{ color: ce.gmc_value >= ce.sub_value ? '#166534' : '#dc2626' }}>
                    {ce.gmc_value - ce.sub_value >= 0 ? '+' : ''}{fmt(ce.gmc_value - ce.sub_value)}
                  </td>
                )}
                <td>
                  {readOnly ? (
                    <span className="status-badge" style={{ background: CE_STATUS_BG[ce.status], color: CE_STATUS_COLOR[ce.status] }}>
                      {ce.status}
                    </span>
                  ) : (
                    <select value={ce.status} onChange={e => changeCEStatus(ce.id, e.target.value)}
                      style={{ background: CE_STATUS_BG[ce.status], color: CE_STATUS_COLOR[ce.status], border:'none', borderRadius:12,
                        padding:'2px 8px', fontSize:12, fontWeight:600, cursor:'pointer' }}>
                      {Object.keys(CE_STATUS_BG).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  )}
                </td>
                <td style={{ fontSize:12 }}>
                  {ce.sub_application_id
                    ? <button className="btn-link" onClick={() => onViewApp(ce.sub_application_id)}>{appLabel(ce.sub_application_id)} →</button>
                    : <span style={{ color:'#9ca3af' }}>—</span>}
                </td>
                <td style={{ fontSize:12 }}>{ce.approved_date ? new Date(ce.approved_date+'T12:00:00').toLocaleDateString('en-IE',{day:'numeric',month:'short',year:'numeric'}) : '—'}</td>
                <td style={{ display:'flex', gap:4, alignItems:'center' }}>
                  {!readOnly && <button onClick={() => openEdit(ce)} title="Edit"
                    style={{ background:'none', border:'1px solid #c7d2fe', borderRadius:6, padding:'3px 8px', cursor:'pointer', fontSize:12, color:'#4338ca' }}>
                    ✎
                  </button>}
                  {!readOnly && <button onClick={() => deleteCE(ce)} title="Delete"
                    style={{ background:'none', border:'1px solid #fca5a5', borderRadius:6, padding:'3px 8px', cursor:'pointer', fontSize:12, color:'#dc2626' }}>
                    ✕
                  </button>}
                </td>
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
function RetentionField({ projectId, subcontractId, value, onSaved, readOnly }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);
  const save = async () => {
    const pct = Math.min(100, Math.max(0, parseFloat(val) || 0));
    await apiFetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/retention`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ retention_pct: pct }) });
    setEditing(false);
    if (onSaved) onSaved();
  };
  if (editing && !readOnly) {
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
      {!readOnly && <button onClick={() => { setVal(value); setEditing(true); }} title="Edit retention %"
        style={{ border: '1px solid #c7d2fe', background: '#eef2ff', color: '#4338ca', borderRadius: 4, padding: '0 6px', cursor: 'pointer', fontSize: 11 }}>✎</button>}
    </span>
  );
}
