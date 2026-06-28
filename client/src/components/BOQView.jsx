import { useState, useEffect, useMemo } from 'react';

// O scope é definido pela SCHEDULE (não pelo type): Sch 1 = Prel. Fixed, 1A = Prel. Time, 2 = Pump Station.
const SCHED_LABELS = { '1': 'Prel. Fixed', '1A': 'Prel. Time', '2': 'Pump Station' };
const SCHED_COLOR  = { '1': 'F', '1A': 'T', '2': 'M' };   // reusa as cores existentes type-F/T/M
const SCHED_ORDER  = ['1', '1A', '2'];

const fmt = (n) =>
  n === 0 || n == null
    ? <span className="zero">—</span>
    : new Intl.NumberFormat('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

function TypeBadge({ schedule }) {
  return <span className={`type-badge type-${SCHED_COLOR[schedule] || 'F'}`}>{SCHED_LABELS[schedule] || schedule}</span>;
}

function BOQTable({ items }) {
  if (!items.length) return null;
  return (
    <table className="boq-table">
      <thead>
        <tr>
          <th className="col-ref">Ref</th>
          <th className="col-desc">Description</th>
          <th className="col-unit">Unit</th>
          <th className="col-num">Rate (€)</th>
          <th className="col-num">Contract Sum (€)</th>
          <th className="col-type">Type</th>
        </tr>
      </thead>
      <tbody>
        {items.map(item => (
          <tr key={item.id}>
            <td className="col-ref">{item.item_ref}</td>
            <td className="col-desc">{item.description}</td>
            <td className="col-unit">{item.unit}</td>
            <td className="col-num">{fmt(item.rate)}</td>
            <td className="col-num" style={{ fontWeight: item.contract_sum > 0 ? 600 : 400 }}>
              {fmt(item.contract_sum)}
            </td>
            <td className="col-type"><TypeBadge schedule={item.schedule} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ScheduleBlock({ schedule, sections, subtotal, label }) {
  const fmt2 = (n) =>
    new Intl.NumberFormat('en-IE', { minimumFractionDigits: 2 }).format(n);

  return (
    <div className="schedule-block">
      <div className="schedule-header">
        <span className="schedule-title">Schedule {schedule}</span>
        <span className="schedule-subtitle">{label}</span>
        <span className="schedule-total">€ {fmt2(subtotal)}</span>
      </div>

      {Object.entries(sections).map(([section, items]) => (
        <div key={section}>
          <div className="section-header">{section}</div>
          <BOQTable items={items} />
        </div>
      ))}
    </div>
  );
}

export default function BOQView({ projectId, schedule, scheduleLabels }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [scheds,  setScheds]  = useState(new Set(['1', '1A', '2']));

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ group: 'schedule' });
    if (schedule) params.set('schedule', schedule);

    fetch(`/api/v1/projects/${projectId}/boq?${params}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [projectId, schedule]);

  const toggleSched = (s) =>
    setScheds(prev => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });

  const filteredGrouped = useMemo(() => {
    if (!data?.grouped) return {};
    const q = search.toLowerCase();

    const result = {};
    for (const [sch, sections] of Object.entries(data.grouped)) {
      if (!scheds.has(sch)) continue;          // filtra por schedule
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
  }, [data, search, scheds]);

  const subtotalFor = (sch) => {
    if (!filteredGrouped[sch]) return 0;
    return Object.values(filteredGrouped[sch])
      .flat()
      .reduce((acc, item) => acc + (item.contract_sum || 0), 0);
  };

  const scheduleOrder = ['1', '1A', '2'];

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

  const visibleSchedules = scheduleOrder.filter(s => filteredGrouped[s]);

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
          {SCHED_ORDER.map(s => (
            <label key={s} style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', fontSize:13, fontWeight:600, color:'#374151' }}>
              <input type="checkbox" checked={scheds.has(s)} onChange={() => toggleSched(s)}
                style={{ width:16, height:16, cursor:'pointer', accentColor:'#1a1a2e' }} />
              {SCHED_LABELS[s]}
            </label>
          ))}
          <button
            onClick={() => { setScheds(new Set(['1', '1A', '2'])); setSearch(''); }}
            title="Show all"
            style={{ padding:'4px 12px', borderRadius:6, border:'1px solid #d1d5db', background:'#f9fafb',
              cursor:'pointer', fontSize:12, color:'#6b7280' }}>
            ✕ Clear
          </button>
        </div>
      </div>

      {visibleSchedules.length === 0 ? (
        <div className="state-box">
          <div className="icon">🔍</div>
          <p>No items match your filters.</p>
        </div>
      ) : (
        visibleSchedules.map(sch => (
          <ScheduleBlock
            key={sch}
            schedule={sch}
            sections={filteredGrouped[sch]}
            subtotal={subtotalFor(sch)}
            label={scheduleLabels[sch] || ''}
          />
        ))
      )}
    </div>
  );
}
