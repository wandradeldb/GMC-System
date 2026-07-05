import { apiFetch } from '../apiFetch.js';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useZoom } from '../zoomContext.js';

const fmt = n => n == null ? '—' : new Intl.NumberFormat('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const fmtDate = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-IE', { day:'numeric', month:'short', year:'numeric' }) : '—';
const fmtWE   = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-IE', { day:'numeric', month:'short' }) : '—';

const CAT_STYLE = {
  Plant:    { bg:'#fef3c7', color:'#92400e', border:'#d97706' },
  Material: { bg:'#dbeafe', color:'#1e40af', border:'#3b82f6' },
  Labour:   { bg:'#dcfce7', color:'#166534', border:'#22c55e' },
  Salary:   { bg:'#f3e8ff', color:'#7c3aed', border:'#a855f7' },
  Overhead: { bg:'#f0f9ff', color:'#0369a1', border:'#38bdf8' },
  Sundry:   { bg:'#fdf4ff', color:'#86198f', border:'#c026d3' },
  Sub:      { bg:'#fff7ed', color:'#c2410c', border:'#f97316' },
  Other:    { bg:'#f8fafc', color:'#475569', border:'#94a3b8' },
};

function CatBadge({ category }) {
  const s = CAT_STYLE[category] || CAT_STYLE.Other;
  return (
    <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`,
      borderRadius: 12, padding: '2px 8px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {category}
    </span>
  );
}

export default function QSCostsView({ projectId, readOnly }) {
  const zoom = useZoom();
  const [data,       setData]       = useState(null);
  const [search,     setSearch]     = useState('');
  const [gang,       setGang]       = useState('');
  const [category,   setCategory]   = useState('');
  const [week,       setWeek]       = useState('');
  const [importing,  setImporting]  = useState(false);
  const [importMsg,  setImportMsg]  = useState(null);
  const [viewMode,   setViewMode]   = useState('list'); // 'list' | 'summary'
  const [selected,   setSelected]   = useState(new Set()); // row IDs for delete
  const [deleting,   setDeleting]   = useState(false);
  const fileRef = useRef();

  const load = useCallback(() => {
    const params = new URLSearchParams({ limit: 500 });
    if (gang)     params.set('gang', gang);
    if (category) params.set('category', category);
    if (week)     params.set('week', week);
    if (search)   params.set('search', search);
    apiFetch(`/api/v1/projects/${projectId}/qs-costs?${params}`)
      .then(r => r.json()).then(setData);
  }, [projectId, gang, category, week, search]);

  useEffect(() => { load(); }, [load]);

  const handleImport = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportMsg(null);
    const form = new FormData();
    form.append('file', file);
    const res = await apiFetch(`/api/v1/projects/${projectId}/qs-costs/import`, { method: 'POST', body: form });
    const json = await res.json();
    setImporting(false);
    if (json.ok) {
      setImportMsg({ type: 'ok', text: `${json.imported} transactions imported from "${json.source_file}" (sheet: ${json.sheet_used})` });
      load();
    } else {
      setImportMsg({ type: 'err', text: json.error });
    }
    fileRef.current.value = '';
  };

  const clearFilters = () => { setSearch(''); setGang(''); setCategory(''); setWeek(''); };
  const hasFilters   = search || gang || category || week;

  const toggleSelect = (id) => {
    const newSelected = new Set(selected);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelected(newSelected);
  };

  const toggleSelectAll = (rows) => {
    if (selected.size === rows.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map(r => r.id)));
    }
  };

  const handleDelete = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} transaction${ids.length > 1 ? 's' : ''}? This cannot be undone.`)) return;

    setDeleting(true);
    try {
      const res = await apiFetch(`/api/v1/projects/${projectId}/qs-costs`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
      });
      const json = await res.json();
      if (json.ok) {
        setImportMsg({ type: 'ok', text: `${json.deleted} transaction${json.deleted > 1 ? 's' : ''} deleted` });
        setSelected(new Set());
        load();
      } else {
        setImportMsg({ type: 'err', text: json.error || 'Delete failed' });
      }
    } catch (e) {
      setImportMsg({ type: 'err', text: e.message });
    } finally {
      setDeleting(false);
    }
  };

  if (!data) return <div className="state-box"><div className="icon">⏳</div><p>Loading QS Costs…</p></div>;

  const { rows, summary, filters } = data;
  const grandTotal = summary.reduce((s, r) => s + r.total, 0);

  return (
    <div>
      {/* ── Toolbar ─────────────────────────────────────────────── */}
      <div className="sc-toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h2 className="sc-title">QS Costs</h2>
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          <div className="type-filters">
            <button className={`tab-btn ${viewMode === 'list' ? 'active' : ''}`} onClick={() => setViewMode('list')}>Transactions</button>
            <button className={`tab-btn ${viewMode === 'summary' ? 'active' : ''}`} onClick={() => setViewMode('summary')}>By Week</button>
            <button className={`tab-btn ${viewMode === 'materials' ? 'active' : ''}`} onClick={() => setViewMode('materials')}>📦 Materials List (Conquest)</button>
          </div>
          {!readOnly && <label className="btn-primary" style={{ cursor:'pointer', position:'relative' }}>
            {importing ? 'Importing…' : '⬆ Import Excel'}
            <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleImport}
              style={{ position:'absolute', inset:0, opacity:0, cursor:'pointer' }} />
          </label>}
        </div>
      </div>

      {importMsg && (
        <div style={{ margin:'8px 0', padding:'8px 14px', borderRadius:6, fontSize:13,
          background: importMsg.type === 'ok' ? '#dcfce7' : '#fee2e2',
          color:      importMsg.type === 'ok' ? '#166534' : '#991b1b',
          border: `1px solid ${importMsg.type === 'ok' ? '#bbf7d0' : '#fecaca'}` }}>
          {importMsg.text}
        </div>
      )}

      {/* ── Summary totals strip ─────────────────────────────────── */}
      {summary.length > 0 && (
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', margin:'12px 0' }}>
          {summary.map(s => {
            const st = CAT_STYLE[s.cost_category] || CAT_STYLE.Other;
            return (
              <div key={s.cost_category}
                onClick={() => setCategory(category === s.cost_category ? '' : s.cost_category)}
                style={{ background: st.bg, border:`1px solid ${category === s.cost_category ? st.border : '#e5e7eb'}`,
                  borderRadius:8, padding:'8px 14px', cursor:'pointer',
                  boxShadow: category === s.cost_category ? `0 0 0 2px ${st.border}` : 'none' }}>
                <div style={{ fontSize:11, color: st.color, fontWeight:600 }}>{s.cost_category}</div>
                <div style={{ fontSize:16, fontWeight:700, color: st.color }}>€{fmt(s.total)}</div>
                <div style={{ fontSize:11, color:'#9ca3af' }}>{s.count} txns</div>
              </div>
            );
          })}
          <div style={{ background:'#1a1a2e', borderRadius:8, padding:'8px 14px', marginLeft:'auto' }}>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.6)', fontWeight:600 }}>TOTAL</div>
            <div style={{ fontSize:16, fontWeight:700, color:'#fff' }}>€{fmt(grandTotal)}</div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.5)' }}>{rows.length} rows</div>
          </div>
        </div>
      )}

      {/* ── Filter bar ──────────────────────────────────────────── */}
      <div className="filter-bar">
        <input
          placeholder="Search description, supplier, plant…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ minWidth: 240 }}
        />

        {/* Sub/Gang filter */}
        <select
          value={gang}
          onChange={e => setGang(e.target.value)}
          style={{ padding:'7px 10px', borderRadius:6, border:'1px solid #d1d5db', fontSize:13, background:'#fff' }}>
          <option value="">All Subs / Gangs</option>
          {filters.gangs.map(g => <option key={g} value={g}>{g}</option>)}
        </select>

        {/* Category chips */}
        <div className="type-filters" style={{ flexWrap:'wrap' }}>
          {['Plant','Material','Labour','Salary','Overhead','Sundry','Sub'].map(cat => {
            const st = CAT_STYLE[cat] || CAT_STYLE.Other;
            return (
              <button key={cat}
                onClick={() => setCategory(category === cat ? '' : cat)}
                style={{
                  padding:'4px 10px', borderRadius:20, border:`1px solid ${category === cat ? st.border : '#d1d5db'}`,
                  fontSize:12, fontWeight:600, cursor:'pointer',
                  background: category === cat ? st.bg : '#fff',
                  color: category === cat ? st.color : '#6b7280',
                }}>
                {cat}
              </button>
            );
          })}
        </div>

        {/* Week filter */}
        <select
          value={week}
          onChange={e => setWeek(e.target.value)}
          style={{ padding:'7px 10px', borderRadius:6, border:'1px solid #d1d5db', fontSize:13, background:'#fff' }}>
          <option value="">All Weeks</option>
          {filters.weeks.map(w => <option key={w} value={w}>WE {fmtWE(w)}</option>)}
        </select>

        {hasFilters && (
          <button onClick={clearFilters}
            style={{ padding:'6px 12px', borderRadius:6, border:'1px solid #d1d5db', background:'#fff', fontSize:12, cursor:'pointer', color:'#6b7280' }}>
            Clear ✕
          </button>
        )}
        {selected.size > 0 && (
          <button onClick={handleDelete} disabled={deleting}
            style={{ padding:'6px 12px', borderRadius:6, border:'1px solid #dc2626', background:'#fee2e2', fontSize:12, cursor: deleting ? 'wait' : 'pointer', color:'#991b1b', fontWeight:600 }}>
            {deleting ? 'Deleting…' : `🗑 Delete ${selected.size}`}
          </button>
        )}
      </div>

      {/* ── View: By Week Summary ─────────────────────────────────── */}
      {viewMode === 'summary' && <WeekSummaryView projectId={projectId} />}

      {/* ── View: Materials List (Conquest) — placeholder, not built yet ── */}
      {viewMode === 'materials' && (
        <div className="state-box">
          <div className="icon">📦</div>
          <p>Materials List (Conquest) — coming soon.</p>
          <p style={{ fontSize: 12, color: '#9ca3af', maxWidth: 420, margin: '4px auto 0' }}>
            Will import the Conquest materials list; each procurement purchase-list import will deduct from the Conquest total.
          </p>
        </div>
      )}

      {/* ── View: Transaction List ───────────────────────────────── */}
      {viewMode === 'list' && (
        rows.length === 0 ? (
          <div className="state-box">
            <div className="icon">📋</div>
            <p>{filters.gangs.length === 0
              ? 'No QS Cost data yet. Import an Excel file with the "QS Costs" sheet.'
              : 'No transactions match the current filters.'}</p>
          </div>
        ) : (
          <div style={{ overflowX:'auto', zoom: `${zoom}%` }}>
            <table className="boq-table" style={{ minWidth:900 }}>
              <thead>
                <tr>
                  <th style={{ width:32, textAlign:'center', padding:'4px' }}>
                    <input type="checkbox"
                      checked={data.rows.length > 0 && selected.size === data.rows.length}
                      onChange={() => toggleSelectAll(data.rows)}
                      style={{ cursor:'pointer' }} />
                  </th>
                  <th>Date</th>
                  <th>WE</th>
                  <th>Sub / Gang</th>
                  <th>Category</th>
                  <th>Code</th>
                  <th>Description</th>
                  <th>Supplier</th>
                  <th style={{textAlign:'right'}}>Qty</th>
                  <th style={{textAlign:'right'}}>Unit Value</th>
                  <th style={{textAlign:'right'}}>Cost</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td style={{ width:32, textAlign:'center', padding:'4px' }}>
                      <input type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() => toggleSelect(r.id)}
                        style={{ cursor:'pointer' }} />
                    </td>
                    <td style={{whiteSpace:'nowrap'}}>{fmtDate(r.trans_date)}</td>
                    <td style={{whiteSpace:'nowrap', color:'#6b7280', fontSize:12}}>WE {fmtWE(r.week_ending)}</td>
                    <td style={{fontWeight:600, maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}
                      title={r.gang_name}>{r.gang_name || '—'}</td>
                    <td><CatBadge category={r.cost_category} /></td>
                    <td style={{fontSize:11, color:'#6b7280', fontFamily:'monospace'}}>{r.cost_code}</td>
                    <td style={{maxWidth:220, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}
                      title={r.stock_item_text || r.plant_description}>
                      {r.stock_item_text || r.plant_description || '—'}
                    </td>
                    <td style={{maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:12, color:'#6b7280'}}
                      title={r.supplier_name}>{r.supplier_name || '—'}</td>
                    <td style={{textAlign:'right', fontVariantNumeric:'tabular-nums'}}>{r.qty ?? '—'}</td>
                    <td style={{textAlign:'right', fontVariantNumeric:'tabular-nums'}}>
                      {r.unit_value != null ? `€${fmt(r.unit_value)}` : '—'}
                    </td>
                    <td style={{textAlign:'right', fontWeight:600, fontVariantNumeric:'tabular-nums', color: r.cost < 0 ? '#dc2626' : '#1a1a2e'}}>
                      €{fmt(r.cost)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{background:'#f8fafc', fontWeight:700}}>
                  <td colSpan={10} style={{textAlign:'right', paddingRight:8}}>Total ({rows.length} transactions)</td>
                  <td style={{textAlign:'right', fontVariantNumeric:'tabular-nums'}}>
                    €{fmt(rows.reduce((s, r) => s + (r.cost || 0), 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )
      )}
    </div>
  );
}

// ── Weekly summary sub-view ───────────────────────────────────────────────────
function WeekSummaryView({ projectId }) {
  const zoom = useZoom();
  const [rows, setRows] = useState([]);

  useEffect(() => {
    apiFetch(`/api/v1/projects/${projectId}/qs-costs/summary-by-week`)
      .then(r => r.json()).then(setRows);
  }, [projectId]);

  // Pivot: week → { category: total }
  const weeks = [...new Set(rows.map(r => r.week_ending))].sort();
  const cats  = [...new Set(rows.map(r => r.cost_category))].sort();
  const pivot = {};
  rows.forEach(r => {
    if (!pivot[r.week_ending]) pivot[r.week_ending] = {};
    pivot[r.week_ending][r.cost_category] = r.total;
  });

  if (!weeks.length) return <div className="state-box"><div className="icon">📊</div><p>No weekly data yet.</p></div>;

  return (
    <div style={{ overflowX:'auto', marginTop:8, zoom: `${zoom}%` }}>
      <table className="boq-table" style={{ minWidth:600 }}>
        <thead>
          <tr>
            <th>Week Ending</th>
            {cats.map(c => <th key={c} style={{textAlign:'right'}}>{c}</th>)}
            <th style={{textAlign:'right'}}>Week Total</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map(w => {
            const weekData = pivot[w] || {};
            const weekTotal = cats.reduce((s, c) => s + (weekData[c] || 0), 0);
            return (
              <tr key={w}>
                <td style={{fontWeight:600}}>WE {fmtWE(w)}</td>
                {cats.map(c => (
                  <td key={c} style={{textAlign:'right', fontVariantNumeric:'tabular-nums', color: weekData[c] ? '#1a1a2e' : '#d1d5db'}}>
                    {weekData[c] ? `€${fmt(weekData[c])}` : '—'}
                  </td>
                ))}
                <td style={{textAlign:'right', fontWeight:700, fontVariantNumeric:'tabular-nums'}}>€{fmt(weekTotal)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{background:'#f8fafc', fontWeight:700}}>
            <td>TOTAL</td>
            {cats.map(c => {
              const t = rows.filter(r => r.cost_category === c).reduce((s,r) => s+r.total, 0);
              return <td key={c} style={{textAlign:'right', fontVariantNumeric:'tabular-nums'}}>€{fmt(t)}</td>;
            })}
            <td style={{textAlign:'right', fontVariantNumeric:'tabular-nums'}}>
              €{fmt(rows.reduce((s,r) => s+r.total,0))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
