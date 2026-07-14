// Parses an MS-Project-style Gantt PDF export (one wide table: ID, Task Name,
// Duration, % Complete, Start, Finish, Total Slack, Predecessors, followed by
// a graphical timeline we don't attempt to read) into structured activity rows.
//
// The PDF's timeline bars are vector graphics, not text, so we never try to
// reconstruct them — only the table columns (which are real text) are parsed.
// The frontend draws its own simple bars from the parsed start/finish dates.
const ROW_TOLERANCE = 2.5;   // px: items within this y-delta belong to the same row
const LEVEL_TOLERANCE = 3;   // px: task-name indents within this delta count as the same outline level

const MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };

function parseDate(str) {
  // "Mon 25/08/25" -> "2025-08-25"
  const m = String(str || '').trim().match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  let [, d, mo, y] = m;
  y = y.length === 2 ? (Number(y) < 50 ? `20${y}` : `19${y}`) : y;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

async function extractPages(buffer) {
  const pdfjsLib = await import('pdfjs-dist/build/pdf.mjs');
  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items
      .filter(it => it.str != null && it.str.trim() !== '')
      .map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5] })));
  }
  return pages;
}

function groupRows(items) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const it of sorted) {
    let row = rows.find(r => Math.abs(r.y - it.y) <= ROW_TOLERANCE);
    if (!row) { row = { y: it.y, items: [] }; rows.push(row); }
    row.items.push(it);
  }
  rows.sort((a, b) => b.y - a.y);
  return rows;
}

function findHeaderCols(rows) {
  for (const row of rows) {
    const find = label => row.items.find(it => it.str.trim() === label);
    const taskName = find('Task Name');
    const duration = find('Duration');
    const start    = find('Start');
    const finish   = find('Finish');
    if (taskName && duration && start && finish) {
      const pct     = find('% Complete');
      const slack   = row.items.find(it => it.str.trim() === 'Total');
      const pred    = find('Predecessors');
      const chart   = row.items.find(it => /^Half \d/.test(it.str.trim()));
      return {
        headerY: row.y,
        taskName: taskName.x,
        duration: duration.x,
        pct: pct ? pct.x : duration.x + 60,
        start: start.x,
        finish: finish.x,
        slack: slack ? slack.x : finish.x + 60,
        pred: pred ? pred.x : finish.x + 100,
        chart: chart ? chart.x : finish.x + 200,
      };
    }
  }
  return null;
}

function bucketRow(row, cols) {
  const bucket = (from, to) => row.items
    .filter(it => it.x >= from && it.x < to)
    .sort((a, b) => a.x - b.x);
  const taskItems = bucket(cols.taskName, cols.duration);
  return {
    idText:       bucket(0, cols.taskName).map(it => it.str).join(' ').trim(),
    taskItems,
    taskText:     taskItems.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim(),
    taskMinX:     taskItems.length ? Math.min(...taskItems.map(it => it.x)) : null,
    durationText: bucket(cols.duration, cols.pct).map(it => it.str).join(' ').replace(/\s+/g, ' ').trim(),
    startText:    bucket(cols.start, cols.finish).map(it => it.str).join(' ').replace(/\s+/g, ' ').trim(),
    finishText:   bucket(cols.finish, cols.slack).map(it => it.str).join(' ').replace(/\s+/g, ' ').trim(),
    predText:     bucket(cols.pred, cols.chart).map(it => it.str).join(' ').replace(/\s+/g, ' ').trim(),
  };
}

const SKIP_ROW_RE = /^(Project:|Date:|Page \d|ID\s+ID\s+Task Name)/;
// Legend row ("Task  Split  Milestone  Late  Baseline  ...") sometimes lands in its own
// y-cluster, separate from the "Project:" prefix that would otherwise skip it — detect it
// by checking whether every word across the task/duration text is a legend keyword.
const LEGEND_WORDS = new Set(['Task', 'Split', 'Milestone', 'Late', 'Baseline', 'Progress', 'Critical']);
function isLegendRow(taskText, durationText, hasDates) {
  if (hasDates) return false;
  const words = `${taskText} ${durationText}`.split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every(w => LEGEND_WORDS.has(w));
}

function parseActivities(pages) {
  let cols = null;
  const bucketed = [];

  for (const items of pages) {
    const rows = groupRows(items);
    if (!cols) cols = findHeaderCols(rows);
    if (!cols) continue;
    for (const row of rows) {
      const lineText = row.items.map(it => it.str).join(' ').trim();
      if (!lineText || SKIP_ROW_RE.test(lineText)) continue;
      if (Math.abs(row.y - cols.headerY) <= ROW_TOLERANCE) continue; // header row itself
      const b = bucketRow(row, cols);
      if (!b.taskText && !b.idText) continue; // fully blank / chart-only row
      const rowHasDates = /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(b.startText) || /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(b.finishText);
      if (isLegendRow(b.taskText, b.durationText, rowHasDates)) continue;
      bucketed.push(b);
    }
  }

  // distinct indent offsets -> outline levels (data-driven, not a hardcoded px guess)
  const offsets = [...new Set(
    bucketed.filter(b => b.taskMinX != null).map(b => Math.round(b.taskMinX))
  )].sort((a, b) => a - b);
  const levelOf = x => {
    if (x == null) return 0;
    let level = 0;
    for (const off of offsets) {
      if (x - off > LEVEL_TOLERANCE) level++;
      else break;
    }
    return level;
  };

  const activities = [];
  let seq = 0;
  for (const b of bucketed) {
    const id = (b.idText.match(/^\d+/) || [])[0] || null;
    const hasDates = /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(b.startText) || /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(b.finishText);
    const isContinuation = !id && !hasDates && !b.durationText && b.taskText;

    if (isContinuation && activities.length) {
      activities[activities.length - 1].task_name += ' ' + b.taskText;
      continue;
    }
    if (!b.taskText) continue;

    activities.push({
      seq: seq++,
      level: levelOf(b.taskMinX),
      task_name: b.taskText,
      duration_label: b.durationText || null,
      start_date: parseDate(b.startText),
      finish_date: parseDate(b.finishText),
      predecessors: b.predText || null,
    });
  }
  return activities;
}

async function parseProgrammePdf(buffer) {
  const pages = await extractPages(buffer);
  return parseActivities(pages);
}

module.exports = { parseProgrammePdf };
