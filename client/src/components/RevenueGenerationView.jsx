import { useState, useEffect, useCallback } from 'react';

const fmt  = (n, d = 2) => n == null ? '—' : new Intl.NumberFormat('en-IE', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
const fmtE = (n, d = 0) => `€${fmt(n, d)}`;
const fmtWE     = iso => { const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}` : iso; };
const fmtDate   = iso => { const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : iso; };
const MONTHS    = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmtWEHead = iso => { const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${parseInt(m[3])} ${MONTHS[parseInt(m[2])-1]}` : iso; };
const isoWeekNum = iso => {
  const d = new Date(iso + 'T12:00:00');
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - y) / 86400000) + 1) / 7);
};

const SECTIONS = ['Prelim Fixed', 'Prelim Time', 'Civil Works', 'MEICA Works', 'Landscape', 'Commission'];
const SEC_COLOR = {
  'Prelim Fixed': '#1e40af', 'Prelim Time': '#d97706', 'Civil Works': '#166534',
  'MEICA Works': '#7c3aed', 'Landscape': '#0891b2', 'Commission': '#be185d',
};

function todayFriday() {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() - 5 + 7) % 7));
  return d.toISOString().slice(0, 10);
}

// Todas as sextas de Jan 2026 a Dez 2027
const ALL_WEEKS = (() => {
  const weeks = [];
  let d = new Date('2026-01-02T12:00:00');
  // avançar até à próxima sexta
  while (d.getDay() !== 5) d.setDate(d.getDate() + 1);
  const end = new Date('2027-12-31T12:00:00');
  while (d <= end) {
    weeks.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 7 * 24 * 60 * 60 * 1000);
  }
  return weeks;
})();

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

export default function RevenueGenerationView({ projectId }) {
  const [mode, setMode]         = useState('revenue');
  const [weekEnding, setWeek]   = useState(todayFriday());
  const [activities, setActs]   = useState([]);
  const [history, setHistory]   = useState({ weeks: [], data: {} });
  const [subs, setSubs]         = useState([]);
  const [edits, setEdits]       = useState({});    // { actId: { we: pct } }
  const [subEdits, setSubEdits] = useState({});    // { actId: sub_id } para a WE selecionada
  const [secOn, setSecOn]       = useState(new Set(SECTIONS));
  const [search, setSearch]     = useState('');
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  useEffect(() => {
    fetch(`/api/v1/projects/${projectId}/subcontracts`).then(r => r.json()).then(setSubs).catch(() => {});
  }, [projectId]);

  const loadData = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/v1/projects/${projectId}/revenue/week/${weekEnding}`).then(r => r.json()),
      fetch(`/api/v1/projects/${projectId}/revenue/history`).then(r => r.json()),
    ]).then(([weekData, histData]) => {
      const acts = weekData.activities || [];
      setActs(acts);

      // Inicializar edits com TODOS os valores de histórico para TODAS as semanas
      const m = {};
      const sm = {};
      acts.forEach(a => {
        m[a.id] = {};
        ALL_WEEKS.forEach(w => {
          m[a.id][w] = histData?.data?.[a.id]?.[w]?.pct ?? 0;
        });
        sm[a.id] = a.sub_id ?? '';
      });
      setEdits(m);
      setSubEdits(sm);
      setHistory(histData || { weeks: [], data: {} });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [projectId, weekEnding]);

  useEffect(() => { loadData(); }, [loadData]);

  const pctOf      = (a, w) => Number(edits[a.id]?.[w]) || 0;
  const revOf      = (a, w) => Math.round(pctOf(a, w) / 100 * (a.contract_value || 0) * 100) / 100;
  const totalPctOf = (a) => ALL_WEEKS.reduce((s, w) => s + (Number(edits[a.id]?.[w]) || 0), 0);
  const cumulOf = a => {
    let sum = 0;
    (history.weeks || []).forEach(w => { sum += history.data?.[a.id]?.[w]?.rev || 0; });
    return Math.round(sum * 100) / 100;
  };
  const remainOf = a => Math.max(0, Math.round(((a.contract_value || 0) - cumulOf(a)) * 100) / 100);

  const setPct = (id, w, v) => {
    const cur = Number(edits[id]?.[w]) || 0;
    const total = ALL_WEEKS.reduce((s, wk) => s + (Number(edits[id]?.[wk]) || 0), 0);
    const available = 100 - (total - cur);
    const n = Math.min(available, Math.max(0, parseFloat(v) || 0));
    setEdits(e => ({ ...e, [id]: { ...e[id], [w]: n } }));
  };
  const setSub = (id, v) => setSubEdits(s => ({ ...s, [id]: v }));

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
    const res = await fetch(`/api/v1/projects/${projectId}/revenue/week/${weekEnding}`,
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
    <div>
      {/* ── Controls sticky ─── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 20,
        background: '#f8fafc', paddingBottom: 6, paddingTop: 4,
        borderBottom: '1px solid #e2e8f0', marginBottom: 8,
      }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
          <div style={{ display: 'flex', borderRadius: 7, overflow: 'hidden', border: '1px solid #d1d5db' }}>
            {[['revenue', 'Revenue Generation'], ['contract', 'Contract BOQ']].map(([k, label]) => (
              <button key={k} onClick={() => setMode(k)}
                style={{ padding: '6px 14px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  background: mode === k ? '#1a1a2e' : '#fff', color: mode === k ? '#fff' : '#374151' }}>
                {label}
              </button>
            ))}
          </div>

          {mode === 'revenue' && (
            <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
              Save WE:&nbsp;
              <select value={weekEnding} onChange={e => setWeek(e.target.value)}
                style={{ padding: '5px 7px', borderRadius: 5, border: '1px solid #d1d5db', fontSize: 12 }}>
                {ALL_WEEKS.map(w => <option key={w} value={w}>{fmtDate(w)}</option>)}
              </select>
            </label>
          )}

          <input type="search" placeholder="Search activities…" value={search} onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 140, padding: '6px 10px', borderRadius: 5, border: '1px solid #d1d5db', fontSize: 12 }} />

          {mode === 'revenue' && (
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 9, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.05em' }}>Week Revenue</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#166534' }}>{fmtE(grand.week, 2)}</div>
                <div style={{ fontSize: 9, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.05em', marginTop: 1 }}>Cumulative</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1e40af' }}>{fmtE(grand.cumul, 2)}</div>
              </div>
              <button onClick={save} disabled={saving} className="btn-primary"
                style={{ padding: '8px 18px', fontSize: 13, whiteSpace: 'nowrap' }}>
                {saving ? 'Saving…' : `Save ${fmtWE(weekEnding)}`}
              </button>
            </div>
          )}
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
      <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 235px)' }}>
        <table style={{
          borderCollapse: 'collapse',
          minWidth: mode === 'revenue' ? FIXED_W + ALL_WEEKS.length * CW.we : 700,
          tableLayout: 'fixed',
          fontSize: 10,
        }}>
          <colgroup>
            <col style={{ width: CW.ref }} />
            <col style={{ width: CW.desc }} />
            {mode === 'revenue' && <>
              <col style={{ width: CW.cv }} />
              <col style={{ width: CW.cumul }} />
              <col style={{ width: CW.rem }} />
              <col style={{ width: CW.sub }} />
              {ALL_WEEKS.map(w => <col key={w} style={{ width: CW.we }} />)}
            </>}
            {mode === 'contract' && <>
              <col style={{ width: 68 }} /><col style={{ width: 40 }} />
              <col style={{ width: 86 }} /><col style={{ width: 94 }} />
            </>}
          </colgroup>

          <thead>
            <tr>
              <th style={thFixed(SL.ref,  { width: CW.ref  })}>Ref</th>
              <th style={thFixed(SL.desc, { width: CW.desc })}>Description</th>
              {mode === 'contract' && <>
                <th style={{ position:'sticky', top:0, zIndex:10, background:'#1e293b', color:'#fff', padding:'3px 4px', fontSize:8, fontWeight:700, textAlign:'right' }}>Qty</th>
                <th style={{ position:'sticky', top:0, zIndex:10, background:'#1e293b', color:'#fff', padding:'3px 4px', fontSize:8, fontWeight:700 }}>Unit</th>
                <th style={{ position:'sticky', top:0, zIndex:10, background:'#1e293b', color:'#fff', padding:'3px 4px', fontSize:8, fontWeight:700, textAlign:'right' }}>Rate</th>
                <th style={{ position:'sticky', top:0, zIndex:10, background:'#1e293b', color:'#fff', padding:'3px 4px', fontSize:8, fontWeight:700, textAlign:'right' }}>Contract €</th>
              </>}
              {mode === 'revenue' && <>
                <th style={thFixed(SL.cv,    { width: CW.cv,    textAlign:'right' })}>Contract €</th>
                <th style={thFixed(SL.cumul, { width: CW.cumul, textAlign:'right' })}>Cumul. €</th>
                <th style={thFixed(SL.rem,   { width: CW.rem,   textAlign:'right' })}>Remain. €</th>
                <th style={thFixed(SL.sub,   { width: CW.sub,   borderRight:'3px solid #60a5fa' })}>Subcontractor</th>
                {ALL_WEEKS.map(w => (
                  <th key={w} style={thWE(w)}>
                    <div style={{ fontSize: 8, fontWeight: 700 }}>WE {fmtWEHead(w)}</div>
                    <div style={{ fontSize: 7, opacity: .7, marginTop: 1 }}>Wk {isoWeekNum(w)}</div>
                  </th>
                ))}
              </>}
            </tr>
            {mode === 'revenue' && (
              <tr>
                <th colSpan={6} style={{ position:'sticky', top: THEAD_H, left:0, zIndex:14, background:'#1e3a8a', padding:0 }} />
                {ALL_WEEKS.map(w => {
                  const isCur = w === weekEnding;
                  return (
                    <th key={w} style={{ position:'sticky', top: THEAD_H, zIndex:9, background: isCur ? '#166534' : '#1e3a8a', padding:'1px 2px', borderLeft: isCur ? '2px solid #4ade80' : '1px solid #1e3a8a' }}>
                      <button onClick={() => setWeek(w)} className="tracker-edit-btn"
                        style={{ display: 'block', width: '100%', marginTop: 0,
                          background: isCur ? 'rgba(74,222,128,0.25)' : 'rgba(255,255,255,0.1)',
                          border: isCur ? '1px solid rgba(74,222,128,0.5)' : '1px solid rgba(255,255,255,0.2)',
                        }}>edit</button>
                    </th>
                  );
                })}
              </tr>
            )}
          </thead>

          <tbody>
            {SECTIONS.filter(s => secOn.has(s)).map(section => {
              const rows = visible.filter(a => a.section === section);
              if (!rows.length) return null;
              const secCV    = rows.reduce((s, a) => s + (a.contract_value || 0), 0);
              const secWeek  = rows.reduce((s, a) => s + revOf(a, weekEnding), 0);
              const secCumul = rows.reduce((s, a) => s + cumulOf(a), 0);
              const totalCols = mode === 'revenue' ? 6 + ALL_WEEKS.length : 6;

              const secStyle = {
                position: 'sticky', top: SEC_TOP,
                background: SEC_COLOR[section], color: '#fff',
                fontWeight: 700, fontSize: 10,
                borderBottom: '1px solid rgba(0,0,0,.12)',
              };
              const fixedSecCols = mode === 'revenue' ? 6 : 2;
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
                      {mode === 'revenue'
                        ? `Wk: ${fmtE(secWeek, 0)} | Cumul: ${fmtE(secCumul, 0)} / ${fmtE(secCV, 0)}`
                        : fmtE(secCV, 2)}
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

                      {mode === 'contract' && <>
                        <td style={{ textAlign:'right', padding:'2px 4px', color:'#111', fontSize:10 }}>{fmt(a.qty, 2)}</td>
                        <td style={{ padding:'2px 4px', color:'#6b7280', fontSize:10 }}>{a.unit}</td>
                        <td style={{ textAlign:'right', padding:'2px 4px', color:'#111', fontSize:10 }}>€{fmt(a.rate, 2)}</td>
                        <td style={{ textAlign:'right', padding:'2px 4px', fontWeight:600, color:'#111', fontSize:10 }}>€{fmt(a.contract_value, 2)}</td>
                      </>}

                      {mode === 'revenue' && <>
                        <td style={tdFixed(SL.cv,    rowBg, { width:CW.cv,    textAlign:'right', fontWeight:600 })}>€{fmt(a.contract_value, 0)}</td>
                        <td style={tdFixed(SL.cumul, rowBg, { width:CW.cumul, textAlign:'right', fontWeight:700, color:'#1e40af' })}>€{fmt(cumul, 0)}</td>
                        <td style={tdFixed(SL.rem,   rowBg, { width:CW.rem,   textAlign:'right', color: remaining === 0 ? '#16a34a' : '#374151', fontWeight: remaining === 0 ? 700 : 400 })}>€{fmt(remaining, 0)}</td>
                        <td style={tdFixed(SL.sub,   rowBg, { width:CW.sub,   padding:'2px 3px', borderRight:'3px solid #60a5fa' })}>
                          <select value={subEdits[a.id] ?? ''} onChange={e => setSub(a.id, e.target.value)}
                            style={{ width:'100%', padding:'1px 2px', fontSize:9, borderRadius:3, border:'1px solid #d1d5db', background:'#fff' }}>
                            <option value="">GMC (none)</option>
                            {subs.map(s => <option key={s.id} value={s.id}>{s.ref} — {s.subcontractor_name}</option>)}
                          </select>
                        </td>

                        {ALL_WEEKS.map(w => {
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
                                    border: `1px solid ${isCur ? '#16a34a' : '#d1d5db'}`,
                                    borderRadius: 3, fontSize: 9,
                                    background: isCur ? '#f0fdf4' : '#fff',
                                    fontWeight: isCur ? 700 : 400,
                                    color: '#111',
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
                      </>}
                    </tr>
                  );
                }),
              ];
            })}
          </tbody>
        </table>
      </div>

      {/* Grand total */}
      <div style={{ display:'flex', justifyContent:'flex-end', gap:20, padding:'10px 14px', background:'#f1f5f9', borderRadius:7, fontWeight:700, marginTop:6 }}>
        <span style={{ color:'#374151' }}>TOTAL CONTRACT: {fmtE(grand.contract, 2)}</span>
        {mode === 'revenue' && (
          <div style={{ textAlign:'right' }}>
            <div style={{ color:'#166534', fontSize:14 }}>WEEK REVENUE ({fmtWE(weekEnding)}): {fmtE(grand.week, 2)}</div>
            <div style={{ color:'#1e40af', fontSize:12, marginTop:2 }}>PROJECT CUMULATIVE: {fmtE(grand.cumul, 2)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
