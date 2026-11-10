/**
 * acceptanceDocuments.mjs — CHP-V8.1-CLOSE-05 (DIR-V81-01).
 *
 * Versiones vigentes de los documentos que se aceptan o deciden al activar una
 * cuenta. Fuente única para el servidor (que rechaza otra versión) y para la
 * pantalla de activación (que la muestra). Cambiar una versión aquí exige que
 * Dirección haya aprobado y publicado ese texto: el registro guarda la versión
 * exacta con cada decisión.
 *
 * La versión aquí es la que el código exige; que esté APROBADA y PUBLICADA lo
 * declara Dirección en la configuración del servidor (`CHP_ACCEPTANCE_DOCUMENTS`,
 * ver server/privacy/acceptance.mjs). Sin esa declaración, la activación no se
 * ofrece: ningún borrador se presenta como documento aprobado.
 */
export const ACCEPTANCE_DOCUMENTS = Object.freeze({
    policy:     Object.freeze({ id: '001', version: '001@1.0', title: 'Política de tratamiento de datos personales' }),
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
    // V8.1-PROD-02B — opcionales: sin respuesta quedan pendientes (no se presumen por A1, A2 ni la compra).
    A3: Object.freeze(['yes', 'no']),   // Leo / inteligencia artificial
    A5: Object.freeze(['yes', 'no']),   // transcripción automática de la voz (oralidad)
});
