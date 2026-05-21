# Seed Admin Local — auditoría manual

> **PROPÓSITO:** garantizar que en entorno LOCAL/DEV exista un usuario
> administrador conocido para auditoría manual y QA, **sin tocar
> producción**, sin debilitar autenticación y sin duplicar usuarios.

## Credenciales

| Campo    | Valor                                |
|----------|--------------------------------------|
| Email    | `admin@chibaleteeditores.com`        |
| Password | `admin123`                           |
| Rol      | `administrador`                      |
| Scope    | acceso total (admin operativo)       |

⚠️ **USO LOCAL EXCLUSIVO.** Estas credenciales solo deben funcionar en
local. NO se aplican (ni deben aplicarse) en producción. El seed
**aborta automáticamente** si detecta `NODE_ENV=production` o si el path
de `users_db.json` apunta a `/var/www/chibalete/...`.

## Comandos

### Seed (correr el seed local)

```bash
npm run seed:admin-local
```

Equivalente:

```bash
node scripts/seed-local-admin.mjs
```

**Es idempotente.** Si el user ya existe con el password correcto, el
script reporta `Action: noop` y **no toca el archivo**. Es seguro correrlo
N veces.

### Arrancar local

```bash
# 1) Backend Express (puerto 3000 por default)
npm run server

# 2) Frontend Vite (otra terminal)
npm run dev
```

Luego abrir http://localhost:5173 (o el puerto que Vite indique) y
loguearse con las credenciales arriba.

### Validar login sin frontend (curl)

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@chibaleteeditores.com","password":"admin123"}'
```

Respuesta esperada:

```json
{
  "success": true,
  "user": {
    "id": "admin-super-1",
    "email": "admin@chibaleteeditores.com",
    "roles": ["administrador"],
    "accountStatus": "active",
    ...
  }
}
```

### Verificar acceso admin a endpoints protegidos

```bash
curl -H "x-user-id: admin-super-1" http://localhost:3000/api/users
# → lista de usuarios

curl -H "x-user-id: admin-super-1" http://localhost:3000/api/groups
# → lista de grupos
```

## Lo que el seed hace exactamente

1. **Verifica que NO sea producción.** Aborta si `NODE_ENV=production` o
   si el path apunta a `/var/www/chibalete/...`.
2. **Lee `data/users_db.json`** (path por default, overrideable con
   `USERS_DB=/otra/ruta`).
3. **Busca user con email `admin@chibaleteeditores.com`** (case-insensitive).
4. Si existe:
   - Si `bcrypt.compare('admin123', currentHash) === true` y `roles`
     ya incluye `administrador` y `accountStatus === 'active'` → **NO-OP**.
   - Si no, actualiza SOLO los campos necesarios:
     - `password` ← bcrypt hash nuevo de `admin123` (cost 10).
     - `roles` ← agrega `administrador` (sin remover otros roles).
     - `accountStatus` ← `'active'`.
   - **PRESERVA** todos los demás campos (id, colegio, groupIds,
     avatar_url, etc.).
5. Si no existe → crea con `id='local-admin-seed'`, colegio `'Chibalete'`,
   role `administrador`, accountStatus `active`.
6. **Backup automático** del archivo antes de modificar
   (`users_db.json.backup-<timestamp>`).
7. **Write atómico** (escribe a `.tmp` y rename).

## Garantías

| Garantía | Mecanismo |
|---|---|
| No corre en producción | Doble check: `NODE_ENV` + marcadores filesystem |
| No duplica users | Match por email case-insensitive |
| Idempotente | `bcrypt.compare` antes de re-hashear |
| Mismo hashing que el server | `bcryptjs` cost 10 (idéntico a `server/server.js`) |
| No debilita auth global | Solo configura UN user existente con credencial conocida |
| Preserva campos | Hace `{ ...existing, password, roles, accountStatus }` |
| Backup defensivo | Copia con timestamp antes de cada modificación |
| No imprime hash | Solo password en plain (el explicit el usuario ya lo conoce) |

## Revertir / eliminar

Si querés eliminar las credenciales locales conocidas:

```bash
# Opción A — Restaurar el último backup
cp data/users_db.json.backup-<timestamp> data/users_db.json
# (los backups se crean en el mismo directorio que users_db.json)

# Opción B — Restaurar desde git si no hay cambios significativos en ese archivo
git checkout HEAD -- data/users_db.json

# Opción C — Eliminar manualmente el user del JSON con jq
jq 'map(select(.email != "admin@chibaleteeditores.com"))' \
   data/users_db.json > data/users_db.json.tmp \
  && mv data/users_db.json.tmp data/users_db.json
```

Después de revertir, el login con `admin123` deja de funcionar.

## Tests

```bash
npm run test:seed-local-admin
```

40 asserts. Cubre:
- `NODE_ENV=production` aborta con exit 1.
- Path productivo (`/var/www/chibalete/...`) aborta.
- Create cuando no existe.
- Update password cuando hash actual no valida.
- NO-OP cuando hash actual ya valida (byte-a-byte sin cambios).
- Re-run idempotente.
- Preserva todos los campos custom en update.
- Roles array conserva mediador/lector, agrega administrador.
- `accountStatus` pasa a active si era disabled.
- Backup automático creado en cada modificación.

## Cómo el seed NO debilita la autenticación

- **El hashing es el mismo** que usa el server: `bcryptjs` cost 10. El
  formato del campo password queda exactamente igual a cualquier otro
  user (`$2b$10$...`).
- **No introduce bypass.** El login pasa por la misma comparación
  `bcrypt.compare` del endpoint `POST /api/auth/login`. Una password
  incorrecta sigue siendo rechazada con `{"error":"Credenciales
  inválidas"}` (verificado en este sprint).
- **No agrega un header secreto** ni una env var nueva. Solo configura
  un user existente con una credencial conocida.
- **No crea endpoints nuevos.** El seed es un script offline; manipula
  `users_db.json` directo. El server no sabe que existe.

## Advertencias de seguridad

1. **NUNCA correr este script en producción.** Aunque el seed tiene
   doble guarda, la responsabilidad operacional es no invocarlo desde
   el VPS. Esto NO está cableado a ningún job, container ni hook —
   solo se ejecuta a mano vía `npm run seed:admin-local`.
2. **El password "admin123" es PÚBLICO.** Cualquier persona con acceso
   al repo lo conoce. NO usar este patrón en ningún entorno expuesto
   a internet.
3. **El backup queda en disco.** Si lo subís a un VCS público, el hash
   bcrypt anterior queda visible. Considerá `git status` antes de hacer
   commit (los `*.backup-*` deberían estar en `.gitignore` si tu repo
   versiona `data/`).
4. **No reemplaza el flujo de invitación.** Para usuarios reales, sigue
   usando el flujo `/api/users` con `x-admin-secret` documentado en
   `scripts/loadtest/seed_users.js`.
5. **El user `admin-super-1` ya existía en `data/users_db.json` antes
   de este sprint.** El seed lo deja en el estado declarado (password
   `admin123`). Si tu copia local de `data/users_db.json` divergía de
   git, el seed actualizó la password — verificá con `git diff
   data/users_db.json` si quisiste preservar el hash anterior.
