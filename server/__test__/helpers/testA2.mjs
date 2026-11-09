/**
 * testA2.mjs — CHP-V8.1-CLOSE-02.
 *
 * Solo pruebas: registro A2 sintético para las suites cuyos mediadores consultan
 * o revisan a lectores sintéticos. Por defecto no hay registro (fallo cerrado);
 * una suite que lo necesita lo pide de forma explícita con `grantA2(ids)`.
 * Fija `CHP_A2_REGISTRY` en `process.env` para que lo hereden los servidores
 * que la suite lance con `...process.env`. Requiere la clave de prueba de
 * `testMode.mjs`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendA2Decision, appendDecisions } from '../../privacy/a2Registry.mjs';
import { ACCEPTANCE_DOCUMENTS } from '../../../utils/acceptanceDocuments.mjs';

export function a2RegistryPath() {
    if (!process.env.CHP_A2_REGISTRY) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_test_a2_'));
        process.env.CHP_A2_REGISTRY = path.join(dir, 'a2.jsonl');
        fs.writeFileSync(process.env.CHP_A2_REGISTRY, '');
    }
    return process.env.CHP_A2_REGISTRY;
}

/** A2 = Sí para cada id (o el estado indicado). */
export function grantA2(ids, status = 'granted') {
    const env = { CHP_A2_REGISTRY: a2RegistryPath() };
    for (const userId of ids) appendA2Decision({ userId, status, requestRef: `A2-SINT-${String(userId).replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 100)}` }, { env });
    return env.CHP_A2_REGISTRY;
}

/** V8.1-CLOSE-05: decisiones de un titular adulto sin institución (B2C), para activar cuentas en pruebas. */
export const ADULT_ACTIVATION = Object.freeze({ terms: true, termsVersion: ACCEPTANCE_DOCUMENTS.terms.version,
    dataNoticeVersion: ACCEPTANCE_DOCUMENTS.dataNotice.version, actingAs: 'titular', adultDeclared: true, A1: 'yes' });
/** V8.1-CLOSE-05: decisiones de un mediador (titular adulto con el compromiso 005). */
export const MEDIATOR_ACTIVATION = Object.freeze({ terms: true, termsVersion: ACCEPTANCE_DOCUMENTS.terms.version, adultDeclared: true,
    mediatorCommitment: true, mediatorVersion: ACCEPTANCE_DOCUMENTS.mediator.version });

/**
 * V8.1-CLOSE-06A (G-01): A1 concedida y verificada (ficha C.1 sintética) para cada id, con fecha del
 * acto antigua para cubrir los hechos sintéticos de la suite. Sin esto, el ledger no emite XP.
 */
export function grantA1(ids, { status = 'granted', actDay = '2000-01-01', verification = 'verified' } = {}) {
    const env = { CHP_A2_REGISTRY: a2RegistryPath() };
    const decisions = [...new Set(ids)].map((userId) => ({ subjectId: userId, kind: 'A1', status, actDay, version: '004@1.0', medium: 'admin_record',
        capacity: 'legal_representative', verification, requestRef: `AUT-SINT-A1-${String(userId).replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 90)}` }));
    if (decisions.length) appendDecisions(decisions, { env });
    return env.CHP_A2_REGISTRY;
}

/**
 * V8.1-CLOSE-06B: documentos declarados aprobados SOLO para pruebas (enlaces .invalid). En producción
 * los declara Dirección en `CHP_ACCEPTANCE_DOCUMENTS`; sin ellos la activación no se ofrece.
 */
export function approveTestDocuments() {
    const docs = Object.fromEntries(Object.values(ACCEPTANCE_DOCUMENTS).map((d) => [d.id, { version: d.version, url: `https://docs.example.invalid/${d.id}/${d.version}` }]));
    process.env.CHP_ACCEPTANCE_DOCUMENTS = JSON.stringify(docs);
    return process.env.CHP_ACCEPTANCE_DOCUMENTS;
}
