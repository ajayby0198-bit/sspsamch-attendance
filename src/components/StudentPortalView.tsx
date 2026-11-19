import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  BookOpen,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  KeyRound,
  MapPin,
  Printer,
  Send,
  ShieldAlert,
  Sparkles,
  Stethoscope,
} from 'lucide-react';
import { db } from '../firebase';
import { submitLeaveRequest, submitStudentCheckIn } from '../services/bamsFirestore';
import {
  AttendanceSession,
  ClinicalRotation,
  INSTITUTION_INFO,
  LearningResource,
  LeaveRequest,
  LeaveType,
  MasterConfig,
  SessionStudentRecord,
  StudentRecord,
  Subject,
  UserProfile,
} from '../types';
import {
  computeExamRiskForecast,
  computeNcisEligibility,
  haversineMeters,
} from '../utils/smartHelpers';
import { RolePieChartCard } from './RolePieChartCard';

interface StudentPortalViewProps {
  userProfile: UserProfile;
  students: StudentRecord[];
  sessions: AttendanceSession[];
  subjects: Subject[];
  resources: LearningResource[];
  masterConfig?: MasterConfig | null;
  leaveRequests?: LeaveRequest[];
  clinicalRotations?: ClinicalRotation[];
  staffUids?: string[];
  isAdminPreview?: boolean;
  isParentMode?: boolean;
  minThreshold?: number;
}

export const StudentPortalView: React.FC<StudentPortalViewProps> = ({
  userProfile,
  students,
  sessions,
  subjects,
  resources,
  masterConfig,
  leaveRequests = [],
  clinicalRotations = [],
  staffUids = [],
  isAdminPreview,
  isParentMode,
  minThreshold = 75,
}) => {
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [codeInputs, setCodeInputs] = useState<Record<string, string>>({});
  const [checkedInIds, setCheckedInIds] = useState<Record<string, boolean>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [sessionHistory, setSessionHistory] = useState<
    Array<{ session: AttendanceSession; record: SessionStudentRecord }>
  >([]);

  // Medical / Duty Leave form state
  const todayIso = new Date().toISOString().slice(0, 10);
  const [leaveType, setLeaveType] = useState<LeaveType>('medical');
  const [leaveStart, setLeaveStart] = useState(todayIso);
  const [leaveEnd, setLeaveEnd] = useState(todayIso);
  const [leaveHours, setLeaveHours] = useState(4);
  const [leaveReason, setLeaveReason] = useState('');
  const [submittingLeave, setSubmittingLeave] = useState(false);

  const studentRecord = useMemo(() => {
    if ((isAdminPreview || isParentMode) && selectedStudentId) {
      const picked = students.find((s) => s.id === selectedStudentId);
      if (picked) return picked;
    }
    const byUid = students.find((s) => s.uid === userProfile.uid);
    if (byUid) return byUid;
    const byRoll = students.find(
      (s) =>
        userProfile.rollOrEmpId &&
        s.rollNumber.toLowerCase() === userProfile.rollOrEmpId.toLowerCase()
    );
    if (byRoll) return byRoll;
    if ((isAdminPreview || isParentMode) && students.length > 0) return students[0];
    return null;
  }, [students, selectedStudentId, userProfile.uid, userProfile.rollOrEmpId, isAdminPreview, isParentMode]);

  useEffect(() => {
    let cancelled = false;
    const loadHistory = async () => {
      if (!studentRecord) {
        setSessionHistory([]);
        return;
      }
      const relevantSessions = sessions
        .filter((s) => s.profYear === studentRecord.profYear)
        .sort(
          (a, b) =>
            b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime)
        );
      const entries: Array<{ session: AttendanceSession; record: SessionStudentRecord }> = [];
      const linkedRoll = (userProfile.rollOrEmpId || '').trim().toUpperCase();
      const useRollQuery =
        !isAdminPreview &&
        linkedRoll.length >= 2 &&
        studentRecord.rollNumber.toUpperCase() === linkedRoll;

      await Promise.all(
        relevantSessions.slice(0, 60).map(async (sess) => {
          try {
            const q = isAdminPreview
              ? query(
                  collection(db, 'attendanceSessions', sess.id, 'records'),
                  where('studentId', '==', studentRecord.id)
                )
              : useRollQuery
                ? query(
                    collection(db, 'attendanceSessions', sess.id, 'records'),
                    where('rollNumber', '==', linkedRoll)
                  )
                : query(
                    collection(db, 'attendanceSessions', sess.id, 'records'),
                    where('studentUid', '==', userProfile.uid)
                  );
            const snap = await getDocs(q);
            if (!snap.empty) {
              entries.push({ session: sess, record: snap.docs[0].data() as SessionStudentRecord });
            }
          } catch {
            // Skip sessions without matching record access
          }
        })
      );
      if (!cancelled) {
        entries.sort(
          (a, b) =>
            b.session.date.localeCompare(a.session.date) ||
            b.session.startTime.localeCompare(a.session.startTime)
        );
        setSessionHistory(entries);
      }
    };
    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [studentRecord, sessions, userProfile.uid, userProfile.rollOrEmpId, isAdminPreview]);

  const applyDatePreset = (days: number | 'all') => {
    if (days === 'all') {
      setDateFrom('');
      setDateTo('');
      return;
    }
    const todayStr = new Date().toISOString().slice(0, 10);
    const fromStr = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    setDateFrom(fromStr);
    setDateTo(todayStr);
  };

  const dateFilteredHistory = useMemo(() => {
    return sessionHistory.filter(({ session }) => {
      if (dateFrom && session.date < dateFrom) return false;
      if (dateTo && session.date > dateTo) return false;
      return true;
    });
  }, [sessionHistory, dateFrom, dateTo]);

  const dateRangeSummary = useMemo(() => {
    const scheduled = dateFilteredHistory.reduce((acc, h) => acc + h.session.durationHours, 0);
    const attended = dateFilteredHistory.reduce((acc, h) => acc + h.record.creditedHours, 0);
    const presentCount = dateFilteredHistory.filter((h) => h.record.status === 'present').length;
    const lateCount = dateFilteredHistory.filter((h) => h.record.status === 'late').length;
    const absentCount = dateFilteredHistory.filter((h) => h.record.status === 'absent').length;
    const pct = scheduled > 0 ? Number(((attended / scheduled) * 100).toFixed(1)) : 0;
    return { scheduled, attended, presentCount, lateCount, absentCount, pct };
  }, [dateFilteredHistory]);

  const openCheckInSessions = useMemo(
    () =>
      sessions.filter(
        (s) =>
          s.status === 'draft' &&
          s.allowStudentSelfMark &&
          (!studentRecord || s.profYear === studentRecord.profYear)
      ),
    [sessions, studentRecord]
  );

  const batchTopicHistory = useMemo(() => {
    const targetProf = studentRecord?.profYear || '1st Prof';
    return sessions
      .filter((s) => {
        if (s.profYear !== targetProf || s.status !== 'submitted') return false;
        if (dateFrom && s.date < dateFrom) return false;
        if (dateTo && s.date > dateTo) return false;
        return true;
      })
      .slice(0, 6);
  }, [sessions, studentRecord, dateFrom, dateTo]);

  const relevantResources = useMemo(() => {
    const targetProf = studentRecord?.profYear || '1st Prof';
    return resources.filter((r) => r.profYear === targetProf || r.profYear === 'All');
  }, [resources, studentRecord]);

  const studentSubjects = useMemo(() => {
    const targetProf = studentRecord?.profYear || '1st Prof';
    return subjects.filter((s) => s.profYear === targetProf);
  }, [subjects, studentRecord]);

  const subjectChartData = useMemo(() => {
    const ratio = studentRecord ? studentRecord.attendancePercent / 100 : 0.85;
    return studentSubjects.map((sub) => ({
      code: sub.code,
      delivered: sub.deliveredHours,
      attendedEst: Number((sub.deliveredHours * ratio).toFixed(1)),
    }));
  }, [studentSubjects, studentRecord]);

  const studentPieData = useMemo(() => {
    if (!studentRecord) return [];
    const missed = Math.max(
      0,
      Number((studentRecord.totalHoursScheduled - studentRecord.totalHoursAttended).toFixed(1))
    );
    return [
      {
        name: 'Theory Attended (hrs)',
        value: Number(studentRecord.theoryHoursAttended.toFixed(1)),
        color: '#14533c',
      },
      {
        name: 'Practical / OPD (hrs)',
        value: Number(studentRecord.practicalHoursAttended.toFixed(1)),
        color: '#c6923a',
      },
      {
        name: 'Missed / Absent (hrs)',
        value: missed,
        color: '#dc2626',
      },
    ];
  }, [studentRecord]);

  const eligibility = useMemo(() => {
    if (!studentRecord) return null;
    return computeNcisEligibility(
      studentRecord.totalHoursAttended,
      studentRecord.totalHoursScheduled,
      minThreshold
    );
  }, [studentRecord, minThreshold]);

  const examForecast = useMemo(() => {
    if (!studentRecord) return null;
    return computeExamRiskForecast(studentRecord, masterConfig?.targetExamDate, minThreshold);
  }, [studentRecord, masterConfig?.targetExamDate, minThreshold]);

  const subjectWiseBreakdown = useMemo(() => {
    const map = new Map<
      string,
      {
        code: string;
        name: string;
        scheduled: number;
        attended: number;
        theoryHrs: number;
        practicalHrs: number;
        classes: number;
      }
    >();
    sessionHistory.forEach(({ session, record }) => {
      const key = session.subjectCode || session.subjectId;
      const cur = map.get(key) || {
        code: session.subjectCode,
        name: session.subjectName,
        scheduled: 0,
        attended: 0,
        theoryHrs: 0,
        practicalHrs: 0,
        classes: 0,
      };
      cur.scheduled = Number((cur.scheduled + session.durationHours).toFixed(1));
      cur.attended = Number((cur.attended + record.creditedHours).toFixed(1));
      if ((session.sessionType || '').toLowerCase().includes('theory')) {
        cur.theoryHrs = Number((cur.theoryHrs + record.creditedHours).toFixed(1));
      } else {
        cur.practicalHrs = Number((cur.practicalHrs + record.creditedHours).toFixed(1));
      }
      cur.classes += 1;
      map.set(key, cur);
    });
    return Array.from(map.values())
      .map((item) => {
        const pct =
          item.scheduled > 0
            ? Math.min(100, Number(((item.attended / item.scheduled) * 100).toFixed(1)))
            : 100;
        const subElig = computeNcisEligibility(item.attended, item.scheduled, minThreshold);
        return { ...item, pct, classesNeeded: subElig.classesNeeded };
      })
      .sort((a, b) => a.pct - b.pct);
  }, [sessionHistory, minThreshold]);

  const myLeaveRequests = useMemo(() => {
    if (!studentRecord) return [];
    return leaveRequests.filter(
      (l) =>
        l.studentId === studentRecord.id ||
        l.rollNumber.toUpperCase() === studentRecord.rollNumber.toUpperCase()
    );
  }, [leaveRequests, studentRecord]);

  const myClinicalRotations = useMemo(() => {
    if (!studentRecord) return [];
    return clinicalRotations.filter(
      (rot) => rot.profYear === studentRecord.profYear || rot.batch === studentRecord.batch
    );
  }, [clinicalRotations, studentRecord]);

  const handleLeaveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentRecord || !leaveReason.trim()) return;
    setSubmittingLeave(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await submitLeaveRequest({
        student: studentRecord,
        actorUid: userProfile.uid,
        leaveType,
        startDate: leaveStart,
        endDate: leaveEnd,
        hoursClaimed: leaveHours,
        reason: leaveReason.trim(),
        staffUids,
      });
      setLeaveReason('');
      setSuccessMsg(
        'Leave application submitted to Principal / Admin desk for condonation review.'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to submit leave request.');
    } finally {
      setSubmittingLeave(false);
    }
  };

  const handleCheckIn = async (session: AttendanceSession) => {
    const rawEntered = (codeInputs[session.id] || '').trim();
    const codeMatch = rawEntered.match(/CODE:([A-Za-z0-9]+)/i);
    const entered = (codeMatch ? codeMatch[1] : rawEntered).trim().toUpperCase();

    if (!entered) {
      setErrorMsg('Enter the live classroom code or scan QR shown by your teacher.');
      return;
    }
    if (entered !== session.checkInCode.trim().toUpperCase()) {
      setErrorMsg('Invalid or expired classroom code. Check the latest rotating QR code.');
      return;
    }

    setSubmittingId(session.id);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const requireGeo = Boolean(session.geoFenceRequired ?? masterConfig?.geoFenceEnabled);
      let geoNote = '';
      if (requireGeo) {
        if (!navigator.geolocation) {
          setErrorMsg('Campus GPS Geo-Fence is active, but GPS is unavailable on this browser.');
          setSubmittingId(null);
          return;
        }
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
          });
        }).catch(() => null);

        if (!position) {
          setErrorMsg(
            'Campus GPS verification required: please allow Location permission in your browser to check in.'
          );
          setSubmittingId(null);
          return;
        }

        const cLat = masterConfig?.campusLat ?? 27.674;
        const cLng = masterConfig?.campusLng ?? 79.558;
        const allowedRadius = masterConfig?.campusRadiusMeters ?? 250;
        const dist = haversineMeters(
          position.coords.latitude,
          position.coords.longitude,
          cLat,
          cLng
        );
        if (dist > allowedRadius) {
          setErrorMsg(
            `Outside Campus Geo-Fence (${dist}m away; allowed ${allowedRadius}m). Attendance check-in is only allowed inside SSPSAMCH campus.`
          );
          setSubmittingId(null);
          return;
        }
        geoNote = ` · GPS verified (${dist}m inside campus)`;
      }

      await submitStudentCheckIn({
        session,
        uid: userProfile.uid,
        studentId: studentRecord?.id || `stu_${userProfile.uid}`,
        rollNumber: studentRecord?.rollNumber || userProfile.rollOrEmpId || 'BAMS-STU',
        studentName: studentRecord?.fullName || userProfile.displayName,
        codeInput: entered,
      });
      setCheckedInIds((prev) => ({ ...prev, [session.id]: true }));
      setSuccessMsg(
        `Check-in verified for ${session.subjectCode} (${session.durationHours}h)${geoNote}. Teacher will finalize the register.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to submit check-in.');
    } finally {
      setSubmittingId(null);
    }
  };

  const percent = studentRecord?.attendancePercent ?? 0;
  const isEligible = percent >= minThreshold;

  return (
    <div className="space-y-6">
      <div className="hidden print:block border-b border-slate-300 pb-4 mb-4">
        <h1 className="text-lg font-bold text-slate-900">{INSTITUTION_INFO.name}</h1>
        <p className="text-xs text-slate-600">
          Student &amp; Parent Periodic Report Card · NCISM {INSTITUTION_INFO.ncismId}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            {isParentMode
              ? 'Parent Report Card & Ward Attendance'
              : 'Student Attendance & BAMS Progress Portal'}
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            {studentRecord
              ? `${studentRecord.fullName} · ${studentRecord.rollNumber} · ${studentRecord.profYear} (${studentRecord.batch})`
              : `${userProfile.displayName} · ${userProfile.rollOrEmpId || 'Pending Roster Enrollment'}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {(isAdminPreview || isParentMode) && students.length > 1 && (
            <select
              aria-label="Select student or ward"
              value={studentRecord?.id || ''}
              onChange={(e) => setSelectedStudentId(e.target.value)}
              className="px-2.5 py-1.5 text-xs font-medium bg-white border border-amber-900/20 rounded-lg text-stone-800"
            >
              {students.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.rollNumber} — {st.fullName} ({st.profYear})
                </option>
              ))}
            </select>
          )}
          {studentRecord && (
            <span
              className={`text-xs font-semibold tabular-nums ${
                isEligible ? 'text-emerald-800' : 'text-red-700'
              }`}
            >
              {isEligible
                ? `NCISM Eligible (≥ ${minThreshold}%)`
                : `Below ${minThreshold}% NCISM Threshold`}
            </span>
          )}
          <button
            type="button"
            onClick={() => window.print()}
            className="print:hidden inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 btn-3d-secondary border border-slate-200 rounded-lg whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5" />
            Print Report Card
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-800">
          {errorMsg}
        </div>
      )}
      {successMsg && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-xs text-emerald-900">
          {successMsg}
        </div>
      )}

      {/* Live Classroom Check-In Section (Students only) */}
      {!isParentMode && (
        <section className="surface-3d rounded-xl p-5 sm:p-6 space-y-4 print:hidden">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Active Class Sessions Open for Self Check-In
              </h2>
              <p className="text-xs text-slate-500">
                Enter the classroom check-in code provided by your faculty during draft window
              </p>
            </div>
            <KeyRound className="w-4 h-4 text-emerald-700 shrink-0" />
          </div>

          {openCheckInSessions.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {openCheckInSessions.map((sess) => {
                const done = checkedInIds[sess.id];
                return (
                  <div
                    key={sess.id}
                    className="border border-slate-200 rounded-lg p-4 space-y-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {sess.subjectCode}: {sess.subjectName}
                      </p>
                      <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
                        {sess.date} · {sess.startTime}-{sess.endTime} ({sess.durationHours}h) ·{' '}
                        {sess.room}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-600">{sess.teacherName}</p>
                    </div>

                    {done ? (
                      <div className="inline-flex items-center gap-2 text-xs font-medium text-emerald-800">
                        <CheckCircle2 className="w-4 h-4" />
                        Check-in recorded in teacher&apos;s draft register
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {(sess.geoFenceRequired ?? masterConfig?.geoFenceEnabled) && (
                          <p className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-800">
                            <MapPin className="w-3 h-3" />
                            Campus GPS Check Active ({masterConfig?.campusRadiusMeters ?? 250}m radius)
                          </p>
                        )}
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            maxLength={64}
                            placeholder="Live code or QR text"
                            value={codeInputs[sess.id] || ''}
                            onChange={(e) =>
                              setCodeInputs((prev) => ({ ...prev, [sess.id]: e.target.value }))
                            }
                            className="flex-1 min-w-0 px-3 py-2 text-sm font-mono tracking-wider border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
                          />
                          <button
                            type="button"
                            disabled={submittingId === sessionIdOrFallback(sess.id)}
                            onClick={() => handleCheckIn(sess)}
                            className="px-4 py-2 text-xs font-medium text-white bg-emerald-800 hover:bg-emerald-900 disabled:opacity-60 rounded-lg whitespace-nowrap shrink-0"
                          >
                            {submittingId === sess.id ? 'Verifying...' : 'Check In'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="border border-dashed border-slate-200 rounded-lg p-6 text-center text-xs text-slate-500">
              No open classroom check-in windows for your Prof Year right now.
            </div>
          )}
        </section>
      )}

      {/* Personal Hours Breakdown */}
      {studentRecord ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="surface-3d-interactive rounded-xl p-5">
              <span className="text-xs font-medium text-slate-500">Overall Attendance</span>
              <p
                className={`mt-2 text-2xl font-bold font-mono tabular-nums ${
                  isEligible ? 'text-emerald-800' : 'text-red-700'
                }`}
              >
                {studentRecord.attendancePercent}%
              </p>
              <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
                {studentRecord.totalHoursAttended} / {studentRecord.totalHoursScheduled} hrs
              </p>
            </div>

            <div className="surface-3d-interactive rounded-xl p-5">
              <span className="text-xs font-medium text-slate-500">Theory Hours</span>
              <p className="mt-2 text-2xl font-bold text-slate-900 font-mono tabular-nums">
                {studentRecord.theoryHoursAttended} hrs
              </p>
              <p className="mt-1 text-xs text-slate-500">Lectures &amp; Samhita classes</p>
            </div>

            <div className="surface-3d-interactive rounded-xl p-5">
              <span className="text-xs font-medium text-slate-500">Practical &amp; Clinical</span>
              <p className="mt-2 text-2xl font-bold text-slate-900 font-mono tabular-nums">
                {studentRecord.practicalHoursAttended} hrs
              </p>
              <p className="mt-1 text-xs text-slate-500">Dissection, Lab &amp; OPD/IPD</p>
            </div>

            <div className="surface-3d-interactive rounded-xl p-5">
              <span className="text-xs font-medium text-slate-500">Consecutive Absences</span>
              <p className="mt-2 text-2xl font-bold text-slate-900 font-mono tabular-nums">
                {studentRecord.consecutiveAbsences}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Standing: <span className="capitalize font-medium">{studentRecord.standing}</span>
              </p>
            </div>
          </div>

          {/* NCISM Exam Eligibility Predictor & Smart Risk Meter */}
          {eligibility && examForecast && (
            <section
              className={`rounded-2xl p-5 border flex flex-col lg:flex-row lg:items-center justify-between gap-4 ${
                eligibility.standing === 'eligible'
                  ? 'bg-emerald-50/80 border-emerald-200'
                  : eligibility.standing === 'borderline'
                    ? 'bg-amber-50/80 border-amber-200'
                    : 'bg-red-50/80 border-red-200'
              }`}
            >
              <div className="space-y-1">
                <p className="text-xs font-bold uppercase tracking-wide flex items-center gap-1.5 text-stone-900">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-800" />
                  NCISM {minThreshold}% Exam Eligibility Predictor
                </p>
                {eligibility.classesNeeded > 0 ? (
                  <p className="text-sm font-bold text-red-800">
                    Attend the next{' '}
                    <span className="font-mono underline">{eligibility.classesNeeded} class hour(s)</span>{' '}
                    continuously to reach {minThreshold}% NCISM exam eligibility.
                  </p>
                ) : (
                  <p className="text-sm font-bold text-emerald-900">
                    Safe for MGGAU University Exam — you have a buffer of{' '}
                    <span className="font-mono">{eligibility.safeSkipMargin} hour(s)</span> above{' '}
                    {minThreshold}%.
                  </p>
                )}
                <p className="text-xs text-stone-700">{examForecast.summary}</p>
              </div>
              <div className="flex items-center gap-4 text-xs font-mono tabular-nums shrink-0">
                <div className="bg-white/90 border border-amber-900/15 rounded-xl px-3.5 py-2 text-center">
                  <span className="block text-[10px] font-sans text-stone-500">Max Possible</span>
                  <strong className="text-sm text-stone-900">{examForecast.maxPossiblePct}%</strong>
                </div>
                <div className="bg-white/90 border border-amber-900/15 rounded-xl px-3.5 py-2 text-center">
                  <span className="block text-[10px] font-sans text-stone-500">Forecast</span>
                  <strong
                    className={`text-xs uppercase font-sans ${
                      examForecast.riskLevel === 'high_risk'
                        ? 'text-red-700'
                        : examForecast.riskLevel === 'recoverable'
                          ? 'text-amber-700'
                          : 'text-emerald-800'
                    }`}
                  >
                    {examForecast.riskLevel.replace('_', ' ')}
                  </strong>
                </div>
              </div>
            </section>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5">
              <RolePieChartCard
                title={isParentMode ? "Ward Attendance Share (Pie Chart)" : "Personal Attendance Pie Chart"}
                subtitle={`${studentRecord.fullName} · ${studentRecord.totalHoursAttended} / ${studentRecord.totalHoursScheduled} hrs`}
                data={studentPieData}
                centerValue={`${studentRecord.attendancePercent}%`}
                centerLabel="Attendance"
                className="h-full"
                emptyMessage="No attendance hours recorded yet."
              />
            </div>
            <div className="lg:col-span-7 surface-3d-interactive rounded-xl p-5 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Subject-Wise Hours Progress ({studentRecord.profYear})
                  </h2>
                  <p className="text-xs text-slate-500">
                    Delivered curriculum hours vs attended hours
                  </p>
                </div>
                <Clock className="w-4 h-4 text-emerald-700" />
              </div>
              <div className="h-60 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={subjectChartData} margin={{ top: 10, right: 12, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="code" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} />
                    <Tooltip />
                    <Bar dataKey="attendedEst" name="Attended Hours" fill="#065f46" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="delivered" name="Delivered Hours" fill="#cbd5e1" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Class Topics & Missed Topic Revision */}
          <div className="surface-3d-interactive rounded-xl p-5 sm:p-6 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Class Topics &amp; Study Updates
                </h2>
                <p className="text-xs text-slate-500">
                  Topics covered &amp; internal assessment notices for {studentRecord.profYear}
                </p>
              </div>
              <BookOpen className="w-4 h-4 text-emerald-700" />
            </div>
            <div className="divide-y divide-slate-100 flex-1 overflow-y-auto max-h-60">
              {batchTopicHistory.map((sess) => (
                <div key={sess.id} className="py-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900">
                      {sess.subjectCode} · {sess.activityType}
                    </span>
                    <span className="font-mono text-slate-500 tabular-nums">{sess.date}</span>
                  </div>
                  <p className="mt-0.5 text-slate-600">{sess.topicTaught || sess.subjectName}</p>
                </div>
              ))}
              {relevantResources.map((res) => (
                <div key={res.id} className="py-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-emerald-800">{res.title}</span>
                    <span className="font-mono text-slate-500">{res.scoreSummary}</span>
                  </div>
                  <p className="mt-0.5 text-slate-600">{res.description}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Date-Range Personal Attendance Log */}
          <section className="surface-3d rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-stone-900">
                  Date-Range Attendance Progress &amp; Class History
                </h2>
                <p className="text-xs text-stone-600">
                  Filter your attended hours, present/late/absent entries, and topics by date range
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 p-1 surface-3d-inset rounded-lg">
                  <button
                    type="button"
                    onClick={() => applyDatePreset(7)}
                    className="px-2.5 py-1 text-xs font-medium rounded-md text-stone-700 hover:bg-white"
                  >
                    7 Days
                  </button>
                  <button
                    type="button"
                    onClick={() => applyDatePreset(30)}
                    className="px-2.5 py-1 text-xs font-medium rounded-md text-stone-700 hover:bg-white"
                  >
                    30 Days
                  </button>
                  <button
                    type="button"
                    onClick={() => applyDatePreset('all')}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md ${
                      !dateFrom && !dateTo ? 'bg-white text-stone-900 shadow-xs' : 'text-stone-700'
                    }`}
                  >
                    All
                  </button>
                </div>

                <div className="flex items-center gap-2 surface-3d rounded-lg px-2.5 py-1.5 text-xs">
                  <Calendar className="w-3.5 h-3.5 text-amber-800 shrink-0" />
                  <input
                    type="date"
                    aria-label="Student progress from date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="font-mono text-xs text-stone-700 bg-transparent focus:outline-none"
                  />
                  <span className="text-stone-400">–</span>
                  <input
                    type="date"
                    aria-label="Student progress to date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="font-mono text-xs text-stone-700 bg-transparent focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="surface-3d-inset rounded-xl p-3">
                <span className="text-stone-500">Range Attendance</span>
                <p className="mt-1 text-lg font-bold font-mono tabular-nums text-emerald-900">
                  {dateRangeSummary.pct}%
                </p>
              </div>
              <div className="surface-3d-inset rounded-xl p-3">
                <span className="text-stone-500">Hours Credited</span>
                <p className="mt-1 text-lg font-bold font-mono tabular-nums text-stone-900">
                  {dateRangeSummary.attended.toFixed(1)} / {dateRangeSummary.scheduled.toFixed(1)}h
                </p>
              </div>
              <div className="surface-3d-inset rounded-xl p-3">
                <span className="text-stone-500">Present / Late</span>
                <p className="mt-1 text-lg font-bold font-mono tabular-nums text-emerald-900">
                  {dateRangeSummary.presentCount}P · {dateRangeSummary.lateCount}L
                </p>
              </div>
              <div className="surface-3d-inset rounded-xl p-3">
                <span className="text-stone-500">Absences in Range</span>
                <p className="mt-1 text-lg font-bold font-mono tabular-nums text-red-700">
                  {dateRangeSummary.absentCount}
                </p>
              </div>
            </div>

            <div className="overflow-x-auto border border-amber-900/15 rounded-xl bg-white/80">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-amber-950/5 border-b border-amber-900/15 text-xs font-semibold text-stone-700">
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Subject &amp; Topic</th>
                    <th className="py-2.5 px-3">Format</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-right">Credited Hrs</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-amber-900/10 text-xs">
                  {dateFilteredHistory.map(({ session, record }) => (
                    <tr key={session.id} className="hover:bg-amber-50/40">
                      <td className="py-2.5 px-3 font-mono text-stone-600 tabular-nums whitespace-nowrap">
                        {session.date}
                      </td>
                      <td className="py-2.5 px-3">
                        <p className="font-semibold text-stone-900">
                          {session.subjectCode} · {session.subjectName}
                        </p>
                        <p className="text-stone-500 truncate max-w-md">
                          {session.topicTaught || session.activityType}
                        </p>
                      </td>
                      <td className="py-2.5 px-3 text-stone-600 whitespace-nowrap">
                        {session.sessionType}
                      </td>
                      <td className="py-2.5 px-3 capitalize font-semibold">
                        <span
                          className={
                            record.status === 'present'
                              ? 'text-emerald-800'
                              : record.status === 'late'
                                ? 'text-amber-700'
                                : 'text-red-700'
                          }
                        >
                          {record.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-stone-900">
                        {record.creditedHours.toFixed(1)}h / {session.durationHours.toFixed(1)}h
                      </td>
                    </tr>
                  ))}
                  {dateFilteredHistory.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-stone-500">
                        No session entries recorded within the selected date range.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Subject-Wise Attendance Breakdown (From Actual Class Registers) */}
          {subjectWiseBreakdown.length > 0 && (
            <section className="surface-3d rounded-2xl p-5 sm:p-6 space-y-4">
              <div>
                <h2 className="text-base font-bold text-stone-900">
                  Subject-Wise NCISM Attendance Breakdown
                </h2>
                <p className="text-xs text-stone-600">
                  Exact Theory vs Practical hours credited per BAMS subject from submitted registers
                </p>
              </div>
              <div className="overflow-x-auto border border-amber-900/15 rounded-xl bg-white/90">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-amber-950/5 border-b border-amber-900/15 font-semibold text-stone-700">
                      <th className="py-2.5 px-3">Subject</th>
                      <th className="py-2.5 px-3 text-right">Theory</th>
                      <th className="py-2.5 px-3 text-right">Practical</th>
                      <th className="py-2.5 px-3 text-right">Attended / Total</th>
                      <th className="py-2.5 px-3 text-right">Subject %</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-900/10">
                    {subjectWiseBreakdown.map((sub) => (
                      <tr key={sub.code} className="hover:bg-amber-50/40">
                        <td className="py-2.5 px-3">
                          <p className="font-semibold text-stone-900">
                            {sub.code} · {sub.name}
                          </p>
                          <p className="text-[11px] text-stone-500">{sub.classes} class(es)</p>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-stone-700">
                          {sub.theoryHrs}h
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-stone-700">
                          {sub.practicalHrs}h
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-stone-900">
                          {sub.attended} / {sub.scheduled}h
                        </td>
                        <td
                          className={`py-2.5 px-3 text-right font-mono font-bold tabular-nums ${
                            sub.pct >= minThreshold ? 'text-emerald-800' : 'text-red-700'
                          }`}
                        >
                          {sub.pct}%
                        </td>
                        <td className="py-2.5 px-3 text-right text-[11px]">
                          {sub.classesNeeded > 0 ? (
                            <span className="text-red-700 font-semibold">
                              Need +{sub.classesNeeded}h
                            </span>
                          ) : (
                            <span className="text-emerald-800 font-semibold">Eligible</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Clinical OPD / IPD Posting Schedule */}
          {myClinicalRotations.length > 0 && (
            <section className="surface-3d rounded-2xl p-5 sm:p-6 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-bold text-stone-900 flex items-center gap-2">
                    <Stethoscope className="w-4 h-4 text-emerald-800" />
                    Clinical OPD / IPD Ward Postings ({studentRecord.profYear})
                  </h2>
                  <p className="text-xs text-stone-600">
                    Active and upcoming hospital department rotations assigned for your batch
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {myClinicalRotations.map((rot) => (
                  <div
                    key={rot.id}
                    className="border border-amber-900/15 bg-white/90 rounded-xl p-4 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-bold text-stone-900">{rot.wardName}</span>
                      <span className="text-[11px] font-bold uppercase text-emerald-800">
                        {rot.status}
                      </span>
                    </div>
                    <p className="text-xs text-stone-600">
                      {rot.department} · {rot.groupLabel} · Supervisor: {rot.supervisorName}
                    </p>
                    <p className="text-[11px] font-mono text-stone-500 tabular-nums">
                      {rot.startDate} → {rot.endDate} · {rot.sessionsLogged} round(s) logged
                    </p>
                    {rot.notes && <p className="text-[11px] text-stone-500">{rot.notes}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Medical & Duty Leave Request Portal */}
          <section className="surface-3d rounded-2xl p-5 sm:p-6 space-y-4 print:hidden">
            <div>
              <h2 className="text-base font-bold text-stone-900 flex items-center gap-2">
                <FileText className="w-4 h-4 text-emerald-800" />
                Medical &amp; Duty Leave (NSS / Camp / Sports) Application
              </h2>
              <p className="text-xs text-stone-600">
                Submit medical certificate or official duty leave request for Principal / Admin condonation approval
              </p>
            </div>

            {!isAdminPreview && (
              <form
                onSubmit={handleLeaveSubmit}
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end bg-white/80 p-4 rounded-xl border border-amber-900/15"
              >
                <div>
                  <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                    Leave Category
                  </label>
                  <select
                    value={leaveType}
                    onChange={(e) => setLeaveType(e.target.value as LeaveType)}
                    className="w-full px-2.5 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                  >
                    <option value="medical">Medical Leave</option>
                    <option value="duty_nss">Duty Leave (NSS / Camp)</option>
                    <option value="academic_seminar">Academic Seminar / CME</option>
                    <option value="sports_cultural">Sports / Cultural</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                    From Date
                  </label>
                  <input
                    type="date"
                    required
                    value={leaveStart}
                    onChange={(e) => setLeaveStart(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs font-mono bg-white border border-amber-900/20 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                    To Date
                  </label>
                  <input
                    type="date"
                    required
                    value={leaveEnd}
                    onChange={(e) => setLeaveEnd(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs font-mono bg-white border border-amber-900/20 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                    Missed Hours
                  </label>
                  <input
                    type="number"
                    min={0.5}
                    max={120}
                    step={0.5}
                    required
                    value={leaveHours}
                    onChange={(e) => setLeaveHours(Number(e.target.value))}
                    className="w-full px-2.5 py-2 text-xs font-mono bg-white border border-amber-900/20 rounded-lg"
                  />
                </div>
                <div className="sm:col-span-2 lg:col-span-4">
                  <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                    Reason &amp; Certificate / Duty Reference *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={280}
                    placeholder="e.g. Viral fever — Medical certificate submitted at Principal office (Ref #102)"
                    value={leaveReason}
                    onChange={(e) => setLeaveReason(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                  />
                </div>
                <div>
                  <button
                    type="submit"
                    disabled={submittingLeave}
                    className="btn-3d w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white rounded-lg whitespace-nowrap"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {submittingLeave ? 'Submitting...' : 'Submit Leave'}
                  </button>
                </div>
              </form>
            )}

            {myLeaveRequests.length > 0 && (
              <div className="divide-y divide-amber-900/10 border border-amber-900/15 rounded-xl bg-white/90">
                {myLeaveRequests.map((req) => (
                  <div
                    key={req.id}
                    className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                  >
                    <div>
                      <p className="font-semibold text-stone-900 capitalize">
                        {req.leaveType.replace('_', ' ')} · {req.startDate} to {req.endDate} (
                        {req.hoursClaimed}h)
                      </p>
                      <p className="text-stone-600">{req.reason}</p>
                    </div>
                    <span
                      className={`text-[11px] font-bold uppercase px-2.5 py-1 rounded-md self-start sm:self-center ${
                        req.status === 'approved'
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : req.status === 'rejected'
                            ? 'bg-red-50 text-red-700 border border-red-200'
                            : 'bg-amber-50 text-amber-800 border border-amber-200'
                      }`}
                    >
                      {req.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : (
        <div className="surface-3d-interactive rounded-xl p-6 flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              {isParentMode ? 'Ward Linking Pending' : 'Roster Enrollment Pending'}
            </h3>
            <p className="mt-1 text-xs text-slate-600 leading-relaxed">
              {isParentMode ? (
                <>
                  Current Ward Roll Number on profile:{' '}
                  <strong className="font-mono text-slate-900">
                    {userProfile.rollOrEmpId || 'Not Linked'}
                  </strong>
                  . Ask College Admin to verify and link your ward&apos;s exact Roll Number (e.g.,{' '}
                  <span className="font-mono">BAMS24-001</span> for Abhay Pratap Maurya) in{' '}
                  <strong>5-Role Hub → Parents</strong>.
                </>
              ) : (
                <>
                  Your Google account is active for classroom self check-ins. Ask your Admin or
                  Principal to link your Roll Number in Admin &amp; RBAC to display cumulative BAMS
                  subject hours.
                </>
              )}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

function sessionIdOrFallback(id: string): string {
  return id;
}
