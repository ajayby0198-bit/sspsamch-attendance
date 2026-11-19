import React, { useMemo, useState } from 'react';
import {
  Activity,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileCheck2,
  MapPin,
  Navigation,
  Plus,
  Power,
  ShieldAlert,
  Sparkles,
  Stethoscope,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  createClinicalRotation,
  deleteClinicalRotation,
  deleteLeaveRequest,
  reviewLeaveRequest,
  saveSmartMasterSettings,
  updateClinicalRotation,
} from '../services/bamsFirestore';
import {
  AttendanceSession,
  ClinicalRotation,
  ClinicalRotationStatus,
  DEFAULT_DEPARTMENTS,
  DEFAULT_PROF_YEARS,
  DEFAULT_SESSION_TYPES,
  DayOfWeek,
  InteractionLog,
  LeaveRequest,
  LeaveType,
  MasterConfig,
  ProfYear,
  StudentRecord,
  Subject,
  TeacherProfile,
  TimetableEntry,
  UserRole,
} from '../types';
import {
  computeExamRiskForecast,
  computeNcisEligibility,
  exportMonthlySmartPackXlsx,
  getTodayDayOfWeek,
} from '../utils/smartHelpers';

type SmartSubTab = 'timetable' | 'leaves' | 'clinical' | 'forecast_geofence' | 'compliance';

const DAYS_OF_WEEK: DayOfWeek[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  medical: 'Medical Leave',
  duty_nss: 'Duty Leave (NSS / Camp)',
  academic_seminar: 'Academic Seminar / CME',
  sports_cultural: 'Sports / Cultural Representation',
};

interface SmartCampusHubProps {
  masterConfig: MasterConfig | null;
  students: StudentRecord[];
  subjects: Subject[];
  teachers: TeacherProfile[];
  sessions: AttendanceSession[];
  leaveRequests: LeaveRequest[];
  clinicalRotations: ClinicalRotation[];
  interactionLogs: InteractionLog[];
  currentUid: string;
  currentName: string;
  currentRole: UserRole;
  staffUids: string[];
  onStartClassFromSlot?: (slot: TimetableEntry) => void;
}

export const SmartCampusHub: React.FC<SmartCampusHubProps> = ({
  masterConfig,
  students,
  subjects,
  teachers,
  sessions,
  leaveRequests,
  clinicalRotations,
  interactionLogs,
  currentUid,
  currentName,
  currentRole,
  staffUids,
  onStartClassFromSlot,
}) => {
  const [subTab, setSubTab] = useState<SmartSubTab>('timetable');
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const isAdminOrCoAdmin = currentRole === 'admin' || currentRole === 'co_admin';
  const canManageSmart =
    currentRole === 'admin' ||
    currentRole === 'co_admin' ||
    currentRole === 'principal' ||
    currentRole === 'teacher';
  const minThreshold = masterConfig?.minAttendanceThreshold ?? 75;

  const profYearOptions = useMemo(
    () => (masterConfig?.profYears?.length ? masterConfig.profYears : DEFAULT_PROF_YEARS),
    [masterConfig]
  );
  const deptOptions = useMemo(
    () => (masterConfig?.departments?.length ? masterConfig.departments : DEFAULT_DEPARTMENTS),
    [masterConfig]
  );
  const sessionTypeOptions = useMemo(
    () => (masterConfig?.sessionTypes?.length ? masterConfig.sessionTypes : DEFAULT_SESSION_TYPES),
    [masterConfig]
  );
  const availableBatches = useMemo(() => {
    const set = new Set<string>(['Batch 2026', 'Batch 2025', 'Batch 2024', 'Batch 2023', 'Batch 2022']);
    students.forEach((s) => {
      if (s.batch) set.add(s.batch);
    });
    return Array.from(set).sort();
  }, [students]);

  // ---------- 1. Timetable State ----------
  const timetableActive = Boolean(masterConfig?.timetableActive);
  const timetableEntries = useMemo(
    () => masterConfig?.timetableEntries || [],
    [masterConfig?.timetableEntries]
  );
  const todayDay = getTodayDayOfWeek();
  const todayIso = new Date().toISOString().slice(0, 10);

  const [ttDay, setTtDay] = useState<DayOfWeek>(todayDay === 'Sun' ? 'Mon' : todayDay);
  const [ttStart, setTtStart] = useState('09:00');
  const [ttEnd, setTtEnd] = useState('10:00');
  const [ttProf, setTtProf] = useState<ProfYear>(profYearOptions[0] || '1st Prof');
  const [ttBatch, setTtBatch] = useState('Batch 2025');
  const [ttSubjectId, setTtSubjectId] = useState(subjects[0]?.id || '');
  const [ttTeacherName, setTtTeacherName] = useState(teachers[0]?.fullName || currentName);
  const [ttRoom, setTtRoom] = useState('Charaka Hall 101');
  const [ttSessionType, setTtSessionType] = useState(sessionTypeOptions[0] || 'Theory (Class Hours)');
  const [ttFilterDay, setTtFilterDay] = useState<'All' | DayOfWeek>('All');

  const todaySlotStatuses = useMemo(() => {
    if (todayDay === 'Sun') return [];
    const todaySlots = timetableEntries
      .filter((e) => e.day === todayDay)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    const todaySessions = sessions.filter((s) => s.date === todayIso);
    const nowTime = new Date().toTimeString().slice(0, 5);

    return todaySlots.map((slot) => {
      const matchedSession = todaySessions.find(
        (s) =>
          s.subjectCode === slot.subjectCode &&
          s.profYear === slot.profYear &&
          (!slot.batch || !s.batchLabel || s.batchLabel.includes(slot.batch.replace('Batch ', '')))
      );
      let state: 'submitted' | 'draft' | 'missed' | 'upcoming' = 'upcoming';
      if (matchedSession?.status === 'submitted') state = 'submitted';
      else if (matchedSession?.status === 'draft') state = 'draft';
      else if (nowTime > slot.endTime) state = 'missed';
      else state = 'upcoming';
      return { slot, matchedSession, state };
    });
  }, [timetableEntries, sessions, todayDay, todayIso]);

  const handleToggleTimetableActive = async () => {
    if (!isAdminOrCoAdmin) return;
    setBusyKey('toggle_tt');
    setErrorMsg(null);
    setNotice(null);
    try {
      const nextActive = !timetableActive;
      await saveSmartMasterSettings({
        timetableActive: nextActive,
        actorUid: currentUid,
        actorName: currentName,
        staffUids,
        auditLabel: `Weekly Time-Table switched ${nextActive ? 'ACTIVE (ON)' : 'INACTIVE (OFF)'}`,
      });
      setNotice(
        nextActive
          ? 'Weekly Time-Table ab ACTIVE ho gaya hai — Class Register aur Missed Class Detector ab timetable ke hisaab se chalega.'
          : 'Weekly Time-Table INACTIVE (OFF) kar diya gaya hai — jab aap chahein wapas ON kar sakte hain.'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to toggle timetable.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleAddTimetableSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdminOrCoAdmin) return;
    const sub = subjects.find((s) => s.id === ttSubjectId) || subjects[0];
    if (!sub) {
      setErrorMsg('Please add or sync subjects before adding timetable slots.');
      return;
    }
    setBusyKey('add_tt');
    setErrorMsg(null);
    setNotice(null);
    try {
      const newEntry: TimetableEntry = {
        id: `tt_${Date.now().toString(36)}`,
        day: ttDay,
        startTime: ttStart,
        endTime: ttEnd,
        profYear: ttProf,
        batch: ttBatch,
        subjectCode: sub.code,
        subjectName: sub.name,
        teacherName: ttTeacherName || sub.teacherName || currentName,
        room: ttRoom.trim() || 'Lecture Hall',
        sessionType: ttSessionType,
      };
      const updated = [...timetableEntries, newEntry];
      await saveSmartMasterSettings({
        timetableEntries: updated,
        actorUid: currentUid,
        actorName: currentName,
        staffUids,
        auditLabel: `Added timetable slot: ${ttDay} ${ttStart}-${ttEnd} ${sub.code} (${ttBatch})`,
      });
      setNotice(`Timetable slot added: ${ttDay} ${ttStart}–${ttEnd} · ${sub.code} (${ttBatch}).`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save timetable slot.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleDeleteTimetableSlot = async (id: string) => {
    if (!isAdminOrCoAdmin) return;
    setBusyKey(`del_tt_${id}`);
    setErrorMsg(null);
    try {
      const updated = timetableEntries.filter((e) => e.id !== id);
      await saveSmartMasterSettings({
        timetableEntries: updated,
        actorUid: currentUid,
        actorName: currentName,
        staffUids,
        auditLabel: 'Removed a weekly timetable slot',
      });
      setNotice('Timetable slot removed.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to remove slot.');
    } finally {
      setBusyKey(null);
    }
  };

  // ---------- 2. Leave Requests State ----------
  const [leaveFilter, setLeaveFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [creditHoursOnApprove, setCreditHoursOnApprove] = useState(true);

  const studentsById = useMemo(() => {
    const map = new Map<string, StudentRecord>();
    students.forEach((s) => map.set(s.id, s));
    return map;
  }, [students]);

  const filteredLeaves = useMemo(() => {
    return leaveRequests.filter((l) => (leaveFilter === 'all' ? true : l.status === leaveFilter));
  }, [leaveRequests, leaveFilter]);

  const pendingLeaveCount = useMemo(
    () => leaveRequests.filter((l) => l.status === 'pending').length,
    [leaveRequests]
  );

  const handleReviewLeave = async (req: LeaveRequest, decision: 'approved' | 'rejected') => {
    setBusyKey(`lv_${req.id}`);
    setErrorMsg(null);
    setNotice(null);
    try {
      await reviewLeaveRequest({
        request: req,
        decision,
        creditHoursToStudent: decision === 'approved' && creditHoursOnApprove,
        student: studentsById.get(req.studentId),
        actorUid: currentUid,
        actorName: currentName,
        actorRole: currentRole,
        staffUids,
      });
      setNotice(
        decision === 'approved'
          ? `Approved ${LEAVE_TYPE_LABELS[req.leaveType]} for ${req.studentName}${
              creditHoursOnApprove ? ` (+${req.hoursClaimed}h condonation credited)` : ''
            }.`
          : `Rejected leave application for ${req.studentName}.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to update leave request.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleDeleteLeave = async (leaveId: string) => {
    if (!isAdminOrCoAdmin) return;
    setBusyKey(`del_lv_${leaveId}`);
    try {
      await deleteLeaveRequest(leaveId);
      setNotice('Leave record deleted.');
    } finally {
      setBusyKey(null);
    }
  };

  // ---------- 3. Clinical OPD/IPD Rotations State ----------
  const [rotProf, setRotProf] = useState<ProfYear>('3rd Prof');
  const [rotBatch, setRotBatch] = useState('Batch 2023');
  const [rotGroup, setRotGroup] = useState('Clinical Group A');
  const [rotWard, setRotWard] = useState('Kayachikitsa OPD / IPD');
  const [rotDept, setRotDept] = useState(deptOptions[0] || 'Kayachikitsa');
  const [rotSupervisor, setRotSupervisor] = useState(teachers[0]?.fullName || currentName);
  const [rotStart, setRotStart] = useState(todayIso);
  const [rotEnd, setRotEnd] = useState(
    new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10)
  );
  const [rotStatus, setRotStatus] = useState<ClinicalRotationStatus>('active');
  const [rotNotes, setRotNotes] = useState('');

  const handleCreateRotation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageSmart) return;
    setBusyKey('add_rot');
    setErrorMsg(null);
    setNotice(null);
    try {
      await createClinicalRotation({
        profYear: rotProf,
        batch: rotBatch,
        groupLabel: rotGroup,
        wardName: rotWard,
        department: rotDept,
        supervisorName: rotSupervisor,
        startDate: rotStart,
        endDate: rotEnd,
        status: rotStatus,
        notes: rotNotes,
        actorUid: currentUid,
        actorName: currentName,
        actorRole: currentRole,
        staffUids,
      });
      setRotNotes('');
      setNotice(`Clinical posting added: ${rotWard} (${rotGroup} · ${rotBatch}).`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to create clinical rotation.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleUpdateRotation = async (
    rot: ClinicalRotation,
    patch: { status?: ClinicalRotationStatus; sessionsLogged?: number }
  ) => {
    setBusyKey(`rot_${rot.id}`);
    try {
      await updateClinicalRotation({ rotation: rot, ...patch });
    } finally {
      setBusyKey(null);
    }
  };

  const handleDeleteRotation = async (rotId: string) => {
    if (!isAdminOrCoAdmin) return;
    setBusyKey(`del_rot_${rotId}`);
    try {
      await deleteClinicalRotation(rotId);
      setNotice('Clinical posting removed.');
    } finally {
      setBusyKey(null);
    }
  };

  // ---------- 4. Exam Risk Forecast & Campus GPS Geo-Fence State ----------
  const [examDateInput, setExamDateInput] = useState(masterConfig?.targetExamDate || '');
  const [geoEnabled, setGeoEnabled] = useState(Boolean(masterConfig?.geoFenceEnabled));
  const [campusLat, setCampusLat] = useState(String(masterConfig?.campusLat ?? 27.674));
  const [campusLng, setCampusLng] = useState(String(masterConfig?.campusLng ?? 79.558));
  const [campusRadius, setCampusRadius] = useState(String(masterConfig?.campusRadiusMeters ?? 250));
  const [riskProfFilter, setRiskProfFilter] = useState<'All' | ProfYear>('All');
  const [locatingGps, setLocatingGps] = useState(false);

  const handleSaveSmartPolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdminOrCoAdmin) return;
    setBusyKey('save_policy');
    setErrorMsg(null);
    setNotice(null);
    try {
      await saveSmartMasterSettings({
        targetExamDate: examDateInput.trim(),
        geoFenceEnabled: geoEnabled,
        campusLat: Number(campusLat) || 27.674,
        campusLng: Number(campusLng) || 79.558,
        campusRadiusMeters: Number(campusRadius) || 250,
        actorUid: currentUid,
        actorName: currentName,
        staffUids,
        auditLabel: `Updated Exam Date (${examDateInput || 'auto'}) & Geo-Fence (${geoEnabled ? 'ON' : 'OFF'}, ${campusRadius}m)`,
      });
      setNotice('Target Exam Date & Campus GPS Geo-Fence settings saved.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save smart settings.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleCaptureCampusGps = () => {
    if (!navigator.geolocation) {
      setErrorMsg('Browser GPS geolocation is not supported on this device.');
      return;
    }
    setLocatingGps(true);
    setErrorMsg(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCampusLat(pos.coords.latitude.toFixed(6));
        setCampusLng(pos.coords.longitude.toFixed(6));
        setLocatingGps(false);
        setNotice(
          `Captured current GPS coordinates (${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}). Click "Save Policy" to apply.`
        );
      },
      (err) => {
        setLocatingGps(false);
        setErrorMsg(`Location permission denied or unavailable (${err.message}).`);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const riskRows = useMemo(() => {
    const activeDate = examDateInput || masterConfig?.targetExamDate || '';
    return students
      .filter((s) => riskProfFilter === 'All' || s.profYear === riskProfFilter)
      .map((s) => ({
        student: s,
        elig: computeNcisEligibility(s.totalHoursAttended, s.totalHoursScheduled, minThreshold),
        forecast: computeExamRiskForecast(s, activeDate, minThreshold),
      }))
      .sort((a, b) => a.student.attendancePercent - b.student.attendancePercent);
  }, [students, riskProfFilter, examDateInput, masterConfig?.targetExamDate, minThreshold]);

  const riskSummary = useMemo(() => {
    const safe = riskRows.filter((r) => r.forecast.riskLevel === 'safe').length;
    const recoverable = riskRows.filter((r) => r.forecast.riskLevel === 'recoverable').length;
    const highRisk = riskRows.filter((r) => r.forecast.riskLevel === 'high_risk').length;
    return { safe, recoverable, highRisk };
  }, [riskRows]);

  // ---------- 5. NCISM Hours Compliance & Monthly Excel Pack ----------
  const [complianceProf, setComplianceProf] = useState<'All' | ProfYear>('All');
  const [exportingPack, setExportingPack] = useState(false);

  const subjectComplianceRows = useMemo(() => {
    const submitted = sessions.filter((s) => s.status === 'submitted');
    return subjects
      .filter((sub) => complianceProf === 'All' || sub.profYear === complianceProf)
      .map((sub) => {
        const subSess = submitted.filter(
          (s) => s.subjectId === sub.id || s.subjectCode === sub.code
        );
        const requiredTotal = (sub.requiredTheoryHours || 0) + (sub.requiredPracticalHours || 0);
        const delivered = Math.max(
          sub.deliveredHours || 0,
          Number(subSess.reduce((acc, s) => acc + s.durationHours, 0).toFixed(1))
        );
        const pct =
          requiredTotal > 0 ? Math.min(100, Math.round((delivered / requiredTotal) * 100)) : 0;
        return {
          sub,
          requiredTotal,
          delivered,
          remaining: Math.max(0, Number((requiredTotal - delivered).toFixed(1))),
          pct,
          classesCount: subSess.length,
        };
      })
      .sort((a, b) => a.pct - b.pct);
  }, [subjects, sessions, complianceProf]);

  const handleDownloadMonthlyPack = async () => {
    setExportingPack(true);
    setNotice(null);
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
        profFilter: complianceProf,
      });
      setNotice(
        `Monthly Smart Report Pack (.xlsx) downloaded — ${res.studentsExported} student report cards & ${res.subjectsExported} NCISM subject compliance rows.`
      );
    } finally {
      setExportingPack(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-stone-900 tracking-tight flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-emerald-800 shrink-0" />
            Smart Campus Operations Hub
          </h1>
          <p className="mt-1 text-xs text-stone-600">
            Weekly Time-Table (Active/Inactive Switch) · Medical/Duty Leaves · Clinical OPD/IPD Rotations · Exam Risk Forecast &amp; Geo-Fence · NCISM Compliance
          </p>
        </div>

        <button
          type="button"
          disabled={exportingPack}
          onClick={handleDownloadMonthlyPack}
          className="btn-3d-gold inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap shrink-0 self-start sm:self-auto disabled:opacity-50"
        >
          <Download className="w-4 h-4" />
          {exportingPack ? 'Exporting Pack...' : 'Monthly Report Pack (.xlsx)'}
        </button>
      </div>

      {notice && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-center justify-between gap-3">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="font-semibold hover:underline">
            Dismiss
          </button>
        </div>
      )}
      {errorMsg && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 flex items-center justify-between gap-3">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg(null)} className="font-semibold hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Sub-tab Bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-amber-900/15 pb-3">
        {(
          [
            {
              id: 'timetable',
              label: `Weekly Time-Table (${timetableActive ? 'ACTIVE' : 'OFF'})`,
              icon: <CalendarClock className="w-3.5 h-3.5" />,
            },
            {
              id: 'leaves',
              label: pendingLeaveCount > 0 ? `Medical & Duty Leaves (${pendingLeaveCount})` : 'Medical & Duty Leaves',
              icon: <FileCheck2 className="w-3.5 h-3.5" />,
            },
            {
              id: 'clinical',
              label: `Clinical OPD/IPD (${clinicalRotations.length})`,
              icon: <Stethoscope className="w-3.5 h-3.5" />,
            },
            {
              id: 'forecast_geofence',
              label: 'Exam Forecast & GPS Fence',
              icon: <MapPin className="w-3.5 h-3.5" />,
            },
            {
              id: 'compliance',
              label: 'NCISM Hours Compliance',
              icon: <BookOpen className="w-3.5 h-3.5" />,
            },
          ] as Array<{ id: SmartSubTab; label: string; icon: React.ReactNode }>
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSubTab(tab.id)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl whitespace-nowrap transition-all ${
              subTab === tab.id
                ? 'btn-3d text-white'
                : 'btn-3d-secondary text-stone-800 border border-amber-900/15'
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* ================= TAB 1: TIMETABLE + ACTIVE/INACTIVE TOGGLE ================= */}
      {subTab === 'timetable' && (
        <div className="space-y-6">
          {/* Master Active / Inactive Switch Card */}
          <section className="surface-3d rounded-2xl p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[11px] font-bold rounded-md ${
                    timetableActive
                      ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                      : 'bg-stone-200 text-stone-700 border border-stone-300'
                  }`}
                >
                  <Power className="w-3 h-3" />
                  {timetableActive ? 'TIMETABLE ACTIVE (ON)' : 'TIMETABLE INACTIVE (OFF)'}
                </span>
                <span className="text-xs font-mono text-stone-500">
                  {timetableEntries.length} slot(s) configured
                </span>
              </div>
              <h2 className="text-base font-bold text-stone-900">
                College Weekly Time-Table &amp; Missed Class Auto-Detector
              </h2>
              <p className="text-xs text-stone-600 max-w-2xl">
                {timetableActive
                  ? 'Timetable abhi ACTIVE hai. Faculty ko Class Register me aaj ke scheduled slots dikhenge aur missed/unmarked classes yahan auto-track hongi.'
                  : 'Timetable abhi INACTIVE (OFF) hai — portal bina timetable restriction ke chal raha hai. Aap abhi slots pre-load kar sakte hain aur jab college timetable finalize ho tab ek click me ACTIVE kar dein.'}
              </p>
            </div>

            {isAdminOrCoAdmin ? (
              <button
                type="button"
                disabled={busyKey === 'toggle_tt'}
                onClick={handleToggleTimetableActive}
                className={`inline-flex items-center justify-center gap-2 px-5 py-3 text-xs font-bold rounded-xl whitespace-nowrap shrink-0 transition-all ${
                  timetableActive
                    ? 'bg-red-700 hover:bg-red-800 text-white shadow-sm'
                    : 'btn-3d text-white'
                }`}
              >
                <Power className="w-4 h-4" />
                {busyKey === 'toggle_tt'
                  ? 'Updating...'
                  : timetableActive
                    ? 'Turn OFF Timetable (Inactive)'
                    : 'Activate Timetable (Turn ON)'}
              </button>
            ) : (
              <span className="text-xs text-stone-500">
                Only Admin / Co-Admin can switch Timetable Active/Inactive
              </span>
            )}
          </section>

          {/* Today's Live Missed Class Detector (Only active when timetableActive === true) */}
          {timetableActive && (
            <section className="surface-3d rounded-2xl p-5 sm:p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-stone-900 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-800" />
                    Today&apos;s Live Class Schedule &amp; Missed Class Detector ({todayDay}, {todayIso})
                  </h3>
                  <p className="text-xs text-stone-500">
                    Automatically compares today&apos;s scheduled periods against submitted/draft class registers
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs font-mono tabular-nums">
                  <span className="text-emerald-800 font-semibold">
                    Submitted: {todaySlotStatuses.filter((s) => s.state === 'submitted').length}
                  </span>
                  <span className="text-amber-700 font-semibold">
                    Draft: {todaySlotStatuses.filter((s) => s.state === 'draft').length}
                  </span>
                  <span className="text-red-700 font-semibold">
                    Missed: {todaySlotStatuses.filter((s) => s.state === 'missed').length}
                  </span>
                </div>
              </div>

              {todayDay === 'Sun' ? (
                <div className="p-4 surface-3d-inset rounded-xl text-xs text-stone-600 text-center">
                  Sunday Holiday — No regular classes scheduled today.
                </div>
              ) : todaySlotStatuses.length === 0 ? (
                <div className="p-4 surface-3d-inset rounded-xl text-xs text-stone-600 text-center">
                  No timetable slots configured for {todayDay} yet. Add slots below to start tracking.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {todaySlotStatuses.map(({ slot, state }) => (
                    <div
                      key={slot.id}
                      className={`rounded-xl p-4 border space-y-2.5 ${
                        state === 'submitted'
                          ? 'bg-emerald-50/70 border-emerald-200'
                          : state === 'missed'
                            ? 'bg-red-50/70 border-red-200'
                            : state === 'draft'
                              ? 'bg-amber-50/70 border-amber-200'
                              : 'bg-white border-amber-900/15'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-mono font-bold text-stone-900 tabular-nums">
                          {slot.startTime} – {slot.endTime}
                        </span>
                        <span
                          className={`font-bold uppercase text-[11px] ${
                            state === 'submitted'
                              ? 'text-emerald-800'
                              : state === 'missed'
                                ? 'text-red-700'
                                : state === 'draft'
                                  ? 'text-amber-700'
                                  : 'text-stone-600'
                          }`}
                        >
                          {state === 'missed' ? 'Unmarked / Missed' : state}
                        </span>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-stone-900">
                          {slot.subjectCode} · {slot.subjectName}
                        </p>
                        <p className="text-xs text-stone-600 mt-0.5">
                          {slot.teacherName} · {slot.profYear} ({slot.batch}) · {slot.room}
                        </p>
                      </div>
                      {state !== 'submitted' && onStartClassFromSlot && (
                        <button
                          type="button"
                          onClick={() => onStartClassFromSlot(slot)}
                          className="btn-3d w-full py-2 text-xs font-semibold text-white rounded-lg inline-flex items-center justify-center gap-1.5"
                        >
                          <ClipboardCheck className="w-3.5 h-3.5" />
                          Open Register for This Class
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Add Timetable Slot Form (Admin / Co-Admin) */}
          {isAdminOrCoAdmin && (
            <form onSubmit={handleAddTimetableSlot} className="surface-3d rounded-2xl p-5 sm:p-6 space-y-4">
              <div>
                <h3 className="text-sm font-bold text-stone-900">Add Weekly Time-Table Period</h3>
                <p className="text-xs text-stone-500">
                  Aap slots abhi save kar sakte hain — chahe Timetable ON ho ya OFF.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-stone-700 mb-1">Day</label>
                  <select
                    value={ttDay}
                    onChange={(e) => setTtDay(e.target.value as DayOfWeek)}
                    className="w-full px-2.5 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                  >
                    {DAYS_OF_WEEK.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-700 mb-1">Start</label>
                    <input
                      type="time"
                      value={ttStart}
                      onChange={(e) => setTtStart(e.target.value)}
                      required
                      className="w-full px-2 py-2 text-xs font-mono bg-white border border-amber-900/20 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-700 mb-1">End</label>
                    <input
                      type="time"
                      value={ttEnd}
                      onChange={(e) => setTtEnd(e.target.value)}
                      required
                      className="w-full px-2 py-2 text-xs font-mono bg-white border border-amber-900/20 rounded-lg"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-stone-700 mb-1">Prof Year</label>
                  <select
                    value={ttProf}
                    onChange={(e) => setTtProf(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                  >
                    {profYearOptions.map((py) => (
                      <option key={py} value={py}>
                        {py}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-stone-700 mb-1">Batch</label>
                  <select
                    value={ttBatch}
                    onChange={(e) => setTtBatch(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                  >
                    {availableBatches.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="lg:col-span-2">
                  <label className="block text-[11px] font-semibold text-stone-700 mb-1">Subject</label>
                  <select
                    value={ttSubjectId}
                    onChange={(e) => {
                      setTtSubjectId(e.target.value);
                      const sub = subjects.find((s) => s.id === e.target.value);
                      if (sub?.teacherName) setTtTeacherName(sub.teacherName);
                      if (sub?.profYear) setTtProf(sub.profYear);
                    }}
                    className="w-full px-2.5 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                  >
                    {subjects.map((sub) => (
                      <option key={sub.id} value={sub.id}>
                        {sub.code} · {sub.name} ({sub.profYear})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-stone-700 mb-1">Faculty</label>
                  <select
                    value={ttTeacherName}
                    onChange={(e) => setTtTeacherName(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                  >
                    {teachers.map((t) => (
                      <option key={t.id} value={t.fullName}>
                        {t.fullName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-stone-700 mb-1">Room / Hall</label>
                  <input
                    type="text"
                    value={ttRoom}
                    onChange={(e) => setTtRoom(e.target.value)}
                    placeholder="Charaka Hall 101"
                    className="w-full px-2.5 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                  />
                </div>
                <div className="lg:col-span-2">
                  <label className="block text-[11px] font-semibold text-stone-700 mb-1">Session Type</label>
                  <select
                    value={ttSessionType}
                    onChange={(e) => setTtSessionType(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                  >
                    {sessionTypeOptions.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="lg:col-span-2 flex items-end justify-end">
                  <button
                    type="submit"
                    disabled={busyKey === 'add_tt'}
                    className="btn-3d inline-flex items-center gap-1.5 px-5 py-2.5 text-xs font-semibold text-white rounded-xl whitespace-nowrap"
                  >
                    <Plus className="w-4 h-4" />
                    {busyKey === 'add_tt' ? 'Saving...' : 'Add Timetable Slot'}
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* Configured Weekly Schedule Directory */}
          <section className="surface-3d rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-stone-900">
                Saved Weekly Time-Table Slots ({timetableEntries.length})
              </h3>
              <div className="flex flex-wrap items-center gap-1 p-1 surface-3d-inset rounded-lg">
                {(['All', ...DAYS_OF_WEEK] as Array<'All' | DayOfWeek>).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setTtFilterDay(d)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md ${
                      ttFilterDay === d ? 'bg-white text-stone-900 shadow-xs' : 'text-stone-600'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto border border-amber-900/15 rounded-xl bg-white/90">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-amber-950/5 border-b border-amber-900/15 font-semibold text-stone-700">
                    <th className="py-2.5 px-3">Day &amp; Time</th>
                    <th className="py-2.5 px-3">Prof / Batch</th>
                    <th className="py-2.5 px-3">Subject</th>
                    <th className="py-2.5 px-3">Faculty &amp; Room</th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-amber-900/10">
                  {timetableEntries
                    .filter((e) => ttFilterDay === 'All' || e.day === ttFilterDay)
                    .sort(
                      (a, b) =>
                        DAYS_OF_WEEK.indexOf(a.day) - DAYS_OF_WEEK.indexOf(b.day) ||
                        a.startTime.localeCompare(b.startTime)
                    )
                    .map((slot) => (
                      <tr key={slot.id} className="hover:bg-amber-50/40">
                        <td className="py-2.5 px-3 font-mono tabular-nums whitespace-nowrap">
                          <strong className="text-stone-900">{slot.day}</strong> · {slot.startTime}–{slot.endTime}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap text-stone-700">
                          {slot.profYear} · {slot.batch}
                        </td>
                        <td className="py-2.5 px-3">
                          <p className="font-semibold text-stone-900">
                            {slot.subjectCode} · {slot.subjectName}
                          </p>
                          <p className="text-[11px] text-stone-500">{slot.sessionType}</p>
                        </td>
                        <td className="py-2.5 px-3 text-stone-700">
                          <p className="font-medium text-stone-900">{slot.teacherName}</p>
                          <p className="text-[11px] text-stone-500">{slot.room}</p>
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            {timetableActive && onStartClassFromSlot && (
                              <button
                                type="button"
                                onClick={() => onStartClassFromSlot(slot)}
                                className="text-emerald-800 font-semibold hover:underline"
                              >
                                Start Class
                              </button>
                            )}
                            {isAdminOrCoAdmin && (
                              <button
                                type="button"
                                disabled={busyKey === `del_tt_${slot.id}`}
                                onClick={() => handleDeleteTimetableSlot(slot.id)}
                                className="text-red-700 hover:text-red-900"
                                aria-label="Remove slot"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  {timetableEntries.filter((e) => ttFilterDay === 'All' || e.day === ttFilterDay).length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-stone-500">
                        No timetable periods saved yet. Add your weekly periods above whenever ready.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* ================= TAB 2: MEDICAL & DUTY LEAVE WORKFLOW ================= */}
      {subTab === 'leaves' && (
        <section className="surface-3d rounded-2xl p-5 sm:p-6 space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-stone-900">
                Medical &amp; Duty Leave (NSS / Camp / Sports) Approval Desk
              </h2>
              <p className="text-xs text-stone-600">
                Review student leave applications submitted from Student Portal and optionally auto-credit approved condonation hours
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-stone-800 cursor-pointer bg-white px-3 py-2 rounded-lg border border-amber-900/15">
                <input
                  type="checkbox"
                  checked={creditHoursOnApprove}
                  onChange={(e) => setCreditHoursOnApprove(e.target.checked)}
                  className="rounded border-amber-900/30 text-emerald-800"
                />
                Auto-credit approved hours to attendance
              </label>

              <div className="flex items-center gap-1 p-1 surface-3d-inset rounded-lg">
                {(['pending', 'approved', 'rejected', 'all'] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setLeaveFilter(st)}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-md capitalize ${
                      leaveFilter === st ? 'bg-white text-stone-900 shadow-xs' : 'text-stone-600'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {filteredLeaves.length > 0 ? (
            <div className="space-y-3">
              {filteredLeaves.map((req) => (
                <div
                  key={req.id}
                  className="border border-amber-900/15 bg-white/90 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-bold text-stone-900">{req.studentName}</span>
                      <span className="font-mono text-stone-500">{req.rollNumber}</span>
                      <span className="text-stone-400">·</span>
                      <span className="text-stone-700">
                        {req.profYear} ({req.batch})
                      </span>
                      <span className="text-stone-400">·</span>
                      <span className="font-semibold text-emerald-900">
                        {LEAVE_TYPE_LABELS[req.leaveType]}
                      </span>
                    </div>
                    <p className="text-xs text-stone-700">{req.reason}</p>
                    <p className="text-[11px] font-mono text-stone-500 tabular-nums">
                      Dates: {req.startDate} to {req.endDate} · Claimed: <strong>{req.hoursClaimed} hrs</strong>
                      {req.reviewedByName ? ` · Reviewed by ${req.reviewedByName}` : ''}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {req.status === 'pending' ? (
                      <>
                        <button
                          type="button"
                          disabled={busyKey === `lv_${req.id}`}
                          onClick={() => handleReviewLeave(req, 'approved')}
                          className="btn-3d inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white rounded-lg"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Approve{creditHoursOnApprove ? ` (+${req.hoursClaimed}h)` : ''}
                        </button>
                        <button
                          type="button"
                          disabled={busyKey === `lv_${req.id}`}
                          onClick={() => handleReviewLeave(req, 'rejected')}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded-lg"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          Reject
                        </button>
                      </>
                    ) : (
                      <span
                        className={`text-xs font-bold uppercase px-2.5 py-1 rounded-md ${
                          req.status === 'approved'
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : 'bg-red-50 text-red-700 border border-red-200'
                        }`}
                      >
                        {req.status}
                      </span>
                    )}
                    {isAdminOrCoAdmin && (
                      <button
                        type="button"
                        disabled={busyKey === `del_lv_${req.id}`}
                        onClick={() => handleDeleteLeave(req.id)}
                        className="p-2 text-stone-400 hover:text-red-700"
                        aria-label="Delete leave record"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="border border-dashed border-amber-900/20 rounded-xl p-8 text-center text-xs text-stone-500">
              No {leaveFilter === 'all' ? '' : leaveFilter} medical or duty leave requests right now. Students can submit leave requests directly from Student Portal.
            </div>
          )}
        </section>
      )}

      {/* ================= TAB 3: CLINICAL OPD / IPD ROTATIONS ================= */}
      {subTab === 'clinical' && (
        <div className="space-y-6">
          {canManageSmart && (
            <form onSubmit={handleCreateRotation} className="surface-3d rounded-2xl p-5 sm:p-6 space-y-4">
              <div>
                <h2 className="text-base font-bold text-stone-900">
                  Schedule BAMS Clinical OPD / IPD Posting Rotation
                </h2>
                <p className="text-xs text-stone-600">
                  Assign 2nd, 3rd &amp; Final Prof batch groups to Hospital Wards (Kayachikitsa, Panchakarma, Shalya, Stri Roga, Balroga)
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-stone-700 mb-1">Prof Year</label>
                  <select
                    value={rotProf}
                    onChange={(e) => setRotProf(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                  >
                    {profYearOptions.map((py) => (
                      <option key={py} value={py}>
                        {py}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-stone-700 mb-1">Batch</label>
                  <select
                    value={rotBatch}
                    onChange={(e) => setRotBatch(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                  >
                    {availableBatches.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-stone-700 mb-1">Batch Group</label>
                  <input
                    type="text"
                    required
                    value={rotGroup}
                    onChange={(e) => setRotGroup(e.target.value)}
                    placeholder="Clinical Group A (Roll 1-20)"
                    className="w-full px-2.5 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-stone-700 mb-1">Ward / OPD Posting</label>
                  <input
                    type="text"
                    required
                    value={rotWard}
                    onChange={(e) => setRotWard(e.target.value)}
                    placeholder="Panchakarma Therapy Ward"
                    className="w-full px-2.5 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-stone-700 mb-1">Department</label>
                  <select
                    value={rotDept}
                    onChange={(e) => setRotDept(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                  >
                    {deptOptions.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-stone-700 mb-1">Faculty Supervisor</label>
                  <select
                    value={rotSupervisor}
                    onChange={(e) => setRotSupervisor(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                  >
                    {teachers.map((t) => (
                      <option key={t.id} value={t.fullName}>
                        {t.fullName}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-700 mb-1">From</label>
                    <input
                      type="date"
                      required
                      value={rotStart}
                      onChange={(e) => setRotStart(e.target.value)}
                      className="w-full px-2 py-2 text-xs font-mono bg-white border border-amber-900/20 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-stone-700 mb-1">To</label>
                    <input
                      type="date"
                      required
                      value={rotEnd}
                      onChange={(e) => setRotEnd(e.target.value)}
                      className="w-full px-2 py-2 text-xs font-mono bg-white border border-amber-900/20 rounded-lg"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-stone-700 mb-1">Status</label>
                  <select
                    value={rotStatus}
                    onChange={(e) => setRotStatus(e.target.value as ClinicalRotationStatus)}
                    className="w-full px-2.5 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                  >
                    <option value="active">Active</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>
                <div className="sm:col-span-2 lg:col-span-3">
                  <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                    Clinical Focus / Case Logbook Instructions
                  </label>
                  <input
                    type="text"
                    value={rotNotes}
                    onChange={(e) => setRotNotes(e.target.value)}
                    placeholder="e.g. Daily morning OPD case sheets + 5 Panchakarma procedures log"
                    className="w-full px-2.5 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
                  />
                </div>
                <div className="flex items-end justify-end">
                  <button
                    type="submit"
                    disabled={busyKey === 'add_rot'}
                    className="btn-3d w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-5 py-2.5 text-xs font-semibold text-white rounded-xl whitespace-nowrap"
                  >
                    <Plus className="w-4 h-4" />
                    {busyKey === 'add_rot' ? 'Adding...' : 'Add Clinical Posting'}
                  </button>
                </div>
              </div>
            </form>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {clinicalRotations.map((rot) => (
              <div key={rot.id} className="surface-3d-interactive rounded-2xl p-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
                      {rot.department} · {rot.profYear}
                    </span>
                    <h3 className="text-sm font-bold text-stone-900 mt-0.5">{rot.wardName}</h3>
                    <p className="text-xs text-stone-600">
                      {rot.groupLabel} ({rot.batch})
                    </p>
                  </div>
                  <span
                    className={`text-[11px] font-bold uppercase px-2 py-0.5 rounded-md ${
                      rot.status === 'active'
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : rot.status === 'completed'
                          ? 'bg-stone-100 text-stone-700 border border-stone-200'
                          : 'bg-amber-50 text-amber-800 border border-amber-200'
                    }`}
                  >
                    {rot.status}
                  </span>
                </div>

                <div className="text-xs text-stone-600 space-y-1">
                  <p>
                    Supervisor: <strong className="text-stone-900">{rot.supervisorName}</strong>
                  </p>
                  <p className="font-mono tabular-nums text-[11px]">
                    {rot.startDate} → {rot.endDate} · Logged Rounds:{' '}
                    <strong className="text-emerald-900">{rot.sessionsLogged}</strong>
                  </p>
                  {rot.notes && <p className="text-[11px] text-stone-500">{rot.notes}</p>}
                </div>

                {canManageSmart && (
                  <div className="pt-2 border-t border-amber-900/10 flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      disabled={busyKey === `rot_${rot.id}`}
                      onClick={() =>
                        handleUpdateRotation(rot, { sessionsLogged: (rot.sessionsLogged || 0) + 1 })
                      }
                      className="btn-3d-secondary px-3 py-1.5 text-xs font-semibold text-emerald-900 rounded-lg"
                    >
                      +1 Ward Session
                    </button>
                    <div className="flex items-center gap-2">
                      <select
                        value={rot.status}
                        onChange={(e) =>
                          handleUpdateRotation(rot, {
                            status: e.target.value as ClinicalRotationStatus,
                          })
                        }
                        className="px-2 py-1 text-xs bg-white border border-amber-900/20 rounded-md"
                      >
                        <option value="scheduled">Scheduled</option>
                        <option value="active">Active</option>
                        <option value="completed">Completed</option>
                      </select>
                      {isAdminOrCoAdmin && (
                        <button
                          type="button"
                          disabled={busyKey === `del_rot_${rot.id}`}
                          onClick={() => handleDeleteRotation(rot.id)}
                          className="p-1.5 text-stone-400 hover:text-red-700"
                          aria-label="Delete rotation"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
            {clinicalRotations.length === 0 && (
              <div className="md:col-span-2 lg:col-span-3 surface-3d rounded-2xl p-8 text-center text-xs text-stone-500">
                No hospital OPD/IPD postings scheduled yet. Add a ward rotation above so students and supervisors can track clinical attendance.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================= TAB 4: EXAM RISK FORECAST & CAMPUS GPS GEO-FENCE ================= */}
      {subTab === 'forecast_geofence' && (
        <div className="space-y-6">
          <form onSubmit={handleSaveSmartPolicy} className="surface-3d rounded-2xl p-5 sm:p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-stone-900">
                  Campus GPS Geo-Fence &amp; University Exam Date Forecast Policy
                </h2>
                <p className="text-xs text-stone-600">
                  Prevent outside-campus proxy check-ins using Haversine GPS distance verification &amp; forecast exam detention risk
                </p>
              </div>
              {isAdminOrCoAdmin && (
                <button
                  type="button"
                  disabled={locatingGps}
                  onClick={handleCaptureCampusGps}
                  className="btn-3d-secondary inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-emerald-900 rounded-xl whitespace-nowrap"
                >
                  <Navigation className="w-3.5 h-3.5" />
                  {locatingGps ? 'Locating GPS...' : 'Use My Current Campus Location'}
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
              <div>
                <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                  Next University Exam Date
                </label>
                <input
                  type="date"
                  value={examDateInput}
                  onChange={(e) => setExamDateInput(e.target.value)}
                  disabled={!isAdminOrCoAdmin}
                  className="w-full px-2.5 py-2 text-xs font-mono bg-white border border-amber-900/20 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                  Campus Latitude
                </label>
                <input
                  type="number"
                  step="0.000001"
                  value={campusLat}
                  onChange={(e) => setCampusLat(e.target.value)}
                  disabled={!isAdminOrCoAdmin}
                  className="w-full px-2.5 py-2 text-xs font-mono bg-white border border-amber-900/20 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                  Campus Longitude
                </label>
                <input
                  type="number"
                  step="0.000001"
                  value={campusLng}
                  onChange={(e) => setCampusLng(e.target.value)}
                  disabled={!isAdminOrCoAdmin}
                  className="w-full px-2.5 py-2 text-xs font-mono bg-white border border-amber-900/20 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                  Allowed Radius (meters)
                </label>
                <input
                  type="number"
                  min={50}
                  max={5000}
                  value={campusRadius}
                  onChange={(e) => setCampusRadius(e.target.value)}
                  disabled={!isAdminOrCoAdmin}
                  className="w-full px-2.5 py-2 text-xs font-mono bg-white border border-amber-900/20 rounded-lg"
                />
              </div>
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-stone-800 py-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={geoEnabled}
                  disabled={!isAdminOrCoAdmin}
                  onChange={(e) => setGeoEnabled(e.target.checked)}
                  className="rounded border-amber-900/30 text-emerald-800"
                />
                Enforce Campus GPS on Check-In
              </label>
            </div>

            {isAdminOrCoAdmin && (
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={busyKey === 'save_policy'}
                  className="btn-3d px-5 py-2.5 text-xs font-semibold text-white rounded-xl"
                >
                  {busyKey === 'save_policy' ? 'Saving...' : 'Save Forecast & Geo-Fence Policy'}
                </button>
              </div>
            )}
          </form>

          {/* Forecast KPI Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="surface-3d-interactive rounded-xl p-5">
              <span className="text-xs font-medium text-stone-500">Safe for Exam (≥{minThreshold}%)</span>
              <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-emerald-800">
                {riskSummary.safe}
              </p>
              <p className="mt-1 text-xs text-stone-500">Comfortable NCISM standing</p>
            </div>
            <div className="surface-3d-interactive rounded-xl p-5">
              <span className="text-xs font-medium text-stone-500">Recoverable (Needs Consistency)</span>
              <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-amber-700">
                {riskSummary.recoverable}
              </p>
              <p className="mt-1 text-xs text-stone-500">Can reach {minThreshold}% before exam</p>
            </div>
            <div className="surface-3d-interactive rounded-xl p-5">
              <span className="text-xs font-medium text-stone-500 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-red-700" />
                High Detention Risk
              </span>
              <p className="mt-2 text-2xl font-bold font-mono tabular-nums text-red-700">
                {riskSummary.highRisk}
              </p>
              <p className="mt-1 text-xs text-stone-500">Needs immediate parent alert &amp; review</p>
            </div>
          </div>

          {/* Student Risk Forecast Table */}
          <section className="surface-3d rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-stone-900">
                  Smart Detention Risk Forecast (Lowest Attendance First)
                </h3>
                <p className="text-xs text-stone-500">
                  {examDateInput || masterConfig?.targetExamDate
                    ? `Calculated against Target Exam Date: ${examDateInput || masterConfig?.targetExamDate}`
                    : 'Using default 45 working days horizon — set exact University Exam Date above for precision'}
                </p>
              </div>
              <select
                value={riskProfFilter}
                onChange={(e) => setRiskProfFilter(e.target.value as 'All' | ProfYear)}
                className="px-3 py-1.5 text-xs bg-white border border-amber-900/20 rounded-lg"
              >
                <option value="All">All Prof Years</option>
                {profYearOptions.map((py) => (
                  <option key={py} value={py}>
                    {py}
                  </option>
                ))}
              </select>
            </div>

            <div className="overflow-x-auto max-h-96 border border-amber-900/15 rounded-xl bg-white/95">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-[#FAF6EE] border-b border-amber-900/15 font-semibold text-stone-700">
                  <tr>
                    <th className="py-2.5 px-3">Roll &amp; Student</th>
                    <th className="py-2.5 px-3">Prof / Batch</th>
                    <th className="py-2.5 px-3 text-right">Current %</th>
                    <th className="py-2.5 px-3 text-right">Needed Now</th>
                    <th className="py-2.5 px-3 text-right">Max Possible</th>
                    <th className="py-2.5 px-3">Forecast Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-amber-900/10">
                  {riskRows.slice(0, 60).map(({ student, elig, forecast }) => (
                    <tr key={student.id} className="hover:bg-amber-50/40">
                      <td className="py-2 px-3">
                        <p className="font-semibold text-stone-900">{student.fullName}</p>
                        <p className="font-mono text-[11px] text-stone-500">{student.rollNumber}</p>
                      </td>
                      <td className="py-2 px-3 text-stone-700 whitespace-nowrap">
                        {student.profYear} · {student.batch}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-bold tabular-nums">
                        <span
                          className={
                            student.attendancePercent >= minThreshold
                              ? 'text-emerald-800'
                              : student.attendancePercent >= minThreshold - 10
                                ? 'text-amber-700'
                                : 'text-red-700'
                          }
                        >
                          {student.attendancePercent}%
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-stone-700">
                        {elig.classesNeeded > 0 ? `+${elig.classesNeeded}h` : 'Eligible'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-stone-700">
                        {forecast.maxPossiblePct}%
                      </td>
                      <td className="py-2 px-3">
                        <span
                          className={`inline-block font-bold uppercase text-[10px] px-2 py-0.5 rounded mr-2 ${
                            forecast.riskLevel === 'high_risk'
                              ? 'bg-red-100 text-red-800'
                              : forecast.riskLevel === 'recoverable'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {forecast.riskLevel.replace('_', ' ')}
                        </span>
                        <span className="text-[11px] text-stone-600">{forecast.summary}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* ================= TAB 5: NCISM HOURS COMPLIANCE & MONTHLY PACK ================= */}
      {subTab === 'compliance' && (
        <section className="surface-3d rounded-2xl p-5 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-stone-900">
                Faculty &amp; Subject NCISM Teaching Hours Compliance Board
              </h2>
              <p className="text-xs text-stone-600">
                Track delivered teaching hours against mandatory NCISM Theory + Practical curriculum hours
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={complianceProf}
                onChange={(e) => setComplianceProf(e.target.value as 'All' | ProfYear)}
                className="px-3 py-2 text-xs bg-white border border-amber-900/20 rounded-lg"
              >
                <option value="All">All Prof Years</option>
                {profYearOptions.map((py) => (
                  <option key={py} value={py}>
                    {py}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={exportingPack}
                onClick={handleDownloadMonthlyPack}
                className="btn-3d inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white rounded-lg whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                {exportingPack ? 'Exporting...' : 'Download Full Compliance Pack (.xlsx)'}
              </button>
            </div>
          </div>

          <div className="overflow-x-auto border border-amber-900/15 rounded-xl bg-white/95">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#FAF6EE] border-b border-amber-900/15 font-semibold text-stone-700">
                  <th className="py-2.5 px-3">Subject</th>
                  <th className="py-2.5 px-3">Prof / Dept</th>
                  <th className="py-2.5 px-3">Faculty</th>
                  <th className="py-2.5 px-3 text-right">Delivered / Required</th>
                  <th className="py-2.5 px-3">Completion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-900/10">
                {subjectComplianceRows.map(({ sub, requiredTotal, delivered, remaining, pct, classesCount }) => (
                  <tr key={sub.id} className="hover:bg-amber-50/40">
                    <td className="py-2.5 px-3">
                      <p className="font-semibold text-stone-900">
                        {sub.code} · {sub.name}
                      </p>
                      <p className="text-[11px] text-stone-500">
                        {classesCount} submitted session(s) logged
                      </p>
                    </td>
                    <td className="py-2.5 px-3 text-stone-700 whitespace-nowrap">
                      {sub.profYear} · {sub.department}
                    </td>
                    <td className="py-2.5 px-3 text-stone-800">{sub.teacherName}</td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                      <strong className="text-stone-900">{delivered}h</strong> / {requiredTotal}h
                      <p className="text-[10px] text-stone-500">{remaining}h left</p>
                    </td>
                    <td className="py-2.5 px-3 min-w-[140px]">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-stone-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              pct >= 75 ? 'bg-emerald-700' : pct >= 40 ? 'bg-amber-600' : 'bg-red-600'
                            }`}
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                        <span className="font-mono font-semibold tabular-nums text-stone-800 w-9 text-right">
                          {pct}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};
