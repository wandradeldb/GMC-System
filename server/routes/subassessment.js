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
  const { week_ending, notes, status, items = [] } = req.body;
  const weekEnding = week_ending || new Date().toISOString().slice(0, 10);

  // week_ending é UNIQUE por subcontrato
  const dup = con.prepare(
    'SELECT application_number, status FROM sub_application WHERE subcontract_id=? AND week_ending=?'
  ).get(req.params.scid, weekEnding);
  if (dup) {
    con.close();
    return res.status(409).json({ error: `An application already exists for week ${weekEnding} (App #${dup.application_number}, status: ${dup.status}). Pick another week.` });
  }

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
    // pct_complete_* guardado = % DESTA app (delta), consistente com import e GET /boq
    return { ...it, pct_prev: prev, this_pct_sub: Math.round((pctSub - prev) * 100) / 100,
      this_pct_gmc: Math.round((pctGmc - prev) * 100) / 100, value_sub: vSub, value_gmc: vGmc };
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
        (subcontract_id, application_number, week_ending, value_sub, value_gmc,
         cumulative_sub, cumulative_gmc, net_payable, status, notes, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))
    `).run(
      req.params.scid, appNum, weekEnding,
      Math.round(valueSub*100)/100, Math.round(valueGmc*100)/100,
      Math.round((prevCum.cum_sub + valueSub)*100)/100,
      Math.round((prevCum.cum_gmc + valueGmc)*100)/100,
      Math.round(valueGmc*100)/100,
      status || 'draft', notes || null
    ).lastInsertRowid;

    const stmt = con.prepare(`
      INSERT INTO sub_application_item
        (sub_application_id, sub_boq_item_id, pct_prev, pct_complete_sub, pct_complete_gmc,
         qty_complete_sub, qty_complete_gmc, value_sub_computed, value_gmc_computed, notes)
      VALUES (?,?,?,?,?,0,0,?,?,?)
    `);
    for (const it of enrichedItems) {
      stmt.run(appId, it.sub_boq_item_id, it.pct_prev,
        it.this_pct_sub, it.this_pct_gmc,
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
  if (!['draft','assessed','approved','invoiced','paid'].includes(status)) {
    con.close(); return res.status(400).json({ error: 'Status inválido' });
  }
  // Ao aprovar, carimba a data de aprovação (se ainda não tiver)
  if (status === 'approved') {
    con.prepare(`UPDATE sub_application
      SET status=?, qs_approved_date=COALESCE(qs_approved_date, date('now')), updated_at=datetime('now')
      WHERE id=? AND subcontract_id=?`).run(status, req.params.appid, req.params.scid);
  } else {
    con.prepare(`UPDATE sub_application SET status=?, updated_at=datetime('now') WHERE id=? AND subcontract_id=?`)
      .run(status, req.params.appid, req.params.scid);
  }
  con.close();
  res.json({ ok: true });
});

// ── PUT /projects/:pid/subcontracts/:scid/applications/:appid/assessment ──────
// Corte do QS: atualiza o € GMC item a item de uma App existente e recalcula totais.
// Body: { items: [{ id, value_gmc }] }  (id = sub_application_item.id; value_gmc = € desta App)
router.put('/projects/:pid/subcontracts/:scid/applications/:appid/assessment', (req, res) => {
  const con = db();
  const { items = [] } = req.body;
  const { appid, scid } = req.params;

  const app = con.prepare('SELECT * FROM sub_application WHERE id=? AND subcontract_id=?').get(appid, scid);
  if (!app) { con.close(); return res.status(404).json({ error: 'Application não encontrada' }); }
  if (['approved', 'invoiced', 'paid'].includes(app.status)) {
    con.close();
    return res.status(409).json({ error: `App já está "${app.status}" — muda o estado para editar.` });
  }

  // contract_value + pct_prev por item desta App
  const rows = con.prepare(`
    SELECT sai.id, sai.pct_prev, ROUND(sbi.qty*sbi.rate,2) AS contract_value
    FROM sub_application_item sai
    JOIN sub_boq_item sbi ON sbi.id = sai.sub_boq_item_id
    WHERE sai.sub_application_id=?
  `).all(appid);
  const byId = {};
  rows.forEach(r => { byId[r.id] = r; });

  con.exec('BEGIN');
  try {
    const upd = con.prepare(`
      UPDATE sub_application_item SET value_gmc_computed=?, pct_complete_gmc=?
      WHERE id=? AND sub_application_id=?
    `);
    let totalGmc = 0;
    for (const it of items) {
      const row = byId[it.id];
      if (!row) continue;
      const cv = row.contract_value || 0;
      const vGmc = Math.round((Number(it.value_gmc) || 0) * 100) / 100;
      // pct_complete_gmc = % DESTA app (consistente com import e GET /boq que soma para o cumulativo)
      const pctGmc = cv > 0 ? Math.round(vGmc / cv * 100 * 100) / 100 : 0;
      upd.run(vGmc, pctGmc, it.id, appid);
      totalGmc += vGmc;
    }
    totalGmc = Math.round(totalGmc * 100) / 100;

    // cumulativo das apps anteriores (não-draft, exceptuando esta)
    const prev = con.prepare(`
      SELECT COALESCE(SUM(value_gmc),0) AS cg
      FROM sub_application WHERE subcontract_id=? AND status != 'draft' AND id != ?
    `).get(scid, appid);
    const cumulativeGmc = Math.round((prev.cg + totalGmc) * 100) / 100;

    con.prepare(`
      UPDATE sub_application SET value_gmc=?, cumulative_gmc=?, net_payable=?, updated_at=datetime('now')
      WHERE id=?
    `).run(totalGmc, cumulativeGmc, totalGmc, appid);

    con.exec('COMMIT');
    con.close();
    res.json({ ok: true, value_gmc: totalGmc, cumulative_gmc: cumulativeGmc });
  } catch (e) {
    con.exec('ROLLBACK'); con.close(); throw e;
  }
});

// ── GET /projects/:pid/subcontracts/:scid/applications/:appid/certificate ─────
// Dados para o Payment Certificate (resumo financeiro + histórico + itens).
router.get('/projects/:pid/subcontracts/:scid/applications/:appid/certificate', (req, res) => {
  const con = db();
  const { pid, scid, appid } = req.params;

  const app = con.prepare('SELECT * FROM sub_application WHERE id=? AND subcontract_id=?').get(appid, scid);
  if (!app) { con.close(); return res.status(404).json({ error: 'Application not found' }); }

  const sc = con.prepare(`
    SELECT sc.ref, sc.retention_pct, s.name AS sub_name,
      (SELECT ROUND(SUM(qty*rate),2) FROM sub_boq_item WHERE subcontract_id=sc.id) AS contract_value
    FROM subcontract sc
    JOIN subcontractor s ON s.id = sc.subcontractor_id
    WHERE sc.id=?
  `).get(scid);
  const project = con.prepare('SELECT name, ref, client FROM project WHERE id=?').get(pid) || {};

  const contractValue   = sc?.contract_value || 0;
  const retentionPct    = sc?.retention_pct || 0;
  const thisApp         = app.value_gmc || 0;
  const cumulative      = app.cumulative_gmc || 0;
  const previously      = Math.round((cumulative - thisApp) * 100) / 100;
  const pctComplete     = contractValue ? Math.round((cumulative / contractValue) * 10000) / 100 : 0;
  const retentionAmount = Math.round(thisApp * retentionPct) / 100;   // thisApp * pct/100
  const netDue          = Math.round((thisApp - retentionAmount) * 100) / 100;

  const history = con.prepare(`
    SELECT application_number, week_ending, value_gmc, cumulative_gmc, status
    FROM sub_application
    WHERE subcontract_id=? AND application_number <= ? AND status != 'draft'
    ORDER BY application_number
  `).all(scid, app.application_number);

  const items = con.prepare(`
    SELECT sbi.item_ref, sbi.description, sbi.unit, ROUND(sbi.qty*sbi.rate,2) AS contract_value,
      sai.pct_complete_gmc, sai.value_gmc_computed
    FROM sub_application_item sai
    JOIN sub_boq_item sbi ON sbi.id = sai.sub_boq_item_id
    WHERE sai.sub_application_id = ?
    ORDER BY sbi.sort_order
  `).all(appid);

  con.close();
  res.json({
    app, project, subcontract: sc,
    summary: { contractValue, thisApp, previously, cumulative, pctComplete, retentionPct, retentionAmount, netDue },
    history, items,
  });
});

// ── Helpers para o formato "Folan" (vertical, uma App por sheet) ─────────────
// Suporta dois layouts:
//  (a) Simples (1 linha header): Item | Description | % Sub | € Sub | % GMC | € GMC
//  (b) Real (2 linhas header): linha de grupo "Folan" / "GMC" por cima,
//      linha de rótulos Item | Description | % Complete | (€) | % Complete | Assessment
// Em ambos: a coluna € de cada lado é a coluna imediatamente à direita da % .
// A data (week ending) está numa linha acima do header.

function norm(s) { return String(s).toLowerCase().replace(/\s+/g, ' ').trim(); }

// Localiza a linha de cabeçalho e mapeia colunas: item, desc, pctSub, eurSub, pctGmc, eurGmc
function findHeader(sh, range) {
  const isItem = v => ['item', 'item#', 'item #', 'ref', 'referência', 'referencia'].includes(v);
  const isDesc = v => ['description', 'descrição', 'descricao', 'desc'].includes(v);
  // Coluna de percentagem: rótulo com "%" ou "complete" (ex.: "% sub", "% gmc", "% complete")
  const isPct  = v => v.includes('%') || v.includes('complete') || v.includes('completo');

  for (let r = range.s.r; r <= Math.min(range.e.r, 30); r++) {
    const labels = {};
    let itemCol, descCol;
    const pctCols = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const v = norm(strV(sh, r, c));
      if (!v) continue;
      labels[c] = v;
      if (isItem(v) && itemCol == null) itemCol = c;
      if (isDesc(v) && descCol == null) descCol = c;
      if (isPct(v)) pctCols.push(c);
    }
    if (itemCol == null || pctCols.length === 0) continue;

    // Linha de grupo (acima): identifica "folan"/"sub" vs "gmc" por coluna
    const groupRow = r > range.s.r ? r - 1 : -1;
    const groupAt = (c) => {
      if (groupRow < 0) return '';
      for (let cc = c; cc >= Math.max(range.s.c, c - 3); cc--) {
        const g = norm(strV(sh, groupRow, cc));
        if (g.includes('gmc')) return 'gmc';
        if (g.includes('folan') || g.includes('sub')) return 'sub';
      }
      return '';
    };

    pctCols.sort((a, b) => a - b);
    let subPct, gmcPct;
    for (const c of pctCols) {
      const lab = labels[c] || '', grp = groupAt(c);
      if (lab.includes('gmc') || grp === 'gmc') { if (gmcPct == null) gmcPct = c; }
      else if (lab.includes('sub') || lab.includes('folan') || grp === 'sub') { if (subPct == null) subPct = c; }
    }
    // Fallback posicional: 1ª % = Sub, 2ª % = GMC
    if (subPct == null && gmcPct == null) { subPct = pctCols[0]; gmcPct = pctCols[1]; }
    else if (gmcPct == null && pctCols.length >= 2) gmcPct = pctCols.find(c => c !== subPct);
    else if (subPct == null && pctCols.length >= 2) subPct = pctCols.find(c => c !== gmcPct);

    const cols = {
      item: itemCol, desc: descCol,
      pctSub: subPct, eurSub: subPct != null ? subPct + 1 : undefined,
      pctGmc: gmcPct, eurGmc: gmcPct != null ? gmcPct + 1 : undefined,
    };
    if (cols.item != null && (cols.pctGmc != null || cols.pctSub != null)) {
      return { headerRow: r, cols };
    }
  }
  return null;
}

// Procura a data (week ending) nas linhas acima do header — serial numérico,
// objecto Date, ou string dd.mm.yyyy / dd/mm/yyyy
function findWeekEnding(sh, range, headerRow) {
  for (let r = range.s.r; r < headerRow; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sh[XLSX.utils.encode_cell({ r, c })];
      if (!cell || cell.v == null) continue;
      if (cell.t === 'n' && cell.v > 40000 && cell.v < 60000) {
        const iso = serialToISO(cell.v);
        if (iso) return iso;
      }
      if (cell.v instanceof Date) {
        const d = cell.v;
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      }
      if (typeof cell.v === 'string') {
        const m = cell.v.trim().match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
        if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
      }
    }
  }
  return null;
}

// Normaliza % — fracção (0.35) → 35; valor já em % (35) fica como está
function pctNorm(v) {
  if (v == null) return null;
  return Math.abs(v) <= 1.0001 ? v * 100 : v;
}

// ── POST /projects/:pid/subcontracts/:scid/applications/import-excel ─────────
// Importa uma App (claim) do Excel para sub_application + items.
// Body (multipart): file=<xlsx>, week_ending=<YYYY-MM-DD> (obrigatório), sheet_name=<str> (opcional)
// Os valores do Excel são DESTA aplicação. A semana é a escolhida no UI (não a do Excel).
router.post('/projects/:pid/subcontracts/:scid/applications/import-excel',
  upload.single('file'),
  (req, res) => {
    const con = db();
    const { sheet_name, week_ending } = req.body;
    if (!req.file) {
      con.close();
      return res.status(400).json({ error: 'Excel file is required.' });
    }
    if (!week_ending) {
      con.close();
      return res.status(400).json({ error: 'Choose a Week Ending before importing.' });
    }

    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });

    // Escolher a aba: a indicada, ou a 1ª com cabeçalho válido
    let sh, usedSheet, range, hdr;
    const candidates = (sheet_name && wb.Sheets[sheet_name]) ? [sheet_name] : (wb.SheetNames || Object.keys(wb.Sheets));
    for (const name of candidates) {
      const s = wb.Sheets[name];
      if (!s) continue;
      const rng = XLSX.utils.decode_range(s['!ref'] || 'A1:A1');
      const h = findHeader(s, rng);
      if (h) { sh = s; usedSheet = name; range = rng; hdr = h; break; }
    }
    if (!sh) {
      con.close();
      return res.status(400).json({
        error: `No sheet with a valid header found (needs "Item" and "% GMC"/"Assessment" columns). Sheets: ${(wb.SheetNames || []).join(', ')}`,
      });
    }
    const { headerRow, cols } = hdr;
    // A semana é a escolhida no UI (não a do Excel)
    const weekEnding = week_ending;

    // BOQ items do sub indexados por item_ref (suporta refs duplicados → fila)
    const boqItems = con.prepare(`
      SELECT id, item_ref, ROUND(qty*rate,2) AS contract_value
      FROM sub_boq_item WHERE subcontract_id=? ORDER BY sort_order
    `).all(req.params.scid);
    const boqByRef = {};
    boqItems.forEach(b => { (boqByRef[b.item_ref] ||= []).push({ ...b }); });

    // % e valor já certificados por item (apps não-draft)
    const certRows = con.prepare(`
      SELECT sai.sub_boq_item_id,
        COALESCE(SUM(sai.pct_complete_gmc),0) AS pct_cum,
        COALESCE(SUM(sai.value_gmc_computed),0) AS val_cum
      FROM sub_application_item sai
      JOIN sub_application sa ON sa.id = sai.sub_application_id
      WHERE sa.subcontract_id=? AND sa.status != 'draft'
      GROUP BY sai.sub_boq_item_id
    `).all(req.params.scid);
    const certMap = {};
    certRows.forEach(r => { certMap[r.sub_boq_item_id] = r; });

    // 1ª passagem: ler o valor DESTA aplicação por item (cada ficheiro = 1 aplicação).
    // € tem prioridade sobre %. Deriva-se a % de €/contract_value (evita ambiguidade fração/%).
    const raw = [];
    const unmatched = [];
    let rowsScanned = 0, subFileTotal = 0, gmcFileTotal = 0;
    for (let r = headerRow + 1; r <= range.e.r; r++) {
      const ref = strV(sh, r, cols.item);
      if (!ref) continue;
      rowsScanned++;

      const queue = boqByRef[ref];
      const boq = queue && queue.length ? queue.shift() : null;
      if (!boq) { unmatched.push(ref); continue; }

      const pctSubRaw = cols.pctSub != null ? numV(sh, r, cols.pctSub) : null;
      const pctGmcRaw = cols.pctGmc != null ? numV(sh, r, cols.pctGmc) : null;
      const eurSubRaw = cols.eurSub != null ? numV(sh, r, cols.eurSub) : null;
      const eurGmcRaw = cols.eurGmc != null ? numV(sh, r, cols.eurGmc) : null;

      const cv = boq.contract_value || 0;
      // Valor DESTA app: € do Excel se existir, senão calcula da % (normalizada)
      const subThisApp = eurSubRaw != null ? eurSubRaw : (pctSubRaw != null ? cv * pctNorm(pctSubRaw) / 100 : 0);
      const gmcThisApp = eurGmcRaw != null ? eurGmcRaw : (pctGmcRaw != null ? cv * pctNorm(pctGmcRaw) / 100 : 0);

      // Linha sem qualquer dado → ignorar
      if (subThisApp === 0 && gmcThisApp === 0 && pctSubRaw == null && pctGmcRaw == null) continue;

      subFileTotal += subThisApp;
      gmcFileTotal += gmcThisApp;
      raw.push({ boq, ref, cv, subThisApp, gmcThisApp });
    }

    if (raw.length === 0) {
      con.close();
      return res.status(400).json({
        error: 'Nenhum item correspondido. Verifica que os refs do Excel coincidem com o BOQ do subcontrato.',
        debug: { headerRow, cols, weekEnding, rowsScanned, unmatched_refs: unmatched.slice(0, 20) },
      });
    }

    // Se a coluna GMC vier toda vazia, usa a claim do Folan (Sub) como assessment inicial.
    const gmcFromSub = gmcFileTotal === 0 && subFileTotal > 0;

    // 2ª passagem: os valores do Excel são DESTA aplicação (não cumulativos) → guardar direto.
    // pct_prev = cumulativo das apps anteriores (só para mostrar / detetar over-claim).
    const items = [];
    const overClaim = [];
    let valueSub = 0, valueGmc = 0;
    for (const it of raw) {
      const cv = it.cv || 0;
      const subVal = it.subThisApp;
      const gmcVal = gmcFromSub ? it.subThisApp : it.gmcThisApp;

      const cert = certMap[it.boq.id] || { pct_cum: 0, val_cum: 0 };
      const pctPrev = Math.round(cert.pct_cum * 100) / 100;

      // % desta app (derivada do €)
      const pctSub = cv ? Math.round(subVal / cv * 100 * 100) / 100 : 0;
      const pctGmc = cv ? Math.round(gmcVal / cv * 100 * 100) / 100 : 0;

      // Cumulativo acima de 100% → precisa de variation (compensation event)
      const cumPct = Math.round((pctPrev + pctGmc) * 100) / 100;
      if (cumPct > 100.01) overClaim.push({ ref: it.ref, cumulative_pct: cumPct });

      valueSub += subVal;
      valueGmc += gmcVal;
      items.push({
        boq_id: it.boq.id, ref: it.ref,
        pctPrev, pctSub, pctGmc,
        vSub: Math.round(subVal * 100) / 100,
        vGmc: Math.round(gmcVal * 100) / 100,
      });
    }

    // Número sequencial e cumulativos anteriores
    const lastApp = con.prepare(
      'SELECT MAX(application_number) AS n FROM sub_application WHERE subcontract_id=?'
    ).get(req.params.scid);
    const dbAppNum = (lastApp.n || 0) + 1;
    const prevCum = con.prepare(`
      SELECT COALESCE(SUM(value_gmc),0) AS cg, COALESCE(SUM(value_sub),0) AS cs
      FROM sub_application WHERE subcontract_id=? AND status != 'draft'
    `).get(req.params.scid);

    // week_ending é NOT NULL e UNIQUE por subcontrato → fallback p/ hoje se não houver data
    const weekEndingFinal = weekEnding || new Date().toISOString().slice(0, 10);
    const dup = con.prepare(
      'SELECT application_number, status FROM sub_application WHERE subcontract_id=? AND week_ending=?'
    ).get(req.params.scid, weekEndingFinal);
    if (dup) {
      con.close();
      return res.status(409).json({
        error: `An application already exists for week ${weekEndingFinal} (App #${dup.application_number}, status: ${dup.status}). `
          + `Each week can only have one application. Pick a different Week Ending.`,
      });
    }
    // GMC empty → 'assessed' (Folan claim loaded, QS still has to cut). GMC filled → 'approved'.
    const appStatus = gmcFromSub ? 'assessed' : 'approved';
    const notes = `Imported from Excel — ${usedSheet} WE ${weekEndingFinal}`
      + (gmcFromSub ? ' (GMC empty → used Folan claim)' : '');

    con.exec('BEGIN');
    try {
      const appId = con.prepare(`
        INSERT INTO sub_application
          (subcontract_id, application_number, week_ending, value_sub, value_gmc,
           cumulative_sub, cumulative_gmc, net_payable, status, notes, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))
      `).run(
        req.params.scid, dbAppNum, weekEndingFinal,
        Math.round(valueSub*100)/100, Math.round(valueGmc*100)/100,
        Math.round((prevCum.cs + valueSub)*100)/100,
        Math.round((prevCum.cg + valueGmc)*100)/100,
        Math.round(valueGmc*100)/100,
        appStatus, notes
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

      con.exec('COMMIT');
      con.close();
      res.json({
        ok: true,
        results: [{
          appNum: dbAppNum, created: true,
          value_gmc: Math.round(valueGmc*100)/100,
          value_sub: Math.round(valueSub*100)/100,
          items: items.length,
          week_ending: weekEnding,
          status: appStatus,
          gmc_from_sub: gmcFromSub,
        }],
        unmatched_refs: unmatched,
        over_claim: overClaim,
      });
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
