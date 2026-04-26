# Chibalete+ — Deployment Package

Versión empaquetada lista para construir imágenes Docker y desplegar en VPS Linux.

**Build:** 2026-04-17-1831  
**Fix incluido:** Auth.tsx — login ya no bloquea por rol (control de acceso delegado a ProtectedRoute)

---

## Contenido del package

```
deployment_package/
├── Dockerfile.front        Build del SPA (Vite → nginx)
├── Dockerfile.api          Build del backend Express (Node 20 Alpine)
├── docker-compose.prod.yml Orquestación completa (ambos servicios)
├── nginx.prod.conf         Config nginx para el contenedor front
├── .env.example            Template de variables de entorno
│
├── package.json            Dependencias del proyecto
├── package-lock.json       Lockfile exacto
├── vite.config.ts          Config del bundler frontend
├── tsconfig.json           Config TypeScript
├── index.html              Entry point HTML
├── index.tsx / App.tsx     Entry points React
│
├── pages/                  Páginas del SPA
├── components/             Componentes React
├── context/                Contextos React (Auth, Offline)
├── hooks/                  Custom hooks
├── services/               Servicios frontend (data, gemini, analytics)
├── types/                  Tipos TypeScript
├── utils/                  Utilidades compartidas
├── config/                 Config frontend (routePermissions)
├── engines/                Motores frontend (rewards, trance, metrics)
├── public/                 Assets estáticos (logos, iconos) — SIN uploads/
│
└── server/                 Backend Express completo
    ├── server.js           Entry point: node server/server.js
    ├── config.js           Rutas canónicas (UPLOADS_ROOT, USERS_DB)
    ├── leo*.js             Subsistema Leo (IA pedagógica)
    ├── accessService.js    Control de acceso por scope
    ├── ttsService.js       Pipeline Text-to-Speech
    └── ttsQueue.js
```

**NO incluido en el tar:**
- `node_modules/` — se instala durante `docker build`
- `data/` — vive en `data-volume` Docker o en la VPS. El Dockerfile.api genera seeds vacíos.
- `public/uploads/` — vive en `uploads-volume` Docker persistente
- `.env` — secretos reales nunca van en el package

---

## Decisiones arquitectónicas

### nginx.prod.conf — contexto de uso

Este archivo configura nginx **dentro del contenedor `front`**, no el nginx del host VPS.

- **Para build/test del package**: usa `docker-compose.prod.yml` incluido. `api:3000` resuelve por la red interna Docker.
- **Para la VPS productiva** (`/opt/chibaleteplus`): el compose limpio de producción ya tiene su propia configuración. Este package se usa para **construir las imágenes** que después se conectan al compose de la VPS.
- El upstream `http://api:3000` funciona correctamente cuando ambos contenedores están en la misma red Docker. En la VPS, el compose de `/opt/chibaleteplus` ya gestiona esto.

### Entry point del API

```
node server/server.js
```

No `server/index.js`. El `CMD` del Dockerfile.api ya lo especifica correctamente.

### Users DB en producción

`USERS_DB` apunta a un archivo externo al contenedor:
```
USERS_DB=/data-critical/usuarios_colegios_oro.json
```
En la VPS: `/var/www/chibalete/data-critical/usuarios_colegios_oro.json`  
Montado como bind read-only en el contenedor API.

**El tar no incluye este archivo. Vive únicamente en la VPS.**

### Uploads en producción

`UPLOADS_ROOT=/app/public/uploads`  
Montado como volumen Docker persistente (`uploads-volume`).  
Los PDFs, audio y assets nunca se rebuildan — persisten en el volumen.

---

## Variables de entorno requeridas

```bash
cp .env.example .env
# Editar con valores reales antes del build
```

| Variable | Descripción |
|---|---|
| `GEMINI_API_KEY` | Clave Google Gemini (IA Leo) |
| `OPENAI_API_KEY` | Clave OpenAI (TTS pipeline) |
| `ADMIN_SECRET` | Secret para rutas admin (`x-admin-secret` header) |
| `ACCESS_FALLBACK_MODE` | `restricted` (recomendado en prod) o `open` |

---

## Pipeline completo — VPS (/opt/chibaleteplus)

### 1. Subir el tar a la VPS

```bash
# Desde máquina local
scp chibaleteplus.release.2026-04-17-1831.tar.gz usuario@tu-vps:/opt/chibaleteplus/releases/
```

### 2. Extraer en la VPS

```bash
ssh usuario@tu-vps

cd /opt/chibaleteplus/releases
mkdir -p chibalete-2026-04-17
tar -xzf chibaleteplus.release.2026-04-17-1831.tar.gz -C chibalete-2026-04-17/

# Verificar que llegó limpio
ls chibalete-2026-04-17/
# Debe mostrar: Dockerfile.front Dockerfile.api docker-compose.prod.yml nginx.prod.conf pages/ server/ etc.
# NO debe mostrar: data/ public/uploads/ node_modules/
```

### 3. Construir imágenes Docker

```bash
cd /opt/chibaleteplus/releases/chibalete-2026-04-17

# Asegurar que .env tiene los secretos reales
cp /opt/chibaleteplus/.env .env

# Build de ambas imágenes
docker build -t chibalete/front:2026-04-17 -f Dockerfile.front .
docker build -t chibalete/api:2026-04-17  -f Dockerfile.api .

# Opcional: también tagear como latest
docker tag chibalete/front:2026-04-17 chibalete/front:latest
docker tag chibalete/api:2026-04-17  chibalete/api:latest
```

### 4. Conectar imágenes al compose de /opt/chibaleteplus

En el `docker-compose.yml` (o `docker-compose.prod.yml`) de `/opt/chibaleteplus`,
cambiar las referencias de `build:` por `image:`:

```yaml
services:
  front:
    image: chibalete/front:2026-04-17   # ← usar imagen construida
    # build: ...                         # comentar o eliminar el bloque build

  api:
    image: chibalete/api:2026-04-17     # ← usar imagen construida
    # build: ...
```

O mantener `build:` apuntando al directorio del release extraído:

```yaml
services:
  front:
    build:
      context: /opt/chibaleteplus/releases/chibalete-2026-04-17
      dockerfile: Dockerfile.front

  api:
    build:
      context: /opt/chibaleteplus/releases/chibalete-2026-04-17
      dockerfile: Dockerfile.api
```

### 5. Correr el deploy

```bash
cd /opt/chibaleteplus

# Si tienes deploy.sh
bash deploy.sh

# O directamente
docker compose pull   # si usas registry externo
docker compose up -d --build

# Verificar que levantó
docker compose ps
docker logs chibalete_api_1 --tail=50
docker logs chibalete_front --tail=20
```

### 6. Validar

```bash
# Health check API
curl -s http://localhost:3000/api/health || curl -s http://localhost/api/health

# Verificar que el login no bloquea por rol
# (el fix de Auth.tsx está incluido — ya no aparece el error de "permisos de rol")

# Revisar logs de login
docker logs chibalete_api_1 --tail=100 | grep -i "login\|auth\|error"

# Verificar acceso a uploads
curl -I http://localhost/uploads/

# Verificar que usuarios se cargan desde data-critical
docker exec chibalete_api_1 ls /app/data-critical/
# Debe mostrar: usuarios_colegios_oro.json
```

### 7. Rollback si falla

```bash
cd /opt/chibaleteplus

# Opción A — revertir a imagen anterior (si usas tags)
# Editar docker-compose para apuntar al tag anterior, ej: chibalete/api:2026-04-15
docker compose up -d

# Opción B — rebuild desde el release anterior
cd /opt/chibaleteplus/releases/chibalete-2026-04-15   # carpeta del release previo
docker build -t chibalete/api:rollback -f Dockerfile.api .
docker build -t chibalete/front:rollback -f Dockerfile.front .
# Actualizar compose para usar :rollback y levantar

# Verificar que el rollback respondió
docker logs chibalete_api_1 --tail=30
curl -s http://localhost/api/health
```

---

## Construcción de imágenes (standalone)

```bash
# Desde la carpeta extraída del tar
docker build -t chibalete/front:latest -f Dockerfile.front .
docker build -t chibalete/api:latest   -f Dockerfile.api .
```

---

## Test local del package completo

```bash
# Desde la carpeta extraída del tar
cp .env.example .env && nano .env   # completar secrets

# Si no existe el directorio de usuarios en el host local:
sudo mkdir -p /var/www/chibalete/data-critical
sudo cp /ruta/a/usuarios_colegios_oro.json /var/www/chibalete/data-critical/

docker compose -f docker-compose.prod.yml up -d --build
# Acceder a http://localhost
```

---

## Carpetas críticas (fuentes de verdad)

| Recurso | Ubicación en VPS | Incluido en tar |
|---|---|---|
| Usuarios | `/var/www/chibalete/data-critical/usuarios_colegios_oro.json` | NO |
| Uploads/libros | `/var/www/chibalete/public/uploads/` (o `uploads-volume`) | NO |
| DBs runtime | `data-volume` Docker | NO (seeds vacíos en imagen) |
| Código fuente | tar → imagen Docker | SÍ |

---

## Puertos

| Servicio | Puerto externo | Puerto interno |
|---|---|---|
| front (nginx) | 80 | 80 |
| api (Express) | — (solo interno) | 3000 |
