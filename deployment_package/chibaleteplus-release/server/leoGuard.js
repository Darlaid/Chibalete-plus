// Validates domain and basic constraints
export const validateLeoRequest = (contentId, chunkIndex, interactionType, payload, exactSentence) => {
    if (!contentId || chunkIndex === undefined || !interactionType || !payload || !exactSentence) {
        throw new Error('Faltan parámetros requeridos para Leo.');
    }
    
    if (payload.length > 250) {
        throw new Error('Parámetros de Leo exceden longitud permitida.');
    }

    if (!['vocab', 'question'].includes(interactionType)) {
        throw new Error('Tipo de interacción no permitida en este dominio clausurado.');
    }

    const lowerPayload = payload.toLowerCase();
    const bannedKeywords = [
        'videojuego', 'videojuegos', 'fortnite', 'minecraft', 'roblox',
        'politica', 'política', 'matematicas', 'pelicula', 'dame un resumen completo', 
        'hazme la tarea', 'ignora las instrucciones', 'prompt'
    ];
    
    if (bannedKeywords.some(keyword => lowerPayload.includes(keyword))) {
        throw new Error('Pregunta fuera del dominio autorizado del libro.');
    }

    return true;
};
