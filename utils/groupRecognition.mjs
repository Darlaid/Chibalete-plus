/**
 * groupRecognition.mjs — CHP-GAMIFICACION-G4-UX-U4.
 *
 * Presentación del bloque «Reconocimiento en el grupo» (Aula Viva) a partir del
 * campo opcional `recognition` de GET /api/groups/:id/analytics-summary.
 * Módulo PURO: solo valida y traduce conteos del servidor. Sin el campo
 * (gamificación o XP apagados) no hay bloque. Nunca nombres, XP ni niveles.
 */

const count = (n) => Number.isSafeInteger(n) && n >= 0;

/** Vista del bloque, o null si no debe mostrarse. */
export function buildGroupRecognitionView(recognition) {
    if (!recognition || typeof recognition !== 'object') return null;
    const min = count(recognition.minGroupSize) ? recognition.minGroupSize : 5;
    const pending = recognition.pedagogy?.pendingReview;
    const ledger = recognition.ledger ?? {};
    const eligible = recognition.catalog?.eligibleWorks;
    return {
        pending: count(pending) ? { value: pending, text: pending === 1 ? '1 entrega espera tu revisión' : `${pending} entregas esperan tu revisión` }
            : { value: null, text: 'No pudimos contar las entregas pendientes' },
        recognized: ledger.status === 'ok' && count(ledger.studentsWithRecognizedWork)
            ? { value: ledger.studentsWithRecognizedWork, text: `${ledger.studentsWithRecognizedWork} ${ledger.studentsWithRecognizedWork === 1 ? 'estudiante tiene' : 'estudiantes tienen'} al menos una obra reconocida` }
            : ledger.status === 'suppressed'
                ? { value: null, text: `Datos insuficientes: se muestran con ${min} estudiantes o más` }
                : { value: null, text: 'No pudimos cargar este dato' },
        eligible: count(eligible)
            ? { value: eligible, text: eligible === 0 ? 'Aún no hay experiencias que sumen reconocimiento para este grupo'
                : `${eligible} ${eligible === 1 ? 'obra tiene' : 'obras tienen'} experiencias que suman reconocimiento` }
            : { value: null, text: 'No pudimos cargar este dato' },
    };
}
