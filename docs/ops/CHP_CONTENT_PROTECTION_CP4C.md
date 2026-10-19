# CHP-CONTENT-PROTECTION-2026-01 · CP-4C — Clasificación de títulos para `licensed_strict`

> **`SUPERSEDED_BY_GLOBAL_POLICY` (CP-4D, 2026-10-19).** La clasificación STANDARD/LICENSED_STRICT dejó de ser necesaria tras la decisión editorial de aplicar la misma política de protección a todo el catálogo. Ver `docs/ops/CHP_CONTENT_PROTECTION_GLOBAL_POLICY.md`. Documento histórico: no se sigue completando.


Fecha: 2026-10-19 · Producción, solo lectura · Rama `chp/epub-mainfile-r1-release`

## A. Veredicto

```
CP4C_CLASSIFICATION:                 INCOMPLETE_NEEDS_EDITORIAL_INPUT
STRICT_CANDIDATES_COUNT:             0
AMBIGUOUS_COUNT:                     48
NONE_COUNT:                          61
BLOCKED_COUNT:                       0  (ningún candidato; 15 títulos quedarían BLOCKED si se declararan externos)
LICENSED_STRICT_REAL_CONTENT_COUNT:  0
PRODUCTION_DATA_MUTATION:            ZERO
WATERMARK_POLICY:                    PROHIBITED
```

No existe ninguna fuente documental que acredite, título a título, que un contenido pertenece a un tercero o que su acuerdo prohíbe entregar el original. Por la regla de la unidad («si la evidencia no permite clasificar con certeza: NO modificar»), no se activó ningún título y no se tocó producción.

## B. Baseline (preflight)

- API `chibalete/api:contentprotect-cp4-3b9bff6` en api_1 y api_2; front `chibalete/front:contentprotect-cp4-3b9bff6`; LU 0.9.2.
- Flags `strict` / `enforce` / `restricted`. Los 4 contenedores healthy, 0 reinicios.
- content 109 (`d8cf6abd`); access_db 22 (`d4182a1d`); uploads 3.364 / 6.010.151.892 B.
- `contentProtectionPolicy`: ausente en los 109. Títulos estrictos antes de esta unidad: 0.

## C. Metodología y fuentes

1. **Inventario de solo lectura** de `content.json` en el VPS: solo metadata y presencia de representaciones. No se leyeron cuerpos editoriales y no se imprimieron URLs. El JSON temporal se borró del VPS al terminar.
2. **Evidencia de derechos.** Se buscó en las fuentes aceptables A–E: claves del modelo, documentación del repositorio e inventarios.
3. **Sin heurísticas.** Autor, título, ISBN, nombre de fichero, carpeta, dominio público y el campo `editorial` no cuentan como evidencia.

| Fuente | Tipo | Cobertura | Confiabilidad |
|---|---|---|---|
| `content.json`: claves de derechos (licen*, derech*, rights, contrat*, convenio, publisher, proveedor, provider, partner, isbn, origen, fuente, source, editorial) | metadata del modelo | 109/109 | solo existe `editorial`, `"Chibalete"` en los 109. Lo fija a mano SubirContenido y el servidor no lo lee (CP-4A §E) → **no fiable** |
| `autor` | metadata | 109/109 | texto libre. Excluido como evidencia por la unidad; se usa solo para separar AMBIGUOUS de NONE |
| ISBN | metadata | 0/109 | no existe el campo |
| Documentación del repo (`docs/`, `ops/`, `*.md`, `*.csv`, `*.json`), búsqueda de convenio, contrato editorial, licencia, derechos de autor, editorial externa, publisher, proveedor, cesión, acuerdo | documental | todo el repo | 0 documentos por título. Solo hay menciones genéricas: la auditoría de CP-0 §U y «contrato editorial» en el sentido de producto de MOOK |
| Carpetas sin seguimiento del repo (`EPUB test/`, `ESTÁS AQUÍ…/`, `Programa integral/`) | material editorial | solo se listaron los nombres de fichero | EPUB, audio y texto de MOOK y PDF de módulos; ningún contrato ni inventario de derechos. No se abrieron |
| Lista aprobada por la editorial u operador | aprobación | — | **no existe**: es el input que falta |

## D. Inventario

- Títulos: **109**. PDF original 51, EPUB original 1, TXT 61 (de ellos 1 canónico), álbum 9, audio 17, vídeo 5.
- `STRICT_READABLE` (mismo criterio que el gate desplegado: TXT o canónico, álbum con imágenes o `url_recurso` no PDF): **94** sí y **15** no.
- No legibles en estricto: 5 libros ilustrados de Chibalete (solo PDF) y sus 10 guías (solo PDF).

## E. Clasificación de derechos

| Estado | Títulos | Criterio |
|---|---|---|
| EXPLICIT_EXTERNAL | 0 | ningún documento que lo acredite |
| EXPLICIT_CHIBALETE | 0 | ningún documento que lo acredite (la autoría «Chibalete Editores» es metadata, no evidencia) |
| AMBIGUOUS | 48 | la autoría acreditada no es Chibalete Editores; el campo `editorial` no confirma ni desmiente; requiere decisión editorial |
| NONE | 61 | acreditados a Chibalete Editores en metadata; sin evidencia documental en ningún sentido |

## F. Matriz pre-activación (109 títulos)

Columnas: PDF / EPUB = original; TXT/C = texto (C = canónico); VIS = álbum; AV = audio o vídeo; SR = strict readable. Ningún título tiene hoy política, así que la propuesta para todos es «sin cambio» (standard por defecto).

| contentId | título | autoría (metadata) | evidencia | fuente | PDF | EPUB | TXT/C | VIS | AV | SR | política propuesta | acción | motivo |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `content-1775853017025` | El principito | Antoine de Saint-Exupéry | AMBIGUOUS | ninguna documental | Y | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-1775775232788` | Las aventuras de Pinocho | Carlo Collodi | AMBIGUOUS | ninguna documental | Y | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-1779292030328` | Las ciudades que llevamos dentro | Constantino Cavafis | AMBIGUOUS | ninguna documental | Y | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-1776096790542` | El cuervo y otros relatos fantásticos | Edgar Allan Poe | AMBIGUOUS | ninguna documental | Y | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-1765751139919` | La metamorfosis | Franz Kafka | AMBIGUOUS | ninguna documental | Y | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-1765751724398` | La guerra de los mundos | H. G. Wells | AMBIGUOUS | ninguna documental | Y | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `child-content-1765751724398-0-1765814004450` | La guerra de los mundos (adaptación 1938 | H. G. Wells | AMBIGUOUS | ninguna documental | — | — | — | — | A | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-1775766806680` | Cuentos de la selva | Horacio Quiroga | AMBIGUOUS | ninguna documental | Y | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-1776097919834` | La llamada de Cthulhu y otros cuentos de | Howard Phillips Lovecraft | AMBIGUOUS | ninguna documental | Y | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-1765830206526` | El vampiro | John W. Polidori | AMBIGUOUS | ninguna documental | Y | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-1776698380526` | Cuatro miradas sobre el río | Julieta Amaya, Ernesto Man | AMBIGUOUS | ninguna documental | — | — | — | Y | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-mook-eaq-13ef9e9e5bd08451` | Libro · Aparecer o estar: el nuevo cogit | Latitud Cero | AMBIGUOUS | ninguna documental | — | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-mook-eaq-fad2f33d8fb7a19c` | Libro · El silencio cartesiano: deteners | Latitud Cero | AMBIGUOUS | ninguna documental | — | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-mook-eaq-36cc16ae3e38edba` | Libro · Elegir un yo: Kierkegaard en la | Latitud Cero | AMBIGUOUS | ninguna documental | — | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-mook-eaq-c1b1b5295527c06e` | Libro · Epílogo — Una ética de la presen | Latitud Cero | AMBIGUOUS | ninguna documental | — | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-mook-eaq-6c9fda952939e21e` | Libro · La multitud y la angustia | Latitud Cero | AMBIGUOUS | ninguna documental | — | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-mook-eaq-87f9579ecc9b6f53` | Libro · Mil pestañas abiertas: lo dividi | Latitud Cero | AMBIGUOUS | ninguna documental | — | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-mook-eaq-a0cc5fa9c906b3de` | Libro · Presencias ausentes: estar sin e | Latitud Cero | AMBIGUOUS | ninguna documental | — | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-mook-eaq-933b26a70b967f6b` | Libro · Prácticas de atención: pequeñas | Latitud Cero | AMBIGUOUS | ninguna documental | — | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-mook-eaq-47e73ce82d0b4399` | Libro · Prólogo. Me desconecto, luego ex | Latitud Cero | AMBIGUOUS | ninguna documental | — | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-mook-eaq-44618b03d1c40d84` | Libro · Simone Weil: atención como justi | Latitud Cero | AMBIGUOUS | ninguna documental | — | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-1773325007384` | Las aventuras de Alicia en el país de la | Lewis Carroll | AMBIGUOUS | ninguna documental | Y | Y | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-1773325050530-1` | bio carroll | Lewis Carroll | AMBIGUOUS | ninguna documental | — | — | — | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-1773325047574-0` | contexto 001 | Lewis Carroll | AMBIGUOUS | ninguna documental | — | — | — | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-1776085981693` | Muu, bee, guau. | María Ortiz y Nicolás JImé | AMBIGUOUS | ninguna documental | — | — | — | Y | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-1774480401139` | Anarquismo | N. Caballero M. Pérez M. N | AMBIGUOUS | ninguna documental | Y | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-1776111162557` | Dios, la nada y los domingos aburridos. | N. Caballero M. Pérez M. N | AMBIGUOUS | ninguna documental | Y | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-1774474831059` | El fantasma en la máquina: inteligencia | N. Caballero M. Pérez M. N | AMBIGUOUS | ninguna documental | Y | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-1774363534133` | Fascismo, totalitarismo  y otras formas | N. Caballero M. Pérez M. N | AMBIGUOUS | ninguna documental | Y | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-1774480266132` | Ismos para entender la política | N. Caballero M. Pérez M. N | AMBIGUOUS | ninguna documental | Y | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-1776110044250` | Juega, ríe y repite. El juego como ensay | N. Caballero M. Pérez M. N | AMBIGUOUS | ninguna documental | Y | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-1774362922886` | Me desconecto, luego existo | N. Caballero M. Pérez M. N | AMBIGUOUS | ninguna documental | Y | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-1776123779618` | Pensar es peligroso (pero necesario) | N. Caballero M. Pérez M. N | AMBIGUOUS | ninguna documental | Y | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-1774479973149` | Platón, posverdad y fake news | N. Caballero M. Pérez M. N | AMBIGUOUS | ninguna documental | Y | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-1776094921021` | Dinosaurios (en orden de estatura) | Nico Caballero | AMBIGUOUS | ninguna documental | — | — | — | Y | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-1775833161349` | El fantasma de Canterville | Oscar Wilde | AMBIGUOUS | ninguna documental | Y | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-1765837262553` | Aprendizaje basado en retos: una mirada | Richar Jacobo Posso Pachec | AMBIGUOUS | ninguna documental | Y | — | C | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-1765812186368` | El extraño caso del Dr. Jekyll y el Sr. | Robert Louis Stevenson | AMBIGUOUS | ninguna documental | Y | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-1775664683377` | El libro de la selva | Rudyard Kipling | AMBIGUOUS | ninguna documental | Y | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-1775842631055` | Sherlock Holmes - Antología final | Sir Arthur Conan Doyle | AMBIGUOUS | ninguna documental | Y | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-1789417845849` | Una odisea marciana | Stanley G. Weinbaum | AMBIGUOUS | ninguna documental | Y | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-1765986272029` | Novela de ajedrez | Stefan Sweig | AMBIGUOUS | ninguna documental | Y | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-1776091771540` | Millones de gatos | Wanda Gág | AMBIGUOUS | ninguna documental | — | — | — | Y | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-1776089328593` | Monogatari | Zeta Blanco y Nico Caballe | AMBIGUOUS | ninguna documental | — | — | — | Y | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-1776006983915` | Sol de los venados | Zeta Blanco y Nico Caballe | AMBIGUOUS | ninguna documental | — | — | — | Y | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-1776094054977` | Odisea Pacífico | Zeta Blanco y Nicolás Jimé | AMBIGUOUS | ninguna documental | — | — | — | Y | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-1776092773110` | Sierra nevada | Zeta Blanco y Nicolás Jimé | AMBIGUOUS | ninguna documental | — | — | — | Y | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-1776087315660` | Un reino para el tirano | Zeta Blanco y Nicolás Jimé | AMBIGUOUS | ninguna documental | — | — | — | Y | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | autoría acreditada ≠ Chibalete Editores; sin documento de derechos; requiere decisión editorial |
| `content-mook-eaq-194637c66ec4bd8a` | A01. Son las once de la noche | Chibalete Editores | NONE | ninguna documental | — | — | — | — | A | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-mook-eaq-96587aab149d0d36` | A02. Si no lo publicaste, ocurrió | Chibalete Editores | NONE | ninguna documental | — | — | — | — | A | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-mook-eaq-2cb6cee4c5d62eb0` | A03. Todos están hablando | Chibalete Editores | NONE | ninguna documental | — | — | — | — | A | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-mook-eaq-c70beb0068d9c36b` | A05. Noventa segundos | Chibalete Editores | NONE | ninguna documental | — | — | — | — | A | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-mook-eaq-504485bf351dac48` | A06. Me estás escuchando | Chibalete Editores | NONE | ninguna documental | — | — | — | — | A | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-mook-eaq-2b136ce44f9a6624` | A07.1. Si no posteo, desaparezco | Chibalete Editores | NONE | ninguna documental | — | — | — | — | A | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-mook-eaq-4342c67bc54f081f` | A07.2. Libertad no paga las cuentas | Chibalete Editores | NONE | ninguna documental | — | — | — | — | A | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-mook-eaq-2f4a76b7f0fcdac4` | A07.3. La elección de empezar a elegir | Chibalete Editores | NONE | ninguna documental | — | — | — | — | A | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-mook-eaq-e5bad7832faebe32` | A08. Día 1 — Una hora sin notificaciones | Chibalete Editores | NONE | ninguna documental | — | — | — | — | A | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-mook-eaq-f4ff74426d1ac743` | A09. Día 2 — Una sola pestaña | Chibalete Editores | NONE | ninguna documental | — | — | — | — | A | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-mook-eaq-ef889cb83492f158` | A10. Día 3 — Una fotografía que no vas a | Chibalete Editores | NONE | ninguna documental | — | — | — | — | A | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-mook-eaq-df6d23a13f2c3372` | A11. Día 4 — Escuchar sin interrumpir | Chibalete Editores | NONE | ninguna documental | — | — | — | — | A | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-mook-eaq-983b7407e8e4e7f6` | A12. Día 5 — Caminar sin audífonos | Chibalete Editores | NONE | ninguna documental | — | — | — | — | A | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-mook-eaq-629b97373cd6c898` | A13. Día 6 — No responder todavía | Chibalete Editores | NONE | ninguna documental | — | — | — | — | A | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-mook-eaq-0b4db945383909dd` | A14. Día 7 — Estar juntos sin pantallas | Chibalete Editores | NONE | ninguna documental | — | — | — | — | A | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-mook-eaq-3c75004673056890` | A15. Una ética de la presencia | Chibalete Editores | NONE | ninguna documental | — | — | — | — | A | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-1773677322659` | Adiós árbol, hola garza | Chibalete Editores | NONE | ninguna documental | Y | — | — | — | — | — | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos. Si se declara externo → BLOCKED_NO_DERIVED_READING (solo PDF) |
| `content-1773693002648` | Búho y la noche inquieta | Chibalete Editores | NONE | ninguna documental | Y | — | — | — | — | — | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos. Si se declara externo → BLOCKED_NO_DERIVED_READING (solo PDF) |
| `content-1765986434403-0` | Detrás de las páginas - 009. Novela de a | Chibalete Editores | NONE | ninguna documental | — | — | — | — | V | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-1773676854661-0` | Guía actividades | Chibalete Editores | NONE | ninguna documental | Y | — | — | — | — | — | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos. Si se declara externo → BLOCKED_NO_DERIVED_READING (solo PDF) |
| `content-1773677357677-1` | Guía de actividades | Chibalete Editores | NONE | ninguna documental | Y | — | — | — | — | — | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos. Si se declara externo → BLOCKED_NO_DERIVED_READING (solo PDF) |
| `content-1773692470405-0` | Guía de actividades | Chibalete Editores | NONE | ninguna documental | Y | — | — | — | — | — | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos. Si se declara externo → BLOCKED_NO_DERIVED_READING (solo PDF) |
| `content-1773693039737-1` | Guía de actividades | Chibalete Editores | NONE | ninguna documental | Y | — | — | — | — | — | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos. Si se declara externo → BLOCKED_NO_DERIVED_READING (solo PDF) |
| `content-1773693527262-0` | Guía de actividades | Chibalete Editores | NONE | ninguna documental | Y | — | — | — | — | — | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos. Si se declara externo → BLOCKED_NO_DERIVED_READING (solo PDF) |
| `content-1773692482811-1` | Guía de lectura | Chibalete Editores | NONE | ninguna documental | Y | — | — | — | — | — | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos. Si se declara externo → BLOCKED_NO_DERIVED_READING (solo PDF) |
| `content-1773693027690-0` | Guía de lectura | Chibalete Editores | NONE | ninguna documental | Y | — | — | — | — | — | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos. Si se declara externo → BLOCKED_NO_DERIVED_READING (solo PDF) |
| `content-1773693537202-1` | Guía de lectura | Chibalete Editores | NONE | ninguna documental | Y | — | — | — | — | — | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos. Si se declara externo → BLOCKED_NO_DERIVED_READING (solo PDF) |
| `content-1773676865746-1` | Guía lectura | Chibalete Editores | NONE | ninguna documental | Y | — | — | — | — | — | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos. Si se declara externo → BLOCKED_NO_DERIVED_READING (solo PDF) |
| `content-1773677346916-0` | Guía lectura | Chibalete Editores | NONE | ninguna documental | Y | — | — | — | — | — | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos. Si se declara externo → BLOCKED_NO_DERIVED_READING (solo PDF) |
| `content-1765984421218-0` | Las aventuras de Alicia en el país de la | Chibalete Editores | NONE | ninguna documental | — | — | — | — | V | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-1765985212432-0` | Las aventuras de Alicia en el país de la | Chibalete Editores | NONE | ninguna documental | — | — | — | — | V | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-1773676835077` | Llegaba tarde la tortuga | Chibalete Editores | NONE | ninguna documental | Y | — | — | — | — | — | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos. Si se declara externo → BLOCKED_NO_DERIVED_READING (solo PDF) |
| `content-1765988943452` | Lu y los cardenales | Chibalete Editores | NONE | ninguna documental | — | — | — | — | V | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-1773693517166` | Mi sombra | Chibalete Editores | NONE | ninguna documental | Y | — | — | — | — | — | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos. Si se declara externo → BLOCKED_NO_DERIVED_READING (solo PDF) |
| `content-1775693616679` | MÓDULO 1 - Fundamentos del modelo pedagó | Chibalete Editores | NONE | ninguna documental | Y | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-1775693670295` | MÓDULO 2 - Desarrollo de la competencia | Chibalete Editores | NONE | ninguna documental | Y | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-1775693733575` | MÓDULO 3 - Experiencia pedagógica y medi | Chibalete Editores | NONE | ninguna documental | Y | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-1775695363643` | MÓDULO 4 - Dispositivos pedagógicos | Chibalete Editores | NONE | ninguna documental | Y | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-1775764092850` | MÓDULO 5 - Ecosistema lector | Chibalete Editores | NONE | ninguna documental | Y | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-1775764137017` | MÓDULO 6 - Escuela de familias lectoras | Chibalete Editores | NONE | ninguna documental | Y | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-1775764203505` | MÓDULO 7 - Sistema de evaluación y medic | Chibalete Editores | NONE | ninguna documental | Y | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-1775764251632` | MÓDULO 8 - Implementación del programa | Chibalete Editores | NONE | ninguna documental | Y | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-1778608611968` | MÓDULO 9 - Leer para pensar | Chibalete Editores | NONE | ninguna documental | Y | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-1775693503920` | Programa Integral de Lectura, Escritura, | Chibalete Editores | NONE | ninguna documental | Y | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-mook-eaq-5ed5d88f4bdbacbb` | Texto del mook · Antes del reto... peque | Chibalete Editores | NONE | ninguna documental | — | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-mook-eaq-71ce37b29d1ab29f` | Texto del mook · Carta de entrada | Chibalete Editores | NONE | ninguna documental | — | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-mook-eaq-0ef0893ea7918897` | Texto del mook · Cinco formas de repetir | Chibalete Editores | NONE | ninguna documental | — | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-mook-eaq-3d34865f4f038b73` | Texto del mook · El derecho a terminar u | Chibalete Editores | NONE | ninguna documental | — | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-mook-eaq-5111c1e4c1e6b42f` | Texto del mook · Elegir también es perde | Chibalete Editores | NONE | ninguna documental | — | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-mook-eaq-893425fc7c6d350c` | Texto del mook · La pausa metódica | Chibalete Editores | NONE | ninguna documental | — | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-mook-eaq-280cb90ba4947874` | Texto del mook · La vida sin testigos | Chibalete Editores | NONE | ninguna documental | — | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-mook-eaq-f2a5ab6d86844df6` | Texto del mook · Quién eligió esta opini | Chibalete Editores | NONE | ninguna documental | — | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-mook-eaq-1314aa22942b6be3` | Transición · M0 | Chibalete Editores | NONE | ninguna documental | — | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-mook-eaq-cb4e7581c0bbdcd9` | Transición · M1 | Chibalete Editores | NONE | ninguna documental | — | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-mook-eaq-8dcd6dd03e85c687` | Transición · M2 | Chibalete Editores | NONE | ninguna documental | — | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-mook-eaq-61299103268a17d1` | Transición · M3 | Chibalete Editores | NONE | ninguna documental | — | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-mook-eaq-b851c5f786a2dc8e` | Transición · M4 | Chibalete Editores | NONE | ninguna documental | — | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-mook-eaq-14e540305448b261` | Transición · M5 | Chibalete Editores | NONE | ninguna documental | — | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-mook-eaq-ca65a887d3cf739d` | Transición · M6 | Chibalete Editores | NONE | ninguna documental | — | — | Y | — | — | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-1776618897409` | Tutorial Chibatele+ | Chibalete Editores | NONE | ninguna documental | — | — | — | — | V | Y | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos |
| `content-1773692447274` | Zorrito, cómo te sientes hoy | Chibalete Editores | NONE | ninguna documental | Y | — | — | — | — | — | sin cambio (standard) | NO_CHANGE_AMBIGUOUS | acreditado a Chibalete Editores en metadata (no documental); sin evidencia de derechos. Si se declara externo → BLOCKED_NO_DERIVED_READING (solo PDF) |

## G. Gate humano

```
STRICT_CANDIDATES_COUNT:  0
APPROVAL_SOURCE:          NONE (no existe una lista aprobada ni un documento de derechos por título)
```

**Input requerido de la editorial:** una lista explícita de `contentId` → `licensed_strict` (o, si no, «standard confirmado»), con su fuente: contrato, convenio o decisión registrada. Los 48 AMBIGUOUS son el punto de partida natural, pero la autoría no basta: obras de dominio público pueden estar en traducciones o ediciones con derechos, y autores del equipo pueden publicar con terceros. Con esa lista, CP-4C se puede repetir con el mismo procedimiento: activar uno a uno por la API administrativa y verificar cada título.

Requisito técnico previo para cualquier título que se declare externo: tiene que poder leerse sin el original. Los 15 títulos «solo PDF» (5 libros ilustrados y 10 guías) quedarían BLOCKED_NO_DERIVED_READING hasta que tengan texto o álbum.

## H–U. Ejecución

- **Backups, activaciones, comprobaciones de PDF/EPUB, modos derivados, front, control STANDARD, marca de agua, copia e impresión, accesibilidad:** no aplican; no hubo mutación. El comportamiento STANDARD y la disuasión son los verificados en CP-4B.
- **Invariantes:** solo lectura. content `d8cf6abd`, access_db `d4182a1d` y uploads 3.364 / 6.010.151.892 B quedan sin cambios.
- **Rollback:** no aplica (no se creó `/root/chp-cp4c/ROLLBACK.txt`). El procedimiento por título queda definido para la siguiente ejecución: `licensed_strict` → `standard` por la API administrativa, de uno en uno, registrando PRE y POST.
- **Monitoreo:** sin cambios respecto de CP-4B.

## V. Pendiente de decisión editorial

Los 109 títulos: AMBIGUOUS (48) y NONE (61), listados en §F. Prioridad sugerida, solo para ordenar la revisión y sin valor de evidencia: la colección Latitud Cero (10 nodos MOOK), los títulos de autores externos con PDF original (clásicos y ensayos), los álbumes con autoría externa y el artículo de un autor externo.

## X. Siguiente

`NEXT: EDITORIAL RIGHTS CLASSIFICATION DECISION`: lista aprobada por la editorial. No ejecutado.
