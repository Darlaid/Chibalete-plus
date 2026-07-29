/**
 * request-index.test.mjs — CHP-STATS-LEGACY-PERF-01A.
 *
 * Prueba las propiedades de las que depende la arquitectura elegida (índices
 * por petición + memoización), sobre fixtures SINTÉTICAS y sin tocar ningún
 * store real. Corre en CI: es barata y no necesita snapshot.
 *
 * Lo que se protege aquí es la EXACTITUD, no la velocidad. La ganancia se mide
 * en `-01C`/`-01E`; lo que no puede regresar nunca es la equivalencia entre
 * "agrupar una vez" y "escanear por alumno".
 *
 *   node scripts/perf/request-index.test.mjs
 */
let pass = 0, fail = 0;
const ok = (l, c, h = '') => { if (c) { console.log('  ✓', l); pass++; } else { console.error('  ✗', l, h ? `— ${h}` : ''); fail++; } };
const section = (t) => console.log(`\n${t}`);

/** Agrupa por clave preservando el orden de aparición. */
function indexBy(rows, keyFn) {
    const idx = new Map();
    for (const r of rows) {
        const k = keyFn(r);
        if (!idx.has(k)) idx.set(k, []);
        idx.get(k).push(r);
    }
    return idx;
}
/** Rebanada normalizada: ausencia -> lista vacía, nunca null ni 0. */
const slice = (idx, key) => idx.get(key) ?? [];

// ── fixture sintética determinista ─────────────────────────────────────────
const USERS = Array.from({ length: 40 }, (_, i) => `u${i + 1}`);
const rows = [];
let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
for (let i = 0; i < 500; i++) {
    // Deliberadamente NO uniforme: hay usuarios con muchas filas y usuarios con
    // ninguna, que es donde fallan las implementaciones descuidadas.
    const u = USERS[Math.floor(rnd() * 25)];
    rows.push({ userId: u, seq: i, payload: `p${i}` });
}
const SIN_DATOS = USERS.slice(25);

console.log('request-index — CHP-STATS-LEGACY-PERF-01A');

section('[1] equivalencia índice vs escaneo');
{
    const idx = indexBy(rows, r => r.userId);
    let diffCount = 0, diffOrder = 0, diffIdentity = 0;
    for (const u of USERS) {
        const scan = rows.filter(r => r.userId === u);
        const got = slice(idx, u);
        if (scan.length !== got.length) { diffCount++; continue; }
        for (let i = 0; i < scan.length; i++) {
            if (scan[i] !== got[i]) { diffIdentity++; break; }
            if (scan[i].seq !== got[i].seq) { diffOrder++; break; }
        }
    }
    ok('[1a] mismo número de registros por usuario', diffCount === 0, `difieren ${diffCount}`);
    ok('[1b] mismo ORDEN de registros', diffOrder === 0, `difieren ${diffOrder}`);
    ok('[1c] mismas referencias, sin copias', diffIdentity === 0, `difieren ${diffIdentity}`);
}

section('[2] ausencia de datos');
{
    const idx = indexBy(rows, r => r.userId);
    let bad = 0;
    for (const u of SIN_DATOS) {
        const got = slice(idx, u);
        // La distinción que el contrato canónico exige preservar: sin datos es
        // una lista vacía, no un cero ni un null.
        if (!Array.isArray(got) || got.length !== 0) bad++;
        if (got === null || got === undefined) bad++;
    }
    ok(`[2a] ${SIN_DATOS.length} usuarios sin filas devuelven [] y no null/0`, bad === 0);
    ok('[2b] el índice no inventa claves', idx.has(SIN_DATOS[0]) === false);
}

section('[3] memoización: exacta si la función es determinista');
{
    let calls = 0;
    const puro = (u) => { calls++; return { u, n: rows.filter(r => r.userId === u).length }; };

    const memo = new Map();
    const memoizado = (u) => { if (!memo.has(u)) memo.set(u, puro(u)); return memo.get(u); };

    // El patrón real: cada alumno se pide dos veces (allStudents + breakdown).
    const pedidos = [...USERS, ...USERS];
    const sinMemo = pedidos.map(u => ({ u, n: rows.filter(r => r.userId === u).length }));
    calls = 0;
    const conMemo = pedidos.map(memoizado);

    ok('[3a] mismos resultados con y sin memoización',
        JSON.stringify(sinMemo) === JSON.stringify(conMemo));
    ok('[3b] la función se evalúa una vez por usuario distinto',
        calls === USERS.length, `llamadas=${calls} esperadas=${USERS.length}`);
    ok('[3c] la memo se limita a los usuarios pedidos', memo.size === USERS.length);
}

section('[4] la memo no sobrevive a la petición');
{
    // Contrato de vida: el contexto se crea y se descarta por petición. Dos
    // "peticiones" no comparten memo, así que un cambio de datos entre ambas es
    // visible de inmediato — que es lo que exige el contrato de frescura.
    const hacerContexto = (dataset) => {
        const memo = new Map();
        const idx = indexBy(dataset, r => r.userId);
        return { count: (u) => { if (!memo.has(u)) memo.set(u, slice(idx, u).length); return memo.get(u); },
                 size: () => memo.size };
    };

    const ctx1 = hacerContexto(rows);
    const antes = ctx1.count('u1');

    const rowsMas = [...rows, { userId: 'u1', seq: 999, payload: 'nuevo' }];
    const ctx2 = hacerContexto(rowsMas);
    const despues = ctx2.count('u1');

    ok('[4a] un contexto nuevo ve los datos nuevos', despues === antes + 1, `${antes} -> ${despues}`);
    ok('[4b] el contexto viejo no contamina al nuevo', ctx1.count('u1') === antes);
    ok('[4c] sin estado compartido entre contextos', ctx1.size() === 1 && ctx2.size() === 1);
}

section('[5] coste: indexar una vez frente a escanear por usuario');
{
    const t0 = process.hrtime.bigint();
    const idx = indexBy(rows, r => r.userId);
    for (const u of USERS) slice(idx, u);
    const conIndice = Number(process.hrtime.bigint() - t0);

    const t1 = process.hrtime.bigint();
    for (const u of USERS) rows.filter(r => r.userId === u);
    const conEscaneo = Number(process.hrtime.bigint() - t1);

    // Sin umbral estricto: en CI compartida el reloj es ruidoso y este test
    // protege exactitud, no rendimiento. Solo se deja constancia.
    console.log(`      índice+lecturas ${(conIndice / 1e6).toFixed(3)} ms | escaneos ${(conEscaneo / 1e6).toFixed(3)} ms`);
    ok('[5a] ambos caminos producen el mismo total de filas',
        USERS.reduce((a, u) => a + slice(idx, u).length, 0)
        === USERS.reduce((a, u) => a + rows.filter(r => r.userId === u).length, 0));
}

console.log(`\nrequest-index: ${pass} ok, ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
