import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  ClipboardCheck,
  ExternalLink,
  GraduationCap,
  HeartHandshake,
  Link2,
  Lock,
  LogOut,
  Menu,
  Shield,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { AdminRbacView } from './components/AdminRbacView';
import { AnalyticsDashboard } from './components/AnalyticsDashboard';
import { AttendanceRegister } from './components/AttendanceRegister';
import { AyurvedicCrest } from './components/AyurvedicCrest';
import { CornerAppearanceControls } from './components/CornerAppearanceControls';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LearningRepositoryView } from './components/LearningRepositoryView';
import { LoginView, SignupIntentData } from './components/LoginView';
import {
  ProfileLockGate,
  ProfileSecurityModal,
  WelcomeAyurvedaNotice,
} from './components/ProfileSecurityAndWelcome';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton';
import { ReportsAndAlertsView } from './components/ReportsAndAlertsView';
import { PieSliceItem } from './components/RolePieChartCard';
import { SmartCampusHub } from './components/SmartCampusHub';
import { StudentPortalView } from './components/StudentPortalView';
import { TeacherProfilesView } from './components/TeacherProfilesView';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from './firebase';
import {
  BOOTSTRAPPED_ADMIN_EMAIL,
  ensureUserProfile,
  hasPermission,
  seedInstitutionalData,
  updateOwnOnboarding,
} from './services/bamsFirestore';
import {
  AccessInvite,
  AttendanceAlert,
  AttendanceSession,
  ClinicalRotation,
  DEFAULT_ROLE_PERMISSIONS,
  FeedbackItem,
  INSTITUTION_ID,
  INSTITUTION_INFO,
  InteractionLog,
  LearningResource,
  LeaveRequest,
  MasterConfig,
  PermissionKey,
  StudentRecord,
  Subject,
  TeacherProfile,
  TimetableEntry,
  UserProfile,
  UserRole,
} from './types';

type NavTab =
  | 'analytics'
  | 'register'
  | 'teachers'
  | 'student'
  | 'learning'
  | 'alerts'
  | 'smart'
  | 'admin';

function MainApp() {
  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  const [activeTab, setActiveTab] = useState<NavTab>('analytics');
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>(undefined);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [adminViewRole, setAdminViewRole] = useState<string>('admin');
  const [principalStudentMode, setPrincipalStudentMode] = useState<'student' | 'parent'>('student');
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileSessionUnlocked, setProfileSessionUnlocked] = useState(false);
  const [showWelcomeNotice, setShowWelcomeNotice] = useState(false);

  // Real-time Firestore state
  const [teachers, setTeachers] = useState<TeacherProfile[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [alerts, setAlerts] = useState<AttendanceAlert[]>([]);
  const [interactionLogs, setInteractionLogs] = useState<InteractionLog[]>([]);
  const [learningResources, setLearningResources] = useState<LearningResource[]>([]);
  const [feedbackItems, setFeedbackItems] = useState<FeedbackItem[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [invites, setInvites] = useState<AccessInvite[]>([]);
  const [masterConfig, setMasterConfig] = useState<MasterConfig | null>(null);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [clinicalRotations, setClinicalRotations] = useState<ClinicalRotation[]>([]);
  const [preFillTimetableSlot, setPreFillTimetableSlot] = useState<TimetableEntry | null>(null);
  const seededOnceRef = useRef(false);
  const pendingSignupRef = useRef<SignupIntentData | null>(null);
  const adminIntentRef = useRef(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (!user) {
        setUserProfile(null);
        setAuthReady(true);
        setNeedsOnboarding(false);
        return;
      }

      try {
        const isAdminEmail =
          user.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL && user.emailVerified;
        const profile = await ensureUserProfile(user);

        if (
          pendingSignupRef.current &&
          !isAdminEmail &&
          profile.role !== 'admin' &&
          profile.approvalStatus === 'pending'
        ) {
          const signupData = pendingSignupRef.current;
          pendingSignupRef.current = null;
          const resolvedName = signupData.displayName || profile.displayName;
          const normalizedCode =
            signupData.requestedRole === 'student' || signupData.requestedRole === 'parent'
              ? signupData.rollOrEmpId.trim().toUpperCase()
              : signupData.rollOrEmpId.trim();
          const cleanedSignup = {
            ...signupData,
            displayName: resolvedName,
            rollOrEmpId: normalizedCode,
          };
          await updateOwnOnboarding(user.uid, cleanedSignup);
          setUserProfile({
            ...profile,
            ...cleanedSignup,
            approvalStatus: 'pending',
            accessCodeVerified: false,
          });
          setAdminViewRole(signupData.requestedRole);
          setNeedsOnboarding(false);
        } else {
          pendingSignupRef.current = null;
          setUserProfile(profile);

          const effectiveProfileRole: UserRole = isAdminEmail ? 'admin' : profile.role;
          setAdminViewRole(effectiveProfileRole);

          if (effectiveProfileRole === 'admin') {
            setActiveTab('admin');
          } else if (effectiveProfileRole === 'co_admin') {
            setActiveTab('admin');
          } else if (effectiveProfileRole === 'teacher') {
            setActiveTab('register');
          } else if (effectiveProfileRole === 'student' || effectiveProfileRole === 'parent') {
            setActiveTab('student');
          } else {
            setActiveTab('analytics');
          }

          if (adminIntentRef.current && effectiveProfileRole !== 'admin' && effectiveProfileRole !== 'co_admin') {
            adminIntentRef.current = false;
            setAuthError(
              `Signed in as ${user.email}. College Admin portal requires the Admin account (${BOOTSTRAPPED_ADMIN_EMAIL}) or an approved Co-Admin.`
            );
          } else {
            adminIntentRef.current = false;
          }

          if (
            !isAdminEmail &&
            profile.role !== 'admin' &&
            profile.approvalStatus === 'pending' &&
            profile.rollOrEmpId.startsWith('BAMS-') &&
            profile.rollOrEmpId.length === 11
          ) {
            setNeedsOnboarding(true);
          } else {
            setNeedsOnboarding(false);
          }
        }
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'Unable to load profile.');
      } finally {
        setAuthReady(true);
      }
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady || !firebaseUser) return;
    const path = `users/${firebaseUser.uid}`;
    const unsub = onSnapshot(
      doc(db, 'users', firebaseUser.uid),
      (snap) => {
        if (snap.exists()) {
          const updated = snap.data() as UserProfile;
          setUserProfile(updated);
        }
      },
      (error) => handleFirestoreError(error, OperationType.GET, path)
    );
    return () => unsub();
  }, [authReady, firebaseUser]);

  const isBootstrappedAdmin = Boolean(
    firebaseUser?.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL && firebaseUser?.emailVerified
  );

  // Two-stage portal access: Blocked users always locked out; active users must pass access code if issued
  const hasActivePortalAccess = Boolean(
    userProfile &&
      (isBootstrappedAdmin ||
        (userProfile.approvalStatus === 'active' &&
          (userProfile.role === 'admin' ||
            userProfile.accessCodeVerified ||
            !userProfile.accessCode)))
  );

  useEffect(() => {
    if (!authReady || !firebaseUser || !userProfile || !hasActivePortalAccess || needsOnboarding) {
      setTeachers([]);
      setSubjects([]);
      setStudents([]);
      setSessions([]);
      setAlerts([]);
      setInteractionLogs([]);
      setLearningResources([]);
      setFeedbackItems([]);
      setAllUsers([]);
      setInvites([]);
      setMasterConfig(null);
      setLeaveRequests([]);
      setClinicalRotations([]);
      return;
    }

    const isAdminRole =
      isBootstrappedAdmin || userProfile.role === 'admin' || userProfile.role === 'co_admin';
    const isStaff =
      isAdminRole || userProfile.role === 'principal' || userProfile.role === 'teacher';

    // 1. Teachers
    const unsubTeachers = onSnapshot(
      query(collection(db, 'teachers'), where('institutionId', '==', INSTITUTION_ID)),
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as TeacherProfile)
          .sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));
        setTeachers(list);

        if (isBootstrappedAdmin && snap.empty && !seededOnceRef.current) {
          seededOnceRef.current = true;
          void seedInstitutionalData(firebaseUser.uid, userProfile.displayName);
        }
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'teachers')
    );

    // 2. Subjects
    const unsubSubjects = onSnapshot(
      query(collection(db, 'subjects'), where('institutionId', '==', INSTITUTION_ID)),
      (snap) => {
        setSubjects(
          snap.docs
            .map((d) => d.data() as Subject)
            .sort((a, b) => a.code.localeCompare(b.code))
        );
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'subjects')
    );

    // 3. Students (Admin gets all; Staff get roster; Students/Parents get matched UID + Linked Roll No.)
    const cleanRoll = (userProfile.rollOrEmpId || '').trim().toUpperCase();
    const canQueryByRoll =
      !isAdminRole &&
      !isStaff &&
      (userProfile.role === 'student' || userProfile.role === 'parent') &&
      cleanRoll.length >= 2;

    const studentsQuery = isAdminRole
      ? collection(db, 'students')
      : isStaff
        ? query(collection(db, 'students'), where('staffUids', 'array-contains', firebaseUser.uid))
        : query(collection(db, 'students'), where('uid', '==', firebaseUser.uid));

    let uidMatchedStudents: StudentRecord[] = [];
    let rollMatchedStudents: StudentRecord[] = [];
    const syncMergedStudents = () => {
      const merged = new Map<string, StudentRecord>();
      uidMatchedStudents.forEach((s) => merged.set(s.id, s));
      rollMatchedStudents.forEach((s) => merged.set(s.id, s));
      setStudents(
        Array.from(merged.values()).sort((a, b) => a.rollNumber.localeCompare(b.rollNumber))
      );
    };

    const unsubStudents = onSnapshot(
      studentsQuery,
      (snap) => {
        uidMatchedStudents = snap.docs.map((d) => d.data() as StudentRecord);
        syncMergedStudents();
        if (
          (isBootstrappedAdmin || userProfile.role === 'admin') &&
          !seededOnceRef.current &&
          (snap.empty || !snap.docs.some((d) => d.id === 'stu_26_001'))
        ) {
          seededOnceRef.current = true;
          void seedInstitutionalData(firebaseUser.uid, userProfile.displayName);
        }
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'students')
    );

    let unsubLinkedWard: (() => void) | undefined;
    if (canQueryByRoll) {
      unsubLinkedWard = onSnapshot(
        query(collection(db, 'students'), where('rollNumber', '==', cleanRoll)),
        (snap) => {
          rollMatchedStudents = snap.docs.map((d) => d.data() as StudentRecord);
          syncMergedStudents();
        },
        (error) => handleFirestoreError(error, OperationType.LIST, 'students')
      );
    }

    // 4. Attendance Sessions
    const sessionsQuery = isAdminRole
      ? collection(db, 'attendanceSessions')
      : isStaff
        ? query(
            collection(db, 'attendanceSessions'),
            where('staffUids', 'array-contains', firebaseUser.uid)
          )
        : query(collection(db, 'attendanceSessions'), where('status', '==', 'submitted'));

    const unsubSessions = onSnapshot(
      sessionsQuery,
      (snap) => {
        setSessions(
          snap.docs
            .map((d) => d.data() as AttendanceSession)
            .sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime))
        );
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'attendanceSessions')
    );

    // Also subscribe to open check-in draft sessions for approved students
    let unsubOpenCheckIns: (() => void) | undefined;
    if (!isAdminRole && !isStaff) {
      unsubOpenCheckIns = onSnapshot(
        query(collection(db, 'attendanceSessions'), where('allowStudentSelfMark', '==', true)),
        (snap) => {
          const openDrafts = snap.docs.map((d) => d.data() as AttendanceSession);
          setSessions((prev) => {
            const submitted = prev.filter((s) => s.status === 'submitted');
            return [...openDrafts, ...submitted].sort(
              (a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime)
            );
          });
        },
        (error) => handleFirestoreError(error, OperationType.LIST, 'attendanceSessions')
      );
    }

    // 5. Alerts
    const alertsQuery = isAdminRole
      ? collection(db, 'alerts')
      : isStaff
        ? query(collection(db, 'alerts'), where('staffUids', 'array-contains', firebaseUser.uid))
        : query(collection(db, 'alerts'), where('targetStudentUid', '==', firebaseUser.uid));

    const unsubAlerts = onSnapshot(
      alertsQuery,
      (snap) => setAlerts(snap.docs.map((d) => d.data() as AttendanceAlert)),
      (error) => handleFirestoreError(error, OperationType.LIST, 'alerts')
    );

    // 6. Interaction Logs
    const logsQuery = isAdminRole
      ? collection(db, 'interactionLogs')
      : isStaff
        ? query(
            collection(db, 'interactionLogs'),
            where('staffUids', 'array-contains', firebaseUser.uid)
          )
        : query(collection(db, 'interactionLogs'), where('actorUid', '==', firebaseUser.uid));

    const unsubLogs = onSnapshot(
      logsQuery,
      (snap) =>
        setInteractionLogs(
          snap.docs.map((d) => d.data() as InteractionLog).sort((a, b) => b.id.localeCompare(a.id))
        ),
      (error) => handleFirestoreError(error, OperationType.LIST, 'interactionLogs')
    );

    // 7. Learning Resources
    const unsubResources = onSnapshot(
      query(collection(db, 'learningResources'), where('institutionId', '==', INSTITUTION_ID)),
      (snap) => setLearningResources(snap.docs.map((d) => d.data() as LearningResource)),
      (error) => handleFirestoreError(error, OperationType.LIST, 'learningResources')
    );

    // 8. Feedback Items
    const feedbackQuery = isAdminRole
      ? collection(db, 'feedbackItems')
      : isStaff
        ? query(
            collection(db, 'feedbackItems'),
            where('staffUids', 'array-contains', firebaseUser.uid)
          )
        : query(collection(db, 'feedbackItems'), where('authorUid', '==', firebaseUser.uid));

    const unsubFeedback = onSnapshot(
      feedbackQuery,
      (snap) => setFeedbackItems(snap.docs.map((d) => d.data() as FeedbackItem)),
      (error) => handleFirestoreError(error, OperationType.LIST, 'feedbackItems')
    );

    // 9. Master Data Configuration
    const unsubMaster = onSnapshot(
      doc(db, 'masterConfig', INSTITUTION_ID),
      (snap) => {
        if (snap.exists()) {
          setMasterConfig(snap.data() as MasterConfig);
        }
      },
      (error) => handleFirestoreError(error, OperationType.GET, `masterConfig/${INSTITUTION_ID}`)
    );

    // 10. All Users, Invites & Request Queue (Admin & Co-Admin)
    let unsubUsers: (() => void) | undefined;
    let unsubInvites: (() => void) | undefined;
    if (isAdminRole) {
      unsubUsers = onSnapshot(
        collection(db, 'users'),
        (snap) => setAllUsers(snap.docs.map((d) => d.data() as UserProfile)),
        (error) => handleFirestoreError(error, OperationType.LIST, 'users')
      );
      unsubInvites = onSnapshot(
        collection(db, 'accessInvites'),
        (snap) => setInvites(snap.docs.map((d) => d.data() as AccessInvite)),
        (error) => handleFirestoreError(error, OperationType.LIST, 'accessInvites')
      );
    }

    // 11. Medical & Duty Leave Requests (Rule-aligned per role)
    const leavesQuery = isAdminRole
      ? collection(db, 'leaveRequests')
      : isStaff
        ? query(collection(db, 'leaveRequests'), where('staffUids', 'array-contains', firebaseUser.uid))
        : query(collection(db, 'leaveRequests'), where('studentUid', '==', firebaseUser.uid));

    let uidMatchedLeaves: LeaveRequest[] = [];
    let rollMatchedLeaves: LeaveRequest[] = [];
    const syncMergedLeaves = () => {
      const merged = new Map<string, LeaveRequest>();
      uidMatchedLeaves.forEach((l) => merged.set(l.id, l));
      rollMatchedLeaves.forEach((l) => merged.set(l.id, l));
      setLeaveRequests(
        Array.from(merged.values()).sort((a, b) => b.startDate.localeCompare(a.startDate) || b.id.localeCompare(a.id))
      );
    };

    const unsubLeaves = onSnapshot(
      leavesQuery,
      (snap) => {
        uidMatchedLeaves = snap.docs.map((d) => d.data() as LeaveRequest);
        syncMergedLeaves();
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'leaveRequests')
    );

    let unsubRollLeaves: (() => void) | undefined;
    if (canQueryByRoll) {
      unsubRollLeaves = onSnapshot(
        query(collection(db, 'leaveRequests'), where('rollNumber', '==', cleanRoll)),
        (snap) => {
          rollMatchedLeaves = snap.docs.map((d) => d.data() as LeaveRequest);
          syncMergedLeaves();
        },
        (error) => handleFirestoreError(error, OperationType.LIST, 'leaveRequests')
      );
    }

    // 12. Clinical OPD/IPD Rotations (Institution-scoped for all active members)
    const unsubRotations = onSnapshot(
      query(collection(db, 'clinicalRotations'), where('institutionId', '==', INSTITUTION_ID)),
      (snap) =>
        setClinicalRotations(
          snap.docs
            .map((d) => d.data() as ClinicalRotation)
            .sort((a, b) => b.startDate.localeCompare(a.startDate))
        ),
      (error) => handleFirestoreError(error, OperationType.LIST, 'clinicalRotations')
    );

    return () => {
      unsubTeachers();
      unsubSubjects();
      unsubStudents();
      if (unsubLinkedWard) unsubLinkedWard();
      unsubSessions();
      if (unsubOpenCheckIns) unsubOpenCheckIns();
      unsubAlerts();
      unsubLogs();
      unsubResources();
      unsubFeedback();
      unsubMaster();
      if (unsubUsers) unsubUsers();
      if (unsubInvites) unsubInvites();
      unsubLeaves();
      if (unsubRollLeaves) unsubRollLeaves();
      unsubRotations();
    };
  }, [authReady, firebaseUser, userProfile, hasActivePortalAccess, isBootstrappedAdmin, needsOnboarding]);

  const handleGoogleSignIn = async () => {
    pendingSignupRef.current = null;
    adminIntentRef.current = false;
    setAuthLoading(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Google Sign-In failed.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleRoleSignUp = async (data: SignupIntentData) => {
    pendingSignupRef.current = data;
    adminIntentRef.current = false;
    setAuthLoading(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      pendingSignupRef.current = null;
      setAuthError(err instanceof Error ? err.message : 'Google Sign-Up failed.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleAdminSignIn = async () => {
    pendingSignupRef.current = null;
    adminIntentRef.current = true;
    setAuthLoading(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      adminIntentRef.current = false;
      setAuthError(err instanceof Error ? err.message : 'Admin Sign-In failed.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleCompleteOnboarding = async (data: SignupIntentData) => {
    if (!firebaseUser) return;
    await updateOwnOnboarding(firebaseUser.uid, data);
    setNeedsOnboarding(false);
  };

  const handleSignOut = async () => {
    if (firebaseUser) {
      sessionStorage.removeItem(`ssps_profile_unlocked_${firebaseUser.uid}`);
      sessionStorage.removeItem(`ssps_welcome_seen_${firebaseUser.uid}`);
    }
    setProfileSessionUnlocked(false);
    setShowWelcomeNotice(false);
    setProfileModalOpen(false);
    await signOut(auth);
  };

  useEffect(() => {
    if (!firebaseUser) {
      setProfileSessionUnlocked(false);
      setShowWelcomeNotice(false);
      return;
    }
    const unlocked = sessionStorage.getItem(`ssps_profile_unlocked_${firebaseUser.uid}`) === 'true';
    setProfileSessionUnlocked(unlocked);
  }, [firebaseUser]);

  const isProfileLockedOut = Boolean(
    userProfile &&
      hasActivePortalAccess &&
      userProfile.profileLockEnabled &&
      userProfile.profileLockPin &&
      !profileSessionUnlocked
  );

  useEffect(() => {
    if (!firebaseUser || !userProfile || !hasActivePortalAccess || needsOnboarding || isProfileLockedOut) {
      return;
    }
    const seenKey = `ssps_welcome_seen_${firebaseUser.uid}`;
    if (sessionStorage.getItem(seenKey) !== 'true') {
      setShowWelcomeNotice(true);
    }
  }, [firebaseUser, userProfile, hasActivePortalAccess, needsOnboarding, isProfileLockedOut]);

  const resolvedUserRole: UserRole = isBootstrappedAdmin
    ? 'admin'
    : userProfile?.role || 'student';

  const simulatingCustomRole = useMemo(() => {
    if (resolvedUserRole !== 'admin' || !adminViewRole.startsWith('custom:')) return null;
    const id = adminViewRole.slice('custom:'.length);
    return masterConfig?.customRoles?.find((r) => r.id === id) || null;
  }, [resolvedUserRole, adminViewRole, masterConfig]);

  const effectiveRole: UserRole = simulatingCustomRole
    ? simulatingCustomRole.baseRole
    : resolvedUserRole === 'admin'
      ? (adminViewRole as UserRole)
      : resolvedUserRole;

  const isSimulatingOtherRole =
    resolvedUserRole === 'admin' && adminViewRole !== 'admin';

  const can = useMemo(() => {
    return (permission: PermissionKey): boolean => {
      if (!userProfile) return false;
      if (resolvedUserRole === 'admin' && !isSimulatingOtherRole) return true;
      if (simulatingCustomRole) {
        return simulatingCustomRole.permissions.includes(permission);
      }
      if (isSimulatingOtherRole) {
        return DEFAULT_ROLE_PERMISSIONS[effectiveRole]?.includes(permission) ?? false;
      }
      return hasPermission(userProfile, permission);
    };
  }, [userProfile, resolvedUserRole, effectiveRole, isSimulatingOtherRole, simulatingCustomRole]);

  const pendingRequestCount = useMemo(
    () => allUsers.filter((u) => u.approvalStatus === 'pending').length,
    [allUsers]
  );

  const staffUids = useMemo(() => {
    const ids = allUsers
      .filter(
        (u) =>
          (u.role === 'admin' ||
            u.role === 'co_admin' ||
            u.role === 'principal' ||
            u.role === 'teacher') &&
          u.approvalStatus === 'active'
      )
      .map((u) => u.uid);
    if (firebaseUser) ids.push(firebaseUser.uid);
    students.forEach((s) => s.staffUids.forEach((u) => ids.push(u)));
    return Array.from(new Set(ids));
  }, [allUsers, firebaseUser, students]);

  // Strict hierarchy + Admin-assigned Permissions Checklist + Admin Profile Menu Visibility
  const navItems = useMemo(() => {
    const items: Array<{ id: NavTab; label: string; icon: React.ReactNode }> = [];
    const hiddenTabsSet = new Set(masterConfig?.profileHiddenTabs || []);

    const applyMenuVisibility = (
      rawItems: Array<{ id: NavTab; label: string; icon: React.ReactNode }>
    ) => {
      const visible = rawItems.filter((item) => {
        if (item.id === 'admin' && resolvedUserRole === 'admin') return true;
        return !hiddenTabsSet.has(`${effectiveRole}:${item.id}`);
      });
      return visible.length > 0 ? visible : rawItems.slice(0, 1);
    };

    if (effectiveRole === 'admin') {
      items.push(
        {
          id: 'admin',
          label:
            pendingRequestCount > 0
              ? `5-Role Hub & Master (${pendingRequestCount})`
              : '5-Role Hub & Master',
          icon: <Shield className="w-4 h-4" />,
        },
        { id: 'analytics', label: 'Live Analytics', icon: <BarChart3 className="w-4 h-4" /> },
        { id: 'register', label: 'Class Register', icon: <ClipboardCheck className="w-4 h-4" /> },
        { id: 'teachers', label: 'Faculty Profiles', icon: <Users className="w-4 h-4" /> },
        { id: 'student', label: 'Student Portal', icon: <GraduationCap className="w-4 h-4" /> },
        { id: 'learning', label: 'Learning & Feedback', icon: <BookOpen className="w-4 h-4" /> },
        { id: 'alerts', label: 'Reports & Alerts', icon: <AlertTriangle className="w-4 h-4" /> },
        { id: 'smart', label: 'Smart Campus Hub', icon: <Sparkles className="w-4 h-4" /> }
      );
      return applyMenuVisibility(items);
    }

    if (can('view_analytics')) {
      items.push({
        id: 'analytics',
        label: 'Live Analytics',
        icon: <BarChart3 className="w-4 h-4" />,
      });
    }

    if (can('manage_attendance') || can('override_attendance')) {
      items.push({
        id: 'register',
        label: 'Class Register',
        icon: <ClipboardCheck className="w-4 h-4" />,
      });
    }

    if (can('manage_faculty')) {
      items.push({
        id: 'teachers',
        label: 'Faculty Profiles',
        icon: <Users className="w-4 h-4" />,
      });
    }

    if (
      effectiveRole === 'student' ||
      effectiveRole === 'parent' ||
      can('manage_students') ||
      can('manage_parents')
    ) {
      items.push({
        id: 'student',
        label:
          effectiveRole === 'parent' || (effectiveRole === 'principal' && principalStudentMode === 'parent')
            ? 'Parent Report'
            : 'Student Portal',
        icon: <GraduationCap className="w-4 h-4" />,
      });
    }

    if (can('manage_learning') || effectiveRole === 'student') {
      items.push({
        id: 'learning',
        label: 'Learning & Feedback',
        icon: <BookOpen className="w-4 h-4" />,
      });
    }

    if (can('manage_alerts')) {
      items.push({
        id: 'alerts',
        label: 'Reports & Alerts',
        icon: <AlertTriangle className="w-4 h-4" />,
      });
    }

    if (
      effectiveRole === 'co_admin' ||
      effectiveRole === 'principal' ||
      effectiveRole === 'teacher'
    ) {
      items.push({
        id: 'smart',
        label: 'Smart Campus Hub',
        icon: <Sparkles className="w-4 h-4" />,
      });
    }

    if (
      effectiveRole === 'co_admin' &&
      (can('verify_users') || can('manage_master') || can('override_attendance'))
    ) {
      items.push({
        id: 'admin',
        label:
          pendingRequestCount > 0
            ? `5-Role Hub & Master (${pendingRequestCount})`
            : '5-Role Hub & Master',
        icon: <Shield className="w-4 h-4" />,
      });
    }

    if (items.length === 0) {
      items.push({
        id: 'analytics',
        label: 'Live Analytics',
        icon: <BarChart3 className="w-4 h-4" />,
      });
    }

    return applyMenuVisibility(items);
  }, [
    effectiveRole,
    resolvedUserRole,
    pendingRequestCount,
    can,
    principalStudentMode,
    masterConfig?.profileHiddenTabs,
  ]);

  const customProfileMenuLinks = useMemo(
    () =>
      (masterConfig?.profileMenuLinks || []).filter(
        (lnk) => lnk.role === 'all' || lnk.role === effectiveRole
      ),
    [masterConfig?.profileMenuLinks, effectiveRole]
  );

  const profileModalPie = useMemo<{
    title: string;
    subtitle: string;
    data: PieSliceItem[];
    centerValue: string;
    centerLabel: string;
  }>(() => {
    if (effectiveRole === 'student' || effectiveRole === 'parent') {
      const cleanRoll = (userProfile?.rollOrEmpId || '').trim().toUpperCase();
      const targetStudent =
        students.find(
          (s) =>
            s.uid === userProfile?.uid ||
            (cleanRoll && s.rollNumber.toUpperCase() === cleanRoll)
        ) || students[0];
      if (targetStudent) {
        const attendedTheory = targetStudent.theoryHoursAttended;
        const attendedPractical = targetStudent.practicalHoursAttended;
        const missed = Math.max(
          0,
          targetStudent.totalHoursScheduled - (attendedTheory + attendedPractical)
        );
        return {
          title: `${targetStudent.fullName} · Attendance Mix`,
          subtitle: `${targetStudent.profYear} (${targetStudent.rollNumber})`,
          data: [
            { name: 'Theory Attended', value: attendedTheory, color: '#065F46' },
            { name: 'Practical / OPD', value: attendedPractical, color: '#B45309' },
            { name: 'Missed / Absent', value: missed, color: '#B91C1C' },
          ],
          centerValue: `${targetStudent.attendancePercent}%`,
          centerLabel: 'Overall',
        };
      }
      return {
        title: 'Personal Attendance Summary',
        subtitle: 'Waiting for roster attendance sync',
        data: [],
        centerValue: '0%',
        centerLabel: 'Overall',
      };
    }

    if (effectiveRole === 'teacher') {
      const matchedTeacher = teachers.find(
        (t) =>
          t.ownerUid === userProfile?.uid ||
          (userProfile?.displayName &&
            t.fullName.toLowerCase().includes(userProfile.displayName.toLowerCase()))
      );
      const mySessions = matchedTeacher
        ? sessions.filter((s) => s.teacherId === matchedTeacher.id)
        : sessions.filter((s) => s.teacherUid === userProfile?.uid);
      const presentSum = mySessions.reduce((acc, s) => acc + (s.presentCount || 0), 0);
      const lateSum = mySessions.reduce((acc, s) => acc + (s.lateCount || 0), 0);
      const absentSum = mySessions.reduce((acc, s) => acc + (s.absentCount || 0), 0);
      const totalMarks = presentSum + lateSum + absentSum;
      const rate =
        totalMarks > 0 ? Math.round(((presentSum + lateSum * 0.5) / totalMarks) * 100) : 0;
      const submittedCount = mySessions.filter((s) => s.status === 'submitted').length;
      const draftCount = mySessions.filter((s) => s.status === 'draft').length;
      const slices: PieSliceItem[] =
        totalMarks > 0
          ? [
              { name: 'Present', value: presentSum, color: '#065F46' },
              { name: 'Late', value: lateSum, color: '#B45309' },
              { name: 'Absent', value: absentSum, color: '#B91C1C' },
            ]
          : [
              { name: 'Submitted Registers', value: submittedCount, color: '#065F46' },
              { name: 'Draft Registers', value: draftCount, color: '#B45309' },
            ];
      return {
        title: 'Faculty Teaching Attendance Overview',
        subtitle: `${mySessions.length} logged class session(s)`,
        data: slices,
        centerValue: totalMarks > 0 ? `${rate}%` : `${mySessions.length}`,
        centerLabel: totalMarks > 0 ? 'Avg Rate' : 'Sessions',
      };
    }

    const nominal = students.filter((s) => s.standing === 'nominal').length;
    const warning = students.filter((s) => s.standing === 'warning').length;
    const critical = students.filter((s) => s.standing === 'critical').length;
    return {
      title: 'Institutional NCISM Standing',
      subtitle: 'All Prof batches combined attendance health',
      data: [
        { name: 'Nominal (>=75%)', value: nominal, color: '#065F46' },
        { name: 'Warning (65-74%)', value: warning, color: '#B45309' },
        { name: 'Critical (<65%)', value: critical, color: '#B91C1C' },
      ],
      centerValue: `${students.length}`,
      centerLabel: 'Students',
    };
  }, [effectiveRole, userProfile, students, teachers, sessions]);

  useEffect(() => {
    if (navItems.length > 0 && !navItems.some((item) => item.id === activeTab)) {
      setActiveTab(navItems[0].id);
    }
  }, [navItems, activeTab]);

  const activeNavLabel = navItems.find((n) => n.id === activeTab)?.label || 'Dashboard';

  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="flex items-center gap-3 text-sm font-medium text-stone-700">
          <AyurvedicCrest className="w-8 h-8" />
          <span>Loading SSPSAMCH Ayurvedic Portal...</span>
        </div>
      </div>
    );
  }

  if (!firebaseUser || !userProfile) {
    return (
      <LoginView
        onGoogleSignIn={handleGoogleSignIn}
        onRoleSignUp={handleRoleSignUp}
        onAdminSignIn={handleAdminSignIn}
        loading={authLoading}
        authError={authError}
      />
    );
  }

  if (needsOnboarding) {
    return (
      <LoginView
        onGoogleSignIn={handleGoogleSignIn}
        onRoleSignUp={handleRoleSignUp}
        onAdminSignIn={handleAdminSignIn}
        loading={authLoading}
        authError={authError}
        pendingOnboardingUser={userProfile}
        onCompleteOnboarding={handleCompleteOnboarding}
        onSignOut={handleSignOut}
      />
    );
  }

  // Strict Approval Gate: Non-admin users cannot access college portals until Admin approves
  if (!hasActivePortalAccess) {
    return (
      <LoginView
        onGoogleSignIn={handleGoogleSignIn}
        onRoleSignUp={handleRoleSignUp}
        onAdminSignIn={handleAdminSignIn}
        loading={authLoading}
        authError={authError}
        accessGateUser={userProfile}
        onEditAccessRequest={() => setNeedsOnboarding(true)}
        onSignOut={handleSignOut}
      />
    );
  }

  if (isProfileLockedOut) {
    return (
      <div className="relative">
        <div className="fixed top-3 right-3 z-50">
          <CornerAppearanceControls compact />
        </div>
        <ProfileLockGate
          userProfile={userProfile}
          onUnlock={() => {
            sessionStorage.setItem(`ssps_profile_unlocked_${userProfile.uid}`, 'true');
            setProfileSessionUnlocked(true);
          }}
          onSignOut={handleSignOut}
        />
      </div>
    );
  }

  const handleOpenSession = (sessionId?: string) => {
    setSelectedSessionId(sessionId);
    setActiveTab('register');
  };

  const handleStartClassFromSlot = (slot: TimetableEntry) => {
    setPreFillTimetableSlot(slot);
    setActiveTab('register');
  };

  return (
    <div className="min-h-screen flex">
      {/* Desktop 3D Ayurvedic Banyan Architectural Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 surface-3d-dark text-white print:hidden">
        <div className="px-4 py-3.5 border-b border-amber-400/20 flex items-center gap-2.5">
          <AyurvedicCrest className="w-8 h-8 shrink-0" />
          <span className="text-base font-bold tracking-tight text-amber-50 font-display truncate">
            {INSTITUTION_INFO.shortName}
          </span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1.5 overflow-y-auto">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-all whitespace-nowrap ${
                  active
                    ? 'bg-emerald-800/95 text-amber-50 border border-amber-400/35 shadow-[inset_0_1px_0_rgba(255,248,225,0.22),0_3px_0_#071a13]'
                    : 'text-stone-300 hover:text-amber-50 hover:bg-white/10'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}

          {customProfileMenuLinks.length > 0 && (
            <div className="pt-3 mt-3 border-t border-amber-400/20 space-y-1">
              <p className="px-3 text-[10px] font-semibold uppercase tracking-wider text-amber-300/80">
                Custom Links
              </p>
              {customProfileMenuLinks.map((lnk) =>
                lnk.targetType === 'url' && lnk.url ? (
                  <a
                    key={lnk.id}
                    href={lnk.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-amber-100 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                  >
                    <span className="truncate">{lnk.label}</span>
                    <ExternalLink className="w-3.5 h-3.5 shrink-0 text-amber-300" />
                  </a>
                ) : lnk.tabId ? (
                  <button
                    key={lnk.id}
                    type="button"
                    onClick={() => setActiveTab(lnk.tabId as NavTab)}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                      activeTab === lnk.tabId
                        ? 'bg-emerald-800/95 text-amber-50 border border-amber-400/35'
                        : 'text-amber-100 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    <span className="truncate">{lnk.label}</span>
                    <Link2 className="w-3.5 h-3.5 shrink-0 text-amber-300" />
                  </button>
                ) : null
              )}
            </div>
          )}
        </nav>

        <div className="p-4 border-t border-amber-400/20 space-y-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-50 truncate">
              {userProfile.displayName}
            </p>
            <p className="text-xs text-stone-300 capitalize truncate">
              {userProfile.customRoleName || resolvedUserRole.replace('_', '-')} ·{' '}
              {resolvedUserRole === 'admin' ? 'Administration' : userProfile.profYear}
            </p>
          </div>

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setProfileModalOpen(true)}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-amber-200 bg-white/10 border border-amber-400/25 hover:bg-white/15 rounded-lg transition-colors"
            >
              <Lock className="w-3.5 h-3.5" />
              {userProfile.profileLockEnabled && userProfile.profileLockPin
                ? 'Profile & Lock (On)'
                : 'Profile & Lock PIN'}
            </button>

            <button
              type="button"
              onClick={handleSignOut}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-amber-50 bg-white/10 border border-amber-400/25 hover:bg-white/15 rounded-lg transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile 3D Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex print:hidden">
          <div
            className="fixed inset-0 bg-stone-950/55"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-64 max-w-[80vw] surface-3d-dark text-white h-full flex flex-col z-10">
            <div className="px-4 py-3.5 border-b border-amber-400/20 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <AyurvedicCrest className="w-7 h-7 shrink-0" />
                <span className="text-sm font-bold text-amber-50 font-display truncate">
                  {INSTITUTION_INFO.shortName}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-stone-300 hover:text-white"
                aria-label="Close navigation"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1.5 overflow-y-auto">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg whitespace-nowrap ${
                    activeTab === item.id
                      ? 'bg-emerald-800/95 text-amber-50 border border-amber-400/35'
                      : 'text-stone-300 hover:text-amber-50 hover:bg-white/10'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}

              {customProfileMenuLinks.length > 0 && (
                <div className="pt-3 mt-3 border-t border-amber-400/20 space-y-1">
                  <p className="px-3 text-[10px] font-semibold uppercase tracking-wider text-amber-300/80">
                    Custom Links
                  </p>
                  {customProfileMenuLinks.map((lnk) =>
                    lnk.targetType === 'url' && lnk.url ? (
                      <a
                        key={lnk.id}
                        href={lnk.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setMobileMenuOpen(false)}
                        className="w-full min-h-[40px] flex items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-amber-100 hover:text-white hover:bg-white/10 rounded-lg"
                      >
                        <span className="truncate">{lnk.label}</span>
                        <ExternalLink className="w-3.5 h-3.5 shrink-0 text-amber-300" />
                      </a>
                    ) : lnk.tabId ? (
                      <button
                        key={lnk.id}
                        type="button"
                        onClick={() => {
                          setActiveTab(lnk.tabId as NavTab);
                          setMobileMenuOpen(false);
                        }}
                        className="w-full min-h-[40px] flex items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-amber-100 hover:text-white hover:bg-white/10 rounded-lg"
                      >
                        <span className="truncate">{lnk.label}</span>
                        <Link2 className="w-3.5 h-3.5 shrink-0 text-amber-300" />
                      </button>
                    ) : null
                  )}
                </div>
              )}
            </nav>
            <div className="p-4 border-t border-amber-400/20">
              <p className="text-xs font-semibold text-amber-50 truncate">
                {userProfile.displayName}
              </p>
              <p className="text-xs text-stone-300 capitalize mb-3">
                {userProfile.customRoleName || resolvedUserRole.replace('_', '-')} ·{' '}
                {resolvedUserRole === 'admin' ? 'Administration' : userProfile.profYear}
              </p>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setProfileModalOpen(true);
                  }}
                  className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-medium text-amber-200 bg-white/10 border border-amber-400/25 rounded-lg"
                >
                  <Lock className="w-3.5 h-3.5" />
                  {userProfile.profileLockEnabled && userProfile.profileLockPin
                    ? 'Profile & Lock (On)'
                    : 'Profile & Lock PIN'}
                </button>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-medium text-amber-50 bg-white/10 border border-amber-400/25 rounded-lg"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign Out
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0 print:pl-0">
        <header className="sticky top-0 z-30 h-14 bg-[#FFFDF9]/95 border-b border-amber-900/15 shadow-xs px-4 sm:px-6 flex items-center justify-between gap-4 print:hidden">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden min-w-[44px] min-h-[44px] inline-flex items-center justify-center -ml-2 text-stone-700 hover:text-stone-900"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-xs text-stone-500 truncate">
              <span>{INSTITUTION_INFO.shortName}</span>
              <span className="mx-2">/</span>
              <span className="font-semibold text-stone-900">{activeNavLabel}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            <CornerAppearanceControls compact />
            <button
              type="button"
              onClick={() => setProfileModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium btn-3d-secondary border border-amber-900/20 rounded-lg text-stone-800 whitespace-nowrap"
              title="Open Profile, Pie Chart & Optional App-Lock PIN"
            >
              <Lock className="w-3.5 h-3.5 text-emerald-900" />
              <span className="hidden sm:inline">
                {userProfile.profileLockEnabled && userProfile.profileLockPin
                  ? 'Lock: On'
                  : 'Profile Lock'}
              </span>
            </button>
            <PWAInstallButton compact />

            {resolvedUserRole === 'admin' && (
              <div className="flex items-center gap-2">
                <label
                  htmlFor="role-perspective"
                  className="hidden sm:inline text-xs text-stone-500 whitespace-nowrap"
                >
                  Portal View:
                </label>
                <select
                  id="role-perspective"
                  value={adminViewRole}
                  onChange={(e) => {
                    const next = e.target.value;
                    setAdminViewRole(next);
                    setPrincipalStudentMode('student');
                    const customTarget = next.startsWith('custom:')
                      ? masterConfig?.customRoles?.find((r) => `custom:${r.id}` === next)?.baseRole
                      : undefined;
                    const routeRole = customTarget || next;
                    if (routeRole === 'admin') setActiveTab('admin');
                    else if (routeRole === 'student' || routeRole === 'parent') setActiveTab('student');
                    else if (routeRole === 'teacher') setActiveTab('register');
                    else setActiveTab('analytics');
                  }}
                  className="px-2.5 py-1.5 text-xs font-medium btn-3d-secondary border border-amber-900/20 rounded-lg text-stone-800"
                >
                  <option value="admin">Admin (5-Role Hub)</option>
                  <option value="co_admin">Co-Admin</option>
                  <option value="principal">Principal (Oversight)</option>
                  <option value="teacher">Faculty / Teacher</option>
                  <option value="student">Student</option>
                  <option value="parent">Parent</option>
                  {(masterConfig?.customRoles || []).map((cr) => (
                    <option key={cr.id} value={`custom:${cr.id}`}>
                      {cr.label} (Custom)
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
          {/* Principal Permitted Role Hub: Faculty · Students · Parents buttons */}
          {effectiveRole === 'principal' &&
            (can('manage_faculty') || can('manage_students') || can('manage_parents')) && (
              <section className="surface-3d rounded-xl px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 print:hidden">
                <div>
                  <p className="text-xs font-bold text-stone-900">
                    Principal Profile Controls · Permitted Portals
                  </p>
                  <p className="text-xs text-stone-500">
                    Direct access granted by Admin permissions checklist
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {can('manage_faculty') && (
                    <button
                      type="button"
                      onClick={() => setActiveTab('teachers')}
                      className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-all ${
                        activeTab === 'teachers'
                          ? 'btn-3d text-white'
                          : 'btn-3d-secondary border border-amber-900/20 text-stone-800'
                      }`}
                    >
                      <Users className="w-3.5 h-3.5" />
                      Faculty
                    </button>
                  )}
                  {(can('manage_students') || can('manage_attendance')) && (
                    <button
                      type="button"
                      onClick={() => {
                        setPrincipalStudentMode('student');
                        setActiveTab(can('manage_students') ? 'student' : 'register');
                      }}
                      className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-all ${
                        (activeTab === 'student' && principalStudentMode === 'student') ||
                        activeTab === 'register'
                          ? 'btn-3d text-white'
                          : 'btn-3d-secondary border border-amber-900/20 text-stone-800'
                      }`}
                    >
                      <GraduationCap className="w-3.5 h-3.5" />
                      Students
                    </button>
                  )}
                  {can('manage_parents') && (
                    <button
                      type="button"
                      onClick={() => {
                        setPrincipalStudentMode('parent');
                        setActiveTab('student');
                      }}
                      className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-all ${
                        activeTab === 'student' && principalStudentMode === 'parent'
                          ? 'btn-3d text-white'
                          : 'btn-3d-secondary border border-amber-900/20 text-stone-800'
                      }`}
                    >
                      <HeartHandshake className="w-3.5 h-3.5" />
                      Parents
                    </button>
                  )}
                </div>
              </section>
            )}

          {activeTab === 'analytics' && (
            <AnalyticsDashboard
              sessions={sessions}
              students={students}
              subjects={subjects}
              teachers={teachers}
              alerts={alerts}
              interactionLogs={interactionLogs}
              masterConfig={masterConfig}
              onNavigateToRegister={handleOpenSession}
              onNavigateToAlerts={() => setActiveTab('alerts')}
            />
          )}

          {activeTab === 'register' && (
            <AttendanceRegister
              sessions={sessions}
              subjects={subjects}
              students={students}
              teachers={teachers}
              currentUid={firebaseUser.uid}
              currentName={userProfile.displayName}
              currentEmail={firebaseUser.email || ''}
              currentRole={effectiveRole}
              canOverride={effectiveRole === 'admin' || can('override_attendance')}
              masterConfig={masterConfig}
              initialSessionId={selectedSessionId}
              preFillSlot={preFillTimetableSlot}
              onClearPreFill={() => setPreFillTimetableSlot(null)}
            />
          )}

          {activeTab === 'teachers' && (
            <TeacherProfilesView
              teachers={teachers}
              subjects={subjects}
              sessions={sessions}
              currentUid={firebaseUser.uid}
              currentRole={effectiveRole}
              onOpenSession={handleOpenSession}
            />
          )}

          {activeTab === 'student' && (
            <StudentPortalView
              userProfile={userProfile}
              students={students}
              sessions={sessions}
              subjects={subjects}
              resources={learningResources}
              masterConfig={masterConfig}
              leaveRequests={leaveRequests}
              clinicalRotations={clinicalRotations}
              staffUids={staffUids}
              isAdminPreview={
                effectiveRole === 'admin' ||
                effectiveRole === 'principal' ||
                (effectiveRole === 'co_admin' && can('manage_students'))
              }
              isParentMode={
                effectiveRole === 'parent' ||
                (effectiveRole === 'principal' && principalStudentMode === 'parent')
              }
              minThreshold={masterConfig?.minAttendanceThreshold ?? 75}
            />
          )}

          {activeTab === 'learning' && (
            <LearningRepositoryView
              resources={learningResources}
              feedbackItems={feedbackItems}
              subjects={subjects}
              currentUid={firebaseUser.uid}
              currentName={userProfile.displayName}
              currentRole={effectiveRole}
              staffUids={staffUids}
            />
          )}

          {activeTab === 'alerts' && (
            <ReportsAndAlertsView
              alerts={alerts}
              students={students}
              sessions={sessions}
              users={allUsers}
              subjects={subjects}
              teachers={teachers}
              interactionLogs={interactionLogs}
              leaveRequests={leaveRequests}
              masterConfig={masterConfig}
              currentUid={firebaseUser.uid}
              currentName={userProfile.displayName}
              currentRole={effectiveRole}
            />
          )}

          {activeTab === 'smart' &&
            (effectiveRole === 'admin' ||
              effectiveRole === 'co_admin' ||
              effectiveRole === 'principal' ||
              effectiveRole === 'teacher') && (
              <SmartCampusHub
                masterConfig={masterConfig}
                students={students}
                subjects={subjects}
                teachers={teachers}
                sessions={sessions}
                leaveRequests={leaveRequests}
                clinicalRotations={clinicalRotations}
                interactionLogs={interactionLogs}
                currentUid={firebaseUser.uid}
                currentName={userProfile.displayName}
                currentRole={effectiveRole}
                staffUids={staffUids}
                onStartClassFromSlot={handleStartClassFromSlot}
              />
            )}

          {activeTab === 'admin' &&
            (resolvedUserRole === 'admin' ||
              (effectiveRole === 'co_admin' &&
                (can('verify_users') || can('manage_master') || can('override_attendance')))) && (
              <AdminRbacView
                users={allUsers}
                invites={invites}
                students={students}
                sessions={sessions}
                subjects={subjects}
                teachers={teachers}
                masterConfig={masterConfig}
                currentProfile={
                  resolvedUserRole === 'admin'
                    ? {
                        ...userProfile,
                        role: 'admin',
                        permissions: DEFAULT_ROLE_PERMISSIONS.admin,
                      }
                    : userProfile
                }
                currentUid={firebaseUser.uid}
                currentName={userProfile.displayName}
              />
            )}
        </main>
      </div>
      <ProfileSecurityModal
        userProfile={userProfile}
        isOpen={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
        onLockNow={() => {
          sessionStorage.removeItem(`ssps_profile_unlocked_${userProfile.uid}`);
          setProfileSessionUnlocked(false);
          setProfileModalOpen(false);
        }}
        pieTitle={profileModalPie.title}
        pieSubtitle={profileModalPie.subtitle}
        pieData={profileModalPie.data}
        pieCenterValue={profileModalPie.centerValue}
        pieCenterLabel={profileModalPie.centerLabel}
      />
      {showWelcomeNotice && (
        <WelcomeAyurvedaNotice
          userProfile={userProfile}
          effectiveRoleLabel={
            userProfile.customRoleName ||
            (resolvedUserRole === 'teacher'
              ? 'Faculty'
              : resolvedUserRole === 'co_admin'
                ? 'Co-Admin'
                : resolvedUserRole)
          }
          onDismiss={() => {
            sessionStorage.setItem(`ssps_welcome_seen_${userProfile.uid}`, 'true');
            setShowWelcomeNotice(false);
          }}
        />
      )}
      <OfflineIndicator />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <MainApp />
    </ErrorBoundary>
  );
}
