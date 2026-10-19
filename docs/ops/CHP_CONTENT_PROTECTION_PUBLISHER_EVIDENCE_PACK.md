# Chibalete+ — Protección de contenidos editoriales

**Paquete de evidencia para editoriales**

Fecha de auditoría: 19 de octubre de 2026 · Plataforma web Chibalete+ (versión de protección `cbc8e2d` / servidor `73f45d6`) · Aplicación Android Chibalete LU 0.9.2

Este documento describe el sistema de protección y control de acceso de contenidos de Chibalete+ y el resultado de su verificación en producción.

---

## 1. Política general

Todos los contenidos de Chibalete+ reciben la misma protección, sea cual sea su procedencia: Chibalete Editores, editoriales externas, dominio público o contenido licenciado.

- Los usuarios autorizados pueden leer cada título en todos los modos de lectura disponibles.
- Chibalete+ no ofrece la descarga de los libros.
- Los archivos editoriales no son públicos.

Derecho a leer no equivale a derecho a descargar.

## 2. Control de acceso

- El usuario debe estar autenticado y autorizado para cada título.
- La autorización la decide el servidor, no la aplicación del usuario. Se basa en las reglas de acceso del usuario, de su grupo (curso o club) y de su institución, con ventanas temporales de vigencia.
- Los accesos no autorizados son rechazados por el servidor:
  - sin sesión → rechazado;
  - con sesión pero sin derecho al título → rechazado.
- El catálogo no entrega la ubicación de los archivos de los títulos que el usuario no puede leer.
- Se indica al navegador que no guarde en caché los recursos autorizados ni el catálogo.

## 3. Modos de lectura

Biblioteca y ficha del título, Modo Guiado, Modo Accesible, Modo Inmersivo, lectura en PDF, lectura EPUB, Álbum, Galería de ilustraciones, podcast, experiencias (MOOK) y vídeo. Todos siguen disponibles para los usuarios autorizados.

## 4. Política de no descarga

- La interfaz no tiene botones, enlaces ni menús para descargar libros, PDF, EPUB o transcripciones.
- Las acciones se llaman «Leer en PDF» y «Leer EPUB»: llevan al lector de Chibalete+, no a una descarga.
- En las experiencias (MOOK), la transcripción se lee dentro de la página («Ver transcripción»). No se puede descargar.

## 5. Protección de PDF

- El PDF se consume dentro del lector de Chibalete+.
- No es público: exige sesión y derecho al título.
- No hay control de descarga en la interfaz.
- Copiar, cortar, el menú contextual y arrastrar están bloqueados en el lector.

## 6. Protección de EPUB

- El EPUB se consume dentro del lector EPUB de Chibalete+.
- El archivo EPUB nunca se sirve de forma directa. Solo lo recibe el lector, para un usuario autorizado.
- No hay control de descarga en la interfaz.
- Copiar, cortar, el menú contextual y arrastrar están bloqueados, también dentro del texto del libro.

## 7. Audio, vídeo e imágenes

| Recurso | Protección |
|---|---|
| Audio (podcast, experiencias) | Requiere autorización. El reproductor no ofrece la opción de descarga. Menú contextual bloqueado |
| Vídeo propio | Requiere autorización. Sin opción de descarga ni de imagen en imagen |
| Vídeo de YouTube | Se muestra con el reproductor de YouTube. No son archivos de Chibalete+ |
| Álbum e ilustraciones | Requieren autorización. Menú contextual y arrastre bloqueados |

## 8. Impresión y copia

- Al imprimir o al «Guardar como PDF» desde una pantalla de lectura, el resultado solo muestra «Contenido protegido en Chibalete+». No incluye el contenido del libro.
- Copiar, cortar, el menú contextual y arrastrar están bloqueados en las pantallas de lectura.
- El Modo Accesible permite copiar, por accesibilidad (ver §10).

## 9. Android: Chibalete LU

| Control | Comportamiento |
|---|---|
| Descarga del libro a la app | Solo con sesión y autorización |
| Copia offline | Cifrada (AES-256-GCM, clave protegida por Android Keystore). Se borra, junto con la clave, al cerrar sesión |
| Capturas de pantalla | Bloqueadas en las pantallas de lectura |
| Grabación de pantalla | Bloqueada en las pantallas de lectura |
| Vista de apps recientes | No muestra el contenido |
| Exportar, compartir, imprimir o copiar el libro | La app no ofrece estas funciones |
| Copia de seguridad del sistema | Desactivada para la app |
| Lectura sin conexión | Disponible para el usuario autorizado |

## 10. Accesibilidad

La protección no reduce la accesibilidad:

- El texto es texto real, legible por lectores de pantalla (también en Android con el bloqueo de capturas activo).
- Hay enlaces para saltar al contenido, navegación por teclado con foco visible, idioma declarado y regiones de página.
- El Modo Accesible permite copiar, porque algunas personas lo necesitan para sus herramientas de apoyo.
- La transcripción de las experiencias se abre con el teclado.

## 11. Datos que no se almacenan

- **Marcas de agua:** Chibalete+ no inserta marcas de agua ni identificadores del lector en el contenido, ni visibles ni en la impresión.
- **Navegador:** no se guarda una copia del texto del libro en el almacenamiento local. Al cerrar sesión se limpian los datos de lectura locales.
- **Caché:** se indica al navegador que no guarde en caché los recursos de lectura autorizados.
- **Android:** la copia offline solo existe cifrada y se elimina al cerrar sesión.

## 12. Limitaciones técnicas

En la web, el navegador necesita recibir los datos para mostrar un PDF, un EPUB, imágenes, audio o vídeo. Por eso, un usuario autorizado con conocimientos técnicos puede llegar a recuperar esos datos.

La plataforma:

- controla quién recibe esos recursos;
- elimina las descargas ordinarias;
- evita el acceso público;
- dificulta la extracción trivial;
- protege frente a la impresión y la copia ordinarias.

Además:

- En la web no es posible impedir de forma fiable las capturas de pantalla. En Android sí se bloquean en las pantallas de lectura.
- Chibalete+ no usa un DRM comercial (Widevine, Adobe DRM, FairPlay, PlayReady u otro).

## 13. Matriz de controles

| Control | Web | Android LU | Estado |
|---|---|---|---|
| Autenticación | ENFORCED | ENFORCED | Verificado |
| Autorización por título | ENFORCED | ENFORCED | Verificado |
| Archivos públicos | BLOCKED | BLOCKED | Verificado |
| Descarga desde la interfaz | NOT PROVIDED | NOT PROVIDED | Verificado |
| Lector PDF | ENFORCED (lectura dentro de Chibalete+) | NOT PROVIDED (LU usa la versión de texto) | Verificado |
| Lector EPUB | ENFORCED (lectura dentro de Chibalete+) | NOT PROVIDED (LU usa la versión de texto) | Verificado |
| Imprimir / Guardar como PDF | BLOCKED (solo aviso) | NOT PROVIDED | Verificado |
| Fricción de copia | ENFORCED | NOT PROVIDED (texto no seleccionable) | Verificado |
| Modo Accesible | ALLOWED_FOR_ACCESSIBILITY | — | Verificado |
| Captura de pantalla | NOT_RELIABLY_PREVENTABLE | BLOCKED | Verificado |
| Grabación de pantalla | NOT_RELIABLY_PREVENTABLE | BLOCKED | Verificado |
| Almacenamiento offline | — (sin copia local del libro) | ENCRYPTED | Verificado |
| Marca de agua | NOT_USED | NOT_USED | Política: prohibida |
| DRM comercial | NOT_IMPLEMENTED | NOT_IMPLEMENTED | — |

## 14. Estado de verificación

Auditoría final del 19 de octubre de 2026, en producción:

| Verificación | Resultado |
|---|---|
| Acceso sin sesión a texto, PDF, EPUB, imágenes y audio | Rechazado |
| Acceso con sesión pero sin derecho al título | Rechazado |
| Acceso del usuario autorizado | Funciona en todos los modos |
| Acceso directo al archivo EPUB | Rechazado para todos |
| Catálogo para títulos no autorizados | Sin ubicación de archivos (0 de 89) |
| Controles de descarga en las pantallas de lectura | 0 |
| Impresión desde las pantallas de lectura | Solo el aviso de contenido protegido |
| Marcas de agua | 0 |
| Accesibilidad | Sin regresiones |
| Android LU 0.9.2 | Capturas y grabación bloqueadas; copia offline cifrada |

Estado: **sistema de protección y control de acceso de contenidos de Chibalete+ en producción, auditado y cerrado.**
