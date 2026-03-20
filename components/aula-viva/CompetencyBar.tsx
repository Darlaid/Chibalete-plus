import React from 'react';

interface CompetencyBarProps {
    label: string;
    value: number;
    color: string;
    description: string;
}

export const CompetencyBar: React.FC<CompetencyBarProps> = React.memo(({ label, value, color, description }) => (
    <div className="w-full">
        <div className="flex justify-between items-end mb-1">
            <span className="font-bold text-sm text-gray-700 dark:text-gray-300">{label}</span>
            <span className="text-xl font-bold">{value}%</span>
        </div>
        <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-4 mb-1">
            <div className={`h-4 rounded-full ${color} transition-all duration-1000`} style={{ width: `${value}%` }}></div>
        </div>
        <p className="text-[10px] text-gray-400">{description}</p>
    </div>
));
