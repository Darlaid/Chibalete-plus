/**
 * accessService.js — Motor de Acceso Institucional (Fase E7+)
 *
 * Centraliza las funciones de resolución y decisión de acceso a contenido.
 * Factorizado desde server.js para claridad, trazabilidad y facilidad de prueba.
 *
 * Uso:
 *   const svc = createAccessService({ readJSON, log, normalizeUser, normalizeGroup,
 *                                      USERS_DB, GROUPS_DB, ACCESS_DB });
 *   const { canUserAccessContent, resolveUserContentAccess, getAccessibleContentIds } = svc;
 *
 * COMPATIBILIDAD: Todas las llamadas existentes en server.js funcionan sin cambio
 * gracias a la desestructuración del objeto de servicio.
 *
 * MODELO DE DECISIÓN (canUserAccessContent):
 *   1. ROL           → admin/mediador: siempre permitido (evalúa el caller, no este servicio)
 *   2. ASIGNACIÓN    → grupo con contentId asignado: permitido (evalúa el caller)
 *   3. SCOPE ENGINE  → access_db.json reglas por scope user/group/organization
 *   4. LEGACY        → group.availableContentIds / schoolConfig (evalúa el caller si legacyFallback)
 */

/**
 * @param {{
 *   readJSON: (path: string) => any,
 *   log: (msg: string, type?: string) => void,
 *   normalizeUser: (u: object) => object,
 *   normalizeGroup: (g: object) => object,
 *   USERS_DB: string,
 *   GROUPS_DB: string,
 *   ACCESS_DB: string,
 * }} deps
 */
export function createAccessService({ readJSON, log, normalizeUser, normalizeGroup, USERS_DB, GROUPS_DB, ACCESS_DB, fallbackMode = 'open' }) {

    /**
     * Resuelve el catálogo efectivo de un usuario a través del Scope Engine.
     * Consolida reglas para user.id, grupos a los que pertenece, y su organización.
     *
     * @returns {{ titleIds: string[], collectionIds: string[], appliedRules: string[], hasBroadAccess: boolean }}
     */
    function resolveUserContentAccess(userId) {
        const users = readJSON(USERS_DB);
        const rawUser = users.find(u => u.id === userId);
        if (!rawUser) {
            return { titleIds: [], collectionIds: [], appliedRules: [], hasBroadAccess: false };
        }
        const user = normalizeUser(rawUser);

        // Grupos donde es mediador o miembro (memberIds como fuente canónica, groupIds como fallback)
        const groups = readJSON(GROUPS_DB).map(normalizeGroup);
        const userGroups = groups.filter(g =>
            (g.mediatorIds && g.mediatorIds.includes(userId)) ||
            (g.memberIds   && g.memberIds.includes(userId))   ||
            (user.groupIds && user.groupIds.includes(g.id))
        );
        const resolvedGroupIds = [...new Set(userGroups.map(g => g.id))];

        // CHP-ID-GROUPS-RECON-01B: `organizationId` es la única autoridad de
        // organización. Antes se caía al string `colegio`, de modo que una regla
        // podía aplicar por coincidencia de nombre. En producción hay 0 reglas
        // con scope 'organization', así que retirar el fallback no cambia
        // ninguna decisión vigente; sí cierra la vía textual.
        const organizationId = user.organizationId || null;

        const accessRules = readJSON(ACCESS_DB);
        const now = Date.now();

        const appliedRules = [];
        const effectiveTitleIds = new Set();
        const effectiveCollectionIds = new Set();

        accessRules.forEach(rule => {
            // Ignorar reglas expiradas
            if (typeof rule.expiresAt === 'number' && Number.isFinite(rule.expiresAt) && now > rule.expiresAt) {
                log(`[ACCESS] Rule expired: ${rule.id} (scope=${rule.scope})`, 'ACCESS');
                return;
            }

            let applies = false;
            let via = null;

            if (rule.scope === 'user'         && rule.scopeId === userId)                  { applies = true; via = `user(${userId})`; }
            if (rule.scope === 'group'         && resolvedGroupIds.includes(rule.scopeId)) { applies = true; via = `group(${rule.scopeId})`; }
            if (rule.scope === 'organization'  && organizationId && rule.scopeId === organizationId) { applies = true; via = `org(${rule.scopeId})`; }

            if (applies) {
                appliedRules.push(rule.id);
                if (rule.titleIds)      rule.titleIds.forEach(id => effectiveTitleIds.add(id));
                if (rule.collectionIds) rule.collectionIds.forEach(id => effectiveCollectionIds.add(id));
                log(`[ACCESS] Rule applied: ${rule.id} via ${via} (+${rule.titleIds?.length || 0} titles, +${rule.collectionIds?.length || 0} collections)`, 'ACCESS');
            }
        });

        log(`[ACCESS] Scope resolved for user ${userId}: ${appliedRules.length} rules → ${effectiveTitleIds.size} titles, ${effectiveCollectionIds.size} collections`, 'ACCESS');

        return {
            titleIds:      Array.from(effectiveTitleIds),
            collectionIds: Array.from(effectiveCollectionIds),
            appliedRules,
            hasBroadAccess: false,
        };
    }

    /**
     * Valida si un usuario tiene acceso a un contenido específico vía Scope Engine.
     * Si legacyFallback=true, el caller debe continuar con las políticas legacy de grupo/org.
     *
     * @returns {{ allowed: boolean, legacyFallback: boolean, reason: string }}
     */
    function canUserAccessContent(userId, contentId, content) {
        const scopeData = resolveUserContentAccess(userId);

        // Sin reglas activas: comportamiento según fallbackMode
        if (scopeData.appliedRules.length === 0) {
            if (fallbackMode === 'restricted') {
                log(`[ACCESS] user ${userId} → content ${contentId} → DENIED via SCOPE_NO_RULES (restricted mode)`, 'ACCESS');
                return { allowed: false, legacyFallback: false, reason: 'Sin reglas activas y modo restringido activo.' };
            }
            log(`[ACCESS] user ${userId} → content ${contentId} → SCOPE_FALLBACK (open mode, no active rules)`, 'ACCESS');
            return { allowed: true, legacyFallback: true, reason: 'Sin reglas estrictas aplicables. Evaluando fallback legacy...' };
        }

        // Concesión por título directo
        if (scopeData.titleIds.includes(contentId)) {
            log(`[ACCESS] user ${userId} → content ${contentId} → GRANTED via SCOPE_TITLE`, 'ACCESS');
            return {
                allowed: true,
                legacyFallback: false,
                reason: 'Aprobado por Título explícito (Scope Engine)',
            };
        }

        // Concesión por colección (content.parentId es el ID de colección)
        if (content.parentId && scopeData.collectionIds.includes(content.parentId)) {
            log(`[ACCESS] user ${userId} → content ${contentId} → GRANTED via SCOPE_COLLECTION (${content.parentId})`, 'ACCESS');
            return {
                allowed: true,
                legacyFallback: false,
                reason: 'Aprobado por Colección autorizada (Scope Engine)',
            };
        }

        // Política restrictiva activa y no autoriza este contenido
        log(`[ACCESS] user ${userId} → content ${contentId} → DENIED via SCOPE_ENGINE`, 'ACCESS');
        return {
            allowed: false,
            legacyFallback: false,
            reason: 'Acceso denegado. Posee política restrictiva que no autoriza este contenido.',
        };
    }

    /**
     * Retorna el conjunto de títulos y colecciones accesibles para un usuario.
     * Interfaz simplificada sobre resolveUserContentAccess para consultas de catálogo.
     *
     * @returns {{ titleIds: string[], collectionIds: string[], appliedRules: string[] }}
     */
    function getAccessibleContentIds(userId) {
        const data = resolveUserContentAccess(userId);
        return { titleIds: data.titleIds, collectionIds: data.collectionIds, appliedRules: data.appliedRules };
    }

    return { resolveUserContentAccess, canUserAccessContent, getAccessibleContentIds };
}
