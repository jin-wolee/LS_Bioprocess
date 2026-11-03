// Time and event order (docs/prompts/10 Step 1). Time is an integer number of seconds from scenario t0; the engine has no timezones.

/** Event priority at equal t, ascending. `dispatch` is internal: its effects are the logged visit_started and run_started. */
export const PRIORITY = { capacityRestored: 0, visitFinished: 1, requestQueued: 2, capacityRemoved: 3, dispatch: 4 } as const;

export interface Scheduled<T> {
  t: number;
  priority: number;
  /** Tie-break inside a priority: a global integer assigned when the event is scheduled. */
  seq: number;
  payload: T;
}

export interface EventQueue<T> {
  push(t: number, priority: number, seq: number, payload: T): void;
  pop(): Scheduled<T> | undefined;
  readonly size: number;
}

/** Binary min-heap ordered by (t, priority, seq); the insertion count settles an exact tie so the order is always total. */
export const createEventQueue = <T>(): EventQueue<T> => {
  const heap: (Scheduled<T> & { n: number })[] = [];
  let count = 0;
  const before = (a: Scheduled<T> & { n: number }, b: Scheduled<T> & { n: number }): boolean =>
    a.t !== b.t ? a.t < b.t : a.priority !== b.priority ? a.priority < b.priority : a.seq !== b.seq ? a.seq < b.seq : a.n < b.n;
  return {
    push(t, priority, seq, payload) {
      const item = { t, priority, seq, payload, n: count++ };
      let i = heap.length;
      heap.push(item);
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (!before(item, heap[parent] as typeof item)) break;
        heap[i] = heap[parent] as typeof item;
        i = parent;
      }
      heap[i] = item;
    },
    pop() {
      const top = heap[0];
      const last = heap.pop();
      if (!top || !last) return top;
      if (heap.length === 0) return top;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let c = l;
        if (c >= heap.length) break;
        if (r < heap.length && before(heap[r] as typeof last, heap[l] as typeof last)) c = r;
        if (!before(heap[c] as typeof last, last)) break;
        heap[i] = heap[c] as typeof last;
        i = c;
      }
      heap[i] = last;
      return top;
    },
    get size() {
      return heap.length;
    },
  };
};

/** Sampled continuous durations become whole seconds: floor(x + 0.5), at least one second. */
export const roundDuration = (x: number): number => Math.max(1, Math.floor(x + 0.5));

/** An instant or an offset in seconds from a value that is not yet whole: floor(x + 0.5). Zero is allowed (unlike roundDuration). */
export const wholeSeconds = (x: number): number => Math.floor(x + 0.5);
