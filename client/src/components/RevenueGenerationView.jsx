import { useState, useEffect, useCallback } from 'react';

const fmt  = (n, d = 2) => n == null ? '—' : new Intl.NumberFormat('en-IE', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
const fmtE = (n, d = 0) => `€${fmt(n, d)}`;

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
function fridayRange(ref, before = 10, after = 4) {
  const out = [];
  for (let i = -before; i <= after; i++) {
    const d = new Date(ref + 'T12:00:00');
    d.setDate(d.getDate() + i * 7);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
const fmtDate = iso => { const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : iso; };

export default function RevenueGenerationView({ projectId }) {
  const [mode, setMode]         = useState('revenue');     // 'revenue' | 'contract'
  const [weekEnding, setWeek]   = useState(todayFriday());
  const [activities, setActs]   = useState([]);
  const [subs, setSubs]         = useState([]);
  const [edits, setEdits]       = useState({});            // id -> { pct, sub_id }
  const [secOn, setSecOn]       = useState(new Set(SECTIONS));
  const [search, setSearch]     = useState('');
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  useEffect(() => {
    fetch(`/api/v1/projects/${projectId}/subcontracts`).then(r => r.json()).then(setSubs).catch(() => {});
  }, [projectId]);

  const loadWeek = useCallback(() => {
    setLoading(true);
    fetch(`/api/v1/projects/${projectId}/revenue/week/${weekEnding}`)
      .then(r => r.json())
      .then(d => {
        setActs(d.activities || []);
        const m = {};
        (d.activities || []).forEach(a => { m[a.id] = { pct: a.pct_complete || 0, sub_id: a.sub_id ?? '' }; });
        setEdits(m);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [projectId, weekEnding]);

  useEffect(() => { loadWeek(); }, [loadWeek]);

  const weeks = fridayRange(todayFriday());
  const subName = id => {
    if (id == null || id === '') return 'GMC (none)';
    const s = subs.find(x => x.id === Number(id));
    return s ? `${s.ref} — ${s.subcontractor_name}` : `#${id}`;
  };

  const pctOf = a => Number(edits[a.id]?.pct) || 0;
  const revOf = a => Math.round(pctOf(a) / 100 * (a.contract_value || 0) * 100) / 100;

  const setPct = (id, v) => {
    const n = Math.max(0, parseFloat(v) || 0);
    setEdits(e => ({ ...e, [id]: { ...e[id], pct: n } }));
  };
  const setSub = (id, v) => setEdits(e => ({ ...e, [id]: { ...e[id], sub_id: v } }));

  const onKey = (e, idx) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const inputs = Array.from(document.querySelectorAll('input.rev-pct'));
    const next = inputs[idx + (e.key === 'ArrowDown' ? 1 : -1)];
    if (next) { next.focus(); next.select(); }
  };

  const save = async () => {
    setSaving(true); setSavedMsg('');
    const items = activities.map(a => ({ activity_id: a.id, pct_complete: pctOf(a), sub_id: edits[a.id]?.sub_id || null }));
    const res = await fetch(`/api/v1/projects/${projectId}/revenue/week/${weekEnding}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
    const j = await res.json();
    setSaving(false);
    if (j.ok) { setSavedMsg(`Saved — week revenue ${fmtE(j.rev_total_week, 2)} (fed to Tracker)`); loadWeek(); }
    else setSavedMsg(j.error || 'Error saving');
  };

  if (loading) return <div className="state-box"><div className="icon">⏳</div><p>Loading…</p></div>;

  const q = search.toLowerCase();
  const visible = activities.filter(a => secOn.has(a.section) &&
    (!q || a.description.toLowerCase().includes(q) || (a.ref || '').toLowerCase().includes(q)));

  const grand = { contract: 0, revenue: 0 };
  activities.forEach(a => { grand.contract += a.contract_value || 0; });
  visible.forEach(a => { grand.revenue += revOf(a); });

  let rowIdx = -1;

  return (
    <div>
      {/* ── Controls ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid #d1d5db' }}>
          {[['revenue', 'Revenue Generation'], ['contract', 'Contract BOQ']].map(([k, label]) => (
            <button key={k} onClick={() => setMode(k)}
              style={{ padding: '7px 16px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                background: mode === k ? '#1a1a2e' : '#fff', color: mode === k ? '#fff' : '#374151' }}>
              {label}
            </button>
          ))}
        </div>

        {mode === 'revenue' && (
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
            Week Ending:&nbsp;
            <select value={weekEnding} onChange={e => setWeek(e.target.value)}
              style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }}>
              {weeks.map(w => <option key={w} value={w}>{fmtDate(w)}</option>)}
            </select>
          </label>
        )}

        <input type="search" placeholder="Search activities…" value={search} onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 180, padding: '7px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }} />

        {mode === 'revenue' && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 14, alignItems: 'center' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: '#9ca3af' }}>WEEK REVENUE</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#166534' }}>{fmtE(grand.revenue, 2)}</div>
            </div>
            <button onClick={save} disabled={saving} className="btn-primary" style={{ padding: '8px 22px', fontSize: 14 }}>
              {saving ? 'Saving…' : 'Save week'}
            </button>
          </div>
        )}
      </div>

      {/* Section checkboxes */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
        {SECTIONS.map(s => (
          <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: SEC_COLOR[s] }}>
            <input type="checkbox" checked={secOn.has(s)} onChange={() => setSecOn(prev => {
              const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n;
            })} style={{ width: 16, height: 16, cursor: 'pointer', accentColor: SEC_COLOR[s] }} />
            {s}
          </label>
        ))}
        <button onClick={() => { setSecOn(new Set(SECTIONS)); setSearch(''); }}
          style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid #d1d5db', background: '#f9fafb', cursor: 'pointer', fontSize: 12, color: '#6b7280' }}>
          ✕ Clear
        </button>
      </div>

      {savedMsg && <div style={{ background: '#f0fdf4', border: '1px solid #86efac', color: '#166534', padding: '8px 12px', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{savedMsg}</div>}

      {/* ── Tables by section ────────────────────────────────────── */}
      {SECTIONS.filter(s => secOn.has(s)).map(section => {
        const rows = visible.filter(a => a.section === section);
        if (!rows.length) return null;
        const secContract = rows.reduce((s, a) => s + (a.contract_value || 0), 0);
        const secRevenue = rows.reduce((s, a) => s + revOf(a), 0);
        return (
          <div key={section} style={{ marginBottom: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              background: SEC_COLOR[section], color: '#fff', padding: '6px 14px', borderRadius: '6px 6px 0 0', fontWeight: 700, fontSize: 14 }}>
              <span>{section}</span>
              <span>{mode === 'revenue' ? `${fmtE(secRevenue, 2)} / ${fmtE(secContract, 0)}` : fmtE(secContract, 2)}</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="boq-table" style={{ minWidth: mode === 'revenue' ? 880 : 700 }}>
                <thead>
                  <tr>
                    <th>Ref</th><th>Description</th>
                    {mode === 'contract' && <><th style={{ textAlign: 'right' }}>Qty</th><th>Unit</th><th style={{ textAlign: 'right' }}>Rate</th></>}
                    <th style={{ textAlign: 'right' }}>Contract €</th>
                    {mode === 'revenue' && <>
                      <th style={{ textAlign: 'center' }}>% Week ✎</th>
                      <th>Subcontractor ✎</th>
                      <th style={{ textAlign: 'right' }}>Revenue €</th>
                    </>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(a => {
                    rowIdx++;
                    const idx = rowIdx;
                    return (
                      <tr key={a.id}>
                        <td style={{ fontFamily: 'monospace', fontSize: 11, whiteSpace: 'nowrap' }}>{a.ref}</td>
                        <td style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }} title={a.description}>{a.description}</td>
                        {mode === 'contract' && <>
                          <td style={{ textAlign: 'right', fontSize: 12 }}>{fmt(a.qty, 2)}</td>
                          <td style={{ fontSize: 12, color: '#6b7280' }}>{a.unit}</td>
                          <td style={{ textAlign: 'right', fontSize: 12 }}>€{fmt(a.rate, 2)}</td>
                        </>}
                        <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 600 }}>€{fmt(a.contract_value, 2)}</td>
                        {mode === 'revenue' && <>
                          <td style={{ textAlign: 'center', background: '#f0fdf4', padding: '2px 4px' }}>
                            <input type="number" min={0} step={1} className="cell-input rev-pct"
                              value={edits[a.id]?.pct ?? 0}
                              onChange={e => setPct(a.id, e.target.value)}
                              onKeyDown={e => onKey(e, idx)}
                              style={{ width: 60, textAlign: 'right', padding: '3px 5px', border: '1px solid #16a34a', borderRadius: 4, fontSize: 12, background: '#f0fdf4', fontWeight: 600 }} />
                          </td>
                          <td style={{ padding: '2px 4px' }}>
                            <select value={edits[a.id]?.sub_id ?? ''} onChange={e => setSub(a.id, e.target.value)}
                              style={{ width: 200, padding: '3px 4px', fontSize: 12, borderRadius: 4, border: '1px solid #d1d5db' }}>
                              <option value="">GMC (none)</option>
                              {subs.map(s => <option key={s.id} value={s.id}>{s.ref} — {s.subcontractor_name}</option>)}
                            </select>
                          </td>
                          <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: revOf(a) > 0 ? '#166534' : '#9ca3af' }}>
                            {revOf(a) > 0 ? fmtE(revOf(a), 2) : '—'}
                          </td>
                        </>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {/* Grand total */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 30, padding: '12px 16px', background: '#f1f5f9', borderRadius: 8, fontWeight: 700 }}>
        <span>TOTAL CONTRACT: {fmtE(grand.contract, 2)}</span>
        {mode === 'revenue' && <span style={{ color: '#166534' }}>WEEK REVENUE: {fmtE(grand.revenue, 2)}</span>}
      </div>
    </div>
  );
}
