import { apiFetch } from '../apiFetch.js';
import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import ImportBOQModal from './ImportBOQModal.jsx';

// Labels conhecidos para os schedules do piloto Merlin Park — cosmético apenas.
// Qualquer outro schedule (ex: de um novo projeto importado) cai no fallback (label = o próprio código).
const SCHED_LABELS = { '1': 'Prel. Fixed', '1A': 'Prel. Time', '2': 'Pump Station' };

const fmt = (n) =>
  n === 0 || n == null
    ? <span className="zero">—</span>
    : new Intl.NumberFormat('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const fmt2 = (n) => new Intl.NumberFormat('en-IE', { minimumFractionDigits: 2 }).format(n);

const HEAD_H = 34;   // column-header row height (sticky at top)
const ROW_ODD  = '#f0f6ff';
const ROW_EVEN = '#ffd8bb';

const thStyle = {
  position: 'sticky', top: 0, zIndex: 5,
  background: '#1a1a2e', color: '#fff',
  padding: '8px 10px', fontSize: 11, fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap',
};

export default function BOQView({ projectId, schedule, scheduleLabels = SCHED_LABELS, readOnly }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [scheds,  setScheds]  = useState(null); // null = "not yet seeded" -> show all schedules present in data
  const [showImport, setShowImport] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDeleteBill = async () => {
    const typed = prompt(
      `This permanently deletes ALL ${data?.totals?.item_count ?? ''} Bill of Quantities items for this project. This cannot be undone.\n\nType DELETE to confirm:`
    );
    if (typed?.trim().toUpperCase() !== 'DELETE') { if (typed !== null) alert('Confirmation text did not match — nothing was deleted.'); return; }
    setDeleting(true);
    const r = await apiFetch(`/api/v1/projects/${projectId}/boq`, { method: 'DELETE' });
    setDeleting(false);
    if (!r.ok) { const d = await r.json().catch(() => ({})); alert(`Could not delete: ${d.error || 'Unknown error'}`); return; }
    reload();
  };

  const reload = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ group: 'schedule' });
    if (schedule) params.set('schedule', schedule);

    apiFetch(`/api/v1/projects/${projectId}/boq?${params}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [projectId, schedule]);

  useEffect(() => { reload(); }, [reload]);

  // Schedule order follows the server's response — it's already the source file's natural bill
  // order (e.g. Prelim Fixed, Prelim Time, Civil Works, MEICA Works, Landscape, Commission), not
  // re-sorted alphabetically, so it reads the same way the original spreadsheet does.
  const allSchedules = useMemo(
    () => Object.keys(data?.grouped || {}),
    [data]
  );

  useEffect(() => {
    if (data?.grouped) setScheds(new Set(Object.keys(data.grouped)));
  }, [data]);

  const toggleSched = (s) =>
    setScheds(prev => {
      const next = new Set(prev || allSchedules);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });

  const filteredGrouped = useMemo(() => {
    if (!data?.grouped) return {};
    const q = search.toLowerCase();
    const activeScheds = scheds || new Set(allSchedules);

    const result = {};
    for (const [sch, sections] of Object.entries(data.grouped)) {
      if (!activeScheds.has(sch)) continue;          // filtra por schedule
      const filteredSections = {};
      for (const [sec, items] of Object.entries(sections)) {
        const filtered = items.filter(item =>
          (!q ||
            item.description.toLowerCase().includes(q) ||
            item.item_ref.toLowerCase().includes(q))
        );
        if (filtered.length) filteredSections[sec] = filtered;
      }
      if (Object.keys(filteredSections).length) result[sch] = filteredSections;
    }
    return result;
  }, [data, search, scheds, allSchedules]);

  const subtotalFor = (sch) => {
    if (!filteredGrouped[sch]) return 0;
    return Object.values(filteredGrouped[sch])
      .flat()
      .reduce((acc, item) => acc + (item.contract_sum || 0), 0);
  };

  if (loading) return (
    <div className="state-box">
      <div className="icon">⏳</div>
      <p>Loading BOQ…</p>
    </div>
  );

  if (!data) return (
    <div className="state-box">
      <div className="icon">⚠️</div>
      <p>Failed to load BOQ data.</p>
    </div>
  );

  const visibleSchedules = allSchedules.filter(s => filteredGrouped[s]);
  const activeScheds = scheds || new Set(allSchedules);
  const grandTotal = visibleSchedules.reduce((sum, sch) => sum + subtotalFor(sch), 0);

  let dataRowIdx = 0;

  return (
    <div>
      <div className="filter-bar">
        <input
          type="search"
          placeholder="Search items…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="type-filters" style={{ display:'flex', alignItems:'center', gap:14, flexWrap:'wrap' }}>
          {allSchedules.map(s => (
            <label key={s} style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', fontSize:13, fontWeight:600, color:'#374151' }}>
              <input type="checkbox" checked={activeScheds.has(s)} onChange={() => toggleSched(s)}
                style={{ width:16, height:16, cursor:'pointer', accentColor:'#1a1a2e' }} />
              {scheduleLabels[s] || s}
            </label>
          ))}
          {allSchedules.length > 0 && (
            <button
              onClick={() => { setScheds(new Set(allSchedules)); setSearch(''); }}
              title="Show all"
              style={{ padding:'4px 12px', borderRadius:6, border:'1px solid #d1d5db', background:'#f9fafb',
                cursor:'pointer', fontSize:12, color:'#6b7280' }}>
              ✕ Clear
            </button>
          )}
          {!readOnly && (
            <button className="btn-primary" onClick={() => setShowImport(true)}>+ Import BOQ</button>
          )}
          {!readOnly && allSchedules.length > 0 && (
            <button
              onClick={handleDeleteBill}
              disabled={deleting}
              title="Permanently delete all BOQ items for this project"
              style={{ padding:'6px 14px', borderRadius:6, border:'1px solid #fca5a5', background:'#fef2f2',
                cursor: deleting ? 'default' : 'pointer', fontSize:13, fontWeight:600, color:'#b91c1c' }}>
              🗑 {deleting ? 'Deleting…' : 'Delete Bill'}
            </button>
          )}
        </div>
      </div>

      {allSchedules.length === 0 ? (
        <div className="state-box">
          <div className="icon">📋</div>
          <p>No BOQ items yet.</p>
          {!readOnly && (
            <button className="btn-primary" style={{ marginTop: 10 }} onClick={() => setShowImport(true)}>+ Import BOQ</button>
          )}
        </div>
      ) : visibleSchedules.length === 0 ? (
        <div className="state-box">
          <div className="icon">🔍</div>
          <p>No items match your filters.</p>
        </div>
      ) : (
        <>
          {/* Total stays visible above the scrolling table, not buried at the bottom */}
          <div style={{
            display: 'flex', justifyContent: 'flex-end', alignItems: 'baseline', gap: 10,
            padding: '9px 14px', background: '#1a1a2e', color: '#fff',
            borderRadius: 7, marginBottom: 8,
          }}>
            <span style={{ fontSize: 11, opacity: .7, textTransform: 'uppercase', letterSpacing: '.06em' }}>Total Contract</span>
            <span style={{ fontSize: 17, fontWeight: 800 }}>€ {fmt2(grandTotal)}</span>
          </div>

          <div style={{ overflowY: 'auto', overflowX: 'auto', maxHeight: 'calc(100vh - 300px)' }}>
            <table className="boq-table" style={{ tableLayout: 'fixed' }}>
              <colgroup>
                <col className="col-ref" />
                <col className="col-desc" />
                <col className="col-num" />
                <col className="col-unit" />
                <col className="col-num" />
                <col className="col-num" />
              </colgroup>
              <thead>
                <tr>
                  <th style={thStyle}>Ref</th>
                  <th style={thStyle}>Description</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Qty</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>Unit</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Rate (€)</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Contract Sum (€)</th>
                </tr>
              </thead>
              <tbody>
                {visibleSchedules.map(sch => (
                  <Fragment key={sch}>
                    <tr>
                      <td colSpan={6} style={{
                        position: 'sticky', top: HEAD_H, zIndex: 4,
                        background: '#374151', color: '#fff',
                        padding: '6px 10px', fontSize: 13, fontWeight: 700,
                        textTransform: 'uppercase', letterSpacing: '0.04em',
                      }}>
                        <span>{scheduleLabels[sch] || sch}</span>
                        <span style={{ float: 'right', fontVariantNumeric: 'tabular-nums' }}>€ {fmt2(subtotalFor(sch))}</span>
                      </td>
                    </tr>

                    {Object.entries(filteredGrouped[sch]).map(([section, items]) => (
                      <Fragment key={section}>
                        <tr>
                          <td colSpan={6} style={{
                            padding: '7px 12px', background: '#f8fafc', fontSize: 12,
                            fontWeight: 600, color: '#374151', borderLeft: '3px solid #cbd5e1',
                          }}>
                            {section}
                          </td>
                        </tr>
                        {items.map(item => {
                          dataRowIdx++;
                          const rowBg = dataRowIdx % 2 !== 0 ? ROW_ODD : ROW_EVEN;
                          return (
                            <tr key={item.id}>
                              <td className="col-ref" style={{ background: rowBg }}>{item.item_ref}</td>
                              <td className="col-desc" style={{ background: rowBg }}>{item.description}</td>
                              <td className="col-num" style={{ background: rowBg }}>{fmt(item.qty)}</td>
                              <td className="col-unit" style={{ background: rowBg }}>{item.unit}</td>
                              <td className="col-num" style={{ background: rowBg }}>{fmt(item.rate)}</td>
                              <td className="col-num" style={{ background: rowBg, fontWeight: item.contract_sum > 0 ? 600 : 400 }}>
                                {fmt(item.contract_sum)}
                              </td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showImport && (
        <ImportBOQModal
          projectId={projectId}
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); reload(); }}
        />
      )}
    </div>
  );
}
