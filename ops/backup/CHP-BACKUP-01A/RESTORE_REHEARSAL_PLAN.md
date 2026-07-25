# CHP-BACKUP-01A — Plan de Restauración Aislada (para CHP-BACKUP-01C)

> **Plan, no ejecución.** El ensayo NO se ejecuta en 01A. Nunca monta rutas/volúmenes/bases productivas en escritura.

## 1. Principios del ensayo

- Entorno **aislado**: contenedor/host/directorio efímero, **sin red pública**, sin exponer la copia restaurada a internet.
- **Cero escritura** sobre `/var/www/chibalete/**` ni sobre ninguna base productiva. Solo lectura del origen de backup.
- Restaurar **una fecha concreta** (un snapshot identificado por ID) a un árbol temporal aislado.
- Validar y **destruir** el entorno de prueba de forma controlada; conservar solo evidencia **no sensible** (hashes, conteos, tiempos, resultados de integridad).

## 2. Entorno propuesto

- Runner Linux aislado (p. ej. contenedor efímero `--rm --network none --read-only` con `tmpfs` de trabajo), análogo al usado en las unidades file-only.
- Restic/borg apuntando al **repositorio off-site** en modo lectura; passphrase provista por el operador solo durante el ensayo, nunca persistida.
- Directorio de restauración: `tmpfs` o volumen efímero dedicado; **jamás** un bind-mount productivo.

## 3. Orden de recuperación

1. **Estructura de directorios y permisos** — recrear el árbol `data/`, `data-critical/`, `public/uploads/` con owner/modo esperados (root:root; dirs 0755; SQLite/JSON 0644; el futuro `admin_secret` 0400 — pero **secretos NO forman parte de este ensayo de datos**).
2. **Identidad y acceso** — `usuarios_colegios_oro.json` (USERS_DB) + (futuro) `identity.db`.
3. **Memberships/grupos** — `groups_db.json`, `access_db.json`, `schools_db.json`, `sections.json`, `school_configs.json`.
4. **Contenido y uploads** — `content.json`/`content_db.json` + árbol `public/uploads/` (reconciliar contra manifiesto).
5. **Eventos/progreso** — `events.db`, `progress.db`, `offline_assignments.db` (+ `user_audit_log.json`, `leo_*`).
6. **Proyecciones reconstruibles** — `insights.db`, `analytics_db.json` (restaurar o regenerar).
7. **Validaciones** (§4).
8. **Habilitación de servicios** — **solo en un recovery real futuro**, nunca en el ensayo.

## 4. Validaciones obligatorias

| Validación | Método |
|---|---|
| Hashes | sha256 de cada archivo restaurado == `manifest.json` del snapshot |
| Integridad SQLite | apertura `readonly:true` + `PRAGMA quick_check`/`integrity_check` == ok en cada base |
| JSON | `JSON.parse` de cada store == OK (sin imprimir contenido) |
| Conteos agregados | filas/entidades restauradas == conteos del manifiesto (events, progress, users, groups, uploads…) |
| Uploads | nº de archivos y volumen == manifiesto; 0 referencias rotas (por conteo) |
| Tiempo real | medir **RTO efectivo** del restore granular (objetivo ≤ 2 h, a confirmar) |
| Aislamiento | verificar ausencia de escucha en interfaces públicas; sin bind-mount productivo |

## 5. Criterios de éxito (GREEN de 01C)

- Snapshot concreto restaurado en entorno aislado.
- Todas las validaciones §4 en verde para los stores **CANON no reconstruibles** (identidad, memberships, eventos, progreso, uploads, Leo, audit).
- RTO efectivo medido y registrado.
- Entorno de prueba destruido; solo evidencia no sensible conservada.
- **Sin** exposición a internet, **sin** escritura productiva, **sin** secretos ni PII en la evidencia.

## 6. Ensayo complementario — snapshot Hostinger (Capa A)

Para clasificar la **restaurabilidad de aplicación** del backup de infra:
- Restaurar el punto Hostinger (p. ej. 2026-07-24) a una **VPS/instancia aislada de prueba** (no la productiva).
- Ejecutar §4 sobre las SQLite del disco restaurado → determinar si son **app-consistent** (quick_check ok) o presentan corrupción por captura de WAL en vuelo.
- Registrar RTO real (~2 h 21 m declarado) y si la restauración es **independiente de la cuenta** Hostinger.
- **NOT TESTED hasta ejecutar 01C.** Este punto es el que convierte la clasificación actual («restaurabilidad de aplicación no demostrada») en demostrada o refutada.

## 7. Qué NO hacer en el ensayo

- No restaurar sobre producción.
- No montar `/var/www/chibalete/**` ni volúmenes productivos en escritura.
- No exponer la copia a internet.
- No incluir secretos/PII en la evidencia.
- No provisionar `/app/secrets/admin_secret` ni desplegar código.
