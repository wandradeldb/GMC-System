import { useState, useEffect } from 'react';
import { apiFetch } from '../apiFetch.js';

export default function ProjectsView({ onSelectProject }) {
  const [projects, setProjects]     = useState([]);
  const [loading,  setLoading]      = useState(true);
  const [showNew,  setShowNew]      = useState(false);
  const [shareProject, setShareProject] = useState(null); // project being managed
  const [members,  setMembers]      = useState([]);
  const [shareForm, setShareForm]   = useState({ username: '', role: 'viewer' });
  const [shareErr, setShareErr]     = useState('');
  const [form,     setForm]         = useState({ name: '', ref: '', client: '', contract_value: '', start_date: '', end_date: '' });
  const [saving,   setSaving]       = useState(false);
  const [error,    setError]        = useState('');

  useEffect(() => { load(); }, []);

  function load() {
    setLoading(true);
    apiFetch('/api/v1/projects')
      .then(r => r.json())
      .then(data => { setProjects(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }

  function openNew() { setForm({ name: '', ref: '', client: '', contract_value: '', start_date: '', end_date: '' }); setError(''); setShowNew(true); }
  function closeNew() { setShowNew(false); }

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.ref.trim()) { setError('Name and Reference are required.'); return; }
    setSaving(true); setError('');
    try {
      const r = await apiFetch('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, contract_value: parseFloat(form.contract_value) || 0 }),
      });
      if (!r.ok) { const d = await r.json(); setError(d.error || 'Error creating project'); setSaving(false); return; }
      closeNew(); load();
    } catch { setError('Network error'); }
    setSaving(false);
  }

  async function openShare(e, p) {
    e.stopPropagation();
    setShareProject(p); setShareErr(''); setShareForm({ username: '', role: 'viewer' });
    const r = await apiFetch(`/api/v1/projects/${p.id}/members`);
    if (r.ok) setMembers(await r.json());
    else setMembers([]);
  }
  function closeShare() { setShareProject(null); setMembers([]); }

  async function handleAddMember(e) {
    e.preventDefault();
    if (!shareForm.username.trim()) return;
    setShareErr('');
    const r = await apiFetch(`/api/v1/projects/${shareProject.id}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(shareForm),
    });
    if (!r.ok) { const d = await r.json(); setShareErr(d.error); return; }
    setShareForm({ username: '', role: 'viewer' });
    const r2 = await apiFetch(`/api/v1/projects/${shareProject.id}/members`);
    if (r2.ok) setMembers(await r2.json());
  }

  async function handleRemoveMember(userId) {
    await apiFetch(`/api/v1/projects/${shareProject.id}/members/${userId}`, { method: 'DELETE' });
    setMembers(m => m.filter(x => x.id !== userId));
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
              <div className="project-card-top">
                <span className="project-card-ref">{p.ref}</span>
                <span className="project-card-status">{p.status}</span>
              </div>
              <div className="project-card-name">{p.name}</div>
              <div className="project-card-client">{p.client || '—'}</div>
              {p.access_role !== 'site' && (
                <div className="project-card-value">{fmt(p.contract_value)}</div>
              )}
              <img src="/gmc-logo.png" alt="" className="project-card-logo" />
              {p.access_role === 'owner' && (
                <button className="project-card-share-btn" onClick={e => openShare(e, p)}>
                  👥 Share
                </button>
              )}
              {p.access_role !== 'owner' && (
                <span className="project-card-shared-badge">Shared with you</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* New Project modal */}
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

      {/* Share / Members modal */}
      {shareProject && (
        <div className="modal-overlay" onClick={closeShare}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Share — {shareProject.name}</span>
              <button className="modal-close" onClick={closeShare}>✕</button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleAddMember} className="share-add-row">
                <input
                  placeholder="Username"
                  value={shareForm.username}
                  onChange={e => setShareForm(f => ({ ...f, username: e.target.value }))}
                />
                <select value={shareForm.role} onChange={e => setShareForm(f => ({ ...f, role: e.target.value }))}>
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                  <option value="site">Site Team (Diary only)</option>
                </select>
                <button type="submit" className="btn-primary">Add</button>
              </form>
              {shareErr && <p className="form-error" style={{ marginTop: 8 }}>{shareErr}</p>}

              {members.length === 0 && <p className="share-empty">No members yet. Add a username above.</p>}
              {members.length > 0 && (
                <table className="share-table">
                  <thead><tr><th>Username</th><th>Role</th><th></th></tr></thead>
                  <tbody>
                    {members.map(m => (
                      <tr key={m.id}>
                        <td>{m.username}</td>
                        <td><span className="share-role-badge">{m.project_role}</span></td>
                        <td><button className="share-remove-btn" onClick={() => handleRemoveMember(m.id)}>✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
