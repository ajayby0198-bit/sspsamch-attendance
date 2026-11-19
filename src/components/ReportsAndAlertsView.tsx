import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  FileSpreadsheet,
  FileWarning,
  MessageCircle,
  Printer,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { fetchRecordsForSessions, resolveAlert } from '../services/bamsFirestore';
import {
  AttendanceAlert,
  AttendanceSession,
  DEFAULT_PROF_YEARS,
  INSTITUTION_INFO,
  InteractionLog,
  LeaveRequest,
  MasterConfig,
  ProfYear,
  StudentRecord,
  Subject,
  TeacherProfile,
  UserProfile,
  UserRole,
} from '../types';
import {
  buildParentWarningWhatsAppText,
  buildWhatsAppUrl,
  computeExamRiskForecast,
  computeNcisEligibility,
  exportMonthlySmartPackXlsx,
} from '../utils/smartHelpers';

interface ReportsAndAlertsViewProps {
  alerts: AttendanceAlert[];
  students: StudentRecord[];
  sessions: AttendanceSession[];
  users: UserProfile[];
  subjects?: Subject[];
  teachers?: TeacherProfile[];
  interactionLogs?: InteractionLog[];
  leaveRequests?: LeaveRequest[];
  masterConfig?: MasterConfig | null;
  currentUid: string;
  currentName: string;
  currentRole: UserRole;
}

function getStudentSerialPrefix(rollNumber: string): number {
  const m = rollNumber.match(/(\d+)$/);
  return m ? Number(m[1]) : 0;
}

function extractNoteField(notes: string, key: string): string {
  const regex = new RegExp(`${key}:\\s*([^·]+)`, 'i');
  const m = notes.match(regex);
  return m ? m[1].trim() : '';
}

export const ReportsAndAlertsView: React.FC<ReportsAndAlertsViewProps> = ({
  alerts,
  students,
  sessions,
  users,
  subjects = [],
  teachers = [],
  interactionLogs = [],
  leaveRequests = [],
  masterConfig,
  currentUid,
  currentName,
  currentRole,
}) => {
  const [standingFilter, setStandingFilter] = useState<'all' | 'defaulters' | 'nominal'>('all');
  const [profFilter, setProfFilter] = useState<'All' | ProfYear>('All');
  const [batchFilter, setBatchFilter] = useState<string>('All');
  const [exportFromDate, setExportFromDate] = useState<string>('');
  const [exportToDate, setExportToDate] = useState<string>('');
  const [includeDrafts, setIncludeDrafts] = useState<boolean>(false);
  const [exportingXlsx, setExportingXlsx] = useState<boolean>(false);
  const [exportingSmartPack, setExportingSmartPack] = useState<boolean>(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  // 1-Click Parent Warning Letter & WhatsApp Modal state
  const [warningStudent, setWarningStudent] = useState<StudentRecord | null>(null);
  const [waLang, setWaLang] = useState<'hi' | 'en'>('hi');
  const [parentPhone, setParentPhone] = useState('');
  const [copiedNotice, setCopiedNotice] = useState(false);

  const minThreshold = masterConfig?.minAttendanceThreshold ?? 75;

  const activeAlerts = useMemo(() => alerts.filter((a) => !a.resolved), [alerts]);
  const resolvedAlerts = useMemo(() => alerts.filter((a) => a.resolved), [alerts]);

  const profYearOptions = useMemo(
    () => (masterConfig?.profYears?.length ? masterConfig.profYears : DEFAULT_PROF_YEARS),
    [masterConfig]
  );

  const availableBatches = useMemo(() => {
    const set = new Set(students.map((s) => s.batch));
    return ['All', ...Array.from(set).sort()];
  }, [students]);

  const usersByUid = useMemo(() => {
    const map = new Map<string, UserProfile>();
    users.forEach((u) => map.set(u.uid, u));
    return map;
  }, [users]);

  const filteredStudents = useMemo(() => {
    return students.filter((s) => {
      if (profFilter !== 'All' && s.profYear !== profFilter) return false;
      if (batchFilter !== 'All' && s.batch !== batchFilter) return false;
      if (standingFilter === 'defaulters' && s.attendancePercent >= 75) return false;
      if (standingFilter === 'nominal' && s.attendancePercent < 75) return false;
      if (
        searchTerm &&
        !s.fullName.toLowerCase().includes(searchTerm.toLowerCase()) &&
        !s.rollNumber.toLowerCase().includes(searchTerm.toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [students, profFilter, batchFilter, standingFilter, searchTerm]);

  const matchingExportSessions = useMemo(() => {
    return sessions
      .filter((sess) => {
        if (!includeDrafts && sess.status !== 'submitted') return false;
        if (profFilter !== 'All' && sess.profYear !== profFilter) return false;
        if (batchFilter !== 'All') {
          const label = (sess.batchLabel || '').toLowerCase();
          if (label && !label.includes(batchFilter.toLowerCase())) {
            // Fall back to matching profYear of that batch if batchLabel wasn't set
            const batchStudent = students.find((st) => st.batch === batchFilter);
            if (!batchStudent || sess.profYear !== batchStudent.profYear) return false;
          }
        }
        if (exportFromDate && sess.date < exportFromDate) return false;
        if (exportToDate && sess.date > exportToDate) return false;
        return true;
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  }, [sessions, includeDrafts, profFilter, batchFilter, exportFromDate, exportToDate, students]);

  const handleResolve = async (alert: AttendanceAlert) => {
    setResolvingId(alert.id);
    try {
      await resolveAlert({
        alert,
        actorUid: currentUid,
        actorName: currentName,
        actorRole: currentRole,
      });
    } finally {
      setResolvingId(null);
    }
  };

  const exportCsvReport = () => {
    const headers = [
      'Roll Number',
      'Student Name',
      'Prof Year',
      'Batch',
      'Scheduled Hours',
      'Attended Hours',
      'Theory Hours',
      'Practical Hours',
      'Attendance %',
      'Consecutive Absences',
      'NCISM Standing',
    ];
    const rows = filteredStudents.map((s) => [
      s.rollNumber,
      s.fullName,
      s.profYear,
      s.batch,
      s.totalHoursScheduled,
      s.totalHoursAttended,
      s.theoryHoursAttended,
      s.practicalHoursAttended,
      s.attendancePercent,
      s.consecutiveAbsences,
      s.standing.toUpperCase(),
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sspsamch-master-attendance-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportClassMatrixXlsx = async () => {
    setExportingXlsx(true);
    setExportNotice(null);
    try {
      const XLSX = await import('xlsx');
      const sessionIds = matchingExportSessions.map((s) => s.id);
      const recordsBySession = await fetchRecordsForSessions(sessionIds);

      // Determine which student columns belong in the matrix (sorted by batch + rollNumber)
      const exportStudents = students
        .filter((s) => {
          if (profFilter !== 'All' && s.profYear !== profFilter) return false;
          if (batchFilter !== 'All' && s.batch !== batchFilter) return false;
          return true;
        })
        .sort((a, b) => a.rollNumber.localeCompare(b.rollNumber));

      const colLabels = exportStudents.map((st) => {
        const serial = getStudentSerialPrefix(st.rollNumber);
        const label =
          serial > 0
            ? `[${serial} ${st.fullName.toUpperCase()}]`
            : `[${st.rollNumber} ${st.fullName.toUpperCase()}]`;
        return { student: st, header: label };
      });

      // Sheet 1: Daily Class Attendance Matrix (Exact Google Form Style)
      const matrixRows = matchingExportSessions.map((sess) => {
        const recs = recordsBySession[sess.id] || [];
        const recByStudentId = new Map(recs.map((r) => [r.studentId, r]));
        const recByRoll = new Map(recs.map((r) => [r.rollNumber.toUpperCase(), r]));

        const noteEmail = extractNoteField(sess.notes || '', 'Email');
        const noteSubmitted = extractNoteField(sess.notes || '', 'Submitted');
        const teacherEmail =
          (noteEmail && noteEmail !== 'n/a' ? noteEmail : '') ||
          usersByUid.get(sess.teacherUid)?.email ||
          '';

        const rowObj: Record<string, string | number> = {
          Timestamp: noteSubmitted || `${sess.date} ${sess.startTime}`,
          'Email address': teacherEmail,
          'Security PIN': sess.checkInCode || '',
          'Teacher Name': sess.teacherName,
          Subject: sess.subjectName,
          'Subject Code': sess.subjectCode,
          'Session Type': sess.sessionType,
          'Class Start Time': sess.startTime,
          'Class Start Date': sess.date,
          'Duration (Hrs)': sess.durationHours,
          Batch: sess.batchLabel || `BAMS ${sess.profYear}`,
          Status: sess.status === 'submitted' ? 'Final' : 'Draft',
          'Present / Total': `${sess.presentCount + sess.lateCount}/${sess.totalStudents}`,
        };

        colLabels.forEach(({ student, header }) => {
          const match =
            recByStudentId.get(student.id) || recByRoll.get(student.rollNumber.toUpperCase());
          if (match) {
            rowObj[header] =
              match.status === 'present' ? 'Present' : match.status === 'late' ? 'Late' : 'Absent';
          } else {
            rowObj[header] = '';
          }
        });

        return rowObj;
      });

      // Sheet 2: Student Summary %
      const summaryRows = exportStudents.map((s) => ({
        'Roll Number': s.rollNumber,
        'Student Name': s.fullName,
        'Prof Year': s.profYear,
        Batch: s.batch,
        'Scheduled Hours': s.totalHoursScheduled,
        'Theory Attended': s.theoryHoursAttended,
        'Practical Attended': s.practicalHoursAttended,
        'Total Attended': s.totalHoursAttended,
        'Attendance %': s.attendancePercent,
        'Consecutive Absences': s.consecutiveAbsences,
        'NCISM Standing': s.standing.toUpperCase(),
      }));

      // Sheet 3: Subject Summary from exported sessions
      const subjectAgg = new Map<
        string,
        {
          code: string;
          name: string;
          profYear: string;
          classes: number;
          hours: number;
          pctSum: number;
        }
      >();
      matchingExportSessions.forEach((sess) => {
        const key = `${sess.subjectCode}|${sess.profYear}`;
        const prev = subjectAgg.get(key) || {
          code: sess.subjectCode,
          name: sess.subjectName,
          profYear: sess.profYear,
          classes: 0,
          hours: 0,
          pctSum: 0,
        };
        const pct =
          sess.totalStudents > 0
            ? ((sess.presentCount + sess.lateCount * 0.5) / sess.totalStudents) * 100
            : 0;
        prev.classes += 1;
        prev.hours = Number((prev.hours + sess.durationHours).toFixed(1));
        prev.pctSum += pct;
        subjectAgg.set(key, prev);
      });
      const subjectRows = Array.from(subjectAgg.values()).map((sub) => ({
        'Subject Code': sub.code,
        'Subject Name': sub.name,
        'Prof Year': sub.profYear,
        'Total Classes': sub.classes,
        'Total Hours': sub.hours,
        'Avg Attendance %': sub.classes > 0 ? Number((sub.pctSum / sub.classes).toFixed(1)) : 0,
      }));

      const wb = XLSX.utils.book_new();
      const wsMatrix = XLSX.utils.json_to_sheet(
        matrixRows.length > 0
          ? matrixRows
          : [{ Info: 'No class sessions matched the selected date/batch filters.' }]
      );
      const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
      const wsSubjects = XLSX.utils.json_to_sheet(
        subjectRows.length > 0 ? subjectRows : [{ Info: 'No subject sessions in selected filter.' }]
      );

      XLSX.utils.book_append_sheet(wb, wsMatrix, 'Daily Class Attendance');
      XLSX.utils.book_append_sheet(wb, wsSummary, 'Student Summary');
      XLSX.utils.book_append_sheet(wb, wsSubjects, 'Subject Summary');

      const tag =
        batchFilter !== 'All'
          ? batchFilter.replace(/\s+/g, '_')
          : profFilter !== 'All'
            ? profFilter.replace(/\s+/g, '_')
            : 'All';
      XLSX.writeFile(
        wb,
        `SSPSAMCH_Class_Wise_Attendance_${tag}_${new Date().toISOString().slice(0, 10)}.xlsx`
      );
      setExportNotice(
        `Exported ${matchingExportSessions.length} class session(s) & ${exportStudents.length} student(s) in Google-Form Matrix Excel (.xlsx).`
      );
    } finally {
      setExportingXlsx(false);
    }
  };

  const handlePrintPdf = () => {
    window.print();
  };

  const handleExportMonthlySmartPack = async () => {
    setExportingSmartPack(true);
    setExportNotice(null);
    try {
      const res = await exportMonthlySmartPackXlsx({
        students,
        subjects,
        teachers,
        sessions,
        leaveRequests,
        interactionLogs,
        minThreshold,
        targetExamDate: masterConfig?.targetExamDate,
        profFilter,
      });
      setExportNotice(
        `Monthly Smart Report Pack (.xlsx) downloaded — ${res.studentsExported} ranked student report cards + ${res.subjectsExported} NCISM subject compliance rows.`
      );
    } finally {
      setExportingSmartPack(false);
    }
  };

  const warningWaText = useMemo(() => {
    if (!warningStudent) return '';
    return buildParentWarningWhatsAppText(warningStudent, minThreshold, waLang);
  }, [warningStudent, minThreshold, waLang]);

  const warningEligibility = useMemo(() => {
    if (!warningStudent) return null;
    return computeNcisEligibility(
      warningStudent.totalHoursAttended,
      warningStudent.totalHoursScheduled,
      minThreshold
    );
  }, [warningStudent, minThreshold]);

  const handleCopyWarningText = async () => {
    if (!warningWaText) return;
    try {
      await navigator.clipboard.writeText(warningWaText);
      setCopiedNotice(true);
      window.setTimeout(() => setCopiedNotice(false), 2000);
    } catch {
      setCopiedNotice(false);
    }
  };

  const studentsById = useMemo(() => {
    const map = new Map<string, StudentRecord>();
    students.forEach((s) => map.set(s.id, s));
    return map;
  }, [students]);

  const canResolve =
    currentRole === 'admin' ||
    currentRole === 'co_admin' ||
    currentRole === 'principal' ||
    currentRole === 'teacher';

  return (
    <div className="space-y-6">
      {/* Print-only Master Academic PDF Header */}
      <div className="hidden print:block border-b border-slate-300 pb-4 mb-4">
        <h1 className="text-lg font-bold text-slate-900">{INSTITUTION_INFO.name}</h1>
        <p className="text-xs text-slate-600">
          {INSTITUTION_INFO.address} · NCISM ID: {INSTITUTION_INFO.ncismId} · MGGAU:{' '}
          {INSTITUTION_INFO.universityId}
        </p>
        <p className="text-xs text-slate-700 mt-1 font-mono">
          Master Academic Attendance Report · Generated {new Date().toLocaleDateString()}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Automated Absenteeism Reports &amp; Master PDF
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Daily/Monthly NCISM 75% monitoring · Class-by-Class Excel Matrix · Printable Master Academic PDF &amp; CSV
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            disabled={exportingSmartPack}
            onClick={handleExportMonthlySmartPack}
            className="btn-3d-gold inline-flex items-center gap-2 px-3.5 py-2.5 text-xs font-bold rounded-lg whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4" />
            {exportingSmartPack ? 'Building Pack...' : 'Monthly Report Pack (.xlsx)'}
          </button>
          <button
            type="button"
            onClick={handlePrintPdf}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-slate-800 btn-3d-secondary border border-slate-200 rounded-lg whitespace-nowrap shrink-0"
          >
            <Printer className="w-4 h-4" />
            Master Academic PDF
          </button>
          <button
            type="button"
            onClick={exportCsvReport}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-white bg-emerald-800 hover:bg-emerald-900 rounded-lg btn-3d whitespace-nowrap shrink-0"
          >
            <Download className="w-4 h-4" />
            Download CSV
          </button>
        </div>
      </div>

      {/* Class-Wise Matrix Excel Export Card (Google Form Layout) */}
      <section className="surface-3d rounded-xl p-5 space-y-4 print:hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-emerald-900" />
              Class-Wise Attendance Matrix Excel Export (.xlsx)
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Bilkul aapki Google Form sheet jaisa format: har class ek row (`Timestamp`, `Teacher`, `Subject`, `Date`, `Time`, `Batch`, `[1 ABHAY PRATAP MAURYA]`... `Present/Absent`) + Student Summary &amp; Subject Summary sheets.
            </p>
          </div>
          <button
            type="button"
            disabled={exportingXlsx}
            onClick={exportClassMatrixXlsx}
            className="btn-3d-gold inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold rounded-lg whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            {exportingXlsx
              ? 'Generating .xlsx...'
              : `Export Class-Wise Excel (${matchingExportSessions.length} Classes)`}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              From Date (Optional)
            </label>
            <input
              type="date"
              value={exportFromDate}
              onChange={(e) => setExportFromDate(e.target.value)}
              className="w-full px-2.5 py-2 text-xs bg-white border border-slate-200 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              To Date (Optional)
            </label>
            <input
              type="date"
              value={exportToDate}
              onChange={(e) => setExportToDate(e.target.value)}
              className="w-full px-2.5 py-2 text-xs bg-white border border-slate-200 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Filter by Prof Year
            </label>
            <select
              value={profFilter}
              onChange={(e) => setProfFilter(e.target.value as 'All' | ProfYear)}
              className="w-full px-2.5 py-2 text-xs bg-white border border-slate-200 rounded-lg"
            >
              <option value="All">All Prof Years</option>
              {profYearOptions.map((py) => (
                <option key={py} value={py}>
                  {py}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Filter by Batch
            </label>
            <select
              value={batchFilter}
              onChange={(e) => setBatchFilter(e.target.value)}
              className="w-full px-2.5 py-2 text-xs bg-white border border-slate-200 rounded-lg"
            >
              {availableBatches.map((b) => (
                <option key={b} value={b}>
                  {b === 'All' ? 'All Batches' : b}
                </option>
              ))}
            </select>
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-slate-700 py-2 cursor-pointer">
            <input
              type="checkbox"
              checked={includeDrafts}
              onChange={(e) => setIncludeDrafts(e.target.checked)}
              className="rounded border-slate-300 text-emerald-800"
            />
            <span>Include Draft Registers</span>
          </label>
        </div>

        {exportNotice && (
          <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900">
            {exportNotice}
          </div>
        )}
      </section>

      {/* Automation Layer & Principal Monitoring Triggers */}
      <section className="surface-3d rounded-xl p-5 space-y-3 print:hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Principal Monitoring &amp; Automation Layer
            </h2>
            <p className="text-xs text-slate-500">
              Automated pipelines connecting class submit triggers to daily, monthly &amp; cumulative academic records
            </p>
          </div>
          <span className="text-xs font-mono text-emerald-800">{INSTITUTION_INFO.email}</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
          {[
            { fn: 'sendDailyAttendanceSummary', trigger: 'Time-based · Daily 17:30' },
            { fn: 'sendAttendanceNotification', trigger: 'On Class Submit' },
            { fn: 'sendMonthlyAttendanceReportBAMS1stProf', trigger: 'Monthly · Batch 2025' },
            { fn: 'sendMonthlyAttendanceReportBAMS2ndProf', trigger: 'Monthly · Batch 2024' },
            { fn: 'generateCumulativeMasterAcademicPDF', trigger: 'Master Academic PDF' },
          ].map((item) => (
            <div key={item.fn} className="border border-slate-200 bg-white/80 rounded-lg p-3">
              <p className="font-mono text-[11px] font-semibold text-slate-900 truncate" title={item.fn}>
                {item.fn}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">{item.trigger}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Active Alerts List */}
      <section className="surface-3d rounded-xl p-5 sm:p-6 space-y-4 print:hidden">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            Active Threshold &amp; Draft Alerts ({activeAlerts.length})
          </h2>
          <span className="text-xs text-slate-500 font-mono tabular-nums">
            {resolvedAlerts.length} resolved
          </span>
        </div>

        {activeAlerts.length > 0 ? (
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
            {activeAlerts.map((alert) => (
              <div
                key={alert.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <AlertTriangle
                    className={`w-4 h-4 mt-0.5 shrink-0 ${
                      alert.severity === 'critical' ? 'text-red-600' : 'text-amber-600'
                    }`}
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span
                        className={`font-semibold uppercase ${
                          alert.severity === 'critical' ? 'text-red-700' : 'text-amber-700'
                        }`}
                      >
                        {alert.severity}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-semibold text-slate-900">{alert.targetName}</span>
                      <span aria-hidden="true">·</span>
                      <span className="text-slate-500 font-mono tabular-nums">
                        {alert.profYear} · {alert.subjectCode}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600 leading-relaxed">{alert.message}</p>
                  </div>
                </div>

                {canResolve && (
                  <div className="flex flex-wrap items-center gap-2 shrink-0 self-start sm:self-center">
                    {studentsById.get(alert.targetStudentId) && (
                      <button
                        type="button"
                        onClick={() => {
                          setWarningStudent(studentsById.get(alert.targetStudentId) || null);
                          setCopiedNotice(false);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-amber-900 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-lg whitespace-nowrap"
                      >
                        <FileWarning className="w-3.5 h-3.5" />
                        Parent Notice
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={resolvingId === alert.id}
                      onClick={() => handleResolve(alert)}
                      className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg whitespace-nowrap"
                    >
                      {resolvingId === alert.id ? 'Resolving...' : 'Mark Reviewed'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="border border-slate-200 rounded-lg p-6 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-700" />
            All active absenteeism and draft alerts have been reviewed.
          </div>
        )}
      </section>

      {/* Automated Student Compliance Table */}
      <section className="surface-3d rounded-xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 print:hidden">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search roll number or student..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3.5 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={profFilter}
              onChange={(e) => setProfFilter(e.target.value as 'All' | ProfYear)}
              className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg"
            >
              <option value="All">All Prof Years</option>
              {profYearOptions.map((py) => (
                <option key={py} value={py}>
                  {py}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'defaulters', label: '< 75% Defaulters' },
                  { id: 'nominal', label: '75%+ Nominal' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStandingFilter(tab.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap ${
                    standingFilter === tab.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th className="py-2.5 px-3">Roll No.</th>
                <th className="py-2.5 px-3">Student</th>
                <th className="py-2.5 px-3">Prof / Batch</th>
                <th className="py-2.5 px-3 text-right">Attended / Sched</th>
                <th className="py-2.5 px-3 text-right">Attendance %</th>
                <th className="py-2.5 px-3 text-right">Needed / Risk</th>
                <th className="py-2.5 px-3 text-right print:hidden">Parent Notice</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredStudents.map((s) => {
                const elig = computeNcisEligibility(
                  s.totalHoursAttended,
                  s.totalHoursScheduled,
                  minThreshold
                );
                const risk = computeExamRiskForecast(
                  s,
                  masterConfig?.targetExamDate,
                  minThreshold
                );
                return (
                  <tr key={s.id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-3 font-mono text-slate-600 tabular-nums">
                      {s.rollNumber}
                    </td>
                    <td className="py-2.5 px-3 font-medium text-slate-900">{s.fullName}</td>
                    <td className="py-2.5 px-3 text-slate-600">
                      {s.profYear} · {s.batch}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                      {s.totalHoursAttended} / {s.totalHoursScheduled}h
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right font-mono font-semibold tabular-nums ${
                        s.attendancePercent >= minThreshold
                          ? 'text-emerald-800'
                          : s.attendancePercent >= minThreshold - 10
                            ? 'text-amber-700'
                            : 'text-red-700'
                      }`}
                    >
                      {s.attendancePercent}%
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <span
                        className={`font-semibold text-[11px] ${
                          risk.riskLevel === 'high_risk'
                            ? 'text-red-700'
                            : risk.riskLevel === 'recoverable'
                              ? 'text-amber-700'
                              : 'text-emerald-800'
                        }`}
                      >
                        {elig.classesNeeded > 0 ? `+${elig.classesNeeded}h · ` : ''}
                        {risk.riskLevel.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right print:hidden">
                      <button
                        type="button"
                        onClick={() => {
                          setWarningStudent(s);
                          setCopiedNotice(false);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-emerald-900 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-md whitespace-nowrap"
                      >
                        <MessageCircle className="w-3 h-3" />
                        Letter / WA
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 1-Click Printable Official College Warning Letterhead & WhatsApp Notice Modal */}
      {warningStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/60 p-4 print:static print:bg-white print:p-0">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[92vh] overflow-y-auto shadow-2xl border border-amber-900/20 p-6 space-y-5 print:shadow-none print:border-0 print:max-h-none">
            <div className="flex items-center justify-between gap-3 print:hidden">
              <h3 className="text-sm font-bold text-stone-900 flex items-center gap-2">
                <FileWarning className="w-4 h-4 text-amber-700" />
                Official Parent Attendance Notice &amp; WhatsApp Alert
              </h3>
              <button
                type="button"
                onClick={() => setWarningStudent(null)}
                className="p-1.5 text-stone-500 hover:text-stone-900"
                aria-label="Close warning letter modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Official Printable SSPSAMCH Letterhead */}
            <div className="border-2 border-emerald-900/30 rounded-xl p-6 space-y-4 bg-[#FFFDF9] print:border-stone-800 print:bg-white">
              <div className="text-center border-b-2 border-emerald-900/20 pb-3 space-y-1">
                <h2 className="text-base sm:text-lg font-bold text-emerald-950 uppercase tracking-tight">
                  {INSTITUTION_INFO.name}
                </h2>
                <p className="text-[11px] text-stone-600">{INSTITUTION_INFO.address}</p>
                <p className="text-[11px] font-mono text-stone-700">
                  College Code: <strong>{INSTITUTION_INFO.collegeCode}</strong> · NCISM ID:{' '}
                  <strong>{INSTITUTION_INFO.ncismId}</strong> · MGGAU University ID:{' '}
                  <strong>{INSTITUTION_INFO.universityId}</strong>
                </p>
              </div>

              <div className="flex items-center justify-between text-xs font-mono text-stone-700">
                <span>Ref: SSPSAMCH/ATTN/{new Date().getFullYear()}/{warningStudent.rollNumber}</span>
                <span>Date: {new Date().toLocaleDateString('en-IN')}</span>
              </div>

              <div className="text-center">
                <p className="inline-block text-xs font-bold uppercase tracking-wider px-3 py-1 bg-red-50 text-red-800 border border-red-200 rounded">
                  Official Attendance Shortage &amp; Parent Intimation Notice
                </p>
              </div>

              <div className="text-xs text-stone-800 space-y-2.5 leading-relaxed">
                <p>
                  <strong>To,</strong>
                  <br />
                  The Parent / Legal Guardian of <strong>{warningStudent.fullName}</strong> (Roll No:{' '}
                  <strong className="font-mono">{warningStudent.rollNumber}</strong>,{' '}
                  {warningStudent.profYear} · {warningStudent.batch})
                </p>
                <p>
                  Dear Parent/Guardian, as per the NCISM &amp; Mahayogi Guru Gorakhnath AYUSH University
                  (MGGAU) examination regulations, a minimum of{' '}
                  <strong>{minThreshold}% attendance</strong> in Theory and Practical/Clinical classes
                  is mandatory to appear in the Professional BAMS Examination.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-white border border-stone-200 rounded-lg p-3 font-mono text-center">
                  <div>
                    <span className="block font-sans text-[10px] text-stone-500">Scheduled</span>
                    <strong>{warningStudent.totalHoursScheduled}h</strong>
                  </div>
                  <div>
                    <span className="block font-sans text-[10px] text-stone-500">Attended</span>
                    <strong>{warningStudent.totalHoursAttended}h</strong>
                  </div>
                  <div>
                    <span className="block font-sans text-[10px] text-stone-500">Current %</span>
                    <strong className="text-red-700">{warningStudent.attendancePercent}%</strong>
                  </div>
                  <div>
                    <span className="block font-sans text-[10px] text-stone-500">Classes Needed</span>
                    <strong className="text-amber-800">
                      {warningEligibility?.classesNeeded ?? 0}h
                    </strong>
                  </div>
                </div>
                <p>
                  {warningEligibility && warningEligibility.classesNeeded > 0
                    ? `Your ward must attend at least ${warningEligibility.classesNeeded} consecutive class hours without absence to restore ${minThreshold}% eligibility.`
                    : `Kindly ensure your ward continues maintaining regular attendance in all theory and hospital OPD/IPD postings.`}
                </p>
                <p>
                  You are requested to contact the Principal / Academic Monitoring Cell (
                  {INSTITUTION_INFO.email}) at the earliest and ensure regular attendance.
                </p>
              </div>

              <div className="pt-6 flex items-end justify-between text-xs text-stone-700">
                <div>
                  <p className="font-semibold">Academic Monitoring Desk</p>
                  <p className="text-[11px] text-stone-500">Issued by: {currentName}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-stone-900">Principal / Dean</p>
                  <p className="text-[11px] text-stone-500">SSPSAMCH, Shahjahanpur (UP)</p>
                </div>
              </div>
            </div>

            {/* Direct WhatsApp Notice & Print Actions */}
            <div className="space-y-3 print:hidden">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-stone-700">WhatsApp Language:</span>
                  <div className="inline-flex p-0.5 bg-stone-100 rounded-lg text-xs">
                    <button
                      type="button"
                      onClick={() => setWaLang('hi')}
                      className={`px-2.5 py-1 rounded-md font-semibold ${
                        waLang === 'hi' ? 'bg-white text-stone-900 shadow-xs' : 'text-stone-600'
                      }`}
                    >
                      Hinglish / Hindi
                    </button>
                    <button
                      type="button"
                      onClick={() => setWaLang('en')}
                      className={`px-2.5 py-1 rounded-md font-semibold ${
                        waLang === 'en' ? 'bg-white text-stone-900 shadow-xs' : 'text-stone-600'
                      }`}
                    >
                      English
                    </button>
                  </div>
                </div>
                <input
                  type="tel"
                  placeholder="Parent WhatsApp No. (Optional 10-digit)"
                  value={parentPhone}
                  onChange={(e) => setParentPhone(e.target.value)}
                  className="px-3 py-1.5 text-xs font-mono border border-stone-200 rounded-lg w-60"
                />
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={handleCopyWarningText}
                  className="btn-3d-secondary inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-stone-800 rounded-lg"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {copiedNotice ? 'Copied!' : 'Copy WhatsApp Text'}
                </button>
                <a
                  href={buildWhatsAppUrl(warningWaText, parentPhone)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg whitespace-nowrap"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  Send on WhatsApp
                </a>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="btn-3d inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white rounded-lg whitespace-nowrap"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print / Save Letter PDF
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
