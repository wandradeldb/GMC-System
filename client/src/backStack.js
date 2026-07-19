// Lightweight in-app "back" navigation, layered on top of the browser History API.
// The app has no router, so without this, the physical browser back button has nothing
// to act on and just leaves the SPA entirely. Any screen that wants to be "back-able"
// (via the on-screen Back button, the browser's back arrow, or the ArrowLeft key)
// registers a handler here — see useBackHandler.js for the React hook that wraps this.
//
// Each registration pushes one real history entry, so the physical back button and the
// keyboard shortcut both just call history.back(); a single popstate listener pops the
// matching handler off the stack and runs it. If a screen goes away for some other reason
// (e.g. the user jumps to a different sidebar tab) its handler is removed directly —
// removeBackHandler() then consumes the now-orphaned history entry itself, so the
// browser's back-button depth never drifts out of sync with what's actually on screen.
//
// push/remove calls are queued and coalesced on a microtask before they touch the real
// history API. This matters because React 18 StrictMode (dev only) mounts every component
// twice — mount, cleanup, mount again — and without coalescing, that throwaway cleanup
// would fire a real history.back() a beat before the "real" mount's own pushState, racing
// it and popping the wrong entry. Queuing lets an immediate push+remove(+push) for the
// same id cancel out before ever calling window.history.

let stack = [];
let seq = 0;
let queue = [];
let flushScheduled = false;

// Distinguishes "I called history.back() myself to consume an orphaned entry" from a real
// physical back-button / ArrowLeft press. Without this, cleaning up several nested levels at
// once (e.g. re-clicking the sidebar item you're already in) fires that many real popstate
// events, and the listener would otherwise treat each one as a fresh "user pressed back" and
// pop+call a handler that has nothing to do with what actually happened. The timeout is a
// safety net in case a browser ever coalesces back() calls into fewer popstate events than
// expected — better to risk swallowing one real back-press than get stuck ignoring back forever.
let selfConsumeCount = 0;
function markSelfConsume() {
  selfConsumeCount++;
  setTimeout(() => { if (selfConsumeCount > 0) selfConsumeCount--; }, 1500);
}

function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(flush);
}

function flush() {
  flushScheduled = false;
  const ops = queue;
  queue = [];
  const pushedIds = new Set(ops.filter(o => o.type === 'push').map(o => o.id));
  const removedIds = new Set(ops.filter(o => o.type === 'remove').map(o => o.id));
  for (const op of ops) {
    if (op.type === 'push') {
      if (removedIds.has(op.id)) continue; // pushed and removed within the same batch — never happened, as far as real history is concerned
      stack.push({ id: op.id, handler: op.handler });
      window.history.pushState({ gmcBackId: op.id }, '');
    } else {
      if (pushedIds.has(op.id)) continue; // already skipped above, don't also try to remove it
      const idx = stack.findIndex(e => e.id === op.id);
      if (idx === -1) continue; // already consumed via popstate
      stack.splice(idx, 1);
      markSelfConsume();
      window.history.back();
    }
  }
}

function flushIfPending() {
  if (flushScheduled) flush();
}

export function pushBackHandler(handler) {
  const id = ++seq;
  queue.push({ type: 'push', id, handler });
  scheduleFlush();
  return id;
}

export function removeBackHandler(id) {
  queue.push({ type: 'remove', id });
  scheduleFlush();
}

export function goBack() {
  flushIfPending();
  if (stack.length === 0) return false;
  window.history.back();
  return true;
}

export function hasBackHandler() {
  flushIfPending();
  return stack.length > 0;
}

window.addEventListener('popstate', () => {
  if (selfConsumeCount > 0) { selfConsumeCount--; return; }
  flushIfPending();
  const top = stack.pop();
  if (top) top.handler();
});
