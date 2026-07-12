import { apiFetch } from '../apiFetch.js';
import { useState, useEffect, useRef } from 'react';

function SupplierSearch({ onSelect }) {
  const [query,    setQuery]   = useState('');
  const [results,  setResults] = useState([]);
  const [open,     setOpen]    = useState(false);
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    if (query.length < 2) { setResults([]); setOpen(false); return; }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      apiFetch(`/api/v1/subcontractors?q=${encodeURIComponent(query)}`)
        .then(r => r.json())
        .then(data => { setResults(data); setOpen(true); });
    }, 220);
  }, [query]);

  const pick = (s) => {
    setSelected(s);
    setQuery(s.name);
    setOpen(false);
    onSelect(s);
  };

  // Not in the GMC master list — create it there first, then select it like any other supplier.
  const createNew = async () => {
    setCreating(true);
    const s = await apiFetch('/api/v1/subcontractors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: query.trim() }),
    }).then(r => r.json());
    setCreating(false);
    pick(s);
  };

  return (
    <div style={{ position: 'relative' }}>
      <input
        value={query}
        onChange={e => { setQuery(e.target.value); setSelected(null); onSelect(null); }}
        placeholder="Type supplier name or code…"
        style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
        onFocus={() => (results.length || query.trim().length >= 2) && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (results.length > 0 || query.trim().length >= 2) && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
          background: '#fff', border: '1px solid #d1d5db', borderRadius: 6,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)', maxHeight: 260, overflowY: 'auto',
        }}>
          {results.map(s => (
            <div key={s.id}
              onMouseDown={() => pick(s)}
              style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f3f4f6', fontSize: 13 }}
              onMouseEnter={e => e.currentTarget.style.background = '#f0f9ff'}
              onMouseLeave={e => e.currentTarget.style.background = '#fff'}
            >
              <div style={{ fontWeight: 600 }}>{s.name}</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>
                {s.code && <span style={{ fontFamily: 'monospace', marginRight: 8 }}>{s.code}</span>}
                {s.balance > 0 && <span style={{ color: '#166534' }}>Balance: €{s.balance.toLocaleString('en-IE', { minimumFractionDigits: 2 })}</span>}
                {s.email && <span style={{ marginLeft: 8 }}>{s.email}</span>}
              </div>
            </div>
          ))}
          {query.trim().length >= 2 && (
            <div
              onMouseDown={createNew}
              style={{ padding: '8px 12px', cursor: creating ? 'default' : 'pointer', fontSize: 13, fontWeight: 600, color: '#1d4ed8', background: '#f8faff' }}
              onMouseEnter={e => e.currentTarget.style.background = '#eff6ff'}
              onMouseLeave={e => e.currentTarget.style.background = '#f8faff'}
            >
              {creating ? 'Creating…' : `+ Create new supplier "${query.trim()}"`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function NewSubcontractModal({ projectId, onClose, onCreated }) {
  const [supplier, setSupplier] = useState(null);
  const [form, setForm] = useState({
    ref: '', description: '', contract_value: '', retention_pct: '5',
    start_date: '', end_date: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const selectSupplier = (s) => {
    setSupplier(s);
    if (s?.code) set('ref', s.code);
  };

  const submit = async () => {
    if (!supplier) { setErr('Select a supplier first.'); return; }
    if (!form.ref) { setErr('Reference is required.'); return; }
    setSaving(true); setErr('');
    const sc = await apiFetch(`/api/v1/projects/${projectId}/subcontracts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subcontractor_id: supplier.id,
        ref:           form.ref,
        description:   form.description,
        contract_value: parseFloat(form.contract_value) || 0,
        retention_pct:  parseFloat(form.retention_pct)  || 5,
        start_date: form.start_date || null,
        end_date:   form.end_date   || null,
      }),
    }).then(r => r.json());
    setSaving(false);
    onCreated(sc);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>New Subcontract</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <div className="modal-section-label" style={{ marginBottom: 8 }}>Subcontractor</div>
          <SupplierSearch onSelect={selectSupplier} />
          {supplier && (
            <div style={{ marginTop: 8, padding: '8px 12px', background: '#f0fdf4', borderRadius: 6, fontSize: 13, color: '#166534', fontWeight: 600 }}>
              ✓ {supplier.name} {supplier.code ? `[${supplier.code}]` : ''}
            </div>
          )}

          <div className="modal-divider" />
          <div className="modal-section-label" style={{ marginBottom: 12 }}>Subcontract Details</div>
          <div className="section-grid">
            <div className="field">
              <label className="field-label">Reference *</label>
              <input value={form.ref} onChange={e => set('ref', e.target.value)} placeholder="Auto-filled from supplier code" />
            </div>
            <div className="field">
              <label className="field-label">Retention %</label>
              <input type="number" step="0.5" min="0" max="10" value={form.retention_pct} onChange={e => set('retention_pct', e.target.value)} />
            </div>
            <div className="field span2">
              <label className="field-label">Description / Scope *</label>
              <input value={form.description} onChange={e => set('description', e.target.value)} placeholder="Civil works — tank excavation and construction" />
            </div>
            <div className="field">
              <label className="field-label">Contract Value (€)</label>
              <input type="number" step="0.01" value={form.contract_value} onChange={e => set('contract_value', e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">Start Date</label>
              <input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">End Date</label>
              <input type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)} />
            </div>
          </div>
          {err && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 8 }}>{err}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={saving || !supplier}>
            {saving ? 'Creating…' : 'Create Subcontract'}
          </button>
        </div>
      </div>
    </div>
  );
}
