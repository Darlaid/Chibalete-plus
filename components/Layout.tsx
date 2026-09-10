
import React, { useRef } from 'react';
import Navbar from './Navbar';
import Chatbot from './Chatbot';

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // CHP-WCAG-01B LAYOUT-01: enlace de salto al contenido principal. Es el primer
  // control enfocable, permanece oculto fuera de foco (sr-only) y se muestra al
  // enfocarse. Con HashRouter el href no puede navegar: se enfoca el <main>.
  const mainRef = useRef<HTMLElement | null>(null);
  const skipToMain = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const main = mainRef.current;
    if (!main) return;
    main.focus();
    main.scrollIntoView({ block: 'start' });
  };
  return (
    <div className="flex flex-col h-screen font-sans">
      <a
        href="#contenido-principal"
        onClick={skipToMain}
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[200] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-indigo-700 focus:text-white focus:font-bold focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-white"
      >
        Saltar al contenido principal
      </a>
      <div className="flex-1 relative flex flex-col md:flex-row overflow-hidden">
        {/* Navbar for larger screens */}
        <div className="hidden md:block">
          <Navbar />
        </div>

        {/* CHP-WCAG-01B LAYOUT-04: el relleno inferior reserva el espacio del botón
            flotante de Leo (bottom-20 + 64px en móvil, bottom-6 + 64px en escritorio)
            para que no tape los controles del final de cada superficie. */}
        <main id="contenido-principal" ref={mainRef} tabIndex={-1} className="flex-1 overflow-y-auto pb-40 md:pb-24 relative scrollbar-hide focus:outline-none">
          {children}
          <Chatbot />
        </main>

        {/* Navbar for smaller screens */}
        <div className="md:hidden">
          <Navbar />
        </div>
      </div>
    </div>
  );
};

export default Layout;