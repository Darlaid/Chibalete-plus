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

// ────────────────────────────────────────────────────────────────────────────
// CHP-ACCESS-PEDAGOGY-01D-B — PREDICATE ÚNICO DE MATERIAL PEDAGÓGICO
//
// Una sola clasificación, compartida por el listado de catálogo, el preflight
// de acceso y el autorizador de assets del edge. No usa título, nombre de
// fichero, carpeta, `publico_objetivo` ni IDs hardcodeados: solo `tipo` y
// `standalone`, que ya existen en el registro. No añade campos ni migra datos.
//
//   PEDAGOGY_RESTRICTED  tipo pedagógico y `standalone !== false`
//                        → material pedagógico independiente: solo mediador/admin
//   EMBEDDED_EXPERIENCE  tipo pedagógico con `standalone === false`
//                        → nodo de una Experience publicada: sigue siendo visible
//   GENERAL              cualquier otro contenido
//
// Para un asset de /uploads/ la clase se resuelve por sus REFERENCIAS en el
// catálogo, jamás por su ruta, carpeta o nombre de fichero:
//
//   PUBLIC_ASSET         referenciado como portada/ilustración — capa de
//                        presentación pública, aunque el registro sea pedagógico
//   GENERAL              alguna referencia sustantiva es general o Experience
//   PEDAGOGY_RESTRICTED  todas sus referencias sustantivas son pedagogía
//                        independiente
//   UNMAPPED_ASSET       sin referencia en el catálogo (APK, temporales, …)
// ────────────────────────────────────────────────────────────────────────────

/** Tipos cuyo material independiente queda reservado a mediadores y admin. */
export const PEDAGOGY_CONTENT_TYPES = Object.freeze([
    'articulo_pedagogico',
    'guia',
    'contexto_pedagogico',
]);

/**
 * Campos de PRESENTACIÓN: portadas, miniaturas e ilustraciones. Siguen siendo
 * públicos aunque el registro que los referencia sea pedagógico — esta unidad
 * protege el cuerpo del material, no su carátula.
 */
const PRESENTATION_ASSET_FIELDS = Object.freeze(['portada_url', 'ilustraciones_url']);

const UPLOADS_PREFIX = '/uploads/';

/**
 * Normaliza un valor del catálogo a su ruta `/uploads/…` comparable.
 *
 * `decode:false` para las rutas que YA vienen decodificadas una vez por
 * `normalizeUploadRequestPath`: volver a decodificarlas sería un segundo
 * decode sobre una entrada ya validada.
 */
function canonicalUploadPath(value, { decode = true } = {}) {
    if (typeof value !== 'string') return null;
    const at = value.indexOf(UPLOADS_PREFIX);
    if (at < 0) return null;
    let p = value.slice(at);
    const cut = p.search(/[?#]/);
    if (cut >= 0) p = p.slice(0, cut);
    if (decode) {
        try { p = decodeURIComponent(p); } catch { /* valor sin escapar: se compara literal */ }
    }
    return p.replace(/\/{2,}/g, '/');
}

function walkStrings(node, visit, depth = 0) {
    if (node == null || depth > 8) return;
    if (typeof node === 'string') { visit(node); return; }
    if (Array.isArray(node)) { for (const v of node) walkStrings(v, visit, depth + 1); return; }
    if (typeof node === 'object') { for (const v of Object.values(node)) walkStrings(v, visit, depth + 1); }
}

/** Rutas de presentación y rutas sustantivas que referencia un registro. */
function itemAssetPaths(item) {
    const presentation = new Set();
    const substantive = new Set();
    if (!item || typeof item !== 'object') return { presentation, substantive };
    for (const [key, value] of Object.entries(item)) {
        const bucket = PRESENTATION_ASSET_FIELDS.includes(key) ? presentation : substantive;
        walkStrings(value, (s) => { const p = canonicalUploadPath(s); if (p) bucket.add(p); });
    }
    return { presentation, substantive };
}

/**
 * Clase de un registro de contenido.
 * @returns {'PEDAGOGY_RESTRICTED'|'EMBEDDED_EXPERIENCE'|'GENERAL'}
 */
export function classifyContentItem(item) {
    if (!item || typeof item !== 'object') return 'GENERAL';
    const tipo = item.tipo ?? item.type ?? null;
    if (!PEDAGOGY_CONTENT_TYPES.includes(tipo)) return 'GENERAL';
    // `standalone === false` marca un nodo embebido en una Experience publicada:
    // los lectores llegan a él dentro de la Experience y deben seguir haciéndolo.
    if (item.standalone === false) return 'EMBEDDED_EXPERIENCE';
    return 'PEDAGOGY_RESTRICTED';
}

/** ¿Es este registro material pedagógico independiente? */
export function isPedagogyRestrictedItem(item) {
    return classifyContentItem(item) === 'PEDAGOGY_RESTRICTED';
}

// ────────────────────────────────────────────────────────────────────────────
// CHP-ACCESS-PEDAGOGY-01D-B-R3 — TTS GENERADO
//
// El audio de TTS no se referencia nunca en el catálogo: los productores lo
// escriben bajo una convención de RUTA y el frontend lo pide por convención.
//
//   ttsService.generateAudioForContent → /uploads/audio/<contentId>/manifest.json
//                                        /uploads/audio/<contentId>/chunk_….mp3
//   albumTtsService                    → /uploads/audio/<contentId>/album/<hash>.mp3
//                                                                  <hash>.json
//   server.js (borrado de contenido)   → rmSync(<uploads>/audio/<id>)
//
// El `contentId` ocupa SIEMPRE el primer segmento tras `/uploads/audio/`, sin
// depender de título ni de nombre humano. `ttsService` lo usa crudo;
// `albumTtsService` le aplica una normalización de segmento — se prueban las
// dos formas contra el `id` del catálogo, sin listas ni IDs hardcodeados.
//
// La clase se hereda del registro dueño, así que el audio de un material
// pedagógico independiente queda tan protegido como su PDF. Fuera de la
// convención (p. ej. la caché global `/uploads/audio/immersive/<hash>`, que
// es por hash de texto y no pertenece a ningún contenido) no hay dueño y la
// ruta conserva `UNMAPPED_ASSET`.
// ────────────────────────────────────────────────────────────────────────────

const AUDIO_PREFIX = `${UPLOADS_PREFIX}audio/`;

/** Normalización de segmento de `albumTtsService.safeSeg` (única copia local). */
const safeAudioSegment = (s) => String(s ?? '').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 80);

/**
 * Segmento de `contentId` de una ruta de TTS, o null si no cumple la
 * convención. NO decodifica: la ruta del edge ya pasó por
 * `normalizeUploadRequestPath`, y un segundo decode reabriría el traversal.
 */
function ttsContentSegment(uploadPath) {
    const p = canonicalUploadPath(uploadPath, { decode: false });
    if (!p || !p.startsWith(AUDIO_PREFIX)) return null;
    const rest = p.slice(AUDIO_PREFIX.length);
    const slash = rest.indexOf('/');
    // Sin fichero debajo no hay asset que servir (es el directorio del contenido).
    if (slash <= 0) return null;
    const seg = rest.slice(0, slash);
    if (seg === '.' || seg === '..' || /[\\\0]/.test(seg)) return null;
    return seg;
}

/**
 * Clase del registro dueño de una ruta de TTS, o null si no hay dueño.
 * Si varios ids colapsaran al mismo segmento normalizado, gana el más
 * restrictivo: la protección no puede depender de un empate.
 */
function ttsOwnerClass(uploadPath, contentList) {
    const seg = ttsContentSegment(uploadPath);
    if (!seg) return null;

    let owner = null;
    for (const item of Array.isArray(contentList) ? contentList : []) {
        const id = item?.id;
        if (typeof id !== 'string' || id.length === 0) continue;
        if (id !== seg && safeAudioSegment(id) !== seg) continue;
        const cls = classifyContentItem(item);
        if (cls === 'PEDAGOGY_RESTRICTED') return 'PEDAGOGY_RESTRICTED';
        owner = owner ?? cls;
    }
    return owner;
}

/**
 * Clase de una ruta de /uploads/ según sus referencias en el catálogo y, para
 * el audio generado, según el registro dueño de la convención de TTS.
 * @returns {'PEDAGOGY_RESTRICTED'|'EMBEDDED_EXPERIENCE'|'PUBLIC_ASSET'|'GENERAL'|'UNMAPPED_ASSET'}
 */
export function classifyUploadPath(uploadPath, contentList) {
    const target = canonicalUploadPath(uploadPath);
    if (!target) return 'UNMAPPED_ASSET';

    let referenced = false;
    let presentationRef = false;
    let openSubstantiveRef = false;
    let restrictedSubstantiveRef = false;

    for (const item of Array.isArray(contentList) ? contentList : []) {
        const { presentation, substantive } = itemAssetPaths(item);
        if (presentation.has(target)) { referenced = true; presentationRef = true; }
        if (substantive.has(target)) {
            referenced = true;
            if (classifyContentItem(item) === 'PEDAGOGY_RESTRICTED') restrictedSubstantiveRef = true;
            else openSubstantiveRef = true;
        }
    }

    // Sin referencia en el catálogo: el audio de TTS hereda la clase de su
    // contenido; lo demás sigue sin mapear.
    if (!referenced) return ttsOwnerClass(uploadPath, contentList) ?? 'UNMAPPED_ASSET';
    if (presentationRef) return 'PUBLIC_ASSET';
    // Una sola referencia general o de Experience basta para no restringir:
    // el fichero compartido general/pedagógico se trata como general.
    if (openSubstantiveRef) return 'GENERAL';
    if (restrictedSubstantiveRef) return 'PEDAGOGY_RESTRICTED';
    return 'GENERAL';
}

/**
 * Normaliza y valida la URI original que reenvía el edge. Decodifica UNA vez
 * (igual que nginx), bloquea traversal y niega cualquier ruta fuera de
 * /uploads/. No toca el disco ni entrega ficheros.
 *
 * @returns {{ ok: true, path: string } | { ok: false, reason: string }}
 */
export function normalizeUploadRequestPath(rawUri) {
    if (typeof rawUri !== 'string' || rawUri.length === 0) return { ok: false, reason: 'EMPTY' };

    let p = rawUri;
    const cut = p.search(/[?#]/);
    if (cut >= 0) p = p.slice(0, cut);
    if (!p.startsWith(UPLOADS_PREFIX)) return { ok: false, reason: 'OUT_OF_SCOPE' };

    let decoded;
    try { decoded = decodeURIComponent(p); } catch { return { ok: false, reason: 'BAD_ENCODING' }; }
    if (decoded.includes('\0') || decoded.includes('\\')) return { ok: false, reason: 'ILLEGAL_CHAR' };

    const collapsed = decoded.replace(/\/{2,}/g, '/');
    if (collapsed.split('/').some(seg => seg === '..' || seg === '.')) return { ok: false, reason: 'TRAVERSAL' };
    if (!collapsed.startsWith(UPLOADS_PREFIX) || collapsed === UPLOADS_PREFIX) return { ok: false, reason: 'OUT_OF_SCOPE' };

    return { ok: true, path: collapsed };
}


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
