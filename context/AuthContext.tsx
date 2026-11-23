import React, { createContext, useState, useContext, ReactNode, useEffect } from 'react';
import type { User } from '../types';
import { dataService } from '../services/dataService';
import { clearEditorialClientStorage } from '../utils/clientEditorialStorage';
import { clearOfflineText } from '../utils/offlineTextCache';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  accessReady: boolean;
  login: (user: User, remember?: boolean) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [accessReady, setAccessReady] = useState(false);

  useEffect(() => {
    let active = true;
    const initAuth = async () => {
      // CP-3 (R7): el texto íntegro de Guiado ya no se persiste; se purga la
      // copia que dejaran versiones anteriores aunque no se cierre sesión.
      clearOfflineText();
      try {
        // Wait for data service to be ready (load users from API if needed)
        await dataService.waitForInitialization();
        if (!active) return;

        // Check both storages. localStorage takes precedence if both exist
        let storedUserId = localStorage.getItem('chibalete_user_id') || sessionStorage.getItem('chibalete_user_id');

        // V9 65E-C1 — hubo un cierre de sesión que el servidor no llegó a recibir (sin conexión): la cookie de aquella
        // cuenta sigue en el navegador. Se vuelve a pedir la revocación y, se logre o no, NO se restaura esa sesión.
        let logoutPending = false;
        if (!storedUserId && dataService.hasLogoutPending()) {
          logoutPending = !(await dataService.settlePendingLogout());
          dataService.clearSessionState();
          if (!active) return;
        }

        // CHP-IDDB-M1-A — la COOKIE de sesión firmada es la autoridad de bootstrap.
        // Si no hay id local pero sí hay sesión (cookie HttpOnly), rehidratamos por
        // /api/auth/me. El id local pasa a ser dato informativo/caché, no autoridad.
        if (!storedUserId && !logoutPending) {
          const me = await dataService.fetchSessionMe();
          if (me && me.id) {
            storedUserId = me.id;
            sessionStorage.setItem('chibalete_user_id', me.id);
          }
        }

        if (storedUserId) {
          const userFromDb = dataService.getUsuarioById(storedUserId);
          
          if (userFromDb && userFromDb.roles && Array.isArray(userFromDb.roles)) {
             // Desbloquear UI inmediatamente con el usuario
             setUser(userFromDb);
             // v4.0.6 hotfix — defensive: si el init constructor corrió SIN sesión válida
             // (intermitencia red, race con localStorage, etc.) re-hidrata con headers ahora
             // que sí hay session userId. No-op si caches ya están poblados de manera consistente.
             dataService.refreshAuthenticatedState().catch(() => {});
             // Trigger background sync
             dataService.syncUserProgress(storedUserId);
             // Cargar acceso en background — no bloquea el render
             dataService.preloadUserAccess(userFromDb.id)
               .catch(() => {})
               .finally(() => { if (active) setAccessReady(true); });
          } else {
             // FIX: Ghost session or corrupted user shape (e.g no roles). Clear storage strictly.
             setUser(null);
             localStorage.removeItem('chibalete_user_id');
             sessionStorage.removeItem('chibalete_user_id');
          }
        } else {
          setUser(null);
        }
      } catch (error) {
        console.error("Failed to load user from storage", error);
        setUser(null);
        localStorage.removeItem('chibalete_user_id');
        sessionStorage.removeItem('chibalete_user_id');
      } finally {
        if (active) setIsLoading(false);
      }
    };

    initAuth();
    return () => { active = false; };
  }, []);

  // Refresco silencioso de caché de acceso al recuperar foco de ventana.
  // Cubre el caso: permisos cambiados mientras la app estaba en background.
  useEffect(() => {
    const handleFocus = () => {
      if (user?.id) {
        dataService.ensureFreshUserAccess(user.id).catch(() => {});
      }
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [user?.id]);

  const login = (userToLogin: User, remember: boolean = false) => {
    // Defensive shape check before trusting UI
    if (!userToLogin.id || !userToLogin.roles || !Array.isArray(userToLogin.roles)) {
      console.error("Attempted login with invalid user shape");
      return;
    }
    
    // FIX: Clear both storages first to prevent duplicated "revivable" sessions
    localStorage.removeItem('chibalete_user_id');
    sessionStorage.removeItem('chibalete_user_id');
    // V9 65E-C1: este inicio de sesión reemplazó la cookie; ya no queda ningún cierre pendiente de otra cuenta, y de
    // ella no debe quedar nada en memoria.
    dataService.clearLogoutPending();
    if (user?.id && user.id !== userToLogin.id) dataService.clearSessionState();

    // Desbloquear UI de inmediato — sin esperar la carga de acceso
    setUser(userToLogin);
    if (remember) {
      localStorage.setItem('chibalete_user_id', userToLogin.id);
    } else {
      sessionStorage.setItem('chibalete_user_id', userToLogin.id);
    }
    // v4.0.6 hotfix — race auth → dataService:
    // El singleton se construyó en module-load posiblemente SIN sesión activa
    // (login fresh, post-logout, incógnito), por lo que content/users/groups/schools
    // quedaron vacíos por 401. Ahora que setSesion ya escribió el x-user-id en storage,
    // re-hidratamos con headers válidos — fire-and-forget, no bloquea la nav.
    dataService.refreshAuthenticatedState().catch(() => {});
    // Cargar acceso en background — no bloquea la navegación
    dataService.preloadUserAccess(userToLogin.id)
      .catch(() => {})
      .finally(() => setAccessReady(true));
    // Trigger background sync
    dataService.syncUserProgress(userToLogin.id);
  };

  const logout = () => {
    // CHP-IDDB-M1-A — revoca la sesión server-side (sid) y borra la cookie ANTES
    // de limpiar el estado local. Best-effort: no bloquea el redirect.
    // V9 65E-C1: primero se envían los guardados pendientes de ESTA cuenta (con su sesión aún válida) y después se
    // revoca. Si el servidor no confirma la revocación, queda la marca de cierre pendiente: la sesión no se restaura
    // sola al reabrir y la revocación se reintenta. La marca se pone ya, por si la pestaña se cierra antes de terminar.
    const leavingId = user?.id || dataService.getSessionUserId();
    dataService.markLogoutPending();
    dataService.flushPendingForLogout(leavingId)
      .then(() => dataService.serverLogout())
      .then((revoked) => { if (revoked) dataService.clearLogoutPending(); })
      .catch(() => {});
    setUser(null);
    setAccessReady(false);
    localStorage.removeItem('chibalete_user_id');
    sessionStorage.removeItem('chibalete_user_id');
    // V9 BI-65C-S: el padrón, los grupos y las copias de Aula Viva que cargó esta cuenta no quedan en memoria (el
    // cierre de sesión no recarga la página) ni las repone una respuesta que venía en camino.
    dataService.clearSessionState();
    // CP-3 (R7): contenido editorial y localizadores cacheados en el navegador.
    clearEditorialClientStorage();
    // Ensure full hard redirect and avoid back-button unmounting issues by forcing Window relocation
    window.location.replace('/#/bienvenida');
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, accessReady, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
