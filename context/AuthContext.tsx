import React, { createContext, useState, useContext, ReactNode, useEffect } from 'react';
import type { User } from '../types';
import { dataService } from '../services/dataService';

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
      try {
        // Wait for data service to be ready (load users from API if needed)
        await dataService.waitForInitialization();
        if (!active) return;

        // Check both storages. localStorage takes precedence if both exist
        const storedUserId = localStorage.getItem('chibalete_user_id') || sessionStorage.getItem('chibalete_user_id');

        if (storedUserId) {
          const userFromDb = dataService.getUsuarioById(storedUserId);
          
          if (userFromDb && userFromDb.roles && Array.isArray(userFromDb.roles)) {
             // Desbloquear UI inmediatamente con el usuario
             setUser(userFromDb);
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

    // Desbloquear UI de inmediato — sin esperar la carga de acceso
    setUser(userToLogin);
    if (remember) {
      localStorage.setItem('chibalete_user_id', userToLogin.id);
    } else {
      sessionStorage.setItem('chibalete_user_id', userToLogin.id);
    }
    // Cargar acceso en background — no bloquea la navegación
    dataService.preloadUserAccess(userToLogin.id)
      .catch(() => {})
      .finally(() => setAccessReady(true));
    // Trigger background sync
    dataService.syncUserProgress(userToLogin.id);
  };

  const logout = () => {
    setUser(null);
    setAccessReady(false);
    localStorage.removeItem('chibalete_user_id');
    sessionStorage.removeItem('chibalete_user_id');
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
