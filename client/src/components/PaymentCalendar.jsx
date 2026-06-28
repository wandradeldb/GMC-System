import { apiFetch } from '../apiFetch.js';
import { useState, useEffect } from 'react';

function fmt(n) {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-IE', { minimumFractionDigits: 2 }).format(n);
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T12:00:00').toLocaleDateString('en-IE', { day:'numeric', month:'short', year:'numeric' });
}

const RUN_STATUS_BG    = { open:'#fef9c3', processing:'#dbeafe', paid:'#dcfce7', cancelled:'#fee2e2' };
const RUN_STATUS_COLOR = { open:'#92400e', processing:'#1e40af', paid:'#166534', cancelled:'#991b1b' };

export default function PaymentCalendar({ projectId }) {
  const [runs,    setRuns]    = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [form,    setForm]    = useState({ run_ref:'', run_date:'', description:'' });
  const [saving,  setSaving]  = useState(false);

  const load = () => apiFetch(`/api/v1/projects/${projectId}/payment-runs`).then(r => r.json()).then(setRuns);
  useEffect(() => { load(); }, [projectId]);

  const createRun = async () => {
    setSaving(true);
    await apiFetch(`/api/v1/projects/${projectId}/payment-runs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
    });
    setSaving(false); setShowNew(false); setForm({ run_ref:'', run_date:'', description:'' }); load();
  };

  const markPaid = async (runId) => {
    if (!confirm('Mark this payment run as PAID? All linked invoices will be updated.')) return;
    await apiFetch(`/api/v1/projects/${projectId}/payment-runs/${runId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status:'paid' }),
    });
    load();
  };

  const totalScheduled = runs.filter(r => r.status !== 'cancelled').reduce((s, r) => s + (r.total_net || 0), 0);
  const totalPaid      = runs.filter(r => r.status === 'paid').reduce((s, r) => s + (r.total_net || 0), 0);

  return (
    <div>
      <div className="section-toolbar">
        <div>
          <span className="section-stat">{runs.length} payment runs</span>
          <span style={{ margin:'0 12px', color:'#d1d5db' }}>|</span>
          <span className="section-stat">Scheduled: €{fmt(totalScheduled)}</span>
          <span style={{ margin:'0 12px', color:'#d1d5db' }}>|</span>
          <span className="section-stat" style={{ color:'#166534', fontWeight:600 }}>Paid: €{fmt(totalPaid)}</span>
        </div>
        <button className="btn-primary" onClick={() => setShowNew(s => !s)}>+ New Payment Run</button>
      </div>

      {showNew && (
        <div className="inline-form" style={{ marginBottom: 16 }}>
          <div className="section-grid">
            <div className="field"><label className="field-label">Run Ref *</label>
              <input value={form.run_ref} onChange={e => setForm(f=>({...f,run_ref:e.target.value}))} placeholder="PR-2026-06" /></div>
            <div className="field"><label className="field-label">Payment Date *</label>
              <input type="date" value={form.run_date} onChange={e => setForm(f=>({...f,run_date:e.target.value}))} /></div>
            <div className="field span2"><label className="field-label">Description</label>
              <input value={form.description} onChange={e => setForm(f=>({...f,description:e.target.value}))} placeholder="June 2026 subcontractor payments" /></div>
          </div>
          <div style={{ display:'flex', gap:8, marginTop:12 }}>
            <button className="btn-primary" onClick={createRun} disabled={saving}>{saving?'Saving…':'Create Run'}</button>
            <button className="btn-ghost" onClick={() => setShowNew(false)}>Cancel</button>
          </div>
        </div>
      )}

      {runs.length === 0 && !showNew ? (
        <div className="empty-hint">No payment runs defined. Create a payment calendar for the project.</div>
      ) : (
        <div className="payment-timeline">
          {runs.map(run => (
            <div key={run.id} className={`payment-run-row ${run.status}`}>
              <div className="pr-date">
                <div className="pr-day">{run.run_date ? new Date(run.run_date+'T12:00:00').toLocaleDateString('en-IE',{day:'2-digit',month:'short'}) : '—'}</div>
                <div className="pr-year">{run.run_date ? new Date(run.run_date+'T12:00:00').getFullYear() : ''}</div>
              </div>
              <div className="pr-dot" />
              <div className="pr-card">
                <div className="pr-card-header">
                  <span className="pr-ref">{run.run_ref}</span>
                  <span className="status-badge" style={{ background: RUN_STATUS_BG[run.status], color: RUN_STATUS_COLOR[run.status] }}>{run.status}</span>
                  {run.description && <span className="pr-desc">{run.description}</span>}
                </div>
                <div className="pr-card-body">
                  <span>{run.invoice_count} invoice{run.invoice_count !== 1 ? 's' : ''}</span>
                  <span className="pr-amount">€{fmt(run.total_net)}</span>
                  {run.status === 'open' && (
                    <button className="btn-link" style={{ marginLeft:'auto' }} onClick={() => markPaid(run.id)}>
                      Mark Paid →
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
