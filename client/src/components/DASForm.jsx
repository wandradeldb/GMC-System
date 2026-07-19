import { apiFetch } from '../apiFetch.js';
import { useState, useEffect, useCallback, useRef } from 'react';
import NextWeekForm from './NextWeekForm.jsx';
import { gridKeyNav } from '../gridKeyNav.js';

const ACTIVITY_CODES = ['A','B','C','D','E','F','G'];
const CODE_LABELS    = { A:'Civil', B:'Mechanical', C:'Electrical', D:'Instrumentation', E:'Commissioning', F:'Preliminaries', G:'Other' };
const SERVICE_CATS   = ['Pump Station','Manhole','Pipework','Preliminaries','MEICA','Landscape','Other'];
const WEATHER_OPTS   = ['Fine','Overcast','Light Rain','Heavy Rain','Wind','Frost','Snow'];
const TRADES         = ['Site Agent','Ganger','Labourer','Carpenter','Fitter','Electrician','Welder','Driver','Groundworker','Other'];

const emptyLabour   = () => ({ worker_name:'', trade:'Labourer', subcontract_id:null, period:'full', hours_worked:8, overtime_hours:0, activity_code:'A', work_type:'Contract', notes:'' });
const emptyPlant    = () => ({ plant_ref:'', description:'', operator:'', subcontract_id:null, period:'full', hours_worked:8, hours_idle:0, activity_code:'A', work_type:'Contract', notes:'' });
const emptyActivity = () => ({ activity_code:'A', service_category:'Pump Station', description:'', qty_today:'', unit:'', work_type:'Contract', notes:'' });

// Group flat segment rows into per-person/per-item cards — 2 segments (am/pm) = a split day
// Pairs an 'am' row with the immediately-following 'pm' row of the SAME entity (worker/plant item)
// into one card; everything else stays a single-segment ('full') card. Adjacency-based (not name-based)
// so two different blank/new rows never get accidentally merged just for sharing an empty name.
function groupSegments(rows, sameEntity) {
  const groups = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i], next = rows[i + 1];
    if (row.period === 'am' && next && next.period === 'pm' && sameEntity(row, next)) {
      groups.push({ rows: [{ ...row, _idx: i }, { ...next, _idx: i + 1 }] });
      i++; // consumed the paired pm row
    } else {
      groups.push({ rows: [{ ...row, _idx: i }] });
    }
  }
  return groups;
}

export default function DASForm({ projectId, date, showNextWeek, nextMonday, onSaved }) {
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [entry,    setEntry]    = useState({ site_agent:'', site_agent_code:'', weather:'Fine', work_type:'Contract', general_notes:'', status:'draft', photo_url: null, stoppage_reason:'' });
  const [labour,   setLabour]   = useState([]);
  const [plant,    setPlant]    = useState([]);
  const [activities, setActivities] = useState([]);
  const [subs,     setSubs]     = useState([]); // subcontractors on site today
  const [activeTab, setActiveTab]   = useState('sub');
  // Trava até o site agent confirmar que é o dia certo — reseta sempre que a data muda
  const [dayConfirmed, setDayConfirmed] = useState(false);
  useEffect(() => { setDayConfirmed(false); setActiveTab('sub'); }, [date]);
  // Histórico do projeto (nomes, máquinas, atividades já digitados antes) — alimenta os autocompletes
  const [suggestions, setSuggestions] = useState({ workers:[], plant:[], plantDescriptions:[], operators:[], activities:[], units:[], siteAgents:[] });
  // Subcontratados do projeto (pra clicar e escolher — não é pra digitar)
  const [subcontracts, setSubcontracts] = useState([]);
  // Registo de Site Agents (código, nome, telefone) — pra autocomplete + mostrar o código
  const [siteAgentList, setSiteAgentList] = useState([]);

  const loadSuggestions = useCallback(() => {
    apiFetch(`/api/v1/projects/${projectId}/das/suggestions`).then(r => r.json()).then(setSuggestions);
  }, [projectId]);

  useEffect(() => { loadSuggestions(); }, [loadSuggestions]);

  useEffect(() => {
    apiFetch(`/api/v1/projects/${projectId}/das/subs`).then(r => r.json()).then(setSubcontracts);
  }, [projectId]);

  useEffect(() => {
    apiFetch(`/api/v1/das/site-agents`).then(r => r.json()).then(setSiteAgentList);
  }, []);

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
        setSubs(d.subcontractors || []);
        setLoading(false);
      });
  }, [projectId, date]);

  const save = async (status) => {
    setSaving(true);
    const body = { entry: { ...entry, status: status || entry.status }, labour, plant, activities, subcontractors: subs };
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
  const locked = !dayConfirmed && !isSubmitted;
  const sectionDisabled = isSubmitted || locked;
  const goNext = () => {
    const i = DAS_STEPS.findIndex(s => s.key === activeTab);
    if (i >= 0 && i < DAS_STEPS.length - 1) setActiveTab(DAS_STEPS[i + 1].key);
  };
  // Contagem por pessoa/item (não por linha crua) — um dia dividido AM/PM ainda conta como 1
  const workerCount = groupSegments(labour, (a, b) => a.worker_name === b.worker_name && a.subcontract_id === b.subcontract_id).length;
  const plantCount  = groupSegments(plant, (a, b) => a.plant_ref === b.plant_ref && a.description === b.description && a.subcontract_id === b.subcontract_id).length;

  return (
    <div className="das-form">
      {/* DAS Header Info */}
      <div className="das-header-card">
        <div className="das-header-left">
          <div className="das-date-label">{fmtDate(date)}</div>
          <span className={`das-status ${isSubmitted ? 'submitted' : 'draft'}`}>
            {isSubmitted ? 'Submitted' : 'Draft'}
          </span>
          {!isSubmitted && (
            <label className="das-confirm-day">
              <input type="checkbox" checked={dayConfirmed} onChange={e => setDayConfirmed(e.target.checked)} />
              ✓ Confirm this is the correct day
            </label>
          )}
        </div>
        <div className="das-header-right">
          <div className="das-summary-pills">
            <span className="pill">{workerCount} Workers</span>
            <span className="pill">{plantCount} Plant</span>
            <span className="pill">{subs.length} Subs</span>
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
      {locked && (
        <div className="das-lock-alert">
          ⚠ Check the date above and tick "Confirm this is the correct day" to unlock Sub / Labour / Plant / Activities.
        </div>
      )}

      {/* Header — sempre visível, logo abaixo da data (não é mais um passo numerado) */}
      <HeaderSection entry={entry} setEntry={setEntry} disabled={isSubmitted} siteAgentList={siteAgentList} />

      {/* Step progress — like an airline booking flow: numbered, checks off as filled in, tap any step */}
      <StepProgress
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        locked={locked}
        done={{
          sub: subs.length > 0,
          labour: labour.length > 0,
          plant: plant.length > 0,
          activities: activities.length > 0,
        }}
      />

      <div className="das-tab-content" style={{ flex:1, minHeight:0, overflow:'auto' }}>
        {activeTab === 'sub' && (
          <SubSection rows={subs} setRows={setSubs} disabled={sectionDisabled} subcontracts={subcontracts}
            entry={entry} setEntry={setEntry} onNext={goNext} />
        )}
        {activeTab === 'labour' && (
          <LabourSection rows={labour} setRows={setLabour} disabled={sectionDisabled} suggestions={suggestions}
            subs={subs} onNext={goNext} />
        )}
        {activeTab === 'plant' && (
          <PlantSection rows={plant} setRows={setPlant} disabled={sectionDisabled} suggestions={suggestions}
            subs={subs} onNext={goNext} />
        )}
        {activeTab === 'activities' && (
          <ActivitiesSection rows={activities} setRows={setActivities} disabled={sectionDisabled} suggestions={suggestions}
            entry={entry} setEntry={setEntry} />
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
  { key:'sub',        label:'Sub' },
  { key:'labour',     label:'Labour' },
  { key:'plant',      label:'Plant' },
  { key:'activities', label:'Activities' },
];

function StepProgress({ activeTab, setActiveTab, done, locked }) {
  // Pisca o próximo passo ainda incompleto — orienta o site agent sem travar a navegação livre
  const nextKey = DAS_STEPS.find(s => !done[s.key])?.key;
  return (
    <div className="das-steps">
      {DAS_STEPS.map((s, i) => {
        const isDone   = done[s.key];
        const isActive = activeTab === s.key;
        const isNext   = !locked && !isActive && s.key === nextKey;
        return (
          <div key={s.key} className="das-step-wrap">
            <button type="button"
              className={`das-step ${isActive ? 'active' : ''} ${isDone ? 'done' : ''} ${isNext ? 'pulse' : ''}`}
              onClick={() => !locked && setActiveTab(s.key)} disabled={locked}>
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

/* ── Header Section — always visible, right below the date, not a numbered step ── */
function HeaderSection({ entry, setEntry, disabled, siteAgentList }) {
  const setSiteAgent = (name) => {
    const known = siteAgentList.find(a => a.name.toLowerCase() === name.trim().toLowerCase());
    setEntry(e => ({ ...e, site_agent: name, site_agent_code: known ? known.code : '' }));
  };

  return (
    <div className="das-header-fixed">
      <Field label="Site Agent" required>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <input value={entry.site_agent || ''} onChange={e => setSiteAgent(e.target.value)} disabled={disabled}
            list="dl-site-agents" style={{ flex:1, maxWidth:340 }} />
          {entry.site_agent_code && <span className="site-agent-code-badge">{entry.site_agent_code}</span>}
        </div>
        <datalist id="dl-site-agents">
          {siteAgentList.map(a => <option key={a.code || a.name} value={a.name} />)}
        </datalist>
      </Field>
    </div>
  );
}

/* ── Labour Section ──────────────────────────────────────────────────────── */
function LabourSection({ rows, setRows, disabled, suggestions, subs, onNext }) {
  const sameWorker = (a, b) => a.worker_name === b.worker_name && a.subcontract_id === b.subcontract_id;
  const groups = groupSegments(rows, sameWorker);

  const addBlank = () => setRows(r => [...r, emptyLabour()]);
  const addKnown = (w) => {
    if (rows.some(r => r.worker_name.toLowerCase() === w.name.toLowerCase())) return;
    setRows(r => [...r, { ...emptyLabour(), worker_name: w.name, trade: w.trade || 'Labourer' }]);
  };
  const removeGroup = (g) => {
    const idxs = new Set(g.rows.map(x => x._idx));
    setRows(r => r.filter((_, j) => !idxs.has(j)));
  };
  const setGroupField = (g, k, v) => {
    const idxs = new Set(g.rows.map(x => x._idx));
    setRows(r => r.map((row, j) => idxs.has(j) ? { ...row, [k]: v } : row));
  };
  const setSegField = (idx, k, v) => setRows(r => r.map((row, j) => j === idx ? { ...row, [k]: v } : row));
  const toggleSplit = (g, split) => {
    const idxs = g.rows.map(x => x._idx);
    setRows(r => {
      if (split && idxs.length === 1) {
        const base = r[idxs[0]];
        const half = Math.round(((parseFloat(base.hours_worked) || 8) / 2) * 10) / 10;
        const rest = r.filter((_, j) => !idxs.includes(j));
        return [...rest, { ...base, period: 'am', hours_worked: half }, { ...base, period: 'pm', hours_worked: half }];
      }
      if (!split && idxs.length === 2) {
        const a = r[idxs[0]], b = r[idxs[1]];
        const rest = r.filter((_, j) => !idxs.includes(j));
        return [...rest, { ...a, period: 'full', hours_worked: (parseFloat(a.hours_worked) || 0) + (parseFloat(b.hours_worked) || 0) }];
      }
      return r;
    });
  };

  const totalHours = rows.reduce((a, r) => a + (parseFloat(r.hours_worked) || 0), 0);
  const totalOT    = rows.reduce((a, r) => a + (parseFloat(r.overtime_hours) || 0), 0);

  return (
    <div>
      <div className="section-toolbar">
        <span className="section-stat">{groups.length} workers · {totalHours}h normal · {totalOT}h OT</span>
        {!disabled && <button className="btn-add" onClick={addBlank}>+ New Worker</button>}
      </div>

      {!disabled && suggestions.workers.length > 0 && (
        <div className="das-sub-chips" style={{ marginBottom: 16 }}>
          {suggestions.workers.map(w => {
            const added = rows.some(r => r.worker_name.toLowerCase() === w.name.toLowerCase());
            return (
              <button key={w.name} type="button" className={`das-sub-chip ${added ? 'added' : ''}`}
                onClick={() => addKnown(w)} disabled={added}>
                {added ? '✓ ' : '+ '}{w.name}
              </button>
            );
          })}
        </div>
      )}

      {groups.length === 0 ? (
        <div className="empty-hint">No labour recorded. Tap a name above or "+ New Worker" to begin.</div>
      ) : (
        <div className="worker-cards">
          {groups.map(g => {
            const first = g.rows[0];
            const isSplit = g.rows.length === 2;
            return (
              <div key={first._idx} className="worker-card">
                <div className="worker-card-row">
                  <input value={first.worker_name} onChange={e => setGroupField(g, 'worker_name', e.target.value)}
                    disabled={disabled} placeholder="Full name" list="dl-workers" className="worker-card-name" />
                  <select value={first.trade} onChange={e => setGroupField(g, 'trade', e.target.value)} disabled={disabled}>
                    {TRADES.map(t => <option key={t}>{t}</option>)}
                  </select>
                  <select value={first.subcontract_id || ''} disabled={disabled}
                    onChange={e => setGroupField(g, 'subcontract_id', e.target.value ? Number(e.target.value) : null)}>
                    <option value="">GMC Direct</option>
                    {subs.map(s => <option key={s.subcontract_id} value={s.subcontract_id}>{s.sub_name}</option>)}
                  </select>
                  <input type="number" min="0" max="12" step="0.5" value={first.overtime_hours} title="Overtime hours"
                    onChange={e => setGroupField(g, 'overtime_hours', e.target.value)} disabled={disabled} style={{ width: 55 }} />
                  {!disabled && <button className="btn-remove" onClick={() => removeGroup(g)}>✕</button>}
                </div>
                <div className="worker-card-split-toggle">
                  <button type="button" className={!isSplit ? 'active' : ''} onClick={() => toggleSplit(g, false)} disabled={disabled}>Full day</button>
                  <button type="button" className={isSplit ? 'active' : ''} onClick={() => toggleSplit(g, true)} disabled={disabled}>Split AM/PM</button>
                </div>
                {g.rows.map(seg => (
                  <div key={seg._idx} className="worker-card-segment">
                    {isSplit && <span className="segment-label">{seg.period === 'am' ? 'Morning' : 'Afternoon'}</span>}
                    <select value={seg.activity_code || ''} onChange={e => setSegField(seg._idx, 'activity_code', e.target.value)} disabled={disabled}>
                      {ACTIVITY_CODES.map(c => <option key={c} value={c}>{c} — {CODE_LABELS[c]}</option>)}
                    </select>
                    <select value={seg.work_type} onChange={e => setSegField(seg._idx, 'work_type', e.target.value)} disabled={disabled}>
                      <option>Contract</option><option>Daywork</option>
                    </select>
                    <input type="number" min="0" max="24" step="0.5" value={seg.hours_worked}
                      onChange={e => setSegField(seg._idx, 'hours_worked', e.target.value)} disabled={disabled} style={{ width: 60 }} />
                    <input value={seg.notes || ''} onChange={e => setSegField(seg._idx, 'notes', e.target.value)} disabled={disabled} placeholder="Notes" />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
      <datalist id="dl-workers">
        {suggestions.workers.map(w => <option key={w.name} value={w.name} />)}
      </datalist>

      <button type="button" className="btn-next" onClick={onNext}>Next → Plant</button>
    </div>
  );
}

/* ── Plant Section ───────────────────────────────────────────────────────── */
function PlantSection({ rows, setRows, disabled, suggestions, subs, onNext }) {
  const samePlant = (a, b) => a.plant_ref === b.plant_ref && a.description === b.description && a.subcontract_id === b.subcontract_id;
  const groups = groupSegments(rows, samePlant);

  const addBlank = () => setRows(r => [...r, emptyPlant()]);
  const addKnown = (p) => {
    if (rows.some(r => (r.plant_ref || '').toLowerCase() === p.ref.toLowerCase())) return;
    setRows(r => [...r, { ...emptyPlant(), plant_ref: p.ref, description: p.description, operator: p.operator }]);
  };
  const removeGroup = (g) => {
    const idxs = new Set(g.rows.map(x => x._idx));
    setRows(r => r.filter((_, j) => !idxs.has(j)));
  };
  const setGroupField = (g, k, v) => {
    const idxs = new Set(g.rows.map(x => x._idx));
    setRows(r => r.map((row, j) => idxs.has(j) ? { ...row, [k]: v } : row));
  };
  const setSegField = (idx, k, v) => setRows(r => r.map((row, j) => j === idx ? { ...row, [k]: v } : row));
  const toggleSplit = (g, split) => {
    const idxs = g.rows.map(x => x._idx);
    setRows(r => {
      if (split && idxs.length === 1) {
        const base = r[idxs[0]];
        const half = Math.round(((parseFloat(base.hours_worked) || 8) / 2) * 10) / 10;
        const rest = r.filter((_, j) => !idxs.includes(j));
        return [...rest, { ...base, period: 'am', hours_worked: half }, { ...base, period: 'pm', hours_worked: half }];
      }
      if (!split && idxs.length === 2) {
        const a = r[idxs[0]], b = r[idxs[1]];
        const rest = r.filter((_, j) => !idxs.includes(j));
        return [...rest, { ...a, period: 'full', hours_worked: (parseFloat(a.hours_worked) || 0) + (parseFloat(b.hours_worked) || 0) }];
      }
      return r;
    });
  };

  return (
    <div>
      <div className="section-toolbar">
        <span className="section-stat">{groups.length} plant items</span>
        {!disabled && <button className="btn-add" onClick={addBlank}>+ New Plant</button>}
      </div>

      {!disabled && suggestions.plant.length > 0 && (
        <div className="das-sub-chips" style={{ marginBottom: 16 }}>
          {suggestions.plant.map(p => {
            const added = rows.some(r => (r.plant_ref || '').toLowerCase() === p.ref.toLowerCase());
            return (
              <button key={p.ref} type="button" className={`das-sub-chip ${added ? 'added' : ''}`}
                onClick={() => addKnown(p)} disabled={added}>
                {added ? '✓ ' : '+ '}{p.ref} — {p.description}
              </button>
            );
          })}
        </div>
      )}

      {groups.length === 0 ? (
        <div className="empty-hint">No plant recorded. Tap an item above or "+ New Plant" to begin.</div>
      ) : (
        <div className="worker-cards">
          {groups.map(g => {
            const first = g.rows[0];
            const isSplit = g.rows.length === 2;
            return (
              <div key={first._idx} className="worker-card">
                <div className="worker-card-row">
                  <input value={first.plant_ref || ''} onChange={e => setGroupField(g, 'plant_ref', e.target.value)}
                    disabled={disabled} placeholder="e.g. P001" style={{ width: 70 }} list="dl-plant-refs" />
                  <input value={first.description} onChange={e => setGroupField(g, 'description', e.target.value)}
                    disabled={disabled} placeholder="e.g. 360 Excavator 20T" list="dl-plant-desc" className="worker-card-name" />
                  <input value={first.operator || ''} onChange={e => setGroupField(g, 'operator', e.target.value)}
                    disabled={disabled} placeholder="Operator name" list="dl-operators" style={{ width: 130 }} />
                  <select value={first.subcontract_id || ''} disabled={disabled}
                    onChange={e => setGroupField(g, 'subcontract_id', e.target.value ? Number(e.target.value) : null)}>
                    <option value="">GMC Direct</option>
                    {subs.map(s => <option key={s.subcontract_id} value={s.subcontract_id}>{s.sub_name}</option>)}
                  </select>
                  <input type="number" min="0" max="24" step="0.5" value={first.hours_idle} title="Idle hours"
                    onChange={e => setGroupField(g, 'hours_idle', e.target.value)} disabled={disabled} style={{ width: 55 }} />
                  {!disabled && <button className="btn-remove" onClick={() => removeGroup(g)}>✕</button>}
                </div>
                <div className="worker-card-split-toggle">
                  <button type="button" className={!isSplit ? 'active' : ''} onClick={() => toggleSplit(g, false)} disabled={disabled}>Full day</button>
                  <button type="button" className={isSplit ? 'active' : ''} onClick={() => toggleSplit(g, true)} disabled={disabled}>Split AM/PM</button>
                </div>
                {g.rows.map(seg => (
                  <div key={seg._idx} className="worker-card-segment">
                    {isSplit && <span className="segment-label">{seg.period === 'am' ? 'Morning' : 'Afternoon'}</span>}
                    <select value={seg.activity_code || ''} onChange={e => setSegField(seg._idx, 'activity_code', e.target.value)} disabled={disabled}>
                      {ACTIVITY_CODES.map(c => <option key={c} value={c}>{c} — {CODE_LABELS[c]}</option>)}
                    </select>
                    <select value={seg.work_type} onChange={e => setSegField(seg._idx, 'work_type', e.target.value)} disabled={disabled}>
                      <option>Contract</option><option>Daywork</option>
                    </select>
                    <input type="number" min="0" max="24" step="0.5" value={seg.hours_worked}
                      onChange={e => setSegField(seg._idx, 'hours_worked', e.target.value)} disabled={disabled} style={{ width: 60 }} />
                    <input value={seg.notes || ''} onChange={e => setSegField(seg._idx, 'notes', e.target.value)} disabled={disabled} placeholder="Notes" />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
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

      <button type="button" className="btn-next" onClick={onNext}>Next → Activities</button>
    </div>
  );
}

/* ── Subcontractors Section — tap a sub's name first, then fill their row ─── */
const emptySubEntry = (sc) => ({
  subcontract_id: sc.id, sub_name: sc.subcontractor_name,
  work_type: 'Contract', description: '', notes: '',
});

function SubSection({ rows, setRows, disabled, subcontracts, entry, setEntry, onNext }) {
  const remove = i => setRows(r => r.filter((_, j) => j !== i));
  const set    = (i, k, v) => setRows(r => r.map((row, j) => j === i ? { ...row, [k]: v } : row));

  const addSub = (sc) => {
    if (rows.some(r => r.subcontract_id === sc.id)) return; // already on today's list
    setRows(r => [...r, emptySubEntry(sc)]);
  };

  return (
    <div>
      <div className="section-toolbar">
        <span className="section-stat">{rows.length} subcontractor{rows.length === 1 ? '' : 's'} on site</span>
      </div>

      {!disabled && (
        subcontracts.length === 0 ? (
          <div className="empty-hint">No subcontracts set up on this project yet.</div>
        ) : (
          <div className="das-sub-chips">
            {subcontracts.map(sc => {
              const added = rows.some(r => r.subcontract_id === sc.id);
              return (
                <button key={sc.id} type="button" className={`das-sub-chip ${added ? 'added' : ''}`}
                  onClick={() => addSub(sc)} disabled={added}>
                  {added ? '✓ ' : '+ '}{sc.subcontractor_name}
                </button>
              );
            })}
          </div>
        )
      )}

      {rows.length === 0 ? (
        <div className="empty-hint">Tap a subcontractor above to add them to today's diary.</div>
      ) : (
        <table className="inline-table">
          <thead>
            <tr>
              <th>Subcontractor</th><th>Work Type</th><th>Description</th><th>Notes</th>
              {!disabled && <th></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{row.sub_name}</td>
                <td>
                  <select value={row.work_type} onChange={e => set(i,'work_type',e.target.value)} disabled={disabled} style={{width:100}}>
                    <option>Contract</option><option>Daywork</option>
                  </select>
                </td>
                <td><input value={row.description || ''} onChange={e => set(i,'description',e.target.value)} onKeyDown={gridKeyNav} data-grid-row={i} data-grid-col="description" disabled={disabled} placeholder="Work done today…" /></td>
                <td><input value={row.notes || ''} onChange={e => set(i,'notes',e.target.value)} onKeyDown={gridKeyNav} data-grid-row={i} data-grid-col="notes" disabled={disabled} placeholder="Notes" /></td>
                {!disabled && <td><button className="btn-remove" onClick={() => remove(i)}>✕</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="field" style={{ marginTop: 20 }}>
        <label className="field-label">General Notes</label>
        <textarea rows={2} value={entry.general_notes || ''} onChange={e => setEntry(en => ({ ...en, general_notes: e.target.value }))}
          placeholder="Site diary notes, issues, instructions received…" disabled={disabled} />
      </div>

      <button type="button" className="btn-next" onClick={onNext}>Next → Labour</button>
    </div>
  );
}

/* ── Activities Section ──────────────────────────────────────────────────── */
function ActivitiesSection({ rows, setRows, disabled, suggestions, entry, setEntry }) {
  const add    = () => setRows(r => [...r, emptyActivity()]);
  const remove = i => setRows(r => r.filter((_, j) => j !== i));
  const set    = (i, k, v) => setRows(r => r.map((row, j) => j === i ? { ...row, [k]: v } : row));
  const setEntryField = (k, v) => setEntry(e => ({ ...e, [k]: v }));
  const [stoppageOpen, setStoppageOpen] = useState(!!(entry.stoppage_reason || '').trim());

  const fileRef = useRef();
  const [compressing, setCompressing] = useState(false);
  async function handlePhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCompressing(true);
    const dataUrl = await compressImage(file);
    setEntryField('photo_url', dataUrl);
    setCompressing(false);
    e.target.value = '';
  }

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
      <div className="section-grid" style={{ marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid #e5e7eb' }}>
        <Field label="Weather">
          <select value={entry.weather || ''} onChange={e => setEntryField('weather', e.target.value)} disabled={disabled}>
            <option value="">— Select —</option>
            {WEATHER_OPTS.map(w => <option key={w}>{w}</option>)}
          </select>
        </Field>
        <Field label="Site Photo" span2>
          <div className="das-photo-wrap">
            {entry.photo_url ? (
              <div className="das-photo-preview">
                <img src={entry.photo_url} alt="Site photo" className="das-photo-img" />
                {!disabled && (
                  <button className="das-photo-remove" onClick={() => setEntryField('photo_url', null)} title="Remove photo">✕</button>
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

      <div className="das-stoppage-box">
        <label className="das-stoppage-toggle">
          <input type="checkbox" checked={stoppageOpen}
            onChange={e => { setStoppageOpen(e.target.checked); if (!e.target.checked) setEntryField('stoppage_reason', ''); }}
            disabled={disabled} />
          ⚠ Site was stopped / delayed today
        </label>
        {stoppageOpen && (
          <textarea rows={2} value={entry.stoppage_reason || ''}
            onChange={e => setEntryField('stoppage_reason', e.target.value)}
            placeholder="Reason — e.g. awaiting client decision, access denied, instruction pending…"
            disabled={disabled} />
        )}
      </div>

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
                    {/* description/unit keep native combobox arrow-key behaviour for their datalist suggestions, so they don't get grid nav */}
                    <td><input value={row.description} onChange={e => setDescription(row._idx, e.target.value)} disabled={disabled} placeholder="Describe work done today…" style={{minWidth:220}} list="dl-activities" /></td>
                    <td><input type="number" step="any" min="0" value={row.qty_today || ''} onChange={e => set(row._idx,'qty_today',e.target.value)} onKeyDown={gridKeyNav} data-grid-row={row._idx} data-grid-col="qty" disabled={disabled} style={{width:70}} placeholder="—" /></td>
                    <td><input value={row.unit || ''} onChange={e => set(row._idx,'unit',e.target.value)} disabled={disabled} style={{width:55}} placeholder="m, m², nr…" list="dl-units" /></td>
                    <td>
                      <select value={row.work_type} onChange={e => set(row._idx,'work_type',e.target.value)} disabled={disabled} style={{width:100}}>
                        <option>Contract</option><option>Daywork</option>
                      </select>
                    </td>
                    <td><input value={row.notes || ''} onChange={e => set(row._idx,'notes',e.target.value)} onKeyDown={gridKeyNav} data-grid-row={row._idx} data-grid-col="notes" disabled={disabled} placeholder="Notes" /></td>
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
