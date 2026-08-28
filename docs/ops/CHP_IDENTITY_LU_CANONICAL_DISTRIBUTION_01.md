# CHP-IDENTITY-LU-CANONICAL-DISTRIBUTION-01

Fecha: 2026-08-28 (16:07–16:11Z). Tipo: corrección productiva mínima de configuración.
Primera unidad ejecutada bajo `CHP-ROADMAP-2026-05` (carril A). Sin código, sin deploy, sin restart,
sin tocar Android/APK, sin migrar dispositivos, sin observabilidad nueva, sin `ENFORCE`.

---

## A. Veredicto

**`GREEN-LU-0.9.0-CANONICAL-DISTRIBUTION`**

Alcance exacto, y nada más:

```text
Las nuevas descargas reciben LU 0.9.0.
```

**No** significa campo migrado, drain cerrado, identidad legacy retirada, `ENFORCE` autorizado ni M1
cerrado. Ver §E.

## B. Estado de entrada

La unidad nace del preflight read-only **`CHP-IDENTITY-FIELD-DRAIN-CLOSE-01A`**, que cerró
`RED-MINIMAL-CORRECTION-REQUIRED` sobre un hecho verificado: producción anunciaba y distribuía el
cliente **legacy 0.8.0**, mientras el 0.9.0 —existente, publicado y validado en `01B-A`/`02`— no era
la distribución canónica. Ese preflight fue íntegramente read-only y, por contrato, no dejó documento
propio; su evidencia queda resumida aquí como estado de entrada.

Esta unidad es, literalmente, la que
`CHP_IDDB_M1_A_ANDROID_SESSION_MIGRATION_02_CANARY_DISTRIBUTION.md` §C dejó reservada: *«el bump de
`lu_config` (version/apkUrl) queda reservado para la unidad de rollout general»*.

## C. Cambio aplicado

Archivo productivo único:

```text
/var/www/chibalete/data/lu_config.json
```

Diff semántico completo — dos valores, ninguna clave añadida, eliminada ni reordenada:

```diff
-  "version": "0.8.0",
-  "apkUrl": "/uploads/chibalete-lu-0.8.0.apk",
+  "version": "0.9.0",
+  "apkUrl": "/uploads/chibalete-lu-0.9.0.apk",
```

Invariantes preservados: `forceUpdate=false`, `minSupportedVersion="0.7.1"` y el resto de claves sin
cambios. Tamaño 272 B antes y después; propiedad y permisos `644 root:root` intactos.

| Hash SHA-256 | |
|---|---|
| `lu_config.json` antes | `7a7c4fc83cb897a7233ffd536beaac39613bf6af528c4cebe73de6192aa3fb00` |
| `lu_config.json` después | `9de63d59c66533560c852c98c12023ff8c51afd7a6ff9311cf107764026d5db7` |
| APK 0.9.0 (sin tocar) | `a925033054a4846a3ecff779e738f5abd7c55ca1831544f3219b809895888e0b` |

Artefacto objetivo: `versionName 0.9.0`, `versionCode 10`, `2 010 794` bytes, `com.chibalete.lu` —
leído del `AndroidManifest.xml` binario en modo lectura y coincidente byte a byte con el artefacto
GREEN previamente documentado.

**Método:** el candidato se construyó y validó **fuera de la ruta productiva** (JSON válido, dos
diferencias semánticas exactas, mismas claves en el mismo orden); el SHA-256 del archivo productivo
se recomprobó **inmediatamente antes** de escribir; la instalación fue un reemplazo **atómico**
(`os.replace` sobre el mismo filesystem, con `fsync` de archivo y directorio) preservando modo y
propiedad. Sin temporal residual.

**No hizo falta ningún restart** y ninguno estaba autorizado: `server.js:1399` hace `readFileSync`
del archivo **en cada petición** a `/api/lu/version`, y `data/` es bind mount de ambas réplicas.

## D. Backup y rollback

```text
/var/www/chibalete/data/lu_config.json.bak-pre-0.9.0-20260828-160911
272 B · 644 root:root · mtime original preservado (cp -p)
sha256 7a7c4fc83cb897a7233ffd536beaac39613bf6af528c4cebe73de6192aa3fb00
cmp -s contra el original → byte a byte IDÉNTICO (verificado antes de mutar)
```

Sigue la convención que ya usaba este mismo archivo (`lu_config.json.bak-<etiqueta>-<fecha>`), vive
junto al original y **fuera del repositorio**. No se copia al repo.

Rollback exacto:

```bash
cp -p /var/www/chibalete/data/lu_config.json.bak-pre-0.9.0-20260828-160911 \
      /var/www/chibalete/data/lu_config.json.rollback.tmp \
 && mv /var/www/chibalete/data/lu_config.json.rollback.tmp \
       /var/www/chibalete/data/lu_config.json
# verificación posterior: sha256 debe volver a 7a7c4fc8…fb00
```

No fue necesario: ninguna condición de rollback se activó.

## E. Evidencia productiva

| Comprobación | Resultado |
|---|---|
| `GET /api/lu/version` (consulta única, 16:10:33Z) | **200** · `version 0.9.0` · `apkUrl /uploads/chibalete-lu-0.9.0.apk` · `forceUpdate false` · `minSupportedVersion 0.7.1` |
| HEAD único al APK anunciado | **200** · `content-length 2 010 794` · `etag "6a8469ed-1eaeaa"` · `last-modified 2026-08-18T14:19:25Z` |
| Cadena endpoint → URL → binario → versión interna | **coincide**: lo anunciado, lo servido y lo validado son el mismo artefacto |
| `chibalete_api_1` / `api_2` | `chibalete/api:e70c0f1`, misma `StartedAt` (27/08 21:56:33Z / 21:57:29Z), `RestartCount=0`, healthy |
| `chibalete_front` | `chibalete/front:ret-162c3e6`, misma `StartedAt` (28/08 03:00:44Z), `RestartCount=0`, healthy |
| `chibalete_edge` | `nginx:alpine`, misma `StartedAt` (11/08 01:33:31Z), `RestartCount=0`, healthy |
| Modos de sesión y acceso | `SESSION_AUTH_MODE=compat` ×2 · `ACCESS_FALLBACK_MODE=open` ×2 — **sin tocar** |
| Errores nuevos desde 16:09Z | **0** 5xx en el edge · **0** líneas de error o `[LU]` en ambas APIs |
| Otras escrituras | `find data/ data-critical/ uploads/ -mmin -25` → **una sola entrada**: `lu_config.json` |

Sin cambio de código, sin build, sin imagen nueva, sin deploy, sin restart, sin migración de datos.

## F. Límites que permanecen abiertos

- **Ningún dispositivo instalado se actualizó por este cambio.** Los clientes desplegados **no
  consultan `/api/lu/version`**; el consumidor real del endpoint es la página web `/chibalete-lu`.
  Este cambio altera **qué se entrega a quien descargue**, no qué corre en los equipos.
- El parque de campo lleva **semanas sin actividad suficiente** para observar migración alguna.
- El drain **no tiene todavía una ventana válida**: el contrato exige ≥48 h hábiles **posteriores** a
  una migración demostrada, y esa migración no está demostrada.
- **`ENFORCE` sigue prohibido.** M1 permanece abierto.
- La actividad legacy del **navegador** mediante `x-user-id` sigue siendo un **hallazgo para M1**, no
  parte de esta unidad: no se tocó.
- **Deuda cosmética no bloqueante, no corregida** (fuera de la allowlist): `notes` todavía menciona
  0.8.0 y `releaseNotes` menciona v0.7.1, de modo que la página muestra «0.9.0» junto a una nota
  desactualizada. No afecta a qué binario se descarga.
- El backup `lu_config.json.bak-pre-0.9.0-20260828-160911` forma parte de los archivos protegidos:
  **no es candidato de limpieza**.

## G. Siguiente unidad

```text
CHP-IDENTITY-FIELD-MIGRATION-EVIDENCE-01
PREFLIGHT READ-ONLY
```

Objetivo futuro: determinar el parque LU realmente instalado, qué evidencia existente puede demostrar
una migración y qué intervención humana o ventana de uso permitiría completar el drain. No se diseña
ni se ejecuta aquí.
