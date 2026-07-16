/** Minimal typed pub/sub used inside packages (not across workers — workers
 * use structured postMessage protocols defined where they live). */
export type Unsubscribe = () => void;

export class Emitter<Events extends Record<string, unknown>> {
  #listeners = new Map<keyof Events, Set<(payload: never) => void>>();

  on<K extends keyof Events>(event: K, fn: (payload: Events[K]) => void): Unsubscribe {
    let set = this.#listeners.get(event);
    if (!set) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    set.add(fn as (payload: never) => void);
    return () => set.delete(fn as (payload: never) => void);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    this.#listeners.get(event)?.forEach((fn) => (fn as (p: Events[K]) => void)(payload));
  }
}
