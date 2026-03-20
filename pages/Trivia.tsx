
import React, { useState, useEffect } from 'react';
import { BrainCircuit, Award, ArrowRight, Loader2, Trophy, Image as ImageIcon, Bookmark, X } from 'lucide-react';
import { generarPreguntaTrivia } from '../services/geminiService';
import { dataService } from '../services/dataService';
import { useAuth } from '../context/AuthContext';
import type { TriviaQuestion, Reward } from '../types';

const REWARD_COST = 500;

const MOCK_REWARDS: Reward[] = [
    { id: 'rew-1', name: 'Fondo Espacial Arion', type: 'wallpaper_mobile', cost: 500, imageUrl: 'https://picsum.photos/seed/space/200/350' },
    { id: 'rew-2', name: 'Separador Cristal', type: 'bookmark', cost: 500, imageUrl: 'https://picsum.photos/seed/crystal/200/600' },
    { id: 'rew-3', name: 'Fondo Escritorio Bosque', type: 'wallpaper_desktop', cost: 500, imageUrl: 'https://picsum.photos/seed/forest/400/225' },
];

const Trivia: React.FC = () => {
    const { user } = useAuth();
    const [loading, setLoading] = useState(true);
    const [question, setQuestion] = useState<TriviaQuestion | null>(null);
    const [selectedOption, setSelectedOption] = useState<string | null>(null);
    const [isAnswered, setIsAnswered] = useState(false);
    const [score, setScore] = useState(user?.puntos || 0);
    const [showRewardModal, setShowRewardModal] = useState(false);
    const [redeeming, setRedeeming] = useState<string | null>(null);

    useEffect(() => {
        loadQuestion();
    }, []);

    useEffect(() => {
        // Sync local score with user data
        if (user) {
            setScore(user.puntos || 0);
        }
    }, [user]);

    const loadQuestion = async () => {
        setLoading(true);
        setIsAnswered(false);
        setSelectedOption(null);
        
        const q = await generarPreguntaTrivia();
        setQuestion(q);
        setLoading(false);
    };

    const handleOptionClick = (option: string) => {
        if (isAnswered || !user || !question) return;
        
        setSelectedOption(option);
        setIsAnswered(true);

        if (option === question.correctAnswer) {
            // Correct!
            dataService.addPuntos(user.id, 1);
            setScore(prev => prev + 1);
            // Play sound or confetti logic here
        }
    };

    const handleRedeem = (reward: Reward) => {
        if (!user) return;
        setRedeeming(reward.id);
        
        setTimeout(() => {
            const success = dataService.canjearRecompensa(user.id, reward.cost);
            if (success) {
                setScore(prev => prev - reward.cost);
                alert(`¡Has canjeado "${reward.name}"! Se ha guardado en tu perfil.`);
            } else {
                alert("No tienes suficientes puntos.");
            }
            setRedeeming(null);
        }, 1000);
    };

    return (
        <div className="p-4 md:p-8 min-h-screen bg-gray-50 dark:bg-gray-900 font-sans">
            {/* Header with Score */}
            <header className="flex flex-col md:flex-row justify-between items-center mb-8 bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm">
                <div>
                    <h1 className="text-3xl font-bold flex items-center text-indigo-600 dark:text-indigo-400">
                        <BrainCircuit className="mr-3" size={32}/> Trívia Infinita
                    </h1>
                    <p className="text-gray-500 text-sm mt-1">Pon a prueba tu conocimiento y gana premios.</p>
                </div>
                
                <div className="flex items-center gap-4 mt-4 md:mt-0">
                    <div className="bg-indigo-100 dark:bg-indigo-900/30 px-6 py-3 rounded-full flex items-center">
                        <Trophy className="text-yellow-500 mr-2" size={24}/>
                        <span className="text-2xl font-bold text-indigo-800 dark:text-indigo-200">{score}</span>
                        <span className="text-xs text-indigo-500 ml-1 font-bold uppercase">PTS</span>
                    </div>
                    <button 
                        onClick={() => setShowRewardModal(true)}
                        className="px-4 py-3 bg-gradient-to-r from-pink-500 to-purple-600 text-white rounded-full font-bold hover:shadow-lg transition-transform transform hover:scale-105 flex items-center"
                    >
                        <Award size={20} className="mr-2"/> Canjear
                    </button>
                </div>
            </header>

            {/* Progress Bar to next reward */}
            <div className="mb-8 max-w-2xl mx-auto">
                <div className="flex justify-between text-xs font-bold text-gray-500 mb-1">
                    <span>Progreso para recompensa</span>
                    <span>{score % REWARD_COST} / {REWARD_COST}</span>
                </div>
                <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div 
                        className="h-full bg-gradient-to-r from-green-400 to-blue-500 transition-all duration-1000"
                        style={{ width: `${(score % REWARD_COST) / REWARD_COST * 100}%` }}
                    ></div>
                </div>
            </div>

            {/* Game Area */}
            <div className="max-w-3xl mx-auto">
                {loading ? (
                    <div className="flex flex-col items-center justify-center h-96">
                        <Loader2 size={64} className="text-indigo-600 animate-spin mb-4"/>
                        <p className="text-gray-500 animate-pulse">Leo está buscando una pregunta en la biblioteca...</p>
                    </div>
                ) : !question ? (
                    <div className="text-center py-20">
                        <p>No se pudo generar una pregunta. Intenta de nuevo.</p>
                        <button onClick={loadQuestion} className="mt-4 text-indigo-600 underline">Reintentar</button>
                    </div>
                ) : (
                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl overflow-hidden animate-in zoom-in-95 duration-300">
                        <div className="bg-indigo-600 p-6 text-white text-center">
                            <span className="inline-block px-3 py-1 bg-white/20 rounded-full text-xs font-bold mb-3 uppercase tracking-wider">
                                {question.sourceTitle}
                            </span>
                            <h2 className="text-xl md:text-2xl font-bold leading-snug">
                                {question.question}
                            </h2>
                        </div>

                        <div className="p-6 grid md:grid-cols-2 gap-4">
                            {question.options.map((option, idx) => {
                                const isSelected = selectedOption === option;
                                const isCorrect = option === question.correctAnswer;
                                
                                let btnClass = "border-gray-200 dark:border-gray-700 hover:bg-indigo-50 dark:hover:bg-gray-700"; // Default
                                
                                if (isAnswered) {
                                    if (isCorrect) {
                                        btnClass = "bg-green-100 border-green-500 text-green-800 dark:bg-green-900 dark:text-green-100"; // Correct answer always green
                                    } else if (isSelected && !isCorrect) {
                                        btnClass = "bg-orange-100 border-orange-500 text-orange-800 dark:bg-orange-900 dark:text-orange-100"; // Wrong selection orange
                                    } else {
                                        btnClass = "opacity-50 grayscale"; // Others dimmed
                                    }
                                }

                                return (
                                    <button
                                        key={idx}
                                        onClick={() => handleOptionClick(option)}
                                        disabled={isAnswered}
                                        className={`p-6 text-left rounded-xl border-2 transition-all duration-300 text-lg font-medium ${btnClass}`}
                                    >
                                        <span className="mr-2 font-bold opacity-50">{['A', 'B', 'C', 'D'][idx]}.</span>
                                        {option}
                                    </button>
                                );
                            })}
                        </div>

                        {isAnswered && (
                            <div className="p-6 bg-gray-50 dark:bg-gray-700/30 border-t border-gray-100 dark:border-gray-700 flex justify-end animate-in slide-in-from-bottom-2">
                                <button 
                                    onClick={loadQuestion}
                                    className="flex items-center px-8 py-3 bg-indigo-600 text-white rounded-full font-bold hover:bg-indigo-700 transition-transform transform hover:scale-105 shadow-lg"
                                >
                                    Siguiente Pregunta <ArrowRight size={20} className="ml-2"/>
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Reward Modal */}
            {showRewardModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-900 w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col">
                        <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gradient-to-r from-purple-600 to-pink-600 text-white">
                            <div>
                                <h2 className="text-2xl font-bold flex items-center"><Award className="mr-2"/> Tienda de Recompensas</h2>
                                <p className="text-purple-100 text-sm">Canjea tus puntos por arte digital exclusivo</p>
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="bg-white/20 px-4 py-2 rounded-full font-bold">
                                    {score} PTS
                                </div>
                                <button onClick={() => setShowRewardModal(false)} className="p-2 hover:bg-white/20 rounded-full"><X size={24}/></button>
                            </div>
                        </div>
                        
                        <div className="p-6 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                            {MOCK_REWARDS.map(reward => (
                                <div key={reward.id} className="bg-gray-50 dark:bg-gray-800 rounded-xl overflow-hidden shadow-md flex flex-col border border-gray-200 dark:border-gray-700">
                                    <div className="relative h-48 bg-gray-200">
                                        <img src={reward.imageUrl} alt={reward.name} className="w-full h-full object-cover"/>
                                        <div className="absolute top-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded backdrop-blur-md uppercase font-bold">
                                            {reward.type.replace('_', ' ')}
                                        </div>
                                    </div>
                                    <div className="p-4 flex-grow flex flex-col">
                                        <h3 className="font-bold text-lg mb-1">{reward.name}</h3>
                                        <p className="text-sm text-gray-500 mb-4">Arte exclusivo de la colección Chibalete.</p>
                                        <div className="mt-auto flex items-center justify-between">
                                            <span className="font-bold text-indigo-600 dark:text-indigo-400">{reward.cost} PTS</span>
                                            <button 
                                                onClick={() => handleRedeem(reward)}
                                                disabled={score < reward.cost || redeeming !== null}
                                                className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${
                                                    score >= reward.cost 
                                                    ? 'bg-indigo-600 text-white hover:bg-indigo-700' 
                                                    : 'bg-gray-200 text-gray-400 cursor-not-allowed dark:bg-gray-700'
                                                }`}
                                            >
                                                {redeeming === reward.id ? <Loader2 className="animate-spin"/> : 'Canjear'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default Trivia;