
import React from 'react';
import Navbar from './Navbar';
import Chatbot from './Chatbot';

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="flex flex-col h-screen font-sans">
      {/* Announcement Banner */}
      <div className="bg-gradient-to-r from-indigo-700 to-purple-700 text-white text-xs sm:text-sm py-1.5 px-4 text-center font-medium shadow-sm z-50">
        Tenemos nuevo sitio web, visítanos en <a href="https://www.tiendachibalete.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-indigo-200 decoration-indigo-300">www.tiendachibalete.com</a>
      </div>

      <div className="flex-1 relative flex flex-col md:flex-row overflow-hidden">
        {/* Navbar for larger screens */}
        <div className="hidden md:block">
          <Navbar />
        </div>

        <main className="flex-1 overflow-y-auto pb-20 md:pb-0 relative scrollbar-hide">
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