// Excel-style keyboard navigation for spreadsheet-like input grids (a <table> of per-row
// editable cells). Tab already moves right/left via native browser tab order, so this only
// needs to handle: Enter/ArrowDown → down, ArrowUp → up, ArrowLeft/ArrowRight → sideways.
//
// Each navigable cell needs `data-grid-row` (a value shared by every cell in that row) and
// `data-grid-col` (a value shared by every cell in that column) attributes, then
// `onKeyDown={gridKeyNav}`. Row/col values just need to be consistent within one grid —
// numeric indices, ids, whatever the caller already has on hand.
//
// Left/Right only move to the next cell once the caret is already at that edge of the
// field's text, so they never fight normal cursor movement while editing a value.
export function gridKeyNav(e) {
  const key = e.key;
  if (key !== 'Enter' && key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'ArrowLeft' && key !== 'ArrowRight') return;

  const el = e.target;
  const row = el.dataset.gridRow;
  const col = el.dataset.gridCol;
  if (row == null || col == null) return;

  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
  if (horizontal) {
    // type="number" inputs don't support cursor-position selection: some browsers throw on
    // selectionStart/End access, Chrome just returns null. Either way, treat that as "always
    // at the boundary" so arrow keys on a number cell just navigate straight to the next cell.
    let start = null, end = null;
    try { start = el.selectionStart; end = el.selectionEnd; } catch { /* unsupported for this input type */ }
    const supportsSelection = start != null;
    const atStart = !supportsSelection || (start === 0 && end === 0);
    const atEnd   = !supportsSelection || (start === el.value.length && end === el.value.length);
    if (key === 'ArrowLeft' && !atStart) return;
    if (key === 'ArrowRight' && !atEnd) return;
  }

  const selector = horizontal ? `[data-grid-row="${cssEscape(row)}"]` : `[data-grid-col="${cssEscape(col)}"]`;
  const cells = Array.from(document.querySelectorAll(selector));
  const idx = cells.indexOf(el);
  if (idx === -1) return;

  const dir = (key === 'ArrowUp' || key === 'ArrowLeft') ? -1 : 1; // Enter/ArrowDown/ArrowRight = forward
  const next = cells[idx + dir];
  if (!next) return;

  e.preventDefault();
  next.focus();
  next.select?.();
}

function cssEscape(v) {
  return window.CSS?.escape ? CSS.escape(String(v)) : String(v).replace(/["\\]/g, '\\$&');
}
