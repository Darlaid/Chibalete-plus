
import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

const FaqItem: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
    const [isOpen, setIsOpen] = useState(false);
    return (
        <div className="border-b border-gray-200 dark:border-gray-700">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex justify-between items-center text-left py-4 px-2"
            >
                <span className="font-semibold">{title}</span>
                <ChevronDown className={`transform transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isOpen ? 'max-h-96' : 'max-h-0'}`}>
                <div className="p-4 bg-gray-50 dark:bg-gray-800">
                    {children}
                </div>
            </div>
        </div>
    );
}


const Soporte: React.FC = () => {
    const [formSubmitted, setFormSubmitted] = useState(false);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setFormSubmitted(true);
    }

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Soporte</h1>

      <section className="mb-12">
        <h2 className="text-2xl font-bold mb-4">Preguntas Frecuentes</h2>
        <div className="bg-white dark:bg-gray-800/50 rounded-lg shadow-sm">
            <FaqItem title="¿Cómo publico con nosotros?">
                <p>Actualmente estamos desarrollando nuestra plataforma para autores de la comunidad. ¡Pronto daremos más detalles sobre cómo puedes publicar tus historias en Chibalete+!</p>
            </FaqItem>
            <FaqItem title="¿Tengo problemas con mi perfil?">
                <p>Si tienes problemas para acceder o editar tu perfil, intenta cerrar sesión y volver a ingresar. Si el problema persiste, por favor contáctanos a través del formulario de abajo.</p>
            </FaqItem>
            <FaqItem title="¿Por qué empleamos GeoFences?">
                <p>Placeholder: En futuras versiones, podríamos usar GeoFences para ofrecer contenido relevante a tu ubicación, como historias locales o eventos literarios en tu ciudad. Tu privacidad es nuestra prioridad y esta función será siempre opcional.</p>
            </FaqItem>
        </div>
      </section>

      <section>
        <h2 className="text-2xl font-bold mb-4">Contáctanos</h2>
        {formSubmitted ? (
            <div className="p-6 bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 rounded-lg">
                ¡Gracias! Hemos recibido tu mensaje y te responderemos pronto.
            </div>
        ) : (
            <form onSubmit={handleSubmit} className="space-y-4 p-6 bg-white dark:bg-gray-800/50 rounded-lg shadow-sm">
                <div>
                    <label htmlFor="name" className="block text-sm font-medium mb-1">Nombre</label>
                    <input type="text" id="name" required className="w-full p-2 border rounded-md bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600"/>
                </div>
                <div>
                    <label htmlFor="email" className="block text-sm font-medium mb-1">Email</label>
                    <input type="email" id="email" required className="w-full p-2 border rounded-md bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600"/>
                </div>
                <div>
                    <label htmlFor="message" className="block text-sm font-medium mb-1">Mensaje</label>
                    <textarea id="message" rows={4} required className="w-full p-2 border rounded-md bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600"></textarea>
                </div>
                <button type="submit" className="w-full py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Enviar Mensaje</button>
            </form>
        )}
      </section>
    </div>
  );
};

export default Soporte;
