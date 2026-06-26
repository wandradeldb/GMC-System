import { useState, useEffect, useCallback, useRef } from 'react';
import ProgressSheet from './ProgressSheet.jsx';

// ── helpers ─────────────────────────────────────────────────────────────────
const fmt = (n, d = 0) => {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat('en-IE', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(n);
};
const fmtPct = n => (n == null ? '—' : `${Number(n).toFixed(1)}%`);
const fmtWE  = we => {
  if (!we) return '—';
  const d = new Date(we + 'T12:00:00');
  return d.toLocaleDateString('en-IE', { day: 'numeric', month: 'short' });
};

// ── row definitions ──────────────────────────────────────────────────────────
const REV_ROWS = [
  { key: 'rev_prelims_fixed', label: 'Prelims — Fixed',   group: 'rev' },
  { key: 'rev_prelims_time',  label: 'Prelims — Time',    group: 'rev' },
  { key: 'rev_ae',            label: 'A&E / Design',      group: 'rev' },
  { key: 'rev_civil',         label: 'Civil',             group: 'rev' },
  { key: 'rev_meica',         label: 'MEICA',             group: 'rev' },
  { key: 'rev_landscape',     label: 'Landscape',         group: 'rev' },
  { key: 'rev_commissioning', label: 'Commissioning',     group: 'rev' },
  { key: 'rev_total_week',    label: 'REVENUE THIS WEEK', group: 'rev-total', bold: true },
  { key: 'rev_cumulative',    label: 'Revenue Cumulative', group: 'rev-cum', italic: true },
];

const COST_ROWS = [
  { key: 'cost_subs',      label: 'Subcontractors',   group: 'cost' },
  { key: 'cost_materials', label: 'Materials',        group: 'cost' },
  { key: 'cost_plant',     label: 'Plant',            group: 'cost' },
  { key: 'ohp_allowance',  label: 'OH&P Allowance',  group: 'cost' },
  { key: 'cost_total_week', label: 'COST THIS WEEK',  group: 'cost-total', bold: true },
  { key: 'cost_cumulative', label: 'Cost Cumulative', group: 'cost-cum', italic: true },
];

const MARGIN_ROWS = [
  { key: 'margin_week',       label: 'MARGIN THIS WEEK',    group: 'margin', bold: true },
  { key: 'margin_cumulative', label: 'Margin Cumulative',   group: 'margin', italic: true },
  { key: 'margin_pct',        label: 'Margin % Cumulative', group: 'margin-pct', pct: true },
];

const EFA_ROWS = [
  { key: 'efa_revenue',    label: 'EFA Revenue',     group: 'efa' },
  { key: 'efa_cost',       label: 'EFA Cost',        group: 'efa' },
  { key: 'efa_margin',     label: 'EFA Margin',      group: 'efa' },
  { key: 'efa_margin_pct', label: 'EFA Margin %',    group: 'efa', pct: true },
  { key: 'target_margin_pct', label: 'Target Margin %', group: 'efa-target', pct: true },
];

const ALL_ROWS = [...REV_ROWS, ...COST_ROWS, ...MARGIN_ROWS, ...EFA_ROWS];

// ── group styling ────────────────────────────────────────────────────────────
const GROUP_STYLE = {
  'rev':        { bg: '#f8faff' },
  'rev-total':  { bg: '#dbeafe', fontWeight: 700 },
  'rev-cum':    { bg: '#eff6ff', fontStyle: 'italic', color: '#1e40af' },
  'cost':       { bg: '#fffbeb' },
  'cost-total': { bg: '#fef3c7', fontWeight: 700 },
  'cost-cum':   { bg: '#fefce8', fontStyle: 'italic', color: '#92400e' },
  'margin':     { bg: '#f0fdf4' },
  'margin-pct': { bg: '#dcfce7', fontWeight: 700, color: '#166534' },
  'efa':        { bg: '#f5f3ff' },
  'efa-target': { bg: '#ede9fe', fontStyle: 'italic', color: '#7c3aed' },
};

const SECTION_HEADERS = [
  { before: 'rev_prelims_fixed', label: 'REVENUE', color: '#1e40af', bg: '#1e40af' },
  { before: 'cost_subs',         label: 'COST',    color: '#92400e', bg: '#b45309' },
  { before: 'margin_week',       label: 'MARGIN',  color: '#166534', bg: '#16a34a' },
  { before: 'efa_revenue',       label: 'EFA — ESTIMATED FINAL ACCOUNT', color: '#7c3aed', bg: '#7c3aed' },
];

// ── nextFriday ───────────────────────────────────────────────────────────────
function nextFriday(from) {
  const d = from ? new Date(from + 'T12:00:00') : new Date();
  const diff = (5 - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

// ── main component ───────────────────────────────────────────────────────────
export default function TrackerView({ projectId }) {
  const [data,        setData]        = useState(null);
  const [showEntry,   setShowEntry]   = useState(false);
  const [entryWE,     setEntryWE]     = useState('');
  const tableRef = useRef(null);

  const load = useCallback(() => {
    fetch(`/api/v1/projects/${projectId}/tracker`)
      .then(r => r.json()).then(setData);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  // Scroll to the rightmost column on load
  useEffect(() => {
    if (tableRef.current) tableRef.current.scrollLeft = tableRef.current.scrollWidth;
  }, [data?.rows?.length]);

  if (!data) return <div className="state-box"><div className="icon">⏳</div><p>Loading tracker…</p></div>;

  const { rows, summary } = data;
  const { latest, previous, contractValue, totalBOQ } = summary;

  const openEntry = (we) => { setEntryWE(we); setShowEntry(true); };
  const suggestWE = rows.length > 0 ? nextFriday(rows[rows.length - 1].week_ending) : nextFriday(null);

  if (showEntry) return (
    <ProgressSheet
      projectId={projectId}
      weekEnding={entryWE}
      onBack={() => { setShowEntry(false); load(); }}
    />
  );

  return (
    <div className="tracker-container">
      {/* ── Project Summary ──────────────────────────────────────── */}
      <div className="tracker-summary">
        <SummaryCard label="Contract Value"   value={`€${fmt(contractValue, 0)}`} color="#1a1a2e" />
        <SummaryCard label="BOQ Total"        value={`€${fmt(totalBOQ, 0)}`}      sub="120 items"         color="#374151" />
        <div className="summary-divider" />
        <SummaryCard label="This Week"        value={`€${fmt(latest?.rev_total_week, 0)}`}   sub={`WE ${fmtWE(latest?.week_ending)}`}      color="#1e40af" />
        <SummaryCard label="Previous Week"    value={`€${fmt(previous?.rev_total_week, 0)}`} sub={`WE ${fmtWE(previous?.week_ending)}`}    color="#374151" />
        <SummaryCard label="Revenue Cumulative" value={`€${fmt(latest?.rev_cumulative, 0)}`} sub={latest && totalBOQ > 0 ? fmtPct(latest.rev_cumulative / totalBOQ * 100) + ' complete' : '—'} color="#166534" />
        <div className="summary-divider" />
        <SummaryCard label="Margin This Week" value={`€${fmt(latest?.margin_week, 0)}`}        sub="week contribution"    color={latest?.margin_week >= 0 ? '#166534' : '#dc2626'} />
        <SummaryCard label="Margin Cumulative" value={`€${fmt(latest?.margin_cumulative, 0)}`} sub={fmtPct(latest?.margin_pct)}              color={latest?.margin_pct >= 0 ? '#166534' : '#dc2626'} />
        <div className="summary-divider" />
        <SummaryCard label="EFA Revenue"      value={`€${fmt(latest?.efa_revenue, 0)}`}      sub="estimated final"       color="#7c3aed" />
        <SummaryCard label="EFA Margin %"     value={fmtPct(latest?.efa_margin_pct)}         sub={`target ${fmtPct(latest?.target_margin_pct)}`} color={latest?.efa_margin_pct >= (latest?.target_margin_pct || 8) ? '#166534' : '#dc2626'} />
      </div>

      {/* ── Toolbar ──────────────────────────────────────────────── */}
      <div className="tracker-toolbar">
        <h2 className="sc-title">Weekly Cost Tracker</h2>
        <button className="btn-primary" onClick={() => openEntry(suggestWE)}>
          + Enter WE {fmtWE(suggestWE)}
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="state-box">
          <div className="icon">📊</div>
          <p>No weeks entered yet. Click "+ Enter WE" to record the first week.</p>
        </div>
      ) : (
        /* ── Tracker Matrix ───────────────────────────────────────── */
        <div className="tracker-scroll-wrap" ref={tableRef}>
          <table className="tracker-table">
            <thead>
              <tr>
                <th className="tracker-row-label-head">Metric</th>
                {rows.map(r => (
                  <th key={r.week_ending} className="tracker-col-head">
                    <div className="tracker-we-label">WE {fmtWE(r.week_ending)}</div>
                    <div className="tracker-we-num">Wk {r.week_number}</div>
                    <button className="tracker-edit-btn" onClick={() => openEntry(r.week_ending)}>edit</button>
                  </th>
                ))}
                {/* Cumulative column */}
                <th className="tracker-col-head tracker-cum-head">
                  <div className="tracker-we-label">CUMULATIVE</div>
                  <div className="tracker-we-num">{rows.length} weeks</div>
                </th>
              </tr>
            </thead>
            <tbody>
              {ALL_ROWS.map(row => {
                const sectionHdr = SECTION_HEADERS.find(s => s.before === row.key);
                const gs = GROUP_STYLE[row.group] || {};
                const latestCumKey = row.key.includes('cumulative') || row.key === 'margin_pct' || row.key.includes('efa') ? row.key : null;
                return (
                  <>
                    {sectionHdr && (
                      <tr key={`hdr-${row.key}`} className="tracker-section-row">
                        <td colSpan={rows.length + 2}
                          style={{ background: sectionHdr.bg, color: '#fff', fontWeight: 700, fontSize: 11, letterSpacing: '0.1em', padding: '3px 12px', textTransform: 'uppercase' }}>
                          {sectionHdr.label}
                        </td>
                      </tr>
                    )}
                    <tr key={row.key} style={{ background: gs.bg }}>
                      <td className="tracker-row-label" style={{ fontStyle: gs.fontStyle, fontWeight: gs.fontWeight || 500 }}>
                        {row.label}
                      </td>
                      {rows.map(r => {
                        const val = r[row.key];
                        const isNeg = typeof val === 'number' && val < 0;
                        return (
                          <td key={r.week_ending} className="tracker-cell"
                            style={{ fontWeight: gs.fontWeight, fontStyle: gs.fontStyle, color: isNeg ? '#dc2626' : gs.color }}>
                            {row.pct ? fmtPct(val) : (val != null && val !== 0 ? `€${fmt(val, 0)}` : <span className="zero">—</span>)}
                          </td>
                        );
                      })}
                      {/* Cumulative / EFA column */}
                      <td className="tracker-cell tracker-cum-cell"
                        style={{ fontWeight: 700, color: gs.color }}>
                        {(() => {
                          const v = latest?.[row.key];
                          if (v == null) return '—';
                          if (row.pct) return fmtPct(v);
                          return v !== 0 ? `€${fmt(v, 0)}` : <span className="zero">—</span>;
                        })()}
                      </td>
                    </tr>
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, sub, color }) {
  return (
    <div className="tracker-summary-card">
      <div className="tracker-kpi-label">{label}</div>
      <div className="tracker-kpi-value" style={{ color }}>{value}</div>
      {sub && <div className="tracker-kpi-sub">{sub}</div>}
    </div>
  );
}
