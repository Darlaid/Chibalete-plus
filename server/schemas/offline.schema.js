/**
 * offline.schema.js — Zod schemas para endpoints /api/offline/assignment.
 *
 * Convención: usar el mismo patrón que auth.schema.js (.strip()) para descartar
 * campos extra sin fallar (anti param-pollution).
 */
import { z } from 'zod';

export const assignBookSchema = z.object({
    contentId: z.string({ required_error: 'contentId requerido' })
        .trim()
        .min(1, 'contentId vacío')
        .max(256, 'contentId demasiado largo'),
}).strip();
