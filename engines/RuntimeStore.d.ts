/**
 * RuntimeStore.d.ts — tipos del store inmutable + observable.
 */

import type { RuntimeSnapshot, Listener, Unsubscribe } from './immersiveRuntimeTypes';

export interface RuntimeStore {
  getSnapshot(): RuntimeSnapshot;
  subscribe(listener: Listener): Unsubscribe;
  /** Reemplaza atómicamente y notifica. Input se freeze defensivamente. */
  replace(next: RuntimeSnapshot): void;
  /**
   * Solo para tests / shutdown total.
   *
   * Sprint M-3.4 — `opts.notify=true` emite INITIAL_SNAPSHOT a TODOS los
   * listeners ANTES de limpiar el set. Útil para que el binder/integrator
   * vea el cierre del runtime y libere recursos antes de desconectarse.
   */
  reset(opts?: { notify?: boolean }): void;
}

export const INITIAL_SNAPSHOT: RuntimeSnapshot;

export function createRuntimeStore(initialSnapshot?: RuntimeSnapshot): RuntimeStore;
