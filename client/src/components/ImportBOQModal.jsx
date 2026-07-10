import { apiFetch } from '../apiFetch.js';
import { useState, useRef } from 'react';

const fmt2 = (n) => new Intl.NumberFormat('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

// Must match RevenueGenerationView.jsx's SECTIONS exactly — the weekly rollup in
// server/routes/revenue.js sums revenue by this exact string into fixed Cost Tracker columns,
// so anything outside this list would silently vanish from the tracker instead of erroring.
const REVENUE_SECTIONS = ['Prelim Fixed', 'Prelim Time', 'Civil Works', 'MEICA Works', 'Landscape', 'Commission'];

// Best-effort guess from a bill's label text — left blank (forcing a manual pick) whenever the
// keyword match isn't confident, since a wrong guess here silently miscounts revenue in the Cost
// Tracker (see server/routes/revenue.js's SECTION_COL comment).
function guessRevenueSection(label) {
  const l = (label || '').toLowerCase();
  if (l.includes('prelim') && l.includes('fixed')) return 'Prelim Fixed';
  if (l.includes('prelim') && l.includes('time')) return 'Prelim Time';
  if (l.includes('meica')) return 'MEICA Works';
  if (l.includes('landscap')) return 'Landscape';
  if (l.includes('commission') || l.includes('plant operation')) return 'Commission';
  return '';
}

export default function ImportBOQModal({ projectId, onClose, onImported }) {
  const [step, setStep]         = useState('input'); // 'input' | 'preview' | 'done'
  const [rows, setRows]         = useState([]);
  const [schedules, setSchedules] = useState([]);      // [{schedule,label,itemCount,subtotal}]
  const [sectionByBill, setSectionByBill] = useState({}); // { [schedule]: revenueSection }
  const [sectioned, setSectioned] = useState(false);   // file already carries a Section column (REV1)
  const [warnings, setWarnings] = useState([]);
  const [parsing, setParsing]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState('');
  const [result, setResult]     = useState(null);
  const [revResult, setRevResult] = useState(null);
  const [revError, setRevError] = useState('');
  const fileRef = useRef();

  const parseFull = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) { setErr('Choose a file first.'); return; }
    setErr(''); setParsing(true);
    const form = new FormData();
    form.append('file', file);
    const res = await apiFetch(`/api/v1/projects/${projectId}/boq-import/parse-excel-full`, { method: 'POST', body: form });
    const json = await res.json();
    setParsing(false);
    if (!res.ok) { setErr(json.error || 'Failed to parse file.'); return; }
    setRows(json.rows);
    setSchedules(json.schedules || []);
    setWarnings(json.warnings || []);
    setSectioned(!!json.sectioned);
    const seeded = {};
    // REV1 layout: each bill/group IS a revenue category already → map identity (no manual choice).
    // Older layout: pre-fill a best-guess per bill, user confirms/edits.
    (json.schedules || []).forEach(s => {
      seeded[s.schedule] = json.sectioned ? s.schedule : guessRevenueSection(s.label);
    });
    setSectionByBill(seeded);
    setStep('preview');
  };

  const removeRow = (idx) => setRows(rs => rs.filter((_, i) => i !== idx));

  const goBack = () => {
    setRows([]); setWarnings([]); setSchedules([]); setSectionByBill({}); setSectioned(false);
    setErr(''); setResult(null); setRevResult(null); setRevError(''); setStep('input');
  };

  const commit = async () => {
    setSaving(true); setErr(''); setRevError('');
    const res = await apiFetch(`/api/v1/projects/${projectId}/boq-import/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mode === 'full'
        ? { rows }
        : { rows, schedule: schedule.trim(), type }),
    });
    const json = await res.json();
    if (!res.ok) { setSaving(false); setErr(json.error || 'Import failed.'); return; }
    setResult(json);

    if (mode === 'full') {
      // Match the Merlin Park standard: Revenue Generator activities use the PD Ref (captured into
      // iw_cost_code by the full-sheet parser) as the reference, falling back to the unique Item
      // value when PD Ref is blank. PD Ref repeats by design, so import insert-only (dedup: false).
      const revenueRows = rows
        .filter(r => sectionByBill[r.schedule])
        .map(r => ({
          ref: r.iw_cost_code || r.item_ref,
          description: r.description,
          qty: r.qty,
          unit: r.unit,
          rate: r.rate,
          section: sectionByBill[r.schedule],
        }));
      if (revenueRows.length > 0) {
        const revRes = await apiFetch(`/api/v1/projects/${projectId}/revenue/activities`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: revenueRows, dedup: false }),
        });
        const revJson = await revRes.json();
        if (revRes.ok) setRevResult(revJson);
        else setRevError(revJson.error || 'Failed to create Revenue Generator activities.');
      }
    } else if (revenueSection) {
      const revRes = await apiFetch(`/api/v1/projects/${projectId}/revenue/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, section: revenueSection }),
      });
      const revJson = await revRes.json();
      if (revRes.ok) setRevResult(revJson);
      else setRevError(revJson.error || 'Failed to create Revenue Generator activities.');
    }

    setSaving(false);
    setStep('done');
  };

  const total = rows.reduce((acc, r) => acc + (r.contract_sum || (r.qty * r.rate) || 0), 0);

  const renderRow = (r, i) => (
    <tr key={i}>
      <td className="col-ref">{r.iw_cost_code || r.item_ref}</td>
      <td className="col-desc">{r.description}</td>
      <td className="col-unit">{r.unit}</td>
      <td className="col-num">{r.qty}</td>
      <td className="col-num">{fmt2(r.rate)}</td>
      <td className="col-num">{fmt2(r.contract_sum ?? r.qty * r.rate)}</td>
      <td className="col-type">{r.type}</td>
      <td><span className="import-row-remove" onClick={() => removeRow(i)} title="Remove row">✕</span></td>
    </tr>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 720 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Import BOQ</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {step === 'input' && (
            <>
              <div style={{
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: 14,
                marginBottom: 16,
                backgroundColor: '#f9fafb'
              }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10, color: '#374151' }}>
                  📋 Expected Column Format
                </div>
                <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #d1d5db' }}>
                      <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: '#6b7280' }}>Column</th>
                      <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: '#6b7280' }}>Header Name</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ padding: '6px 8px', color: '#374151' }}>A</td>
                      <td style={{ padding: '6px 8px', color: '#374151' }}>Item</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ padding: '6px 8px', color: '#374151' }}>B</td>
                      <td style={{ padding: '6px 8px', color: '#374151' }}>PD Ref</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ padding: '6px 8px', color: '#374151' }}>C</td>
                      <td style={{ padding: '6px 8px', color: '#374151' }}>Description</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ padding: '6px 8px', color: '#374151' }}>D</td>
                      <td style={{ padding: '6px 8px', color: '#374151' }}>Unit</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ padding: '6px 8px', color: '#374151' }}>E</td>
                      <td style={{ padding: '6px 8px', color: '#374151' }}>Qty</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ padding: '6px 8px', color: '#374151' }}>F</td>
                      <td style={{ padding: '6px 8px', color: '#374151' }}>Rate</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ padding: '6px 8px', color: '#374151' }}>G</td>
                      <td style={{ padding: '6px 8px', color: '#374151' }}>Amount</td>
                    </tr>
                    <tr style={{ backgroundColor: '#fef3c7' }}>
                      <td style={{ padding: '6px 8px', color: '#92400e', fontWeight: 600 }}>H</td>
                      <td style={{ padding: '6px 8px', color: '#92400e', fontWeight: 600 }}>Section ⭐ (Prelim Fixed, Temp, etc.)</td>
                    </tr>
                  </tbody>
                </table>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 8, fontStyle: 'italic' }}>
                  ⭐ Column H (Section) is the most important — it organizes activities by category (Prelim Fixed, Prelim Time, Pump Station, etc.)
                </div>
              </div>

              <div className="field">
                <label className="field-label">Excel File (.xlsx, .xls)</label>
                <input ref={fileRef} type="file" accept=".xlsx,.xls" />
              </div>

              {err && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 8 }}>{err}</div>}
            </>
          )}

          {step === 'preview' && (
            <>
              {warnings.length > 0 && (
                <div className="import-warning-banner">
                  {warnings.map((w, i) => <div key={i}>{w}</div>)}
                </div>
              )}
              <div style={{ fontSize: 13, fontWeight: 600, margin: '10px 0' }}>
                {rows.length} item{rows.length === 1 ? '' : 's'} ready to import — total € {fmt2(total)}
              </div>

              <div className="import-preview-table-wrap">
                {schedules.map(s => (
                  <div key={s.schedule} style={{ marginBottom: 18 }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: 12, padding: '6px 4px', flexWrap: 'wrap',
                    }}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>
                        {sectioned ? s.schedule : (
                          <>Schedule {s.schedule} {s.label ? `— ${s.label}` : '(no label)'}</>
                        )}
                        <span style={{ fontWeight: 400, color: '#6b7280', marginLeft: 8 }}>
                          {s.itemCount} items · € {fmt2(s.subtotal)}
                        </span>
                      </div>
                      {sectioned ? (
                        <span style={{ fontSize: 11, color: '#6b7280', fontStyle: 'italic' }}>
                          Revenue Section from file
                        </span>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <label className="field-label" style={{ margin: 0 }}>Revenue Section</label>
                          <select
                            value={sectionByBill[s.schedule] || ''}
                            onChange={e => setSectionByBill(m => ({ ...m, [s.schedule]: e.target.value }))}
                          >
                            <option value="">— skip —</option>
                            {REVENUE_SECTIONS.map(sec => <option key={sec} value={sec}>{sec}</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                    <table className="boq-table">
                      <thead>
                        <tr>
                          <th className="col-ref">Ref</th>
                          <th className="col-desc">Description</th>
                          <th className="col-unit">Unit</th>
                          <th className="col-num">Qty</th>
                          <th className="col-num">Rate (€)</th>
                          <th className="col-num">Contract Sum (€)</th>
                          <th className="col-type">Type</th>
                          <th style={{ width: 28 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => r.schedule === s.schedule ? renderRow(r, i) : null)}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
              {err && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 8 }}>{err}</div>}
            </>
          )}

          {step === 'done' && (
            <div style={{ padding: '20px 0', fontSize: 14 }}>
              <div>BOQ: {result.inserted} new, {result.updated} updated ({result.total} total).</div>
              {revResult && (
                <div style={{ marginTop: 6 }}>
                  Revenue Generator: {revResult.inserted} new, {revResult.updated} updated activities.
                </div>
              )}
              {revError && (
                <div style={{ marginTop: 6, color: '#dc2626' }}>
                  BOQ imported, but Revenue Generator activities failed: {revError}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          {step === 'input' && (
            <>
              <button className="btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn-primary" disabled={parsing} onClick={parseFull}>
                {parsing ? 'Parsing…' : 'Parse Full Sheet'}
              </button>
            </>
          )}
          {step === 'preview' && (
            <>
              <button className="btn-ghost" onClick={goBack}>Back</button>
              <button className="btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn-primary" disabled={saving || rows.length === 0} onClick={commit}>
                {saving ? 'Importing…' : 'Confirm Import'}
              </button>
            </>
          )}
          {step === 'done' && (
            <button className="btn-primary" onClick={() => { onImported(); onClose(); }}>Close</button>
          )}
        </div>
      </div>
    </div>
  );
}
