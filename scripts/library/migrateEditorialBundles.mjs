#!/usr/bin/env node
/**
 * migrateEditorialBundles.mjs — CHP-LIB-01 (plan: docs/ops/CHP_LIB_MIG_00.md).
 *
 * Migra los bundles/"Experiencias" (bundles_db.json, ya referencias por
 * contentIds) a colecciones+referencias EDITORIAL de Biblioteca.
 *
 * - dry-run por defecto: reporta sin escribir.
 * - --apply: escribe library_db.json SOLO si el dry-run es limpio
 *   (0 huérfanos, 0 conflictos). Idempotente por unicidad del store.
 * - NO muta bundles_db.json ni content.json (rollback = borrar library_db).
 * - Las estructuras isCollection:true de content.json NO se migran (decisión
 *   del ADR: son contenido canónico agrupado, no LibraryCollection).
 *
 * Uso: node scripts/library/migrateEditorialBundles.mjs [--apply] [--data-dir <dir>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeLibrary, addCollection, addReference } from '../../server/lib/libraryStore.js';

/**
 * Mapping puro (testeable): bundles → { doc, report }. Muta una COPIA del doc.
 */
export function mapBundlesToEditorial(bundles, contentList, existingDoc) {
    const doc = normalizeLibrary(JSON.parse(JSON.stringify(existingDoc ?? {})));
    const bookIds = new Set((contentList || []).map(c => c.id));
    const report = {
        bundlesDetected: 0,
        collectionsCreated: 0,
        referencesProposed: 0,
        referencesCreated: 0,
        duplicatesSkipped: 0,
        orphanContentIds: [],
        conflicts: [],
    };
    for (const bundle of Array.isArray(bundles) ? bundles : []) {
        if (!bundle || !bundle.id || !Array.isArray(bundle.contentIds)) {
            report.conflicts.push({ bundleId: bundle?.id ?? '(sin id)', reason: 'shape inválida' });
            continue;
        }
        report.bundlesDetected += 1;
        let col = doc.collections.find(c => c.layer === 'EDITORIAL' && c.name === String(bundle.name ?? bundle.id).trim());
        if (!col) {
            col = addCollection(doc, { layer: 'EDITORIAL', name: bundle.name ?? bundle.id, description: bundle.shortDescription ?? bundle.description ?? '' });
            col.published = true; // los bundles actuales están expuestos hoy → migran publicados
            report.collectionsCreated += 1;
        }
        bundle.contentIds.forEach((bookId, i) => {
            report.referencesProposed += 1;
            if (!bookIds.has(bookId)) {
                report.orphanContentIds.push({ bundleId: bundle.id, bookId });
                return;
            }
            const out = addReference(doc, { bookId, layer: 'EDITORIAL', collectionId: col.id, position: i }, (id) => bookIds.has(id));
            if (out.created) report.referencesCreated += 1;
            else report.duplicatesSkipped += 1;
        });
    }
    return { doc, report };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    const args = process.argv.slice(2);
    const apply = args.includes('--apply');
    const dirIdx = args.indexOf('--data-dir');
    const dataDir = dirIdx >= 0 ? args[dirIdx + 1] : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');

    const readJson = (f, fallback) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : fallback);
    const bundlesRaw = readJson(path.join(dataDir, 'bundles_db.json'), []);
    const bundles = Array.isArray(bundlesRaw) ? bundlesRaw : (bundlesRaw.value ?? []);
    const contentList = readJson(path.join(dataDir, 'content.json'), []);
    const libraryPath = path.join(dataDir, 'library_db.json');
    const existing = normalizeLibrary(readJson(libraryPath, {}));

    const { doc, report } = mapBundlesToEditorial(bundles, contentList, existing);
    const clean = report.orphanContentIds.length === 0 && report.conflicts.length === 0;

    console.log(`[LIB-MIG] modo=${apply ? 'APPLY' : 'DRY-RUN'} dataDir=${dataDir}`);
    console.log(JSON.stringify(report, null, 2));
    console.log(`[LIB-MIG] resultado: colecciones=${doc.collections.length} referencias=${doc.references.length} limpio=${clean}`);

    if (apply) {
        if (!clean) {
            console.error('[LIB-MIG] APPLY ABORTADO: hay huérfanos/conflictos (YELLOW-LIB-MIGRATION). Nada se escribió.');
            process.exit(2);
        }
        fs.writeFileSync(libraryPath, JSON.stringify(doc, null, 2));
        console.log(`[LIB-MIG] escrito ${libraryPath}`);
    }
}
