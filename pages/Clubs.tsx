import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { dataService } from '../services/dataService';
import type { Group, Bundle } from '../types';
import { Globe, Sparkles, Users, ArrowRight, Check } from 'lucide-react';

const Clubs: React.FC = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [openClubs, setOpenClubs] = useState<Group[]>([]);
    const [bundles, setBundles] = useState<Bundle[]>([]);
    const [joining, setJoining] = useState<string | null>(null);
    const [joinedIds, setJoinedIds] = useState<Set<string>>(new Set());

    const loadOpenClubs = useCallback(() => {
        const allGroups = dataService.getAllGroups();
        const open = allGroups.filter(g => g.type === 'club' && (g as any).kind === 'open');
        setOpenClubs(open);
        setBundles(dataService.getBundles());
        if (user) {
            const already = open
                .filter(g => g.memberIds?.includes(user.id) || g.mediatorIds?.includes(user.id))
                .map(g => g.id);
            setJoinedIds(new Set(already));
        }
    }, [user]);

    // Re-read groups on every route visit (location.key changes on each navigation)
    useEffect(() => {
        loadOpenClubs();
    }, [loadOpenClubs, location.key]);

    const handleJoin = async (club: Group) => {
        if (!user) return;
        setJoining(club.id);
        try {
            await dataService.joinOpenClub(club.id, user.id);
            setJoinedIds(prev => new Set([...prev, club.id]));
            navigate(`/clubs/${club.id}`);
        } catch (err: any) {
            alert(`No se pudo unir al club: ${err.message}`);
        } finally {
            setJoining(null);
        }
    };

    const getBundleName = (bundleId?: string | null) =>
        bundleId ? (bundles.find(b => b.id === bundleId)?.name ?? null) : null;

    return (
        <div className="max-w-4xl mx-auto px-4 py-8">
            <div className="mb-8">
                <div className="flex items-center gap-3 mb-2">
                    <Globe size={28} className="text-pink-500" />
                    <h1 className="text-3xl font-black text-gray-900 dark:text-white">Clubes de Lectura</h1>
                </div>
                <p className="text-gray-500 dark:text-gray-400 ml-11">
                    Únete a una comunidad de lectores y explora experiencias compartidas.
                </p>
            </div>

            {openClubs.length === 0 ? (
                <div className="text-center py-20 text-gray-400">
                    <Globe size={48} className="mx-auto mb-4 opacity-30" />
                    <p className="text-lg font-semibold">No hay clubes externos disponibles aún.</p>
                </div>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                    {openClubs.map(club => {
                        const isMember = joinedIds.has(club.id);
                        const bundleName = getBundleName(club.activeExperienceId);
                        const memberCount = club.memberIds?.length ?? 0;

                        return (
                            <div
                                key={club.id}
                                className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col"
                            >
                                <div className="flex items-start justify-between mb-3">
                                    <div className="p-2 bg-pink-50 dark:bg-pink-900/30 rounded-xl">
                                        <Globe size={20} className="text-pink-500" />
                                    </div>
                                    <span className="text-xs font-bold text-pink-500 bg-pink-50 dark:bg-pink-900/20 px-2 py-1 rounded-full uppercase tracking-wider">
                                        Club Abierto
                                    </span>
                                </div>

                                <h3 className="text-lg font-black text-gray-900 dark:text-white mb-1">{club.name}</h3>

                                {bundleName && (
                                    <div className="flex items-center gap-1.5 text-xs text-indigo-600 dark:text-indigo-400 font-semibold mb-2">
                                        <Sparkles size={12} />
                                        {bundleName}
                                    </div>
                                )}

                                <div className="flex items-center gap-1.5 text-xs text-gray-400 mt-auto mb-4">
                                    <Users size={12} />
                                    <span>{memberCount} {memberCount === 1 ? 'miembro' : 'miembros'}</span>
                                </div>

                                {isMember ? (
                                    <button
                                        onClick={() => navigate(`/clubs/${club.id}`)}
                                        className="w-full py-3 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 font-bold rounded-xl flex items-center justify-center gap-2 text-sm hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors"
                                    >
                                        <Check size={16} />
                                        Ver mi club
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => handleJoin(club)}
                                        disabled={joining === club.id}
                                        className="w-full py-3 bg-gradient-to-r from-pink-500 to-indigo-600 text-white font-bold rounded-xl flex items-center justify-center gap-2 text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
                                    >
                                        {joining === club.id ? (
                                            <div className="w-4 h-4 border-2 border-white/50 border-t-white rounded-full animate-spin" />
                                        ) : (
                                            <>
                                                <ArrowRight size={16} />
                                                Unirme
                                            </>
                                        )}
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default Clubs;
