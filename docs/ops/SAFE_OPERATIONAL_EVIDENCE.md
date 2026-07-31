# Evidencia operativa segura

**Unidad:** CHP-SEC-ADMIN-EVIDENCE-HARDEN-01B
**Contrato:** `scripts/security/evidenceContract.mjs` v1.0.0
**Alcance:** cualquier archivo que se guarde, adjunte a un ticket, pegue en un
chat o suba a un repositorio para documentar el estado de producción.

---

## 1. La regla

> **La evidencia se genera seleccionando campos permitidos.
> Nunca copiando el objeto completo y redactando después.**

No es una preferencia de estilo. Redactar-después falla en silencio: el día que
Docker añada un campo nuevo, o que alguien meta una variable con un nombre que
nadie previó, el volcado completo la copia tal cual. Un proyector por allowlist
sencillamente no la ve.

De dónde sale esta regla — hallazgos de CHP-SEC-AI-PROVIDER-KEYS-ROTATE-01A:

| # | Hallazgo | Consecuencia |
|---|---|---|
| 1 | `docker inspect` crudo persistido | dos claves completas en 3 artefactos | <!-- chp-evidence-ratchet: allow tabla-de-hallazgos -->
| 2 | `docker compose config` efectivo persistido | las mismas variables, otra vez | <!-- chp-evidence-ratchet: allow tabla-de-hallazgos -->
| 3 | Copias de `.env` | 8 archivos con varias credenciales cada uno |
| 4 | Sanear **una** variable | el archivo seguía sucio: tenía otras |
| 5 | Clave Gemini con **punto** | invisible para el tokenizador del escáner |
| 6 | Provisión con el valor en el prompt de `read` | clave en `/root/.bash_history` |
| 7 | Buscar por nombres conocidos | no encuentra la variable que nadie previó |

---

## 2. Qué se puede guardar

Lo que produce `scripts/security/safeOperationalEvidence.mjs`:

- nombre de contenedor, `ImageID`, tag, estado, salud, `restartCount`;
- fechas de creación y arranque, política de reinicio;
- límites de CPU y memoria;
- redes y alias (**sin IP**);
- mounts con la ruta de origen **saneada**;
- **nombres** de variables de entorno;
- **valores** de las banderas de la allowlist (`ENV_VALUE_ALLOWLIST`);
- labels expresamente permitidos;
- commit y `deployed_at` (vía `/api/health`).

## 3. Qué no se guarda nunca

- `Config.Env` con valores;
- `Config.Cmd` / `Config.Entrypoint` (los argumentos llevan secretos a veces);
- el test del healthcheck (puede contener URLs firmadas);
- `secrets`, tokens, contraseñas, cookies, cabeceras `Authorization`;
- credenciales de registry;
- el contenido de `.env`;
- payloads de usuarios, PII, IP completas cuando no hacen falta.

Si necesitas un campo que no está en la allowlist, **añádelo al contrato con su
justificación** — no lo saques por otro camino.

---

## 4. El helper aprobado

```bash
node scripts/security/safeOperationalEvidence.mjs <subcomando> [--out archivo]
```

| Subcomando | Para qué |
|---|---|
| `container-summary` | estado completo del contenedor, por allowlist |
| `compose-summary` | compose efectivo sin persistirlo crudo |
| `environment-names` | qué variables hay (y el valor de las banderas permitidas) |
| `mount-summary` | mounts con rutas saneadas |
| `health-summary` | salud, reinicios, arranque |
| `image-summary` | ImageID, tag y labels permitidos |
| `redact-json` | redacta un JSON estructuralmente |
| `redact-env` | `--mode names` (por defecto) o `--mode redacted` |
| `redact-yaml` | redacta un YAML sin romperlo |
| `scan-artifact` | busca valores literales en un archivo, sin tokenizar |

**No existe `--raw`, ni `--full`, ni `--no-redact`.** Pasarlos es un error duro.
La herramienta no tiene un modo inseguro que activar por descuido.

### 4.1 Ejemplos seguros

```bash
# Estado de los dos backends, archivado como evidencia (el archivo sale 0600)
node scripts/security/safeOperationalEvidence.mjs container-summary \
  chibalete_api_1 chibalete_api_2 --out ops/evidence/2026-07-31-api.json

# Desde el VPS, sin instalar nada allí: el JSON crudo vive solo en la tubería
ssh root@VPS "docker inspect --format '{{json .}}' chibalete_api_1" \
  | node scripts/security/safeOperationalEvidence.mjs container-summary --from-file -

# Comprobar banderas sin volcar el entorno
node scripts/security/safeOperationalEvidence.mjs environment-names chibalete_api_1

# Qué variables declara un .env, sin ver ni un valor (extracción en el host)
ssh root@VPS "grep -oE '^[A-Za-z_][A-Za-z0-9_]*' /opt/chibaleteplus/.env"

# Validar el compose sin imprimir su contenido efectivo
ssh root@VPS "cd /opt/chibaleteplus && docker compose config -q && echo VALID"
```

### 4.2 Ejemplos prohibidos

Todos estos los bloquea el ratchet de CI:

Cada línea lleva el marcador de exención porque el ratchet, con toda la razón,
bloquearía este mismo bloque:

```bash
docker inspect chibalete_api_1 > evidencia.json          # docker-inspect-raw · chp-evidence-ratchet: allow ejemplo-prohibido
docker compose config > compose.effective.yml            # compose-config-persisted · chp-evidence-ratchet: allow ejemplo-prohibido
cp /opt/chibaleteplus/.env "$SNAP/configs/.env.original" # env-file-copy · chp-evidence-ratchet: allow ejemplo-prohibido
docker inspect --format '{{range .Config.Env}}…'         # config-env-values · chp-evidence-ratchet: allow ejemplo-prohibido
read -r -s -p "$VALOR" CLAVE                             # secret-as-prompt · chp-evidence-ratchet: allow ejemplo-prohibido
curl -H "x-admin-secret: $SECRET" https://…              # secret-in-argv · chp-evidence-ratchet: allow ejemplo-prohibido
docker exec chibalete_api_1 env                          # env-dump · chp-evidence-ratchet: allow ejemplo-prohibido
```

---

## 5. Provisión humana de un secreto

El incidente: `read -r -s -p "<la clave>" GEMINI_KEY`. `-s` oculta lo que se
teclea, pero **el historial guarda la línea de comando**, y la clave estaba
dentro del prompt. Terminó escrita en `/root/.bash_history`, línea 1979.

Procedimiento correcto:

```bash
set +o history                                    # 1. nada de esta sesión al historial
install -m 0400 /dev/null /root/incoming/nueva.key 2>/dev/null || true
read -r -s -p 'Pega el valor y pulsa Enter: ' V   # 2. prompt LITERAL FIJO
printf %s "$V" | node scripts/security/provisionSecret.mjs \
  --out /root/incoming/nueva.key --mode 0400 --expect-prefix 'sk-'
unset V                                           # 3. fuera de la memoria del shell
set -o history
```

Invariantes que impone `provisionSecret.mjs`:

- el valor entra **solo por stdin**: no hay `--value` (en argv sería visible en `ps`);
- el archivo se crea **con su modo final**, con `O_EXCL`, antes de escribir nada;
- no sobrescribe sin `--force`;
- valida longitud, prefijo y que sean ASCII visibles **sin revelar el valor**;
- la salida son metadatos: ruta, modo, longitud y una huella corta.

Y el prompt **nunca** se construye con el valor. Es una cadena literal fija.

---

## 6. Limpieza

Tras cualquier operación con material sensible:

```bash
shred -n 3 -u <archivo temporal>          # no basta `rm`
node scripts/security/safeOperationalEvidence.mjs scan-artifact <artefacto> \
  --needles <archivo-de-patrones 0600>    # confirma que el artefacto quedó limpio
```

Si hay que sustituir un valor dentro de un archivo que se conserva: escribir el
resultado en un temporal, hacer `os.replace` y **triturar el inodo viejo**
(retenido con un hardlink antes del swap). Un `rm` deja los bloques en disco.

---

## 7. Manifiestos

Un manifiesto de operación puede contener huellas (`sha256` truncado), nunca
material. Regla práctica: si perder el manifiesto obligara a rotar algo, el
manifiesto está mal construido.

---

## 8. Respuesta a incidentes

1. **Contener antes de investigar**: permisos a 0600/0400 y dejar de generar copias.
2. **Localizar por huella, no por nombre.** `scan-artifact` busca el valor
   completo en varias codificaciones (crudo, escapado JSON, base64, percent,
   comillas YAML, partido en varias líneas). No tokeniza: por eso ve las claves
   con punto que el escáner anterior no veía.
3. **Rotar antes de sanear.** Un artefacto saneado con la clave todavía viva
   solo reduce copias, no el riesgo.
4. **Recrear los procesos.** `server/aiEngine.js` cachea los clientes de
   OpenAI/Gemini en variables de módulo: un proceso vivo conserva la clave
   antigua para siempre. Sin recreación rolling, la rotación no llega al runtime.
5. **Barrer el historial de shell.** Es el sitio donde nadie mira.

---

## 9. Antes de adjuntar un archivo a un ticket o a un chat

Lista de comprobación:

- [ ] ¿Lo generó el helper aprobado? Si no, ¿por qué no?
- [ ] ¿Es un formato estructurado? El texto plano es best-effort y no vale como
      evidencia definitiva cuando existe alternativa estructurada.
- [ ] ¿Pasa `scan-artifact` contra los patrones conocidos?
- [ ] ¿Contiene rutas absolutas del host, IP o nombres de cliente?
- [ ] ¿Contiene nombres de variable? Vale. ¿Valores? Solo los de la allowlist.
- [ ] Una vez enviado, no se puede retirar: puede quedar indexado o cacheado.

---

## 10. Límites conocidos

- **YAML**: el redactor es estructural por indentación, sin dependencias nuevas.
  No interpreta flow-style (`{a: b}`), anclas ni bloques literales multilínea.
  Ante ellos redacta de más, nunca de menos.
- **Texto plano**: best-effort por definición. Marcado como tal en la salida.
- **El helper corre donde está el repositorio.** Para evidencia del VPS, el JSON
  crudo viaja por una tubería SSH y se proyecta en local; nunca toca disco.
  Instalar el helper en el host (para proyectar antes de cruzar el cable) queda
  pendiente: esta unidad tiene prohibido tocar producción.
- **La taxonomía de nombres es la segunda línea de defensa.** La primera es la
  allowlist de salida. Si añades un formato nuevo, hazlo con allowlist.

---

## 11. Verificación

```bash
npm run test:evidence      # helper + redactores + escáner + provisión
npm run lint:evidence      # ratchet sobre todo lo versionado (bloqueante en CI)
```

El job `evidence-hardening` de `.github/workflows/security.yml` ejecuta ambos en
cada push. Es bloqueante.
