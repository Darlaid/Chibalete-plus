# Política de drift de la candidate — CHP-IDDB-02B-A

Una candidate es un **corte**, no un store vivo. El padrón sigue cambiando
mientras la candidate no cambia. Que el fichero fuente ya no coincida no la
invalida por sí solo: lo que decide es **si cambió algo que la candidate
realmente importa**.

## 1. Dos clases de drift

**`ALLOWED_NON_IMPORTED_DRIFT`** — el hash de la fuente cambió pero las
proyecciones canónicas coinciden. Caso típico: un `lastLoginAt`, que identity.db
no almacena y que no altera identidad alguna. La candidate sigue siendo
promovible.

**`BLOCKING_IDENTITY_DRIFT`** — cambió algo que sí define identidad:

- un usuario añadido o retirado;
- un rol global cambiado;
- un estado de usuario cambiado;
- una membresía añadida o retirada;
- un grupo añadido, retirado o reasignado;
- una institución añadida, retirada o renombrada.

Ante esto la candidate **no se promueve**. Hay que regenerar una candidate
atestada con el mismo importador y volver a verificarla. Promover la vieja sería
promover una foto caducada y arrancar el espejo ya divergente.

## 2. Cómo se comprueba

`classifyCandidateDrift` compara la candidate contra el JSON de hoy usando las
mismas proyecciones canónicas del reconciliador, y además contrasta los hashes de
fuente declarados en el manifiesto. Devuelve la clasificación, si es promovible,
qué fuentes cambiaron y qué entidades bloquean.

Antes de cualquier promoción productiva hay que comprobar, como mínimo: hash
lógico de los campos realmente importados, conteos, grupos e instituciones,
membresías y el respeto de las disposiciones de 01A–01D.

## 3. Estado de la candidate de 02A

Verificada en esta unidad contra el padrón de producción: **sin drift bloqueante**
—reconciliación `MATCH` en las cuatro entidades—. Sigue siendo promovible, pero
esa comprobación caduca: hay que repetirla inmediatamente antes de promover, no
heredarla de aquí.

## 4. Qué bloquea 02B-B

1. Drift bloqueante sin regenerar la candidate.
2. Promover sin aplicar `0003` y pretender encender el shadow-write: el espejo
   fallará cerrado con `SHADOW_TABLES_MISSING`.
3. Encender el dual-write sin haber bloqueado o cubierto todas las superficies
   de escritura del inventario.
4. Encender cualquier flag de lectura: 02B-C mantiene la lectura en JSON.
5. Cualquier expectativa de que identity.db sirva autenticación: no guarda
   credenciales por diseño.
