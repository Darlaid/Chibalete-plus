import React, { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, FileUp, ShieldCheck, AlertTriangle } from 'lucide-react';
import ChibaleteEpubReader, { type EpubOpenInfo, type EpubRelocateState } from '../components/epub-reader/ChibaleteEpubReader';

/**
 * CHP-CONTENT-CANONICAL-2026-01 3E.2 — SPIKE LOCAL del lector EPUB.
 * Ruta SOLO de desarrollo (#/dev/epub-reader, registrada bajo
 * import.meta.env.DEV): no existe en el build de producción, no aparece en
 * Biblioteca ni en la navegación. Abre un EPUB local (File) — nunca epub_url.
 */
const PILOT = {
    name: 'Aventuras_Alicia_Maravillas_EPUB_V4.epub',
    size: 49272977,
    sha256: 'b85b8dea87a87fbc30b0622ee83f1fe23d52e3bdc9b7d8879bd69ae97e045d37',
};

type Metrics = { hashMs?: number; openStart?: number; firstContentMs?: number; navigableMs?: number; heapMB?: number };

const sha256Hex = async (file: File) => {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};
const heapMB = () => {
    const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return m ? Math.round(m.usedJSHeapSize / 1048576) : undefined;
};

const DevEpubReader: React.FC = () => {
    const navigate = useNavigate();
    const [file, setFile] = useState<File | null>(null);
    const [check, setCheck] = useState<{ ok: boolean; msg: string } | null>(null);
    const [metrics, setMetrics] = useState<Metrics>({});
    const [info, setInfo] = useState<EpubOpenInfo | null>(null);
    const [loc, setLoc] = useState<EpubRelocateState | null>(null);
    const [audit, setAudit] = useState<unknown>(null);
    const adapterRef = useRef<{ auditImages: () => Promise<unknown> } | null>(null);
    const metricsRef = useRef<Metrics>({});
    const setM = (patch: Metrics) => { metricsRef.current = { ...metricsRef.current, ...patch }; setMetrics(metricsRef.current); };

    const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        setFile(null); setInfo(null); setLoc(null); setAudit(null); metricsRef.current = {}; setMetrics({});
        if (!f) return;
        if (f.size !== PILOT.size || f.name !== PILOT.name) {
            setCheck({ ok: false, msg: `Archivo no esperado: ${f.name} (${f.size} B). Se espera ${PILOT.name} (${PILOT.size} B).` });
            return;
        }
        setCheck({ ok: true, msg: 'Verificando SHA-256…' });
        const t = performance.now();
        const hash = await sha256Hex(f);
        setM({ hashMs: Math.round(performance.now() - t) });
        if (hash !== PILOT.sha256) { setCheck({ ok: false, msg: `SHA-256 distinto (${hash.slice(0, 12)}…). No se abre.` }); return; }
        setCheck({ ok: true, msg: `SHA-256 verificado (${hash.slice(0, 12)}…).` });
        setM({ openStart: performance.now() });
        setFile(f);
    };

    const onOpened = useCallback((i: EpubOpenInfo) => {
        setInfo(i);
        const s = metricsRef.current.openStart ?? performance.now();
        setM({ navigableMs: Math.round(performance.now() - s), heapMB: heapMB() });
    }, []);
    const onFirstRelocate = useCallback(() => {
        const s = metricsRef.current.openStart ?? performance.now();
        setM({ firstContentMs: Math.round(performance.now() - s) });
    }, []);
    const onRelocate = useCallback((s: EpubRelocateState) => {
        setLoc(s);
        console.debug('[EPUB_DEV] relocate', { fraction: s.fraction, section: s.sectionIndex, toc: s.tocLabel, cfi: s.cfi });
    }, []);

    // Estado dev expuesto para inspección/automatización local (solo en DEV).
    (window as unknown as Record<string, unknown>).__chpEpubDev = { info, loc, metrics, audit, runAudit: () => adapterRef.current?.auditImages().then((r) => { setAudit(r); return r; }) };

    if (file) {
        return (
            <>
                <ChibaleteEpubReader
                    file={file}
                    fallbackTitle="Alicia (EPUB piloto)"
                    onBack={() => { setFile(null); }}
                    onOpened={onOpened}
                    onFirstRelocate={onFirstRelocate}
                    onRelocate={onRelocate}
                    onAdapter={(a) => { adapterRef.current = a as never; }}
                />
                <details className="fixed bottom-20 md:bottom-3 left-3 z-[70] max-w-xs text-[11px] font-mono bg-black/80 text-green-300 rounded-xl p-2 border border-white/10">
                    <summary className="cursor-pointer text-white">dev state</summary>
                    <pre className="whitespace-pre-wrap break-all max-h-60 overflow-auto">{JSON.stringify({ layout: info?.layout, sections: info?.sectionCount, toc: info?.toc.length, metrics, loc: loc && { fraction: loc.fraction, section: loc.sectionIndex, toc: loc.tocLabel, cfi: loc.cfi, location: loc.location } }, null, 1)}</pre>
                    <button type="button" className="mt-1 px-2 py-1 rounded bg-indigo-600 text-white" onClick={() => adapterRef.current?.auditImages().then(setAudit)}>Auditar imágenes</button>
                    {audit ? <pre className="whitespace-pre-wrap break-all">{JSON.stringify(audit)}</pre> : null}
                </details>
            </>
        );
    }

    return (
        <main className="min-h-screen bg-gray-900 text-white flex items-center justify-center p-6">
            <div className="w-full max-w-lg rounded-3xl bg-white/5 border border-white/10 p-8 shadow-2xl">
                <p className="text-xs font-bold uppercase tracking-wider text-amber-300 mb-2">Solo desarrollo · 3E.2</p>
                <h1 className="text-2xl font-bold mb-2 flex items-center gap-2"><BookOpen className="text-indigo-400" /> Lector EPUB Chibalete+</h1>
                <p className="text-sm text-gray-300 mb-6">Abre el EPUB piloto desde tu equipo. No se sube nada ni se usa ningún contenido de producción.</p>
                <label htmlFor="dev-epub-file" className="flex items-center justify-center gap-2 px-6 py-4 rounded-full bg-indigo-600 hover:bg-indigo-500 font-bold cursor-pointer transition-all focus-within:ring-2 focus-within:ring-indigo-400">
                    <FileUp size={20} /> Elegir EPUB
                </label>
                <input id="dev-epub-file" type="file" accept=".epub,application/epub+zip" onChange={onPick} className="sr-only" />
                {check && (
                    <p role="status" className={`mt-4 flex items-start gap-2 text-sm ${check.ok ? 'text-green-300' : 'text-red-300'}`}>
                        {check.ok ? <ShieldCheck size={18} /> : <AlertTriangle size={18} />} {check.msg}
                    </p>
                )}
                <button type="button" onClick={() => navigate('/')} className="mt-6 text-sm text-gray-400 hover:text-white underline">Volver al inicio</button>
            </div>
        </main>
    );
};

export default DevEpubReader;
