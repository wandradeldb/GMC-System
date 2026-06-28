const express = require('express');
const multer  = require('multer');
const XLSX    = require('xlsx');
const path    = require('path');
const { DatabaseSync } = require('node:sqlite');

const router  = express.Router();
const DB_PATH = require('../db-path');
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

function db() {
  const con = new DatabaseSync(DB_PATH, { open: true });
  con.exec('PRAGMA foreign_keys = ON');
  return con;
}

function serialToISO(v) {
  if (!v || isNaN(Number(v))) return null;
  const d = XLSX.SSF.parse_date_code(Number(v));
  if (!d) return null;
  return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
}

function cellVal(sh, r, c) {
  const cell = sh[XLSX.utils.encode_cell({ r, c })];
  return cell ? cell.v : null;
}
function cellStr(sh, r, c) {
  const v = cellVal(sh, r, c);
  return v != null ? String(v).trim() : '';
}
function cellNum(sh, r, c) {
  const v = cellVal(sh, r, c);
  return v != null && !isNaN(Number(v)) ? Number(v) : null;
}

// â”€â”€ Parser: Folan Civil / Right Group (application-based) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Detecta blocos "App N" nas rows de header; extrai GMC Assessment total por app
function parseApplicationBased(sh, sheetName) {
  const range = XLSX.utils.decode_range(sh['!ref'] || 'A1:A1');
  const results = [];

  // Encontrar a linha de header (contÃ©m "App" e "Assessment" ou "GMC Assessment")
  let hdRow = -1;
  for (let r = 0; r <= Math.min(8, range.e.r); r++) {
    let hasApp = false, hasAssessment = false;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const s = cellStr(sh, r, c).toLowerCase();
      if (s.includes('app ') || s === 'app1' || s === 'app2') hasApp = true;
      if (s.includes('assessment') || s.includes('gmc assessment')) hasAssessment = true;
    }
    if (hasApp && hasAssessment) { hdRow = r; break; }
    if (hasApp) { hdRow = r; }  // fallback: sÃ³ app
  }
  if (hdRow < 0) return results;

  // Linha de datas WE (procurar linha antes do hdRow com seriais de data)
  let dateRow = -1;
  for (let r = Math.max(0, hdRow - 2); r < hdRow; r++) {
    let dateCount = 0;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const v = cellNum(sh, r, c);
      if (v && v > 40000 && v < 60000) dateCount++;
    }
    if (dateCount > 0) { dateRow = r; break; }
  }

  // Mapear blocos: para cada col onde header contÃ©m "App N"
  const appBlocks = []; // { col, appLabel, assessCol, weekEnding }
  for (let c = range.s.c; c <= range.e.c; c++) {
    const hdr = cellStr(sh, hdRow, c);
    if (/^app\s*\d+/i.test(hdr)) {
      const appLabel = hdr.replace(/\s+/g, ' ').replace(/\n/g, ' ').trim();
      // Procurar "Assessment" ou "GMC Assessment" nas colunas seguintes (max +5)
      let assessCol = -1;
      for (let cc = c + 1; cc <= Math.min(c + 5, range.e.c); cc++) {
        const h = cellStr(sh, hdRow, cc).toLowerCase();
        if (h.includes('assessment')) { assessCol = cc; break; }
      }
      if (assessCol < 0) assessCol = c + 2; // fallback

      // WE date: procurar na linha de datas na col do App ou na col Assessment
      let weISO = null;
      if (dateRow >= 0) {
        const dApp   = cellNum(sh, dateRow, c);
        const dAssess = cellNum(sh, dateRow, assessCol);
        weISO = serialToISO(dAssess) || serialToISO(dApp);
      }
      appBlocks.push({ col: c, appLabel, assessCol, weekEnding: weISO });
    }
  }

  // Para cada bloco, somar valores numÃ©ricos na coluna Assessment
  for (const blk of appBlocks) {
    let gmcTotal = 0, subTotal = 0;
    for (let r = hdRow + 1; r <= range.e.r; r++) {
      const v = cellNum(sh, r, blk.assessCol);
      if (v) gmcTotal += v;
      const sv = cellNum(sh, r, blk.col);
      if (sv) subTotal += sv;
    }
    if (gmcTotal !== 0 || subTotal !== 0) {
      results.push({
        sub_name:       sheetName,
        app_label:      blk.appLabel,
        week_ending:    blk.weekEnding,
        gmc_assessment: Math.round(gmcTotal * 100) / 100,
        sub_claimed:    Math.round(subTotal * 100) / 100,
      });
    }
  }
  return results;
}

// â”€â”€ Parser: RPS / CarlowT (colunas semanais Qty+Amount) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function parseWeeklyQtyAmount(sh, sheetName) {
  const range = XLSX.utils.decode_range(sh['!ref'] || 'A1:A1');
  const results = [];

  // Encontrar linha de datas (seriais) e linha "Amount"
  let dateRow = -1, hdRow = -1;
  for (let r = 0; r <= Math.min(5, range.e.r); r++) {
    let dateCount = 0, amountCount = 0;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const v  = cellNum(sh, r, c);
      const s  = cellStr(sh, r, c).toLowerCase();
      if (v && v > 40000 && v < 60000) dateCount++;
      if (s === 'amount') amountCount++;
    }
    if (dateCount > 1) dateRow = r;
    if (amountCount > 1) hdRow = r;
  }
  if (dateRow < 0 || hdRow < 0) return results;

  // Mapear colunas: pares (Qty, Amount) por WE
  const weeks = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const d = cellNum(sh, dateRow, c);
    const h = cellStr(sh, hdRow, c).toLowerCase();
    if (d && d > 40000 && d < 60000 && h === 'amount') {
      weeks.push({ amountCol: c, weekEnding: serialToISO(d) });
    }
  }

  for (const wk of weeks) {
    let total = 0;
    for (let r = hdRow + 1; r <= range.e.r; r++) {
      const v = cellNum(sh, r, wk.amountCol);
      if (v) total += v;
    }
    if (total !== 0) {
      results.push({
        sub_name:       sheetName,
        app_label:      `WE_${wk.weekEnding}`,
        week_ending:    wk.weekEnding,
        gmc_assessment: Math.round(total * 100) / 100,
        sub_claimed:    Math.round(total * 100) / 100,
      });
    }
  }
  return results;
}

// â”€â”€ Parser: Misc Subcons (semanal, agrupado por "Subbie") â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function parseMiscSubcons(sh) {
  const range = XLSX.utils.decode_range(sh['!ref'] || 'A1:A1');
  const results = [];

  // Linha de datas e linha "Amount"
  let dateRow = -1, hdRow = -1;
  for (let r = 0; r <= Math.min(5, range.e.r); r++) {
    let dateCount = 0, amountCount = 0;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const v = cellNum(sh, r, c);
      const s = cellStr(sh, r, c).toLowerCase();
      if (v && v > 40000 && v < 60000) dateCount++;
      if (s === 'amount') amountCount++;
    }
    if (dateCount > 1) dateRow = r;
    if (amountCount > 1) hdRow = r;
  }
  if (dateRow < 0 || hdRow < 0) return results;

  // Mapear colunas Amount por WE
  const weeks = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const d = cellNum(sh, dateRow, c);
    const h = cellStr(sh, hdRow, c).toLowerCase();
    if (d && d > 40000 && d < 60000 && h === 'amount') {
      weeks.push({ amountCol: c, weekEnding: serialToISO(d) });
    }
  }

  // Col A (ou col 0): nome do subbie (em linhas com "Subbie" na col anterior)
  let currentSubbie = null;
  const totals = {}; // subbie+we â†’ total

  for (let r = hdRow + 1; r <= range.e.r; r++) {
    // Verificar se esta linha Ã© um header de subbie (col 0 ou 1 tem texto nÃ£o-numÃ©rico)
    const colA = cellStr(sh, r, range.s.c);
    const colB = cellStr(sh, r, range.s.c + 1);
    const label = colA || colB;

    if (label && !/^\d/.test(label) && !label.toLowerCase().includes('total')) {
      // Ã‰ um nome de subbie ou item
      // Se a linha seguinte tem valores, este Ã© o nome do item
      currentSubbie = label;
    }

    for (const wk of weeks) {
      const v = cellNum(sh, r, wk.amountCol);
      if (v && currentSubbie) {
        const key = `${currentSubbie}__${wk.weekEnding}`;
        totals[key] = (totals[key] || 0) + v;
      }
    }
  }

  for (const [key, total] of Object.entries(totals)) {
    const [subName, weekEnding] = key.split('__');
    results.push({
      sub_name:       `Misc â€” ${subName}`,
      app_label:      `WE_${weekEnding}`,
      week_ending:    weekEnding,
      gmc_assessment: Math.round(total * 100) / 100,
      sub_claimed:    Math.round(total * 100) / 100,
    });
  }
  return results;
}

// â”€â”€ Detectar formato e fazer parse de uma aba â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function parseSheet(sh, sheetName) {
  if (sheetName === 'Misc Subcons') return parseMiscSubcons(sh);

  // Detectar se Ã© application-based ou weekly
  const range = XLSX.utils.decode_range(sh['!ref'] || 'A1:A1');
  for (let r = 0; r <= Math.min(6, range.e.r); r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      if (/^app\s*\d+/i.test(cellStr(sh, r, c))) {
        return parseApplicationBased(sh, sheetName);
      }
    }
  }
  return parseWeeklyQtyAmount(sh, sheetName);
}

// â”€â”€ Abas a ignorar (nÃ£o sÃ£o de sub) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const IGNORE_SHEETS = new Set([
  'project summary','revenue summary','subcons summary','tracker',
  'revenue generator','qs costs','summary pl-mat','ae revenue',
  'agent codes','gangs','costs civil subbie',
]);

// â”€â”€ POST /projects/:pid/assessment/import â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/projects/:pid/assessment/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Sem ficheiro', code: 'NO_FILE' });

  const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
  const sourceFile = req.file.originalname;
  const projectId  = req.params.pid;

  const allRows = [];
  const sheetsSummary = [];

  for (const name of wb.SheetNames) {
    if (IGNORE_SHEETS.has(name.toLowerCase())) continue;
    const sh = wb.Sheets[name];
    if (!sh || !sh['!ref']) continue;

    const parsed = parseSheet(sh, name);
    if (parsed.length > 0) {
      allRows.push(...parsed);
      sheetsSummary.push({ sheet: name, records: parsed.length });
    }
  }

  if (allRows.length === 0) {
    return res.status(400).json({ error: 'Nenhum dado de assessment encontrado', code: 'NO_DATA' });
  }

  const con = db();
  con.exec('BEGIN');
  try {
    // Limpar dados anteriores do mesmo ficheiro
    con.prepare('DELETE FROM sub_assessment WHERE project_id=? AND source_file=?').run(projectId, sourceFile);

    const stmt = con.prepare(`
      INSERT INTO sub_assessment
        (project_id, sub_name, app_label, week_ending, gmc_assessment, sub_claimed, source_file)
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(project_id, sub_name, app_label) DO UPDATE SET
        week_ending=excluded.week_ending,
        gmc_assessment=excluded.gmc_assessment,
        sub_claimed=excluded.sub_claimed,
        source_file=excluded.source_file,
        imported_at=datetime('now')
    `);

    for (const r of allRows) {
      stmt.run(projectId, r.sub_name, r.app_label, r.week_ending, r.gmc_assessment, r.sub_claimed, sourceFile);
    }

    con.exec('COMMIT');
    con.close();
    res.json({ ok: true, imported: allRows.length, sheets: sheetsSummary, source_file: sourceFile });
  } catch (e) {
    con.exec('ROLLBACK');
    con.close();
    throw e;
  }
});

// â”€â”€ GET /projects/:pid/assessment â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/projects/:pid/assessment', (req, res) => {
  const con = db();
  const rows = con.prepare(`
    SELECT sub_name, app_label, week_ending, gmc_assessment, sub_claimed
    FROM sub_assessment WHERE project_id=?
    ORDER BY sub_name, week_ending
  `).all(req.params.pid);
  con.close();
  res.json(rows);
});

// â”€â”€ GET /projects/:pid/assessment/summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/projects/:pid/assessment/summary', (req, res) => {
  const con = db();
  const rows = con.prepare(`
    SELECT sub_name,
      COUNT(*) AS apps,
      ROUND(SUM(gmc_assessment),2) AS total_gmc,
      ROUND(SUM(sub_claimed),2) AS total_sub,
      MIN(week_ending) AS first_we,
      MAX(week_ending) AS last_we
    FROM sub_assessment WHERE project_id=?
    GROUP BY sub_name ORDER BY sub_name
  `).all(req.params.pid);
  con.close();
  res.json(rows);
});

router.use((err, _req, res, _next) => {
  console.error('Assessment route error:', err);
  res.status(500).json({ error: err.message, code: 'ERROR' });
});

module.exports = router;
