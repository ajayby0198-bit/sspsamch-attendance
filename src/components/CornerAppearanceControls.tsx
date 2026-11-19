import React, { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

export type ThemeMode = 'light' | 'dark' | 'system';

const FONT_STEPS = [85, 92, 100, 112, 125] as const;
const THEME_STORAGE_KEY = 'ssps_theme_mode';
const FONT_STORAGE_KEY = 'ssps_font_scale';

function applyThemeToDom(mode: ThemeMode) {
  const prefersDark =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const resolvedDark = mode === 'dark' || (mode === 'system' && prefersDark);
  const root = document.documentElement;
  if (resolvedDark) {
    root.classList.add('dark');
    root.setAttribute('data-theme', 'dark');
  } else {
    root.classList.remove('dark');
    root.setAttribute('data-theme', 'light');
  }
}

function applyFontScaleToDom(scale: number) {
  document.documentElement.style.fontSize = `${scale}%`;
}

export function useAppearanceSettings() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'light';
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved === 'dark' || saved === 'light' || saved === 'system' ? saved : 'light';
  });

  const [fontScale, setFontScale] = useState<number>(() => {
    if (typeof window === 'undefined') return 100;
    const saved = Number(localStorage.getItem(FONT_STORAGE_KEY));
    return FONT_STEPS.includes(saved as (typeof FONT_STEPS)[number]) ? saved : 100;
  });

  useEffect(() => {
    applyThemeToDom(themeMode);
    localStorage.setItem(THEME_STORAGE_KEY, themeMode);

    if (themeMode !== 'system' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyThemeToDom('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [themeMode]);

  useEffect(() => {
    applyFontScaleToDom(fontScale);
    localStorage.setItem(FONT_STORAGE_KEY, String(fontScale));
  }, [fontScale]);

  const stepDownFont = () => {
    const idx = FONT_STEPS.indexOf(fontScale as (typeof FONT_STEPS)[number]);
    if (idx > 0) setFontScale(FONT_STEPS[idx - 1]);
  };

  const resetFont = () => setFontScale(100);

  const stepUpFont = () => {
    const idx = FONT_STEPS.indexOf(fontScale as (typeof FONT_STEPS)[number]);
    if (idx >= 0 && idx < FONT_STEPS.length - 1) setFontScale(FONT_STEPS[idx + 1]);
  };

  return {
    themeMode,
    setThemeMode,
    fontScale,
    canStepDown: fontScale > FONT_STEPS[0],
    canStepUp: fontScale < FONT_STEPS[FONT_STEPS.length - 1],
    stepDownFont,
    resetFont,
    stepUpFont,
  };
}

interface CornerAppearanceControlsProps {
  compact?: boolean;
}

export const CornerAppearanceControls: React.FC<CornerAppearanceControlsProps> = ({
  compact = false,
}) => {
  const {
    themeMode,
    setThemeMode,
    fontScale,
    canStepDown,
    canStepUp,
    stepDownFont,
    resetFont,
    stepUpFont,
  } = useAppearanceSettings();

  return (
    <div
      className="inline-flex items-center gap-1.5 flex-wrap"
      aria-label="Theme and Word Size Controls"
    >
      {/* A- / A / A+ Word Size Controls */}
      <div
        className="inline-flex items-center rounded-lg border border-amber-900/20 bg-white/90 p-0.5 shadow-2xs"
        role="group"
        aria-label="Adjust word size"
      >
        <button
          type="button"
          onClick={stepDownFont}
          disabled={!canStepDown}
          title="Decrease word size (A-)"
          className="px-2 py-1 text-[11px] font-bold text-stone-700 hover:bg-amber-900/10 rounded disabled:opacity-35 transition-colors"
        >
          A-
        </button>
        <button
          type="button"
          onClick={resetFont}
          title={`Reset word size (Current: ${fontScale}%)`}
          className={`px-1.5 py-1 text-[11px] font-semibold rounded transition-colors ${
            fontScale === 100
              ? 'bg-emerald-900 text-white'
              : 'text-emerald-900 hover:bg-amber-900/10'
          }`}
        >
          {compact ? 'A' : `A (${fontScale}%)`}
        </button>
        <button
          type="button"
          onClick={stepUpFont}
          disabled={!canStepUp}
          title="Increase word size (A+)"
          className="px-2 py-1 text-[11px] font-bold text-stone-700 hover:bg-amber-900/10 rounded disabled:opacity-35 transition-colors"
        >
          A+
        </button>
      </div>

      {/* Light / Dark / System Theme Controls */}
      <div
        className="inline-flex items-center rounded-lg border border-amber-900/20 bg-white/90 p-0.5 shadow-2xs"
        role="group"
        aria-label="Theme mode"
      >
        {(
          [
            { id: 'light', label: 'Light', icon: <Sun className="w-3.5 h-3.5" /> },
            { id: 'dark', label: 'Dark', icon: <Moon className="w-3.5 h-3.5" /> },
            { id: 'system', label: 'System', icon: <Monitor className="w-3.5 h-3.5" /> },
          ] as const
        ).map((item) => {
          const active = themeMode === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setThemeMode(item.id)}
              title={`${item.label} Theme`}
              aria-pressed={active}
              className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded transition-colors ${
                active
                  ? 'bg-emerald-900 text-amber-50'
                  : 'text-stone-700 hover:bg-amber-900/10'
              }`}
            >
              {item.icon}
              {!compact && <span className="hidden xl:inline">{item.label}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
};
