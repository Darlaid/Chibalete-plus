# CHP-ADR-BIBLIOTECA — Biblioteca como capa de referencia, organización y contexto

Fecha: 2026-08-18 · Estado: **ACEPTADO (contrato congelado, implementación diferida)** · Unidad: CHP-ADR-BIBLIOTECA + CHP-LIB-UX-00
Alcance: SOLO contrato. No toca producción, migraciones, autenticación, entitlements ni memberships.

---

## 1. Problema

Chibalete+ necesita tres formas de organización y descubrimiento del catálogo (editorial, institucional, personal) sin: duplicar libros ni metadata, crear una segunda fuente de autorización, mezclar las capas entre sí, ni romper el aislamiento institucional. Hoy el terreno ya contiene proto-capas dispersas: `bundles_db.json` ("Experiencias": **listas de `contentIds` que ya referencian sin duplicar**), `school_configs.json` (selección por colegio), reglas del access engine (`access_db.json`, scopes user→group→organization con ventanas temporales) y una página `Biblioteca.tsx` que lista el catálogo. No existe capa personal persistente. Las colecciones viven **conflated** dentro de `content.json` (`isCollection: true`).

## 2. Decisión

**Biblioteca es una capa de referencia + organización + contexto. NO es propiedad, ni copia, ni autorización.**

- **Entidad canónica de libro** = el registro de `content.json` (id `content-*`, tipos `libro|video|guia|libro_album`). Es la ÚNICA fuente de metadata, archivos, portadas y estado de publicación.
- **Referencia de Biblioteca** = un puntero liviano a esa entidad dentro de una capa/contexto. Añadir a una biblioteca solo crea la referencia.
- **Autorización** = sigue siendo EXCLUSIVA del access engine existente (E6/E7). Biblioteca jamás fabrica entitlement ni lo bypassa; el backend sigue siendo la única fuente de verdad de acceso (regla vigente de CLAUDE.md).

### Fórmula de visibilidad (CONGELADA)

```
visibility = reference ∩ entitlement ∩ membership/role ∩ publication_state
```

| Componente | Significado | Sustrato actual |
|---|---|---|
| `reference` | el libro está referenciado en la biblioteca/contexto solicitado | LibraryReference (nuevo, LIB-01) |
| `entitlement` | el usuario tiene derecho efectivo de lectura | access engine `access_db.json` (user→group→organization, temporal) — YA existe |
| `membership/role` | pertenece al contexto y su rol lo permite (aplica a INSTITUTIONAL) | groups/organizationId + roles canónicos (enforcement = M1-B) |
| `publication_state` | el contenido está en estado expuesto | `content.status` (hoy `disponible`; el contrato trata cualquier otro valor como no publicado) |

La presencia de una referencia NUNCA basta para leer. La pérdida de entitlement/membership NUNCA borra referencias: las deja inertes.

## 3. Modelo de dominio mínimo

### 3.1 LibraryReference

```
LibraryReference {
  id           // ref-*
  bookId       // id canónico en content.json — FK conceptual, jamás copia
  layer        // EDITORIAL | INSTITUTIONAL | PERSONAL
  contextId    // EDITORIAL → null (contexto global de Chibalete Editores)
               // INSTITUTIONAL → organizationId (autoridad única de institución — CHP-ID canon)
               // PERSONAL → userId
  collectionId // nullable — agrupación dentro de la capa (ver 3.3)
  position     // entero, orden manual dentro de (layer, contextId, collectionId)
  createdAt / updatedAt
}
```

Campos EVALUADOS y RECHAZADOS (YAGNI, sin flujo UX que los exija): `state` por referencia (el ocultamiento se decide por `publication_state` del libro y por publicación de la colección, no por referencia), `addedBy` (autoría se infiere del contexto y del audit log si existe), metadata de presentación por referencia (nota/alias/portada alternativa — ningún caso de uso del MVP la pide; se añadiría solo con necesidad demostrada).

**Invariante de unicidad:** `UNIQUE(layer, contextId, collectionId, bookId)` — el mismo libro no puede referenciarse dos veces dentro del mismo contexto+colección (re-añadir = no-op idempotente). Entre capas o contextos distintos SÍ puede repetirse: eso ES el diseño (Caso D).

### 3.2 Capas

`EDITORIAL` (selección de Chibalete Editores, contexto global) · `INSTITUTIONAL` (contexto = `organizationId`; una por institución) · `PERSONAL` (contexto = `userId`; privada por defecto).

### 3.3 Colección (agrupación)

Reutilizar el concepto ya existente: los **bundles/"Experiencias"** son exactamente colecciones editoriales por referencia (`contentIds`). El contrato los adopta como `LibraryCollection`:

```
LibraryCollection {
  id, layer, contextId,        // misma semántica que la referencia
  name, description,           // metadata de presentación de la agrupación (no del libro)
  published                    // bool — publicar/despublicar la organización de la capa
  position
}
```

PERSONAL no tiene colecciones en el MVP (el espacio privado se ordena plano). No se crean más entidades: **dos** (Reference + Collection) bastan para todos los casos de uso obligatorios.

### 3.4 No duplicación (invariante dura)

Agregar un libro a cualquier biblioteca NO crea: nuevo Book, nueva publicación, nuevo archivo, nueva portada, ni nuevo entitlement. Un libro presente en las tres capas = **1 entidad de contenido + 3 referencias**. UX puede mostrarlo en varios contextos; dominio jamás lo copia.

## 4. Roles y capacidades (matriz mínima — roles existentes, sin roles nuevos)

| Actor (rol canónico existente) | Capacidades Biblioteca |
|---|---|
| `administrador` (editorial) | crear/publicar/despublicar colecciones EDITORIAL; añadir/quitar/ordenar referencias EDITORIAL |
| `mediador` (teacher/librarian/coordinator) dentro de su organización | crear colecciones INSTITUTIONAL de su organizationId; añadir/quitar/ordenar referencias INSTITUTIONAL **limitadas a contenido con entitlement institucional vigente**; no toca otras instituciones |
| usuario autenticado (cualquier rol) | añadir/quitar/ordenar en su PERSONAL |
| `lector` | descubrir, filtrar, abrir contenido SI el access engine lo autoriza |

Los roles canónicos actuales bastan; no se congela ningún rol nuevo. El enforcement real de "dentro de su organización" depende de M1-B (ver §7).

## 5. Casos de uso obligatorios (validados contra el modelo)

- **A** Editorial incluye un libro → +1 LibraryReference(EDITORIAL); 0 libros nuevos. ✅
- **B** Un colegio incorpora el mismo libro → +1 LibraryReference(INSTITUTIONAL, organizationId); misma entidad canónica. ✅
- **C** Un estudiante lo añade a Mi Biblioteca → +1 LibraryReference(PERSONAL, userId), privada. ✅
- **D** Aparece en las tres capas → 1 Book, 3 referencias. UX lo muestra en tres contextos. ✅
- **E** Pierde entitlement → la referencia queda; `visibility` falla en `entitlement`; el visor sigue gateado por `/api/content/:id/access` (sin cambio). La biblioteca puede mostrarlo "sin acceso" o filtrarlo (decisión UX §LIB-UX-00), nunca abrirlo. ✅
- **F** Deja la institución → falla `membership` para la capa INSTITUTIONAL (deja de verse esa biblioteca); su referencia PERSONAL sobrevive, pero abrir sigue dependiendo de entitlement. No se destruye ni el Book ni la referencia personal. ✅
- **G** Se despublica el contenido (`status` ≠ disponible) → falla `publication_state`: invisible en TODAS las capas; las referencias quedan dormidas y reviven si se republica. ✅

Ambigüedad real encontrada y decidida: las colecciones legacy dentro de `content.json` (`isCollection:true`) NO son bibliotecas — son contenido agrupado que los visores y el access engine ya usan (`collectionIds`). Se mantienen como entidad canónica referenciable; su eventual separación queda fuera de este contrato.

## 6. Aislamiento (invariantes a probar en LIB-01, no implementadas aquí)

1. Una institución no puede leer, modificar ni descubrir referencias/colecciones INSTITUTIONAL de otra (`contextId` ≠ sus organizationIds ⇒ 403/404 indistinguible).
2. PERSONAL es privada por defecto: solo su `userId` la lee/escribe.
3. Ninguna escritura de Biblioteca muta `content.json`, `access_db.json`, memberships ni roles.
4. Ninguna respuesta de Biblioteca revela existencia de contextos ajenos.

## 7. Dependencias y frontera de implementación

| Dependencia | Clasificación | Motivo |
|---|---|---|
| Modelo de referencia/colección, capas, invariantes, UX, matriz de capacidades | **CONTRACT-READY** | congelado en este ADR |
| Entidad canónica de libro + `publication_state` | **CONTRACT-READY** | ya existen (`content.json`, `status`) |
| Entitlement (lectura) | **CONTRACT-READY** como consumo | el access engine E6/E7 ya es canónico; LIB-01 solo lo CONSUME vía `/api/content/:id/access` |
| Identidad de sesión (quién es el usuario) | **IMPLEMENTATION-BLOCKED** | M1-A en curso (compat; enforce bloqueado por drain Android) — PERSONAL exige actor autenticado no falsificable |
| Membership/roles con aislamiento institucional real | **IMPLEMENTATION-BLOCKED** | M1-B (tenant authz) construido pero NO desplegado; requiere M1-A enforce |
| Escrituras INSTITUTIONAL con authz por organización | **IMPLEMENTATION-BLOCKED** | depende de los dos anteriores |
| Migración de datos (bundles/school_configs → referencias) | **IMPLEMENTATION-BLOCKED** | plan en CHP_LIB_MIG_00; ejecutar tras gates |

Regla congelada: **LIB-01 no escribe capa INSTITUTIONAL ni PERSONAL en producción hasta que M1-A enforce + M1-B estén GREEN.** La capa EDITORIAL (lectura y administración con admin-secret ya canónico) no depende de esos gates.

## 8. Qué NO es esta decisión

No es un CMS, no crea microservicios, ni event sourcing, ni segunda base de catálogo, ni sistema nuevo de permisos, ni duplica Book, ni implementa MOOK, ni resuelve escala futura sin evidencia.
