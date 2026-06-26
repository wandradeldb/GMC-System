import { useState, useEffect, useCallback } from 'react';
import AssessmentForm from './AssessmentForm.jsx';
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
  const [data,     setData]     = useState(null);
  const [tab,      setTab]      = useState('overview');
  const [appPeriod, setAppPeriod] = useState(null); // YYYY-MM being viewed

  const load = useCallback(() => {
    fetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}`)
      .then(r => r.json()).then(setData);
  }, [projectId, subcontractId]);

  useEffect(() => { load(); }, [load]);

  if (!data) return <div className="state-box"><div className="icon">⏳</div><p>Loading…</p></div>;

  const { subcontract: sc, boq_items, applications, compensation_events } = data;

  const currentPeriod = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  };

  const totalCertified = applications.filter(a => a.status !== 'draft')
                                     .reduce((s, a) => s + (a.value_gmc || 0), 0);
  const totalPaid      = applications.filter(a => a.status === 'paid')
                                     .reduce((s, a) => s + (a.net_payable || 0), 0);
  const retention      = Math.round(totalCertified * (sc.retention_pct / 100) * 100) / 100;

  if (appPeriod !== null) return (
    <AssessmentForm
      projectId={projectId}
      subcontractId={subcontractId}
      subcontract={sc}
      boqItems={boq_items}
      period={appPeriod}
      onBack={() => { setAppPeriod(null); load(); }}
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
          <div className="sc-detail-meta">
            {fmtDate(sc.start_date)} – {fmtDate(sc.end_date)} · Retention {sc.retention_pct}%
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
          { id:'ces',         label:`CEs (${compensation_events.length})` },
          { id:'payments',    label:'Payment Calendar' },
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
            onOpen={period => setAppPeriod(period)}
            onNewAssessment={() => setAppPeriod(currentPeriod())}
            retention_pct={sc.retention_pct}
          />
        )}
        {tab === 'boq' && <BOQTab boqItems={boq_items} />}
        {tab === 'ces'  && <CETab ces={compensation_events} subcontractId={sc.id} projectId={projectId} onRefresh={load} />}
        {tab === 'payments' && <PaymentCalendar projectId={projectId} />}
      </div>
    </div>
  );
}

/* ── Applications Tab ───────────────────────────────────────────────────── */
function ApplicationsTab({ applications, onOpen, onNewAssessment, retention_pct }) {
  const fmtPeriod = p => {
    const [y, m] = p.split('-');
    return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString('en-IE', { month: 'long', year: 'numeric' });
  };

  return (
    <div>
      <div className="section-toolbar">
        <span className="section-stat">{applications.length} assessments</span>
        <button className="btn-primary" onClick={onNewAssessment}>+ New Assessment</button>
      </div>

      {applications.length === 0 ? (
        <div className="empty-hint">No assessments yet. Click "New Assessment" to start the monthly cycle.</div>
      ) : (
        <table className="boq-table">
          <thead>
            <tr>
              <th>No.</th><th>Period</th>
              <th className="col-num">Sub Claim (€)</th>
              <th className="col-num">GMC Assessed (€)</th>
              <th className="col-num">Delta (€)</th>
              <th className="col-num">Retention (€)</th>
              <th className="col-num">Net Payable (€)</th>
              <th>Approved By</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {applications.map(a => {
              const retHeld = Math.round((a.cumulative_gmc || 0) * (retention_pct / 100) * 100) / 100;
              return (
                <tr key={a.id}>
                  <td style={{ fontWeight: 700 }}>#{a.application_number}</td>
                  <td>{fmtPeriod(a.period)}</td>
                  <td className="col-num">{fmt(a.value_sub)}</td>
                  <td className="col-num" style={{ fontWeight: 600 }}>{fmt(a.value_gmc)}</td>
                  <td className="col-num" style={{ color: (a.delta || 0) < 0 ? '#dc2626' : '#166534' }}>
                    {(a.delta || 0) >= 0 ? '+' : ''}{fmt(a.delta)}
                  </td>
                  <td className="col-num" style={{ color: '#7c3aed' }}>{fmt(retHeld)}</td>
                  <td className="col-num" style={{ fontWeight: 700 }}>{fmt(a.net_payable)}</td>
                  <td style={{ fontSize: 12 }}>{a.qs_approved_by || '—'}</td>
                  <td>
                    <span className="status-badge" style={{ background: STATUS_BG[a.status], color: STATUS_COLOR[a.status] }}>
                      {a.status}
                    </span>
                  </td>
                  <td>
                    <button className="btn-link" onClick={() => onOpen(a.period)}>Open →</button>
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
function BOQTab({ boqItems }) {
  const total = boqItems.reduce((s, i) => s + (i.qty || 0) * (i.rate || 0), 0);
  return (
    <div>
      <div className="section-toolbar">
        <span className="section-stat">{boqItems.length} items · Sub total: €{fmt(total)}</span>
      </div>
      {boqItems.length === 0 ? (
        <div className="empty-hint">No sub BOQ items defined. Add items in the assessment to build the scope.</div>
      ) : (
        <table className="boq-table">
          <thead>
            <tr>
              <th className="col-ref">Ref</th><th>Description</th>
              <th className="col-unit">Unit</th>
              <th className="col-num">Qty</th>
              <th className="col-num">Rate (€)</th>
              <th className="col-num">Sub Total (€)</th>
              <th>Contract Ref</th>
            </tr>
          </thead>
          <tbody>
            {boqItems.map(i => (
              <tr key={i.id}>
                <td className="col-ref">{i.item_ref}</td>
                <td>{i.description}</td>
                <td className="col-unit">{i.unit}</td>
                <td className="col-num">{fmt(i.qty, 3)}</td>
                <td className="col-num">{fmt(i.rate)}</td>
                <td className="col-num" style={{ fontWeight: 600 }}>{fmt(i.qty * i.rate)}</td>
                <td style={{ fontSize: 12, color: '#6b7280' }}>{i.contract_ref || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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
    await fetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/ces`, {
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
