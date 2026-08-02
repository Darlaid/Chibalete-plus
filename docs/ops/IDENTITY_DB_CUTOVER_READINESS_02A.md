# Preparación para el cutover — CHP-IDDB-02A

## 1. Estado

| | |
|---|---|
| `identity.db` productiva | **NO creada** |
| Candidate | root-only, modo 0600, fuera del repositorio y de todo mount productivo |
| Esquema | v2 |
| Importación | completada e idempotente |
| `IDENTITY_SQLITE_ENABLED` / `IDENTITY_DUAL_WRITE` / `IDENTITY_READ` | sin cambios, apagados |
| Producción | intacta; `api_1` y `api_2` no participaron |

## 2. Lo que esta unidad deja resuelto

- Migración v2 versionada, transaccional, reversible y fail-closed ante una
  instalación v1 con datos.
- Importador determinístico y atómico, con destino, fuente, plan y `run_id`
  verificados antes de escribir.
- Candidate con los conteos exactos y las exclusiones reconciliadas contra las
  disposiciones congeladas.
- Compatibilidad de lectura comprobada contra la candidate, sin tocar ninguna
  ruta productiva.

## 3. Lo que NO resuelve, y hay que decidir antes de leer desde SQLite

1. **Credenciales.** La candidate no almacena contraseñas: es un artefacto de
   verificación, no una base de autenticación. Servir `users` desde SQLite para
   la ruta de login exige una decisión explícita sobre dónde viven las
   credenciales. Hasta entonces, el padrón JSON sigue siendo la fuente de la
   autenticación.
2. **Dual-write.** El espejo de P1-A está escrito contra el esquema v1 y ahora
   se **niega** ante v2 en vez de intentarlo, dejándolo auditado. El
   dual-write v2 es trabajo de la unidad siguiente.
3. **Identidades perdidas.** 01D dejó 3 identidades con actividad ausentes del
   padrón sin baja registrada. La migración no las recrea —la actividad no crea
   identidad— y su reprovisión es una decisión de la organización.
4. **Grupos legacy.** Los 15 grupos pendientes de retiro y sus 26 membresías
   siguen físicamente en producción; su purga es `CHP-IDDB-PURGE-GROUPS-01`.

## 4. Rollback

Nada que revertir en producción: no se creó ninguna base, no se cambió ninguna
variable y no se desplegó. En el plano del código, `0002_identity_v2` tiene
sección `DOWN` completa y el runner puede revertirla. La candidate se puede
borrar sin consecuencias: es reproducible desde el manifiesto.

## 5. Etapa siguiente

`CHP-IDDB-02B` — imagen inmutable, importación productiva y shadow-write en una
sola API. Entra con el esquema fijado, el importador probado y una candidate
verificable contra la que comparar.
