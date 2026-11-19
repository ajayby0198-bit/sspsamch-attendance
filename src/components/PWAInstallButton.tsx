import React, { useState } from 'react';
import { Download, Smartphone, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';
import { AyurvedicCrest } from './AyurvedicCrest';

interface PWAInstallButtonProps {
  compact?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      const accepted = await install();
      if (!accepted) return;
      return;
    }
    setShowGuide(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={
          compact
            ? 'btn-3d-gold inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0'
            : 'btn-3d-gold inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0'
        }
      >
        {isIOS ? <Smartphone className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
        <span>{isInstallable ? 'Install App' : 'Mobile App'}</span>
      </button>

      {showGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/60 p-4">
          <div className="w-full max-w-md surface-3d rounded-2xl p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <AyurvedicCrest className="w-10 h-10 shrink-0" />
                <div>
                  <h3 className="text-lg font-bold text-stone-900">
                    Install SSPSAMCH as Mobile App
                  </h3>
                  <p className="text-xs text-stone-600">
                    Works as Website &amp; Standalone App on Android &amp; iPhone
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="p-1.5 text-stone-500 hover:text-stone-900"
                aria-label="Close install guide"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="surface-3d-inset rounded-xl p-4 space-y-3 text-xs text-stone-700">
              <div>
                <p className="font-semibold text-emerald-950">Android (Chrome Browser)</p>
                <p className="mt-1 leading-relaxed">
                  1. Open this portal link in Google Chrome.
                  <br />
                  2. Tap the top-right <strong>Menu (⋮)</strong> and choose{' '}
                  <strong>Install App</strong> or <strong>Add to Home screen</strong>.
                </p>
              </div>
              <div className="pt-2 border-t border-amber-900/15">
                <p className="font-semibold text-emerald-950">Apple iPhone / iPad (Safari or Chrome)</p>
                <p className="mt-1 leading-relaxed">
                  1. Open this portal link in Safari or Chrome on iOS.
                  <br />
                  2. Tap the <strong>Share</strong> icon and select{' '}
                  <strong>Add to Home Screen</strong>.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-full btn-3d py-2.5 text-xs font-medium text-white rounded-lg"
            >
              Got It
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-amber-800 px-3.5 py-2 text-xs font-medium text-amber-50 shadow-lg">
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>Offline Mode — Cached portal data active.</span>
    </div>
  );
};
