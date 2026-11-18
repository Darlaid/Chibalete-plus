/**
 * V9 65A — constancias de recepción para un progreso sembrado directamente en el almacén.
 *
 * Desde 65A, un mediador solo recibe como «del curso» las sesiones que el servidor anotó haber recibido
 * (`contextLedger.recordSessionReceipt`), con una fecha coherente con esa recepción. Una suite que siembra progreso
 * sin pasar por `/sync` y prueba otra cosa (asignación, membresía, alcance) anota aquí lo que el servidor habría
 * anotado al recibir cada sesión en línea: primera recepción al empezar y última al terminar.
 *
 *   fromOrigin: false  ⇒ el progreso es anterior al registro (su primer guardado no consta): nunca se certifica entero.
 *   sin sesiones       ⇒ un guardado sin sesión (acumulado sin fecha).
 *
 * @param {object} Ledger   módulo `aulaViva/contextLedger.mjs` ya importado con el registro encendido
 * @param {{userId:string, contentId:string, history?:Array<{sessionId:string, startedAt:string, durationSec?:number, mode?:string}>}} record
 * @param {{fromOrigin?:boolean, undatedAt?:number}} [opts]
 */
export function seedSessionReceipts(Ledger, record, { fromOrigin = true, undatedAt = Date.now() } = {}) {
    const history = Array.isArray(record.history) ? record.history : [];
    if (history.length === 0) {
        Ledger.recordSessionReceipt({ userId: record.userId, workId: record.contentId, sessionId: '', fromOrigin, nowTs: undatedAt });
        return;
    }
    const sorted = [...history].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    sorted.forEach((h, i) => {
        const start = Date.parse(h.startedAt), durationSec = h.durationSec ?? 0;
        const base = { userId: record.userId, workId: record.contentId, sessionId: h.sessionId, declaredStartTs: start, mode: h.mode ?? 'text' };
        Ledger.recordSessionReceipt({ ...base, durationSec: 0, fromOrigin: fromOrigin && i === 0, nowTs: start + 1000 });
        Ledger.recordSessionReceipt({ ...base, durationSec, nowTs: start + durationSec * 1000 });
    });
}
