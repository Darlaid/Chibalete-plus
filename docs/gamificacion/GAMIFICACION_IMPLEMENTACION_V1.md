# GAMIFICACION — Plan de implementación V1

**Unidad:** GAMIFICACION-G1-01 · **Fecha:** 2026-10-29 · **Baseline:** `f4836d1` (G0 `GREEN_PROD`).
**Depende de:** [`GAMIFICACION_DOCTRINA_V1.md`](GAMIFICACION_DOCTRINA_V1.md) y [`GAMIFICACION_CONTRATOS_V1.md`](GAMIFICACION_CONTRATOS_V1.md).
**Naturaleza:** secuencia de unidades. Ninguna está autorizada por este documento: cada una exige su propio encargo.
**Sin fechas:** el roadmap de la fuente (nov-2026 a abr-2027) es una secuenciación orientativa. Este plan **no** convierte estimaciones en compromisos.

## 0. Reglas transversales para todas las unidades

- Cambios mínimos y localizados (CLAUDE.md). Módulo integrado en el backend existente (`server/gamification/`).
- **No tocar sin su propia unidad autorizada:** MOOK, Leo, el progreso canónico, regalías, derechos ni WooCommerce. Los únicos cambios permitidos en esos sistemas son **ganchos aditivos** de una o dos líneas, sin efecto con el flag en OFF, y cada gancho lleva una prueba que demuestra que la ruta original es idéntica.
- Todo lo nuevo va detrás de flags en **OFF** por defecto (Doctrina §7).
- Ninguna migración sin autorización explícita en el encargo de la unidad. Ninguna escritura en producción ni despliegue sin su unidad de despliegue.
- Se añade la suite `test:gamification` al job `identity-preflight`, como ya se hizo con `test:gamification-g0`.
- **Criterio GREEN común:** suites nuevas en verde, suites existentes sin regresión (la lista de fallos preexistentes está en la memoria de G0), CI 3/3 y `git diff` limitado al alcance.
- **STOP común:** cualquier cambio necesario fuera del alcance declarado, cualquier efecto observable con los flags en OFF o cualquier escritura en stores reales durante las pruebas.

## 1. Prerrequisitos no técnicos (gobernanza)

No bloquean G2 ni G3. Bloquean lo que se indica.

| # | Prerrequisito | Responsable | Bloquea |
|---|---|---|---|
| N1 | Owner ejecutivo y RACI del comité (D50) | Dirección | Cambios de reglas y apertura del piloto (G7) |
| N2 | DPIA/PIA de gamificación (D39) | DPO/Legal | G7, y cualquier activación con menores reales |
| N3 | Resolver las alternativas abiertas D05, D06, D11, D18 y la cuestión de MOOK `con_comentarios` | Pedagogía / Producto | Las partes concretas de G4, G5 y G7 |
| N4 | Licencias de activos visuales (D15 y D16) | Diseño + Legal | G5-A en producción |
| N5 | Contratos y derechos del contenido-premio: D17, D51 y D52 | Editorial + Legal | G5-B |
| N6 | Presupuesto: bolsa y techo (D46); simulación de topes y precios (D14, D20–D22) | Finanzas + Producto | Cualquier canje con coste |
| N7 | Mecanismo de autorización adulta (D35) | Legal + Producto | G6 |
| N8 | Credenciales y SLA de WooCommerce `wc/v3` (D23) | Ecommerce | G6 |

## 2. Grafo de dependencias

```
G1 (doctrina, contratos y plan: este documento)
 └─ G2 arquitectura y contratos técnicos
     └─ G3 ledger, idempotencia y seguridad
         ├─ G4 XP, niveles, logros y fuentes ── G4A.1 doble lectura ── G4A.2 UI de perfil e historial
         │     └─ G4B.2 / G4B.3 / G4B.4 / G4B.5 (retiro del legado)
         ├─ G5-A recompensas digitales ──(N4)
         │     └─ G5-B contenido-premio ──(N5)
         │           └─ G6 cupones WooCommerce ──(N6, N7, N8)
         └─ G7 colegios, piloto y despliegue gradual ──(N1, N2, N3)
G4B.1 (Trivia) depende solo de G0 y de la comprobación de tráfico; puede ir en paralelo a G2/G3
```

---

## 3. Unidades

### G2: arquitectura y contratos técnicos (solo documentos)

- **Objetivo:** convertir los contratos funcionales en contratos técnicos congelados.
- **Alcance:**
  - ADR de almacenamiento (recomendación: `data-critical/gamification.db`, mismo patrón que `royalties.db`, con el porqué frente a usar una tabla en `events.db`).
  - Borrador de esquema SQL con triggers append-only y `UNIQUE`, en un documento y **sin aplicarlo**.
  - Firmas de la función interna `award()`, de los endpoints de dominio (`GET /me`, `/me/ledger`, `/rewards`, `POST /redemptions`, `POST /admin/adjustments`) y sus códigos de error.
  - Definición de día y semana; `ruleVersion` y su formato de configuración.
  - Matriz de flags; matriz RBAC.
  - Plan de respaldo y retención del nuevo archivo.
  - Contrato del validador de finalización de lectura.
- **Archivos previstos:** `docs/gamificacion/GAMIFICACION_ARQUITECTURA_G2.md` y `docs/gamificacion/ADR-GAM-01-almacenamiento.md`.
- **Dependencias:** G1.
- **Pruebas:** validación documental cruzada con D25–D30 e I1–I6. Comprobar que cada endpoint tiene su RBAC y su flag.
- **GREEN:** contratos sin huecos frente a los Contratos V1 §4–§8; revisión humana del ADR.
- **STOP:** si el ADR concluye que hace falta infraestructura nueva (se eleva a Dirección), o si la definición del validador de finalización exige cambiar el contrato del progreso canónico.

### G3: ledger, idempotencia y seguridad

- **Objetivo:** el núcleo transaccional, sin ninguna fuente conectada ni UI.
- **Alcance:**
  - `server/gamification/` con:
    - `ledgerStore`: migración 0001, triggers append-only, snapshot;
    - `award()` con idempotencia y topes;
    - reservas, confirmación y liberación, y el reconciliador de reservas huérfanas;
    - compensación y ajuste administrativo con motivo;
    - configuración de reglas versionada y lectura de flags.
  - Endpoints de solo lectura `GET /api/gamification/me` y `/me/ledger`, detrás de `GAMIFICATION_ENABLED`.
- **Archivos previstos:** `server/gamification/{ledgerStore,award,redemption,rules,flags}.mjs`, `server/gamification/migrations/0001_ledger.sql`, `server/gamification/__test__/*` y un **gancho de registro de rutas** en `server/server.js` (aditivo).
- **Dependencias:** G2, y autorización expresa de la migración.
- **Pruebas** (scripts de la fuente):
  - `idempotency`, `redemptionConcurrency` (20 canjes concurrentes, dos conexiones al mismo archivo para simular las dos réplicas);
  - `ledgerInvariant` más pruebas de propiedades (secuencias aleatorias de emisión, reserva, canje y compensación);
  - `sourceAuthority` (ningún endpoint acepta montos);
  - `royaltyIsolation` (sin imports de `server/royalties/` y huella de `royalties.db` sin cambios);
  - `rbac` (solo lectura propia; ajuste solo para el administrador).
- **GREEN:** I1–I6 probadas; con los flags en OFF, cero tablas creadas en arranques de producción y cero rutas que respondan algo distinto de 404 o «deshabilitado»; CI 3/3.
- **STOP:** cualquier fallo de concurrencia o de invariante; necesidad de tocar `royalties.db`, `access_db` o `progress.db`; creación de archivos en `data*/` durante las pruebas (guard de stores reales).

### G4: XP, niveles, logros y fuentes de evidencia

- **Objetivo:** conectar evidencia real de grado A y B y derivar XP, nivel, logros y racha.
- **Alcance, en subunidades:**
  - **G4-1 validador de finalización.** Servidor; contrasta `/complete` con la actividad canónica. Primero **solo observa**: registra si la finalización habría sido válida, sin emitir nada.
  - **G4-2 fuente MOOK.** Gancho después de `reviewEvidence` y de la experiencia completada.
  - **G4-3 XP, nivel (híbrido D04) y catálogo inicial de logros (DC-01)**, más la racha cuando D05 esté resuelta.
  - **G4A.1 doble lectura comparativa sin mostrar saldo** (flag de emisión ON solo en shadow).
  - **G4A.2 UI de Perfil e historial** (D31–D33), accesible (D40), que reemplaza el «Puntos de Magia» heredado del Perfil.
- **Archivos previstos:** `server/gamification/sources/{readingCompletion,mook}.mjs`, `server/gamification/progression.mjs`, ganchos aditivos en `server.js` (endpoint `/complete` y revisión MOOK), y `pages/Perfil.tsx` más un componente de historial.
- **Dependencias:** G3, N3 parcial y la UX de Perfil.
- **Pruebas:**
  - fuente → un solo movimiento;
  - lectura sin validar → cero PM;
  - MOOK `REVIEWED` → emisión única por `evidenceId`;
  - con el motor que lanza error, `/complete` y la revisión MOOK responden igual (aislamiento de la lectura);
  - `test:a11y:gamification`;
  - suites MOOK y de progreso sin regresión.
- **GREEN:** la doble lectura muestra cero divergencias de invariante; la tasa de finalizaciones no validadas está medida y aceptada por Producto; la UI aprobada.
- **STOP:** el validador rechaza finalizaciones legítimas por encima del umbral acordado; cualquier cambio en la respuesta de `/complete` o de la revisión MOOK; cualquier dependencia de Leo u oralidad para emitir.

### G4B: retiro controlado del legado

Va **por olas**, cada una con su condición previa. No se hace todo a la vez.

| Ola | Acción | Condición previa | Momento | Pruebas / GREEN | STOP |
|---|---|---|---|---|---|
| G4B.1 | Eliminar Trivia (`pages/Trivia.tsx`, generador y ruta) | Logs del edge: `/trivia` sin tráfico relevante; G0 en producción | **Ya puede ir**, en paralelo a G2/G3 | La ruta queda en «no disponible» o redirige; `grep` limpio; build verde | Aparecen consumidores |
| G4B.2 | Eliminar `addPoints`, `addPuntos`, `canjearRecompensa`, `redeemCoupon` y `processRewardRequest`; cerrar las solicitudes antiguas con aviso (D54) | Ningún consumidor; texto del aviso aprobado | Después de G4A.2 | `grep` sin llamadas; prueba estructural | — |
| G4B.3 | Retirar campos y páginas muertas: `puntos`, `racha_dias`, `immersive_level`, `storeOrders`, `precio_descuento_puntos`, `unlockCost` en la UI, `AdminProductos` en lo relativo a puntos | Migración y `grep` limpio; sin lectura en el padrón | Después de G4B.2 | Tipos y build verdes; `sections.json` sin alterar mientras siga como fuente | El padrón contiene datos en esos campos (recuento autorizado) |
| G4B.4 | Reformular `LEVELS` del inmersivo como «duración de sesión» configurable (D44); retirar el XP por bloque y el multiplicador de 30 s (grado D) | UX aprobada | Después de G4-3 | Suite inmersiva verde; el corte por tiempo sigue sin decir «Lectura completada» (invariante de G0) | Regresión en la finalización legítima |
| G4B.5 | Sustituir las métricas escolares simuladas | Métricas reales disponibles (G7) | Con G7 | — | — |

### G5: recompensas digitales y derechos

- **G5-A, digitales:**
  - **Objetivo:** catálogo de avatares, fondos y salas cosméticas, con canje a PM y concesión local.
  - **Alcance y archivos:** `server/gamification/rewards/*`, endpoints `/rewards` y `/redemptions` (solo digitales), y la pestaña PM de la Tienda (DC-07).
  - **Dependencias:** G3, G4A.2 y N4.
  - **Pruebas:** concurrencia de canje, liberación ante fallo, P7 (nada visible sin entrega posible) y activo accesible solo para su propietario.
  - **GREEN:** canje digital de extremo a extremo con flags en local y sin coste comercial.
  - **STOP:** activos sin licencia confirmada.
- **G5-B, contenido-premio:**
  - **Objetivo:** desbloquear contenido como regla de acceso temporal o de cortesía.
  - **Alcance:** puente `grantRewardAccess()` → `access_db` (alcance de usuario, ventana y clase no económica).
  - **Dependencias:** G5-A y N5 (D17, D51, D52). Si D51 = B, se necesita **antes** una unidad separada de regalías y derechos para el nuevo permiso.
  - **Pruebas:** `rewardAccessRights` y `royaltyIsolation` ampliada (la regla de premio no genera atribución económica).
  - **GREEN:** el acceso se aplica en el servidor y respeta derechos.
  - **STOP:** se necesita modificar las reglas de regalías o el motor de acceso más allá de crear reglas.

### G6: cupones WooCommerce (≤ 15 %)

- **Objetivo:** cupón de uso único emitido por el servidor dentro del canje con reserva.
- **Alcance:** cliente `wc/v3` con credenciales de servidor (secreto en archivo, nunca en argv ni en el repositorio), política de cupón (Contratos V1 §6), fallback de pool pregenerado, reconciliador Woo ↔ ledger y flujo de autorización adulta.
- **Archivos previstos:** `server/gamification/woo/{client,couponPolicy}.mjs`. **Sin cambios** en `server/lib/wooCatalog.mjs`.
- **Dependencias:** G5-A, N6, N7 y N8; pruebas en un entorno Woo de staging.
- **Pruebas:**
  - `wooCouponPolicy`: más del 15 % rechazado, uso único, expiración, producto;
  - `wooCompensation`: un fallo de Woo deja los PM intactos;
  - idempotencia de doble capa;
  - el catálogo actual sigue intacto (`TiendaWooCatalog`).
- **GREEN:** en staging, cero cupones duplicados ante reintentos y cero débitos sin cupón o sin compensación.
- **STOP:** sin autorización adulta verificable; sin staging de Woo; cualquier escritura en la tienda de producción durante las pruebas.

### G7: colegios, piloto y despliegue gradual

- **Objetivo:** misiones institucionales, KPIs y piloto por cohortes.
- **Alcance:**
  - catálogo y evaluación de misiones (D38);
  - panel del coordinador con agregados (D37);
  - validación offline por el docente (D12);
  - cohortes A, B y C (D42), con asignación estable;
  - cuadro de KPIs de seis capas (D41);
  - runbook de los kill switches (D49);
  - unidades de despliegue por réplica, con todos los flags en OFF primero y activación por cohorte después.
- **Dependencias:** G4, G5-A, N1, N2 y N3. La cohorte C depende de G6.
- **Pruebas:** RBAC del coordinador (sin detalle personal), las misiones no dan PM a funcionarios, las alarmas de los KPIs y las pruebas de kill switch (detener emisión y canje sin detener la lectura).
- **GREEN:** se cumplen los diez criterios de aceptación del piloto de la fuente (finalización legítima sin regresión, duplicados = 0, ningún débito huérfano, error económico dentro del máximo, cero exposición no consentida, equidad, coste dentro del presupuesto y motivación intrínseca sin empeorar).
- **STOP:** cualquiera de los diez criterios en rojo.

---

## 4. Primera unidad ejecutable

**G2-01, arquitectura y contratos técnicos (solo documentos).** No toca código ni datos y desbloquea G3.

En paralelo, y de forma independiente, se puede autorizar **G4B.1, retiro de Trivia**. Antes necesita una comprobación de solo lectura del tráfico de `/trivia` en los logs del edge.
