import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Ban,
  BookPlus,
  Check,
  CheckCircle2,
  Copy,
  Database,
  ExternalLink,
  KeyRound,
  Link2,
  Lock,
  MailPlus,
  Menu,
  MinusCircle,
  Plus,
  PlusCircle,
  RefreshCw,
  Settings2,
  Shield,
  Sliders,
  Trash2,
  UserCheck,
  UserPlus,
  XCircle,
} from 'lucide-react';
import {
  adminAdjustStudentAttendance,
  adminApproveRequest,
  adminBlockUser,
  adminCreateAccessInvite,
  adminCreateSubject,
  adminDeleteAccessInvite,
  adminDeleteSubject,
  adminEnrollStudent,
  adminPromoteBatch,
  adminReassignSubjectTeacher,
  adminRegenerateAccessCode,
  adminRejectRequest,
  adminResetProfileLock,
  adminUnblockUser,
  adminUpdateUserPermissions,
  hasPermission,
  saveMasterConfig,
} from '../services/bamsFirestore';
import {
  AccessInvite,
  AttendanceSession,
  CustomMasterSection,
  CustomRoleDef,
  DEFAULT_ACTIVITY_TYPES,
  DEFAULT_ATTENDANCE_OPTIONS,
  DEFAULT_DEPARTMENTS,
  DEFAULT_PROF_YEARS,
  DEFAULT_ROLE_PERMISSIONS,
  DEFAULT_SESSION_TYPES,
  MasterConfig,
  PERMISSION_CATALOG,
  PermissionKey,
  PortalTabId,
  ProfYear,
  ProfileMenuLink,
  StudentRecord,
  Subject,
  TeacherProfile,
  UserProfile,
  UserRole,
} from '../types';
import { ExcelAttendanceImporter } from './ExcelAttendanceImporter';
import { RolePieChartCard } from './RolePieChartCard';

const PORTAL_MENU_TABS: Array<{ id: PortalTabId; label: string }> = [
  { id: 'analytics', label: 'Live Analytics' },
  { id: 'register', label: 'Class Register' },
  { id: 'teachers', label: 'Faculty Profiles' },
  { id: 'student', label: 'Student / Parent Portal' },
  { id: 'learning', label: 'Learning & Feedback' },
  { id: 'alerts', label: 'Reports & Alerts' },
  { id: 'smart', label: 'Smart Campus Hub' },
  { id: 'admin', label: '5-Role Hub & Master' },
];

const PROFILE_LINK_ROLES: Array<{ id: UserRole | 'all'; label: string }> = [
  { id: 'all', label: 'All Profiles' },
  { id: 'admin', label: 'Admin' },
  { id: 'co_admin', label: 'Co-Admin' },
  { id: 'principal', label: 'Principal' },
  { id: 'teacher', label: 'Faculty / Teacher' },
  { id: 'student', label: 'Student' },
  { id: 'parent', label: 'Parent' },
];

function normalizeSafeExternalUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

type BaseRoleTab = 'principal' | 'teacher' | 'student' | 'parent' | 'co_admin';
type AdminHubTab = BaseRoleTab | 'master' | `custom:${string}`;

const ROLE_TABS: Array<{ id: BaseRoleTab; label: string; subtitle: string }> = [
  { id: 'principal', label: 'Principal', subtitle: 'College Head & Teacher Oversight' },
  { id: 'teacher', label: 'Faculty', subtitle: 'BAMS Teachers & Class Registers' },
  { id: 'student', label: 'Students', subtitle: 'BAMS Students & Attendance Control' },
  { id: 'parent', label: 'Parents', subtitle: 'Ward Progress & Alert Guardians' },
  { id: 'co_admin', label: 'Co-Admin', subtitle: 'Delegated Administrative Support' },
];

interface AdminRbacViewProps {
  users: UserProfile[];
  invites: AccessInvite[];
  students: StudentRecord[];
  sessions: AttendanceSession[];
  subjects: Subject[];
  teachers: TeacherProfile[];
  masterConfig: MasterConfig | null;
  currentProfile: UserProfile;
  currentUid: string;
  currentName: string;
}

export const AdminRbacView: React.FC<AdminRbacViewProps> = ({
  users,
  invites,
  students,
  sessions,
  subjects,
  teachers,
  masterConfig,
  currentProfile,
  currentUid,
  currentName,
}) => {
  const canVerifyUsers = hasPermission(currentProfile, 'verify_users');
  const canManageMaster = hasPermission(currentProfile, 'manage_master');
  const canOverrideAttendance = hasPermission(currentProfile, 'override_attendance');

  const [activeHubTab, setActiveHubTab] = useState<AdminHubTab>('principal');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [generatedCredential, setGeneratedCredential] = useState<{
    email: string;
    name: string;
    role: string;
    code: string;
  } | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Per-request permissions checklist & roll/ward code override before approving
  const [requestPerms, setRequestPerms] = useState<Record<string, PermissionKey[]>>({});
  const [requestRollOverrides, setRequestRollOverrides] = useState<Record<string, string>>({});
  // Expandable edit-permissions drawer per verified user
  const [editingPermsUid, setEditingPermsUid] = useState<string | null>(null);
  const [editUserPerms, setEditUserPerms] = useState<PermissionKey[]>([]);

  // Pre-add / Invite Email Form for active role tab
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteProfYear, setInviteProfYear] = useState('1st Prof');
  const [inviteDepartment, setInviteDepartment] = useState('Kayachikitsa');
  const [inviteIdCode, setInviteIdCode] = useState('');
  const [invitePermissions, setInvitePermissions] = useState<PermissionKey[]>(
    DEFAULT_ROLE_PERMISSIONS.principal
  );
  const [creatingInvite, setCreatingInvite] = useState(false);

  // Admin Attendance Add / Remove Override state (under Students tab)
  const [selectedStudentId, setSelectedStudentId] = useState<string>(students[0]?.id || '');
  const [adjustMode, setAdjustMode] = useState<'add' | 'remove'>('add');
  const [adjustHours, setAdjustHours] = useState<number>(2);
  const [adjustCategory, setAdjustCategory] = useState<'theory' | 'practical'>('theory');
  const [adjustScheduled, setAdjustScheduled] = useState<boolean>(true);
  const [adjustReason, setAdjustReason] = useState<string>('');
  const [adjusting, setAdjusting] = useState(false);

  // Academic Batch Promotion / Rollover state
  const [promoKey, setPromoKey] = useState<string>('');
  const [promoTargetProf, setPromoTargetProf] = useState<ProfYear>('2nd Prof');
  const [promoResetHours, setPromoResetHours] = useState<boolean>(false);
  const [promotingBatch, setPromotingBatch] = useState<boolean>(false);

  // Master Data Editor state
  const [sessionTypes, setSessionTypes] = useState<string[]>(
    masterConfig?.sessionTypes?.length ? masterConfig.sessionTypes : DEFAULT_SESSION_TYPES
  );
  const [activityTypes, setActivityTypes] = useState<string[]>(
    masterConfig?.activityTypes?.length ? masterConfig.activityTypes : DEFAULT_ACTIVITY_TYPES
  );
  const [attendanceOptions, setAttendanceOptions] = useState<string[]>(
    masterConfig?.attendanceOptions?.length
      ? masterConfig.attendanceOptions
      : DEFAULT_ATTENDANCE_OPTIONS
  );
  const [profYears, setProfYears] = useState<string[]>(
    masterConfig?.profYears?.length ? masterConfig.profYears : DEFAULT_PROF_YEARS
  );
  const [departments, setDepartments] = useState<string[]>(
    masterConfig?.departments?.length ? masterConfig.departments : DEFAULT_DEPARTMENTS
  );
  const [customSections, setCustomSections] = useState<CustomMasterSection[]>(
    masterConfig?.customSections || []
  );
  const [customRoles, setCustomRoles] = useState<CustomRoleDef[]>(
    masterConfig?.customRoles || []
  );
  const [profileMenuLinks, setProfileMenuLinks] = useState<ProfileMenuLink[]>(
    masterConfig?.profileMenuLinks || []
  );
  const [profileHiddenTabs, setProfileHiddenTabs] = useState<string[]>(
    masterConfig?.profileHiddenTabs || []
  );
  const [menuManagerRole, setMenuManagerRole] = useState<UserRole | 'all'>('student');
  const [newLinkLabel, setNewLinkLabel] = useState('');
  const [newLinkTargetType, setNewLinkTargetType] = useState<'url' | 'tab'>('url');
  const [newLinkUrl, setNewLinkUrl] = useState('');
  const [newLinkTab, setNewLinkTab] = useState<PortalTabId>('learning');
  const [savingMenuLinks, setSavingMenuLinks] = useState(false);

  const [minThreshold, setMinThreshold] = useState<number>(
    masterConfig?.minAttendanceThreshold ?? 75
  );
  const [newSessionOpt, setNewSessionOpt] = useState('');
  const [newActivityOpt, setNewActivityOpt] = useState('');
  const [newAttendanceOpt, setNewAttendanceOpt] = useState('');
  const [newProfYearOpt, setNewProfYearOpt] = useState('');
  const [newDeptOpt, setNewDeptOpt] = useState('');
  const [newSectionTitle, setNewSectionTitle] = useState('');
  const [newSectionInitialOpt, setNewSectionInitialOpt] = useState('');
  const [customSectionInputs, setCustomSectionInputs] = useState<Record<string, string>>({});
  const [savingMaster, setSavingMaster] = useState(false);

  // Add Custom Role Form state
  const [showAddRoleForm, setShowAddRoleForm] = useState(false);
  const [newRoleLabel, setNewRoleLabel] = useState('');
  const [newRoleSubtitle, setNewRoleSubtitle] = useState('');
  const [newRoleBase, setNewRoleBase] = useState<BaseRoleTab>('co_admin');
  const [newRolePerms, setNewRolePerms] = useState<PermissionKey[]>(
    DEFAULT_ROLE_PERMISSIONS.co_admin
  );
  const [savingCustomRole, setSavingCustomRole] = useState(false);

  // New Subject Master Form & Reassignment state
  const [subCode, setSubCode] = useState('');
  const [subName, setSubName] = useState('');
  const [subDept, setSubDept] = useState(departments[0] || 'Kayachikitsa');
  const [subProf, setSubProf] = useState(profYears[0] || '1st Prof');
  const [subTheoryHrs, setSubTheoryHrs] = useState(120);
  const [subPracHrs, setSubPracHrs] = useState(80);
  const [subTeacherId, setSubTeacherId] = useState(teachers[0]?.id || '');
  const [savingSubject, setSavingSubject] = useState(false);
  const [reassigningSubId, setReassigningSubId] = useState<string | null>(null);

  useEffect(() => {
    if (!masterConfig) return;
    setSessionTypes(masterConfig.sessionTypes);
    setActivityTypes(masterConfig.activityTypes);
    setAttendanceOptions(masterConfig.attendanceOptions);
    setProfYears(masterConfig.profYears);
    setDepartments(masterConfig.departments);
    setCustomSections(masterConfig.customSections || []);
    setCustomRoles(masterConfig.customRoles || []);
    setProfileMenuLinks(masterConfig.profileMenuLinks || []);
    setProfileHiddenTabs(masterConfig.profileHiddenTabs || []);
    setMinThreshold(masterConfig.minAttendanceThreshold);
  }, [masterConfig]);

  const activeCustomRole = useMemo(() => {
    if (!activeHubTab.startsWith('custom:')) return null;
    const id = activeHubTab.slice('custom:'.length);
    return customRoles.find((cr) => cr.id === id) || null;
  }, [activeHubTab, customRoles]);

  const activeBaseRole: BaseRoleTab | null = useMemo(() => {
    if (activeHubTab === 'master') return null;
    if (activeHubTab.startsWith('custom:')) {
      return activeCustomRole?.baseRole || 'co_admin';
    }
    return activeHubTab as BaseRoleTab;
  }, [activeHubTab, activeCustomRole]);

  useEffect(() => {
    if (!activeBaseRole) return;
    setInvitePermissions(
      activeCustomRole ? activeCustomRole.permissions : DEFAULT_ROLE_PERMISSIONS[activeBaseRole]
    );
    setInviteDepartment(
      activeBaseRole === 'principal' || activeBaseRole === 'teacher'
        ? departments[0] || 'Kayachikitsa'
        : activeBaseRole === 'co_admin'
          ? 'Institutional Administration'
          : 'BAMS Undergraduate'
    );
    setInviteProfYear(
      activeBaseRole === 'principal' || activeBaseRole === 'teacher'
        ? 'Faculty'
        : activeBaseRole === 'co_admin'
          ? 'Administration'
          : activeBaseRole === 'parent'
            ? 'Parent'
            : profYears[0] || '1st Prof'
    );
  }, [activeBaseRole, activeCustomRole, departments, profYears]);

  const staffUids = useMemo(() => {
    const ids = users
      .filter(
        (u) =>
          (u.role === 'admin' ||
            u.role === 'co_admin' ||
            u.role === 'principal' ||
            u.role === 'teacher') &&
          u.approvalStatus === 'active'
      )
      .map((u) => u.uid);
    return Array.from(new Set([currentUid, ...ids]));
  }, [users, currentUid]);

  const pendingCountsByRole = useMemo(() => {
    const counts: Record<BaseRoleTab, number> = {
      principal: 0,
      teacher: 0,
      student: 0,
      parent: 0,
      co_admin: 0,
    };
    users.forEach((u) => {
      if (u.approvalStatus === 'pending' && u.requestedRole in counts) {
        counts[u.requestedRole as BaseRoleTab] += 1;
      }
    });
    return counts;
  }, [users]);

  const customRoleIdSet = useMemo(() => new Set(customRoles.map((r) => r.id)), [customRoles]);

  const activeRoleTab = activeBaseRole;
  const activeRoleDisplayLabel = activeCustomRole
    ? activeCustomRole.label
    : activeRoleTab === 'teacher'
      ? 'Faculty'
      : activeRoleTab === 'co_admin'
        ? 'Co-Admin'
        : activeRoleTab
          ? activeRoleTab.charAt(0).toUpperCase() + activeRoleTab.slice(1)
          : '';

  const rolePendingUsers = useMemo(() => {
    if (!activeRoleTab) return [];
    if (activeCustomRole) {
      return users.filter(
        (u) =>
          u.approvalStatus === 'pending' &&
          (u.customRoleId === activeCustomRole.id || u.requestedRole === activeCustomRole.baseRole)
      );
    }
    return users.filter((u) => u.approvalStatus === 'pending' && u.requestedRole === activeRoleTab);
  }, [users, activeRoleTab, activeCustomRole]);

  const roleVerifiedUsers = useMemo(() => {
    if (!activeRoleTab) return [];
    if (activeCustomRole) {
      return users.filter(
        (u) => u.approvalStatus === 'active' && u.customRoleId === activeCustomRole.id
      );
    }
    return users.filter(
      (u) =>
        u.approvalStatus === 'active' &&
        (!u.customRoleId || !customRoleIdSet.has(u.customRoleId)) &&
        u.role === activeRoleTab
    );
  }, [users, activeRoleTab, activeCustomRole, customRoleIdSet]);

  const roleBlockedUsers = useMemo(() => {
    if (!activeRoleTab) return [];
    if (activeCustomRole) {
      return users.filter(
        (u) => u.approvalStatus === 'blocked' && u.customRoleId === activeCustomRole.id
      );
    }
    return users.filter(
      (u) =>
        u.approvalStatus === 'blocked' &&
        (!u.customRoleId || !customRoleIdSet.has(u.customRoleId)) &&
        (u.role === activeRoleTab || u.requestedRole === activeRoleTab)
    );
  }, [users, activeRoleTab, activeCustomRole, customRoleIdSet]);

  const roleInvites = useMemo(() => {
    if (!activeRoleTab) return [];
    if (activeCustomRole) {
      return invites.filter(
        (inv) => inv.status === 'invited' && inv.customRoleId === activeCustomRole.id
      );
    }
    return invites.filter(
      (inv) =>
        inv.status === 'invited' &&
        (!inv.customRoleId || !customRoleIdSet.has(inv.customRoleId)) &&
        inv.role === activeRoleTab
    );
  }, [invites, activeRoleTab, activeCustomRole, customRoleIdSet]);

  const enrolledUids = useMemo(() => new Set(students.map((s) => s.uid)), [students]);
  const effectiveStudent = useMemo(
    () => students.find((s) => s.id === selectedStudentId) || students[0] || null,
    [students, selectedStudentId]
  );

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch {
      setCopiedCode(code);
    }
  };

  const getRequestPerms = (u: UserProfile, role: UserRole): PermissionKey[] => {
    return (
      requestPerms[u.uid] ||
      (activeCustomRole ? activeCustomRole.permissions : DEFAULT_ROLE_PERMISSIONS[role])
    );
  };

  const toggleRequestPerm = (uid: string, role: UserRole, perm: PermissionKey) => {
    const base =
      requestPerms[uid] ||
      (activeCustomRole ? activeCustomRole.permissions : DEFAULT_ROLE_PERMISSIONS[role]);
    const next = base.includes(perm) ? base.filter((p) => p !== perm) : [...base, perm];
    setRequestPerms((prev) => ({ ...prev, [uid]: next }));
  };

  const handleVerifyUser = async (targetUser: UserProfile, roleToGrant: UserRole) => {
    if (!canVerifyUsers) return;
    setUpdatingId(targetUser.uid);
    setStatusMessage(null);
    try {
      const perms = getRequestPerms(targetUser, roleToGrant);
      const chosenRoll =
        requestRollOverrides[targetUser.uid] !== undefined
          ? requestRollOverrides[targetUser.uid]
          : targetUser.rollOrEmpId;
      const { accessCode } = await adminApproveRequest({
        targetUser,
        approvedRole: roleToGrant,
        permissions: perms,
        overrideRollOrEmpId: chosenRoll,
        customRoleId: activeCustomRole?.id,
        customRoleName: activeCustomRole?.label,
        regenerateCode: true,
        actorUid: currentUid,
        actorName: currentName,
        allStaffUids: staffUids,
      });
      setGeneratedCredential({
        email: targetUser.email || 'Google Account',
        name: targetUser.displayName,
        role: activeCustomRole?.label || roleToGrant,
        code: accessCode,
      });
      setStatusMessage(
        `Verified ${targetUser.displayName} (${activeCustomRole?.label || roleToGrant}). Share Auto Password ${accessCode} so they can unlock their dashboard.`
      );
    } finally {
      setUpdatingId(null);
    }
  };

  const handleRejectUser = async (targetUser: UserProfile) => {
    if (!canVerifyUsers) return;
    setUpdatingId(targetUser.uid);
    setStatusMessage(null);
    try {
      await adminRejectRequest({
        targetUser,
        actorUid: currentUid,
        actorName: currentName,
        allStaffUids: staffUids,
      });
      setStatusMessage(`Rejected access request for ${targetUser.displayName}.`);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleBlockUser = async (targetUser: UserProfile) => {
    if (!canVerifyUsers) return;
    setUpdatingId(targetUser.uid);
    setStatusMessage(null);
    try {
      await adminBlockUser({
        targetUser,
        actorUid: currentUid,
        actorName: currentName,
        allStaffUids: staffUids,
      });
      setStatusMessage(
        `Blocked ${targetUser.displayName} (${targetUser.email}). Their email ID can no longer access the portal.`
      );
    } finally {
      setUpdatingId(null);
    }
  };

  const handleUnblockUser = async (targetUser: UserProfile) => {
    if (!canVerifyUsers) return;
    setUpdatingId(targetUser.uid);
    setStatusMessage(null);
    try {
      await adminUnblockUser({
        targetUser,
        actorUid: currentUid,
        actorName: currentName,
        allStaffUids: staffUids,
      });
      setStatusMessage(
        `Unblocked ${targetUser.displayName} (${targetUser.email}). Portal access restored.`
      );
    } finally {
      setUpdatingId(null);
    }
  };

  const handleResetProfileLock = async (targetUser: UserProfile) => {
    if (!canVerifyUsers) return;
    setUpdatingId(targetUser.uid);
    setStatusMessage(null);
    try {
      await adminResetProfileLock(targetUser.uid);
      setStatusMessage(
        `Cleared personal Profile Lock PIN for ${targetUser.displayName}. They can set a new one anytime.`
      );
    } finally {
      setUpdatingId(null);
    }
  };

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRoleTab || !inviteEmail.trim() || !canVerifyUsers) return;
    setCreatingInvite(true);
    setStatusMessage(null);
    try {
      const { accessCode, alreadyRegistered } = await adminCreateAccessInvite({
        email: inviteEmail,
        displayName: inviteName,
        role: activeRoleTab,
        profYear: inviteProfYear,
        department: inviteDepartment,
        rollOrEmpId: inviteIdCode,
        permissions: invitePermissions,
        customRoleId: activeCustomRole?.id,
        customRoleName: activeCustomRole?.label,
        existingUsers: users,
        actorUid: currentUid,
        actorName: currentName,
        allStaffUids: staffUids,
      });
      setGeneratedCredential({
        email: inviteEmail.trim().toLowerCase(),
        name: inviteName || inviteEmail.trim(),
        role: activeCustomRole?.label || activeRoleTab,
        code: accessCode,
      });
      setStatusMessage(
        alreadyRegistered
          ? `${inviteEmail.trim().toLowerCase()} was already signed up — verified & activated with Auto Password ${accessCode}.`
          : `Added ${inviteEmail.trim().toLowerCase()} under ${activeCustomRole?.label || activeRoleTab}. Share Auto Password ${accessCode} for login verification.`
      );
      setInviteEmail('');
      setInviteName('');
      setInviteIdCode('');
    } finally {
      setCreatingInvite(false);
    }
  };

  const handleSaveUserPermissions = async (u: UserProfile) => {
    setUpdatingId(u.uid);
    try {
      await adminUpdateUserPermissions({
        targetUser: u,
        permissions: editUserPerms,
        actorUid: currentUid,
        actorName: currentName,
        allStaffUids: staffUids,
      });
      setEditingPermsUid(null);
      setStatusMessage(`Updated access checklist for ${u.displayName}.`);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleRegenerateCode = async (u: UserProfile) => {
    setUpdatingId(u.uid);
    try {
      const newCode = await adminRegenerateAccessCode({
        targetUser: u,
        actorUid: currentUid,
        actorName: currentName,
        allStaffUids: staffUids,
      });
      setGeneratedCredential({
        email: u.email,
        name: u.displayName,
        role: u.customRoleName || u.role,
        code: newCode,
      });
      setStatusMessage(`Generated fresh Auto Password ${newCode} for ${u.displayName}.`);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleEnrollStudent = async (u: UserProfile) => {
    setUpdatingId(u.uid);
    try {
      const prof: ProfYear = u.profYear || '1st Prof';
      const batchName =
        prof === '1st Prof'
          ? 'Batch 2025'
          : prof === '2nd Prof'
            ? 'Batch 2024'
            : prof === '3rd Prof'
              ? 'Batch 2023'
              : prof === '4th Prof'
                ? 'Batch 2022'
                : prof.slice(0, 20);
      await adminEnrollStudent({
        uid: u.uid,
        fullName: u.displayName,
        rollNumber: u.rollOrEmpId || `BAMS-${u.uid.slice(0, 5).toUpperCase()}`,
        profYear: prof,
        batch: batchName,
        staffUids,
      });
      setStatusMessage(`Enrolled ${u.displayName} into ${prof} BAMS roster.`);
    } finally {
      setUpdatingId(null);
    }
  };

  const liveBatchGroups = useMemo(() => {
    const map = new Map<string, { key: string; batch: string; profYear: ProfYear; count: number }>();
    students.forEach((s) => {
      const py = s.profYear || '1st Prof';
      const bName = s.batch || py;
      const key = `${bName}::${py}`;
      const prev = map.get(key);
      if (prev) {
        prev.count += 1;
      } else {
        map.set(key, { key, batch: bName, profYear: py, count: 1 });
      }
    });
    return Array.from(map.values()).sort(
      (a, b) => a.profYear.localeCompare(b.profYear) || a.batch.localeCompare(b.batch)
    );
  }, [students]);

  const effectivePromoGroup =
    liveBatchGroups.find((g) => g.key === promoKey) || liveBatchGroups[0] || null;

  const handlePromoteBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectivePromoGroup || !canManageMaster) return;
    if (effectivePromoGroup.profYear === promoTargetProf) {
      setStatusMessage(
        `${effectivePromoGroup.batch} is already in ${promoTargetProf}. Select a different target Prof.`
      );
      return;
    }

    const studentsToPromote = students.filter(
      (s) => s.batch === effectivePromoGroup.batch && s.profYear === effectivePromoGroup.profYear
    );
    if (studentsToPromote.length === 0) return;

    const studentUidSet = new Set(studentsToPromote.map((s) => s.uid));
    const studentRollSet = new Set(studentsToPromote.map((s) => s.rollNumber.toUpperCase()));
    const usersToUpdate = users.filter(
      (u) =>
        u.role !== 'admin' &&
        (studentUidSet.has(u.uid) ||
          (u.rollOrEmpId && studentRollSet.has(u.rollOrEmpId.trim().toUpperCase())))
    );

    setPromotingBatch(true);
    try {
      const res = await adminPromoteBatch({
        studentsToPromote,
        usersToUpdate,
        fromProfYear: effectivePromoGroup.profYear,
        toProfYear: promoTargetProf,
        sourceBatch: effectivePromoGroup.batch,
        resetAttendanceForNewProf: promoResetHours,
        actorUid: currentUid,
        actorName: currentName,
        staffUids,
      });
      setStatusMessage(
        `Promoted ${res.promotedStudents} student(s) of ${effectivePromoGroup.batch} (${effectivePromoGroup.profYear} → ${promoTargetProf}). Both old & new batches inside ${promoTargetProf} stay separated by their Admission Batch tag.`
      );
    } finally {
      setPromotingBatch(false);
    }
  };

  const handleAttendanceOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveStudent || !adjustReason.trim() || adjustHours <= 0 || !canOverrideAttendance)
      return;
    setAdjusting(true);
    try {
      await adminAdjustStudentAttendance({
        student: effectiveStudent,
        mode: adjustMode,
        hours: adjustHours,
        category: adjustCategory,
        adjustScheduled,
        reason: adjustReason.trim(),
        actorUid: currentUid,
        actorName: currentName,
        staffUids,
      });
      setStatusMessage(
        `${adjustMode === 'add' ? 'Added' : 'Removed'} ${adjustHours}h (${adjustCategory}) for ${effectiveStudent.fullName}.`
      );
      setAdjustReason('');
    } finally {
      setAdjusting(false);
    }
  };

  const persistMasterPayload = async (
    nextSections: CustomMasterSection[],
    nextRoles: CustomRoleDef[],
    nextLinks: ProfileMenuLink[] = profileMenuLinks,
    nextHiddenTabs: string[] = profileHiddenTabs
  ) => {
    await saveMasterConfig({
      sessionTypes,
      activityTypes,
      attendanceOptions,
      profYears,
      departments,
      customSections: nextSections,
      customRoles: nextRoles,
      profileMenuLinks: nextLinks,
      profileHiddenTabs: nextHiddenTabs,
      minAttendanceThreshold: minThreshold,
      actorUid: currentUid,
      actorName: currentName,
      staffUids,
    });
  };

  const handleAddProfileMenuLink = async (
    e: React.FormEvent,
    overrideRole?: UserRole | 'all'
  ) => {
    e.preventDefault();
    if (!canManageMaster && currentProfile.role !== 'admin') return;
    const cleanLabel = newLinkLabel.trim();
    if (!cleanLabel) return;
    const targetRole = overrideRole || menuManagerRole;
    if (newLinkTargetType === 'url' && !newLinkUrl.trim()) return;

    const newItem: ProfileMenuLink = {
      id: `lnk_${Date.now().toString(36)}`,
      role: targetRole,
      label: cleanLabel.slice(0, 48),
      targetType: newLinkTargetType,
      ...(newLinkTargetType === 'url'
        ? { url: normalizeSafeExternalUrl(newLinkUrl) }
        : { tabId: newLinkTab }),
    };

    const nextLinks = [...profileMenuLinks, newItem].slice(0, 40);
    setProfileMenuLinks(nextLinks);
    setNewLinkLabel('');
    setNewLinkUrl('');
    setSavingMenuLinks(true);
    try {
      await persistMasterPayload(customSections, customRoles, nextLinks, profileHiddenTabs);
      setStatusMessage(`Added sidebar menu link "${newItem.label}" for ${targetRole} profile.`);
    } finally {
      setSavingMenuLinks(false);
    }
  };

  const handleRemoveProfileMenuLink = async (linkId: string) => {
    if (!canManageMaster && currentProfile.role !== 'admin') return;
    const nextLinks = profileMenuLinks.filter((l) => l.id !== linkId);
    setProfileMenuLinks(nextLinks);
    setSavingMenuLinks(true);
    try {
      await persistMasterPayload(customSections, customRoles, nextLinks, profileHiddenTabs);
      setStatusMessage('Removed custom link from profile sidebar menu.');
    } finally {
      setSavingMenuLinks(false);
    }
  };

  const handleToggleBuiltInTabVisibility = async (role: UserRole, tabId: PortalTabId) => {
    if (!canManageMaster && currentProfile.role !== 'admin') return;
    if (role === 'admin' && tabId === 'admin') return; // Prevent Admin lockout
    const token = `${role}:${tabId}`;
    const nextHidden = profileHiddenTabs.includes(token)
      ? profileHiddenTabs.filter((x) => x !== token)
      : [...profileHiddenTabs, token].slice(0, 40);
    setProfileHiddenTabs(nextHidden);
    setSavingMenuLinks(true);
    try {
      await persistMasterPayload(customSections, customRoles, profileMenuLinks, nextHidden);
      setStatusMessage(`Updated sidebar tab menu visibility for ${role}.`);
    } finally {
      setSavingMenuLinks(false);
    }
  };

  const handleSaveMaster = async () => {
    if (!canManageMaster) return;
    setSavingMaster(true);
    try {
      await persistMasterPayload(customSections, customRoles);
      setStatusMessage(
        'Master Data saved cleanly. All Sections, Options, Prof batches, Menu Links, and Custom Roles are live.'
      );
    } finally {
      setSavingMaster(false);
    }
  };

  const handleCreateCustomSection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageMaster || !newSectionTitle.trim()) return;
    const cleanTitle = newSectionTitle.trim();
    const initialOpt = newSectionInitialOpt.trim();
    const created: CustomMasterSection = {
      id: `sec_${Date.now().toString(36)}`,
      title: cleanTitle,
      items: initialOpt ? [initialOpt] : [],
    };
    const nextSections = [...customSections, created];
    setCustomSections(nextSections);
    setNewSectionTitle('');
    setNewSectionInitialOpt('');
    setSavingMaster(true);
    try {
      await persistMasterPayload(nextSections, customRoles);
      setStatusMessage(`Created new Master Data section "${cleanTitle}".`);
    } finally {
      setSavingMaster(false);
    }
  };

  const handleDeleteCustomSection = async (sectionId: string) => {
    if (!canManageMaster) return;
    const nextSections = customSections.filter((s) => s.id !== sectionId);
    setCustomSections(nextSections);
    setSavingMaster(true);
    try {
      await persistMasterPayload(nextSections, customRoles);
      setStatusMessage('Removed custom Master Data section.');
    } finally {
      setSavingMaster(false);
    }
  };

  const handleAddCustomSectionItem = (sectionId: string) => {
    const val = (customSectionInputs[sectionId] || '').trim();
    if (!val) return;
    setCustomSections((prev) =>
      prev.map((sec) =>
        sec.id === sectionId
          ? { ...sec, items: Array.from(new Set([...sec.items, val])) }
          : sec
      )
    );
    setCustomSectionInputs((prev) => ({ ...prev, [sectionId]: '' }));
  };

  const handleRemoveCustomSectionItem = (sectionId: string, item: string) => {
    setCustomSections((prev) =>
      prev.map((sec) =>
        sec.id === sectionId ? { ...sec, items: sec.items.filter((x) => x !== item) } : sec
      )
    );
  };

  const handleCreateCustomRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoleLabel.trim()) return;
    const id = `role_${newRoleLabel
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 24)}_${Date.now().toString(36).slice(-3)}`;
    const roleDef: CustomRoleDef = {
      id,
      label: newRoleLabel.trim(),
      subtitle: newRoleSubtitle.trim() || `${newRoleBase.replace('_', ' ')} Tier Portal`,
      baseRole: newRoleBase,
      permissions: newRolePerms,
    };
    const nextRoles = [...customRoles, roleDef];
    setCustomRoles(nextRoles);
    setSavingCustomRole(true);
    try {
      await persistMasterPayload(customSections, nextRoles);
      setNewRoleLabel('');
      setNewRoleSubtitle('');
      setShowAddRoleForm(false);
      setActiveHubTab(`custom:${roleDef.id}`);
      setStatusMessage(
        `Created custom role "${roleDef.label}". It is now active in the Admin Hub and Header Portal View switcher.`
      );
    } finally {
      setSavingCustomRole(false);
    }
  };

  const handleDeleteCustomRole = async (roleId: string) => {
    const nextRoles = customRoles.filter((r) => r.id !== roleId);
    setCustomRoles(nextRoles);
    setActiveHubTab('principal');
    await persistMasterPayload(customSections, nextRoles);
    setStatusMessage('Removed custom role from Portal View & Admin Hub.');
  };

  const handleAddSubjectMaster = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageMaster || !subCode.trim() || !subName.trim()) return;
    const teacher = teachers.find((t) => t.id === subTeacherId) || teachers[0];
    if (!teacher) return;
    setSavingSubject(true);
    try {
      await adminCreateSubject({
        code: subCode.trim(),
        name: subName.trim(),
        department: subDept,
        profYear: subProf,
        requiredTheoryHours: subTheoryHrs,
        requiredPracticalHours: subPracHrs,
        teacher,
        actorUid: currentUid,
        actorName: currentName,
        staffUids,
      });
      setStatusMessage(
        `Added Master Subject ${subCode.toUpperCase()} (${subProf}) for ${teacher.fullName}.`
      );
      setSubCode('');
      setSubName('');
    } finally {
      setSavingSubject(false);
    }
  };

  const handleReassignSubjectTeacher = async (subject: Subject, newTeacherId: string) => {
    if (!canManageMaster || newTeacherId === subject.teacherId) return;
    const newTeacher = teachers.find((t) => t.id === newTeacherId);
    if (!newTeacher) return;
    setReassigningSubId(subject.id);
    try {
      await adminReassignSubjectTeacher({
        subject,
        newTeacher,
        actorUid: currentUid,
        actorName: currentName,
        staffUids,
      });
      setStatusMessage(
        `Subject Code ${subject.code} reassigned to ${newTeacher.fullName}. All past sessions & hours preserved.`
      );
    } finally {
      setReassigningSubId(null);
    }
  };

  const handleSeed = async () => {
    const { seedInstitutionalData } = await import('../services/bamsFirestore');
    setSeeding(true);
    try {
      await seedInstitutionalData(currentUid, currentName);
      setStatusMessage('SSPSAMCH BAMS Master Data & Institutional Records synchronized.');
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight">
            Admin Control Center · 5 Role Portals &amp; Master Data
          </h1>
          <p className="mt-1 text-xs text-stone-600">
            Add email or verify requests per role · Set granular permission checklists · Share auto-generated access passwords
          </p>
        </div>

        {currentProfile.role === 'admin' && (
          <button
            type="button"
            disabled={seeding}
            onClick={handleSeed}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-white rounded-xl btn-3d self-start sm:self-auto whitespace-nowrap shrink-0"
          >
            <Database className="w-4 h-4" />
            {seeding ? 'Syncing Dataset...' : 'Sync Sample SSPSAMCH Data'}
          </button>
        )}
      </div>

      {/* 5 Role Buttons + Custom Roles + Master Data + Add Role */}
      <div className="surface-3d rounded-2xl p-3 sm:p-4 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {ROLE_TABS.map((tab) => {
            const active = activeHubTab === tab.id;
            const pendingCount = pendingCountsByRole[tab.id];
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveHubTab(tab.id)}
                className={`px-3.5 py-3 rounded-xl text-left transition-all flex flex-col justify-between gap-1 min-h-[58px] ${
                  active ? 'btn-3d text-white' : 'btn-3d-secondary text-stone-900'
                }`}
              >
                <div className="flex items-center justify-between gap-2 w-full">
                  <span className="text-xs font-bold whitespace-nowrap">{tab.label}</span>
                  {pendingCount > 0 && (
                    <span
                      className={`text-xs font-mono tabular-nums font-bold ${
                        active ? 'text-amber-300' : 'text-amber-800'
                      }`}
                    >
                      {pendingCount}
                    </span>
                  )}
                </div>
                <span
                  className={`text-[11px] leading-tight truncate ${
                    active ? 'text-emerald-100' : 'text-stone-500'
                  }`}
                >
                  {tab.subtitle}
                </span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setActiveHubTab('master')}
            className={`px-3.5 py-3 rounded-xl text-left transition-all flex flex-col justify-between gap-1 min-h-[58px] ${
              activeHubTab === 'master' ? 'btn-3d-gold text-white' : 'btn-3d-secondary text-stone-900'
            }`}
          >
            <div className="flex items-center justify-between gap-2 w-full">
              <span className="text-xs font-bold whitespace-nowrap">Master Data</span>
              <Settings2 className="w-3.5 h-3.5 shrink-0" />
            </div>
            <span
              className={`text-[11px] leading-tight truncate ${
                activeHubTab === 'master' ? 'text-amber-100' : 'text-stone-500'
              }`}
            >
              Sections, Codes &amp; Profs
            </span>
          </button>

          {customRoles.map((cr) => {
            const tabKey = `custom:${cr.id}` as AdminHubTab;
            const active = activeHubTab === tabKey;
            return (
              <button
                key={cr.id}
                type="button"
                onClick={() => setActiveHubTab(tabKey)}
                className={`px-3.5 py-3 rounded-xl text-left transition-all flex flex-col justify-between gap-1 min-h-[58px] ${
                  active ? 'btn-3d text-white' : 'btn-3d-secondary text-stone-900'
                }`}
              >
                <div className="flex items-center justify-between gap-2 w-full">
                  <span className="text-xs font-bold truncate">{cr.label}</span>
                  <span
                    className={`text-[10px] font-mono uppercase ${
                      active ? 'text-amber-200' : 'text-emerald-800'
                    }`}
                  >
                    Custom
                  </span>
                </div>
                <span
                  className={`text-[11px] leading-tight truncate ${
                    active ? 'text-emerald-100' : 'text-stone-500'
                  }`}
                >
                  {cr.subtitle}
                </span>
              </button>
            );
          })}

          {(canManageMaster || currentProfile.role === 'admin') && (
            <button
              type="button"
              onClick={() => setShowAddRoleForm((v) => !v)}
              className={`px-3.5 py-3 rounded-xl text-left transition-all flex flex-col justify-between gap-1 min-h-[58px] border border-dashed ${
                showAddRoleForm
                  ? 'btn-3d-gold text-white border-amber-700'
                  : 'border-amber-900/35 bg-amber-50/40 text-stone-900 hover:bg-amber-50'
              }`}
            >
              <div className="flex items-center justify-between gap-2 w-full">
                <span className="text-xs font-bold whitespace-nowrap">+ Add Role</span>
                <PlusCircle className="w-3.5 h-3.5 shrink-0" />
              </div>
              <span
                className={`text-[11px] leading-tight truncate ${
                  showAddRoleForm ? 'text-amber-100' : 'text-stone-600'
                }`}
              >
                Add to Portal View
              </span>
            </button>
          )}
        </div>

        {showAddRoleForm && (
          <form
            onSubmit={handleCreateCustomRole}
            className="surface-3d-inset rounded-xl p-4 space-y-3 border border-amber-900/20"
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-bold text-stone-900">
                  Create New Custom Role (Syncs with Header &quot;Portal View:&quot; Switcher)
                </p>
                <p className="text-[11px] text-stone-600">
                  Create roles such as HOD / Coordinator, Hostel Warden, Exam Cell, or Clinical Supervisor.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddRoleForm(false)}
                className="text-xs text-stone-600 hover:text-stone-900"
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                type="text"
                required
                maxLength={40}
                placeholder="Role Name (e.g. HOD / Coordinator)"
                value={newRoleLabel}
                onChange={(e) => setNewRoleLabel(e.target.value)}
                className="px-3 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
              />
              <input
                type="text"
                maxLength={60}
                placeholder="Subtitle (e.g. Dept Academic Oversight)"
                value={newRoleSubtitle}
                onChange={(e) => setNewRoleSubtitle(e.target.value)}
                className="px-3 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
              />
              <select
                value={newRoleBase}
                onChange={(e) => {
                  const base = e.target.value as BaseRoleTab;
                  setNewRoleBase(base);
                  setNewRolePerms(DEFAULT_ROLE_PERMISSIONS[base]);
                }}
                className="px-3 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
              >
                <option value="co_admin">Base Access: Co-Admin Tier</option>
                <option value="principal">Base Access: Principal Tier</option>
                <option value="teacher">Base Access: Faculty / Teacher Tier</option>
                <option value="student">Base Access: Student Tier</option>
                <option value="parent">Base Access: Parent Tier</option>
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {PERMISSION_CATALOG.map((perm) => (
                <label
                  key={perm.key}
                  className="flex items-start gap-2 text-xs text-stone-800 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={newRolePerms.includes(perm.key)}
                    onChange={() =>
                      setNewRolePerms((prev) =>
                        prev.includes(perm.key)
                          ? prev.filter((k) => k !== perm.key)
                          : [...prev, perm.key]
                      )
                    }
                    className="mt-0.5 rounded border-amber-900/30 text-emerald-800"
                  />
                  <span>{perm.label}</span>
                </label>
              ))}
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingCustomRole}
                className="btn-3d px-4 py-2 text-xs font-medium text-white rounded-lg whitespace-nowrap"
              >
                {savingCustomRole ? 'Creating Role...' : 'Save & Add to Portal View'}
              </button>
            </div>
          </form>
        )}

        {Object.values(pendingCountsByRole).some((c) => c > 0) && (
          <div className="pt-3 border-t border-amber-900/10 flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-amber-900">
              Pending Signup Requests Waiting:
            </span>
            {ROLE_TABS.filter((t) => pendingCountsByRole[t.id] > 0).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveHubTab(t.id)}
                className={`px-2.5 py-1 rounded-md font-semibold transition-colors whitespace-nowrap ${
                  activeHubTab === t.id
                    ? 'bg-emerald-900 text-white'
                    : 'bg-amber-100 text-amber-950 hover:bg-amber-200'
                }`}
              >
                {t.label} ({pendingCountsByRole[t.id]})
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Auto-Generated Access Password Callout */}
      {generatedCredential && (
        <div className="surface-3d-dark text-white rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-amber-300">
              Auto Access Password Ready — Share with {generatedCredential.name}
            </p>
            <p className="text-xs text-stone-200">
              Email: <span className="font-mono">{generatedCredential.email}</span> · Role:{' '}
              <span className="capitalize font-semibold">{generatedCredential.role.replace('_', ' ')}</span>
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="px-4 py-2 bg-black/35 border border-amber-400/40 rounded-lg font-mono text-base font-bold tracking-wider text-amber-200 tabular-nums">
              {generatedCredential.code}
            </span>
            <button
              type="button"
              onClick={() => copyCode(generatedCredential.code)}
              className="btn-3d-gold inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg whitespace-nowrap"
            >
              <Copy className="w-3.5 h-3.5" />
              {copiedCode === generatedCredential.code ? 'Copied' : 'Copy Password'}
            </button>
          </div>
        </div>
      )}

      {statusMessage && (
        <div className="surface-3d rounded-xl px-4 py-3 text-xs text-emerald-950 font-medium flex items-center justify-between gap-3">
          <span>{statusMessage}</span>
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            className="text-emerald-800 hover:underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ================================================================= */}
      {/* ROLE-SPECIFIC MANAGEMENT VIEW (Principal / Faculty / Students / Parents / Co-Admin) */}
      {/* ================================================================= */}
      {activeRoleTab && (
        <div className="space-y-6">
          {/* Role Pie Chart Overview + Quick Role Menu Summary */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-6">
              <RolePieChartCard
                compact
                title={`${activeRoleDisplayLabel} Accounts Breakdown (Pie Chart)`}
                subtitle={`Verified, Pre-Invited, Pending Requests & Blocked IDs in ${activeRoleDisplayLabel}`}
                data={[
                  { name: 'Verified Active', value: roleVerifiedUsers.length, color: '#15803d' },
                  { name: 'Pending Approval', value: rolePendingUsers.length, color: '#d97706' },
                  { name: 'Pre-Invited', value: roleInvites.length, color: '#0ea5e9' },
                  { name: 'Blocked', value: roleBlockedUsers.length, color: '#dc2626' },
                ]}
                centerValue={String(
                  roleVerifiedUsers.length +
                    rolePendingUsers.length +
                    roleInvites.length +
                    roleBlockedUsers.length
                )}
                centerLabel="Accounts"
                emptyMessage={`No accounts or invites in ${activeRoleDisplayLabel} yet.`}
              />
            </div>

            <div className="lg:col-span-6">
              <RolePieChartCard
                compact
                title="Institutional Attendance Standing (Pie Chart)"
                subtitle={`All Profs (${students.length} enrolled BAMS students)`}
                data={[
                  {
                    name: 'Nominal (75%+)',
                    value: students.filter((s) => s.standing === 'nominal').length,
                    color: '#15803d',
                  },
                  {
                    name: 'Warning (65-74%)',
                    value: students.filter((s) => s.standing === 'warning').length,
                    color: '#d97706',
                  },
                  {
                    name: 'Critical (<65%)',
                    value: students.filter((s) => s.standing === 'critical').length,
                    color: '#dc2626',
                  },
                ]}
                centerValue={String(students.length)}
                centerLabel="Students"
                emptyMessage="No students enrolled yet."
              />
            </div>
          </div>

          {/* Quick Per-Profile Sidebar Menu & Custom Links Editor */}
          {(canManageMaster || currentProfile.role === 'admin') && (
            <section className="surface-3d rounded-2xl p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-stone-900 flex items-center gap-2">
                    <Menu className="w-4 h-4 text-emerald-900" />
                    {activeRoleDisplayLabel} Profile Menu &amp; Custom Links (Add / Remove)
                  </h2>
                  <p className="text-xs text-stone-600">
                    Customize {activeRoleDisplayLabel} sidebar ke built-in tabs aur extra links add ya remove karein. All Profiles ke links sabhi ko dikhenge.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMenuManagerRole(activeRoleTab);
                    setActiveHubTab('master');
                  }}
                  className="btn-3d-secondary px-3 py-1.5 text-xs font-medium text-emerald-900 rounded-lg whitespace-nowrap self-start sm:self-auto"
                >
                  Open Full All-Profile Menu Manager
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                <div className="lg:col-span-6 surface-3d-inset rounded-xl p-3.5 space-y-2">
                  <p className="text-xs font-semibold text-stone-800">
                    Built-In Portal Tabs for {activeRoleDisplayLabel}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {PORTAL_MENU_TABS.filter((t) => t.id !== 'admin' || activeRoleTab === 'co_admin').map(
                      (tab) => {
                        const isHidden = profileHiddenTabs.includes(`${activeRoleTab}:${tab.id}`);
                        return (
                          <button
                            key={tab.id}
                            type="button"
                            disabled={savingMenuLinks}
                            onClick={() => handleToggleBuiltInTabVisibility(activeRoleTab, tab.id)}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                              isHidden
                                ? 'bg-red-50 border-red-200 text-red-700 line-through'
                                : 'bg-white border-emerald-800/30 text-emerald-950'
                            }`}
                          >
                            <span>{tab.label}</span>
                            <span className="text-[10px] font-bold">
                              {isHidden ? '+ Add Back' : '× Remove'}
                            </span>
                          </button>
                        );
                      }
                    )}
                  </div>
                </div>

                <div className="lg:col-span-6 surface-3d-inset rounded-xl p-3.5 space-y-2.5">
                  <p className="text-xs font-semibold text-stone-800">
                    Custom Links on {activeRoleDisplayLabel} Menu (
                    {
                      profileMenuLinks.filter(
                        (l) => l.role === activeRoleTab || l.role === 'all'
                      ).length
                    }
                    )
                  </p>
                  <form
                    onSubmit={(e) => handleAddProfileMenuLink(e, activeRoleTab)}
                    className="flex flex-wrap gap-2"
                  >
                    <input
                      type="text"
                      required
                      maxLength={40}
                      placeholder="Link Label (e.g. NCISM Portal)"
                      value={newLinkLabel}
                      onChange={(e) => setNewLinkLabel(e.target.value)}
                      className="flex-1 min-w-[140px] px-2.5 py-1.5 text-xs bg-white border border-amber-900/20 rounded-lg"
                    />
                    <select
                      value={newLinkTargetType}
                      onChange={(e) => setNewLinkTargetType(e.target.value as 'url' | 'tab')}
                      className="px-2 py-1.5 text-xs bg-white border border-amber-900/20 rounded-lg"
                    >
                      <option value="url">Web Link</option>
                      <option value="tab">Portal Tab</option>
                    </select>
                    {newLinkTargetType === 'url' ? (
                      <input
                        type="text"
                        required
                        placeholder="https://ncismindia.org"
                        value={newLinkUrl}
                        onChange={(e) => setNewLinkUrl(e.target.value)}
                        className="flex-1 min-w-[150px] px-2.5 py-1.5 text-xs bg-white border border-amber-900/20 rounded-lg"
                      />
                    ) : (
                      <select
                        value={newLinkTab}
                        onChange={(e) => setNewLinkTab(e.target.value as PortalTabId)}
                        className="px-2.5 py-1.5 text-xs bg-white border border-amber-900/20 rounded-lg"
                      >
                        {PORTAL_MENU_TABS.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    )}
                    <button
                      type="submit"
                      disabled={savingMenuLinks}
                      className="btn-3d px-3 py-1.5 text-xs font-semibold text-white rounded-lg whitespace-nowrap"
                    >
                      + Add Link
                    </button>
                  </form>

                  <div className="space-y-1.5 max-h-36 overflow-y-auto">
                    {profileMenuLinks
                      .filter((l) => l.role === activeRoleTab || l.role === 'all')
                      .map((lnk) => (
                        <div
                          key={lnk.id}
                          className="flex items-center justify-between gap-2 bg-white px-2.5 py-1.5 rounded-lg border border-amber-900/15 text-xs"
                        >
                          <div className="min-w-0 flex items-center gap-1.5">
                            {lnk.targetType === 'url' ? (
                              <ExternalLink className="w-3 h-3 text-emerald-800 shrink-0" />
                            ) : (
                              <Link2 className="w-3 h-3 text-amber-800 shrink-0" />
                            )}
                            <span className="font-semibold text-stone-900 truncate">
                              {lnk.label}
                            </span>
                            <span className="text-[10px] font-mono text-stone-500">
                              ({lnk.role === 'all' ? 'All Profiles' : activeRoleDisplayLabel})
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveProfileMenuLink(lnk.id)}
                            className="text-red-700 hover:text-red-900 font-medium shrink-0"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            </section>
          )}

          {activeCustomRole && (
            <div className="surface-3d rounded-xl px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-stone-900">
                  Custom Role: {activeCustomRole.label}
                </p>
                <p className="text-xs text-stone-600">
                  {activeCustomRole.subtitle} · Base Tier: {activeCustomRole.baseRole.replace('_', ' ')} ·{' '}
                  {activeCustomRole.permissions.length} default permission(s)
                </p>
              </div>
              {canManageMaster && (
                <button
                  type="button"
                  onClick={() => handleDeleteCustomRole(activeCustomRole.id)}
                  className="btn-3d-danger px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap self-start sm:self-auto"
                >
                  Delete Custom Role
                </button>
              )}
            </div>
          )}

          {/* 1. Pending Requests for this Role */}
          <section className="surface-3d rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-emerald-900" />
              <div>
                <h2 className="text-base font-bold text-stone-900">
                  {activeRoleDisplayLabel} Signup Requests ({rolePendingUsers.length})
                </h2>
                <p className="text-xs text-stone-600">
                  Verify email request, select allowed permissions below, and auto-generate their login access password
                </p>
              </div>
            </div>

            {rolePendingUsers.length > 0 ? (
              <div className="space-y-4">
                {rolePendingUsers.map((reqUser) => {
                  const chosenPerms = getRequestPerms(reqUser, activeRoleTab);
                  return (
                    <div
                      key={reqUser.uid}
                      className="border border-amber-900/20 rounded-xl bg-white/85 p-4 space-y-4"
                    >
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="text-sm font-bold text-stone-900">
                              {reqUser.displayName}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono text-emerald-900 font-medium">
                              {reqUser.email || 'Email pending'}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono text-stone-600">
                              {reqUser.rollOrEmpId || 'No ID'}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-stone-600">
                            Department: {reqUser.department} · Batch/Level: {reqUser.profYear}
                          </p>
                        </div>

                        <div className="flex items-center gap-2.5 shrink-0">
                          <button
                            type="button"
                            disabled={!canVerifyUsers || updatingId === reqUser.uid}
                            onClick={() => handleVerifyUser(reqUser, activeRoleTab)}
                            className="btn-3d inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white rounded-lg whitespace-nowrap"
                          >
                            <Check className="w-3.5 h-3.5" />
                            Verify &amp; Create Password
                          </button>
                          <button
                            type="button"
                            disabled={!canVerifyUsers || updatingId === reqUser.uid}
                            onClick={() => handleRejectUser(reqUser)}
                            className="btn-3d-danger inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg whitespace-nowrap"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            Reject
                          </button>
                        </div>
                      </div>

                      {(activeRoleTab === 'parent' || activeRoleTab === 'student') && (
                        <div className="surface-3d-inset rounded-xl p-3 flex flex-col sm:flex-row sm:items-center gap-2.5 text-xs">
                          <span className="font-semibold text-stone-800 whitespace-nowrap">
                            {activeRoleTab === 'parent'
                              ? 'Link Ward Student Roll No.:'
                              : 'Confirm Student Roll No.:'}
                          </span>
                          <select
                            value={(
                              requestRollOverrides[reqUser.uid] ??
                              reqUser.rollOrEmpId ??
                              ''
                            ).toUpperCase()}
                            onChange={(e) =>
                              setRequestRollOverrides((prev) => ({
                                ...prev,
                                [reqUser.uid]: e.target.value.toUpperCase(),
                              }))
                            }
                            className="flex-1 min-w-0 px-2.5 py-1.5 text-xs bg-white border border-amber-900/20 rounded-lg"
                          >
                            <option value="">Select BAMS Student to Link...</option>
                            {students.map((st) => (
                              <option key={st.id} value={st.rollNumber}>
                                {st.rollNumber} · {st.fullName} ({st.profYear})
                              </option>
                            ))}
                          </select>
                          <input
                            type="text"
                            maxLength={40}
                            placeholder="e.g. BAMS24-001"
                            value={requestRollOverrides[reqUser.uid] ?? reqUser.rollOrEmpId ?? ''}
                            onChange={(e) =>
                              setRequestRollOverrides((prev) => ({
                                ...prev,
                                [reqUser.uid]: e.target.value.toUpperCase(),
                              }))
                            }
                            className="sm:w-36 px-2.5 py-1.5 text-xs font-mono bg-white border border-amber-900/20 rounded-lg"
                          />
                        </div>
                      )}

                      {/* Permission Checklist for this Request */}
                      <div className="surface-3d-inset rounded-xl p-3.5 space-y-2">
                        <p className="text-xs font-semibold text-stone-800">
                          Select Allowed Actions (Permissions Checklist)
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                          {PERMISSION_CATALOG.map((perm) => {
                            const checked = chosenPerms.includes(perm.key);
                            return (
                              <label
                                key={perm.key}
                                className="flex items-start gap-2 text-xs text-stone-800 cursor-pointer select-none"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() =>
                                    toggleRequestPerm(reqUser.uid, activeRoleTab, perm.key)
                                  }
                                  className="mt-0.5 rounded border-amber-900/30 text-emerald-800"
                                />
                                <span>{perm.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="surface-3d-inset rounded-xl p-4 text-xs text-stone-600">
                No pending signup requests in {activeRoleTab.replace('_', ' ')} right now.
              </div>
            )}
          </section>

          {/* 2. Pre-Add Institutional Email & Generate Auto Password */}
          {canVerifyUsers && (
            <section className="surface-3d rounded-2xl p-5 sm:p-6 space-y-4">
              <div className="flex items-center gap-2">
                <MailPlus className="w-4 h-4 text-emerald-900" />
                <div>
                  <h2 className="text-base font-bold text-stone-900">
                    Add {activeRoleDisplayLabel} Email &amp; Assign Permissions
                  </h2>
                  <p className="text-xs text-stone-600">
                    Pre-register an institutional Google email here; when they sign in with this mail and enter the generated password, their ticked permissions activate automatically.
                  </p>
                </div>
              </div>

              <form onSubmit={handleCreateInvite} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                  <div className="lg:col-span-2">
                    <label className="block text-xs font-medium text-stone-700 mb-1">
                      Authorized Google Email
                    </label>
                    <input
                      type="email"
                      required
                      placeholder={`e.g. ${activeRoleTab}@sspsamch.edu`}
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-700 mb-1">
                      Full Name
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Full Name"
                      value={inviteName}
                      onChange={(e) => setInviteName(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-700 mb-1">
                      {activeRoleTab === 'student' || activeRoleTab === 'parent'
                        ? 'Prof Year'
                        : 'Department'}
                    </label>
                    {activeRoleTab === 'student' || activeRoleTab === 'parent' ? (
                      <select
                        value={inviteProfYear}
                        onChange={(e) => setInviteProfYear(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                      >
                        {profYears.map((py) => (
                          <option key={py} value={py}>
                            {py}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <select
                        value={inviteDepartment}
                        onChange={(e) => setInviteDepartment(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                      >
                        {departments.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                        <option value="Institutional Administration">Institutional Administration</option>
                      </select>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-stone-700 mb-1">
                      {activeRoleTab === 'parent'
                        ? 'Ward Roll No. (Link Student)'
                        : activeRoleTab === 'student'
                          ? 'Student Roll No.'
                          : 'Employee Code'}
                    </label>
                    <input
                      type="text"
                      placeholder={
                        activeRoleTab === 'parent' || activeRoleTab === 'student'
                          ? 'e.g. BAMS24-001'
                          : 'FAC-BAMS-022'
                      }
                      value={inviteIdCode}
                      onChange={(e) => setInviteIdCode(e.target.value)}
                      className="w-full px-3 py-2 text-xs font-mono bg-white border border-amber-900/20 rounded-lg"
                    />
                  </div>
                </div>

                {(activeRoleTab === 'parent' || activeRoleTab === 'student') && students.length > 0 && (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-xs">
                    <span className="font-medium text-stone-700 whitespace-nowrap">
                      Quick Select BAMS Student:
                    </span>
                    <select
                      value={inviteIdCode.trim().toUpperCase()}
                      onChange={(e) => {
                        const code = e.target.value;
                        setInviteIdCode(code);
                        const match = students.find((st) => st.rollNumber === code);
                        if (match) setInviteProfYear(match.profYear);
                      }}
                      className="flex-1 px-3 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                    >
                      <option value="">-- Choose student to auto-fill Roll No. --</option>
                      {students.map((st) => (
                        <option key={st.id} value={st.rollNumber}>
                          {st.rollNumber} · {st.fullName} ({st.profYear} · {st.batch})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="surface-3d-inset rounded-xl p-4 space-y-2.5">
                  <p className="text-xs font-semibold text-stone-800">
                    Access Permissions Checklist for this {activeRoleTab.replace('_', ' ')} Account
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    {PERMISSION_CATALOG.map((perm) => {
                      const checked = invitePermissions.includes(perm.key);
                      return (
                        <label
                          key={perm.key}
                          className="flex items-start gap-2 text-xs text-stone-800 cursor-pointer select-none"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setInvitePermissions((prev) =>
                                prev.includes(perm.key)
                                  ? prev.filter((k) => k !== perm.key)
                                  : [...prev, perm.key]
                              )
                            }
                            className="mt-0.5 rounded border-amber-900/30 text-emerald-800"
                          />
                          <span>
                            <strong className="font-medium">{perm.label}</strong>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={creatingInvite}
                    className="btn-3d inline-flex items-center gap-2 px-5 py-2.5 text-xs font-medium text-white rounded-lg whitespace-nowrap"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    {creatingInvite ? 'Generating Access...' : 'Add Email & Generate Auto Password'}
                  </button>
                </div>
              </form>
            </section>
          )}

          {/* 3. Verified Members & Pending Email Invites for this Role */}
          <section className="surface-3d rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-emerald-900" />
              <h2 className="text-base font-bold text-stone-900">
                Verified {activeRoleDisplayLabel} Directory &amp; Pre-Added Emails (
                {roleVerifiedUsers.length + roleInvites.length})
              </h2>
            </div>

            {roleInvites.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-amber-800">
                  Pre-Added Emails (Awaiting First Google Sign-In)
                </p>
                <div className="divide-y divide-amber-900/10 border border-amber-900/15 rounded-xl bg-amber-50/40">
                  {roleInvites.map((inv) => (
                    <div
                      key={inv.id}
                      className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                    >
                      <div>
                        <p className="font-semibold text-stone-900">
                          {inv.displayName} · <span className="font-mono">{inv.email}</span>
                        </p>
                        <p className="text-stone-600 mt-0.5">
                          {inv.permissions.length} permission(s) granted · {inv.department} (
                          {inv.profYear})
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono font-bold text-emerald-950 bg-white border border-amber-900/20 px-2.5 py-1 rounded-md tabular-nums">
                          {inv.accessCode}
                        </span>
                        <button
                          type="button"
                          onClick={() => copyCode(inv.accessCode)}
                          className="btn-3d-secondary px-2.5 py-1.5 rounded-md text-stone-700"
                          title="Copy Access Password"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => adminDeleteAccessInvite(inv.id)}
                          className="btn-3d-secondary px-2.5 py-1.5 rounded-md text-red-700"
                          title="Delete Invite"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {roleVerifiedUsers.length > 0 ? (
              <div className="space-y-3">
                {roleVerifiedUsers.map((u) => {
                  const isEditingPerms = editingPermsUid === u.uid;
                  const currentPerms = u.permissions?.length
                    ? u.permissions
                    : DEFAULT_ROLE_PERMISSIONS[u.role];
                  return (
                    <div
                      key={u.uid}
                      className="border border-amber-900/15 rounded-xl bg-white/80 p-4 space-y-3"
                    >
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="text-sm font-semibold text-stone-900">
                              {u.displayName}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono text-stone-700">{u.email || u.uid}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono text-stone-500">
                              {u.rollOrEmpId || '—'} · {u.profYear}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-stone-600">
                            Auto Password:{' '}
                            <strong className="font-mono text-emerald-950">
                              {u.accessCode || 'Not Generated'}
                            </strong>{' '}
                            ·{' '}
                            <span
                              className={
                                u.accessCodeVerified ? 'text-emerald-800 font-medium' : 'text-amber-800 font-medium'
                              }
                            >
                              {u.accessCodeVerified
                                ? 'Password Verified by User'
                                : 'Waiting for User to Enter Password'}
                            </span>{' '}
                            · {currentPerms.length} permission(s)
                          </p>
                          <p className="mt-1 text-xs text-stone-600 flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1">
                              <Lock className="w-3 h-3 text-amber-800" />
                              Profile Lock Password:
                            </span>
                            {u.profileLockEnabled && u.profileLockPin ? (
                              <>
                                <strong className="font-mono text-emerald-950">
                                  {u.profileLockPin}
                                </strong>
                                <button
                                  type="button"
                                  onClick={() => copyCode(u.profileLockPin || '')}
                                  className="text-emerald-800 hover:underline font-medium"
                                >
                                  {copiedCode === u.profileLockPin ? 'Copied' : 'Copy Lock PIN'}
                                </button>
                              </>
                            ) : (
                              <span className="text-stone-500">Off (Optional privacy lock not set)</span>
                            )}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          {u.accessCode && (
                            <button
                              type="button"
                              onClick={() => copyCode(u.accessCode)}
                              className="btn-3d-secondary inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-stone-800 rounded-md"
                            >
                              <Copy className="w-3 h-3" />
                              {copiedCode === u.accessCode ? 'Copied' : 'Copy Code'}
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={updatingId === u.uid}
                            onClick={() => handleRegenerateCode(u)}
                            className="btn-3d-secondary inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-stone-800 rounded-md whitespace-nowrap"
                          >
                            <RefreshCw className="w-3 h-3" />
                            New Password
                          </button>

                          {u.profileLockEnabled && u.profileLockPin && canVerifyUsers && (
                            <button
                              type="button"
                              disabled={updatingId === u.uid}
                              onClick={() => handleResetProfileLock(u)}
                              className="btn-3d-secondary inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-amber-900 rounded-md whitespace-nowrap"
                              title="Clear user's forgotten Profile Lock PIN"
                            >
                              <Lock className="w-3 h-3" />
                              Reset Lock PIN
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              if (isEditingPerms) {
                                setEditingPermsUid(null);
                              } else {
                                setEditingPermsUid(u.uid);
                                setEditUserPerms(currentPerms);
                              }
                            }}
                            className="btn-3d-secondary inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-emerald-900 rounded-md whitespace-nowrap"
                          >
                            <Sliders className="w-3 h-3" />
                            {isEditingPerms ? 'Close Permissions' : 'Edit Permissions'}
                          </button>

                          {u.role === 'student' && !enrolledUids.has(u.uid) && (
                            <button
                              type="button"
                              disabled={updatingId === u.uid}
                              onClick={() => handleEnrollStudent(u)}
                              className="btn-3d inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white rounded-md whitespace-nowrap"
                            >
                              <UserPlus className="w-3 h-3" />
                              Enroll Roster
                            </button>
                          )}

                          {canVerifyUsers && u.role !== 'admin' && (
                            <button
                              type="button"
                              disabled={updatingId === u.uid}
                              onClick={() => handleBlockUser(u)}
                              className="btn-3d-danger inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md whitespace-nowrap"
                              title="Block email access when member leaves"
                            >
                              <Ban className="w-3 h-3" />
                              Block Access
                            </button>
                          )}
                        </div>
                      </div>

                      {isEditingPerms && (
                        <div className="surface-3d-inset rounded-xl p-3.5 space-y-3">
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                            {PERMISSION_CATALOG.map((perm) => (
                              <label
                                key={perm.key}
                                className="flex items-start gap-2 text-xs text-stone-800 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={editUserPerms.includes(perm.key)}
                                  onChange={() =>
                                    setEditUserPerms((prev) =>
                                      prev.includes(perm.key)
                                        ? prev.filter((k) => k !== perm.key)
                                        : [...prev, perm.key]
                                    )
                                  }
                                  className="mt-0.5 rounded border-amber-900/30 text-emerald-800"
                                />
                                <span>{perm.label}</span>
                              </label>
                            ))}
                          </div>
                          <div className="flex justify-end">
                            <button
                              type="button"
                              disabled={updatingId === u.uid}
                              onClick={() => handleSaveUserPermissions(u)}
                              className="btn-3d px-4 py-1.5 text-xs font-medium text-white rounded-lg"
                            >
                              Save Permission Checklist
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              roleInvites.length === 0 && (
                <div className="surface-3d-inset rounded-xl p-4 text-xs text-stone-600">
                  No verified {activeRoleDisplayLabel} accounts yet. Add an institutional email above or approve incoming signup requests.
                </div>
              )
            )}

            {/* Blocked Members Directory with Instant Unblock */}
            {roleBlockedUsers.length > 0 && (
              <div className="pt-4 border-t border-amber-900/15 space-y-2.5">
                <p className="text-xs font-bold text-red-800 flex items-center gap-1.5">
                  <Ban className="w-3.5 h-3.5" />
                  Blocked Emails ({roleBlockedUsers.length}) — Email Access Revoked
                </p>
                <div className="divide-y divide-red-200/70 border border-red-200 rounded-xl bg-red-50/40">
                  {roleBlockedUsers.map((bu) => (
                    <div
                      key={bu.uid}
                      className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-stone-900">
                          {bu.displayName} · <span className="font-mono text-red-900">{bu.email}</span>
                        </p>
                        <p className="text-stone-600 mt-0.5">
                          Blocked on portal · {bu.department} ({bu.profYear}) ·{' '}
                          {bu.rollOrEmpId || 'No ID'}
                          {bu.profileLockEnabled && bu.profileLockPin
                            ? ` · Profile Lock PIN: ${bu.profileLockPin}`
                            : ''}
                        </p>
                      </div>
                      {canVerifyUsers && (
                        <button
                          type="button"
                          disabled={updatingId === bu.uid}
                          onClick={() => handleUnblockUser(bu)}
                          className="btn-3d inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white rounded-lg whitespace-nowrap shrink-0"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Unblock Access
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* 4. Admin Attendance Add / Remove Override (Shown cleanly inside Students Tab) */}
          {activeRoleTab === 'student' && canOverrideAttendance && (
            <section className="surface-3d rounded-2xl p-5 sm:p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-bold text-stone-900">
                    Admin Attendance Add / Remove Override
                  </h2>
                  <p className="text-xs text-stone-600">
                    Directly add or deduct attendance hours for any BAMS student across batches
                  </p>
                </div>
                {effectiveStudent && (
                  <div className="text-xs font-mono tabular-nums text-emerald-950 font-semibold">
                    Current: {effectiveStudent.totalHoursAttended}/
                    {effectiveStudent.totalHoursScheduled}h ({effectiveStudent.attendancePercent}%)
                  </div>
                )}
              </div>

              <form
                onSubmit={handleAttendanceOverride}
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3"
              >
                <div className="lg:col-span-2">
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    Select Student
                  </label>
                  <select
                    value={effectiveStudent?.id || ''}
                    onChange={(e) => setSelectedStudentId(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                  >
                    {students.map((stu) => (
                      <option key={stu.id} value={stu.id}>
                        {stu.rollNumber} · {stu.fullName} ({stu.profYear})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">Action</label>
                  <div className="grid grid-cols-2 gap-1 p-1 surface-3d-inset rounded-lg">
                    <button
                      type="button"
                      onClick={() => setAdjustMode('add')}
                      className={`py-1.5 text-xs font-medium rounded-md flex items-center justify-center gap-1 ${
                        adjustMode === 'add' ? 'bg-emerald-900 text-white shadow-xs' : 'text-stone-700'
                      }`}
                    >
                      <PlusCircle className="w-3 h-3" />
                      Add
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdjustMode('remove')}
                      className={`py-1.5 text-xs font-medium rounded-md flex items-center justify-center gap-1 ${
                        adjustMode === 'remove' ? 'bg-red-800 text-white shadow-xs' : 'text-stone-700'
                      }`}
                    >
                      <MinusCircle className="w-3 h-3" />
                      Remove
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">Hours</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0.5"
                    max="40"
                    required
                    value={adjustHours}
                    onChange={(e) => setAdjustHours(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-white border border-amber-900/20 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">Hour Type</label>
                  <select
                    value={adjustCategory}
                    onChange={(e) => setAdjustCategory(e.target.value as 'theory' | 'practical')}
                    className="w-full px-3 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                  >
                    <option value="theory">Theory / Lecture</option>
                    <option value="practical">Practical / OPD-IPD</option>
                  </select>
                </div>

                <div className="flex items-end">
                  <label className="inline-flex items-center gap-2 text-xs text-stone-700 pb-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={adjustScheduled}
                      onChange={(e) => setAdjustScheduled(e.target.checked)}
                      className="rounded border-amber-900/30 text-emerald-800"
                    />
                    Adjust Scheduled Hrs
                  </label>
                </div>

                <div className="sm:col-span-2 lg:col-span-4">
                  <input
                    type="text"
                    required
                    maxLength={140}
                    placeholder="Audit reason (e.g. Medical duty leave credited / Duplicate entry removed)"
                    value={adjustReason}
                    onChange={(e) => setAdjustReason(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                  />
                </div>

                <div className="lg:col-span-2 flex justify-end">
                  <button
                    type="submit"
                    disabled={adjusting || !effectiveStudent}
                    className={`w-full px-4 py-2 text-xs font-medium rounded-lg whitespace-nowrap ${
                      adjustMode === 'add' ? 'btn-3d text-white' : 'btn-3d-danger'
                    }`}
                  >
                    {adjusting
                      ? 'Updating...'
                      : adjustMode === 'add'
                        ? `Add +${adjustHours}h Attendance`
                        : `Remove -${adjustHours}h Attendance`}
                  </button>
                </div>
              </form>
            </section>
          )}

          {/* 5. Academic Batch Promotion / Multi-Batch Rollover (Students Tab) */}
          {activeRoleTab === 'student' && canManageMaster && liveBatchGroups.length > 0 && (
            <section className="surface-3d rounded-2xl p-5 sm:p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-bold text-stone-900 flex items-center gap-2">
                    <ArrowRight className="w-4 h-4 text-emerald-900" />
                    Academic Batch Promotion (1-Click Prof Rollover · Multi-Batch Safe)
                  </h2>
                  <p className="text-xs text-stone-600 mt-0.5">
                    Jaise Batch 2025 (1st Prof) ko 2nd Prof me promote karein — 2nd Prof me Batch 2024 aur Batch 2025 dono alag-alag batch tag ke saath safely chalenge.
                  </p>
                </div>
              </div>

              <form
                onSubmit={handlePromoteBatch}
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end"
              >
                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    Select Current Batch &amp; Prof
                  </label>
                  <select
                    value={effectivePromoGroup?.key || ''}
                    onChange={(e) => {
                      const nextKey = e.target.value;
                      setPromoKey(nextKey);
                      const grp = liveBatchGroups.find((g) => g.key === nextKey);
                      if (grp) {
                        const idx = profYears.indexOf(grp.profYear);
                        if (idx >= 0 && idx + 1 < profYears.length) {
                          setPromoTargetProf(profYears[idx + 1]);
                        }
                      }
                    }}
                    className="w-full px-3 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                  >
                    {liveBatchGroups.map((g) => (
                      <option key={g.key} value={g.key}>
                        {g.batch} · {g.profYear} ({g.count} students)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-stone-700 mb-1">
                    Promote To Target Prof
                  </label>
                  <select
                    value={promoTargetProf}
                    onChange={(e) => setPromoTargetProf(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                  >
                    {profYears.map((py) => (
                      <option key={py} value={py}>
                        {py}
                      </option>
                    ))}
                  </select>
                </div>

                <label className="inline-flex items-center gap-2 text-xs text-stone-700 pb-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={promoResetHours}
                    onChange={(e) => setPromoResetHours(e.target.checked)}
                    className="rounded border-amber-900/30 text-emerald-800"
                  />
                  <span>Reset hours to 0 for new Prof</span>
                </label>

                <button
                  type="submit"
                  disabled={promotingBatch || !effectivePromoGroup}
                  className="btn-3d inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white rounded-lg whitespace-nowrap"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                  {promotingBatch
                    ? 'Promoting Batch...'
                    : effectivePromoGroup
                      ? `Promote ${effectivePromoGroup.batch} → ${promoTargetProf}`
                      : 'Promote Batch'}
                </button>
              </form>
            </section>
          )}

          {/* 6. Bulk Excel / CSV Previous-Portal Attendance Migration (Students Tab) */}
          {activeRoleTab === 'student' && canOverrideAttendance && (
            <ExcelAttendanceImporter
              students={students}
              sessions={sessions}
              subjects={subjects}
              teachers={teachers}
              users={users}
              invites={invites}
              masterConfig={masterConfig}
              actorUid={currentUid}
              actorName={currentName}
              staffUids={staffUids}
              onImported={(msg) => setStatusMessage(msg)}
            />
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* MASTER DATA CONFIGURATION VIEW                                    */}
      {/* ================================================================= */}
      {activeHubTab === 'master' && (
        <div className="space-y-6">
          {/* 1. Attendance Options, Prof Years & Departments Master */}
          <section className="surface-3d rounded-2xl p-5 sm:p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-stone-900">
                  Attendance Options, Prof Years &amp; Departments Master
                </h2>
                <p className="text-xs text-stone-600">
                  Add or customize Session Formats, Class Activities, Attendance Mark Options, and BAMS Prof Years
                </p>
              </div>
              <button
                type="button"
                disabled={!canManageMaster || savingMaster}
                onClick={handleSaveMaster}
                className="btn-3d px-4 py-2.5 text-xs font-medium text-white rounded-xl whitespace-nowrap shrink-0"
              >
                {savingMaster ? 'Saving Master Data...' : 'Save Master Data'}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Session Formats */}
              <div className="surface-3d-inset rounded-xl p-4 space-y-3">
                <p className="text-xs font-bold text-stone-900">Session Formats</p>
                <div className="space-y-1.5">
                  {sessionTypes.map((item) => (
                    <div
                      key={item}
                      className="flex items-center justify-between bg-white px-3 py-1.5 rounded-lg border border-amber-900/15 text-xs"
                    >
                      <span>{item}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setSessionTypes((prev) =>
                            prev.length > 1 ? prev.filter((x) => x !== item) : prev
                          )
                        }
                        className="text-red-700 hover:text-red-900"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Add format (e.g. Dissection Lab)"
                    value={newSessionOpt}
                    onChange={(e) => setNewSessionOpt(e.target.value)}
                    className="flex-1 px-3 py-1.5 text-xs bg-white border border-amber-900/20 rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!newSessionOpt.trim()) return;
                      setSessionTypes((prev) =>
                        Array.from(new Set([...prev, newSessionOpt.trim()]))
                      );
                      setNewSessionOpt('');
                    }}
                    className="btn-3d-secondary px-3 py-1.5 text-xs font-medium rounded-lg"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Activity Options */}
              <div className="surface-3d-inset rounded-xl p-4 space-y-3">
                <p className="text-xs font-bold text-stone-900">Class Activity Options</p>
                <div className="space-y-1.5">
                  {activityTypes.map((item) => (
                    <div
                      key={item}
                      className="flex items-center justify-between bg-white px-3 py-1.5 rounded-lg border border-amber-900/15 text-xs"
                    >
                      <span>{item}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setActivityTypes((prev) =>
                            prev.length > 1 ? prev.filter((x) => x !== item) : prev
                          )
                        }
                        className="text-red-700 hover:text-red-900"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Add activity (e.g. Case Viva)"
                    value={newActivityOpt}
                    onChange={(e) => setNewActivityOpt(e.target.value)}
                    className="flex-1 px-3 py-1.5 text-xs bg-white border border-amber-900/20 rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!newActivityOpt.trim()) return;
                      setActivityTypes((prev) =>
                        Array.from(new Set([...prev, newActivityOpt.trim()]))
                      );
                      setNewActivityOpt('');
                    }}
                    className="btn-3d-secondary px-3 py-1.5 text-xs font-medium rounded-lg"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Attendance Status / Leave Options */}
              <div className="surface-3d-inset rounded-xl p-4 space-y-3">
                <p className="text-xs font-bold text-stone-900">Attendance Status &amp; Leave Options</p>
                <div className="space-y-1.5">
                  {attendanceOptions.map((item) => (
                    <div
                      key={item}
                      className="flex items-center justify-between bg-white px-3 py-1.5 rounded-lg border border-amber-900/15 text-xs"
                    >
                      <span>{item}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setAttendanceOptions((prev) =>
                            prev.length > 1 ? prev.filter((x) => x !== item) : prev
                          )
                        }
                        className="text-red-700 hover:text-red-900"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Add option (e.g. NSS / Camp Duty)"
                    value={newAttendanceOpt}
                    onChange={(e) => setNewAttendanceOpt(e.target.value)}
                    className="flex-1 px-3 py-1.5 text-xs bg-white border border-amber-900/20 rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!newAttendanceOpt.trim()) return;
                      setAttendanceOptions((prev) =>
                        Array.from(new Set([...prev, newAttendanceOpt.trim()]))
                      );
                      setNewAttendanceOpt('');
                    }}
                    className="btn-3d-secondary px-3 py-1.5 text-xs font-medium rounded-lg"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* BAMS Prof Years & Departments */}
              <div className="surface-3d-inset rounded-xl p-4 space-y-4">
                <div className="space-y-2">
                  <p className="text-xs font-bold text-stone-900">BAMS Prof Batches</p>
                  <div className="flex flex-wrap gap-2">
                    {profYears.map((py) => (
                      <div
                        key={py}
                        className="inline-flex items-center gap-2 bg-white px-2.5 py-1 rounded-lg border border-amber-900/15 text-xs"
                      >
                        <span>{py}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setProfYears((prev) =>
                              prev.length > 1 ? prev.filter((x) => x !== py) : prev
                            )
                          }
                          className="text-red-700 font-bold"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Add Prof (e.g. Final Prof)"
                      value={newProfYearOpt}
                      onChange={(e) => setNewProfYearOpt(e.target.value)}
                      className="flex-1 px-3 py-1.5 text-xs bg-white border border-amber-900/20 rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!newProfYearOpt.trim()) return;
                        setProfYears((prev) =>
                          Array.from(new Set([...prev, newProfYearOpt.trim()]))
                        );
                        setNewProfYearOpt('');
                      }}
                      className="btn-3d-secondary px-3 py-1.5 text-xs font-medium rounded-lg"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="space-y-2 pt-2 border-t border-amber-900/15">
                  <p className="text-xs font-bold text-stone-900">Ayurvedic Departments</p>
                  <div className="flex flex-wrap gap-2">
                    {departments.map((d) => (
                      <div
                        key={d}
                        className="inline-flex items-center gap-2 bg-white px-2.5 py-1 rounded-lg border border-amber-900/15 text-xs"
                      >
                        <span>{d}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setDepartments((prev) =>
                              prev.length > 1 ? prev.filter((x) => x !== d) : prev
                            )
                          }
                          className="text-red-700 font-bold"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Add Dept (e.g. Rasashastra)"
                      value={newDeptOpt}
                      onChange={(e) => setNewDeptOpt(e.target.value)}
                      className="flex-1 px-3 py-1.5 text-xs bg-white border border-amber-900/20 rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!newDeptOpt.trim()) return;
                        setDepartments((prev) =>
                          Array.from(new Set([...prev, newDeptOpt.trim()]))
                        );
                        setNewDeptOpt('');
                      }}
                      className="btn-3d-secondary px-3 py-1.5 text-xs font-medium rounded-lg"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="pt-2 border-t border-amber-900/15 flex items-center justify-between gap-3">
                  <label className="text-xs font-bold text-stone-900">
                    NCISM Attendance Alert Threshold (%)
                  </label>
                  <input
                    type="number"
                    min={50}
                    max={100}
                    value={minThreshold}
                    onChange={(e) => setMinThreshold(Number(e.target.value))}
                    className="w-24 px-3 py-1.5 text-xs font-mono tabular-nums bg-white border border-amber-900/20 rounded-lg"
                  />
                </div>
              </div>

              {/* Custom Master Sections (Dynamic Cards Matching Attendance Options Layout) */}
              {customSections.map((sec) => (
                <div key={sec.id} className="surface-3d-inset rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold text-stone-900">{sec.title}</p>
                    {canManageMaster && (
                      <button
                        type="button"
                        onClick={() => handleDeleteCustomSection(sec.id)}
                        className="text-xs font-medium text-red-700 hover:underline whitespace-nowrap"
                      >
                        Delete Section
                      </button>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {sec.items.length > 0 ? (
                      sec.items.map((item) => (
                        <div
                          key={item}
                          className="flex items-center justify-between bg-white px-3 py-1.5 rounded-lg border border-amber-900/15 text-xs"
                        >
                          <span>{item}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveCustomSectionItem(sec.id, item)}
                            className="text-red-700 hover:text-red-900"
                          >
                            Remove
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="text-[11px] text-stone-500">No options added yet.</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder={`Add option to ${sec.title}`}
                      value={customSectionInputs[sec.id] || ''}
                      onChange={(e) =>
                        setCustomSectionInputs((prev) => ({
                          ...prev,
                          [sec.id]: e.target.value,
                        }))
                      }
                      className="flex-1 px-3 py-1.5 text-xs bg-white border border-amber-900/20 rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={() => handleAddCustomSectionItem(sec.id)}
                      className="btn-3d-secondary px-3 py-1.5 text-xs font-medium rounded-lg"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Add New Master Section Form */}
            {canManageMaster && (
              <form
                onSubmit={handleCreateCustomSection}
                className="surface-3d-inset rounded-xl p-4 space-y-3 border border-amber-900/15"
              >
                <div>
                  <p className="text-xs font-bold text-stone-900">
                    Add New Master Section Card (Like Attendance Status &amp; Leave Options)
                  </p>
                  <p className="text-[11px] text-stone-600">
                    Need a new category (e.g. Hostel / Transport Leave, Lecture Halls, Clinical Units)? Create it here and add its options.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <input
                    type="text"
                    required
                    maxLength={60}
                    placeholder="Section Title (e.g. Lecture Halls / OPD Wards)"
                    value={newSectionTitle}
                    onChange={(e) => setNewSectionTitle(e.target.value)}
                    className="px-3 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                  />
                  <input
                    type="text"
                    maxLength={80}
                    placeholder="First Option (optional, e.g. Charaka Hall 101)"
                    value={newSectionInitialOpt}
                    onChange={(e) => setNewSectionInitialOpt(e.target.value)}
                    className="px-3 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                  />
                  <button
                    type="submit"
                    disabled={savingMaster}
                    className="btn-3d inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium text-white rounded-lg whitespace-nowrap"
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    Create New Master Section
                  </button>
                </div>
              </form>
            )}
          </section>

          {/* 2. Subjects & Faculty Assignment Master */}
          <section className="surface-3d rounded-2xl p-5 sm:p-6 space-y-5">
            <div className="flex items-center gap-2">
              <BookPlus className="w-4 h-4 text-emerald-900" />
              <div>
                <h2 className="text-base font-bold text-stone-900">
                  Subject Codes &amp; Faculty Handover Mapping ({subjects.length})
                </h2>
                <p className="text-xs text-stone-600">
                  Every Subject Code holds permanent curriculum hours &amp; history. If a teacher leaves, reassign that Subject Code below to seamlessly transfer ownership to the new faculty.
                </p>
              </div>
            </div>

            {canManageMaster && (
              <form
                onSubmit={handleAddSubjectMaster}
                className="surface-3d-inset rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3"
              >
                <input
                  type="text"
                  required
                  placeholder="Code (BAMS-401)"
                  value={subCode}
                  onChange={(e) => setSubCode(e.target.value)}
                  className="px-3 py-2 text-xs font-mono bg-white border border-amber-900/20 rounded-lg"
                />
                <input
                  type="text"
                  required
                  placeholder="Subject Name"
                  value={subName}
                  onChange={(e) => setSubName(e.target.value)}
                  className="lg:col-span-2 px-3 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                />
                <select
                  value={subDept}
                  onChange={(e) => setSubDept(e.target.value)}
                  className="px-3 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                >
                  {departments.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
                <select
                  value={subProf}
                  onChange={(e) => setSubProf(e.target.value)}
                  className="px-3 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                >
                  {profYears.map((py) => (
                    <option key={py} value={py}>
                      {py}
                    </option>
                  ))}
                </select>
                <select
                  value={subTeacherId || teachers[0]?.id || ''}
                  onChange={(e) => setSubTeacherId(e.target.value)}
                  className="px-3 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                >
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.fullName}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={savingSubject || teachers.length === 0}
                  className="btn-3d px-3 py-2 text-xs font-medium text-white rounded-lg whitespace-nowrap"
                >
                  {savingSubject ? 'Adding...' : 'Add Subject'}
                </button>
              </form>
            )}

            <div className="overflow-x-auto border border-amber-900/15 rounded-xl bg-white/80">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-amber-950/5 border-b border-amber-900/15 font-semibold text-stone-700">
                    <th className="py-2.5 px-3">Subject Code</th>
                    <th className="py-2.5 px-3">Subject &amp; Department</th>
                    <th className="py-2.5 px-3">Prof Year</th>
                    <th className="py-2.5 px-3">Assigned Faculty (Handover)</th>
                    <th className="py-2.5 px-3 text-right">Delivered / Req Hrs</th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-amber-900/10">
                  {subjects.map((sub) => (
                    <tr key={sub.id} className="hover:bg-amber-50/40">
                      <td className="py-2.5 px-3 font-mono font-bold text-emerald-950 whitespace-nowrap">
                        {sub.code}
                      </td>
                      <td className="py-2.5 px-3">
                        <p className="font-semibold text-stone-900">{sub.name}</p>
                        <p className="text-stone-500">{sub.department}</p>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">{sub.profYear}</td>
                      <td className="py-2.5 px-3">
                        {canManageMaster && teachers.length > 0 ? (
                          <select
                            aria-label={`Assign faculty for ${sub.code}`}
                            disabled={reassigningSubId === sub.id}
                            value={sub.teacherId}
                            onChange={(e) => handleReassignSubjectTeacher(sub, e.target.value)}
                            className="px-2.5 py-1.5 text-xs bg-white border border-amber-900/20 rounded-lg max-w-[230px]"
                          >
                            {!teachers.some((t) => t.id === sub.teacherId) && (
                              <option value={sub.teacherId}>{sub.teacherName}</option>
                            )}
                            {teachers.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.fullName}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span>{sub.teacherName}</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        {sub.deliveredHours}h / {sub.requiredTheoryHours + sub.requiredPracticalHours}h
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        {canManageMaster && (
                          <button
                            type="button"
                            onClick={() => adminDeleteSubject(sub.id)}
                            className="text-red-700 hover:underline font-medium"
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* 3. All Profiles Sidebar Menu & Custom Links Manager */}
          <section className="surface-3d rounded-2xl p-5 sm:p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Menu className="w-4 h-4 text-emerald-900" />
                <div>
                  <h2 className="text-base font-bold text-stone-900">
                    All Profiles Menu &amp; Custom Links Manager (Add / Remove Links)
                  </h2>
                  <p className="text-xs text-stone-600">
                    Har profile (Admin, Co-Admin, Principal, Faculty, Student, Parent) ke sidebar menu me custom web/portal links add ya built-in menu tabs hide/restore karein.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {PROFILE_LINK_ROLES.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setMenuManagerRole(r.id)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap ${
                      menuManagerRole === r.id
                        ? 'btn-3d text-white'
                        : 'btn-3d-secondary text-stone-800'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {menuManagerRole !== 'all' && (
              <div className="surface-3d-inset rounded-xl p-4 space-y-2.5">
                <p className="text-xs font-bold text-stone-900">
                  Built-in Sidebar Tabs for{' '}
                  {PROFILE_LINK_ROLES.find((r) => r.id === menuManagerRole)?.label} (Click to
                  Remove or Restore)
                </p>
                <div className="flex flex-wrap gap-2">
                  {PORTAL_MENU_TABS.map((tab) => {
                    const lockedAdminTab =
                      menuManagerRole === 'admin' && tab.id === 'admin';
                    const isHidden =
                      !lockedAdminTab &&
                      profileHiddenTabs.includes(`${menuManagerRole}:${tab.id}`);
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        disabled={lockedAdminTab || savingMenuLinks}
                        onClick={() =>
                          handleToggleBuiltInTabVisibility(menuManagerRole as UserRole, tab.id)
                        }
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                          lockedAdminTab
                            ? 'bg-emerald-950 text-amber-200 border-amber-400/30 cursor-not-allowed'
                            : isHidden
                              ? 'bg-red-50 border-red-200 text-red-700 line-through'
                              : 'bg-white border-emerald-800/30 text-emerald-950'
                        }`}
                      >
                        <span>{tab.label}</span>
                        <span className="text-[10px] font-bold">
                          {lockedAdminTab
                            ? '(Core Locked)'
                            : isHidden
                              ? '+ Restore'
                              : '× Remove'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <form
              onSubmit={(e) => handleAddProfileMenuLink(e)}
              className="surface-3d-inset rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end"
            >
              <div>
                <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                  Target Profile
                </label>
                <select
                  value={menuManagerRole}
                  onChange={(e) => setMenuManagerRole(e.target.value as UserRole | 'all')}
                  className="w-full px-2.5 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                >
                  {PROFILE_LINK_ROLES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                  Menu Link Title
                </label>
                <input
                  type="text"
                  required
                  maxLength={48}
                  placeholder="e.g. Exam Timetable"
                  value={newLinkLabel}
                  onChange={(e) => setNewLinkLabel(e.target.value)}
                  className="w-full px-2.5 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                  Link Type
                </label>
                <select
                  value={newLinkTargetType}
                  onChange={(e) => setNewLinkTargetType(e.target.value as 'url' | 'tab')}
                  className="w-full px-2.5 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                >
                  <option value="url">External Website URL</option>
                  <option value="tab">Portal Screen Tab</option>
                </select>
              </div>
              <div className="lg:col-span-2">
                <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                  {newLinkTargetType === 'url' ? 'Website URL' : 'Select Portal Tab'}
                </label>
                {newLinkTargetType === 'url' ? (
                  <input
                    type="text"
                    required
                    maxLength={300}
                    placeholder="https://mggau.ac.in or https://ncismindia.org"
                    value={newLinkUrl}
                    onChange={(e) => setNewLinkUrl(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                  />
                ) : (
                  <select
                    value={newLinkTab}
                    onChange={(e) => setNewLinkTab(e.target.value as PortalTabId)}
                    className="w-full px-2.5 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                  >
                    {PORTAL_MENU_TABS.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <button
                type="submit"
                disabled={savingMenuLinks}
                className="btn-3d inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white rounded-lg whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                {savingMenuLinks ? 'Saving...' : 'Add Menu Link'}
              </button>
            </form>

            <div className="overflow-x-auto border border-amber-900/15 rounded-xl bg-white/85">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-amber-950/5 border-b border-amber-900/15 font-semibold text-stone-700">
                    <th className="py-2.5 px-3">Profile Target</th>
                    <th className="py-2.5 px-3">Link Label</th>
                    <th className="py-2.5 px-3">Destination</th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-amber-900/10">
                  {profileMenuLinks.map((lnk) => (
                    <tr key={lnk.id} className="hover:bg-amber-50/40">
                      <td className="py-2.5 px-3 font-semibold text-emerald-950 whitespace-nowrap">
                        {PROFILE_LINK_ROLES.find((r) => r.id === lnk.role)?.label || lnk.role}
                      </td>
                      <td className="py-2.5 px-3 font-medium text-stone-900">{lnk.label}</td>
                      <td className="py-2.5 px-3 font-mono text-stone-600 truncate max-w-md">
                        {lnk.targetType === 'url'
                          ? lnk.url
                          : `Portal Tab → ${
                              PORTAL_MENU_TABS.find((t) => t.id === lnk.tabId)?.label || lnk.tabId
                            }`}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleRemoveProfileMenuLink(lnk.id)}
                          className="text-red-700 hover:underline font-medium"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                  {profileMenuLinks.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-5 text-center text-stone-500">
                        No custom profile menu links added yet. Use the form above to add links for any role.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
