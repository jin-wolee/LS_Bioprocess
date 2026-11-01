// The pointer, wheel and keys of the plant (docs/design/plant_ui.md section 3.4): click or tap the floor to walk, drag or one finger to look, wheel or pinch to zoom, the keys of the table.
// This file turns DOM events into the calls of a small handler object and holds no state of the scene; the walking, the camera and the picking are in the scene and in the pure modules.

export interface Handlers {
  /** A click or a tap that did not become a drag, at a point in the canvas (pixels from its top left). */
  click(x: number, y: number): void;
  /** A drag, or one finger moving, in pixels since the last event. */
  look(dx: number, dy: number): void;
  /** The wheel (pixels of delta, positive away) or a pinch (the same sign: fingers closing is positive). */
  zoom(delta: number): void;
  /** A key, lower-cased, going down or up. `repeat` is true for a key that is held. True when the plant used it, so the page does not scroll under an arrow key. */
  key(name: string, down: boolean, repeat: boolean): boolean;
}

const DRAG_PX = 5; // a press that moves less than this is a click

/** Whether the focus is in a control that takes typing: the keys of the plant leave it alone. */
const typing = (target: EventTarget | null): boolean => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName));

export const listen = (canvas: HTMLCanvasElement, handlers: Handlers): (() => void) => {
  const pointers = new Map<number, { x: number; y: number }>();
  let pressed: { x: number; y: number; moved: boolean } | null = null;
  let pinch = 0;
  const gap = (): number => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const local = (e: PointerEvent): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const down = (e: PointerEvent): void => {
    canvas.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, p);
    pressed = pointers.size === 1 ? { ...p, moved: false } : null;
    pinch = gap();
  };
  const move = (e: PointerEvent): void => {
    const before = pointers.get(e.pointerId);
    if (!before) return;
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 2) {
      const now = gap();
      handlers.zoom((pinch - now) * 4);
      pinch = now;
      return;
    }
    if (!pressed) return;
    if (!pressed.moved && Math.hypot(p.x - pressed.x, p.y - pressed.y) < DRAG_PX) return;
    pressed.moved = true;
    handlers.look(p.x - before.x, p.y - before.y);
  };
  const up = (e: PointerEvent): void => {
    const p = local(e);
    pointers.delete(e.pointerId);
    if (pressed && !pressed.moved && pointers.size === 0 && e.type === "pointerup") handlers.click(p.x, p.y);
    if (pointers.size === 0) pressed = null;
  };
  const wheel = (e: WheelEvent): void => {
    e.preventDefault();
    handlers.zoom(e.deltaY);
  };
  const key = (down_: boolean) => (e: KeyboardEvent): void => {
    if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (handlers.key(e.key.length === 1 ? e.key.toLowerCase() : e.key, down_, e.repeat)) e.preventDefault();
  };
  const keydown = key(true);
  const keyup = key(false);

  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("wheel", wheel, { passive: false });
  window.addEventListener("keydown", keydown);
  window.addEventListener("keyup", keyup);
  return () => {
    canvas.removeEventListener("pointerdown", down);
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerup", up);
    canvas.removeEventListener("pointercancel", up);
    canvas.removeEventListener("wheel", wheel);
    window.removeEventListener("keydown", keydown);
    window.removeEventListener("keyup", keyup);
  };
};
