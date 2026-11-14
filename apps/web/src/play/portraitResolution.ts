/** Keep the WebGL drawing buffer stable while the CSS portrait is moving/resizing.
 * Projection still follows the element; allocate the final buffer only after motion settles.
 */
export function createPortraitResolution(apply: (width: number, height: number) => void) {
  let appliedWidth = 0,
    appliedHeight = 0;
  let pending: { width: number; height: number; at: number } | null = null;
  function commit() {
    if (!pending) return;
    appliedWidth = pending.width;
    appliedHeight = pending.height;
    pending = null;
    apply(appliedWidth, appliedHeight);
  }
  return {
    resize(width: number, height: number, at: number) {
      const nextWidth = Math.max(1, Math.round(width));
      const nextHeight = Math.max(1, Math.round(height));
      if (nextWidth === appliedWidth && nextHeight === appliedHeight) {
        pending = null;
        return;
      }
      pending = { width: nextWidth, height: nextHeight, at };
      if (!appliedWidth) commit();
    },
    tick(at: number, motionFinished: boolean) {
      if (pending && motionFinished && at - pending.at >= 120) commit();
    },
  };
}
