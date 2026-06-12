# AGENTS.md - Chibalete+

Este archivo define las reglas de trabajo para Codex al intervenir este repositorio.

## 1. Identidad del proyecto

Chibalete+ es la plataforma web principal de Chibalete Editores. Incluye lectura digital, modos de lectura, accesibilidad, libro album, audio, usuarios, grupos, colegios, clubes de lectura, progreso lector, backend Express, frontend React/TypeScript y despliegue productivo en VPS con Docker.

El proyecto es una aplicacion full-stack:

- Frontend: React + TypeScript + Vite.
- Backend: Express sobre Node.js.
- Persistencia actual: archivos JSON.
- Produccion: Docker Compose en VPS.

## 2. Principio rector

Codex debe trabajar como agente tecnico de mantenimiento, diagnostico y correccion quirurgica.

Prioridades:

1. estabilidad;
2. preservacion de funcionalidades existentes;
3. cambios minimos y localizados;
4. compatibilidad hacia atras;
5. trazabilidad;
6. deploy seguro.

No buscar elegancia arquitectonica a costa de romper produccion.

## 3. Reglas absolutas de trabajo

Codex NO debe:

- refactorizar masivamente sin instruccion explicita;
- reescribir modulos completos si basta con un parche localizado;
- cambiar autenticacion sin autorizacion explicita;
- modificar modelos globales sin diagnostico y justificacion;
- introducir dependencias nuevas salvo necesidad clara;
- eliminar logica legacy sin reemplazo completo y probado;
- romper endpoints existentes;
- cambiar estructura de base de datos sin autorizacion;
- hacer deploy sin autorizacion explicita;
- ejecutar comandos destructivos;
- tocar secretos, llaves, tokens o archivos .env;
- imprimir valores sensibles en logs o reportes.

Codex DEBE:

- leer este archivo antes de trabajar;
- revisar git status antes de modificar;
- crear o trabajar en una rama especifica;
- diagnosticar antes de cambiar;
- explicar que archivos modificara;
- aplicar cambios minimos;
- ejecutar build/pruebas disponibles;
- mostrar resumen de diff;
- documentar riesgos residuales;
- proponer rollback cuando aplique.

## 4. Estado de produccion y despliegue

Produccion NO usa PM2.

Produccion corre en VPS mediante Docker Compose en:

- /opt/chibaleteplus/docker-compose.yml

Servicios principales:

- chibalete_edge: nginx en contenedor, puertos 80/443.
- chibalete_front: frontend como imagen Docker chibalete/front:<tag>, sin mounts.
- chibalete_api_1: backend.
- chibalete_api_2: backend.

La red Docker de produccion es:

- chibalete_net

El backend usa mounts persistentes:

- /var/www/chibalete/data -> /app/data
- /var/www/chibalete/data-critical -> /app/data-critical
- /var/www/chibalete/public/uploads -> /app/public/uploads
- /var/www/chibalete/server -> /app/server

## 5. Reglas absolutas de produccion

Codex NO debe:

- usar docker compose down;
- borrar volumenes Docker;
- tocar /var/www/chibalete/data;
- tocar /var/www/chibalete/data-critical;
- tocar /var/www/chibalete/public/uploads;
- tocar /var/www/chibalete/server sin autorizacion explicita;
- reiniciar nginx si el cambio no afecta routing o frontend publico;
- reiniciar frontend si el cambio es solo backend;
- reiniciar backend sin health check previo y posterior;
- ejecutar migraciones sin dry-run;
- aplicar cambios destructivos sin rollback documentado.

Regla central:

Chibalete+ no se actualiza copiando archivos sueltos. Se actualiza como sistema: codigo, datos, imagen Docker si aplica, migracion controlada si aplica y restart controlado.

## 6. Comandos conocidos

Frontend:

- npm run dev
- npm run build
- npm run preview

Backend local:

- npm run server

PM2 solo puede considerarse para desarrollo local si el proyecto lo permite. No usar PM2 como referencia de produccion.

No asumir que existen comandos de lint o test. Revisar package.json antes de ejecutarlos.

## 7. Arquitectura funcional

Chibalete+ se modela como una plataforma de organizaciones de lectura.

Una organizacion puede ser:

- school: colegio.
- independent_club_org: club externo futuro.

Dentro de cada organizacion existen grupos de lectura.

Los grupos son la unidad operativa principal del sistema.

Tipos de grupo:

- course: curso escolar.
- club: club de lectura.

No crear modelos separados para cursos y clubes. Ambos deben usar la entidad group.

## 8. Usuarios, grupos y acceso

Roles base:

- administrador.
- mediador.
- lector.

Especializaciones posibles del mediador:

- teacher.
- librarian.
- coordinator.

Un usuario puede pertenecer a multiples grupos.

El acceso al contenido se resuelve por capas:

1. user: regla explicita por usuario.
2. group: membresia en curso o club.
3. organization: configuracion de la organizacion.
4. fallback legacy temporal.

El backend es la fuente de verdad. No delegar logica de control de acceso al frontend.

## 9. Lectores y modos de lectura

El lector es un componente critico.

Codex debe preservar:

- Modo Visual/PDF.
- Modo Guiado.
- Modo Inmersivo.
- Modo Album.
- audio/TTS.
- lectura en voz alta.
- progreso lector.
- accesibilidad.
- compatibilidad movil.

Modos conocidos:

- pdf: Modo Visual/PDF.
- text: Modo Guiado.
- immersive: Modo Inmersivo.
- album: Modo Album.
- accessible: legacy; no usar en codigo nuevo.
- a11y: reservado; no activar hasta que exista visor completo.

Reglas:

- Codigo nuevo debe usar ReaderMode y helpers de utils/readerMode.ts.
- No escribir 'accessible' en codigo nuevo.
- No registrar /leer/accesible/:id ni emitir 'a11y' al backend hasta que el visor exista.

## 10. Modo inmersivo

El modo inmersivo requiere atencion especial.

Antes de modificarlo, Codex debe diagnosticar:

- componentes del lector;
- hooks de audio;
- estado de segmento actual;
- timers;
- prefetch;
- render de texto;
- cambio de segmento;
- recuperacion de estado;
- efectos React;
- race conditions;
- cleanup de listeners;
- latencia entre audio y texto;
- perdida temporal de texto visible;
- diferencias con modo album.

Problemas historicos a vigilar:

- texto que desaparece mientras el audio continua;
- cambio visual de segmento unos milisegundos tarde;
- recuperacion posterior del render con experiencia inestable;
- prefetch tardio;
- diferencias de velocidad entre modo inmersivo y libro album.

No reescribir el modo inmersivo completo. Priorizar parches pequenos, medibles y reversibles.

## 11. Modo libro album y audio

El modo libro album puede incluir audio, dialogos, texturas sonoras y lectura guiada.

Codex debe evitar que mejoras del modo inmersivo rompan:

- libro album;
- audio de album;
- TTS;
- prefetch de audio;
- autoplay handling;
- sincronia de escenas;
- comportamiento movil.

Cuando se toque audio o TTS, revisar tanto modo inmersivo como modo album.

## 12. Leo

Leo es el asistente pedagogico.

Codex NO debe modificar el comportamiento central de Leo sin instruccion explicita.

Solo se permiten mejoras localizadas y seguras cuando esten directamente relacionadas con una tarea aprobada.

## 13. Frontend

Entrada principal:

- index.html
- index.tsx
- App.tsx

Paginas principales en:

- /pages

Servicios principales en:

- /services

Reglas:

- No saltarse useAccessCheck ni AccessWrapper.
- No duplicar logica de acceso en frontend.
- No introducir rutas nuevas sin justificar.
- No romper lazy loading ni rutas existentes.
- Mantener textos de interfaz en espanol.

## 14. Backend

Backend principal:

- server/server.js

Persistencia en archivos JSON:

- users_db.json
- content.json
- groups_db.json
- progress_db.json
- access_db.json
- leo_memory_db.json

Reglas:

- No modificar datos productivos.
- No cambiar estructura de JSON sin migracion o compatibilidad.
- No confiar en reloj del cliente para accesos temporales.
- No romper endpoints existentes.
- No modificar autenticacion sin instruccion explicita.

## 15. Flujo obligatorio para cualquier tarea

1. Leer AGENTS.md.
2. Revisar git status.
3. Confirmar rama activa.
4. Diagnosticar antes de modificar.
5. Proponer plan minimo.
6. Aplicar cambios localizados.
7. Ejecutar comandos de validacion disponibles.
8. Revisar diff.
9. Documentar riesgos.
10. No hacer deploy sin autorizacion explicita.

## 16. Entrega esperada al cerrar cada intervencion

Toda intervencion debe terminar con:

- resumen ejecutivo;
- rama activa;
- archivos modificados;
- comandos ejecutados;
- resultado de build/pruebas;
- diff resumido;
- riesgos residuales;
- rollback sugerido;
- siguiente paso recomendado.

## 17. Prioridades actuales para Codex

Prioridad P0:

- estabilizar modo inmersivo;
- corregir desaparicion temporal de texto;
- mejorar sincronizacion audio/texto;
- evitar regresiones en libro album;
- preservar lectura en voz alta.

Prioridad P1:

- mejorar observabilidad del lector;
- detectar errores silenciosos;
- crear pruebas o checklists de regresion;
- validar rendimiento en Android economico.

Prioridad P2:

- ordenar scripts operativos;
- mejorar documentacion de deploy;
- preparar diagnosticos VPS de solo lectura.

Prioridad P3:

- bundles;
- clubes externos;
- nuevos modos de lectura;
- cambios mayores de arquitectura.

No implementar P2/P3 mientras haya P0/P1 abiertos sin instruccion explicita.
