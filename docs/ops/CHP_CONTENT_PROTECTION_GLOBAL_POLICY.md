# CHP-CONTENT-PROTECTION-2026-01 — Política global de contenidos: solo lectura protegida (CP-4D)

Fecha: 2026-10-19 · Local, sin deploy · Rama `chp/epub-mainfile-r1-release`

```
GLOBAL_CONTENT_POLICY:                 READ_ONLY_PROTECTED
ALL_TITLES_SAME_PROTECTION:            YES
PER_TITLE_PROTECTION_CLASSIFICATION:   DEPRECATED
ALL_AVAILABLE_READING_MODES:           PRESERVED
READER_DOWNLOAD_CONTROLS:              ZERO
PDF_EXPLICIT_DOWNLOAD:                 DISABLED
EPUB_EXPLICIT_DOWNLOAD:                DISABLED
RAW_ORIGINAL_PUBLIC_ACCESS:            DENIED
WEB_BYTE_EXTRACTION_PREVENTION:        NOT_ABSOLUTE
WATERMARK_POLICY:                      PROHIBITED
ACCESSIBILITY_REGRESSION:              ZERO
```

## Política editorial

**Todos los contenidos de Chibalete+, independientemente de su procedencia, reciben la misma protección. Los usuarios autorizados pueden disfrutarlos en todos los modos de lectura disponibles, pero Chibalete+ no ofrece descarga de los libros ni acceso público a sus archivos.**

La política aplica por igual a:
- Chibalete Editores, editoriales externas, dominio público y contenidos licenciados.
- Material pedagógico y MOOK.
- Álbum, PDF, EPUB, audio y vídeo.

Ni la editorial, ni el autor, ni la licencia, ni el contrato, ni la procedencia cambian la protección. Derecho a leer ≠ derecho a descargar.

## Limitación técnica

**En un navegador, los datos necesarios para representar un contenido pueden ser recuperables por un usuario con conocimientos técnicos. Chibalete+ controla el acceso, elimina las funciones ordinarias de descarga y dificulta la extracción trivial, pero no afirma imposibilidad criptográfica de copia.**

Chibalete+ no tiene DRM comercial: ni Widevine, ni FairPlay, ni PlayReady. PDF.js, Foliate, los reproductores y las imágenes reciben los bytes que representan. En Android (LU), las capturas y la grabación de pantalla están bloqueadas con FLAG_SECURE y la copia offline va cifrada.

## Qué compone la protección (igual para todos los títulos)

| Capa | Comportamiento |
|---|---|
| Autorización en el servidor | El servidor decide una sola cosa: si este usuario puede leer este título (usuario → grupo → organización, ventanas temporales; CP-1/2/3). Si no puede: 401 sin sesión, 403 sin derecho. Si puede: recibe los recursos que necesitan sus modos de lectura |
| Archivos protegidos | `/uploads` estricto: ningún archivo editorial es público. El EPUB nunca se sirve crudo (403 para todos); solo lo recibe el lector autorizado por `GET /api/content/:id/epub` |
| Catálogo | Quien no tiene acceso a un título no recibe sus localizadores (R2). Quien sí lo tiene recibe los de todos los modos disponibles |
| Caché | `private, no-store` en recursos autorizados y en el catálogo |
| Interfaz | Sin botones, enlaces ni menús de descarga. Los modos se llaman «Leer en PDF» y «Leer EPUB»: el usuario entra al visor, no a una descarga |
| Fricción | Copia, corte, menú contextual y arrastre bloqueados en las superficies de lectura. El Modo Accesible conserva la copia por accesibilidad |
| Impresión | Imprimir y «Guardar como PDF» muestran solo «Contenido protegido en Chibalete+» |
| Media | `controlsList="nodownload"` en audio y vídeo propios; PiP deshabilitado en vídeo propio; YouTube sin cambios |
| Sin marca de agua | `WATERMARK_POLICY: PROHIBITED` |
| Android (LU) | FLAG_SECURE, offline cifrado, descarga autenticada; sin opción de exportar el libro (`LU_EXPLICIT_EXPORT: NONE`) |

## Qué cambió en CP-4D

- **Política por título (CP-4A2) retirada:** `contentProtectionPolicy` / `licensed_strict` ya no gobiernan ningún comportamiento.
  - **Servidor:** se quitaron la denegación del PDF/EPUB original, el gate de publicación, la validación del campo y el trato especial en el catálogo y en modo legacy. El código del servidor vuelve exactamente al de CP-4A1 (`7d8bb72`).
  - **Administración:** se quitó el selector «Protección del contenido». La protección es global, así que no hay decisión por título.
  - **Registros históricos:** sin migración. Un registro que todavía lleve el campo recibe exactamente la misma protección que el resto; el campo es inerte.
- **Etiquetas:** «Ver PDF Original» → **«Leer en PDF»** y «Ver EPUB original» → **«Leer EPUB»**.
- **MOOK:** se quitó «Descargar transcripción». La transcripción sigue legible en la página («Ver transcripción», `<details>` nativo), así que se conserva la alternativa textual accesible del ADR §17.4.
- **Lector EPUB:** la barra de progreso de carga anuncia «Carga del libro / Cargando» en lugar de «Descarga…».
- **Matriz de CP-4C / CP-4C1:** marcada `SUPERSEDED_BY_GLOBAL_POLICY`.

## PDF y EPUB

| | PDF | EPUB |
|---|---|---|
| Modo | `PDF_MODE: AVAILABLE` (PDF.js, Range 206) | `EPUB_MODE: AVAILABLE` (Foliate) |
| Descarga explícita | `DISABLED`: sin botón, enlace ni `a[download]` | `DISABLED` |
| Acceso público / crudo | `DENIED` (401 sin sesión, 403 sin derecho) | `/uploads/*.epub` crudo 403 para todos |
| Autorización | `REQUIRED` (`decideContentAccess`) | `REQUIRED` (`GET /api/content/:id/epub`) |
| Extracción técnica | `POSSIBLE_FOR_AUTHORIZED_TECHNICAL_USER` | `POSSIBLE_FOR_AUTHORIZED_TECHNICAL_USER` |

## Evidencia

**Tests**
- `contentGlobalReadOnlyPolicy` (nuevo, en `test:content-rmw`): 38/0.
- Suites que necesitan sesión firmada, corridas en un contenedor Linux: verdes.
- Suites de front y de MOOK sobre el árbol completo: verdes.

**Navegador** (fixture sintético; API en modo enforce + strict con el código actual, que incluye un registro histórico marcado `licensed_strict`):
- **Detalle:** ambos títulos ofrecen Leer Ahora, Inmersivo, Guiado, Accesible, «Leer en PDF», «Leer EPUB» y Galería.
- **Descargas:** 0 `a[download]`, 0 textos de descarga y 0 enlaces crudos en todas las superficies.
- **Ficheros:** PDF 200, EPUB por el lector 200, EPUB crudo 403.
- **Impresión:** solo el aviso; sin marca de agua.
- **Administración:** el formulario ya no muestra el selector.

## Pendiente para el rollout (CP-4E)

Imágenes nuevas de API y front construidas desde el commit de esta unidad, y el mismo procedimiento de CP-4B: backups JIT, canario aislado, api_1 → api_2 → front, y smoke con sesiones.
