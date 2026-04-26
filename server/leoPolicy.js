/**
 * leoPolicy.js — System Prompt Assembly
 *
 * Builds the Leo system prompt from a structured context packet.
 * Each section is only included when its content is non-empty.
 * Graceful fallback: missing context is explicitly noted or omitted.
 */

const section = (heading, content) =>
    content ? `\n${heading}:\n${content}` : '';

const formatAnchors = (anchors) => {
    if (!Array.isArray(anchors) || anchors.length === 0) return null;
    return anchors.map(a => {
        const parts = [];
        if (a.type) parts.push(`[${a.type}]`);
        if (a.anchor) parts.push(`"${a.anchor}"`);
        if (a.explanation) parts.push(a.explanation);
        return parts.join(' — ');
    }).join('\n');
};

const formatVocabulary = (vocab) => {
    if (!Array.isArray(vocab) || vocab.length === 0) return null;
    return vocab.map(v => {
        if (typeof v === 'string') return v;
        if (v.word && v.meaning) return `${v.word}: ${v.meaning}`;
        return JSON.stringify(v);
    }).join('\n');
};

const formatMemory = (memoryContext) => {
    if (!memoryContext) return null;
    const parts = [];
    
    if (memoryContext.sessionProgress > 0)
        parts.push(`- El lector ya ha avanzado un ${memoryContext.sessionProgress}% en esta sesión. Muestra sutilmente que sabes que continúa su lectura.`);
    
    if (memoryContext.lastQuestionType === 'vocab')
        parts.push(`- Su última interacción fue de vocabulario. Mantén un tono didáctico enfocado en el léxico si la pregunta es ambigua.`);
    else if (memoryContext.lastQuestionType === 'inferential')
        parts.push(`- Su última interacción fue inferencial. Fomenta la exploración de causas, motivaciones y significados implícitos.`);
    else if (memoryContext.lastQuestionType === 'reflection')
        parts.push(`- Su última interacción fue reflexiva. Invita a conectar el texto con experiencias propias o valoraciones personales.`);
    else if (memoryContext.lastQuestionType === 'question')
        parts.push(`- Su última interacción fue una pregunta sobre el texto. Mantén el hilo de curiosidad y exploración analítica.`);
        
    if (memoryContext.anchorCount > 0)
        parts.push(`- Ya ha explorado ${memoryContext.anchorCount} nota(s) o contexto(s) en esta sesión. Reconoce su esfuerzo exploratorio si viene al caso.`);
        
    return parts.length > 0 ? "Instrucciones de contexto temporal:\n" + parts.join('\n') : null;
};
const DIFFICULTY_LABELS = {
    inicial:  'Inicial (apoya comprensión literal, vocabulario básico)',
    medio:    'Medio (vocabulario e inferencias balanceados)',
    avanzado: 'Avanzado (promueve reflexión crítica y análisis profundo)',
};

const STAGE_LABELS = {
    comprehension:  'Comprensión — El lector está entrando al texto. Prioriza verificar la comprensión literal y el vocabulario.',
    interpretation: 'Interpretación — El lector ya conoce el texto. Invita a inferencias, conexiones y significados implícitos.',
    reflection:     'Reflexión — El lector ha avanzado significativamente. Promueve reflexión crítica y evaluación del texto.',
    creation:       'Creación — El lector está cerca del final. Anima una pequeña producción de ideas, síntesis o escritura propia.',
};

/**
 * formatTrajectory — builds the TRAYECTORIA PEDAGÓGICA section.
 * Includes stage guidance + orality history + reader tendency hints.
 */
const formatTrajectory = (pedagogicalStage, readerProfile) => {
    const stageLabel = STAGE_LABELS[pedagogicalStage] ?? STAGE_LABELS['comprehension'];
    const parts = [`Etapa actual: ${stageLabel}`];

    if (readerProfile) {
        if (readerProfile.oralityAttemptsCount > 0) {
            const scoreStr = readerProfile.averageOralityScore !== null
                ? ` con promedio de ${readerProfile.averageOralityScore}%`
                : '';
            parts.push(`El estudiante ha realizado ${readerProfile.oralityAttemptsCount} lectura(s) oral(es)${scoreStr}. Considera apoyar la fluidez y pronunciación si es oportuno.`);
        }
        if (readerProfile.preferredSupportType === 'vocabulary') {
            parts.push('Tendencia: este lector frecuentemente necesita apoyo de vocabulario. Usa definiciones claras y ejemplos cotidianos.');
        } else if (readerProfile.preferredSupportType === 'inferential') {
            parts.push('Tendencia: este lector hace frecuentes preguntas de comprensión. Fomenta la autonomía inferencial progresivamente.');
        } else if (readerProfile.preferredSupportType === 'reflection') {
            parts.push('Tendencia: este lector frecuentemente abre anclas de reflexión. Puede tolerar preguntas más profundas.');
        }
    }

    return parts.join('\n');
};

/**
 * formatTransitionalContext — builds the CONTEXTO DE MEDIACIÓN (FASE 4) section.
 */
const formatTransitionalContext = (ctx) => {
    if (!ctx) return null;
    const parts = [];
    if (ctx.isAssignedContext) {
        parts.push("El estudiante está leyendo este contenido como parte de una asignación formal activa.");
    } else {
        parts.push("El estudiante está explorando este contenido de forma libre (fuera de asignaciones).");
    }
    
    if (ctx.groupType) {
        parts.push(`Institución / Espacio: ${ctx.groupType === 'club' ? 'Club de lectura recreativo' : 'Curso escolar estructurado'}.`);
    }
    if (ctx.mediatorKind) {
        const kinds = {
            'teacher': 'Profesor(a) titular',
            'librarian': 'Bibliotecario(a)',
            'coordinator': 'Coordinador(a) académico(a)',
            'parent': 'Familiar / Tutor'
        };
        parts.push(`Figura mediadora principal: ${kinds[ctx.mediatorKind] || 'Docente'}.`);
    }
    if (ctx.organizationName) {
        parts.push(`Colegio o núcleo: ${ctx.organizationName}.`);
    }
    
    return parts.join(' ');
};

/**
 * buildSystemPrompt — assembles the Leo system prompt from a structured context packet.
 *
 * @param {object} contextPacket — from buildLeoContextPacket()
 * @returns {string} system prompt
 */
export const buildSystemPrompt = (contextPacket) => {
    // Handle legacy string input (backward compat)
    if (typeof contextPacket === 'string') {
        return `Eres Leo, un amigable y estricto mediador pedagógico de lectura de Chibalete+ para niños.

REGLAS OBLIGATORIAS E INQUEBRANTABLES:
1. SOLO puedes responder basándote en el fragmento o datos autorizados proveídos en el contexto.
2. NO eres un chatbot general. NO puedes hablar de videojuegos, tareas externas, política, o matemáticas.
3. Si la pregunta del niño está fuera del texto o es irrelevante, DEBES redirigirlo a la lectura.
4. Tu respuesta debe ser EXTREMADAMENTE BREVE: Máximo 2 a 3 frases.
5. Usa un lenguaje claro, alentador y adecuado para lectores jóvenes.
6. Contexto autorizado: ${contextPacket}

ACTÚA SIEMPRE COMO MEDIADOR DE DOMINIO CERRADO. NUNCA SALGAS DE TU PERSONAJE.`;
    }

    const {
        anchorsContext,
        pedagogicalContext,
        memoryContext,
        difficultyLevel,
        pedagogicalStage,
        readerProfile,
        transitionalContext,
    } = contextPacket;

    // --- Assemble each context section ---
    const anchorsText    = formatAnchors(anchorsContext?.anchors);
    const vocabularyText = formatVocabulary(anchorsContext?.vocabulary);

    const hasPedagogical = Boolean(
        pedagogicalContext?.guide ||
        pedagogicalContext?.authorBio ||
        pedagogicalContext?.historical ||
        pedagogicalContext?.literary
    );

    const pedagogicalBlock = hasPedagogical
        ? [
            pedagogicalContext.guide      ? `Guía pedagógica: ${pedagogicalContext.guide}` : null,
            pedagogicalContext.authorBio  ? `Autor/a: ${pedagogicalContext.authorBio}` : null,
            pedagogicalContext.historical ? `Contexto histórico: ${pedagogicalContext.historical}` : null,
            pedagogicalContext.literary   ? `Notas literarias: ${pedagogicalContext.literary}` : null,
          ].filter(Boolean).join('\n')
        : 'Contexto pedagógico no disponible para este libro.';

    const memoryText      = formatMemory(memoryContext);
    const difficultyLabel = DIFFICULTY_LABELS[difficultyLevel] ?? DIFFICULTY_LABELS['medio'];
    const trajectoryText  = formatTrajectory(pedagogicalStage, readerProfile);
    const transitionalText = formatTransitionalContext(transitionalContext);

    // --- Build the structured prompt ---
    const contextBlock = [
        section('CONTEXTO PEDAGÓGICO DEL LIBRO', pedagogicalBlock),
        section('CONTEXTO DE MEDIACIÓN (FASE 4)', transitionalText),
        section('ANCLAS CONTEXTUALES DEL FRAGMENTO ACTUAL', anchorsText),
        section('VOCABULARIO DEL FRAGMENTO ACTUAL', vocabularyText),
        section('MEMORIA DE SESIÓN', memoryText),
        section('NIVEL DEL LECTOR', difficultyLabel),
        section('TRAYECTORIA PEDAGÓGICA', trajectoryText),
    ].filter(Boolean).join('\n');

    return `Eres Leo, un amigable y estricto mediador pedagógico de lectura de Chibalete+ para niños.

REGLAS OBLIGATORIAS E INQUEBRANTABLES:
1. SOLO puedes responder basándote en el fragmento o datos autorizados proveídos en el contexto.
2. NO eres un chatbot general. NO puedes hablar de videojuegos, tareas externas, política, o matemáticas.
3. Si la pregunta del niño está fuera del texto o es irrelevante, DEBES redirigirlo a la lectura (ej. "¡Buena pregunta! Pero ahora concentrémonos en nuestra historia...").
4. Tu respuesta debe ser EXTREMADAMENTE BREVE: Máximo 2 a 3 frases.
5. Usa un lenguaje claro, alentador y adecuado para lectores jóvenes.
6. Adapta tu respuesta al nivel y etapa pedagógica indicados a continuación.
${contextBlock}

ACTÚA SIEMPRE COMO MEDIADOR DE DOMINIO CERRADO. NUNCA SALGAS DE TU PERSONAJE.`;
};
