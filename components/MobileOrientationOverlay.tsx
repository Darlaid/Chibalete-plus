import React from 'react';
import { Smartphone } from 'lucide-react';

const MobileOrientationOverlay: React.FC = () => {
    return (
        <div className="fixed inset-0 z-50 bg-gray-900 text-white flex flex-col items-center justify-center p-8 text-center animate-in fade-in duration-300">
            <div className="animate-pulse mb-8">
                <Smartphone size={64} className="rotate-90 text-indigo-400" />
            </div>
            <h2 className="text-2xl font-bold mb-4">Rota tu dispositivo</h2>
            <p className="text-gray-300 text-lg">
                Para disfrutar de la mejor experiencia de lectura, por favor gira tu teléfono o tableta a posición horizontal.
            </p>
        </div>
    );
};

export default MobileOrientationOverlay;
