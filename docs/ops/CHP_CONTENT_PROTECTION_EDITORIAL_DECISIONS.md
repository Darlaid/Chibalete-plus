# CHP-CONTENT-PROTECTION-2026-01 — Matriz de decisión editorial de derechos (CP-4C1)

> **Complete únicamente POLÍTICA y FUENTE_DE_DECISIÓN.**
>
> **STANDARD** significa que Chibalete+ está autorizado a entregar los PDF/EPUB originales disponibles.
>
> **LICENSED_STRICT** significa que esos originales no deben entregarse al lector.
>
> **Si no existe certeza, dejar PENDIENTE.**

La pregunta de cada fila no es «¿el autor es externo?». Es: **«¿Chibalete+ está autorizado a entregar al lector el PDF o el EPUB original de esta edición?»**. Ni un autor externo implica licencia estricta, ni un título propio puede clasificarse por suposición.

## Cómo se rellena

| Columna | Valores admitidos | Quién la escribe |
|---|---|---|
| POLÍTICA | `STANDARD` · `LICENSED_STRICT` · `PENDIENTE` | la editorial |
| FUENTE_DE_DECISIÓN | texto breve y verificable. Ejemplos: «Derechos editoriales propios Chibalete», «Contrato X, cláusula Y», «Convenio con Editorial X», «Licencia digital autorizada», «Decisión editorial registrada 19/10/2026». No se admiten fuentes inventadas ni deducidas | la editorial |
| ESTADO | se deriva de POLÍTICA y de strict_readable (no se edita a mano) | técnica |

Reglas de ESTADO:

| POLÍTICA | strict_readable | ESTADO |
|---|---|---|
| STANDARD | — | `READY_STANDARD` |
| LICENSED_STRICT | Y | `READY_STRICT` |
| LICENSED_STRICT | — | `BLOCKED_NEEDS_DERIVED_READING` |
| PENDIENTE | — | `PENDING_EDITORIAL_DECISION` |

Columnas técnicas: PDF / EPUB = original entregable hoy; TXT/canónico = texto para Guiado, Accesible e Inmersivo; visual = Álbum; strict_readable = el título sigue siendo legible si se bloquean los originales (mismo criterio que el gate desplegado: TXT o canónico, álbum con imágenes, o audio/vídeo). Fuente técnica: inventario de solo lectura de CP-4C (`docs/ops/CHP_CONTENT_PROTECTION_CP4C.md` §F).

## Resumen para decisión

```
TOTAL:                          109
PENDIENTES:                     109
STRICT_READABLE:                94
STRICT_BLOCKED_IF_SELECTED:     15
YA DESPLEGADO TÉCNICAMENTE:     YES (CP-4B, contentprotect-cp4-3b9bff6)
TÍTULOS ACTUALMENTE STRICT:     0
PRODUCCIÓN MODIFICADA:          NO
```

Representaciones: PDF 51 · EPUB 1 · TXT/canónico 61 (canónico 1) · visual 9 · audio 17 · vídeo 5.

## Matriz (109 títulos)

| contentId | título | PDF | EPUB | TXT/canónico | visual | audio/vídeo | strict_readable | POLÍTICA | FUENTE_DE_DECISIÓN | OBSERVACIÓN | ESTADO |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `child-content-1765751724398-0-1765814004450` | La guerra de los mundos (adaptación 1938 | — | — | — | — | audio | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1765751139919` | La metamorfosis | Y | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1765751724398` | La guerra de los mundos | Y | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1765812186368` | El extraño caso del Dr. Jekyll y el Sr. | Y | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1765830206526` | El vampiro | Y | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1765837262553` | Aprendizaje basado en retos: una mirada | Y | — | canónico | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1765984421218-0` | Las aventuras de Alicia en el país de la | — | — | — | — | vídeo | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1765985212432-0` | Las aventuras de Alicia en el país de la | — | — | — | — | vídeo | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1765986272029` | Novela de ajedrez | Y | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1765986434403-0` | Detrás de las páginas - 009. Novela de a | — | — | — | — | vídeo | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1765988943452` | Lu y los cardenales | — | — | — | — | vídeo | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1773325007384` | Las aventuras de Alicia en el país de la | Y | Y | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1773325047574-0` | contexto 001 | — | — | — | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1773325050530-1` | bio carroll | — | — | — | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1773676835077` | Llegaba tarde la tortuga | Y | — | — | — | — | — | PENDIENTE |  | Solo PDF: si se elige LICENSED_STRICT queda bloqueado hasta tener texto o álbum | PENDING_EDITORIAL_DECISION |
| `content-1773676854661-0` | Guía actividades | Y | — | — | — | — | — | PENDIENTE |  | Solo PDF: si se elige LICENSED_STRICT queda bloqueado hasta tener texto o álbum | PENDING_EDITORIAL_DECISION |
| `content-1773676865746-1` | Guía lectura | Y | — | — | — | — | — | PENDIENTE |  | Solo PDF: si se elige LICENSED_STRICT queda bloqueado hasta tener texto o álbum | PENDING_EDITORIAL_DECISION |
| `content-1773677322659` | Adiós árbol, hola garza | Y | — | — | — | — | — | PENDIENTE |  | Solo PDF: si se elige LICENSED_STRICT queda bloqueado hasta tener texto o álbum | PENDING_EDITORIAL_DECISION |
| `content-1773677346916-0` | Guía lectura | Y | — | — | — | — | — | PENDIENTE |  | Solo PDF: si se elige LICENSED_STRICT queda bloqueado hasta tener texto o álbum | PENDING_EDITORIAL_DECISION |
| `content-1773677357677-1` | Guía de actividades | Y | — | — | — | — | — | PENDIENTE |  | Solo PDF: si se elige LICENSED_STRICT queda bloqueado hasta tener texto o álbum | PENDING_EDITORIAL_DECISION |
| `content-1773692447274` | Zorrito, cómo te sientes hoy | Y | — | — | — | — | — | PENDIENTE |  | Solo PDF: si se elige LICENSED_STRICT queda bloqueado hasta tener texto o álbum | PENDING_EDITORIAL_DECISION |
| `content-1773692470405-0` | Guía de actividades | Y | — | — | — | — | — | PENDIENTE |  | Solo PDF: si se elige LICENSED_STRICT queda bloqueado hasta tener texto o álbum | PENDING_EDITORIAL_DECISION |
| `content-1773692482811-1` | Guía de lectura | Y | — | — | — | — | — | PENDIENTE |  | Solo PDF: si se elige LICENSED_STRICT queda bloqueado hasta tener texto o álbum | PENDING_EDITORIAL_DECISION |
| `content-1773693002648` | Búho y la noche inquieta | Y | — | — | — | — | — | PENDIENTE |  | Solo PDF: si se elige LICENSED_STRICT queda bloqueado hasta tener texto o álbum | PENDING_EDITORIAL_DECISION |
| `content-1773693027690-0` | Guía de lectura | Y | — | — | — | — | — | PENDIENTE |  | Solo PDF: si se elige LICENSED_STRICT queda bloqueado hasta tener texto o álbum | PENDING_EDITORIAL_DECISION |
| `content-1773693039737-1` | Guía de actividades | Y | — | — | — | — | — | PENDIENTE |  | Solo PDF: si se elige LICENSED_STRICT queda bloqueado hasta tener texto o álbum | PENDING_EDITORIAL_DECISION |
| `content-1773693517166` | Mi sombra | Y | — | — | — | — | — | PENDIENTE |  | Solo PDF: si se elige LICENSED_STRICT queda bloqueado hasta tener texto o álbum | PENDING_EDITORIAL_DECISION |
| `content-1773693527262-0` | Guía de actividades | Y | — | — | — | — | — | PENDIENTE |  | Solo PDF: si se elige LICENSED_STRICT queda bloqueado hasta tener texto o álbum | PENDING_EDITORIAL_DECISION |
| `content-1773693537202-1` | Guía de lectura | Y | — | — | — | — | — | PENDIENTE |  | Solo PDF: si se elige LICENSED_STRICT queda bloqueado hasta tener texto o álbum | PENDING_EDITORIAL_DECISION |
| `content-1774362922886` | Me desconecto, luego existo | Y | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1774363534133` | Fascismo, totalitarismo  y otras formas | Y | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1774474831059` | El fantasma en la máquina: inteligencia | Y | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1774479973149` | Platón, posverdad y fake news | Y | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1774480266132` | Ismos para entender la política | Y | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1774480401139` | Anarquismo | Y | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1775664683377` | El libro de la selva | Y | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1775693503920` | Programa Integral de Lectura, Escritura, | Y | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1775693616679` | MÓDULO 1 - Fundamentos del modelo pedagó | Y | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1775693670295` | MÓDULO 2 - Desarrollo de la competencia | Y | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1775693733575` | MÓDULO 3 - Experiencia pedagógica y medi | Y | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1775695363643` | MÓDULO 4 - Dispositivos pedagógicos | Y | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1775764092850` | MÓDULO 5 - Ecosistema lector | Y | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1775764137017` | MÓDULO 6 - Escuela de familias lectoras | Y | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1775764203505` | MÓDULO 7 - Sistema de evaluación y medic | Y | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1775764251632` | MÓDULO 8 - Implementación del programa | Y | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1775766806680` | Cuentos de la selva | Y | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1775775232788` | Las aventuras de Pinocho | Y | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1775833161349` | El fantasma de Canterville | Y | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1775842631055` | Sherlock Holmes - Antología final | Y | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1775853017025` | El principito | Y | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1776006983915` | Sol de los venados | — | — | — | Y | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1776085981693` | Muu, bee, guau. | — | — | — | Y | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1776087315660` | Un reino para el tirano | — | — | — | Y | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1776089328593` | Monogatari | — | — | — | Y | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1776091771540` | Millones de gatos | — | — | — | Y | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1776092773110` | Sierra nevada | — | — | — | Y | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1776094054977` | Odisea Pacífico | — | — | — | Y | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1776094921021` | Dinosaurios (en orden de estatura) | — | — | — | Y | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1776096790542` | El cuervo y otros relatos fantásticos | Y | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1776097919834` | La llamada de Cthulhu y otros cuentos de | Y | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1776110044250` | Juega, ríe y repite. El juego como ensay | Y | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1776111162557` | Dios, la nada y los domingos aburridos. | Y | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1776123779618` | Pensar es peligroso (pero necesario) | Y | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1776618897409` | Tutorial Chibatele+ | — | — | — | — | vídeo | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1776698380526` | Cuatro miradas sobre el río | — | — | — | Y | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1778608611968` | MÓDULO 9 - Leer para pensar | Y | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1779292030328` | Las ciudades que llevamos dentro | Y | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-1789417845849` | Una odisea marciana | Y | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-0b4db945383909dd` | A14. Día 7 — Estar juntos sin pantallas | — | — | — | — | audio | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-0ef0893ea7918897` | Texto del mook · Cinco formas de repetir | — | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-1314aa22942b6be3` | Transición · M0 | — | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-13ef9e9e5bd08451` | Libro · Aparecer o estar: el nuevo cogit | — | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-14e540305448b261` | Transición · M5 | — | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-194637c66ec4bd8a` | A01. Son las once de la noche | — | — | — | — | audio | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-280cb90ba4947874` | Texto del mook · La vida sin testigos | — | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-2b136ce44f9a6624` | A07.1. Si no posteo, desaparezco | — | — | — | — | audio | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-2cb6cee4c5d62eb0` | A03. Todos están hablando | — | — | — | — | audio | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-2f4a76b7f0fcdac4` | A07.3. La elección de empezar a elegir | — | — | — | — | audio | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-36cc16ae3e38edba` | Libro · Elegir un yo: Kierkegaard en la | — | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-3c75004673056890` | A15. Una ética de la presencia | — | — | — | — | audio | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-3d34865f4f038b73` | Texto del mook · El derecho a terminar u | — | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-4342c67bc54f081f` | A07.2. Libertad no paga las cuentas | — | — | — | — | audio | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-44618b03d1c40d84` | Libro · Simone Weil: atención como justi | — | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-47e73ce82d0b4399` | Libro · Prólogo. Me desconecto, luego ex | — | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-504485bf351dac48` | A06. Me estás escuchando | — | — | — | — | audio | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-5111c1e4c1e6b42f` | Texto del mook · Elegir también es perde | — | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-5ed5d88f4bdbacbb` | Texto del mook · Antes del reto... peque | — | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-61299103268a17d1` | Transición · M3 | — | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-629b97373cd6c898` | A13. Día 6 — No responder todavía | — | — | — | — | audio | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-6c9fda952939e21e` | Libro · La multitud y la angustia | — | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-71ce37b29d1ab29f` | Texto del mook · Carta de entrada | — | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-87f9579ecc9b6f53` | Libro · Mil pestañas abiertas: lo dividi | — | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-893425fc7c6d350c` | Texto del mook · La pausa metódica | — | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-8dcd6dd03e85c687` | Transición · M2 | — | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-933b26a70b967f6b` | Libro · Prácticas de atención: pequeñas | — | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-96587aab149d0d36` | A02. Si no lo publicaste, ocurrió | — | — | — | — | audio | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-983b7407e8e4e7f6` | A12. Día 5 — Caminar sin audífonos | — | — | — | — | audio | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-a0cc5fa9c906b3de` | Libro · Presencias ausentes: estar sin e | — | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-b851c5f786a2dc8e` | Transición · M4 | — | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-c1b1b5295527c06e` | Libro · Epílogo — Una ética de la presen | — | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-c70beb0068d9c36b` | A05. Noventa segundos | — | — | — | — | audio | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-ca65a887d3cf739d` | Transición · M6 | — | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-cb4e7581c0bbdcd9` | Transición · M1 | — | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-df6d23a13f2c3372` | A11. Día 4 — Escuchar sin interrumpir | — | — | — | — | audio | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-e5bad7832faebe32` | A08. Día 1 — Una hora sin notificaciones | — | — | — | — | audio | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-ef889cb83492f158` | A10. Día 3 — Una fotografía que no vas a | — | — | — | — | audio | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-f2a5ab6d86844df6` | Texto del mook · Quién eligió esta opini | — | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-f4ff74426d1ac743` | A09. Día 2 — Una sola pestaña | — | — | — | — | audio | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |
| `content-mook-eaq-fad2f33d8fb7a19c` | Libro · El silencio cartesiano: deteners | — | — | TXT | — | — | Y | PENDIENTE |  |  | PENDING_EDITORIAL_DECISION |

## Títulos que requieren representación derivada si la decisión editorial es LICENSED_STRICT

Hoy solo se leen por su PDF original. Si se marcan `LICENSED_STRICT`, el gate de publicación rechaza el cambio (422) y el título quedaría sin lectura. Antes habría que dotarlos de texto (TXT o canónico) o de páginas de álbum. Esta unidad no crea ninguna.

| contentId | título | representación actual | representación faltante |
|---|---|---|---|
| `content-1773676835077` | Llegaba tarde la tortuga | PDF original | texto (TXT o canónico) para Guiado, Accesible e Inmersivo, o páginas de álbum para la lectura visual |
| `content-1773676854661-0` | Guía actividades | PDF original | texto (TXT o canónico) para Guiado, Accesible e Inmersivo, o páginas de álbum para la lectura visual |
| `content-1773676865746-1` | Guía lectura | PDF original | texto (TXT o canónico) para Guiado, Accesible e Inmersivo, o páginas de álbum para la lectura visual |
| `content-1773677322659` | Adiós árbol, hola garza | PDF original | texto (TXT o canónico) para Guiado, Accesible e Inmersivo, o páginas de álbum para la lectura visual |
| `content-1773677346916-0` | Guía lectura | PDF original | texto (TXT o canónico) para Guiado, Accesible e Inmersivo, o páginas de álbum para la lectura visual |
| `content-1773677357677-1` | Guía de actividades | PDF original | texto (TXT o canónico) para Guiado, Accesible e Inmersivo, o páginas de álbum para la lectura visual |
| `content-1773692447274` | Zorrito, cómo te sientes hoy | PDF original | texto (TXT o canónico) para Guiado, Accesible e Inmersivo, o páginas de álbum para la lectura visual |
| `content-1773692470405-0` | Guía de actividades | PDF original | texto (TXT o canónico) para Guiado, Accesible e Inmersivo, o páginas de álbum para la lectura visual |
| `content-1773692482811-1` | Guía de lectura | PDF original | texto (TXT o canónico) para Guiado, Accesible e Inmersivo, o páginas de álbum para la lectura visual |
| `content-1773693002648` | Búho y la noche inquieta | PDF original | texto (TXT o canónico) para Guiado, Accesible e Inmersivo, o páginas de álbum para la lectura visual |
| `content-1773693027690-0` | Guía de lectura | PDF original | texto (TXT o canónico) para Guiado, Accesible e Inmersivo, o páginas de álbum para la lectura visual |
| `content-1773693039737-1` | Guía de actividades | PDF original | texto (TXT o canónico) para Guiado, Accesible e Inmersivo, o páginas de álbum para la lectura visual |
| `content-1773693517166` | Mi sombra | PDF original | texto (TXT o canónico) para Guiado, Accesible e Inmersivo, o páginas de álbum para la lectura visual |
| `content-1773693527262-0` | Guía de actividades | PDF original | texto (TXT o canónico) para Guiado, Accesible e Inmersivo, o páginas de álbum para la lectura visual |
| `content-1773693537202-1` | Guía de lectura | PDF original | texto (TXT o canónico) para Guiado, Accesible e Inmersivo, o páginas de álbum para la lectura visual |

## Grupos para la revisión humana

Solo agrupan filas para trabajar más rápido. **No son recomendaciones de política** y no usan el autor como indicio de derechos. Un título puede aparecer en varios grupos.

### Proyecto MOOK «¿Estás aquí?» (41)

Nodos de la experiencia (audio, texto del MOOK, transiciones y capítulos del libro asociado). Ninguno tiene PDF ni EPUB original, así que la política solo tendría efecto si en el futuro se les adjunta un original.

`content-mook-eaq-0b4db945383909dd` A14. Día 7 — Estar juntos sin pantallas, `content-mook-eaq-0ef0893ea7918897` Texto del mook · Cinco formas de repetir, `content-mook-eaq-1314aa22942b6be3` Transición · M0, `content-mook-eaq-13ef9e9e5bd08451` Libro · Aparecer o estar: el nuevo cogit, `content-mook-eaq-14e540305448b261` Transición · M5, `content-mook-eaq-194637c66ec4bd8a` A01. Son las once de la noche, `content-mook-eaq-280cb90ba4947874` Texto del mook · La vida sin testigos, `content-mook-eaq-2b136ce44f9a6624` A07.1. Si no posteo, desaparezco, `content-mook-eaq-2cb6cee4c5d62eb0` A03. Todos están hablando, `content-mook-eaq-2f4a76b7f0fcdac4` A07.3. La elección de empezar a elegir, `content-mook-eaq-36cc16ae3e38edba` Libro · Elegir un yo: Kierkegaard en la, `content-mook-eaq-3c75004673056890` A15. Una ética de la presencia, `content-mook-eaq-3d34865f4f038b73` Texto del mook · El derecho a terminar u, `content-mook-eaq-4342c67bc54f081f` A07.2. Libertad no paga las cuentas, `content-mook-eaq-44618b03d1c40d84` Libro · Simone Weil: atención como justi, `content-mook-eaq-47e73ce82d0b4399` Libro · Prólogo. Me desconecto, luego ex, `content-mook-eaq-504485bf351dac48` A06. Me estás escuchando, `content-mook-eaq-5111c1e4c1e6b42f` Texto del mook · Elegir también es perde, `content-mook-eaq-5ed5d88f4bdbacbb` Texto del mook · Antes del reto... peque, `content-mook-eaq-61299103268a17d1` Transición · M3, `content-mook-eaq-629b97373cd6c898` A13. Día 6 — No responder todavía, `content-mook-eaq-6c9fda952939e21e` Libro · La multitud y la angustia, `content-mook-eaq-71ce37b29d1ab29f` Texto del mook · Carta de entrada, `content-mook-eaq-87f9579ecc9b6f53` Libro · Mil pestañas abiertas: lo dividi, `content-mook-eaq-893425fc7c6d350c` Texto del mook · La pausa metódica, `content-mook-eaq-8dcd6dd03e85c687` Transición · M2, `content-mook-eaq-933b26a70b967f6b` Libro · Prácticas de atención: pequeñas, `content-mook-eaq-96587aab149d0d36` A02. Si no lo publicaste, ocurrió, `content-mook-eaq-983b7407e8e4e7f6` A12. Día 5 — Caminar sin audífonos, `content-mook-eaq-a0cc5fa9c906b3de` Libro · Presencias ausentes: estar sin e, `content-mook-eaq-b851c5f786a2dc8e` Transición · M4, `content-mook-eaq-c1b1b5295527c06e` Libro · Epílogo — Una ética de la presen, `content-mook-eaq-c70beb0068d9c36b` A05. Noventa segundos, `content-mook-eaq-ca65a887d3cf739d` Transición · M6, `content-mook-eaq-cb4e7581c0bbdcd9` Transición · M1, `content-mook-eaq-df6d23a13f2c3372` A11. Día 4 — Escuchar sin interrumpir, `content-mook-eaq-e5bad7832faebe32` A08. Día 1 — Una hora sin notificaciones, `content-mook-eaq-ef889cb83492f158` A10. Día 3 — Una fotografía que no vas a, `content-mook-eaq-f2a5ab6d86844df6` Texto del mook · Quién eligió esta opini, `content-mook-eaq-f4ff74426d1ac743` A09. Día 2 — Una sola pestaña, `content-mook-eaq-fad2f33d8fb7a19c` Libro · El silencio cartesiano: deteners

### Programa Integral (módulos) (10)

`content-1775693503920` Programa Integral de Lectura, Escritura,, `content-1775693616679` MÓDULO 1 - Fundamentos del modelo pedagó, `content-1775693670295` MÓDULO 2 - Desarrollo de la competencia, `content-1775693733575` MÓDULO 3 - Experiencia pedagógica y medi, `content-1775695363643` MÓDULO 4 - Dispositivos pedagógicos, `content-1775764092850` MÓDULO 5 - Ecosistema lector, `content-1775764137017` MÓDULO 6 - Escuela de familias lectoras, `content-1775764203505` MÓDULO 7 - Sistema de evaluación y medic, `content-1775764251632` MÓDULO 8 - Implementación del programa, `content-1778608611968` MÓDULO 9 - Leer para pensar

### Títulos con PDF original (51)

`content-1765751139919` La metamorfosis, `content-1765751724398` La guerra de los mundos, `content-1765812186368` El extraño caso del Dr. Jekyll y el Sr., `content-1765830206526` El vampiro, `content-1765837262553` Aprendizaje basado en retos: una mirada, `content-1765986272029` Novela de ajedrez, `content-1773325007384` Las aventuras de Alicia en el país de la, `content-1773676835077` Llegaba tarde la tortuga, `content-1773676854661-0` Guía actividades, `content-1773676865746-1` Guía lectura, `content-1773677322659` Adiós árbol, hola garza, `content-1773677346916-0` Guía lectura, `content-1773677357677-1` Guía de actividades, `content-1773692447274` Zorrito, cómo te sientes hoy, `content-1773692470405-0` Guía de actividades, `content-1773692482811-1` Guía de lectura, `content-1773693002648` Búho y la noche inquieta, `content-1773693027690-0` Guía de lectura, `content-1773693039737-1` Guía de actividades, `content-1773693517166` Mi sombra, `content-1773693527262-0` Guía de actividades, `content-1773693537202-1` Guía de lectura, `content-1774362922886` Me desconecto, luego existo, `content-1774363534133` Fascismo, totalitarismo  y otras formas, `content-1774474831059` El fantasma en la máquina: inteligencia, `content-1774479973149` Platón, posverdad y fake news, `content-1774480266132` Ismos para entender la política, `content-1774480401139` Anarquismo, `content-1775664683377` El libro de la selva, `content-1775693503920` Programa Integral de Lectura, Escritura,, `content-1775693616679` MÓDULO 1 - Fundamentos del modelo pedagó, `content-1775693670295` MÓDULO 2 - Desarrollo de la competencia, `content-1775693733575` MÓDULO 3 - Experiencia pedagógica y medi, `content-1775695363643` MÓDULO 4 - Dispositivos pedagógicos, `content-1775764092850` MÓDULO 5 - Ecosistema lector, `content-1775764137017` MÓDULO 6 - Escuela de familias lectoras, `content-1775764203505` MÓDULO 7 - Sistema de evaluación y medic, `content-1775764251632` MÓDULO 8 - Implementación del programa, `content-1775766806680` Cuentos de la selva, `content-1775775232788` Las aventuras de Pinocho, `content-1775833161349` El fantasma de Canterville, `content-1775842631055` Sherlock Holmes - Antología final, `content-1775853017025` El principito, `content-1776096790542` El cuervo y otros relatos fantásticos, `content-1776097919834` La llamada de Cthulhu y otros cuentos de, `content-1776110044250` Juega, ríe y repite. El juego como ensay, `content-1776111162557` Dios, la nada y los domingos aburridos., `content-1776123779618` Pensar es peligroso (pero necesario), `content-1778608611968` MÓDULO 9 - Leer para pensar, `content-1779292030328` Las ciudades que llevamos dentro, `content-1789417845849` Una odisea marciana

### Título con EPUB original (1)

`content-1773325007384` Las aventuras de Alicia en el país de la

### Álbumes (9)

`content-1776006983915` Sol de los venados, `content-1776085981693` Muu, bee, guau., `content-1776087315660` Un reino para el tirano, `content-1776089328593` Monogatari, `content-1776091771540` Millones de gatos, `content-1776092773110` Sierra nevada, `content-1776094054977` Odisea Pacífico, `content-1776094921021` Dinosaurios (en orden de estatura), `content-1776698380526` Cuatro miradas sobre el río

### Títulos solo PDF (bloqueados si se eligiera LICENSED_STRICT) (15)

`content-1773676835077` Llegaba tarde la tortuga, `content-1773676854661-0` Guía actividades, `content-1773676865746-1` Guía lectura, `content-1773677322659` Adiós árbol, hola garza, `content-1773677346916-0` Guía lectura, `content-1773677357677-1` Guía de actividades, `content-1773692447274` Zorrito, cómo te sientes hoy, `content-1773692470405-0` Guía de actividades, `content-1773692482811-1` Guía de lectura, `content-1773693002648` Búho y la noche inquieta, `content-1773693027690-0` Guía de lectura, `content-1773693039737-1` Guía de actividades, `content-1773693517166` Mi sombra, `content-1773693527262-0` Guía de actividades, `content-1773693537202-1` Guía de lectura

### Títulos sin PDF ni EPUB original (58)

Para estos títulos `LICENSED_STRICT` no cambia hoy lo que recibe el lector: no hay original que bloquear. Aun así, la decisión deja registrada la política por si se adjunta un original más adelante.

`child-content-1765751724398-0-1765814004450` La guerra de los mundos (adaptación 1938, `content-1765984421218-0` Las aventuras de Alicia en el país de la, `content-1765985212432-0` Las aventuras de Alicia en el país de la, `content-1765986434403-0` Detrás de las páginas - 009. Novela de a, `content-1765988943452` Lu y los cardenales, `content-1773325047574-0` contexto 001, `content-1773325050530-1` bio carroll, `content-1776006983915` Sol de los venados, `content-1776085981693` Muu, bee, guau., `content-1776087315660` Un reino para el tirano, `content-1776089328593` Monogatari, `content-1776091771540` Millones de gatos, `content-1776092773110` Sierra nevada, `content-1776094054977` Odisea Pacífico, `content-1776094921021` Dinosaurios (en orden de estatura), `content-1776618897409` Tutorial Chibatele+, `content-1776698380526` Cuatro miradas sobre el río, `content-mook-eaq-0b4db945383909dd` A14. Día 7 — Estar juntos sin pantallas, `content-mook-eaq-0ef0893ea7918897` Texto del mook · Cinco formas de repetir, `content-mook-eaq-1314aa22942b6be3` Transición · M0, `content-mook-eaq-13ef9e9e5bd08451` Libro · Aparecer o estar: el nuevo cogit, `content-mook-eaq-14e540305448b261` Transición · M5, `content-mook-eaq-194637c66ec4bd8a` A01. Son las once de la noche, `content-mook-eaq-280cb90ba4947874` Texto del mook · La vida sin testigos, `content-mook-eaq-2b136ce44f9a6624` A07.1. Si no posteo, desaparezco, `content-mook-eaq-2cb6cee4c5d62eb0` A03. Todos están hablando, `content-mook-eaq-2f4a76b7f0fcdac4` A07.3. La elección de empezar a elegir, `content-mook-eaq-36cc16ae3e38edba` Libro · Elegir un yo: Kierkegaard en la, `content-mook-eaq-3c75004673056890` A15. Una ética de la presencia, `content-mook-eaq-3d34865f4f038b73` Texto del mook · El derecho a terminar u, `content-mook-eaq-4342c67bc54f081f` A07.2. Libertad no paga las cuentas, `content-mook-eaq-44618b03d1c40d84` Libro · Simone Weil: atención como justi, `content-mook-eaq-47e73ce82d0b4399` Libro · Prólogo. Me desconecto, luego ex, `content-mook-eaq-504485bf351dac48` A06. Me estás escuchando, `content-mook-eaq-5111c1e4c1e6b42f` Texto del mook · Elegir también es perde, `content-mook-eaq-5ed5d88f4bdbacbb` Texto del mook · Antes del reto... peque, `content-mook-eaq-61299103268a17d1` Transición · M3, `content-mook-eaq-629b97373cd6c898` A13. Día 6 — No responder todavía, `content-mook-eaq-6c9fda952939e21e` Libro · La multitud y la angustia, `content-mook-eaq-71ce37b29d1ab29f` Texto del mook · Carta de entrada, `content-mook-eaq-87f9579ecc9b6f53` Libro · Mil pestañas abiertas: lo dividi, `content-mook-eaq-893425fc7c6d350c` Texto del mook · La pausa metódica, `content-mook-eaq-8dcd6dd03e85c687` Transición · M2, `content-mook-eaq-933b26a70b967f6b` Libro · Prácticas de atención: pequeñas, `content-mook-eaq-96587aab149d0d36` A02. Si no lo publicaste, ocurrió, `content-mook-eaq-983b7407e8e4e7f6` A12. Día 5 — Caminar sin audífonos, `content-mook-eaq-a0cc5fa9c906b3de` Libro · Presencias ausentes: estar sin e, `content-mook-eaq-b851c5f786a2dc8e` Transición · M4, `content-mook-eaq-c1b1b5295527c06e` Libro · Epílogo — Una ética de la presen, `content-mook-eaq-c70beb0068d9c36b` A05. Noventa segundos, `content-mook-eaq-ca65a887d3cf739d` Transición · M6, `content-mook-eaq-cb4e7581c0bbdcd9` Transición · M1, `content-mook-eaq-df6d23a13f2c3372` A11. Día 4 — Escuchar sin interrumpir, `content-mook-eaq-e5bad7832faebe32` A08. Día 1 — Una hora sin notificaciones, `content-mook-eaq-ef889cb83492f158` A10. Día 3 — Una fotografía que no vas a, `content-mook-eaq-f2a5ab6d86844df6` Texto del mook · Quién eligió esta opini, `content-mook-eaq-f4ff74426d1ac743` A09. Día 2 — Una sola pestaña, `content-mook-eaq-fad2f33d8fb7a19c` Libro · El silencio cartesiano: deteners

## Después de la revisión

Con la matriz devuelta, CP-4C se repite solo sobre las filas `READY_STRICT`: activación título a título por la API administrativa, con su verificación y su rollback por título. Las filas `READY_STANDARD` no requieren cambio técnico, porque standard es el comportamiento por defecto. Las `PENDING` y `BLOCKED` no se tocan.
