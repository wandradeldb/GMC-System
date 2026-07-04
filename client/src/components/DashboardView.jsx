import { apiFetch } from '../apiFetch.js';
import { useState, useEffect } from 'react';

const fmtE = (n, d = 0) => n == null ? '—' : `€${new Intl.NumberFormat('en-IE', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n)}`;
const fmtK = n => n == null ? '—' : (Math.abs(n) >= 1000 ? `€${(n / 1000).toFixed(0)}k` : `€${n.toFixed(0)}`);

const PIPELINE = [
  { key: 'draft',    label: 'Planejada', color: '#92400e', bg: '#fef9c3' },
  { key: 'assessed', label: 'Assessed', color: '#d97706', bg: '#fef3c7' },
  { key: 'approved', label: 'Approved', color: '#166534', bg: '#dcfce7' },
  { key: 'invoiced', label: 'Invoiced', color: '#6d28d9', bg: '#ede9fe' },
  { key: 'paid',     label: 'Paid',     color: '#1e40af', bg: '#dbeafe' },
];

export default function DashboardView({ projectId, onNavigate }) {
  const [dash, setDash] = useState(null);
  const [tracker, setTracker] = useState(null);

  useEffect(() => {
    apiFetch(`/api/v1/projects/${projectId}/dashboard`).then(r => r.json()).then(setDash).catch(() => {});
    apiFetch(`/api/v1/projects/${projectId}/tracker`).then(r => r.json()).then(setTracker).catch(() => {});
  }, [projectId]);

  if (!dash || !tracker) return <div className="state-box"><div className="icon">⏳</div><p>Loading dashboard…</p></div>;

  const rows = (tracker.rows || []).filter(r => r.rev_cumulative > 0 || r.cost_cumulative > 0);
  const latest = rows[rows.length - 1] || {};
  const contractValue = dash.project?.contract_value || tracker.summary?.contractValue || 0;
  const revenueCum = latest.rev_cumulative || 0;
  const costCum = latest.cost_cumulative || 0;
  const marginCum = latest.margin_cumulative || 0;
  const marginPct = revenueCum > 0 ? (marginCum / revenueCum) * 100 : 0;
  const targetPct = latest.target_margin_pct || 8;
  const pctComplete = contractValue > 0 ? (revenueCum / contractValue) * 100 : 0;

  // Cost breakdown (cumulative across weeks)
  const cost = { Subs: 0, Materials: 0, Plant: 0, 'OH&P': 0 };
  rows.forEach(r => {
    cost.Subs += r.cost_subs || 0; cost.Materials += r.cost_materials || 0;
    cost.Plant += r.cost_plant || 0; cost['OH&P'] += r.ohp_allowance || 0;
  });
  const costTotal = Object.values(cost).reduce((a, b) => a + b, 0) || 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* KPIs */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <Kpi label="Margin (cumulative)" value={fmtE(marginCum, 0)}
          sub={`${marginPct.toFixed(1)}% · target ${targetPct}%`}
          color={marginPct >= targetPct ? '#166534' : marginPct >= 0 ? '#d97706' : '#dc2626'}
          onClick={() => onNavigate('tracker')} />
        <Kpi label="Works Completed" value={`${pctComplete.toFixed(1)}%`}
          sub={`${fmtE(revenueCum, 0)} of ${fmtE(contractValue, 0)}`}
          color="#1e40af" onClick={() => onNavigate('tracker')} />
        <Kpi label="Certified to Subs" value={fmtE(dash.kpis.certifiedTotal, 0)}
          sub={`of ${fmtE(dash.kpis.committedTotal, 0)} committed`}
          color="#7c3aed" onClick={() => onNavigate('sub')} />
        <Kpi label="Owed to Subs" value={fmtE(dash.kpis.owedToSubs, 0)}
          sub={`Retention held ${fmtE(dash.kpis.retentionHeld, 0)}`}
          color="#dc2626" onClick={() => onNavigate('sub')} />
      </div>

      {/* S-curve + weekly margin */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Card title="Revenue vs Cost (cumulative)" onClick={() => onNavigate('tracker')} grow>
          <SCurve rows={rows} />
        </Card>
        <Card title="Weekly Margin" onClick={() => onNavigate('tracker')} grow>
          <MarginBars rows={rows} target={targetPct} />
        </Card>
      </div>

      {/* Cost breakdown + Pipeline */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Card title="Cost Breakdown (to date)" onClick={() => onNavigate('tracker')} grow>
          {costTotal <= 1 ? <Empty /> : Object.entries(cost).map(([k, v]) => (
            <BarRow key={k} label={k} value={v} pct={v / costTotal * 100} color="#6366f1" />
          ))}
        </Card>
        <Card title="Applications Pipeline" onClick={() => onNavigate('sub')} grow>
          <Pipeline pipeline={dash.pipeline} />
        </Card>
      </div>

      {/* Sub exposure */}
      <Card title="Subcontract Exposure (committed · certified · remaining)" onClick={() => onNavigate('sub')}>
        {dash.subExposure.length === 0 ? <Empty /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {dash.subExposure.map(s => {
              const cv = s.contract_value || 1;
              const certPct = Math.min(100, s.certified / cv * 100);
              return (
                <div key={s.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                    <span style={{ fontWeight: 600, color: '#1a1a2e' }}>{s.ref} — {s.sub_name}</span>
                    <span style={{ color: '#6b7280' }}>{fmtE(s.certified, 0)} / {fmtE(s.contract_value, 0)}</span>
                  </div>
                  <div style={{ height: 16, background: '#fee2e2', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${certPct}%`, height: '100%', background: '#16a34a' }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Charts ──────────────────────────────────────────────────────────────────
function SCurve({ rows }) {
  if (rows.length < 2) return <Empty />;
  const W = 560, H = 220, pad = 40;
  const rev = rows.map(r => r.rev_cumulative || 0);
  const cost = rows.map(r => r.cost_cumulative || 0);
  const maxV = Math.max(...rev, ...cost, 1);
  const n = rows.length;
  const x = i => pad + (i / (n - 1)) * (W - pad - 10);
  const y = v => H - pad - (v / maxV) * (H - pad - 14);
  const path = arr => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
        {[0, 0.5, 1].map(f => (
          <g key={f}>
            <line x1={pad} y1={y(maxV * f)} x2={W - 10} y2={y(maxV * f)} stroke="#eef2f7" />
            <text x={4} y={y(maxV * f) + 4} fontSize="9" fill="#9ca3af">{fmtK(maxV * f)}</text>
          </g>
        ))}
        <path d={path(rev)} fill="none" stroke="#1e40af" strokeWidth="2.5" />
        <path d={path(cost)} fill="none" stroke="#dc2626" strokeWidth="2.5" />
      </svg>
      <Legend items={[{ c: '#1e40af', l: 'Revenue' }, { c: '#dc2626', l: 'Cost' }]} />
    </div>
  );
}

function MarginBars({ rows, target }) {
  if (rows.length < 1) return <Empty />;
  const W = 560, H = 220, pad = 40;
  const vals = rows.map(r => r.margin_week || 0);
  const maxV = Math.max(...vals.map(Math.abs), 1);
  const n = rows.length;
  const bw = (W - pad - 10) / n * 0.7;
  const x = i => pad + (i + 0.15) / n * (W - pad - 10);
  const zeroY = H - pad - ((0 + maxV) / (2 * maxV)) * (H - pad - 14);
  const y = v => H - pad - ((v + maxV) / (2 * maxV)) * (H - pad - 14);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
        <line x1={pad} y1={zeroY} x2={W - 10} y2={zeroY} stroke="#cbd5e1" />
        <text x={4} y={zeroY + 4} fontSize="9" fill="#9ca3af">0</text>
        {rows.map((r, i) => {
          const v = r.margin_week || 0;
          return <rect key={i} x={x(i)} y={Math.min(zeroY, y(v))} width={bw} height={Math.abs(y(v) - zeroY)}
            fill={v >= 0 ? '#16a34a' : '#dc2626'} rx="1" />;
        })}
      </svg>
      <Legend items={[{ c: '#16a34a', l: 'Positive' }, { c: '#dc2626', l: 'Negative' }]} />
    </div>
  );
}

function Pipeline({ pipeline }) {
  const total = PIPELINE.reduce((a, p) => a + (pipeline[p.key] || 0), 0);
  if (total <= 0) return <Empty />;
  return (
    <div>
      <div style={{ display: 'flex', height: 26, borderRadius: 6, overflow: 'hidden', marginBottom: 12 }}>
        {PIPELINE.map(p => {
          const v = pipeline[p.key] || 0;
          if (v <= 0) return null;
          return <div key={p.key} title={`${p.label}: ${fmtE(v, 0)}`}
            style={{ width: `${v / total * 100}%`, background: p.color }} />;
        })}
      </div>
      {PIPELINE.filter(p => (pipeline[p.key] || 0) > 0).map(p => (
        <div key={p.key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: p.color }} />{p.label}
          </span>
          <span style={{ fontWeight: 600 }}>{fmtE(pipeline[p.key], 0)}</span>
        </div>
      ))}
    </div>
  );
}

// ── UI helpers ──────────────────────────────────────────────────────────────
function Kpi({ label, value, sub, color, onClick }) {
  return (
    <div onClick={onClick} title="Open source tab"
      style={{ flex: 1, minWidth: 180, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
        padding: '14px 18px', cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
      <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
function Card({ title, children, onClick, grow }) {
  return (
    <div style={{ flex: grow ? 1 : 'unset', minWidth: grow ? 340 : 'unset', background: '#fff',
      border: '1px solid #e5e7eb', borderRadius: 10, padding: 16 }}>
      <div onClick={onClick} title="Open source tab"
        style={{ fontSize: 13, fontWeight: 700, color: '#1a1a2e', marginBottom: 12, cursor: onClick ? 'pointer' : 'default',
          display: 'flex', justifyContent: 'space-between' }}>
        {title} {onClick && <span style={{ color: '#6366f1', fontSize: 12 }}>↗</span>}
      </div>
      {children}
    </div>
  );
}
function BarRow({ label, value, pct, color }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
        <span style={{ color: '#374151' }}>{label}</span>
        <span style={{ fontWeight: 600 }}>{fmtE(value, 0)} <span style={{ color: '#9ca3af' }}>({pct.toFixed(0)}%)</span></span>
      </div>
      <div style={{ height: 12, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color }} />
      </div>
    </div>
  );
}
function Legend({ items }) {
  return (
    <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 6 }}>
      {items.map(it => (
        <span key={it.l} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#6b7280' }}>
          <span style={{ width: 12, height: 3, background: it.c, borderRadius: 2 }} />{it.l}
        </span>
      ))}
    </div>
  );
}
function Empty() {
  return <div style={{ color: '#9ca3af', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>No data yet.</div>;
}
