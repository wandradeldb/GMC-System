import { useState, useEffect, useCallback } from 'react';

const fmt  = (n, d = 0) => n == null ? '—' : new Intl.NumberFormat('en-IE', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
const fmtD      = d => { if (!d) return '—'; const [y,m,dy] = String(d).split('-'); return `${dy}/${m}/${y}`; };
const fmtPeriod = p => { if (!p) return '—'; const [y,m] = String(p).split('-'); return new Date(`${y}-${m}-01T12:00:00`).toLocaleDateString('en-IE', { month: 'short', year: 'numeric' }); };

const STATUS_LABEL = { draft: 'Draft', submitted: 'Submitted', certified: 'Certified', paid: 'Paid' };
const STATUS_COLOR = { draft: '#6b7280', submitted: '#1e40af', certified: '#166534', paid: '#7c3aed' };

const SCH_LABEL = { '1': 'Schedule 1 — Prelims Fixed', '1A': 'Schedule 1A — Prelims Time', '2': 'Schedule 2 — Civil & MEICA' };

export default function PayAppView({ projectId }) {
  const [data,       setData]      = useState(null);
  const [showNew,    setShowNew]   = useState(false);
  const [detail,     setDetail]    = useState(null); // single payapp detail

  const load = useCallback(() => {
    fetch(`/api/v1/projects/${projectId}/payapps`)
      .then(r => r.json()).then(setData);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  if (!data) return <div className="state-box"><div className="icon">⏳</div><p>Loading…</p></div>;

  const { payapps, latest, summary } = data;

  if (showNew) return (
    <NewPayAppForm
      projectId={projectId}
      onBack={() => { setShowNew(false); load(); }}
    />
  );

  if (detail) return (
    <PayAppDetail
      payapp={detail}
      projectId={projectId}
      onBack={() => setDetail(null)}
      onStatusChange={load}
    />
  );

  const totalCertified = latest?.net_cumulative || 0;
  const pctCertified = summary.totalBOQ > 0 ? totalCertified / summary.totalBOQ * 100 : 0;

  return (
    <div>
      {/* ── Summary bar ─────────────────────────────────────────── */}
      <div className="tracker-summary">
        <div className="tracker-summary-card">
          <div className="tracker-kpi-label">Contract Value</div>
          <div className="tracker-kpi-value" style={{ color: '#1a1a2e' }}>€{fmt(summary.contractValue)}</div>
          <div className="tracker-kpi-sub">Merlin Park W03/26</div>
        </div>
        <div className="summary-divider" />
        <div className="tracker-summary-card">
          <div className="tracker-kpi-label">Total Certified</div>
          <div className="tracker-kpi-value" style={{ color: '#166534' }}>€{fmt(totalCertified)}</div>
          <div className="tracker-kpi-sub">{fmt(pctCertified, 1)}% of contract</div>
        </div>
        <div className="tracker-summary-card">
          <div className="tracker-kpi-label">Previously Certified</div>
          <div className="tracker-kpi-value" style={{ color: '#374151' }}>€{fmt(latest?.previously_certified || 0)}</div>
          <div className="tracker-kpi-sub">before PayApp #{latest?.app_number || '—'}</div>
        </div>
        <div className="tracker-summary-card">
          <div className="tracker-kpi-label">Last Certificate</div>
          <div className="tracker-kpi-value" style={{ color: '#1e40af' }}>€{fmt(latest?.this_certificate || 0)}</div>
          <div className="tracker-kpi-sub">PayApp #{latest?.app_number} — {fmtD(latest?.date_submitted)}</div>
        </div>
        <div className="summary-divider" />
        <div className="tracker-summary-card">
          <div className="tracker-kpi-label">Retention Held</div>
          <div className="tracker-kpi-value" style={{ color: '#dc2626' }}>€{fmt(latest?.retention_cumulative || 0)}</div>
          <div className="tracker-kpi-sub">{latest?.retention_pct || 3}% of gross</div>
        </div>
        <div className="tracker-summary-card">
          <div className="tracker-kpi-label">Balance Remaining</div>
          <div className="tracker-kpi-value" style={{ color: '#7c3aed' }}>€{fmt((summary.totalBOQ || 0) - (latest?.works_gross_cumulative || 0))}</div>
          <div className="tracker-kpi-sub">uncertified gross works</div>
        </div>
      </div>

      {/* ── Toolbar ─────────────────────────────────────────────── */}
      <div className="tracker-toolbar">
        <h2 className="sc-title">Application for Payment</h2>
        <button className="btn-primary" onClick={() => setShowNew(true)}>
          + New PayApp #{(latest?.app_number || 0) + 1}
        </button>
      </div>

      {/* ── History table ───────────────────────────────────────── */}
      {payapps.length === 0 ? (
        <div className="state-box"><div className="icon">🧾</div><p>No applications yet. Create the first PayApp.</p></div>
      ) : (
        <div style={{ padding: '0 12px 32px', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table className="boq-table" style={{ minWidth: 480 }}>
            <thead>
              <tr>
                <th style={{ width: 50 }}>App #</th>
                <th style={{ width: 80 }}>Period</th>
                <th style={{ width: 110 }} className="payapp-col-hide">Submitted</th>
                <th style={{ width: 100 }}>Status</th>
                <th className="col-num payapp-col-hide">Works Gross</th>
                <th className="col-num payapp-col-hide">Net Cum.</th>
                <th className="col-num" style={{ background: '#f0fdf4' }}>This Certificate</th>
                <th className="col-num" style={{ width: 80 }}>ER Cert #</th>
                <th style={{ width: 50 }}></th>
              </tr>
            </thead>
            <tbody>
              {[...payapps].reverse().map(pa => (
                <tr key={pa.id} style={{ cursor: 'pointer' }} onClick={() => setDetail(pa)}>
                  <td style={{ fontWeight: 700, textAlign: 'center' }}>#{pa.app_number}</td>
                  <td>{fmtPeriod(pa.period)}</td>
                  <td className="payapp-col-hide">{fmtD(pa.date_submitted)}</td>
                  <td>
                    <span className="type-badge" style={{ background: STATUS_COLOR[pa.status] + '18', color: STATUS_COLOR[pa.status], border: `1px solid ${STATUS_COLOR[pa.status]}40` }}>
                      {STATUS_LABEL[pa.status]}
                    </span>
                  </td>
                  <td className="col-num payapp-col-hide" style={{ color: '#6b7280' }}>€{fmt(pa.works_gross_cumulative)}</td>
                  <td className="col-num payapp-col-hide">€{fmt(pa.net_cumulative)}</td>
                  <td className="col-num" style={{ background: '#f0fdf4', color: '#166534', fontWeight: 700, fontSize: 14 }}>
                    €{fmt(pa.this_certificate)}
                  </td>
                  <td className="col-num" style={{ color: '#7c3aed', fontSize: 12 }}>
                    {pa.cert_number || '—'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn-link" onClick={e => { e.stopPropagation(); setDetail(pa); }}>View →</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── New PayApp Form ──────────────────────────────────────────────────────────
function NewPayAppForm({ projectId, onBack }) {
  const [sheet,         setSheet]        = useState(null);
  const [items,         setItems]        = useState([]);
  const [header,        setHeader]       = useState({ period: '', date_submitted: '', retention_pct: 3.0, prepared_by: '', notes: '' });
  const [grossOverride, setGrossOverride] = useState(''); // direct entry of Works Gross
  const [saving,        setSaving]       = useState(false);
  const [saved,         setSaved]        = useState(false);
  const [activeTab,     setActiveTab]    = useState('summary');
  const [search,        setSearch]       = useState('');

  useEffect(() => {
    fetch(`/api/v1/projects/${projectId}/payapps/new/boq-sheet`)
      .then(r => r.json())
      .then(d => {
        setSheet(d);
        setItems(d.items.map(i => ({ ...i, pct_complete: i.pct_prev })));
        // Pre-fill Works Gross from last certified (QS adjusts upward for new app)
        if (d.last_certified?.works_gross_cumulative) {
          setGrossOverride(String(d.last_certified.works_gross_cumulative));
        }
        const now = new Date();
        setHeader(h => ({ ...h, period: `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}` }));
      });
  }, [projectId]);

  if (!sheet) return <div className="state-box"><div className="icon">⏳</div><p>Loading BOQ…</p></div>;

  const setItem = (i, val) => {
    const n = Math.min(100, Math.max(0, parseFloat(val) || 0));
    setItems(rows => rows.map((r, j) => j === i ? { ...r, pct_complete: n } : r));
  };

  // Live totals — use direct gross override if QS entered it, else sum from items
  const itemsGross = items.reduce((s, i) => s + (parseFloat(i.pct_complete) || 0) / 100 * (i.contract_sum || 0), 0);
  const worksGross = grossOverride !== '' ? (parseFloat(grossOverride) || 0) : itemsGross;
  const retPct     = parseFloat(header.retention_pct) || 3;
  const retention  = worksGross * retPct / 100;
  const netCum     = worksGross - retention;
  const prevCert   = sheet.previously_certified;
  const thisCert   = netCum - prevCert;

  const save = async () => {
    setSaving(true);
    await fetch(`/api/v1/projects/${projectId}/payapps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_number:          sheet.next_app_number,
        period:              header.period,
        date_submitted:      header.date_submitted || null,
        retention_pct:       header.retention_pct,
        prepared_by:         header.prepared_by,
        notes:               header.notes,
        works_gross_override: grossOverride !== '' ? parseFloat(grossOverride) : undefined,
        items,
      }),
    });
    setSaving(false); setSaved(true);
    setTimeout(() => onBack(), 1200);
  };

  const schedules = [...new Set(items.map(i => i.schedule))].sort();

  return (
    <div>
      <div className="detail-nav">
        <button className="btn-back" onClick={onBack}>← PayApps</button>
      </div>

      {/* Header */}
      <div className="assessment-header">
        <div className="assessment-title">
          <span className="assessment-period">PayApp #{sheet.next_app_number}</span>
          <span style={{ fontSize: 13, color: '#6b7280' }}>
            Previously Certified: <strong>€{fmt(prevCert)}</strong>
          </span>
        </div>
        <div className="assessment-kpis">
          <div className="assess-kpi">
            <div className="kpi-label">Works Gross (Cum.) €</div>
            <div className="kpi-value" style={{ color: '#1e40af' }}>€{fmt(grossOverride || itemsGross, 2)}</div>
          </div>
          <div className="assess-kpi">
            <div className="kpi-label">Retention ({retPct}%)</div>
            <div className="kpi-value" style={{ color: '#dc2626' }}>€{fmt(retention, 0)}</div>
          </div>
          <div className="assess-kpi">
            <div className="kpi-label">This Certificate</div>
            <div className="kpi-value" style={{ color: thisCert >= 0 ? '#166534' : '#dc2626', fontWeight: 800 }}>€{fmt(thisCert, 0)}</div>
          </div>
        </div>
        <div className="assessment-actions">
          <input value={header.prepared_by} onChange={e => setHeader(h => ({ ...h, prepared_by: e.target.value }))}
            placeholder="Prepared by" style={{ padding:'7px 10px', border:'1px solid #d1d5db', borderRadius:6, fontSize:13, width:150 }} />
          <button className="btn-save" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save PayApp'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="das-tabs">
        {[
          { id: 'boq',     label: `BOQ Detail (${items.length})` },
          { id: 'header',  label: 'Header / Certificate' },
          { id: 'summary', label: 'Summary Sheet' },
        ].map(t => (
          <button key={t.id} className={`das-tab ${activeTab === t.id ? 'active' : ''}`} onClick={() => setActiveTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="das-tab-content">
        {activeTab === 'boq' && (
          <div>
            <div className="section-toolbar" style={{ marginBottom: 12 }}>
              <span className="section-stat">{items.filter(i => parseFloat(i.pct_complete) > 0).length} items with % claimed</span>
              <input type="search" placeholder="Filter items…" value={search} onChange={e => setSearch(e.target.value)}
                style={{ padding:'6px 10px', border:'1px solid #d1d5db', borderRadius:6, fontSize:13, width:220 }} />
            </div>
            {schedules.map(sch => {
              const schItems = items.map((it, idx) => ({ ...it, _idx: idx }))
                .filter(it => it.schedule === sch &&
                  (!search || it.description.toLowerCase().includes(search.toLowerCase()) || it.item_ref.toLowerCase().includes(search.toLowerCase())));
              if (!schItems.length) return null;
              const schVal = schItems.reduce((s, i) => s + (parseFloat(i.pct_complete) || 0) / 100 * (i.contract_sum || 0), 0);
              return (
                <div key={sch} className="schedule-block">
                  <div className="schedule-header">
                    <span className="schedule-title">{SCH_LABEL[sch] || `Schedule ${sch}`}</span>
                    <span className="schedule-total" style={{ fontSize: 13 }}>Claimed: €{fmt(schVal, 0)}</span>
                  </div>
                  <table className="boq-table">
                    <thead>
                      <tr>
                        <th className="col-ref">Ref</th>
                        <th>Description</th>
                        <th className="col-unit">Unit</th>
                        <th className="col-num">Contract Sum</th>
                        <th className="col-num" style={{ background: '#eff6ff' }}>% Prev App</th>
                        <th className="col-num" style={{ background: '#f0fdf4' }}>% This App</th>
                        <th className="col-num" style={{ background: '#f0fdf4' }}>Value Claimed (€)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {schItems.map(row => {
                        const pct = parseFloat(row.pct_complete) || 0;
                        const val = (pct / 100) * (row.contract_sum || 0);
                        const delta = pct - (row.pct_prev || 0);
                        return (
                          <tr key={row._idx}>
                            <td className="col-ref">{row.item_ref}</td>
                            <td style={{ fontSize: 13 }}>{row.description}</td>
                            <td className="col-unit">{row.unit}</td>
                            <td className="col-num" style={{ color: '#6b7280' }}>€{fmt(row.contract_sum, 0)}</td>
                            <td className="col-num" style={{ background: '#f8faff', color: '#6b7280' }}>
                              {fmt(row.pct_prev, 1)}%
                            </td>
                            <td className="col-num" style={{ background: '#f0fff4' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                                <input type="number" min="0" max="100" step="0.5"
                                  value={row.pct_complete}
                                  onChange={e => setItem(row._idx, e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
                                    e.preventDefault();
                                    e.stopPropagation();
                                    const all = [...document.querySelectorAll('.assess-input-gmc')];
                                    const i = all.findIndex(el => el === e.target);
                                    const dir = e.key === 'ArrowUp' ? -1 : 1;
                                    const next = all[i + dir];
                                    if (next) { next.focus(); next.select(); }
                                  }}
                                  className="assess-input assess-input-gmc"
                                  style={{ width: 64 }} />
                                <span style={{ fontSize: 11, color: '#6b7280' }}>%</span>
                              </div>
                            </td>
                            <td className="col-num" style={{ background: '#f0fff4', color: val > 0 ? '#166534' : '#d1d5db', fontWeight: val > 0 ? 700 : 400 }}>
                              {val > 0 ? `€${fmt(val, 0)}` : '—'}
                              {delta > 0 && <div style={{ fontSize: 10, color: '#1e40af' }}>+{fmt(delta, 1)}% this app</div>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'header' && (
          <div className="section-grid" style={{ maxWidth: 520 }}>
            {[
              { key: 'period',         label: 'Period (YYYY-MM)',   type: 'text',   placeholder: '2026-07' },
              { key: 'date_submitted', label: 'Date Submitted',     type: 'date',   placeholder: '' },
              { key: 'retention_pct',  label: 'Retention %',        type: 'number', placeholder: '3.0' },
              { key: 'notes',          label: 'Notes / Commentary', type: 'text',   placeholder: 'Optional notes…' },
            ].map(f => (
              <div key={f.key} className="field">
                <label className="field-label">{f.label}</label>
                <input type={f.type} value={header[f.key]} placeholder={f.placeholder}
                  onChange={e => setHeader(h => ({ ...h, [f.key]: e.target.value }))} />
              </div>
            ))}
          </div>
        )}

        {activeTab === 'summary' && (
          <div style={{ maxWidth: 520, padding: '8px 0' }}>
            <table className="payapp-cert-table">
              <tbody>
                <CertRow label="Works (Current Commitment)" commitment={`€${fmt(sheet.last_certified?.works_gross_cumulative || 0)}`} value={`€${fmt(worksGross, 0)}`} />
                <CertRow label="Adjustment Events" commitment="€0" value="€0" />
                <CertRow label="Total" commitment={`€${fmt(sheet.last_certified?.total_gross_cumulative || 0)}`} value={`€${fmt(worksGross, 0)}`} bold />
                <tr><td colSpan={3} style={{ padding: '6px 0', borderBottom: '1px solid #e5e7eb' }}></td></tr>
                <CertRow label={`Total Retention @ ${retPct}%`} value={`€${fmt(retention, 0)}`} minus />
                <CertRow label="Total less Retention" value={`€${fmt(netCum, 0)}`} bold />
                <CertRow label="Previously Certified" value={`€${fmt(prevCert, 0)}`} minus />
                <tr><td colSpan={3} style={{ padding: '4px 0' }}></td></tr>
                <CertRow label="PRESENT CERTIFICATE" value={`€${fmt(thisCert, 0)}`} total />
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function CertRow({ label, commitment, value, bold, minus, total }) {
  return (
    <tr style={{ background: total ? '#f0fdf4' : 'transparent' }}>
      <td style={{ padding: '7px 12px', fontSize: 13, fontWeight: bold || total ? 700 : 400, color: total ? '#166534' : 'inherit', width: '55%' }}>{label}</td>
      <td style={{ padding: '7px 12px', fontSize: 13, textAlign: 'right', color: '#6b7280', width: '20%' }}>{commitment || ''}</td>
      <td style={{ padding: '7px 12px', fontSize: 13, textAlign: 'right', fontWeight: bold || total ? 700 : 400, color: total ? '#166534' : minus ? '#dc2626' : 'inherit', width: '25%' }}>{minus ? `(${value})` : value}</td>
    </tr>
  );
}

// ── PayApp Detail view ───────────────────────────────────────────────────────
function PayAppDetail({ payapp, projectId, onBack, onStatusChange }) {
  const [erCert,  setErCert]  = useState({ er_works_certified: payapp.er_works_certified || '', er_net_certified: payapp.er_net_certified || '', er_this_cert: payapp.er_this_cert || '', date_certified: payapp.date_certified || '', cert_number: payapp.cert_number || '' });
  const [saving,  setSaving]  = useState(false);

  const nextStatus = { draft: 'submitted', submitted: 'certified', certified: 'paid' };
  const btnLabel   = { draft: 'Submit to Client', submitted: 'Record ER Cert', certified: 'Mark Paid', paid: null };

  const advance = async () => {
    setSaving(true);
    const body = { status: nextStatus[payapp.status], ...erCert };
    await fetch(`/api/v1/projects/${projectId}/payapps/${payapp.id}/status`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    setSaving(false);
    onStatusChange();
    onBack();
  };

  return (
    <div>
      <div className="detail-nav">
        <button className="btn-back" onClick={onBack}>← PayApps</button>
      </div>

      <div className="assessment-header">
        <div className="assessment-title">
          <span className="assessment-period">PayApp #{payapp.app_number} — {fmtPeriod(payapp.period)}</span>
          <span className="type-badge" style={{ background: STATUS_COLOR[payapp.status] + '18', color: STATUS_COLOR[payapp.status], border: `1px solid ${STATUS_COLOR[payapp.status]}40`, fontSize: 12 }}>
            {STATUS_LABEL[payapp.status]}
          </span>
        </div>
        <div className="assessment-kpis">
          <div className="assess-kpi"><div className="kpi-label">Works Gross</div><div className="kpi-value" style={{ color: '#1e40af' }}>€{fmt(payapp.works_gross_cumulative)}</div></div>
          <div className="assess-kpi"><div className="kpi-label">Net Cumulative</div><div className="kpi-value">€{fmt(payapp.net_cumulative)}</div></div>
          <div className="assess-kpi"><div className="kpi-label">This Certificate</div><div className="kpi-value" style={{ color: '#166534', fontWeight: 800 }}>€{fmt(payapp.this_certificate)}</div></div>
        </div>
        {btnLabel[payapp.status] && (
          <div className="assessment-actions">
            <button className="btn-save" onClick={advance} disabled={saving}>
              {saving ? 'Saving…' : btnLabel[payapp.status]}
            </button>
          </div>
        )}
      </div>

      <div style={{ padding: '24px', maxWidth: 560 }}>
        <table className="payapp-cert-table" style={{ marginBottom: 24 }}>
          <thead><tr>
            <th style={{ width:'55%', textAlign:'left', padding:'6px 12px', fontSize:11, textTransform:'uppercase', letterSpacing:'.06em', color:'#6b7280' }}>Item</th>
            <th style={{ width:'22%', textAlign:'right', padding:'6px 12px', fontSize:11, textTransform:'uppercase', color:'#6b7280' }}>Submitted</th>
            <th style={{ width:'23%', textAlign:'right', padding:'6px 12px', fontSize:11, textTransform:'uppercase', color:'#7c3aed' }}>ER Certified</th>
          </tr></thead>
          <tbody>
            <CertRow label="Works (gross cumulative)" value={`€${fmt(payapp.works_gross_cumulative)}`} commitment={payapp.er_works_certified ? `€${fmt(payapp.er_works_certified)}` : '—'} />
            <CertRow label={`Retention @ ${payapp.retention_pct}%`} value={`€${fmt(payapp.retention_cumulative)}`} commitment="" minus />
            <CertRow label="Net Cumulative" value={`€${fmt(payapp.net_cumulative)}`} commitment={payapp.er_net_certified ? `€${fmt(payapp.er_net_certified)}` : '—'} bold />
            <CertRow label="Previously Certified" value={`€${fmt(payapp.previously_certified)}`} commitment="" minus />
            <CertRow label="THIS CERTIFICATE" value={`€${fmt(payapp.this_certificate)}`} commitment={payapp.er_this_cert ? `€${fmt(payapp.er_this_cert)}` : '—'} total />
          </tbody>
        </table>

        {/* ER determination fields — show when submitted */}
        {payapp.status === 'submitted' && (
          <div>
            <div className="section-label" style={{ marginBottom: 12 }}>ER Determination</div>
            <div className="section-grid" style={{ maxWidth: 480 }}>
              {[
                { key: 'cert_number',       label: 'Certificate Number',     type: 'text'   },
                { key: 'date_certified',     label: 'Date Certified',         type: 'date'   },
                { key: 'er_works_certified', label: 'ER Works Certified (€)', type: 'number' },
                { key: 'er_net_certified',   label: 'ER Net Certified (€)',   type: 'number' },
                { key: 'er_this_cert',       label: 'ER This Cert Amount (€)',type: 'number' },
              ].map(f => (
                <div key={f.key} className="field">
                  <label className="field-label">{f.label}</label>
                  <input type={f.type} value={erCert[f.key]} onChange={e => setErCert(c => ({ ...c, [f.key]: e.target.value }))} />
                </div>
              ))}
            </div>
          </div>
        )}

        {payapp.source === 'import' && (
          <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 16 }}>Imported from Excel — {payapp.notes}</p>
        )}
      </div>
    </div>
  );
}
