import { useEffect, useRef } from 'react';
import { pushBackHandler, removeBackHandler } from './backStack.js';

// Registers `onBack` as the current "step back" action for as long as `active` is true.
// Uses a ref for the handler itself so passing a fresh inline function every render
// (the norm in this codebase) doesn't re-register on every render — only a genuine
// active:false→true / true→false transition pushes or removes a history entry.
export function useBackHandler(onBack, active = true) {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!active) return;
    const id = pushBackHandler(() => onBackRef.current());
    return () => removeBackHandler(id);
  }, [active]);
}
