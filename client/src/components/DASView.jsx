import { apiFetch } from '../apiFetch.js';
import { useState, useEffect, useCallback } from 'react';
import DASForm from './DASForm.jsx';
import { useZoom } from '../zoomContext.js';

function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

function isFriday(dateStr) {
  return new Date(dateStr + 'T12:00:00').getDay() === 5;
}

function nextMonday(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const diff = (8 - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return toISODate(d);
}

// Monday of the week containing dateStr
function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay(); // 0=Sun..6=Sat
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d;
}

// Week Ending (Friday) of the week containing dateStr
function weekEndingOf(dateStr) {
  const mon = mondayOf(dateStr);
  mon.setDate(mon.getDate() + 4);
  return toISODate(mon);
}

// Monday..Saturday (6 days) of the week ending on weFriday
function daysOfWeek(weFriday) {
  const fri = new Date(weFriday + 'T12:00:00');
  const mon = new Date(fri); mon.setDate(fri.getDate() - 4);
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(mon); d.setDate(mon.getDate() + i);
    return toISODate(d);
  });
}

// Range of Week Endings (Fridays) around a reference Friday
function friRange(refWE, before = 8, after = 2) {
  return Array.from({ length: before + after + 1 }, (_, i) => {
    const d = new Date(refWE + 'T12:00:00');
    d.setDate(d.getDate() + (i - before) * 7);
    return toISODate(d);
  });
}

export default function DASView({ projectId, readOnly }) {
  const [selectedDate, setSelectedDate] = useState(toISODate(new Date()));
  const [entries, setEntries]           = useState([]);
  const [view, setView]                 = useState('form'); // 'form' | 'list'

  const loadEntries = useCallback(() => {
    apiFetch(`/api/v1/projects/${projectId}/das`)
      .then(r => r.json())
      .then(setEntries);
  }, [projectId]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  const handleSaved = () => { loadEntries(); };

  const currentWE = weekEndingOf(selectedDate);
  const weOptions = friRange(weekEndingOf(toISODate(new Date())), 8, 2);
  const dayFmt = d => new Date(d + 'T12:00:00').toLocaleDateString('en-IE', { weekday: 'short', day: 'numeric', month: 'short' });
  const weFmt  = d => new Date(d + 'T12:00:00').toLocaleDateString('en-IE', { day: 'numeric', month: 'short' });

  return (
    <div>
      <div className="das-toolbar">
        <div className="das-date-nav">
          <label className="das-we-label">
            WE:&nbsp;
            <select value={currentWE} onChange={e => {
              const mon = new Date(e.target.value + 'T12:00:00');
              mon.setDate(mon.getDate() - 4);
              setSelectedDate(toISODate(mon));
            }}>
              {weOptions.map(we => <option key={we} value={we}>{weFmt(we)}</option>)}
            </select>
          </label>
          <div className="das-day-picker">
            {daysOfWeek(currentWE).map(d => (
              <button key={d} type="button"
                className={`das-day-btn ${d === selectedDate ? 'active' : ''}`}
                onClick={() => setSelectedDate(d)}>
                {dayFmt(d)}
              </button>
            ))}
          </div>
          <button className="btn-ghost" onClick={() => setSelectedDate(toISODate(new Date()))}>Today</button>
        </div>

        {!readOnly && (
          <button className={`tab-btn ${view === 'list' ? 'active' : ''}`}
            onClick={() => setView(v => v === 'list' ? 'form' : 'list')}>
            {view === 'list' ? '← Back to Entry' : `History (${entries.length})`}
          </button>
        )}
      </div>

      {view === 'form' && !readOnly ? (
        <DASForm
          projectId={projectId}
          date={selectedDate}
          showNextWeek={isFriday(selectedDate)}
          nextMonday={nextMonday(selectedDate)}
          onSaved={handleSaved}
        />
      ) : (
        <DASList entries={entries} onSelect={date => { setSelectedDate(date); setView(readOnly ? 'list' : 'form'); }} />
      )}
    </div>
  );
}

function DASList({ entries, onSelect }) {
  const zoom = useZoom();
  const fmt = d => new Date(d + 'T12:00:00').toLocaleDateString('en-IE', { weekday:'short', day:'numeric', month:'short', year:'numeric' });
  const statusColor = s => s === 'submitted' ? '#166534' : '#92400e';

  if (!entries.length) return (
    <div className="state-box"><div className="icon">📋</div><p>No DAS entries yet.</p></div>
  );

  return (
    <table className="boq-table" style={{ marginTop: 12, zoom: `${zoom}%` }}>
      <thead>
        <tr>
          <th>Date</th><th>Site Agent</th><th>Weather</th>
          <th style={{textAlign:'center'}}>Labour</th>
          <th style={{textAlign:'center'}}>Plant</th>
          <th style={{textAlign:'center'}}>Activities</th>
          <th>Work Type</th><th>Status</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(e => (
          <tr key={e.id} style={{cursor:'pointer'}} onClick={() => onSelect(e.entry_date)}>
            <td style={{fontWeight:600}}>{fmt(e.entry_date)}</td>
            <td>{e.site_agent}</td>
            <td>{e.weather || '—'}</td>
            <td style={{textAlign:'center'}}>{e.labour_count}</td>
            <td style={{textAlign:'center'}}>{e.plant_count}</td>
            <td style={{textAlign:'center'}}>{e.activity_count}</td>
            <td><span className={`type-badge type-${e.work_type === 'Contract' ? 'F' : 'T'}`}>{e.work_type}</span></td>
            <td><span style={{color: statusColor(e.status), fontWeight:600, fontSize:12}}>{e.status}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
