# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## REGLAS DE INGENIERÍA — CHIBALETE+

### PRINCIPIOS
- No romper funcionalidades existentes
- Cambios mínimos y localizados
- No refactorizar sin instrucción explícita
- Mantener consistencia con el código actual
- Explicar siempre qué archivos se modifican
- Priorizar estabilidad sobre optimización

### RESTRICCIONES CRÍTICAS
- No tocar autenticación sin indicación
- No modificar modelos globales sin justificar
- No introducir nuevas dependencias innecesarias

### MODO DE TRABAJO
- Intervenciones quirúrgicas
- Cambios progresivos
- Validación constante

### RESTRICCIONES ARQUITECTÓNICAS CRÍTICAS

Claude **NO debe:**
- Crear una entidad separada para clubes
- Duplicar lógica de cursos y clubes
- Reescribir el sistema de autenticación
- Romper endpoints existentes
- Eliminar lógica legacy sin reemplazo completo
- Introducir nuevas dependencias sin necesidad clara
- Refactorizar masivamente el código
- Cambiar estructura de base de datos sin justificación explícita

Claude **DEBE:**
- Hacer cambios mínimos y localizados
- Explicar qué archivos modifica
- Mantener compatibilidad hacia atrás
- Priorizar estabilidad sobre elegancia

---

## ARQUITECTURA FUNCIONAL — CHIBALETE+

### PRINCIPIO CENTRAL

Chibalete+ se modela como una plataforma de organizaciones de lectura.

Una organización puede ser:
- `school` (colegio)
- `independent_club_org` (club externo, futuro)

Dentro de cada organización existen grupos de lectura.

### MODELO DE GRUPOS

Los grupos son la unidad operativa principal del sistema.

Tipos de grupo:
- `course` → curso escolar (Primero A, Segundo B)
- `club` → club de lectura (Ej: Club Edgar Allan Poe)

**IMPORTANTE:** No crear modelos separados para cursos y clubes. Ambos usan la misma entidad `group`.

### USUARIOS

Roles base: `administrador`, `mediador`, `lector`

Especialización del mediador: `teacher`, `librarian`, `coordinator`

Un usuario puede pertenecer a múltiples grupos. (Futuro: múltiples organizaciones.)

### RELACIONES CLAVE

- Todo grupo pertenece a una organización (actualmente `school`)
- Un mediador puede gestionar múltiples grupos
- Un grupo puede tener múltiples mediadores
- Un usuario puede pertenecer a múltiples grupos

### ACCESO AL CONTENIDO

El acceso se resuelve por capas en orden:

1. `user` — regla explícita por usuario
2. `group` ← **PRINCIPAL** — membresía en curso o club
3. `organization` — configuración de school
4. fallback legacy (temporal, mientras no haya reglas estrictas)

**El backend es la única fuente de verdad. Nunca delegar lógica de control de acceso al frontend.**

### TIPOS DE ACCESO

- Por grupo (`course` o `club`)
- Por organización (`school config`)
- Temporal (`accessStartsAt` / `accessEndsAt`)
- Por contenido individual o colección (`titleIds` / `collectionIds`)

### BUNDLES (PRÓXIMO — NO IMPLEMENTAR AÚN)

Se introducirán bundles como colecciones reutilizables de contenido para facilitar creación de clubes, simplificar activación comercial y mejorar UX pedagógica. No implementar sin instrucción explícita.

---

## PRIORIDADES DE DESARROLLO (ORDEN ESTRICTO)

1. **MODELO DE GRUPOS** — Consolidar `groups` como unidad central. Soportar `course` y `club`. Múltiples mediadores por grupo, múltiples grupos por mediador, membresía flexible. No crear entidades separadas para clubes.

2. **MODELO ESCOLAR** — Fortalecer relación `school → groups → users`. Soportar `gradeLevel` y secciones (A, B, etc.). Mantener compatibilidad con el modelo actual de `school`.

3. **ACCESO POR GRUPO** — Asegurar que el acceso funcione correctamente por `groupId`. Integrar con el access engine existente. Soportar acceso temporal. No eliminar fallback legacy aún.

4. **CLUBES DENTRO DEL COLEGIO** — Permitir crear grupos tipo `club` con miembros de distintos cursos y contenidos específicos. El acceso debe funcionar solo para ese grupo.

5. **UX BÁSICA DE GRUPOS** — Mostrar grupos del usuario, clubes activos y lecturas asignadas por grupo.

6. **BUNDLES** — No implementar sin instrucción explícita.

7. **CLUBES EXTERNOS** — No implementar aún. Depende de consolidar modelo de organización.

8. **LEO** — No modificar comportamiento central sin instrucción. Solo mejoras localizadas y seguras.

9. **AUTENTICACIÓN** — No tocar sin instrucción explícita.

---

## Project Overview

Chibalete+ is an AI-powered digital reading and learning platform for children, featuring accessibility modes, gamification, and a pedagogical AI assistant (Leo). It's a full-stack app: React 19 + TypeScript frontend built with Vite, and an Express 5 backend running on Node.js.

## Commands

```bash
# Frontend development
npm run dev          # Vite dev server (frontend only)
npm run build        # Production build → dist/
npm run preview      # Serve production build locally

# Backend
npm run server       # Start Express backend (server/server.js) on PORT 3000

# Production (VPS)
pm2 start ecosystem.config.cjs   # Start backend via PM2
pm2 restart chibalete            # Restart app
```

There are no configured lint or test commands.

### Environment Setup

Create `.env` in project root with:
```
GEMINI_API_KEY=...
OPENAI_API_KEY=...
ADMIN_SECRET=...       # Required for admin API routes (x-admin-secret header)
```

## Architecture

### Frontend (`/src` root — files are at project root, not `/src`)

**Entry:** `index.html` → `index.tsx` → `App.tsx`

`App.tsx` sets up React Router with lazy-loaded page components. All pages live in `/pages/`. Key contexts wrap the entire app:
- `AuthContext` — user auth state, login/logout
- `OfflineContext` — offline mode detection and cache

**Key services** (all in `/services/`):
- `dataService.ts` (94KB) — primary data layer: fetches content, syncs progress, manages local cache
- `geminiService.ts` (26KB) — Google Gemini AI integration for Leo and comprehension features
- `offlineService.ts` — offline cache management
- `persistenceService.ts` — localStorage abstraction

**Reading viewers** (the core user-facing feature):
- `VisorPDF` — PDF rendering via PDF.js (Mozilla CDN)
- `VisorTexto` — Text reader with TTS support
- `VisorInmersivo` — Accessible/immersive reading mode (OpenDyslexic font, high contrast)
- `VisorAlbum` — Guided picture book mode
- `VisorAudio`, `VisorVideo`

`ContentRouter` component dynamically selects the right viewer based on content type.

**Access control on the frontend:** `useAccessCheck` hook and `AccessWrapper` component call `/api/content/:id/access` before showing content. Never bypass this — the server is authoritative.

### Backend (`/server/server.js`)

Single-file Express app (~1,946 lines) with JSON flat-file databases in `/data/`:
- `users_db.json`, `content.json`, `groups_db.json`, `progress_db.json`
- `access_db.json` — scope-based access rules (E6 phase)
- `leo_memory_db.json` — Leo AI session memory

**Auth pattern:**
- Admin routes: require `x-admin-secret` header matching `ADMIN_SECRET` env var
- User routes: require `x-user-id` header
- Roles: `administrador`, `profesor`, `lector`

**Key subsystems:**

**Access Control Engine (Phases E6-E7)** — Scope hierarchy: `user` → `group` → `organization`. Rules stored in `access_db.json` with temporal windows (`accessStartsAt`, `accessEndsAt`). Server clock is authoritative (no client-clock trust). Endpoint: `/api/content/:id/access` for preflight checks, `/api/access` for rule CRUD.

**Leo Pedagogical AI** — Modular AI assistant in `/server/leo/`:
- `leoEngine.js` — orchestrator
- `leoGuard.js` — input validation/safety
- `leoPolicy.js` — pedagogical rules
- `leoContextBuilder.js` — builds prompts with reader profile
- `leoResponder.js` — formats responses
- `leoRetriever.js` — fetches relevant context
- Endpoints: `/api/leo/ask`, `/api/leo/memory`, `/api/leo/ingest`

**TTS Pipeline** — On text content upload, async TTS generation is queued:
- `ttsQueue.js` — job queue
- `ttsService.js` — audio generation
- Output: `/public/uploads/audio/:contentId/manifest.json`
- Status tracked in content record (`ttsStatus`, `processingStatus`)

**File Upload Validation (3 layers):**
1. Extension whitelist (regex)
2. MIME type detection via `file-type` library
3. Binary content inspection (null-byte check for TXT files)

**Aula Viva (Classroom):** Groups with type `course` or `club`, mediators (teachers) and members (students). `/api/groups` routes. Teachers can assign content collections to groups.

**Progress Tracking:** Heartbeat sync at `/api/progress/:userId/:contentId/sync`, completion at `/api/progress/:userId/:contentId/complete`. Progress records track sentence index, percentage, reading mode, and up to 20 session history entries.

### Deployment

- Reverse proxy: Nginx → `localhost:3000` (Express)
- Process manager: PM2 (`ecosystem.config.cjs`)
- Static assets: Vite build output served by Nginx
- See `deployment_guide.md` for full VPS (Hostinger) setup steps

## Key Conventions

- **ESM throughout** — `package.json` has `"type": "module"`; backend uses `.cjs` extension only for PM2 config
- **TypeScript path alias** — `@/*` maps to project root (not `/src`)
- **Tailwind via CDN** — no PostCSS/build step for CSS; Tailwind loaded from CDN in `index.html`
- **No ORM** — all database operations are direct JSON file reads/writes in `server.js`
- **Spanish UI** — all user-facing text, variable names for domain concepts, and route names are in Spanish (e.g., `Biblioteca`, `Bitacora`, `lector`, `profesor`)
