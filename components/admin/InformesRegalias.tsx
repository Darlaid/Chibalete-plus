/**
 * InformesRegalias — CHP-EDITORIAL-ROYALTIES-2026-01 V1.4 U5 · REPORTES-01.
 *
 * Pestaña «Informes» del Panel Admin. Muestra el informe que calcula el
 * servidor (vista previa U2, simulación U3/U4 o cierre congelado U4) y el
 * acumulado trimestral. El navegador nunca calcula importes: los filtros y las
 * exportaciones se piden al servidor sobre el mismo resultado (`reference`).
 *
 * Operaciones habilitadas: registrar el INS con su soporte y crear un cierre
 * TÉCNICO con confirmación expresa. Sin cierres oficiales, pagos ni asignación
 * de pendientes (requieren autorización posterior).
 *
 * REPORTES-UX-01: orden de lectura A) encabezado y filtros, B) resumen del
 * periodo (estado, indicadores, datos técnicos en bloque secundario), C) obras,
 * D) detalle, exportación (una sola ubicación) y operaciones. Solo presentación.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle, ChevronDown, ChevronRight, FileDown, Loader2, Lock, Printer, RefreshCw, Scale } from 'lucide-react';
import { dataService } from '../../services/dataService';
import type { RoyaltyPeriodInput, RoyaltyReport, RoyaltyReportWork } from '../../types';

// REPORTES-FILTROS-01: mismo valor que `NO_IMPRINT` del servidor (obras sin sello asignado).
const NO_IMPRINT = '__sin_sello__';
const NO_FILTERS = { editorial: '', sello: '', titular: '', obra: '' };
const IMPRINT_STATUS: Record<string, string> = {
    none: 'Sin sello asignado', publisher_changed: 'La editorial cambió después del periodo: el sello actual no se aplica',
    not_in_catalog: 'Obra fuera del catálogo actual', not_historical: 'El cierre no congela el sello', unknown: '—',
};

const cop = (n: number | null | undefined) => (n == null ? '—' : `$ ${Number(n).toLocaleString('es-CO')}`);
const dec = (n: number | null | undefined, d = 3) => (n == null ? '—' : Number(n).toFixed(d));
const bogotaMonth = () => new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 7);
const quarterOf = (month: string) => `${month.slice(0, 4)}-Q${Math.floor((Number(month.slice(5, 7)) - 1) / 3) + 1}`;

const STATUS_STYLE: Record<string, string> = {
    PROVISIONAL: 'bg-amber-100 text-amber-800 border-amber-300',
    PROVISIONAL_INCOMPLETE: 'bg-amber-100 text-amber-800 border-amber-300',
    PROVISIONAL_TECHNICAL: 'bg-sky-100 text-sky-800 border-sky-300',
    TECHNICAL: 'bg-sky-100 text-sky-800 border-sky-300',
    OFFICIAL: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    DEFINITIVE: 'bg-emerald-100 text-emerald-800 border-emerald-300',
};
const SOURCE_LABEL: Record<string, string> = {
    preview: 'Vista previa (sin INS registrado)', simulation: 'Simulación sin guardar', close: 'Cierre congelado', quarter_closes: 'Suma de cierres mensuales',
};

const Card: React.FC<{ label: string; value: string; hint?: string }> = ({ label, value, hint }) => (
    <div className="min-w-0 bg-white dark:bg-gray-800 p-3 md:p-4 rounded-xl border border-gray-100 dark:border-gray-700">
        <p className="text-gray-500 text-xs font-bold uppercase tracking-wider">{label}</p>
        <p className="text-lg md:text-2xl font-bold mt-1 text-gray-800 dark:text-white tabular-nums break-words">{value}</p>
        {hint && <p className="text-xs text-gray-500 mt-1 break-words">{hint}</p>}
    </div>
);

// Detalle de una obra dentro del mismo periodo: elegibilidad económica (U2), reparto entre titulares y partes (U3).
const WorkDetail: React.FC<{ w: RoyaltyReportWork; kind: 'month' | 'quarter'; nameOf: (id: string | null) => string }> = ({ w, kind, nameOf }) => {
    const el = w.eligibility;
    const excluded = Object.entries(el?.episodes?.excludedByReason || {});
    return (
        <div className="grid gap-4 lg:grid-cols-2 text-sm text-gray-700 dark:text-gray-200 min-w-0">
            <div className="space-y-1 min-w-0">
                <p className="font-bold">Elegibilidad económica</p>
                <p className="text-xs text-gray-500">Lecturas que cuentan para regalías (Q), no métricas pedagógicas.</p>
                {kind === 'month' ? (
                    <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-xs">
                        <dt className="font-bold">Régimen de derechos</dt><dd>{el?.rightsRegime == null ? '—' : el.rightsRegime ? 'sí' : 'no (sin versión de derechos)'}</dd>
                        <dt className="font-bold">Episodios cualificados</dt><dd>{el?.episodes ? `${el.episodes.qualified} de ${el.episodes.total}` : '—'}</dd>
                        <dt className="font-bold">Días de presencia elegibles</dt><dd>{el?.eligibleDays ?? '—'}</dd>
                        <dt className="font-bold">Exclusiones</dt><dd className="font-mono break-all">{excluded.length ? excluded.map(([k, n]) => `${k}: ${n}`).join(' · ') : 'ninguna'}</dd>
                        <dt className="font-bold">Avisos</dt><dd className="font-mono break-all">{el?.flags?.length ? el.flags.join(' · ') : 'ninguno'}</dd>
                        {!!el?.publisherChanges?.length && <><dt className="font-bold">Cambio de editorial</dt>
                            <dd>{el.publisherChanges.map((c) => `${nameOf(c.from)} → ${nameOf(c.to)} (${c.changedAt.slice(0, 10)})`).join('; ')}</dd></>}
                    </dl>
                ) : (
                    <>
                        {el?.publisherChangedInQuarter && <p className="text-xs text-amber-800">La editorial responsable cambió entre meses: se muestra la del primer cierre.</p>}
                        <table className="text-xs"><thead><tr><th className="pr-3 text-left">Mes</th><th className="pr-3 text-right">Q</th><th className="pr-3 text-right">R</th><th className="pr-3 text-right">S</th><th className="text-right">MontoObra</th></tr></thead>
                            <tbody>{(w.months || []).map((m) => (
                                <tr key={m.period}><td className="pr-3">{m.period}</td><td className="pr-3 text-right tabular-nums">{m.Q}</td><td className="pr-3 text-right tabular-nums">{dec(m.R)}</td>
                                    <td className="pr-3 text-right tabular-nums">{dec(m.S)}</td><td className="text-right tabular-nums">{cop(m.montoObra)}</td></tr>
                            ))}</tbody></table>
                        <p className="text-xs text-gray-500">R y S son mensuales y no se suman en el trimestre.</p>
                    </>
                )}
            </div>
            <div className="space-y-1 min-w-0">
                <p className="font-bold">Reparto de la variable entre titulares</p>
                {!w.amounts ? <p className="text-xs text-gray-500">Sin importes: registra el INS del mes para simular el reparto.</p> : (
                    <>
                        <table className="text-xs"><thead><tr><th className="pr-3 text-left">Titular</th><th className="pr-3 text-right">Cobrable</th><th className="text-right">Retenido</th></tr></thead>
                            <tbody>{w.amounts.byHolder.map((h) => (
                                <tr key={h.publisherId ?? 'none'}><td className="pr-3">{h.name ?? 'sin titular (matriz incompleta)'}</td>
                                    <td className="pr-3 text-right tabular-nums">{cop(h.payable)}</td><td className="text-right tabular-nums">{cop(h.retained)}</td></tr>
                            ))}{!w.amounts.byHolder.length && <tr><td colSpan={3} className="text-gray-500">Sin participaciones (obra retenida, pendiente o sin importe)</td></tr>}</tbody></table>
                        <p className="text-xs text-gray-500">Pendiente {cop(w.amounts.pending)} = D1 {cop(w.amounts.pendingD1)} + D4 {cop(w.amounts.pendingD4)}. La Base de presencia se reparte por titular y días, no por obra.</p>
                        {kind === 'month' && !!w.parts?.length && (
                            <p className="text-xs text-gray-500">Partes: {w.parts.map((p) => `v${p.versionNos.join('+')} α ${p.alpha} · Q ${p.Q} · ${cop(p.amount)}`).join(' | ')}</p>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

const panel = 'bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700';
const h3 = 'font-bold text-gray-800 dark:text-white';
const th = 'px-3 py-2 text-left text-xs font-bold text-gray-600 dark:text-gray-300 uppercase whitespace-nowrap';
const thn = `${th} text-right`;
const td = 'px-3 py-2 text-sm text-gray-800 dark:text-gray-100';
const tdn = `${td} text-right tabular-nums whitespace-nowrap`;
const field = 'mt-1 bg-gray-50 dark:bg-gray-700 rounded-lg p-2 font-medium';
const fieldLabel = 'min-w-0 text-sm font-bold text-gray-700 dark:text-gray-200 flex flex-col';

const InformesRegalias: React.FC = () => {
    const [view, setView] = useState<'month' | 'quarter'>('month');
    const [month, setMonth] = useState(bogotaMonth());
    const [quarter, setQuarter] = useState(quarterOf(bogotaMonth()));
    const [filters, setFilters] = useState(NO_FILTERS);
    const [openWork, setOpenWork] = useState<string | null>(null);
    const [report, setReport] = useState<RoyaltyReport | null>(null);
    const [options, setOptions] = useState<RoyaltyReport | null>(null);
    const [inputs, setInputs] = useState<RoyaltyPeriodInput[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [insForm, setInsForm] = useState({ grossCop: '', deductionsCop: '0', supportRef: '' });
    const [confirmMonth, setConfirmMonth] = useState('');
    const [busy, setBusy] = useState(false);
    const errorRef = useRef<HTMLDivElement>(null);

    const periodParams = useMemo(() => (view === 'month' ? { month } : { quarter }), [view, month, quarter]);

    const load = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const unfiltered = await dataService.getRoyaltyReport(periodParams);
            setOptions(unfiltered);
            const hasFilters = !!(filters.editorial || filters.sello || filters.titular || filters.obra);
            setReport(hasFilters ? await dataService.getRoyaltyReport({ ...periodParams, ...filters }) : unfiltered);
            setInputs(view === 'month' ? await dataService.listRoyaltyPeriodInputs(month) : []);
        } catch (e: any) {
            setReport(null); setError(e.message || 'No se pudo cargar el informe');
        } finally { setLoading(false); }
    }, [periodParams, filters, view, month]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
    useEffect(() => { setFilters(NO_FILTERS); setOpenWork(null); setNotice(null); setConfirmMonth(''); }, [view, month, quarter]);

    // Opciones en cascada sobre el informe sin filtrar: editorial → sellos y obras; sello → obras.
    const imprintAvailable = options?.dimensions?.imprint === 'current_catalog';
    const allWorks = useMemo(() => options?.works || [], [options]);
    const inEditorial = (w: RoyaltyReportWork, ed: string) => !ed || w.responsiblePublisherId === ed;
    const inSello = (w: RoyaltyReportWork, se: string) => !se || (se === NO_IMPRINT ? !w.imprint : w.imprint === se);
    const editorialOptions = useMemo(() => {
        const m = new Map<string, string>();
        allWorks.forEach((w) => { if (w.responsiblePublisherId) m.set(w.responsiblePublisherId, w.responsibleName || w.responsiblePublisherId); });
        return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    }, [allWorks]);
    const selloOptions = useMemo(() => [...new Set<string>(allWorks.filter((w) => inEditorial(w, filters.editorial) && w.imprint).map((w) => w.imprint as string))]
        .sort((a, b) => a.localeCompare(b)), [allWorks, filters.editorial]);
    const obraOptions = useMemo(() => allWorks.filter((w) => inEditorial(w, filters.editorial) && inSello(w, filters.sello))
        .map((w) => [w.contentId, w.title || w.contentId] as const), [allWorks, filters.editorial, filters.sello]);
    const titularOptions = useMemo(() => {
        const scoped = new Set(allWorks.filter((w) => inEditorial(w, filters.editorial) && inSello(w, filters.sello)).flatMap((w) => w.beneficiaries));
        const narrowed = !!(filters.editorial || filters.sello);
        return (options?.holders || []).filter((h) => !narrowed || scoped.has(h.publisherId))
            .map((h) => [h.publisherId, h.name] as const).sort((a, b) => a[1].localeCompare(b[1]));
    }, [options, allWorks, filters.editorial, filters.sello]);
    // Al cambiar un nivel, se descartan las selecciones inferiores que ya no pertenecen a él.
    const changeFilter = (key: keyof typeof NO_FILTERS, value: string) => {
        const next = { ...filters, [key]: value };
        if (key === 'editorial') {
            if (next.sello && next.sello !== NO_IMPRINT && !allWorks.some((w) => inEditorial(w, next.editorial) && w.imprint === next.sello)) next.sello = '';
        }
        if (key === 'editorial' || key === 'sello') {
            if (next.obra && !allWorks.some((w) => w.contentId === next.obra && inEditorial(w, next.editorial) && inSello(w, next.sello))) next.obra = '';
        }
        setFilters(next); setOpenWork(null);
    };
    const nameOf = (id: string | null) => (id ? (options?.holders.find((h) => h.publisherId === id)?.name ?? editorialOptions.find(([k]) => k === id)?.[1] ?? id) : '—');

    const exportUrl = (format: 'csv' | 'html') => (report
        ? dataService.royaltyReportUrl({ ...periodParams, ...filters, format, expectReference: report.reference.value }) : '#');

    const submitIns = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true); setError(null); setNotice(null);
        try {
            const gross = Number(insForm.grossCop), ded = Number(insForm.deductionsCop);
            if (!Number.isInteger(gross) || !Number.isInteger(ded) || gross < 0 || ded < 0) throw new Error('Recaudo y deducciones deben ser pesos enteros ≥ 0');
            const created = await dataService.createRoyaltyPeriodInput({ period: month, grossCop: gross, deductionsCop: ded, supportRef: insForm.supportRef.trim() });
            setNotice(`INS registrado: ${cop(created.insCop)} (soporte ${created.supportRef}).`);
            setInsForm({ grossCop: '', deductionsCop: '0', supportRef: '' });
            await load();
        } catch (err: any) { setError(err.message); } finally { setBusy(false); }
    };

    const latestInput = inputs[inputs.length - 1] || null;
    const canClose = view === 'month' && report?.source === 'simulation' && !!latestInput;
    const submitClose = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!latestInput || confirmMonth !== month) return;
        setBusy(true); setError(null); setNotice(null);
        try {
            const c = await dataService.createRoyaltyTechnicalClose({ month, periodInputId: latestInput.id, confirmMonth });
            setNotice(`Cierre técnico ${c.period} registrado (sha256 ${c.snapshotSha256.slice(0, 12)}…). No autoriza pagos.`);
            setConfirmMonth('');
            await load();
        } catch (err: any) { setError(err.message); } finally { setBusy(false); }
    };

    const r = report;
    const workCols = r?.kind === 'month' ? 11 : 9;
    return (
        <div className="animate-in fade-in space-y-6 min-w-0">
            {/* A. Encabezado y filtros */}
            <section aria-labelledby="inf-titulo" className={`${panel} p-4 space-y-4`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 id="inf-titulo" className="text-xl font-bold text-gray-900 dark:text-white flex items-center"><Scale className="mr-2" size={20} /> Informes de regalías</h2>
                    <button type="button" onClick={load} disabled={loading} className="px-4 py-2 bg-indigo-50 dark:bg-gray-700 text-indigo-700 dark:text-indigo-300 rounded-lg text-sm font-bold flex items-center disabled:opacity-60">
                        {loading ? <Loader2 size={16} className="mr-2 animate-spin" /> : <RefreshCw size={16} className="mr-2" />} Actualizar
                    </button>
                </div>
                <div className="flex flex-wrap items-end gap-4">
                    <div role="group" aria-label="Tipo de informe" className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600">
                        {(['month', 'quarter'] as const).map((v) => (
                            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
                                className={`px-4 py-2 text-sm font-bold ${view === v ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300'}`}>
                                {v === 'month' ? 'Mensual' : 'Trimestral'}
                            </button>
                        ))}
                    </div>
                    {view === 'month' ? (
                        <label className={fieldLabel}>Mes
                            <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className={field} />
                        </label>
                    ) : (
                        <label className={fieldLabel}>Trimestre
                            <span className="flex gap-2 mt-1">
                                <input type="number" aria-label="Año" min={2026} max={2100} value={quarter.slice(0, 4)}
                                    onChange={(e) => /^\d{4}$/.test(e.target.value) && setQuarter(`${e.target.value}${quarter.slice(4)}`)} className="w-24 bg-gray-50 dark:bg-gray-700 rounded-lg p-2 font-medium" />
                                <select aria-label="Trimestre del año" value={quarter.slice(5)} onChange={(e) => setQuarter(`${quarter.slice(0, 4)}-${e.target.value}`)} className="bg-gray-50 dark:bg-gray-700 rounded-lg p-2 font-medium">
                                    {['Q1', 'Q2', 'Q3', 'Q4'].map((q) => <option key={q} value={q}>{q}</option>)}
                                </select>
                            </span>
                        </label>
                    )}
                    <label className={fieldLabel}>Editorial
                        <select value={filters.editorial} onChange={(e) => changeFilter('editorial', e.target.value)} className={`${field} max-w-[14rem]`}>
                            <option value="">Todas</option>
                            {editorialOptions.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
                        </select>
                    </label>
                    <label className={fieldLabel}>Sello
                        <select value={filters.sello} onChange={(e) => changeFilter('sello', e.target.value)} disabled={!imprintAvailable}
                            aria-describedby={imprintAvailable ? undefined : 'inf-sello-nota'} className={`${field} max-w-[14rem] disabled:opacity-60`}>
                            <option value="">Todos</option>
                            <option value={NO_IMPRINT}>Sin sello asignado</option>
                            {selloOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </label>
                    <label className={fieldLabel}>Libro
                        <select value={filters.obra} onChange={(e) => changeFilter('obra', e.target.value)} className={`${field} max-w-[14rem]`}>
                            <option value="">Todos</option>
                            {obraOptions.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
                        </select>
                    </label>
                    <label className={fieldLabel}>Titular
                        <select value={filters.titular} onChange={(e) => changeFilter('titular', e.target.value)} className={`${field} max-w-[14rem]`}>
                            <option value="">Todos</option>
                            {titularOptions.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
                        </select>
                    </label>
                    {(filters.editorial || filters.sello || filters.obra || filters.titular) && (
                        <button type="button" onClick={() => { setFilters(NO_FILTERS); setOpenWork(null); }} className="px-3 py-2 text-sm font-bold text-gray-600 dark:text-gray-300 underline">Quitar filtros</button>
                    )}
                </div>
                {options && !imprintAvailable && (
                    <p id="inf-sello-nota" className="text-xs text-gray-500">El sello no está disponible: este informe sale de cierres congelados, que no guardan el sello, y no se reconstruye con el sello actual.</p>
                )}
                {imprintAvailable && (
                    <p className="text-xs text-gray-500">Sello tomado del catálogo actual (no tiene historial); si la editorial de una obra cambió después del periodo, esa obra figura sin sello.</p>
                )}
            </section>

            {error && (
                <div ref={errorRef} tabIndex={-1} role="alert" className="p-3 rounded-lg border border-red-300 bg-red-50 text-red-800 text-sm font-medium">{error}</div>
            )}
            <div aria-live="polite">{notice && <div className="p-3 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-800 text-sm font-medium">{notice}</div>}</div>

            {loading && !r && <div className="flex justify-center p-10"><Loader2 size={32} className="animate-spin text-indigo-600" aria-label="Cargando informe" /></div>}

            {r && (
                <>
                    {/* B. Resumen del periodo */}
                    <section aria-labelledby="inf-estado" className={`${panel} p-4 space-y-4`}>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                            <h3 id="inf-estado" className="text-lg font-bold text-gray-900 dark:text-white">Resumen del periodo {r.period}</h3>
                            <span className={`px-3 py-1 rounded-full border text-xs font-extrabold ${STATUS_STYLE[r.status] || ''}`}>{r.statusLabel}</span>
                            <span className="text-xs text-gray-500">{SOURCE_LABEL[r.source]}</span>
                            <span className={`text-xs font-bold flex items-center ${r.reconciliation.ok ? 'text-emerald-700' : 'text-red-700'}`}>
                                {r.reconciliation.ok ? <CheckCircle size={14} className="mr-1" /> : <AlertTriangle size={14} className="mr-1" />}
                                {r.reconciliation.ok ? 'Conciliado al peso' : 'Conciliación fallida'}
                            </span>
                        </div>
                        {r.notExigible && (
                            <p className="p-2 border-2 border-red-600 text-red-700 font-extrabold text-sm rounded">PROVISIONAL — NO EXIGIBLE. No constituye liquidación ni obligación de pago.</p>
                        )}
                        <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Total del periodo completo{r.source === 'close' || r.source === 'quarter_closes' ? ' (cierre congelado)' : ''}</p>
                        {r.kind === 'month' && (
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                                <Card label="INS" value={r.ins ? cop(r.ins.insCop) : 'Sin INS'} hint={r.ins ? `Soporte: ${r.ins.supportRef}` : 'Registra el INS para simular importes'} />
                                <Card label="Bolsa de derechos 25 %" value={r.pools ? cop(r.pools.brd) : '—'} />
                                <Card label="Presencia 30 %" value={r.pools ? cop(r.pools.bgp) : '—'} hint={r.pools?.blcToBgp ? 'Σ S = 0: la BLC pasa a la presencia' : undefined} />
                                <Card label="Lectura cualificada 70 %" value={r.pools ? cop(r.pools.blc) : '—'} />
                            </div>
                        )}
                        {r.totals && (
                            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
                                {r.kind === 'quarter' && <Card label="BRD acumulada" value={cop(r.totals.brd)} />}
                                <Card label="Cobrable" value={cop(r.totals.payable)} />
                                <Card label="Retenido" value={cop(r.totals.retained)} hint="No cobrable hasta su liberación" />
                                <Card label="Pagado registrado" value={cop(r.totals.paid)} />
                                <Card label="Pendiente (no cobrable)" value={cop(r.totals.pendingTotal)}
                                    hint={`D1 ${cop(r.totals.pending.versionSplit)} · D4 ${cop(r.totals.pending.alphaComplement)} · D5 ${cop(r.totals.pending.bgpWithoutHolders)}`} />
                            </div>
                        )}
                        {r.kind === 'quarter' && !!r.missingMonths?.length && (
                            <p className="p-2 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 text-sm font-medium">Trimestre incompleto: faltan cierres de {r.missingMonths.join(', ')}.</p>
                        )}
                        {r.filters && r.visibleTotals && (
                            <div aria-labelledby="inf-subtotal" className="rounded-lg border border-indigo-200 dark:border-indigo-900 bg-indigo-50/60 dark:bg-gray-900/40 p-3 space-y-3">
                                <div>
                                    <h4 id="inf-subtotal" className="text-sm font-bold text-indigo-900 dark:text-indigo-200">Subtotal filtrado</h4>
                                    <p className="text-xs text-gray-600 dark:text-gray-300">Vista sobre el mismo resultado: las cifras de arriba son el total del periodo completo y no cambian. No se redistribuyen bolsas ni se recalcula S; R no se suma.</p>
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
                                    <Card label="Obras visibles" value={String(r.visibleTotals.works)} hint={`${r.visibleTotals.holders} titulares`} />
                                    <Card label="Q visible" value={String(r.visibleTotals.Q)} hint="Sesiones cualificadas" />
                                    <Card label="MontoObra visible" value={cop(r.visibleTotals.montoObra)} />
                                    <Card label={r.filters.titular ? 'Cobrable del titular en estas obras' : 'Cobrable por obras'} value={cop(r.visibleTotals.worksPayable)} hint="Variable; sin Base de presencia" />
                                    <Card label={r.filters.titular ? 'Retenido del titular en estas obras' : 'Retenido por obras'} value={cop(r.visibleTotals.worksRetained)} />
                                    {r.filters.titular
                                        ? <Card label="Saldo total del titular" value={cop(r.visibleTotals.payable)} hint={`Incluye Base y movimientos · retenido ${cop(r.visibleTotals.retained)}`} />
                                        : <Card label="Pendiente por obras" value={cop(r.visibleTotals.worksPending)} hint="D1 + D4, no cobrable" />}
                                </div>
                            </div>
                        )}
                        <dl aria-label="Datos técnicos del informe" className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-1 text-xs text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/40 rounded-lg p-3">
                            <div className="flex gap-2 min-w-0 lg:col-span-2"><dt className="font-bold shrink-0">Referencia</dt><dd className="font-mono break-all" title={r.reference.value}>{r.reference.kind}: {r.reference.value}</dd></div>
                            {r.cutoff && <div className="flex gap-2"><dt className="font-bold shrink-0">Corte</dt><dd>{r.cutoff}</dd></div>}
                            {r.ruleSetId && <div className="flex gap-2"><dt className="font-bold shrink-0">Rule set</dt><dd className="break-all">{r.ruleSetId}</dd></div>}
                            {r.closedAt && <div className="flex gap-2"><dt className="font-bold shrink-0">Cierre registrado</dt><dd>{r.closedAt}</dd></div>}
                            {r.kind === 'quarter' && <div className="flex gap-2"><dt className="font-bold shrink-0">Meses faltantes</dt><dd>{r.missingMonths?.length ? r.missingMonths.join(', ') : 'ninguno'}</dd></div>}
                            <div className="flex gap-2 min-w-0"><dt className="font-bold shrink-0">Fórmula S</dt><dd className="font-mono break-all">{r.scoreFormula ?? '—'}</dd></div>
                            {r.policies?.D1 && <div className="flex gap-2 min-w-0 lg:col-span-2"><dt className="font-bold shrink-0">D1</dt><dd>{r.policies.D1.id} ({r.policies.D1.status}): {r.policies.D1.basis}</dd></div>}
                        </dl>
                    </section>

                    {/* C. Desempeño de obras */}
                    <section aria-labelledby="inf-obras" className={panel}>
                        <div className="px-4 pt-4">
                            <h3 id="inf-obras" className={h3}>Desempeño de obras</h3>
                            {r.kind === 'month' && !r.ins && r.works.length > 0 && (
                                <p className="text-xs text-gray-500 mt-1">Sin INS registrado: los importes se calculan al registrar el INS del mes.</p>
                            )}
                        </div>
                        <div className="overflow-x-auto relative mt-2">
                            <table className="min-w-full">
                                <thead className="bg-gray-50 dark:bg-gray-700"><tr>
                                    <th className={th}>Obra</th><th className={th}>Editorial</th><th className={th}>Sello</th><th className={thn}>Q</th>
                                    {r.kind === 'month' && <><th className={thn}>R</th><th className={thn}>S</th></>}
                                    <th className={thn}>MontoObra</th><th className={thn}>Cobrable</th><th className={thn}>Retenido</th><th className={thn}>Pendiente</th>
                                    <th className={th}><span className="sr-only">Detalle</span></th>
                                </tr></thead>
                                <tbody>
                                    {r.works.map((w) => {
                                        const open = openWork === w.contentId;
                                        return (
                                            <React.Fragment key={w.contentId}>
                                                <tr className="border-t border-gray-100 dark:border-gray-700">
                                                    <td className={`${td} min-w-[10rem]`}>{w.title || w.contentId}</td><td className={td}>{w.responsibleName || '—'}</td>
                                                    <td className={`${td} ${w.imprint ? '' : 'text-gray-500'}`} title={w.imprint ? undefined : IMPRINT_STATUS[w.imprintStatus || 'unknown']}>
                                                        {w.imprint || (w.imprintStatus === 'none' ? 'Sin sello' : '—')}
                                                    </td>
                                                    <td className={tdn}>{w.Q}</td>
                                                    {r.kind === 'month' && <><td className={tdn}>{dec(w.R)}</td><td className={tdn}>{dec(w.S)}</td></>}
                                                    <td className={tdn}>{cop(w.montoObra)}</td><td className={tdn}>{cop(w.amounts?.payable)}</td>
                                                    <td className={tdn}>{cop(w.amounts?.retained)}</td><td className={tdn}>{cop(w.amounts?.pending)}</td>
                                                    <td className={td}>
                                                        <button type="button" aria-expanded={open} aria-controls={`inf-det-${w.contentId}`} onClick={() => setOpenWork(open ? null : w.contentId)}
                                                            className="flex items-center text-xs font-bold text-indigo-700 dark:text-indigo-300 whitespace-nowrap">
                                                            {open ? <ChevronDown size={14} className="mr-1" /> : <ChevronRight size={14} className="mr-1" />} Detalle
                                                        </button>
                                                    </td>
                                                </tr>
                                                {open && (
                                                    <tr id={`inf-det-${w.contentId}`} className="bg-gray-50 dark:bg-gray-900/40">
                                                        <td colSpan={workCols} className="px-4 py-3"><div className="sticky left-4 max-w-[calc(100vw-4rem)] md:max-w-none"><WorkDetail w={w} kind={r.kind} nameOf={nameOf} /></div></td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        );
                                    })}
                                    {!r.works.length && (
                                        <tr><td className={`${td} text-gray-500`} colSpan={workCols}>
                                            {r.filters ? 'Ninguna obra coincide con los filtros aplicados.'
                                                : r.kind === 'month' ? 'Sin lecturas cualificadas en este mes: todavía no hay obras con lecturas que repartir.'
                                                    : 'Sin obras en los cierres de este trimestre.'}
                                        </td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </section>

                    {/* D. Detalle y operaciones */}
                    {r.holders.length > 0 && (
                        <section aria-labelledby="inf-titulares" className={panel}>
                            <h3 id="inf-titulares" className={`${h3} px-4 pt-4`}>Titulares y editoriales</h3>
                            {r.filters && <p className="px-4 text-xs text-gray-500">Las columnas de saldo son del titular en todo el periodo (Base, todas sus obras y movimientos); «En obras visibles» es solo su variable cobrable en la selección.</p>}
                            <div className="overflow-x-auto relative mt-2">
                                <table className="min-w-full">
                                    <thead className="bg-gray-50 dark:bg-gray-700"><tr>
                                        <th className={th}>Titular</th><th className={thn}>Base</th><th className={thn}>Variable</th><th className={thn}>Liquidado</th>
                                        <th className={thn}>Ajustes y recibidos</th><th className={thn}>Pagado</th><th className={thn}>Retenido</th><th className={thn}>Saldo cobrable</th>
                                        {r.filters && <th className={thn}>En obras visibles</th>}
                                    </tr></thead>
                                    <tbody>
                                        {r.holders.map((h) => (
                                            <tr key={h.publisherId} className="border-t border-gray-100 dark:border-gray-700">
                                                <td className={`${td} min-w-[10rem]`}>{h.name}{h.belowPayoutThreshold ? <span className="ml-2 text-xs text-gray-500">(bajo umbral)</span> : null}</td>
                                                <td className={tdn}>{cop(h.base ?? h.settledBase)}</td><td className={tdn}>{cop(h.variable ?? h.settledVariable)}</td><td className={tdn}>{cop(h.settledTotal)}</td>
                                                <td className={tdn}>{cop(h.adjustments + h.carriedIn - h.transferredOut)}</td><td className={tdn}>{cop(h.paid)}</td>
                                                <td className={tdn}>{cop(h.retained)}</td><td className={`${tdn} font-bold`}>{cop(h.payable)}</td>
                                                {r.filters && <td className={tdn} title="Variable cobrable de este titular en las obras visibles">{h.visibleWorks ? cop(h.visibleWorks.payable) : '—'}</td>}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </section>
                    )}

                    {r.movements.length > 0 && (
                        <section aria-labelledby="inf-mov" className={panel}>
                            <h3 id="inf-mov" className={`${h3} px-4 pt-4`}>Movimientos</h3>
                            <div className="overflow-x-auto relative mt-2">
                                <table className="min-w-full">
                                    <thead className="bg-gray-50 dark:bg-gray-700"><tr>
                                        <th className={th}>Periodo</th><th className={th}>Tipo</th><th className={th}>Titular</th><th className={thn}>Importe</th><th className={th}>Motivo</th><th className={th}>Fecha</th>
                                    </tr></thead>
                                    <tbody>
                                        {r.movements.map((m) => (
                                            <tr key={m.id} className="border-t border-gray-100 dark:border-gray-700">
                                                <td className={td}>{m.period || r.period}</td><td className={td}>{m.kind}{m.targetPeriod ? ` → ${m.targetPeriod}` : ''}</td><td className={td}>{m.name}</td>
                                                <td className={tdn}>{cop(m.amountCop)}</td><td className={`${td} min-w-[12rem]`}>{m.reason}</td><td className={`${td} whitespace-nowrap`}>{m.createdAt}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </section>
                    )}

                    <section aria-labelledby="inf-export" className={`${panel} p-4 flex flex-wrap items-center justify-between gap-3`}>
                        <div className="min-w-0">
                            <h3 id="inf-export" className={h3}>Exportar informe</h3>
                            <p className="text-xs text-gray-500">Mismo resultado y referencia que en pantalla{r.filters ? ', con los filtros aplicados' : ''}.</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <a href={exportUrl('csv')} download className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold flex items-center"><FileDown size={16} className="mr-2" /> Exportar CSV (Excel)</a>
                            <a href={exportUrl('html')} target="_blank" rel="noopener" className="px-4 py-2 bg-indigo-50 dark:bg-gray-700 text-indigo-700 dark:text-indigo-300 rounded-lg text-sm font-bold flex items-center"><Printer size={16} className="mr-2" /> Versión imprimible (PDF)</a>
                        </div>
                    </section>

                    {view === 'month' && r.source !== 'close' && (
                        <section aria-labelledby="inf-ops" className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border-2 border-dashed border-indigo-200 dark:border-gray-600 space-y-4">
                            <div>
                                <h3 id="inf-ops" className={h3}>Operaciones del periodo {month}</h3>
                                <p className="text-xs text-gray-500">Estas acciones registran datos; la consulta de arriba no modifica nada.</p>
                            </div>
                            <div className="grid md:grid-cols-2 gap-6">
                                <form onSubmit={submitIns} className="space-y-2 min-w-0" aria-label="Registrar INS">
                                    <p className="font-bold text-gray-800 dark:text-white">Registrar INS de {month}</p>
                                    {latestInput && <p className="text-xs text-gray-500">Vigente: {cop(latestInput.insCop)} · soporte {latestInput.supportRef} ({inputs.length} registro{inputs.length > 1 ? 's' : ''}). Registrar otro lo reemplaza para la simulación; el anterior se conserva.</p>}
                                    <label className="block text-sm">Recaudo elegible (COP)<input required inputMode="numeric" value={insForm.grossCop} onChange={(e) => setInsForm({ ...insForm, grossCop: e.target.value })} className="mt-1 w-full bg-gray-50 dark:bg-gray-700 rounded-lg p-2" /></label>
                                    <label className="block text-sm">Deducciones contractuales (COP)<input required inputMode="numeric" value={insForm.deductionsCop} onChange={(e) => setInsForm({ ...insForm, deductionsCop: e.target.value })} className="mt-1 w-full bg-gray-50 dark:bg-gray-700 rounded-lg p-2" /></label>
                                    <label className="block text-sm">Referencia del soporte<input required value={insForm.supportRef} onChange={(e) => setInsForm({ ...insForm, supportRef: e.target.value })} className="mt-1 w-full bg-gray-50 dark:bg-gray-700 rounded-lg p-2" /></label>
                                    <button type="submit" disabled={busy} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold disabled:opacity-50">Registrar INS</button>
                                </form>
                                <form onSubmit={submitClose} className="space-y-2 min-w-0" aria-label="Cierre técnico">
                                    <p className="font-bold text-gray-800 dark:text-white flex items-center"><Lock size={16} className="mr-2" /> Cierre técnico</p>
                                    <p className="text-xs text-gray-600 dark:text-gray-300">Congela esta simulación con su hash. Es único por periodo y no se puede modificar. <strong>No autoriza pagos ni causación oficial.</strong> Los cierres oficiales no se habilitan desde aquí.</p>
                                    {canClose ? (
                                        <>
                                            <label className="block text-sm">Escribe <span className="font-mono">{month}</span> para confirmar
                                                <input value={confirmMonth} onChange={(e) => setConfirmMonth(e.target.value)} className="mt-1 w-full bg-gray-50 dark:bg-gray-700 rounded-lg p-2 font-mono" /></label>
                                            <button type="submit" disabled={busy || confirmMonth !== month} className="px-4 py-2 bg-sky-700 text-white rounded-lg text-sm font-bold disabled:opacity-50">Crear cierre técnico</button>
                                        </>
                                    ) : <p className="text-sm text-gray-500">Requiere un INS registrado.</p>}
                                </form>
                            </div>
                        </section>
                    )}
                </>
            )}
        </div>
    );
};

export default InformesRegalias;
