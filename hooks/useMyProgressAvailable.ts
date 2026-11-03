/**
 * useMyProgressAvailable — CHP-GAMIFICACION-G4-UX-U3.
 *
 * ¿Mostrar el acceso «Mi progreso»? Solo si `GET /api/me/progress` responde
 * `{ enabled: true }` para la persona de la sesión. Con gamificación o XP
 * apagados (404 / `enabled:false`), error o sin sesión, no hay enlace.
 * La respuesta no se guarda en ningún almacenamiento: vive en memoria y se
 * vuelve a pedir al cambiar de usuario. `active=false` no pide nada (p. ej.
 * un perfil ajeno).
 */
import { useEffect, useState } from 'react';
import { dataService } from '../services/dataService';
import { classifyProgressResponse } from '../utils/myProgressView.mjs';

export function useMyProgressAvailable(userId: string | null | undefined, active = true): boolean {
    const [available, setAvailable] = useState(false);
    useEffect(() => {
        setAvailable(false);
        if (!userId || !active) return;
        let alive = true;
        dataService.getMyProgress().then(({ status, body }) => {
            if (alive) setAvailable(classifyProgressResponse(status, body).kind === 'ok');
        });
        return () => { alive = false; };
    }, [userId, active]);
    return available;
}
