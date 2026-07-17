// The 6 fixed Revenue Generator categories, in the source contract's natural bill order —
// Prelim Fixed/Time first, Civil Works last among the "works" bills. Shared across every screen
// that groups or filters BOQ/activity data by this category, so the order and per-category color
// read the same everywhere (Bill of Quantities, Revenue Generator, Applications).
export const SECTIONS = ['Prelim Fixed', 'Prelim Time', 'Civil Works', 'MEICA Works', 'Landscape', 'Commission'];

export const SEC_COLOR = {
  'Prelim Fixed': '#1e40af',
  'Prelim Time': '#d97706',
  'Civil Works': '#166534',
  'MEICA Works': '#7c3aed',
  'Landscape': '#0891b2',
  'Commission': '#be185d',
};

// Orders an arbitrary list of schedule/section names to match SECTIONS' natural order, with any
// unrecognized name (e.g. a project using a different naming scheme) appended alphabetically after.
export function orderSections(names) {
  const known = SECTIONS.filter(s => names.includes(s));
  const unknown = names.filter(n => !SECTIONS.includes(n)).sort();
  return [...known, ...unknown];
}

// Returns SEC_COLOR's fixed value for one of the known 6, or a deterministic hash-based color for
// any project-specific category (its own BOQ Section value) so it still gets a stable, distinct
// color instead of always falling back to gray.
export function getSectionColor(name) {
  if (SEC_COLOR[name]) return SEC_COLOR[name];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 40%)`;
}
