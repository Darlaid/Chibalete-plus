import { useState, useEffect } from 'react';

type DeviceType = {
    isMobile: boolean;
    isTablet: boolean;
    isDesktop: boolean;
};

export const useDevice = (): DeviceType => {
    const [device, setDevice] = useState<DeviceType>({
        isMobile: false,
        isTablet: false,
        isDesktop: true, // Default to desktop for SSR/initial render
    });

    useEffect(() => {
        const handleResize = () => {
            const width = window.innerWidth;

            const isMobile = width < 768;
            const isTablet = width >= 768 && width < 1024;
            const isDesktop = width >= 1024;

            setDevice({
                isMobile,
                isTablet,
                isDesktop,
            });
        };

        // Initial check
        handleResize();

        // Event listener
        window.addEventListener('resize', handleResize);

        // Cleanup
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    return device;
};
