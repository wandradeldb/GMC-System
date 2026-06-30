const express   = require('express');
const PDFDocument = require('pdfkit');
const { buildTrackerReport, db } = require('./tracker');

const router = express.Router();

const eur = (n) => `€${new Intl.NumberFormat('en-IE', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n || 0)}`;
const pct = (n) => `${Number(n || 0).toFixed(1)}%`;
const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric' });
};

// ── GET /projects/:pid/reports/period-pdf?from=YYYY-MM-DD&to=YYYY-MM-DD ────
router.get('/projects/:pid/reports/period-pdf', (req, res) => {
  const { pid } = req.params;
  const { from, to } = req.query;
  const con = db();

  const project = con.prepare('SELECT * FROM project WHERE id=?').get(pid);
  const { rows, sub_lines, subs } = buildTrackerReport(con, pid);
  con.close();

  const weeks = rows.filter(r =>
    (!from || r.week_ending >= from) && (!to || r.week_ending <= to));

  if (weeks.length === 0) {
    return res.status(404).json({ error: 'No tracker data in the selected period', code: 'NO_DATA' });
  }

  const revTotal    = weeks.reduce((s, r) => s + (r.rev_total_week    || 0), 0);
  const costTotal   = weeks.reduce((s, r) => s + (r.cost_total_week   || 0), 0);
  const marginTotal = revTotal - costTotal;
  const marginPct   = revTotal > 0 ? (marginTotal / revTotal) * 100 : 0;

  const costBreakdown = {
    subs:      weeks.reduce((s, r) => s + (r.cost_subs      || 0), 0),
    materials: weeks.reduce((s, r) => s + (r.cost_materials || 0), 0),
    plant:     weeks.reduce((s, r) => s + (r.cost_plant     || 0), 0),
    ohp:       weeks.reduce((s, r) => s + (r.ohp_allowance  || 0), 0),
  };
  const revBreakdown = {
    prelims_fixed: weeks.reduce((s, r) => s + (r.rev_prelims_fixed || 0), 0),
    prelims_time:  weeks.reduce((s, r) => s + (r.rev_prelims_time  || 0), 0),
    ae:            weeks.reduce((s, r) => s + (r.rev_ae            || 0), 0),
    civil:         weeks.reduce((s, r) => s + (r.rev_civil         || 0), 0),
    meica:         weeks.reduce((s, r) => s + (r.rev_meica         || 0), 0),
    landscape:     weeks.reduce((s, r) => s + (r.rev_landscape     || 0), 0),
    commissioning: weeks.reduce((s, r) => s + (r.rev_commissioning || 0), 0),
  };

  // Per-sub totals within the period
  const subTotals = {};
  subs.forEach(sc => { subTotals[sc.sub_name] = { ref: sc.ref, cost_payment: 0, cost_material: 0, revenue_generated: 0 }; });
  weeks.forEach(r => {
    (sub_lines[r.week_ending] || []).forEach(s => {
      if (!subTotals[s.sub_name]) return;
      subTotals[s.sub_name].cost_payment      += s.cost_payment      || 0;
      subTotals[s.sub_name].cost_material     += s.cost_material     || 0;
      subTotals[s.sub_name].revenue_generated += s.revenue_generated || 0;
    });
  });

  const latest = weeks[weeks.length - 1];

  const filename = `GMC-Report-${project.ref.replace(/[^\w-]/g, '_')}-${weeks[0].week_ending}_${latest.week_ending}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  doc.pipe(res);

  // ── Header ──────────────────────────────────────────────────────────────
  doc.fontSize(18).fillColor('#1a1a2e').text('GMC System — Period Report', { continued: false });
  doc.fontSize(11).fillColor('#374151')
    .text(`${project.name} · ${project.ref} · ${project.client}`)
    .text(`Period: ${fmtDate(weeks[0].week_ending)} → ${fmtDate(latest.week_ending)}  (${weeks.length} week${weeks.length > 1 ? 's' : ''})`);
  doc.moveDown(1);

  // ── Executive summary cards ────────────────────────────────────────────
  doc.fontSize(13).fillColor('#1a1a2e').text('Executive Summary', { underline: true });
  doc.moveDown(0.3);
  const summaryLines = [
    ['Revenue (period)', eur(revTotal)],
    ['Cost (period)',    eur(costTotal)],
    ['Margin (period)',  `${eur(marginTotal)}  (${pct(marginPct)})`],
    ['EFA Margin % (latest WE)', `${pct(latest.efa_margin_pct)}  vs target ${pct(latest.target_margin_pct)}`],
  ];
  doc.fontSize(10).fillColor('#111827');
  summaryLines.forEach(([label, val]) => doc.text(`${label}:  ${val}`));
  doc.moveDown(1);

  // ── Weekly table ────────────────────────────────────────────────────────
  doc.fontSize(13).fillColor('#1a1a2e').text('Weekly Breakdown', { underline: true });
  doc.moveDown(0.3);
  const colX = [40, 140, 240, 330, 420];
  const headerY = doc.y;
  doc.fontSize(9);
  doc.fillColor('#1e40af');
  doc.rect(40, headerY, 515, 16).fill();
  doc.fillColor('#ffffff')
    .text('WE',       colX[0] + 2, headerY + 4)
    .text('Revenue',  colX[1] + 2, headerY + 4)
    .text('Cost',     colX[2] + 2, headerY + 4)
    .text('Margin',   colX[3] + 2, headerY + 4)
    .text('Margin %', colX[4] + 2, headerY + 4);
  let y = headerY + 16;
  doc.fontSize(9);
  weeks.forEach((r, i) => {
    if (y > 760) { doc.addPage(); y = 40; }
    const bg = i % 2 === 0 ? '#f8faff' : '#ffffff';
    doc.fillColor(bg);
    doc.rect(40, y, 515, 14).fill();
    doc.fillColor('#111827')
      .text(fmtDate(r.week_ending),            colX[0] + 2, y + 3)
      .text(eur(r.rev_total_week),             colX[1] + 2, y + 3)
      .text(eur(r.cost_total_week),            colX[2] + 2, y + 3)
      .text(eur(r.margin_week),                colX[3] + 2, y + 3)
      .text(pct(r.margin_pct),                 colX[4] + 2, y + 3);
    y += 14;
  });
  doc.y = y + 10;

  // ── Cost breakdown ──────────────────────────────────────────────────────
  if (doc.y > 680) doc.addPage();
  doc.fontSize(13).fillColor('#1a1a2e').text('Cost Breakdown (period)', { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor('#111827');
  Object.entries(costBreakdown).forEach(([k, v]) => {
    const label = { subs: 'Subcontractors', materials: 'Materials', plant: 'Plant', ohp: 'OH&P Allowance' }[k];
    const sharePct = costTotal > 0 ? (v / costTotal) * 100 : 0;
    doc.text(`${label}:  ${eur(v)}  (${pct(sharePct)})`);
  });
  doc.moveDown(1);

  // ── Revenue breakdown ───────────────────────────────────────────────────
  if (doc.y > 650) doc.addPage();
  doc.fontSize(13).fillColor('#1a1a2e').text('Revenue Breakdown (period)', { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor('#111827');
  const revLabels = { prelims_fixed: 'Prelims — Fixed', prelims_time: 'Prelims — Time', ae: 'A&E / Design', civil: 'Civil', meica: 'MEICA', landscape: 'Landscape', commissioning: 'Commissioning' };
  Object.entries(revBreakdown).forEach(([k, v]) => {
    if (v === 0) return;
    const sharePct = revTotal > 0 ? (v / revTotal) * 100 : 0;
    doc.text(`${revLabels[k]}:  ${eur(v)}  (${pct(sharePct)})`);
  });
  doc.moveDown(1);

  // ── Per-subcontractor breakdown ─────────────────────────────────────────
  const activeSubsList = Object.entries(subTotals).filter(([, t]) => t.cost_payment || t.cost_material || t.revenue_generated);
  if (activeSubsList.length > 0) {
    if (doc.y > 600) doc.addPage();
    doc.fontSize(13).fillColor('#1a1a2e').text('Subcontractor Breakdown (period)', { underline: true });
    doc.moveDown(0.3);
    const sColX = [40, 220, 320, 420];
    const sHeaderY = doc.y;
    doc.fillColor('#b45309');
    doc.rect(40, sHeaderY, 515, 16).fill();
    doc.fontSize(9).fillColor('#ffffff')
      .text('Subcontractor', sColX[0] + 2, sHeaderY + 4)
      .text('Cost Payment',  sColX[1] + 2, sHeaderY + 4)
      .text('Material',      sColX[2] + 2, sHeaderY + 4)
      .text('Revenue Gen.',  sColX[3] + 2, sHeaderY + 4);
    let sy = sHeaderY + 16;
    activeSubsList.forEach(([name, t], i) => {
      if (sy > 760) { doc.addPage(); sy = 40; }
      const bg = i % 2 === 0 ? '#fffbeb' : '#ffffff';
      doc.fillColor(bg);
      doc.rect(40, sy, 515, 14).fill();
      doc.fontSize(9).fillColor('#111827')
        .text(`${t.ref} — ${name}`.slice(0, 38), sColX[0] + 2, sy + 3)
        .text(eur(t.cost_payment),  sColX[1] + 2, sy + 3)
        .text(eur(t.cost_material), sColX[2] + 2, sy + 3)
        .text(eur(t.revenue_generated), sColX[3] + 2, sy + 3);
      sy += 14;
    });
    doc.y = sy + 10;
  }

  // ── EFA vs Actual ───────────────────────────────────────────────────────
  if (doc.y > 680) doc.addPage();
  doc.fontSize(13).fillColor('#1a1a2e').text('EFA vs Actual (latest week in period)', { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor('#111827');
  doc.text(`EFA Revenue:  ${eur(latest.efa_revenue)}`);
  doc.text(`EFA Cost:  ${eur(latest.efa_cost)}`);
  doc.text(`EFA Margin:  ${eur(latest.efa_margin)}  (${pct(latest.efa_margin_pct)})`);
  doc.text(`Target Margin %:  ${pct(latest.target_margin_pct)}`);
  doc.fillColor(latest.efa_margin_pct >= latest.target_margin_pct ? '#166534' : '#dc2626')
    .text(latest.efa_margin_pct >= latest.target_margin_pct ? 'On target' : 'Below target — variance risk');

  doc.end();
});

module.exports = router;
