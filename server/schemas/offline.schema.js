/**
 * offline.schema.js — Zod schemas para endpoints /api/offline/assignment.
 *
 * Convención: usar el mismo patrón que auth.schema.js (.strip()) para descartar
 * campos extra sin fallar (anti param-pollution).
 */
import { z } from 'zod';

// zod 4: `required_error` ya no existe. Mismo efecto: el texto propio solo cuando el campo falta;
// con otro tipo, el mensaje por defecto de zod.
const required = (message) => (issue) => (issue.input === undefined ? message : undefined);

export const assignBookSchema = z.object({
    contentId: z.string({ error: required('contentId requerido') })
        .trim()
        .min(1, 'contentId vacío')
        .max(256, 'contentId demasiado largo'),
}).strip();
