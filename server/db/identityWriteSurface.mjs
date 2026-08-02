/**
 * identityWriteSurface.mjs — CHP-IDDB-02B-A.
 *
 * Contrato versionado de las superficies que pueden mutar identidad. Existe
 * para que "escritor desconocido" sea un estado detectable y no una sorpresa:
 * el espejo solo acepta escrituras de un escritor registrado, y cualquier otra
 * vía queda expresamente bloqueada mientras el dual-write esté activo.
 *
 * Inventario verificado sobre el árbol real (CHP-IDDB-02B-A, Fase 1):
 *
 *   COVERED_BY_SEAM — pasan por writeJSON/writeJSONAsync de server.js, que es
 *   donde vive el hook. Cubren usuarios, grupos, reglas de acceso e
 *   instituciones. Es la única superficie que el runtime HTTP ejercita.
 *
 *   BLOCKED_WHEN_DUAL_WRITE — writeJsonAtomic de groupMembershipService. No lo
 *   invoca ningún módulo del servidor (solo scripts), escribe sin pasar por el
 *   seam y por tanto no puede espejarse. Con el dual-write encendido se niega
 *   en vez de divergir en silencio.
 *
 *   OUT_OF_BAND — escritores fuera del proceso del API (scripts sueltos,
 *   edición manual del fichero). No son interceptables por definición: se
 *   detectan por reconciliación, no por hook.
 */

export const WRITE_SURFACE_CONTRACT_VERSION = '1.0.0';

/** Dominios de identidad espejables. `access` se conserva del modelo v1. */
export const IDENTITY_DOMAINS = ['users', 'groups', 'access', 'institutions'];

export const WRITE_SURFACES = Object.freeze([
    { id: 'server.writeJSON', kind: 'COVERED_BY_SEAM', module: 'server/server.js',
      domains: ['users', 'groups', 'access', 'institutions'],
      note: 'seam único: todas las rutas HTTP de mutación de identidad desembocan aquí' },
    { id: 'server.writeJSONAsync', kind: 'COVERED_BY_SEAM', module: 'server/server.js',
      domains: ['users'],
      note: 'auto-upgrade de rol y lastLoginAt' },
    { id: 'groupMembershipService.writeJsonAtomic', kind: 'BLOCKED_WHEN_DUAL_WRITE',
      module: 'server/groupMembershipService.js', domains: ['users', 'groups'],
      note: 'sin llamadores en el servidor; solo scripts. Se bloquea con dual-write activo' },
    { id: 'out-of-band.script', kind: 'OUT_OF_BAND', module: '(fuera del proceso del API)',
      domains: ['users', 'groups', 'access', 'institutions'],
      note: 'no interceptable; se detecta por reconciliación' },
]);

const REGISTERED = new Set(WRITE_SURFACES.filter(s => s.kind === 'COVERED_BY_SEAM').map(s => s.id));

/** Resuelve el dominio de identidad de un fichero, o null si no lo es. */
export function domainOf(file, paths) {
    if (!file || !paths) return null;
    if (file === paths.usersDb) return 'users';
    if (file === paths.groupsDb) return 'groups';
    if (file === paths.accessDb) return 'access';
    if (file === paths.schoolsDb) return 'institutions';
    return null;
}

/**
 * Un escritor no registrado no puede espejar. Devuelve la clasificación del
 * rechazo en vez de lanzar: el espejo nunca rompe el flujo canónico.
 */
export function assertRegisteredWriter(writerId) {
    return REGISTERED.has(writerId) ? null : 'UNREGISTERED_WRITER';
}

/**
 * Guard para las superficies expresamente bloqueadas: con el dual-write
 * encendido, escribir sin espejo divergiría en silencio, así que se niega.
 * @returns {string|null} motivo del bloqueo, o null si puede proceder.
 */
export function blockedWhenDualWrite({ dualWriteEnabled, domain }) {
    if (!dualWriteEnabled) return null;
    if (!domain) return null;
    return 'IDENTITY_WRITE_SURFACE_BLOCKED_UNDER_DUAL_WRITE';
}
