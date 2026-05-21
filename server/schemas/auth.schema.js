/**
 * auth.schema.js — P0.4 esquemas zod para endpoints de autenticación.
 *
 * PRINCIPIO DE SEGURIDAD SIN ROMPER LOGIN:
 *   En /login NO se valida formato/complejidad estricta. Validar `.email()`
 *   estricto o reglas de password en el LOGIN bloquearía cuentas legacy
 *   válidas (emails no-RFC, passwords cortas heredadas) → catastrófico.
 *   Acá solo se acota tipo + presencia + longitud sana + trim: esto frena
 *   inyección/DoS por payload anómalo SIN cambiar la semántica de auth.
 *   La complejidad de password va en registro/reset, no en login (P1).
 */
import { z } from 'zod';

export const loginSchema = z.object({
    email: z.string({ required_error: 'email requerido' })
        .trim()
        .min(3, 'email demasiado corto')
        .max(254, 'email demasiado largo'),
    password: z.string({ required_error: 'password requerido' })
        .min(1, 'password requerido')
        .max(512, 'password demasiado largo'),
}).strip();   // descarta campos extra (anti param-pollution) sin fallar

export const resetRequestSchema = z.object({
    email: z.string({ required_error: 'email requerido' })
        .trim()
        .min(3)
        .max(254),
}).strip();

// Confirmación de reset: acá SÍ corresponde un piso de longitud de password
// (es donde se setea la nueva). Mantener laxo en caracteres permitidos.
export const resetConfirmSchema = z.object({
    token: z.string({ required_error: 'token requerido' }).min(10).max(512),
    password: z.string({ required_error: 'password requerido' })
        .min(8, 'mínimo 8 caracteres')
        .max(512),
}).strip();
