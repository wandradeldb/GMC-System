import { useState, useEffect, useCallback } from 'react';

const fmt  = (n, d = 2) => n == null ? '—' : new Intl.NumberFormat('en-IE', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
const fmtE = (n, d = 0) => n == null ? '—' : `€${fmt(n, d)}`;
const fmtP = n => n == null ? '—' : `${Number(n).toFixed(1)}%`;

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
  const [view,          setView]          = useState('list'); // 'list' | 'new' | 'detail'
  const [detailApp,     setDetailApp]     = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [importing,     setImporting]     = useState(false);
  const [importResult,  setImportResult]  = useState(null);

  const loadBoq = useCallback(() =>
    fetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/boq`)
      .then(r => r.json()).then(setBoqItems), [projectId, subcontractId]);

  const loadApps = useCallback(() =>
    fetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/applications`)
      .then(r => r.json()).then(setApps), [projectId, subcontractId]);

  useEffect(() => {
    Promise.all([loadBoq(), loadApps()]).finally(() => setLoading(false));
  }, [loadBoq, loadApps]);

  const openDetail = async (appId) => {
    const res = await fetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/applications/${appId}`);
    setDetailApp(await res.json());
    setView('detail');
  };

  const reloadDetail = async () => {
    const cur = detailApp?.app || detailApp?.application;
    if (!cur) return;
    const res = await fetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/applications/${cur.id}`);
    setDetailApp(await res.json());
    await Promise.all([loadBoq(), loadApps()]);
  };

  const totalContract = boqItems.reduce((s, i) => s + (i.contract_value || 0), 0);
  const totalCertified = boqItems.reduce((s, i) => s + (i.value_certified || 0), 0);
  const totalRemaining = boqItems.reduce((s, i) => s + (i.value_remaining || 0), 0);
  const latestApp = apps[0];

  if (loading) return <div className="state-box"><div className="icon">⏳</div><p>A carregar…</p></div>;

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
          onDelete={async (appId) => {
            await fetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/applications/${appId}`, { method:'DELETE' });
            await Promise.all([loadBoq(), loadApps()]);
          }}
          importResult={importResult}
          importing={importing}
          onImportExcel={async ({ file, sheetName }) => {
            setImporting(true); setImportResult(null);
            const fd = new FormData();
            fd.append('file', file);
            fd.append('sheet_name', sheetName);
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
            await fetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/applications/${appId}/status`,
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
            const res = await fetch(
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
          onBack={() => setView('list')}
        />
      )}
    </div>
  );
}

// ── Application list ─────────────────────────────────────────────────────────
function ListView({ apps, boqItems, onNew, onDetail, onStatusChange, onDelete, onImportExcel, importing, importResult }) {
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [sheetName,  setSheetName]  = useState('Folan Civil');

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
        <h3 style={{ margin:0, fontSize:16, color:'#1a1a2e' }}>Payment Applications</h3>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={() => setShowImport(s => !s)}
            style={{ padding:'6px 14px', borderRadius:6, border:'1px solid #6366f1', background:'#f5f3ff',
              color:'#4338ca', cursor:'pointer', fontSize:13, fontWeight:600 }}>
            ↑ Importar Excel
          </button>
          <button className="btn-primary" onClick={onNew}>+ New Assessment</button>
        </div>
      </div>

      {/* Import panel */}
      {showImport && (
        <div style={{ background:'#f5f3ff', border:'1px solid #c4b5fd', borderRadius:8, padding:14, marginBottom:16 }}>
          <div style={{ fontWeight:600, fontSize:13, color:'#4338ca', marginBottom:10 }}>
            Importar Apps históricos do Excel v2
          </div>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'flex-end' }}>
            <label style={{ fontSize:13 }}>
              <div style={{ fontWeight:600, color:'#374151', marginBottom:4 }}>Ficheiro Excel</div>
              <input type="file" accept=".xlsx,.xls"
                onChange={e => setImportFile(e.target.files[0])}
                style={{ fontSize:13 }} />
            </label>
            <label style={{ fontSize:13 }}>
              <div style={{ fontWeight:600, color:'#374151', marginBottom:4 }}>Nome da Aba</div>
              <input type="text" value={sheetName} onChange={e => setSheetName(e.target.value)}
                placeholder="ex: Folan Civil"
                style={{ padding:'5px 8px', borderRadius:6, border:'1px solid #c4b5fd', fontSize:13, width:160 }} />
            </label>
            <button
              disabled={!importFile || !sheetName || importing}
              onClick={() => onImportExcel({ file: importFile, sheetName })}
              style={{ padding:'6px 18px', borderRadius:6, border:'none', background:'#4338ca',
                color:'#fff', cursor: importFile && sheetName && !importing ? 'pointer' : 'not-allowed',
                fontSize:13, fontWeight:600, opacity: importing ? 0.7 : 1 }}>
              {importing ? 'A importar…' : 'Importar'}
            </button>
          </div>

          {importResult && (
            <div style={{ marginTop:12, background:'#fff', borderRadius:6, padding:10, fontSize:12, border:'1px solid #e5e7eb' }}>
              {importResult.ok ? (
                <div>
                  <div style={{ color:'#166534', fontWeight:600, marginBottom:6 }}>✓ Importação concluída</div>
                  {importResult.results.map(r => (
                    <div key={r.appNum} style={{ padding:'2px 0', color: r.created ? '#166534' : '#9ca3af' }}>
                      App {r.appNum}: {r.created
                        ? `criado — GMC €${(r.value_gmc||0).toFixed(2)} (${r.items} itens)`
                        : `ignorado — ${r.reason}`}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ color:'#dc2626' }}>Erro: {importResult.error}</div>
              )}
            </div>
          )}
        </div>
      )}

      {apps.length === 0 ? (
        <div className="state-box">
          <div className="icon">📋</div>
          <p>Nenhuma aplicação ainda. Clica em "New Assessment" para começar.</p>
        </div>
      ) : (
        <div style={{ overflowX:'auto' }}>
          <table className="boq-table">
            <thead>
              <tr>
                <th>App #</th>
                <th>Period</th>
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
                    <td>{a.week_ending || a.period}</td>
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
                        Ver
                        <span style={{ fontSize:10, fontWeight:700, background:'#16a34a', color:'#fff', borderRadius:4, padding:'1px 5px' }}>
                          €{fmt(a.value_gmc, 0)}
                        </span>
                      </button>
                      <button onClick={() => { if (window.confirm(`Apagar App ${a.application_number}?`)) onDelete(a.id); }}
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
      <div style={{ overflowX:'auto' }}>
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

// ── New Assessment Form ───────────────────────────────────────────────────────
function NewAssessmentView({ projectId, subcontractId, boqItems, apps, onSave, onCancel }) {
  const nextAppNum = (apps[0]?.application_number || 0) + 1;
  const defaultWE = todayFriday();
  const [weekEnding, setWeekEnding] = useState(defaultWE);
  const [appStatus, setAppStatus] = useState('draft');
  const [pcts, setPcts]     = useState(() => {
    const m = {};
    boqItems.forEach(i => { m[i.id] = { sub: i.pct_certified, gmc: i.pct_certified }; });
    return m;
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState(null);
  const [showUpload, setShowUpload] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [sheetName,  setSheetName]  = useState('Folan Civil');
  const [importing,  setImporting]  = useState(false);

  // Generate WE options
  const weOptions = fridayRange(defaultWE, 8, 2);

  const setPct = (id, field, val) => {
    const n = Math.min(100, Math.max(0, parseFloat(val) || 0));
    setPcts(p => ({ ...p, [id]: { ...p[id], [field]: n } }));
  };

  // Calcular valor desta aplicação por item
  const itemCalc = (it) => {
    const prev = it.pct_certified || 0;
    const gmc  = pcts[it.id]?.gmc ?? prev;
    const delta = Math.max(0, gmc - prev);
    return {
      prev,
      gmc,
      delta,
      value: Math.round(delta / 100 * it.contract_value * 100) / 100,
    };
  };

  const totalGmc = boqItems.reduce((s,i) => s + itemCalc(i).value, 0);
  const cumGmc   = (apps.find(a=>a.status!=='draft')?.cumulative_gmc || 0) + totalGmc;

  const handleSave = async () => {
    setSaving(true); setError(null);
    const items = boqItems.map(i => ({
      sub_boq_item_id: i.id,
      pct_complete_sub: pcts[i.id]?.sub ?? i.pct_certified,
      pct_complete_gmc: pcts[i.id]?.gmc ?? i.pct_certified,
    }));
    const res = await onSave({ week_ending: weekEnding, status: appStatus, items });
    setSaving(false);
    if (!res.ok) setError(res.error || 'Erro ao guardar');
  };

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:16 }}>
        <button onClick={onCancel}
          style={{ background:'none', border:'1px solid #d1d5db', borderRadius:6, padding:'4px 10px', cursor:'pointer', fontSize:13 }}>
          ← Voltar
        </button>
        <h3 style={{ margin:0, fontSize:16, color:'#1a1a2e' }}>App {nextAppNum} — New Assessment</h3>
      </div>

      {/* Week Ending + Status */}
      <div style={{ display:'flex', gap:12, alignItems:'center', marginBottom:16, flexWrap:'wrap' }}>
        <label style={{ fontSize:13, fontWeight:600, color:'#374151' }}>
          WE:&nbsp;
          <select value={weekEnding} onChange={e=>setWeekEnding(e.target.value)}
            style={{ padding:'5px 8px', borderRadius:6, border:'1px solid #d1d5db', fontSize:13 }}>
            {weOptions.map(we => (
              <option key={we} value={we}>
                {new Date(we + 'T12:00:00').toLocaleDateString('en-IE', { day: 'numeric', month: 'short' })}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize:13, fontWeight:600, color:'#374151' }}>
          Status:&nbsp;
          <select value={appStatus} onChange={e=>setAppStatus(e.target.value)}
            style={{ padding:'5px 8px', borderRadius:6, border:'1px solid #d1d5db', fontSize:13 }}>
            <option value="draft">Draft</option>
            <option value="assessed">Assessed</option>
            <option value="approved">Approved</option>
            <option value="invoiced">Invoiced</option>
            <option value="paid">Paid</option>
          </select>
        </label>
        <div style={{ marginLeft:'auto', display:'flex', gap:16, alignItems:'center' }}>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontSize:11, color:'#9ca3af' }}>ESTA APP (GMC)</div>
            <div style={{ fontSize:18, fontWeight:700, color:'#1e40af' }}>{fmtE(totalGmc,2)}</div>
          </div>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontSize:11, color:'#9ca3af' }}>CUMULATIVO</div>
            <div style={{ fontSize:18, fontWeight:700, color:'#166534' }}>{fmtE(cumGmc,2)}</div>
          </div>
        </div>
      </div>

      {error && <div style={{ background:'#fee2e2', color:'#991b1b', padding:'8px 12px', borderRadius:6, marginBottom:12, fontSize:13 }}>{error}</div>}

      {/* Upload Panel */}
      <div style={{ marginBottom:16 }}>
        <button onClick={() => setShowUpload(s => !s)}
          style={{ padding:'6px 14px', borderRadius:6, border:'1px solid #6366f1', background:'#f5f3ff',
            color:'#4338ca', cursor:'pointer', fontSize:13, fontWeight:600 }}>
          {showUpload ? '▼' : '▶'} Importar dados do Excel
        </button>
        {showUpload && (
          <div style={{ background:'#f5f3ff', border:'1px solid #c4b5fd', borderRadius:8, padding:12, marginTop:10 }}>
            <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'flex-end', marginBottom:8 }}>
              <label style={{ fontSize:13 }}>
                <div style={{ fontWeight:600, color:'#374151', marginBottom:4 }}>Ficheiro Excel</div>
                <input type="file" accept=".xlsx,.xls"
                  onChange={e => setImportFile(e.target.files[0])}
                  style={{ fontSize:13 }} />
              </label>
              <label style={{ fontSize:13 }}>
                <div style={{ fontWeight:600, color:'#374151', marginBottom:4 }}>Nome da Aba</div>
                <input type="text" value={sheetName} onChange={e => setSheetName(e.target.value)}
                  placeholder="ex: Folan Civil"
                  style={{ padding:'5px 8px', borderRadius:6, border:'1px solid #c4b5fd', fontSize:13, width:160 }} />
              </label>
              <button
                disabled={!importFile || !sheetName || importing}
                onClick={async () => {
                  setImporting(true);
                  const fd = new FormData();
                  fd.append('file', importFile);
                  fd.append('sheet_name', sheetName);
                  const res = await fetch(
                    `/api/v1/projects/${projectId}/subcontracts/${subcontractId}/applications/import-excel`,
                    { method: 'POST', body: fd }
                  );
                  const json = await res.json();
                  if (json.ok) {
                    setShowUpload(false);
                    setImportFile(null);
                    window.location.reload();
                  } else {
                    setError(`Erro import: ${json.error}`);
                  }
                  setImporting(false);
                }}
                style={{ padding:'6px 18px', borderRadius:6, border:'none', background:'#4338ca',
                  color:'#fff', cursor: importFile && sheetName && !importing ? 'pointer' : 'not-allowed',
                  fontSize:13, fontWeight:600, opacity: importing ? 0.7 : 1 }}>
                {importing ? 'A importar…' : 'Importar'}
              </button>
            </div>
            <div style={{ fontSize:11, color:'#6b7280', fontStyle:'italic' }}>
              Importação carrega dados históricos do Excel. Após, volta à lista.
            </div>
          </div>
        )}
      </div>

      <div style={{ overflowX:'auto' }}>
        <table className="boq-table" style={{ minWidth:900 }}>
          <thead>
            <tr>
              <th>Ref</th>
              <th>Description</th>
              <th style={{textAlign:'right'}}>Contract €</th>
              <th style={{textAlign:'right', color:'#6b7280'}}>Prev %</th>
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
              const cumVal  = Math.round(pcts[it.id]?.gmc / 100 * it.contract_value * 100) / 100;
              const remVal  = Math.round((1 - pcts[it.id]?.gmc / 100) * it.contract_value * 100) / 100;
              return (
                <tr key={it.id} style={{ background: idx%2===0 ? '#f8fafc' : '#fff' }}>
                  <td style={{fontFamily:'monospace', fontSize:11, whiteSpace:'nowrap'}}>{it.item_ref}</td>
                  <td style={{maxWidth:240, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:12}} title={it.description}>{it.description}</td>
                  <td style={{textAlign:'right', fontVariantNumeric:'tabular-nums', fontSize:12}}>€{fmt(it.contract_value,2)}</td>
                  <td style={{textAlign:'right', color:'#9ca3af', fontSize:12}}>{fmtP(c.prev)}</td>
                  {/* Sub % */}
                  <td style={{background:'#fffbeb', padding:'2px 4px'}}>
                    <input type="number" min={0} max={100} step={1}
                      value={pcts[it.id]?.sub ?? c.prev}
                      onChange={e => setPct(it.id, 'sub', e.target.value)}
                      style={{ width:64, textAlign:'center', padding:'3px 4px', border:'1px solid #d97706',
                        borderRadius:4, fontSize:13, background:'#fffbeb' }} />
                  </td>
                  {/* GMC % */}
                  <td style={{background:'#f0fdf4', padding:'2px 4px'}}>
                    <input type="number" min={0} max={100} step={1}
                      value={pcts[it.id]?.gmc ?? c.prev}
                      onChange={e => setPct(it.id, 'gmc', e.target.value)}
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
              <td></td>
              <td></td>
              <td style={{textAlign:'right', color:'#166534'}}>€{fmt(totalGmc,2)}</td>
              <td style={{textAlign:'right', color:'#1e40af'}}>€{fmt(cumGmc,2)}</td>
              <td style={{textAlign:'right', color:'#dc2626'}}>
                €{fmt(boqItems.reduce((s,i)=>s+Math.round((1-(pcts[i.id]?.gmc||i.pct_certified)/100)*i.contract_value*100)/100,0),2)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div style={{ marginTop:16, display:'flex', gap:12, justifyContent:'flex-end' }}>
        <button onClick={onCancel}
          style={{ padding:'8px 20px', borderRadius:6, border:'1px solid #d1d5db', background:'#fff', cursor:'pointer', fontSize:14 }}>
          Cancelar
        </button>
        <button onClick={handleSave} disabled={saving} className="btn-primary"
          style={{ padding:'8px 24px', fontSize:14 }}>
          {saving ? 'A guardar…' : `Guardar App ${nextAppNum}`}
        </button>
      </div>
    </div>
  );
}

// ── Application Detail ────────────────────────────────────────────────────────
function DetailView({ detail, projectId, subcontractId, onUpdated, onBack }) {
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
  const folanPctOf = it => it.pct_complete_sub || 0;          // % importado do Folan
  const folanEurOf = it => it.value_sub_computed || 0;        // € claim do Folan (desta App)
  const prevPctOf  = it => it.pct_prev || 0;
  const gPctOf     = it => Number(gmcPct[it.id]) || 0;        // % de assessment (GMC)
  // € GMC desta App = (% assessment − % anterior) × valor contrato
  const gmcEurOf   = it => Math.round((gPctOf(it) - prevPctOf(it)) / 100 * cvOf(it) * 100) / 100;

  const folanTotal = items.reduce((s, i) => s + folanEurOf(i), 0);
  const gmcTotal   = items.reduce((s, i) => s + (editable ? gmcEurOf(i) : (i.value_gmc_computed || 0)), 0);
  const cutTotal   = folanTotal - gmcTotal;
  const cutPctLive = folanTotal > 0 ? (1 - gmcTotal / folanTotal) * 100 : 0;

  const setItemGmcPct = (id, v) => {
    const n = parseFloat(v);
    setGmcPct(p => ({ ...p, [id]: isNaN(n) ? 0 : Math.round(Math.max(0, n) * 100) / 100 }));
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
    const res = await fetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/applications/${app.id}/assessment`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return res.json();
  };
  const handleSave = async () => {
    setSaving(true); setError(null);
    const j = await saveAssessment();
    setSaving(false);
    if (!j.ok) { setError(j.error || 'Erro ao guardar'); return; }
    await onUpdated();
  };
  const handleApprove = async () => {
    if (!window.confirm(`Aprovar App ${app.application_number} com GMC ${fmtE(gmcTotal, 2)} (corte de ${cutPctLive.toFixed(1)}%)?`)) return;
    setApproving(true); setError(null);
    const j = await saveAssessment();
    if (!j.ok) { setApproving(false); setError(j.error || 'Erro ao guardar'); return; }
    const r = await fetch(`/api/v1/projects/${projectId}/subcontracts/${subcontractId}/applications/${app.id}/status`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'approved' }) });
    const rj = await r.json();
    setApproving(false);
    if (!rj.ok) { setError(rj.error || 'Erro ao aprovar'); return; }
    await onUpdated();
  };

  // Resumo (usa value_*_computed — os campos value_sub/value_gmc são qty*rate=0)
  const totalSubC = items.reduce((s, i) => s + (i.value_sub_computed || 0), 0);
  const totalGmcC = items.reduce((s, i) => s + (i.value_gmc_computed || 0), 0);
  const cutPctApproved = totalSubC > 0 ? Math.round((1 - totalGmcC / totalSubC) * 1000) / 10 : 0;

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:16, flexWrap:'wrap' }}>
        <button onClick={onBack}
          style={{ background:'none', border:'1px solid #d1d5db', borderRadius:6, padding:'4px 10px', cursor:'pointer', fontSize:13 }}>
          ← Voltar
        </button>
        <h3 style={{ margin:0, fontSize:16, color:'#1a1a2e' }}>
          App {app.application_number} — WE {app.week_ending || app.period}
        </h3>
        <span style={{ background:ss.bg, color:ss.color, borderRadius:12, padding:'2px 10px', fontSize:12, fontWeight:600 }}>
          {ss.label}
        </span>
        <div style={{ marginLeft:'auto', display:'flex', gap:16 }}>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontSize:11, color:'#9ca3af' }}>GMC ASSESSMENT</div>
            <div style={{ fontSize:18, fontWeight:700, color:'#166534' }}>{fmtE(editable ? gmcTotal : app.value_gmc, 2)}</div>
          </div>
          <div style={{ textAlign:'right' }}>
            <div style={{ fontSize:11, color:'#9ca3af' }}>CUMULATIVE</div>
            <div style={{ fontSize:18, fontWeight:700, color:'#1e40af' }}>{fmtE(app.cumulative_gmc,2)}</div>
          </div>
        </div>
      </div>

      {error && <div style={{ background:'#fee2e2', color:'#991b1b', padding:'8px 12px', borderRadius:6, marginBottom:12, fontSize:13 }}>{error}</div>}

      {/* Painel de corte do QS (só quando editável) */}
      {editable && (
        <div style={{ background:'#fff7ed', border:'1px solid #fed7aa', borderRadius:8, padding:14, marginBottom:16 }}>
          <div style={{ fontSize:13, fontWeight:700, color:'#9a3412', marginBottom:10 }}>✂️ Corte do QS — ajusta o GMC antes de aprovar</div>
          <div style={{ display:'flex', gap:20, flexWrap:'wrap', alignItems:'center' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <label style={{ fontSize:13, fontWeight:600, color:'#374151' }}>Corte global:</label>
              <input type="number" min={0} max={100} step={1} value={cut}
                onChange={e => setCut(e.target.value)} placeholder="ex: 10"
                style={{ width:70, padding:'5px 8px', borderRadius:6, border:'1px solid #fb923c', fontSize:13, textAlign:'center' }} />
              <span style={{ fontSize:13, color:'#6b7280' }}>%</span>
              <button onClick={applyGlobalCut}
                style={{ padding:'5px 12px', borderRadius:6, border:'none', background:'#ea580c', color:'#fff', cursor:'pointer', fontSize:12, fontWeight:600 }}>
                Aplicar a todos
              </button>
            </div>
            <div style={{ marginLeft:'auto', display:'flex', gap:18, alignItems:'center' }}>
              <Stat label="FOLAN (CLAIM)" value={fmtE(folanTotal,2)} color="#92400e" />
              <Stat label="GMC (APROVA)"  value={fmtE(gmcTotal,2)}   color="#166534" />
              <Stat label="CORTE" value={`${fmtE(cutTotal,2)} · ${cutPctLive.toFixed(1)}%`} color="#dc2626" />
            </div>
          </div>
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
              <Stat label="Date" value={new Date(app.qs_approved_date).toLocaleDateString('en-IE')} color="#374151" small />
            )}
          </div>
        </div>
      )}

      <div style={{ overflowX:'auto' }}>
        <table className="boq-table" style={{ minWidth:860 }}>
          <thead>
            <tr>
              <th>Ref</th>
              <th>Description</th>
              <th style={{textAlign:'right'}}>Contract €</th>
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
                  <td style={{textAlign:'right', color:'#92400e', fontSize:12}}>{fmtP(folanPctOf(it))}</td>
                  <td style={{textAlign:'right', color:'#92400e', fontSize:12, fontVariantNumeric:'tabular-nums'}}>€{fmt(folanEur,2)}</td>
                  <td style={{textAlign:'center', background: editable ? '#f0fdf4' : 'transparent', padding: editable ? '2px 4px' : undefined}}>
                    {editable ? (
                      <span style={{ display:'inline-flex', alignItems:'center', gap:2 }}>
                        <input type="number" min={0} step={1} value={gmcPct[it.id] ?? ''}
                          onChange={e => setItemGmcPct(it.id, e.target.value)}
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
              <td colSpan={4} style={{textAlign:'right', paddingRight:8}}>TOTAL</td>
              <td style={{textAlign:'right', color:'#92400e'}}>{fmtE(folanTotal,2)}</td>
              <td></td>
              <td style={{textAlign:'right', color:'#166534'}}>{fmtE(gmcTotal,2)}</td>
              <td style={{textAlign:'right', color:'#dc2626'}}>{cutTotal > 0.005 ? `−${fmtE(cutTotal,2)}` : '—'}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {editable && (
        <div style={{ marginTop:16, display:'flex', gap:12, justifyContent:'flex-end', flexWrap:'wrap' }}>
          <button onClick={handleSave} disabled={saving || approving}
            style={{ padding:'8px 20px', borderRadius:6, border:'1px solid #16a34a', background:'#fff', color:'#166534',
              cursor: saving||approving ? 'not-allowed' : 'pointer', fontSize:14, fontWeight:600 }}>
            {saving ? 'A guardar…' : 'Guardar corte'}
          </button>
          <button onClick={handleApprove} disabled={saving || approving} className="btn-primary"
            style={{ padding:'8px 24px', fontSize:14 }}>
            {approving ? 'A aprovar…' : '✓ Aprovar App'}
          </button>
        </div>
      )}
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

function SCard({ label, value, sub, color }) {
  return (
    <div style={{ background:'#f8fafc', border:'1px solid #e5e7eb', borderRadius:8, padding:'10px 16px', minWidth:140 }}>
      <div style={{ fontSize:11, color:'#9ca3af', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.05em' }}>{label}</div>
      <div style={{ fontSize:20, fontWeight:700, color, marginTop:2 }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:'#9ca3af', marginTop:2 }}>{sub}</div>}
    </div>
  );
}
