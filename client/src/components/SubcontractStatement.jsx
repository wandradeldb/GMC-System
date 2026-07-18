const fmt  = (n, d = 2) => n == null ? '—' : new Intl.NumberFormat('en-IE', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
const fmtE = (n, d = 0) => n == null ? '—' : `€${fmt(n, d)}`;
const fmtDate = iso => {
  if (!iso) return '—';
  const m = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

const STATUS_LABEL = { draft:'Planejada', assessed:'Assessed', approved:'Approved', invoiced:'Invoiced', paid:'Paid' };

// Full application history for one subcontract, one document -- for subs that run to 30+
// applications, cuts/Daywork/Variation/Contra Charge divergences accumulate across all of them, so
// a QS needs to walk the whole history with the sub in a meeting rather than one certificate at a
// time. Summary table up top (one row per application), then a page-break-per-application item
// breakdown below (only for applications with actual claimed/assessed movement or a linked CE, to
// avoid dozens of all-zero rows for subs whose BOQ has far more items than any one period touches).
export default function SubcontractStatement({ data, onBack }) {
  const { subcontract: sc = {}, project = {}, contractValue = 0, applications = [] } = data;

  const totals = applications.reduce((t, a) => ({
    sub:  t.sub  + (a.value_sub || 0),
    gmc:  t.gmc  + (a.value_gmc || 0),
    cut:  t.cut  + (a.cutValue || 0),
    day:  t.day  + (a.daySum || 0),
    varn: t.varn + (a.varSum || 0),
    cc:   t.cc   + (a.ccSum || 0),
    net:  t.net  + (a.net_payable || 0),
  }), { sub:0, gmc:0, cut:0, day:0, varn:0, cc:0, net:0 });

  const lastApp         = applications[applications.length - 1];
  const cumulativeFinal = lastApp?.cumulative_gmc || 0;
  const retentionFinal  = Math.round(cumulativeFinal * (sc.retention_pct || 0) / 100 * 100) / 100;

  const detailApps = applications.filter(a =>
    a.items.some(i => (i.value_sub_computed || 0) > 0 || (i.value_gmc_computed || 0) > 0) ||
    a.compensation_events.length > 0
  );

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

      <div className="cert-print" style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:8, padding:28, maxWidth:980, margin:'0 auto' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:16,
          background:'#1a1a2e', color:'#fff', borderRadius:6, padding:'14px 20px', margin:'-28px -28px 22px -28px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:14 }}>
            <img src="/gmc-logo.png" alt="GMC" style={{ height:42, background:'#fff', borderRadius:6, padding:'4px 6px' }} />
            <div>
              <div style={{ fontSize:20, fontWeight:800, letterSpacing:'0.03em' }}>SUBCONTRACT STATEMENT</div>
              <div style={{ fontSize:12, color:'#c7cad1', marginTop:2 }}>{project.name} — {project.ref} · {project.client}</div>
            </div>
          </div>
          <div style={{ textAlign:'right', fontSize:11, color:'#c7cad1', lineHeight:1.6 }}>
            <div>Printed: {fmtDate((d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`)(new Date()))}</div>
          </div>
        </div>

        <div style={{ display:'flex', flexWrap:'wrap', gap:'8px 40px', marginBottom:22, fontSize:13 }}>
          <CField label="Contractor" value={`${sc.sub_name || ''} (${sc.ref || ''})`} />
          <CField label="Contract Value" value={fmtE(contractValue, 2)} />
          <CField label="Retention" value={`${sc.retention_pct || 0}%`} />
          <CField label="Applications" value={applications.length} />
          <CField label="Period" value={applications.length ? `${fmtDate(applications[0].week_ending)} – ${fmtDate(lastApp.week_ending)}` : '—'} />
        </div>

        <CTitle>Summary — All Applications</CTitle>
        {applications.length === 0 ? (
          <div style={{ color:'#9ca3af', fontSize:13, marginBottom:22 }}>No applications yet.</div>
        ) : (
        <div style={{ overflowX:'auto', marginBottom:22 }}>
        <table className="boq-table">
          <thead><tr>
            <th>App #</th><th>Week Ending</th>
            <th style={{textAlign:'right'}}>Sub Claimed €</th>
            <th style={{textAlign:'right'}}>GMC Assessed €</th>
            <th style={{textAlign:'right'}}>Cut €</th>
            <th style={{textAlign:'right'}}>Cut %</th>
            <th style={{textAlign:'right'}}>Daywork €</th>
            <th style={{textAlign:'right'}}>Variation €</th>
            <th style={{textAlign:'right'}}>Contra Charge €</th>
            <th style={{textAlign:'right'}}>Cumulative €</th>
            <th style={{textAlign:'right'}}>Retention €</th>
            <th style={{textAlign:'right'}}>Net Payable €</th>
            <th>Status</th>
          </tr></thead>
          <tbody>
            {applications.map(a => {
              const retHeld = Math.round((a.cumulative_gmc || 0) * (sc.retention_pct || 0) / 100 * 100) / 100;
              return (
                <tr key={a.id}>
                  <td style={{ fontWeight:700 }}>App {a.application_number}</td>
                  <td>{fmtDate(a.week_ending)}</td>
                  <td style={{textAlign:'right'}}>{fmtE(a.value_sub,2)}</td>
                  <td style={{textAlign:'right', fontWeight:600}}>{fmtE(a.value_gmc,2)}</td>
                  <td style={{textAlign:'right', color: a.cutValue > 0.005 ? '#dc2626' : '#9ca3af'}}>
                    {a.cutValue > 0.005 ? `− ${fmtE(a.cutValue,2)}` : '—'}
                  </td>
                  <td style={{textAlign:'right', color:'#6b7280'}}>{a.cutPct ? `${a.cutPct}%` : '—'}</td>
                  <td style={{textAlign:'right', color: a.daySum > 0 ? '#7c3aed' : '#9ca3af'}}>{a.daySum > 0 ? fmtE(a.daySum,2) : '—'}</td>
                  <td style={{textAlign:'right', color: a.varSum > 0 ? '#7c3aed' : '#9ca3af'}}>{a.varSum > 0 ? fmtE(a.varSum,2) : '—'}</td>
                  <td style={{textAlign:'right', color: a.ccSum > 0 ? '#dc2626' : '#9ca3af'}}>{a.ccSum > 0 ? `− ${fmtE(a.ccSum,2)}` : '—'}</td>
                  <td style={{textAlign:'right'}}>{fmtE(a.cumulative_gmc,2)}</td>
                  <td style={{textAlign:'right'}}>{fmtE(retHeld,2)}</td>
                  <td style={{textAlign:'right', fontWeight:700}}>{fmtE(a.net_payable,2)}</td>
                  <td>{STATUS_LABEL[a.status] || a.status}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight:700, background:'#f1f5f9' }}>
              <td colSpan={2} style={{textAlign:'right', paddingRight:8}}>TOTAL</td>
              <td style={{textAlign:'right'}}>{fmtE(totals.sub,2)}</td>
              <td style={{textAlign:'right'}}>{fmtE(totals.gmc,2)}</td>
              <td style={{textAlign:'right', color:'#dc2626'}}>{totals.cut > 0.005 ? `− ${fmtE(totals.cut,2)}` : '—'}</td>
              <td></td>
              <td style={{textAlign:'right', color:'#7c3aed'}}>{fmtE(totals.day,2)}</td>
              <td style={{textAlign:'right', color:'#7c3aed'}}>{fmtE(totals.varn,2)}</td>
              <td style={{textAlign:'right', color:'#dc2626'}}>{totals.cc > 0.005 ? `− ${fmtE(totals.cc,2)}` : '—'}</td>
              <td style={{textAlign:'right'}}>{fmtE(cumulativeFinal,2)}</td>
              <td style={{textAlign:'right'}}>{fmtE(retentionFinal,2)}</td>
              <td style={{textAlign:'right'}}>{fmtE(totals.net,2)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
        </div>
        )}

        {detailApps.map(a => (
          <div key={a.id} style={{ pageBreakBefore:'always', paddingTop:8 }}>
            <CTitle>Application #{a.application_number} — WE {fmtDate(a.week_ending)} — Item Breakdown</CTitle>
            <div style={{ overflowX:'auto' }}>
            <table className="boq-table" style={{ marginBottom:10 }}>
              <thead><tr>
                <th>Ref</th><th>Description</th>
                <th style={{textAlign:'right'}}>Contract €</th>
                <th style={{textAlign:'right'}}>Sub %</th>
                <th style={{textAlign:'right'}}>Sub €</th>
                <th style={{textAlign:'right'}}>GMC %</th>
                <th style={{textAlign:'right'}}>GMC €</th>
                <th style={{textAlign:'right'}}>Cut €</th>
              </tr></thead>
              <tbody>
                {a.items.filter(i => (i.value_sub_computed || 0) > 0 || (i.value_gmc_computed || 0) > 0).map((i, idx) => {
                  const itemCut = (i.value_sub_computed || 0) - (i.value_gmc_computed || 0);
                  return (
                    <tr key={idx}>
                      <td style={{ fontFamily:'monospace', fontSize:11 }}>{i.item_ref}</td>
                      <td style={{ fontSize:12 }}>{i.description}</td>
                      <td style={{textAlign:'right'}}>{fmtE(i.contract_value,2)}</td>
                      <td style={{textAlign:'right'}}>{i.pct_complete_sub != null ? `${Number(i.pct_complete_sub).toFixed(1)}%` : '—'}</td>
                      <td style={{textAlign:'right'}}>{fmtE(i.value_sub_computed,2)}</td>
                      <td style={{textAlign:'right'}}>{i.pct_complete_gmc != null ? `${Number(i.pct_complete_gmc).toFixed(1)}%` : '—'}</td>
                      <td style={{textAlign:'right'}}>{fmtE(i.value_gmc_computed,2)}</td>
                      <td style={{textAlign:'right', color: itemCut > 0.005 ? '#dc2626' : '#9ca3af'}}>
                        {itemCut > 0.005 ? `− ${fmtE(itemCut,2)}` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
            {a.compensation_events.length > 0 && (
              <div style={{ marginBottom:16 }}>
                {a.compensation_events.map(ce => {
                  const isContra = ce.type === 'contra_charge';
                  const kind = ce.type === 'daywork' ? 'Daywork' : isContra ? 'Contra Charge' : 'Variation';
                  return (
                    <div key={ce.id} style={{ display:'flex', justifyContent:'space-between', fontSize:12, padding:'2px 0',
                      color: isContra ? '#dc2626' : '#7c3aed' }}>
                      <span>↳ {kind}: {ce.description}</span>
                      <span style={{ fontWeight:600 }}>{isContra ? '− ' : ''}{fmtE(ce.gmc_value,2)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
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
