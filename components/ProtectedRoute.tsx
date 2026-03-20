import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { User } from '../types';

interface ProtectedRouteProps {
  roles?: User['roles'];
  children: React.ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ roles, children }) => {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  // Fallback if no user or broken shape
  if (!user || !user.roles || !Array.isArray(user.roles)) {
    return <Navigate to="/bienvenida" state={{ from: location }} replace />;
  }

  // If specific roles are required, ensure the user has at least one of them
  if (roles && roles.length > 0) {
    const hasRequiredRole = roles.some(role => user.roles.includes(role));
    
    if (!hasRequiredRole) {
      // Redirect Admin to their dashboard if they accidentally hit a forbidden route (like /biblioteca if they are purely admin)
      if (user.roles.includes('administrador')) {
          // Prevent infinite redirect loop if they are already on admin-dashboard 
          if(location.pathname !== '/admin-dashboard') return <Navigate to="/admin-dashboard" replace />;
      }
      // If regular user or unknown role, go home natively 
      return <Navigate to="/" replace />; 
    }
  }

  return <>{children}</>;
};

export default ProtectedRoute;