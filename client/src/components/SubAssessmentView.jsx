import { apiFetch } from '../apiFetch.js';
import { useState, useEffect, useCallback } from 'react';
import { useZoom } from '../zoomContext.js';

const fmt  = (n, d = 2) => n == null ? '—' : new Intl.NumberFormat('en-IE', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
const fmtE = (n, d = 0) => n == null ? '—' : `€${fmt(n, d)}`;
const fmtP = n => n == null ? '—' : `${Number(n).toFixed(1)}%`;
// ISO (YYYY-MM-DD) → dd/mm/yyyy
const fmtDate = iso => {
  if (!iso) return '—';
  const m = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};
// ↑/↓/Enter move o foco para o campo da linha de cima/baixo na mesma coluna
const cellKeyNav = (e, colClass, idx) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
  e.preventDefault();
  const inputs = Array.from(document.querySelectorAll('input.' + colClass));
  const next = inputs[idx + (e.key === 'ArrowUp' ? -1 : 1)];
  if (next) { next.focus(); next.select(); }
};

const STATUS_STYLE = {
  draft:     { bg: '#fef9c3', color: '#92400e', label: 'Draft' },
  assessed:  { bg: '#fef3c7', color: '#d97706', label: 'Assessed' },
  approved:  { bg: '#dcfce7', color: '#166534', label: 'Approved' },
  invoiced:  { bg: '#ede9fe', color: '#6d28d9', label: 'Invoiced' },
  paid:      { bg: '#dbeafe', color: '#1e40af', label: 'Paid' },
};

export default function SubAssessmentView({ projectId, subcontractId, subRef, subName, contractValue, onBack }) {
  const [boqItems,      setBoqItems]      = useState([]);
  const [apps,          setApps]          = useState([]);
  const [view,          setView]          = useState('list'); // 'list' | 'new' | 'detail' | 'certificate'
  const [detailApp,     setDetailApp]     = useState(null);
  const [certData,      setCertData]      = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [importing,     setImporting]     = useState(false);
  const [importResult,  setImportResult]  = useState(null);

  const loadBoq = useCallback(() =>
    apiFetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/boq`)
      .then(r => r.json()).then(setBoqItems), [projectId, subcontractId]);

  const loadApps = useCallback(() =>
    apiFetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/applications`)
      .then(r => r.json()).then(setApps), [projectId, subcontractId]);

  useEffect(() => {
    Promise.all([loadBoq(), loadApps()]).finally(() => setLoading(false));
  }, [loadBoq, loadApps]);

  const openDetail = async (appId) => {
    const res = await apiFetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/applications/${appId}`);
    setDetailApp(await res.json());
    setView('detail');
  };

  const openCertificate = async (appId) => {
    const res = await apiFetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/applications/${appId}/certificate`);
    setCertData(await res.json());
    setView('certificate');
  };

  const reloadDetail = async () => {
    const cur = detailApp?.app || detailApp?.application;
    if (!cur) return;
    const res = await apiFetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/applications/${cur.id}`);
    setDetailApp(await res.json());
    await Promise.all([loadBoq(), loadApps()]);
  };

  const totalContract = boqItems.reduce((s, i) => s + (i.contract_value || 0), 0);
  const totalCertified = boqItems.reduce((s, i) => s + (i.value_certified || 0), 0);
  const totalRemaining = boqItems.reduce((s, i) => s + (i.value_remaining || 0), 0);
  const latestApp = apps[0];

  if (loading) return <div className="state-box"><div className="icon">⏳</div><p>Loading…</p></div>;

  if (view === 'certificate' && certData) {
    return <CertificateView data={certData} onBack={() => { setView('list'); setCertData(null); loadApps(); }} />;
  }

  return (
    <div>
      {/* ── Breadcrumb ──────────────────────────────────────────────── */}
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:16 }}>
        <button onClick={onBack}
          style={{ background:'none', border:'1px solid #d1d5db', borderRadius:6, padding:'4px 10px', cursor:'pointer', fontSize:13, color:'#374151' }}>
          ← Subcontracts
        </button>
        <span style={{ color:'#9ca3af', fontSize:13 }}>/</span>
        <span style={{ fontWeight:700, color:'#1a1a2e' }}>{subRef} — {subName}</span>
      </div>

      {/* ── Summary cards ───────────────────────────────────────────── */}
      <div style={{ display:'flex', gap:12, flexWrap:'wrap', marginBottom:20 }}>
        <SCard label="Contract Value"  value={fmtE(totalContract,0)}  color="#1a1a2e" />
        <SCard label="Certified To-Date" value={fmtE(totalCertified,0)}
          sub={totalContract > 0 ? fmtP(totalCertified/totalContract*100) : ''}
          color="#166534" />
        <SCard label="Remaining"       value={fmtE(totalRemaining,0)} color="#dc2626" />
        <SCard label="Applications"    value={apps.length}            sub={latestApp ? `Last: App ${latestApp.application_number}` : 'None yet'} color="#7c3aed" />
      </div>

      {/* ── Views ───────────────────────────────────────────────────── */}
      {view === 'list' && (
        <ListView
          apps={apps} boqItems={boqItems}
          onNew={() => setView('new')}
          onDetail={openDetail}
          onCertificate={openCertificate}
          onDelete={async (appId) => {
            await apiFetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/applications/${appId}`, { method:'DELETE' });
            await Promise.all([loadBoq(), loadApps()]);
          }}
          importResult={importResult}
          importing={importing}
          onImportExcel={async ({ file, weekEnding }) => {
            setImporting(true); setImportResult(null);
            const fd = new FormData();
            fd.append('file', file);
            fd.append('week_ending', weekEnding);
            const res = await fetch(
              `/api/v1/projects/${projectId}/subcontracts/${subcontractId}/applications/import-excel`,
              { method: 'POST', body: fd }
            );
            const json = await res.json();
            setImportResult(json);
            if (json.ok) { await Promise.all([loadBoq(), loadApps()]); }
            setImporting(false);
          }}
          onStatusChange={async (appId, status) => {
            await apiFetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/applications/${appId}/status`,
              { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ status }) });
            loadApps();
          }}
        />
      )}
      {view === 'new' && (
        <NewAssessmentView
          projectId={projectId} subcontractId={subcontractId}
          boqItems={boqItems} apps={apps}
          onSave={async (payload) => {
            const res = await apiFetch(
              `/api/v1/projects/${projectId}/subcontracts/${subcontractId}/applications`,
              { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) }
            );
            const json = await res.json();
            if (json.ok) { await Promise.all([loadBoq(), loadApps()]); setView('list'); }
            return json;
          }}
          onCancel={() => setView('list')}
        />
      )}
      {view === 'detail' && detailApp && (
        <DetailView
          key={(detailApp.app || detailApp.application).id}
          detail={detailApp}
          projectId={projectId}
          subcontractId={subcontractId}
          onUpdated={reloadDetail}
          onCertificate={openCertificate}
          onBack={() => setView('list')}
        />
      )}
    </div>
  );
}

// ── Application list ─────────────────────────────────────────────────────────
function ListView({ apps, boqItems, onNew, onDetail, onCertificate, onStatusChange, onDelete, onImportExcel, importing, importResult }) {
  const zoom = useZoom();
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importWE,   setImportWE]   = useState('');   // semana escolhida (obrigatória)
  const weOptions = fridayRange(todayFriday(), 8, 2);

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
        <h3 style={{ margin:0, fontSize:16, color:'#1a1a2e' }}>Payment Applications</h3>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={() => setShowImport(s => !s)}
            style={{ padding:'6px 14px', borderRadius:6, border:'1px solid #6366f1', background:'#f5f3ff',
              color:'#4338ca', cursor:'pointer', fontSize:13, fontWeight:600 }}>
            ↑ Import Claim
          </button>
          <button className="btn-primary" onClick={onNew}>+ Manual Assessment</button>
        </div>
      </div>

      {/* Import panel */}
      {showImport && (
        <div style={{ background:'#f5f3ff', border:'1px solid #c4b5fd', borderRadius:8, padding:14, marginBottom:16 }}>
          <div style={{ fontWeight:600, fontSize:13, color:'#4338ca', marginBottom:10 }}>
            Import a subcontractor claim (Excel) — creates the next application for the week you choose
          </div>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'flex-end' }}>
            <label style={{ fontSize:13 }}>
              <div style={{ fontWeight:600, color:'#374151', marginBottom:4 }}>Excel file</div>
              <input type="file" accept=".xlsx,.xls"
                onChange={e => setImportFile(e.target.files[0])}
                style={{ fontSize:13 }} />
            </label>
            <label style={{ fontSize:13 }}>
              <div style={{ fontWeight:600, color:'#374151', marginBottom:4 }}>Week Ending <span style={{color:'#dc2626'}}>*</span></div>
              <select value={importWE} onChange={e => setImportWE(e.target.value)}
                style={{ padding:'5px 8px', borderRadius:6, border:'1px solid #c4b5fd', fontSize:13, width:160,
                  background: importWE ? '#fff' : '#fff7ed' }}>
                <option value="">— choose week —</option>
                {weOptions.map(we => <option key={we} value={we}>{fmtDate(we)}</option>)}
              </select>
            </label>
            <button
              disabled={!importFile || !importWE || importing}
              onClick={() => onImportExcel({ file: importFile, weekEnding: importWE })}
              title={!importFile ? 'Choose a file' : !importWE ? 'Choose a Week Ending' : ''}
              style={{ padding:'6px 18px', borderRadius:6, border:'none', background:'#4338ca',
                color:'#fff', cursor: importFile && importWE && !importing ? 'pointer' : 'not-allowed',
                fontSize:13, fontWeight:600, opacity: (importFile && importWE && !importing) ? 1 : 0.5 }}>
              {importing ? 'Importing…' : 'Import'}
            </button>
          </div>

          {importResult && (
            <div style={{ marginTop:12, background:'#fff', borderRadius:6, padding:10, fontSize:12, border:'1px solid #e5e7eb' }}>
              {importResult.ok ? (
                <div>
                  <div style={{ color:'#166534', fontWeight:600, marginBottom:6 }}>✓ Import complete</div>
                  {importResult.results.map(r => (
                    <div key={r.appNum} style={{ padding:'2px 0', color: r.created ? '#166534' : '#9ca3af' }}>
                      App {r.appNum}: {r.created
                        ? `created — €${(r.value_gmc||0).toFixed(2)} GMC, ${r.items} items, WE ${fmtDate(r.week_ending)}`
                        : `skipped — ${r.reason}`}
                      {r.gmc_from_sub && <span style={{ color:'#9a3412' }}> · GMC empty → used Folan claim (review & cut)</span>}
                    </div>
                  ))}
                  {importResult.over_claim?.length > 0 && (
                    <div style={{ marginTop:6, color:'#b45309', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:4, padding:'4px 8px' }}>
                      ⚠ Over 100% (needs a variation): {importResult.over_claim.map(o => `${o.ref} (${o.cumulative_pct}%)`).join(', ')}
                    </div>
                  )}
                  {importResult.unmatched_refs?.length > 0 && (
                    <div style={{ marginTop:4, color:'#9ca3af' }}>Unmatched refs (not in BOQ): {importResult.unmatched_refs.join(', ')}</div>
                  )}
                </div>
              ) : (
                <div style={{ color:'#dc2626' }}>{importResult.error}</div>
              )}
            </div>
          )}
        </div>
      )}

      {apps.length === 0 ? (
        <div className="state-box">
          <div className="icon">📋</div>
          <p>No applications yet. Use "Import Claim" or "Manual Assessment" to start.</p>
        </div>
      ) : (
        <div style={{ overflowX:'auto', zoom: `${zoom}%` }}>
          <table className="boq-table">
            <thead>
              <tr>
                <th>App #</th>
                <th>Week Ending</th>
                <th style={{textAlign:'right'}}>This App (GMC)</th>
                <th style={{textAlign:'right'}}>Cumulative (GMC)</th>
                <th style={{textAlign:'right'}}>Sub Claimed</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {apps.map(a => {
                const ss = STATUS_STYLE[a.status] || STATUS_STYLE.draft;
                return (
                  <tr key={a.id}>
                    <td style={{fontWeight:700}}>App {a.application_number}</td>
                    <td>{fmtDate(a.week_ending || a.period)}</td>
                    <td style={{textAlign:'right', fontWeight:600}}>{fmtE(a.value_gmc, 2)}</td>
                    <td style={{textAlign:'right', color:'#1e40af'}}>{fmtE(a.cumulative_gmc, 2)}</td>
                    <td style={{textAlign:'right', color:'#6b7280'}}>{fmtE(a.value_sub, 2)}</td>
                    <td>
                      <select value={a.status}
                        onChange={e => onStatusChange(a.id, e.target.value)}
                        style={{ background: ss.bg, color: ss.color, border:'none', borderRadius:12,
                          padding:'2px 8px', fontSize:12, fontWeight:600, cursor:'pointer' }}>
                        {Object.entries(STATUS_STYLE).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                    </td>
                    <td style={{ display:'flex', gap:4, alignItems:'center' }}>
                      <button onClick={() => onDetail(a.id)}
                        style={{
                          display:'flex', alignItems:'center', gap:6,
                          background:'#f0fdf4', border:'1px solid #16a34a', borderRadius:6, padding:'4px 10px',
                          cursor:'pointer', fontSize:11, fontWeight:600, color:'#166534'
                        }}>
                        View
                        <span style={{ fontSize:10, fontWeight:700, background:'#16a34a', color:'#fff', borderRadius:4, padding:'1px 5px' }}>
                          €{fmt(a.value_gmc, 0)}
                        </span>
                      </button>
                      {['approved','invoiced','paid'].includes(a.status) && (
                        <button onClick={() => onCertificate(a.id)} title="Payment Certificate"
                          style={{ background:'#eff6ff', border:'1px solid #3b82f6', borderRadius:6, padding:'4px 10px',
                            cursor:'pointer', fontSize:11, fontWeight:600, color:'#1e40af' }}>
                          📄 Certificate
                        </button>
                      )}
                      <button onClick={() => { if (window.confirm(`Delete App ${a.application_number}?`)) onDelete(a.id); }}
                        style={{ background:'none', border:'1px solid #fca5a5', borderRadius:6, padding:'3px 8px', cursor:'pointer', fontSize:12, color:'#dc2626' }}>
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* BOQ Summary */}
      <h3 style={{ marginTop:28, marginBottom:12, fontSize:16, color:'#1a1a2e' }}>BOQ — Contracted Scope</h3>
      <div style={{ overflowX:'auto', zoom: `${zoom}%` }}>
        <table className="boq-table">
          <thead>
            <tr>
              <th>Ref</th>
              <th>Description</th>
              <th>Unit</th>
              <th style={{textAlign:'right'}}>Qty</th>
              <th style={{textAlign:'right'}}>Rate</th>
              <th style={{textAlign:'right'}}>Contract Value</th>
              <th style={{textAlign:'right'}}>% Certified</th>
              <th style={{textAlign:'right'}}>Certified</th>
              <th style={{textAlign:'right'}}>Remaining</th>
            </tr>
          </thead>
          <tbody>
            {boqItems.map((it, idx) => (
              <tr key={it.id} style={{ background: idx%2===0 ? '#f8fafc' : '#fff' }}>
                <td style={{fontFamily:'monospace', fontSize:12, whiteSpace:'nowrap'}}>{it.item_ref}</td>
                <td style={{maxWidth:300, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}} title={it.description}>{it.description}</td>
                <td style={{color:'#6b7280', fontSize:12}}>{it.unit}</td>
                <td style={{textAlign:'right', fontVariantNumeric:'tabular-nums'}}>{fmt(it.qty,2)}</td>
                <td style={{textAlign:'right', fontVariantNumeric:'tabular-nums'}}>€{fmt(it.rate,2)}</td>
                <td style={{textAlign:'right', fontWeight:600, fontVariantNumeric:'tabular-nums'}}>€{fmt(it.contract_value,2)}</td>
                <td style={{textAlign:'right', color: it.pct_certified > 0 ? '#166534' : '#9ca3af'}}>
                  {fmtP(it.pct_certified)}
                </td>
                <td style={{textAlign:'right', color:'#1e40af', fontVariantNumeric:'tabular-nums'}}>
                  {it.value_certified > 0 ? fmtE(it.value_certified,2) : <span style={{color:'#d1d5db'}}>—</span>}
                </td>
                <td style={{textAlign:'right', color:'#dc2626', fontVariantNumeric:'tabular-nums'}}>
                  {fmtE(it.value_remaining,2)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{background:'#f1f5f9', fontWeight:700}}>
              <td colSpan={5} style={{textAlign:'right', paddingRight:8}}>TOTAL</td>
              <td style={{textAlign:'right'}}>€{fmt(boqItems.reduce((s,i)=>s+(i.contract_value||0),0),2)}</td>
              <td></td>
              <td style={{textAlign:'right', color:'#1e40af'}}>€{fmt(boqItems.reduce((s,i)=>s+(i.value_certified||0),0),2)}</td>
              <td style={{textAlign:'right', color:'#dc2626'}}>€{fmt(boqItems.reduce((s,i)=>s+(i.value_remaining||0),0),2)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ── Helper: Generate Fridays ──────────────────────────────────────────────
function todayFriday() {
  const d = new Date();
  const diff = (d.getDay() - 5 + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}

function fridayRange(ref, before = 4, after = 2) {
  const result = [];
  for (let i = -before; i <= after; i++) {
    const d = new Date(ref + 'T12:00:00');
    d.setDate(d.getDate() + i * 7);
    result.push(d.toISOString().slice(0, 10));
  }
  return result;
}

// ── Manual Assessment Form ────────────────────────────────────────────────────
function NewAssessmentView({ projectId, subcontractId, boqItems, apps, onSave, onCancel }) {
  const zoom = useZoom();
  const nextAppNum = (apps[0]?.application_number || 0) + 1;
  const defaultWE = todayFriday();
  const [weekEnding, setWeekEnding] = useState(defaultWE);
  const [appStatus, setAppStatus] = useState('draft');
  // % desta aplicação (começa a 0 — o utilizador insere o trabalho deste período)
  const [pcts, setPcts] = useState(() => {
    const m = {};
    boqItems.forEach(i => { m[i.id] = { sub: 0, gmc: 0 }; });
    return m;
  });
  const [notes,  setNotes]  = useState('');
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState(null);

  // Generate WE options
  const weOptions = fridayRange(defaultWE, 8, 2);

  // Cap: cumulativo (prev + this) não pode ultrapassar 100%
  const setPct = (id, field, val) => {
    const item = boqItems.find(i => i.id === id);
    const prev = item?.pct_certified || 0;
    const max  = Math.max(0, 100 - prev);
    const n    = Math.min(max, Math.max(0, parseFloat(val) || 0));
    setPcts(p => ({ ...p, [id]: { ...p[id], [field]: n } }));
  };

  // Valor desta aplicação por item (a % inserida é DESTE período)
  const itemCalc = (it) => {
    const prev  = it.pct_certified || 0;
    const gmc   = pcts[it.id]?.gmc ?? 0;            // % deste período
    const sub   = pcts[it.id]?.sub ?? 0;            // % deste período (claim do sub)
    return {
      prev, gmc, sub,
      value:    Math.round(gmc / 100 * it.contract_value * 100) / 100,
      subValue: Math.round(sub / 100 * it.contract_value * 100) / 100,
    };
  };

  const totalGmc = boqItems.reduce((s,i) => s + itemCalc(i).value, 0);
  const totalSub = boqItems.reduce((s,i) => s + itemCalc(i).subValue, 0);
  const cumGmc   = (apps.find(a=>a.status!=='draft')?.cumulative_gmc || 0) + totalGmc;

  const handleSave = async () => {
    setSaving(true); setError(null);
    // Backend espera a % CUMULATIVA (prev + deste período) e calcula o delta
    const items = boqItems.map(i => {
      const prev = i.pct_certified || 0;
      return {
        sub_boq_item_id: i.id,
        pct_complete_sub: prev + (pcts[i.id]?.sub ?? 0),
        pct_complete_gmc: prev + (pcts[i.id]?.gmc ?? 0),
      };
    });
    const res = await onSave({ week_ending: weekEnding, status: appStatus, notes, items });
    setSaving(false);
    if (!res.ok) setError(res.error || 'Error saving');
  };

  return (
    <div>
      {/* Sticky top bar */}
      <div style={{ position:'sticky', top:56, zIndex:10, background:'#fff', borderBottom:'1px solid #e5e7eb',
        padding:'8px 0 10px', marginBottom:12 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <button onClick={onCancel}
            style={{ background:'none', border:'1px solid #d1d5db', borderRadius:6, padding:'4px 10px', cursor:'pointer', fontSize:13 }}>
            ← Back
          </button>
          <h3 style={{ margin:0, fontSize:15, color:'#1a1a2e' }}>App {nextAppNum} — Manual Assessment</h3>
          <label style={{ fontSize:13, fontWeight:600, color:'#374151' }}>
            WE:&nbsp;
            <select value={weekEnding} onChange={e=>setWeekEnding(e.target.value)}
              style={{ padding:'4px 8px', borderRadius:6, border:'1px solid #d1d5db', fontSize:13 }}>
              {weOptions.map(we => <option key={we} value={we}>{fmtDate(we)}</option>)}
            </select>
          </label>
          <label style={{ fontSize:13, fontWeight:600, color:'#374151' }}>
            Status:&nbsp;
            <select value={appStatus} onChange={e=>setAppStatus(e.target.value)}
              style={{ padding:'4px 8px', borderRadius:6, border:'1px solid #d1d5db', fontSize:13 }}>
              <option value="draft">Draft</option>
              <option value="assessed">Assessed</option>
            </select>
          </label>
          <div style={{ marginLeft:'auto', display:'flex', gap:14, alignItems:'center' }}>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:10, color:'#9ca3af' }}>SUB CLAIMED</div>
              <div style={{ fontSize:16, fontWeight:700, color:'#92400e' }}>{fmtE(totalSub,2)}</div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:10, color:'#9ca3af' }}>GMC APPROVED</div>
              <div style={{ fontSize:16, fontWeight:700, color:'#1e40af' }}>{fmtE(totalGmc,2)}</div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:10, color:'#9ca3af' }}>CUMULATIVE</div>
              <div style={{ fontSize:16, fontWeight:700, color:'#166534' }}>{fmtE(cumGmc,2)}</div>
            </div>
            <button onClick={handleSave} disabled={saving} className="btn-primary"
              style={{ padding:'7px 22px', fontSize:14 }}>
              {saving ? 'Saving…' : `Save App ${nextAppNum}`}
            </button>
          </div>
        </div>
        {error && <div style={{ background:'#fee2e2', color:'#991b1b', padding:'6px 12px', borderRadius:6, marginTop:8, fontSize:13 }}>{error}</div>}
      </div>

      <div style={{ marginBottom:14 }}>
        <label style={{ fontSize:12, fontWeight:600, color:'#374151', display:'block', marginBottom:4 }}>
          Notes / Comments
        </label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)}
          placeholder="Optional notes for this application…" rows={2}
          style={{ width:'100%', padding:'8px 10px', borderRadius:6, border:'1px solid #d1d5db',
            fontSize:13, fontFamily:'inherit', resize:'vertical', boxSizing:'border-box' }} />
      </div>

      <div style={{ overflowX:'auto', zoom: `${zoom}%` }}>
        <table className="boq-table" style={{ minWidth:1000 }}>
          <thead>
            <tr>
              <th>Ref</th>
              <th>Description</th>
              <th style={{textAlign:'right'}}>Contract €</th>
              <th style={{textAlign:'right', color:'#6b7280'}}>Accum %</th>
              <th style={{textAlign:'right', background:'#fffbeb', color:'#92400e'}}>Sub €</th>
              <th style={{textAlign:'center', background:'#fef3c7', color:'#92400e'}}>Sub %</th>
              <th style={{textAlign:'center', background:'#dcfce7', color:'#166534'}}>GMC %</th>
              <th style={{textAlign:'right', background:'#dcfce7', color:'#166534'}}>This App €</th>
              <th style={{textAlign:'right'}}>Cumul €</th>
              <th style={{textAlign:'right', color:'#dc2626'}}>Remaining €</th>
            </tr>
          </thead>
          <tbody>
            {boqItems.map((it, idx) => {
              const c = itemCalc(it);
              const cumPct  = (c.prev || 0) + (pcts[it.id]?.gmc ?? 0);
              const cumVal  = Math.round(cumPct / 100 * it.contract_value * 100) / 100;
              const remVal  = Math.round((1 - cumPct / 100) * it.contract_value * 100) / 100;
              return (
                <tr key={it.id} style={{ background: idx%2===0 ? '#f8fafc' : '#fff' }}>
                  <td style={{fontFamily:'monospace', fontSize:11, whiteSpace:'nowrap'}}>{it.item_ref}</td>
                  <td style={{maxWidth:240, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:12}} title={it.description}>{it.description}</td>
                  <td style={{textAlign:'right', fontVariantNumeric:'tabular-nums', fontSize:12}}>€{fmt(it.contract_value,2)}</td>
                  <td style={{textAlign:'right', color:'#9ca3af', fontSize:12}}>{fmtP(c.prev)}</td>
                  {/* Sub € (this period) — value the sub is claiming, for comparison against This App € (GMC) */}
                  <td style={{textAlign:'right', color: c.subValue > 0 ? '#92400e' : '#9ca3af', fontVariantNumeric:'tabular-nums', fontSize:12, background:'#fffbeb'}}>
                    {c.subValue > 0 ? fmtE(c.subValue,2) : '—'}
                  </td>
                  {/* Sub % (this period) */}
                  <td style={{background:'#fffbeb', padding:'2px 4px'}}>
                    <input type="number" min={0} max={Math.max(0, 100 - (c.prev||0))} step={1}
                      className="cell-input sub-col"
                      value={pcts[it.id]?.sub ?? 0}
                      onChange={e => setPct(it.id, 'sub', e.target.value)}
                      onKeyDown={e => cellKeyNav(e, 'sub-col', idx)}
                      style={{ width:64, textAlign:'center', padding:'3px 4px', border:'1px solid #d97706',
                        borderRadius:4, fontSize:13, background:'#fffbeb' }} />
                  </td>
                  {/* GMC % (this period) */}
                  <td style={{background:'#f0fdf4', padding:'2px 4px'}}>
                    <input type="number" min={0} max={Math.max(0, 100 - (c.prev||0))} step={1}
                      className="cell-input gmc-col"
                      value={pcts[it.id]?.gmc ?? 0}
                      onChange={e => setPct(it.id, 'gmc', e.target.value)}
                      onKeyDown={e => cellKeyNav(e, 'gmc-col', idx)}
                      style={{ width:64, textAlign:'center', padding:'3px 4px', border:'1px solid #16a34a',
                        borderRadius:4, fontSize:13, background:'#f0fdf4', fontWeight:600 }} />
                  </td>
                  <td style={{textAlign:'right', fontWeight:600, color: c.value > 0 ? '#166534' : '#9ca3af', fontVariantNumeric:'tabular-nums', fontSize:12}}>
                    {c.value > 0 ? fmtE(c.value,2) : '—'}
                  </td>
                  <td style={{textAlign:'right', color:'#1e40af', fontVariantNumeric:'tabular-nums', fontSize:12}}>€{fmt(cumVal,2)}</td>
                  <td style={{textAlign:'right', color: remVal > 0 ? '#dc2626' : '#16a34a', fontVariantNumeric:'tabular-nums', fontSize:12}}>€{fmt(remVal,2)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{background:'#f1f5f9', fontWeight:700}}>
              <td colSpan={2} style={{textAlign:'right', paddingRight:8}}>TOTAL</td>
              <td style={{textAlign:'right'}}>€{fmt(boqItems.reduce((s,i)=>s+(i.contract_value||0),0),2)}</td>
              <td></td>
              <td style={{textAlign:'right', color:'#92400e'}}>€{fmt(totalSub,2)}</td>
              <td></td>
              <td></td>
              <td style={{textAlign:'right', color:'#166534'}}>€{fmt(totalGmc,2)}</td>
              <td style={{textAlign:'right', color:'#1e40af'}}>€{fmt(cumGmc,2)}</td>
              <td style={{textAlign:'right', color:'#dc2626'}}>
                €{fmt(boqItems.reduce((s,i)=>s+Math.round((1-((i.pct_certified||0)+(pcts[i.id]?.gmc||0))/100)*i.contract_value*100)/100,0),2)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

    </div>
  );
}

// ── Application Detail ────────────────────────────────────────────────────────
function DetailView({ detail, projectId, subcontractId, onUpdated, onCertificate, onBack }) {
  const zoom = useZoom();
  const app = detail.app || detail.application;
  const items = detail.items || [];
  const ss = STATUS_STYLE[app.status] || STATUS_STYLE.draft;
  const editable = ['draft', 'assessed'].includes(app.status);

  // % GMC (assessment) editável por item — começa no % atual (= claim do Folan após import)
  const [gmcPct, setGmcPct] = useState(() => {
    const m = {};
    items.forEach(i => { m[i.id] = Math.round((i.pct_complete_gmc || 0) * 100) / 100; });
    return m;
  });
  const [cut,       setCut]       = useState('');   // corte global %
  const [saving,    setSaving]    = useState(false);
  const [approving, setApproving] = useState(false);
  const [error,     setError]     = useState(null);

  const cvOf       = it => it.contract_value || 0;
  const folanPctOf = it => it.pct_complete_sub || 0;          // % do Folan (deste período)
  const folanEurOf = it => it.value_sub_computed || 0;        // € claim do Folan (deste período)
  const prevPctOf  = it => it.pct_prev || 0;                  // % já certificada (apps anteriores)
  const gPctOf     = it => Number(gmcPct[it.id]) || 0;        // % de assessment GMC (deste período)
  // € GMC deste período = % assessment × valor contrato
  const gmcEurOf   = it => Math.round(gPctOf(it) / 100 * cvOf(it) * 100) / 100;
  // Cumulativo (anterior + este período) — não deve passar 100% (acima → variation)
  const cumPctOf   = it => Math.round((prevPctOf(it) + gPctOf(it)) * 100) / 100;
  const overItems  = items.filter(i => cumPctOf(i) > 100.01);

  const folanTotal = items.reduce((s, i) => s + folanEurOf(i), 0);
  const gmcTotal   = items.reduce((s, i) => s + (editable ? gmcEurOf(i) : (i.value_gmc_computed || 0)), 0);
  const cutTotal   = folanTotal - gmcTotal;
  const cutPctLive = folanTotal > 0 ? (1 - gmcTotal / folanTotal) * 100 : 0;

  // Cap: cumulative (pct_prev + this) cannot exceed 100%
  const setItemGmcPct = (id, v) => {
    const n    = parseFloat(v);
    const item = items.find(i => i.id === id);
    const max  = item ? Math.max(0, 100 - (item.pct_prev || 0)) : 100;
    setGmcPct(p => ({ ...p, [id]: isNaN(n) ? 0 : Math.round(Math.min(max, Math.max(0, n)) * 100) / 100 }));
  };
  // Corte global: GMC % = Folan % × (1 − corte%)
  const applyGlobalCut = () => {
    const c = Math.min(100, Math.max(0, parseFloat(cut) || 0));
    setGmcPct(() => {
      const m = {};
      items.forEach(i => { m[i.id] = Math.round(folanPctOf(i) * (1 - c / 100) * 100) / 100; });
      return m;
    });
  };

  const saveAssessment = async () => {
    const payload = { items: items.map(i => ({ id: i.id, value_gmc: gmcEurOf(i) })) };
    const res = await apiFetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/applications/${app.id}/assessment`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return res.json();
  };
  const handleSave = async () => {
    setSaving(true); setError(null);
    const j = await saveAssessment();
    setSaving(false);
    if (!j.ok) { setError(j.error || 'Error saving'); return; }
    await onUpdated();
  };
  const handleApprove = async () => {
    if (!window.confirm(`Approve App ${app.application_number} with GMC ${fmtE(gmcTotal, 2)} (cut of ${cutPctLive.toFixed(1)}%)?`)) return;
    setApproving(true); setError(null);
    const j = await saveAssessment();
    if (!j.ok) { setApproving(false); setError(j.error || 'Error saving'); return; }
    const r = await apiFetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/applications/${app.id}/status`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'approved' }) });
    const rj = await r.json();
    setApproving(false);
    if (!rj.ok) { setError(rj.error || 'Error approving'); return; }
    await onUpdated();
  };

  // Resumo (usa value_*_computed — os campos value_sub/value_gmc são qty*rate=0)
  const totalSubC = items.reduce((s, i) => s + (i.value_sub_computed || 0), 0);
  const totalGmcC = items.reduce((s, i) => s + (i.value_gmc_computed || 0), 0);
  const cutPctApproved = totalSubC > 0 ? Math.round((1 - totalGmcC / totalSubC) * 1000) / 10 : 0;

  return (
    <div>
      {/* Sticky header */}
      <div style={{ position:'sticky', top:56, zIndex:10, background:'#fff', borderBottom:'1px solid #e5e7eb',
        padding:'8px 0 10px', marginBottom:12 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <button onClick={onBack}
            style={{ background:'none', border:'1px solid #d1d5db', borderRadius:6, padding:'4px 10px', cursor:'pointer', fontSize:13 }}>
            ← Back
          </button>
          <h3 style={{ margin:0, fontSize:15, color:'#1a1a2e' }}>
            App {app.application_number} — WE {fmtDate(app.week_ending || app.period)}
          </h3>
          <span style={{ background:ss.bg, color:ss.color, borderRadius:12, padding:'2px 10px', fontSize:12, fontWeight:600 }}>
            {ss.label}
          </span>
          <div style={{ marginLeft:'auto', display:'flex', gap:14, alignItems:'center' }}>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:10, color:'#9ca3af' }}>GMC ASSESSMENT</div>
              <div style={{ fontSize:16, fontWeight:700, color:'#166534' }}>{fmtE(editable ? gmcTotal : app.value_gmc, 2)}</div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:10, color:'#9ca3af' }}>CUMULATIVE</div>
              <div style={{ fontSize:16, fontWeight:700, color:'#1e40af' }}>{fmtE(app.cumulative_gmc,2)}</div>
            </div>
            {editable && (
              <>
                <button onClick={handleSave} disabled={saving || approving}
                  style={{ padding:'7px 16px', borderRadius:6, border:'1px solid #16a34a', background:'#fff', color:'#166534',
                    cursor: saving||approving ? 'not-allowed' : 'pointer', fontSize:13, fontWeight:600 }}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={handleApprove} disabled={saving || approving} className="btn-primary"
                  style={{ padding:'7px 18px', fontSize:13 }}>
                  {approving ? 'Approving…' : '✓ Approve'}
                </button>
              </>
            )}
          </div>
        </div>
        {error && <div style={{ background:'#fee2e2', color:'#991b1b', padding:'6px 12px', borderRadius:6, marginTop:8, fontSize:13 }}>{error}</div>}
      </div>

      {app.notes && (
        <div style={{ background:'#f8fafc', border:'1px solid #e5e7eb', borderRadius:8, padding:'10px 14px', marginBottom:16, fontSize:13, color:'#374151' }}>
          <div style={{ fontSize:11, fontWeight:600, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:4 }}>Notes</div>
          {app.notes}
        </div>
      )}

      {/* Painel de corte do QS (só quando editável) */}
      {editable && (
        <div style={{ background:'#fff7ed', border:'1px solid #fed7aa', borderRadius:8, padding:14, marginBottom:16 }}>
          <div style={{ fontSize:13, fontWeight:700, color:'#9a3412', marginBottom:10 }}>✂️ QS Assessment — adjust GMC % before approving</div>
          <div style={{ display:'flex', gap:20, flexWrap:'wrap', alignItems:'center' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <label style={{ fontSize:13, fontWeight:600, color:'#374151' }}>Global cut:</label>
              <input type="number" min={0} max={100} step={1} value={cut}
                onChange={e => setCut(e.target.value)} placeholder="ex: 10"
                style={{ width:70, padding:'5px 8px', borderRadius:6, border:'1px solid #fb923c', fontSize:13, textAlign:'center' }} />
              <span style={{ fontSize:13, color:'#6b7280' }}>%</span>
              <button onClick={applyGlobalCut}
                style={{ padding:'5px 12px', borderRadius:6, border:'none', background:'#ea580c', color:'#fff', cursor:'pointer', fontSize:12, fontWeight:600 }}>
                Apply to all
              </button>
            </div>
            <div style={{ marginLeft:'auto', display:'flex', gap:18, alignItems:'center' }}>
              <Stat label="FOLAN (CLAIM)" value={fmtE(folanTotal,2)} color="#92400e" />
              <Stat label="GMC (ASSESSED)" value={fmtE(gmcTotal,2)}   color="#166534" />
              <Stat label="CUT" value={`${fmtE(cutTotal,2)} · ${cutPctLive.toFixed(1)}%`} color="#dc2626" />
            </div>
          </div>
          {overItems.length > 0 && (
            <div style={{ marginTop:10, color:'#b45309', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:6, padding:'6px 10px', fontSize:12 }}>
              ⚠ Over 100% — these items need a <strong>variation</strong> (compensation event): {overItems.map(o => `${o.item_ref} (${cumPctOf(o)}%)`).join(', ')}
            </div>
          )}
        </div>
      )}

      {/* Resumo aprovado */}
      {!editable && (
        <div style={{ background:'#f0fdf4', border:'1px solid #86efac', borderRadius:8, padding:12, marginBottom:16 }}>
          <div style={{ fontSize:12, fontWeight:600, color:'#166534', marginBottom:8 }}>✓ {ss.label.toUpperCase()}</div>
          <div style={{ display:'flex', gap:20, flexWrap:'wrap' }}>
            <Stat label="Sub Claimed"  value={fmtE(totalSubC,2)} color="#1a1a2e" small />
            <Stat label="GMC Approved" value={fmtE(totalGmcC,2)} color="#166534" small />
            <Stat label="Cut Applied"  value={`${cutPctApproved}%`} color="#dc2626" small />
            {app.qs_approved_date && (
              <Stat label="Date" value={fmtDate(app.qs_approved_date)} color="#374151" small />
            )}
            <button onClick={() => onCertificate(app.id)}
              style={{ marginLeft:'auto', alignSelf:'center', background:'#1e40af', color:'#fff', border:'none',
                borderRadius:6, padding:'8px 18px', cursor:'pointer', fontSize:13, fontWeight:600 }}>
              📄 Issue Certificate
            </button>
          </div>
        </div>
      )}

      <div style={{ overflowX:'auto', zoom: `${zoom}%` }}>
        <table className="boq-table" style={{ minWidth:860 }}>
          <thead>
            <tr>
              <th>Ref</th>
              <th>Description</th>
              <th style={{textAlign:'right'}}>Contract €</th>
              <th style={{textAlign:'right', color:'#6b7280'}}>Accum %</th>
              <th style={{textAlign:'right', color:'#92400e'}}>Folan %</th>
              <th style={{textAlign:'right', color:'#92400e'}}>Folan €</th>
              <th style={{textAlign:'center', color:'#166534'}}>GMC % {editable && '✎'}</th>
              <th style={{textAlign:'right', color:'#166534'}}>GMC €</th>
              <th style={{textAlign:'right', color:'#dc2626'}}>Cut €</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => {
              const folanEur = folanEurOf(it);
              const gmcEur   = editable ? gmcEurOf(it) : (it.value_gmc_computed || 0);
              const itemCut  = folanEur - gmcEur;
              return (
                <tr key={it.id} style={{ background: idx%2===0 ? '#f8fafc' : '#fff' }}>
                  <td style={{fontFamily:'monospace', fontSize:11}}>{it.item_ref}</td>
                  <td style={{maxWidth:230, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:12}} title={it.description}>{it.description}</td>
                  <td style={{textAlign:'right', fontSize:12}}>€{fmt(it.contract_value,2)}</td>
                  <td style={{textAlign:'right', color: cumPctOf(it) > 100.01 ? '#dc2626' : '#9ca3af', fontSize:12}}>{fmtP(prevPctOf(it))}</td>
                  <td style={{textAlign:'right', color:'#92400e', fontSize:12}}>{fmtP(folanPctOf(it))}</td>
                  <td style={{textAlign:'right', color:'#92400e', fontSize:12, fontVariantNumeric:'tabular-nums'}}>€{fmt(folanEur,2)}</td>
                  <td style={{textAlign:'center', background: editable ? '#f0fdf4' : 'transparent', padding: editable ? '2px 4px' : undefined}}>
                    {editable ? (
                      <span style={{ display:'inline-flex', alignItems:'center', gap:2 }}>
                        <input type="number" min={0} max={Math.max(0, 100 - prevPctOf(it))} step={1} value={gmcPct[it.id] ?? ''}
                          className="cell-input gmc-col"
                          onChange={e => setItemGmcPct(it.id, e.target.value)}
                          onKeyDown={e => cellKeyNav(e, 'gmc-col', idx)}
                          style={{ width:64, textAlign:'right', padding:'3px 6px', border:'1px solid #16a34a',
                            borderRadius:4, fontSize:12, background:'#f0fdf4', fontWeight:600, fontVariantNumeric:'tabular-nums' }} />
                        <span style={{ fontSize:11, color:'#6b7280' }}>%</span>
                      </span>
                    ) : (
                      <span style={{ color:'#166534', fontWeight:600, fontSize:12 }}>{fmtP(it.pct_complete_gmc)}</span>
                    )}
                  </td>
                  <td style={{textAlign:'right', color:'#166534', fontWeight:600, fontSize:12, fontVariantNumeric:'tabular-nums'}}>€{fmt(gmcEur,2)}</td>
                  <td style={{textAlign:'right', color: itemCut > 0.005 ? '#dc2626' : '#9ca3af', fontSize:12, fontVariantNumeric:'tabular-nums'}}>
                    {itemCut > 0.005 ? `−€${fmt(itemCut,2)}` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{background:'#f1f5f9', fontWeight:700}}>
              <td colSpan={5} style={{textAlign:'right', paddingRight:8}}>TOTAL</td>
              <td style={{textAlign:'right', color:'#92400e'}}>{fmtE(folanTotal,2)}</td>
              <td></td>
              <td style={{textAlign:'right', color:'#166534'}}>{fmtE(gmcTotal,2)}</td>
              <td style={{textAlign:'right', color:'#dc2626'}}>{cutTotal > 0.005 ? `−${fmtE(cutTotal,2)}` : '—'}</td>
            </tr>
          </tfoot>
        </table>
      </div>

    </div>
  );
}

function Stat({ label, value, color, small }) {
  return (
    <div style={{ textAlign:'right' }}>
      <div style={{ fontSize:10, color:'#6b7280', fontWeight:600 }}>{label}</div>
      <div style={{ fontSize: small ? 14 : 15, fontWeight:700, color }}>{value}</div>
    </div>
  );
}

// ── Payment Certificate ───────────────────────────────────────────────────────
function CertificateView({ data, onBack }) {
  const { app, project = {}, subcontract = {}, summary: s = {}, history = [], items = [] } = data;
  const checklist = [
    'Contract Alignment — application within contract scope',
    'Documentation — invoices, timesheets, certificates received',
    'Progress Verification — progress substantiated and verified on site',
    'Rate Validation — unit rates match BOQ pricing',
    'Retention Compliance — retention applied correctly',
    'Variations — no unapproved change orders included',
    'Performance — on programme, quality acceptable',
    'Insurance & H&S — valid insurance and H&S compliance',
  ];
  const stLabel = st => (STATUS_STYLE[st] || {}).label || st;

  return (
    <div>
      <div className="no-print" style={{ display:'flex', gap:12, marginBottom:16 }}>
        <button onClick={onBack}
          style={{ background:'none', border:'1px solid #d1d5db', borderRadius:6, padding:'6px 14px', cursor:'pointer', fontSize:13 }}>
          ← Back
        </button>
        <button onClick={() => window.print()} className="btn-primary" style={{ padding:'6px 18px', fontSize:13 }}>
          🖨 Print / Save PDF
        </button>
      </div>

      <div className="cert-print" style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:8, padding:28, maxWidth:820, margin:'0 auto' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:16,
          background:'#1a1a2e', color:'#fff', borderRadius:6, padding:'14px 20px', margin:'-28px -28px 22px -28px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:14 }}>
            <img src="/gmc-logo.png" alt="GMC" style={{ height:42, background:'#fff', borderRadius:6, padding:'4px 6px' }} />
            <div>
              <div style={{ fontSize:20, fontWeight:800, letterSpacing:'0.03em' }}>PAYMENT CERTIFICATE</div>
              <div style={{ fontSize:12, color:'#c7cad1', marginTop:2 }}>{project.name} — {project.ref} · {project.client}</div>
            </div>
          </div>
          <div style={{ textAlign:'right', fontSize:11, color:'#c7cad1', lineHeight:1.6 }}>
            <div>Approved: <strong style={{ color:'#fff' }}>{fmtDate(app.qs_approved_date)}</strong></div>
            <div>Printed: {fmtDate(new Date().toISOString())}</div>
          </div>
        </div>

        <div style={{ display:'flex', flexWrap:'wrap', gap:'8px 40px', marginBottom:22, fontSize:13 }}>
          <CField label="Contractor" value={`${subcontract.sub_name || ''} (${subcontract.ref || ''})`} />
          <CField label="Application No." value={`App ${app.application_number}`} />
          <CField label="Week Ending" value={fmtDate(app.week_ending)} />
          <CField label="Status" value={stLabel(app.status)} />
          {app.qs_approved_date && <CField label="Approved Date" value={fmtDate(app.qs_approved_date)} />}
        </div>

        <CTitle>Financial Summary</CTitle>
        <table className="boq-table" style={{ marginBottom:22 }}>
          <tbody>
            <CRow label="Contract Value" value={fmtE(s.contractValue,2)} />
            <CRow label="This Application Value" value={fmtE(s.thisApp,2)} />
            <CRow label="Previously Certified" value={fmtE(s.previously,2)} />
            <CRow label="Cumulative Certified" value={fmtE(s.cumulative,2)} bold />
            <CRow label="% of Works Completed" value={`${s.pctComplete}%`} />
            <CRow label={`Retention (${s.retentionPct}%)`} value={`− ${fmtE(s.retentionAmount,2)}`} color="#dc2626" />
            <CRow label="NET PAYMENT DUE" value={fmtE(s.netDue,2)} big />
          </tbody>
        </table>

        <CTitle>Applications History</CTitle>
        <table className="boq-table" style={{ marginBottom:22 }}>
          <thead><tr>
            <th>App #</th><th>Week Ending</th>
            <th style={{textAlign:'right'}}>This App €</th>
            <th style={{textAlign:'right'}}>Cumulative €</th><th>Status</th>
          </tr></thead>
          <tbody>
            {history.map(h => (
              <tr key={h.application_number} style={{ fontWeight: h.application_number === app.application_number ? 700 : 400,
                background: h.application_number === app.application_number ? '#eff6ff' : undefined }}>
                <td>App {h.application_number}</td>
                <td>{fmtDate(h.week_ending)}</td>
                <td style={{textAlign:'right'}}>{fmtE(h.value_gmc,2)}</td>
                <td style={{textAlign:'right'}}>{fmtE(h.cumulative_gmc,2)}</td>
                <td>{stLabel(h.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <CTitle>This Application — Item Breakdown</CTitle>
        <table className="boq-table" style={{ marginBottom:22 }}>
          <thead><tr>
            <th>Ref</th><th>Description</th>
            <th style={{textAlign:'right'}}>Contract €</th>
            <th style={{textAlign:'right'}}>GMC %</th>
            <th style={{textAlign:'right'}}>This App €</th>
          </tr></thead>
          <tbody>
            {items.filter(i => (i.value_gmc_computed || 0) > 0).map((i, idx) => (
              <tr key={idx}>
                <td style={{fontFamily:'monospace', fontSize:11}}>{i.item_ref}</td>
                <td style={{maxWidth:340, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:12}} title={i.description}>{i.description}</td>
                <td style={{textAlign:'right'}}>€{fmt(i.contract_value,2)}</td>
                <td style={{textAlign:'right'}}>{fmtP(i.pct_complete_gmc)}</td>
                <td style={{textAlign:'right'}}>{fmtE(i.value_gmc_computed,2)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr style={{fontWeight:700, background:'#f1f5f9'}}>
            <td colSpan={4} style={{textAlign:'right', paddingRight:8}}>TOTAL</td>
            <td style={{textAlign:'right'}}>{fmtE(s.thisApp,2)}</td>
          </tr></tfoot>
        </table>

        <CTitle>Assessment Checklist</CTitle>
        <div style={{ marginBottom:24 }}>
          {checklist.map((c, i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:8, padding:'3px 0', fontSize:12.5, color:'#374151' }}>
              <span style={{ width:14, height:14, border:'1.5px solid #9ca3af', borderRadius:3, display:'inline-block', flexShrink:0 }} />
              {c}
            </div>
          ))}
        </div>

        <div className="cert-sign">
          <CTitle>Recommendation & Sign-off</CTitle>
          <div style={{ display:'flex', gap:48, marginTop:28, flexWrap:'wrap' }}>
            <CSign role="Reviewed By (QS)" />
            <CSign role="Approved By (Project Manager)" />
          </div>
        </div>
      </div>
    </div>
  );
}

function CField({ label, value }) {
  return (
    <div>
      <div style={{ fontSize:10, color:'#9ca3af', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em' }}>{label}</div>
      <div style={{ fontSize:14, fontWeight:600, color:'#1a1a2e' }}>{value}</div>
    </div>
  );
}
function CTitle({ children }) {
  return <div style={{ fontSize:12, fontWeight:700, color:'#1a1a2e', textTransform:'uppercase', letterSpacing:'0.05em',
    borderBottom:'1px solid #e5e7eb', paddingBottom:4, marginBottom:8 }}>{children}</div>;
}
function CRow({ label, value, bold, big, color }) {
  return (
    <tr style={{ background: big ? '#f0fdf4' : undefined }}>
      <td style={{ fontWeight: bold || big ? 700 : 400, fontSize: big ? 15 : 13 }}>{label}</td>
      <td style={{ textAlign:'right', fontVariantNumeric:'tabular-nums', fontWeight: bold || big ? 700 : 500,
        fontSize: big ? 16 : 13, color: color || (big ? '#166534' : '#1a1a2e') }}>{value}</td>
    </tr>
  );
}
function CSign({ role }) {
  return (
    <div style={{ flex:1, minWidth:220 }}>
      <div style={{ borderBottom:'1px solid #1a1a2e', height:36 }} />
      <div style={{ fontSize:12, color:'#6b7280', marginTop:4 }}>{role}</div>
      <div style={{ borderBottom:'1px solid #d1d5db', height:28, marginTop:14, width:'60%' }} />
      <div style={{ fontSize:11, color:'#9ca3af', marginTop:4 }}>Date</div>
    </div>
  );
}

function SCard({ label, value, sub, color }) {
  return (
    <div style={{ background:'#f8fafc', border:'1px solid #e5e7eb', borderRadius:8, padding:'10px 16px', minWidth:140 }}>
      <div style={{ fontSize:11, color:'#9ca3af', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em' }}>{label}</div>
      <div style={{ fontSize:20, fontWeight:700, color, marginTop:2 }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:'#9ca3af', marginTop:2 }}>{sub}</div>}
    </div>
  );
}
