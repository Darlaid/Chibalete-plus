# V8.1-PROD-02C: publicación de A3/A5 y continuidad para lectores actuales

**Fecha:** 2026-11-10.
- **Publicado:** `92c9a9b..348085a`, con PROD-02B.
- **Sin despliegue, sin imágenes y sin XP.** No se han creado autorizaciones, registros ni claves reales, ni se han tocado datos.

## 1. Chibalete LU

**Inspección estática** de `chibalete-lu-0.9.2.apk` (SHA-256 `4c7e29e6…de902`). El detalle está en la hoja 10 del paquete PROD-02A.

**Resultado para 0.9.2:**
- **Permisos:** solo red.
- **En el dispositivo:** sesión cifrada, libro asignado, progreso y eventos de lectura pendientes.
- **Envíos:** solo a `chibaleteplus.chibaleteeditores.com` (login, asignación offline, progreso y eventos).
- **Terceros:** ningún SDK ni dominio externo.
- **Conclusión:** sin datos personales más allá de A1, así que **A4 no requiere una decisión propia**.

**Límites:**
- No se ha verificado qué versión se distribuye hoy; la documentación de distribución cita 0.7.1 y 0.8.0 en el servidor.
- No se ha verificado qué borra la app al cerrar sesión.
- No se ha inspeccionado el contenido de cada evento.

## 2. Usuarios históricos: regularización de A3/A5 (sin concesiones por uso anterior)

**Qué ocurre si se despliega sin regularizar:** con `0b230a6`, todo lector **sin A3/A5 efectiva** pierde Leo y la lectura en voz alta con transcripción. **Ningún lector actual tiene A3 ni A5**, porque esos tipos no existían en el registro. Por lo tanto, al desplegar se cerrarían Leo y la transcripción de voz para **todos los lectores actuales**.

**Procedimiento** (reutiliza el 004 Parte III, el 006 C.1 y el registro existente):
1. **Identificar el impacto antes del despliegue**, con la imagen nueva y sin escribir nada:
   `docker exec -i chibalete_api_1 node --input-type=module - < ops/a2/decision_coverage.mjs`.
   - Devuelve recuentos por tipo y estado (A1, A2, A3, A5 de los lectores; C005 de los mediadores) y el impacto: `leoClosedReaders`, `voiceTranscriptionClosedReaders` y `mediatorsWithoutIndividualAccess`. Sin ids.
   - La ejecuta AT y Dirección conserva el resultado.
2. **Recoger A3/A5** en la ficha C.1 de cada lector (Parte III del 004 aprobado), por la institución (CI) o por el titular adulto. Un uso anterior de Leo o de la oralidad **no es evidencia**.
3. **Verificar** (VER) cada ficha. Solo entran decisiones con verificación «suficiente» (CLOSE-04).
4. **Registrar** con `ops/a2/decision_operator.mjs`, una línea por decisión: `kind` `A3` o `A5`, `status` `granted`/`denied`/`revoked`, `actDay` = la fecha de la ficha, `version` `004@1.0`, `verification: "verified"` y `requestRef` = la referencia opaca de la ficha.
   - **Las negativas y las revocaciones también se registran.** Las pendientes no se anotan: equivalen a no autorizar.
5. **Comprobar** repitiendo el paso 1. `leoClosedReaders` debe ser igual al número de lectores sin A3 concedida en C.1, y lo mismo con A5. El comportamiento por decisión está probado en `optionalProcessingHttp` (32/0).
6. **Titulares adultos (B2C):** pueden decidir A3/A5 ellos mismos en la activación, o, si ya están activos, por contacto@chibaleteeditores.com. Esa vía queda registrada como `admin_record` y verificada.

**Gate de despliegue: BLOQUEADO.** No hay ninguna evidencia de A3/A5 de los lectores actuales. El despliegue solo puede hacerse si se da una de estas dos condiciones:
- **(a)** `decision_coverage` muestra que los cierres de Leo y de la voz corresponden solo a quienes no autorizaron; o
- **(b)** Dirección acepta **por escrito** una transición compatible con los derechos de los lectores. Por ejemplo, desplegar con Leo y la transcripción de voz cerradas para quien aún no ha decidido, informando a las familias y a las instituciones.

**No hay excepciones productivas:** no existe ningún interruptor que conceda A3/A5 por uso anterior, y no se crea.

## 3. Correspondencia 001 ↔ 004

La hoja 09 (rev. PROD-02C) y la hoja 10 recogen la tabla completa. **Es coherente** con la 001 en estos puntos:
- §9.2: Leo no envía nombre, correo ni institución, comprobado en el código;
- §9.3: los registros del proveedor quedan **[VERIFICAR]**;
- §9.5: la voz la transcribe el navegador; Chibalete no la recibe ni la conserva;
- §9.8 y §9.9: categorías de LU y sincronización no necesariamente en tiempo real; el efecto de cerrar sesión queda **[VERIFICAR]**;
- §10.11: los proveedores quedan **[VERIFICAR]**;
- revocación con efecto inmediato.

**En la 001 no hacen falta correcciones indispensables.** Convienen dos precisiones: §9.5, que el reconocimiento lo hace el navegador, y §9.8, las categorías de LU.

## 4. Pruebas de esta unidad

**`decisionCoverage` (nueva, en `test:v81`):** 9/0.
- Cuenta solo las cuentas activas.
- Recuentos por estado: una A5 sin verificar no se cuenta como efectiva.
- Calcula el impacto sobre los lectores y mediadores.
- La salida no contiene ids ni correos.
- **No escribe** en el registro.
- Con el registro alterado ⇒ `ok:false` y código 1.
