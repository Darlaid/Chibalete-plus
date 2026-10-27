import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { dataService } from '../services/dataService';
import type { Content, Publisher, RightsEligibility, RightsRegistry, RightsVersion } from '../types';
import { Scale, ChevronLeft, CheckCircle, AlertTriangle, Plus, Trash, Save, X, Copy } from 'lucide-react';
import {
    RIGHTS_CAPABILITIES, CAPABILITY_LABELS, LEGAL_STATUS_LABELS, ECONOMIC_STATUS_LABELS, SETTLEMENT_CLASS_LABELS,
    emptyRightsForm, formFromVersion, buildRightsBody, sharesTotalBp, reasonLabel, serverErrorLabel, isoToBogotaText,
} from '../utils/rightsForm.mjs';

// V1.4 / U1 DERECHOS-UI-01 — derechos contractuales por obra (F2-A).
// Usa solo GET/POST /api/admin/rights/:contentId… (append-only): no hay
// edición ni borrado de versiones; cada cambio es una versión nueva. Registrar
// una versión no activa por sí sola la liquidación: eso lo dice el veredicto de
// elegibilidad del servidor. Solo administración (ruta y API).

type RightsFormState = ReturnType<typeof emptyRightsForm>;

const ECONOMIC_TYPES = ['libro', 'libro_album'];
const inputCls = 'w-full p-2.5 bg-gray-50 dark:bg-gray-700/50 border border-gray-300 dark:border-gray-600 rounded-lg';

const pct = (bp: number) => `${(bp / 100).toLocaleString('es-CO', { maximumFractionDigits: 2 })} %`;
const alphaText = (a: number | null) => (a == null ? '—' : `${(a * 100).toLocaleString('es-CO', { maximumFractionDigits: 4 })} %`);

const AdminDerechos: React.FC = () => {
    const { contentId = '' } = useParams<{ contentId: string }>();
    const { user } = useAuth();
    const [content, setContent] = useState<Content | null>(null);
    const [publishers, setPublishers] = useState<Publisher[] | null>(null);
    const [registry, setRegistry] = useState<RightsRegistry | null>(null);
    const [eligibility, setEligibility] = useState<RightsEligibility | null>(null);
    const [loadError, setLoadError] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState<RightsFormState>(emptyRightsForm());
    const [errors, setErrors] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    // El resumen de errores queda arriba del formulario: se enfoca para que se vea y se anuncie.
    const errorsRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => { if (errors.length) errorsRef.current?.focus(); }, [errors]);

    const load = useCallback(async () => {
        const [reg, elig, pubs] = await Promise.all([
            dataService.getRights(contentId),
            dataService.getRightsEligibility(contentId),
            dataService.getAdminPublishers(),
        ]);
        setLoadError(reg === null || pubs === null);
        setRegistry(reg);
        setEligibility(elig);
        setPublishers(pubs);
        setContent(dataService.getContenidos(['administrador']).find(c => c.id === contentId) ?? null);
    }, [contentId]);

    // Al cambiar de obra no se arrastra nada de la anterior (aviso, formulario, datos).
    useEffect(() => {
        setRegistry(null); setEligibility(null); setNotice(null); setErrors([]); setShowForm(false);
        load();
    }, [load]);

    const publisherById = useMemo(() => new Map((publishers || []).map(p => [p.id, p])), [publishers]);
    const activePublishers = useMemo(() => (publishers || []).filter(p => p.status === 'active'), [publishers]);
    const nameOf = (id: string | null | undefined) => {
        if (!id) return '—';
        const p = publisherById.get(id);
        return p ? (p.tradeName || p.legalName) : id;
    };

    if (!user || !user.roles.includes('administrador')) {
        return <div className="p-8 text-center text-red-500">Acceso restringido a administradores.</div>;
    }

    const responsibleId = registry?.publisherId ?? content?.publisherId ?? null;
    const isEconomicType = !!content && ECONOMIC_TYPES.includes(content.tipo);
    const versions = registry?.versions ?? [];
    const effective = versions.find(v => v.id === registry?.effectiveVersionId) ?? null;
    const latest = versions.length ? versions[versions.length - 1] : null;
    const now = Date.now();
    const todayBogota = new Date(now - 5 * 3600_000).toISOString().slice(0, 10);

    const openForm = (from: RightsVersion | null) => {
        setForm(from ? formFromVersion(from) : emptyRightsForm());
        setErrors([]);
        setNotice(null);
        setShowForm(true);
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        const { errors: errs, body } = buildRightsBody(form, {
            publisherId: responsibleId,
            isEconomicType,
            activePublisherIds: activePublishers.map(p => p.id),
        });
        setErrors(errs);
        if (!body) return;
        setSaving(true);
        try {
            const saved = await dataService.createRightsVersion(contentId, body);
            setShowForm(false);
            await load();
            setNotice(`Versión ${saved.versionNo} registrada (Acta «${saved.actRef}»). Registrar una versión no activa por sí sola la liquidación: revisa el veredicto de elegibilidad.`);
        } catch (err: any) {
            setErrors([serverErrorLabel(err?.code, err?.message)]);
        } finally {
            setSaving(false);
        }
    };

    const setShare = (i: number, patch: Partial<{ publisherId: string; pct: string }>) =>
        setForm(f => ({ ...f, shares: f.shares.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
    const totalBp = sharesTotalBp(form.shares);

    return (
        <div className="p-4 md:p-8 min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200">
            <Link to="/subir-contenido?clase=libros" className="inline-flex items-center text-sm text-indigo-600 dark:text-indigo-400 hover:underline mb-4">
                <ChevronLeft size={16} aria-hidden="true" /> Catálogo administrativo
            </Link>
            <header className="mb-6">
                <h1 className="text-3xl font-bold flex items-center text-indigo-700 dark:text-indigo-400">
                    <Scale className="mr-3" size={32} aria-hidden="true" /> Derechos de la obra
                </h1>
                <p className="text-gray-500 dark:text-gray-400 max-w-3xl">
                    Registro contractual por Acta. Cada cambio es una versión nueva; las anteriores se conservan sin modificarse.
                    La editorial responsable identifica la obra; los beneficiarios y sus porcentajes los fija la matriz de participaciones.
                </p>
            </header>

            {loadError && (
                <div role="alert" className="mb-6 p-4 rounded-xl border border-red-200 bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-200 text-sm">
                    No se pudo cargar el registro de derechos o de editoriales. No registres versiones hasta que cargue.
                </div>
            )}
            {notice && <div role="status" className="mb-4 p-3 rounded-lg bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-200 text-sm">{notice}</div>}

            <section aria-labelledby="dr-obra" className="mb-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 grid md:grid-cols-2 gap-4 text-sm">
                <div>
                    <h2 id="dr-obra" className="text-lg font-bold mb-2">{content?.titulo || contentId}</h2>
                    <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
                        <dt className="text-gray-500">Identificador</dt><dd className="font-mono">{contentId}</dd>
                        <dt className="text-gray-500">Autor</dt><dd>{content?.autor || '—'}</dd>
                        <dt className="text-gray-500">Tipo</dt><dd>{content?.tipo || '—'}{content && !isEconomicType && ' (no liquidable en V1)'}</dd>
                        <dt className="text-gray-500">Estado en catálogo</dt><dd>{content?.status || '—'}</dd>
                        <dt className="text-gray-500">Editorial responsable</dt><dd>{nameOf(responsibleId)}{content?.imprint ? ` · sello ${content.imprint}` : ''}</dd>
                    </dl>
                </div>
                <div>
                    <h3 className="font-bold mb-2">Elegibilidad económica (hoy)</h3>
                    {eligibility === null ? (
                        <p className="text-gray-500">{loadError ? 'Sin datos.' : 'Consultando…'}</p>
                    ) : eligibility.eligible ? (
                        <p role="status" className="flex items-center gap-2 text-green-800 dark:text-green-300"><CheckCircle size={16} aria-hidden="true" /> Elegible para liquidación con la versión vigente.</p>
                    ) : (
                        <div role="status">
                            <p className="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-medium"><AlertTriangle size={16} aria-hidden="true" /> No elegible. Motivos:</p>
                            <ul className="list-disc ml-6 mt-1 text-gray-600 dark:text-gray-300">
                                {eligibility.reasons.map(r => <li key={r}>{reasonLabel(r)}</li>)}
                            </ul>
                        </div>
                    )}
                    {registry && (
                        <p className="mt-3 text-xs text-gray-500">
                            Cumplimiento de permisos en el servidor: <strong>{registry.enforcementMode}</strong>
                            {registry.enforcementMode === 'off' && ' (los permisos se registran, pero aún no restringen el acceso a la obra).'}
                        </p>
                    )}
                </div>
            </section>

            <section aria-labelledby="dr-hist" className="mb-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-x-auto">
                <div className="flex flex-wrap items-center justify-between gap-2 p-4">
                    <h2 id="dr-hist" className="text-lg font-bold">Historial de versiones</h2>
                    {!showForm && registry && publishers && (
                        <div className="flex gap-2">
                            {latest && (
                                <button type="button" onClick={() => openForm(effective ?? latest)} className="inline-flex items-center px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 font-semibold hover:bg-gray-200 dark:hover:bg-gray-600">
                                    <Copy size={16} className="mr-1" aria-hidden="true" /> Nueva versión a partir de la {effective ? 'versión en efecto' : 'última'}
                                </button>
                            )}
                            <button type="button" onClick={() => openForm(null)} className="inline-flex items-center px-3 py-2 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700">
                                <Plus size={16} className="mr-1" aria-hidden="true" /> Registrar versión desde un Acta
                            </button>
                        </div>
                    )}
                </div>
                {versions.length === 0 ? (
                    <p className="px-4 pb-4 text-gray-500 text-sm">{registry ? 'Sin versiones registradas: la obra no tiene régimen de derechos.' : ''}</p>
                ) : (
                    <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 dark:bg-gray-700 text-gray-500 uppercase text-xs">
                            <tr>
                                <th scope="col" className="p-3">Versión</th>
                                <th scope="col" className="p-3">Acta</th>
                                <th scope="col" className="p-3">Vigencia</th>
                                <th scope="col" className="p-3">Estados</th>
                                <th scope="col" className="p-3">Alfa · minutos</th>
                                <th scope="col" className="p-3">Participaciones</th>
                                <th scope="col" className="p-3">Permisos</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700 align-top">
                            {[...versions].reverse().map(v => {
                                const scheduled = Date.parse(v.effectiveAt) > now;
                                return (
                                    <tr key={v.id}>
                                        <td className="p-3 whitespace-nowrap">
                                            <div className="font-bold">v{v.versionNo}</div>
                                            {v.id === registry?.effectiveVersionId && <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">En efecto</span>}
                                            {v.validUntil && v.validUntil < todayBogota && <span className="inline-flex ml-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">Vigencia vencida</span>}
                                            {scheduled && <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">Programada</span>}
                                            <div className="text-xs text-gray-500 mt-1">Rige desde {isoToBogotaText(v.effectiveAt)}</div>
                                            <div className="text-xs text-gray-400">Registrada {isoToBogotaText(v.createdAt)} · {v.createdBy}</div>
                                        </td>
                                        <td className="p-3">
                                            <div>{v.actRef}</div>
                                            <div className="text-xs text-gray-500">Firmada {v.actSignedOn}</div>
                                            <div className="text-xs text-gray-500">Editorial: {nameOf(v.publisherId)}</div>
                                            {v.notes && <div className="text-xs text-gray-400 mt-1 max-w-xs">{v.notes}</div>}
                                        </td>
                                        <td className="p-3 whitespace-nowrap">{v.validFrom} → {v.validUntil || 'indefinida'}</td>
                                        <td className="p-3 text-xs">
                                            <div>Jurídica: {LEGAL_STATUS_LABELS[v.legalStatus]}</div>
                                            <div>Económica: {ECONOMIC_STATUS_LABELS[v.economicStatus]}</div>
                                            <div>Liquidación: {SETTLEMENT_CLASS_LABELS[v.settlementClass]}</div>
                                        </td>
                                        <td className="p-3 text-xs">
                                            <div>Alfa: {alphaText(v.alpha)}</div>
                                            <div>Minutos: {v.expectedMinutes ?? '—'}</div>
                                        </td>
                                        <td className="p-3 text-xs">
                                            {v.shares.length === 0 ? '—' : v.shares.map(s => <div key={s.publisherId}>{nameOf(s.publisherId)}: {pct(s.shareBp)}</div>)}
                                        </td>
                                        <td className="p-3 text-xs">
                                            {RIGHTS_CAPABILITIES.map(cap => (
                                                <div key={cap} className={v.permissions[cap as keyof RightsVersion['permissions']] ? 'text-green-700 dark:text-green-400' : 'text-gray-400 line-through'}>
                                                    {CAPABILITY_LABELS[cap]}
                                                </div>
                                            ))}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </section>

            {showForm && (
                <form onSubmit={submit} noValidate className="mb-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6" aria-labelledby="dr-form-title">
                    <div className="flex items-center justify-between mb-2">
                        <h2 id="dr-form-title" className="text-lg font-bold">Nueva versión de derechos</h2>
                        <button type="button" onClick={() => setShowForm(false)} aria-label="Cerrar formulario" className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"><X size={18} /></button>
                    </div>
                    <p className="text-sm text-gray-500 mb-4">
                        Se registra como versión {versions.length + 1} para la editorial responsable <strong>{nameOf(responsibleId)}</strong>.
                        No modifica las versiones anteriores. Para que la obra sea elegible deben cumplirse todas las condiciones del veredicto.
                    </p>

                    {errors.length > 0 && (
                        <div ref={errorsRef} tabIndex={-1} role="alert" className="mb-4 p-3 rounded-lg outline-none bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-200 text-sm">
                            <ul className="list-disc ml-5">{errors.map(m => <li key={m}>{m}</li>)}</ul>
                        </div>
                    )}

                    <fieldset className="grid md:grid-cols-3 gap-4 mb-6">
                        <legend className="font-semibold mb-2">Acta y vigencia</legend>
                        <div className="md:col-span-3">
                            <label htmlFor="dr-actRef" className="block text-sm font-medium mb-1">Referencia del Acta</label>
                            <input id="dr-actRef" maxLength={200} value={form.actRef} onChange={e => setForm(f => ({ ...f, actRef: e.target.value }))} className={inputCls} />
                        </div>
                        <div>
                            <label htmlFor="dr-signed" className="block text-sm font-medium mb-1">Fecha de firma</label>
                            <input id="dr-signed" type="date" value={form.actSignedOn} onChange={e => setForm(f => ({ ...f, actSignedOn: e.target.value }))} className={inputCls} />
                        </div>
                        <div>
                            <label htmlFor="dr-from" className="block text-sm font-medium mb-1">Inicio de vigencia</label>
                            <input id="dr-from" type="date" value={form.validFrom} onChange={e => setForm(f => ({ ...f, validFrom: e.target.value }))} className={inputCls} />
                        </div>
                        <div>
                            <label htmlFor="dr-until" className="block text-sm font-medium mb-1">Fin de vigencia (opcional)</label>
                            <input id="dr-until" type="date" value={form.validUntil} onChange={e => setForm(f => ({ ...f, validUntil: e.target.value }))} className={inputCls} />
                        </div>
                        <div className="md:col-span-3">
                            <label htmlFor="dr-effective" className="block text-sm font-medium mb-1">Esta versión rige desde (hora de Colombia)</label>
                            <input id="dr-effective" type="datetime-local" value={form.effectiveAt} onChange={e => setForm(f => ({ ...f, effectiveAt: e.target.value }))} className={`${inputCls} md:w-72`} />
                            <p className="text-xs text-gray-500 mt-1">Una fecha futura deja la versión programada; hasta entonces rige la anterior.</p>
                        </div>
                    </fieldset>

                    <fieldset className="grid md:grid-cols-3 gap-4 mb-6">
                        <legend className="font-semibold mb-2">Estados</legend>
                        {([
                            ['legalStatus', 'Situación jurídica', LEGAL_STATUS_LABELS],
                            ['economicStatus', 'Estado económico', ECONOMIC_STATUS_LABELS],
                            ['settlementClass', 'Clase de liquidación', SETTLEMENT_CLASS_LABELS],
                        ] as const).map(([key, label, options]) => (
                            <div key={key}>
                                <label htmlFor={`dr-${key}`} className="block text-sm font-medium mb-1">{label}</label>
                                <select id={`dr-${key}`} value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} className={inputCls}>
                                    <option value="">Elegir…</option>
                                    {Object.entries(options).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                </select>
                            </div>
                        ))}
                        <p className="md:col-span-3 text-xs text-gray-500">
                            Guardar con estado económico «Pendiente» registra el Acta sin activar la liquidación. Solo «Activa» + «Liquidable» + situación «Vigente» la habilitan, junto con el resto de condiciones.
                        </p>
                    </fieldset>

                    <fieldset className="grid md:grid-cols-3 gap-4 mb-6">
                        <legend className="font-semibold mb-2">Condiciones económicas</legend>
                        <div>
                            <label htmlFor="dr-alpha" className="block text-sm font-medium mb-1">Porcentaje alfa contractual (%)</label>
                            <input id="dr-alpha" inputMode="decimal" value={form.alphaPct} onChange={e => setForm(f => ({ ...f, alphaPct: e.target.value }))} className={inputCls} placeholder="Sin definir" />
                        </div>
                        <div>
                            <label htmlFor="dr-minutes" className="block text-sm font-medium mb-1">Minutos esperados de lectura</label>
                            <input id="dr-minutes" inputMode="decimal" value={form.expectedMinutes} onChange={e => setForm(f => ({ ...f, expectedMinutes: e.target.value }))} className={inputCls} placeholder="Sin definir" />
                        </div>
                        <div className="md:col-span-3">
                            <div className="flex items-center justify-between mb-1">
                                <span id="dr-shares-label" className="text-sm font-medium">Matriz de participaciones entre titulares</span>
                                <span role="status" className={`text-xs font-semibold ${form.shares.length === 0 ? 'text-gray-500' : totalBp === 10000 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                                    Total: {pct(totalBp)}
                                </span>
                            </div>
                            <div role="group" aria-labelledby="dr-shares-label" className="space-y-2">
                                {form.shares.map((s, i) => (
                                    <div key={i} className="flex flex-wrap gap-2 items-center">
                                        <select aria-label={`Titular ${i + 1}`} value={s.publisherId} onChange={e => setShare(i, { publisherId: e.target.value })} className={`${inputCls} flex-1 min-w-[12rem]`}>
                                            <option value="">Elegir titular…</option>
                                            {activePublishers.map(p => <option key={p.id} value={p.id}>{p.tradeName || p.legalName} ({p.kind === 'editorial' ? 'editorial' : 'tercero'})</option>)}
                                        </select>
                                        <input aria-label={`Porcentaje del titular ${i + 1}`} inputMode="decimal" value={s.pct} onChange={e => setShare(i, { pct: e.target.value })} className={`${inputCls} w-28`} placeholder="%" />
                                        <button type="button" onClick={() => setForm(f => ({ ...f, shares: f.shares.filter((_, j) => j !== i) }))} aria-label={`Quitar titular ${i + 1}`}
                                            className="p-2 rounded-md bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-200"><Trash size={14} /></button>
                                    </div>
                                ))}
                            </div>
                            <button type="button" onClick={() => setForm(f => ({ ...f, shares: [...f.shares, { publisherId: '', pct: '' }] }))}
                                className="mt-2 inline-flex items-center text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
                                <Plus size={14} className="mr-1" aria-hidden="true" /> Añadir titular
                            </button>
                            <p className="text-xs text-gray-500 mt-1">Debe sumar exactamente 100 %. La editorial responsable no figura automáticamente: añádela solo si el Acta la hace beneficiaria.</p>
                        </div>
                    </fieldset>

                    <fieldset className="mb-6">
                        <legend className="font-semibold mb-2">Permisos (todos expresos)</legend>
                        <div className="grid md:grid-cols-2 gap-2">
                            {RIGHTS_CAPABILITIES.map(cap => (
                                <div key={cap} role="radiogroup" aria-label={CAPABILITY_LABELS[cap]} className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg border border-gray-200 dark:border-gray-700">
                                    <span className="text-sm">{CAPABILITY_LABELS[cap]}</span>
                                    <span className="flex gap-3 text-sm">
                                        {(['yes', 'no'] as const).map(val => (
                                            <label key={val} className="inline-flex items-center gap-1">
                                                <input type="radio" name={`dr-perm-${cap}`} value={val} checked={form.permissions[cap] === val}
                                                    onChange={() => setForm(f => ({ ...f, permissions: { ...f.permissions, [cap]: val } }))} />
                                                {val === 'yes' ? 'Autorizado' : 'No autorizado'}
                                            </label>
                                        ))}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </fieldset>

                    <div className="mb-4">
                        <label htmlFor="dr-notes" className="block text-sm font-medium mb-1">Notas (opcional)</label>
                        <textarea id="dr-notes" rows={2} maxLength={2000} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className={`${inputCls} resize-none`} />
                    </div>

                    <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg bg-gray-200 dark:bg-gray-700 font-semibold">Cancelar</button>
                        <button type="submit" disabled={saving || loadError} className="inline-flex items-center px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:opacity-50">
                            <Save size={16} className="mr-1" aria-hidden="true" /> {saving ? 'Registrando…' : 'Registrar versión'}
                        </button>
                    </div>
                </form>
            )}
        </div>
    );
};

export default AdminDerechos;
