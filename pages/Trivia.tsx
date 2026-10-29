
import React from 'react';
import { Link } from 'react-router-dom';
import { BrainCircuit } from 'lucide-react';

// CHP-GAMIFICACION-G0-01: Trivia contenida. La versión anterior generaba una
// pregunta al azar sobre el catálogo (no sobre lo leído), corregía en el
// cliente, sumaba +1 punto sin límite a un saldo que no persistía y ofrecía
// «arte digital» simulado (MOCK_REWARDS) que nunca se entregaba. Se retiró de
// la navegación; la ruta directa solo muestra este aviso: sin preguntas, sin
// puntos y sin premios. `generarPreguntaTrivia` y `TriviaQuestion` quedan en
// el inventario de G4B.
const Trivia: React.FC = () => (
    <div className="p-4 md:p-8 min-h-screen bg-gray-50 dark:bg-gray-900 font-sans">
        <div className="max-w-xl mx-auto bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 text-center">
            <BrainCircuit className="mx-auto mb-4 text-indigo-600 dark:text-indigo-400" size={40} aria-hidden="true" />
            <h1 className="text-2xl font-bold text-gray-800 dark:text-white mb-2">Trivia no disponible</h1>
            <p className="text-gray-600 dark:text-gray-300 mb-6">
                Esta actividad no está disponible por ahora.
            </p>
            <Link
                to="/biblioteca"
                className="inline-flex items-center px-6 py-3 bg-indigo-600 text-white rounded-full font-bold hover:bg-indigo-700 transition-colors"
            >
                Ir a la Biblioteca
            </Link>
        </div>
    </div>
);

export default Trivia;
