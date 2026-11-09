# V8.1-CLOSE-07A: release candidata final

**Fecha:** 2026-11-09.
- **Publicación:** CLOSE-06B (`0f37df6..dd16a8a`), CI remota **3/3 en verde** (identity-preflight, security, content-rmw).
- **Release:** construida desde `dd16a8a`. **Sin despliegue y con XP apagado.**

## 1. Imágenes

| Imagen | ID | SHA-256 del artefacto |
|---|---|---|
| `chibalete/api:v81-dd16a8a` (`linux/amd64`) | `sha256:4e232ce06f8614f7d176fec7b760bc63c3971395261efc87b1fe7122ca5d59ce` | `b24cecad250e4dd3c85768e84a93cc0dac6901e685d74a4f1362e9ca7a5539e0` |
| `chibalete/front:v81-dd16a8a` (`linux/amd64`) | `sha256:5fea50ccfcb54624145b2763ea4c247c60ada23cd559a70853d0f4aa08434e91` | `192dc0fff6e289a9cc7554b6e2ddf3bf5c338f17484a44f4a03c8c685ab4bb6d` |

- **Ubicación:** `D:\chp-artifacts\v81-dd16a8a\`, fuera de Git. Contiene `MANIFEST.md`, `SHA256SUMS`, `evidence/` y `lab/`.
- **El front es necesario:** `ActivarCuenta` envía las decisiones y muestra los documentos. Con el front actual, la API nueva respondería 422 en toda activación.
- **Desplegar juntas:** API y front van en la misma ventana, la API primero.

## 2. Verificación

- **Contexto:** `git archive` con LF; 0 bytes CR en el árbol y en la imagen.
- **Integridad de la API:** 51/0. Sin secretos, sin `data/` ni `data-critical/`, sin variables de gamificación, A2 ni documentos.
- **Trivy 0.69.3** (HIGH/CRITICAL, `--ignore-unfixed`, `.trivyignore`): API 0 y front 0.
- **gitleaks 8.21.2** sobre el árbol: limpio. CI: `security` en verde.
- **Laboratorio sobre el código de la imagen** (`--network none`, solo las pruebas montadas en solo lectura): **13/13 suites en verde.**

| Suite | Resultado |
|---|---|
| Registro A2 | 34 |
| Aceptación | 42 |
| Activación con dos réplicas | 31 |
| Contratación | 28 |
| Alcance por sujeto | 45 |
| Aula Viva | 107 |
| Revisión MOOK con identidad | 30 |
| Revisión MOOK con dos réplicas | 14 |
| A1 → XP | 23 |
| Rectificación | 44 |
| Progreso individual | 49 |
| `workRecognition` | 120 |
| `platformIntegration` | 58 |

- **Laboratorio A2 de CLOSE-03** con esta imagen: 41/0. Incluye clave, carga desde C.1, custodia, dos réplicas, revocación, restauración sin reactivar y corrupción.
- **Tokens de invitación:** 9/0.
  - Solo el administrador los recibe, en el enlace de la respuesta del alta.
  - Mediador y lector: 401/403, sin token.
  - No aparecen en el listado, en la ficha ni en los logs, y no hay valores de 64 hex en los logs.
- **Fallo cerrado** (cubierto por las suites anteriores):
  - Sin `CHP_ACCEPTANCE_DOCUMENTS`: la activación responde 503.
  - Sin registro: activación 503, altas invitadas, sin A2 y sin XP.

## 3. Rollback

- **Imágenes:** `unifiedxp-13b8045` (API `c3361ee0…`, front `26a0a3f4…`, las de producción).
- **Datos:** esas imágenes no contienen `server/privacy/` ni código del registro. Volver a ellas ignora el registro y la clave sin restaurar ninguna base: el registro de decisiones queda como estaba, append-only.
- **Cuentas creadas durante la ventana:** las invitadas siguen invitadas. Con la imagen anterior se podrían activar sin decisiones; se regularizan después.
