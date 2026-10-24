# CHP-EDITORIAL-ROYALTIES-2026-01 — F3-A3 / A11Y-LAB-02 · Laboratorio de lectura accesible

**Fecha:** 2026-10-24 · **Base:** `e04eaa6` · **Laboratorio:** `scripts/royalties/a11yLab.mjs` · **Prueba previa:** `scripts/royalties/a11yLabSelfTest.mjs`
**Modo:** local. Sin despliegue, sin producción y sin datos reales.
**Veredicto:** **YELLOW**. El laboratorio está aislado, operativo y verificado (19/19), con acceso preparado en la red local. **Faltan las pruebas en iPhone y Android**, que no se han ejecutado y no se declaran superadas.

## 1. Base y CI

- HEAD `e04eaa6`, sincronizado con `origin/chp/epub-mainfile-r1-release`.
- CI de `e04eaa6`: `security` ✓ y `content-rmw` ✓. `identity-preflight` no se dispara en commits solo de documentación; está en verde en `44bc915`, con el mismo código.
- **CI de esta unidad (`7e22057`, código en `94f295e`):** `security` ✓ (`40131665742`), `content-rmw` ✓ (`40131665635`) e `identity-preflight` ✓ (`40131665648`).

## 2. Entorno elegido: Docker Desktop

WSL solo tiene la distribución interna de Docker Desktop, sin Node, así que se usa Docker Desktop con la imagen oficial `node:20-bookworm`, la misma familia que `Dockerfile.api` (Node 20).

1. **Imagen `chp-a11ylab:local`:** copia limpia del árbol con `git archive` (sin `.env`, `data/`, `data-critical/`, uploads ni archivos sin versionar) y `npm ci` dentro del contenedor.
2. **Contenedor `chp-a11ylab`:** laboratorio en `/tmp/chp_a11ylab` dentro del contenedor; API en :3000 **sin publicar**; Vite en :5173 publicado **solo** en `127.0.0.1` y en la IP local `192.168.0.3`. Nada en `0.0.0.0`, en puertos públicos, en DNS ni en el VPS.

```bash
# construir (desde el repo; en PowerShell, sin conversión de rutas)
git archive --format=tar HEAD | gzip > ../chp_a11ylab_src.tgz
docker run -d --name chp-a11ylab-build node:20-bookworm sleep 3600
docker cp ../chp_a11ylab_src.tgz chp-a11ylab-build:/tmp/src.tgz
docker exec chp-a11ylab-build sh -c "mkdir -p /app && tar -xzf /tmp/src.tgz -C /app && cd /app && npm ci --no-audit --no-fund"
docker stop chp-a11ylab-build
docker commit -c 'CMD ["sleep","infinity"]' -c 'WORKDIR /app' chp-a11ylab-build chp-a11ylab:local
docker rm chp-a11ylab-build

# arrancar para dispositivos (sustituir 192.168.0.3 por la IP local del equipo)
docker run -d --name chp-a11ylab -p 127.0.0.1:5173:5173 -p 192.168.0.3:5173:5173 chp-a11ylab:local
docker exec chp-a11ylab sh -c "umask 077; node scripts/royalties/a11yLab.mjs seed --dir /tmp/chp_a11ylab --origin http://192.168.0.3:5173 > /tmp/lab_seed.txt"
docker exec -d chp-a11ylab sh -c "npm run dev > /tmp/lab_vite.log 2>&1"
docker exec -d chp-a11ylab sh -c "node scripts/royalties/a11yLab.mjs start --dir /tmp/chp_a11ylab > /tmp/lab_api.log 2>&1"

# prueba previa (contenedor SIN red)
docker run -d --name chp-a11ylab-test --network none chp-a11ylab:local
docker exec chp-a11ylab-test node scripts/royalties/a11yLabSelfTest.mjs
docker rm -f chp-a11ylab-test

# parar y retirar
docker rm -f chp-a11ylab          # el laboratorio y sus datos sintéticos desaparecen con el contenedor
docker rmi chp-a11ylab:local      # opcional: solo cuando ya no haga falta repetir las pruebas
```

> En Git Bash, `/tmp/...` se convierte en una ruta de Windows antes de llegar a `docker exec`: usar PowerShell o anteponer `MSYS_NO_PATHCONV=1`.

## 3. Aislamiento

Durante la verificación se encontraron y corrigieron cuatro fugas posibles en `a11yLab.mjs`:

| Riesgo encontrado | Corrección |
|---|---|
| `start` heredaba todo el entorno del shell, con posibles claves reales | Entorno mínimo explícito (PATH, HOME, TMPDIR, LANG, TZ y las variables del laboratorio) |
| `server.js` carga el `.env` del repositorio con dotenv | `start` se detiene si existe `.env` |
| Varios módulos escriben en `data/` con rutas fijas (memoria de Leo, configuración LU) y `progressService` usa `data/progress.db` por defecto | `start` se detiene si existen `data/` o `data-critical/`; `PROGRESS_SQLITE_PATH` y `LEO_EVIDENCE_DB` van al laboratorio |
| La Tienda consulta el catálogo público de WooCommerce | `CHP_TEST_WOO_ORIGIN` → `127.0.0.1:9`, que no lleva a ninguna parte (el servidor solo lo honra con `NODE_ENV=test`) |
| `start` no reenviaba `SIGTERM`/`SIGINT` al servidor | Parar el laboratorio para también el servidor |

Verificado en la prueba previa, dentro de un contenedor **sin red**:

| Comprobación | Resultado |
|---|---|
| Datos sintéticos en el temporal, con marcador; `seed` rechaza otras rutas | ✓ |
| Ingesta encendida **solo** en el servidor del laboratorio (`economicIngest: on`); `--ingest off` la apaga | ✓ |
| Servidor sin `ADMIN_SECRET`, con las claves de IA vacías y `NODE_ENV=test` (leído de `/proc/<pid>/environ`) | ✓ |
| Los 10 almacenes y directorios del servidor dentro del laboratorio | ✓ |
| Sin salida a internet (`EAI_AGAIN`); la Tienda responde 503 sin contactar el catálogo | ✓ |
| Ingesta sin sesión → 401 | ✓ |
| Tras la ejecución no existen `/app/data`, `/app/data-critical` ni `/app/public/uploads`, y el log no tiene errores de almacenamiento | ✓ |
| Parada limpia: puerto cerrado, sin procesos del servidor | ✓ |

**Credenciales:** cuenta `lector@a11y-lab.test` con contraseña aleatoria de 12 caracteres, generada por `seed` y guardada solo en `/tmp/lab_seed.txt` del contenedor (modo 600). No es ninguna cuenta real ni sirve fuera del laboratorio. **Contenidos:** dos obras generadas (`lab-largo`, 4000 palabras; `lab-corto`, 70) sin texto editorial.

**El contenedor de dispositivos sí tiene la red habitual de Docker.** Publicar un puerto exige una red con salida. La prueba sin red demuestra que el laboratorio funciona entero sin internet y que ninguna ruta suya contacta producción: el frontend usa rutas relativas (`/api`) que Vite reenvía al servidor del propio contenedor. El navegador del dispositivo sí carga las librerías públicas que la app pide a sus CDN (Tailwind y PDF.js), igual que en desarrollo.

## 4. Resultados de `seed`, `start` y `report` (prueba previa 19/19)

El núcleo real del cliente genera los ticks, el servidor real los valida y guarda en `econ_events`, y el motor F3-A1 los evalúa:

| Escenario | Ticks guardados | Acreditado | Esperado |
|---|---|---|---|
| Lectura normal (Accesible, 4 min, interacción cada 20 s) | 17/17 | 225 s, 1 episodio cualificado | ≈ 4 min ✓ |
| Sin actividad (una interacción y 5 min sin nada, pestaña visible) | 8 (el cliente deja de emitir) | 105 s | ≤ 120 s ✓ |
| Desplazamiento automático (auto-avance) 5 min | 8 | 105 s | ≤ 120 s ✓ |
| Lector de pantalla: una interacción y desplazamiento real cada 40 s, 5 min | 21/21 | 285 s | ≈ 5 min ✓ |
| Cambio de modo: Accesible 2,5 min → Guiado 2,5 min | 27/27 | 285 s (`a11y` 135 + `text` 150), **1 episodio, Q = 1** | sin duplicar ✓ |

`report` muestra, por sesión técnica, el modo, la ventana con ticks y **el tiempo acreditado evaluado de forma aislada**, además de los episodios agregados y Q. Esto se añadió en esta unidad: si no, varios casos de la misma obra en menos de 30 min se consolidarían en un solo episodio, como establece el contrato, y no se podrían evaluar uno por uno.

**Navegador real (Chrome de escritorio en el laboratorio):** la app, el login, el visor Accesible y la telemetría pedagógica (`reading_started`, `reading_progress`, `session_heartbeat`, `session_ended`) funcionan. La automatización del navegador no logró entregar clics ni teclas a la página, así que no hubo ninguna interacción de confianza. Los 4 desplazamientos reales de la ventana que se hicieron sin interacción previa produjeron **0 ticks económicos**, como exige la regla «el desplazamiento nunca abre una lectura». El camino completo con interacción real queda para las pruebas en dispositivo.

## 5. Acceso desde los dispositivos

**Red:** el equipo del laboratorio y los dispositivos deben estar en la **misma red local controlada**: la wifi de casa u oficina detrás del router `192.168.0.1`, o mejor una red aislada o de invitados sin otros equipos. No hace falta abrir puertos en el router.

1. En el equipo: `docker ps` debe mostrar `chp-a11ylab` con `127.0.0.1:5173` y `192.168.0.3:5173`.
2. Contraseña: `docker exec chp-a11ylab cat /tmp/lab_seed.txt`. No la compartas fuera de la sesión de pruebas.
3. Si el dispositivo no llega a `http://192.168.0.3:5173`:
   - comprobar que está en la misma red y que el router no aísla clientes;
   - si Windows muestra el aviso del cortafuegos para **Docker Desktop Backend**, permitirlo solo en **redes privadas**. Es un ajuste del propio equipo, no del laboratorio. No lo he cambiado.

**iPhone o iPad (VoiceOver):**
1. Safari → `http://192.168.0.3:5173` → «Soy Lector» → cuenta del laboratorio.
2. Abrir la obra: Biblioteca → *Laboratorio · texto largo*, o directamente `http://192.168.0.3:5173/#/leer/accesible/lab-largo` (Guiado: `#/leer/texto/lab-largo`).
3. VoiceOver: Ajustes → Accesibilidad → VoiceOver, o el atajo de accesibilidad (triple clic en el botón lateral).
4. «Leer todo» desde arriba: dos dedos hacia abajo. Desde el elemento actual: dos dedos hacia arriba. Pausar o reanudar: toque con dos dedos.

**Android (TalkBack):**
1. Chrome → `http://192.168.0.3:5173` → mismo acceso.
2. TalkBack: Ajustes → Accesibilidad → TalkBack, o el atajo de volumen.
3. «Leer desde arriba» o «desde el siguiente elemento»: menú de TalkBack (toque con tres dedos o deslizar abajo y luego a la derecha, según la versión). Activar: doble toque. Pausar: menú de TalkBack o toque con dos dedos.

## 6. Guía manual (sobre la matriz de `F3A3_A11Y_FIX_01.md` §5.2)

**Antes de cada caso:** anotar la hora de inicio. **Después:** `docker exec chp-a11ylab node scripts/royalties/a11yLab.mjs report --dir /tmp/chp_a11ylab` y copiar solo la línea de la sesión nueva («Acreditado por sesión»). El informe no contiene datos personales: identificador técnico de la sesión, modo, obra sintética, horas y segundos. Entre casos, cerrar el visor (volver a la Biblioteca) para que cada caso sea una sesión distinta.

| Caso | Qué hacer | Esperado (acreditado de la sesión) | Dónde |
|---|---|---|---|
| **VO-1 / TB-1** «Leer todo», texto largo, 10 min | Abrir `lab-largo` en Accesible, doble toque en «Siguiente sección» y luego «Leer todo» sin tocar nada | ≥ 90 % de los 10 min si el lector desplaza la página; si no, ≤ 120 s, y se anota como limitación | Dispositivo |
| **VO-2 / TB-2** texto que cabe en pantalla, 3 min | Abrir `lab-corto` en Accesible, doble toque en el texto y «Leer todo»; quedarse escuchando | ≤ 120 s (no hay desplazamiento): **confirma la limitación**, no es un fallo | Dispositivo |
| **VO-3 / TB-3** navegación por elementos, 5 min | Deslizar un dedo a la derecha, elemento a elemento | ≥ 90 %. Anotar si se acredita sin desplazar (foco) | Dispositivo |
| **VO-4 / TB-4** auto-avance, 5 min | **Actualizado en `F3A3_A11Y_LAB_03.md` §6.1** (cuenta `lector-avance@…` con el avance desbloqueado) | ≤ 120 s tras el último gesto | Dispositivo |
| **VO-5 / TB-5** Guiado sin TTS, 5 min | `#/leer/texto/lab-largo`, «Leer todo» con el lector de pantalla | ≥ 90 % (igual que VO-1) | Dispositivo |
| **VO-6 / TB-6** EPUB | **Actualizado en `F3A3_A11Y_LAB_03.md` §6.1** (`lab-epub` sintético; solo paginado: el producto no tiene modo continuo en EPUB) | Ver LAB-03 | Dispositivo |
| **VO-7 / TB-7** cambio de modo | 3 min en Accesible y, sin parar, 3 min en Guiado | En «Episodios»: **1 episodio** de `lab-largo` con `a11y` y `text`, Q = 1, total ≤ 6 min | Dispositivo |
| **VO-8 / TB-8** pausa | «Leer todo» 2 min, pausar el lector 3 min, reanudar 2 min **sin tocar la pantalla** | ≤ 4 min (la pausa no cuenta y el desplazamiento solo no reabre); tras un doble toque, vuelve a acreditar | Dispositivo |
| **VO-9 / TB-9** abandono | A mitad de lectura, bloquear la pantalla o cambiar de app 3 min | Nada acreditado mientras está oculta | Dispositivo |
| **X-1** ingesta apagada | Reiniciar el servidor con `--ingest off` (ver abajo), leer 2 min y volver a encenderlo | `runtime-config` → `off`; **ninguna sesión nueva** en `report` | Navegador del equipo (`http://localhost:5173`) o cualquier dispositivo |

```bash
# X-1: apagar y volver a encender la ingesta del laboratorio
docker exec chp-a11ylab sh -c "pkill -TERM -f 'a11yLab.mjs start'"
docker exec -d chp-a11ylab sh -c "node scripts/royalties/a11yLab.mjs start --dir /tmp/chp_a11ylab --ingest off > /tmp/lab_api.log 2>&1"
#   … leer 2 min, comprobar http://localhost:5173/api/runtime-config → "off" y report sin sesiones nuevas …
docker exec chp-a11ylab sh -c "pkill -TERM -f 'a11yLab.mjs start'"
docker exec -d chp-a11ylab sh -c "node scripts/royalties/a11yLab.mjs start --dir /tmp/chp_a11ylab > /tmp/lab_api.log 2>&1"
```

**Qué exige un dispositivo físico y qué no:** VoiceOver para iOS solo existe en un iPhone o iPad real; el simulador de iOS no lo trae. TalkBack funciona en el emulador de Android, pero la prueba válida es en dispositivo. X-1 se puede hacer desde el navegador del equipo.

## 7. Criterios de aceptación económica

| Criterio | Cómo se comprueba |
|---|---|
| La lectura accesible con señales verificables acredita | VO/TB-1, -3 y -5 ≥ 90 % cuando hay desplazamiento o foco observable |
| Los desplazamientos automáticos no acreditan | VO/TB-4 ≤ 120 s; prueba previa [3] |
| La lectura sin señales deja de acreditarse según el contrato (pausa de 120 s) | VO/TB-2, -8 y -9; prueba previa [2] |
| Una misma lectura en dos modos no duplica | VO/TB-7: 1 episodio, Q = 1; prueba previa [5] |
| Sin cambios en porcentajes ni parámetros | Prueba previa: `rs-2026-01-v1` intacto (pausa 120, 45 s, tope 20 min, franja 15 s, 25 % BRD); el motor no se modifica |

**No se fabrican señales:** el laboratorio no inyecta interacciones; los resultados se registran tal como salgan.

## 8. Bloqueos y decisiones pendientes

1. **Pruebas en dispositivo** (VO y TB, casos 1 a 9): requieren una persona con iPhone o iPad y con Android. Hasta entonces, YELLOW.
2. **VO-6 / TB-6 (EPUB):** el laboratorio no incluye una obra EPUB sintética. Añadirla es una ampliación pequeña de `seed` (generar un EPUB mínimo), pero **no se hizo sin instrucción**. Decidir si se incluye antes de las pruebas.
3. **VO-4 / TB-4:** el auto-avance se desbloquea tras 2 h de lectura acumulada. En el laboratorio puede no estar disponible. Decidir si basta con la prueba automática ([3] y `economicTick` [12]) o si se prepara un estado sintético que lo desbloquee.
4. **Directorios de pruebas anteriores** (solo datos sintéticos, verificados con marcador): el entorno denegó su eliminación. Los retira el usuario (lista en la entrega).
5. **Imagen `chp-a11ylab:local` (≈ 2,6 GB):** se conserva para repetir las pruebas. Retirarla cuando ya no haga falta (`docker rmi chp-a11ylab:local`).
