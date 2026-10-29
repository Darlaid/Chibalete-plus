# GAMIFICACION-DOCTRINA-01 — Documento fuente para G1-01

**Estado de aprobación (29 de octubre de 2026):** La dirección de Chibalete+ expresó conformidad con la orientación general y las decisiones recomendadas de esta doctrina. Este documento conserva íntegro el texto fuente recibido, incluidas las 54 preguntas y sus recomendaciones. **No representa 54 votos individuales diligenciados.**

**Regla de interpretación para Claude:** tomar como FIXED los principios explícitos y decisiones doctrinales aceptadas; marcar como CONFIGURABLE cantidades de PM, precios, umbrales, límites, cohortes, duración y presupuesto que el propio texto llama experimentales; marcar como GATED los aspectos que exigen validaciones de derechos, privacidad, familia, regalías, integración comercial u otras dependencias. No inventar elecciones donde la recomendación ofrece alternativas (por ejemplo, B/D). Conservar las incertidumbres y registrarlas explícitamente.

**Alcance:** especificación documental G1-01, no implementación ni autorización de despliegue. Baseline G0 `f4836d1`, `GREEN_PROD` según reporte del equipo.

---

## Texto fuente íntegro

Doctrina unificada de gamificación para Chibalete+: cuestionario exhaustivo de decisiones antes de implementar
Resumen ejecutivo
La investigación converge en una doctrina bastante clara: Chibalete+ no debería construir su gamificación alrededor de “dar puntos por usar la plataforma”, sino alrededor de reconocer progreso lector verificable, autonomía, dominio y participación significativa. La literatura reciente encuentra efectos positivos de la gamificación sobre aprendizaje y motivación, pero no automáticos: el diseño, la duración, el contexto y la forma de implementar recompensas cambian sustancialmente los resultados. Un metaanálisis de 2024 encontró un efecto pequeño sobre motivación intrínseca, junto con efectos mayores sobre autonomía y relación social; otro encontró efectos positivos moderados sobre rendimiento. 

Esto tiene una consecuencia directa para Chibalete+: XP, Puntos de Magia, logros y beneficios comerciales deben ser conceptos diferentes. El XP debe expresar progreso permanente y no gastable; los Puntos de Magia —si se aprueban como moneda canjeable— deben ser escasos, auditables y emitidos exclusivamente desde evidencia validada por el servidor; los logros deben reconocer hitos cualitativos; y los descuentos comerciales deben ser una capa separada, con presupuesto y reglas de protección al menor. La auditoría interna ya mostró precisamente el riesgo de mezclar estas capas: el sistema anterior tenía puntos efímeros en cliente, XP local, varios “niveles” incompatibles, canjes simulados y ninguna autoridad central. 
 

La recomendación doctrinal es no convertir Q, R o S —las métricas que participan en los sistemas de lectura y/o economía editorial— en moneda directamente. Pueden funcionar como evidencia de elegibilidad o como insumos para determinar progreso, pero el libro de gamificación debe ser independiente del libro de regalías. Esta separación evita que cambiar una regla motivacional altere accidentalmente una liquidación editorial y evita que una acción diseñada para aumentar puntos distorsione la métrica económica. La auditoría interna ya identifica progreso canónico, MOOK, reglas de acceso y regalías como sistemas productivos que deben conservarse y desacoplarse de la futura gamificación. 

En protección infantil, la doctrina debe adoptar un estándar superior al mero consentimiento. En Colombia, el tratamiento de datos de niños, niñas y adolescentes está sujeto a protección reforzada, interés superior y respeto de derechos fundamentales; la SIC exige además que se valore la opinión del menor conforme a su madurez. La Ley 1480 contiene protección especial para menores en comercio electrónico y exige autorización expresa de los padres cuando la adquisición la realiza un menor. 
 Como referencia internacional de diseño, el Children’s Code del ICO recomienda privacidad alta por defecto, minimización de datos y evitar nudges que debiliten la privacidad, mientras UNICEF insiste en responsabilidad del proveedor además del consentimiento parental. 

Por tanto, propongo que la doctrina se apruebe con siete principios no negociables:

El progreso lector no se gasta.
Los Puntos de Magia no se generan en el cliente ni por texto de una IA.
Toda emisión y todo canje tiene evidencia, idempotencia y trazabilidad.
Nunca se premia velocidad, repetición artificial ni tiempo de pantalla por sí mismos.
No hay rankings públicos individuales de menores por defecto.
Regalías y gamificación comparten evidencia cuando sea útil, pero nunca el mismo libro contable.
Ninguna recompensa se anuncia antes de que pueda entregarse realmente.
La investigación académica respalda especialmente los puntos sobre autonomía, competencia y evitar diseños excesivamente extrínsecos o competitivos: algunos estudios han observado que badges o leaderboards pueden disminuir motivación o resultados cuando se convierten en el centro de la experiencia. 

La arquitectura recomendada sería:

evidencia compartida

Lectura canónica

Motor de evidencia

MOOK / evidencia revisada

Leo con evidencia estructurada

Actividades validadas fuera de plataforma

Progreso lector / XP permanente

Logros y misiones

Emisión de Puntos de Magia

Perfil

Libro de movimientos PM

Motor de recompensas

Avatares y cosméticos

Fondos y activos digitales

Accesos / cuentos / salas

Cupones WooCommerce <=15%

Motor de acceso + derechos

WooCommerce

Evidencia de regalías

Libro económico separado

Administradores / colegio

Misiones institucionales

KPIs institucionales



Mostrar código
El repositorio auditado ya contiene piezas aprovechables —progreso canónico, MOOK, reglas de acceso y catálogo WooCommerce de lectura— pero no un ledger de gamificación, badges, cupón real ni saldo autoritativo. 
 
 WooCommerce sí proporciona API de cupones con porcentaje, expiración, uso individual, límites totales y por usuario, restricciones por producto y otras condiciones, de modo que técnicamente existe una base adecuada para que Chibalete+ emita cupones desde el servidor sin confiar en el navegador. 

Fundamentos pedagógicos, evidencia y economía de motivación
La gamificación educativa funciona mejor cuando ayuda a que el alumno perciba autonomía, competencia y relación, no cuando convierte la lectura en una cadena de microtransacciones. La teoría de autodeterminación es una de las bases más utilizadas en la investigación de gamificación educativa, y las revisiones recientes encuentran que intervenciones que apoyan autonomía y competencia pueden mejorar variables motivacionales. 
 Por eso, la doctrina debería considerar los PM como una capa secundaria de reconocimiento, no como el motivo principal para leer.

Qué debe contar como evidencia
Propongo clasificar toda fuente potencial en cuatro grados.

Grado	Ejemplo	¿XP?	¿PM?	Recomendación
A — verificada fuerte	obra terminada según progreso canónico; evidencia MOOK aprobada por humano	Sí	Sí, con límites	Fuente primaria
B — verificada estructural	hitos reales de lectura, experiencia completada, actividad de Leo respaldada por evento estructurado	Sí	Sí, menor peso	Admitir con controles
C — probabilística	oralidad automática, inferencia de comprensión, interacción con IA	Tal vez	No inicialmente	Usar para feedback
D — interacción superficial	abrir pantalla, mantener audio activo, clics, rachas rápidas, tiempo en sesión	No	No	Nunca monetizar

La auditoría identifica MOOK como la única fuente con evidencia explícitamente revisable por una persona y el progreso canónico como fuente productiva de finalización; también advierte que el antiguo RewardEngine premiaba bloques y velocidad de interacción, lo que constituye una mala base para un sistema con valor económico. 

Q, R y S
Para aprobar doctrina conviene votar expresamente la relación de Q, R y S con gamificación. Mi recomendación es:

Opción	Uso de Q/R/S	Ventaja	Riesgo	Recomendación
A	Convertir directamente Q/R/S → XP y PM	Simple	Incentiva optimizar una métrica económica; acopla sistemas	Rechazar
B	Usarlos solo como evidencia de elegibilidad	Se aprovecha evidencia fiable sin duplicar economía	Hay que definir umbrales	Preferida
C	No usarlos en gamificación	Separación máxima	Duplica validaciones	Válida si la semántica no encaja
D	Solo Q/R para progreso; nunca S para PM	Buen equilibrio	Requiere contrato formal de significado	Alternativa recomendada

En especial, si S tiene implicaciones económicas o se deriva de variables utilizadas para liquidación, no debería gobernar recompensas canjeables. Esa es una recomendación de arquitectura y control, no una afirmación sobre el significado jurídico de S.

XP frente a Puntos de Magia
La separación recomendada es fuerte:

XP/progreso lector: permanente, monotónico, no transferible, no canjeable, derivado de logros educativos y utilizado para niveles o hitos personales.
Puntos de Magia: gastables, auditables, sujetos a límites, reversibles mediante movimientos compensatorios y con presupuesto.
Logros: no gastables; describen qué se consiguió.
Racha: si existe, debe medir continuidad flexible, no obligar a entrar todos los días ni castigar enfermedad, vacaciones o fines de semana.
Nivel: debe expresar una trayectoria legible y única; nunca volver a reutilizar “nivel” para duración de sesión.
La literatura no justifica tratar más puntos como sinónimo de más aprendizaje; al contrario, los resultados dependen de cómo la mecánica satisface autonomía y competencia. 

Cuestionario doctrinal exhaustivo de decisiones
La siguiente matriz es la parte central de aprobación. Cada fila es una decisión que debe quedar explícita antes de programar. P0 bloquea arquitectura o cumplimiento; P1 bloquea piloto; P2 puede cerrarse durante el piloto.

Estrategia, pedagogía y modelo de progresión
Decisión	Opciones posibles	Recomendación técnica/negocio	Criterio de aceptación	Riesgos / dependencias	Datos necesarios	Responsable	Prioridad
Objetivo principal	A engagement; B aprendizaje/comprensión; C hábito lector; D combinación ponderada	D, pero con aprendizaje/hábito por encima de uso bruto	Todo KPI de uso tiene KPI educativo espejo	Optimizar minutos en vez de lectura	baseline de lectura, retención y finalización	Producto + Pedagogía	P0
Función del XP	A moneda; B progreso permanente; C score social	B	XP nunca puede disminuir ni canjearse	Confusión con PM	distribución histórica de actividad	Producto	P0
Función de PM	A solo simbólico; B moneda digital sin valor comercial; C moneda canjeable híbrida	C gradual, empezando por recompensas digitales	Todo PM tiene emisión y gasto en ledger	coste, fraude, menores	presupuesto y coste por premio	Dirección + Finanzas	P0
Nivel lector	A por XP; B por competencias; C híbrido XP+competencias	C, con requisitos pedagógicos además de volumen	No se puede subir solo repitiendo eventos fáciles	complejidad de reglas	distribución Q/R, lectura y MOOK	Pedagogía + Datos	P0
Rachas	A diaria rígida; B semanal flexible; C eliminar; D racha por metas personales	B o D	no penaliza fines de semana/ausencia; recuperación posible	presión psicológica	patrones reales de uso escolar	Pedagogía	P1
Rankings	A individual global; B por aula; C cooperativo; D ninguno	C, opt-in para mediadores; nunca global infantil	sin exposición pública individual por defecto	comparación y estigma	entrevistas escolares	Pedagogía + Privacidad	P0
Logros	A volumen; B variedad; C dominio; D combinación	D, privilegiando diversidad y dominio	cada logro tiene evidencia definida	coleccionismo vacío	catálogo y taxonomía	Pedagogía	P1
Dificultad	A nivel del usuario; B atributo de obra; C adaptativa; D sin dificultad	B+C	dificultad de obra separada de nivel personal	etiquetado editorial	metadatos de obras	Editorial + Pedagogía	P1

La preferencia por cooperación, elección y progreso personal sobre competición agresiva está alineada con resultados que muestran que el diseño competitivo puede perjudicar ciertos resultados o motivaciones. 

Evidencia, emisión, límites y antifraude
Decisión	Opciones	Recomendación	Criterio de aceptación	Riesgos / dependencias	Datos para decidir	Responsable	Prioridad
Fuentes PM iniciales	A lectura; B MOOK; C Leo; D todas	Lectura validada + MOOK aprobado; Leo solo tras madurez	evento servidor verificable	farming y duplicados	frecuencia por fuente	Producto + Backend	P0
Q/R/S	A conversión directa; B elegibilidad; C ignorar; D parcial	B/D	ninguna fórmula económica controla saldo directamente	acoplamiento regalías	significado contractual exacto	Finanzas + Editorial + Datos	P0
Leo	A texto concede PM; B evento estructurado validado; C sin PM	C al inicio, luego B	modelo nunca decide cantidad	prompt injection	métricas de evidencia de Leo	IA + Pedagogía	P0
Oralidad	A PM directo; B XP; C logro; D feedback	D/C hasta validar precisión	falsos positivos no generan valor	sesgo por acento/discapacidad	evaluación por variedades dialectales	Pedagogía + Accesibilidad	P0
Actividades offline	A autoafirmación; B QR; C docente valida; D evidencia multimedia	C, quizá QR firmado	validación trazable sin fotos obligatorias	carga docente	pilotos colegios	Colegios + Producto	P1
Límite diario	A ninguno; B por fuente; C global; D ambos	D	servidor impide excederlo	frustración / gaming	percentiles de actividad	Producto + Riesgo	P0
Límite semanal	A ninguno; B fijo; C dinámico; D solo PM comerciales	B inicial	<= coste presupuestado por alumno	inflación	simulación de distribución	Finanzas + Producto	P0
Repetición de obra	A siempre paga; B primera vez; C rendimiento decreciente; D ventana	C/D	relectura pedagógica reconocida sin farming	penalizar relectura legítima	tasa de relectura	Pedagogía	P1
Correcciones/reversos	A editar saldo; B movimiento compensatorio; C borrar evento	B	jamás se reescribe historia	saldo negativo temporal	escenarios de soporte	Backend + Auditoría	P0
Anomalías	A bloqueo automático; B revisión; C shadow cap	B + límites automáticos	señales no sancionan sin trazabilidad	falsos positivos	patrones normales	Seguridad + Soporte	P1

Como punto de partida de simulación —no como tarifa aprobada— propongo testar tres políticas semanales:

Política	PM máximos ordinarios/semana	Uso recomendado
Conservadora	120	piloto con riesgo económico
Equilibrada	200	candidata principal
Amplia	300	solo si recompensas son mayormente digitales

El límite definitivo debe surgir de una simulación con distribución real de actividad, coste de recompensas y tasa esperada de canje, no de una cifra estética.

Recompensas, precios y WooCommerce
El marco colombiano de consumo es relevante porque las promociones e incentivos, incluso los sistemas de acumulación de puntos, generan obligaciones sobre información, condiciones y cumplimiento; la SIC señala que las condiciones anunciadas obligan al oferente. 
 Para menores, el comercio electrónico tiene exigencias específicas de edad y autorización parental para la adquisición. 

Decisión	Opciones	Recomendación	Aceptación	Riesgos / dependencias	Datos	Responsable	Prioridad
Catálogo inicial	A cosméticos; B contenido; C cupones; D todo	A primero, B después, C último	entrega efectiva y auditable por familia	derechos y coste	inventario de activos/licencias	Producto + Editorial	P0
Avatares	A gratuitos; B PM; C logros; D mixto	D	no exponen foto real ni identidad	licencias	activos disponibles	Diseño + Legal	P1
Fondos	A descarga; B uso interno; C ambos	B primero	activo accesible solo al propietario	redistribución	licencias	Editorial	P1
Cuentos/capítulos	A permanentes; B temporales; C hasta suscripción; D cortesía	B/D inicialmente	regla de acceso y derechos explícitos	regalías/derechos	contratos editoriales	Editorial + Legal	P0
Salas biblioteca	A cosméticas; B contenido; C funcionales	A/B	servidor aplica acceso, no UI decorativa	complejidad de permisos	diseño de secciones	Producto	P1
Cupones	A 5%; B 10%; C 15%; D escalonados	D: 5/10/15, nunca >15%	uso único y expiración	margen y menores	margen por categoría	Comercial + Finanzas	P0
Emisión Woo	A códigos pregenerados; B API al canjear; C aprobación manual	B, con fallback A	idempotencia local + Woo	disponibilidad Woo	SLA y credenciales	Backend + Ecommerce	P0
Validez cupón	A 7d; B 30d; C 90d; D sin expiración	B candidato	fecha visible antes del canje	quejas por expiración	ciclo de compra	Comercial	P1
Uso	A ilimitado; B uno total; C uno/usuario; D combinación	B+C	usage_limit=1, individual_use y trazabilidad	reenvío de códigos	identidad Woo	Backend	P0

WooCommerce soporta creación de cupones y propiedades como individual_use, usage_limit, usage_limit_per_user, expiración, exclusión de artículos rebajados y restricciones de producto, de manera que estas reglas pueden reforzarse en el sistema de destino además del ledger de Chibalete+. 

Una escala de precios para pilotar, no aprobar todavía, podría ser:

Recompensa	Bajo	Base recomendada para experimento	Alto
Avatar común	60	100 PM	150
Fondo de perfil	80	150 PM	220
Avatar especial	150	250 PM	350
Cuento/capítulo promocional	250	400 PM	600
Sala temática	350	600 PM	900
Cupón 5%	600	800 PM	1.000
Cupón 10%	1.200	1.600 PM	2.000
Cupón 15%	2.000	2.600 PM	3.200

La finalidad del piloto es comprobar si esos precios producen elección significativa sin convertir lectura en trabajo pagado. Si un alumno promedio puede comprar el descuento máximo cada pocas semanas, la moneda probablemente está demasiado inflada.

Persistencia, API, contratos y transacciones
Decisión	Opciones	Recomendación	Criterio de aceptación	Riesgo/dependencia	Datos	Responsable	Prioridad
Fuente de verdad	A cliente; B servidor; C híbrida	B	cliente nunca escribe saldo arbitrario	latencia	arquitectura actual	Arquitectura	P0
Modelo de saldo	A campo mutable; B ledger; C ledger + snapshot	C	saldo derivable del ledger	coste consultas	volumen estimado	Backend	P0
Ledger	A editable; B append-only; C event sourcing completo	B	no UPDATE/DELETE normal	GDPR/retención	volumen	Backend + Legal	P0
Idempotencia	A timestamp; B client UUID; C clave fuente+eventId	C	reintento idéntico produce una sola entrada	calidad IDs	contratos de eventos	Backend	P0
Canje atómico	A restar luego emitir; B reservar→emitir→confirmar; C emitir luego restar	B	fallo Woo no pierde PM	compensaciones	SLA Woo	Backend	P0
Saldo insuficiente	A frontend; B backend; C ambos	C, backend autoritativo	carrera concurrente no sobregasta	locking	tests concurrencia	Backend	P0
API	A RPC genérica; B endpoints dominio; C GraphQL	B	contratos versionados	proliferación endpoints	stack actual	Arquitectura	P1
Historial	A solo saldo; B movimientos; C movimientos + explicación	C	usuario entiende cada cambio	volumen UI	copy UX	UX + Backend	P1
Versionado reglas	A sobrescribir; B ruleVersion por movimiento; C snapshot reglas	B	auditoría histórica reproducible	complejidad	frecuencia cambios	Backend	P1

Contrato conceptual recomendado:

text
Copiar
POST /api/gamification/events/ingest       # solo fuentes internas autorizadas
GET  /api/gamification/me
GET  /api/gamification/me/ledger
GET  /api/gamification/rewards
POST /api/gamification/redemptions
GET  /api/gamification/redemptions/:id
POST /api/gamification/admin/adjustments   # movimiento compensatorio, nunca "set balance"
GET  /api/gamification/schools/:id/missions
POST /api/gamification/schools/:id/missions/:missionId/claim
El principio crítico es que /events/ingest no sea una API pública donde el navegador declara “terminé un libro”. Debe ser invocada desde sistemas ya autorizados después de validar la evidencia.

La transacción de canje recomendada sería:

WooCommerce
Ledger
Gamification API
Usuario
WooCommerce
Ledger
Gamification API
Usuario
alt
[Woo responde OK]
[Woo falla]
POST redemption + idempotency-key
validar saldo + reservar PM
reserva confirmada
crear cupón único <=15%
coupon_id + code
confirmar débito + recompensa
canje confirmado
liberar reserva / compensación
canje no completado, PM intactos


Mostrar código
UI/UX, colegio, privacidad y accesibilidad
Decisión	Opciones	Recomendación	Aceptación	Riesgos/dependencias	Datos	Responsable	Prioridad
Perfil	A solo nivel; B nivel+PM; C dashboard completo	C progresivo	distingue XP/PM/logros claramente	sobrecarga visual	tests usabilidad	UX	P1
Tienda	A catálogo mixto; B pestañas; C tienda PM separada	B	precio real y PM nunca se confunden	confusión	investigación usuarios	UX + Comercial	P1
Historial PM	A oculto; B resumen; C ledger legible	C	motivo, fecha, fuente y estado	privacidad	prototipo	UX	P1
Notificaciones	A toast siempre; B digest; C configurables	C, con low-motion	no bloquean lectura	fatiga	pruebas	UX	P1
Rol estudiante	A canje libre; B límites; C aprobación adulto para comerciales	C para cupones	flujo adulto verificable	fricción	edades y cuentas	Legal + Producto	P0
Rol docente	A concede PM; B valida evidencia; C solo observa	B con permisos limitados	no puede fabricar saldo manualmente	abuso interno	modelo roles	Colegios + Seguridad	P0
Rol coordinador	A todo; B métricas escuela; C misiones	B+C	sin acceso innecesario a detalle personal	minimización	mapa RBAC	Seguridad	P0
Rol familia/acudiente	A ninguno; B consentimiento; C consentimiento + comercio	C cuando aplique	consentimiento auditable y revocable	identidad adulto	proceso actual	Legal	P0
Misiones colegio	A uso; B lectura; C formación docente; D híbridas	D, sin premios económicos personales a funcionarios	evidencia institucional	gaming de métricas	onboarding real	B2B + Pedagogía	P1
Privacidad menores	A estándar adulto; B reforzada por edad; C alta privacidad para todos	C si viable	minimización y defaults privados	personalización	DPIA/PIA	DPO/Legal	P0
Perfil público	A nivel visible; B logros visibles; C privado	C por defecto	exposición solo opt-in autorizado	presión social	entrevistas	Legal + Pedagogía	P0
Accesibilidad	A WCAG 2.1 AA; B WCAG 2.2 AA; C AA + criterios AAA seleccionados	C	teclado, lectores pantalla, contraste, reduced motion, status messages	coste diseño	auditoría a11y	UX + QA	P0

WCAG 2.2 establece requisitos relevantes para una gamificación con toasts, confeti o animación; entre ellos, mensajes de estado accesibles y mecanismos para evitar animaciones desencadenadas por interacción cuando sea necesario. 
 La aplicación ya dispone de algunas piezas que respetan movimiento reducido, según la auditoría, por lo que conviene conservar ese comportamiento durante la migración. 

Para colegios, la doctrina debería gamificar la adopción institucional, no solo al estudiante. Ejemplos de misiones: configurar biblioteca, formar mediadores, activar grupos, realizar primera experiencia MOOK, alcanzar cobertura de lectura, revisar evidencias, celebrar una actividad comunitaria y completar una evaluación de adopción. El objetivo no sería “ganar PM institucionales” necesariamente, sino ofrecer un mapa visible de madurez, badges institucionales y desbloqueos de acompañamiento.

Gobernanza, métricas, piloto, saneamiento y contingencias
Métricas que deben existir antes del lanzamiento
La doctrina no debería aprobar “engagement” como KPI único. Recomiendo un cuadro con cuatro capas:

Capa	KPIs recomendados	Señal de alarma
Pedagógica	obras terminadas con criterio válido, variedad, MOOK aprobado, retorno voluntario a lectura	más PM pero igual/peor comprensión
Motivacional	autonomía percibida, disfrute, competencia percibida, abandono	usuarios leen solo cuando hay recompensa
Económica	PM emitidos, PM gastados, liability teórica, tasa de canje, coste por usuario	inflación o descuento > presupuesto
Integridad	duplicados bloqueados, anomalías, reversos, fallos de Woo, reclamaciones	spikes por fuente/usuario
Equidad	actividad por edad, tipo de colegio, accesibilidad, dispositivo	grupos sistemáticamente penalizados
Institucional	activación docente, grupos activos, misiones completadas, retención del colegio	uso concentrado en un único profesor

La investigación muestra heterogeneidad considerable entre implementaciones de gamificación; por eso un piloto controlado y con métricas de motivación es más defendible que asumir que “más puntos = mejor”. 

Piloto recomendado
Propongo tres cohortes durante un período suficientemente largo para observar novedad y habituación:

Cohorte	Sistema	Propósito
A	progreso + logros, sin PM comerciales	medir efecto del reconocimiento
B	progreso + PM digitales	medir efecto de moneda sin coste comercial
C	progreso + PM digitales + cupones limitados	medir coste, fraude y canje

No recomiendo negar funcionalidad pedagógica esencial al grupo de comparación. La comparación debería centrarse en capas de recompensa, no en acceso educativo.

Los criterios de aceptación del piloto deberían incluir, como mínimo:

ninguna regresión en finalización legítima de lectura;
no aumento material de sesiones sospechosamente repetitivas;
duplicación de emisiones = 0 ante reintentos idénticos;
ningún canje deja saldo debitado sin recompensa o compensación;
error económico máximo definido previamente y auditado;
ausencia de exposición pública no consentida de menores;
satisfacción/claridad de XP frente a PM superior a un umbral acordado;
ningún segmento de usuarios queda materialmente perjudicado por discapacidad, dispositivo o modalidad escolar;
coste comercial por alumno dentro del presupuesto aprobado;
señales de motivación intrínseca no empeoran respecto al baseline.
Scripts de validación que deberían escribirse, pero no ejecutar todavía
bash
Copiar
# 1. Idempotencia: mismo evento 100 veces -> un solo movimiento
node tests/gamification/idempotency.test.mjs

# 2. Carrera de saldo: 20 canjes concurrentes con saldo para uno
node tests/gamification/redemptionConcurrency.test.mjs

# 3. Reversión Woo: fallo de emisión -> PM disponibles de nuevo
node tests/gamification/wooCompensation.test.mjs

# 4. Ledger: saldo materializado == suma de movimientos
node tests/gamification/ledgerInvariant.test.mjs

# 5. Privilegios: estudiante/docente/admin no exceden RBAC
node tests/gamification/rbac.test.mjs

# 6. Fuente de evidencia: cliente no puede autootorgarse XP/PM
node tests/gamification/sourceAuthority.test.mjs

# 7. Regalías: eventos de gamificación no crean movimientos económicos editoriales
node tests/gamification/royaltyIsolation.test.mjs

# 8. Derechos: desbloqueo solo cuando existe regla/autorización válida
node tests/gamification/rewardAccessRights.test.mjs

# 9. Woo: cupón <=15%, uso único, expiración y producto permitido
node tests/gamification/wooCouponPolicy.test.mjs

# 10. Accesibilidad: no depende de animación y status messages anunciables
npm run test:a11y:gamification
También escribiría pruebas de propiedad, por ejemplo: “para cualquier secuencia de emisiones, reservas, canjes y compensaciones, el saldo nunca diverge de la suma del ledger”; “un sourceEventId nunca puede acreditar dos veces”; y “ningún endpoint de cliente acepta un monto arbitrario positivo”.

Plan de saneamiento del legado
La auditoría interna ya señala los candidatos concretos para retirada: Trivia actual y su generador, las funciones antiguas de puntos ya neutralizadas, AdminRecompensas legado, storeOrders, campos sin uso como racha_dias/immersive_level, referencias de coste en puntos y el panel escolar con datos simulados. 

La limpieza no debe hacerse toda a la vez. Recomiendo este orden:

Ola	Acción	Condición previa
G4A	introducir motor nuevo detrás de flag OFF	doctrina aprobada
G4A.1	doble lectura comparativa sin mostrar saldo	ledger estable
G4A.2	UI nueva de perfil/historial	contratos API congelados
G4B.1	eliminar Trivia y generador	rutas sin tráfico relevante
G4B.2	eliminar funciones addPoints/canjes legado	ningún consumidor
G4B.3	retirar campos y páginas muertas	migración y grep limpio
G4B.4	reformular niveles inmersivos como duración de sesión	UX aprobada
G4B.5	sustituir métricas escolares simuladas	métricas reales disponibles

Gobernanza y presupuesto
Decisión	Opciones	Recomendación	Aceptación	Riesgo	Datos	Responsable	Prioridad
Owner doctrina	Producto; Pedagogía; comité	Comité con un owner ejecutivo	RACI aprobado	decisiones bloqueadas	organigrama	Dirección	P0
Cambios a PM	libre; release; comité	change control mensual/urgente	toda regla versionada	inflación	telemetría	Producto + Finanzas	P0
Presupuesto	ilimitado; por usuario; bolsa mensual	bolsa + techo usuario	peor caso modelado	sobrecoste	cohortes y margen	Finanzas	P0
Descuentos	dinámicos; fijos; campaña	tiers 5/10/15	nunca >15%	erosión margen	margen Woo	Comercial	P0
Caducidad PM	nunca; anual; por inactividad	no caducar en menores durante piloto	política clara	pasivo acumulado	simulación	Legal + Finanzas	P1
Cambios de regla	retroactivos; prospectivos; mixtos	prospectivos	ledger conserva ruleVersion	inequidad histórica	auditoría	Producto	P0
Soporte	sin disputas; ticket; docente	ticket con auditoría	SLA y trazabilidad	abuso	capacidad soporte	Operaciones	P1
Kill switch	no; por recompensa; global	ambos	se puede parar emisión/canje sin parar lectura	operación	runbook	SRE	P0

Rollback y contingencias
La gamificación debe poder fallar sin impedir leer. Si el motor de PM, WooCommerce o el ledger están indisponibles, el usuario debe poder seguir accediendo a biblioteca, lectura, progreso canónico y MOOK. Esa separación es coherente con la arquitectura actual identificada en las auditorías. 

Estados recomendados:

GAMIFICATION_ENABLED=false: todo oculto, lectura normal.
PM_EARNING_ENABLED=false: se muestran saldos/historiales, no se emite.
PM_REDEMPTION_ENABLED=false: se puede ganar pero no canjear; UI explica indisponibilidad.
COMMERCIAL_REWARDS_ENABLED=false: cosméticos y contenido sí; cupones no.
WOO_COUPONS_ENABLED=false: no se inicia ningún débito definitivo.
SCHOOL_MISSIONS_ENABLED=false: elimina capa institucional sin afectar alumnos.
Nunca recomiendo rollback por edición destructiva del ledger. El rollback económico debe ser mediante movimientos compensatorios.

Roadmap mínimo
2026-11-01
2026-12-01
2027-01-01
2027-02-01
2027-03-01
2027-04-01
Aprobación decisiones y DPIA
Derechos y política comercial
Contratos + ledger + idempotencia
Motor de evidencia y XP
Perfil + historial
Misiones institucionales
Cosméticos digitales
Accesos y contenido autorizado
Piloto controlado
WooCommerce <=15%
Evaluación y recalibración
Saneamiento G4B
Doctrina
Núcleo
Recompensas
Colegios
Calidad
Legado
Roadmap mínimo propuesto de gamificación


Mostrar código
Este timeline es una propuesta de secuenciación, no un compromiso de fechas. La prioridad es que el primer piloto pueda operar solo con recompensas digitales; el sistema de cupones debe llegar después de demostrar integridad de ledger, antifraude y protección de menores.

Cuestionario final listo para votación de stakeholders
La tabla siguiente está diseñada para convertirse directamente en acta. El voto sugerido no sustituye la aprobación del comité.

ID	Decisión	A	B	C	D	Recomendación	Voto
D01	Objetivo primario	Engagement	Aprendizaje	Hábito	Mixto	D	☐A ☐B ☐C ☐D
D02	XP	Gastable	Permanente	Ranking	—	B	☐A ☐B ☐C
D03	PM	Simbólico	Digital	Híbrido comercial	—	C gradual	☐A ☐B ☐C
D04	Nivel	XP	Competencias	Híbrido	—	C	☐A ☐B ☐C
D05	Racha	Diaria	Semanal flexible	Sin racha	Meta personal	B/D	☐A ☐B ☐C ☐D
D06	Ranking alumnos	Global	Aula	Cooperativo	Ninguno	C/D	☐A ☐B ☐C ☐D
D07	Q/R/S	PM directo	Elegibilidad	Ignorar	Parcial	B/D	☐A ☐B ☐C ☐D
D08	Lectura finalizada da PM	Sí siempre	Primera vez	Rendimiento decreciente	No	C	☐A ☐B ☐C ☐D
D09	MOOK aprobado da PM	Sí	Solo XP	Solo logro	No	A	☐A ☐B ☐C ☐D
D10	Leo da PM	Texto IA	Evento validado	Nunca	—	C inicialmente	☐A ☐B ☐C
D11	Oralidad da PM	Sí	XP	Logro	Feedback	D/C	☐A ☐B ☐C ☐D
D12	Offline	Autoafirma	QR	Docente valida	Multimedia	C	☐A ☐B ☐C ☐D
D13	Límite PM	Ninguno	Diario	Semanal	Diario+semanal	D	☐A ☐B ☐C ☐D
D14	Tope piloto semanal	120	200	300	Otro	B	☐A ☐B ☐C ☐D
D15	Avatares	Gratis	PM	Logros	Mixto	D	☐A ☐B ☐C ☐D
D16	Fondos	Descargar	Solo perfil	Ambos	—	B inicial	☐A ☐B ☐C
D17	Contenido premio	Permanente	Temporal	Hasta suscripción	Cortesía	B/D	☐A ☐B ☐C ☐D
D18	Salas	Cosmética	Contenido	Funcional	—	A/B	☐A ☐B ☐C
D19	Cupones	5%	10%	15%	Escalonados	D	☐A ☐B ☐C ☐D
D20	Precio cupón 5%	600	800	1000	Otro	B piloto	☐A ☐B ☐C ☐D
D21	Precio cupón 10%	1200	1600	2000	Otro	B piloto	☐A ☐B ☐C ☐D
D22	Precio cupón 15%	2000	2600	3200	Otro	B piloto	☐A ☐B ☐C ☐D
D23	Emisión Woo	Pregenerado	API	Manual	—	B + fallback A	☐A ☐B ☐C
D24	Vigencia cupón	7 días	30	90	Sin vencimiento	B	☐A ☐B ☐C ☐D
D25	Fuente de verdad	Cliente	Servidor	Híbrida	—	B	☐A ☐B ☐C
D26	Saldo	Campo mutable	Ledger	Ledger+snapshot	—	C	☐A ☐B ☐C
D27	Ledger	Editable	Append-only	Event sourcing total	—	B	☐A ☐B ☐C
D28	Idempotencia	Timestamp	UUID cliente	source+eventId	—	C	☐A ☐B ☐C
D29	Canje	Débito→Woo	Reserva→Woo→confirmación	Woo→débito	—	B	☐A ☐B ☐C
D30	Reversos	Editar saldo	Compensación	Borrar evento	—	B	☐A ☐B ☐C
D31	Perfil	Nivel	Nivel+PM	Completo	—	C progresivo	☐A ☐B ☐C
D32	Historial	Ninguno	Resumen	Movimientos explicados	—	C	☐A ☐B ☐C
D33	Notificaciones	Siempre	Digest	Configurables	—	C	☐A ☐B ☐C
D34	Privacidad perfil menor	Público	Colegio	Privado	Opt-in	C + D excepcional	☐A ☐B ☐C ☐D
D35	Comercio menor	Libre	Tope	Autorización adulto	Sin cupones	C	☐A ☐B ☐C ☐D
D36	Docente	Da PM	Valida evidencia	Solo observa	—	B	☐A ☐B ☐C
D37	Coordinador	Ve individuos	KPIs agregados	KPIs+misiones	—	C	☐A ☐B ☐C
D38	Misiones colegio	Uso	Lectura	Formación	Mixtas	D	☐A ☐B ☐C ☐D
D39	Privacidad base	Adulto	Por edad	Alta para todos	—	C	☐A ☐B ☐C
D40	Accesibilidad	WCAG 2.1 AA	WCAG 2.2 AA	2.2 AA + AAA selectivo	—	C	☐A ☐B ☐C
D41	KPI principal	Tiempo	Finalización	Comprensión	Cuadro balanceado	D	☐A ☐B ☐C ☐D
D42	Piloto	Todo	Digital primero	Cupones primero	—	B	☐A ☐B ☐C
D43	Legacy Trivia	Mantener	Reformar	Eliminar	—	C	☐A ☐B ☐C
D44	Legacy niveles inmersivos	Mantener	Sesión configurable	Eliminar temporizador	—	B	☐A ☐B ☐C
D45	Código muerto PM	Mantener	Marcar deprecated	Eliminar tras migración	—	C	☐A ☐B ☐C
D46	Presupuesto PM	Sin techo	Por usuario	Bolsa mensual	Ambos	D	☐A ☐B ☐C ☐D
D47	Caducidad PM	Nunca	Anual	Inactividad	—	A piloto	☐A ☐B ☐C
D48	Cambios de reglas	Retroactivos	Prospectivos	Mixtos	—	B	☐A ☐B ☐C
D49	Kill switch	Global	Por módulo	Ambos	Ninguno	C	☐A ☐B ☐C ☐D
D50	Owner doctrina	Producto	Pedagogía	Comité	Comité + owner ejecutivo	D	☐A ☐B ☐C ☐D
D51	Derechos contenido-premio	Derechos actuales	Nuevo permiso	Solo contenido propio	Sin contenido premio	B o C	☐A ☐B ☐C ☐D
D52	Regalías de contenidos premio	Siempre cuentan	Nunca	Por commercialClass/acuerdo	Caso manual	C	☐A ☐B ☐C ☐D
D53	Datos históricos locales	Migrar	Ignorar	Mostrar como legado	Conversión parcial	B salvo evidencia fiable	☐A ☐B ☐C ☐D
D54	Solicitudes antiguas	Migrar	Borrar cliente	Informar y cerrar	Revisar manualmente	C	☐A ☐B ☐C ☐D
