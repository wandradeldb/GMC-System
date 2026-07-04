import { apiFetch } from '../apiFetch.js';
import { useState, useEffect, useCallback, useRef } from 'react';
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
  const [entry,    setEntry]    = useState({ site_agent:'', weather:'Fine', work_type:'Contract', visitors:'', general_notes:'', status:'draft', photo_url: null });
  const [labour,   setLabour]   = useState([]);
  const [plant,    setPlant]    = useState([]);
  const [activities, setActivities] = useState([]);
  const [activeTab, setActiveTab]   = useState('header');
  // Histórico do projeto (nomes, máquinas, atividades já digitados antes) — alimenta os autocompletes
  const [suggestions, setSuggestions] = useState({ workers:[], plant:[], plantDescriptions:[], operators:[], activities:[], units:[], siteAgents:[] });

  const loadSuggestions = useCallback(() => {
    apiFetch(`/api/v1/projects/${projectId}/das/suggestions`).then(r => r.json()).then(setSuggestions);
  }, [projectId]);

  useEffect(() => { loadSuggestions(); }, [loadSuggestions]);

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
    loadSuggestions(); // atualiza o histórico com o que acabou de ser digitado
    setTimeout(() => setSaved(false), 2500);
  };

  const fmtDate = d => new Date(d + 'T12:00:00').toLocaleDateString('en-IE', {
    weekday:'long', day:'numeric', month:'long', year:'numeric'
  });

  if (loading) return <div className="state-box"><div className="icon">⏳</div><p>Loading…</p></div>;

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
              {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Draft'}
            </button>
            <button className="btn-submit" onClick={() => { if(confirm('Submit this DAS? It cannot be edited after submission.')) save('submitted'); }}
              disabled={saving || isSubmitted}>
              Submit DAS
            </button>
          </div>
        </div>
      </div>

      {/* Step progress — like an airline booking flow: numbered, checks off as filled in, tap any step */}
      <StepProgress
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        done={{
          header: !!(entry.site_agent || '').trim(),
          labour: labour.length > 0,
          plant: plant.length > 0,
          activities: activities.length > 0,
        }}
      />

      <div className="das-tab-content">
        {activeTab === 'header' && (
          <HeaderSection entry={entry} setEntry={setEntry} disabled={isSubmitted} suggestions={suggestions} />
        )}
        {activeTab === 'labour' && (
          <LabourSection rows={labour} setRows={setLabour} disabled={isSubmitted} suggestions={suggestions} />
        )}
        {activeTab === 'plant' && (
          <PlantSection rows={plant} setRows={setPlant} disabled={isSubmitted} suggestions={suggestions} />
        )}
        {activeTab === 'activities' && (
          <ActivitiesSection rows={activities} setRows={setActivities} disabled={isSubmitted} suggestions={suggestions} />
        )}
      </div>

      {showNextWeek && (
        <NextWeekForm projectId={projectId} monday={nextMonday} disabled={isSubmitted} />
      )}
    </div>
  );
}

/* ── Step Progress (airline-booking style: 1→2→3→4, checks off, tap any step) ── */
const DAS_STEPS = [
  { key:'header',     label:'Header' },
  { key:'labour',     label:'Labour' },
  { key:'plant',      label:'Plant' },
  { key:'activities', label:'Activities' },
];

function StepProgress({ activeTab, setActiveTab, done }) {
  return (
    <div className="das-steps">
      {DAS_STEPS.map((s, i) => {
        const isDone   = done[s.key];
        const isActive = activeTab === s.key;
        return (
          <div key={s.key} className="das-step-wrap">
            <button type="button"
              className={`das-step ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`}
              onClick={() => setActiveTab(s.key)}>
              <span className="das-step-circle">{isDone ? '✓' : i + 1}</span>
              <span className="das-step-label">{s.label}</span>
            </button>
            {i < DAS_STEPS.length - 1 && <span className={`das-step-line ${isDone ? 'done' : ''}`} />}
          </div>
        );
      })}
    </div>
  );
}

/* ── Photo compress helper ───────────────────────────────────────────────── */
function compressImage(file, maxPx = 1200, quality = 0.75) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxPx || height > maxPx) {
        if (width > height) { height = Math.round(height * maxPx / width); width = maxPx; }
        else { width = Math.round(width * maxPx / height); height = maxPx; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = url;
  });
}

/* ── Header Section ──────────────────────────────────────────────────────── */
function HeaderSection({ entry, setEntry, disabled, suggestions }) {
  const set = (k, v) => setEntry(e => ({ ...e, [k]: v }));
  const fileRef = useRef();
  const [compressing, setCompressing] = useState(false);

  async function handlePhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCompressing(true);
    const dataUrl = await compressImage(file);
    set('photo_url', dataUrl);
    setCompressing(false);
    e.target.value = '';
  }

  return (
    <div className="section-grid">
      <Field label="Site Agent" required>
        <input value={entry.site_agent || ''} onChange={e => set('site_agent', e.target.value)} disabled={disabled}
          list="dl-site-agents" />
        <datalist id="dl-site-agents">
          {suggestions.siteAgents.map(n => <option key={n} value={n} />)}
        </datalist>
      </Field>
      <Field label="Weather">
        <select value={entry.weather || ''} onChange={e => set('weather', e.target.value)} disabled={disabled}>
          <option value="">— Select —</option>
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
          placeholder="Site diary notes, issues, instructions received…" disabled={disabled} />
      </Field>
      <Field label="Site Photo" span2>
        <div className="das-photo-wrap">
          {entry.photo_url ? (
            <div className="das-photo-preview">
              <img src={entry.photo_url} alt="Site photo" className="das-photo-img" />
              {!disabled && (
                <button className="das-photo-remove" onClick={() => set('photo_url', null)} title="Remove photo">✕</button>
              )}
            </div>
          ) : (
            <button className="das-photo-btn" onClick={() => fileRef.current?.click()} disabled={disabled || compressing}>
              {compressing ? 'Processing…' : '📷  Add Photo'}
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={handlePhoto}
          />
        </div>
      </Field>
    </div>
  );
}

/* ── Labour Section ──────────────────────────────────────────────────────── */
function LabourSection({ rows, setRows, disabled, suggestions }) {
  const add    = () => setRows(r => [...r, emptyLabour()]);
  const remove = i => setRows(r => r.filter((_, j) => j !== i));
  const set    = (i, k, v) => setRows(r => r.map((row, j) => j === i ? { ...row, [k]: v } : row));

  // Escolheu um nome já conhecido? Preenche o trade dele automaticamente — menos um campo pra mexer
  const setWorkerName = (i, name) => {
    const known = suggestions.workers.find(w => w.name.toLowerCase() === name.trim().toLowerCase());
    setRows(r => r.map((row, j) => j === i ? { ...row, worker_name: name, trade: known ? known.trade : row.trade } : row));
  };

  const totalHours = rows.reduce((a, r) => a + (parseFloat(r.hours_worked) || 0), 0);
  const totalOT    = rows.reduce((a, r) => a + (parseFloat(r.overtime_hours) || 0), 0);

  return (
    <div>
      <div className="section-toolbar">
        <span className="section-stat">{rows.length} workers · {totalHours}h normal · {totalOT}h OT</span>
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
                <td><input value={row.worker_name} onChange={e => setWorkerName(i, e.target.value)} disabled={disabled} placeholder="Full name" list="dl-workers" /></td>
                <td>
                  <select value={row.trade} onChange={e => set(i,'trade',e.target.value)} disabled={disabled}>
                    {TRADES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </td>
                <td><input type="number" min="0" max="24" step="0.5" value={row.hours_worked} onChange={e => set(i,'hours_worked',e.target.value)} disabled={disabled} style={{width:60}} /></td>
                <td><input type="number" min="0" max="12" step="0.5" value={row.overtime_hours} onChange={e => set(i,'overtime_hours',e.target.value)} disabled={disabled} style={{width:50}} /></td>
                <td>
                  <select value={row.activity_code || ''} onChange={e => set(i,'activity_code',e.target.value)} disabled={disabled} style={{width:110}}>
                    {ACTIVITY_CODES.map(c => <option key={c} value={c}>{c} — {CODE_LABELS[c]}</option>)}
                  </select>
                </td>
                <td>
                  <select value={row.work_type} onChange={e => set(i,'work_type',e.target.value)} disabled={disabled} style={{width:100}}>
                    <option>Contract</option><option>Daywork</option>
                  </select>
                </td>
                <td><input value={row.notes || ''} onChange={e => set(i,'notes',e.target.value)} disabled={disabled} placeholder="Notes" /></td>
                {!disabled && <td><button className="btn-remove" onClick={() => remove(i)}>✕</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <datalist id="dl-workers">
        {suggestions.workers.map(w => <option key={w.name} value={w.name} />)}
      </datalist>
    </div>
  );
}

/* ── Plant Section ───────────────────────────────────────────────────────── */
function PlantSection({ rows, setRows, disabled, suggestions }) {
  const add    = () => setRows(r => [...r, emptyPlant()]);
  const remove = i => setRows(r => r.filter((_, j) => j !== i));
  const set    = (i, k, v) => setRows(r => r.map((row, j) => j === i ? { ...row, [k]: v } : row));

  // Escolheu um ref já conhecido? Preenche descrição/operador se ainda estiverem vazios
  const setPlantRef = (i, ref) => {
    const known = suggestions.plant.find(p => p.ref.toLowerCase() === ref.trim().toLowerCase());
    setRows(r => r.map((row, j) => j === i ? {
      ...row, plant_ref: ref,
      description: (!row.description && known) ? known.description : row.description,
      operator:    (!row.operator    && known) ? known.operator    : row.operator,
    } : row));
  };

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
                <td><input value={row.plant_ref || ''} onChange={e => setPlantRef(i, e.target.value)} disabled={disabled} placeholder="e.g. P001" style={{width:70}} list="dl-plant-refs" /></td>
                <td><input value={row.description} onChange={e => set(i,'description',e.target.value)} disabled={disabled} placeholder="e.g. 360 Excavator 20T" list="dl-plant-desc" /></td>
                <td><input value={row.operator || ''} onChange={e => set(i,'operator',e.target.value)} disabled={disabled} placeholder="Operator name" list="dl-operators" /></td>
                <td><input type="number" min="0" max="24" step="0.5" value={row.hours_worked} onChange={e => set(i,'hours_worked',e.target.value)} disabled={disabled} style={{width:60}} /></td>
                <td><input type="number" min="0" max="24" step="0.5" value={row.hours_idle} onChange={e => set(i,'hours_idle',e.target.value)} disabled={disabled} style={{width:60}} /></td>
                <td>
                  <select value={row.activity_code || ''} onChange={e => set(i,'activity_code',e.target.value)} disabled={disabled} style={{width:110}}>
                    {ACTIVITY_CODES.map(c => <option key={c} value={c}>{c} — {CODE_LABELS[c]}</option>)}
                  </select>
                </td>
                <td>
                  <select value={row.work_type} onChange={e => set(i,'work_type',e.target.value)} disabled={disabled} style={{width:100}}>
                    <option>Contract</option><option>Daywork</option>
                  </select>
                </td>
                <td><input value={row.notes || ''} onChange={e => set(i,'notes',e.target.value)} disabled={disabled} placeholder="Notes" /></td>
                {!disabled && <td><button className="btn-remove" onClick={() => remove(i)}>✕</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <datalist id="dl-plant-refs">
        {suggestions.plant.map(p => <option key={p.ref} value={p.ref} />)}
      </datalist>
      <datalist id="dl-plant-desc">
        {suggestions.plantDescriptions.map(d => <option key={d} value={d} />)}
      </datalist>
      <datalist id="dl-operators">
        {suggestions.operators.map(o => <option key={o} value={o} />)}
      </datalist>
    </div>
  );
}

/* ── Activities Section ──────────────────────────────────────────────────── */
function ActivitiesSection({ rows, setRows, disabled, suggestions }) {
  const add    = () => setRows(r => [...r, emptyActivity()]);
  const remove = i => setRows(r => r.filter((_, j) => j !== i));
  const set    = (i, k, v) => setRows(r => r.map((row, j) => j === i ? { ...row, [k]: v } : row));

  // Descrição já usada antes? Preenche a unidade se ainda estiver vazia
  const setDescription = (i, desc) => {
    const known = suggestions.activities.find(a => a.description.toLowerCase() === desc.trim().toLowerCase());
    setRows(r => r.map((row, j) => j === i ? {
      ...row, description: desc,
      unit: (!row.unit && known) ? known.unit : row.unit,
    } : row));
  };

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
                    <td><input value={row.description} onChange={e => setDescription(row._idx, e.target.value)} disabled={disabled} placeholder="Describe work done today…" style={{minWidth:220}} list="dl-activities" /></td>
                    <td><input type="number" step="any" min="0" value={row.qty_today || ''} onChange={e => set(row._idx,'qty_today',e.target.value)} disabled={disabled} style={{width:70}} placeholder="—" /></td>
                    <td><input value={row.unit || ''} onChange={e => set(row._idx,'unit',e.target.value)} disabled={disabled} style={{width:55}} placeholder="m, m², nr…" list="dl-units" /></td>
                    <td>
                      <select value={row.work_type} onChange={e => set(row._idx,'work_type',e.target.value)} disabled={disabled} style={{width:100}}>
                        <option>Contract</option><option>Daywork</option>
                      </select>
                    </td>
                    <td><input value={row.notes || ''} onChange={e => set(row._idx,'notes',e.target.value)} disabled={disabled} placeholder="Notes" /></td>
                    {!disabled && <td><button className="btn-remove" onClick={() => remove(row._idx)}>✕</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}

      {/* Ungrouped new rows (no code assigned yet shows at bottom) */}
      <datalist id="dl-activities">
        {suggestions.activities.map(a => <option key={a.description} value={a.description} />)}
      </datalist>
      <datalist id="dl-units">
        {suggestions.units.map(u => <option key={u} value={u} />)}
      </datalist>
    </div>
  );
}

/* ── Shared Field wrapper ────────────────────────────────────────────────── */
function Field({ label, children, required, span2 }) {
  return (
    <div className={`field${span2 ? ' span2' : ''}`}>
      <label className="field-label">{label}{required && <span className="req">*</span>}</label>
      {children}
    </div>
  );
}
