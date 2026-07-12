import { apiFetch } from '../apiFetch.js';
import { useState, useEffect, useCallback } from 'react';
import { useZoom } from '../zoomContext.js';
import { SEC_COLOR, orderSections } from '../lib/sections.js';

const fmt  = (n, d = 0) => n == null ? '—' : new Intl.NumberFormat('en-IE', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
const fmtD      = d => { if (!d) return '—'; const [y,m,dy] = String(d).split('-'); return `${dy}/${m}/${y}`; };
const fmtPeriod = p => { if (!p) return '—'; const [y,m] = String(p).split('-'); return new Date(`${y}-${m}-01T12:00:00`).toLocaleDateString('en-IE', { month: 'short', year: 'numeric' }); };

const STATUS_LABEL = { draft: 'Draft', submitted: 'Submitted', certified: 'Certified', paid: 'Paid' };
const STATUS_COLOR = { draft: '#6b7280', submitted: '#1e40af', certified: '#166534', paid: '#7c3aed' };

export default function PayAppView({ projectId, readOnly }) {
  const zoom = useZoom();
  const [data,       setData]      = useState(null);
  const [showNew,    setShowNew]   = useState(false);
  const [detail,     setDetail]    = useState(null); // single payapp detail

  const load = useCallback(() => {
    apiFetch(`/api/v1/projects/${projectId}/payapps`)
      .then(r => r.json()).then(setData);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  if (!data) return <div className="state-box"><div className="icon">⏳</div><p>Loading…</p></div>;

  const { payapps, latest, summary } = data;

  if (showNew) return (
    <NewPayAppForm
      projectId={projectId}
      onBack={() => { setShowNew(false); load(); }}
    />
  );

  if (detail) return (
    <PayAppDetail
      payapp={detail}
      projectId={projectId}
      onBack={() => setDetail(null)}
      onStatusChange={load}
    />
  );

  const totalCertified = latest?.net_cumulative || 0;
  const pctCertified = summary.totalBOQ > 0 ? totalCertified / summary.totalBOQ * 100 : 0;

  return (
    <div>
      {/* ── Summary bar ─────────────────────────────────────────── */}
      <div className="tracker-summary">
        <div className="tracker-summary-card">
          <div className="tracker-kpi-label">Contract Value</div>
          <div className="tracker-kpi-value" style={{ color: '#1a1a2e' }}>€{fmt(summary.contractValue)}</div>
        </div>
        <div className="summary-divider" />
        <div className="tracker-summary-card">
          <div className="tracker-kpi-label">Total Certified</div>
          <div className="tracker-kpi-value" style={{ color: '#166534' }}>€{fmt(totalCertified)}</div>
          <div className="tracker-kpi-sub">{fmt(pctCertified, 1)}% of contract</div>
        </div>
        <div className="tracker-summary-card">
          <div className="tracker-kpi-label">Previously Certified</div>
          <div className="tracker-kpi-value" style={{ color: '#374151' }}>€{fmt(latest?.previously_certified || 0)}</div>
          <div className="tracker-kpi-sub">before PayApp #{latest?.app_number || '—'}</div>
        </div>
        <div className="tracker-summary-card">
          <div className="tracker-kpi-label">Last Certificate</div>
          <div className="tracker-kpi-value" style={{ color: '#1e40af' }}>€{fmt(latest?.this_certificate || 0)}</div>
          <div className="tracker-kpi-sub">PayApp #{latest?.app_number} — {fmtD(latest?.date_submitted)}</div>
        </div>
        <div className="summary-divider" />
        <div className="tracker-summary-card">
          <div className="tracker-kpi-label">Retention Held</div>
          <div className="tracker-kpi-value" style={{ color: '#dc2626' }}>€{fmt(latest?.retention_cumulative || 0)}</div>
          <div className="tracker-kpi-sub">{latest?.retention_pct || 3}% of gross</div>
        </div>
        <div className="tracker-summary-card">
          <div className="tracker-kpi-label">Balance Remaining</div>
          <div className="tracker-kpi-value" style={{ color: '#7c3aed' }}>€{fmt((summary.totalBOQ || 0) - (latest?.works_gross_cumulative || 0))}</div>
          <div className="tracker-kpi-sub">uncertified gross works</div>
        </div>
      </div>

      {/* ── Toolbar ─────────────────────────────────────────────── */}
      <div className="tracker-toolbar">
        <h2 className="sc-title">Application for Payment</h2>
        {!readOnly && <button className="btn-primary" onClick={() => setShowNew(true)}>
          + New PayApp #{(latest?.app_number || 0) + 1}
        </button>}
      </div>

      {/* ── History table ───────────────────────────────────────── */}
      {payapps.length === 0 ? (
        <div className="state-box"><div className="icon">🧾</div><p>No applications yet. Create the first PayApp.</p></div>
      ) : (
        <div style={{ padding: '0 12px 32px', overflowX: 'auto', WebkitOverflowScrolling: 'touch', zoom: `${zoom}%` }}>
          <table className="boq-table" style={{ minWidth: 480 }}>
            <thead>
              <tr>
                <th style={{ width: 50 }}>App #</th>
                <th style={{ width: 80 }}>Period</th>
                <th style={{ width: 110 }} className="payapp-col-hide">Submitted</th>
                <th style={{ width: 100 }}>Status</th>
                <th className="col-num payapp-col-hide">Works Gross</th>
                <th className="col-num payapp-col-hide">Net Cum.</th>
                <th className="col-num" style={{ background: '#f0fdf4' }}>This Certificate</th>
                <th className="col-num" style={{ width: 80 }}>ER Cert #</th>
                <th style={{ width: 50 }}></th>
              </tr>
            </thead>
            <tbody>
              {[...payapps].reverse().map(pa => (
                <tr key={pa.id} style={{ cursor: 'pointer' }} onClick={() => setDetail(pa)}>
                  <td style={{ fontWeight: 700, textAlign: 'center' }}>#{pa.app_number}</td>
                  <td>{fmtPeriod(pa.period)}</td>
                  <td className="payapp-col-hide">{fmtD(pa.date_submitted)}</td>
                  <td>
                    <span className="type-badge" style={{ background: STATUS_COLOR[pa.status] + '18', color: STATUS_COLOR[pa.status], border: `1px solid ${STATUS_COLOR[pa.status]}40` }}>
                      {STATUS_LABEL[pa.status]}
                    </span>
                  </td>
                  <td className="col-num payapp-col-hide" style={{ color: '#6b7280' }}>€{fmt(pa.works_gross_cumulative)}</td>
                  <td className="col-num payapp-col-hide">€{fmt(pa.net_cumulative)}</td>
                  <td className="col-num" style={{ background: '#f0fdf4', color: '#166534', fontWeight: 700, fontSize: 14 }}>
                    €{fmt(pa.this_certificate)}
                  </td>
                  <td className="col-num" style={{ color: '#7c3aed', fontSize: 12 }}>
                    {pa.cert_number || '—'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn-link" onClick={e => { e.stopPropagation(); setDetail(pa); }}>View →</button>
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

// ── New PayApp Form ──────────────────────────────────────────────────────────
function NewPayAppForm({ projectId, onBack }) {
  const zoom = useZoom();
  const [sheet,         setSheet]        = useState(null);
  const [items,         setItems]        = useState([]);
  const [history,       setHistory]      = useState({});
  const [priorApps,     setPriorApps]    = useState([]);
  const [header,        setHeader]       = useState({ period: '', date_submitted: '', retention_pct: 3.0, prepared_by: '', notes: '' });
  const [grossOverride, setGrossOverride] = useState(''); // direct entry of Works Gross
  const [saving,        setSaving]       = useState(false);
  const [saved,         setSaved]        = useState(false);
  const [activeTab,     setActiveTab]    = useState('boq');
  const [search,        setSearch]       = useState('');
  const [schOn,         setSchOn]        = useState(null); // null = "not yet seeded" -> all on

  useEffect(() => {
    apiFetch(`/api/v1/projects/${projectId}/payapps/new/boq-sheet`)
      .then(r => r.json())
      .then(d => {
        setSheet(d);
        setItems(d.items.map(i => ({ ...i, pct_complete: 0 }))); // incremental for this app
        setHistory(d.history || {});
        setPriorApps(d.prior_apps || []);
        // Pre-fill Works Gross from last certified (QS adjusts upward for new app)
        if (d.last_certified?.works_gross_cumulative) {
          setGrossOverride(String(d.last_certified.works_gross_cumulative));
        }
        const now = new Date();
        setHeader(h => ({ ...h, period: `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}` }));
      });
  }, [projectId]);

  if (!sheet) return <div className="state-box"><div className="icon">⏳</div><p>Loading BOQ…</p></div>;

  const setItem = (i, val) => {
    const row = items[i];
    const maxPct = 100 - (row.pct_prev || 0);
    const n = Math.min(maxPct, Math.max(0, parseFloat(val) || 0));
    setItems(rows => rows.map((r, j) => j === i ? { ...r, pct_complete: n } : r));
  };

  // Live totals — cumulative = pct_prev + incremental; use override if QS entered it
  const itemsGross = items.reduce((s, i) => s + ((parseFloat(i.pct_prev) || 0) + (parseFloat(i.pct_complete) || 0)) / 100 * (i.contract_sum || 0), 0);
  const worksGross = grossOverride !== '' ? (parseFloat(grossOverride) || 0) : itemsGross;
  const retPct     = parseFloat(header.retention_pct) || 3;
  const retention  = worksGross * retPct / 100;
  const netCum     = worksGross - retention;
  const prevCert   = sheet.previously_certified;
  const thisCert   = netCum - prevCert;

  const save = async () => {
    setSaving(true);
    await apiFetch(`/api/v1/projects/${projectId}/payapps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_number:          sheet.next_app_number,
        period:              header.period,
        date_submitted:      header.date_submitted || null,
        retention_pct:       header.retention_pct,
        prepared_by:         header.prepared_by,
        notes:               header.notes,
        works_gross_override: grossOverride !== '' ? parseFloat(grossOverride) : undefined,
        items: items.map(i => ({ ...i, pct_complete: (parseFloat(i.pct_prev) || 0) + (parseFloat(i.pct_complete) || 0) })),
      }),
    });
    setSaving(false); setSaved(true);
    setTimeout(() => onBack(), 1200);
  };

  const schedules = orderSections([...new Set(items.map(i => i.schedule))]);

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', minHeight:0 }}>
      <div className="detail-nav">
        <button className="btn-back" onClick={onBack}>← PayApps</button>
      </div>

      {/* Header — sticky below topbar. Everything on one row: this bar, the tabs, and the filter
          row below it are all sticky "chrome" competing with the scrollable table for vertical
          space, so the 3-row stacked layout got collapsed into one compact flex row. */}
      <div style={{ position:'sticky', top:0, zIndex:10, background:'#fff', borderBottom:'1px solid #e5e7eb',
        display:'flex', alignItems:'center', flexWrap:'wrap', gap:'4px 18px', padding:'4px 16px' }}>
        <span style={{ fontSize:15, fontWeight:800 }}>PayApp #{sheet.next_app_number}</span>
        <span style={{ fontSize:12, color:'#6b7280' }}>Prev. Certified <strong>€{fmt(prevCert)}</strong></span>
        <span style={{ fontSize:12, color:'#6b7280' }}>Gross <strong style={{ color:'#1e40af' }}>€{fmt(grossOverride || itemsGross, 2)}</strong></span>
        <span style={{ fontSize:12, color:'#6b7280' }}>Retention ({retPct}%) <strong style={{ color:'#dc2626' }}>€{fmt(retention, 0)}</strong></span>
        <span style={{ fontSize:13, color:'#6b7280' }}>This Cert. <strong style={{ fontSize:15, color: thisCert >= 0 ? '#166534' : '#dc2626' }}>€{fmt(thisCert, 0)}</strong></span>
        <input value={header.prepared_by} onChange={e => setHeader(h => ({ ...h, prepared_by: e.target.value }))}
          placeholder="Prepared by" style={{ padding:'4px 10px', border:'1px solid #d1d5db', borderRadius:6, fontSize:12, width:130 }} />
        <button className="btn-save" onClick={save} disabled={saving} style={{ padding:'5px 14px', marginLeft:'auto' }}>
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save PayApp'}
        </button>
      </div>

      {/* Tabs — sticky below header */}
      <div className="das-tabs" style={{ position:'sticky', top:0, zIndex:8, background:'#fff', borderBottom:'1px solid #e5e7eb' }}>
        {[
          { id: 'boq',     label: `BOQ Detail (${items.length})` },
          { id: 'header',  label: 'Header / Certificate' },
          { id: 'summary', label: 'Summary Sheet' },
        ].map(t => (
          <button key={t.id} className={`das-tab ${activeTab === t.id ? 'active' : ''}`} onClick={() => setActiveTab(t.id)} style={{ padding:'4px 16px' }}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="das-tab-content" style={{ padding: 0, flex:1, minHeight:0, display:'flex', flexDirection:'column' }}>
        {activeTab === 'boq' && (() => {
          const activeSch = schOn || new Set(schedules);
          const displaySchedules = schedules.filter(s => activeSch.has(s));
          const grandTotal    = items.reduce((s,i) => s + (i.contract_sum||0), 0);
          const grandCumulate = items.reduce((s,i) => s + ((parseFloat(i.pct_prev)||0)/100)*(i.contract_sum||0), 0);
          const grandThis     = items.reduce((s,i) => s + ((parseFloat(i.pct_complete)||0)/100)*(i.contract_sum||0), 0);
          const COLS = 6 + priorApps.length; // ref+desc+unit+rate+total+cumulate + apps
          const toggleSch = (s) => setSchOn(prev => {
            const next = new Set(prev || schedules);
            next.has(s) ? next.delete(s) : next.add(s);
            return next;
          });

          return (
            <div style={{ display:'flex', flexDirection:'column', flex:1, minHeight:0 }}>
              {/* Schedule filter + search */}
              <div style={{ display:'flex', alignItems:'center', gap:14, padding:'4px 12px', flexWrap:'wrap', borderBottom:'1px solid #e5e7eb' }}>
                {schedules.map(s => (
                  <label key={s} style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', fontSize:13, fontWeight:600, color: SEC_COLOR[s] || '#374151' }}>
                    <input type="checkbox" checked={activeSch.has(s)} onChange={() => toggleSch(s)}
                      style={{ width:14, height:14, cursor:'pointer', accentColor: SEC_COLOR[s] || '#1a1a2e' }} />
                    {s}
                  </label>
                ))}
                <button onClick={() => { setSchOn(new Set(schedules)); setSearch(''); }}
                  style={{ padding:'3px 10px', borderRadius:5, border:'1px solid #d1d5db', background:'#f9fafb', cursor:'pointer', fontSize:11, color:'#6b7280' }}>
                  ✕ Clear
                </button>
                <span style={{ color:'#6b7280', fontSize:12 }}>{items.filter(i => parseFloat(i.pct_complete) > 0).length} items with %</span>
                <input type="search" placeholder="Filter items…" value={search} onChange={e => setSearch(e.target.value)}
                  style={{ padding:'5px 10px', border:'1px solid #d1d5db', borderRadius:6, fontSize:12, width:180, marginLeft:'auto' }} />
              </div>

              {/* Scrollable table area — overflow:auto + max-height makes thead sticky work */}
              {(() => {
                // sticky column left offsets
                const W = { ref:52, desc:200, qty:56, unit:46, rate:82, total:90 };
                const L = { ref:0, desc:W.ref, qty:W.ref+W.desc, unit:W.ref+W.desc+W.qty, rate:W.ref+W.desc+W.qty+W.unit, total:W.ref+W.desc+W.qty+W.unit+W.rate };
                const stickyTh = (extra={}) => ({
                  position:'sticky', zIndex:6, background:'#1e3a8a', ...extra,
                });
                const stickyTd = (left, bg) => ({
                  position:'sticky', left, zIndex:2, background: bg,
                });
                let rowIdx = 0;
                const rowBg = (ri) => ri % 2 === 0 ? '#f0f6ff' : '#ffd8bb';

                const thStyle = (extra={}) => ({
                  background:'#1e3a8a', color:'#fff', fontWeight:700,
                  fontSize:11, letterSpacing:'.05em', textTransform:'uppercase',
                  padding:'7px 8px', borderBottom:'2px solid #1e40af', whiteSpace:'nowrap',
                  ...extra,
                });

                return (
                <div style={{ overflow:'auto', flex:1, minHeight:0, WebkitOverflowScrolling:'touch', zoom: `${zoom}%` }}>
                  <table className="boq-table" style={{ minWidth: 730 + priorApps.length * 70 }}>
                    <thead>
                      <tr>
                        <th style={{ ...thStyle({ position:'sticky', top:0, left:L.ref,   zIndex:7, width:W.ref,   textAlign:'left'   }) }}>Ref</th>
                        <th style={{ ...thStyle({ position:'sticky', top:0, left:L.desc,  zIndex:7, width:W.desc,  textAlign:'left'   }) }}>Description</th>
                        <th style={{ ...thStyle({ position:'sticky', top:0, left:L.qty,   zIndex:7, width:W.qty,   textAlign:'right'  }) }}>Qty</th>
                        <th style={{ ...thStyle({ position:'sticky', top:0, left:L.unit,  zIndex:7, width:W.unit,  textAlign:'center' }) }}>Unit</th>
                        <th style={{ ...thStyle({ position:'sticky', top:0, left:L.rate,  zIndex:7, width:W.rate,  textAlign:'right'  }) }}>Rate</th>
                        <th style={{ ...thStyle({ position:'sticky', top:0, left:L.total, zIndex:7, width:W.total, textAlign:'right'  }) }}>Contract €</th>
                        <th style={{ ...thStyle({ position:'sticky', top:0, zIndex:5, background:'#1e40af', textAlign:'right', minWidth:90 }) }}>Cumul. €</th>
                        {priorApps.map(a => (
                          <th key={a.app_number} style={{ ...thStyle({ position:'sticky', top:0, zIndex:5, background:'#334155', textAlign:'right', minWidth:64 }) }}>
                            App #{a.app_number}
                          </th>
                        ))}
                        <th style={{ ...thStyle({ position:'sticky', top:0, zIndex:5, background:'#166534', textAlign:'right', minWidth:76 }) }}>% This App</th>
                        <th style={{ ...thStyle({ position:'sticky', top:0, zIndex:5, background:'#166534', textAlign:'right', minWidth:84 }) }}>Value €</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displaySchedules.map(sch => {
                        const schItems = items.map((it, idx) => ({ ...it, _idx: idx }))
                          .filter(it => it.schedule === sch &&
                            (!search || it.description.toLowerCase().includes(search.toLowerCase()) || it.item_ref.toLowerCase().includes(search.toLowerCase())));
                        if (!schItems.length) return null;
                        const schContractTotal = schItems.reduce((s,i) => s + (i.contract_sum||0), 0);
                        const schCumulate      = schItems.reduce((s,i) => s + ((parseFloat(i.pct_prev)||0)/100)*(i.contract_sum||0), 0);
                        const schThis          = schItems.reduce((s,i) => s + ((parseFloat(i.pct_complete)||0)/100)*(i.contract_sum||0), 0);
                        return [
                          <tr key={`hdr-${sch}`} style={{ background: (SEC_COLOR[sch] || '#1e3a8a') + '18' }}>
                            <td colSpan={7 + priorApps.length + 2} style={{ padding:'5px 12px', color: SEC_COLOR[sch] || '#1e3a8a', fontWeight:700, fontSize:12, letterSpacing:'.04em' }}>
                              {sch}
                            </td>
                          </tr>,
                          ...schItems.map(row => {
                            const bg     = rowBg(rowIdx++);
                            const inc    = parseFloat(row.pct_complete) || 0;
                            const prev   = parseFloat(row.pct_prev)     || 0;
                            const val    = (inc / 100) * (row.contract_sum || 0);
                            const cumVal = (prev / 100) * (row.contract_sum || 0);
                            const appPcts = priorApps.map((a, ai) => {
                              const cum     = parseFloat(history[row.boq_item_id]?.[a.app_number]) || 0;
                              const cumPrev = ai > 0 ? (parseFloat(history[row.boq_item_id]?.[priorApps[ai-1].app_number]) || 0) : 0;
                              return cum - cumPrev;
                            });
                            return (
                              <tr key={row._idx} style={{ background: bg }}>
                                <td style={{ ...stickyTd(L.ref,   bg), padding:'5px 8px', fontSize:12, fontWeight:600, color:'#374151', whiteSpace:'nowrap' }}>{row.item_ref}</td>
                                <td style={{ ...stickyTd(L.desc,  bg), padding:'5px 8px', fontSize:12, color:'#111827', maxWidth:W.desc, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={row.description}>{row.description}</td>
                                <td style={{ ...stickyTd(L.qty,   bg), padding:'5px 8px', fontSize:12, textAlign:'right', color:'#6b7280', whiteSpace:'nowrap' }}>{row.qty > 0 ? fmt(row.qty, 2) : '—'}</td>
                                <td style={{ ...stickyTd(L.unit,  bg), padding:'5px 4px', fontSize:12, textAlign:'center', color:'#6b7280', whiteSpace:'nowrap' }}>{row.unit}</td>
                                <td style={{ ...stickyTd(L.rate,  bg), padding:'5px 8px', fontSize:11, textAlign:'right', color:'#6b7280', whiteSpace:'nowrap' }}>{row.rate > 0 ? `€${fmt(row.rate,2)}` : '—'}</td>
                                <td style={{ ...stickyTd(L.total, bg), padding:'5px 8px', fontSize:12, textAlign:'right', color:'#374151', whiteSpace:'nowrap' }}>{row.contract_sum > 0 ? `€${fmt(row.contract_sum,2)}` : '—'}</td>
                                <td className="col-num" style={{ background:'#eff6ff', color: cumVal > 0 ? '#1e40af' : '#d1d5db', fontSize:12 }}>
                                  {cumVal > 0 ? `€${fmt(cumVal,2)}` : '—'}
                                </td>
                                {appPcts.map((p, ai) => (
                                  <td key={ai} className="col-num" style={{ background:'#f8faff', color: p > 0 ? '#374151' : '#d1d5db', fontSize:11 }}>
                                    {p > 0 ? `${fmt(p,1)}%` : '—'}
                                  </td>
                                ))}
                                <td className="col-num" style={{ background:'#f0fff4' }}>
                                  <div style={{ display:'flex', alignItems:'center', gap:4, justifyContent:'flex-end' }}>
                                    <input type="number" min="0" max={100 - prev} step="0.5"
                                      value={row.pct_complete}
                                      onChange={e => setItem(row._idx, e.target.value)}
                                      onKeyDown={e => {
                                        if (e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
                                        e.preventDefault(); e.stopPropagation();
                                        const all = [...document.querySelectorAll('.assess-input-gmc')];
                                        const i = all.findIndex(el => el === e.target);
                                        const next = all[i + (e.key === 'ArrowUp' ? -1 : 1)];
                                        if (next) { next.focus(); next.select(); }
                                      }}
                                      className="assess-input assess-input-gmc" style={{ width:54 }} />
                                    <span style={{ fontSize:10, color:'#6b7280' }}>%</span>
                                  </div>
                                </td>
                                <td className="col-num" style={{ background:'#f0fff4', color: val > 0 ? '#166534' : '#d1d5db', fontWeight: val > 0 ? 700 : 400 }}>
                                  {val > 0 ? `€${fmt(val,2)}` : '—'}
                                </td>
                              </tr>
                            );
                          }),
                          <tr key={`sub-${sch}`} style={{ background:'#dbeafe', fontWeight:700 }}>
                            <td style={{ ...stickyTd(L.ref,  '#dbeafe'), padding:'5px 8px' }} />
                            <td style={{ ...stickyTd(L.desc, '#dbeafe'), padding:'5px 8px', fontSize:12, color: SEC_COLOR[sch] || '#1e40af' }}>
                              {sch} — Subtotal
                            </td>
                            <td style={{ ...stickyTd(L.qty,  '#dbeafe') }} />
                            <td style={{ ...stickyTd(L.unit, '#dbeafe') }} />
                            <td style={{ ...stickyTd(L.rate, '#dbeafe') }} />
                            <td style={{ ...stickyTd(L.total,'#dbeafe'), padding:'5px 8px', textAlign:'right', color:'#1e40af' }}>€{fmt(schContractTotal,2)}</td>
                            <td className="col-num" style={{ background:'#bfdbfe', color:'#1e40af' }}>€{fmt(schCumulate,2)}</td>
                            {priorApps.map(a => <td key={a.app_number} />)}
                            <td />
                            <td className="col-num" style={{ background:'#bbf7d0', color:'#166534' }}>€{fmt(schThis,2)}</td>
                          </tr>,
                        ];
                      })}
                      <tr style={{ background:'#1e3a8a', color:'#fff', fontWeight:700 }}>
                        <td style={{ ...stickyTd(L.ref,  '#1e3a8a'), padding:'6px 8px' }} />
                        <td style={{ ...stickyTd(L.desc, '#1e3a8a'), padding:'6px 8px', fontSize:13, color:'#fff' }}>GRAND TOTAL</td>
                        <td style={{ ...stickyTd(L.qty,  '#1e3a8a') }} />
                        <td style={{ ...stickyTd(L.unit, '#1e3a8a') }} />
                        <td style={{ ...stickyTd(L.rate, '#1e3a8a') }} />
                        <td style={{ ...stickyTd(L.total,'#1e3a8a'), padding:'6px 8px', textAlign:'right', color:'#fff' }}>€{fmt(grandTotal,2)}</td>
                        <td className="col-num" style={{ background:'#1e40af' }}>€{fmt(grandCumulate,2)}</td>
                        {priorApps.map(a => <td key={a.app_number} />)}
                        <td />
                        <td className="col-num" style={{ background:'#166534' }}>€{fmt(grandThis,2)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                );
              })()}
            </div>
          );
        })()}

        {activeTab === 'header' && (
          <div className="section-grid" style={{ maxWidth: 520 }}>
            {[
              { key: 'period',         label: 'Period (YYYY-MM)',   type: 'text',   placeholder: '2026-07' },
              { key: 'date_submitted', label: 'Date Submitted',     type: 'date',   placeholder: '' },
              { key: 'retention_pct',  label: 'Retention %',        type: 'number', placeholder: '3.0' },
              { key: 'notes',          label: 'Notes / Commentary', type: 'text',   placeholder: 'Optional notes…' },
            ].map(f => (
              <div key={f.key} className="field">
                <label className="field-label">{f.label}</label>
                <input type={f.type} value={header[f.key]} placeholder={f.placeholder}
                  onChange={e => setHeader(h => ({ ...h, [f.key]: e.target.value }))} />
              </div>
            ))}
          </div>
        )}

        {activeTab === 'summary' && (
          <div style={{ maxWidth: 520, padding: '8px 0' }}>
            <table className="payapp-cert-table">
              <tbody>
                <CertRow label="Works (Current Commitment)" commitment={`€${fmt(sheet.last_certified?.works_gross_cumulative || 0)}`} value={`€${fmt(worksGross, 0)}`} />
                <CertRow label="Adjustment Events" commitment="€0" value="€0" />
                <CertRow label="Total" commitment={`€${fmt(sheet.last_certified?.total_gross_cumulative || 0)}`} value={`€${fmt(worksGross, 0)}`} bold />
                <tr><td colSpan={3} style={{ padding: '6px 0', borderBottom: '1px solid #e5e7eb' }}></td></tr>
                <CertRow label={`Total Retention @ ${retPct}%`} value={`€${fmt(retention, 0)}`} minus />
                <CertRow label="Total less Retention" value={`€${fmt(netCum, 0)}`} bold />
                <CertRow label="Previously Certified" value={`€${fmt(prevCert, 0)}`} minus />
                <tr><td colSpan={3} style={{ padding: '4px 0' }}></td></tr>
                <CertRow label="PRESENT CERTIFICATE" value={`€${fmt(thisCert, 0)}`} total />
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function CertRow({ label, commitment, value, bold, minus, total }) {
  return (
    <tr style={{ background: total ? '#f0fdf4' : 'transparent' }}>
      <td style={{ padding: '7px 12px', fontSize: 13, fontWeight: bold || total ? 700 : 400, color: total ? '#166534' : 'inherit', width: '55%' }}>{label}</td>
      <td style={{ padding: '7px 12px', fontSize: 13, textAlign: 'right', color: '#6b7280', width: '20%' }}>{commitment || ''}</td>
      <td style={{ padding: '7px 12px', fontSize: 13, textAlign: 'right', fontWeight: bold || total ? 700 : 400, color: total ? '#166534' : minus ? '#dc2626' : 'inherit', width: '25%' }}>{minus ? `(${value})` : value}</td>
    </tr>
  );
}

// ── PayApp Detail view ───────────────────────────────────────────────────────
function PayAppDetail({ payapp, projectId, onBack, onStatusChange }) {
  const [erCert,  setErCert]  = useState({ er_works_certified: payapp.er_works_certified || '', er_net_certified: payapp.er_net_certified || '', er_this_cert: payapp.er_this_cert || '', date_certified: payapp.date_certified || '', cert_number: payapp.cert_number || '' });
  const [saving,  setSaving]  = useState(false);

  const nextStatus = { draft: 'submitted', submitted: 'certified', certified: 'paid' };
  const btnLabel   = { draft: 'Submit to Client', submitted: 'Record ER Cert', certified: 'Mark Paid', paid: null };

  const advance = async () => {
    setSaving(true);
    const body = { status: nextStatus[payapp.status], ...erCert };
    await apiFetch(`/api/v1/projects/${projectId}/payapps/${payapp.id}/status`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    setSaving(false);
    onStatusChange();
    onBack();
  };

  return (
    <div>
      <div className="detail-nav">
        <button className="btn-back" onClick={onBack}>← PayApps</button>
      </div>

      <div className="assessment-header">
        <div className="assessment-title">
          <span className="assessment-period">PayApp #{payapp.app_number} — {fmtPeriod(payapp.period)}</span>
          <span className="type-badge" style={{ background: STATUS_COLOR[payapp.status] + '18', color: STATUS_COLOR[payapp.status], border: `1px solid ${STATUS_COLOR[payapp.status]}40`, fontSize: 12 }}>
            {STATUS_LABEL[payapp.status]}
          </span>
        </div>
        <div className="assessment-kpis">
          <div className="assess-kpi"><div className="kpi-label">Works Gross</div><div className="kpi-value" style={{ color: '#1e40af' }}>€{fmt(payapp.works_gross_cumulative)}</div></div>
          <div className="assess-kpi"><div className="kpi-label">Net Cumulative</div><div className="kpi-value">€{fmt(payapp.net_cumulative)}</div></div>
          <div className="assess-kpi"><div className="kpi-label">This Certificate</div><div className="kpi-value" style={{ color: '#166534', fontWeight: 800 }}>€{fmt(payapp.this_certificate)}</div></div>
        </div>
        {btnLabel[payapp.status] && (
          <div className="assessment-actions">
            <button className="btn-save" onClick={advance} disabled={saving}>
              {saving ? 'Saving…' : btnLabel[payapp.status]}
            </button>
          </div>
        )}
      </div>

      <div style={{ padding: '24px', maxWidth: 560 }}>
        <table className="payapp-cert-table" style={{ marginBottom: 24 }}>
          <thead><tr>
            <th style={{ width:'55%', textAlign:'left', padding:'6px 12px', fontSize:11, textTransform:'uppercase', letterSpacing:'.06em', color:'#6b7280' }}>Item</th>
            <th style={{ width:'22%', textAlign:'right', padding:'6px 12px', fontSize:11, textTransform:'uppercase', color:'#6b7280' }}>Submitted</th>
            <th style={{ width:'23%', textAlign:'right', padding:'6px 12px', fontSize:11, textTransform:'uppercase', color:'#7c3aed' }}>ER Certified</th>
          </tr></thead>
          <tbody>
            <CertRow label="Works (gross cumulative)" value={`€${fmt(payapp.works_gross_cumulative)}`} commitment={payapp.er_works_certified ? `€${fmt(payapp.er_works_certified)}` : '—'} />
            <CertRow label={`Retention @ ${payapp.retention_pct}%`} value={`€${fmt(payapp.retention_cumulative)}`} commitment="" minus />
            <CertRow label="Net Cumulative" value={`€${fmt(payapp.net_cumulative)}`} commitment={payapp.er_net_certified ? `€${fmt(payapp.er_net_certified)}` : '—'} bold />
            <CertRow label="Previously Certified" value={`€${fmt(payapp.previously_certified)}`} commitment="" minus />
            <CertRow label="THIS CERTIFICATE" value={`€${fmt(payapp.this_certificate)}`} commitment={payapp.er_this_cert ? `€${fmt(payapp.er_this_cert)}` : '—'} total />
          </tbody>
        </table>

        {/* ER determination fields — show when submitted */}
        {payapp.status === 'submitted' && (
          <div>
            <div className="section-label" style={{ marginBottom: 12 }}>ER Determination</div>
            <div className="section-grid" style={{ maxWidth: 480 }}>
              {[
                { key: 'cert_number',       label: 'Certificate Number',     type: 'text'   },
                { key: 'date_certified',     label: 'Date Certified',         type: 'date'   },
                { key: 'er_works_certified', label: 'ER Works Certified (€)', type: 'number' },
                { key: 'er_net_certified',   label: 'ER Net Certified (€)',   type: 'number' },
                { key: 'er_this_cert',       label: 'ER This Cert Amount (€)',type: 'number' },
              ].map(f => (
                <div key={f.key} className="field">
                  <label className="field-label">{f.label}</label>
                  <input type={f.type} value={erCert[f.key]} onChange={e => setErCert(c => ({ ...c, [f.key]: e.target.value }))} />
                </div>
              ))}
            </div>
          </div>
        )}

        {payapp.source === 'import' && (
          <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 16 }}>Imported from Excel — {payapp.notes}</p>
        )}
      </div>
    </div>
  );
}
