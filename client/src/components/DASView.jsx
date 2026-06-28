import { apiFetch } from '../apiFetch.js';
import { useState, useEffect, useCallback } from 'react';
import DASForm from './DASForm.jsx';

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

export default function DASView({ projectId }) {
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

  return (
    <div>
      <div className="das-toolbar">
        <div className="das-date-nav">
          <button className="icon-btn" onClick={() => {
            const d = new Date(selectedDate + 'T12:00:00');
            d.setDate(d.getDate() - 1);
            setSelectedDate(toISODate(d));
          }}>‹</button>
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="date-input"
          />
          <button className="icon-btn" onClick={() => {
            const d = new Date(selectedDate + 'T12:00:00');
            d.setDate(d.getDate() + 1);
            setSelectedDate(toISODate(d));
          }}>›</button>
          <button className="btn-ghost" onClick={() => setSelectedDate(toISODate(new Date()))}>Today</button>
        </div>

        <div className="das-view-tabs">
          <button className={`tab-btn ${view === 'form' ? 'active' : ''}`} onClick={() => setView('form')}>
            Daily Entry
          </button>
          <button className={`tab-btn ${view === 'list' ? 'active' : ''}`} onClick={() => setView('list')}>
            History ({entries.length})
          </button>
        </div>
      </div>

      {view === 'form' ? (
        <DASForm
          projectId={projectId}
          date={selectedDate}
          showNextWeek={isFriday(selectedDate)}
          nextMonday={nextMonday(selectedDate)}
          onSaved={handleSaved}
        />
      ) : (
        <DASList entries={entries} onSelect={date => { setSelectedDate(date); setView('form'); }} />
      )}
    </div>
  );
}

function DASList({ entries, onSelect }) {
  const fmt = d => new Date(d + 'T12:00:00').toLocaleDateString('en-IE', { weekday:'short', day:'numeric', month:'short', year:'numeric' });
  const statusColor = s => s === 'submitted' ? '#166534' : '#92400e';

  if (!entries.length) return (
    <div className="state-box"><div className="icon">📋</div><p>No DAS entries yet.</p></div>
  );

  return (
    <table className="boq-table" style={{ marginTop: 12 }}>
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
