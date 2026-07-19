import { useState, useRef, useEffect } from 'react';

// Excel-style AutoFilter dropdown: an "All" checkbox at the top, then one checkbox per
// option below it. `selected` is either `null` (meaning "All" — nothing excluded, no
// filter applied) or an array of explicitly-checked values, which CAN be empty — clicking
// "All" to uncheck it unchecks every individual item too, same as Excel, and an empty
// array means "nothing checked" (the caller should show zero rows), not "no filter".
// Checking every individual option back on collapses `selected` back to `null`.
export default function MultiSelectFilter({ options, selected, onChange, allLabel = 'All', formatOption, style }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);
  const allCheckboxRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const fmt = formatOption || (x => x);

  const checkedCount = selected === null ? options.length : selected.length;
  const allChecked  = checkedCount === options.length && options.length > 0;
  const noneChecked = checkedCount === 0;

  useEffect(() => {
    if (allCheckboxRef.current) allCheckboxRef.current.indeterminate = !allChecked && !noneChecked;
  }, [allChecked, noneChecked]);

  const buttonLabel = selected === null || allChecked ? allLabel
    : noneChecked ? 'None selected'
    : checkedCount === 1 ? fmt(selected[0])
    : `${checkedCount} selected`;

  const filteredOptions = query
    ? options.filter(o => fmt(o).toLowerCase().includes(query.toLowerCase()))
    : options;

  const isChecked = opt => selected === null || selected.includes(opt);

  // Clicking "All": if everything is currently checked, uncheck everything; otherwise
  // (partial or none checked) check everything.
  const toggleAll = () => onChange(allChecked ? [] : null);

  const toggleOption = opt => {
    const current = selected === null ? options : selected;
    const next = current.includes(opt) ? current.filter(o => o !== opt) : [...current, opt];
    onChange(next.length === options.length ? null : next);
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
              <input ref={allCheckboxRef} type="checkbox" checked={allChecked} onChange={toggleAll} />
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
