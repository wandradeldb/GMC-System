import { useState } from 'react';
import { apiFetch } from '../apiFetch.js';

const STATUS_OPTIONS = [
  { value: 'active',    label: 'Active' },
  { value: 'on_hold',   label: 'On Hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'closed',    label: 'Closed' },
];

export default function ProjectSettingsView({ project, onProjectUpdated }) {
  const [form, setForm] = useState({
    name:           project.name           || '',
    ref:            project.ref            || '',
    client:         project.client         || '',
    contract_value: project.contract_value || '',
    start_date:     project.start_date     || '',
    end_date:       project.end_date       || '',
    status:         project.status         || 'active',
  });
  const [saving,  setSaving]  = useState(false);
  const [success, setSuccess] = useState(false);
  const [error,   setError]   = useState('');

  async function handleSave(e) {
    e.preventDefault();
    setError(''); setSuccess(false);
    if (!form.name.trim() || !form.ref.trim()) { setError('Name and Reference are required.'); return; }
    setSaving(true);
    const r = await apiFetch(`/api/v1/projects/${project.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (!r.ok) { const d = await r.json(); setError(d.error || 'Error saving settings.'); return; }
    setSuccess(true);
    onProjectUpdated({ ...project, ...form, contract_value: parseFloat(form.contract_value) || 0 });
  }

  const statusColor = {
    active:    { bg: '#dcfce7', color: '#166534' },
    on_hold:   { bg: '#fef9c3', color: '#92400e' },
    completed: { bg: '#dbeafe', color: '#1e40af' },
    closed:    { bg: '#f3f4f6', color: '#6b7280' },
  };

  return (
    <div className="profile-page">
      <div className="profile-card">
        <div style={{ flex: 1 }}>
          <div className="profile-username">{form.name}</div>
          <div className="profile-handle">{form.ref}{form.client ? ` · ${form.client}` : ''}</div>
        </div>
        <span style={{
          fontSize: 12, fontWeight: 600, padding: '3px 12px', borderRadius: 99,
          background: statusColor[form.status]?.bg,
          color: statusColor[form.status]?.color,
          textTransform: 'capitalize',
        }}>
          {STATUS_OPTIONS.find(s => s.value === form.status)?.label}
        </span>
      </div>

      <div className="profile-section">
        <h2 className="profile-section-title">Project Settings</h2>
        <form onSubmit={handleSave} className="profile-form">
          <div className="form-row-2col">
            <div className="form-row">
              <label>Project Name *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Merlin Park" required />
            </div>
            <div className="form-row">
              <label>Reference *</label>
              <input value={form.ref} onChange={e => setForm(f => ({ ...f, ref: e.target.value }))} placeholder="e.g. W03/26" required />
            </div>
          </div>
          <div className="form-row-2col">
            <div className="form-row">
              <label>Client</label>
              <input value={form.client} onChange={e => setForm(f => ({ ...f, client: e.target.value }))} placeholder="e.g. Uisce Éireann" />
            </div>
            <div className="form-row">
              <label>Contract Value (€)</label>
              <input type="number" step="0.01" value={form.contract_value} onChange={e => setForm(f => ({ ...f, contract_value: e.target.value }))} placeholder="0.00" />
            </div>
          </div>
          <div className="form-row-2col">
            <div className="form-row">
              <label>Start Date</label>
              <input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
            </div>
            <div className="form-row">
              <label>End Date</label>
              <input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
            </div>
          </div>
          <div className="form-row">
            <label>Status</label>
            <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          {error   && <p className="form-error">{error}</p>}
          {success && <p className="form-success">Settings saved.</p>}
          <div className="profile-form-footer">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save Settings'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
