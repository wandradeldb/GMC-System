import { apiFetch } from '../apiFetch.js';
import { useState, useEffect } from 'react';

function fmt(n, d=2) {
  if (n == null || isNaN(n)) return 'â€”';
  return new Intl.NumberFormat('en-IE', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
}

export default function AssessmentForm({ projectId, subcontractId, subcontract, boqItems, period, onBack }) {
  const [data,    setData]    = useState(null);
  const [items,   setItems]   = useState([]);
  const [header,  setHeader]  = useState({});
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [showInv, setShowInv] = useState(false);
  const [invForm, setInvForm] = useState({ invoice_number:'', invoice_date:'', gross_amount:'', retention_amount:'', notes:'' });

  const fmtPeriod = p => {
    const [y, m] = p.split('-');
    return new Date(parseInt(y), parseInt(m)-1, 1).toLocaleDateString('en-IE', { month:'long', year:'numeric' });
  };

  useEffect(() => {
    apiFetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/applications/${period}`)
      .then(r => r.json())
      .then(d => {
        setData(d);
        setHeader({ ...d.application });
        // Merge boqItems with existing assessment items
        const existing = Object.fromEntries((d.items || []).map(i => [i.sub_boq_item_id, i]));
        setItems(boqItems.map(b => ({
          sub_boq_item_id:  b.id,
          item_ref:         b.item_ref,
          description:      b.description,
          unit:             b.unit,
          qty_contracted:   b.qty,
          rate:             b.rate,
          section:          b.section,
          qty_complete_sub: existing[b.id]?.qty_complete_sub ?? 0,
          qty_complete_gmc: existing[b.id]?.qty_complete_gmc ?? 0,
          notes:            existing[b.id]?.notes ?? '',
        })));
      });
  }, [projectId, subcontractId, period, boqItems]);

  const setItem = (i, k, v) => setItems(rows => rows.map((r, j) => j === i ? { ...r, [k]: v } : r));

  const totalSub = items.reduce((s, i) => s + (parseFloat(i.qty_complete_sub)||0) * (i.rate||0), 0);
  const totalGmc = items.reduce((s, i) => s + (parseFloat(i.qty_complete_gmc)||0) * (i.rate||0), 0);
  const delta    = totalGmc - totalSub;

  const save = async (newStatus) => {
    setSaving(true);
    const body = {
      items: items.map(i => ({ sub_boq_item_id: i.sub_boq_item_id, qty_complete_sub: parseFloat(i.qty_complete_sub)||0, qty_complete_gmc: parseFloat(i.qty_complete_gmc)||0, notes: i.notes })),
      header: { ...header, status: newStatus || header.status },
    };
    const r = await apiFetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/applications/${period}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then(r => r.json());
    setHeader(r.application);
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const approve = async () => {
    const by = prompt('QS approved by (name):');
    if (!by) return;
    const r = await apiFetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/applications/${data.application.id}/approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approved_by: by }),
    }).then(r => r.json());
    setHeader(r);
  };

  const submitInvoice = async () => {
    await apiFetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/applications/${data.application.id}/invoices`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...invForm, gross_amount: parseFloat(invForm.gross_amount)||0, retention_amount: parseFloat(invForm.retention_amount)||0 }),
    });
    setShowInv(false);
    // Reload
    apiFetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/applications/${period}`)
      .then(r => r.json()).then(d => { setData(d); setHeader(d.application); });
  };

  if (!data) return <div className="state-box"><div className="icon">â³</div><p>Loadingâ€¦</p></div>;

  const app       = header;
  const isLocked  = ['invoiced','paid'].includes(app.status);
  const canApprove= app.status === 'assessed';
  const canInvoice= app.status === 'approved';

  // Group by section
  const sections = [...new Set(items.map(i => i.section || 'General'))];

  return (
    <div>
      <div className="detail-nav">
        <button className="btn-back" onClick={onBack}>â† {subcontract.ref}</button>
      </div>

      {/* Assessment header */}
      <div className="assessment-header">
        <div className="assessment-title">
          <span className="assessment-period">{fmtPeriod(period)}</span>
          <span className="assessment-num">Application #{app.application_number}</span>
          <span className="status-badge" style={{ background: { draft:'#fef9c3',assessed:'#dbeafe',approved:'#dcfce7',invoiced:'#ede9fe',paid:'#d1fae5' }[app.status], color:{ draft:'#92400e',assessed:'#1e40af',approved:'#166534',invoiced:'#7c3aed',paid:'#065f46' }[app.status] }}>
            {app.status}
          </span>
        </div>

        <div className="assessment-kpis">
          <div className="assess-kpi"><div className="kpi-label">Sub Claim</div><div className="kpi-value" style={{color:'#1e40af'}}>â‚¬{fmt(totalSub)}</div></div>
          <div className="assess-kpi"><div className="kpi-label">GMC Certified</div><div className="kpi-value" style={{color:'#166534'}}>â‚¬{fmt(totalGmc)}</div></div>
          <div className="assess-kpi"><div className="kpi-label">Delta</div>
            <div className="kpi-value" style={{color: delta < 0 ? '#dc2626' : '#166534'}}>{delta>=0?'+':''}{fmt(delta)}</div></div>
          <div className="assess-kpi"><div className="kpi-label">Net Payable</div><div className="kpi-value">â‚¬{fmt(app.net_payable)}</div></div>
        </div>

        <div className="assessment-actions">
          {!isLocked && (
            <>
              <button className="btn-save" onClick={() => save('assessed')} disabled={saving}>
                {saving ? 'Savingâ€¦' : saved ? 'âœ“ Saved' : 'Save & Mark Assessed'}
              </button>
              {canApprove && (
                <button className="btn-approve" onClick={approve}>âœ“ Approve</button>
              )}
            </>
          )}
          {canInvoice && (
            <button className="btn-primary" onClick={() => setShowInv(true)}>Record Invoice</button>
          )}
          {app.qs_approved_by && (
            <span className="approved-by">Approved by {app.qs_approved_by} Â· {app.qs_approved_date}</span>
          )}
        </div>
      </div>

      {/* Invoice form */}
      {showInv && (
        <div className="inline-form" style={{ marginBottom: 16 }}>
          <div className="modal-section-label">Record Invoice</div>
          <div className="section-grid">
            <div className="field"><label className="field-label">Invoice No.</label>
              <input value={invForm.invoice_number} onChange={e => setInvForm(f=>({...f,invoice_number:e.target.value}))} placeholder="INV-001" /></div>
            <div className="field"><label className="field-label">Invoice Date</label>
              <input type="date" value={invForm.invoice_date} onChange={e => setInvForm(f=>({...f,invoice_date:e.target.value}))} /></div>
            <div className="field"><label className="field-label">Gross Amount (â‚¬)</label>
              <input type="number" step="0.01" value={invForm.gross_amount} onChange={e => setInvForm(f=>({...f,gross_amount:e.target.value}))} /></div>
            <div className="field"><label className="field-label">Retention (â‚¬)</label>
              <input type="number" step="0.01" value={invForm.retention_amount} onChange={e => setInvForm(f=>({...f,retention_amount:e.target.value}))} /></div>
          </div>
          <div style={{ display:'flex', gap:8, marginTop:12 }}>
            <button className="btn-primary" onClick={submitInvoice}>Save Invoice</button>
            <button className="btn-ghost" onClick={() => setShowInv(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Invoices */}
      {data.invoices?.length > 0 && (
        <div className="inline-form" style={{ marginBottom:16 }}>
          <div className="modal-section-label">Invoices</div>
          <table className="boq-table">
            <thead><tr><th>Invoice No.</th><th>Date</th><th className="col-num">Gross (â‚¬)</th><th className="col-num">Retention (â‚¬)</th><th className="col-num">Net (â‚¬)</th><th>Sent Finance</th><th>Payment Run</th><th>Status</th></tr></thead>
            <tbody>
              {data.invoices.map(inv => (
                <tr key={inv.id}>
                  <td style={{fontFamily:'monospace',fontSize:12}}>{inv.invoice_number}</td>
                  <td>{inv.invoice_date}</td>
                  <td className="col-num">{fmt(inv.gross_amount)}</td>
                  <td className="col-num" style={{color:'#7c3aed'}}>{fmt(inv.retention_amount)}</td>
                  <td className="col-num" style={{fontWeight:700}}>{fmt(inv.net_amount)}</td>
                  <td style={{fontSize:12}}>{inv.sent_finance_date || 'â€”'}</td>
                  <td style={{fontSize:12}}>{inv.run_ref || 'â€”'}</td>
                  <td><span className="status-badge" style={{background:'#ede9fe',color:'#7c3aed'}}>{inv.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Assessment table */}
      <div className="das-tab-content" style={{ padding: 0 }}>
        {sections.map(sec => {
          const secItems = items.map((it, i) => ({...it, _idx:i})).filter(it => (it.section||'General') === sec);
          const secSub = secItems.reduce((s, i) => s + (parseFloat(i.qty_complete_sub)||0)*(i.rate||0), 0);
          const secGmc = secItems.reduce((s, i) => s + (parseFloat(i.qty_complete_gmc)||0)*(i.rate||0), 0);
          return (
            <div key={sec} className="schedule-block" style={{ padding: '0 20px 12px' }}>
              <div className="schedule-header">
                <span className="schedule-title">{sec}</span>
                <span className="schedule-total" style={{ fontSize:13 }}>
                  Sub: â‚¬{fmt(secSub)} Â· GMC: â‚¬{fmt(secGmc)}
                </span>
              </div>
              <table className="boq-table">
                <thead>
                  <tr>
                    <th className="col-ref">Ref</th>
                    <th>Description</th>
                    <th className="col-unit">Unit</th>
                    <th className="col-num">Contracted</th>
                    <th className="col-num" style={{background:'#eff6ff'}}>Sub Qty</th>
                    <th className="col-num" style={{background:'#eff6ff'}}>Sub Value (â‚¬)</th>
                    <th className="col-num" style={{background:'#f0fdf4'}}>GMC Qty</th>
                    <th className="col-num" style={{background:'#f0fdf4'}}>GMC Value (â‚¬)</th>
                    <th className="col-num">Rate (â‚¬)</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {secItems.map(row => {
                    const vSub = (parseFloat(row.qty_complete_sub)||0) * (row.rate||0);
                    const vGmc = (parseFloat(row.qty_complete_gmc)||0) * (row.rate||0);
                    return (
                      <tr key={row._idx}>
                        <td className="col-ref">{row.item_ref}</td>
                        <td>{row.description}</td>
                        <td className="col-unit">{row.unit}</td>
                        <td className="col-num" style={{color:'#6b7280'}}>{fmt(row.qty_contracted, 3)}</td>
                        <td className="col-num" style={{background:'#f8faff'}}>
                          <input type="number" step="any" min="0" value={row.qty_complete_sub}
                            onChange={e => setItem(row._idx,'qty_complete_sub',e.target.value)}
                            disabled={isLocked} className="assess-input" />
                        </td>
                        <td className="col-num" style={{background:'#f8faff', color:'#1e40af'}}>{fmt(vSub)}</td>
                        <td className="col-num" style={{background:'#f0fff4'}}>
                          <input type="number" step="any" min="0" value={row.qty_complete_gmc}
                            onChange={e => setItem(row._idx,'qty_complete_gmc',e.target.value)}
                            disabled={isLocked} className="assess-input assess-input-gmc" />
                        </td>
                        <td className="col-num" style={{background:'#f0fff4', color:'#166534', fontWeight:600}}>{fmt(vGmc)}</td>
                        <td className="col-num" style={{color:'#6b7280'}}>{fmt(row.rate)}</td>
                        <td>
                          <input value={row.notes} onChange={e => setItem(row._idx,'notes',e.target.value)}
                            disabled={isLocked} style={{width:'100%',fontSize:12,border:'1px solid #e5e7eb',borderRadius:4,padding:'3px 6px'}} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
