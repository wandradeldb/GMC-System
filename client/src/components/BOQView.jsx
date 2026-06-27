import { useState, useEffect, useMemo } from 'react';

const TYPE_LABELS = { F: 'Prel. Fixed', T: 'Prel. Time', M: 'Measured' };

const fmt = (n) =>
  n === 0 || n == null
    ? <span className="zero">—</span>
    : new Intl.NumberFormat('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

function TypeBadge({ type }) {
  return <span className={`type-badge type-${type}`}>{type} — {TYPE_LABELS[type]}</span>;
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
            <td className="col-type"><TypeBadge type={item.type} /></td>
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
  const [types,   setTypes]   = useState(new Set(['F', 'T', 'M']));

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ group: 'schedule' });
    if (schedule) params.set('schedule', schedule);

    fetch(`/api/v1/projects/${projectId}/boq?${params}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [projectId, schedule]);

  const toggleType = (t) =>
    setTypes(prev => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });

  const filteredGrouped = useMemo(() => {
    if (!data?.grouped) return {};
    const q = search.toLowerCase();

    const result = {};
    for (const [sch, sections] of Object.entries(data.grouped)) {
      const filteredSections = {};
      for (const [sec, items] of Object.entries(sections)) {
        const filtered = items.filter(item =>
          types.has(item.type) &&
          (!q ||
            item.description.toLowerCase().includes(q) ||
            item.item_ref.toLowerCase().includes(q))
        );
        if (filtered.length) filteredSections[sec] = filtered;
      }
      if (Object.keys(filteredSections).length) result[sch] = filteredSections;
    }
    return result;
  }, [data, search, types]);

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
        <div className="type-filters">
          {['F', 'T', 'M'].map(t => (
            <button
              key={t}
              className={`type-chip ${types.has(t) ? `active-${t}` : ''}`}
              onClick={() => toggleType(t)}
            >
              {t} — {TYPE_LABELS[t]}
            </button>
          ))}
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
