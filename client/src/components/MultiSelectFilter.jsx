import { useState, useRef, useEffect } from 'react';

// Excel-style AutoFilter dropdown: an "All" checkbox at the top, then one checkbox per
// option below it. `selected` is the list of explicitly-included values; an EMPTY array
// means "All" (no filter applied) — this mirrors how the existing single-value filters
// treated '' as "no filter", so callers building the API query can keep doing
// `if (selected.length) …` the same way they used to do `if (value) …`.
export default function MultiSelectFilter({ options, selected, onChange, allLabel = 'All', formatOption, style }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const fmt = formatOption || (x => x);

  const allSelected = selected.length === 0;
  const buttonLabel = allSelected ? allLabel
    : selected.length === 1 ? fmt(selected[0])
    : `${selected.length} selected`;

  const filteredOptions = query
    ? options.filter(o => fmt(o).toLowerCase().includes(query.toLowerCase()))
    : options;

  const isChecked = opt => allSelected || selected.includes(opt);

  const toggleAll = () => onChange([]);

  const toggleOption = opt => {
    if (allSelected) {
      onChange(options.filter(o => o !== opt));
    } else if (selected.includes(opt)) {
      const next = selected.filter(o => o !== opt);
      onChange(next.length === options.length ? [] : next);
    } else {
      const next = [...selected, opt];
      onChange(next.length === options.length ? [] : next);
    }
  };

  return (
    <div ref={ref} style={{ position: 'relative', ...style }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{ padding:'7px 10px', borderRadius:6, border:'1px solid #d1d5db', fontSize:13, background:'#fff',
          cursor:'pointer', display:'flex', alignItems:'center', gap:8, minWidth:150, justifyContent:'space-between' }}>
        <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{buttonLabel}</span>
        <span style={{ fontSize:10, color:'#6b7280' }}>▾</span>
      </button>
      {open && (
        <div style={{ position:'absolute', top:'calc(100% + 4px)', left:0, zIndex:20, background:'#fff',
          border:'1px solid #d1d5db', borderRadius:8, boxShadow:'0 8px 24px rgba(0,0,0,0.15)', minWidth:220, maxWidth:320 }}>
          {options.length > 8 && (
            <div style={{ padding:8, borderBottom:'1px solid #f0f0f0' }}>
              <input autoFocus placeholder="Search…" value={query} onChange={e => setQuery(e.target.value)}
                style={{ width:'100%', padding:'5px 8px', borderRadius:6, border:'1px solid #d1d5db', fontSize:12, boxSizing:'border-box' }} />
            </div>
          )}
          <div style={{ maxHeight:280, overflowY:'auto', padding:'4px 0' }}>
            <label style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 12px', fontSize:13, fontWeight:700, cursor:'pointer', borderBottom:'1px solid #f0f0f0' }}>
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              {allLabel}
            </label>
            {filteredOptions.map(opt => (
              <label key={opt} style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 12px', fontSize:13, cursor:'pointer' }}>
                <input type="checkbox" checked={isChecked(opt)} onChange={() => toggleOption(opt)} />
                <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{fmt(opt)}</span>
              </label>
            ))}
            {filteredOptions.length === 0 && <div style={{ padding:'10px 12px', fontSize:12, color:'#9ca3af' }}>No matches</div>}
          </div>
        </div>
      )}
    </div>
  );
}
