import { apiFetch } from '../apiFetch.js';
import { useState, useEffect } from 'react';
import { SECTIONS } from '../lib/sections.js';

const fmtE = (n, d = 0) => n == null ? '—' : `€${new Intl.NumberFormat('en-IE', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n)}`;
const fmtK = n => n == null ? '—' : (Math.abs(n) >= 1000 ? `€${(n / 1000).toFixed(0)}k` : `€${n.toFixed(0)}`);
const fmtDate = iso => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-IE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

// Section name -> the weekly tracker_we column it rolls up into (mirrors server/routes/revenue.js's SECTION_COL)
const SECTION_TO_TRACKER_COL = {
  'Prelim Fixed': 'rev_prelims_fixed',
  'Prelim Time':  'rev_prelims_time',
  'Civil Works':  'rev_civil',
  'MEICA Works':  'rev_meica',
  'Landscape':    'rev_landscape',
  'Commission':   'rev_commissioning',
};

const PIPELINE = [
  { key: 'draft',    label: 'Planejada', color: '#c9973b', bg: '#3a2c12' },
  { key: 'assessed', label: 'Assessed',  color: '#e0a940', bg: '#3a2c12' },
  { key: 'approved', label: 'Approved',  color: '#6fd189', bg: '#112b19' },
  { key: 'invoiced', label: 'Invoiced',  color: '#a99be0', bg: '#221c33' },
  { key: 'paid',     label: 'Paid',      color: '#3fd3e0', bg: '#0e2a2e' },
];

export default function DashboardView({ projectId, onNavigate }) {
  const [dash, setDash] = useState(null);
  const [tracker, setTracker] = useState(null);
  const [activities, setActivities] = useState(null);
  const [payapps, setPayapps] = useState(null);

  useEffect(() => {
    apiFetch(`/api/v1/projects/${projectId}/dashboard`).then(r => r.json()).then(setDash).catch(() => {});
    apiFetch(`/api/v1/projects/${projectId}/tracker`).then(r => r.json()).then(setTracker).catch(() => {});
    apiFetch(`/api/v1/projects/${projectId}/revenue/activities`).then(r => r.json()).then(setActivities).catch(() => setActivities([]));
    apiFetch(`/api/v1/projects/${projectId}/payapps`).then(r => r.json()).then(setPayapps).catch(() => setPayapps({ payapps: [] }));
  }, [projectId]);

  if (!dash || !tracker || !activities || !payapps) return <div className="state-box"><div className="icon">⏳</div><p>Loading dashboard…</p></div>;

  // Client side of the cash picture: certified = latest cert issued by the ER (any status from
  // 'certified' on); received = latest cert that's actually been marked paid. Both cumulative,
  // read off the most recent PayApp that qualifies (payapps are cumulative by design).
  const paList = payapps.payapps || [];
  const certifiedByClient  = [...paList].reverse().find(p => ['certified', 'paid'].includes(p.status))?.net_cumulative || 0;
  const receivedFromClient = [...paList].reverse().find(p => p.status === 'paid')?.net_cumulative || 0;

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

  // Revenue by category: tender value per section (from revenue_activity) vs cumulative
  // certified per section (summed weekly tracker_we columns) — same pattern as Cost Breakdown above.
  const catTender = {};
  activities.forEach(a => { catTender[a.section] = (catTender[a.section] || 0) + (a.contract_value || 0); });
  const catRevenue = {};
  SECTIONS.forEach(s => {
    const col = SECTION_TO_TRACKER_COL[s];
    catRevenue[s] = rows.reduce((sum, r) => sum + (r[col] || 0), 0);
  });
  const categories = SECTIONS
    .map(s => {
      const tender = catTender[s] || 0;
      const revenue = catRevenue[s] || 0;
      const pct = tender > 0 ? (revenue / tender) * 100 : 0;
      const shareOfContract = contractValue > 0 ? (tender / contractValue) * 100 : 0;
      // Flag categories that are a meaningful slice of the contract (>=10%) and lagging the
      // project's own average pace — not just "0% = bad", since a category can legitimately not
      // be due yet. A small-value category sitting at 0% stays neutral rather than alarming.
      let status = 'neutral';
      if (shareOfContract >= 10 && pct < pctComplete) status = 'bad';
      else if (pct >= pctComplete) status = 'good';
      return { section: s, tender, revenue, pct, shareOfContract, status };
    })
    .filter(c => c.tender > 0)
    .sort((a, b) => b.tender - a.tender);

  // The single biggest risk to surface: the "behind" category carrying the largest share of the
  // contract. If nothing qualifies as behind, there's no callout to show — an all-clear project
  // shouldn't get a fabricated warning.
  const riskCategory = categories.filter(c => c.status === 'bad').sort((a, b) => b.shareOfContract - a.shareOfContract)[0];

  return (
    <div className="exec-dashboard">
      <header className="ed-titleblock">
        <div>
          <div className="ed-eyebrow">Executive dashboard</div>
          <h1>{dash.project?.name || 'Project'}</h1>
          {dash.project?.client && <div className="ed-sub">{dash.project.client}</div>}
        </div>
        <dl className="ed-stampgrid">
          <div><dt>Project code</dt><dd>{dash.project?.ref || '—'}</dd></div>
          <div><dt>Week no.</dt><dd>{latest.week_number ?? '—'}</dd></div>
          <div><dt>Week ending</dt><dd>{fmtDate(latest.week_ending)}</dd></div>
        </dl>
      </header>

      <section className="ed-kpi-strip">
        <Kpi label="Margin (cumulative)" value={fmtE(marginCum, 0)}
          delta={`${marginPct.toFixed(1)}% · target ${targetPct}%`}
          color={marginPct >= targetPct ? 'var(--ed-good)' : marginPct >= 0 ? 'var(--ed-warn)' : 'var(--ed-bad)'}
          onClick={() => onNavigate('tracker')} />
        <Kpi label="Works Completed" value={`${pctComplete.toFixed(1)}%`}
          delta={`${fmtE(revenueCum, 0)} of ${fmtE(contractValue, 0)}`}
          color="var(--ed-accent)" onClick={() => onNavigate('tracker')} />
        <Kpi label="Certified by Client" value={fmtE(certifiedByClient, 0)}
          delta={`${contractValue > 0 ? (certifiedByClient / contractValue * 100).toFixed(1) : '0.0'}% of contract`}
          color="var(--ed-good)" onClick={() => onNavigate('payapp')} />
        <Kpi label="Received from Client" value={fmtE(receivedFromClient, 0)}
          delta={`${fmtE(certifiedByClient - receivedFromClient, 0)} certified, not yet paid`}
          color="var(--ed-accent)" onClick={() => onNavigate('payapp')} />
        <Kpi label="Certified to Subs" value={fmtE(dash.kpis.certifiedTotal, 0)}
          delta={`of ${fmtE(dash.kpis.committedTotal, 0)} committed`}
          color="var(--ed-cost)" onClick={() => onNavigate('sub')} />
        <Kpi label="Owed to Subs" value={fmtE(dash.kpis.owedToSubs, 0)}
          delta={`Retention held ${fmtE(dash.kpis.retentionHeld, 0)}`}
          color="var(--ed-bad)" onClick={() => onNavigate('sub')} />
      </section>

      {riskCategory && (
        <div className="ed-callout">
          <div className="ed-callout-mark" aria-hidden="true" />
          <div>
            <div className="ed-callout-head">{riskCategory.section} is the number the {pctComplete.toFixed(1)}% headline hides</div>
            <div className="ed-callout-text">
              {riskCategory.section} is <b>{fmtE(riskCategory.tender, 0)}</b> — <b>{riskCategory.shareOfContract.toFixed(0)}%</b> of
              the entire contract — and is only <b>{riskCategory.pct.toFixed(1)}%</b> certified, against the
              project's overall <b>{pctComplete.toFixed(1)}%</b> pace.
            </div>
          </div>
        </div>
      )}

      <div className="ed-grid-2">
        <Card title="Revenue vs Cost (cumulative)" onClick={() => onNavigate('tracker')}>
          <SCurve rows={rows} />
        </Card>
        <Card title="Revenue by Category" sub="Cumulative % of each category's tender value certified" onClick={() => onNavigate('boq')}>
          {categories.length === 0 ? <Empty /> : (
            <div className="ed-catlist">
              {categories.map(c => <CategoryRow key={c.section} {...c} />)}
              <div className="ed-statuskey">
                <StatusKey color="var(--ed-good)" label="On track" />
                <StatusKey color="var(--ed-warn)" label="Behind — large share of contract, lagging pace" />
                <StatusKey color="var(--ed-ink-faint)" label="Below pace, low value at stake" />
              </div>
            </div>
          )}
        </Card>
      </div>

      <div className="ed-grid-2">
        <Card title="Weekly Margin" onClick={() => onNavigate('tracker')}>
          <MarginBars rows={rows} target={targetPct} />
        </Card>
        <Card title="Cost Breakdown (to date)" onClick={() => onNavigate('tracker')}>
          {costTotal <= 1 ? <Empty /> : Object.entries(cost).map(([k, v]) => (
            <BarRow key={k} label={k} value={v} pct={v / costTotal * 100} color="var(--ed-cost)" />
          ))}
        </Card>
      </div>

      <div className="ed-grid-2">
        <Card title="Applications Pipeline" onClick={() => onNavigate('sub')}>
          <Pipeline pipeline={dash.pipeline} />
        </Card>
        <Card title="Subcontract Exposure" sub="committed · certified · remaining" onClick={() => onNavigate('sub')}>
          {dash.subExposure.length === 0 ? <Empty /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {dash.subExposure.map(s => {
                const cv = s.contract_value || 1;
                const certPct = Math.min(100, s.certified / cv * 100);
                return (
                  <div key={s.id}>
                    <div className="ed-catrow-head">
                      <span className="ed-cat-name">{s.ref} — {s.sub_name}</span>
                      <span className="ed-cat-amt">{fmtE(s.certified, 0)} / {fmtE(s.contract_value, 0)}</span>
                    </div>
                    <div className="ed-track"><div className="ed-fill" style={{ width: `${certPct}%`, background: 'var(--ed-good)' }} /></div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ── Charts ──────────────────────────────────────────────────────────────────
function SCurve({ rows }) {
  if (rows.length < 2) return <Empty />;
  const W = 560, H = 230, padL = 40, padB = 50, padT = 14;
  const rev = rows.map(r => r.rev_cumulative || 0);
  const cost = rows.map(r => r.cost_cumulative || 0);
  const maxV = Math.max(...rev, ...cost, 1);
  const n = rows.length;

  // X axis is a real time scale (by week_ending date), not point order — a missing week in
  // tracker_we (a gap in the data) then draws as a visibly wider gap in the line instead of being
  // silently compressed to look like a normal 1-week step.
  const dates = rows.map(r => new Date(r.week_ending + 'T12:00:00').getTime());
  const span = Math.max(1, dates[n - 1] - dates[0]);
  const x = i => padL + ((dates[i] - dates[0]) / span) * (W - padL - 10);
  const y = v => (H - padB) - (v / maxV) * (H - padB - padT);
  const path = arr => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  // Label every week when there's room for it (rotated so short labels don't need much width);
  // only thin out once a project has run long enough that even rotated labels would overlap.
  const tickEvery = n <= 30 ? 1 : Math.ceil(n / 30);
  const tickIdxs = [...new Set(rows.map((_, i) => i).filter(i => i % tickEvery === 0).concat(n - 1))];
  const fmtTick = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-IE', { day: '2-digit', month: 'short' }) : '';

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
        {[0, 0.5, 1].map(f => (
          <g key={f}>
            <line x1={padL} y1={y(maxV * f)} x2={W - 10} y2={y(maxV * f)} stroke="var(--ed-line)" />
            <text x={4} y={y(maxV * f) + 4} fontSize="9" fontFamily="var(--ed-font-mono)" fill="var(--ed-ink-faint)">{fmtK(maxV * f)}</text>
          </g>
        ))}
        <path d={path(rev)} fill="none" stroke="var(--ed-accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <path d={path(cost)} fill="none" stroke="var(--ed-cost)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {tickIdxs.map(i => (
          <g key={i}>
            <line x1={x(i)} y1={H - padB} x2={x(i)} y2={H - padB + 4} stroke="var(--ed-line)" />
            <text x={x(i)} y={H - padB + 8} fontSize="7" fontFamily="var(--ed-font-mono)" fill="var(--ed-ink-faint)"
              textAnchor="end" transform={`rotate(-55 ${x(i).toFixed(1)} ${H - padB + 8})`}>
              {fmtTick(rows[i].week_ending)}
            </text>
          </g>
        ))}
      </svg>
      <Legend items={[{ c: 'var(--ed-accent)', l: 'Revenue' }, { c: 'var(--ed-cost)', l: 'Cost' }]} />
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
        <line x1={pad} y1={zeroY} x2={W - 10} y2={zeroY} stroke="var(--ed-line-strong)" />
        <text x={4} y={zeroY + 4} fontSize="9" fontFamily="var(--ed-font-mono)" fill="var(--ed-ink-faint)">0</text>
        {rows.map((r, i) => {
          const v = r.margin_week || 0;
          return <rect key={i} x={x(i)} y={Math.min(zeroY, y(v))} width={bw} height={Math.abs(y(v) - zeroY)}
            fill={v >= 0 ? 'var(--ed-good)' : 'var(--ed-bad)'} rx="1" />;
        })}
      </svg>
      <Legend items={[{ c: 'var(--ed-good)', l: 'Positive' }, { c: 'var(--ed-bad)', l: 'Negative' }]} />
    </div>
  );
}

function Pipeline({ pipeline }) {
  const total = PIPELINE.reduce((a, p) => a + (pipeline[p.key] || 0), 0);
  if (total <= 0) return <Empty />;
  return (
    <div>
      <div className="ed-pipeline-strip">
        {PIPELINE.map(p => {
          const v = pipeline[p.key] || 0;
          if (v <= 0) return null;
          return <div key={p.key} title={`${p.label}: ${fmtE(v, 0)}`}
            style={{ width: `${v / total * 100}%`, background: p.color }} />;
        })}
      </div>
      {PIPELINE.filter(p => (pipeline[p.key] || 0) > 0).map(p => (
        <div key={p.key} className="ed-pipeline-row">
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: p.color }} />{p.label}
          </span>
          <b>{fmtE(pipeline[p.key], 0)}</b>
        </div>
      ))}
    </div>
  );
}

const STATUS_COLOR = { good: 'var(--ed-good)', bad: 'var(--ed-warn)', neutral: 'var(--ed-ink-faint)' };
const STATUS_LABEL = { good: 'on track', bad: 'behind pace', neutral: 'below pace' };
function CategoryRow({ section, tender, revenue, pct, shareOfContract, status }) {
  const color = STATUS_COLOR[status];
  return (
    <div>
      <div className="ed-catrow-head">
        <span className="ed-cat-name">{section}</span>
        <span className="ed-cat-amt">{fmtE(tender, 0)} tender · {shareOfContract.toFixed(0)}% of contract</span>
      </div>
      <div className="ed-track"><div className="ed-fill" style={{ width: `${Math.min(100, pct)}%`, background: color }} /></div>
      <div className="ed-catrow-foot">
        <span style={{ color, fontWeight: 600 }}>{pct.toFixed(1)}% certified{status !== 'neutral' ? ` · ${STATUS_LABEL[status]}` : ''}</span>
        <span>{fmtE(revenue, 0)}</span>
      </div>
    </div>
  );
}
function StatusKey({ color, label }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />{label}
    </span>
  );
}

// ── UI helpers ──────────────────────────────────────────────────────────────
function Kpi({ label, value, delta, color, onClick }) {
  return (
    <div className="ed-kpi" onClick={onClick} title="Open source tab">
      <div className="ed-kpi-label">{label}</div>
      <div className="ed-kpi-value ed-mono" style={{ color }}>{value}</div>
      {delta && <div className="ed-kpi-delta">{delta}</div>}
    </div>
  );
}
function Card({ title, sub, children, onClick }) {
  return (
    <div className="ed-panel">
      <div className="ed-panel-title" onClick={onClick} title="Open source tab">
        {title} {onClick && <span style={{ color: 'var(--ed-accent)', fontSize: 12 }}>↗</span>}
      </div>
      {sub && <div className="ed-panel-sub">{sub}</div>}
      {children}
    </div>
  );
}
function BarRow({ label, value, pct, color }) {
  return (
    <div className="ed-barrow">
      <div className="ed-barrow-head">
        <span>{label}</span>
        <span><b className="ed-mono">{fmtE(value, 0)}</b> <span>({pct.toFixed(0)}%)</span></span>
      </div>
      <div className="ed-barrow-track"><div className="ed-barrow-fill" style={{ width: `${pct}%`, background: color }} /></div>
    </div>
  );
}
function Legend({ items }) {
  return (
    <div className="ed-legend">
      {items.map(it => (
        <span key={it.l}><i style={{ background: it.c }} />{it.l}</span>
      ))}
    </div>
  );
}
function Empty() {
  return <div className="ed-empty">No data yet.</div>;
}
