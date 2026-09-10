# CHP-PRIVACY-SECURITY-AI-EVIDENCE-01A (R1) — Inventario factual de privacidad, seguridad y gobernanza de IA

**Fecha:** 2026-09-10 · **Rama:** `chp/mook-contract-00` · **Baseline:** `46657dce24c544402d3369ea3d561adaea1d955a` (tras `chore(privacy): redact personal emails from tracked artifacts`)

| Campo | Valor |
|---|---|
| Veredicto | **GREEN-PRIVACY-SECURITY-AI-EVIDENCE-AUDIT-PUBLISHED** (auditoría completa; no certifica cumplimiento) |
| `M5` | **AMBER-EVIDENCE-AUDITED-REMEDIATION-PENDING** |
| `HISTORY_REWRITE` | `PROHIBITED_NOT_EXECUTED` |
| Método | Solo código, tests y documentos tracked; sin scanners, sin subagentes, sin datos reales, sin producción |

Estados usados: `PROVEN` (código + test tracked), `DOCUMENTED` (política sin implementación demostrada), `IMPLEMENTED_OFF` (implementado, desactivado), `DEPLOYED` (documento productivo vigente lo demuestra), `PARTIAL`, `ABSENT`, `UNKNOWN`, `REQUIRES_HUMAN_DECISION`, `NOT_APPLICABLE`. Cadena: `POLICY → IMPLEMENTATION → ACTIVATION → PRODUCTION EVIDENCE`. Ningún commit local posterior a la imagen `ped01d-bef0afe` (2026-09-07) se presenta como desplegado.

---

## 1. Alcance y límites

Cubre las autoridades tracked de autenticación y sesión, roles/memberships/tenant isolation, acceso a contenidos pedagógicos, eventos, evidencias MOOK/Review, `signal_snapshots`, retención, backups, logging, Leo y demás llamadas a modelos, workflows de seguridad y textos visibles. No cubre: historial de Git, stores reales, uploads reales, Android LU, EN 301 549, valoración jurídica (RGPD, Ley 1581, AI Act), pruebas de intrusión ni auditoría de dependencias más allá de los checks existentes. La evidencia productiva proviene exclusivamente de documentos tracked; donde ninguno lo demuestra, el estado es `UNKNOWN`.

## 2. Árbol actual libre de PII personal

Gate ejecutado sobre HEAD con búsqueda de patrones de correo y de secretos, sin imprimir valores:

| Comprobación | Resultado |
|---|---|
| Cadenas con forma de correo en archivos tracked | 123, todas clasificadas |
| Dominios personales (gmail, hotmail, outlook, yahoo, icloud, protonmail) | 0 |
| Patrones de claves de proveedor, tokens o claves privadas | 0 |
| Clasificación | fixtures sintéticos de tests (`x.cl`, `fx.test`, `test.local`, `loadtest.fx.local`, `fixture.*`, `example.*`, `x.com`, `mail.com`, `t.test`, `colegio.test`), plantilla CSV (`colegio.edu`), compose local (`chibalete.local`), buzones funcionales públicos de Chibalete (contacto, ventas), buzón genérico de rol `admin@…` del seed local y dos entradas demo en `services/dataService.ts` |

La redacción de `46657dc` cubre HEAD en adelante; los commits anteriores permanecen accesibles y el job `gitleaks-history` (no bloqueante) sigue en rojo por hallazgos históricos ya fuera de HEAD (`docs/ops/CHP_MOOK_ESTAS_AQUI_04B_RELEASE_PREFLIGHT.md:743-744`). Observación: `scripts/deploy-smoke-release.sh:148` deriva el actor de `git config user.email` y `:166` lo escribe en `server/.release-marker`; una futura ejecución reintroduciría un correo (§8, P2).

## 3. Estado local frente a producción

| Control / flag | Local (HEAD) | Producción (evidencia tracked) | Estado |
|---|---|---|---|
| Imagen API | `46657dc` (no desplegado) | `chibalete/api:ped01d-bef0afe` en ambas réplicas, healthy 2026-09-09 (`docs/ops/CHP_IDENTITY_M1_T0_EXECUTION_01.md:69-72`) | DEPLOYED |
| `SESSION_AUTH_MODE` | default `off` (`server/lib/sessionAuth.js:36-39`) | `compat` ×2 (`CHP_IDENTITY_M1_T0_EXECUTION_01.md:85-91`) | DEPLOYED (compat); ENFORCE `NOT_AUTHORIZED` (`:198-206`) |
| M1 drain | — | T0 = 2026-09-09T12:07:53Z, `M1: AMBER-DRAIN-IN_PROGRESS`, ventana ≥ 48 h hábiles (`:139-141, 171-180`) | DEPLOYED / en curso |
| `ACCESS_FALLBACK_MODE` | default `restricted` (`server/server.js:200-204`); `docker-compose.prod.yml:59` = `restricted` | **`open` ×2** en la última evidencia (`docs/ops/CHP_ACCESS_FILBO_CONSOLIDATION_01.md:23`; `CHP_IDENTITY_LU_CANONICAL_DISTRIBUTION_01.md:107`) | DEPLOYED = `open` (§7.3) |
| Pedagogía protegida (01D) | `server/accessService.js` | `ped01d-bef0afe`, 401/403/200 verificados por edge, 0 fugas (`docs/ops/CHP_ACCESS_PEDAGOGY_DEPLOY_02.md:3-19, 71-76, 161-170`) | DEPLOYED |
| Eventos canónicos MOOK (`EXPERIENCE_EVENTS_BACKBONE_ENABLED`) | implementado | ausente en `api_1` ⇒ NO-OP (`CHP_MOOK_ESTAS_AQUI_04B_RELEASE_PREFLIGHT.md:148`); activación `NOT_AUTHORIZED` (`T0_EXECUTION_01.md:205`) | IMPLEMENTED_OFF |
| Materializador, scheduler, `SNAPSHOT_HISTORY_ENABLED`, `ARCHIVE_ROTATION_ENABLED`, `pruneSignalSnapshots` | implementados, default OFF | «no desplegar ni activar» (`docs/ops/CHP_MOOK_EVENTS_EVIDENCE_PRIVACY_RETENTION_01.md:257-258`); estado real no verificado (`:246-247`) | IMPLEMENTED_OFF / UNKNOWN en prod |
| Retención (todas las capas) | políticas aprobadas, implementación `NOT_STARTED`, borrado `NOT_AUTHORIZED` (`docs/ops/CHP_MOOK_EVENTS_EVIDENCE_RETENTION_POLICY_01.md:179-192`) | retención indefinida (`:21-23`) | DOCUMENTED |
| Backups | runner + sandbox guard | timer cada 6 h, 237 snapshots, restore drill real 2026-09-03 (`docs/ops/CHP_BACKUP_MOOK_STORE_COVERAGE_01.md:178-181`; `CHP_BACKUP_COMPOSE_OVERRIDE_COVERAGE_01.md:10-14`); `forget/prune` nunca ejecutados (`ops/backup/CHP-BACKUP-01B/README.md:338-344`) | DEPLOYED (copia) / DOCUMENTED (retención 7/4/6) |
| Logging | pino con redacción (`server/lib/logger.js:25-41`) | sin `logging:` en compose tracked; rotación pendiente (`deployment_guide.md:1199`); edge ≈ 7 d, Prometheus 2 semanas (`T0_EXECUTION_01.md:106-108`) | PARTIAL |
| Leo texto (modelo) | `gemini-3.6-flash` por defecto (`server/aiEngine.js:34`) | commit `4c407af` es ancestro de `bef0afe` (imagen desplegada) ⇒ el modelo corregido viaja en producción; el documento `AI_RUNTIME_MODEL_COMPAT_01A.md:3-6` describe el estado previo al despliegue | DEPLOYED por cadena de imagen (sin doc específico) |
| Seguridad CI | `security.yml` | gitleaks-head, trivy (fs/config), evidence-hardening, image-integrity bloqueantes; gitleaks-history y trivy-image informativos; osv/trivy en rojo por advisories nuevos con remediación en rama sin desplegar (`docs/ops/SEC_DEPENDENCY_REMEDIATION_01.md:3-24`) | PARTIAL |

## 4. Matriz de datos y retención

| Categoría | Finalidad | Datos / identificadores | Naturaleza | Menores | Store | Lectura / escritura | Minimización | Política | Implementación | Activación | Borrado | En backups | Estado |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Identidad y memberships | autenticación, roles, alcance | id, nombre, correo, roles, `organizationId`, `accountStatus`, contraseña bcrypt | personal directo | sí (lectores) | `usuarios_colegios_oro.json`, `groups_db.json`, `schools_db.json`; sombra `identity.db` (V2 sin credenciales, `server/db/identityShadowV2.js:328-336`; V1 espeja `password`, `identityShadow.js:57-72`) | admin (CRUD), CIS lee; `sanitizeUserForClient` quita credenciales/tokens (`server.js:3285-3288`) | PARTIAL (sombra V1 con contraseña) | no definida | `DELETE /api/users/:id` sin cascada (`server.js:4515-4549`); tombstones solo en sombra | n/a | n/a | sí, cifrados por restic | PARTIAL |
| Sesiones | autenticación firmada | SHA-256 del sid, userId, `credentialVersion`, expiración (`server/db/sessionStore.js:26-37`) | seudonimizado | sí | `sessions.db` | servidor | PROVEN (solo hash) | TTL 12 h absoluto (`sessionAuth.js:33-34`); `cleanupExpiredSessions` oportunista | PROVEN | compat en prod | expiración + revocación (`server.js:9559-9589`) | no listado en inventario canónico | PROVEN |
| Eventos | analítica pedagógica | `user_id`, `session_id`, `content_id`, `payload_json` acotado por registry `.strip()` (`server/eventsService.js:82-97`; `server/analytics/eventRegistry.js:15`) | seudonimizado; payloads sin texto libre por contrato (`eventRegistry.js:125-132`) | sí | `events.db` | escritura con sesión en compat/enforce (`server/lib/eventsWriteAuth.js:25-47`); lectura materializador/health | PROVEN (payload inválido → marcador, `analyticsShadow.mjs:35-46`) | 90 d + archivo 12 meses (`RETENTION_POLICY_01.md:74-79`) | rotación implementada OFF (`archiveRotation.mjs:19-20`) | OFF; en prod flag MOOK ausente | ninguno ejecutado | sí | IMPLEMENTED_OFF |
| `signal_snapshots` / perfiles | proyecciones Aula Viva | `scope_id`=userId, señales, `metadata_json` (`server/db/insightsDbExt.mjs:36-93`) | seudonimizado | sí | `insights.db` | materializador (OFF), lectores con scope CIS | PROVEN | 90 d (`RETENTION_POLICY_01.md:106-114`) | `pruneSignalSnapshots` OFF, sin caller (`insightMaterializer.mjs:19-22`) | OFF | ninguno | sí | IMPLEMENTED_OFF |
| Runs y evidencias MOOK | producciones y revisión | `userId`, respuestas y texto libre, `versions[]`, `history[]`, `reviewerId` (`server/lib/experienceStore.js:371-385, 456-516`) | personal + **texto libre de menores** | sí | `mook_db.json` | participante (vista sin `reviewerId`, `:520-551`), admin/mediador con scope; `reviewDetailView` devuelve `review` con `reviewerId` (`:607-621`) | PARTIAL | relación activa + 12 meses (`RETENTION_POLICY_01.md:88-104`) | sin función de borrado (`PRIVACY_RETENTION_01.md:150-152`) | n/a | ABSENT | sí | DOCUMENTED / ABSENT |
| Diario privado MOOK | reflexión personal | texto libre del participante | personal, texto libre de menores | sí | `mook_db.json` | solo dueño, sin bypass de rol (`experienceStore.js:394-408, 529-537`) | PROVEN (proyección) | idem evidencias | «no se promete cifrado en reposo» (`:398`) | n/a | ABSENT | sí | PARTIAL |
| Evidencias de Leo | señales pedagógicas heurísticas | `userInputPreview` 80 chars y `answerPreview` 150 chars **verbatim**, clasificación, etapa (`server/leoEvidenceService.js:46-47, 287, 301`) | personal + fragmentos de texto libre | sí | `leo_evidence_db.json` (cap 2000→1800 entradas, `:44-45`) | servidor; mediador ve señales **sin previews** (`leoMediatorViewService.js:133-142`) | PARTIAL (previews) | «NEEDS_LEGAL_REVIEW» (`ops/backup/CHP-BACKUP-01B/runners/chibalete_backup/stores.py:94-116`) | sin TTL (0 coincidencias `ttl|expir|prune`) | activo cuando Leo se usa | solo recorte por volumen | sí, cifrados | PARTIAL (§8 P1) |
| Memoria y perfil de Leo | continuidad pedagógica | contadores y enumeraciones por usuario/contenido, sin transcripciones (`server/leoMemoryService.js:102-137`) | seudonimizado | sí | `leo_memory_db.json`, `leo_profile_db.json` | servidor | PROVEN | NEEDS_LEGAL_REVIEW | sin TTL | activo | ABSENT | sí | PARTIAL |
| Prompts y respuestas de Leo | inferencia | prompt: pasaje actual, extractos de contexto editorial, 4 campos de perfil no identificativos, nombre de organización; sin nombre, edad ni fecha (`server/leoContextBuilder.js:111-119`; `server/leoPolicy.js:106-119, 192`) | texto del alumno (≤ 250 chars, `leoGuard.js:7`) enviado al proveedor | sí | no persistidos íntegros; `leo_interactions_db.json` metadatos (`server.js:688, 7690`) | proveedor externo (OpenAI `gpt-4o-mini` primario para chat, Gemini fallback; `server/aiEngine.js:94-102`) | PROVEN (eventos Leo sin texto, `leoBackboneEmitter.mjs:22-25`) | ADR: jamás transcripciones en `events.db` (`docs/adr/CHP_ADR_MOOK.md:217, 229`) | n/a | activo en prod (imagen contiene `4c407af`) | n/a | metadatos sí | PROVEN / PARTIAL (previews en evidencias) |
| Logs | operación | request id, `userId` de header; redacción de cookies, secretos, `password`, `token` (`server/lib/logger.js:25-72`); **`POST /api/events` registra el cuerpo del evento** (`server.js:10004`); mismatches con ambos ids (`server.js:8354-8358`) | seudonimizado + payload | sí | stdout → json-file de Docker (rotación no versionada) | operadores del VPS | PARTIAL | 30 d (`RETENTION_POLICY_01.md:135-143`) | no versionada | UNKNOWN | UNKNOWN | no (fuera del inventario) | PARTIAL (§8 P1) |
| Uploads | contenido editorial y cubiertas | ficheros editoriales; sin texto de alumnos (evidencias MOOK son texto en `mook_db.json`, `experienceStore.js:374-375`) | no personal (editorial) | no | `public/uploads` | admin (`/api/upload` montado tras `requireAdminRole`, `server.js:651`); lectura gobernada por `auth_request` (`ops/edge/nginx.conf:182-185, 203`) | validación en 3 capas (`server.js:2627-2662`) | n/a | n/a | DEPLOYED | admin | sí | PROVEN |
| Backups y archivo de eventos | continuidad | 26 stores incl. padrón, eventos, insights, mook, leo_* (`stores.py:57-116, 185`) | personal + texto libre | sí | restic → B2, cifrado | runner root del VPS | n/a | 7/4/6 aprobado (`RETENTION_POLICY_01.md:116-133`) | `forget/prune` bloqueados y nunca ejecutados (`README.md:338-344`) | copia DEPLOYED; retención OFF | ninguno | — | DOCUMENTED (retención) |

Invariantes registrados: la ventana analítica de 28 d no es retención; los ids son seudónimos vinculables al padrón, no anonimización (`PRIVACY_RETENTION_01.md:113-123`); política aprobada ≠ borrado ejecutado.

## 5. Matriz de seguridad y aislamiento

| Control | Evidencia (código) | Test tracked | Producción | Estado |
|---|---|---|---|---|
| Sesión firmada HMAC, taxonomía 401/503 fail-closed | `server/lib/sessionAuth.js:94-129` | `sessionIdentity.test.mjs` 42/42; integración y cookie-only solo POSIX (CI) | compat | PROVEN local · DEPLOYED compat |
| Compat legacy: header aceptado; `enforce` exige `SESSION_LEGACY_ALLOW=1` | `sessionAuth.js:15-24, 164-167` | idem | compat; ENFORCE no autorizado | DEPLOYED compat |
| Subject mismatch → 401 | `sessionAuth.js:152-155`; eventos `eventsService.js:337-342` | `eventsWriteAuth.test.mjs` | — | PROVEN |
| Usuarios inactivos / inexistentes | `server.js:525-559` (401 en compat/enforce; 403 en `off`) | `mookReviewIdentity01a` capa A | — | PROVEN |
| Claves por referencia (archivo 0400, uid/gid, `O_NOFOLLOW`, zeroize) | `server/lib/secretFile.js:111-176`; `sessionSigningKey.js:17-53`; admin secret file-only `server.js:454-465` | integración POSIX | — | PROVEN (POSIX) |
| Cookie `chp_session`: httpOnly, sameSite strict, secure solo prod, 12 h, path `/` | `sessionAuth.js:239-247` | `sessionIdentity` | — | PROVEN |
| CSRF (Sec-Fetch-Site / Origin allowlist) | `sessionAuth.js:214-236` | integración POSIX | — | PROVEN |
| Login: bcryptjs, auto-upgrade, `loginLimiter` 10/15 min; **sin lockout por cuenta** | `server.js:3866-3899, 321-327` | — | — | PARTIAL |
| Rate limiting global e invitación/reset/TTS | `server.js:293-302, 329-379` | — | — | PROVEN (código) |
| Helmet sin CSP; CORS por allowlist con credenciales | `server.js:244-261` | — | — | PARTIAL |
| Roles y memberships explícitos, `organizationId` única autoridad, default-deny | `server/identity/cis.mjs:147-153, 203-249, 269-359`; `organizationScope.mjs:1-28, 109-142` | `cisScopeAccess` 69/69, `organizationScope`, `aulaVivaInstitutional` 44/44 | — | PROVEN |
| Aislamiento grupo/institución en Aula Viva | `scopeAccess.mjs:62-81`; timeline con scope (`operationalRouter.mjs`) | `aulaVivaOperational` 51/51 | no desplegado (posterior a `bef0afe`) | PROVEN local |
| Admin global por política declarada | `cis.mjs:276-278` | `cisScopeAccess` | — | PROVEN |
| Acceso pedagógico por `tipo`+`standalone`, portadas públicas, TTS clasificado | `server/accessService.js:48-118, 122-209`; `server.js:2131-2192, 2438-2479` | `pedagogyAccess01dB` | DEPLOYED 2026-09-07 | PROVEN + DEPLOYED |
| Fallback de contenidos | `server.js:2400-2407` | — | `open` en prod | ver §7.3 |
| Uploads: autorización efectiva por montaje | `app.use('/api/upload', requireAdminRole)` en `server.js:651` precede a `app.post('/api/upload')` en `:2666`; Express aplica el middleware montado antes de la ruta | — | — | PROVEN (cadena efectiva); la ruta no lo declara localmente (P2 de legibilidad) |
| Review: mediador gateado, admin opera; `reviewerId` de sesión | `server.js:1967-2064` | `mookReview01`, `mookReviewIdentity01a` | v1 en prod desde 2026-08-27 | PROVEN + DEPLOYED |
| Endpoints de mediador de Leo | `GET /api/leo/mediator/student/:userId[...]` y `/api/leo/activation/:userId` con `requireAuth` (GET pasa con sesión activa, sin rol ni scope; comentario D7 pendiente) `server.js:7859-7862, 7901` | ninguno | UNKNOWN | PARTIAL (§8 P1) |
| Eventos: escritura solo con sesión; 202 accept-and-drop Android temporal | `eventsWriteAuth.js:25-47, 69-91`; `server.js:3243-3260` | `eventsWriteAuth`, `eventsRoutesSessionGuard` | compat | PROVEN |
| Checks CI | `.github/workflows/security.yml` | — | bloqueantes verdes; 4 heredados en rojo | PARTIAL |

Pendientes registrados sin corregir: drain de M1; `SESSION_AUTH_MODE=compat`; `ACCESS_FALLBACK_MODE=open` productivo; activaciones bloqueadas (eventos, materializador, rotación, retención); cuatro jobs heredados en rojo.

## 6. Matriz de gobernanza de IA

| Punto | Evidencia | Estado |
|---|---|---|
| 1. Llamadas navegador→Gemini | `services/geminiService.ts:35, 43` crea `GoogleGenAI` si existe `VITE_GEMINI_API_KEY`; sin clave el cliente es `null` y las funciones degradan (`:41, 45`). Llamadores vivos: `pages/AulaViva.tsx:429` (`analizarProgresoPedagogico`), `pages/SubirContenido.tsx:631, 691` (álbum/etiquetas, admin), `pages/Trivia.tsx:43`. En producción la variable «se deja sin definir» (`ops/security/CHP-SEC-HISTORY-01A/GEMINI_KEY_ROTATION_RUNBOOK.md:73`); el backend ya sustituye la llamada de Subir (`server.js:7453`) | IMPLEMENTED_OFF en prod (DOCUMENTED); riesgo si el build recibe la clave (`docs/AUDITORIA-ESTRUCTURAL-2026-05.md:136`) |
| 2. Envío de audio grabado | `analizarFluidezLectora` (`geminiService.ts:363-388`) envía audio + frase de referencia | **sin llamador en pages/components/hooks** → código muerto, no alcanzable | ABSENT (no alcanzable) |
| 3. Puntuación de fluidez | la misma función pide `score` 1–5 | no alcanzable | ABSENT |
| 4. Activa/accesible/desplegada | ninguna ruta la invoca; en prod sin clave | — | ABSENT |
| 5–6. Uso de la puntuación | no se presenta ni decide | — | NOT_APPLICABLE |
| 7. Datos enviados al proveedor (Leo) | pasaje actual + pregunta (`server/leoResponder.js:5`), extractos editoriales acotados (`leoRetriever.js:10-15`), 4 campos de perfil (`leoContextBuilder.js:111-119`), nombre de organización (`leoPolicy.js:106-119`); guard ≤ 250 chars y vetos (`leoGuard.js:3-24`); `analizarProgresoPedagogico` (cliente, solo con clave) envía WPM, relecturas y puntuaciones de comprensión con userId en clave de caché (`geminiService.ts:518-541`) | PROVEN (servidor) |
| 8. Persistencia y logging | sin transcripciones en memoria/eventos (`leoMemoryService.js:102-137`; `leoBackboneEmitter.mjs:22-25`); previews verbatim en `leo_evidence_db.json` sin TTL; respuestas del cliente en `localStorage` bajo `gemini_cache_` (`geminiService.ts:53, 86`) | PARTIAL |
| 9. Aviso visible de IA | MOOK nodo LEO: «Leo es un asistente de inteligencia artificial: conversarás con una IA que acompaña tu lectura, no con una persona. Leo no califica ni evalúa; las producciones las revisa siempre tu mediador humano.» (`pages/Experiencias.tsx:304`; preview `ExperienceStudio.tsx:256`). Chat flotante: solo «Leo - Asistente» (`components/Chatbot.tsx:477`). Compañero de lectura: sin aviso (`components/LeoCompanion.tsx`) | PARTIAL (§8 P1) |
| 10. Revisar/rechazar/ignorar la salida | la salida es texto conversacional; el lector puede ignorarla; no hay acción que la aplique automáticamente | PROVEN (por diseño) |
| 11. Reporte de respuestas problemáticas | ningún control visible en Chatbot ni LeoCompanion | ABSENT |
| 12. Control humano | PRODUCTION exige revisión humana (`experienceStore.js:376`); recomendaciones con acknowledge/dismiss del docente (`operationalRouter.mjs:191, 212-219`) | PROVEN |
| 13. Ranking, notas, diagnóstico, decisión automatizada | ADR §17.2/§17.6 los prohíben (`docs/adr/CHP_ADR_MOOK.md:180, 225`); único efecto automático: token `[AWARD_POINTS: 5]` que otorga puntos de gamificación (`server/leoOrchestrator.js:804-808`; `Chatbot.tsx:390`); motores deterministas separados con vocabulario observacional (`AulaVivaOperacional.tsx:166-167`; `LongitudinalStudentTimeline.tsx:318-322`) | PROVEN salvo puntos (P2) |
| 14. Transparencia para menores y mediadores | solo el aviso del nodo LEO; sin edad ni fecha en prompts (`fecha_nacimiento` solo en `types/index.ts` y `pages/Perfil.tsx`) | PARTIAL |
| 15. Aviso de privacidad o consentimiento | única coincidencia: placeholder en `pages/Soporte.tsx:48`; `Bienvenida`, `Auth`, `Perfil` sin texto ni enlace | ABSENT (§8 P1/HUMAN) |

## 7. Hallazgos preliminares revalidados contra HEAD

| # | Hecho preliminar | Resultado | Soporte |
|---|---|---|---|
| 1 | Logging del cuerpo completo de eventos | **CONFIRMADO** | `server.js:10004` serializa `rest` del evento en `POST /api/events`; `:8354-8358` registra ambos ids en mismatches |
| 2 | Uploads autorizados por montaje | **CONFIRMADO como protegido** | `app.use('/api/upload', requireAdminRole)` (`:651`) antes de `app.post('/api/upload')` (`:2666`); no es vulnerabilidad, solo legibilidad |
| 3 | Fallback productivo abierto | **CONFIRMADO (documental)** | prod `open` (`FILBO_CONSOLIDATION_01.md:23`; `LU_CANONICAL_DISTRIBUTION_01.md:107`) vs `restricted` en `docker-compose.prod.yml:59` y default de código; el compose tracked no es el desplegado (`CHP_BACKUP_COMPOSE_OVERRIDE_COVERAGE_01.md:20-24`) |
| 4 | Leo textual no funcional en producción | **REFUTADO para el estado actual** | `4c407af` (modelo `gemini-3.6-flash`) es ancestro de `bef0afe`, imagen desplegada 2026-09-07 (`CHP_ACCESS_PEDAGOGY_DEPLOY_02.md:16`); el doc `AI_RUNTIME_MODEL_COMPAT_01A.md:3-6` describe el estado anterior; saldo del proveedor OpenAI = UNKNOWN |
| 5 | Ausencia de aviso de privacidad y menores | **CONFIRMADO** | grep sobre `pages/`, `components/`, `index.html`: solo placeholder `Soporte.tsx:48` |
| 6 | Llamadas directas a Gemini desde navegador | **CONFIRMADO en código, no en prod** | `geminiService.ts:35`; llamadores vivos en AulaViva, Subir y Trivia; prod sin `VITE_GEMINI_API_KEY` (documental) |
| 7 | Envío de audio y puntuación de fluidez | **REFUTADO (no alcanzable)** | `analizarFluidezLectora` sin llamador tracked |
| 8 | Evidencias verbatim de Leo sin expiración | **CONFIRMADO** | `leoEvidenceService.js:46-47, 287, 301`; 0 coincidencias de TTL |
| 9 | Aviso de IA limitado al nodo LEO | **CONFIRMADO** | `Experiencias.tsx:304`; Chatbot/LeoCompanion sin aviso |
| 10 | Endpoint de mediador de Leo sin scope | **CONFIRMADO** | `server.js:7859-7862, 7901` solo `requireAuth`; comentario D7 reconoce el middleware pendiente |
| 11 | Generador de `.release-marker` reintroduce correo | **CONFIRMADO** | `scripts/deploy-smoke-release.sh:148, 166` |

## 8. Brechas P0 / P1 / P2 / HUMAN

| ID | Prioridad | Brecha | Evidencia | Local / prod | Riesgo | Corrección mínima | Dep. M1 | Unidad sugerida |
|---|---|---|---|---|---|---|---|---|
| COMP-01 | **P1** | Fallback de acceso `open` en producción con grupos sin `availableContentIds` | §7.3; `ESTAS_AQUI_04F_GENERAL_RELEASE.md:300` | local `restricted` / prod `open` | contenidos concedidos por `LEGACY_OPEN` sin regla | fijar `restricted` en el override productivo tras poblar reglas | no (pero coordinar con FilBo) | `CHP-ACCESS-FALLBACK-RESTRICTED-01A` |
| COMP-02 | **P1** | `POST /api/events` escribe el payload del evento en el log | `server.js:10004` | ambos | copia de datos seudonimizados fuera del store con retención no versionada | registrar solo `event`, `userId`, tamaño | no | `CHP-LOG-MINIMIZATION-01A` |
| COMP-03 | **P1** | Endpoints de mediador de Leo sin rol ni scope | `server.js:7859-7901` | ambos (activación UNKNOWN) | cualquier sesión activa lee señales de cualquier lector | aplicar `evaluateScopeAccess('user', userId)` | no | `CHP-LEO-MEDIATOR-SCOPE-01A` |
| COMP-04 | **P1** | Sin aviso de IA ni reporte en Chatbot y LeoCompanion | §6.9, §6.11 | ambos | menores conversan con IA sin identificación explícita fuera de MOOK | reutilizar el texto del nodo LEO + enlace de reporte | no | `CHP-LEO-AI-DISCLOSURE-01A` |
| COMP-05 | **P1 + HUMAN** | Sin aviso de privacidad, consentimiento ni texto para menores en la UI | §6.15 | ambos | tratamiento de datos de menores sin información visible | decisión de texto y ubicación (Bienvenida/Auth/Perfil) por dirección | no | `CHP-PRIVACY-NOTICE-01A` |
| COMP-06 | **P1** | Previews verbatim de alumnos y respuestas en `leo_evidence_db.json` sin TTL | §4 | ambos | fragmentos de texto libre de menores persistidos indefinidamente y respaldados | decidir supresión de previews o caducidad; hoy `NEEDS_LEGAL_REVIEW` | no | `CHP-LEO-EVIDENCE-MINIMIZATION-01A` |
| COMP-07 | **HUMAN** | Retención no ejecutada en ninguna capa; borrado no autorizado | `RETENTION_POLICY_01.md:179-192` | prod indefinida | crecimiento sin límite; sin vía de supresión | las 5 decisiones de `PRIVACY_RETENTION_01.md:224-240` | sí (activaciones) | `CHP-RETENTION-ACTIVATION-DECISION-01A` |
| COMP-08 | **P2** | `DELETE /api/users/:id` no cascada; `delete_user` audita el correo | `server.js:4515-4549` | ambos | eliminación incompleta ante solicitud | definir cascada o tombstone; auditar por id | sí (identidad) | posterior a COMP-07 |
| COMP-09 | **P2** | Sombra V1 espeja contraseña y correos | `identityShadow.js:57-72` | prod `IDENTITY_READ=json` | duplicado de credenciales | retirar V1 tras M1 | sí | M1 |
| COMP-10 | **P2** | `reviewDetailView` devuelve `review.reviewerId` | `experienceStore.js:607-621` | ambos | exposición del id del revisor al panel admin | proyectar sin `reviewerId` | no | Review |
| COMP-11 | **P2** | Rotación de logs no versionada (30 d aprobados) | `deployment_guide.md:1199` | prod | retención de logs indefinida/desconocida | `logging:` json-file en compose productivo | no | ops |
| COMP-12 | **P2** | Cliente Gemini en bundle y caché `localStorage` | `geminiService.ts:35, 53` | prod sin clave | riesgo latente de clave en bundle | eliminar cliente y mover a `/api/*` (recomendación previa) | no | `CHP-AI-BACKEND-ONLY-01A` |
| COMP-13 | **P2** | Token `[AWARD_POINTS]` otorga puntos desde la salida del modelo | `leoOrchestrator.js:804-808` | ambos | decisión automatizada menor (gamificación) | decidir si se mantiene; documentar | no | HUMAN editorial |
| COMP-14 | **P2** | Sin lockout de cuenta en login; Helmet sin CSP | `server.js:321-327, 244-247` | ambos | fuerza bruta acotada solo por IP/15 min | evaluar lockout progresivo y CSP | no | seguridad |
| COMP-15 | **P2** | `.release-marker` reintroducirá un correo | `deploy-smoke-release.sh:148` | local | PII tracked de nuevo | actor por rol o `git config user.name` | no | ops |
| COMP-16 | **P2** | Documentación de despliegue obsoleta (bind mount de `server/`, `USERS_DB` ro/rw) | `deployment_guide.md:151, 244`; `README_DEPLOY.md:77-80` | — | decisiones erróneas en incidentes | corregir docs | no | ops |

Sin P0: no se demostró exposición activa ni decisión automatizada con perjuicio inmediato dentro del alcance.

## 9. Decisiones humanas pendientes

1. Texto y ubicación del aviso de privacidad y de la información para menores y mediadores (COMP-05).
2. Las cinco decisiones de retención y borrado ya listadas en `docs/ops/CHP_MOOK_EVENTS_EVIDENCE_PRIVACY_RETENTION_01.md:224-240` (eventos, evidencias, snapshots, backups 7/4/6, logs), incluida la vía de supresión de evidencias de menores (COMP-07, COMP-08).
3. Revisión jurídica pendiente de los stores `leo_*` (`stores.py:94-116`) y de las previews verbatim (COMP-06).
4. Mantener o retirar la recompensa automática de puntos generada por el modelo (COMP-13).
5. Momento de fijar `ACCESS_FALLBACK_MODE=restricted` en producción en coordinación con las memberships de FilBo (COMP-01).

## 10. Estado resultante

`M5: AMBER-EVIDENCE-AUDITED-REMEDIATION-PENDING`. Controles de identidad, sesión, aislamiento, acceso pedagógico, minimización de eventos y separación Leo/evaluación están demostrados en código y tests; la producción corre en compat con fallback abierto, retención indefinida, sin avisos de privacidad ni de IA fuera de MOOK, y con endpoints de mediador de Leo sin alcance. Evidencia de tests reutilizada de la ejecución en `631df93` (22 suites en verde: sesión, eventos, CIS, organización, Aula Viva, pedagogía, Review, materializador, Leo, compat de modelos, breaker, WCAG estructurales, `test:mook`, `lint:evidence`, `git diff --check`), válida porque `git diff --name-only 631df93..46657dc` no toca ningún archivo de `server/`, `scripts/`, `components/`, `pages/`, `services/`, `hooks/`, `utils/`, `.github/` ni `package.json` salvo `server/.release-marker` (texto plano sin consumidor de runtime). Al cierre de esta unidad se reejecutaron `npm run lint:evidence` y `git diff --check`.
