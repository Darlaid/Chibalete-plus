// Verificación sin ids: entradas por estado y número de lectores.
const { loadA2Key, readA2Registry } = await import('/app/server/privacy/a2Registry.mjs');
try {
    await loadA2Key();
    const m = readA2Registry();
    const by = {}; for (const v of m.values()) by[v.status] = (by[v.status] ?? 0) + 1;
    console.log(JSON.stringify({ ok: true, readers: m.size, byStatus: by }));
} catch (e) { console.log(JSON.stringify({ ok: false, code: e?.code || 'ERROR' })); process.exitCode = 1; }
