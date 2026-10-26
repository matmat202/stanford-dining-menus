/* keys-logic.js — keyboard use of the menu page.
 *
 * Two things, and the first is the one that mattered:
 *
 * 1. **Focus survives a re-render.** render() rebuilds every day, meal, view and filter
 *    button with replaceChildren(), so the button a keyboard user just pressed Enter on
 *    is removed and focus falls to <body> — back to the top of the page after every
 *    choice, and again every 60 s from the "closes in N min" timer. Measured 2026-10-26
 *    in Electron: day, meal and view buttons all left focus on BODY. The fix is to
 *    remember *which slot* held focus (container id + position among its buttons), not
 *    the element, because the element is gone by the time we look again.
 * 2. **Shortcuts.** `/` focuses search (it is tab stop 12 of ~131), Esc clears it,
 *    Left/Right change day. Never while typing, never with a modifier (Ctrl+Left is the
 *    browser's), never inside the map (Leaflet pans with the arrows).
 */
(function (root) {
  // Containers whose buttons render() rebuilds.
  const REBUILT = ['days', 'meals', 'views', 'drawer'];

  function isEditable(t) {
    if (!t) return false;
    const tag = (t.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!t.isContentEditable;
  }

  /** Where focus sits, as something that survives the element: {id, index} or null. */
  function focusSlot(active) {
    if (!active || !active.closest) return null;
    for (const id of REBUILT) {
      const box = active.closest('#' + id);
      if (!box) continue;
      const index = Array.from(box.querySelectorAll('button')).indexOf(active);
      return index < 0 ? null : { id, index };
    }
    return null;
  }

  /** Put focus back in the same slot after a rebuild. Clamps if the list got shorter. */
  function restoreFocus(slot, doc) {
    if (!slot) return false;
    const box = doc.getElementById(slot.id);
    if (!box) return false;
    const btns = box.querySelectorAll('button');
    if (!btns.length) return false;
    const b = btns[Math.min(slot.index, btns.length - 1)];
    if (doc.activeElement === b) return false;
    b.focus({ preventScroll: true });
    return true;
  }

  /** A keydown -> {type:'search'} | {type:'clear'} | {type:'day', delta} | null. */
  function action(ev) {
    if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing || ev.defaultPrevented) return null;
    const t = ev.target;
    if (ev.key === 'Escape') return t && t.id === 'q' ? { type: 'clear' } : null;
    if (isEditable(t)) return null;
    if (t && t.closest && t.closest('#map')) return null;
    if (ev.key === '/' && !ev.shiftKey) return { type: 'search' };
    if (ev.shiftKey) return null;
    if (ev.key === 'ArrowLeft') return { type: 'day', delta: -1 };
    if (ev.key === 'ArrowRight') return { type: 'day', delta: 1 };
    return null;
  }

  /** Next day index, clamped to the payload's range; null when it would not move. */
  function stepDay(cur, delta, n) {
    const next = Math.max(0, Math.min(n - 1, cur + delta));
    return next === cur ? null : next;
  }

  const api = { focusSlot, restoreFocus, action, stepDay, isEditable, REBUILT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KeysLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
