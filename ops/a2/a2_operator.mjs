// Plantilla CLOSE-01 §1 (operador A2). stdin: 1 = user_id; 2 = granted|denied|revoked; 3 = referencia opaca; 4 = vigencia (opcional).
const { loadA2Key, appendA2Decision } = await import('/app/server/privacy/a2Registry.mjs');
let input = '';
for await (const chunk of process.stdin) input += chunk;
const [userId, status, requestRef, validUntil] = input.split(/\r?\n/).map((s) => s.trim());
try {
    await loadA2Key();
    console.log(JSON.stringify({ ok: true, ...appendA2Decision({ userId, status, requestRef, validUntil: validUntil || null }) }));
} catch (e) {
    console.log(JSON.stringify({ ok: false, code: e?.code || 'ERROR' }));
    process.exitCode = 1;
}
