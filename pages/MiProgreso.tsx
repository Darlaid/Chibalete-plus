/**
 * MiProgreso.tsx — CHP-GAMIFICACION-G4-UX-U3.
 *
 * Pantalla privada del lector (`/mi-progreso`, sin `:id`). Única fuente:
 * `GET /api/me/progress` (contrato U2). El navegador NO calcula XP, nivel ni
 * logros: solo traduce lo que responde el servidor (`utils/myProgressView.mjs`).
 * Nada se guarda en localStorage, sessionStorage ni caché: el estado vive en
 * memoria y se descarta al cambiar de usuario.
 *
 * Diseño: GAMIFICACION_G4_UX_01 §D.2–§D.5 (7 a 11 años): una columna, texto
 * siempre visible junto a cada barra, sin rankings, rachas ni animaciones.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { CheckCircle2, Circle, Sprout, Leaf, Award, Sparkles, RefreshCw, BookOpen, ChevronDown } from 'lucide-react';
import { dataService } from '../services/dataService';
import { useAuth } from '../context/AuthContext';
import { buildProgressView, classifyProgressResponse } from '../utils/myProgressView.mjs';

type View = NonNullable<ReturnType<typeof buildProgressView>>;
type Load =
    | { kind: 'loading' }
    | { kind: 'ok'; view: View }
    | { kind: 'off' | 'disabled' | 'unauthenticated' | 'forbidden' | 'unavailable' };

const card = 'bg-white dark:bg-gray-800 rounded-2xl shadow-md border border-gray-100 dark:border-gray-700 p-5';
const button = 'inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-xl font-semibold focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-400 focus-visible:ring-offset-2';

/** Barra accesible: el valor también va en texto visible. Sin animación. */
const Bar: React.FC<{ value: number; max: number; text: string; label: string }> = ({ value, max, text, label }) => (
    <div>
        <div
            role="progressbar"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={max}
            aria-valuenow={value}
            aria-valuetext={text}
            className="w-full h-4 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden border border-gray-300 dark:border-gray-600"
        >
            <div className="h-full rounded-full bg-emerald-600" style={{ width: `${max > 0 ? Math.round((value / max) * 100) : 0}%` }} />
        </div>
        <p className="mt-1 text-sm font-semibold text-gray-800 dark:text-gray-100">{text}</p>
    </div>
);

const Mark: React.FC<{ done: boolean; text: string }> = ({ done, text }) => (
    <li className="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-100">
        {done ? <CheckCircle2 size={18} className="text-emerald-700 dark:text-emerald-400 shrink-0" aria-hidden /> : <Circle size={18} className="text-gray-500 shrink-0" aria-hidden />}
        <span>{text}<span className="sr-only">{done ? ' (listo)' : ' (pendiente)'}</span></span>
    </li>
);

const TONE: Record<string, string> = {
    good: 'bg-emerald-50 text-emerald-900 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-100 dark:border-emerald-700',
    action: 'bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-900/30 dark:text-amber-100 dark:border-amber-700',
    waiting: 'bg-sky-50 text-sky-900 border-sky-300 dark:bg-sky-900/30 dark:text-sky-100 dark:border-sky-700',
    neutral: 'bg-gray-50 text-gray-800 border-gray-300 dark:bg-gray-900/40 dark:text-gray-100 dark:border-gray-600',
};

/** Vista presentacional pura (se prueba con render estático). */
export const MiProgresoView: React.FC<{ view: View }> = ({ view }) => {
    const LevelIcon = view.level.name === 'Brote' ? Leaf : Sprout;
    return (
        <div className="space-y-6">
            <section aria-labelledby="mp-nivel" className={card}>
                <h2 id="mp-nivel" className="text-lg font-bold text-gray-900 dark:text-white">Mi nivel</h2>
                <div className="mt-3 flex items-center gap-4">
                    <div className="p-3 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200 shrink-0">
                        <LevelIcon size={32} aria-hidden />
                    </div>
                    <div className="min-w-0">
                        <p className="text-2xl font-extrabold text-gray-900 dark:text-white">{view.level.name}</p>
                        <p className="text-base text-gray-700 dark:text-gray-200">Tienes {view.xp} XP en total</p>
                    </div>
                </div>
                {view.level.bar && (
                    <div className="mt-4 space-y-3">
                        <Bar {...view.level.bar} label={`Avance hacia ${view.level.nextName}`} />
                        {view.level.requirements.length > 0 && (
                            <>
                                <p className="text-sm text-gray-700 dark:text-gray-200">Para llegar a {view.level.nextName}:</p>
                                <ul className="space-y-1">{view.level.requirements.map((r) => <Mark key={r.key} done={r.done} text={r.text} />)}</ul>
                            </>
                        )}
                    </div>
                )}
                {view.level.reached && <p className="mt-4 font-semibold text-emerald-800 dark:text-emerald-300">{view.level.reached}</p>}
                {view.zero && view.canEarn && (
                    <div className="mt-4">
                        <p className="text-gray-800 dark:text-gray-100">Tu camino empieza aquí. Cuando escribas sobre una obra y tu mediador lo apruebe, verás crecer tu semilla.</p>
                        <Link to="/experiencias" className={`${button} mt-3 bg-indigo-700 text-white hover:bg-indigo-800`}>Ver experiencias</Link>
                    </div>
                )}
                {!view.canEarn && (
                    <div className="mt-4">
                        <p className="text-gray-800 dark:text-gray-100">Todavía no hay experiencias que sumen XP para ti. Puedes seguir leyendo en la Biblioteca.</p>
                        <Link to="/biblioteca" className={`${button} mt-3 bg-indigo-700 text-white hover:bg-indigo-800`}><BookOpen size={18} aria-hidden /> Ir a la Biblioteca</Link>
                    </div>
                )}
            </section>

            <section aria-labelledby="mp-obras" className={card}>
                <h2 id="mp-obras" className="text-lg font-bold text-gray-900 dark:text-white">Mis obras</h2>
                {view.works.length === 0 ? (
                    <p className="mt-2 text-gray-700 dark:text-gray-200">Aquí aparecerán las obras sobre las que escribas en una experiencia.</p>
                ) : (
                    <ul className="mt-3 space-y-4">
                        {view.works.map((w) => (
                            <li key={w.contentId} className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                                <h3 className="font-bold text-gray-900 dark:text-white break-words">{w.title}</h3>
                                <p className={`mt-2 inline-block rounded-lg border px-3 py-1 text-sm font-medium ${TONE[w.tone]}`}>
                                    <span className="sr-only">Estado: </span>{w.stateText}
                                </p>
                                {w.xp && (
                                    <div className="mt-3 space-y-2">
                                        <Bar value={w.xp.value} max={w.xp.max} text={w.xp.text} label={`XP reconocido en ${w.title}`} />
                                        <ul className="flex flex-wrap gap-x-4 gap-y-1">{w.marks.map((m) => <Mark key={m.label} done={m.done} text={m.label} />)}</ul>
                                    </div>
                                )}
                                {w.experienceId && (
                                    <Link to={`/experiencias/${encodeURIComponent(w.experienceId)}`}
                                        className={`${button} mt-3 border border-indigo-700 text-indigo-800 dark:text-indigo-200 dark:border-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30`}>
                                        Ver mi entrega<span className="sr-only"> sobre {w.title}</span>
                                    </Link>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section aria-labelledby="mp-historial" className={card}>
                <h2 id="mp-historial" className="text-lg font-bold text-gray-900 dark:text-white">Mi historial</h2>
                {view.history.length === 0 ? (
                    <p className="mt-2 text-gray-700 dark:text-gray-200">Aquí verás cada vez que tu mediador apruebe lo que escribiste y los XP que ganaste.</p>
                ) : (
                    <ol className="mt-3 space-y-3">
                        {view.history.map((h, i) => (
                            <li key={`${h.day}-${i}`} className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                                    <h3 className="font-bold text-gray-900 dark:text-white break-words">{h.label}: {h.title}</h3>
                                    <p className="font-bold text-emerald-800 dark:text-emerald-300">{h.text}</p>
                                </div>
                                <p className="mt-1 text-sm text-gray-700 dark:text-gray-200"><time dateTime={h.day}>{h.date}</time></p>
                                <p className="mt-1 text-gray-800 dark:text-gray-100">{h.why}</p>
                            </li>
                        ))}
                    </ol>
                )}
            </section>

            <section aria-labelledby="mp-logros" className={card}>
                <h2 id="mp-logros" className="text-lg font-bold text-gray-900 dark:text-white">Mis logros</h2>
                {view.earned.length === 0 && <p className="mt-2 text-gray-700 dark:text-gray-200">Tus logros aparecerán aquí cuando los consigas.</p>}
                {view.earned.length > 0 && (
                    <ul className="mt-3 space-y-3">
                        {view.earned.map((a) => (
                            <li key={a.id} className="flex items-start gap-3">
                                <Award size={24} className="text-amber-700 dark:text-amber-300 shrink-0" aria-hidden />
                                <div><p className="font-bold text-gray-900 dark:text-white">{a.title}</p><p className="text-gray-700 dark:text-gray-200">{a.body}</p></div>
                            </li>
                        ))}
                    </ul>
                )}
                {view.nextAchievement && (
                    <div className="mt-4 rounded-xl bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-700 p-4 flex items-start gap-3">
                        <Sparkles size={20} className="text-indigo-700 dark:text-indigo-300 shrink-0 mt-0.5" aria-hidden />
                        <p className="text-gray-900 dark:text-gray-100"><span className="font-bold">Siguiente posible: {view.nextAchievement.title}.</span> {view.nextAchievement.how}</p>
                    </div>
                )}
            </section>

            <section aria-labelledby="mp-cuenta" className={card}>
                <details className="group">
                    <summary className="cursor-pointer min-h-[44px] flex items-center justify-between gap-2 rounded-lg list-none focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-400">
                        <h2 id="mp-cuenta" className="text-lg font-bold text-gray-900 dark:text-white">Qué cuenta</h2>
                        <ChevronDown size={20} className="text-gray-700 dark:text-gray-200 shrink-0 group-open:rotate-180" aria-hidden />
                    </summary>
                    <div className="mt-2 space-y-2 text-gray-800 dark:text-gray-100">
                        <p>Ganas XP cuando escribes lo que piensas de una obra en una experiencia y tu mediador lo aprueba.</p>
                        <p>Cada obra tiene un máximo de XP. Lo alcanzas con tu primera reflexión aprobada y una segunda reflexión sobre la misma obra.</p>
                        <p>Leer, abrir páginas, escuchar audios o hablar con Leo no da XP. Puedes hacerlo todo lo que quieras: también te ayuda a aprender.</p>
                        <p>Tu progreso es solo tuyo. Nadie más ve tu nivel ni tus XP.</p>
                    </div>
                </details>
            </section>
        </div>
    );
};

/** Estados sin datos: nunca muestran 0 XP como sustituto. */
export const MiProgresoNotice: React.FC<{ kind: 'unauthenticated' | 'forbidden' | 'unavailable'; onRetry?: () => void; onLogin?: () => void }> = ({ kind, onRetry, onLogin }) => (
    <div className={`${card} text-center`} role="alert">
        {kind === 'unavailable' && (
            <>
                <p className="text-lg font-semibold text-gray-900 dark:text-white">No pudimos cargar tu progreso.</p>
                <p className="mt-1 text-gray-700 dark:text-gray-200">Tu avance está guardado. Intenta de nuevo en un momento.</p>
                <button type="button" onClick={onRetry} className={`${button} mt-4 bg-indigo-700 text-white hover:bg-indigo-800`}><RefreshCw size={18} aria-hidden /> Reintentar</button>
            </>
        )}
        {kind === 'unauthenticated' && (
            <>
                <p className="text-lg font-semibold text-gray-900 dark:text-white">Tu sesión terminó.</p>
                <p className="mt-1 text-gray-700 dark:text-gray-200">Vuelve a ingresar para ver tu progreso.</p>
                <button type="button" onClick={onLogin} className={`${button} mt-4 bg-indigo-700 text-white hover:bg-indigo-800`}>Ingresar de nuevo</button>
            </>
        )}
        {kind === 'forbidden' && <p className="text-lg font-semibold text-gray-900 dark:text-white">No tienes acceso a esta sección.</p>}
    </div>
);

const MiProgreso: React.FC = () => {
    const { user, logout } = useAuth();
    const [load, setLoad] = useState<Load>({ kind: 'loading' });
    const userId = user?.id ?? null;

    const fetchProgress = useCallback(async () => {
        setLoad({ kind: 'loading' });
        const { status, body } = await dataService.getMyProgress();
        const r = classifyProgressResponse(status, body);
        if (r.kind === 'ok') {
            const view = buildProgressView(r.data);
            setLoad(view ? { kind: 'ok', view } : { kind: 'unavailable' });
        } else {
            setLoad({ kind: r.kind });
        }
    }, []);

    // Cada cambio de persona descarta lo anterior y vuelve a pedir: nada persiste.
    useEffect(() => {
        setLoad({ kind: 'loading' });
        if (userId) void fetchProgress();
    }, [userId, fetchProgress]);

    if (load.kind === 'off' || load.kind === 'disabled') return <Navigate to="/" replace />;

    return (
        <div className="max-w-2xl mx-auto px-4 py-6 md:py-8">
            <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white mb-6">Mi progreso</h1>
            <div aria-live="polite" aria-busy={load.kind === 'loading'}>
                {load.kind === 'loading' && <p className="text-gray-700 dark:text-gray-200">Cargando tu progreso…</p>}
                {load.kind === 'ok' && <MiProgresoView view={load.view} />}
                {(load.kind === 'unavailable' || load.kind === 'unauthenticated' || load.kind === 'forbidden') && (
                    <MiProgresoNotice kind={load.kind} onRetry={() => void fetchProgress()} onLogin={logout} />
                )}
            </div>
        </div>
    );
};

export default MiProgreso;
