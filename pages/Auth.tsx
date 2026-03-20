import React, { useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { dataService } from '../services/dataService';
import { AtSign, Lock, User as UserIcon, Eye, EyeOff, ChevronLeft } from 'lucide-react';

const Auth: React.FC = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [formData, setFormData] = useState({ email: '', password: '', nombre: '' });
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.type === 'email' || e.target.name === 'email' ? 'email' : e.target.name]: e.target.value });
    setError('');
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const user = await dataService.validarCredenciales(formData.email, formData.password);

      if (!user) {
        setError('Credenciales incorrectas. Verifica tu email y contraseña.');
        return;
      }

      const targetRole = location.state?.targetRole;
      const userRoles = user.roles || [];

      if (targetRole && !userRoles.includes(targetRole)) {
        setError('Tu cuenta no tiene permisos para ingresar con ese rol.');
        return;
      }

      // --- Club Activation: escribir bienvenida de club para Home ---
      try {
        const allGroups = dataService.getAllGroups();
        const userClubs = allGroups.filter(
          (g) =>
            g.type === 'club' &&
            (
              (Array.isArray(g.memberIds) && g.memberIds.includes(user.id)) ||
              (Array.isArray(g.mediatorIds) && g.mediatorIds.includes(user.id))
            )
        );
        if (userClubs.length > 0) {
          const firstClub = userClubs[0];
          const clubContent = dataService.getClubContent(firstClub);
          sessionStorage.setItem(
            'chibalete_club_welcome',
            JSON.stringify({
              clubName: firstClub.name,
              contentCount: clubContent.length,
              clubIds: userClubs.map((c) => c.id),
            })
          );
        }
      } catch (_err) {
        // Best-effort: no debe bloquear el login
      }
      // ---

      login(user, rememberMe);

      if (targetRole === 'administrador') {
        navigate('/admin-dashboard');
        return;
      }

      navigate('/');
    } catch (e: any) {
      setError('Error al iniciar sesión. Intenta nuevamente.');
      console.error(e);
    }
  };

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    // Simulate registration (mock logic for demo)
    alert("¡Registro público desactivado por ahora! Contacta a tu colegio o administrador.");
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900 relative">
      {/* Botón de Volver */}
      <Link
        to="/bienvenida"
        className="absolute top-4 left-4 md:top-8 md:left-8 flex items-center text-gray-500 hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-400 transition-colors font-medium"
      >
        <ChevronLeft className="w-5 h-5 mr-1" />
        Volver al inicio
      </Link>

      <div className="w-full max-w-md p-8 space-y-6 bg-white dark:bg-gray-800 rounded-2xl shadow-lg mt-12 md:mt-0">
        <h1 className="text-3xl font-bold text-center text-gray-900 dark:text-white">
          {isLogin ? 'Bienvenido de vuelta' : 'Crea tu cuenta'}
        </h1>

        <div className="flex border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setIsLogin(true)}
            className={`w-1/2 py-4 text-center font-medium transition-colors ${isLogin ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600' : 'text-gray-500 hover:text-gray-700'
              }`}
          >
            Ingresar
          </button>
          <button
            onClick={() => setIsLogin(false)}
            className={`w-1/2 py-4 text-center font-medium transition-colors ${!isLogin ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600' : 'text-gray-500 hover:text-gray-700'
              }`}
          >
            Registrarse
          </button>
        </div>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative text-sm">
            {error}
          </div>
        )}

        {isLogin ? (
          <form onSubmit={handleLogin} className="space-y-6">
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                <AtSign className="h-5 w-5 text-gray-400" />
              </span>
              <input
                name="email"
                className="w-full pl-10 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50 dark:bg-gray-700"
                type="email"
                placeholder="Correo electrónico"
                value={formData.email}
                onChange={handleChange}
                required
              />
            </div>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                <Lock className="h-5 w-5 text-gray-400" />
              </span>
              <input
                name="password"
                className="w-full pl-10 pr-10 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50 dark:bg-gray-700"
                type={showPassword ? "text" : "password"}
                placeholder="Contraseña"
                value={formData.password}
                onChange={handleChange}
                required
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600">
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <input
                  id="remember-me"
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded cursor-pointer"
                />
                <label htmlFor="remember-me" className="ml-2 block text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                  Recordarme
                </label>
              </div>
              <a href="#" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">¿Olvidaste tu contraseña?</a>
            </div>

            <button type="submit" className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-md transition-colors">Ingresar</button>
          </form>
        ) : (
          <form onSubmit={handleRegister} className="space-y-6">
            <div className="relative"><span className="absolute inset-y-0 left-0 flex items-center pl-3"><UserIcon className="h-5 w-5 text-gray-400" /></span><input className="w-full pl-10 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50 dark:bg-gray-700" type="text" placeholder="Nombre de usuario" required /></div>
            <div className="relative"><span className="absolute inset-y-0 left-0 flex items-center pl-3"><AtSign className="h-5 w-5 text-gray-400" /></span><input className="w-full pl-10 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50 dark:bg-gray-700" type="email" placeholder="Email" required /></div>
            <div className="relative"><span className="absolute inset-y-0 left-0 flex items-center pl-3"><Lock className="h-5 w-5 text-gray-400" /></span><input className="w-full pl-10 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-gray-50 dark:bg-gray-700" type="password" placeholder="Contraseña" required /></div>
            <button type="submit" className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-md transition-colors">Solicitar Registro</button>
          </form>
        )}
      </div>
    </div>
  );
};

export default Auth;
