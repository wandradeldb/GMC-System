import { apiFetch } from '../apiFetch.js';
import { useState, useEffect, useCallback, useRef } from 'react';
import PaymentCalendar from './PaymentCalendar.jsx';

const STATUS_STEPS = ['draft','assessed','approved','invoiced','paid'];
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

export default function SubcontractDetail({ projectId, subcontractId, onBack }) {
  const [data,       setData]       = useState(null);
  const [tab,        setTab]        = useState('overview');
  const [selectedAppId, setSelectedAppId] = useState(null);
  const [appDetail,  setAppDetail]  = useState(null);
  const [boqCertified, setBoqCertified] = useState([]);

  const load = useCallback(() => {
    apiFetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}`)
      .then(r => r.json()).then(setData);
    apiFetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/boq`)
      .then(r => r.json()).then(setBoqCertified).catch(() => {});
  }, [projectId, subcontractId]);

  useEffect(() => { load(); }, [load]);

  const openApp = async (appId) => {
    const res = await apiFetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/applications/${appId}`);
    const json = await res.json();
    setAppDetail(json);
    setSelectedAppId(appId);
  };

  if (!data) return <div className="state-box"><div className="icon">⏳</div><p>Loading…</p></div>;

  const { subcontract: sc, boq_items, applications, compensation_events } = data;

  const totalCertified = applications.filter(a => a.status !== 'draft')
                                     .reduce((s, a) => s + (a.value_gmc || 0), 0);
  const totalPaid      = applications.filter(a => a.status === 'paid')
                                     .reduce((s, a) => s + (a.net_payable || 0), 0);
  const retention      = Math.round(totalCertified * (sc.retention_pct / 100) * 100) / 100;

  if (selectedAppId !== null && appDetail) return (
    <AppDetailView
      detail={appDetail}
      sc={sc}
      onBack={() => { setSelectedAppId(null); setAppDetail(null); }}
    />
  );

  return (
    <div>
      {/* Back + Header */}
      <div className="detail-nav">
        <button className="btn-back" onClick={onBack}>← Subcontracts</button>
      </div>

      <div className="sc-detail-header">
        <div>
          <div className="sc-detail-ref">{sc.ref}</div>
          <div className="sc-detail-name">{sc.subcontractor_name}</div>
          <div className="sc-detail-desc">{sc.description}</div>
          <div className="sc-detail-meta" style={{ display:'flex', alignItems:'center', gap:6 }}>
            {fmtDate(sc.start_date)} – {fmtDate(sc.end_date)} ·
            <RetentionField projectId={projectId} subcontractId={subcontractId} value={sc.retention_pct} onSaved={load} />
          </div>
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
      <div className="das-tabs" style={{ marginTop: 16 }}>
        {[
          { id:'overview',    label:`Applications (${applications.length})` },
          { id:'boq',         label:`Sub BOQ (${boq_items.length})` },
          { id:'ces',         label:`Variations (${compensation_events.length})` },
          { id:'payments',    label:'Tracker Invoices' },
        ].map(t => (
          <button key={t.id} className={`das-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="das-tab-content">
        {tab === 'overview' && (
          <ApplicationsTab
            applications={applications}
            onOpen={openApp}
            retention_pct={sc.retention_pct}
          />
        )}
        {tab === 'boq' && <BOQTab boqItems={boq_items} boqCertified={boqCertified} projectId={projectId} subcontractId={subcontractId} onRefresh={load} />}
        {tab === 'ces'  && <CETab ces={compensation_events} subcontractId={sc.id} projectId={projectId} onRefresh={load} />}
        {tab === 'payments' && <PaymentCalendar projectId={projectId} />}
      </div>
    </div>
  );
}

/* ── Applications Tab ───────────────────────────────────────────────────── */
function ApplicationsTab({ applications, onOpen, retention_pct }) {
  const fmtPeriod = p => {
    if (!p) return '—';
    const [y, m] = p.split('-');
    return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString('en-IE', { month: 'long', year: 'numeric' });
  };

  return (
    <div>
      <div className="section-toolbar">
        <span className="section-stat">{applications.length} assessments</span>
      </div>

      {applications.length === 0 ? (
        <div className="empty-hint">No assessments yet.</div>
      ) : (
        <table className="boq-table">
          <thead>
            <tr>
              <th>No.</th><th>Period</th>
              <th style={{textAlign:'right'}}>Sub Claim (€)</th>
              <th style={{textAlign:'right'}}>GMC Assessed (€)</th>
              <th style={{textAlign:'right'}}>Cumulative (€)</th>
              <th style={{textAlign:'right'}}>Retention (€)</th>
              <th style={{textAlign:'right'}}>Net Payable (€)</th>
              <th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {applications.map(a => {
              const retHeld = Math.round((a.cumulative_gmc || 0) * (retention_pct / 100) * 100) / 100;
              return (
                <tr key={a.id}>
                  <td style={{ fontWeight: 700 }}>#{a.application_number}</td>
                  <td>{fmtPeriod(a.period)}</td>
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
                  <td>
                    <button className="btn-link" onClick={() => onOpen(a.id)}>Ver detalhe →</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ── BOQ Tab ────────────────────────────────────────────────────────────── */
function BOQTab({ boqItems, boqCertified, projectId, subcontractId, onRefresh }) {
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
    <div>
      <div className="section-toolbar">
        <span className="section-stat">
          {boqItems.length} items · Contract: €{fmt(totalContract)} · Certified: €{fmt(totalCertified)} · Remaining: €{fmt(totalRemaining)}
        </span>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          {importMsg && <span style={{ fontSize:12, color: importMsg.startsWith('✓') ? '#166534' : '#dc2626' }}>{importMsg}</span>}
          <label style={{ padding:'5px 12px', borderRadius:6, border:'1px solid #bfdbfe', background:'#eff6ff',
            cursor:'pointer', fontSize:12, color:'#1e40af', fontWeight:600 }}>
            {importing ? 'Importing…' : '⬆ Import BOQ (Excel)'}
            <input type="file" accept=".xlsx,.xls,.csv" style={{ display:'none' }} onChange={handleFile} disabled={importing} />
          </label>
        </div>
      </div>
      {boqItems.length === 0 ? (
        <div className="empty-hint">No sub BOQ items defined.</div>
      ) : (
        <div style={{ overflowX:'auto' }}>
          <table className="boq-table">
            <thead>
              <tr>
                <th>Ref</th><th>Description</th>
                <th>Unit</th>
                <th style={{textAlign:'right'}}>Qty</th>
                <th style={{textAlign:'right'}}>Rate (€)</th>
                <th style={{textAlign:'right'}}>Contract (€)</th>
                <th style={{textAlign:'right', color:'#1e40af'}}>% Cert.</th>
                <th style={{textAlign:'right', color:'#166534'}}>Certified (€)</th>
                <th style={{textAlign:'right', color:'#dc2626'}}>Remaining (€)</th>
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
                    <td style={{fontSize:12, color:'#6b7280'}}>{i.unit}</td>
                    <td style={{textAlign:'right', fontSize:12}}>{fmt(i.qty, 3)}</td>
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
              <tr style={{background:'#f1f5f9', fontWeight:700}}>
                <td colSpan={5} style={{textAlign:'right', paddingRight:8}}>TOTAL</td>
                <td style={{textAlign:'right'}}>€{fmt(totalContract)}</td>
                <td></td>
                <td style={{textAlign:'right', color:'#166534'}}>€{fmt(totalCertified)}</td>
                <td style={{textAlign:'right', color:'#dc2626'}}>€{fmt(totalRemaining || totalContract - totalCertified)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── App Detail View (read-only) ─────────────────────────────────────────── */
function AppDetailView({ detail, sc, onBack }) {
  const app   = detail.application || detail.app;
  const items = detail.items || [];
  const ss    = STATUS_BG[app.status] ? { bg: STATUS_BG[app.status], color: STATUS_COLOR[app.status] } : { bg:'#f3f4f6', color:'#6b7280' };
  const retention_pct = sc.retention_pct || 0;
  const retHeld = Math.round((app.cumulative_gmc || 0) * (retention_pct / 100) * 100) / 100;

  return (
    <div>
      <div className="detail-nav">
        <button className="btn-back" onClick={onBack}>← Back to list</button>
      </div>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:16, flexWrap:'wrap' }}>
        <div>
          <div style={{ fontSize:18, fontWeight:700, color:'#1a1a2e' }}>
            App #{app.application_number} — {app.period}
          </div>
          {app.notes && <div style={{ fontSize:12, color:'#9ca3af', marginTop:2 }}>{app.notes}</div>}
        </div>
        <span style={{ background:ss.bg, color:ss.color, borderRadius:12, padding:'3px 12px', fontSize:12, fontWeight:600 }}>
          {app.status}
        </span>
        <div style={{ marginLeft:'auto', display:'flex', gap:20 }}>
          {[
            { label:'Sub Claimed', val:`€${fmt(app.value_sub)}`, color:'#92400e' },
            { label:'GMC Assessed', val:`€${fmt(app.value_gmc)}`, color:'#166534' },
            { label:'Cumulative', val:`€${fmt(app.cumulative_gmc)}`, color:'#1e40af' },
            { label:'Retention', val:`€${fmt(retHeld)}`, color:'#7c3aed' },
            { label:'Net Payable', val:`€${fmt(app.net_payable)}`, color:'#1a1a2e' },
          ].map(k => (
            <div key={k.label} style={{ textAlign:'right' }}>
              <div style={{ fontSize:10, color:'#9ca3af', fontWeight:600, textTransform:'uppercase' }}>{k.label}</div>
              <div style={{ fontSize:16, fontWeight:700, color:k.color }}>{k.val}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Item table */}
      <div style={{ overflowX:'auto' }}>
        <table className="boq-table" style={{ minWidth:900 }}>
          <thead>
            <tr>
              <th>Ref</th>
              <th>Description</th>
              <th>Unit</th>
              <th style={{textAlign:'right'}}>Contract (€)</th>
              <th style={{textAlign:'right', color:'#6b7280'}}>Prev %</th>
              <th style={{textAlign:'right', color:'#92400e'}}>Sub %</th>
              <th style={{textAlign:'right', color:'#166534'}}>GMC %</th>
              <th style={{textAlign:'right', color:'#166534'}}>Esta App (€)</th>
              <th style={{textAlign:'right', color:'#1e40af'}}>Cumul. (€)</th>
              <th style={{textAlign:'right', color:'#dc2626'}}>Remaining (€)</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => {
              const cv       = it.contract_value || Math.round((it.qty_contracted || 0) * (it.rate || 0) * 100) / 100;
              const pctCum   = (it.pct_prev || 0) + (it.pct_complete_gmc || 0);
              const cumVal   = Math.round(pctCum / 100 * cv * 100) / 100;
              const remVal   = Math.round((cv - cumVal) * 100) / 100;
              const thisApp  = Math.round((it.pct_complete_gmc || 0) / 100 * cv * 100) / 100;
              return (
                <tr key={it.id} style={{ background: idx%2===0 ? '#f8fafc' : '#fff' }}>
                  <td style={{fontFamily:'monospace', fontSize:11, whiteSpace:'nowrap'}}>{it.item_ref}</td>
                  <td style={{maxWidth:280, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:12}} title={it.description}>{it.description}</td>
                  <td style={{fontSize:12, color:'#6b7280'}}>{it.unit}</td>
                  <td style={{textAlign:'right', fontSize:12}}>€{fmt(cv)}</td>
                  <td style={{textAlign:'right', color:'#9ca3af', fontSize:12}}>{fmt(it.pct_prev, 1)}%</td>
                  <td style={{textAlign:'right', color:'#92400e', fontSize:12}}>{fmt(it.pct_complete_sub, 1)}%</td>
                  <td style={{textAlign:'right', color:'#166534', fontWeight:600, fontSize:12}}>{fmt(it.pct_complete_gmc, 1)}%</td>
                  <td style={{textAlign:'right', fontWeight:600, color: thisApp > 0 ? '#166534' : '#9ca3af', fontSize:12}}>
                    {thisApp > 0 ? `€${fmt(thisApp)}` : '—'}
                  </td>
                  <td style={{textAlign:'right', color:'#1e40af', fontSize:12}}>€{fmt(cumVal)}</td>
                  <td style={{textAlign:'right', color: remVal > 0.01 ? '#dc2626' : '#16a34a', fontSize:12}}>€{fmt(remVal)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{background:'#f1f5f9', fontWeight:700}}>
              <td colSpan={7} style={{textAlign:'right', paddingRight:8}}>TOTAL</td>
              <td style={{textAlign:'right', color:'#166534'}}>€{fmt(app.value_gmc)}</td>
              <td style={{textAlign:'right', color:'#1e40af'}}>€{fmt(app.cumulative_gmc)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/* ── Compensation Events Tab ─────────────────────────────────────────────── */
function CETab({ ces, subcontractId, projectId, onRefresh }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ce_ref:'', description:'', sub_value:'', gmc_value:'', status:'submitted', notes:'' });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    // extract pid from URL — passed in as prop
    await apiFetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/ces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, sub_value: parseFloat(form.sub_value)||0, gmc_value: parseFloat(form.gmc_value)||0 }),
    });
    setSaving(false);
    setShowForm(false);
    setForm({ ce_ref:'', description:'', sub_value:'', gmc_value:'', status:'submitted', notes:'' });
    onRefresh();
  };

  const CE_STATUS_COLOR = { submitted:'#92400e', assessed:'#1e40af', agreed:'#166534', rejected:'#991b1b' };
  const CE_STATUS_BG    = { submitted:'#fef9c3', assessed:'#dbeafe', agreed:'#dcfce7', rejected:'#fee2e2' };

  return (
    <div>
      <div className="section-toolbar">
        <span className="section-stat">{ces.length} compensation events · GMC agreed: €{fmt(ces.filter(c=>c.status==='agreed').reduce((s,c)=>s+c.gmc_value,0))}</span>
        <button className="btn-primary" onClick={() => setShowForm(s => !s)}>+ New CE</button>
      </div>

      {showForm && (
        <div className="inline-form">
          <div className="section-grid">
            <div className="field"><label className="field-label">CE Ref *</label>
              <input value={form.ce_ref} onChange={e => setForm(f=>({...f,ce_ref:e.target.value}))} placeholder="CE-001" /></div>
            <div className="field"><label className="field-label">Status</label>
              <select value={form.status} onChange={e => setForm(f=>({...f,status:e.target.value}))}>
                {['submitted','assessed','agreed','rejected'].map(s=><option key={s}>{s}</option>)}
              </select></div>
            <div className="field span2"><label className="field-label">Description *</label>
              <input value={form.description} onChange={e => setForm(f=>({...f,description:e.target.value}))} placeholder="Describe the variation / extra work…" /></div>
            <div className="field"><label className="field-label">Sub Claim (€)</label>
              <input type="number" step="0.01" value={form.sub_value} onChange={e => setForm(f=>({...f,sub_value:e.target.value}))} /></div>
            <div className="field"><label className="field-label">GMC Assessed (€)</label>
              <input type="number" step="0.01" value={form.gmc_value} onChange={e => setForm(f=>({...f,gmc_value:e.target.value}))} /></div>
          </div>
          <div style={{ display:'flex', gap:8, marginTop:12 }}>
            <button className="btn-primary" onClick={submit} disabled={saving}>{saving?'Saving…':'Save CE'}</button>
            <button className="btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {ces.length === 0 && !showForm ? (
        <div className="empty-hint">No compensation events raised.</div>
      ) : (
        <table className="boq-table" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Ref</th><th>Description</th>
              <th className="col-num">Sub Claim (€)</th>
              <th className="col-num">GMC Value (€)</th>
              <th className="col-num">Delta (€)</th>
              <th>Status</th><th>Approved</th>
            </tr>
          </thead>
          <tbody>
            {ces.map(ce => (
              <tr key={ce.id}>
                <td style={{ fontFamily:'monospace', fontSize:12 }}>{ce.ce_ref}</td>
                <td>{ce.description}</td>
                <td className="col-num">{fmt(ce.sub_value)}</td>
                <td className="col-num" style={{ fontWeight: 600 }}>{fmt(ce.gmc_value)}</td>
                <td className="col-num" style={{ color: ce.gmc_value >= ce.sub_value ? '#166534' : '#dc2626' }}>
                  {ce.gmc_value - ce.sub_value >= 0 ? '+' : ''}{fmt(ce.gmc_value - ce.sub_value)}
                </td>
                <td><span className="status-badge" style={{ background: CE_STATUS_BG[ce.status], color: CE_STATUS_COLOR[ce.status] }}>{ce.status}</span></td>
                <td style={{ fontSize:12 }}>{ce.approved_date ? new Date(ce.approved_date+'T12:00:00').toLocaleDateString('en-IE',{day:'numeric',month:'short',year:'numeric'}) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
