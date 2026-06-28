import { apiFetch } from '../apiFetch.js';
import { useState, useEffect } from 'react';

export default function NextWeekForm({ projectId, monday, disabled }) {
  const [data,   setData]   = useState({ site_agent:'', planned_labour:'', planned_plant:'', planned_activities:'' });
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  useEffect(() => {
    apiFetch(`/api/v1/projects/${projectId}/next-week/${monday}`)
      .then(r => r.json())
      .then(d => setData({
        site_agent:          d.site_agent          || '',
        planned_labour:      d.planned_labour      || '',
        planned_plant:       d.planned_plant        || '',
        planned_activities:  d.planned_activities  || '',
      }));
  }, [projectId, monday]);

  const save = async () => {
    setSaving(true);
    await apiFetch(`/api/v1/projects/${projectId}/next-week/${monday}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const fmtMonday = d => new Date(d + 'T12:00:00').toLocaleDateString('en-IE', {
    weekday:'long', day:'numeric', month:'long'
  });

  return (
    <div className="next-week-card">
      <div className="next-week-header">
        <span className="next-week-icon">ðŸ“…</span>
        <div>
          <div className="next-week-title">Next Week Plan</div>
          <div className="next-week-sub">Week commencing {fmtMonday(monday)}</div>
        </div>
        <button className="btn-save" style={{marginLeft:'auto'}} onClick={save} disabled={saving || disabled}>
          {saving ? 'Savingâ€¦' : saved ? 'âœ“ Saved' : 'Save Plan'}
        </button>
      </div>

      <div className="section-grid" style={{marginTop:16}}>
        <div className="field">
          <label className="field-label">Planned Labour</label>
          <textarea rows={3} value={data.planned_labour}
            onChange={e => setData(d => ({...d, planned_labour: e.target.value}))}
            placeholder="Who will be on site next weekâ€¦" disabled={disabled} />
        </div>
        <div className="field">
          <label className="field-label">Planned Plant</label>
          <textarea rows={3} value={data.planned_plant}
            onChange={e => setData(d => ({...d, planned_plant: e.target.value}))}
            placeholder="Plant and equipment requiredâ€¦" disabled={disabled} />
        </div>
        <div className="field span2">
          <label className="field-label">Planned Activities</label>
          <textarea rows={4} value={data.planned_activities}
            onChange={e => setData(d => ({...d, planned_activities: e.target.value}))}
            placeholder="Describe planned work activities for the coming weekâ€¦" disabled={disabled} />
        </div>
      </div>
    </div>
  );
}
