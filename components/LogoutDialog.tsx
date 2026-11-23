/**
 * LogoutDialog.tsx — CHP V9 65E-C3 (Bloque I). Cierre de sesión informado.
 *
 * Al cerrar sesión, en el navegador quedan datos de la cuenta que salió: las lecturas que todavía no se pudieron enviar
 * y lo que solo existe en ese equipo (bitácora, reseñas, entregas, vocabulario…), porque no tienen copia en el servidor.
 * Borrarlos sin preguntar destruiría trabajo de su titular; dejarlos sin decirlo los deja a la vista de quien use después
 * el equipo. Aquí se le dice qué queda y se le deja elegir:
 *   - conservarlos en este equipo (opción por defecto: nada se borra sin pedirlo), o
 *   - eliminarlos, con una segunda confirmación que dice exactamente qué se pierde. Solo lo de SU cuenta.
 * No cifra ni mueve nada: usa el almacenamiento y la cola que ya existen (`dataService`).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CloudOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { dataService } from '../services/dataService';
import type { LocalDataSummary } from '../services/dataService';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const dateOf = (ms: number) => new Date(ms).toLocaleDateString('es', { day: 'numeric', month: 'long' });

/** Lo que solo existe en este equipo, en palabras de su titular. */
export function localOnlyItems(s: LocalDataSummary): string[] {
    const out: string[] = [];
    if (s.journal) out.push(plural(s.journal, 'entrada de tu bitácora', 'entradas de tu bitácora'));
    if (s.reviews) out.push(plural(s.reviews, 'reseña', 'reseñas'));
    if (s.submissions) out.push(plural(s.submissions, 'entrega de tarea', 'entregas de tareas'));
    if (s.posts) out.push(plural(s.posts, 'publicación', 'publicaciones'));
    if (s.orality) out.push(plural(s.orality, 'práctica de lectura en voz alta', 'prácticas de lectura en voz alta'));
    if (s.vocabulary) out.push(plural(s.vocabulary, 'palabra de tu vocabulario', 'palabras de tu vocabulario'));
    if (s.other) out.push(plural(s.other, 'nota de lectura (relecturas y acompañamiento)', 'notas de lectura (relecturas y acompañamiento)'));
    return out;
}

interface Props {
    userId: string;
    onCancel: () => void;
    /** Cerrar sesión conservando lo local. */
    onKeep: () => void;
    /** Eliminar lo local de esa cuenta y cerrar sesión. */
    onDelete: () => Promise<void> | void;
}

export const LogoutDialog: React.FC<Props> = ({ userId, onCancel, onKeep, onDelete }) => {
    const [summary] = useState<LocalDataSummary>(() => dataService.localDataSummary(userId));
    const [step, setStep] = useState<'choose' | 'confirm'>('choose');
    const [busy, setBusy] = useState(false);
    const boxRef = useRef<HTMLDivElement>(null);
    const firstRef = useRef<HTMLButtonElement>(null);
    const items = localOnlyItems(summary);
    const nothing = summary.total === 0;

    // El foco entra en la opción que NO borra nada; al cambiar de paso, en «Volver».
    useEffect(() => { firstRef.current?.focus(); }, [step]);

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape' && !busy) { e.stopPropagation(); if (step === 'confirm') setStep('choose'); else onCancel(); return; }
        if (e.key !== 'Tab') return;
        const f = boxRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])');
        if (!f || f.length === 0) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    const confirmDelete = async () => { setBusy(true); try { await onDelete(); } finally { setBusy(false); } };

    const btn = 'w-full px-4 py-3 rounded-xl font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-indigo-500 disabled:opacity-60';
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" data-testid="logout-dialog-backdrop">
            <div ref={boxRef} role="dialog" aria-modal="true" aria-labelledby="logout-dialog-title" aria-describedby="logout-dialog-desc" onKeyDown={onKeyDown}
                data-testid="logout-dialog" data-step={step}
                className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-gray-900 p-6 text-left text-gray-800 dark:text-gray-100 shadow-xl">
                {step === 'choose' ? (
                    <>
                        <h2 id="logout-dialog-title" className="text-xl font-bold">Antes de cerrar sesión</h2>
                        <div id="logout-dialog-desc" className="mt-3 space-y-3 text-sm leading-relaxed">
                            {nothing ? (
                                <p>No queda ningún dato tuyo guardado en este equipo.</p>
                            ) : (
                                <>
                                    <p>En este equipo quedan datos tuyos que todavía no están guardados en tu cuenta:</p>
                                    <ul className="list-disc pl-5 space-y-1" data-testid="logout-remaining">
                                        {summary.pendingReadings > 0 && (
                                            <li>
                                                <strong>{plural(summary.pendingReadings, 'lectura sin enviar', 'lecturas sin enviar')}.</strong>{' '}
                                                El envío se hará cuando vuelvas a entrar con tu cuenta en este equipo
                                                {summary.pendingExpiresAt ? <> antes del <strong>{dateOf(summary.pendingExpiresAt)}</strong>. Después de esa fecha se eliminan de este equipo sin haberse enviado.</> : '.'}
                                            </li>
                                        )}
                                        {items.map((t) => <li key={t}>{t} <span className="text-gray-500 dark:text-gray-400">(solo existen en este equipo)</span></li>)}
                                    </ul>
                                    <p className="rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3 text-amber-900 dark:text-amber-100">
                                        Si otras personas usan este equipo, alguien con acceso al navegador podría verlos. En equipos compartidos conviene que cada persona use su propio perfil del navegador.
                                    </p>
                                </>
                            )}
                        </div>
                        <div className="mt-5 space-y-2">
                            <button ref={firstRef} type="button" onClick={onKeep} data-testid="logout-keep" className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`}>
                                {nothing ? 'Cerrar sesión' : 'Conservarlos en este equipo y cerrar sesión'}
                            </button>
                            {!nothing && (
                                <button type="button" onClick={() => setStep('confirm')} data-testid="logout-delete" className={`${btn} border border-red-300 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20`}>
                                    Eliminar mis datos de este equipo…
                                </button>
                            )}
                            <button type="button" onClick={onCancel} data-testid="logout-cancel" className={`${btn} text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800`}>
                                Cancelar y seguir con la sesión abierta
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <h2 id="logout-dialog-title" className="text-xl font-bold">¿Eliminar tus datos de este equipo?</h2>
                        <div id="logout-dialog-desc" className="mt-3 space-y-3 text-sm leading-relaxed">
                            <p>Se eliminará de forma definitiva, solo de tu cuenta y solo en este equipo:</p>
                            <ul className="list-disc pl-5 space-y-1" data-testid="logout-losing">
                                {summary.pendingReadings > 0 && (
                                    <li><strong>{plural(summary.pendingReadings, 'lectura sin enviar', 'lecturas sin enviar')}.</strong> Primero se intentará el envío; lo que no llegue ahora <strong>se perderá</strong> y no contará en tu progreso.</li>
                                )}
                                {items.map((t) => <li key={t}>{t}: <strong>no hay otra copia</strong>, no se podrá recuperar.</li>)}
                            </ul>
                            <p>No se toca lo que ya está guardado en tu cuenta ni los datos de otras personas que usen este equipo. Esta acción no se puede deshacer.</p>
                        </div>
                        <div className="mt-5 space-y-2">
                            <button ref={firstRef} type="button" onClick={() => setStep('choose')} disabled={busy} data-testid="logout-back" className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`}>
                                Volver sin eliminar nada
                            </button>
                            <button type="button" onClick={confirmDelete} disabled={busy} data-testid="logout-delete-confirm" className={`${btn} bg-red-600 text-white hover:bg-red-700`}>
                                {busy ? 'Eliminando…' : 'Sí, eliminar mis datos y cerrar sesión'}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

/**
 * Flujo de cierre de sesión para un botón «Cerrar sesión». Si no queda nada de la cuenta en el equipo, cierra sin
 * preguntar (salvo `always`); si queda algo, abre el diálogo. Al terminar devuelve el foco al botón si se cancela.
 */
export function useLogoutFlow(onAfter?: () => void): { requestLogout: (trigger?: HTMLElement | null, opts?: { always?: boolean }) => void; dialog: React.ReactNode } {
    const { user, logout } = useAuth();
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLElement | null>(null);
    const finish = useCallback(() => { setOpen(false); logout(); onAfter?.(); }, [logout, onAfter]);
    const requestLogout = useCallback((trigger?: HTMLElement | null, opts?: { always?: boolean }) => {
        const id = user?.id;
        if (!id || (!opts?.always && dataService.localDataSummary(id).total === 0)) { finish(); return; }
        triggerRef.current = trigger ?? null;
        setOpen(true);
    }, [user?.id, finish]);
    const cancel = () => { setOpen(false); triggerRef.current?.focus?.(); };
    const dialog = open && user ? (
        <LogoutDialog userId={user.id} onCancel={cancel} onKeep={finish}
            onDelete={async () => {
                // Lo que pueda enviarse se envía antes (con la sesión todavía válida); después se elimina lo de esta cuenta.
                await dataService.flushPendingForLogout(user.id);
                dataService.purgeLocalDataOf(user.id);
                finish();
            }} />
    ) : null;
    return { requestLogout, dialog };
}

/**
 * Aviso de lecturas sin sincronizar de la cuenta en sesión. No aparece por un envío en curso: solo si lleva más de un
 * minuto pendiente o si el navegador está sin conexión. Mientras la sesión siga abierta no caducan.
 */
export const PendingSyncNotice: React.FC = () => {
    const { user } = useAuth();
    const [state, setState] = useState<{ count: number; offline: boolean; unsaved: number; expired: { count: number; at: number } | null }>({ count: 0, offline: false, unsaved: 0, expired: null });
    useEffect(() => {
        if (!user?.id) { setState({ count: 0, offline: false, unsaved: 0, expired: null }); return; }
        const read = () => {
            const s = dataService.pendingSyncStatus(user.id);
            const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
            const stale = s.oldestAddedAt !== null && Date.now() - s.oldestAddedAt > 60_000;
            setState({ count: s.count > 0 && (offline || stale || s.unsaved > 0) ? s.count : 0, offline, unsaved: s.unsaved, expired: s.expired });
        };
        read();
        const t = window.setInterval(read, 15_000);
        window.addEventListener('online', read); window.addEventListener('offline', read); window.addEventListener('focus', read);
        return () => { window.clearInterval(t); window.removeEventListener('online', read); window.removeEventListener('offline', read); window.removeEventListener('focus', read); };
    }, [user?.id]);
    if (state.count === 0 && !state.expired) return null;
    const box = 'mb-3 flex items-start gap-2 rounded-lg p-3 text-xs';
    return (
        <>
            {/* V9 65E-C4 — lo que caducó sin enviarse mientras la cuenta no usaba este equipo: se dice, no se calla. */}
            {state.expired && user?.id && (
                <div role="status" data-testid="pending-expired-notice" className={`${box} bg-red-50 dark:bg-red-900/20 text-red-900 dark:text-red-100`}>
                    <CloudOff size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                    <span>
                        {plural(state.expired.count, 'lectura guardada en este equipo se eliminó', 'lecturas guardadas en este equipo se eliminaron')} sin enviarse
                        {Number.isFinite(state.expired.at) ? ` el ${dateOf(state.expired.at)}` : ''}, al cumplirse {dataService.pendingRetentionLabel} sin que entraras aquí con tu cuenta. Eso no se sumó a tu progreso.{' '}
                        <button type="button" data-testid="pending-expired-ack" className="underline font-semibold" onClick={() => { dataService.acknowledgeExpiredPending(user.id); setState((s) => ({ ...s, expired: null })); }}>Entendido</button>
                    </span>
                </div>
            )}
            {state.count > 0 && (
                <p role="status" data-testid="pending-sync-notice" className={`${box} bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-100`}>
                    <CloudOff size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                    <span>
                        {plural(state.count, 'lectura sin sincronizar', 'lecturas sin sincronizar')} en este equipo.{' '}
                        {state.offline ? 'El envío se hará cuando vuelva la conexión.' : 'El envío se hará en cuanto el servidor responda.'}{' '}
                        {state.unsaved > 0
                            ? <strong data-testid="pending-unsaved">No queda espacio en este equipo para guardar más: {plural(state.unsaved, 'lectura solo se conserva', 'lecturas solo se conservan')} mientras esta ventana siga abierta. Conéctate para enviarlas antes de cerrarla.</strong>
                            : <>Si cierras sesión antes, quedan guardadas aquí {dataService.pendingRetentionLabel}.</>}
                    </span>
                </p>
            )}
        </>
    );
};

export default LogoutDialog;
