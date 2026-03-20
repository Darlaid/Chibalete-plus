/**
 * useAccessCheck — Fase Hardening E2
 *
 * Hook de preflight de acceso a contenido.
 * Consulta el endpoint server-side GET /api/content/:id/access?userId=...
 * ANTES de que el visor de contenido se renderice.
 *
 * Estados posibles:
 *  - { status: 'checking' }   → esperando respuesta del servidor
 *  - { status: 'allowed' }    → acceso concedido
 *  - { status: 'denied', reason } → acceso denegado (el visor NO debe renderizarse)
 *  - { status: 'error', reason }  → error de red (comportamiento conservador: denegar)
 */

import { useEffect, useState } from 'react';

type AccessStatus = 'checking' | 'allowed' | 'denied' | 'error';

interface AccessCheckResult {
    status: AccessStatus;
    reason?: string;
}

export function useAccessCheck(contentId: string, userId: string | undefined): AccessCheckResult {
    const [result, setResult] = useState<AccessCheckResult>({ status: 'checking' });

    useEffect(() => {
        // Reset a "checking" cada vez que cambia el contenido o usuario
        setResult({ status: 'checking' });

        // Sin usuario autenticado: denegar de forma conservadora
        if (!userId) {
            setResult({ status: 'denied', reason: 'No hay usuario autenticado.' });
            return;
        }

        let cancelled = false;

        const checkAccess = async () => {
            try {
                const res = await fetch(`/api/content/${encodeURIComponent(contentId)}/access?userId=${encodeURIComponent(userId)}`, {
                    headers: {
                        // Anti-spoofing (Micro-Parche E2): el servidor valida que este header
                        // coincide con el query param userId. Un atacante que inyecte un userId
                        // ajeno en la URL también tendría que controlar este header, lo que
                        // requiere que el fetch lo emita el propio cliente autenticado.
                        'x-user-id': userId,
                    },
                });
                if (cancelled) return;

                const data = await res.json();
                if (cancelled) return;

                if (data.allowed === true) {
                    setResult({ status: 'allowed' });
                } else {
                    setResult({ status: 'denied', reason: data.reason || 'Acceso no autorizado.' });
                }
            } catch (err) {
                if (!cancelled) {
                    // Error de red: conservadoramente bloquear render
                    console.error('[useAccessCheck] Error de red al verificar acceso:', err);
                    setResult({ status: 'error', reason: 'No se pudo verificar el acceso. Intenta de nuevo.' });
                }
            }
        };

        checkAccess();

        return () => { cancelled = true; };
    }, [contentId, userId]);

    return result;
}
