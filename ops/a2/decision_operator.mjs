// V8.1-CLOSE-05 — operador de decisiones (regularización y verificación). Solo Administración (AT), en una réplica.
// stdin: una decisión por línea, JSON, tomada de una ficha C.1 ya verificada por VER:
//   {"subjectId":"<id de cuenta, u organización para C003>","kind":"A1|A2|A0|T|C003|C005","status":"granted|denied|revoked",
//    "actDay":"AAAA-MM-DD (fecha del acto según la evidencia)","version":"004@1.0","medium":"paper|electronic_signature|verifiable_message|admin_record",
//    "capacity":"titular|legal_representative|institution|mediator","verification":"verified","requestRef":"AUT-…","validUntil":null}
// Nada tiene valor por defecto: la fecha, el medio y la referencia salen de la evidencia. Todas las líneas o ninguna.
// Salida: solo acuses (sin ids).
const { loadA2Key, appendDecisions } = await import('/app/server/privacy/a2Registry.mjs');
let input = '';
for await (const chunk of process.stdin) input += chunk;
try {
    const decisions = input.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
    if (decisions.some((d) => d.medium === 'in_app')) throw Object.assign(new Error(), { code: 'IN_APP_NOT_ALLOWED_HERE' });
    await loadA2Key();
    const acks = appendDecisions(decisions);
    console.log(JSON.stringify({ ok: true, written: acks.length, acks }));
} catch (e) {
    console.log(JSON.stringify({ ok: false, code: e?.code || 'ERROR' }));
    process.exitCode = 1;
}
