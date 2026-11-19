import { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  buildPdfSubjects,
  buildPdfTeacherProfiles,
  PDF_BATCH_DEFINITIONS,
  PDF_SESSION_TYPES,
} from '../data/sspsamchRoster';
import {
  AccessInvite,
  ActivityType,
  AttendanceAlert,
  AttendanceSession,
  ClinicalRotation,
  ClinicalRotationStatus,
  CustomMasterSection,
  CustomRoleDef,
  DEFAULT_ACTIVITY_TYPES,
  DEFAULT_ATTENDANCE_OPTIONS,
  DEFAULT_DEPARTMENTS,
  DEFAULT_PROF_YEARS,
  DEFAULT_ROLE_PERMISSIONS,
  EntryMode,
  FeedbackCategory,
  FeedbackItem,
  FeedbackStatus,
  INSTITUTION_ID,
  InteractionActionType,
  LearningResource,
  LeaveRequest,
  LeaveStatus,
  LeaveType,
  MasterConfig,
  PermissionKey,
  ProfYear,
  ProfileMenuLink,
  ResourceCategory,
  SessionStatus,
  SessionStudentRecord,
  SessionType,
  StudentAttendanceStatus,
  StudentRecord,
  StudentStanding,
  Subject,
  TeacherProfile,
  TimetableEntry,
  UserProfYear,
  UserProfile,
  UserRole,
  VALIDATION_LIMITS,
} from '../types';

export const BOOTSTRAPPED_ADMIN_EMAIL = 'ajayby0198@gmail.com';
export const FACULTY_SECURITY_PIN = '2422';

export function generateAccessCode(): string {
  const num = Math.floor(100000 + Math.random() * 900000);
  return `SSPS-${num}`;
}

export function emailToInviteId(email: string): string {
  const clean = email.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  return `inv_${clean}`.slice(0, VALIDATION_LIMITS.idMax);
}

export function hasPermission(
  profile: UserProfile | null | undefined,
  permission: PermissionKey
): boolean {
  if (!profile) return false;
  if (profile.role === 'admin') return true;
  if (Array.isArray(profile.permissions) && profile.permissions.length > 0) {
    return profile.permissions.includes(permission);
  }
  if (profile.permissions && profile.permissions.length === 0) {
    return false;
  }
  return DEFAULT_ROLE_PERMISSIONS[profile.role]?.includes(permission) ?? false;
}

const clamp = (val: string, max: number, fallback = ''): string => {
  const cleaned = (val ?? fallback).trim();
  return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
};

const safeId = (raw: string): string => {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, VALIDATION_LIMITS.idMax);
  return cleaned.length > 0 ? cleaned : `id_${Date.now()}`;
};

const currentHourBucket = (): string => {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  return `${h}:00`;
};

export function computeStanding(percent: number, consecutiveAbsences: number): StudentStanding {
  if (percent < 65 || consecutiveAbsences >= 3) return 'critical';
  if (percent < 75 || consecutiveAbsences >= 2) return 'warning';
  return 'nominal';
}

export function isTheorySessionType(sessionType: string): boolean {
  const lower = (sessionType || '').toLowerCase();
  return lower.includes('lecture') || lower.includes('theory');
}

export async function ensureUserProfile(user: User): Promise<UserProfile> {
  const userPath = `users/${user.uid}`;
  try {
    const userRef = doc(db, 'users', user.uid);
    const snap = await getDoc(userRef);
    const emailLower = (user.email || 'no-email@sspsamch.edu').trim().toLowerCase();
    const isAdminEmail =
      emailLower === BOOTSTRAPPED_ADMIN_EMAIL && user.emailVerified;

    if (snap.exists()) {
      const existingData = snap.data() as Partial<UserProfile>;
      if (isAdminEmail) {
        await setDoc(doc(db, 'admins', user.uid), {
          uid: safeId(user.uid),
          createdAt: serverTimestamp(),
        });
        if (
          existingData.role !== 'admin' ||
          existingData.approvalStatus !== 'active' ||
          !existingData.accessCodeVerified ||
          !existingData.permissions?.includes('verify_users')
        ) {
          const repaired: Partial<UserProfile> = {
            email: clamp(existingData.email || emailLower, VALIDATION_LIMITS.emailMax, emailLower),
            role: 'admin',
            requestedRole: 'admin',
            approvalStatus: 'active',
            permissions: DEFAULT_ROLE_PERMISSIONS.admin,
            accessCode: 'ADMIN',
            accessCodeVerified: true,
            profYear: 'Administration',
            department: 'Institutional Administration',
            rollOrEmpId: existingData.rollOrEmpId || 'ADM-001',
            updatedAt: serverTimestamp(),
          };
          await updateDoc(userRef, repaired);
          return {
            ...(existingData as UserProfile),
            ...(repaired as UserProfile),
          };
        }
      }

      if (
        existingData.email === undefined ||
        existingData.permissions === undefined ||
        existingData.accessCode === undefined ||
        existingData.accessCodeVerified === undefined ||
        existingData.inviteId === undefined
      ) {
        const patched: Partial<UserProfile> = {
          email: clamp(existingData.email || emailLower, VALIDATION_LIMITS.emailMax, emailLower),
          permissions: existingData.permissions ?? [],
          accessCode: existingData.accessCode ?? '',
          accessCodeVerified: existingData.accessCodeVerified ?? false,
          inviteId: existingData.inviteId ?? '',
          updatedAt: serverTimestamp(),
        };
        await updateDoc(userRef, patched);
        return {
          ...(existingData as UserProfile),
          ...(patched as UserProfile),
        };
      }
      return existingData as UserProfile;
    }

    // Check if Admin pre-authorized this Google email in AccessInvites
    let matchedInvite: AccessInvite | null = null;
    if (!isAdminEmail && user.emailVerified && user.email) {
      const inviteSnap = await getDocs(
        query(collection(db, 'accessInvites'), where('email', '==', emailLower))
      );
      const activeDoc = inviteSnap.docs.find((d) => (d.data() as AccessInvite).status === 'invited');
      if (activeDoc) {
        matchedInvite = activeDoc.data() as AccessInvite;
      }
    }

    const defaultProfYear: UserProfYear = isAdminEmail
      ? 'Administration'
      : matchedInvite?.profYear || '1st Prof';

    const profile: UserProfile = {
      uid: safeId(user.uid),
      email: clamp(emailLower, VALIDATION_LIMITS.emailMax, 'no-email@sspsamch.edu'),
      displayName: clamp(
        matchedInvite?.displayName ||
          user.displayName ||
          emailLower.split('@')[0] ||
          'College Member',
        VALIDATION_LIMITS.displayNameMax,
        'College Member'
      ),
      role: isAdminEmail ? 'admin' : matchedInvite ? matchedInvite.role : 'student',
      requestedRole: isAdminEmail ? 'admin' : matchedInvite ? matchedInvite.role : 'student',
      approvalStatus: isAdminEmail || matchedInvite ? 'active' : 'pending',
      permissions: isAdminEmail
        ? DEFAULT_ROLE_PERMISSIONS.admin
        : matchedInvite
          ? matchedInvite.permissions
          : [],
      accessCode: isAdminEmail ? 'ADMIN' : matchedInvite ? matchedInvite.accessCode : '',
      accessCodeVerified: isAdminEmail,
      inviteId: matchedInvite ? matchedInvite.id : '',
      profYear: defaultProfYear,
      department: isAdminEmail
        ? 'Institutional Administration'
        : matchedInvite?.department || 'BAMS Undergraduate',
      rollOrEmpId: isAdminEmail
        ? 'ADM-001'
        : matchedInvite?.rollOrEmpId || `BAMS-${user.uid.slice(0, 6).toUpperCase()}`,
      avatarUrl: clamp(user.photoURL || '', VALIDATION_LIMITS.avatarUrlMax, ''),
      ...(matchedInvite?.customRoleId ? { customRoleId: matchedInvite.customRoleId } : {}),
      ...(matchedInvite?.customRoleName ? { customRoleName: matchedInvite.customRoleName } : {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await setDoc(userRef, profile);

    if (matchedInvite) {
      await updateDoc(doc(db, 'accessInvites', matchedInvite.id), {
        status: 'claimed',
        updatedAt: serverTimestamp(),
      });
    }

    await setDoc(doc(db, 'users', user.uid, 'private', 'info'), {
      uid: safeId(user.uid),
      email: clamp(emailLower, VALIDATION_LIMITS.emailMax, 'no-email@sspsamch.edu'),
      phone: '',
      updatedAt: serverTimestamp(),
    });

    if (isAdminEmail) {
      await setDoc(doc(db, 'admins', user.uid), {
        uid: safeId(user.uid),
        createdAt: serverTimestamp(),
      });
    }

    return profile;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

export async function updateOwnOnboarding(
  uid: string,
  updates: {
    displayName: string;
    profYear: UserProfYear;
    department: string;
    rollOrEmpId: string;
    requestedRole: UserRole;
  }
): Promise<void> {
  const path = `users/${uid}`;
  const cleanId =
    updates.requestedRole === 'student' || updates.requestedRole === 'parent'
      ? updates.rollOrEmpId.trim().toUpperCase()
      : updates.rollOrEmpId.trim();
  try {
    await updateDoc(doc(db, 'users', uid), {
      displayName: clamp(updates.displayName, VALIDATION_LIMITS.displayNameMax, 'Member'),
      profYear: updates.profYear,
      department: clamp(updates.department, VALIDATION_LIMITS.departmentMax, 'BAMS'),
      rollOrEmpId: clamp(cleanId, VALIDATION_LIMITS.rollOrEmpIdMax, ''),
      requestedRole: updates.requestedRole,
      approvalStatus: 'pending',
      accessCodeVerified: false,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function verifyOwnAccessCode(
  uid: string,
  inputCode: string,
  expectedCode: string
): Promise<boolean> {
  const path = `users/${uid}`;
  if (!expectedCode || inputCode.trim().toUpperCase() !== expectedCode.trim().toUpperCase()) {
    return false;
  }
  try {
    await updateDoc(doc(db, 'users', uid), {
      accessCodeVerified: true,
      updatedAt: serverTimestamp(),
    });
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateOwnProfileLock(params: {
  uid: string;
  enabled: boolean;
  pin: string;
}): Promise<void> {
  const path = `users/${params.uid}`;
  const cleanPin = clamp(params.pin, 24, '');
  try {
    await updateDoc(doc(db, 'users', params.uid), {
      profileLockEnabled: Boolean(params.enabled && cleanPin.length >= 4),
      profileLockPin: params.enabled ? cleanPin : '',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function adminResetProfileLock(uid: string): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      profileLockEnabled: false,
      profileLockPin: '',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function logInteraction(params: {
  actorUid: string;
  actorName: string;
  actorRole: UserRole;
  actionType: InteractionActionType;
  label: string;
  staffUids: string[];
  hourBucket?: string;
}): Promise<void> {
  const id = safeId(`log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  const path = `interactionLogs/${id}`;
  try {
    await setDoc(doc(db, 'interactionLogs', id), {
      id,
      actorUid: safeId(params.actorUid),
      actorName: clamp(params.actorName, VALIDATION_LIMITS.displayNameMax, 'User'),
      actorRole: params.actorRole,
      actionType: params.actionType,
      label: clamp(params.label, VALIDATION_LIMITS.logLabelMax, 'Activity logged'),
      hourBucket: clamp(params.hourBucket || currentHourBucket(), 12, '09:00'),
      staffUids: params.staffUids.slice(0, VALIDATION_LIMITS.maxStaffList),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function seedInstitutionalData(adminUid: string, adminName: string): Promise<void> {
  const staffUids = [safeId(adminUid)];
  const todayStr = new Date().toISOString().slice(0, 10);
  const yesterdayStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const twoDaysAgoStr = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);

  try {
    const teachers = buildPdfTeacherProfiles(safeId(adminUid));
    const subjects = buildPdfSubjects();

    // Assign subject codes back onto each teacher profile
    teachers.forEach((t) => {
      t.assignedSubjects = subjects.filter((s) => s.teacherId === t.id).map((s) => s.code);
    });

    const students: Omit<StudentRecord, 'createdAt' | 'updatedAt'>[] = [];
    for (const def of PDF_BATCH_DEFINITIONS) {
      def.students.forEach((fullName, idx) => {
        const serial = idx + 1;
        const id =
          def.batch === 'Batch 2024'
            ? `stu_${200 + serial}`
            : def.batch === 'Batch 2023'
              ? `stu_${300 + serial}`
              : def.batch === 'Batch 2025'
                ? `stu_25_${String(serial).padStart(3, '0')}`
                : `stu_26_${String(serial).padStart(3, '0')}`;
        const rollNumber = `${def.rollPrefix}${String(serial).padStart(3, '0')}`;

        const scheduled =
          def.batch === 'Batch 2024'
            ? 140
            : def.batch === 'Batch 2023'
              ? 160
              : def.batch === 'Batch 2025'
                ? 120
                : 80;

        // Deterministic realistic standing preserving alert students in Batch 2024
        let attended = Math.round(scheduled * 0.86);
        let consecutive = 0;
        if (def.batch === 'Batch 2024' && serial === 2) {
          attended = 101;
          consecutive = 2;
        } else if (def.batch === 'Batch 2024' && serial === 3) {
          attended = 86;
          consecutive = 3;
        } else if (def.batch === 'Batch 2024' && serial === 8) {
          attended = 96;
          consecutive = 2;
        } else if (def.batch === 'Batch 2024' && serial === 11) {
          attended = 84;
          consecutive = 3;
        } else if (serial % 11 === 0) {
          attended = Math.round(scheduled * 0.68);
          consecutive = 2;
        } else if (serial % 7 === 0) {
          attended = Math.round(scheduled * 0.73);
          consecutive = 1;
        } else if (serial % 3 === 0) {
          attended = Math.round(scheduled * 0.91);
        }

        const theoryHrs = Math.round(attended * 0.56);
        const practicalHrs = Math.max(0, attended - theoryHrs);
        const pct = scheduled > 0 ? Math.min(100, Number(((attended / scheduled) * 100).toFixed(1))) : 100;

        students.push({
          id,
          uid: `seed_${id}`,
          rollNumber,
          fullName,
          profYear: def.profYear,
          batch: def.batch,
          totalHoursScheduled: scheduled,
          totalHoursAttended: attended,
          theoryHoursAttended: theoryHrs,
          practicalHoursAttended: practicalHrs,
          attendancePercent: pct,
          consecutiveAbsences: consecutive,
          standing: computeStanding(pct, consecutive),
          staffUids,
        });
      });
    }

    const alerts: Omit<AttendanceAlert, 'createdAt' | 'updatedAt'>[] = [
      {
        id: 'alt_abhinendra_crit',
        type: 'consecutive_absence',
        severity: 'critical',
        targetStudentId: 'stu_203',
        targetStudentUid: 'seed_stu_203',
        targetName: 'Abhinendra Singh',
        profYear: '2nd Prof',
        subjectCode: 'BAMS-DG-202',
        attendancePercent: 61.4,
        message: '3 consecutive absences in Batch 2024 Dravyaguna practicals; cumulative attendance at 61.4% (<75% NCISM threshold).',
        resolved: false,
        resolvedBy: '',
        staffUids,
      },
      {
        id: 'alt_ankita_crit',
        type: 'low_attendance',
        severity: 'critical',
        targetStudentId: 'stu_211',
        targetStudentUid: 'seed_stu_211',
        targetName: 'Ankita Chand',
        profYear: '2nd Prof',
        subjectCode: 'BAMS-RSBK-203',
        attendancePercent: 60.0,
        message: 'Batch 2024 cumulative attendance dropped to 60.0% (84/140 hrs). Parent notification flagged for 2nd Prof.',
        resolved: false,
        resolvedBy: '',
        staffUids,
      },
      {
        id: 'alt_abhinav_warn',
        type: 'low_attendance',
        severity: 'warning',
        targetStudentId: 'stu_202',
        targetStudentUid: 'seed_stu_202',
        targetName: 'Abhinav Gangwar',
        profYear: '2nd Prof',
        subjectCode: 'BAMS-DG-202',
        attendancePercent: 72.1,
        message: 'Attendance at 72.1% (101/140 hrs) with 2 consecutive absences. Requires 6 additional hours to reach 75% NCISM standing.',
        resolved: false,
        resolvedBy: '',
        staffUids,
      },
      {
        id: 'alt_aman_warn',
        type: 'low_attendance',
        severity: 'warning',
        targetStudentId: 'stu_208',
        targetStudentUid: 'seed_stu_208',
        targetName: 'Aman',
        profYear: '2nd Prof',
        subjectCode: 'BAMS-RSBK-203',
        attendancePercent: 68.6,
        message: 'Batch 2024 attendance at 68.6% (96/140 hrs). Flagged in daily Principal monitoring digest.',
        resolved: false,
        resolvedBy: '',
        staffUids,
      },
      {
        id: 'alt_draft_awasthi',
        type: 'draft_pending',
        severity: 'warning',
        targetStudentId: 't_pdf_007',
        targetStudentUid: safeId(adminUid),
        targetName: 'Dr. ARUN KUMAR AWASTHI',
        profYear: '2nd Prof',
        subjectCode: 'BAMS-DG-202',
        attendancePercent: 75.0,
        message: 'Batch 2024 Dravyaguna afternoon draft open for latecomer verification. Submit final register before 17:00.',
        resolved: false,
        resolvedBy: '',
        staffUids,
      },
    ];

    const resources: Omit<LearningResource, 'createdAt' | 'updatedAt'>[] = [
      {
        id: 'res_101',
        title: 'Asthi & Sandhi Sharir — Dissection Atlas Notes',
        category: 'notes',
        profYear: '1st Prof',
        subjectCode: 'BAMS-RS-101',
        description: 'Structured revision sheet covering Marmas, Asthi count, and osteology landmarks taught in Dissection Hall 1.',
        scoreSummary: 'Unit 3 · 24 pages',
        authorUid: safeId(adminUid),
        authorName: 'Dr. HONEY SR PRASAD',
        institutionId: INSTITUTION_ID,
      },
      {
        id: 'res_201',
        title: 'Batch 2024 Dravyaguna Internal Assessment Paper 1 (With Key)',
        category: 'test_paper',
        profYear: '2nd Prof',
        subjectCode: 'BAMS-DG-202',
        description: 'Previous sessional test paper on Rasa, Guna, Virya, Vipaka & Prabhava pharmacology for 2nd Professional students.',
        scoreSummary: 'Max Marks: 50',
        authorUid: safeId(adminUid),
        authorName: 'Dr. ARUN KUMAR AWASTHI',
        institutionId: INSTITUTION_ID,
      },
      {
        id: 'res_301',
        title: 'Mid-Term Internal Marks — Batch 2023 & 2024 Summary',
        category: 'marks',
        profYear: '3rd Prof',
        subjectCode: 'BAMS-KC-301',
        description: 'Evaluated clinical viva and internal assessment scores for Kayachikitsa OPD rotation.',
        scoreSummary: 'Class Avg: 74.2%',
        authorUid: safeId(adminUid),
        authorName: 'Dr. TRIPURA SAHU',
        institutionId: INSTITUTION_ID,
      },
      {
        id: 'res_notice_1',
        title: 'NCISM AYU0638 75% Attendance Audit Notice — Monthly Parent Summary',
        category: 'notification',
        profYear: 'All',
        subjectCode: 'INST',
        description: 'All Prof batches (Batch 2026, 2025, 2024, 2023) must maintain ≥75% theory & practical attendance for MGGAU AYUBA109 examination eligibility.',
        scoreSummary: 'Principal Office',
        authorUid: safeId(adminUid),
        authorName: 'SSPSAMCH Principal Office',
        institutionId: INSTITUTION_ID,
      },
    ];

    const feedbacks: Omit<FeedbackItem, 'createdAt' | 'updatedAt'>[] = [
      {
        id: 'fb_seed_1',
        authorUid: safeId(adminUid),
        authorName: 'Dr. PALLAVI SAXENA',
        authorRole: 'teacher',
        category: 'Attendance',
        message: 'Draft saving before final submit has completely eliminated wrong absent entries for hostel bus latecomers.',
        status: 'implemented',
        staffUids,
      },
      {
        id: 'fb_seed_2',
        authorUid: safeId(adminUid),
        authorName: 'Abhay Pratap Maurya',
        authorRole: 'student',
        category: 'Resources',
        message: 'Linking missed class topics directly inside the Student Portal helps Batch 2024 catch up immediately after leave.',
        status: 'reviewed',
        staffUids,
      },
      {
        id: 'fb_seed_3',
        authorUid: safeId(adminUid),
        authorName: 'Adeeba Khan',
        authorRole: 'student',
        category: 'Usability',
        message: '6-digit classroom self check-in plus instant subject-wise hours tracking makes 75% NCISM monitoring transparent.',
        status: 'submitted',
        staffUids,
      },
    ];

    const seedLogs: Array<{
      id: string;
      actionType: InteractionActionType;
      actorRole: UserRole;
      actorName: string;
      label: string;
      hourBucket: string;
    }> = [
      { id: 'log_seed_1', actionType: 'draft_saved', actorRole: 'teacher', actorName: 'Dr. HONEY SR PRASAD', label: 'Saved Rachana Sharir (BAMS-RS-101) 2h draft', hourBucket: '09:00' },
      { id: 'log_seed_2', actionType: 'student_checkin', actorRole: 'student', actorName: 'Aarti Mourya', label: 'Self check-in verified for BAMS-RS-101 (Batch 2025)', hourBucket: '09:00' },
      { id: 'log_seed_3', actionType: 'student_checkin', actorRole: 'student', actorName: 'Aadya Shukla', label: 'Self check-in verified for BAMS-RS-101 (Batch 2026)', hourBucket: '09:00' },
      { id: 'log_seed_4', actionType: 'session_submitted', actorRole: 'teacher', actorName: 'Dr. PALLAVI SAXENA', label: 'Submitted BAMS-KS-104 Kriya Sharir (2.0 hrs)', hourBucket: '10:00' },
      { id: 'log_seed_5', actionType: 'draft_saved', actorRole: 'teacher', actorName: 'Dr. ARUN KUMAR AWASTHI', label: 'Opened Batch 2024 BAMS-DG-202 draft with check-in code', hourBucket: '14:00' },
      { id: 'log_seed_6', actionType: 'student_checkin', actorRole: 'student', actorName: 'Abhay Pratap Maurya', label: 'Self check-in verified for BAMS-DG-202 (Batch 2024)', hourBucket: '14:00' },
      { id: 'log_seed_7', actionType: 'student_checkin', actorRole: 'student', actorName: 'Akhya Sharma', label: 'Self check-in verified for BAMS-DG-202 (Batch 2024)', hourBucket: '14:00' },
      { id: 'log_seed_8', actionType: 'session_submitted', actorRole: 'teacher', actorName: 'Dr. AAFTAB AHMAD', label: 'Submitted Panchakarma OPD clinicals (3.0 hrs)', hourBucket: '13:00' },
      { id: 'log_seed_9', actionType: 'alert_resolved', actorRole: 'principal', actorName: 'Dr. TRIPURA SAHU', label: 'Reviewed daily attendance summary & Master Academic PDF', hourBucket: '15:00' },
      { id: 'log_seed_10', actionType: 'role_updated', actorRole: 'admin', actorName: adminName, label: 'Synced SSPSAMCH 2024, 2025 & 2026 Batch rosters (179 students)', hourBucket: '16:00' },
    ];

    // Commit in safe chunks (< 400 writes per Firestore writeBatch)
    const writeOps: Array<() => { ref: ReturnType<typeof doc>; data: Record<string, unknown> }> = [];

    for (const t of teachers) {
      writeOps.push(() => ({
        ref: doc(db, 'teachers', t.id),
        data: { ...t, createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
      }));
    }
    for (const s of subjects) {
      writeOps.push(() => ({
        ref: doc(db, 'subjects', s.id),
        data: { ...s, createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
      }));
    }
    for (const st of students) {
      writeOps.push(() => ({
        ref: doc(db, 'students', st.id),
        data: { ...st, createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
      }));
    }
    for (const a of alerts) {
      writeOps.push(() => ({
        ref: doc(db, 'alerts', a.id),
        data: { ...a, createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
      }));
    }
    for (const r of resources) {
      writeOps.push(() => ({
        ref: doc(db, 'learningResources', r.id),
        data: { ...r, createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
      }));
    }
    for (const f of feedbacks) {
      writeOps.push(() => ({
        ref: doc(db, 'feedbackItems', f.id),
        data: { ...f, createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
      }));
    }
    for (const l of seedLogs) {
      writeOps.push(() => ({
        ref: doc(db, 'interactionLogs', l.id),
        data: {
          id: l.id,
          actorUid: safeId(adminUid),
          actorName: clamp(l.actorName, VALIDATION_LIMITS.displayNameMax, 'Staff'),
          actorRole: l.actorRole,
          actionType: l.actionType,
          label: clamp(l.label, VALIDATION_LIMITS.logLabelMax, 'Event'),
          hourBucket: l.hourBucket,
          staffUids,
          createdAt: serverTimestamp(),
        },
      }));
    }

    for (let i = 0; i < writeOps.length; i += 350) {
      const chunk = writeOps.slice(i, i + 350);
      const batch = writeBatch(db);
      chunk.forEach((makeOp) => {
        const { ref, data } = makeOp();
        batch.set(ref, data);
      });
      await batch.commit();
    }

    const batch24First11 = students.filter((s) => s.batch === 'Batch 2024').slice(0, 11);
    const batch25First6 = students.filter((s) => s.batch === 'Batch 2025').slice(0, 6);
    const batch23All = students.filter((s) => s.batch === 'Batch 2023');

    const sessionsToSeed: Array<{
      session: Omit<AttendanceSession, 'createdAt' | 'updatedAt'>;
      records: Array<Omit<SessionStudentRecord, 'updatedAt'>>;
    }> = [
      {
        session: {
          id: 'sess_open_draft_101',
          teacherUid: safeId(adminUid),
          teacherId: 't_pdf_001',
          teacherName: 'Dr. HONEY SR PRASAD',
          subjectId: 'sub_101',
          subjectCode: 'BAMS-RS-101',
          subjectName: 'Rachana Sharir',
          profYear: '1st Prof',
          batchLabel: '(2025) BAMS 1st Professional',
          sessionType: 'Practical (Lab Hours)',
          activityType: 'Regular Class',
          topicTaught: 'Marmasharir — Upper Limb Vital Points & Dissection',
          entryMode: 'live',
          date: todayStr,
          startTime: '09:00',
          endTime: '11:00',
          durationHours: 2,
          room: 'Dissection Hall 1',
          status: 'draft',
          allowStudentSelfMark: true,
          checkInCode: '482910',
          presentCount: 5,
          lateCount: 1,
          absentCount: 0,
          totalStudents: batch25First6.length,
          notes: 'Saved in draft — waiting for late hostel bus arrivals before final submission.',
          staffUids,
        },
        records: batch25First6.map((st, idx) => ({
          studentId: st.id,
          studentUid: st.uid,
          rollNumber: st.rollNumber,
          studentName: st.fullName,
          status: idx === 2 ? 'late' : 'present',
          creditedHours: idx === 2 ? 1.5 : 2,
          selfCheckedIn: idx < 2,
          checkInTime: idx === 2 ? '09:20' : '09:02',
          remarks: idx === 2 ? 'Arrived 20m late' : 'On time',
          teacherUid: safeId(adminUid),
          staffUids,
        })),
      },
      {
        session: {
          id: 'sess_open_draft_201',
          teacherUid: safeId(adminUid),
          teacherId: 't_pdf_007',
          teacherName: 'Dr. ARUN KUMAR AWASTHI',
          subjectId: 'sub_201',
          subjectCode: 'BAMS-DG-202',
          subjectName: 'Dravyaguna Vigyana',
          profYear: '2nd Prof',
          batchLabel: '(2024) BAMS 2nd Professional',
          sessionType: 'Theory (Class Hours)',
          activityType: 'Internal Test',
          topicTaught: 'Rasa-Panchaka Sessional Quiz & Ashwagandha Pharmacognosy',
          entryMode: 'live',
          date: todayStr,
          startTime: '14:00',
          endTime: '15:00',
          durationHours: 1,
          room: 'Charaka Hall 204',
          status: 'draft',
          allowStudentSelfMark: true,
          checkInCode: '739205',
          presentCount: 7,
          lateCount: 1,
          absentCount: 3,
          totalStudents: batch24First11.length,
          notes: 'Afternoon session — self check-in enabled for Batch 2024 (2nd Prof).',
          staffUids,
        },
        records: batch24First11.map((st, idx) => {
          const stStatus: StudentAttendanceStatus =
            idx === 1 ? 'late' : idx === 2 || idx === 7 || idx === 10 ? 'absent' : 'present';
          return {
            studentId: st.id,
            studentUid: st.uid,
            rollNumber: st.rollNumber,
            studentName: st.fullName,
            status: stStatus,
            creditedHours: stStatus === 'present' ? 1 : stStatus === 'late' ? 0.75 : 0,
            selfCheckedIn: stStatus === 'present' && idx % 2 === 0,
            checkInTime: stStatus === 'absent' ? '' : stStatus === 'late' ? '14:16' : '14:02',
            remarks: stStatus === 'late' ? 'Arrived 15m late' : '',
            teacherUid: safeId(adminUid),
            staffUids,
          };
        }),
      },
      {
        session: {
          id: 'sess_sub_302_today',
          teacherUid: safeId(adminUid),
          teacherId: 't_pdf_013',
          teacherName: 'Dr. AAFTAB AHMAD',
          subjectId: 'sub_302',
          subjectCode: 'BAMS-PK-302',
          subjectName: 'Panchakarma Clinical Therapeutics',
          profYear: '3rd Prof',
          batchLabel: '(2023) BAMS 3rd Professional',
          sessionType: 'Practical (Lab Hours)',
          activityType: 'Clinical Ward',
          topicTaught: 'Vamana & Virechana Poorvakarma Snehana Assessment',
          entryMode: 'live',
          date: todayStr,
          startTime: '08:00',
          endTime: '11:00',
          durationHours: 3,
          room: 'Panchakarma Ward B',
          status: 'submitted',
          allowStudentSelfMark: false,
          checkInCode: '918273',
          presentCount: 3,
          lateCount: 1,
          absentCount: 0,
          totalStudents: batch23All.length,
          notes: 'Completed morning Vamana & Virechana OPD rounds.',
          staffUids,
        },
        records: batch23All.map((st, idx) => ({
          studentId: st.id,
          studentUid: st.uid,
          rollNumber: st.rollNumber,
          studentName: st.fullName,
          status: idx === 2 ? 'late' : 'present',
          creditedHours: idx === 2 ? 2 : 3,
          selfCheckedIn: false,
          checkInTime: idx === 2 ? '08:40' : '08:00',
          remarks: idx === 2 ? 'Clinical logbook late' : '',
          teacherUid: safeId(adminUid),
          staffUids,
        })),
      },
      {
        session: {
          id: 'sess_sub_102_yest',
          teacherUid: safeId(adminUid),
          teacherId: 't_pdf_003',
          teacherName: 'Dr. PALLAVI SAXENA',
          subjectId: 'sub_102',
          subjectCode: 'BAMS-KS-104',
          subjectName: 'Kriya Sharir',
          profYear: '1st Prof',
          batchLabel: '(2025) BAMS 1st Professional',
          sessionType: 'Theory (Class Hours)',
          activityType: 'Seminar',
          topicTaught: 'Tridosha Prakriti & Dhatu Poshana Nyaya Seminar',
          entryMode: 'paper_backup',
          date: yesterdayStr,
          startTime: '14:00',
          endTime: '16:00',
          durationHours: 2,
          room: 'Sushruta Hall 102',
          status: 'submitted',
          allowStudentSelfMark: false,
          checkInCode: '554120',
          presentCount: 5,
          lateCount: 1,
          absentCount: 0,
          totalStudents: batch25First6.length,
          notes: 'Updated from department paper backup sheet after campus fiber maintenance.',
          staffUids,
        },
        records: batch25First6.map((st, idx) => ({
          studentId: st.id,
          studentUid: st.uid,
          rollNumber: st.rollNumber,
          studentName: st.fullName,
          status: idx === 2 ? 'late' : 'present',
          creditedHours: idx === 2 ? 1.5 : 2,
          selfCheckedIn: false,
          checkInTime: idx === 2 ? '14:15' : '14:01',
          remarks: 'Paper Backup Sync',
          teacherUid: safeId(adminUid),
          staffUids,
        })),
      },
      {
        session: {
          id: 'sess_sub_301_2days',
          teacherUid: safeId(adminUid),
          teacherId: 't_pdf_012',
          teacherName: 'Dr. TRIPURA SAHU',
          subjectId: 'sub_301',
          subjectCode: 'BAMS-KC-301',
          subjectName: 'Kayachikitsa (Internal Medicine)',
          profYear: '3rd Prof',
          batchLabel: '(2023) BAMS 3rd Professional',
          sessionType: 'Practical (Lab Hours)',
          activityType: 'Clinical Ward',
          topicTaught: 'Jwara Chikitsa & Agni Deepana Case Presentations',
          entryMode: 'live',
          date: twoDaysAgoStr,
          startTime: '09:00',
          endTime: '12:00',
          durationHours: 3,
          room: 'Kayachikitsa OPD 1',
          status: 'submitted',
          allowStudentSelfMark: false,
          checkInCode: '312904',
          presentCount: 4,
          lateCount: 0,
          absentCount: 0,
          totalStudents: batch23All.length,
          notes: 'Full batch attendance in Jwara Chikitsa case presentation.',
          staffUids,
        },
        records: batch23All.map((st) => ({
          studentId: st.id,
          studentUid: st.uid,
          rollNumber: st.rollNumber,
          studentName: st.fullName,
          status: 'present',
          creditedHours: 3,
          selfCheckedIn: false,
          checkInTime: '09:00',
          remarks: '',
          teacherUid: safeId(adminUid),
          staffUids,
        })),
      },
    ];

    for (const item of sessionsToSeed) {
      await setDoc(doc(db, 'attendanceSessions', item.session.id), {
        ...item.session,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const recBatch = writeBatch(db);
      for (const r of item.records) {
        recBatch.set(doc(db, 'attendanceSessions', item.session.id, 'records', r.studentId), {
          ...r,
          updatedAt: serverTimestamp(),
        });
      }
      await recBatch.commit();
    }

    const existingMasterSnap = await getDoc(doc(db, 'masterConfig', INSTITUTION_ID));
    const existingMaster: Partial<MasterConfig> = existingMasterSnap.exists()
      ? (existingMasterSnap.data() as Partial<MasterConfig>)
      : {};

    await setDoc(doc(db, 'masterConfig', INSTITUTION_ID), {
      id: INSTITUTION_ID,
      institutionId: INSTITUTION_ID,
      sessionTypes: [...PDF_SESSION_TYPES],
      activityTypes: DEFAULT_ACTIVITY_TYPES,
      attendanceOptions: DEFAULT_ATTENDANCE_OPTIONS,
      profYears: DEFAULT_PROF_YEARS,
      departments: DEFAULT_DEPARTMENTS,
      customSections: existingMaster.customSections || [],
      customRoles: existingMaster.customRoles || [],
      profileMenuLinks: existingMaster.profileMenuLinks || [],
      profileHiddenTabs: existingMaster.profileHiddenTabs || [],
      timetableActive: existingMaster.timetableActive ?? false,
      timetableEntries: existingMaster.timetableEntries || [],
      geoFenceEnabled: existingMaster.geoFenceEnabled ?? false,
      campusLat: existingMaster.campusLat ?? 27.674,
      campusLng: existingMaster.campusLng ?? 79.558,
      campusRadiusMeters: existingMaster.campusRadiusMeters ?? 250,
      targetExamDate: existingMaster.targetExamDate || '',
      minAttendanceThreshold: existingMaster.minAttendanceThreshold ?? 75,
      updatedBy: clamp(adminName, VALIDATION_LIMITS.displayNameMax, 'Admin'),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'seedInstitutionalData');
  }
}

export async function createAttendanceSession(params: {
  teacherUid: string;
  teacher: TeacherProfile;
  teacherExistsInDb?: boolean;
  subject: Subject;
  batchLabel?: string;
  sessionType: SessionType;
  activityType: ActivityType;
  topicTaught: string;
  entryMode: EntryMode;
  date: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  room: string;
  allowStudentSelfMark: boolean;
  notes: string;
  students: StudentRecord[];
  initialStatusMap?: Record<string, StudentAttendanceStatus>;
  submitImmediately?: boolean;
  staffUids: string[];
  actorRole: UserRole;
  actorName: string;
}): Promise<{ sessionId: string; alertCount: number }> {
  const sessionId = safeId(`sess_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  const checkInCode = String(Math.floor(100000 + Math.random() * 900000));
  const mergedStaff = Array.from(new Set([...params.staffUids, params.teacherUid])).slice(
    0,
    VALIDATION_LIMITS.maxStaffList
  );
  const safeDuration = Math.min(8, Math.max(0.5, params.durationHours));

  const builtRecords: SessionStudentRecord[] = params.students.map((st) => {
    const status: StudentAttendanceStatus = params.initialStatusMap?.[st.id] || 'present';
    const creditedHours =
      status === 'present'
        ? safeDuration
        : status === 'late'
          ? Number((safeDuration * 0.5).toFixed(1))
          : 0;
    return {
      studentId: st.id,
      studentUid: st.uid,
      rollNumber: st.rollNumber,
      studentName: st.fullName,
      status,
      creditedHours,
      selfCheckedIn: false,
      checkInTime: status !== 'absent' ? clamp(params.startTime, 10, '09:00') : '',
      remarks: params.entryMode === 'paper_backup' ? 'Paper Backup Entry' : '',
      teacherUid: safeId(params.teacherUid),
      staffUids: mergedStaff,
    };
  });

  const presentCount = builtRecords.filter((r) => r.status === 'present').length;
  const lateCount = builtRecords.filter((r) => r.status === 'late').length;
  const absentCount = builtRecords.filter((r) => r.status === 'absent').length;

  const path = `attendanceSessions/${sessionId}`;
  try {
    const sessionDoc: Omit<AttendanceSession, 'createdAt' | 'updatedAt'> = {
      id: sessionId,
      teacherUid: safeId(params.teacherUid),
      teacherId: safeId(params.teacher.id),
      teacherName: clamp(params.teacher.fullName, VALIDATION_LIMITS.displayNameMax, 'Faculty'),
      subjectId: safeId(params.subject.id),
      subjectCode: clamp(params.subject.code, VALIDATION_LIMITS.subjectCodeMax, 'BAMS'),
      subjectName: clamp(params.subject.name, VALIDATION_LIMITS.subjectNameMax, 'BAMS Subject'),
      profYear: params.subject.profYear,
      ...(params.batchLabel ? { batchLabel: clamp(params.batchLabel, 60, '') } : {}),
      sessionType: clamp(params.sessionType, 80, 'Theory (Class Hours)'),
      activityType: clamp(params.activityType, 60, 'Regular Class'),
      topicTaught: clamp(params.topicTaught, VALIDATION_LIMITS.topicTaughtMax, ''),
      entryMode: params.entryMode,
      date: clamp(params.date, 20, new Date().toISOString().slice(0, 10)),
      startTime: clamp(params.startTime, 10, '09:00'),
      endTime: clamp(params.endTime, 10, '10:00'),
      durationHours: safeDuration,
      room: clamp(params.room, VALIDATION_LIMITS.roomMax, 'Lecture Hall'),
      status: 'draft',
      allowStudentSelfMark: params.submitImmediately ? false : params.allowStudentSelfMark,
      checkInCode,
      presentCount,
      lateCount,
      absentCount,
      totalStudents: builtRecords.length,
      notes: clamp(params.notes, VALIDATION_LIMITS.notesMax, ''),
      staffUids: mergedStaff,
    };

    await setDoc(doc(db, 'attendanceSessions', sessionId), {
      ...sessionDoc,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const batch = writeBatch(db);
    for (const rec of builtRecords) {
      const recRef = doc(db, 'attendanceSessions', sessionId, 'records', rec.studentId);
      batch.set(recRef, {
        ...rec,
        updatedAt: serverTimestamp(),
      });
    }

    if (params.teacherExistsInDb !== false) {
      batch.update(doc(db, 'teachers', params.teacher.id), {
        sessionsDraft: params.teacher.sessionsDraft + 1,
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();

    if (params.submitImmediately) {
      const studentsMap: Record<string, StudentRecord> = {};
      params.students.forEach((s) => {
        studentsMap[s.id] = s;
      });
      const alertCount = await submitSessionFinal({
        session: sessionDoc,
        records: builtRecords,
        notes: sessionDoc.notes,
        topicTaught: sessionDoc.topicTaught,
        activityType: sessionDoc.activityType,
        entryMode: sessionDoc.entryMode,
        studentsMap,
        subject: params.subject,
        teacher: params.teacherExistsInDb !== false ? params.teacher : undefined,
        actorUid: params.teacherUid,
        actorName: params.actorName,
        actorRole: params.actorRole,
      });
      return { sessionId, alertCount };
    }

    await logInteraction({
      actorUid: params.teacherUid,
      actorName: params.actorName,
      actorRole: params.actorRole,
      actionType: 'draft_saved',
      label: `Opened ${params.subject.code} (${safeDuration}h · ${params.sessionType}) draft`,
      staffUids: mergedStaff,
    });

    return { sessionId, alertCount: 0 };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function saveSessionDraft(params: {
  session: AttendanceSession;
  records: SessionStudentRecord[];
  notes: string;
  topicTaught: string;
  activityType: ActivityType;
  entryMode: EntryMode;
  allowStudentSelfMark: boolean;
  actorUid: string;
  actorName: string;
  actorRole: UserRole;
}): Promise<void> {
  const path = `attendanceSessions/${params.session.id}`;
  try {
    const presentCount = params.records.filter((r) => r.status === 'present').length;
    const lateCount = params.records.filter((r) => r.status === 'late').length;
    const absentCount = params.records.filter((r) => r.status === 'absent').length;

    const batch = writeBatch(db);
    for (const rec of params.records) {
      batch.update(doc(db, 'attendanceSessions', params.session.id, 'records', rec.studentId), {
        status: rec.status,
        creditedHours: rec.creditedHours,
        selfCheckedIn: rec.selfCheckedIn,
        checkInTime: clamp(rec.checkInTime, 20, ''),
        remarks: clamp(rec.remarks, VALIDATION_LIMITS.remarksMax, ''),
        updatedAt: serverTimestamp(),
      });
    }

    batch.update(doc(db, 'attendanceSessions', params.session.id), {
      presentCount,
      lateCount,
      absentCount,
      totalStudents: params.records.length,
      allowStudentSelfMark: params.allowStudentSelfMark,
      topicTaught: clamp(params.topicTaught, VALIDATION_LIMITS.topicTaughtMax, ''),
      activityType: params.activityType,
      entryMode: params.entryMode,
      notes: clamp(params.notes, VALIDATION_LIMITS.notesMax, ''),
      updatedAt: serverTimestamp(),
    });

    await batch.commit();

    await logInteraction({
      actorUid: params.actorUid,
      actorName: params.actorName,
      actorRole: params.actorRole,
      actionType: 'draft_saved',
      label: `Updated draft ${params.session.subjectCode} (${presentCount}P · ${lateCount}L · ${absentCount}A)`,
      staffUids: params.session.staffUids,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function submitSessionFinal(params: {
  session: AttendanceSession;
  records: SessionStudentRecord[];
  notes: string;
  topicTaught: string;
  activityType: ActivityType;
  entryMode: EntryMode;
  studentsMap: Record<string, StudentRecord>;
  subject: Subject | undefined;
  teacher: TeacherProfile | undefined;
  actorUid: string;
  actorName: string;
  actorRole: UserRole;
}): Promise<number> {
  const path = `attendanceSessions/${params.session.id}`;
  try {
    const presentCount = params.records.filter((r) => r.status === 'present').length;
    const lateCount = params.records.filter((r) => r.status === 'late').length;
    const absentCount = params.records.filter((r) => r.status === 'absent').length;
    const duration = params.session.durationHours;
    const isTheory = isTheorySessionType(params.session.sessionType);

    const batch = writeBatch(db);
    let generatedAlerts = 0;

    for (const rec of params.records) {
      batch.update(doc(db, 'attendanceSessions', params.session.id, 'records', rec.studentId), {
        status: rec.status,
        creditedHours: rec.creditedHours,
        selfCheckedIn: rec.selfCheckedIn,
        checkInTime: clamp(rec.checkInTime, 20, ''),
        remarks: clamp(rec.remarks, VALIDATION_LIMITS.remarksMax, ''),
        updatedAt: serverTimestamp(),
      });

      const stu = params.studentsMap[rec.studentId];
      if (stu) {
        const newScheduled = stu.totalHoursScheduled + duration;
        const newAttended = Number((stu.totalHoursAttended + rec.creditedHours).toFixed(1));
        const newTheory = isTheory
          ? Number((stu.theoryHoursAttended + rec.creditedHours).toFixed(1))
          : stu.theoryHoursAttended;
        const newPractical = !isTheory
          ? Number((stu.practicalHoursAttended + rec.creditedHours).toFixed(1))
          : stu.practicalHoursAttended;
        const newPercent =
          newScheduled > 0 ? Number(((newAttended / newScheduled) * 100).toFixed(1)) : 100;
        const newConsecutive = rec.status === 'absent' ? stu.consecutiveAbsences + 1 : 0;
        const newStanding = computeStanding(newPercent, newConsecutive);

        batch.update(doc(db, 'students', stu.id), {
          totalHoursScheduled: newScheduled,
          totalHoursAttended: newAttended,
          theoryHoursAttended: newTheory,
          practicalHoursAttended: newPractical,
          attendancePercent: Math.min(100, newPercent),
          consecutiveAbsences: newConsecutive,
          standing: newStanding,
          updatedAt: serverTimestamp(),
        });

        if (rec.status === 'absent' && (newPercent < 75 || newConsecutive >= 2)) {
          generatedAlerts += 1;
          const alertId = safeId(`alt_${stu.id}_${Date.now()}`);
          batch.set(doc(db, 'alerts', alertId), {
            id: alertId,
            type: newConsecutive >= 2 ? 'consecutive_absence' : 'low_attendance',
            severity: newStanding === 'critical' ? 'critical' : 'warning',
            targetStudentId: stu.id,
            targetStudentUid: stu.uid,
            targetName: stu.fullName,
            profYear: stu.profYear,
            subjectCode: params.session.subjectCode,
            attendancePercent: Math.min(100, newPercent),
            message: clamp(
              `${stu.fullName} (${stu.rollNumber}) marked absent in ${params.session.subjectCode}. Cumulative attendance now ${newPercent}% (${newConsecutive} consecutive).`,
              VALIDATION_LIMITS.alertMessageMax,
              'Low attendance alert'
            ),
            resolved: false,
            resolvedBy: '',
            staffUids: params.session.staffUids,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }
    }

    batch.update(doc(db, 'attendanceSessions', params.session.id), {
      status: 'submitted',
      allowStudentSelfMark: false,
      presentCount,
      lateCount,
      absentCount,
      totalStudents: params.records.length,
      topicTaught: clamp(params.topicTaught, VALIDATION_LIMITS.topicTaughtMax, ''),
      activityType: params.activityType,
      entryMode: params.entryMode,
      notes: clamp(params.notes, VALIDATION_LIMITS.notesMax, ''),
      updatedAt: serverTimestamp(),
    });

    if (params.subject) {
      batch.update(doc(db, 'subjects', params.subject.id), {
        deliveredHours: Number((params.subject.deliveredHours + duration).toFixed(1)),
        updatedAt: serverTimestamp(),
      });
    }

    if (params.teacher) {
      const sessionPct =
        params.records.length > 0
          ? ((presentCount + lateCount * 0.75) / params.records.length) * 100
          : params.teacher.avgAttendanceRate;
      const newAvg = Number(((params.teacher.avgAttendanceRate * 4 + sessionPct) / 5).toFixed(1));
      batch.update(doc(db, 'teachers', params.teacher.id), {
        sessionsSubmitted: params.teacher.sessionsSubmitted + 1,
        sessionsDraft: Math.max(0, params.teacher.sessionsDraft - 1),
        avgAttendanceRate: Math.min(100, newAvg),
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();

    await logInteraction({
      actorUid: params.actorUid,
      actorName: params.actorName,
      actorRole: params.actorRole,
      actionType: 'session_submitted',
      label: `Finalized ${params.session.subjectCode} (${duration}h) · ${presentCount + lateCount}/${params.records.length} attended`,
      staffUids: params.session.staffUids,
    });

    return generatedAlerts;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function adminCorrectSubmittedRecord(params: {
  session: AttendanceSession;
  records: SessionStudentRecord[];
  targetRecord: SessionStudentRecord;
  newStatus: StudentAttendanceStatus;
  newCreditedHours: number;
  correctionReason: string;
  student: StudentRecord | undefined;
  actorUid: string;
  actorName: string;
  actorRole: UserRole;
}): Promise<void> {
  const path = `attendanceSessions/${params.session.id}/records/${params.targetRecord.studentId}`;
  try {
    const updatedRecords = params.records.map((r) =>
      r.studentId === params.targetRecord.studentId
        ? {
            ...r,
            status: params.newStatus,
            creditedHours: params.newCreditedHours,
            remarks: clamp(`Audit Correction: ${params.correctionReason}`, VALIDATION_LIMITS.remarksMax, 'Corrected'),
          }
        : r
    );
    const presentCount = updatedRecords.filter((r) => r.status === 'present').length;
    const lateCount = updatedRecords.filter((r) => r.status === 'late').length;
    const absentCount = updatedRecords.filter((r) => r.status === 'absent').length;

    const batch = writeBatch(db);
    batch.update(doc(db, 'attendanceSessions', params.session.id, 'records', params.targetRecord.studentId), {
      status: params.newStatus,
      creditedHours: params.newCreditedHours,
      remarks: clamp(`Audit Correction: ${params.correctionReason}`, VALIDATION_LIMITS.remarksMax, 'Corrected'),
      updatedAt: serverTimestamp(),
    });

    batch.update(doc(db, 'attendanceSessions', params.session.id), {
      presentCount,
      lateCount,
      absentCount,
      updatedAt: serverTimestamp(),
    });

    if (params.student) {
      const delta = params.newCreditedHours - params.targetRecord.creditedHours;
      const nextAttended = Math.max(
        0,
        Number((params.student.totalHoursAttended + delta).toFixed(1))
      );
      const nextPct =
        params.student.totalHoursScheduled > 0
          ? Math.min(100, Number(((nextAttended / params.student.totalHoursScheduled) * 100).toFixed(1)))
          : 100;
      const isTheory = isTheorySessionType(params.session.sessionType);
      batch.update(doc(db, 'students', params.student.id), {
        totalHoursAttended: nextAttended,
        theoryHoursAttended: isTheory
          ? Math.max(0, Number((params.student.theoryHoursAttended + delta).toFixed(1)))
          : params.student.theoryHoursAttended,
        practicalHoursAttended: !isTheory
          ? Math.max(0, Number((params.student.practicalHoursAttended + delta).toFixed(1)))
          : params.student.practicalHoursAttended,
        attendancePercent: nextPct,
        standing: computeStanding(nextPct, params.student.consecutiveAbsences),
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();

    await logInteraction({
      actorUid: params.actorUid,
      actorName: params.actorName,
      actorRole: params.actorRole,
      actionType: 'correction_audit',
      label: `Audit correction on ${params.session.subjectCode} for ${params.targetRecord.studentName}: ${params.targetRecord.status} -> ${params.newStatus} (${params.correctionReason})`,
      staffUids: params.session.staffUids,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function submitStudentCheckIn(params: {
  session: AttendanceSession;
  uid: string;
  studentId: string;
  rollNumber: string;
  studentName: string;
  codeInput: string;
}): Promise<void> {
  const path = `attendanceSessions/${params.session.id}/checkIns/${params.uid}`;
  try {
    await setDoc(doc(db, 'attendanceSessions', params.session.id, 'checkIns', params.uid), {
      uid: safeId(params.uid),
      studentId: safeId(params.studentId),
      rollNumber: clamp(params.rollNumber, 32, 'BAMS'),
      studentName: clamp(params.studentName, VALIDATION_LIMITS.displayNameMax, 'Student'),
      checkInCode: clamp(params.codeInput, VALIDATION_LIMITS.checkInCodeMax, ''),
      teacherUid: params.session.teacherUid,
      staffUids: params.session.staffUids,
      checkedInAt: serverTimestamp(),
    });

    await logInteraction({
      actorUid: params.uid,
      actorName: params.studentName,
      actorRole: 'student',
      actionType: 'student_checkin',
      label: `Student self check-in for ${params.session.subjectCode} (${params.session.room})`,
      staffUids: params.session.staffUids,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function resolveAlert(params: {
  alert: AttendanceAlert;
  actorUid: string;
  actorName: string;
  actorRole: UserRole;
}): Promise<void> {
  const path = `alerts/${params.alert.id}`;
  try {
    await updateDoc(doc(db, 'alerts', params.alert.id), {
      resolved: true,
      resolvedBy: clamp(params.actorName, VALIDATION_LIMITS.displayNameMax, 'Staff'),
      updatedAt: serverTimestamp(),
    });

    await logInteraction({
      actorUid: params.actorUid,
      actorName: params.actorName,
      actorRole: params.actorRole,
      actionType: 'alert_resolved',
      label: `Resolved ${params.alert.severity} alert for ${params.alert.targetName}`,
      staffUids: params.alert.staffUids,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateTeacherProfile(
  teacherId: string,
  updates: { officeHours: string; bio: string }
): Promise<void> {
  const path = `teachers/${teacherId}`;
  try {
    await updateDoc(doc(db, 'teachers', teacherId), {
      officeHours: clamp(updates.officeHours, VALIDATION_LIMITS.officeHoursMax, ''),
      bio: clamp(updates.bio, VALIDATION_LIMITS.bioMax, ''),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function publishLearningResource(params: {
  title: string;
  category: ResourceCategory;
  profYear: ProfYear | 'All';
  subjectCode: string;
  description: string;
  scoreSummary: string;
  authorUid: string;
  authorName: string;
  authorRole: UserRole;
  staffUids: string[];
}): Promise<void> {
  const id = safeId(`res_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`);
  const path = `learningResources/${id}`;
  try {
    await setDoc(doc(db, 'learningResources', id), {
      id,
      title: clamp(params.title, VALIDATION_LIMITS.resourceTitleMax, 'Study Resource'),
      category: params.category,
      profYear: params.profYear,
      subjectCode: clamp(params.subjectCode, VALIDATION_LIMITS.subjectCodeMax, 'BAMS'),
      description: clamp(params.description, VALIDATION_LIMITS.resourceDescMax, ''),
      scoreSummary: clamp(params.scoreSummary, VALIDATION_LIMITS.scoreSummaryMax, ''),
      authorUid: safeId(params.authorUid),
      authorName: clamp(params.authorName, VALIDATION_LIMITS.displayNameMax, 'Faculty'),
      institutionId: INSTITUTION_ID,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await logInteraction({
      actorUid: params.authorUid,
      actorName: params.authorName,
      actorRole: params.authorRole,
      actionType: 'resource_published',
      label: `Published ${params.category}: ${params.title}`,
      staffUids: params.staffUids,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function submitFeedback(params: {
  authorUid: string;
  authorName: string;
  authorRole: UserRole;
  category: FeedbackCategory;
  message: string;
  staffUids: string[];
}): Promise<void> {
  const id = safeId(`fb_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`);
  const path = `feedbackItems/${id}`;
  try {
    await setDoc(doc(db, 'feedbackItems', id), {
      id,
      authorUid: safeId(params.authorUid),
      authorName: clamp(params.authorName, VALIDATION_LIMITS.displayNameMax, 'Member'),
      authorRole: params.authorRole,
      category: params.category,
      message: clamp(params.message, VALIDATION_LIMITS.feedbackMsgMax, ''),
      status: 'submitted',
      staffUids: params.staffUids.slice(0, VALIDATION_LIMITS.maxStaffList),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await logInteraction({
      actorUid: params.authorUid,
      actorName: params.authorName,
      actorRole: params.authorRole,
      actionType: 'feedback_submitted',
      label: `Submitted ${params.category} feedback suggestion`,
      staffUids: params.staffUids,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateFeedbackStatus(
  feedbackId: string,
  status: FeedbackStatus
): Promise<void> {
  const path = `feedbackItems/${feedbackId}`;
  try {
    await updateDoc(doc(db, 'feedbackItems', feedbackId), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function adminApproveRequest(params: {
  targetUser: UserProfile;
  approvedRole: UserRole;
  permissions?: PermissionKey[];
  overrideRollOrEmpId?: string;
  customRoleId?: string;
  customRoleName?: string;
  regenerateCode?: boolean;
  actorUid: string;
  actorName: string;
  allStaffUids: string[];
}): Promise<{ accessCode: string }> {
  const path = `users/${params.targetUser.uid}`;
  try {
    const newProfYear: UserProfYear =
      params.approvedRole === 'admin' || params.approvedRole === 'co_admin'
        ? 'Administration'
        : params.approvedRole === 'principal' || params.approvedRole === 'teacher'
          ? 'Faculty'
          : params.approvedRole === 'parent'
            ? 'Parent'
            : params.targetUser.profYear === 'Faculty' ||
                params.targetUser.profYear === 'Administration' ||
                params.targetUser.profYear === 'Parent'
              ? '1st Prof'
              : params.targetUser.profYear;

    const assignedPermissions =
      params.permissions && params.permissions.length > 0
        ? params.permissions
        : DEFAULT_ROLE_PERMISSIONS[params.approvedRole];

    const accessCode =
      params.approvedRole === 'admin'
        ? 'ADMIN'
        : !params.regenerateCode && params.targetUser.accessCode
          ? params.targetUser.accessCode
          : generateAccessCode();

    const rawRollOrEmp =
      params.overrideRollOrEmpId !== undefined
        ? params.overrideRollOrEmpId
        : params.targetUser.rollOrEmpId || '';
    const resolvedRollOrEmp =
      params.approvedRole === 'student' || params.approvedRole === 'parent'
        ? clamp(rawRollOrEmp.toUpperCase(), VALIDATION_LIMITS.rollOrEmpIdMax, '')
        : clamp(rawRollOrEmp, VALIDATION_LIMITS.rollOrEmpIdMax, '');

    await updateDoc(doc(db, 'users', params.targetUser.uid), {
      role: params.approvedRole,
      approvalStatus: 'active',
      permissions: assignedPermissions,
      accessCode,
      accessCodeVerified: params.approvedRole === 'admin',
      profYear: newProfYear,
      rollOrEmpId: resolvedRollOrEmp,
      customRoleId: clamp(params.customRoleId ?? params.targetUser.customRoleId ?? '', 64, ''),
      customRoleName: clamp(params.customRoleName ?? params.targetUser.customRoleName ?? '', 64, ''),
      updatedAt: serverTimestamp(),
    });

    if (params.approvedRole === 'admin') {
      await setDoc(doc(db, 'admins', params.targetUser.uid), {
        uid: params.targetUser.uid,
        createdAt: serverTimestamp(),
      });
    }

    if (
      params.approvedRole === 'principal' ||
      params.approvedRole === 'teacher' ||
      params.approvedRole === 'co_admin' ||
      params.approvedRole === 'admin'
    ) {
      const nextStaff = Array.from(new Set([...params.allStaffUids, params.targetUser.uid])).slice(
        0,
        VALIDATION_LIMITS.maxStaffList
      );
      const [studentsSnap, sessionsSnap, alertsSnap, fbSnap] = await Promise.all([
        getDocs(collection(db, 'students')),
        getDocs(collection(db, 'attendanceSessions')),
        getDocs(collection(db, 'alerts')),
        getDocs(collection(db, 'feedbackItems')),
      ]);
      const allRefs = [
        ...studentsSnap.docs.map((d) => d.ref),
        ...sessionsSnap.docs.map((d) => d.ref),
        ...alertsSnap.docs.map((d) => d.ref),
        ...fbSnap.docs.map((d) => d.ref),
      ];
      for (let i = 0; i < allRefs.length; i += 350) {
        const batch = writeBatch(db);
        allRefs.slice(i, i + 350).forEach((ref) =>
          batch.update(ref, { staffUids: nextStaff, updatedAt: serverTimestamp() })
        );
        await batch.commit();
      }

      if (params.approvedRole === 'teacher' || params.approvedRole === 'principal') {
        const existingTeacher = await getDocs(
          query(collection(db, 'teachers'), where('ownerUid', '==', params.targetUser.uid))
        );
        if (existingTeacher.empty) {
          const teacherId = safeId(`t_${params.targetUser.uid}`);
          await setDoc(doc(db, 'teachers', teacherId), {
            id: teacherId,
            ownerUid: safeId(params.targetUser.uid),
            fullName: clamp(
              params.targetUser.displayName,
              VALIDATION_LIMITS.displayNameMax,
              'BAMS Faculty'
            ),
            designation:
              params.approvedRole === 'principal' ? 'Principal & Professor' : 'Assistant Professor',
            department: clamp(
              params.targetUser.department || 'Ayurveda Samhita',
              VALIDATION_LIMITS.departmentMax,
              'Ayurveda Samhita'
            ),
            qualification: 'BAMS, MD (Ayurveda)',
            employeeCode: clamp(
              params.targetUser.rollOrEmpId || `FAC-${params.targetUser.uid.slice(0, 5).toUpperCase()}`,
              VALIDATION_LIMITS.employeeCodeMax,
              'FAC-BAMS'
            ),
            officeHours: 'Mon–Sat · 10:00–13:00',
            bio: 'Approved BAMS faculty profile on the SSPSAMCH Academic Portal.',
            avatarUrl: clamp(params.targetUser.avatarUrl || '', VALIDATION_LIMITS.avatarUrlMax, ''),
            assignedSubjects: [],
            weeklyHours: 12,
            sessionsSubmitted: 0,
            sessionsDraft: 0,
            avgAttendanceRate: 85,
            institutionId: INSTITUTION_ID,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }
    }

    if (params.approvedRole === 'student') {
      const prof: ProfYear =
        newProfYear === 'Faculty' || newProfYear === 'Administration' || newProfYear === 'Parent'
          ? '1st Prof'
          : newProfYear;
      await adminEnrollStudent({
        uid: params.targetUser.uid,
        fullName: params.targetUser.displayName,
        rollNumber:
          resolvedRollOrEmp || `BAMS-${params.targetUser.uid.slice(0, 5).toUpperCase()}`,
        profYear: prof,
        batch: prof === '1st Prof' ? 'Batch 2025' : prof === '2nd Prof' ? 'Batch 2024' : 'Batch 2023',
        staffUids: params.allStaffUids,
      });
    }

    await logInteraction({
      actorUid: params.actorUid,
      actorName: params.actorName,
      actorRole: 'admin',
      actionType: 'role_updated',
      label: `Verified ${params.targetUser.displayName} as ${params.customRoleName || params.approvedRole} (${assignedPermissions.length} permissions)`,
      staffUids: params.allStaffUids,
    });

    return { accessCode };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function adminRejectRequest(params: {
  targetUser: UserProfile;
  actorUid: string;
  actorName: string;
  allStaffUids: string[];
}): Promise<void> {
  const path = `users/${params.targetUser.uid}`;
  try {
    await updateDoc(doc(db, 'users', params.targetUser.uid), {
      role: 'student',
      approvalStatus: 'rejected',
      permissions: [],
      accessCode: '',
      accessCodeVerified: false,
      updatedAt: serverTimestamp(),
    });

    await logInteraction({
      actorUid: params.actorUid,
      actorName: params.actorName,
      actorRole: 'admin',
      actionType: 'request_rejected',
      label: `Rejected portal access request for ${params.targetUser.displayName} (${params.targetUser.requestedRole})`,
      staffUids: params.allStaffUids,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function adminBlockUser(params: {
  targetUser: UserProfile;
  actorUid: string;
  actorName: string;
  allStaffUids: string[];
}): Promise<void> {
  const path = `users/${params.targetUser.uid}`;
  if (params.targetUser.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL) {
    throw new Error('Primary institutional Admin account cannot be blocked.');
  }
  try {
    await updateDoc(doc(db, 'users', params.targetUser.uid), {
      approvalStatus: 'blocked',
      accessCodeVerified: false,
      updatedAt: serverTimestamp(),
    });

    if (params.targetUser.email) {
      const invId = emailToInviteId(params.targetUser.email);
      const invRef = doc(db, 'accessInvites', invId);
      const invSnap = await getDoc(invRef);
      if (invSnap.exists()) {
        await updateDoc(invRef, {
          status: 'revoked',
          updatedAt: serverTimestamp(),
        });
      }
    }

    await logInteraction({
      actorUid: params.actorUid,
      actorName: params.actorName,
      actorRole: 'admin',
      actionType: 'user_blocked',
      label: `Blocked email access for ${params.targetUser.displayName} (${params.targetUser.email})`,
      staffUids: params.allStaffUids,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function adminUnblockUser(params: {
  targetUser: UserProfile;
  actorUid: string;
  actorName: string;
  allStaffUids: string[];
}): Promise<void> {
  const path = `users/${params.targetUser.uid}`;
  try {
    await updateDoc(doc(db, 'users', params.targetUser.uid), {
      approvalStatus: 'active',
      accessCodeVerified: true,
      updatedAt: serverTimestamp(),
    });

    if (params.targetUser.email) {
      const invId = emailToInviteId(params.targetUser.email);
      const invRef = doc(db, 'accessInvites', invId);
      const invSnap = await getDoc(invRef);
      if (invSnap.exists()) {
        await updateDoc(invRef, {
          status: 'claimed',
          updatedAt: serverTimestamp(),
        });
      }
    }

    await logInteraction({
      actorUid: params.actorUid,
      actorName: params.actorName,
      actorRole: 'admin',
      actionType: 'user_unblocked',
      label: `Unblocked portal access for ${params.targetUser.displayName} (${params.targetUser.email})`,
      staffUids: params.allStaffUids,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function adminUpdateUserPermissions(params: {
  targetUser: UserProfile;
  permissions: PermissionKey[];
  actorUid: string;
  actorName: string;
  allStaffUids: string[];
}): Promise<void> {
  const path = `users/${params.targetUser.uid}`;
  try {
    await updateDoc(doc(db, 'users', params.targetUser.uid), {
      permissions: params.permissions.slice(0, 15),
      updatedAt: serverTimestamp(),
    });
    await logInteraction({
      actorUid: params.actorUid,
      actorName: params.actorName,
      actorRole: 'admin',
      actionType: 'role_updated',
      label: `Updated permissions checklist for ${params.targetUser.displayName}`,
      staffUids: params.allStaffUids,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function adminRegenerateAccessCode(params: {
  targetUser: UserProfile;
  actorUid: string;
  actorName: string;
  allStaffUids: string[];
}): Promise<string> {
  const path = `users/${params.targetUser.uid}`;
  try {
    const newCode = generateAccessCode();
    await updateDoc(doc(db, 'users', params.targetUser.uid), {
      accessCode: newCode,
      accessCodeVerified: false,
      updatedAt: serverTimestamp(),
    });
    await logInteraction({
      actorUid: params.actorUid,
      actorName: params.actorName,
      actorRole: 'admin',
      actionType: 'role_updated',
      label: `Generated new access code for ${params.targetUser.displayName}`,
      staffUids: params.allStaffUids,
    });
    return newCode;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function adminCreateAccessInvite(params: {
  email: string;
  displayName: string;
  role: Exclude<UserRole, 'admin'>;
  profYear: string;
  department: string;
  rollOrEmpId: string;
  permissions: PermissionKey[];
  customRoleId?: string;
  customRoleName?: string;
  existingUsers: UserProfile[];
  actorUid: string;
  actorName: string;
  allStaffUids: string[];
}): Promise<{ accessCode: string; alreadyRegistered: boolean }> {
  const emailLower = params.email.trim().toLowerCase();
  const id = emailToInviteId(emailLower);
  const path = `accessInvites/${id}`;
  try {
    const existingMember = params.existingUsers.find(
      (u) => u.email?.toLowerCase() === emailLower
    );

    const normalizedInviteId =
      params.role === 'student' || params.role === 'parent'
        ? params.rollOrEmpId.trim().toUpperCase()
        : params.rollOrEmpId.trim();

    if (existingMember) {
      const { accessCode } = await adminApproveRequest({
        targetUser: existingMember,
        approvedRole: params.role,
        permissions: params.permissions,
        overrideRollOrEmpId: normalizedInviteId || existingMember.rollOrEmpId,
        customRoleId: params.customRoleId,
        customRoleName: params.customRoleName,
        regenerateCode: true,
        actorUid: params.actorUid,
        actorName: params.actorName,
        allStaffUids: params.allStaffUids,
      });
      return { accessCode, alreadyRegistered: true };
    }

    const accessCode = generateAccessCode();
    await setDoc(doc(db, 'accessInvites', id), {
      id,
      email: clamp(emailLower, VALIDATION_LIMITS.emailMax, emailLower),
      displayName: clamp(
        params.displayName || emailLower.split('@')[0],
        VALIDATION_LIMITS.displayNameMax,
        'College Member'
      ),
      role: params.role,
      profYear: clamp(params.profYear, 40, '1st Prof'),
      department: clamp(params.department, VALIDATION_LIMITS.departmentMax, 'BAMS'),
      rollOrEmpId: clamp(normalizedInviteId, VALIDATION_LIMITS.rollOrEmpIdMax, ''),
      permissions: params.permissions.slice(0, 15),
      accessCode,
      status: 'invited',
      ...(params.customRoleId ? { customRoleId: clamp(params.customRoleId, 64, '') } : {}),
      ...(params.customRoleName ? { customRoleName: clamp(params.customRoleName, 64, '') } : {}),
      createdByUid: safeId(params.actorUid),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await logInteraction({
      actorUid: params.actorUid,
      actorName: params.actorName,
      actorRole: 'admin',
      actionType: 'invite_created',
      label: `Pre-added ${emailLower} as ${params.customRoleName || params.role} with auto access password`,
      staffUids: params.allStaffUids,
    });

    return { accessCode, alreadyRegistered: false };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function adminDeleteAccessInvite(inviteId: string): Promise<void> {
  const path = `accessInvites/${inviteId}`;
  try {
    await deleteDoc(doc(db, 'accessInvites', inviteId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveMasterConfig(params: {
  sessionTypes: string[];
  activityTypes: string[];
  attendanceOptions: string[];
  profYears: string[];
  departments: string[];
  customSections?: CustomMasterSection[];
  customRoles?: CustomRoleDef[];
  profileMenuLinks?: ProfileMenuLink[];
  profileHiddenTabs?: string[];
  timetableActive?: boolean;
  timetableEntries?: TimetableEntry[];
  geoFenceEnabled?: boolean;
  campusLat?: number;
  campusLng?: number;
  campusRadiusMeters?: number;
  targetExamDate?: string;
  minAttendanceThreshold: number;
  actorUid: string;
  actorName: string;
  staffUids: string[];
}): Promise<void> {
  const path = `masterConfig/${INSTITUTION_ID}`;
  try {
    const existingSnap = await getDoc(doc(db, 'masterConfig', INSTITUTION_ID));
    const existing: Partial<MasterConfig> = existingSnap.exists()
      ? (existingSnap.data() as Partial<MasterConfig>)
      : {};

    await setDoc(doc(db, 'masterConfig', INSTITUTION_ID), {
      id: INSTITUTION_ID,
      institutionId: INSTITUTION_ID,
      sessionTypes: params.sessionTypes.slice(0, 25),
      activityTypes: params.activityTypes.slice(0, 25),
      attendanceOptions: params.attendanceOptions.slice(0, 20),
      profYears: params.profYears.slice(0, 15),
      departments: params.departments.slice(0, 30),
      customSections: (params.customSections || []).slice(0, 20),
      customRoles: (params.customRoles || []).slice(0, 15),
      profileMenuLinks: (params.profileMenuLinks || []).slice(0, 40).map((lnk) => ({
        id: lnk.id,
        role: lnk.role,
        label: lnk.label,
        targetType: lnk.targetType,
        ...(lnk.url ? { url: lnk.url } : {}),
        ...(lnk.tabId ? { tabId: lnk.tabId } : {}),
      })),
      profileHiddenTabs: (params.profileHiddenTabs || []).slice(0, 40),
      timetableActive: params.timetableActive ?? existing.timetableActive ?? false,
      timetableEntries: (params.timetableEntries ?? existing.timetableEntries ?? []).slice(0, 120),
      geoFenceEnabled: params.geoFenceEnabled ?? existing.geoFenceEnabled ?? false,
      campusLat: params.campusLat ?? existing.campusLat ?? 27.674,
      campusLng: params.campusLng ?? existing.campusLng ?? 79.558,
      campusRadiusMeters: Math.min(
        5000,
        Math.max(50, params.campusRadiusMeters ?? existing.campusRadiusMeters ?? 250)
      ),
      targetExamDate: clamp(params.targetExamDate ?? existing.targetExamDate ?? '', 20, ''),
      minAttendanceThreshold: Math.min(100, Math.max(50, params.minAttendanceThreshold)),
      updatedBy: clamp(params.actorName, VALIDATION_LIMITS.displayNameMax, 'Admin'),
      updatedAt: serverTimestamp(),
    });

    await logInteraction({
      actorUid: params.actorUid,
      actorName: params.actorName,
      actorRole: 'admin',
      actionType: 'master_updated',
      label: 'Updated Master Data configuration (Menu Links, Custom Roles, Prof years & Smart Settings)',
      staffUids: params.staffUids,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function saveSmartMasterSettings(params: {
  timetableActive?: boolean;
  timetableEntries?: TimetableEntry[];
  geoFenceEnabled?: boolean;
  campusLat?: number;
  campusLng?: number;
  campusRadiusMeters?: number;
  targetExamDate?: string;
  actorUid: string;
  actorName: string;
  staffUids: string[];
  auditLabel?: string;
}): Promise<void> {
  const path = `masterConfig/${INSTITUTION_ID}`;
  try {
    const ref = doc(db, 'masterConfig', INSTITUTION_ID);
    const snap = await getDoc(ref);
    const patch: Record<string, unknown> = {
      updatedBy: clamp(params.actorName, VALIDATION_LIMITS.displayNameMax, 'Admin'),
      updatedAt: serverTimestamp(),
    };
    if (params.timetableActive !== undefined) patch.timetableActive = params.timetableActive;
    if (params.timetableEntries !== undefined) {
      patch.timetableEntries = params.timetableEntries.slice(0, 120);
    }
    if (params.geoFenceEnabled !== undefined) patch.geoFenceEnabled = params.geoFenceEnabled;
    if (params.campusLat !== undefined) {
      patch.campusLat = Math.min(90, Math.max(-90, Number(params.campusLat)));
    }
    if (params.campusLng !== undefined) {
      patch.campusLng = Math.min(180, Math.max(-180, Number(params.campusLng)));
    }
    if (params.campusRadiusMeters !== undefined) {
      patch.campusRadiusMeters = Math.min(5000, Math.max(50, Math.round(params.campusRadiusMeters)));
    }
    if (params.targetExamDate !== undefined) {
      patch.targetExamDate = clamp(params.targetExamDate, 20, '');
    }

    if (snap.exists()) {
      await updateDoc(ref, patch);
    } else {
      await setDoc(ref, {
        id: INSTITUTION_ID,
        institutionId: INSTITUTION_ID,
        sessionTypes: [...PDF_SESSION_TYPES],
        activityTypes: DEFAULT_ACTIVITY_TYPES,
        attendanceOptions: DEFAULT_ATTENDANCE_OPTIONS,
        profYears: DEFAULT_PROF_YEARS,
        departments: DEFAULT_DEPARTMENTS,
        customSections: [],
        customRoles: [],
        profileMenuLinks: [],
        profileHiddenTabs: [],
        minAttendanceThreshold: 75,
        timetableActive: params.timetableActive ?? false,
        timetableEntries: (params.timetableEntries || []).slice(0, 120),
        geoFenceEnabled: params.geoFenceEnabled ?? false,
        campusLat: params.campusLat ?? 27.674,
        campusLng: params.campusLng ?? 79.558,
        campusRadiusMeters: params.campusRadiusMeters ?? 250,
        targetExamDate: params.targetExamDate || '',
        ...patch,
      });
    }

    await logInteraction({
      actorUid: params.actorUid,
      actorName: params.actorName,
      actorRole: 'admin',
      actionType: 'master_updated',
      label: clamp(params.auditLabel || 'Updated Smart Campus Settings', VALIDATION_LIMITS.logLabelMax, 'Updated Smart Campus Settings'),
      staffUids: params.staffUids,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function adminCreateSubject(params: {
  code: string;
  name: string;
  department: string;
  profYear: ProfYear;
  requiredTheoryHours: number;
  requiredPracticalHours: number;
  teacher: TeacherProfile;
  actorUid: string;
  actorName: string;
  staffUids: string[];
}): Promise<void> {
  const id = safeId(`sub_${params.code}_${Date.now().toString(36)}`);
  const path = `subjects/${id}`;
  try {
    await setDoc(doc(db, 'subjects', id), {
      id,
      code: clamp(params.code.toUpperCase(), VALIDATION_LIMITS.subjectCodeMax, 'BAMS-NEW'),
      name: clamp(params.name, VALIDATION_LIMITS.subjectNameMax, 'Ayurvedic Subject'),
      department: clamp(params.department, VALIDATION_LIMITS.departmentMax, 'Ayurveda Samhita'),
      profYear: clamp(params.profYear, 40, '1st Prof'),
      requiredTheoryHours: Math.max(0, params.requiredTheoryHours),
      requiredPracticalHours: Math.max(0, params.requiredPracticalHours),
      deliveredHours: 0,
      teacherId: safeId(params.teacher.id),
      teacherName: clamp(params.teacher.fullName, VALIDATION_LIMITS.displayNameMax, 'Faculty'),
      institutionId: INSTITUTION_ID,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await logInteraction({
      actorUid: params.actorUid,
      actorName: params.actorName,
      actorRole: 'admin',
      actionType: 'master_updated',
      label: `Added Master Subject ${params.code.toUpperCase()} (${params.profYear}) for ${params.teacher.fullName}`,
      staffUids: params.staffUids,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function adminReassignSubjectTeacher(params: {
  subject: Subject;
  newTeacher: TeacherProfile;
  actorUid: string;
  actorName: string;
  staffUids: string[];
}): Promise<void> {
  const path = `subjects/${params.subject.id}`;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'subjects', params.subject.id), {
      teacherId: safeId(params.newTeacher.id),
      teacherName: clamp(params.newTeacher.fullName, VALIDATION_LIMITS.displayNameMax, 'Faculty'),
      updatedAt: serverTimestamp(),
    });

    const nextAssigned = Array.from(
      new Set([...(params.newTeacher.assignedSubjects || []), params.subject.code])
    ).slice(0, VALIDATION_LIMITS.maxAssignedSubjects);

    batch.update(doc(db, 'teachers', params.newTeacher.id), {
      assignedSubjects: nextAssigned,
      updatedAt: serverTimestamp(),
    });

    await batch.commit();

    await logInteraction({
      actorUid: params.actorUid,
      actorName: params.actorName,
      actorRole: 'admin',
      actionType: 'subject_reassigned',
      label: `Reassigned ${params.subject.code} (${params.subject.name}) to ${params.newTeacher.fullName}`,
      staffUids: params.staffUids,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function adminDeleteSubject(subjectId: string): Promise<void> {
  const path = `subjects/${subjectId}`;
  try {
    await deleteDoc(doc(db, 'subjects', subjectId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function adminUpdateUserRole(params: {
  targetUser: UserProfile;
  newRole: UserRole;
  actorUid: string;
  actorName: string;
  allStaffUids: string[];
}): Promise<void> {
  await adminApproveRequest({
    targetUser: params.targetUser,
    approvedRole: params.newRole,
    actorUid: params.actorUid,
    actorName: params.actorName,
    allStaffUids: params.allStaffUids,
  });
}

export async function adminEnrollStudent(params: {
  uid: string;
  fullName: string;
  rollNumber: string;
  profYear: ProfYear;
  batch: string;
  staffUids: string[];
}): Promise<void> {
  const id = safeId(`stu_${params.uid}`);
  const path = `students/${id}`;
  const cleanRoll = clamp(
    params.rollNumber.toUpperCase(),
    32,
    `BAMS-${params.uid.slice(0, 4).toUpperCase()}`
  );
  try {
    const [existingUidQuery, existingRollQuery] = await Promise.all([
      getDocs(query(collection(db, 'students'), where('uid', '==', params.uid))),
      getDocs(query(collection(db, 'students'), where('rollNumber', '==', cleanRoll))),
    ]);
    if (!existingUidQuery.empty || !existingRollQuery.empty) return;

    await setDoc(doc(db, 'students', id), {
      id,
      uid: safeId(params.uid),
      rollNumber: cleanRoll,
      fullName: clamp(params.fullName, VALIDATION_LIMITS.displayNameMax, 'BAMS Student'),
      profYear: params.profYear,
      batch: clamp(params.batch, 20, 'Batch 2025'),
      totalHoursScheduled: 20,
      totalHoursAttended: 18,
      theoryHoursAttended: 10,
      practicalHoursAttended: 8,
      attendancePercent: 90,
      consecutiveAbsences: 0,
      standing: 'nominal',
      staffUids: params.staffUids.slice(0, VALIDATION_LIMITS.maxStaffList),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function adminAdjustStudentAttendance(params: {
  student: StudentRecord;
  mode: 'add' | 'remove';
  hours: number;
  category: 'theory' | 'practical';
  adjustScheduled: boolean;
  reason: string;
  actorUid: string;
  actorName: string;
  staffUids: string[];
}): Promise<void> {
  const path = `students/${params.student.id}`;
  try {
    const delta = params.mode === 'add' ? Math.abs(params.hours) : -Math.abs(params.hours);
    const nextScheduled = params.adjustScheduled
      ? Math.max(0, Number((params.student.totalHoursScheduled + delta).toFixed(1)))
      : params.student.totalHoursScheduled;

    const nextTheory =
      params.category === 'theory'
        ? Math.max(0, Number((params.student.theoryHoursAttended + delta).toFixed(1)))
        : params.student.theoryHoursAttended;
    const nextPractical =
      params.category === 'practical'
        ? Math.max(0, Number((params.student.practicalHoursAttended + delta).toFixed(1)))
        : params.student.practicalHoursAttended;

    const rawAttended = Math.max(0, Number((params.student.totalHoursAttended + delta).toFixed(1)));
    const nextAttended = nextScheduled > 0 ? Math.min(nextScheduled, rawAttended) : rawAttended;
    const nextPct =
      nextScheduled > 0 ? Math.min(100, Number(((nextAttended / nextScheduled) * 100).toFixed(1))) : 100;
    const nextConsecutive = params.mode === 'add' ? 0 : params.student.consecutiveAbsences;
    const nextStanding = computeStanding(nextPct, nextConsecutive);

    await updateDoc(doc(db, 'students', params.student.id), {
      totalHoursScheduled: nextScheduled,
      totalHoursAttended: nextAttended,
      theoryHoursAttended: nextTheory,
      practicalHoursAttended: nextPractical,
      attendancePercent: nextPct,
      consecutiveAbsences: nextConsecutive,
      standing: nextStanding,
      updatedAt: serverTimestamp(),
    });

    await logInteraction({
      actorUid: params.actorUid,
      actorName: params.actorName,
      actorRole: 'admin',
      actionType: 'admin_attendance_adjust',
      label: `Admin ${params.mode === 'add' ? 'added' : 'removed'} ${Math.abs(params.hours)}h (${params.category}) for ${params.student.fullName} — ${params.reason}`,
      staffUids: params.staffUids,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export interface BulkAttendanceUpdateItem {
  student: StudentRecord;
  nextScheduled: number;
  nextAttended: number;
  nextTheory: number;
  nextPractical: number;
  nextConsecutive: number;
  nextPercent: number;
  isNewStudent?: boolean;
}

export async function adminBulkImportStudentAttendance(params: {
  items: BulkAttendanceUpdateItem[];
  mode: 'replace' | 'add';
  sourceLabel: string;
  actorUid: string;
  actorName: string;
  staffUids: string[];
}): Promise<number> {
  if (params.items.length === 0) return 0;
  const path = 'students/bulk_excel_import';
  try {
    for (let i = 0; i < params.items.length; i += 350) {
      const batch = writeBatch(db);
      params.items.slice(i, i + 350).forEach((item) => {
        const scheduled = Math.max(0, Number(item.nextScheduled.toFixed(1)));
        const theory = Math.max(0, Number(item.nextTheory.toFixed(1)));
        const practical = Math.max(0, Number(item.nextPractical.toFixed(1)));
        const rawAttended = Math.max(0, Number(item.nextAttended.toFixed(1)));
        const attended = scheduled > 0 ? Math.min(scheduled, rawAttended) : rawAttended;
        const pct =
          scheduled > 0 ? Math.min(100, Number(((attended / scheduled) * 100).toFixed(1))) : 100;
        const consecutive = Math.max(0, Math.round(item.nextConsecutive));
        const standing = computeStanding(pct, consecutive);

        if (item.isNewStudent) {
          const stId = safeId(item.student.id);
          batch.set(doc(db, 'students', stId), {
            id: stId,
            uid: safeId(item.student.uid || stId),
            rollNumber: clamp(item.student.rollNumber.toUpperCase(), 32, 'BAMS-NEW'),
            fullName: clamp(item.student.fullName, VALIDATION_LIMITS.displayNameMax, 'BAMS Student'),
            profYear: clamp(item.student.profYear, 40, '1st Prof'),
            batch: clamp(item.student.batch, 20, 'Batch 2025'),
            totalHoursScheduled: scheduled,
            totalHoursAttended: attended,
            theoryHoursAttended: theory,
            practicalHoursAttended: practical,
            attendancePercent: pct,
            consecutiveAbsences: consecutive,
            standing,
            staffUids: params.staffUids.slice(0, VALIDATION_LIMITS.maxStaffList),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          batch.update(doc(db, 'students', item.student.id), {
            totalHoursScheduled: scheduled,
            totalHoursAttended: attended,
            theoryHoursAttended: theory,
            practicalHoursAttended: practical,
            attendancePercent: pct,
            consecutiveAbsences: consecutive,
            standing,
            updatedAt: serverTimestamp(),
          });
        }
      });
      await batch.commit();
    }

    await logInteraction({
      actorUid: params.actorUid,
      actorName: params.actorName,
      actorRole: 'admin',
      actionType: 'admin_attendance_adjust',
      label: `Bulk Excel import (${params.mode === 'replace' ? 'Opening Balance' : 'Added Hours'}) for ${params.items.length} students from ${params.sourceLabel}`,
      staffUids: params.staffUids,
    });

    return params.items.length;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function fetchRecordsForSessions(
  sessionIds: string[]
): Promise<Record<string, SessionStudentRecord[]>> {
  const result: Record<string, SessionStudentRecord[]> = {};
  if (sessionIds.length === 0) return result;
  for (let i = 0; i < sessionIds.length; i += 15) {
    const chunk = sessionIds.slice(i, i + 15);
    await Promise.all(
      chunk.map(async (sid) => {
        try {
          const snap = await getDocs(collection(db, 'attendanceSessions', sid, 'records'));
          result[sid] = snap.docs.map((d) => d.data() as SessionStudentRecord);
        } catch {
          result[sid] = [];
        }
      })
    );
  }
  return result;
}

export interface GoogleFormSessionImportPayload {
  sessionId: string;
  sessionDoc: Omit<AttendanceSession, 'createdAt' | 'updatedAt'>;
  records: Array<Omit<SessionStudentRecord, 'updatedAt'>>;
}

export async function adminImportGoogleFormAttendance(params: {
  sessionsToCreate: GoogleFormSessionImportPayload[];
  studentUpdates: BulkAttendanceUpdateItem[];
  subjectHourDeltas: Record<string, number>;
  existingSubjectsMap: Record<string, Subject>;
  saveSessions: boolean;
  mode: 'replace' | 'add';
  sourceLabel: string;
  actorUid: string;
  actorName: string;
  staffUids: string[];
}): Promise<{ sessionsSaved: number; studentsUpdated: number }> {
  const path = 'attendanceSessions/google_form_import';
  try {
    let sessionsSaved = 0;

    if (params.saveSessions && params.sessionsToCreate.length > 0) {
      // Phase 1: Commit parent session documents first so child record rules `exists(...)` pass reliably
      for (let i = 0; i < params.sessionsToCreate.length; i += 350) {
        const batch = writeBatch(db);
        params.sessionsToCreate.slice(i, i + 350).forEach((item) => {
          const s = item.sessionDoc;
          const sid = safeId(item.sessionId);
          batch.set(doc(db, 'attendanceSessions', sid), {
            id: sid,
            teacherUid: safeId(s.teacherUid),
            teacherId: safeId(s.teacherId),
            teacherName: clamp(s.teacherName, VALIDATION_LIMITS.displayNameMax, 'Faculty'),
            subjectId: safeId(s.subjectId),
            subjectCode: clamp(s.subjectCode, VALIDATION_LIMITS.subjectCodeMax, 'BAMS'),
            subjectName: clamp(s.subjectName, VALIDATION_LIMITS.subjectNameMax, 'BAMS Subject'),
            profYear: clamp(s.profYear, 40, '1st Prof'),
            ...(s.batchLabel ? { batchLabel: clamp(s.batchLabel, 60, '') } : {}),
            sessionType: clamp(s.sessionType, 80, 'Theory (Class Hours)'),
            activityType: clamp(s.activityType, 60, 'Regular Class'),
            topicTaught: clamp(s.topicTaught, VALIDATION_LIMITS.topicTaughtMax, ''),
            entryMode: s.entryMode,
            date: clamp(s.date, 20, new Date().toISOString().slice(0, 10)),
            startTime: clamp(s.startTime, 10, '09:00'),
            endTime: clamp(s.endTime, 10, '10:00'),
            durationHours: Math.min(8, Math.max(0.5, Number(s.durationHours) || 1)),
            room: clamp(s.room, VALIDATION_LIMITS.roomMax, 'Lecture Hall'),
            status: 'submitted',
            allowStudentSelfMark: false,
            checkInCode: clamp(s.checkInCode, VALIDATION_LIMITS.checkInCodeMax, 'GF2026'),
            presentCount: Math.max(0, s.presentCount),
            lateCount: Math.max(0, s.lateCount),
            absentCount: Math.max(0, s.absentCount),
            totalStudents: Math.max(0, s.totalStudents),
            notes: clamp(s.notes, VALIDATION_LIMITS.notesMax, ''),
            staffUids: s.staffUids.slice(0, VALIDATION_LIMITS.maxStaffList),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });
        await batch.commit();
      }

      // Phase 2: Commit all session student records in chunks of 350
      const flattenedRecords: Array<{
        sid: string;
        rec: Omit<SessionStudentRecord, 'updatedAt'>;
      }> = [];
      params.sessionsToCreate.forEach((item) => {
        const sid = safeId(item.sessionId);
        item.records.forEach((rec) => {
          flattenedRecords.push({ sid, rec });
        });
      });

      for (let i = 0; i < flattenedRecords.length; i += 350) {
        const batch = writeBatch(db);
        flattenedRecords.slice(i, i + 350).forEach(({ sid, rec }) => {
          const stId = safeId(rec.studentId);
          batch.set(doc(db, 'attendanceSessions', sid, 'records', stId), {
            studentId: stId,
            studentUid: rec.studentUid || stId,
            rollNumber: clamp(rec.rollNumber, 32, 'BAMS'),
            studentName: clamp(rec.studentName, VALIDATION_LIMITS.displayNameMax, 'Student'),
            status: rec.status,
            creditedHours: Math.min(8, Math.max(0, Number(rec.creditedHours) || 0)),
            selfCheckedIn: false,
            checkInTime: clamp(rec.checkInTime, 20, ''),
            remarks: clamp(rec.remarks, VALIDATION_LIMITS.remarksMax, 'Google Form Import'),
            teacherUid: safeId(rec.teacherUid),
            staffUids: rec.staffUids.slice(0, VALIDATION_LIMITS.maxStaffList),
            updatedAt: serverTimestamp(),
          });
        });
        await batch.commit();
      }

      // Phase 3: Increment deliveredHours on matching existing subjects
      const subjectEntries = Object.entries(params.subjectHourDeltas).filter(
        ([subId, delta]) => delta > 0 && Boolean(params.existingSubjectsMap[subId])
      );
      for (let i = 0; i < subjectEntries.length; i += 350) {
        const batch = writeBatch(db);
        subjectEntries.slice(i, i + 350).forEach(([subId, delta]) => {
          const sub = params.existingSubjectsMap[subId];
          if (sub) {
            batch.update(doc(db, 'subjects', subId), {
              deliveredHours: Number((sub.deliveredHours + delta).toFixed(1)),
              updatedAt: serverTimestamp(),
            });
          }
        });
        await batch.commit();
      }

      sessionsSaved = params.sessionsToCreate.length;
    }

    // Phase 4: Update student cumulative attendance records
    for (let i = 0; i < params.studentUpdates.length; i += 350) {
      const batch = writeBatch(db);
      params.studentUpdates.slice(i, i + 350).forEach((item) => {
        const scheduled = Math.max(0, Number(item.nextScheduled.toFixed(1)));
        const theory = Math.max(0, Number(item.nextTheory.toFixed(1)));
        const practical = Math.max(0, Number(item.nextPractical.toFixed(1)));
        const rawAttended = Math.max(0, Number(item.nextAttended.toFixed(1)));
        const attended = scheduled > 0 ? Math.min(scheduled, rawAttended) : rawAttended;
        const pct =
          scheduled > 0 ? Math.min(100, Number(((attended / scheduled) * 100).toFixed(1))) : 100;
        const consecutive = Math.max(0, Math.round(item.nextConsecutive));
        const standing = computeStanding(pct, consecutive);

        if (item.isNewStudent) {
          const stId = safeId(item.student.id);
          batch.set(doc(db, 'students', stId), {
            id: stId,
            uid: safeId(item.student.uid || stId),
            rollNumber: clamp(item.student.rollNumber.toUpperCase(), 32, 'BAMS-NEW'),
            fullName: clamp(item.student.fullName, VALIDATION_LIMITS.displayNameMax, 'BAMS Student'),
            profYear: clamp(item.student.profYear, 40, '1st Prof'),
            batch: clamp(item.student.batch, 20, 'Batch 2025'),
            totalHoursScheduled: scheduled,
            totalHoursAttended: attended,
            theoryHoursAttended: theory,
            practicalHoursAttended: practical,
            attendancePercent: pct,
            consecutiveAbsences: consecutive,
            standing,
            staffUids: params.staffUids.slice(0, VALIDATION_LIMITS.maxStaffList),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          batch.update(doc(db, 'students', item.student.id), {
            totalHoursScheduled: scheduled,
            totalHoursAttended: attended,
            theoryHoursAttended: theory,
            practicalHoursAttended: practical,
            attendancePercent: pct,
            consecutiveAbsences: consecutive,
            standing,
            updatedAt: serverTimestamp(),
          });
        }
      });
      await batch.commit();
    }

    await logInteraction({
      actorUid: params.actorUid,
      actorName: params.actorName,
      actorRole: 'admin',
      actionType: 'admin_attendance_adjust',
      label: `Google Form Excel import: ${sessionsSaved} classes, ${params.studentUpdates.length} students (${params.mode}) from ${params.sourceLabel}`,
      staffUids: params.staffUids,
    });

    return {
      sessionsSaved,
      studentsUpdated: params.studentUpdates.length,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function adminAddRecordToSession(params: {
  session: AttendanceSession;
  records: SessionStudentRecord[];
  student: StudentRecord;
  status: StudentAttendanceStatus;
  actorUid: string;
  actorName: string;
}): Promise<void> {
  const path = `attendanceSessions/${params.session.id}/records/${params.student.id}`;
  try {
    const creditedHours =
      params.status === 'present'
        ? params.session.durationHours
        : params.status === 'late'
          ? Number((params.session.durationHours * 0.5).toFixed(1))
          : 0;

    const newRecord: SessionStudentRecord = {
      studentId: params.student.id,
      studentUid: params.student.uid,
      rollNumber: params.student.rollNumber,
      studentName: params.student.fullName,
      status: params.status,
      creditedHours,
      selfCheckedIn: false,
      checkInTime: params.status !== 'absent' ? params.session.startTime : '',
      remarks: 'Added by Admin',
      teacherUid: params.session.teacherUid,
      staffUids: params.session.staffUids,
    };

    const nextRecords = [...params.records.filter((r) => r.studentId !== params.student.id), newRecord];
    const presentCount = nextRecords.filter((r) => r.status === 'present').length;
    const lateCount = nextRecords.filter((r) => r.status === 'late').length;
    const absentCount = nextRecords.filter((r) => r.status === 'absent').length;

    const batch = writeBatch(db);
    batch.set(doc(db, 'attendanceSessions', params.session.id, 'records', params.student.id), {
      ...newRecord,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'attendanceSessions', params.session.id), {
      presentCount,
      lateCount,
      absentCount,
      totalStudents: nextRecords.length,
      updatedAt: serverTimestamp(),
    });

    if (params.session.status === 'submitted') {
      const nextScheduled = params.student.totalHoursScheduled + params.session.durationHours;
      const nextAttended = Number((params.student.totalHoursAttended + creditedHours).toFixed(1));
      const isTheory = isTheorySessionType(params.session.sessionType);
      const nextTheory = isTheory
        ? Number((params.student.theoryHoursAttended + creditedHours).toFixed(1))
        : params.student.theoryHoursAttended;
      const nextPractical = !isTheory
        ? Number((params.student.practicalHoursAttended + creditedHours).toFixed(1))
        : params.student.practicalHoursAttended;
      const nextPct =
        nextScheduled > 0 ? Math.min(100, Number(((nextAttended / nextScheduled) * 100).toFixed(1))) : 100;
      batch.update(doc(db, 'students', params.student.id), {
        totalHoursScheduled: nextScheduled,
        totalHoursAttended: nextAttended,
        theoryHoursAttended: nextTheory,
        practicalHoursAttended: nextPractical,
        attendancePercent: nextPct,
        standing: computeStanding(nextPct, params.student.consecutiveAbsences),
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();

    await logInteraction({
      actorUid: params.actorUid,
      actorName: params.actorName,
      actorRole: 'admin',
      actionType: 'admin_attendance_adjust',
      label: `Admin added ${params.student.fullName} (${params.status}) to ${params.session.subjectCode}`,
      staffUids: params.session.staffUids,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function adminRemoveRecordFromSession(params: {
  session: AttendanceSession;
  records: SessionStudentRecord[];
  targetRecord: SessionStudentRecord;
  student: StudentRecord | undefined;
  actorUid: string;
  actorName: string;
}): Promise<void> {
  const path = `attendanceSessions/${params.session.id}/records/${params.targetRecord.studentId}`;
  try {
    const nextRecords = params.records.filter((r) => r.studentId !== params.targetRecord.studentId);
    const presentCount = nextRecords.filter((r) => r.status === 'present').length;
    const lateCount = nextRecords.filter((r) => r.status === 'late').length;
    const absentCount = nextRecords.filter((r) => r.status === 'absent').length;

    const batch = writeBatch(db);
    batch.delete(
      doc(db, 'attendanceSessions', params.session.id, 'records', params.targetRecord.studentId)
    );
    batch.update(doc(db, 'attendanceSessions', params.session.id), {
      presentCount,
      lateCount,
      absentCount,
      totalStudents: nextRecords.length,
      updatedAt: serverTimestamp(),
    });

    if (params.session.status === 'submitted' && params.student) {
      const nextScheduled = Math.max(
        0,
        Number((params.student.totalHoursScheduled - params.session.durationHours).toFixed(1))
      );
      const nextAttended = Math.max(
        0,
        Number((params.student.totalHoursAttended - params.targetRecord.creditedHours).toFixed(1))
      );
      const isTheory = isTheorySessionType(params.session.sessionType);
      const nextTheory = isTheory
        ? Math.max(0, Number((params.student.theoryHoursAttended - params.targetRecord.creditedHours).toFixed(1)))
        : params.student.theoryHoursAttended;
      const nextPractical = !isTheory
        ? Math.max(
            0,
            Number((params.student.practicalHoursAttended - params.targetRecord.creditedHours).toFixed(1))
          )
        : params.student.practicalHoursAttended;
      const nextPct =
        nextScheduled > 0 ? Math.min(100, Number(((nextAttended / nextScheduled) * 100).toFixed(1))) : 100;
      batch.update(doc(db, 'students', params.student.id), {
        totalHoursScheduled: nextScheduled,
        totalHoursAttended: nextAttended,
        theoryHoursAttended: nextTheory,
        practicalHoursAttended: nextPractical,
        attendancePercent: nextPct,
        standing: computeStanding(nextPct, params.student.consecutiveAbsences),
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();

    await logInteraction({
      actorUid: params.actorUid,
      actorName: params.actorName,
      actorRole: 'admin',
      actionType: 'admin_attendance_adjust',
      label: `Admin removed ${params.targetRecord.studentName} from ${params.session.subjectCode} (${params.session.date})`,
      staffUids: params.session.staffUids,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function adminDeleteSession(params: {
  session: AttendanceSession;
  actorUid: string;
  actorName: string;
}): Promise<void> {
  const path = `attendanceSessions/${params.session.id}`;
  try {
    const recSnap = await getDocs(collection(db, 'attendanceSessions', params.session.id, 'records'));
    const batch = writeBatch(db);
    recSnap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    await deleteDoc(doc(db, 'attendanceSessions', params.session.id));

    await logInteraction({
      actorUid: params.actorUid,
      actorName: params.actorName,
      actorRole: 'admin',
      actionType: 'admin_attendance_adjust',
      label: `Admin deleted register ${params.session.subjectCode} (${params.session.date})`,
      staffUids: params.session.staffUids,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function adminPromoteBatch(params: {
  studentsToPromote: StudentRecord[];
  usersToUpdate: UserProfile[];
  fromProfYear: ProfYear;
  toProfYear: ProfYear;
  sourceBatch: string;
  resetAttendanceForNewProf: boolean;
  actorUid: string;
  actorName: string;
  staffUids: string[];
}): Promise<{ promotedStudents: number; updatedUsers: number }> {
  const path = `students/promote_${params.sourceBatch}`;
  try {
    type BatchOp =
      | { kind: 'student'; ref: ReturnType<typeof doc>; data: Record<string, unknown> }
      | { kind: 'user'; ref: ReturnType<typeof doc>; data: Record<string, unknown> };

    const ops: BatchOp[] = [];
    const cleanTargetProf = clamp(params.toProfYear, 40, '2nd Prof');

    params.studentsToPromote.forEach((stu) => {
      ops.push({
        kind: 'student',
        ref: doc(db, 'students', stu.id),
        data: {
          profYear: cleanTargetProf,
          batch: stu.batch,
          ...(params.resetAttendanceForNewProf
            ? {
                totalHoursScheduled: 0,
                totalHoursAttended: 0,
                theoryHoursAttended: 0,
                practicalHoursAttended: 0,
                attendancePercent: 100,
                consecutiveAbsences: 0,
                standing: 'nominal',
              }
            : {}),
          updatedAt: serverTimestamp(),
        },
      });
    });

    params.usersToUpdate.forEach((u) => {
      if (u.role === 'admin') return;
      ops.push({
        kind: 'user',
        ref: doc(db, 'users', u.uid),
        data: {
          profYear: cleanTargetProf,
          updatedAt: serverTimestamp(),
        },
      });
    });

    const CHUNK = 350;
    for (let i = 0; i < ops.length; i += CHUNK) {
      const batch = writeBatch(db);
      ops.slice(i, i + CHUNK).forEach((op) => {
        batch.update(op.ref, op.data);
      });
      await batch.commit();
    }

    await logInteraction({
      actorUid: params.actorUid,
      actorName: params.actorName,
      actorRole: 'admin',
      actionType: 'master_updated',
      label: `Promoted ${params.studentsToPromote.length} student(s) of ${params.sourceBatch} (${params.fromProfYear} → ${cleanTargetProf})`,
      staffUids: params.staffUids,
    });

    return {
      promotedStudents: params.studentsToPromote.length,
      updatedUsers: params.usersToUpdate.filter((u) => u.role !== 'admin').length,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function rotateSessionCheckInCode(params: {
  sessionId: string;
  newCode?: string;
  qrRotatingEnabled?: boolean;
  geoFenceRequired?: boolean;
  allowStudentSelfMark?: boolean;
}): Promise<string> {
  const path = `attendanceSessions/${params.sessionId}`;
  const code = (
    params.newCode ||
    `QR${Math.floor(1000 + Math.random() * 9000)}`
  )
    .trim()
    .toUpperCase()
    .slice(0, VALIDATION_LIMITS.checkInCodeMax);
  try {
    const patch: Record<string, unknown> = {
      checkInCode: code,
      updatedAt: serverTimestamp(),
    };
    if (params.qrRotatingEnabled !== undefined) patch.qrRotatingEnabled = params.qrRotatingEnabled;
    if (params.geoFenceRequired !== undefined) patch.geoFenceRequired = params.geoFenceRequired;
    if (params.allowStudentSelfMark !== undefined) {
      patch.allowStudentSelfMark = params.allowStudentSelfMark;
    }
    await updateDoc(doc(db, 'attendanceSessions', params.sessionId), patch);
    return code;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function submitLeaveRequest(params: {
  student: StudentRecord;
  actorUid: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  hoursClaimed: number;
  reason: string;
  staffUids: string[];
}): Promise<void> {
  const id = safeId(`lv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`);
  const path = `leaveRequests/${id}`;
  try {
    const hours = Math.min(120, Math.max(0.5, Number(params.hoursClaimed) || 1));
    const mergedStaff = Array.from(new Set([...params.student.staffUids, ...params.staffUids])).slice(
      0,
      VALIDATION_LIMITS.maxStaffList
    );
    await setDoc(doc(db, 'leaveRequests', id), {
      id,
      studentId: safeId(params.student.id),
      studentUid: safeId(params.actorUid || params.student.uid),
      rollNumber: clamp(params.student.rollNumber, 32, 'BAMS-001'),
      studentName: clamp(params.student.fullName, 100, 'Student'),
      profYear: clamp(params.student.profYear, 40, '1st Prof'),
      batch: clamp(params.student.batch, 20, 'Batch 2025'),
      leaveType: params.leaveType,
      startDate: clamp(params.startDate, 20, new Date().toISOString().slice(0, 10)),
      endDate: clamp(params.endDate, 20, new Date().toISOString().slice(0, 10)),
      hoursClaimed: hours,
      reason: clamp(params.reason, 300, 'Medical / Duty Leave Application'),
      status: 'pending' as LeaveStatus,
      reviewedBy: '',
      reviewedByName: '',
      staffUids: mergedStaff,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function reviewLeaveRequest(params: {
  request: LeaveRequest;
  decision: 'approved' | 'rejected';
  creditHoursToStudent: boolean;
  student?: StudentRecord;
  actorUid: string;
  actorName: string;
  actorRole: UserRole;
  staffUids: string[];
}): Promise<void> {
  const path = `leaveRequests/${params.request.id}`;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'leaveRequests', params.request.id), {
      status: params.decision,
      reviewedBy: safeId(params.actorUid),
      reviewedByName: clamp(params.actorName, 100, 'Admin'),
      updatedAt: serverTimestamp(),
    });

    if (params.decision === 'approved' && params.creditHoursToStudent && params.student) {
      const addHrs = Number(params.request.hoursClaimed) || 0;
      const nextScheduled = Math.max(
        params.student.totalHoursScheduled,
        Number((params.student.totalHoursAttended + addHrs).toFixed(1))
      );
      const nextAttended = Math.min(
        nextScheduled,
        Number((params.student.totalHoursAttended + addHrs).toFixed(1))
      );
      const nextTheory = Number((params.student.theoryHoursAttended + addHrs).toFixed(1));
      const nextPct =
        nextScheduled > 0
          ? Math.min(100, Number(((nextAttended / nextScheduled) * 100).toFixed(1)))
          : 100;
      batch.update(doc(db, 'students', params.student.id), {
        totalHoursScheduled: nextScheduled,
        totalHoursAttended: nextAttended,
        theoryHoursAttended: nextTheory,
        attendancePercent: nextPct,
        consecutiveAbsences: 0,
        standing: computeStanding(nextPct, 0),
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();

    await logInteraction({
      actorUid: params.actorUid,
      actorName: params.actorName,
      actorRole: params.actorRole,
      actionType: 'admin_attendance_adjust',
      label: `${params.decision === 'approved' ? 'Approved' : 'Rejected'} ${params.request.leaveType} leave (${params.request.hoursClaimed}h) for ${params.request.studentName}`,
      staffUids: params.staffUids,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteLeaveRequest(leaveId: string): Promise<void> {
  const path = `leaveRequests/${leaveId}`;
  try {
    await deleteDoc(doc(db, 'leaveRequests', leaveId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function createClinicalRotation(params: {
  profYear: ProfYear;
  batch: string;
  groupLabel: string;
  wardName: string;
  department: string;
  supervisorName: string;
  startDate: string;
  endDate: string;
  status: ClinicalRotationStatus;
  notes: string;
  actorUid: string;
  actorName: string;
  actorRole: UserRole;
  staffUids: string[];
}): Promise<void> {
  const id = safeId(`rot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`);
  const path = `clinicalRotations/${id}`;
  try {
    await setDoc(doc(db, 'clinicalRotations', id), {
      id,
      profYear: clamp(params.profYear, 40, '3rd Prof'),
      batch: clamp(params.batch, 20, 'Batch 2023'),
      groupLabel: clamp(params.groupLabel, 60, 'Clinical Group A'),
      wardName: clamp(params.wardName, 100, 'Kayachikitsa OPD / IPD'),
      department: clamp(params.department, 80, 'Kayachikitsa'),
      supervisorName: clamp(params.supervisorName, 100, 'BAMS Faculty'),
      startDate: clamp(params.startDate, 20, new Date().toISOString().slice(0, 10)),
      endDate: clamp(params.endDate, 20, new Date().toISOString().slice(0, 10)),
      status: params.status,
      sessionsLogged: 0,
      notes: clamp(params.notes, 240, ''),
      institutionId: INSTITUTION_ID,
      staffUids: params.staffUids.slice(0, VALIDATION_LIMITS.maxStaffList),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await logInteraction({
      actorUid: params.actorUid,
      actorName: params.actorName,
      actorRole: params.actorRole,
      actionType: 'master_updated',
      label: `Created clinical rotation: ${params.wardName} for ${params.groupLabel} (${params.batch})`,
      staffUids: params.staffUids,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateClinicalRotation(params: {
  rotation: ClinicalRotation;
  status?: ClinicalRotationStatus;
  sessionsLogged?: number;
  notes?: string;
}): Promise<void> {
  const path = `clinicalRotations/${params.rotation.id}`;
  try {
    const patch: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };
    if (params.status !== undefined) patch.status = params.status;
    if (params.sessionsLogged !== undefined) {
      patch.sessionsLogged = Math.min(500, Math.max(0, Math.round(params.sessionsLogged)));
    }
    if (params.notes !== undefined) patch.notes = clamp(params.notes, 240, '');
    await updateDoc(doc(db, 'clinicalRotations', params.rotation.id), patch);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteClinicalRotation(rotationId: string): Promise<void> {
  const path = `clinicalRotations/${rotationId}`;
  try {
    await deleteDoc(doc(db, 'clinicalRotations', rotationId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}


