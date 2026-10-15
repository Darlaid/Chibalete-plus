# UPSTREAM — vendored snapshot (archivo propio de Chibalete+)

> Este archivo NO forma parte de foliate-js. Lo añade Chibalete+ para
> documentar la procedencia del snapshot. Todos los demás archivos de este
> directorio son copia byte a byte del upstream indicado abajo.

Project:
foliate-js

Upstream repository:
https://github.com/johnfactotum/foliate-js

Upstream commit:
78914aef4466eb960965702401634c2cb348e9b1

Upstream tree:
72c695f2511bcfc0e3dc37385b81daa5f6fe6930

Imported date:
2026-10-15

License:
MIT — ver `LICENSE` en este directorio (original, sin modificar).
Copyright del código original: sus autores upstream, no Chibalete+.

Import method:
`git -c core.autocrlf=false archive 78914aef…` (sin conversión de fin de
línea), extraído en `vendor/foliate-js/`. 231 archivos, 13.042.940 bytes.
Verificación: el blob id de git de cada archivo coincide con `git ls-tree -r
78914aef…` (231/231). El `.gitattributes` raíz de Chibalete+ marca
`vendor/foliate-js/** -text` para que ningún checkout convierta fines de línea.

Policy:
- vendored snapshot controlled by Chibalete+
- no automatic upstream synchronization
- upstream upgrades are manual and reviewed
- local modifications must be documented

Local modifications:
- none (a la fecha de importación).

Security note (contrato upstream, README «Security»):
- foliate-js NO soporta EPUB con scripts: el contenido se sirve desde `blob:`
  del mismo origen y los iframes llevan `sandbox="allow-same-origin
  allow-scripts"` (WebKit bug 218086), así que el sandbox no aísla scripts.
- Upstream exige una CSP que bloquee todo script salvo `'self'`
  (ver la `<meta http-equiv="Content-Security-Policy">` de `reader.html`).
- En Chibalete+ el contenido EPUB con scripts permanece deshabilitado salvo
  decisión explícita posterior.
