import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Ban,
  BarChart3,
  CheckCircle2,
  Clock,
  GraduationCap,
  HeartHandshake,
  KeyRound,
  LogIn,
  LogOut,
  RefreshCw,
  Shield,
  ShieldCheck,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { verifyOwnAccessCode } from '../services/bamsFirestore';
import {
  DEFAULT_DEPARTMENTS,
  DEFAULT_PROF_YEARS,
  INSTITUTION_INFO,
  PERMISSION_CATALOG,
  ProfYear,
  UserProfYear,
  UserProfile,
  UserRole,
} from '../types';
import { AyurvedicCrest } from './AyurvedicCrest';
import { Campus3DStage } from './Campus3DStage';
import { CornerAppearanceControls } from './CornerAppearanceControls';
import { PWAInstallButton } from './PWAInstallButton';

export interface SignupIntentData {
  displayName: string;
  profYear: UserProfYear;
  department: string;
  rollOrEmpId: string;
  requestedRole: UserRole;
}

interface LoginViewProps {
  onGoogleSignIn: () => Promise<void>;
  onRoleSignUp?: (data: SignupIntentData) => Promise<void>;
  onAdminSignIn?: () => Promise<void>;
  loading: boolean;
  authError: string | null;
  pendingOnboardingUser?: UserProfile | null;
  onCompleteOnboarding?: (data: SignupIntentData) => Promise<void>;
  accessGateUser?: UserProfile | null;
  onEditAccessRequest?: () => void;
  onSignOut?: () => Promise<void>;
}

const PREVIEW_BATCHES = [
  { label: 'Batch 2025', profYear: '1st Prof', avgPercent: 82.5, studentCount: 60 },
  { label: 'Batch 2024', profYear: '2nd Prof', avgPercent: 79.4, studentCount: 60 },
  { label: 'Batch 2023', profYear: '3rd Prof', avgPercent: 84.7, studentCount: 55 },
];

const SIGNUP_ROLE_CARDS: Array<{
  id: Exclude<UserRole, 'admin'>;
  label: string;
  subtitle: string;
  icon: React.ReactNode;
}> = [
  {
    id: 'principal',
    label: 'Principal',
    subtitle: 'College Oversight',
    icon: <Shield className="w-4 h-4" />,
  },
  {
    id: 'teacher',
    label: 'Faculty',
    subtitle: 'BAMS Class Register',
    icon: <Users className="w-4 h-4" />,
  },
  {
    id: 'student',
    label: 'Students',
    subtitle: 'Check-In & Progress',
    icon: <GraduationCap className="w-4 h-4" />,
  },
  {
    id: 'parent',
    label: 'Parents',
    subtitle: 'Ward Report Card',
    icon: <HeartHandshake className="w-4 h-4" />,
  },
  {
    id: 'co_admin',
    label: 'Co-Admin',
    subtitle: 'Delegated Admin',
    icon: <UserCheck className="w-4 h-4" />,
  },
];

export const LoginView: React.FC<LoginViewProps> = ({
  onGoogleSignIn,
  onRoleSignUp,
  onAdminSignIn,
  loading,
  authError,
  pendingOnboardingUser,
  onCompleteOnboarding,
  accessGateUser,
  onEditAccessRequest,
  onSignOut,
}) => {
  // Home auth mode: Sign In vs Sign Up
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signup');
  const [selectedSignupRole, setSelectedSignupRole] =
    useState<Exclude<UserRole, 'admin'>>('student');
  const [signupName, setSignupName] = useState('');
  const [signupProfYear, setSignupProfYear] = useState<ProfYear>('2nd Prof');
  const [signupDept, setSignupDept] = useState(DEFAULT_DEPARTMENTS[0]);
  const [signupIdCode, setSignupIdCode] = useState('');

  // Post-login onboarding state (fallback if someone signs in cleanly without pre-filling Sign Up)
  const [displayName, setDisplayName] = useState(pendingOnboardingUser?.displayName || '');
  const [requestedRole, setRequestedRole] = useState<UserRole>(
    pendingOnboardingUser?.requestedRole || 'student'
  );
  const [profYear, setProfYear] = useState<ProfYear>('2nd Prof');
  const [department, setDepartment] = useState(
    pendingOnboardingUser?.department || 'BAMS Undergraduate'
  );
  const [rollOrEmpId, setRollOrEmpId] = useState(pendingOnboardingUser?.rollOrEmpId || '');
  const [saving, setSaving] = useState(false);

  // Auto Access Code verification state
  const [accessCodeInput, setAccessCodeInput] = useState('');
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingOnboardingUser) return;
    setDisplayName(pendingOnboardingUser.displayName || '');
    setRequestedRole(pendingOnboardingUser.requestedRole || 'student');
    setDepartment(pendingOnboardingUser.department || 'BAMS Undergraduate');
    setRollOrEmpId(pendingOnboardingUser.rollOrEmpId || '');
    if (
      pendingOnboardingUser.profYear &&
      !['Faculty', 'Administration', 'Parent'].includes(pendingOnboardingUser.profYear)
    ) {
      setProfYear(pendingOnboardingUser.profYear);
    }
  }, [pendingOnboardingUser]);

  const handleHomeSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const resolvedProfYear: UserProfYear =
      selectedSignupRole === 'student'
        ? signupProfYear
        : selectedSignupRole === 'parent'
          ? 'Parent'
          : selectedSignupRole === 'co_admin'
            ? 'Administration'
            : 'Faculty';
    const resolvedDept =
      selectedSignupRole === 'student' || selectedSignupRole === 'parent'
        ? 'BAMS Undergraduate'
        : selectedSignupRole === 'co_admin'
          ? 'Institutional Administration'
          : signupDept;

    const cleanId =
      selectedSignupRole === 'student' || selectedSignupRole === 'parent'
        ? signupIdCode.trim().toUpperCase()
        : signupIdCode.trim();

    if (onRoleSignUp) {
      await onRoleSignUp({
        displayName: signupName.trim(),
        profYear: resolvedProfYear,
        department: resolvedDept,
        rollOrEmpId: cleanId,
        requestedRole: selectedSignupRole,
      });
    } else {
      await onGoogleSignIn();
    }
  };

  const handleOnboardingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onCompleteOnboarding) return;
    setSaving(true);
    const cleanId =
      requestedRole === 'student' || requestedRole === 'parent'
        ? rollOrEmpId.trim().toUpperCase()
        : rollOrEmpId.trim();
    try {
      await onCompleteOnboarding({
        displayName: displayName || 'College Member',
        profYear:
          requestedRole === 'student'
            ? profYear
            : requestedRole === 'parent'
              ? 'Parent'
              : requestedRole === 'co_admin'
                ? 'Administration'
                : 'Faculty',
        department,
        rollOrEmpId: cleanId,
        requestedRole,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleVerifyAccessCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessGateUser) return;
    setVerifyingCode(true);
    setCodeError(null);
    try {
      const ok = await verifyOwnAccessCode(
        accessGateUser.uid,
        accessCodeInput,
        accessGateUser.accessCode
      );
      if (!ok) {
        setCodeError(
          'Access password did not match. Ask College Admin for your generated SSPS-XXXXXX code.'
        );
      }
    } finally {
      setVerifyingCode(false);
    }
  };

  // Gate 1: Onboarding Request Confirmation (if signed in via generic Sign In first)
  if (pendingOnboardingUser && onCompleteOnboarding) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 sm:p-8 relative">
        <div className="fixed top-3 right-3 z-40">
          <CornerAppearanceControls compact />
        </div>
        <div className="max-w-lg w-full surface-3d rounded-2xl p-6 sm:p-8">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <AyurvedicCrest className="w-11 h-11 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-emerald-900 truncate">
                  {INSTITUTION_INFO.shortName}
                </p>
                <h1 className="text-xl sm:text-2xl font-bold text-stone-900">
                  Complete Registration Request
                </h1>
              </div>
            </div>
            {onSignOut && (
              <button
                type="button"
                onClick={onSignOut}
                className="btn-3d-secondary px-3 py-1.5 text-xs font-medium text-stone-700 rounded-lg whitespace-nowrap shrink-0"
              >
                Sign Out
              </button>
            )}
          </div>

          <p className="mt-3 text-sm text-stone-600 leading-relaxed">
            Google Account:{' '}
            <strong className="font-mono text-stone-900">{pendingOnboardingUser.email}</strong>. Select your role so the request goes straight into Admin&apos;s matching approval tab.
          </p>

          <form onSubmit={handleOnboardingSubmit} className="mt-6 space-y-4">
            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1.5">
                Full Name
              </label>
              <input
                type="text"
                required
                maxLength={100}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-amber-900/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-800/20 focus:border-emerald-800"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1.5">
                Select Portal Section
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {SIGNUP_ROLE_CARDS.map((roleOption) => (
                  <button
                    key={roleOption.id}
                    type="button"
                    onClick={() => setRequestedRole(roleOption.id)}
                    className={`px-2.5 py-2.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                      requestedRole === roleOption.id
                        ? 'text-white border-emerald-900 btn-3d'
                        : 'btn-3d-secondary text-stone-700 border-amber-900/20'
                    }`}
                  >
                    {roleOption.label}
                  </button>
                ))}
              </div>
            </div>

            {requestedRole === 'student' || requestedRole === 'parent' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1.5">
                    BAMS Prof Year
                  </label>
                  <select
                    value={profYear}
                    onChange={(e) => setProfYear(e.target.value as ProfYear)}
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-amber-900/20 rounded-lg focus:outline-none focus:border-emerald-800"
                  >
                    {DEFAULT_PROF_YEARS.map((py) => (
                      <option key={py} value={py}>
                        {py} BAMS
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1.5">
                    {requestedRole === 'parent' ? 'Ward Roll Number' : 'Roll Number'}
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={40}
                    placeholder="e.g. BAMS24-001"
                    value={rollOrEmpId}
                    onChange={(e) => setRollOrEmpId(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm font-mono bg-white border border-amber-900/20 rounded-lg focus:outline-none focus:border-emerald-800"
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1.5">
                    Ayurvedic Department
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={80}
                    placeholder="e.g. Kayachikitsa / Rachana Sharir"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-amber-900/20 rounded-lg focus:outline-none focus:border-emerald-800"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1.5">
                    Employee Code
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={40}
                    placeholder="e.g. FAC-BAMS-018"
                    value={rollOrEmpId}
                    onChange={(e) => setRollOrEmpId(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm font-mono bg-white border border-amber-900/20 rounded-lg focus:outline-none focus:border-emerald-800"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={saving}
              className="w-full mt-2 inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-medium text-white disabled:opacity-60 rounded-lg btn-3d"
            >
              {saving ? 'Submitting to Admin...' : 'Submit Request & Wait for Admin Approval'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Gate 2: Active User who hasn't entered Admin's Auto-Generated Access Password yet
  if (
    accessGateUser &&
    accessGateUser.approvalStatus === 'active' &&
    accessGateUser.role !== 'admin' &&
    !accessGateUser.accessCodeVerified
  ) {
    const grantedLabels = PERMISSION_CATALOG.filter((p) =>
      accessGateUser.permissions?.includes(p.key)
    ).map((p) => p.label);

    return (
      <div className="min-h-screen flex items-center justify-center p-4 sm:p-8 relative">
        <div className="fixed top-3 right-3 z-40">
          <CornerAppearanceControls compact />
        </div>
        <div className="max-w-lg w-full surface-3d rounded-2xl p-6 sm:p-8 space-y-5">
          <div className="flex items-start gap-4">
            <AyurvedicCrest className="w-12 h-12 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-emerald-900">{INSTITUTION_INFO.shortName}</p>
              <h1 className="mt-1 text-2xl font-bold text-stone-900">
                Approved! Enter Admin Access Password
              </h1>
              <p className="mt-1 text-xs text-stone-600">
                Your <strong className="capitalize">{accessGateUser.role.replace('_', ' ')}</strong> account (
                <span className="font-mono">{accessGateUser.email}</span>) has been verified by Admin.
              </p>
            </div>
          </div>

          <form onSubmit={handleVerifyAccessCode} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1.5">
                Auto-Generated Access Password (shared by Admin)
              </label>
              <input
                type="text"
                required
                placeholder="e.g. SSPS-482917"
                value={accessCodeInput}
                onChange={(e) => setAccessCodeInput(e.target.value)}
                className="w-full px-4 py-3 text-base font-mono tracking-wider uppercase bg-white border border-amber-900/25 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-800/20 focus:border-emerald-800"
              />
            </div>

            {codeError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
                {codeError}
              </div>
            )}

            <button
              type="submit"
              disabled={verifyingCode}
              className="w-full btn-3d inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-medium text-white rounded-lg"
            >
              <KeyRound className="w-4 h-4" />
              {verifyingCode ? 'Unlocking Portal...' : 'Verify Password & Open Dashboard'}
            </button>
          </form>

          {grantedLabels.length > 0 && (
            <div className="surface-3d-inset rounded-xl p-4 space-y-1.5 text-xs">
              <p className="font-semibold text-stone-900">Permitted Modules Selected by Admin:</p>
              <p className="text-stone-600 leading-relaxed">{grantedLabels.join(' · ')}</p>
            </div>
          )}

          {onSignOut && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onSignOut}
                className="btn-3d-secondary inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-stone-700 rounded-lg"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Gate 3: Blocked / Wait for Admin Approval / Declined Screen
  if (accessGateUser) {
    const isBlocked = accessGateUser.approvalStatus === 'blocked';
    const isRejected = accessGateUser.approvalStatus === 'rejected';
    const roleLabel =
      accessGateUser.customRoleName ||
      (accessGateUser.requestedRole === 'teacher'
        ? 'Faculty'
        : accessGateUser.requestedRole === 'co_admin'
          ? 'Co-Admin'
          : accessGateUser.requestedRole);

    return (
      <div className="min-h-screen flex items-center justify-center p-4 sm:p-8 relative">
        <div className="fixed top-3 right-3 z-40">
          <CornerAppearanceControls compact />
        </div>
        <div className="max-w-lg w-full surface-3d rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="flex items-start gap-4">
            <AyurvedicCrest className="w-12 h-12 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-emerald-900">
                {INSTITUTION_INFO.name}
              </p>
              <h1 className="mt-1 text-2xl font-bold text-stone-900">
                {isBlocked
                  ? 'Account Blocked by College Admin'
                  : isRejected
                    ? 'Access Request Declined'
                    : 'Request Sent — Wait for Admin Approval'}
              </h1>
            </div>
          </div>

          <div className="surface-3d-inset rounded-xl p-4 space-y-2 text-xs">
            <div className="flex items-center gap-2 font-semibold text-stone-900">
              {isBlocked ? (
                <Ban className="w-4 h-4 text-red-700 shrink-0" />
              ) : isRejected ? (
                <AlertCircle className="w-4 h-4 text-red-700 shrink-0" />
              ) : (
                <Clock className="w-4 h-4 text-amber-800 shrink-0" />
              )}
              <span>
                {isBlocked
                  ? 'Aapki email ID ka portal access College Admin dwara block kar diya gaya hai.'
                  : isRejected
                    ? 'Your registration request was declined by the College Admin.'
                    : `Please wait for Admin approval. Aapki request Admin ke ${roleLabel} section me bhej di gayi hai.`}
              </span>
            </div>
            <p className="text-stone-600 leading-relaxed">
              {isBlocked
                ? 'Jab tak College Admin aapko Unblock nahi karte, is email ID se portal par login ya data access nahi ho sakega. Dubara access ke liye College Admin se sampark karein.'
                : isRejected
                  ? 'Please verify your Gmail ID, Roll Number, or Employee Code and resubmit your request.'
                  : 'Jaise hi Admin aapka account verify karenge aur Auto Access Password (SSPS-XXXXXX) create karenge, yahan password daalne ka option automatically khul jayega.'}
            </p>
          </div>

          <div className="border border-amber-900/15 rounded-xl bg-white/80 divide-y divide-amber-900/10 text-xs">
            <div className="px-4 py-2.5 flex justify-between gap-4">
              <span className="text-stone-500">Registered Gmail</span>
              <span className="font-mono text-stone-900">{accessGateUser.email || '—'}</span>
            </div>
            <div className="px-4 py-2.5 flex justify-between gap-4">
              <span className="text-stone-500">Applicant Name</span>
              <span className="font-semibold text-stone-900">{accessGateUser.displayName}</span>
            </div>
            <div className="px-4 py-2.5 flex justify-between gap-4">
              <span className="text-stone-500">Admin Target Tab</span>
              <span className="font-semibold text-emerald-900 capitalize">{roleLabel}</span>
            </div>
            <div className="px-4 py-2.5 flex justify-between gap-4">
              <span className="text-stone-500">Roll / Employee ID</span>
              <span className="font-mono text-stone-800">{accessGateUser.rollOrEmpId || '—'}</span>
            </div>
            <div className="px-4 py-2.5 flex justify-between gap-4">
              <span className="text-stone-500">Current Status</span>
              <span
                className={`font-semibold capitalize ${
                  isBlocked || isRejected ? 'text-red-700' : 'text-amber-800'
                }`}
              >
                {isBlocked
                  ? 'Blocked by Admin'
                  : accessGateUser.approvalStatus === 'pending'
                    ? 'Pending Admin Verification'
                    : accessGateUser.approvalStatus}
              </span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            {onEditAccessRequest && !isBlocked && (
              <button
                type="button"
                onClick={onEditAccessRequest}
                className="flex-1 btn-3d-gold inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium rounded-lg whitespace-nowrap"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Change Role / Edit Request
              </button>
            )}
            {onSignOut && (
              <button
                type="button"
                onClick={onSignOut}
                className="btn-3d-secondary inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium text-stone-800 rounded-lg whitespace-nowrap"
              >
                <LogOut className="w-3.5 h-3.5" />
                Back to Home
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Clean 3-Zone Top Bar with Separate Admin Login CTA */}
      <header className="w-full bg-[#FFFDF9]/95 border-b border-amber-900/15 px-4 sm:px-6 py-3.5 flex items-center justify-between gap-8 shadow-xs">
        <div className="flex items-center gap-3 shrink-0">
          <AyurvedicCrest className="w-9 h-9 shrink-0" />
          <span className="text-base sm:text-lg font-bold tracking-tight text-stone-900 font-display whitespace-nowrap shrink-0">
            {INSTITUTION_INFO.shortName}
          </span>
        </div>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-stone-600">
          <a href="#portal-access" className="hover:text-emerald-900 transition-colors whitespace-nowrap shrink-0">
            Sign In / Up
          </a>
          <a href="#analytics" className="hover:text-emerald-900 transition-colors whitespace-nowrap shrink-0">
            Analytics
          </a>
          <a href="#faculty" className="hover:text-emerald-900 transition-colors whitespace-nowrap shrink-0">
            Role Portals
          </a>
          <a href="#rbac" className="hover:text-emerald-900 transition-colors whitespace-nowrap shrink-0">
            Verification
          </a>
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <CornerAppearanceControls compact />
          <button
            type="button"
            onClick={onAdminSignIn || onGoogleSignIn}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg btn-3d-gold whitespace-nowrap shrink-0"
          >
            <Shield className="w-3.5 h-3.5" />
            {loading ? 'Connecting...' : 'Admin Login'}
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8 lg:py-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          {/* Left Column: Home Sign Up (5 Roles) / Sign In + Separate Admin Option */}
          <div id="portal-access" className="lg:col-span-6 flex flex-col justify-between space-y-5">
            <div>
              <p className="text-xs font-semibold text-emerald-900 tracking-wide">
                {INSTITUTION_INFO.name}
              </p>
              <h1 className="mt-2 text-3xl sm:text-4xl font-bold tracking-tight text-stone-900 text-balance">
                {INSTITUTION_INFO.portalTitle}
              </h1>
              <p className="mt-2.5 text-sm text-stone-600 leading-relaxed">
                Select <strong>Sign Up</strong> to choose your institutional role and request Admin approval, or <strong>Sign In</strong> if your account is already verified.
              </p>
            </div>

            {/* Sign Up vs Sign In Interactive Card */}
            <div className="surface-3d rounded-2xl p-5 sm:p-6 space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="inline-flex items-center gap-1 p-1 surface-3d-inset rounded-lg">
                  <button
                    type="button"
                    onClick={() => setAuthMode('signup')}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-md transition-all whitespace-nowrap ${
                      authMode === 'signup'
                        ? 'btn-3d text-white'
                        : 'text-stone-700 hover:text-stone-900'
                    }`}
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    Sign Up (New Request)
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuthMode('signin')}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-md transition-all whitespace-nowrap ${
                      authMode === 'signin'
                        ? 'btn-3d text-white'
                        : 'text-stone-700 hover:text-stone-900'
                    }`}
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    Sign In
                  </button>
                </div>

                <PWAInstallButton compact />
              </div>

              {authMode === 'signup' ? (
                <form onSubmit={handleHomeSignUp} className="space-y-4">
                  <div>
                    <p className="text-xs font-semibold text-stone-800 mb-2">
                      1. Choose Role for Verification Request:
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                      {SIGNUP_ROLE_CARDS.map((card) => {
                        const active = selectedSignupRole === card.id;
                        return (
                          <button
                            key={card.id}
                            type="button"
                            onClick={() => setSelectedSignupRole(card.id)}
                            className={`p-2.5 rounded-xl text-left border transition-all flex flex-col gap-1 min-h-[68px] ${
                              active
                                ? 'btn-3d text-white border-emerald-950'
                                : 'bg-white/85 border-amber-900/20 text-stone-800 hover:border-emerald-800/40'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              {card.icon}
                              {active && <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
                            </div>
                            <span className="text-xs font-bold leading-tight">{card.label}</span>
                            <span
                              className={`text-[11px] leading-tight truncate ${
                                active ? 'text-emerald-100' : 'text-stone-500'
                              }`}
                            >
                              {card.subtitle}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <input
                      type="text"
                      required
                      maxLength={100}
                      placeholder="Your Full Name"
                      value={signupName}
                      onChange={(e) => setSignupName(e.target.value)}
                      className="px-3 py-2 text-xs bg-white border border-amber-900/20 rounded-lg focus:outline-none focus:border-emerald-800"
                    />
                    {selectedSignupRole === 'student' || selectedSignupRole === 'parent' ? (
                      <select
                        value={signupProfYear}
                        onChange={(e) => setSignupProfYear(e.target.value)}
                        className="px-3 py-2 text-xs bg-white border border-amber-900/20 rounded-lg focus:outline-none focus:border-emerald-800"
                      >
                        {DEFAULT_PROF_YEARS.map((py) => (
                          <option key={py} value={py}>
                            {py} BAMS
                          </option>
                        ))}
                      </select>
                    ) : (
                      <select
                        value={signupDept}
                        onChange={(e) => setSignupDept(e.target.value)}
                        className="px-3 py-2 text-xs bg-white border border-amber-900/20 rounded-lg focus:outline-none focus:border-emerald-800"
                      >
                        {DEFAULT_DEPARTMENTS.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    )}
                    <input
                      type="text"
                      required
                      maxLength={40}
                      placeholder={
                        selectedSignupRole === 'parent'
                          ? 'Ward Roll No (e.g. BAMS24-001)'
                          : selectedSignupRole === 'student'
                            ? 'Roll No (e.g. BAMS24-001)'
                            : 'Employee ID (e.g. FAC-012)'
                      }
                      value={signupIdCode}
                      onChange={(e) => setSignupIdCode(e.target.value)}
                      className="px-3 py-2 text-xs font-mono bg-white border border-amber-900/20 rounded-lg focus:outline-none focus:border-emerald-800"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white disabled:opacity-60 rounded-lg btn-3d"
                  >
                    <UserPlus className="w-4 h-4" />
                    {loading
                      ? 'Submitting Request...'
                      : `Sign Up with Google as ${
                          SIGNUP_ROLE_CARDS.find((c) => c.id === selectedSignupRole)?.label
                        }`}
                  </button>
                  <p className="text-xs text-stone-500">
                    Sign up karne ke baad aapki request Admin ke{' '}
                    <strong className="text-stone-800">
                      {SIGNUP_ROLE_CARDS.find((c) => c.id === selectedSignupRole)?.label}
                    </strong>{' '}
                    section me jayegi aur approval wait screen dikhega.
                  </p>
                </form>
              ) : (
                <div className="space-y-4">
                  <p className="text-xs text-stone-600 leading-relaxed">
                    Already registered or pre-added by College Admin? Sign in with your verified Google account and enter your Auto Access Password (`SSPS-XXXXXX`) if prompted.
                  </p>
                  <button
                    type="button"
                    onClick={onGoogleSignIn}
                    disabled={loading}
                    className="w-full inline-flex items-center justify-center gap-2.5 px-5 py-3 text-sm font-semibold text-white disabled:opacity-60 rounded-lg btn-3d"
                  >
                    <LogIn className="w-4 h-4" />
                    {loading ? 'Signing In...' : 'Sign In with Google Account'}
                  </button>
                </div>
              )}

              {authError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
                  {authError}
                </div>
              )}
            </div>

            {/* Separate Admin Login Strip on Home Page */}
            <div className="surface-3d-dark text-amber-50 rounded-xl p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  College Super Admin Portal (Separate Access)
                </p>
                <p className="mt-0.5 text-xs text-stone-300">
                  Admin login yahan se alag karein — 5 role verification queues &amp; Master Data kholne ke liye.
                </p>
              </div>
              <button
                type="button"
                onClick={onAdminSignIn || onGoogleSignIn}
                disabled={loading}
                className="btn-3d-gold px-4 py-2.5 text-xs font-bold rounded-lg whitespace-nowrap shrink-0"
              >
                {loading ? 'Opening...' : 'Admin Login'}
              </button>
            </div>
          </div>

          {/* Right Column: Interactive 3D Ayurvedic Batch Stage */}
          <div className="lg:col-span-6 flex flex-col">
            <Campus3DStage batches={PREVIEW_BATCHES} className="flex-1 min-h-[380px] lg:h-full" />
          </div>
        </div>

        <section
          id="analytics"
          className="mt-12 pt-8 border-t border-amber-900/15 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5"
        >
          <div id="hours-module" className="surface-3d-interactive rounded-xl p-5">
            <Clock className="w-5 h-5 text-emerald-900" />
            <h2 className="mt-3 text-base font-bold text-stone-900">1. Role-Wise Sign Up</h2>
            <p className="mt-1 text-xs text-stone-600 leading-relaxed">
              Principal, Faculty, Students, Parents ya Co-Admin apna role chunein aur Google se request bhejein.
            </p>
          </div>
          <div id="faculty" className="surface-3d-interactive rounded-xl p-5">
            <Users className="w-5 h-5 text-emerald-900" />
            <h2 className="mt-3 text-base font-bold text-stone-900">2. Admin 5-Tab Queue</h2>
            <p className="mt-1 text-xs text-stone-600 leading-relaxed">
              Har role ki request Admin profile ke usi tab me jati hai jahan se verify, permissions aur password milta hai.
            </p>
          </div>
          <div className="surface-3d-interactive rounded-xl p-5">
            <BarChart3 className="w-5 h-5 text-emerald-900" />
            <h2 className="mt-3 text-base font-bold text-stone-900">3. Date-Range Analytics</h2>
            <p className="mt-1 text-xs text-stone-600 leading-relaxed">
              Hours-wise BAMS class attendance, drafts, aur From–To date range monitoring live charts par dekhein.
            </p>
          </div>
          <div id="rbac" className="surface-3d-interactive rounded-xl p-5">
            <ShieldCheck className="w-5 h-5 text-amber-800" />
            <h2 className="mt-3 text-base font-bold text-stone-900">4. Mobile App (PWA)</h2>
            <p className="mt-1 text-xs text-stone-600 leading-relaxed">
              Website link ko Android Chrome ya Apple Safari/Chrome me app ki tarah install karke use karein.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
};
