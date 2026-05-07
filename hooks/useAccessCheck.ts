/**
 * useAccessCheck — Fase Hardening E2 + UX-3B.
 *
 * Hook de preflight de acceso a contenido.
 * Consulta el endpoint server-side GET /api/content/:id/access?userId=...
 * ANTES de que el visor de contenido se renderice.
 *
 * Estados posibles:
 *  - { status: 'checking' }       → esperando respuesta del servidor
 *  - { status: 'allowed' }        → acceso concedido
 *  - { status: 'denied', reason } → acceso denegado (403, denegación legítima)
 *  - { status: 'error',  reason } → error técnico (5xx, red caída, sesión inválida)
 *
 * UX-3B — diferenciación 'denied' vs 'error':
 *   El servidor distingue ahora entre denegación real (HTTP 403) y error
 *   técnico (HTTP 500 + errorCode 'ACCESS_CHECK_FAILED'). El frontend
 *   refleja eso: 'denied' es el "no tienes acceso" (sin acción del user),
 *   'error' es el "no pudimos verificar, intenta de nuevo" (con retry).
 *   Antes: ambos colapsaban a 'denied' silenciosamente.
 */

import { useCallback, useEffect, useState } from 'react';

type AccessStatus = 'checking' | 'allowed' | 'denied' | 'error';

interface AccessCheckResult {
    status: AccessStatus;
    reason?: string;
    /**
     * UX-3B — re-disparar el preflight sin recargar la página. El consumidor
     * lo conecta al botón "Reintentar" cuando el status es 'error'. No tiene
     * efecto en estados 'allowed'/'denied' (siempre dispara el effect, pero
     * el resultado vuelve a converger).
     */
    retry: () => void;
}

export function useAccessCheck(contentId: string, userId: string | undefined): AccessCheckResult {
    const [result, setResult]   = useState<Omit<AccessCheckResult, 'retry'>>({ status: 'checking' });
    const [retryNonce, setNonce] = useState(0);
    const retry = useCallback(() => setNonce(n => n + 1), []);

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

                const data = await res.json().catch(() => ({}));
                if (cancelled) return;

                // UX-3B — diferenciación por status:
                //   2xx + allowed:true   → allowed
                //   403 + allowed:false  → denied   (denegación legítima)
                //   5xx / 401 / 400      → error    (técnico, ofrece retry)
                //   2xx + allowed:false  → denied   (compat, no debería ocurrir)
                if (res.ok && data.allowed === true) {
                    setResult({ status: 'allowed' });
                } else if (res.status === 403) {
                    setResult({
                        status: 'denied',
                        reason: data.reason || 'No tienes acceso a este contenido.',
                    });
                } else if (!res.ok) {
                    // 5xx / 401 / 400 / etc. — error técnico, no permiso real.
                    setResult({
                        status: 'error',
                        reason: data.reason || 'No pudimos verificar tu acceso. Intenta de nuevo.',
                    });
                } else {
                    // res.ok pero allowed:false — fallback defensivo.
                    setResult({
                        status: 'denied',
                        reason: data.reason || 'Acceso no autorizado.',
                    });
                }
            } catch (err) {
                if (!cancelled) {
                    // fetch lanzó (red caída, DNS, etc.) — error técnico.
                    console.error('[useAccessCheck] Error de red al verificar acceso:', err);
                    setResult({ status: 'error', reason: 'No pudimos verificar tu acceso. Intenta de nuevo.' });
                }
            }
        };

        checkAccess();

        return () => { cancelled = true; };
    }, [contentId, userId, retryNonce]);

    return { ...result, retry };
}
