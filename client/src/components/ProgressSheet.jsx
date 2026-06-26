import { useState, useEffect } from 'react';

const fmt = (n, d = 2) => n == null ? '—' : new Intl.NumberFormat('en-IE', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
const fmtWE = we => we ? new Date(we + 'T12:00:00').toLocaleDateString('en-IE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';

const SCH_LABEL = { '1': 'Sch 1 — Prelims Fixed', '1A': 'Sch 1A — Prelims Time', '2': 'Sch 2 — WW Pump Stations' };

export default function ProgressSheet({ projectId, weekEnding, onBack }) {
  const [sheet,    setSheet]    = useState(null);
  const [items,    setItems]    = useState([]);
  const [costs,    setCosts]    = useState({ cost_materials: 0, cost_plant: 0, ohp_allowance: 0 });
  const [efa,      setEfa]      = useState({ efa_revenue: 0, efa_cost: 0, target_margin_pct: 8 });
  const [enteredBy, setEnteredBy] = useState('');
  const [notes,    setNotes]    = useState('');
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [activeTab, setActiveTab] = useState('boq');
  const [search,   setSearch]   = useState('');

  useEffect(() => {
    fetch(`/api/v1/projects/${projectId}/tracker/${weekEnding}/progress-sheet`)
      .then(r => r.json())
      .then(d => {
        setSheet(d);
        setItems(d.items.map(i => ({ ...i })));
      });
    // Load existing tracker row for costs/EFA
    fetch(`/api/v1/projects/${projectId}/tracker/${weekEnding}`)
      .then(r => r.json())
      .then(d => {
        if (d.tracker) {
          setCosts({ cost_materials: d.tracker.cost_materials, cost_plant: d.tracker.cost_plant, ohp_allowance: d.tracker.ohp_allowance });
          setEfa({ efa_revenue: d.tracker.efa_revenue, efa_cost: d.tracker.efa_cost, target_margin_pct: d.tracker.target_margin_pct });
          setEnteredBy(d.tracker.entered_by || '');
          setNotes(d.tracker.notes || '');
        }
      });
  }, [projectId, weekEnding]);

  const setItem = (i, k, v) => setItems(rows => rows.map((r, j) => j === i ? { ...r, [k]: v } : r));

  const save = async () => {
    setSaving(true);
    await fetch(`/api/v1/projects/${projectId}/tracker/${weekEnding}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boq_progress: items, costs, efa, entered_by: enteredBy, notes }),
    });
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  if (!sheet) return <div className="state-box"><div className="icon">⏳</div><p>Loading…</p></div>;

  // Live revenue preview
  const liveRev = items.reduce((s, i) => {
    const delta = Math.max(0, (parseFloat(i.pct_complete_this) || 0) - (parseFloat(i.pct_complete_prev) || 0));
    return s + (delta / 100) * (i.contract_sum || 0);
  }, 0);
  const liveCost = (parseFloat(costs.cost_materials) || 0) + (parseFloat(costs.cost_plant) || 0) + (parseFloat(costs.ohp_allowance) || 0);

  const schedules = [...new Set(items.map(i => i.schedule))].sort();
  const filtered  = search ? items.filter((it, i) => ({ ...it, _idx: i }) &&
    (it.description.toLowerCase().includes(search.toLowerCase()) || it.item_ref.toLowerCase().includes(search.toLowerCase()))
  ) : null;

  return (
    <div>
      <div className="detail-nav" style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <button className="btn-back" onClick={onBack}>← Tracker</button>
        <button onClick={async () => {
          if (!window.confirm(`Apagar semana WE ${weekEnding} e todos os dados de progresso desta semana?`)) return;
          await fetch(`/api/v1/projects/${projectId}/tracker/${weekEnding}`, { method:'DELETE' });
          onBack();
        }} style={{ padding:'5px 12px', borderRadius:6, border:'1px solid #fca5a5',
          background:'#fff5f5', cursor:'pointer', fontSize:12, color:'#dc2626', fontWeight:600 }}>
          ✕ Apagar Semana
        </button>
      </div>

      {/* Header */}
      <div className="assessment-header">
        <div className="assessment-title">
          <span className="assessment-period">WE {fmtWE(weekEnding)}</span>
          {sheet.prev_week_ending && (
            <span style={{ fontSize: 13, color: '#6b7280' }}>prev WE: {new Date(sheet.prev_week_ending + 'T12:00:00').toLocaleDateString('en-IE', { day: 'numeric', month: 'short' })}</span>
          )}
        </div>
        <div className="assessment-kpis">
          <div className="assess-kpi">
            <div className="kpi-label">Revenue This WE</div>
            <div className="kpi-value" style={{ color: '#1e40af' }}>€{fmt(liveRev, 0)}</div>
          </div>
          <div className="assess-kpi">
            <div className="kpi-label">Manual Cost</div>
            <div className="kpi-value" style={{ color: '#92400e' }}>€{fmt(liveCost, 0)}</div>
          </div>
          <div className="assess-kpi">
            <div className="kpi-label">Margin (preview)</div>
            <div className="kpi-value" style={{ color: liveRev - liveCost >= 0 ? '#166534' : '#dc2626' }}>
              €{fmt(liveRev - liveCost, 0)}
            </div>
          </div>
        </div>
        <div className="assessment-actions">
          <input value={enteredBy} onChange={e => setEnteredBy(e.target.value)}
            placeholder="Entered by" style={{ padding:'7px 10px', border:'1px solid #d1d5db', borderRadius:6, fontSize:13, width:160 }} />
          <button className="btn-save" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save & Recalculate'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="das-tabs">
        {[
          { id: 'boq',   label: `BOQ Progress (${items.length})` },
          { id: 'costs', label: 'Manual Costs' },
          { id: 'efa',   label: 'EFA Forecast' },
          { id: 'notes', label: 'Notes' },
        ].map(t => (
          <button key={t.id} className={`das-tab ${activeTab === t.id ? 'active' : ''}`} onClick={() => setActiveTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="das-tab-content">
        {activeTab === 'boq' && (
          <div>
            <div className="section-toolbar" style={{ marginBottom: 12 }}>
              <span className="section-stat">{items.filter(i => parseFloat(i.pct_complete_this) > 0).length} items with progress</span>
              <input type="search" placeholder="Filter items…" value={search} onChange={e => setSearch(e.target.value)} style={{ padding:'6px 10px', border:'1px solid #d1d5db', borderRadius:6, fontSize:13, width:220 }} />
            </div>
            {schedules.map(sch => {
              const schItems = items.map((it, idx) => ({...it, _idx: idx})).filter(it => it.schedule === sch &&
                (!search || it.description.toLowerCase().includes(search.toLowerCase()) || it.item_ref.toLowerCase().includes(search.toLowerCase())));
              if (!schItems.length) return null;
              const schRev = schItems.reduce((s, i) => s + Math.max(0, (parseFloat(i.pct_complete_this)||0) - (parseFloat(i.pct_complete_prev)||0)) / 100 * (i.contract_sum||0), 0);
              return (
                <div key={sch} className="schedule-block">
                  <div className="schedule-header">
                    <span className="schedule-title">{SCH_LABEL[sch] || `Schedule ${sch}`}</span>
                    <span className="schedule-total" style={{ fontSize: 13 }}>WE Revenue: €{fmt(schRev, 0)}</span>
                  </div>
                  <table className="boq-table">
                    <thead>
                      <tr>
                        <th className="col-ref">Ref</th>
                        <th>Description</th>
                        <th className="col-unit">Unit</th>
                        <th className="col-num">Contract Sum</th>
                        <th className="col-num" style={{ background: '#eff6ff' }}>% Prev</th>
                        <th className="col-num" style={{ background: '#f0fdf4' }}>% This WE</th>
                        <th className="col-num" style={{ background: '#f0fdf4' }}>WE Revenue (€)</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {schItems.map(row => {
                        const delta = Math.max(0, (parseFloat(row.pct_complete_this)||0) - (parseFloat(row.pct_complete_prev)||0));
                        const weRev = (delta / 100) * (row.contract_sum || 0);
                        return (
                          <tr key={row._idx}>
                            <td className="col-ref">{row.item_ref}</td>
                            <td style={{ fontSize: 13 }}>{row.description}</td>
                            <td className="col-unit">{row.unit}</td>
                            <td className="col-num" style={{ color: '#6b7280' }}>€{fmt(row.contract_sum, 0)}</td>
                            <td className="col-num" style={{ background: '#f8faff', color: '#6b7280' }}>
                              {fmt(row.pct_complete_prev, 1)}%
                            </td>
                            <td className="col-num" style={{ background: '#f0fff4' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                                <input
                                  type="number" min="0" max="100" step="1"
                                  value={row.pct_complete_this}
                                  onChange={e => setItem(row._idx, 'pct_complete_this', e.target.value)}
                                  className="assess-input assess-input-gmc"
                                  style={{ width: 64 }}
                                />
                                <span style={{ fontSize: 11, color: '#6b7280' }}>%</span>
                              </div>
                            </td>
                            <td className="col-num" style={{ background: '#f0fff4', color: '#166534', fontWeight: weRev > 0 ? 700 : 400 }}>
                              {weRev > 0 ? `€${fmt(weRev, 0)}` : <span className="zero">—</span>}
                            </td>
                            <td>
                              <input value={row.progress_notes || ''} onChange={e => setItem(row._idx, 'progress_notes', e.target.value)}
                                style={{ width: '100%', fontSize: 12, border: '1px solid #e5e7eb', borderRadius: 4, padding: '3px 6px' }}
                                placeholder="Notes…" />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'costs' && (
          <div className="section-grid" style={{ maxWidth: 480 }}>
            {[
              { key: 'cost_materials', label: 'Materials Cost (€)', placeholder: '0.00' },
              { key: 'cost_plant',     label: 'Plant Cost (€)',     placeholder: '0.00' },
              { key: 'ohp_allowance',  label: 'OH&P Allowance (€)', placeholder: '0.00' },
            ].map(f => (
              <div key={f.key} className="field">
                <label className="field-label">{f.label}</label>
                <input type="number" step="0.01" min="0"
                  value={costs[f.key]}
                  onChange={e => setCosts(c => ({ ...c, [f.key]: e.target.value }))}
                  placeholder={f.placeholder} />
              </div>
            ))}
            <div className="field">
              <label className="field-label">Note</label>
              <p style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                Subcontractor cost is auto-populated from approved SUB_APPLICATIONs for this period's month.
              </p>
            </div>
          </div>
        )}

        {activeTab === 'efa' && (
          <div className="section-grid" style={{ maxWidth: 480 }}>
            {[
              { key: 'efa_revenue',      label: 'EFA Revenue (€)',      state: efa, set: setEfa },
              { key: 'efa_cost',         label: 'EFA Cost (€)',          state: efa, set: setEfa },
              { key: 'target_margin_pct', label: 'Target Margin (%)',    state: efa, set: setEfa },
            ].map(f => (
              <div key={f.key} className="field">
                <label className="field-label">{f.label}</label>
                <input type="number" step={f.key.includes('pct') ? '0.1' : '1000'} min="0"
                  value={f.state[f.key]}
                  onChange={e => f.set(s => ({ ...s, [f.key]: e.target.value }))} />
              </div>
            ))}
            <div className="field span2">
              <label className="field-label">EFA Margin (computed)</label>
              <div style={{ fontWeight: 700, fontSize: 16, color: (parseFloat(efa.efa_revenue)||0) - (parseFloat(efa.efa_cost)||0) >= 0 ? '#166534' : '#dc2626', paddingTop: 4 }}>
                €{fmt((parseFloat(efa.efa_revenue)||0) - (parseFloat(efa.efa_cost)||0), 0)}
                {' '}
                ({efa.efa_revenue > 0 ? (((parseFloat(efa.efa_revenue)||0) - (parseFloat(efa.efa_cost)||0)) / (parseFloat(efa.efa_revenue)||1) * 100).toFixed(1) : '0.0'}%)
              </div>
            </div>
          </div>
        )}

        {activeTab === 'notes' && (
          <div className="field">
            <label className="field-label">Week Notes / Commentary</label>
            <textarea rows={6} value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Site progress, issues, key events this week…"
              style={{ width: '100%', maxWidth: 640 }} />
          </div>
        )}
      </div>
    </div>
  );
}
