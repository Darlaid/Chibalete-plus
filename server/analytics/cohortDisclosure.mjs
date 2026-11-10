/**
 * cohortDisclosure.mjs — CHP-V8.1-PROD-01 (DIR-V81-05).
 *
 * Umbral de divulgación de agregados de `insights.db` por cohorte: un agregado de
 * grupo, club, colegio u organización solo se muestra con AL MENOS 5 lectores
 * distintos (MIN_COHORT_READERS) y sin inferencias por diferencia entre un total
 * y un subconjunto.
 *
 * Regla:
 *  1. cohorte < 5 lectores ⇒ se suprime;
 *  2. para cada otro ámbito de la MISMA organización (sus grupos y la propia
 *     organización) que contenga a este o esté contenido en él, la diferencia
 *     de lectores debe ser 0 o ≥ 5. Si no, restar los dos agregados describiría
 *     a 1–4 personas ⇒ se suprimen los dos (la regla es simétrica);
 *  3. ningún subámbito contenido en este puede tener 1–4 lectores (se aislaría
 *     restando los demás agregados visibles: org − g1 − g2 = g3), y lo que queda
 *     fuera de la unión de sus subámbitos debe ser 0 o ≥ 5.
 *
 * La cohorte lectora es la de `resolveGroupReaderCohort` (autoridad única:
 * membresía vigente − mediadores). No cambia nada del detalle individual que un
 * mediador consulta con A2 y C005 (ámbito `user`), ni lo que ve el administrador.
 * La respuesta suprimida conserva la forma del endpoint y NUNCA informa el tamaño.
 *
 * Fuera de esta regla (documentado): solapamientos parciales entre grupos no
 * anidados y diferencias en el tiempo por altas o bajas de la cohorte.
 */
import fs from 'node:fs';
import { GROUPS_DB, USERS_DB } from '../config.js';
import { resolveGroupReaderCohort } from './readerCohort.mjs';

export const MIN_COHORT_READERS = 5;
const GROUP_TYPES = new Set(['group', 'club']);
const ORG_TYPES = new Set(['school', 'organization']);

const parse = (file) => { const v = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(v) ? v : []; };
/** Fuentes canónicas (las mismas que el materializer). Lanza si no se pueden leer. */
export function loadCohortSources() { return { groups: parse(GROUPS_DB), users: parse(USERS_DB) }; }

const readersOfGroup = (group, sources) => new Set(resolveGroupReaderCohort(group, sources.users, { allGroups: sources.groups }).readerIds);
const orgOfGroup = (g) => g?.organizationId ?? null;

/**
 * Lectores de un ámbito agregado, o null si el ámbito no es de cohorte (user, all…).
 * Organización: unión de los lectores de sus grupos.
 */
export function readersOfScope(scopeType, scopeId, sources) {
    const t = String(scopeType), id = String(scopeId);
    if (GROUP_TYPES.has(t)) {
        const g = sources.groups.find((x) => x?.id === id);
        return g ? readersOfGroup(g, sources) : new Set();
    }
    if (ORG_TYPES.has(t)) {
        const out = new Set();
        for (const g of sources.groups) if (orgOfGroup(g) === id) for (const r of readersOfGroup(g, sources)) out.add(r);
        return out;
    }
    return null;
}

const isSubset = (a, b) => { for (const x of a) if (!b.has(x)) return false; return true; };

/**
 * ¿Se puede mostrar el agregado de este ámbito?
 * @returns {{ allowed: boolean, reason?: 'cohort_below_min'|'complement_below_min'|'cohort_unavailable' }}
 */
export function cohortDisclosure(scopeType, scopeId, { sources = null, min = MIN_COHORT_READERS } = {}) {
    const t = String(scopeType);
    if (!GROUP_TYPES.has(t) && !ORG_TYPES.has(t)) return { allowed: true }; // user (A2/C005), all, cohortes tipadas: otra regla
    let src;
    try { src = sources ?? loadCohortSources(); } catch { return { allowed: false, reason: 'cohort_unavailable' }; }
    const mine = readersOfScope(t, scopeId, src);
    if (mine.size < min) return { allowed: false, reason: 'cohort_below_min' };
    // Ámbitos comparables de la misma organización: sus grupos y la organización.
    const org = GROUP_TYPES.has(t) ? orgOfGroup(src.groups.find((g) => g?.id === String(scopeId))) : String(scopeId);
    const others = [];
    for (const g of src.groups) {
        if (!g?.id || (GROUP_TYPES.has(t) && g.id === String(scopeId))) continue;
        if (org !== null && orgOfGroup(g) !== org) continue;
        if (org === null) continue; // grupo sin organización: solo se compara consigo mismo
        others.push(readersOfGroup(g, src));
    }
    if (GROUP_TYPES.has(t) && org !== null) others.push(readersOfScope('organization', org, src));
    const covered = new Set();
    let hasNested = false;
    for (const other of others) {
        if (other.size === 0) continue;
        const inside = isSubset(other, mine), outside = isSubset(mine, other);
        const diff = Math.abs(mine.size - other.size);
        // Par anidado: total − subconjunto describiría a 1–4 personas.
        if ((inside || outside) && diff > 0 && diff < min) return { allowed: false, reason: 'complement_below_min' };
        if (inside && other.size < mine.size) {
            // Un subámbito pequeño dentro de este se aislaría restando los demás agregados visibles.
            if (other.size < min) return { allowed: false, reason: 'complement_below_min' };
            hasNested = true;
            for (const r of other) covered.add(r);
        }
    }
    // Lo que queda fuera de la unión de los subámbitos (total − Σ subconjuntos).
    if (hasNested) {
        let rest = 0;
        for (const r of mine) if (!covered.has(r)) rest++;
        if (rest > 0 && rest < min) return { allowed: false, reason: 'complement_below_min' };
    }
    return { allowed: true };
}

/** Cuerpo suprimido con la forma del endpoint: sin valores y sin tamaño. */
export const suppressedAggregate = (base, reason) => ({ ...base, suppressed: true, reason, minCohort: MIN_COHORT_READERS });
