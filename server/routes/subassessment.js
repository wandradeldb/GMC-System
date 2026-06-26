const express = require('express');
const multer  = require('multer');
const XLSX    = require('xlsx');
const path    = require('path');
const { DatabaseSync } = require('node:sqlite');

const router  = express.Router();
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

function serialToISO(v) {
  if (!v || isNaN(Number(v))) return null;
  const d = XLSX.SSF.parse_date_code(Number(v));
  if (!d) return null;
  return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
}
function cellV(sh,r,c){ const x=sh[XLSX.utils.encode_cell({r,c})]; return x?x.v:null; }
function numV(sh,r,c){ const v=cellV(sh,r,c); return typeof v==='number'?v:null; }
function strV(sh,r,c){ const v=cellV(sh,r,c); return v!=null?String(v).trim():''; }
const DB_PATH = path.join(__dirname, '../../db/gmc.db');

function db() {
  const con = new DatabaseSync(DB_PATH, { open: true });
  con.exec('PRAGMA foreign_keys = ON');
  return con;
}

// ── GET /projects/:pid/subcontracts/:scid/boq ────────────────────────────────
// Lista itens BOQ do sub com o último % certificado
router.get('/projects/:pid/subcontracts/:scid/boq', (req, res) => {
  const con = db();
  const items = con.prepare(`
    SELECT sbi.*,
      ROUND(sbi.qty * sbi.rate, 2) AS contract_value
    FROM sub_boq_item sbi
    WHERE sbi.subcontract_id = ?
    ORDER BY sbi.sort_order
  `).all(req.params.scid);

  // % e valor certificado por item = SUM de todos os deltas de apps aprovadas
  const certData = con.prepare(`
    SELECT sai.sub_boq_item_id,
      ROUND(SUM(sai.pct_complete_gmc), 4) AS pct_cum,
      ROUND(SUM(sai.value_gmc_computed), 2) AS val_cum
    FROM sub_application_item sai
    JOIN sub_application sa ON sa.id = sai.sub_application_id
    WHERE sa.subcontract_id = ? AND sa.status != 'draft'
    GROUP BY sai.sub_boq_item_id
  `).all(req.params.scid);
  const certMap = {};
  certData.forEach(r => { certMap[r.sub_boq_item_id] = r; });

  con.close();
  res.json(items.map(i => {
    const c = certMap[i.id];
    const pctCum = c ? c.pct_cum : 0;
    const valCum = c ? c.val_cum : 0;
    return {
      ...i,
      pct_certified: pctCum,
      value_certified: valCum,
      value_remaining: Math.round((i.contract_value - valCum) * 100) / 100,
    };
  }));
});

// ── GET /projects/:pid/subcontracts/:scid/applications ───────────────────────
router.get('/projects/:pid/subcontracts/:scid/applications', (req, res) => {
  const con = db();
  const apps = con.prepare(`
    SELECT sa.*,
      sc.ref, s.name AS sub_name,
      COUNT(sai.id) AS item_count
    FROM sub_application sa
    JOIN subcontract sc ON sc.id = sa.subcontract_id
    JOIN subcontractor s ON s.id = sc.subcontractor_id
    LEFT JOIN sub_application_item sai ON sai.sub_application_id = sa.id
    WHERE sa.subcontract_id = ?
    GROUP BY sa.id
    ORDER BY sa.application_number DESC
  `).all(req.params.scid);
  con.close();
  res.json(apps);
});

// ── GET /projects/:pid/subcontracts/:scid/applications/:appid ───────────────
router.get('/projects/:pid/subcontracts/:scid/applications/:appid', (req, res) => {
  const con = db();
  const app = con.prepare('SELECT * FROM sub_application WHERE id=? AND subcontract_id=?')
    .get(req.params.appid, req.params.scid);
  if (!app) { con.close(); return res.status(404).json({ error: 'Not found' }); }

  const items = con.prepare(`
    SELECT sai.*, sbi.item_ref, sbi.description, sbi.unit, sbi.qty, sbi.rate, sbi.section,
      ROUND(sbi.qty * sbi.rate, 2) AS contract_value
    FROM sub_application_item sai
    JOIN sub_boq_item sbi ON sbi.id = sai.sub_boq_item_id
    WHERE sai.sub_application_id = ?
    ORDER BY sbi.sort_order
  `).all(req.params.appid);

  con.close();
  res.json({ app, items });
});

// ── POST /projects/:pid/subcontracts/:scid/applications ─────────────────────
// Criar nova aplicação de assessment
// Body: { period, notes, items: [{sub_boq_item_id, pct_complete_sub, pct_complete_gmc, notes}] }
router.post('/projects/:pid/subcontracts/:scid/applications', (req, res) => {
  const con = db();
  const { period, notes, status, items = [] } = req.body;

  // Próximo número de aplicação
  const last = con.prepare('SELECT MAX(application_number) AS n FROM sub_application WHERE subcontract_id=?').get(req.params.scid);
  const appNum = (last.n || 0) + 1;

  // BOQ items com contract_value e % anterior
  const boqItems = con.prepare(`
    SELECT sbi.id, ROUND(sbi.qty * sbi.rate, 2) AS contract_value
    FROM sub_boq_item sbi WHERE sbi.subcontract_id=?
  `).all(req.params.scid);
  const boqMap = {};
  boqItems.forEach(b => { boqMap[b.id] = b.contract_value; });

  // % anterior certificada por item (última aplicação aprovada)
  const prevApps = con.prepare(`
    SELECT sai.sub_boq_item_id, sai.pct_complete_gmc
    FROM sub_application_item sai
    JOIN sub_application sa ON sa.id = sai.sub_application_id
    WHERE sa.subcontract_id=? AND sa.status != 'draft'
    ORDER BY sa.application_number DESC
  `).all(req.params.scid);
  const prevPct = {};
  prevApps.forEach(r => { if (!(r.sub_boq_item_id in prevPct)) prevPct[r.sub_boq_item_id] = r.pct_complete_gmc; });

  // Calcular totais
  let valueSub = 0, valueGmc = 0;
  const enrichedItems = items.map(it => {
    const cv = boqMap[it.sub_boq_item_id] || 0;
    const prev = prevPct[it.sub_boq_item_id] || 0;
    const pctSub = Number(it.pct_complete_sub) || 0;
    const pctGmc = Number(it.pct_complete_gmc) || 0;
    const vSub = Math.round((pctSub - prev) / 100 * cv * 100) / 100;
    const vGmc = Math.round((pctGmc - prev) / 100 * cv * 100) / 100;
    valueSub += vSub;
    valueGmc += vGmc;
    return { ...it, pct_prev: prev, value_sub: vSub, value_gmc: vGmc };
  });

  // Cumulativos anteriores
  const prevCum = con.prepare(`
    SELECT COALESCE(SUM(value_gmc),0) AS cum_gmc, COALESCE(SUM(value_sub),0) AS cum_sub
    FROM sub_application WHERE subcontract_id=? AND status != 'draft'
  `).get(req.params.scid);

  con.exec('BEGIN');
  try {
    const appId = con.prepare(`
      INSERT INTO sub_application
        (subcontract_id, application_number, period, value_sub, value_gmc,
         cumulative_sub, cumulative_gmc, net_payable, status, notes, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))
    `).run(
      req.params.scid, appNum, period || new Date().toISOString().slice(0,7),
      Math.round(valueSub*100)/100, Math.round(valueGmc*100)/100,
      Math.round((prevCum.cum_sub + valueSub)*100)/100,
      Math.round((prevCum.cum_gmc + valueGmc)*100)/100,
      Math.round(valueGmc*100)/100,
      status || 'planned', notes || null
    ).lastInsertRowid;

    const stmt = con.prepare(`
      INSERT INTO sub_application_item
        (sub_application_id, sub_boq_item_id, pct_prev, pct_complete_sub, pct_complete_gmc,
         qty_complete_sub, qty_complete_gmc, value_sub_computed, value_gmc_computed, notes)
      VALUES (?,?,?,?,?,0,0,?,?,?)
    `);
    for (const it of enrichedItems) {
      stmt.run(appId, it.sub_boq_item_id, it.pct_prev,
        it.pct_complete_sub, it.pct_complete_gmc,
        it.value_sub, it.value_gmc, it.notes || null);
    }

    con.exec('COMMIT');
    con.close();
    res.json({ ok: true, application_id: Number(appId), application_number: appNum,
      value_gmc: Math.round(valueGmc*100)/100 });
  } catch (e) {
    con.exec('ROLLBACK');
    con.close();
    throw e;
  }
});

// ── PUT /projects/:pid/subcontracts/:scid/applications/:appid/status ─────────
router.put('/projects/:pid/subcontracts/:scid/applications/:appid/status', (req, res) => {
  const con = db();
  const { status } = req.body;
  if (!['draft','submitted','approved','paid'].includes(status)) {
    con.close(); return res.status(400).json({ error: 'Status inválido' });
  }
  con.prepare(`UPDATE sub_application SET status=?, updated_at=datetime('now') WHERE id=? AND subcontract_id=?`)
    .run(status, req.params.appid, req.params.scid);
  con.close();
  res.json({ ok: true });
});

// ── POST /projects/:pid/subcontracts/:scid/applications/import-excel ─────────
// Importa Apps históricos do Excel v2 (por sheet name) para sub_application + sub_application_item
// Body (multipart): file=<xlsx>, sheet_name=<str>
// Cada App com algum valor GMC não-zero é criado; duplicados (por application_number) são ignorados
router.post('/projects/:pid/subcontracts/:scid/applications/import-excel',
  upload.single('file'),
  (req, res) => {
    const con = db();
    const { sheet_name } = req.body;
    if (!req.file || !sheet_name) {
      con.close();
      return res.status(400).json({ error: 'file e sheet_name são obrigatórios' });
    }

    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sh = wb.Sheets[sheet_name];
    if (!sh) {
      con.close();
      return res.status(400).json({ error: `Aba "${sheet_name}" não encontrada no ficheiro` });
    }

    // Detectar Apps: col inicial 19, step 5
    const FIRST_COL = 19; const STEP = 5;
    const apps = [];
    for (let c = FIRST_COL; c <= 60; c += STEP) {
      const label = strV(sh, 1, c);
      const dateSerial = numV(sh, 2, c + 3);
      if (!label && !dateSerial) break;
      const we = serialToISO(dateSerial);
      apps.push({ appNum: apps.length + 1, startCol: c, label, week_ending: we });
    }

    // BOQ items do sub (indexados por item_ref)
    const boqItems = con.prepare(`
      SELECT id, item_ref, ROUND(qty*rate,2) AS contract_value
      FROM sub_boq_item WHERE subcontract_id=?
    `).all(req.params.scid);
    const boqByRef = {};
    boqItems.forEach(b => { boqByRef[b.item_ref] = b; });

    // Próximo número de aplicação sequencial no DB (ignora colunas sem dados)
    const lastApp = con.prepare(
      'SELECT MAX(application_number) AS n FROM sub_application WHERE subcontract_id=?'
    ).get(req.params.scid);
    let nextAppNum = (lastApp.n || 0) + 1;

    // Labels já importados (para evitar duplicados por label/week_ending)
    const existingLabels = new Set(
      con.prepare('SELECT notes FROM sub_application WHERE subcontract_id=?')
        .all(req.params.scid).map(r => r.notes || '')
    );

    const results = [];

    con.exec('BEGIN');
    try {
      for (const app of apps) {
        // Verificar se já foi importado (pelo label no notes)
        const importLabel = `Importado do Excel — ${app.label || ''}${app.week_ending ? ' WE '+app.week_ending : ''}`;
        if ([...existingLabels].some(n => n.includes(app.week_ending || app.label || ''))) {
          results.push({ appNum: app.appNum, skipped: true, reason: 'já existe' });
          continue;
        }

        // Ler items desta App
        const items = [];
        let valueSub = 0, valueGmc = 0;
        for (let r = 6; r <= 120; r++) {
          const ref = strV(sh, r, 2);
          if (!ref) continue;
          const pctFolan = numV(sh, r, app.startCol);
          const valFolan = numV(sh, r, app.startCol + 1);
          const pctGmc   = numV(sh, r, app.startCol + 2);
          const valGmc   = numV(sh, r, app.startCol + 3);

          const boq = boqByRef[ref];
          if (!boq) continue;
          if (!pctGmc && !valGmc) continue;

          const pctSubPct  = pctFolan != null ? Math.round(pctFolan * 100 * 100) / 100 : 0;
          const pctGmcPct  = pctGmc   != null ? Math.round(pctGmc   * 100 * 100) / 100 : 0;

          const vSub = valFolan != null ? Math.round(valFolan * 100) / 100 : 0;
          const vGmc = valGmc   != null ? Math.round(valGmc   * 100) / 100 : 0;
          valueSub += vSub;
          valueGmc += vGmc;

          // pct_prev = soma acumulada de apps anteriores já no DB
          const prevData = con.prepare(`
            SELECT COALESCE(SUM(sai.pct_complete_gmc),0) AS pct_prev
            FROM sub_application_item sai
            JOIN sub_application sa ON sa.id = sai.sub_application_id
            WHERE sai.sub_boq_item_id=? AND sa.subcontract_id=?
          `).get(boq.id, req.params.scid);
          const pctPrev = Math.round((prevData.pct_prev || 0) * 100) / 100;

          items.push({ boq_id: boq.id, pctSub: pctSubPct, pctGmc: pctGmcPct, pctPrev, vSub, vGmc });
        }

        if (valueGmc === 0 && items.length === 0) {
          results.push({ appNum: app.appNum, skipped: true, reason: 'sem dados' });
          continue;
        }

        // Número sequencial real (ignora apps do Excel sem dados)
        const dbAppNum = nextAppNum;

        // Cumulativos de apps anteriores já importadas neste mesmo ciclo
        const prevCum = con.prepare(`
          SELECT COALESCE(SUM(value_gmc),0) AS cg, COALESCE(SUM(value_sub),0) AS cs
          FROM sub_application WHERE subcontract_id=? AND status != 'draft'
        `).get(req.params.scid);

        const period = app.week_ending ? app.week_ending.slice(0,7) : null;
        const label  = app.label || `App ${app.appNum}`;

        const appId = con.prepare(`
          INSERT INTO sub_application
            (subcontract_id, application_number, period, value_sub, value_gmc,
             cumulative_sub, cumulative_gmc, net_payable, status, notes, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))
        `).run(
          req.params.scid, dbAppNum, period,
          Math.round(valueSub*100)/100, Math.round(valueGmc*100)/100,
          Math.round((prevCum.cs + valueSub)*100)/100,
          Math.round((prevCum.cg + valueGmc)*100)/100,
          Math.round(valueGmc*100)/100,
          'approved',
          `Importado do Excel — ${label}${app.week_ending ? ' WE '+app.week_ending : ''}`
        ).lastInsertRowid;

        const stmt = con.prepare(`
          INSERT INTO sub_application_item
            (sub_application_id, sub_boq_item_id, pct_prev, pct_complete_sub, pct_complete_gmc,
             qty_complete_sub, qty_complete_gmc, value_sub_computed, value_gmc_computed, notes)
          VALUES (?,?,?,?,?,0,0,?,?,NULL)
        `);
        for (const it of items) {
          stmt.run(appId, it.boq_id, it.pctPrev || 0, it.pctSub, it.pctGmc, it.vSub, it.vGmc);
        }

        nextAppNum++;
        results.push({ appNum: dbAppNum, created: true, value_gmc: Math.round(valueGmc*100)/100, items: items.length });
      }

      con.exec('COMMIT');
      con.close();
      res.json({ ok: true, results });
    } catch (e) {
      con.exec('ROLLBACK');
      con.close();
      throw e;
    }
  }
);

// ── DELETE /projects/:pid/subcontracts/:scid/applications/:appid ─────────────
router.delete('/projects/:pid/subcontracts/:scid/applications/:appid', (req, res) => {
  const con = db();
  con.exec('BEGIN');
  try {
    con.prepare('DELETE FROM sub_application_item WHERE sub_application_id=?').run(req.params.appid);
    const r = con.prepare('DELETE FROM sub_application WHERE id=? AND subcontract_id=?')
      .run(req.params.appid, req.params.scid);
    con.exec('COMMIT');
    con.close();
    if (r.changes === 0) return res.status(404).json({ error: 'Application não encontrada' });
    res.json({ ok: true });
  } catch (e) {
    con.exec('ROLLBACK');
    con.close();
    throw e;
  }
});

router.use((err, _req, res, _next) => {
  console.error('SubAssessment error:', err);
  res.status(500).json({ error: err.message });
});

module.exports = router;
