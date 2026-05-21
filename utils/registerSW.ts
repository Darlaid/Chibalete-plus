/**
 * registerSW.ts — P3-G registro GATED del Service Worker foundation.
 *
 * NO se importa desde index.tsx/App.tsx todavía (foundation = inerte por
 * defecto; no hay offline total). Activación deliberada en 1 punto cuando
 * P4 lo decida. Doble gate:
 *   - flag runtime: localStorage 'SW_ENABLED' === '1'  (ops/QA)
 *   - o build flag:  import.meta.env.VITE_SW_ENABLED === '1'
 *
 * Rollback instantáneo: unregisterSW() (limpia SW + caches) — provisto.
 */
export async function registerSW(): Promise<boolean> {
    try {
        if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
        const lsOn = typeof window !== 'undefined'
            && window.localStorage?.getItem('SW_ENABLED') === '1';
        const buildOn = (import.meta as any)?.env?.VITE_SW_ENABLED === '1';
        if (!lsOn && !buildOn) return false;          // default OFF
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        // eslint-disable-next-line no-console
        console.log('[sw] registered', reg.scope);
        return true;
    } catch (e) {
        // SW JAMÁS debe romper la app: degradar a sin-SW.
        // eslint-disable-next-line no-console
        console.warn('[sw] register failed (continuing online-only):', (e as Error).message);
        return false;
    }
}

/** Kill-switch del SW: desregistra + purga caches. Para incident response. */
export async function unregisterSW(): Promise<void> {
    try {
        if (!('serviceWorker' in navigator)) return;
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
        if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.filter((k) => k.startsWith('chibalete-sw')).map((k) => caches.delete(k)));
        }
        // eslint-disable-next-line no-console
        console.log('[sw] unregistered + caches purged');
    } catch { /* defensivo */ }
}
