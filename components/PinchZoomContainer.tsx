import React, { useRef, useState, useEffect } from 'react';

interface PinchZoomContainerProps {
    children: React.ReactNode;
    enabled?: boolean;
}

const PinchZoomContainer: React.FC<PinchZoomContainerProps> = ({ children, enabled = true }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [isGesturing, setIsGesturing] = useState(false);

    // Helper to get distance between two touches
    const getDistance = (touches: React.TouchList) => {
        return Math.hypot(
            touches[0].clientX - touches[1].clientX,
            touches[0].clientY - touches[1].clientY
        );
    };

    useEffect(() => {
        const el = containerRef.current;
        if (!el || !enabled) return;

        let startDist = 0;
        let startScale = 1;
        let startX = 0;
        let startY = 0;
        let lastX = 0;
        let lastY = 0;

        const handleTouchStart = (e: TouchEvent) => {
            // Pinch
            if (e.touches.length === 2) {
                setIsGesturing(true);
                startDist = getDistance(e.touches);
                startScale = scale;
            }
            // Pan (only if zoomed in)
            else if (e.touches.length === 1 && scale > 1) {
                setIsGesturing(true);
                startX = e.touches[0].clientX - lastX;
                startY = e.touches[0].clientY - lastY;
            }
        };

        const handleTouchMove = (e: TouchEvent) => {
            if (e.touches.length === 2 && isGesturing) {
                e.preventDefault(); // Prevent page scroll
                const dist = getDistance(e.touches);
                const newScale = Math.min(Math.max(1, startScale * (dist / startDist)), 4);
                setScale(newScale);
            } else if (e.touches.length === 1 && scale > 1 && isGesturing) {
                e.preventDefault();
                lastX = e.touches[0].clientX - startX;
                lastY = e.touches[0].clientY - startY;

                // Simple bounds check could be added here, but relative panning is safer for now
                setOffset({ x: lastX, y: lastY });
            }
        };

        const handleTouchEnd = () => {
            setIsGesturing(false);
            // Reset if scale is 1 to snap back
            if (scale <= 1) {
                setScale(1);
                setOffset({ x: 0, y: 0 });
                lastX = 0;
                lastY = 0;
            }
        };

        el.addEventListener('touchstart', handleTouchStart, { passive: false });
        el.addEventListener('touchmove', handleTouchMove, { passive: false });
        el.addEventListener('touchend', handleTouchEnd);

        return () => {
            el.removeEventListener('touchstart', handleTouchStart);
            el.removeEventListener('touchmove', handleTouchMove);
            el.removeEventListener('touchend', handleTouchEnd);
        };
    }, [enabled, scale, isGesturing]); // Re-bind if scale changes significantly or gesture state

    return (
        <div
            ref={containerRef}
            style={{
                touchAction: 'none',
                overflow: 'hidden',
                width: '100%',
                height: '100%',
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
            }}
        >
            <div
                style={{
                    transform: `scale(${scale}) translate(${offset.x}px, ${offset.y}px)`,
                    transformOrigin: 'center center',
                    transition: isGesturing ? 'none' : 'transform 0.2s ease-out',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}
            >
                {children}
            </div>
        </div>
    );
};

export default PinchZoomContainer;
