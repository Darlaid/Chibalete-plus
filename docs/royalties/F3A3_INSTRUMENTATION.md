# CHP-EDITORIAL-ROYALTIES-2026-01 — F3-A3 · Instrumentación económica de los 6 modos

**Fecha:** 2026-10-24 · **Base:** `b01bd77` (SEC-DEPS-02 GREEN) · **Plan:** `PLAN_GENERAL_V1_1.md` §3.3.9, §4 y unidad 7 · **Decisiones:** `DECISIONES_F0C.md` (P3, P4, P10)
**Modo:** implementación local, pruebas y CI. **Sin despliegue.** `ECONOMIC_INGEST_MODE` y `RIGHTS_ENFORCEMENT_MODE` siguen apagados.
**Veredicto:** **GREEN_LOCAL**. El gate completo de F3-A3 del Plan (despliegue, smoke en producción, 1 episodio real al cambiar de modo, y VoiceOver/TalkBack) queda **pendiente de autorización**.

## 1. Alcance y discrepancia registrada

El prompt de la unidad describía F3-A3 como «conectar el motor F3-A1 con los eventos F3-A2». El Plan V1.1 define F3-A3 como la **instrumentación de los 6 modos**: el hook `useEconomicTick`, la sesión nativa en EPUB y las señales de accesibilidad, con despliegue y smoke en producción como gate (`DECISIONES_F0C.md`: «Despliegue (F3-A4) es el gate de F3-A3»). Conectar el motor con `events.db` es el núcleo de F3-B.

Se reportó antes de implementar y Dirección eligió: **alcance del Plan, solo local y CI**. Por eso:
- no hay vista previa de Q, R ni S (F3-B);
- no hay despliegue ni ingesta encendida, así que los criterios «en producción» del Plan no se pueden cumplir en esta unidad.

## 2. Implementación

| Archivo | Cambio |
|---|---|
| `utils/economicTick.mjs` (nuevo) | Núcleo **puro** del cliente: ventana, visibilidad, señales humanas, avance de la narración, gesto, buffer y desfase de reloj. No calcula nada económico. |
| `hooks/useEconomicTick.ts` (nuevo) | Hook único para los 6 modos. **Totalmente inerte** si el servidor no declara `economicIngest: 'on'`: sin listeners, sin timers y sin red. |
| `server/server.js` | `/api/runtime-config` añade `economicIngest` (valor de `econIngestMode()`, `off` por defecto). Es el único cambio de servidor. |
| `pages/VisorPDF.tsx`, `VisorTexto.tsx`, `VisorInmersivo.tsx`, `VisorAccesible.tsx`, `VisorAlbum.tsx` | Una llamada a `useEconomicTick` junto a la sesión existente, con la misma condición de activación |
| `components/epub-reader/EpubReaderApp.tsx` | **Sesión nativa del EPUB**: el usuario de `/api/auth/me`, la interacción dentro de los iframes y los `relocate` del lector |
| `components/epub-reader/foliateAdapter.mjs` | `onActivity(cb)`: reenvía la interacción de confianza (`isTrusted`) de las páginas del libro. No cambia nada más. |
| `utils/NarrativeAudioEngine.ts`, `hooks/useNarrativeAudio.ts` | Accesor de solo lectura al medio de **narración** del álbum. El ambiente y los efectos quedan fuera. |
| `utils/__tests__/economicTick.test.mjs` (nuevo), `server/royalties/__test__/econIngestHttp.test.mjs` (sección [8]), `package.json` (`test:royalties`) | Pruebas |

**No se modifica:**
- el motor F3-A1;
- la ingesta F3-A2 (`econEvents.mjs` y su rama en `/api/v1/events`);
- `session_heartbeat` y los demás eventos del backbone, el progreso y las métricas pedagógicas;
- la autenticación, los usuarios, los derechos, las clases comerciales, `royalties.db` y `events.db`;
- las dependencias.

No hay esquemas zod nuevos ni entradas públicas sobre listas: la excepción ZOD-01 no se ve afectada.

### 2.1 Qué declara cada `econ_tick`

| Campo | Regla del cliente |
|---|---|
| Cadencia | Un tick cada 15 s (= `slotSeconds`); envío agrupado cada 30 s, al ocultar la pestaña y al salir. Lotes de ≤ 50 eventos; se descarta lo de más de 9 min, que el servidor rechazaría a los 10. |
| `windowMs` | Desde el tick emitido anterior, con un máximo de 2 min (el máximo del servidor) |
| `visible` | Solo si la pestaña estuvo visible **toda** la ventana |
| Señales humanas | Eventos de confianza en captura: puntero, teclado, rueda, toque, `click` (la activación de VoiceOver y TalkBack llega como click) y `focusin` (navegación por elementos). En EPUB, además, la interacción dentro de los iframes y los `relocate` con motivo `page`, `snap`, `scroll` o `navigation`. **El scroll del documento no cuenta como señal**, porque los visores lo provocan solos (auto-avance y sincronía del inmersivo); `anchor` (re-maquetación) tampoco. |
| `audio` | Solo el avance **real** del medio de narración: Guiado (TTS), Inmersivo (relevo A/B) y Álbum (región). Un salto (seek) no suma, un medio silenciado no avanza y la velocidad debe estar entre 0,25 y 4. La reproducción vale como iniciada por un gesto si arrancó ≤ 10 s después de una señal humana; tras 2 min sin avance hace falta otro gesto. |
| Emisión | Sin señal en la ventana, sin avance de audio y sin cola acreditable (señal hace ≤ 120 s con la pestaña visible) **no se emite nada** |
| Reloj | `clientTs` = reloj local + desfase medido una vez con `/api/server-time` (punto medio del viaje) |
| Sesión | Un ULID por montaje (obra × modo). Cambiar de modo abre otra sesión técnica; el motor une las sesiones por usuario y obra. |

Con la ingesta apagada, el hook no hace nada, así que el producto no cambia. Con la ingesta encendida, los ticks viajan en peticiones propias a `/api/v1/events` y van a `econ_events` (F3-A2); la tabla `events` y las métricas pedagógicas no reciben nada (prueba HTTP [7]).

### 2.2 Superficies

| Modo | Superficie | Vía visual | Vía de escucha |
|---|---|---|---|
| `pdf` | `VisorPDF` | ✔ | — |
| `text` | `VisorTexto` (Modo Guiado) | ✔ | TTS (`audioRef`) |
| `immersive` | `VisorInmersivo` (V1, la ruta productiva) | ✔ | narración A/B |
| `a11y` | `VisorAccesible` | ✔ (teclado, click, foco) | — |
| `album` | `VisorAlbum` | ✔ | narración de región |
| `epub` | `epub-reader.html` (`EpubReaderApp`) | ✔ (iframes y navegación) | — |

`VisorInmersivoV2` no se instrumenta: es solo de desarrollo, con una ruta local y doble guarda en `App.tsx`. LU/Android, MOOK, podcast y vídeo siguen fuera, según P10.

## 3. Reglas económicas preservadas

- **Identidad:** el usuario sale siempre de la sesión firmada. El cliente no envía `userId`.
- **Episodio, unión de modos, franjas de 15 s, pausa de 120 s, tope de escucha de 20 min, 45 s para cualificar, tope diario, desempate entre obras y avance equivalente desactivado:** todo sigue en el motor F3-A1 con `rs-2026-01-v1`, sin cambios. El cliente no decide la elegibilidad.
- **Atribución, derechos y clases:** las sigue resolviendo el servidor (F3-A2 y F2-B), con denegación por defecto. No hay reclasificación ni inferencias.
- **Sin eventos sintéticos en producción:** las pruebas usan temporales; producción no se ha tocado.

## 4. Pruebas

| Suite | Entorno | Resultado |
|---|---|---|
| `economicTick` (nueva: cliente → validador real del servidor → motor real) | Windows | **62 ✓, 0 ✗** |
| `econIngestHttp` [8] (servidor real en `enforce`, dos réplicas y una con el flag apagado) | Linux | ver §6 (CI) |
| `test:royalties`, resto de suites | Windows | economicEpisodes, publishers, rights, commercialClass y econEvents (67 ✓) en verde. Las suites POSIX se saltan en Windows. |
| `commercialClassHttp` | Windows | 1 ✗ en la primera vuelta («hora del servidor», `since >= t0`) y 36 ✓ en dos repeticiones: intermitencia conocida en Windows, en este árbol y en la base |
| `test:a11y-reader`, `test:mook`, `test:content-rmw`, `test:analytics`, `lint:immersive-guards`, `chibaleteEpubReader` (47 ✓) | Windows | verde |
| `test:immersive` | Windows | 1 ✗ **previo**: `playbackTelemetryNonBlocking` exige `x-user-id` en `hooks/useImmersivePlayback.ts`, archivo que F3-A3 no toca (sin diff respecto de `b01bd77`) |
| `typecheck:baseline` | Windows | sin regresiones (14 errores actuales frente a 25 de la base) |
| `npm run build` | Windows | correcto |

**Cobertura de los casos pedidos** (en `economicTick` salvo que se indique otra suite):

| Caso | Dónde |
|---|---|
| Integridad y lectura de eventos económicos | [1]: todos los ticks pasan `normalizeEconTick`; HTTP [8]: lectura de `econ_events` por el motor |
| Idempotencia y ausencia de doble conteo | [9]: reenvío, orden y unicidad de ids; [3]: dos pestañas se unen |
| Cálculo multimodal y límites de episodios | [2]: un cambio de modo da 1 episodio y Q = 1; recorrer los 6 modos da 1 episodio; [4]: equivalencia entre los 6 modos; [5]: pausas; [7]: tope de escucha |
| Escucha accesible sin desventaja | [6]: pestaña oculta, gesto, silencio, 2×, seek y relevo A/B |
| Exclusión de gratuitos, pilotos, QA e internos | [8]: `unclassified`, `pilot`, `courtesy`, `internal`, `template`, `promo_authorized` sin fondo y cuenta interna |
| Sin remuneración sin elegibilidad comercial o contractual | [8]: sin derechos vigentes → `work_not_eligible`; Q = 0 |
| Compatibilidad con las bases actuales | sin migraciones; HTTP [8] sobre el `events.db` compartido de F3-A2 |
| Instrumentación inerte y única | [11], estructural sobre los 6 visores, el hook, el adaptador EPUB y el servidor |

## 5. Impacto sobre datos y producción

- **Ninguno.** No hay despliegue, ni escrituras en producción, ni migraciones, ni cambios de credenciales.
- **Si se despliega con la ingesta apagada,** la única diferencia observable es un campo más en `/api/runtime-config` (`"economicIngest":"off"`). Ningún visor emite.

## 6. CI

Se completa con el run del commit de F3-A3 (`identity-preflight` ejecuta `test:royalties`, incluida la prueba HTTP en Linux).

## 7. Riesgos y condiciones para desplegar

1. **El gate del Plan está incompleto.** Faltan:
   - el E2E en navegador real por modo;
   - VoiceOver (iOS) y TalkBack (Android), que son manuales y en dispositivo;
   - «una lectura continua cambiando de modo da 1 episodio en producción», que exige desplegar y **encender la ingesta**.

   Cada paso necesita autorización explícita.
2. **Lectores de pantalla en modo lectura continua.** Cuando VoiceOver o TalkBack leen texto sin mover el foco ni activar nada, el navegador no recibe ningún evento. Esa lectura no produce señales y, pasados 120 s, no se acredita. Es la prueba crítica del gate de accesibilidad (G4) y, si se confirma, hace falta una decisión de producto: una señal accesible explícita o una revisión de P3.
3. **El auto-avance del Modo Accesible no es una señal humana** (por diseño, P3). Un lector que solo usa el auto-avance sin interactuar durante más de 120 s deja de acreditar. Hay que revisarlo con el responsable de accesibilidad junto con el punto 2.
4. **La actividad la declara el cliente** (F3-A2 §6.1). Las anomalías se tratan en F3-B.
5. **Coste:** con la ingesta encendida, cada lector envía ≈ 2 peticiones por minuto y el servidor evalúa `decideContentAccess` una vez por obra. Hay que medirlo con carga antes de encender en producción.
6. **Despliegue:** el backend y el frontend son imágenes nuevas, y el orden es el habitual (`api_1` → `api_2` → front). Si se despliega con la ingesta apagada, la instrumentación queda latente.
7. **Fallo previo ajeno:** `playbackTelemetryNonBlocking` (`test:immersive`).
