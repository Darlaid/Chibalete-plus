import React, { useState } from 'react';
import { Lock, Eye, EyeOff, CheckCircle, AlertCircle, Shield } from 'lucide-react';
import { dataService } from '../services/dataService';

// SEC-ACCOUNT-01 — Perfil → Seguridad: cambio de la contraseña PROPIA.
// El servidor es la autoridad (identidad por sesión, bcrypt, política, revocación
// de todas las sesiones). Aquí solo hay validación de cortesía y el cierre de
// sesión local tras el éxito. Los valores nunca se guardan ni se registran.
export const SELF_PASSWORD_MIN_LENGTH = 12;
const LOGOUT_DELAY_MS = 3500;

const PasswordField: React.FC<{
    id: string; label: string; value: string; onChange: (v: string) => void;
    autoComplete: string; visible: boolean; onToggle: () => void;
}> = ({ id, label, value, onChange, autoComplete, visible, onToggle }) => (
    <div>
        <label htmlFor={id} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
        <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                <Lock className="h-5 w-5 text-gray-400" aria-hidden="true" />
            </span>
            <input
                id={id}
                type={visible ? 'text' : 'password'}
                className="w-full pl-10 pr-10 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50 dark:bg-gray-700 dark:text-white"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                autoComplete={autoComplete}
                required
            />
            <button
                type="button"
                onClick={onToggle}
                aria-label={visible ? `Ocultar ${label.toLowerCase()}` : `Mostrar ${label.toLowerCase()}`}
                aria-pressed={visible}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
            >
                {visible ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
        </div>
    </div>
);

const PasswordChangeSection: React.FC<{ onChanged: () => void }> = ({ onChanged }) => {
    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [confirm, setConfirm] = useState('');
    const [show, setShow] = useState({ current: false, next: false, confirm: false });
    const [state, setState] = useState<'idle' | 'submitting' | 'done'>('idle');
    const [error, setError] = useState('');

    const clearError = (set: (v: string) => void) => (v: string) => { set(v); setError(''); };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (state !== 'idle') return;
        if (!current || !next || !confirm) return setError('Completa los tres campos.');
        if (next.length < SELF_PASSWORD_MIN_LENGTH) return setError(`La nueva contraseña debe tener al menos ${SELF_PASSWORD_MIN_LENGTH} caracteres.`);
        if (next !== confirm) return setError('La confirmación no coincide con la nueva contraseña.');
        if (next === current) return setError('La nueva contraseña debe ser distinta de la actual.');

        setState('submitting');
        const r = await dataService.changeOwnPassword(current, next, confirm);
        if (r.ok) {
            setCurrent(''); setNext(''); setConfirm('');
            setState('done');
            // El servidor ya revocó todas las sesiones: cerrar también la local.
            setTimeout(onChanged, LOGOUT_DELAY_MS);
            return;
        }
        setState('idle');
        if (r.status === 401) return setError('Tu sesión expiró. Inicia sesión de nuevo para cambiar la contraseña.');
        setError(r.error || 'No se pudo cambiar la contraseña. Intenta nuevamente.');
    };

    if (state === 'done') {
        return (
            <div role="status" className="max-w-lg p-4 rounded-lg bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-200 flex items-start gap-3">
                <CheckCircle className="flex-shrink-0 mt-0.5" size={20} aria-hidden="true" />
                <p>Contraseña actualizada. Cerramos tu sesión en todos los dispositivos: inicia sesión de nuevo con tu nueva contraseña.</p>
            </div>
        );
    }

    return (
        <div className="max-w-lg">
            <h2 className="text-xl font-bold mb-1 flex items-center gap-2"><Shield className="text-indigo-500" aria-hidden="true" /> Cambiar contraseña</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Mínimo {SELF_PASSWORD_MIN_LENGTH} caracteres. Al guardarla se cerrará tu sesión en todos los dispositivos.
            </p>
            {error && (
                <div role="alert" className="mb-4 p-3 rounded-md bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-200 flex items-start gap-2 text-sm">
                    <AlertCircle className="flex-shrink-0 mt-0.5" size={18} aria-hidden="true" />
                    <span>{error}</span>
                </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                <PasswordField id="pw-current" label="Contraseña actual" value={current} onChange={clearError(setCurrent)}
                    autoComplete="current-password" visible={show.current} onToggle={() => setShow(s => ({ ...s, current: !s.current }))} />
                <PasswordField id="pw-new" label="Nueva contraseña" value={next} onChange={clearError(setNext)}
                    autoComplete="new-password" visible={show.next} onToggle={() => setShow(s => ({ ...s, next: !s.next }))} />
                <PasswordField id="pw-confirm" label="Confirmar nueva contraseña" value={confirm} onChange={clearError(setConfirm)}
                    autoComplete="new-password" visible={show.confirm} onToggle={() => setShow(s => ({ ...s, confirm: !s.confirm }))} />
                <button
                    type="submit"
                    disabled={state === 'submitting'}
                    className="w-full py-2 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 disabled:cursor-not-allowed text-white font-semibold rounded-md transition-colors"
                >
                    {state === 'submitting' ? 'Guardando…' : 'Cambiar contraseña'}
                </button>
            </form>
        </div>
    );
};

export default PasswordChangeSection;
