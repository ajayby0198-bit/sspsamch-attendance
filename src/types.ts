export type UserRole = 'admin' | 'co_admin' | 'principal' | 'teacher' | 'student' | 'parent';
export type ApprovalStatus = 'active' | 'pending' | 'rejected' | 'blocked';
export type AccessInviteStatus = 'invited' | 'claimed' | 'revoked';
export type ProfYear = string;
export type UserProfYear = string;
export type SessionType = string;
export type ActivityType = string;
export type EntryMode = 'live' | 'paper_backup';
export type SessionStatus = 'draft' | 'submitted';
export type StudentAttendanceStatus = 'present' | 'late' | 'absent';
export type StudentStanding = 'nominal' | 'warning' | 'critical';
export type AlertType = 'low_attendance' | 'consecutive_absence' | 'draft_pending';
export type AlertSeverity = 'warning' | 'critical';
export type ResourceCategory = 'notes' | 'test_paper' | 'marks' | 'notification';
export type FeedbackCategory = 'Usability' | 'Attendance' | 'Academic' | 'Resources';
export type FeedbackStatus = 'submitted' | 'reviewed' | 'implemented';
export type InteractionActionType =
  | 'draft_saved'
  | 'session_submitted'
  | 'student_checkin'
  | 'alert_resolved'
  | 'role_updated'
  | 'correction_audit'
  | 'resource_published'
  | 'feedback_submitted'
  | 'admin_attendance_adjust'
  | 'request_rejected'
  | 'invite_created'
  | 'master_updated'
  | 'user_blocked'
  | 'user_unblocked'
  | 'subject_reassigned';

export type PermissionKey =
  | 'view_analytics'
  | 'manage_attendance'
  | 'override_attendance'
  | 'manage_faculty'
  | 'manage_students'
  | 'manage_parents'
  | 'manage_learning'
  | 'manage_alerts'
  | 'manage_master'
  | 'verify_users';

export const PERMISSION_CATALOG: Array<{
  key: PermissionKey;
  label: string;
  description: string;
}> = [
  {
    key: 'view_analytics',
    label: 'Live Analytics & Date-Range Progress',
    description: 'View real-time charts, batch trends, and date-range attendance KPIs',
  },
  {
    key: 'manage_attendance',
    label: 'Class Attendance Register',
    description: 'Create class registers, save drafts, and submit student attendance',
  },
  {
    key: 'override_attendance',
    label: 'Attendance Add / Remove Override',
    description: 'Directly add or remove student attendance hours and session records',
  },
  {
    key: 'manage_faculty',
    label: 'Faculty Profiles Access',
    description: 'View and manage BAMS teacher profiles and subject loads',
  },
  {
    key: 'manage_students',
    label: 'Students Portal & Roster Access',
    description: 'Access student attendance progress, roster, and defaulters list',
  },
  {
    key: 'manage_parents',
    label: 'Parents Report Access',
    description: 'View parent progress reports and ward absenteeism notifications',
  },
  {
    key: 'manage_learning',
    label: 'Learning Repository & Feedback',
    description: 'Publish study notes, test papers, internal marks, and notices',
  },
  {
    key: 'manage_alerts',
    label: 'Reports & Alerts Resolution',
    description: 'Resolve automated absenteeism alerts and print Master PDFs',
  },
  {
    key: 'manage_master',
    label: 'Master Data Configuration',
    description: 'Add attendance options, subjects, departments, and BAMS prof batches',
  },
  {
    key: 'verify_users',
    label: 'Verify / Reject User Requests',
    description: 'Pre-add institutional emails, verify signups, block/unblock users, and generate access codes',
  },
];

export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, PermissionKey[]> = {
  admin: PERMISSION_CATALOG.map((p) => p.key),
  co_admin: [
    'view_analytics',
    'manage_attendance',
    'override_attendance',
    'manage_faculty',
    'manage_students',
    'manage_parents',
    'manage_learning',
    'manage_alerts',
    'manage_master',
    'verify_users',
  ],
  principal: [
    'view_analytics',
    'manage_faculty',
    'manage_students',
    'manage_parents',
    'manage_alerts',
    'manage_learning',
  ],
  teacher: [
    'manage_attendance',
    'manage_students',
    'view_analytics',
    'manage_learning',
    'manage_alerts',
  ],
  student: ['view_analytics', 'manage_learning'],
  parent: ['view_analytics', 'manage_parents'],
};

export const DEFAULT_PROF_YEARS = ['1st Prof', '2nd Prof', '3rd Prof', '4th Prof'];
export const DEFAULT_SESSION_TYPES = [
  'Theory (Class Hours)',
  'Practical (Lab Hours)',
  'Class Test',
  'Theory Terminal Assessment Examination',
  'Viva-Voce Terminal Assessment Examination',
  'Practical Terminal Assessment Examination',
  'Cultural Activity',
  'Seminar',
  'Workshop',
  'Training',
  'Transitional Curriculum',
];
export const DEFAULT_ACTIVITY_TYPES = [
  'Regular Class',
  'Internal Test',
  'Seminar',
  'Clinical Ward',
  'Sports / Co-Curricular',
];
export const DEFAULT_ATTENDANCE_OPTIONS = [
  'Present (100% Hours)',
  'Late (50% Hours)',
  'Absent (0% Hours)',
  'Medical Duty Leave',
  'Clinical Posting Exempt',
];
export const DEFAULT_DEPARTMENTS = [
  'Kayachikitsa',
  'Rachana Sharir',
  'Kriya Sharir',
  'Dravyaguna Vigyana',
  'Rasashastra',
  'Panchakarma',
  'Ayurveda Samhita',
  'Shalya Tantra',
];

export const VALIDATION_LIMITS = {
  idPattern: /^[a-zA-Z0-9_-]+$/,
  idMax: 128,
  displayNameMax: 100,
  departmentMax: 80,
  rollOrEmpIdMax: 40,
  avatarUrlMax: 300,
  emailMax: 160,
  phoneMax: 30,
  designationMax: 80,
  qualificationMax: 100,
  employeeCodeMax: 30,
  officeHoursMax: 100,
  bioMax: 500,
  subjectCodeMax: 24,
  subjectNameMax: 120,
  topicTaughtMax: 160,
  roomMax: 60,
  checkInCodeMax: 12,
  notesMax: 300,
  remarksMax: 200,
  alertMessageMax: 280,
  logLabelMax: 180,
  resourceTitleMax: 140,
  resourceDescMax: 400,
  scoreSummaryMax: 100,
  feedbackMsgMax: 400,
  maxStaffList: 20,
  maxAssignedSubjects: 10,
} as const;

export const INSTITUTION_ID = 'bams-ayurveda' as const;

export const INSTITUTION_INFO = {
  name: 'Shri Santan Pal Singh Ayurvedic Medical College & Hospital',
  shortName: 'SSPSAMCH Attendance Portal',
  portalTitle: 'Digital Attendance & Academic Monitoring Portal',
  address: 'Badaun - Farrukhabad Road, Near Tehsil Kalan, Mirzapur, Shahjahanpur (UP) - 242221',
  email: 'attendancesspsamch@gmail.com',
  collegeCode: '2022ayu0638',
  ncismId: 'AYU0638',
  universityId: 'AYUBA109',
  motto: 'Attendance Se Academic Excellence Tak',
  pillars: 'Principal · Faculty · Students · Parents · Co-Admin',
  principles: 'Transparent · Measurable · Accountable · Continuously Improving',
} as const;

export interface CustomMasterSection {
  id: string;
  title: string;
  items: string[];
}

export interface CustomRoleDef {
  id: string;
  label: string;
  subtitle: string;
  baseRole: Exclude<UserRole, 'admin'>;
  permissions: PermissionKey[];
}

export type PortalTabId =
  | 'analytics'
  | 'register'
  | 'teachers'
  | 'student'
  | 'learning'
  | 'alerts'
  | 'smart'
  | 'admin';

export type DayOfWeek = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat';

export interface TimetableEntry {
  id: string;
  day: DayOfWeek;
  startTime: string;
  endTime: string;
  profYear: ProfYear;
  batch: string;
  subjectCode: string;
  subjectName: string;
  teacherName: string;
  room: string;
  sessionType: string;
}

export type LeaveType = 'medical' | 'duty_nss' | 'academic_seminar' | 'sports_cultural';
export type LeaveStatus = 'pending' | 'approved' | 'rejected';

export interface LeaveRequest {
  id: string;
  studentId: string;
  studentUid: string;
  rollNumber: string;
  studentName: string;
  profYear: ProfYear;
  batch: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  hoursClaimed: number;
  reason: string;
  status: LeaveStatus;
  reviewedBy: string;
  reviewedByName: string;
  staffUids: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type ClinicalRotationStatus = 'scheduled' | 'active' | 'completed';

export interface ClinicalRotation {
  id: string;
  profYear: ProfYear;
  batch: string;
  groupLabel: string;
  wardName: string;
  department: string;
  supervisorName: string;
  startDate: string;
  endDate: string;
  status: ClinicalRotationStatus;
  sessionsLogged: number;
  notes: string;
  institutionId: typeof INSTITUTION_ID;
  staffUids: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ProfileMenuLink {
  id: string;
  role: UserRole | 'all';
  label: string;
  targetType: 'url' | 'tab';
  url?: string;
  tabId?: PortalTabId;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  requestedRole: UserRole;
  approvalStatus: ApprovalStatus;
  permissions: PermissionKey[];
  accessCode: string;
  accessCodeVerified: boolean;
  inviteId: string;
  profYear: UserProfYear;
  department: string;
  rollOrEmpId: string;
  avatarUrl: string;
  customRoleId?: string;
  customRoleName?: string;
  profileLockEnabled?: boolean;
  profileLockPin?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AccessInvite {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  profYear: string;
  department: string;
  rollOrEmpId: string;
  permissions: PermissionKey[];
  accessCode: string;
  status: AccessInviteStatus;
  customRoleId?: string;
  customRoleName?: string;
  createdByUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface MasterConfig {
  id: string;
  institutionId: typeof INSTITUTION_ID;
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
  updatedBy: string;
  updatedAt?: unknown;
}

export interface UserPrivateInfo {
  uid: string;
  email: string;
  phone: string;
  updatedAt?: unknown;
}

export interface TeacherProfile {
  id: string;
  ownerUid: string;
  fullName: string;
  designation: string;
  department: string;
  qualification: string;
  employeeCode: string;
  officeHours: string;
  bio: string;
  avatarUrl: string;
  assignedSubjects: string[];
  weeklyHours: number;
  sessionsSubmitted: number;
  sessionsDraft: number;
  avgAttendanceRate: number;
  institutionId: typeof INSTITUTION_ID;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Subject {
  id: string;
  code: string;
  name: string;
  department: string;
  profYear: ProfYear;
  requiredTheoryHours: number;
  requiredPracticalHours: number;
  deliveredHours: number;
  teacherId: string;
  teacherName: string;
  institutionId: typeof INSTITUTION_ID;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface StudentRecord {
  id: string;
  uid: string;
  rollNumber: string;
  fullName: string;
  profYear: ProfYear;
  batch: string;
  totalHoursScheduled: number;
  totalHoursAttended: number;
  theoryHoursAttended: number;
  practicalHoursAttended: number;
  attendancePercent: number;
  consecutiveAbsences: number;
  standing: StudentStanding;
  staffUids: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AttendanceSession {
  id: string;
  teacherUid: string;
  teacherId: string;
  teacherName: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  profYear: ProfYear;
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
  status: SessionStatus;
  allowStudentSelfMark: boolean;
  checkInCode: string;
  qrRotatingEnabled?: boolean;
  geoFenceRequired?: boolean;
  presentCount: number;
  lateCount: number;
  absentCount: number;
  totalStudents: number;
  notes: string;
  staffUids: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface SessionStudentRecord {
  studentId: string;
  studentUid: string;
  rollNumber: string;
  studentName: string;
  status: StudentAttendanceStatus;
  creditedHours: number;
  selfCheckedIn: boolean;
  checkInTime: string;
  remarks: string;
  teacherUid: string;
  staffUids: string[];
  updatedAt?: unknown;
}

export interface StudentCheckIn {
  uid: string;
  studentId: string;
  rollNumber: string;
  studentName: string;
  checkInCode: string;
  teacherUid: string;
  staffUids: string[];
  checkedInAt?: unknown;
}

export interface AttendanceAlert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  targetStudentId: string;
  targetStudentUid: string;
  targetName: string;
  profYear: ProfYear | 'Faculty';
  subjectCode: string;
  attendancePercent: number;
  message: string;
  resolved: boolean;
  resolvedBy: string;
  staffUids: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface InteractionLog {
  id: string;
  actorUid: string;
  actorName: string;
  actorRole: UserRole;
  actionType: InteractionActionType;
  label: string;
  hourBucket: string;
  staffUids: string[];
  createdAt?: unknown;
}

export interface LearningResource {
  id: string;
  title: string;
  category: ResourceCategory;
  profYear: ProfYear | 'All';
  subjectCode: string;
  description: string;
  scoreSummary: string;
  authorUid: string;
  authorName: string;
  institutionId: typeof INSTITUTION_ID;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface FeedbackItem {
  id: string;
  authorUid: string;
  authorName: string;
  authorRole: UserRole;
  category: FeedbackCategory;
  message: string;
  status: FeedbackStatus;
  staffUids: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}
