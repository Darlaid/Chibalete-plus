# CHP-SEC-HISTORY-01A — Runbook humano: Firebase Web API key expuesta en el historial

> **Unidad:** CHP-SEC-HISTORY-01A (revisado en R1) · **Naturaleza:** inventario forense +
> procedimiento humano.
> **Ninguna acción de nube fue ejecutada.** La clave **no** fue usada, probada, impresa,
> copiada ni reconstruida. Este documento **no contiene credenciales** ni fragmentos de ellas.
> Requiere ejecución **humana** en Google Cloud Console.
>
> *La ruta del archivo conserva el nombre original por estabilidad de enlaces. El contenido
> usa la terminología correcta: **Firebase Web API key**, no «secreto Gemini».*

---

## 1. Contexto del incidente

Durante `CHP-SEC-GATE-01B` el job **no bloqueante** `gitleaks-history` reportó 10 hallazgos
históricos. Dos de ellos corresponden **al mismo valor**, detectado por dos reglas distintas
(`gcp-api-key` y `chibalete-gemini-key`; ambas casan el mismo patrón de clave de API de
Google).

| Dato | Valor |
|---|---|
| Ruta histórica | `studio-editor-bi/assets/index-CqLdlylq.js` |
| Línea | 1120 |
| Commit de introducción | `f7f0c5c` — *«Clean initial commit without secrets»*, 2026-03-20 10:24:12 −05:00 |
| Commit de eliminación | `91c6c64` — *«Clean repository: remove build artifacts…»*, 2026-03-20 10:31:44 −05:00 |
| Tiempo presente en HEAD | **7 min 32 s** |
| Presente en HEAD hoy | **No** (`gitleaks-head` = 0 hallazgos) |
| Presente en el historial | **Sí** |
| Repositorio | **público** (`visibility: public`); el commit se recupera **sin autenticación** |
| Accesibilidad pública | desde 2026-03-20 (**> 4 meses**) |

`f7f0c5c` es un **commit raíz** del repositorio, alcanzable desde 13 ramas locales,
5 referencias remotas (incluida `origin/main`) y **los 8 tags** `v4.0.0`–`v4.0.7`. Un clone
normal descarga el objeto.

### 1.1 Naturaleza de la credencial — corrección respecto de informes previos

Unidades anteriores la describieron como *«clave Gemini/GCP»*. El análisis forense **acota esa
descripción**, y el matiz cambia cuál es la acción correcta:

- **Línea 1120** contiene un objeto de configuración **Firebase Web** completo — presentes los
  nombres de campo `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`,
  `appId`, `measurementId` — y **ningún** identificador de Gemini.
  ⇒ El valor expuesto es una **Firebase Web API key** (Google API key asociada a Firebase,
  clave pública de configuración cliente).
- **Línea 1376** es donde coexisten `process.env.GEMINI_API_KEY` y `generativelanguage`.
  **gitleaks no detectó ningún literal en esa línea.**
  ⇒ **No quedó demostrado** que el secreto de servidor de Gemini se incorporara al bundle.
- El archivo es un **bundle minificado** (944 642 bytes, 1531 líneas, ~616 caracteres por
  línea): un artefacto compilado de **Studio Editor BI**, aplicación **distinta de
  Chibalete+**, que quedó incluida en el commit inicial y se retiró 7 min 32 s después.

Todo lo anterior se determinó con **conteos y números de línea**, comprobando presencia de
*nombres de campo* —que no son secretos—, sin volcar contenido.

---

## 2. Clasificación

Tres ejes distintos. **No confundirlos**: uno está demostrado, dos no.

| Eje | Clasificación | Fundamento |
|---|---|---|
| Exposición | **`PUBLIC_GIT_HISTORY_EXPOSURE`** — *demostrada* | El valor está en un commit público alcanzable y descargable con un clone normal; el commit responde sin autenticación |
| Distribución en navegador | **`DEPLOYED_BROWSER_DISTRIBUTION_INDETERMINATE`** — *no demostrada* | Una Firebase Web API key está **diseñada** para aparecer en el cliente, pero **esta unidad no verificó** que este bundle histórico concreto llegara a desplegarse, ni que siga siendo el bundle actual de Studio Editor BI |
| Uso actual | **`CURRENT_USAGE_INDETERMINATE`** — *no determinado* | El consumidor sería **Studio Editor BI**, externo a este repositorio (0 archivos bajo `studio-editor-bi/` en HEAD). Resolverlo exige revisar esa aplicación en operación o Google Cloud |
| Estado a asumir | **Clave potencialmente activa y expuesta públicamente** | No existe evidencia de revocación, de restricciones ni de uso. **No asumir que está inactiva.** |

**Estado de Chibalete+ (la aplicación de este repositorio):** su clave de Gemini se consume
**en servidor** (`server/aiEngine.js` → `process.env.GEMINI_API_KEY`) y **no se demostró
expuesta**. Existe además una ruta cliente heredada (`services/geminiService.ts` →
`import.meta.env.VITE_GEMINI_API_KEY`) que en producción se deja sin definir, mediando el
backend (`/api/leo/chat`, `/api/leo/recap`, `/api/album/tts`). Ver §10.2: es **deuda latente**,
no un incidente activo.

---

## 3. Evidencia (redactada)

- Detección: `gitleaks 8.21.2`, `detect --source . --config .gitleaks.toml --redact`.
- Fingerprints (no reversibles, sin material de la clave):
  - `f7f0c5c…:studio-editor-bi/assets/index-CqLdlylq.js:chibalete-gemini-key:1120`
  - `f7f0c5c…:studio-editor-bi/assets/index-CqLdlylq.js:gcp-api-key:1120`
- `gitleaks-head` sobre HEAD: **0 hallazgos** — el valor ya no está en el árbol actual.
- No se accedió a Google Cloud, al VPS ni a la aplicación desplegada.

---

## 4. Qué **no** significa «no es un secreto diseñado para permanecer oculto»

Google documenta que una Firebase Web API key viaja en el cliente y no es un secreto en el
sentido clásico. Eso **no** implica ninguna de estas cosas:

1. **No** implica acceso irrestricto permitido: sin restricciones, la clave puede usarse desde
   cualquier origen.
2. **No** implica ausencia de riesgo.
3. **No** implica autorización para otras APIs: si el proyecto tiene otras APIs habilitadas y
   la clave no está restringida, puede invocarlas —incluida Generative Language API—.
4. **No** implica que las reglas de seguridad de Firebase sean correctas: el control de acceso
   a datos son **las reglas**, y hay que revisarlas por separado.
5. **No** implica ausencia de impacto económico: el consumo se factura al proyecto propietario.

La seguridad de este tipo de clave depende de **(a) las restricciones de la clave de API** y
**(b) las reglas de seguridad de Firebase**, no del ocultamiento. Por eso la acción prioritaria
es **verificar restricciones**, no necesariamente «rotar».

---

## 5. Árbol de decisión

Recorrer **en orden**. No crear una clave nueva antes de conocer el consumidor.

### Rama 1 — Clave correctamente restringida, uso esperado y sin abuso
1. Confirmar **referrers autorizados** acotados a los dominios reales de Studio Editor BI.
2. Confirmar **APIs permitidas**, limitadas a las que la aplicación necesita.
3. Revisar **cuotas**.
4. Revisar **reglas de Firebase** (Firestore/Storage/RTDB).
5. **Documentar** el estado en §11.
→ La exposición es la esperada para una clave de configuración cliente. **La rotación no es
necesariamente urgente.**

### Rama 2 — Clave activa pero sin restricciones suficientes
1. **Crear reemplazo restringido** (referrers + APIs) — nunca al revés.
2. **Actualizar Studio Editor BI** con la clave nueva (fuera del repositorio).
3. **Validar** el consumidor en producción.
4. **Revocar** la clave antigua.
5. Revisar **consumo y facturación**.

### Rama 3 — Clave sin consumidor actual
→ **Revocar sin reemplazo.** No crear clave nueva.

### Rama 4 — Uso actual indeterminado *(estado actual del incidente)*
1. **No revocar a ciegas**: revocar una clave en uso deja fuera de servicio la aplicación.
2. **Identificar primero** el proyecto propietario y el consumidor real (§6.1, §6.2).
3. Solo entonces entrar en la rama 1, 2, 3 o 5.

### Rama 5 — Evidencia de uso abusivo
1. **Restringir o rotar con prioridad**, sin esperar a completar el diagnóstico.
2. Revisar **facturación, cuotas y logs**.
3. **Preservar evidencia** del incidente (exportar métricas y registros antes de cambiar nada).
4. Escalar como incidente de facturación además de seguridad.

---

## 6. Procedimiento humano en Google Cloud Console

> Ejecutar desde la consola web con una cuenta con permiso sobre el proyecto.
> **No** pegar el valor de la clave en ningún chat, ticket, archivo local, herramienta de IA
> ni en este documento.

### 6.1 Identificar el proyecto propietario
1. Obtener el `projectId` **desde la configuración de Studio Editor BI en ejecución**, no desde
   el historial de Git. El `projectId` **no es un secreto**.
2. Seleccionar ese proyecto en Google Cloud Console.
3. Confirmar que es el proyecto **de Studio Editor BI** y no el de Chibalete+.

### 6.2 Identificar los dominios reales de Studio Editor BI
1. Determinar los dominios/hosts desde los que se sirve realmente la aplicación.
2. Anotarlos: son la base de la restricción por referrers de §6.5.

### 6.3 Localizar la credencial por metadata, sin copiar su valor
1. **APIs y servicios → Credenciales**.
2. Identificarla por **nombre**, **fecha de creación** y **restricciones** — no por su valor.
3. Anotar únicamente el **ID de la clave** en §11. **No** copiar el valor fuera de la consola.

### 6.4 Revisar restricciones — **el control decisivo**
- **Application restrictions**: ¿«Ninguna», o referrers HTTP acotados a los dominios de §6.2?
- **API restrictions**: ¿«Sin restricción», o limitada a las APIs necesarias?
- **APIs habilitadas** en el proyecto: listarlas.
- ¿Puede esta clave invocar **Generative Language API**? (habilitada + no excluida por las
  restricciones de API).

### 6.5 Revisar métricas, consumo y facturación
1. **APIs y servicios → Panel**: tráfico por API, últimos 30–90 días.
2. Buscar **picos anómalos**, orígenes inesperados o consumo de APIs que la app no usa.
3. **Facturación → Informes**: coste por SKU y proyecto; desviaciones **desde 2026-03-20**.
4. Registrar en §11. Si hay indicios de abuso → **rama 5**.

### 6.6 Revisar reglas de Firestore y Storage
Son el control real de acceso a datos, independiente de la clave. Revisarlas aunque la clave
resulte estar bien restringida.

### 6.7 Endurecer la clave existente (vía preferente cuando no hay abuso)
1. Aplicar **restricción de aplicación** por referrers a los dominios de §6.2.
2. Aplicar **restricción de API** a lo estrictamente necesario.
3. Validar la aplicación (§6.10).

### 6.8 Crear reemplazo **solo cuando corresponda** (ramas 2 y 5)
1. **Solo después** de conocer el consumidor (§6.1–§6.2).
2. **Crear la clave nueva primero**; nunca revocar antes de tener el reemplazo en servicio.
3. Aplicar de entrada las restricciones de §6.7.
4. Nombrarla de forma trazable (p. ej. `studio-editor-bi-web-<fecha>`).

### 6.9 Actualizar la configuración **fuera del repositorio**
- El valor solo en el mecanismo de configuración del despliegue de Studio Editor BI
  (variables de entorno del contenedor / gestor de secretos).
- **Prohibido** commitearlo, escribirlo en un `.env` versionado o pegarlo en tickets o chats.
- Rebuild + redeploy de Studio Editor BI.

### 6.10 Validar el consumidor
1. Cargar la aplicación en un navegador limpio.
2. Verificar login, lectura/escritura de datos y funciones de IA.
3. Consola del navegador sin `API_KEY_INVALID`, `PERMISSION_DENIED`,
   `REQUESTS_FROM_REFERER_BLOCKED`.

### 6.11 Revocar la clave histórica
**Solo después** de que §6.10 esté en verde:
1. Eliminar la clave antigua en **Credenciales**.
2. Confirmar que la aplicación sigue operativa 24 h después.
3. Registrar fecha y responsable en §11.

### 6.12 Comprobar errores y cuotas tras el cambio
- Panel de APIs: tasa de error estable · Cuotas: sin agotamiento ·
  Facturación: sin desviación en los 7 días siguientes.

---

## 7. Rollback seguro

- **Antes de revocar:** rollback trivial — revertir el despliegue a la configuración anterior;
  la clave antigua sigue viva.
- **Después de revocar:** la clave antigua **no se puede restaurar**. El rollback consiste en
  crear otra clave nueva con las mismas restricciones y volver a desplegar. Por eso el orden
  §6.8 → §6.9 → §6.10 → §6.11 es **obligatorio**.
- Si el fallo aparece tras endurecer restricciones (§6.7), revertir **solo la restricción
  concreta** que rompió el consumidor y volver a acotarla con más precisión. **No** dejar la
  clave sin restricción como solución permanente.

---

## 8. Criterios de cierre

1. Proyecto propietario identificado y registrado.
2. Dominios reales de Studio Editor BI identificados.
3. Application restrictions y API restrictions verificadas y documentadas.
4. APIs habilitadas revisadas; determinado si Generative Language API es alcanzable.
5. Consumo y facturación revisados desde 2026-03-20 — sin abuso, o escalado.
6. Reglas de Firestore y Storage revisadas.
7. Clave restringida correctamente **o** reemplazada y la antigua revocada.
8. Consumidor validado en producción.
9. §11 completo, con responsable y fecha.
10. Decisión registrada sobre la limpieza de historia (§10.1).

---

## 9. Prohibición de manejo de claves

- **Nunca** guardar claves en el repositorio ni en archivos locales versionables.
- **Nunca** pegar una clave en un chat, ticket, issue o herramienta de IA — **incluida esta**.
- **Nunca** pasarlas como argumento de línea de comandos (quedan en el historial del shell).
- El valor solo debe existir en el gestor de secretos del despliegue y en la consola de Google.
- Ante una exposición: **restringir o rotar primero**, investigar después.

---

## 10. Planes posteriores

### 10.1 Limpieza de la historia Git

El valor permanece en el historial **público**. Reescribirlo exige una **unidad propia**:

- `f7f0c5c` es un **commit raíz**: reescribir cambia **todos** los SHA descendientes.
- Afecta a 13 ramas locales, 5 referencias remotas —incluida **`origin/main`**— y **8 tags**.
- Obliga a `--force-with-lease`, a reetiquetar `v4.0.0`–`v4.0.7` y a rehacer todos los clones.
- **Los clones existentes conservarán el objeto** aunque se reescriba el remoto.
- Hay que **asumir que el valor ya pudo ser capturado**: llevaba más de 4 meses accesible sin
  autenticación.

**La limpieza de historia NO sustituye a restringir o revocar.** Orden correcto: **primero §5
y §6**, después planificar la reescritura, con coordinación explícita del equipo.

**No ejecutar `git filter-repo` ni equivalente en esta unidad.**

### 10.2 Deuda latente en Chibalete+ (no es este incidente)

`services/geminiService.ts` puede consumir `import.meta.env.VITE_GEMINI_API_KEY`. Toda
variable `VITE_*` se **inlinea en el bundle de navegador** durante el build. Hoy en producción
se deja sin definir y el backend media, pero **si alguien la define al construir, la clave de
Gemini quedaría publicada en el bundle**. Recomendación: eliminar esa ruta cliente y dejar solo
la mediación por backend, en unidad aparte.

---

## 11. Registro de decisión humana

> Rellenar durante la ejecución. **No escribir valores de claves en esta tabla.**

| Campo | Valor |
|---|---|
| Proyecto confirmado (`projectId`) | |
| Dominios reales de Studio Editor BI | |
| ID de la clave (no el valor) | |
| Application restrictions observadas | |
| API restrictions observadas | |
| APIs habilitadas en el proyecto | |
| ¿Generative Language API alcanzable con esta clave? | |
| Uso actual confirmado (sí / no / cuál) | |
| Indicios de abuso (consumo o facturación) | |
| Rama del árbol de decisión aplicada (1–5) | |
| ¿Requiere reemplazo? (sí / no + motivo) | |
| Nueva clave creada (ID, no el valor) | |
| Restricciones aplicadas a la nueva | |
| Reglas de Firestore/Storage revisadas | |
| Consumidor validado (fecha / resultado) | |
| Clave antigua revocada (sí / no) | |
| Fecha de revocación | |
| Responsable | |
| Evidencia adjunta (sin credenciales) | |
| Decisión sobre limpieza de historia | |

---

## 12. Qué NO hizo esta unidad

No se usó ni probó la clave. No se accedió a Google Cloud ni se ejecutó `gcloud`. No se
abrieron archivos `.env` ni ignorados. No se modificó código, CI, dependencias ni producción.
No se reescribió historia. No se accedió al VPS ni a Backblaze. No se desplegó. No se verificó
si el bundle histórico llegó a desplegarse ni si sigue siendo el bundle actual de Studio
Editor BI — de ahí la clasificación `DEPLOYED_BROWSER_DISTRIBUTION_INDETERMINATE`.
