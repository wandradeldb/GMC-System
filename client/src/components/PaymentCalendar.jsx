import { apiFetch } from '../apiFetch.js';
import { useState, useEffect, useCallback } from 'react';

function fmt(n, d = 2) {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-IE', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T12:00:00').toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric' });
}

const INV_STATUS_BG    = { received: '#fef9c3', sent_to_finance: '#dbeafe', scheduled: '#e0e7ff', paid: '#dcfce7', disputed: '#fee2e2' };
const INV_STATUS_COLOR = { received: '#92400e', sent_to_finance: '#1e40af', scheduled: '#4338ca', paid: '#166534', disputed: '#991b1b' };

// "Tracker Invoices" tab -- records an invoice directly against an approved application (Gross
// Amount pre-filled from that application's certified value), rather than the old "Payment Run"
// batching flow. See AssessmentForm.jsx for the original per-application "Record Invoice" modal,
// which this doesn't replace -- it's a second entry point into the same sub_invoice table, useful
// when you want to record several subs' invoices without opening each application individually.
export default function PaymentCalendar({ projectId, subcontractId, applications = [], retentionPct = 5, onRefresh }) {
  const [invoices, setInvoices] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [showNew,  setShowNew]  = useState(false);
  const [form,     setForm]     = useState({ application_id: '', invoice_number: '', gross_amount: '', retention_amount: '', submitted_to_account: '', comment: '' });
  const [saving,   setSaving]   = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/invoices`)
      .then(r => r.json()).then(rows => { setInvoices(rows); setLoading(false); }).catch(() => setLoading(false));
  }, [projectId, subcontractId]);

  useEffect(() => { load(); }, [load]);

  // Applications already invoiced drop out of the picker -- the backend only allows one invoice
  // per approved application (its status flips to 'invoiced' on creation).
  const invoicedAppIds = new Set(invoices.map(i => i.sub_application_id));
  const eligibleApps = applications.filter(a => a.status === 'approved' && !invoicedAppIds.has(a.id));

  const pickApp = (appIdStr) => {
    const app = applications.find(a => a.id === Number(appIdStr));
    const gross     = app ? (app.value_gmc || 0) : '';
    const retention = app ? Math.round((app.value_gmc || 0) * retentionPct / 100 * 100) / 100 : '';
    setForm(f => ({ ...f, application_id: appIdStr, gross_amount: gross, retention_amount: retention }));
  };

  const submit = async () => {
    if (!form.application_id || !form.invoice_number) return;
    setSaving(true);
    await apiFetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/applications/${form.application_id}/invoices`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invoice_number: form.invoice_number,
        gross_amount: parseFloat(form.gross_amount) || 0,
        retention_amount: parseFloat(form.retention_amount) || 0,
        sent_finance_date: form.submitted_to_account || null,
        notes: form.comment || null,
      }),
    });
    setSaving(false);
    setShowNew(false);
    setForm({ application_id: '', invoice_number: '', gross_amount: '', retention_amount: '', submitted_to_account: '', comment: '' });
    load();
    onRefresh && onRefresh();
  };

  const totalGross = invoices.reduce((s, i) => s + (i.gross_amount || 0), 0);
  const totalNet   = invoices.reduce((s, i) => s + (i.net_amount   || 0), 0);

  if (loading) return <div className="state-box"><div className="icon">⏳</div><p>Loading invoices…</p></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="section-toolbar">
        <span className="section-stat">
          {invoices.length} invoice{invoices.length !== 1 ? 's' : ''} · Gross: €{fmt(totalGross)} · Net: €{fmt(totalNet)}
        </span>
        <button className="btn-primary" onClick={() => setShowNew(s => !s)} disabled={eligibleApps.length === 0}>
          + New Invoice
        </button>
      </div>

      {eligibleApps.length === 0 && !showNew && (
        <div className="empty-hint">No approved applications ready to invoice.</div>
      )}

      {showNew && (
        <div className="inline-form" style={{ marginBottom: 16 }}>
          <div className="modal-section-label">New invoice</div>
          <div className="section-grid">
            <div className="field span2"><label className="field-label">Application *</label>
              <select value={form.application_id} onChange={e => pickApp(e.target.value)}>
                <option value="">Select…</option>
                {eligibleApps.map(a => (
                  <option key={a.id} value={a.id}>
                    Application #{a.application_number} — WE {fmtDate(a.week_ending)} — €{fmt(a.value_gmc, 2)} certified
                  </option>
                ))}
              </select>
            </div>
            <div className="field"><label className="field-label">Gross Amount (€)</label>
              <input type="number" step="0.01" value={form.gross_amount} onChange={e => setForm(f => ({ ...f, gross_amount: e.target.value }))} /></div>
            <div className="field"><label className="field-label">Retention Amount (€)</label>
              <input type="number" step="0.01" value={form.retention_amount} onChange={e => setForm(f => ({ ...f, retention_amount: e.target.value }))} /></div>
            <div className="field"><label className="field-label">Invoice Number *</label>
              <input value={form.invoice_number} onChange={e => setForm(f => ({ ...f, invoice_number: e.target.value }))} placeholder="INV-001" /></div>
            <div className="field"><label className="field-label">Submitted to Account</label>
              <input type="date" value={form.submitted_to_account} onChange={e => setForm(f => ({ ...f, submitted_to_account: e.target.value }))} /></div>
            <div className="field span2"><label className="field-label">Comment</label>
              <input value={form.comment} onChange={e => setForm(f => ({ ...f, comment: e.target.value }))} placeholder="Optional note…" /></div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn-primary" onClick={submit} disabled={saving || !form.application_id || !form.invoice_number}>
              {saving ? 'Saving…' : 'Save Invoice'}
            </button>
            <button className="btn-ghost" onClick={() => setShowNew(false)}>Cancel</button>
          </div>
        </div>
      )}

      {invoices.length === 0 ? (
        !showNew && eligibleApps.length > 0 && <div className="empty-hint">No invoices recorded yet.</div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <table className="boq-table">
            <thead>
              <tr>
                <th style={{ position: 'sticky', top: 0, background: '#f9fafb', zIndex: 2 }}>Invoice #</th>
                <th style={{ position: 'sticky', top: 0, background: '#f9fafb', zIndex: 2 }}>Application</th>
                <th className="col-num" style={{ position: 'sticky', top: 0, background: '#f9fafb', zIndex: 2 }}>Gross (€)</th>
                <th className="col-num" style={{ position: 'sticky', top: 0, background: '#f9fafb', zIndex: 2 }}>Retention (€)</th>
                <th className="col-num" style={{ position: 'sticky', top: 0, background: '#f9fafb', zIndex: 2 }}>Net (€)</th>
                <th style={{ position: 'sticky', top: 0, background: '#f9fafb', zIndex: 2 }}>Submitted to Account</th>
                <th style={{ position: 'sticky', top: 0, background: '#f9fafb', zIndex: 2 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv, idx) => (
                <tr key={inv.id} style={{ background: idx % 2 === 0 ? '#f8fafc' : '#fff' }}>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{inv.invoice_number}</td>
                  <td style={{ fontSize: 12 }}>#{inv.application_number} · WE {fmtDate(inv.week_ending)}</td>
                  <td className="col-num">{fmt(inv.gross_amount)}</td>
                  <td className="col-num" style={{ color: '#7c3aed' }}>{fmt(inv.retention_amount)}</td>
                  <td className="col-num" style={{ fontWeight: 700 }}>{fmt(inv.net_amount)}</td>
                  <td style={{ fontSize: 12 }}>{inv.sent_finance_date ? fmtDate(inv.sent_finance_date) : '—'}</td>
                  <td><span className="status-badge" style={{ background: INV_STATUS_BG[inv.status], color: INV_STATUS_COLOR[inv.status] }}>{inv.status}</span></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: '#1a1a2e', color: '#fff', fontWeight: 700 }}>
                <td colSpan={2} style={{ textAlign: 'right', padding: '8px 10px' }}>TOTAL</td>
                <td className="col-num" style={{ padding: '8px 10px' }}>€{fmt(totalGross)}</td>
                <td></td>
                <td className="col-num" style={{ padding: '8px 10px' }}>€{fmt(totalNet)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
