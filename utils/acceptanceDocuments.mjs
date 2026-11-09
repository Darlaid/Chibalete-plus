/**
 * acceptanceDocuments.mjs — CHP-V8.1-CLOSE-05 (DIR-V81-01).
 *
 * Versiones vigentes de los documentos que se aceptan o deciden al activar una
 * cuenta. Fuente única para el servidor (que rechaza otra versión) y para la
 * pantalla de activación (que la muestra). Cambiar una versión aquí exige que
 * Dirección haya aprobado y publicado ese texto: el registro guarda la versión
 * exacta con cada decisión.
 */
export const ACCEPTANCE_DOCUMENTS = Object.freeze({
    terms:      Object.freeze({ id: '002', version: '002@1.0', title: 'Términos y condiciones de Chibalete+' }),
    dataNotice: Object.freeze({ id: '004', version: '004@1.0', title: 'Información y autorización de tratamiento de datos' }),
    mediator:   Object.freeze({ id: '005', version: '005@1.0', title: 'Compromiso de acceso y confidencialidad de mediadores' }),
});

/** Opciones admitidas por decisión (sin valor por defecto: ninguna viene marcada). */
export const DECISION_OPTIONS = Object.freeze({
    actingAs: Object.freeze(['titular', 'legal_representative']),
    A0: Object.freeze(['yes', 'no']),
    A1: Object.freeze(['yes', 'no']),
    A2: Object.freeze(['yes', 'no', 'not_applicable']),
});
