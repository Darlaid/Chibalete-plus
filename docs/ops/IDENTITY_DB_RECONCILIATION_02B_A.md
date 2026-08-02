# Reconciliación JSON → SQLite — CHP-IDDB-02B-A

`scripts/identity/reconcileIdentityShadow.mjs` compara el padrón JSON —que es la
autoridad— contra el espejo, y opcionalmente converge el espejo. **El JSON nunca
se modifica**: la reconciliación es unidireccional.

## 1. Modos

| Modo | Efecto |
|---|---|
| `--check` | read-only. Diagnóstico y violaciones de contrato |
| `--plan` | read-only. Además, cuántas operaciones aplicaría |
| `--apply` | converge el espejo. Idempotente y con auditoría propia |

`--apply` exige ruta explícita de la base y manifiesto. Rechaza rutas
productivas, no lee `.env` ni backups, y no consulta `events.db`,
`progress.db` ni `insights.db` para crear identidad.

## 2. Estados

`MATCH` · `MISSING_IN_SQLITE` · `STALE_IN_SQLITE` · `UNEXPECTED_IN_SQLITE` ·
`CONTRACT_VIOLATION`

La comparación se hace por **proyecciones canónicas**, no por igualdad bruta:
usuarios, instituciones, grupos, membresías, aliases autorizados, exclusiones y
tombstones. Los campos que identity.db no almacena no producen diferencia.

`CONTRACT_VIOLATION` cubre lo que el espejo no debería contener jamás: una
identidad excluida presente, una membresía sin usuario, una membresía hacia un
tombstone o un tombstone que sea a la vez usuario. Los dos últimos son además
**imposibles por esquema** —hay triggers que los rechazan—, así que el detector
es una segunda barrera, no la única.

## 3. Convergencia

`--apply` no tiene una implementación propia: reutiliza el **mismo** espejo que
el runtime, dominio a dominio. Una sola implementación, un solo conjunto de
reglas, y por tanto es imposible que reconciliar produzca algo que el espejo en
vivo no produciría.

Cada ejecución deja una fila en `reconciliation_runs` con su modo, la versión de
fuente, el estado y los conteos. Un segundo `--apply` idéntico aplica cero
operaciones.

## 4. Verificación contra datos reales

Ejecutado en sandbox contra el padrón de producción en solo lectura y una copia
de la candidate: **MATCH exacto** en 4 instituciones, 247 usuarios, 4 grupos y
227 membresías, con 0 violaciones y 0 operaciones planificadas.

Eso cruza dos implementaciones independientes —la proyección del importador de
02A y la del espejo de 02B-A— sobre los mismos datos, y coinciden.

## 5. Una consecuencia operativa para 02B-B

La candidate congelada de 02A es v2 **sin** las tablas de contabilidad del
espejo, que llegan en la migración aditiva `0003`. Mientras no se apliquen, el
espejo y el reconciliador **fallan cerrado** con `SHADOW_TABLES_MISSING` en vez
de no hacer nada en silencio.

Es decir: promover la candidate no basta para encender el shadow-write. Hay que
aplicar `0003` sobre la base promovida, y esa es una decisión explícita de la
unidad que despliegue, no un efecto colateral.
