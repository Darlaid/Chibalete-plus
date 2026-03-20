import { runHybridTask } from './aiEngine.js';

export const askAI = async (systemPrompt, userPayload, exactSentence) => {
    try {
        const fullPrompt = `PASAJE ACTUAL DEL LIBRO: "${exactSentence}"\n\nPREGUNTA DEL ESTUDIANTE: ${userPayload}`;
        
        const payload = {
            messages: [{ role: 'user', content: fullPrompt }],
            systemInstruction: systemPrompt
        };

        const result = await runHybridTask('chat', payload);
        
        if (!result || !result.data) {
             return "¡Ups! Leo se quedó pensando. ¿Podrías preguntarme de nuevo?";
        }

        return result.data.trim();
    } catch (error) {
        console.error("Error en leoResponder:", error);
        return "Tengo un problemita técnico, pero sigue leyendo, ¡lo estás haciendo genial!";
    }
};
