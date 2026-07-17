import { apiFetch } from '../apiFetch.js';
import { useState, useEffect } from 'react';

const eur = (n) => `€${new Intl.NumberFormat('en-IE', { maximumFractionDigits: 0 }).format(n || 0)}`;
const pct = (n) => `${Number(n || 0).toFixed(1)}%`;
const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric' });
};

const COST_LABELS = { subs: 'Subcontractors', materials: 'Materials', plant: 'Plant', ohp: 'OH&P Allowance' };

export default function PeriodReportPreview({ projectId, from, to, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setData(null);
    setError('');
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to)   params.set('to', to);
    apiFetch(`/api/v1/projects/${projectId}/reports/period-data?${params}`)
      .then(async r => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || 'Failed to load report');
        setData(body);
      })
      .catch(e => setError(e.message));
  }, [projectId, from, to]);

  const exportPDF = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to)   params.set('to', to);
      const res = await apiFetch(`/api/v1/projects/${projectId}/reports/period-pdf?${params}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Failed to generate report');
        return;
      }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = res.headers.get('content-disposition')?.match(/filename="(.+)"/)?.[1] || 'GMC-Report.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="report-preview-overlay" onClick={onClose}>
      <div className="report-preview-panel" onClick={e => e.stopPropagation()}>
        <div className="report-preview-header">
          <h2 className="sc-title">Period Report Preview</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-primary" onClick={exportPDF} disabled={exporting || !data}>
              {exporting ? 'Generating…' : '📄 Export PDF'}
            </button>
            <button className="btn-secondary" onClick={onClose}>✕ Close</button>
          </div>
        </div>

        <div className="report-preview-body">
          {error && <div className="state-box"><div className="icon">⚠️</div><p>{error}</p></div>}
          {!error && !data && <div className="state-box"><div className="icon">⏳</div><p>Loading report…</p></div>}
          {data && (
            <>
              <h1 className="report-title">GMC System — Period Report</h1>
              <p className="report-subtitle">{data.project.name} · {data.project.ref} · {data.project.client}</p>
              <p className="report-subtitle">Period: {fmtDate(data.period.from)} → {fmtDate(data.period.to)} ({data.period.weekCount} week{data.period.weekCount > 1 ? 's' : ''})</p>

              <h3 className="report-section-title">Executive Summary</h3>
              <div className="report-summary-grid">
                <div><span className="report-summary-label">Revenue (period)</span><span>{eur(data.summary.revTotal)}</span></div>
                <div><span className="report-summary-label">Cost (period)</span><span>{eur(data.summary.costTotal)}</span></div>
                <div><span className="report-summary-label">Margin (period)</span><span>{eur(data.summary.marginTotal)} ({pct(data.summary.marginPct)})</span></div>
              </div>

              <h3 className="report-section-title">Weekly Breakdown</h3>
              <table className="report-table">
                <thead>
                  <tr><th>WE</th><th>Revenue</th><th>Cost</th><th>Margin</th><th>Margin %</th></tr>
                </thead>
                <tbody>
                  {data.weeks.map((w, i) => (
                    <tr key={w.week_ending} className={i % 2 === 0 ? 'report-row-alt' : ''}>
                      <td>{fmtDate(w.week_ending)}</td>
                      <td>{eur(w.rev_total_week)}</td>
                      <td>{eur(w.cost_total_week)}</td>
                      <td>{eur(w.margin_week)}</td>
                      <td>{pct(w.margin_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h3 className="report-section-title">Cost Breakdown (period)</h3>
              <ul className="report-list">
                {Object.entries(data.costBreakdown).map(([k, v]) => (
                  <li key={k}>{COST_LABELS[k]}: {eur(v)} ({pct(data.summary.costTotal > 0 ? (v / data.summary.costTotal) * 100 : 0)})</li>
                ))}
              </ul>

              <h3 className="report-section-title">Revenue Breakdown (period)</h3>
              <ul className="report-list">
                {Object.entries(data.revBreakdown).filter(([, v]) => v !== 0).map(([k, v]) => (
                  <li key={k}>{k}: {eur(v)} ({pct(data.summary.revTotal > 0 ? (v / data.summary.revTotal) * 100 : 0)})</li>
                ))}
              </ul>

              {data.subs.length > 0 && (
                <>
                  <h3 className="report-section-title">Subcontractor Breakdown (period)</h3>
                  <table className="report-table">
                    <thead>
                      <tr><th>Subcontractor</th><th>Cost Payment</th><th>Material</th><th>Revenue Gen.</th></tr>
                    </thead>
                    <tbody>
                      {data.subs.map((s, i) => (
                        <tr key={s.name} className={i % 2 === 0 ? 'report-row-alt' : ''}>
                          <td>{s.name}</td>
                          <td>{eur(s.cost_payment)}</td>
                          <td>{eur(s.cost_material)}</td>
                          <td>{eur(s.revenue_generated)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
