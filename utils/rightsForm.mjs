/**
 * rightsForm.mjs — V1.4 / U1 DERECHOS-UI-01.
 *
 * Núcleo PURO del formulario de derechos por obra (pages/AdminDerechos.tsx):
 * convierte lo que escribe el administrador en el cuerpo de
 * POST /api/admin/rights/:contentId/versions, hace una comprobación previa
 * para no enviar matrices o referencias imposibles y traduce los motivos y
 * códigos del servidor. La validación que manda es la del servidor
 * (server/royalties/rightsStore.mjs · validateRightsInput): aquí no se decide
 * nada que el servidor no vuelva a comprobar, y nada se rellena por defecto.
 */

export const RIGHTS_CAPABILITIES = Object.freeze([
    'subscription_reading', 'tts', 'ai_leo', 'offline', 'indexing', 'promo_fragments', 'cover_metadata',
]);
export const FULL_SHARE_BP = 10000;

export const CAPABILITY_LABELS = Object.freeze({
    subscription_reading: 'Lectura por suscripción',
    tts: 'Narración sintética (TTS)',
    ai_leo: 'Asistente de IA (Leo)',
    offline: 'Descarga sin conexión',
    indexing: 'Indexación y búsqueda en el texto',
    promo_fragments: 'Fragmentos promocionales',
    cover_metadata: 'Portada y metadatos públicos',
});

export const LEGAL_STATUS_LABELS = Object.freeze({
    active: 'Vigente', suspended: 'Suspendida', revoked: 'Revocada', disputed: 'En disputa',
});
export const ECONOMIC_STATUS_LABELS = Object.freeze({
    pending: 'Pendiente', active: 'Activa', retained: 'Retenida',
});
export const SETTLEMENT_CLASS_LABELS = Object.freeze({
    liquidable: 'Liquidable', auxiliary: 'Auxiliar (no liquidable)', excluded: 'Excluida',
});

/** Motivos de economicEligibility (rightsStore.mjs) en lenguaje de administración. */
export const ELIGIBILITY_REASON_LABELS = Object.freeze({
    CONTENT_NOT_FOUND: 'La obra no existe en el catálogo.',
    CONTENT_NOT_AVAILABLE: 'La obra no está disponible en el catálogo.',
    CONTENT_TYPE_NOT_ECONOMIC: 'Este tipo de contenido no es liquidable en V1 (solo libros y libros álbum).',
    NO_RIGHTS_VERSION: 'No hay ninguna versión de derechos registrada.',
    NO_EFFECTIVE_VERSION: 'Ninguna versión ha entrado en vigor todavía (fecha de efecto futura).',
    LEGAL_SUSPENDED: 'Situación jurídica: suspendida.',
    LEGAL_REVOKED: 'Situación jurídica: revocada.',
    LEGAL_DISPUTED: 'Situación jurídica: en disputa.',
    OUT_OF_VALIDITY: 'Fuera del periodo de vigencia del Acta.',
    ECONOMIC_PENDING: 'Estado económico pendiente: la versión está registrada pero aún no activa la liquidación.',
    ECONOMIC_RETAINED: 'Estado económico retenido.',
    SETTLEMENT_AUXILIARY: 'Clase de liquidación auxiliar: no se liquida.',
    SETTLEMENT_EXCLUDED: 'Clase de liquidación excluida.',
    READING_NOT_AUTHORIZED: 'El Acta no autoriza la lectura por suscripción.',
    ALPHA_MISSING: 'Falta el porcentaje alfa contractual.',
    EXPECTED_MINUTES_MISSING: 'Faltan los minutos esperados de lectura.',
    PUBLISHER_NOT_ACTIVE: 'La editorial de la versión no está activa.',
    PUBLISHER_MISMATCH: 'La editorial de la versión no coincide con la editorial responsable actual de la obra.',
    SHARES_INVALID: 'La matriz de participaciones está vacía o no suma 100 %.',
    SHARE_HOLDER_NOT_ACTIVE: 'Algún titular de la matriz no está activo.',
});

export const reasonLabel = (code) => ELIGIBILITY_REASON_LABELS[code] || `Motivo no reconocido: ${code}`;

/** Códigos de error de validateRightsInput → mensaje para el formulario. */
const SERVER_ERROR_LABELS = Object.freeze({
    invalid_body: 'El formulario no se pudo enviar. Revisa los campos.',
    unknown_field: 'El formulario envió un campo no admitido.',
    content_not_found: 'La obra no existe en el catálogo.',
    invalid_content_id: 'Identificador de obra inválido.',
    unknown_publisher: 'La editorial indicada no existe.',
    inactive_publisher: 'La editorial indicada está inactiva.',
    publisher_mismatch: 'La editorial del Acta debe ser la editorial responsable de la obra. Si cambió, corrige primero la ficha de la obra.',
    invalid_act_ref: 'La referencia del Acta es obligatoria (máximo 200 caracteres).',
    invalid_date: 'Alguna fecha no es válida (formato AAAA-MM-DD).',
    invalid_validity: 'El fin de vigencia es anterior al inicio.',
    invalid_effective_at: 'La fecha y hora de efecto no es válida.',
    invalid_legal_status: 'Situación jurídica no válida.',
    invalid_economic_status: 'Estado económico no válido.',
    invalid_settlement_class: 'Clase de liquidación no válida.',
    permissions_required: 'Hay que declarar los siete permisos.',
    unknown_permission: 'Permiso desconocido.',
    permission_not_explicit: 'Cada permiso debe marcarse expresamente como autorizado o no autorizado.',
    invalid_alpha: 'El porcentaje alfa debe ser mayor que 0 y como máximo 100 %.',
    invalid_expected_minutes: 'Los minutos esperados deben ser un número positivo.',
    invalid_shares: 'La matriz de participaciones no es válida (titulares repetidos o porcentajes fuera de rango).',
    unknown_share_holder: 'Un titular de la matriz no existe.',
    inactive_share_holder: 'Un titular de la matriz está inactivo.',
    shares_not_100: 'Las participaciones deben sumar exactamente 100 %.',
    not_economic_type: 'Este tipo de contenido no es liquidable en V1: usa la clase «Auxiliar» o «Excluida».',
    shares_required: 'Una obra liquidable necesita su matriz de participaciones.',
    alpha_required: 'Una obra liquidable necesita el porcentaje alfa.',
    expected_minutes_required: 'Una obra liquidable necesita los minutos esperados (P1).',
    reading_required: 'Una obra liquidable debe autorizar la lectura por suscripción.',
});

export const serverErrorLabel = (code, fallback) => SERVER_ERROR_LABELS[code] || fallback || 'No se pudo registrar la versión.';

/** Formulario vacío: ningún permiso, estado ni porcentaje se presupone. */
export function emptyRightsForm() {
    const permissions = {};
    for (const cap of RIGHTS_CAPABILITIES) permissions[cap] = '';
    return {
        actRef: '', actSignedOn: '', validFrom: '', validUntil: '', effectiveAt: '',
        legalStatus: '', economicStatus: '', settlementClass: '',
        alphaPct: '', expectedMinutes: '', shares: [], permissions, notes: '',
    };
}

const bpToPct = (bp) => String(Math.round(bp) / 100);
const alphaToPct = (a) => String(Math.round(a * 1e6) / 1e4);

/**
 * Copia explícita de una versión ya registrada (botón «Partir de la versión
 * vigente»). La fecha de efecto se deja vacía: la nueva versión necesita la suya.
 */
export function formFromVersion(v) {
    const f = emptyRightsForm();
    if (!v) return f;
    f.actRef = v.actRef || '';
    f.actSignedOn = v.actSignedOn || '';
    f.validFrom = v.validFrom || '';
    f.validUntil = v.validUntil || '';
    f.legalStatus = v.legalStatus || '';
    f.economicStatus = v.economicStatus || '';
    f.settlementClass = v.settlementClass || '';
    f.alphaPct = v.alpha == null ? '' : alphaToPct(v.alpha);
    f.expectedMinutes = v.expectedMinutes == null ? '' : String(v.expectedMinutes);
    f.shares = (v.shares || []).map((s) => ({ publisherId: s.publisherId, pct: bpToPct(s.shareBp) }));
    for (const cap of RIGHTS_CAPABILITIES) {
        const p = v.permissions?.[cap];
        f.permissions[cap] = p === true ? 'yes' : p === false ? 'no' : '';
    }
    f.notes = v.notes || '';
    return f;
}

/** Porcentaje escrito (coma o punto, hasta 2 decimales) → puntos básicos enteros, o null. */
export function pctToBp(text) {
    const t = String(text ?? '').trim().replace(',', '.');
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
    const bp = Math.round(Number(t) * 100);
    return Number.isInteger(bp) ? bp : null;
}

export const sharesTotalBp = (shares) => (shares || []).reduce((s, x) => s + (pctToBp(x.pct) ?? 0), 0);

/**
 * `datetime-local` (hora de Colombia, UTC−5 sin horario de verano) → ISO UTC.
 * El servidor guarda instantes; el administrador piensa en hora de Bogotá.
 */
export function bogotaLocalToIso(local) {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(String(local || ''));
    if (!m) return null;
    const d = new Date(`${m[1]}T${m[2]}:${m[3]}:00-05:00`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ISO UTC → texto de fecha y hora en Bogotá (para el historial). */
export function isoToBogotaText(iso) {
    const ms = Date.parse(iso || '');
    if (Number.isNaN(ms)) return '—';
    return `${new Date(ms - 5 * 3600_000).toISOString().slice(0, 16).replace('T', ' ')} (Bogotá)`;
}

/**
 * Comprobación previa y cuerpo de la API. Devuelve { errors, body }: si hay
 * errores, body es null y no se envía nada. Reproduce las reglas del servidor
 * que el administrador puede corregir en el formulario.
 */
export function buildRightsBody(form, { publisherId, isEconomicType, activePublisherIds }) {
    const errors = [];
    const active = new Set(activePublisherIds || []);
    if (!publisherId) errors.push('La obra no tiene editorial responsable: asígnala primero en la ficha de la obra.');
    else if (!active.has(publisherId)) errors.push('La editorial responsable de la obra no está activa.');
    const actRef = String(form.actRef || '').trim();
    if (!actRef) errors.push('La referencia del Acta es obligatoria.');
    else if (actRef.length > 200) errors.push('La referencia del Acta admite como máximo 200 caracteres.');
    if (!form.actSignedOn) errors.push('Indica la fecha de firma del Acta.');
    if (!form.validFrom) errors.push('Indica el inicio de vigencia.');
    if (form.validUntil && form.validFrom && form.validUntil < form.validFrom) errors.push('El fin de vigencia es anterior al inicio.');
    const effectiveAt = bogotaLocalToIso(form.effectiveAt);
    if (!effectiveAt) errors.push('Indica la fecha y hora desde la que rige esta versión.');
    if (!form.legalStatus) errors.push('Elige la situación jurídica.');
    if (!form.economicStatus) errors.push('Elige el estado económico.');
    if (!form.settlementClass) errors.push('Elige la clase de liquidación.');

    const permissions = {};
    const undecided = [];
    for (const cap of RIGHTS_CAPABILITIES) {
        const v = form.permissions?.[cap];
        if (v === 'yes') permissions[cap] = true;
        else if (v === 'no') permissions[cap] = false;
        else undecided.push(CAPABILITY_LABELS[cap]);
    }
    if (undecided.length) errors.push(`Declara expresamente cada permiso. Sin decidir: ${undecided.join(', ')}.`);

    let alpha = null;
    if (String(form.alphaPct ?? '').trim() !== '') {
        const bp = pctToBp(form.alphaPct);
        if (bp === null || bp < 1 || bp > FULL_SHARE_BP) errors.push('El porcentaje alfa debe ser mayor que 0 y como máximo 100 (hasta 2 decimales).');
        else alpha = bp / FULL_SHARE_BP;
    }
    let expectedMinutes = null;
    if (String(form.expectedMinutes ?? '').trim() !== '') {
        const n = Number(String(form.expectedMinutes).trim().replace(',', '.'));
        if (!(Number.isFinite(n) && n > 0 && n < 100000)) errors.push('Los minutos esperados deben ser un número positivo.');
        else expectedMinutes = n;
    }

    const shares = [];
    const seen = new Set();
    for (const s of form.shares || []) {
        if (!s.publisherId) { errors.push('Cada fila de la matriz necesita un titular.'); continue; }
        if (seen.has(s.publisherId)) errors.push('Un titular aparece dos veces en la matriz.');
        seen.add(s.publisherId);
        if (!active.has(s.publisherId)) errors.push('Algún titular de la matriz no está activo.');
        const bp = pctToBp(s.pct);
        if (bp === null || bp < 1 || bp > FULL_SHARE_BP) errors.push('Cada participación debe ser un porcentaje entre 0,01 y 100.');
        else shares.push({ publisherId: s.publisherId, shareBp: bp });
    }
    const total = shares.reduce((a, s) => a + s.shareBp, 0);
    if (shares.length > 0 && total !== FULL_SHARE_BP) errors.push(`Las participaciones suman ${total / 100} %; deben sumar exactamente 100 %.`);

    if (form.settlementClass === 'liquidable') {
        if (!isEconomicType) errors.push('Este tipo de contenido no es liquidable en V1: usa la clase «Auxiliar» o «Excluida».');
        if ((form.shares || []).length === 0) errors.push('Una obra liquidable necesita su matriz de participaciones.');
        if (alpha === null) errors.push('Una obra liquidable necesita el porcentaje alfa.');
        if (expectedMinutes === null) errors.push('Una obra liquidable necesita los minutos esperados de lectura.');
        if (permissions.subscription_reading !== true) errors.push('Una obra liquidable debe autorizar la lectura por suscripción.');
    }

    const unique = [...new Set(errors)];
    if (unique.length) return { errors: unique, body: null };
    const notes = String(form.notes || '').trim();
    return {
        errors: [],
        body: {
            publisherId, actRef, actSignedOn: form.actSignedOn, validFrom: form.validFrom,
            validUntil: form.validUntil || null, effectiveAt,
            legalStatus: form.legalStatus, economicStatus: form.economicStatus, settlementClass: form.settlementClass,
            alpha, expectedMinutes, shares, permissions, notes: notes || null,
        },
    };
}
