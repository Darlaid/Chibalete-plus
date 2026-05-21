# RUNBOOK P0 — "STOP THE BLEED"

**Origen:** Auditoría estructural 2026-05 (`docs/AUDITORIA-ESTRUCTURAL-2026-05.md`).
**Naturaleza:** acciones que tocan **producción, autenticación y git history compartido**. Por regla CLAUDE.md ("No tocar autenticación sin indicación") y por ser operaciones irreversibles/coordinadas, **las ejecuta una persona**, no el agente. Este documento es la guía paso a paso.

> Estado del ítem P0.1 (GET-bypass): ✅ **YA RESUELTO en código** en este branch (`server/server.js`, bloque de auth). Pendiente: desplegarlo. El resto de ítems requieren acción manual en el VPS / git.

---

## P0.1 — GET-bypass de auth → ✅ HECHO (solo falta deploy)

**Cambio aplicado:** se eliminó `if (req.method === 'GET') return next()` en `requireAdminAccess`, `requireAuth`, `requireAdminRole`. Ahora todo GET exige admin-secret **o** sesión `x-user-id` activa. No exige rol admin en GET (preserva el modelo sano y `GET /api/content/:id/access`).

**Verificación local hecha:** `node --check` OK · 3 bypasses cerrados · `npm run test:memberships` verde.

**Deploy:** flujo backend canónico (swap bind-mount + restart escalonado). Tras desplegar, smoke obligatorio:
```bash
# Debe devolver 401 (antes devolvía 200 con PII):
curl -s -o /dev/null -w "%{http_code}\n" https://<dominio>/api/users
# Debe devolver 200 (frontend autenticado no se rompe):
curl -s -o /dev/null -w "%{http_code}\n" -H "x-user-id: <id_admin_real>" https://<dominio>/api/users
# Preflight de acceso (todo visor) debe seguir vivo con sesión:
curl -s -o /dev/null -w "%{http_code}\n" -H "x-user-id: <id_lector_real>" "https://<dominio>/api/content/<id>/access?userId=<id_lector_real>"
```
**Residual conocido (NO cerrado por este fix):** IDOR entre usuarios autenticados (un `lector` puede leer GETs de otros). Endurecimiento de rol = sprint P-follow-up. Documentado para no inducir falsa sensación de cierre total.

---

## P0.2 — Rotar credenciales expuestas en git history (CRÍTICO)

**Por qué:** `git show f7f0c5c:data/users_db.json` y commits `2a2da85`/`967a4be`/`e75100d` contienen contraseñas en texto plano (`admin123` rol administrador con Gmail real, `Mediador101`, `M4r140rt1z`, `lector123`, `password123`). Presentes en `main` y **todas** las ramas. Cualquiera con acceso de lectura al repo (clones, forks, CI logs) las tiene.

**Orden de ejecución (rotar ANTES de purgar history — si purgas primero, las cuentas siguen comprometidas mientras tanto):**

1. **Inventariar las cuentas afectadas en producción.** En el VPS:
   ```bash
   ssh root@72.60.158.97
   # NO imprimir hashes/PII a stdout compartido. Trabajar en el host.
   node -e "const u=require('/var/www/chibalete/data-critical/usuarios_colegios_oro.json'); \
     console.log(u.filter(x=>['monicauribe22@gmail.com','mediador@chibaleteeditores.com','mariaortiz@chibalete.com'].includes(x.email)).map(x=>({email:x.email,roles:x.roles||x.rol})))"
   ```
2. **Forzar reset de contraseña** de cada cuenta listada en history (mínimo: la admin `monicauribe22@gmail.com`, el mediador, las demo `admin@demo.com`/`lector@demo.com` si existen en prod). Vía el flujo de reset existente o, si no hay email, seteando un hash bcrypt nuevo directamente en el archivo de producción **dentro de una ventana de mantenimiento** (recordar: 2 procesos comparten el archivo — coordinar con el lock; o hacerlo con la app detenida).
3. **Invalidar sesiones activas** de esas cuentas (si hay tokens persistidos).
4. **Confirmar** que ninguna de esas contraseñas se reusa en otras cuentas reales del colegio.

**Criterio de cierre:** login con `admin123` / `Mediador101` / `M4r140rt1z` / `lector123` → rechazado en producción.

---

## P0.3 — Purgar git history (tras P0.2)

> ⚠️ Reescribe history y exige `--force` a TODAS las ramas. Coordinar con todos los que tengan clones (deben re-clonar; un `git pull` sobre history reescrito corrompe su copia). Hacer backup del repo antes.

```bash
# 1. Backup espejo del repo (recuperable si algo sale mal)
git clone --mirror <repo-url> chibalete-backup-prepurge.git

# 2. Instalar git-filter-repo (MIT) — NO usar filter-branch (lento/peligroso)
pip install git-filter-repo   # o brew install git-filter-repo

# 3. Purgar el archivo de todo el history (todas las ramas y tags)
git filter-repo --path data/users_db.json --invert-paths --force
#   (si hay otros JSON con secretos en history, añadir más --path)

# 4. Re-añadir el remote (filter-repo lo elimina por seguridad) y forzar
git remote add origin <repo-url>
git push origin --force --all
git push origin --force --tags

# 5. Invalidar caches/forks: GitHub no purga forks ni PR refs automáticamente.
#    Abrir ticket de soporte del proveedor para garbage-collection si aplica.
```
**Después:** todos los colaboradores re-clonan. `git log --all -S "admin123"` → debe ser vacío. Añadir `gitleaks` (MIT) como pre-commit + gate de CI (ver P0.6) para que no reincida.

---

## P0.4 — protobufjs RCE (CRÍTICO, vía firebase)

```bash
npm why protobufjs            # confirmar cadena firebase@12.10 → @grpc/proto-loader
# Opción A (preferida): bump firebase a versión con protobufjs >=7.5.6
npm install firebase@latest
# Opción B (si A rompe): override en package.json
#   "overrides": { "protobufjs": ">=7.5.6" }
npm install
npm audit --audit-level=critical    # objetivo: 0 críticas
```
**Nota de deploy:** cambia `package.json` ⇒ requiere **rebuild de imagen api** (flujo NO cubierto por `deploy-backend.sh` — ver `deployment_guide.md:117`). Planificar como deploy de imagen, no swap de bind-mount.

---

## P0.5 — IA fuera del bundle frontend

`geminiService.ts:35,43` instancia `GoogleGenAI` con `import.meta.env.VITE_GEMINI_API_KEY` (Vite la inlinea en el JS público). Ya existe el patrón correcto: proxies backend `/api/gemini/*` y `/api/leo/*` con la key en `process.env`.
- Mover las ~15 llamadas `ai.models.generateContent()` de `geminiService.ts` a endpoints backend (extender los proxies existentes).
- Eliminar el cliente `GoogleGenAI` del frontend y la var `VITE_GEMINI_API_KEY` del build env.
- Añadir rate-limit dedicado por `x-user-id` a `/api/leo/ask|chat|recap` (hoy solo el limiter global) — análogo a `ttsUserLimiter`.
- **Rotar la key Gemini** (ya estuvo en bundles desplegados).

---

## P0.6 — Backup offsite cifrado (antes de cualquier cambio estructural)

Hoy: backups solo on-host (`/root/backups/...`), sin cifrar, `rm -rf` a 7d. Fallo de disco/ransomware = datos + backups perdidos juntos.
- Añadir **restic** (BSD-2) o **borgbackup** (BSD) → object-storage externo, cifrado, dedup.
- Programar antes de `backup-vps.sh` borrar la retención.
- **Probar un restore real** (un backup no verificado no es un backup).
- Añadir CI gate (GitHub Actions ya en uso para a11y): **Trivy** (deps+imagen) + **gitleaks** (secretos) + `npm audit --audit-level=high` bloqueante.

---

## Orden recomendado
`P0.1 deploy` → `P0.6 backup offsite` → `P0.2 rotar creds` → `P0.3 purgar history` → `P0.4 protobufjs` → `P0.5 IA backend`.
(Backup offsite primero porque P0.2/P0.3/P0.4 tocan datos/history irreversiblemente.)
