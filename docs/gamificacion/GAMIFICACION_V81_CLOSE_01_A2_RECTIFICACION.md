# V8.1-CLOSE-01: A2 y rectificación de XP (G-02 y G-03)

**Fecha:** 2026-11-09. **Estado:** `GREEN_LOCAL`, sin push ni despliegue. XP sigue apagado.

**Base:** la matriz `GAMIFICACION_V8_CORRESPONDENCIA_001_006.md`, §3, brechas G-02 y G-03.

Esta unidad no cambia los importes 30/20/50, el motor, las reglas O1 ni los permisos existentes. No crea paneles ni roles. No toca datos productivos.

## 1. G-02: consulta individual condicionada por A2

### Fuente

`server/privacy/a2Registry.mjs`, un registro append-only en la ruta `CHP_A2_REGISTRY`. No tiene valor por defecto.

- **Línea:** `{id, s, a, d, u, r, m}`.
  - `s`: HMAC del lector; el id nunca aparece en claro.
  - `a`: `granted`, `denied` o `revoked`.
  - `d`: día de la anotación.
  - `u`: vigencia opcional, solo con `granted`.
  - `r`: referencia opaca del trámite.
  - `m`: MAC con una clave derivada de la clave de sujeto, con etiqueta propia.
- **Lectura:** por lector vale la última línea. Si no hay ninguna, A2 está **pendiente**. «No aplica» (004 §9) se trata igual que pendiente: no hay consulta individual.
- **Independencia del estado de cuenta:** A2 no se infiere de `accountStatus`, de la membresía ni de A1. Retirar A2 no cambia el XP del lector, su «Mi progreso» ni su acceso a contenidos (006 §3.5).
- **Fallo cerrado:** si falta la ruta o la clave, si el archivo no existe o está truncado, o si una sola línea está alterada, el resultado es `unavailable` y nadie es visible.
- **Restauración:** igual que el registro de exclusiones, debe vivir fuera del inventario de respaldos. Restaurar `gamification.db` no lo retrocede.

### Criterio único: `individualDisclosure(cohort)`

El llamador ya ha resuelto la sesión, el alcance y la cohorte; esta función solo decide A2.

| Situación | Detalle individual | Agregados que lo acompañan |
|---|---|---|
| Todos con A2 vigente | todos | cohorte |
| Entre 1 y 4 retenidos | solo los que tienen A2 | **solo los visibles**. Si se restara el detalle al agregado de la cohorte, se revelaría a los retenidos |
| 5 o más retenidos, o nadie visible | solo los que tienen A2 | cohorte (k ≥ 5) |
| Registro no verificable | nadie | cohorte |

### Superficies

- **`GET /api/groups/:groupId/students/:studentId/progress`:** añade una quinta puerta después de la cohorte.
  - Sin A2 vigente: el **mismo 404, byte a byte**, que una persona ajena al grupo.
  - Registro no verificable: 503 para todos.
  - Las puertas 1–4 no cambian: el administrador de plataforma sigue en 403 y un mediador ajeno también.
- **`GET /api/groups/:id/analytics-summary` (Aula Viva):**
  - `readers[]` solo incluye a los lectores visibles. Se evalúa en cada petición, fuera de la caché, así que una revocación rige de inmediato.
  - Si se aplica la regla de los 1 a 4 retenidos, los agregados y el bloque de reconocimiento se recalculan con las mismas funciones sobre los visibles.
  - Se añade `individualAccess: {status, aggregateOver}`, sin ids.
  - El front lo tolera sin cambios: una fila sin detalle muestra «—».

### Operación: solo Administración, por stdin

Ninguna ruta HTTP escribe A2. Es el mismo patrón que `excludeUser` (PRIV-C7 §5): el operador ejecuta la plantilla en una sola réplica y la otra lo ve sin reiniciarse, porque comparten el registro.

```js
// stdin: línea 1 = user_id; 2 = granted|denied|revoked; 3 = referencia opaca; 4 = vigencia AAAA-MM-DD (opcional).
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
```

La invocación es la de PRIV-C7 §5, paso 4: `read -rs` para el id, `docker compose exec -T`, `node --input-type=module -e`. **No se ha ejecutado contra ningún contenedor.**

### Efecto al desplegar (gate)

Producción no tiene ni `CHP_A2_REGISTRY` ni la clave de sujeto. Desplegar esta versión **cierra en ese mismo momento** el detalle por lector de Aula Viva para todos los mediadores. El 404 y el resto de los agregados no cambian.

Antes de desplegar hay que hacer tres cosas:

1. Proveer la clave y una ruta de registro montada en ambas réplicas, fuera de los respaldos.
2. Cargar las A2 verificadas (C.1 del 006).
3. O bien aceptar expresamente el cierre hasta tenerlas.

## 2. G-03: rectificación de un reconocimiento

### Función

`server/gamification/rectification.mjs`:

```js
voidRecognition(db, { userId, evidenceId, reason, requestRef, actorId })
```

Reutiliza el esquema `void` existente, sin migración.

- **Asiento:** una transacción `IMMEDIATE` inserta un asiento `void` (xp = 0) sobre el `award` de la evidencia. El índice `ux_gm_xp_void` admite uno solo por asiento, así que la operación es idempotente también entre réplicas.
- **Auditoría:** en la misma transacción se escribe una fila en `gm_admin_audit`.
  - `action`: `xp_void:<motivo>`, con motivo `recognition_error` o `rectification_request`.
  - `ref`: la referencia opaca del trámite, con el formato de PRIV-C7 §5.3.
  - Operador y persona aparecen como sujetos pseudónimos, sin ids.
- **Historial íntegro:** nada se borra ni se modifica. El hecho, el `award` y los actos por obra siguen ahí, y las tablas siguen siendo append-only.
- **XP efectivo:** XP, nivel, obras, logros, «Mi progreso», la vista del mediador y los agregados ya excluían los asientos anulados. Se recalculan sin tocar el motor.
- **Reconciliación:** el hecho conserva su clave, así que ni el barrido ni el gancho de revisión vuelven a emitir esa evidencia.
- **Techo por obra:** decisión de esta unidad. Los actos anulados siguen ocupando su ciclo, de modo que una corrección no abre una segunda vía de pago en la misma obra y ciclo. El efecto se limita a restar.
- **Rechazos:**
  - Motivo fuera de la lista.
  - Referencia con texto libre o ausente.
  - Sin operador.
  - Autocorrección.
  - Evidencia sin reconocimiento o de otra persona (`RECOGNITION_NOT_FOUND`).
  - Persona excluida.
  - Registro de exclusiones dañado.
  - Sin clave.
- **Sin flag:** no depende de `XP_EARNING_ENABLED`, porque corregir no emite nada.

### Operación

Solo operador, por stdin y con el mismo patrón. Hay que abrir la base existente: si no existe, no hay nada que corregir y la operación se detiene.

```js
// stdin: 1 = user_id; 2 = evidenceId MOOK; 3 = motivo; 4 = referencia opaca; 5 = id del operador.
const R = '/app/server/gamification';
const fs = await import('node:fs');
const { loadSubjectKey } = await import(`${R}/subjectKey.mjs`);
const { getGamificationDb, closeGamificationDb, resolveGamificationDbPath } = await import(`${R}/db.mjs`);
const { voidRecognition } = await import(`${R}/rectification.mjs`);
let input = '';
for await (const chunk of process.stdin) input += chunk;
const [userId, evidenceId, reason, requestRef, actorId] = input.split(/\r?\n/).map((s) => s.trim());
try {
    if (!fs.existsSync(resolveGamificationDbPath())) throw Object.assign(new Error(), { code: 'NO_LEDGER' });
    await loadSubjectKey();
    const db = getGamificationDb({ env: { ...process.env, GAMIFICATION_ENABLED: '1' } });
    console.log(JSON.stringify({ ok: true, ...voidRecognition(db, { userId, evidenceId, reason, requestRef, actorId }) }));
    closeGamificationDb();
} catch (e) {
    console.log(JSON.stringify({ ok: false, code: e?.code || 'ERROR' }));
    process.exitCode = 1;
}
```

### O8

`facts_entries` añade dos campos: `voids` y `badVoids` (una anulación que no apunta a un `award` del mismo sujeto). `badVoids > 0` da FAIL.

## 3. Pruebas (datos sintéticos)

| Suite | Resultado | Qué cubre |
|---|---|---|
| `server/__test__/a2Registry.test.mjs` | 34/0 | Sí, No, pendiente, vencida, revocada y renovada. Registro alterado, truncado o sin MAC; sin clave u otra clave. Escritura, criterio único (0, 1, 5 retenidos) y agregados recalculados |
| `server/gamification/__test__/studentProgressHttp.test.mjs` | 49/0 | Lo anterior sobre `server.js` real: 404 idéntico, 503 con el registro ausente o alterado, permisos intactos, XP del lector conservado, Aula Viva |
| `server/__test__/groupAnalyticsSummary.test.mjs` | 107/0 | Sin registro A2, `readers[]` vacío y agregados de la cohorte. Con A2, contrato completo |
| `server/gamification/__test__/xpRectification.test.mjs` | 44/0 | 30/20/50 previo, anulación, idempotencia, historial y auditoría, barridos y gancho, techo, rechazos, XP apagado, dos procesos a la vez, invariantes O8 |
| `ops/gamification/__tests__/o8Check.test.mjs` | solo Linux | Nuevos `[2c]` y `badVoids`. Usa `/app`: se ejecuta en la imagen o en laboratorio |

## 4. Lo que queda fuera

- **Otras vistas individuales del mediador:** `GET /api/students/:id/status`, `/export-submissions` y la revisión MOOK de entregas. **Cerradas en V8.1-CLOSE-02** (`GAMIFICACION_V81_CLOSE_02_A2_ALCANCE.md`): 004 A2 incluye D4 «para revisar, retroalimentar», así que las tres exigen A2.
- **Agregados de Aula Viva en grupos de menos de 5 lectores:** ya se mostraban sin umbral k antes de esta unidad.
- **G-01, G-04 a G-08:** siguen la secuencia de la matriz (§6).
