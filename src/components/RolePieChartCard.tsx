import React from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

export interface PieSliceItem {
  name: string;
  value: number;
  color: string;
}

interface RolePieChartCardProps {
  title: string;
  subtitle?: string;
  data: PieSliceItem[];
  centerLabel?: string;
  centerValue?: string;
  unitLabel?: string;
  compact?: boolean;
  emptyMessage?: string;
  className?: string;
}

export const RolePieChartCard: React.FC<RolePieChartCardProps> = ({
  title,
  subtitle,
  data,
  centerLabel,
  centerValue,
  unitLabel = '',
  compact = false,
  emptyMessage = 'No chart data recorded yet.',
  className = '',
}) => {
  const nonZeroData = data.filter((d) => d.value > 0);
  const total = nonZeroData.reduce((acc, d) => acc + d.value, 0);

  return (
    <div className={`surface-3d rounded-xl p-4 sm:p-5 space-y-3 ${className}`.trim()}>
      <div>
        <h3 className="text-sm font-bold text-stone-900">{title}</h3>
        {subtitle && <p className="text-xs text-stone-500 mt-0.5">{subtitle}</p>}
      </div>

      {total === 0 ? (
        <div className="h-44 flex items-center justify-center text-xs text-stone-500 border border-dashed border-amber-900/20 rounded-lg px-4 text-center">
          {emptyMessage}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
          <div className={`${compact ? 'h-44' : 'h-52'} sm:col-span-6 relative`}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={nonZeroData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={compact ? 42 : 52}
                  outerRadius={compact ? 68 : 80}
                  paddingAngle={2}
                  strokeWidth={1}
                >
                  {nonZeroData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => {
                    const num = typeof value === 'number' ? value : Number(value ?? 0);
                    return [
                      `${num}${unitLabel ? ` ${unitLabel}` : ''} (${total > 0 ? Math.round((num / total) * 100) : 0}%)`,
                      String(name ?? ''),
                    ];
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            {(centerValue || centerLabel) && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                {centerValue && (
                  <span className="text-base font-bold text-stone-900 font-mono tabular-nums">
                    {centerValue}
                  </span>
                )}
                {centerLabel && (
                  <span className="text-[10px] font-medium text-stone-500 max-w-[80px] leading-tight">
                    {centerLabel}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="sm:col-span-6 space-y-2">
            {data.map((slice) => {
              const pct = total > 0 ? Math.round((slice.value / total) * 100) : 0;
              return (
                <div
                  key={slice.name}
                  className="flex items-center justify-between gap-2 text-xs bg-white/70 border border-amber-900/10 rounded-lg px-2.5 py-1.5"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-xs shrink-0"
                      style={{ backgroundColor: slice.color }}
                    />
                    <span className="font-medium text-stone-800 truncate">{slice.name}</span>
                  </div>
                  <span className="font-mono font-semibold text-stone-900 tabular-nums shrink-0">
                    {slice.value}
                    {unitLabel} ({pct}%)
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
