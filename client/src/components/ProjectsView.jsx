import { useState, useEffect } from 'react';
import { apiFetch } from '../apiFetch.js';

export default function ProjectsView({ onSelectProject }) {
  const [projects, setProjects]   = useState([]);
  const [loading,  setLoading]    = useState(true);
  const [showNew,  setShowNew]    = useState(false);
  const [form,     setForm]       = useState({ name: '', ref: '', client: '', contract_value: '', start_date: '', end_date: '' });
  const [saving,   setSaving]     = useState(false);
  const [error,    setError]      = useState('');

  useEffect(() => { load(); }, []);

  function load() {
    setLoading(true);
    apiFetch('/api/v1/projects')
      .then(r => r.json())
      .then(data => { setProjects(data); setLoading(false); })
      .catch(() => setLoading(false));
  }

  function openNew() { setForm({ name: '', ref: '', client: '', contract_value: '', start_date: '', end_date: '' }); setError(''); setShowNew(true); }
  function closeNew() { setShowNew(false); }

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.ref.trim()) { setError('Name and Reference are required.'); return; }
    setSaving(true);
    setError('');
    try {
      const r = await apiFetch('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, contract_value: parseFloat(form.contract_value) || 0 }),
      });
      if (!r.ok) { const d = await r.json(); setError(d.error || 'Error creating project'); setSaving(false); return; }
      closeNew();
      load();
    } catch { setError('Network error'); }
    setSaving(false);
  }

  const fmt = n => n ? new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0 }).format(n) : '—';

  return (
    <div className="projects-page">
      <div className="projects-header">
        <h1 className="projects-title">My Projects</h1>
        <button className="btn-primary" onClick={openNew}>+ New Project</button>
      </div>

      {loading && <p className="projects-empty">Loading…</p>}

      {!loading && projects.length === 0 && (
        <div className="projects-empty-state">
          <p>No projects yet.</p>
          <button className="btn-primary" onClick={openNew}>Create your first project</button>
        </div>
      )}

      {!loading && projects.length > 0 && (
        <div className="projects-grid">
          {projects.map(p => (
            <div key={p.id} className="project-card" onClick={() => onSelectProject(p)}>
              <div className="project-card-ref">{p.ref}</div>
              <div className="project-card-name">{p.name}</div>
              <div className="project-card-client">{p.client}</div>
              <div className="project-card-value">{fmt(p.contract_value)}</div>
              <div className="project-card-status">{p.status}</div>
            </div>
          ))}
        </div>
      )}

      {showNew && (
        <div className="modal-overlay" onClick={closeNew}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">New Project</span>
              <button className="modal-close" onClick={closeNew}>✕</button>
            </div>
            <form onSubmit={handleCreate} className="modal-body">
              <div className="form-row">
                <label>Project Name *</label>
                <input autoFocus value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Merlin Park" />
              </div>
              <div className="form-row">
                <label>Reference *</label>
                <input value={form.ref} onChange={e => setForm(f => ({ ...f, ref: e.target.value }))} placeholder="e.g. W03/26" />
              </div>
              <div className="form-row">
                <label>Client</label>
                <input value={form.client} onChange={e => setForm(f => ({ ...f, client: e.target.value }))} placeholder="e.g. Uisce Éireann" />
              </div>
              <div className="form-row">
                <label>Contract Value (€)</label>
                <input type="number" step="0.01" value={form.contract_value} onChange={e => setForm(f => ({ ...f, contract_value: e.target.value }))} placeholder="0.00" />
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
              {error && <p className="form-error">{error}</p>}
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={closeNew}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create Project'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
