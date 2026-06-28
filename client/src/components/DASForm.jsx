import { apiFetch } from '../apiFetch.js';
import { useState, useEffect } from 'react';
import NextWeekForm from './NextWeekForm.jsx';

const ACTIVITY_CODES = ['A','B','C','D','E','F','G'];
const CODE_LABELS    = { A:'Civil', B:'Mechanical', C:'Electrical', D:'Instrumentation', E:'Commissioning', F:'Preliminaries', G:'Other' };
const SERVICE_CATS   = ['Pump Station','Manhole','Pipework','Preliminaries','MEICA','Landscape','Other'];
const WEATHER_OPTS   = ['Fine','Overcast','Light Rain','Heavy Rain','Wind','Frost','Snow'];
const TRADES         = ['Site Agent','Ganger','Labourer','Carpenter','Fitter','Electrician','Welder','Driver','Groundworker','Other'];

const emptyLabour   = () => ({ worker_name:'', trade:'Labourer', hours_worked:8, overtime_hours:0, activity_code:'A', work_type:'Contract', notes:'' });
const emptyPlant    = () => ({ plant_ref:'', description:'', operator:'', hours_worked:8, hours_idle:0, activity_code:'A', work_type:'Contract', notes:'' });
const emptyActivity = () => ({ activity_code:'A', service_category:'Pump Station', description:'', qty_today:'', unit:'', work_type:'Contract', notes:'' });

export default function DASForm({ projectId, date, showNextWeek, nextMonday, onSaved }) {
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [entry,    setEntry]    = useState({ site_agent:'', weather:'Fine', work_type:'Contract', visitors:'', general_notes:'', status:'draft' });
  const [labour,   setLabour]   = useState([]);
  const [plant,    setPlant]    = useState([]);
  const [activities, setActivities] = useState([]);
  const [activeTab, setActiveTab]   = useState('header');

  useEffect(() => {
    setLoading(true);
    setSaved(false);
    apiFetch(`/api/v1/projects/${projectId}/das/${date}`)
      .then(r => r.json())
      .then(d => {
        setEntry(d.entry);
        setLabour(d.labour);
        setPlant(d.plant);
        setActivities(d.activities);
        setLoading(false);
      });
  }, [projectId, date]);

  const save = async (status) => {
    setSaving(true);
    const body = { entry: { ...entry, status: status || entry.status }, labour, plant, activities };
    await apiFetch(`/api/v1/projects/${projectId}/das/${date}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    setSaved(true);
    onSaved?.();
    setTimeout(() => setSaved(false), 2500);
  };

  const fmtDate = d => new Date(d + 'T12:00:00').toLocaleDateString('en-IE', {
    weekday:'long', day:'numeric', month:'long', year:'numeric'
  });

  if (loading) return <div className="state-box"><div className="icon">â³</div><p>Loadingâ€¦</p></div>;

  const isSubmitted = entry.status === 'submitted';

  return (
    <div className="das-form">
      {/* DAS Header Info */}
      <div className="das-header-card">
        <div className="das-header-left">
          <div className="das-date-label">{fmtDate(date)}</div>
          <span className={`das-status ${isSubmitted ? 'submitted' : 'draft'}`}>
            {isSubmitted ? 'Submitted' : 'Draft'}
          </span>
        </div>
        <div className="das-header-right">
          <div className="das-summary-pills">
            <span className="pill">{labour.length} Workers</span>
            <span className="pill">{plant.length} Plant</span>
            <span className="pill">{activities.length} Activities</span>
          </div>
          <div style={{display:'flex', gap:8, marginTop:8}}>
            <button className="btn-save" onClick={() => save('draft')} disabled={saving || isSubmitted}>
              {saving ? 'Savingâ€¦' : saved ? 'âœ“ Saved' : 'Save Draft'}
            </button>
            <button className="btn-submit" onClick={() => { if(confirm('Submit this DAS? It cannot be edited after submission.')) save('submitted'); }}
              disabled={saving || isSubmitted}>
              Submit DAS
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="das-tabs">
        {['header','labour','plant','activities'].map(t => (
          <button key={t} className={`das-tab ${activeTab === t ? 'active' : ''}`} onClick={() => setActiveTab(t)}>
            {t === 'header' ? 'Header' : t === 'labour' ? `Labour (${labour.length})` : t === 'plant' ? `Plant (${plant.length})` : `Activities (${activities.length})`}
          </button>
        ))}
      </div>

      <div className="das-tab-content">
        {activeTab === 'header' && (
          <HeaderSection entry={entry} setEntry={setEntry} disabled={isSubmitted} />
        )}
        {activeTab === 'labour' && (
          <LabourSection rows={labour} setRows={setLabour} disabled={isSubmitted} />
        )}
        {activeTab === 'plant' && (
          <PlantSection rows={plant} setRows={setPlant} disabled={isSubmitted} />
        )}
        {activeTab === 'activities' && (
          <ActivitiesSection rows={activities} setRows={setActivities} disabled={isSubmitted} />
        )}
      </div>

      {showNextWeek && (
        <NextWeekForm projectId={projectId} monday={nextMonday} disabled={isSubmitted} />
      )}
    </div>
  );
}

/* â”€â”€ Header Section â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function HeaderSection({ entry, setEntry, disabled }) {
  const set = (k, v) => setEntry(e => ({ ...e, [k]: v }));
  return (
    <div className="section-grid">
      <Field label="Site Agent" required>
        <input value={entry.site_agent || ''} onChange={e => set('site_agent', e.target.value)} disabled={disabled} />
      </Field>
      <Field label="Weather">
        <select value={entry.weather || ''} onChange={e => set('weather', e.target.value)} disabled={disabled}>
          <option value="">â€” Select â€”</option>
          {WEATHER_OPTS.map(w => <option key={w}>{w}</option>)}
        </select>
      </Field>
      <Field label="Work Type">
        <div className="toggle-group">
          {['Contract','Daywork'].map(t => (
            <button key={t} className={`toggle-btn ${entry.work_type === t ? 'active' : ''}`}
              onClick={() => !disabled && set('work_type', t)} disabled={disabled}>
              {t}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Visitors">
        <input value={entry.visitors || ''} onChange={e => set('visitors', e.target.value)}
          placeholder="Names / company" disabled={disabled} />
      </Field>
      <Field label="General Notes" span2>
        <textarea rows={3} value={entry.general_notes || ''} onChange={e => set('general_notes', e.target.value)}
          placeholder="Site diary notes, issues, instructions receivedâ€¦" disabled={disabled} />
      </Field>
    </div>
  );
}

/* â”€â”€ Labour Section â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function LabourSection({ rows, setRows, disabled }) {
  const add    = () => setRows(r => [...r, emptyLabour()]);
  const remove = i => setRows(r => r.filter((_, j) => j !== i));
  const set    = (i, k, v) => setRows(r => r.map((row, j) => j === i ? { ...row, [k]: v } : row));

  const totalHours = rows.reduce((a, r) => a + (parseFloat(r.hours_worked) || 0), 0);
  const totalOT    = rows.reduce((a, r) => a + (parseFloat(r.overtime_hours) || 0), 0);

  return (
    <div>
      <div className="section-toolbar">
        <span className="section-stat">{rows.length} workers Â· {totalHours}h normal Â· {totalOT}h OT</span>
        {!disabled && <button className="btn-add" onClick={add}>+ Add Worker</button>}
      </div>

      {rows.length === 0 ? (
        <div className="empty-hint">No labour recorded. Click "Add Worker" to begin.</div>
      ) : (
        <table className="inline-table">
          <thead>
            <tr>
              <th>Name</th><th>Trade</th><th>Hours</th><th>OT</th>
              <th>Code</th><th>Work Type</th><th>Notes</th>
              {!disabled && <th></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                <td><input value={row.worker_name} onChange={e => set(i,'worker_name',e.target.value)} disabled={disabled} placeholder="Full name" /></td>
                <td>
                  <select value={row.trade} onChange={e => set(i,'trade',e.target.value)} disabled={disabled}>
                    {TRADES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </td>
                <td><input type="number" min="0" max="24" step="0.5" value={row.hours_worked} onChange={e => set(i,'hours_worked',e.target.value)} disabled={disabled} style={{width:60}} /></td>
                <td><input type="number" min="0" max="12" step="0.5" value={row.overtime_hours} onChange={e => set(i,'overtime_hours',e.target.value)} disabled={disabled} style={{width:50}} /></td>
                <td>
                  <select value={row.activity_code || ''} onChange={e => set(i,'activity_code',e.target.value)} disabled={disabled} style={{width:110}}>
                    {ACTIVITY_CODES.map(c => <option key={c} value={c}>{c} â€” {CODE_LABELS[c]}</option>)}
                  </select>
                </td>
                <td>
                  <select value={row.work_type} onChange={e => set(i,'work_type',e.target.value)} disabled={disabled} style={{width:100}}>
                    <option>Contract</option><option>Daywork</option>
                  </select>
                </td>
                <td><input value={row.notes || ''} onChange={e => set(i,'notes',e.target.value)} disabled={disabled} placeholder="Notes" /></td>
                {!disabled && <td><button className="btn-remove" onClick={() => remove(i)}>âœ•</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* â”€â”€ Plant Section â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function PlantSection({ rows, setRows, disabled }) {
  const add    = () => setRows(r => [...r, emptyPlant()]);
  const remove = i => setRows(r => r.filter((_, j) => j !== i));
  const set    = (i, k, v) => setRows(r => r.map((row, j) => j === i ? { ...row, [k]: v } : row));

  return (
    <div>
      <div className="section-toolbar">
        <span className="section-stat">{rows.length} plant items</span>
        {!disabled && <button className="btn-add" onClick={add}>+ Add Plant</button>}
      </div>

      {rows.length === 0 ? (
        <div className="empty-hint">No plant recorded.</div>
      ) : (
        <table className="inline-table">
          <thead>
            <tr>
              <th>Ref</th><th>Description</th><th>Operator</th>
              <th>Hrs Worked</th><th>Hrs Idle</th>
              <th>Code</th><th>Work Type</th><th>Notes</th>
              {!disabled && <th></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                <td><input value={row.plant_ref || ''} onChange={e => set(i,'plant_ref',e.target.value)} disabled={disabled} placeholder="e.g. P001" style={{width:70}} /></td>
                <td><input value={row.description} onChange={e => set(i,'description',e.target.value)} disabled={disabled} placeholder="e.g. 360 Excavator 20T" /></td>
                <td><input value={row.operator || ''} onChange={e => set(i,'operator',e.target.value)} disabled={disabled} placeholder="Operator name" /></td>
                <td><input type="number" min="0" max="24" step="0.5" value={row.hours_worked} onChange={e => set(i,'hours_worked',e.target.value)} disabled={disabled} style={{width:60}} /></td>
                <td><input type="number" min="0" max="24" step="0.5" value={row.hours_idle} onChange={e => set(i,'hours_idle',e.target.value)} disabled={disabled} style={{width:60}} /></td>
                <td>
                  <select value={row.activity_code || ''} onChange={e => set(i,'activity_code',e.target.value)} disabled={disabled} style={{width:110}}>
                    {ACTIVITY_CODES.map(c => <option key={c} value={c}>{c} â€” {CODE_LABELS[c]}</option>)}
                  </select>
                </td>
                <td>
                  <select value={row.work_type} onChange={e => set(i,'work_type',e.target.value)} disabled={disabled} style={{width:100}}>
                    <option>Contract</option><option>Daywork</option>
                  </select>
                </td>
                <td><input value={row.notes || ''} onChange={e => set(i,'notes',e.target.value)} disabled={disabled} placeholder="Notes" /></td>
                {!disabled && <td><button className="btn-remove" onClick={() => remove(i)}>âœ•</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* â”€â”€ Activities Section â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function ActivitiesSection({ rows, setRows, disabled }) {
  const add    = () => setRows(r => [...r, emptyActivity()]);
  const remove = i => setRows(r => r.filter((_, j) => j !== i));
  const set    = (i, k, v) => setRows(r => r.map((row, j) => j === i ? { ...row, [k]: v } : row));

  // Group by code for display
  const grouped = ACTIVITY_CODES.reduce((acc, c) => {
    const items = rows.map((r, i) => ({...r, _idx: i})).filter(r => r.activity_code === c);
    if (items.length) acc[c] = items;
    return acc;
  }, {});

  return (
    <div>
      <div className="section-toolbar">
        <span className="section-stat">{rows.length} work activities</span>
        {!disabled && <button className="btn-add" onClick={add}>+ Add Activity</button>}
      </div>

      {rows.length === 0 ? (
        <div className="empty-hint">No activities recorded. Click "Add Activity" to describe today's work.</div>
      ) : (
        Object.entries(grouped).map(([code, items]) => (
          <div key={code} className="activity-group">
            <div className="activity-group-header">
              <span className="activity-code-badge">{code}</span>
              <span className="activity-code-label">{CODE_LABELS[code]}</span>
            </div>
            <table className="inline-table">
              <thead>
                <tr>
                  <th>Service Category</th><th>Description</th>
                  <th>Qty</th><th>Unit</th><th>Work Type</th><th>Notes</th>
                  {!disabled && <th></th>}
                </tr>
              </thead>
              <tbody>
                {items.map(row => (
                  <tr key={row._idx}>
                    <td>
                      <select value={row.service_category} onChange={e => set(row._idx,'service_category',e.target.value)} disabled={disabled} style={{width:140}}>
                        {SERVICE_CATS.map(c => <option key={c}>{c}</option>)}
                      </select>
                    </td>
                    <td><input value={row.description} onChange={e => set(row._idx,'description',e.target.value)} disabled={disabled} placeholder="Describe work done todayâ€¦" style={{minWidth:220}} /></td>
                    <td><input type="number" step="any" min="0" value={row.qty_today || ''} onChange={e => set(row._idx,'qty_today',e.target.value)} disabled={disabled} style={{width:70}} placeholder="â€”" /></td>
                    <td><input value={row.unit || ''} onChange={e => set(row._idx,'unit',e.target.value)} disabled={disabled} style={{width:55}} placeholder="m, mÂ², nrâ€¦" /></td>
                    <td>
                      <select value={row.work_type} onChange={e => set(row._idx,'work_type',e.target.value)} disabled={disabled} style={{width:100}}>
                        <option>Contract</option><option>Daywork</option>
                      </select>
                    </td>
                    <td><input value={row.notes || ''} onChange={e => set(row._idx,'notes',e.target.value)} disabled={disabled} placeholder="Notes" /></td>
                    {!disabled && <td><button className="btn-remove" onClick={() => remove(row._idx)}>âœ•</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}

      {/* Ungrouped new rows (no code assigned yet shows at bottom) */}
    </div>
  );
}

/* â”€â”€ Shared Field wrapper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function Field({ label, children, required, span2 }) {
  return (
    <div className={`field${span2 ? ' span2' : ''}`}>
      <label className="field-label">{label}{required && <span className="req">*</span>}</label>
      {children}
    </div>
  );
}
