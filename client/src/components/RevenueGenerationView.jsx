import { apiFetch } from '../apiFetch.js';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useZoom } from '../zoomContext.js';
import ImportBOQModal from './ImportBOQModal.jsx';
import NewSubcontractModal from './NewSubcontractModal.jsx';
import { SECTIONS, SEC_COLOR } from '../lib/sections.js';

const fmt  = (n, d = 2) => n == null ? '—' : new Intl.NumberFormat('en-IE', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
const fmtE = (n, d = 0) => `€${fmt(n, d)}`;
const fmtWE     = iso => { const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}` : iso; };
const fmtDate   = iso => { const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : iso; };
const MONTHS    = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmtWEHead = iso => { const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${parseInt(m[3])} ${MONTHS[parseInt(m[2])-1]}` : iso; };
const fmtWK     = n => !n ? '—' : (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(0)}k` : n.toFixed(0));
const isoWeekNum = iso => {
  const d = new Date(iso + 'T12:00:00');
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - y) / 86400000) + 1) / 7);
};

function todayFriday() {
  const now = new Date();
  // Anchor on today's *local* calendar date at noon before doing date math -- building straight
  // off `new Date()` and reading it back via toISOString() (UTC) let the local getDay()/setDate()
  // arithmetic land on one calendar day while the UTC serialization rolled to the next, so the
  // default WE could silently not match any real week column depending on timezone.
  const localISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const d = new Date(localISO + 'T12:00:00');
  d.setDate(d.getDate() - ((d.getDay() - 5 + 7) % 7));
  return d.toISOString().slice(0, 10);
}

// All Fridays between two ISO dates (inclusive), snapped forward to the first Friday >= start.
function fridaysBetween(startISO, endISO) {
  let d = new Date(startISO + 'T12:00:00');
  while (d.getDay() !== 5) d.setDate(d.getDate() + 1);
  const end = new Date(endISO + 'T12:00:00');
  const weeks = [];
  while (d <= end) {
    weeks.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 7 * 24 * 60 * 60 * 1000);
  }
  return weeks;
}

// Column widths (px)
const CW = { ref: 52, desc: 238, cv: 86, cumul: 86, rem: 86, sub: 136, we: 58 };
const SL = {
  ref:   0,
  desc:  CW.ref,
  cv:    CW.ref + CW.desc,
  cumul: CW.ref + CW.desc + CW.cv,
  rem:   CW.ref + CW.desc + CW.cv + CW.cumul,
  sub:   CW.ref + CW.desc + CW.cv + CW.cumul + CW.rem,
};
const FIXED_W  = CW.ref + CW.desc + CW.cv + CW.cumul + CW.rem + CW.sub;
const THEAD_H  = 34;
const THEAD2_H = 16; // edit-button row height
const SEC_TOP  = THEAD_H + THEAD2_H; // section headers stick below both thead rows
const ROW_ODD  = '#f0f6ff';
const ROW_EVEN = '#ffd8bb';

export default function RevenueGenerationView({ projectId, project, readOnly }) {
  const zoom = useZoom();
  const [showImport, setShowImport] = useState(false);
  const [weekEnding, setWeek]   = useState(todayFriday());
  const [activities, setActs]   = useState([]);
  const [history, setHistory]   = useState({ weeks: [], data: {} });
  const [allWeeks, setAllWeeks] = useState([]);
  const [subs, setSubs]         = useState([]);
  const [edits, setEdits]       = useState({});    // { actId: { we: pct } }
  const [subEdits, setSubEdits] = useState({});    // { actId: sub_id } para a WE selecionada
  const [secOn, setSecOn]       = useState(new Set(SECTIONS));
  const [search, setSearch]     = useState('');
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const curWeekThRef = useRef(null);

  useEffect(() => {
    curWeekThRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [weekEnding, allWeeks]);
  const [addingSubFor, setAddingSubFor] = useState(null); // activity id awaiting a new subcontract, or null

  const loadSubs = useCallback(() => {
    apiFetch(`/api/v1/projects/${projectId}/subcontracts`).then(r => r.json()).then(setSubs).catch(() => {});
  }, [projectId]);

  useEffect(() => { loadSubs(); }, [loadSubs]);

  const loadData = useCallback(() => {
    setLoading(true);
    Promise.all([
      apiFetch(`/api/v1/projects/${projectId}/revenue/week/${weekEnding}`).then(r => r.json()),
      apiFetch(`/api/v1/projects/${projectId}/revenue/history`).then(r => r.json()),
    ]).then(([weekData, histData]) => {
      const acts = weekData.activities || [];
      setActs(acts);

      // Week columns span the project's duration (padded 2 weeks either side) when start_date/
      // end_date are set; most projects don't set them, so fall back to an ~18-month window
      // around today. Either way, the window is stretched to also cover the currently selected
      // week and any week that already has saved history — so past % entries never silently
      // drop out of totalPctOf's 100%-lock calculation just because they fall outside the window.
      // Anchor at local noon before doing ms arithmetic — same reasoning as todayFriday() above:
      // building straight off `new Date()` (arbitrary time-of-day) and later reading the result
      // back via toISOString() (UTC) can roll the window boundary back a calendar day.
      const today = new Date(`${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}-${String(new Date().getDate()).padStart(2,'0')}T12:00:00`);
      const fallbackStart = new Date(today.getTime() - 39 * 7 * 24 * 60 * 60 * 1000);
      const fallbackEnd   = new Date(today.getTime() + 39 * 7 * 24 * 60 * 60 * 1000);
      let lo = project?.start_date ? new Date(project.start_date + 'T12:00:00') : fallbackStart;
      let hi = project?.end_date   ? new Date(project.end_date   + 'T12:00:00') : fallbackEnd;
      lo = new Date(lo.getTime() - 14 * 24 * 60 * 60 * 1000);
      hi = new Date(hi.getTime() + 14 * 24 * 60 * 60 * 1000);

      const histWeeks = histData?.weeks || [];
      const boundary = [...histWeeks, weekEnding].map(w => new Date(w + 'T12:00:00'));
      for (const d of boundary) {
        if (d < lo) lo = d;
        if (d > hi) hi = d;
      }

      const weeks = fridaysBetween(lo.toISOString().slice(0, 10), hi.toISOString().slice(0, 10));
      setAllWeeks(weeks);

      // Inicializar edits com TODOS os valores de histórico para TODAS as semanas
      const m = {};
      const sm = {};
      acts.forEach(a => {
        m[a.id] = {};
        weeks.forEach(w => {
          m[a.id][w] = histData?.data?.[a.id]?.[w]?.pct ?? 0;
        });
        sm[a.id] = a.sub_id ?? '';
      });
      setEdits(m);
      setSubEdits(sm);
      setHistory(histData || { weeks: [], data: {} });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [projectId, weekEnding, project?.start_date, project?.end_date]);

  useEffect(() => { loadData(); }, [loadData]);

  const pctOf      = (a, w) => Number(edits[a.id]?.[w]) || 0;
  const revOf      = (a, w) => Math.round(pctOf(a, w) / 100 * (a.contract_value || 0) * 100) / 100;
  const totalPctOf = (a) => allWeeks.reduce((s, w) => s + (Number(edits[a.id]?.[w]) || 0), 0);
  const cumulOf = a => {
    let sum = 0;
    (history.weeks || []).forEach(w => { sum += history.data?.[a.id]?.[w]?.rev || 0; });
    return Math.round(sum * 100) / 100;
  };
  const remainOf = a => Math.max(0, Math.round(((a.contract_value || 0) - cumulOf(a)) * 100) / 100);

  const setPct = (id, w, v) => {
    const cur = Number(edits[id]?.[w]) || 0;
    const total = allWeeks.reduce((s, wk) => s + (Number(edits[id]?.[wk]) || 0), 0);
    const available = 100 - (total - cur);
    const n = Math.min(available, Math.max(0, parseFloat(v) || 0));
    setEdits(e => ({ ...e, [id]: { ...e[id], [w]: n } }));
  };
  const setSub = (id, v) => {
    if (v === '__new__') { setAddingSubFor(id); return; } // opens NewSubcontractModal instead of assigning
    setSubEdits(s => ({ ...s, [id]: v }));
  };

  const onKey = (e, inputs, i) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const next = inputs[i + (e.key === 'ArrowDown' ? 1 : -1)];
    if (next) { next.focus(); next.select(); }
  };

  const save = async () => {
    setSaving(true); setSavedMsg('');
    const items = activities.map(a => ({
      activity_id: a.id,
      pct_complete: Math.min(100, pctOf(a, weekEnding)),
      sub_id: subEdits[a.id] || null,
    }));
    const res = await apiFetch(`/api/v1/projects/${projectId}/revenue/week/${weekEnding}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
    const j = await res.json();
    setSaving(false);
    if (j.ok) { setSavedMsg(`Saved ${fmtWE(weekEnding)} — ${fmtE(j.rev_total_week, 2)}`); loadData(); }
    else setSavedMsg(j.error || 'Error saving');
  };

  if (loading) return <div className="state-box"><div className="icon">⏳</div><p>Loading…</p></div>;

  const q = search.toLowerCase();
  const visible = activities.filter(a => secOn.has(a.section) &&
    (!q || a.description.toLowerCase().includes(q) || (a.ref || '').toLowerCase().includes(q)));

  const today     = todayFriday();
  const savedWeeks = new Set(history.weeks || []);

  const grand = { contract: 0, week: 0, cumul: 0 };
  activities.forEach(a => { grand.contract += a.contract_value || 0; });
  visible.forEach(a => { grand.week += revOf(a, weekEnding); grand.cumul += cumulOf(a); });

  // Helpers de estilo para thead
  const thFixed = (left, extra = {}) => ({
    position: 'sticky', top: 0, left, zIndex: 14,
    background: '#1e40af', color: '#fff',
    padding: '3px 4px', fontSize: 8, fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '.03em',
    borderRight: '1px solid #1e3a8a', whiteSpace: 'nowrap', ...extra,
  });
  const thWE = (w) => {
    const isCur = w === weekEnding;
    const hasSaved = savedWeeks.has(w);
    return {
      position: 'sticky', top: 0, zIndex: 10,
      padding: '3px 2px', fontSize: 8, fontWeight: 700,
      textAlign: 'center', whiteSpace: 'nowrap',
      background: isCur ? '#166534' : '#1e40af',
      color: '#fff',
      borderLeft: isCur ? '2px solid #4ade80' : '1px solid #1e3a8a',
      opacity: hasSaved || isCur ? 1 : 0.75,
    };
  };
  const tdFixed = (left, rowBg, extra = {}) => ({
    position: 'sticky', left, zIndex: 2, background: rowBg,
    padding: '2px 4px', fontSize: 9, borderRight: '1px solid #e2e8f0',
    verticalAlign: 'middle', color: '#111', ...extra,
  });

  let dataRowIdx = 0;
  const currentInputs = []; // refs para ArrowKey nav da coluna atual

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', minHeight:0 }}>
      {/* ── Controls sticky ─── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 20,
        background: '#f8fafc', paddingBottom: 4, paddingTop: 4,
        borderBottom: '1px solid #e2e8f0', marginBottom: 4,
      }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
            Save WE:&nbsp;
            <select value={weekEnding} onChange={e => setWeek(e.target.value)}
              style={{ padding: '5px 7px', borderRadius: 5, border: '1px solid #d1d5db', fontSize: 12 }}>
              {allWeeks.map(w => <option key={w} value={w}>{fmtDate(w)}</option>)}
            </select>
          </label>

          <input type="search" placeholder="Search activities…" value={search} onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 140, padding: '6px 10px', borderRadius: 5, border: '1px solid #d1d5db', fontSize: 12 }} />

          {!readOnly && (
            <button className="btn-primary" onClick={() => setShowImport(true)}
              style={{ padding: '6px 14px', fontSize: 12, whiteSpace: 'nowrap' }}>
              + Import BOQ
            </button>
          )}

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 9, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em' }}>Week Revenue</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#166534' }}>{fmtE(grand.week, 2)}</div>
              <div style={{ fontSize: 9, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 1 }}>Cumulative</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1e40af' }}>{fmtE(grand.cumul, 2)}</div>
            </div>
            <button onClick={save} disabled={saving} className="btn-primary"
              style={{ padding: '8px 18px', fontSize: 13, whiteSpace: 'nowrap' }}>
              {saving ? 'Saving…' : `Save ${fmtWE(weekEnding)}`}
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {SECTIONS.map(s => (
            <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: SEC_COLOR[s] }}>
              <input type="checkbox" checked={secOn.has(s)} onChange={() => setSecOn(prev => {
                const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n;
              })} style={{ width: 14, height: 14, cursor: 'pointer', accentColor: SEC_COLOR[s] }} />
              {s}
            </label>
          ))}
          <button onClick={() => { setSecOn(new Set(SECTIONS)); setSearch(''); }}
            style={{ padding: '3px 10px', borderRadius: 5, border: '1px solid #d1d5db', background: '#f9fafb', cursor: 'pointer', fontSize: 11, color: '#6b7280' }}>
            ✕ Clear
          </button>
        </div>
      </div>

      {savedMsg && (
        <div style={{ background: '#f0fdf4', border: '1px solid #86efac', color: '#166534', padding: '7px 12px', borderRadius: 6, marginBottom: 8, fontSize: 12 }}>
          {savedMsg}
        </div>
      )}

      {/* ── Tabela ─── */}
      <div style={{ overflowX: 'auto', overflowY: 'auto', flex: 1, minHeight: 0, zoom: `${zoom}%` }}>
        <table style={{
          borderCollapse: 'collapse',
          minWidth: FIXED_W + allWeeks.length * CW.we,
          tableLayout: 'fixed',
          fontSize: 10,
        }}>
          <colgroup>
            <col style={{ width: CW.ref }} />
            <col style={{ width: CW.desc }} />
            <col style={{ width: CW.cv }} />
            <col style={{ width: CW.cumul }} />
            <col style={{ width: CW.rem }} />
            <col style={{ width: CW.sub }} />
            {allWeeks.map(w => <col key={w} style={{ width: CW.we }} />)}
          </colgroup>

          <thead>
            <tr>
              <th style={thFixed(SL.ref,  { width: CW.ref  })}>Ref</th>
              <th style={thFixed(SL.desc, { width: CW.desc })}>Description</th>
              <th style={thFixed(SL.cv,    { width: CW.cv,    textAlign:'right' })}>Contract €</th>
              <th style={thFixed(SL.cumul, { width: CW.cumul, textAlign:'right' })}>Cumul. €</th>
              <th style={thFixed(SL.rem,   { width: CW.rem,   textAlign:'right' })}>Remain. €</th>
              <th style={thFixed(SL.sub,   { width: CW.sub,   borderRight:'3px solid #60a5fa' })}>Subcontractor</th>
              {allWeeks.map(w => (
                <th key={w} style={thWE(w)} ref={w === weekEnding ? curWeekThRef : null}>
                  <div style={{ fontSize: 8, fontWeight: 700 }}>WE {fmtWEHead(w)}</div>
                  <div style={{ fontSize: 7, opacity: .7, marginTop: 1 }}>Wk {isoWeekNum(w)}</div>
                </th>
              ))}
            </tr>
            <tr>
              <th colSpan={6} style={{ position:'sticky', top: THEAD_H, left:0, zIndex:14, background:'#1e3a8a', padding:0 }} />
              {allWeeks.map(w => {
                const isCur = w === weekEnding;
                const weekTotal = visible.reduce((s, a) => s + revOf(a, w), 0);
                return (
                  <th key={w} style={{ position:'sticky', top: THEAD_H, zIndex:9, background: isCur ? '#166534' : '#1e3a8a', padding:'1px 2px', borderLeft: isCur ? '2px solid #4ade80' : '1px solid #1e3a8a' }}>
                    <div title={fmtE(weekTotal, 2)} style={{ fontSize: 7, color: weekTotal ? '#4ade80' : 'rgba(255,255,255,0.4)', fontWeight: 700, textAlign: 'center', lineHeight: 1.3 }}>
                      €{fmtWK(weekTotal)}
                    </div>
                    <button onClick={() => setWeek(w)} className="tracker-edit-btn"
                      style={{ display: 'block', width: '100%', marginTop: 0,
                        background: isCur ? 'rgba(74,222,128,0.25)' : 'rgba(255,255,255,0.1)',
                        border: isCur ? '1px solid rgba(74,222,128,0.5)' : '1px solid rgba(255,255,255,0.2)',
                      }}>edit</button>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {SECTIONS.filter(s => secOn.has(s)).map(section => {
              const rows = visible.filter(a => a.section === section);
              if (!rows.length) return null;
              const secCV    = rows.reduce((s, a) => s + (a.contract_value || 0), 0);
              const secWeek  = rows.reduce((s, a) => s + revOf(a, weekEnding), 0);
              const secCumul = rows.reduce((s, a) => s + cumulOf(a), 0);
              const totalCols = 6 + allWeeks.length;

              const secStyle = {
                position: 'sticky', top: SEC_TOP,
                background: SEC_COLOR[section], color: '#fff',
                fontWeight: 700, fontSize: 10,
                borderBottom: '1px solid rgba(0,0,0,.12)',
              };
              const fixedSecCols = 6;
              const scrollSecCols = totalCols - fixedSecCols;

              return [
                <tr key={`sec-${section}`}>
                  <td colSpan={fixedSecCols} style={{
                    ...secStyle, zIndex: 8,
                    position: 'sticky', top: SEC_TOP, left: 0,
                    padding: '3px 10px', whiteSpace: 'nowrap',
                  }}>
                    <span style={{ marginRight: 14 }}>{section}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, opacity: .95 }}>
                      {`Wk: ${fmtE(secWeek, 0)} | Cumul: ${fmtE(secCumul, 0)} / ${fmtE(secCV, 0)}`}
                    </span>
                  </td>
                  {scrollSecCols > 0 && (
                    <td colSpan={scrollSecCols} style={{ ...secStyle, zIndex: 7, padding: 0 }} />
                  )}
                </tr>,

                ...rows.map(a => {
                  dataRowIdx++;
                  const rowBg    = dataRowIdx % 2 !== 0 ? ROW_ODD : ROW_EVEN;
                  const cumul    = cumulOf(a);
                  const remaining = remainOf(a);

                  return (
                    <tr key={a.id} style={{ background: rowBg }}>
                      <td style={tdFixed(SL.ref,  rowBg, { width: CW.ref,  fontFamily:'monospace', fontSize:9, whiteSpace:'nowrap', overflow:'hidden' })}>{a.ref}</td>
                      <td style={tdFixed(SL.desc, rowBg, { width: CW.desc, fontSize:10, whiteSpace:'normal', wordBreak:'break-word', lineHeight:1.3 })}>{a.description}</td>

                      <td style={tdFixed(SL.cv,    rowBg, { width:CW.cv,    textAlign:'right', fontWeight:600 })}>€{fmt(a.contract_value, 0)}</td>
                      <td style={tdFixed(SL.cumul, rowBg, { width:CW.cumul, textAlign:'right', fontWeight:700, color:'#1e40af' })}>€{fmt(cumul, 0)}</td>
                      <td style={tdFixed(SL.rem,   rowBg, { width:CW.rem,   textAlign:'right', color: remaining === 0 ? '#16a34a' : '#374151', fontWeight: remaining === 0 ? 700 : 400 })}>€{fmt(remaining, 0)}</td>
                      <td style={tdFixed(SL.sub,   rowBg, { width:CW.sub,   padding:'2px 3px', borderRight:'3px solid #60a5fa' })}>
                        <select value={subEdits[a.id] ?? ''} onChange={e => setSub(a.id, e.target.value)}
                          style={{ width:'100%', padding:'1px 2px', fontSize:9, borderRadius:3, border:'1px solid #d1d5db', background:'#fff' }}>
                          <option value="">GMC (none)</option>
                          {subs.map(s => <option key={s.id} value={s.id}>{s.ref} — {s.subcontractor_name}</option>)}
                          <option value="__new__">+ Add new sub…</option>
                        </select>
                      </td>

                      {allWeeks.map(w => {
                          const isCur    = w === weekEnding;
                          const hasSaved = savedWeeks.has(w) && (history.data?.[a.id]?.[w]?.pct ?? 0) > 0;
                          const pct      = pctOf(a, w);
                          const rev      = revOf(a, w);
                          const savedRev = history.data?.[a.id]?.[w]?.rev ?? 0;
                          const savedPct = history.data?.[a.id]?.[w]?.pct ?? 0;
                          const totPct   = totalPctOf(a);
                          const at100    = totPct >= 100 && pct === 0;

                          return (
                            <td key={w} style={{
                              textAlign: 'center',
                              padding: '1px 2px',
                              verticalAlign: 'middle',
                              background: isCur ? '#f0fdf4' : 'inherit',
                              borderLeft: isCur ? '2px solid #4ade80' : '1px solid #e2e8f0',
                              width: CW.we,
                            }}>
                              {/* Valor €: mostra calculado em tempo real se isCur, senão o salvo */}
                              {isCur ? (
                                <div style={{ fontSize: 9, fontWeight: 700, color: '#166534', marginBottom: 1 }}>
                                  {fmtE(rev, 0)}
                                </div>
                              ) : hasSaved ? (
                                <div style={{ fontSize: 9, fontWeight: 700, color: '#111' }}>
                                  {fmtE(savedRev, 0)}
                                </div>
                              ) : null}

                              {/* Input % or 100% lock */}
                              {at100 ? (
                                <div style={{ fontSize: 7, color: '#f59e0b', fontWeight: 700, textAlign: 'center', lineHeight: 1.2, padding: '2px 0' }}>
                                  ⚠ 100%
                                </div>
                              ) : (
                                <input
                                  type="number" min={0} max={100} step={1}
                                  className={isCur ? 'cell-input rev-pct' : 'cell-input'}
                                  value={pct}
                                  disabled={!isCur}
                                  title={isCur ? undefined : 'Click "edit" on this week\'s column header to enter its %'}
                                  onChange={e => setPct(a.id, w, e.target.value)}
                                  ref={isCur ? el => { if (el) currentInputs.push(el); } : null}
                                  onKeyDown={isCur ? e => {
                                    if (e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
                                    e.preventDefault();
                                    e.stopPropagation();
                                    const all = Array.from(document.querySelectorAll('input.rev-pct'));
                                    const idx = all.findIndex(el => el === e.target);
                                    const dir = e.key === 'ArrowUp' ? -1 : 1;
                                    const next = all[idx + dir];
                                    if (next) { next.focus(); next.select(); }
                                  } : undefined}
                                  style={{
                                    width: 34, textAlign: 'right', padding: '1px 2px',
                                    border: `1px solid ${isCur ? '#16a34a' : '#e5e7eb'}`,
                                    borderRadius: 3, fontSize: 9,
                                    background: isCur ? '#f0fdf4' : '#f9fafb',
                                    fontWeight: isCur ? 700 : 400,
                                    color: isCur ? '#111' : '#9ca3af',
                                    cursor: isCur ? 'text' : 'not-allowed',
                                  }}
                                />
                              )}

                              {/* % salvo em baixo (só para não-atual com dados) */}
                              {!isCur && !at100 && hasSaved && (
                                <div style={{ fontSize: 7, color: '#94a3b8', marginTop: 1 }}>
                                  {savedPct}%
                                </div>
                              )}
                            </td>
                          );
                        })}
                    </tr>
                  );
                }),
              ];
            })}
          </tbody>
        </table>
      </div>

      {/* Grand total — pinned to the bottom of the scroll area so it (and Save) stay visible without scrolling past a long list */}
      <div style={{
        position: 'sticky', bottom: 0, zIndex: 21,
        display:'flex', justifyContent:'flex-end', alignItems:'center', gap:20,
        padding:'10px 14px', background:'#f1f5f9', borderRadius:7, fontWeight:700, marginTop:6,
        boxShadow: '0 -4px 10px rgba(0,0,0,0.08)',
      }}>
        <span style={{ color:'#374151' }}>TOTAL CONTRACT: {fmtE(grand.contract, 2)}</span>
        <div style={{ textAlign:'right' }}>
          <div style={{ color:'#166534', fontSize:14 }}>WEEK REVENUE ({fmtWE(weekEnding)}): {fmtE(grand.week, 2)}</div>
          <div style={{ color:'#1e40af', fontSize:12, marginTop:2 }}>PROJECT CUMULATIVE: {fmtE(grand.cumul, 2)}</div>
        </div>
        {!readOnly && (
          <button onClick={save} disabled={saving} className="btn-primary"
            style={{ padding: '8px 18px', fontSize: 13, whiteSpace: 'nowrap' }}>
            {saving ? 'Saving…' : `Save ${fmtWE(weekEnding)}`}
          </button>
        )}
      </div>

      {showImport && (
        <ImportBOQModal
          projectId={projectId}
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); loadData(); }}
        />
      )}

      {addingSubFor != null && (
        <NewSubcontractModal
          projectId={projectId}
          onClose={() => setAddingSubFor(null)}
          onCreated={(sc) => {
            const forId = addingSubFor;
            setAddingSubFor(null);
            loadSubs();
            setSubEdits(s => ({ ...s, [forId]: sc.id }));
          }}
        />
      )}
    </div>
  );
}
