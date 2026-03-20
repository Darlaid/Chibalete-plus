import React from 'react';

interface DistributionChartProps {
    low: number;
    mid: number;
    high: number;
    total: number;
}

export const DistributionChart: React.FC<DistributionChartProps> = React.memo(({ low, mid, high, total }) => {
    const pLow = total ? (low / total) * 100 : 0;
    const pMid = total ? (mid / total) * 100 : 0;
    const pHigh = total ? (high / total) * 100 : 0;

    return (
        <div className="h-4 w-full flex rounded-full overflow-hidden">
            <div style={{ width: `${pLow}%` }} className="bg-red-400 h-full" title={`Bajo: ${low} estudiantes`}></div>
            <div style={{ width: `${pMid}%` }} className="bg-yellow-400 h-full" title={`Medio: ${mid} estudiantes`}></div>
            <div style={{ width: `${pHigh}%` }} className="bg-green-500 h-full" title={`Alto: ${high} estudiantes`}></div>
        </div>
    );
});
