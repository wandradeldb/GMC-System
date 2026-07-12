import { apiFetch } from '../apiFetch.js';
import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import ProgressSheet from './ProgressSheet.jsx';
import PeriodReportPreview from './PeriodReportPreview.jsx';
import { useZoom } from '../zoomContext.js';

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

// Nearest Friday on or before today
function todayFriday() {
  const d = new Date();
  const diff = (d.getDay() - 5 + 7) % 7; // days since last Friday (0 if today IS Friday)
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}

// Generate a range of Fridays: n weeks before and m weeks after a reference date
function fridayRange(ref, before = 4, after = 2) {
  const result = [];
  for (let i = -before; i <= after; i++) {
    const d = new Date(ref + 'T12:00:00');
    d.setDate(d.getDate() + i * 7);
    result.push(d.toISOString().slice(0, 10));
  }
  return result;
}

// All Fridays Jan 2026 → Dec 2027
const ALL_TRACKER_WEEKS = (() => {
  const weeks = [];
  const d = new Date('2026-01-02T12:00:00');
  while (d.getDay() !== 5) d.setDate(d.getDate() + 1);
  const end = new Date('2027-12-31T12:00:00');
  while (d <= end) {
    weeks.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 7);
  }
  return weeks;
})();

// ── main component ───────────────────────────────────────────────────────────
export default function TrackerView({ projectId, readOnly, onSubCellClick }) {
  const [data,        setData]        = useState(null);
  const [showEntry,   setShowEntry]   = useState(false);
  const [entryWE,     setEntryWE]     = useState('');
  const [selectedWE,  setSelectedWE]  = useState('');
  const [reportFrom,  setReportFrom]  = useState('');
  const [reportTo,    setReportTo]    = useState('');
  const [showReport,  setShowReport]  = useState(false);
  const tableRef = useRef(null);
  const zoom = useZoom();

  const load = useCallback(() => {
    apiFetch(`/api/v1/projects/${projectId}/tracker`)
      .then(r => r.json()).then(setData);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  // Scroll to show latest data (around today) on load
  useEffect(() => {
    if (tableRef.current) {
      const today = new Date().toISOString().slice(0, 10);
      const idx = ALL_TRACKER_WEEKS.findIndex(w => w >= today);
      const colW = 110; // approximate column width
      tableRef.current.scrollLeft = Math.max(0, (idx - 3) * colW);
    }
  }, [data?.rows?.length]);

  if (!data) return <div className="state-box"><div className="icon">⏳</div><p>Loading tracker…</p></div>;

  const { rows: dbRows, summary, sub_lines = {}, subs: allSubs = [] } = data;
  // Merge all pre-generated weeks with DB data; show empty cells for unsaved weeks
  const rowMap = {};
  dbRows.forEach((r, i) => { rowMap[r.week_ending] = { ...r, week_number: i + 1 }; });
  const rows = ALL_TRACKER_WEEKS.map((w, i) => rowMap[w] || { week_ending: w, week_number: null, _empty: true });
  const { latest, previous, contractValue, totalBOQ } = summary;

  // Every registered subcontract gets a row, whether or not any week has data for it yet —
  // sourcing this from sub_lines (which only exists per already-saved tracker week) meant a sub
  // was invisible here until the first weekly entry was made for it, even though it already
  // existed in Subcontracts.
  const subList = allSubs;

  // Sub row colors (cycle through a palette)
  const SUB_PALETTES = [
    { bg:'#f0fdf4', border:'#bbf7d0', hdr:'#16a34a' },
    { bg:'#fefce8', border:'#fde68a', hdr:'#ca8a04' },
    { bg:'#eff6ff', border:'#bfdbfe', hdr:'#1d4ed8' },
    { bg:'#fff7ed', border:'#fed7aa', hdr:'#ea580c' },
    { bg:'#fdf4ff', border:'#e9d5ff', hdr:'#9333ea' },
    { bg:'#f0f9ff', border:'#bae6fd', hdr:'#0284c7' },
  ];
  const subPalette = (i) => SUB_PALETTES[i % SUB_PALETTES.length];

  // Cumulative totals per sub (across all weeks)
  const subCumTotals = {};
  subList.forEach(s => {
    subCumTotals[s.sub_name] = { cost_payment:0, cost_material:0, revenue_generated:0, planned_cost:0 };
  });
  rows.forEach(r => {
    (sub_lines[r.week_ending] || []).forEach(s => {
      if (subCumTotals[s.sub_name]) {
        subCumTotals[s.sub_name].cost_payment      += s.cost_payment      || 0;
        subCumTotals[s.sub_name].cost_material     += s.cost_material     || 0;
        subCumTotals[s.sub_name].revenue_generated += s.revenue_generated || 0;
        subCumTotals[s.sub_name].planned_cost      += s.planned_cost      || 0;
      }
    });
  });
  const gmcOpCum  = rows.reduce((s,r) => s + (sub_lines[r.week_ending]?.__gmc_op__?.gmc_op_plant        || 0), 0);
  const miscCCum  = rows.reduce((s,r) => s + (sub_lines[r.week_ending]?.__misc__?.misc_subbies_cost      || 0), 0);
  const miscRCum  = rows.reduce((s,r) => s + (sub_lines[r.week_ending]?.__misc__?.misc_subbies_revenue   || 0), 0);

  const openEntry = (we) => { setEntryWE(we); setShowEntry(true); };

  // WE dropdown: 4 weeks before today's Friday, today's friday, 2 after
  const todayFri = todayFriday();
  const weOptions = fridayRange(todayFri, 4, 2);
  const existingWEs = new Set(rows.map(r => r.week_ending));
  const activeWE = selectedWE || weOptions.find(w => !existingWEs.has(w)) || weOptions[weOptions.length - 1];

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
        <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
          <input type="date" value={reportFrom} onChange={e => setReportFrom(e.target.value)}
            title="Report from"
            style={{ padding:'6px 8px', borderRadius:8, border:'1px solid #d1d5db', fontSize:12 }} />
          <span style={{ fontSize:12, color:'#6b7280' }}>→</span>
          <input type="date" value={reportTo} onChange={e => setReportTo(e.target.value)}
            title="Report to"
            style={{ padding:'6px 8px', borderRadius:8, border:'1px solid #d1d5db', fontSize:12 }} />
          <button className="btn-secondary" onClick={() => setShowReport(true)}>
            📊 Gerar Relatório
          </button>
          <select value={activeWE} onChange={e => setSelectedWE(e.target.value)}
            style={{ padding:'7px 10px', borderRadius:8, border:'1px solid #d1d5db', fontSize:13, background:'#fff', cursor:'pointer' }}>
            {weOptions.map(w => (
              <option key={w} value={w}>
                WE {fmtWE(w)}{existingWEs.has(w) ? ' ✎' : ' — new'}
              </option>
            ))}
          </select>
          {!readOnly && <button className="btn-primary" onClick={() => openEntry(activeWE)}>
            {existingWEs.has(activeWE) ? '✎ Edit WE' : '+ Enter WE'}
          </button>}
        </div>
      </div>

      {dbRows.length === 0 ? (
        <div className="state-box">
          <div className="icon">📊</div>
          <p>No weeks entered yet. Click "+ Enter WE" to record the first week.</p>
        </div>
      ) : (
        /* ── Tracker Matrix ───────────────────────────────────────── */
        <div className="tracker-scroll-wrap" ref={tableRef} style={{ zoom: `${zoom}%` }}>
          <table className="tracker-table">
            <thead>
              <tr>
                <th className="tracker-row-label-head">Metric</th>
                {/* Cumulative column — sticky after label */}
                <th className="tracker-col-head tracker-cum-head">
                  <div className="tracker-we-label">CUMULATIVE</div>
                  <div className="tracker-we-num">{rows.length} weeks</div>
                </th>
                {rows.map(r => (
                  <th key={r.week_ending} className="tracker-col-head"
                    style={r._empty ? { opacity: 0.55 } : {}}>
                    <div className="tracker-we-label">WE {fmtWE(r.week_ending)}</div>
                    <div className="tracker-we-num">{r.week_number ? `Wk ${r.week_number}` : ''}</div>
                    <button className="tracker-edit-btn" onClick={() => openEntry(r.week_ending)}>edit</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ALL_ROWS.map(row => {
                const sectionHdr = SECTION_HEADERS.find(s => s.before === row.key);
                const gs = GROUP_STYLE[row.group] || {};
                const colSpan = rows.length + 2;
                return (
                  <Fragment key={row.key}>
                    {sectionHdr && (
                      <tr key={`hdr-${row.key}`} className="tracker-section-row">
                        <td colSpan={colSpan}
                          style={{ background: sectionHdr.bg, color: '#fff', fontWeight: 700, fontSize: 11, letterSpacing: '0.1em', padding: '3px 12px', textTransform: 'uppercase' }}>
                          {sectionHdr.label}
                        </td>
                      </tr>
                    )}

                    {/* ── Sub breakdown rows — injected before cost_subs ── */}
                    {row.key === 'cost_subs' && subList.length > 0 && (
                      <>
                        {subList.map((sub, si) => {
                          const pal = subPalette(si);
                          const cum = subCumTotals[sub.sub_name];
                          return (
                            <Fragment key={sub.sub_name}>
                              {/* Sub name header — primeira célula sticky */}
                              <tr key={`sub-hdr-${sub.sub_name}`}>
                                <td className="tracker-row-label"
                                  style={{ background: pal.hdr, color:'#fff', fontWeight:700, fontSize:10, letterSpacing:'0.08em', padding:'2px 20px', textTransform:'uppercase', zIndex:2 }}>
                                  {sub.sub_name}
                                </td>
                                <td style={{ background: pal.hdr, position:'sticky', left:200, zIndex:1 }} />
                                {rows.map(r => <td key={r.week_ending} style={{ background: pal.hdr }} />)}
                              </tr>
                              {/* Costs — Payment */}
                              <tr key={`sub-cp-${sub.sub_name}`} style={{ background: pal.bg }}>
                                <td className="tracker-row-label" style={{ background: pal.bg, paddingLeft:28, fontSize:12 }}>Costs — Payment</td>
                                <td className="tracker-cell tracker-cum-cell" style={{ fontWeight:700, cursor: onSubCellClick ? 'pointer' : 'default' }}
                                  onClick={() => onSubCellClick && onSubCellClick(sub.sub_name)}>
                                  {cum.cost_payment ? <span style={{ color: onSubCellClick ? '#1d4ed8' : undefined }}>{`€${fmt(cum.cost_payment,0)}`}</span> : <span className="zero">—</span>}
                                </td>
                                {rows.map(r => {
                                  const sl = (sub_lines[r.week_ending] || []).find(s => s.sub_name === sub.sub_name);
                                  const v = sl?.cost_payment || 0;
                                  return <td key={r.week_ending} className="tracker-cell" style={{ borderTop:`1px solid ${pal.border}`, cursor: onSubCellClick ? 'pointer' : 'default' }}
                                    onClick={() => onSubCellClick && onSubCellClick(sub.sub_name)}>
                                    {v ? <span style={{ color: onSubCellClick ? '#1d4ed8' : undefined, fontWeight: onSubCellClick ? 600 : undefined }}>{`€${fmt(v,0)}`}</span> : <span className="zero">—</span>}
                                  </td>;
                                })}
                              </tr>
                              {/* Material & Disposal */}
                              <tr key={`sub-mat-${sub.sub_name}`} style={{ background: pal.bg }}>
                                <td className="tracker-row-label" style={{ background: pal.bg, paddingLeft:28, fontSize:12 }}>Material &amp; Disposal</td>
                                <td className="tracker-cell tracker-cum-cell" style={{ fontWeight:700 }}>
                                  {cum.cost_material ? `€${fmt(cum.cost_material,0)}` : <span className="zero">—</span>}
                                </td>
                                {rows.map(r => {
                                  const sl = (sub_lines[r.week_ending] || []).find(s => s.sub_name === sub.sub_name);
                                  const v = sl?.cost_material || 0;
                                  return <td key={r.week_ending} className="tracker-cell" style={{ borderTop:`1px solid ${pal.border}` }}>
                                    {v ? `€${fmt(v,0)}` : <span className="zero">—</span>}
                                  </td>;
                                })}
                              </tr>
                              {/* Revenue Generated */}
                              <tr key={`sub-rev-${sub.sub_name}`} style={{ background: pal.bg }}>
                                <td className="tracker-row-label" style={{ background: pal.bg, paddingLeft:28, fontSize:12, color:'#16a34a', fontWeight:600 }}>Revenue Generated</td>
                                <td className="tracker-cell tracker-cum-cell" style={{ fontWeight:700, color:'#16a34a' }}>
                                  {cum.revenue_generated ? `€${fmt(cum.revenue_generated,0)}` : <span className="zero">—</span>}
                                </td>
                                {rows.map(r => {
                                  const sl = (sub_lines[r.week_ending] || []).find(s => s.sub_name === sub.sub_name);
                                  const v = sl?.revenue_generated || 0;
                                  return <td key={r.week_ending} className="tracker-cell" style={{ borderTop:`1px solid ${pal.border}`, color:'#16a34a' }}>
                                    {v ? `€${fmt(v,0)}` : <span className="zero">—</span>}
                                  </td>;
                                })}
                              </tr>
                              {/* Planned Cost (forecast) — só aparece se houver valores */}
                              {cum.planned_cost > 0 && (
                                <tr key={`sub-plan-${sub.sub_name}`} style={{ background: pal.bg, opacity: 0.75 }}>
                                  <td className="tracker-row-label" style={{ background: pal.bg, paddingLeft:28, fontSize:11, color:'#6b7280', fontStyle:'italic' }}>Planned (forecast)</td>
                                  <td className="tracker-cell tracker-cum-cell" style={{ fontWeight:700, color:'#6b7280', fontStyle:'italic' }}>
                                    {cum.planned_cost ? `€${fmt(cum.planned_cost,0)}` : <span className="zero">—</span>}
                                  </td>
                                  {rows.map(r => {
                                    const sl = (sub_lines[r.week_ending] || []).find(s => s.sub_name === sub.sub_name);
                                    const v = sl?.planned_cost || 0;
                                    return <td key={r.week_ending} className="tracker-cell" style={{ borderTop:`1px dashed ${pal.border}`, color:'#6b7280', fontStyle:'italic' }}>
                                      {v ? `€${fmt(v,0)}` : <span className="zero">—</span>}
                                    </td>;
                                  })}
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}

                        {/* GMC OP — Plant (unallocated) */}
                        <tr key="gmc-op-hdr">
                          <td colSpan={colSpan}
                            style={{ background:'#475569', color:'#fff', fontWeight:700, fontSize:10, letterSpacing:'0.08em', padding:'2px 20px', textTransform:'uppercase' }}>
                            GMC OP — Plant (Unallocated)
                          </td>
                        </tr>
                        <tr key="gmc-op" style={{ background:'#f8fafc' }}>
                          <td className="tracker-row-label" style={{ background:'#f8fafc', paddingLeft:28, fontSize:12 }}>Plant Cost</td>
                          <td className="tracker-cell tracker-cum-cell" style={{ fontWeight:700 }}>
                            {gmcOpCum ? `€${fmt(gmcOpCum,0)}` : <span className="zero">—</span>}
                          </td>
                          {rows.map(r => {
                            const v = sub_lines[r.week_ending]?.__gmc_op__?.gmc_op_plant || 0;
                            return <td key={r.week_ending} className="tracker-cell">
                              {v ? `€${fmt(v,0)}` : <span className="zero">—</span>}
                            </td>;
                          })}
                        </tr>

                        {/* Misc Subbies */}
                        <tr key="misc-hdr">
                          <td colSpan={colSpan}
                            style={{ background:'#78716c', color:'#fff', fontWeight:700, fontSize:10, letterSpacing:'0.08em', padding:'2px 20px', textTransform:'uppercase' }}>
                            Misc Subbies
                          </td>
                        </tr>
                        <tr key="misc-cost" style={{ background:'#fafaf9' }}>
                          <td className="tracker-row-label" style={{ background:'#fafaf9', paddingLeft:28, fontSize:12 }}>Misc Subbies — Cost</td>
                          <td className="tracker-cell tracker-cum-cell" style={{ fontWeight:700 }}>
                            {miscCCum ? `€${fmt(miscCCum,0)}` : <span className="zero">—</span>}
                          </td>
                          {rows.map(r => {
                            const v = sub_lines[r.week_ending]?.__misc__?.misc_subbies_cost || 0;
                            return <td key={r.week_ending} className="tracker-cell">
                              {v ? `€${fmt(v,0)}` : <span className="zero">—</span>}
                            </td>;
                          })}
                        </tr>
                        <tr key="misc-rev" style={{ background:'#fafaf9' }}>
                          <td className="tracker-row-label" style={{ background:'#fafaf9', paddingLeft:28, fontSize:12, color:'#16a34a', fontWeight:600 }}>Misc Subbies — Revenue</td>
                          <td className="tracker-cell tracker-cum-cell" style={{ fontWeight:700, color:'#16a34a' }}>
                            {miscRCum ? `€${fmt(miscRCum,0)}` : <span className="zero">—</span>}
                          </td>
                          {rows.map(r => {
                            const v = sub_lines[r.week_ending]?.__misc__?.misc_subbies_revenue || 0;
                            return <td key={r.week_ending} className="tracker-cell" style={{ color:'#16a34a' }}>
                              {v ? `€${fmt(v,0)}` : <span className="zero">—</span>}
                            </td>;
                          })}
                        </tr>

                        {/* Separator before totals */}
                        <tr key="cost-totals-hdr">
                          <td colSpan={colSpan}
                            style={{ background:'#92400e', color:'#fff', fontWeight:700, fontSize:10, letterSpacing:'0.08em', padding:'2px 20px', textTransform:'uppercase' }}>
                            Cost Totals
                          </td>
                        </tr>
                      </>
                    )}

                    <tr key={row.key} style={{ background: gs.bg }}>
                      <td className="tracker-row-label" style={{ background: gs.bg || '#fff', fontStyle: gs.fontStyle, fontWeight: gs.fontWeight || 500 }}>
                        {row.label}
                      </td>
                      {/* Cumulative / EFA column — sticky after label */}
                      <td className="tracker-cell tracker-cum-cell"
                        style={{ fontWeight: 700, color: gs.color }}>
                        {(() => {
                          const v = latest?.[row.key];
                          if (v == null) return '—';
                          if (row.pct) return fmtPct(v);
                          return v !== 0 ? `€${fmt(v, 0)}` : <span className="zero">—</span>;
                        })()}
                      </td>
                      {rows.map(r => {
                        if (r._empty) return <td key={r.week_ending} className="tracker-cell"><span className="zero">—</span></td>;
                        const val = r[row.key];
                        const isNeg = typeof val === 'number' && val < 0;
                        return (
                          <td key={r.week_ending} className="tracker-cell"
                            style={{ fontWeight: gs.fontWeight, fontStyle: gs.fontStyle, color: isNeg ? '#dc2626' : gs.color }}>
                            {row.pct ? fmtPct(val) : (val != null && val !== 0 ? `€${fmt(val, 0)}` : <span className="zero">—</span>)}
                          </td>
                        );
                      })}
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showReport && (
        <PeriodReportPreview
          projectId={projectId}
          from={reportFrom}
          to={reportTo}
          onClose={() => setShowReport(false)}
        />
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
