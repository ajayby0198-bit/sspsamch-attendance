import {
  AttendanceSession,
  DayOfWeek,
  INSTITUTION_INFO,
  InteractionLog,
  LeaveRequest,
  StudentRecord,
  Subject,
  TeacherProfile,
} from '../types';

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

export interface NcisEligibilityResult {
  pct: number;
  classesNeeded: number;
  safeSkipMargin: number;
  standing: 'eligible' | 'borderline' | 'detained';
}

export function computeNcisEligibility(
  attendedHours: number,
  scheduledHours: number,
  minThreshold = 75
): NcisEligibilityResult {
  const safeSched = Math.max(0, Number(scheduledHours) || 0);
  const safeAtt = Math.max(0, Number(attendedHours) || 0);
  const t = Math.min(0.99, Math.max(0.1, minThreshold / 100));

  if (safeSched === 0) {
    return { pct: 100, classesNeeded: 0, safeSkipMargin: 0, standing: 'eligible' };
  }

  const pct = Math.min(100, Number(((safeAtt / safeSched) * 100).toFixed(1)));
  if (pct >= minThreshold) {
    const safeSkipMargin = Math.max(0, Math.floor(safeAtt / t - safeSched));
    return {
      pct,
      classesNeeded: 0,
      safeSkipMargin,
      standing: 'eligible',
    };
  }

  const rawNeeded = (t * safeSched - safeAtt) / (1 - t);
  const classesNeeded = Math.max(1, Math.ceil(rawNeeded));
  const standing = pct >= minThreshold - 10 ? 'borderline' : 'detained';
  return {
    pct,
    classesNeeded,
    safeSkipMargin: 0,
    standing,
  };
}

export interface ExamRiskForecast {
  hasTargetDate: boolean;
  workingDaysRemaining: number;
  estimatedRemainingHours: number;
  maxPossiblePct: number;
  neededHoursFromRemaining: number;
  neededPctOfRemaining: number;
  riskLevel: 'safe' | 'recoverable' | 'high_risk';
  summary: string;
}

export function countWorkingDaysUntil(targetDateIso: string): number {
  if (!targetDateIso) return 0;
  const target = new Date(`${targetDateIso}T00:00:00`);
  if (Number.isNaN(target.getTime())) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (target <= today) return 0;

  let count = 0;
  const cur = new Date(today.getTime());
  let guard = 0;
  while (cur < target && guard < 400) {
    cur.setDate(cur.getDate() + 1);
    if (cur.getDay() !== 0) {
      // Mon–Sat are working days in BAMS colleges
      count += 1;
    }
    guard += 1;
  }
  return count;
}

export function computeExamRiskForecast(
  student: StudentRecord,
  targetExamDate?: string,
  minThreshold = 75,
  avgHoursPerWorkingDay = 4
): ExamRiskForecast {
  const hasTargetDate = Boolean(targetExamDate && targetExamDate.trim().length >= 8);
  const workingDaysRemaining = hasTargetDate
    ? countWorkingDaysUntil(targetExamDate!)
    : 45;
  const estimatedRemainingHours = workingDaysRemaining * avgHoursPerWorkingDay;
  const t = Math.min(0.99, Math.max(0.1, minThreshold / 100));

  const sched = Math.max(0, student.totalHoursScheduled);
  const att = Math.max(0, student.totalHoursAttended);
  const totalFinalSched = sched + estimatedRemainingHours;
  const maxPossiblePct =
    totalFinalSched > 0
      ? Math.min(100, Number((((att + estimatedRemainingHours) / totalFinalSched) * 100).toFixed(1)))
      : 100;

  const neededTotalAtt = Math.ceil(t * totalFinalSched);
  const neededHoursFromRemaining = Math.max(0, neededTotalAtt - att);
  const neededPctOfRemaining =
    estimatedRemainingHours > 0
      ? Number(((neededHoursFromRemaining / estimatedRemainingHours) * 100).toFixed(1))
      : neededHoursFromRemaining > 0
        ? 101
        : 0;

  let riskLevel: 'safe' | 'recoverable' | 'high_risk' = 'safe';
  let summary = `On track (needs ${Math.min(100, Math.max(0, Math.round(neededPctOfRemaining)))}% of remaining classes).`;

  if (maxPossiblePct < minThreshold || neededPctOfRemaining > 92) {
    riskLevel = 'high_risk';
    summary =
      maxPossiblePct < minThreshold
        ? `Max possible ${maxPossiblePct}% (<${minThreshold}%). Needs condonation / medical leave review.`
        : `Must attend ${neededHoursFromRemaining}h (${Math.round(neededPctOfRemaining)}%) of remaining ${estimatedRemainingHours}h.`;
  } else if (student.attendancePercent < minThreshold || neededPctOfRemaining > 75) {
    riskLevel = 'recoverable';
    summary = `Recoverable: attend ${neededHoursFromRemaining}h of next ${estimatedRemainingHours}h (${Math.round(neededPctOfRemaining)}%).`;
  }

  return {
    hasTargetDate,
    workingDaysRemaining,
    estimatedRemainingHours,
    maxPossiblePct,
    neededHoursFromRemaining,
    neededPctOfRemaining,
    riskLevel,
    summary,
  };
}

function normalizeFuzzyText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getBigrams(str: string): Set<string> {
  const bigrams = new Set<string>();
  const clean = str.replace(/\s+/g, '');
  for (let i = 0; i < clean.length - 1; i++) {
    bigrams.add(clean.slice(i, i + 2));
  }
  return bigrams;
}

export function stringSimilarity(a: string, b: string): number {
  const na = normalizeFuzzyText(a);
  const nb = normalizeFuzzyText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.92;

  const setA = getBigrams(na);
  const setB = getBigrams(nb);
  if (setA.size === 0 || setB.size === 0) return 0;

  let overlap = 0;
  setA.forEach((bg) => {
    if (setB.has(bg)) overlap += 1;
  });
  const dice = (2 * overlap) / (setA.size + setB.size);

  const tokensA = na.split(' ').filter((w) => w.length >= 3);
  const tokensB = nb.split(' ').filter((w) => w.length >= 3);
  let tokenHits = 0;
  tokensA.forEach((ta) => {
    if (tokensB.some((tb) => tb.startsWith(ta.slice(0, 4)) || ta.startsWith(tb.slice(0, 4)))) {
      tokenHits += 1;
    }
  });
  const tokenScore =
    tokensA.length > 0 ? tokenHits / Math.max(tokensA.length, tokensB.length) : 0;

  return Math.max(dice, tokenScore * 0.9);
}

export function findBestFuzzyMatch<T>(
  input: string,
  candidates: T[],
  getLabel: (item: T) => string,
  minScore = 0.56
): { item: T; score: number } | null {
  const cleanIn = normalizeFuzzyText(input);
  if (!cleanIn) return null;
  let best: { item: T; score: number } | null = null;
  for (const cand of candidates) {
    const score = stringSimilarity(cleanIn, getLabel(cand));
    if (score >= minScore && (!best || score > best.score)) {
      best = { item: cand, score };
    }
  }
  return best;
}

export function getTodayDayOfWeek(): DayOfWeek | 'Sun' {
  const idx = new Date().getDay();
  const map: Array<'Sun' | DayOfWeek> = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return map[idx] || 'Mon';
}

export function buildParentWarningWhatsAppText(
  student: StudentRecord,
  minThreshold = 75,
  lang: 'en' | 'hi' = 'hi'
): string {
  const elig = computeNcisEligibility(
    student.totalHoursAttended,
    student.totalHoursScheduled,
    minThreshold
  );
  const today = new Date().toLocaleDateString('en-IN');

  if (lang === 'hi') {
    return [
      `*${INSTITUTION_INFO.name}*`,
      `NCISM ID: ${INSTITUTION_INFO.ncismId} | College Code: ${INSTITUTION_INFO.collegeCode}`,
      `Date: ${today}`,
      ``,
      `Adarniya Abhibhavak (Parent/Guardian),`,
      `Aapke ward *${student.fullName}* (Roll No: *${student.rollNumber}*, ${student.profYear} - ${student.batch}) ki cumulative BAMS attendance abhi *${student.attendancePercent}%* (${student.totalHoursAttended}/${student.totalHoursScheduled} hrs) hai, jo NCISM/MGGAU ke minimum *${minThreshold}%* niyam se kam hai.`,
      elig.classesNeeded > 0
        ? `Exam eligibility ke liye kam se kam *${elig.classesNeeded} lagatar classes (hours)* attend karna anivarya hai.`
        : `Kripya regular attendance banaye rakhein.`,
      ``,
      `Kripya college office / Principal desk se sampark karein aur student ko niyamit class & clinical OPD me bhejein.`,
      `- Principal & Academic Monitoring Desk, SSPSAMCH`,
    ].join('\n');
  }

  return [
    `*${INSTITUTION_INFO.name}*`,
    `NCISM ID: ${INSTITUTION_INFO.ncismId} | University ID: ${INSTITUTION_INFO.universityId}`,
    `Date: ${today}`,
    ``,
    `Dear Parent / Guardian,`,
    `This is an official attendance alert for your ward *${student.fullName}* (Roll No: *${student.rollNumber}*, ${student.profYear} · ${student.batch}).`,
    `Current Attendance: *${student.attendancePercent}%* (${student.totalHoursAttended} / ${student.totalHoursScheduled} hours) — below the mandatory *${minThreshold}%* NCISM examination threshold.`,
    elig.classesNeeded > 0
      ? `Action Required: Your ward must attend at least *${elig.classesNeeded} consecutive class hours* without absence to regain exam eligibility.`
      : `Please ensure regular attendance in upcoming theory and clinical classes.`,
    ``,
    `Kindly meet the Principal / HOD office if medical leave documentation is pending.`,
    `- Academic Monitoring Cell, SSPSAMCH`,
  ].join('\n');
}

export function buildWhatsAppUrl(text: string, phone?: string): string {
  const digits = (phone || '').replace(/[^0-9]/g, '');
  const encoded = encodeURIComponent(text);
  if (digits.length >= 10) {
    const withCountry = digits.length === 10 ? `91${digits}` : digits;
    return `https://wa.me/${withCountry}?text=${encoded}`;
  }
  return `https://wa.me/?text=${encoded}`;
}

export async function exportMonthlySmartPackXlsx(params: {
  students: StudentRecord[];
  subjects: Subject[];
  teachers: TeacherProfile[];
  sessions: AttendanceSession[];
  leaveRequests: LeaveRequest[];
  interactionLogs: InteractionLog[];
  minThreshold: number;
  targetExamDate?: string;
  profFilter?: string;
}): Promise<{ studentsExported: number; subjectsExported: number }> {
  const XLSX = await import('xlsx');
  const filteredStudents = params.students
    .filter((s) => !params.profFilter || params.profFilter === 'All' || s.profYear === params.profFilter)
    .sort((a, b) => b.attendancePercent - a.attendancePercent || a.rollNumber.localeCompare(b.rollNumber));

  const approvedLeaveHoursByStudent = new Map<string, number>();
  params.leaveRequests
    .filter((l) => l.status === 'approved')
    .forEach((l) => {
      approvedLeaveHoursByStudent.set(
        l.studentId,
        Number(((approvedLeaveHoursByStudent.get(l.studentId) || 0) + l.hoursClaimed).toFixed(1))
      );
    });

  // Sheet 1: Monthly Ranked Batch Report Card
  const reportCardRows = filteredStudents.map((s, idx) => {
    const elig = computeNcisEligibility(
      s.totalHoursAttended,
      s.totalHoursScheduled,
      params.minThreshold
    );
    const forecast = computeExamRiskForecast(s, params.targetExamDate, params.minThreshold);
    return {
      Rank: idx + 1,
      'Roll Number': s.rollNumber,
      'Student Name': s.fullName,
      'Prof Year': s.profYear,
      Batch: s.batch,
      'Scheduled Hrs': s.totalHoursScheduled,
      'Theory Hrs': s.theoryHoursAttended,
      'Practical / OPD Hrs': s.practicalHoursAttended,
      'Total Attended Hrs': s.totalHoursAttended,
      'Approved Leave Hrs': approvedLeaveHoursByStudent.get(s.id) || 0,
      'Attendance %': s.attendancePercent,
      'Classes Needed for Threshold': elig.classesNeeded,
      'Safe Skip Margin (Hrs)': elig.safeSkipMargin,
      'NCISM Standing': s.standing.toUpperCase(),
      'Exam Risk Forecast': forecast.riskLevel.toUpperCase(),
    };
  });

  // Sheet 2: Faculty & Subject NCISM Teaching Hours Compliance
  const submittedSessions = params.sessions.filter((s) => s.status === 'submitted');
  const complianceRows = params.subjects.map((sub) => {
    const subSessions = submittedSessions.filter(
      (s) => s.subjectId === sub.id || s.subjectCode === sub.code
    );
    const requiredTotal = (sub.requiredTheoryHours || 0) + (sub.requiredPracticalHours || 0);
    const delivered = Math.max(
      sub.deliveredHours || 0,
      Number(subSessions.reduce((acc, s) => acc + s.durationHours, 0).toFixed(1))
    );
    const completionPct =
      requiredTotal > 0 ? Math.min(100, Number(((delivered / requiredTotal) * 100).toFixed(1))) : 0;
    const avgClassAttendance =
      subSessions.length > 0
        ? Number(
            (
              subSessions.reduce(
                (acc, s) =>
                  acc +
                  (s.totalStudents > 0
                    ? ((s.presentCount + s.lateCount * 0.5) / s.totalStudents) * 100
                    : 0),
                0
              ) / subSessions.length
            ).toFixed(1)
          )
        : 0;
    return {
      'Subject Code': sub.code,
      'Subject Name': sub.name,
      Department: sub.department,
      'Prof Year': sub.profYear,
      'Assigned Faculty': sub.teacherName,
      'Required Theory Hrs': sub.requiredTheoryHours,
      'Required Practical Hrs': sub.requiredPracticalHours,
      'Total NCISM Required Hrs': requiredTotal,
      'Delivered Hrs': delivered,
      'Remaining Hrs': Math.max(0, Number((requiredTotal - delivered).toFixed(1))),
      'Syllabus Completion %': completionPct,
      'Classes Logged': subSessions.length,
      'Avg Class Attendance %': avgClassAttendance,
    };
  });

  // Sheet 3: Faculty Summary & Recent Audit Trail
  const facultyRows = params.teachers.map((t) => {
    const mySess = submittedSessions.filter((s) => s.teacherId === t.id || s.teacherName === t.fullName);
    const totalHrs = Number(mySess.reduce((acc, s) => acc + s.durationHours, 0).toFixed(1));
    return {
      'Employee Code': t.employeeCode,
      'Faculty Name': t.fullName,
      Designation: t.designation,
      Department: t.department,
      'Assigned Subjects': t.assignedSubjects.join(', '),
      'Submitted Classes': Math.max(t.sessionsSubmitted, mySess.length),
      'Draft Pending': t.sessionsDraft,
      'Delivered Hours Logged': totalHrs,
      'Avg Attendance Rate %': t.avgAttendanceRate,
    };
  });

  const auditRows = params.interactionLogs.slice(0, 100).map((log) => ({
    'Log ID': log.id,
    'Hour Bucket': log.hourBucket,
    'Actor Name': log.actorName,
    Role: log.actorRole,
    Action: log.actionType,
    Detail: log.label,
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      reportCardRows.length > 0 ? reportCardRows : [{ Info: 'No student records available.' }]
    ),
    'Monthly Report Card'
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      complianceRows.length > 0 ? complianceRows : [{ Info: 'No subjects configured.' }]
    ),
    'NCISM Subject Compliance'
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      facultyRows.length > 0 ? facultyRows : [{ Info: 'No faculty records available.' }]
    ),
    'Faculty Workload'
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      auditRows.length > 0 ? auditRows : [{ Info: 'No audit logs recorded yet.' }]
    ),
    'Audit Trail'
  );

  const monthTag = new Date().toISOString().slice(0, 7);
  XLSX.writeFile(wb, `SSPSAMCH_Monthly_Smart_Report_Pack_${monthTag}.xlsx`);

  return {
    studentsExported: filteredStudents.length,
    subjectsExported: params.subjects.length,
  };
}
