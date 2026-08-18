# CHP-LIB-UX-00 — Experiencia mínima de Biblioteca (UX freeze)

Fecha: 2026-08-18 · Estado: **CONGELADO** junto con CHP-ADR-BIBLIOTECA. Diseño mínimo; no es un CMS.
Regla madre visible en toda la experiencia: **Biblioteca organiza, referencia y contextualiza — no duplica libros y no concede acceso.**

---

## 1. Entrada

La ruta y página existentes (`Biblioteca.tsx`, entrada "Biblioteca" del menú lateral) se conservan como única puerta. No se crean rutas paralelas. La página evoluciona de "catálogo plano" a "catálogo con tres contextos".

## 2. Navegación — tres contextos, una pantalla

Tres pestañas (o segmentos) en la misma página, en este orden:

1. **Editorial** — "Selección Chibalete" (colecciones/Experiencias + referencias editoriales publicadas).
2. **Mi institución** — visible SOLO si el usuario pertenece a una organización; muestra las colecciones/referencias INSTITUTIONAL de su organizationId.
3. **Mi biblioteca** — su espacio personal plano (sin colecciones en MVP).

Nada de árboles profundos ni navegación anidada: capa → (colección opcional) → libro. Dos niveles máximo.

## 3. Estados UX del libro (mínimos, todos sostenibles por el backend actual/contratado)

| Estado | Condición (fórmula de visibilidad) | Presentación |
|---|---|---|
| **Disponible para leer** | reference ∩ entitlement ∩ membership ∩ published | card normal + acción Abrir |
| **Visible sin acceso** (permitido SOLO en Editorial/Institucional) | reference ∩ ¬entitlement ∩ published | card con candado + texto "Pídelo a tu mediador"; jamás abre el visor (el preflight `/api/content/:id/access` sigue siendo la autoridad) |
| **No publicado** | ¬published | invisible en todas las capas (la referencia queda dormida) |
| **En Mi Biblioteca** | referencia PERSONAL existe | ícono marcador activo en cualquier contexto donde aparezca el libro |
| **En colección** | referencia con collectionId | chip con el nombre de la colección |

No se inventan estados adicionales (leído/por leer, favorito con niveles, etc.): el progreso ya vive en Bitácora/"Estoy leyendo" y NO se migra a Biblioteca ("Estoy leyendo" es derivado del progreso, no una biblioteca).

## 4. Acciones

**Todo usuario:** abrir (si autorizado) · añadir a Mi Biblioteca (toggle marcador, idempotente) · quitar de Mi Biblioteca · explorar colección · filtrar/buscar dentro de la capa activa (búsqueda simple por título/etiqueta; sin facetas complejas en MVP).

**Administrador (Editorial):** añadir/quitar referencia editorial · ordenar (drag o botones subir/bajar sobre `position`) · publicar/despublicar colección. Se hace inline en la misma página con el rol adecuado — NO un CMS aparte.

**Mediador (Institucional, su organización):** añadir/quitar referencia institucional (el selector ofrece ÚNICAMENTE contenido con entitlement institucional vigente — la UI no permite referenciar lo que la institución no tiene) · ordenar · gestionar colecciones institucionales (crear/renombrar/publicar).

**El mismo libro en varios contextos:** se muestra en cada pestaña donde esté referenciado; la card es la misma entidad visual (misma portada/metadata, siempre desde el canónico) con el chip del contexto. Nunca dos "versiones" del libro.

## 5. Correspondencia UX ↔ contrato

- El candado NO es un paywall nuevo: es la representación de `¬entitlement` que ya existe (Caso E). Perder acceso convierte "Abrir" en candado sin tocar la referencia.
- Salir de la institución (Caso F) hace desaparecer la pestaña "Mi institución"; "Mi biblioteca" permanece.
- Despublicar (Caso G) quita el libro de las tres pestañas sin borrar nada.
- Añadir a cualquier biblioteca nunca muestra estados de "copia", "descarga" ni "propiedad".

## 6. Fuera de alcance del MVP UX

Portadas alternativas por contexto, notas del mediador sobre referencias, colecciones personales, compartir bibliotecas entre usuarios, ordenamiento automático/inteligente, recomendaciones. Cada uno exigiría campos/entidades que el ADR rechazó por YAGNI; se reabren solo con necesidad demostrada.
