import React from 'react';

interface TrendChartProps {
    data: { month: string, avgScore: number }[];
}

export const TrendChart: React.FC<TrendChartProps> = React.memo(({ data }) => {
    if (!data || data.length === 0) return <p className="text-xs text-gray-400">Sin datos históricos</p>;
    const maxScore = 100;

    return (
        <div className="flex items-end justify-between h-24 gap-2 mt-4">
            {data.map((d, i) => (
                <div key={i} className="flex flex-col items-center w-full group relative">
                    <div
                        className="w-full bg-indigo-200 dark:bg-indigo-900/50 rounded-t-md hover:bg-indigo-400 transition-all relative"
                        style={{ height: `${(d.avgScore / maxScore) * 100}%` }}
                    >
                        <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs font-bold bg-black/70 text-white px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">{d.avgScore}</span>
                    </div>
                    <span className="text-xs text-gray-500 mt-1">{d.month}</span>
                </div>
            ))}
        </div>
    );
});
