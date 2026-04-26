
import React from 'react';
import Navbar from './Navbar';
import Chatbot from './Chatbot';

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="flex flex-col h-screen font-sans">
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