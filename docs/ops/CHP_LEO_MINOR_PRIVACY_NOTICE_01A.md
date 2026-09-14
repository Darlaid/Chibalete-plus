# CHP-LEO-MINOR-PRIVACY-NOTICE-01A — Aviso de privacidad para menores en las superficies de Leo

**Veredicto:** `GREEN-LEO-MINOR-PRIVACY-NOTICE-LOCAL-AND-PUBLISHED`
**Alcance:** local. Publicado en `origin/chp/mook-contract-00`. **NO desplegado.**
**Fecha:** 2026-09-14.

Cierra localmente **COMP-05**, el último P1 abierto de
`docs/ops/CHP_PRIVACY_SECURITY_AI_EVIDENCE_01A.md`.

Esto **no es una política integral de privacidad** ni una declaración de
cumplimiento jurídico. Es un aviso breve, dirigido a lectores menores de edad,
visible en el momento en que van a escribirle a Leo.

---

## 1. Autoridad y texto aprobado

**Autoridad:** Nicolás Jiménez, Director de Chibalete Editores. El texto se
incorporó **verbatim**, sin reescrituras.

> **Cuida tu información.** Cuando usas Leo, lo que escribes se procesa para
> generar una respuesta y Chibalete+ registra señales generales para acompañar tu
> lectura. No compartas nombres completos, direcciones, teléfonos, contraseñas ni
> otra información privada. Tu mediador puede consultar indicadores de
> acompañamiento, no la conversación completa. Si algo te incomoda, cierra Leo y
> habla con una persona adulta o con tu mediador.
>
> Consultas sobre privacidad: contacto@chibaleteeditores.com

El canal es el **buzón institucional público** ya usado por Chibalete Editores.
Esta unidad **no** valida su recepción técnica ni afirma que constituya un canal
formal de derechos del titular.

## 2. Baseline

```text
Rama: chp/mook-contract-00
HEAD: 0ae72cb5e0e9ce60af263f3dbdca1a0be88f0af0
Local == remoto (git ls-remote, sin fetch)
Tracked limpio · 3 stashes y 5 untracked preexistentes, sin abrir
```

## 3. Superficies inventariadas

Revalidadas contra HEAD buscando **dónde una persona envía información a Leo**:

| Superficie | Archivo | Rol |
|---|---|---|
| Chat flotante | `components/Chatbot.tsx` | campo de texto → `chatConBibliotecario` → `/api/leo/chat` |
| Compañero de lectura | `components/LeoCompanion.tsx` | campo de texto → `/api/leo/ask` |
| Nodo LEO de Experiencias | `pages/Experiencias.tsx` | punto de entrada a la conversación dentro de una Experiencia |

**Precisión honesta:** el nodo LEO no tiene campo propio; instruye a conversar
con Leo dentro de la lectura y valida con «Ya conversé». Se cubre igual porque es
donde el lector decide entrar a esa conversación.

Descartadas tras revisarlas, por no enviar texto libre del lector a Leo:
`AulaViva.tsx` (análisis de progreso para el mediador), `SubirContenido.tsx`
(análisis de ilustración), `Trivia.tsx` (generación de preguntas),
`VisorAlbum.tsx` y `VisorTexto.tsx` (micro-resumen y TTS).
`VisorInmersivo.tsx` y `VisorTexto.tsx` montan `LeoCompanion`, ya cubierto.
No apareció una cuarta superficie activa.

## 4. Coherencia factual

Cada afirmación del texto aprobado se contrastó con el código vigente:

| Afirmación | Verificación en HEAD |
|---|---|
| «lo que escribes se procesa para generar una respuesta» | `/api/leo/ask` y `/api/leo/chat` envían el texto al proveedor |
| «Chibalete+ registra señales generales» | `leoEvidenceService` persiste 18 campos estructurados; `leoBackboneEmitter` emite eventos sin texto |
| «tu mediador puede consultar indicadores…, no la conversación completa» | `leoMediatorViewService._toEvidenceSignal()` proyecta 6 campos: `timestamp`, `surface`, `contentId`, `pedagogicalObjective`, `evidenceType`, `interpretationHint` |
| las evidencias nuevas ya no guardan extractos verbatim | `_PERSISTED_FIELDS` excluye `userInputPreview` y `answerPreview` (`bd77695`) |
| Leo no califica ni sustituye al mediador | coherente con el aviso de IA vigente, que lo dice explícitamente |

Ninguna afirmación contradice el código. No aplicó
`STOP-LEO-PRIVACY-NOTICE-FACTUAL-CONTRADICTION`.

**Límite declarado:** el texto dice «se procesa» sin nombrar al proveedor externo
(OpenAI primario, Gemini de respaldo). Es cierto, pero no exhaustivo; nombrarlo
corresponde a una política integral, no a este aviso.

## 5. Allowlist

| Archivo | Cambio |
|---|---|
| `components/Chatbot.tsx` | +8 líneas |
| `components/LeoCompanion.tsx` | +8 líneas |
| `pages/Experiencias.tsx` | +8 líneas |
| `hooks/__tests__/useReducedMotion.structural.test.mjs` | §14, 45 aserciones |
| `docs/ops/CHP_LEO_MINOR_PRIVACY_NOTICE_01A.md` | este documento |

Sin componente nuevo, sin test nuevo, sin página, modal, consentimiento,
servicio, dependencia ni infraestructura. No se tocó backend, rutas, stores,
prompts, eventos, navegación, `package.json`, configuración ni workflows.

## 6. Invariantes implementados

El mismo aviso, con el mismo texto, en las tres superficies, sin excepción por
rol, libro, experiencia ni usuario:

- **texto completo y visible en el DOM** — no `title`, no tooltip, no `aria-label`;
- **precede al control que inicia la interacción**: antes del campo y del envío
  en el chat, antes de «Explicar vocabulario» / «Pregunta sobre el texto» / el
  envío en el compañero, y antes de «Ya conversé — validar» en el nodo LEO;
- **el aviso de IA sigue visible y lo precede** en las tres;
- **canal como enlace `mailto:`**, alcanzable por teclado — el ciclo Tab del
  diálogo ya incluye `[href]` en su selector, así que no hubo que tocarlo;
- **informativo, no consentimiento**: sin checkbox, aceptación, bloqueo ni modal;
- **no es live region**: no se anuncia durante el streaming;
- **una sola vez por superficie**, fuera del `map` de mensajes y del bloque
  `mode === 'result'`;
- **no entra en ningún payload ni se envía al modelo**;
- sin estado, efecto ni import nuevos; foco, Escape, restauración, respuestas y
  puntos intactos.

Estilos: la banda existente `text-xs` con `gray-600` / `dark:gray-300` sobre
`gray-50` / `dark:gray-900` — el par que CHP-WCAG-01C ya fijó (7.23:1 en claro,
12.04:1 en oscuro). En el nodo LEO se usó el idioma de tarjeta de esa página
(`rounded-lg … p-2`) en vez del borde inferior del panel, para no introducir un
patrón visual ajeno.

**Observación de densidad, sin corregir:** en el chat a 320 px el aviso de IA más
el de privacidad ocupan una porción apreciable del panel de 500 px, reduciendo el
área de mensajes (que sigue desplazándose). Es consecuencia directa de mostrar el
texto íntegro, como exige la decisión aprobada. Queda registrado para un eventual
pase de UX; **no se alteró el texto ni su visibilidad**.

## 7. Pruebas

| Gate | Resultado |
|---|---|
| `hooks/__tests__/useReducedMotion.structural.test.mjs` (§14 nueva, 45 aserciones) | **195/195 ✓** (antes 141) |
| `server/__test__/mookAudioA11y.test.mjs` | **18/18 OK** |
| `npm run test:mook` (cubre `Experiencias`) | **rc=0**, 228 aserciones, 0 fallos |
| `npm run build` | **✓ built in 46.95 s** |
| `npm run typecheck:baseline` | **✅ sin regresiones** |
| `npm run lint:evidence` | **OK — 873 archivos, 0 violaciones** |
| `git diff --check` | limpio |

Los 12 requisitos quedan cubiertos por §14: tres superficies, texto íntegro,
expresiones exigidas, orden en el DOM, buzón institucional como único correo,
ausencia de consentimiento, unicidad, permanencia del aviso de IA, contratos de
red intactos, ausencia de estado e imports nuevos, y contraste/reflow/foco.

No se arrancó backend ni Chrome: la banda reutiliza estilos ya auditados en
Chrome real por `CHP-LEO-AI-TRANSPARENCY-NOTICE-01A`, con el mismo par de color.

## 8. Aviso breve frente a política integral

| Este aviso | Una política integral |
|---|---|
| Qué pasa con lo que el lector escribe, en lenguaje para menores | Bases de legitimación, responsable y encargados |
| Qué ve el mediador | Proveedores, transferencias internacionales, plazos de retención |
| Qué no compartir | Derechos del titular y su procedimiento |
| A quién acudir si algo incomoda | Consentimiento parental y su registro |
| Buzón institucional de consultas | Canal formal de ejercicio de derechos |

Lo primero queda cubierto desde ahora. Lo segundo **sigue pendiente** y es
trabajo jurídico, no de software.

## 9. Estado

```text
COMP-05:                  CLOSED_LOCAL_PENDING_DEPLOYMENT
M2–M5_ARCHITECTURE:       COMPLETE
M2–M5_LOCAL_EVIDENCE:     COMPLETE
PRODUCTION_DEPLOYMENT:    PENDING
RELEASE_AUTHORIZATION:    NOT_GRANTED
COMPLIANCE_CERTIFICATION: NOT_CLAIMED
```

Pendientes que esta unidad **no** toca: despliegue de todo lo `LOCAL_ONLY`;
política integral de privacidad y revisión jurídica de los stores `leo_*`
(`NEEDS_LEGAL_REVIEW`); purga del histórico de previews (`NOT_AUTHORIZED`);
cierre del drain de M1 y su dependencia de campo; `ENFORCE` (`NOT_AUTHORIZED`);
registro de `a11y-baseline` como workflow activo.

## 10. Cero producción

Sin SSH, Docker, deploy, flags ni stores reales. No se abrió `data/`,
`data-critical/`, `uploads/`, untracked ni stashes. Cuatro archivos de código y
prueba, más este documento.

## 11. Único siguiente paso

Decisión humana sobre **desplegar** el conjunto acumulado —aviso de IA, aviso de
privacidad, alcance del mediador de Leo, minimización de evidencia, cuerpo de
eventos fuera del log, principal canónico de Aula Viva y correcciones WCAG—, hoy
todo `LOCAL_ONLY` y bloqueado por el drain de M1.
