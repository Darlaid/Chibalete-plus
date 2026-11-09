# V8.1-CLOSE-04: conciliación administrativa de A1/A2

**Fecha:** 2026-11-09. **Veredicto:** `HOLD_A2_EVIDENCE`. Este documento es solo de procedimiento: no contiene datos personales, no crea autorizaciones, no toca código ni producción.

**Instrumentos:**
- **004:** instrumento de autorización, con las decisiones A0–A5 en el formulario de la p. 8.
- **006, Anexo C.1** (p. 23): registro rector por lector.
- **006 §1.2:** funciones.
- **003, cláusula 5 y B.2:** reparto con la institución.

## 1. Alcance examinado

- **Población:** los lectores de grupos `ACTIVE_REAL` (con organización registrada) que tienen al menos un mediador activo. Es la población en la que A2 condiciona algo: Aula Viva, status, exportaciones y revisión MOOK.
  - Los lectores sin grupo mediado no necesitan A2 para nada de lo que ya hacen.
  - Siguen necesitando A1 (G-01).
- **Inventario:** se obtiene con la plantilla de solo lectura `inventory.mjs` (§7).
  - Usa las mismas funciones que el control A2: `classifyGroup`, `resolveGroupLectorCohort`, cuenta activa y no sintética.
  - Solo produce **agregados por grupo**: id interno, tipo, grado y sección, institución, número de lectores y de mediadores activos.
  - No produce nombres, ids de personas ni correos.

## 2. Evidencias reales disponibles (verificado en CLOSE-03)

| Evidencia | Estado |
|---|---|
| 004 diligenciados (A0–A5 por lector) | **Ninguno**. Solo existe la proforma |
| Registro C.1 del 006 | **No existe** |
| 003 firmado por institución (Anexo A y B.2) | **Ninguno**. Solo existe la plantilla |
| 005 firmado por mediador y registro C.2 | **Ninguno** (005 en blanco) |
| Registro de autorizaciones en la plataforma | **No existe**. El código no guarda A0–A5; los avisos de Leo «no son consentimiento» |
| Acta O1 (reglas XP) | Existe; no es una autorización individual |

**Clasificación vigente:**

| Estado | Lectores |
|---|---|
| A2 afirmativa verificada | 0 |
| A2 negativa | 0 |
| A2 revocada | 0 |
| A2 pendiente o sin evidencia | todos |

Lo mismo vale para A1. Una cuenta activa, la matrícula, el contrato o la pertenencia a un grupo **no** acreditan ninguna decisión. El 006 añade que «un consentimiento posterior no prueba una autorización anterior».

## 3. Faltantes documentales concretos

**Por institución** (una vez):
1. **003 aceptado:** Anexo A (partes, versiones de 001 y 002) y **B.2**. B.2 dice quién informa, verifica representación, recoge y custodia. Por defecto (cláusula 5) es la institución, y Chibalete verifica la habilitación individual.
2. **Designación por cargo** del Coordinador Institucional (CI) y del canal de solicitudes (B.2).
3. **Procedimiento del colegio** para entregar el 004 y custodiar los originales, con acceso efectivo a la prueba (cláusula 5: «no bastará una declaración global ni un enlace que pueda desaparecer»).

**Por lector** de la población del §1:
1. **004** en la versión vigente, con A0, A1 y A2 marcadas sin casillas premarcadas. Una opción vacía o doble cuenta como pendiente (006, P03 paso 4).
2. **Ficha C.1** con:
   - Decisión A2: autoriza / no autoriza / pendiente / no aplica / revocada.
   - Verificación: sin revisar / suficiente / requiere aclaración / insuficiente.
   - Soporte, custodio, fecha y medio.
   - Constancia de información recibida, separada de la decisión.
   - Participación del menor.
3. **Referencia mínima del lector**, conciliable con la cuenta canónica. La resuelve AT fuera de Git (§5, paso 5).

**Por mediador** de esos grupos:
1. **005** firmado, con grupos asignados y vigencia.
2. **Registro C.2** de alta.

Sin ellos, el mediador no debería conservar acceso individual aunque sus lectores tengan A2 (003, cláusula 7).

## 4. Regla de paso de C.1 al registro A2 (sin inferencia)

| Ficha C.1 (A2) | Verificación (VER) | Se anota en el registro A2 |
|---|---|---|
| autoriza | **suficiente** | `granted` (con vigencia si el 004 o la institución la fijan) |
| autoriza | sin revisar / requiere aclaración / insuficiente | **nada**: queda pendiente |
| no autoriza | cualquiera | `denied` |
| revocada | cualquiera | `revoked` |
| pendiente / no aplica / vacía / contradictoria | — | **nada**: equivale a no tener A2 |

**Condición previa:** una A2 sin A1 «autoriza + suficiente» no se anota. La cuenta no debería estar activa (004 A1; G-01, ruta P), y el caso se escala a DIR.

**Referencia del trámite:** cada línea lleva como referencia (`requestRef`) el número del registro `AUT-…` del C.1, que es opaco. Nunca nombres, cursos ni fechas de nacimiento.

## 5. Responsables y procedimiento de conciliación (006 §1.2 y P03)

| Paso | Quién | Qué |
|---|---|---|
| 1 | DIR | Aprueba el 001 y el 006, completa el Anexo A del 006 y designa por cargo a GVA, AT, VER y al custodio de la copia del registro A2 (J4) |
| 2 | DIR y CI | Aceptan el 003 con B.2 por institución |
| 3 | GVA | Entrega a cada CI la relación de grupos pendientes (§6, solo recuentos) y el 004 vigente |
| 4 | CI | Distribuye el 004, recoge las decisiones, verifica la representación y custodia los originales. Entrega a GVA el soporte de cada decisión, sin documentos familiares completos |
| 5 | GVA | Abre una ficha C.1 por lector y registra decisión, prueba y estado. AT resuelve la referencia mínima a la cuenta canónica con comprobación de dos personas (patrón PRIV-C7 §5.2) **fuera de Git** |
| 6 | VER | Revisa cada ficha y marca «suficiente» solo con prueba accesible y coherente |
| 7 | GVA | Prepara el lote de carga (`user_id`, estado, `AUT-…`, vigencia) desde las fichas que cumplen el §4. Lo custodia fuera de Git y lo borra tras la carga |
| 8 | DIR | Acepta el alcance: grupos cubiertos y grupos donde acepta el cierre del detalle individual |
| 9 | AT | Ejecuta el aprovisionamiento de CLOSE-03 (`docs/ops/V81_CLOSE_03_RELEASE_CANDIDATE.md` §5) |
| 10 | VER | Verifica que el número de lectores con decisión en el registro coincide con el número de fichas C.1 con decisión. Entrega la copia al custodio |
| 11 | GVA | Atiende cada alta o revocación posterior con la plantilla de operador y actualiza la copia custodiada |

## 6. Relación operativa por grupo

Se llena con la salida del inventario (§7) y la actualizan GVA y VER. Solo contiene recuentos y referencias de cargo, por lo que puede viajar a cada CI sin listados nominativos.

| Grupo (id interno) | Institución | Tipo / grado | Lectores | Mediadores activos | CI (cargo) | 003 / B.2 | 004 recibidos | C.1 A2 autoriza+suficiente | C.1 no autoriza | C.1 revocada | Pendientes | 005 / C.2 de mediadores | Estado |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| … | … | … | n | n | … | no / ref | 0 | 0 | 0 | 0 | n | 0 / n | Pendiente |

**Estados de grupo:**
- **Pendiente:** sin 003 o sin fichas.
- **En conciliación:** hay fichas abiertas.
- **Verificado:** pendientes = 0, o DIR aceptó el cierre de los pendientes.
- **Con cierre aceptado:** DIR aceptó por escrito que el detalle individual quede cerrado.

## 7. Inventario de solo lectura

La plantilla [`ops/a2/inventory.mjs`](../../ops/a2/inventory.mjs) se ejecuta en una réplica:

```
cat ops/a2/inventory.mjs | ssh root@<vps> "cd /opt/chibaleteplus && docker compose exec -T api_1 node --input-type=module"
```

- Lee el padrón, los grupos y los colegios con las rutas de `server/config.js`. No escribe.
- Imprime una línea de totales y una por grupo `ACTIVE_REAL`.
- Se probó con datos sintéticos en la imagen candidata.
- La salida es agregada. Solo se incorpora al documento de seguimiento de Dirección, no a Git.

## 8. Condiciones exactas para desplegar `v81-325b8fc`

1. **Pasos 1–8 cerrados**, con la relación del §6 en estado «Verificado» o «Con cierre aceptado» para **todos** los grupos con mediadores activos.
2. **Lote de carga y verificación:** el lote del paso 7 existe y VER lo verificó. El número de lectores coincide con las fichas C.1 que tienen decisión.
3. **Prerrequisitos técnicos de CLOSE-03:**
   - Clave F2 con evidencia.
   - Directorio del registro fuera de `data/`, `data-critical/` y de los respaldos, distinto del de exclusiones.
   - Carga en un contenedor efímero de la imagen `sha256:17b0dbb8…`, con el tar `bc6c7d6b…` verificado.
   - Copia custodiada.
   - Override con `CHP_A2_REGISTRY` en las dos réplicas.
   - Rolling por réplica.
4. **Gamificación:** sus flags siguen sin definir. Este despliegue no activa XP.

## 9. Siguiente paso mínimo

DIR ejecuta los pasos 1 y 2: aprobar 001 y 006, designar las funciones y aceptar el 003 con B.2 de cada institución. GVA puede entonces entregar a cada CI su relación del §6 con el 004 vigente.
