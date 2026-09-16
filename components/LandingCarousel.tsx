// CHP-LANDING-BANNER-03 — carrusel del banner de /bienvenida.
// Lee GET /api/landing-banner una sola vez. Sin slides, con error o con la
// imagen activa rota muestra una superficie institucional: la landing y el
// login nunca dependen del banner.
import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { dataService, type LandingBannerSlide } from '../services/dataService';

const ROTATION_MS = 6000;

const focusRing = 'outline-none focus-visible:ring-4 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-slate-800';

const prefersReducedMotion = () => {
    try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
        return false;
    }
};

const Fallback: React.FC = () => (
    <div className="absolute inset-0 flex items-center justify-center bg-white/30">
        <img src="/chibalete_logo.png" alt="" className="w-32 md:w-48 opacity-70 drop-shadow-md" />
    </div>
);

const LandingCarousel: React.FC = () => {
    const [slides, setSlides] = useState<LandingBannerSlide[] | null>(null);
    const [index, setIndex] = useState(0);
    const [broken, setBroken] = useState<Set<string>>(() => new Set());
    const [reducedMotion] = useState(prefersReducedMotion);
    // Foco de teclado dentro del carrusel: no rotar, o el elemento enfocado desaparecería.
    const [keyboardFocus, setKeyboardFocus] = useState(false);

    useEffect(() => {
        let alive = true;
        dataService.getLandingBanner().then(list => {
            if (alive) setSlides(Array.isArray(list) ? list : []);
        });
        return () => { alive = false; };
    }, []);

    const count = slides?.length ?? 0;
    const autoplay = count > 1 && !reducedMotion && !keyboardFocus;

    // Un timeout por posición: cambiar de slide a mano lo reinicia.
    useEffect(() => {
        if (!autoplay) return;
        const t = window.setTimeout(() => setIndex(i => (i + 1) % count), ROTATION_MS);
        return () => window.clearTimeout(t);
    }, [autoplay, index, count]);

    const go = (i: number) => setIndex((i + count) % count);

    const slide = count > 0 ? slides![index] : null;
    const showImage = slide && !broken.has(slide.id);
    const hasCta = !!(slide?.linkUrl && slide?.linkLabel);
    const hasCaption = !!(slide?.title || slide?.text || hasCta);

    return (
        <section
            aria-roledescription="carrusel"
            aria-label="Novedades de Chibalete+"
            aria-busy={slides === null}
            onFocus={(e) => setKeyboardFocus(e.target.matches(':focus-visible'))}
            onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setKeyboardFocus(false); }}
            className="relative w-full h-64 sm:h-80 md:h-[28rem] lg:h-auto lg:min-h-[32rem] rounded-3xl overflow-hidden shadow-xl bg-white/20"
        >
            {!slide ? (
                <Fallback />
            ) : (
                <div
                    role="group"
                    aria-roledescription="diapositiva"
                    aria-label={`${index + 1} de ${count}`}
                    aria-live={autoplay ? 'off' : 'polite'}
                    className="absolute inset-0"
                >
                    {showImage ? (
                        <img
                            key={slide.id}
                            src={slide.imageUrl}
                            alt={slide.title ?? ''}
                            className="w-full h-full object-cover"
                            onError={() => setBroken(prev => new Set(prev).add(slide.id))}
                        />
                    ) : (
                        <Fallback />
                    )}
                    {hasCaption && (
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/40 to-transparent px-6 pt-16 pb-12 md:px-10 text-left text-white">
                            {slide.title && <h2 className="text-2xl md:text-3xl font-bold drop-shadow">{slide.title}</h2>}
                            {slide.text && <p className="mt-2 text-base md:text-lg max-w-2xl drop-shadow">{slide.text}</p>}
                            {hasCta && (
                                <a
                                    href={slide.linkUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={`inline-block mt-4 bg-white text-slate-800 font-bold py-2 px-5 rounded-full shadow-lg hover:bg-gray-100 ${focusRing}`}
                                >
                                    {slide.linkLabel}
                                </a>
                            )}
                        </div>
                    )}
                </div>
            )}

            {count > 1 && (
                <>
                    <button
                        type="button"
                        onClick={() => go(index - 1)}
                        aria-label="Diapositiva anterior"
                        className={`absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/80 text-slate-800 shadow hover:bg-white ${focusRing}`}
                    >
                        <ChevronLeft size={24} />
                    </button>
                    <button
                        type="button"
                        onClick={() => go(index + 1)}
                        aria-label="Diapositiva siguiente"
                        className={`absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/80 text-slate-800 shadow hover:bg-white ${focusRing}`}
                    >
                        <ChevronRight size={24} />
                    </button>
                    <div className="absolute bottom-3 inset-x-0 flex justify-center gap-2">
                        {slides!.map((s, i) => (
                            <button
                                key={s.id}
                                type="button"
                                onClick={() => go(i)}
                                aria-label={`Ir a la diapositiva ${i + 1}`}
                                aria-current={i === index ? 'true' : undefined}
                                className={`h-3 rounded-full transition-all ${i === index ? 'w-8 bg-white' : 'w-3 bg-white/60 hover:bg-white/80'} ${focusRing}`}
                            />
                        ))}
                    </div>
                </>
            )}
        </section>
    );
};

export default LandingCarousel;
