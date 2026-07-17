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

// Project-wide invoice list, aggregating sub_invoice across every subcontractor -- so answering
// "has sub X invoiced yet?" doesn't require opening that sub's card and its "Tracker Invoices" tab.
export default function InvoiceTrackerView({ projectId }) {
  const [invoices, setInvoices] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');

  const load = useCallback(() => {
    setLoading(true);
    apiFetch(`/api/v1/projects/${projectId}/invoices`)
      .then(r => r.json()).then(rows => { setInvoices(rows); setLoading(false); }).catch(() => setLoading(false));
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="state-box"><div className="icon">⏳</div><p>Loading invoices…</p></div>;

  const q = search.toLowerCase();
  const visible = invoices.filter(inv =>
    !q || inv.sub_name.toLowerCase().includes(q) || (inv.subcontract_ref || '').toLowerCase().includes(q));

  const totalGross     = visible.reduce((s, i) => s + (i.gross_amount || 0), 0);
  const totalRetention = visible.reduce((s, i) => s + (i.retention_amount || 0), 0);
  const totalNet        = visible.reduce((s, i) => s + (i.net_amount || 0), 0);
  const totalSubmitted  = visible.filter(i => i.sent_finance_date).reduce((s, i) => s + (i.net_amount || 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="sc-toolbar">
        <h2 className="sc-title">Invoice Tracker</h2>
      </div>

      <div className="filter-bar">
        <input
          type="search"
          placeholder="Search by subcontractor…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {invoices.length === 0 ? (
        <div className="state-box">
          <div className="icon">🧾</div>
          <p>No invoices recorded yet. Record one from a subcontract's "Tracker Invoices" tab.</p>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <table className="boq-table">
            <thead>
              <tr>
                <th style={{ position: 'sticky', top: 0, background: '#f9fafb', zIndex: 2 }}>Subcontractor</th>
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
              {visible.map((inv, idx) => (
                <tr key={inv.id} style={{ background: idx % 2 === 0 ? '#f8fafc' : '#fff' }}>
                  <td style={{ fontSize: 12 }}>{inv.subcontract_ref} — {inv.sub_name}</td>
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
                <td colSpan={3} style={{ textAlign: 'right', padding: '8px 10px' }}>TOTAL ({visible.length})</td>
                <td className="col-num" style={{ padding: '8px 10px' }}>€{fmt(totalGross)}</td>
                <td className="col-num" style={{ padding: '8px 10px' }}>€{fmt(totalRetention)}</td>
                <td className="col-num" style={{ padding: '8px 10px' }}>€{fmt(totalNet)}</td>
                <td colSpan={2} style={{ padding: '8px 10px', color: '#4ade80' }}>
                  Submitted to account: €{fmt(totalSubmitted)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
