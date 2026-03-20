import React from 'react';

interface ProgressBarProps {
    value: number;
    color: string;
    label?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = React.memo(({ value, color, label }) => (
    <div className="mb-2">
        {label && <div className="flex justify-between text-xs mb-1 font-bold text-gray-500"><span>{label}</span><span>{value}%</span></div>}
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
            <div className={`h-2.5 rounded-full ${color}`} style={{ width: `${value}%` }}></div>
        </div>
    </div>
));
