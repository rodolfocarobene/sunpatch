/** A phone or tablet with no mouse or trackpad: no hover, Shift or right-click. The same test hides the Walk button (style.css). */
export function touchOnly(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse) and (not (any-pointer: fine))').matches
}
