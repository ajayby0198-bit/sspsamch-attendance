import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LockOpen,
  LogOut,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { updateOwnProfileLock } from '../services/bamsFirestore';
import { INSTITUTION_INFO, UserProfile } from '../types';
import { AyurvedicCrest } from './AyurvedicCrest';
import { PieSliceItem, RolePieChartCard } from './RolePieChartCard';

interface ProfileLockGateProps {
  userProfile: UserProfile;
  onUnlock: () => void;
  onSignOut: () => Promise<void>;
}

export const ProfileLockGate: React.FC<ProfileLockGateProps> = ({
  userProfile,
  onUnlock,
  onSignOut,
}) => {
  const [pinInput, setPinInput] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const expected = (userProfile.profileLockPin || '').trim();
    if (!expected || pinInput.trim() === expected) {
      setError(null);
      onUnlock();
      return;
    }
    setError('Incorrect Profile Lock Password. Please try again or ask College Admin to view/reset it.');
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 sm:p-8">
      <div className="max-w-md w-full surface-3d rounded-2xl overflow-hidden">
        <div className="surface-3d-dark text-white px-6 py-5 flex items-center gap-3.5 border-b border-amber-400/25">
          <AyurvedicCrest className="w-11 h-11 shrink-0" />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-amber-300 tracking-wide uppercase">
              Profile App Lock Active
            </p>
            <h1 className="text-lg font-bold text-amber-50 truncate font-display">
              {userProfile.displayName}
            </h1>
            <p className="text-xs text-stone-300 font-mono truncate">{userProfile.email}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-xs text-stone-600 leading-relaxed">
            Aapne apne profile par privacy ke liye <strong>Personal Profile Lock</strong> active kiya hai. Portal kholne ke liye apna lock password daalein.
          </p>

          <div>
            <label
              htmlFor="profile-lock-unlock-input"
              className="block text-xs font-semibold text-stone-800 mb-1.5"
            >
              Enter Profile Lock Password / PIN
            </label>
            <div className="relative">
              <input
                id="profile-lock-unlock-input"
                type={showPin ? 'text' : 'password'}
                required
                autoFocus
                maxLength={24}
                placeholder="Enter your lock password"
                value={pinInput}
                onChange={(e) => {
                  setPinInput(e.target.value);
                  if (error) setError(null);
                }}
                className="w-full pl-3.5 pr-10 py-2.5 text-sm font-mono tracking-wider bg-white border border-amber-900/25 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-800/20 focus:border-emerald-800"
              />
              <button
                type="button"
                onClick={() => setShowPin((v) => !v)}
                aria-label={showPin ? 'Hide lock password' : 'Show lock password'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-800 p-1"
              >
                {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="w-full btn-3d inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white rounded-lg"
          >
            <LockOpen className="w-4 h-4" />
            Unlock Profile &amp; Open Portal
          </button>

          <div className="pt-2 border-t border-amber-900/10 flex items-center justify-between gap-3 text-xs">
            <span className="text-stone-500">
              Forgot PIN? Admin can view/reset it.
            </span>
            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex items-center gap-1.5 text-stone-700 hover:text-stone-900 font-medium whitespace-nowrap"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface ProfileSecurityModalProps {
  userProfile: UserProfile;
  isOpen: boolean;
  onClose: () => void;
  onLockNow: () => void;
  pieTitle?: string;
  pieSubtitle?: string;
  pieData?: PieSliceItem[];
  pieCenterValue?: string;
  pieCenterLabel?: string;
}

export const ProfileSecurityModal: React.FC<ProfileSecurityModalProps> = ({
  userProfile,
  isOpen,
  onClose,
  onLockNow,
  pieTitle,
  pieSubtitle,
  pieData,
  pieCenterValue,
  pieCenterLabel,
}) => {
  const isCurrentlyLocked = Boolean(userProfile.profileLockEnabled && userProfile.profileLockPin);
  const [newPin, setNewPin] = useState(userProfile.profileLockPin || '');
  const [confirmPin, setConfirmPin] = useState(userProfile.profileLockPin || '');
  const [showPins, setShowPins] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setNewPin(userProfile.profileLockPin || '');
    setConfirmPin(userProfile.profileLockPin || '');
    setMsg(null);
    setErr(null);
  }, [isOpen, userProfile.profileLockPin]);

  if (!isOpen) return null;

  const handleEnableOrUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newPin.trim();
    if (trimmed.length < 4) {
      setErr('Profile Lock password kam se kam 4 characters/digits ka hona chahiye.');
      return;
    }
    if (trimmed !== confirmPin.trim()) {
      setErr('Dono password fields match nahi kar rahe hain.');
      return;
    }
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      await updateOwnProfileLock({
        uid: userProfile.uid,
        enabled: true,
        pin: trimmed,
      });
      setMsg('Profile Lock Password active & saved. Ab har naye session/lock par yeh password maanga jayega.');
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Unable to save Profile Lock.');
    } finally {
      setSaving(false);
    }
  };

  const handleDisableLock = async () => {
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      await updateOwnProfileLock({
        uid: userProfile.uid,
        enabled: false,
        pin: '',
      });
      setNewPin('');
      setConfirmPin('');
      setMsg('Profile Lock turn off kar diya gaya hai. Ab portal direct khulega.');
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Unable to disable Profile Lock.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-950/55 print:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Profile & Optional Privacy Lock Settings"
    >
      <div className="max-w-lg w-full surface-3d rounded-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="surface-3d-dark text-white px-5 py-4 flex items-center justify-between gap-3 border-b border-amber-400/20">
          <div className="flex items-center gap-3 min-w-0">
            <AyurvedicCrest className="w-9 h-9 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-amber-300">Member Profile &amp; App Lock</p>
              <h2 className="text-base font-bold text-amber-50 truncate">{userProfile.displayName}</h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close profile settings"
            className="p-1.5 text-stone-300 hover:text-white rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-5">
          {/* Account Summary */}
          <div className="surface-3d-inset rounded-xl p-3.5 grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-stone-500">Registered Gmail</span>
              <p className="font-mono text-stone-900 truncate mt-0.5">{userProfile.email}</p>
            </div>
            <div>
              <span className="text-stone-500">Portal Role</span>
              <p className="font-semibold text-emerald-900 capitalize mt-0.5">
                {userProfile.customRoleName || userProfile.role.replace('_', ' ')} · {userProfile.profYear}
              </p>
            </div>
            <div>
              <span className="text-stone-500">ID / Roll / Emp Code</span>
              <p className="font-mono text-stone-800 mt-0.5">{userProfile.rollOrEmpId || '—'}</p>
            </div>
            <div>
              <span className="text-stone-500">Profile App Lock</span>
              <p
                className={`font-semibold mt-0.5 ${
                  isCurrentlyLocked ? 'text-emerald-800' : 'text-stone-600'
                }`}
              >
                {isCurrentlyLocked ? 'Active (Protected)' : 'Off (Optional)'}
              </p>
            </div>
          </div>

          {pieData && pieData.length > 0 && (
            <RolePieChartCard
              compact
              title={pieTitle || 'My Portal Overview (Pie Chart)'}
              subtitle={pieSubtitle}
              data={pieData}
              centerValue={pieCenterValue}
              centerLabel={pieCenterLabel}
            />
          )}

          {/* Optional Profile Lock Password Form */}
          <form onSubmit={handleEnableOrUpdate} className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-stone-900 flex items-center gap-1.5">
                  <Lock className="w-4 h-4 text-emerald-900" />
                  Personal Profile Lock Password (Optional)
                </h3>
                <p className="mt-1 text-xs text-stone-600 leading-relaxed">
                  Agar aapko phone/app par privacy chahiye (jaise bank ya phone app lock), to apna khud ka lock password banayein. Admin ko aapke mail card par yeh lock password support ke liye dikhega.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1">
                  New Lock Password / PIN
                </label>
                <div className="relative">
                  <input
                    type={showPins ? 'text' : 'password'}
                    minLength={4}
                    maxLength={24}
                    required
                    placeholder="Min 4 chars / digits"
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value)}
                    className="w-full pl-3 pr-9 py-2 text-xs font-mono bg-white border border-amber-900/20 rounded-lg focus:outline-none focus:border-emerald-800"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPins((v) => !v)}
                    aria-label={showPins ? 'Hide password' : 'Show password'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-800 p-1"
                  >
                    {showPins ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1">
                  Confirm Lock Password
                </label>
                <input
                  type={showPins ? 'text' : 'password'}
                  minLength={4}
                  maxLength={24}
                  required
                  placeholder="Re-enter lock password"
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono bg-white border border-amber-900/20 rounded-lg focus:outline-none focus:border-emerald-800"
                />
              </div>
            </div>

            {err && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
                {err}
              </div>
            )}
            {msg && (
              <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{msg}</span>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                {isCurrentlyLocked && (
                  <>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={onLockNow}
                      className="btn-3d-gold inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg whitespace-nowrap"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      Lock Screen Now
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={handleDisableLock}
                      className="btn-3d-secondary inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-red-700 rounded-lg whitespace-nowrap"
                    >
                      Turn Off Lock
                    </button>
                  </>
                )}
              </div>

              <button
                type="submit"
                disabled={saving}
                className="btn-3d inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white rounded-lg whitespace-nowrap"
              >
                <KeyRound className="w-3.5 h-3.5" />
                {saving
                  ? 'Saving...'
                  : isCurrentlyLocked
                    ? 'Update Lock Password'
                    : 'Activate Profile Lock'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

interface WelcomeAyurvedaNoticeProps {
  userProfile: UserProfile;
  effectiveRoleLabel: string;
  onDismiss: () => void;
}

export const WelcomeAyurvedaNotice: React.FC<WelcomeAyurvedaNoticeProps> = ({
  userProfile,
  effectiveRoleLabel,
  onDismiss,
}) => {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-950/60 print:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Ayurveda Institutional Notice"
    >
      <div className="max-w-xl w-full surface-3d rounded-2xl overflow-hidden">
        <div className="surface-3d-dark text-white px-6 py-5 border-b border-amber-400/25 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <AyurvedicCrest className="w-12 h-12 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-amber-300 tracking-wide">
                स्वस्थस्य स्वास्थ्य रक्षणम् · Welcome to Ayurveda
              </p>
              <h2 className="mt-0.5 text-lg sm:text-xl font-bold text-amber-50 font-display leading-snug">
                {INSTITUTION_INFO.name}
              </h2>
              <p className="mt-0.5 text-xs text-stone-300">
                NCISM Code: {INSTITUTION_INFO.ncismId} · {INSTITUTION_INFO.motto}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Close welcome notice"
            className="p-1.5 text-stone-300 hover:text-white rounded-lg shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="surface-3d-inset rounded-xl p-4 space-y-1.5">
            <p className="text-sm font-bold text-stone-900 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-700 shrink-0" />
              Namaste, {userProfile.displayName}
            </p>
            <p className="text-xs text-stone-700 leading-relaxed">
              Welcome to the <strong>Ayurveda Digital Attendance &amp; Academic Portal</strong>. You are signed in as{' '}
              <strong className="text-emerald-900 capitalize">{effectiveRoleLabel}</strong> ({userProfile.profYear}).
            </p>
          </div>

          <div className="space-y-2 text-xs text-stone-700">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-emerald-800 shrink-0 mt-0.5" />
              <p>
                <strong>NCISM 75% Attendance Standard:</strong> All BAMS lectures, Samhita sessions, Dissection/Lab practicals, and Hospital OPD/IPD hours are tracked live by date range.
              </p>
            </div>
            <div className="flex items-start gap-2.5">
              <Lock className="w-4 h-4 text-amber-800 shrink-0 mt-0.5" />
              <p>
                <strong>Optional Profile Privacy Lock:</strong> Sidebar me <strong>Profile &amp; Lock PIN</strong> option se aap chaahein to apni profile par personal App-Lock password set kar sakte hain.
              </p>
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              type="button"
              onClick={onDismiss}
              className="btn-3d inline-flex items-center justify-center gap-2 px-6 py-2.5 text-sm font-semibold text-white rounded-lg"
            >
              Enter Ayurveda Portal
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
