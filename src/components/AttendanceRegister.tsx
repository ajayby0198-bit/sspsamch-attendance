import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import QRCode from 'qrcode';
import {
  CalendarClock,
  Check,
  Clock,
  FileEdit,
  KeyRound,
  Lock,
  MapPin,
  Plus,
  QrCode,
  RefreshCw,
  RotateCw,
  Send,
  ShieldAlert,
  Trash2,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  buildPdfSubjects,
  PDF_BATCH_DEFINITIONS,
  PDF_FACULTY_NAMES,
  PDF_SESSION_TYPES,
} from '../data/sspsamchRoster';
import {
  adminAddRecordToSession,
  adminCorrectSubmittedRecord,
  adminDeleteSession,
  adminRemoveRecordFromSession,
  createAttendanceSession,
  FACULTY_SECURITY_PIN,
  rotateSessionCheckInCode,
  saveSessionDraft,
  submitSessionFinal,
} from '../services/bamsFirestore';
import {
  ActivityType,
  AttendanceSession,
  DEFAULT_ACTIVITY_TYPES,
  EntryMode,
  MasterConfig,
  ProfYear,
  SessionStudentRecord,
  SessionType,
  StudentAttendanceStatus,
  StudentCheckIn,
  StudentRecord,
  Subject,
  TeacherProfile,
  TimetableEntry,
  UserRole,
} from '../types';
import { getTodayDayOfWeek } from '../utils/smartHelpers';

interface AttendanceRegisterProps {
  sessions: AttendanceSession[];
  subjects: Subject[];
  students: StudentRecord[];
  teachers: TeacherProfile[];
  currentUid: string;
  currentName: string;
  currentEmail?: string;
  currentRole: UserRole;
  canOverride?: boolean;
  masterConfig?: MasterConfig | null;
  initialSessionId?: string;
  preFillSlot?: TimetableEntry | null;
  onClearPreFill?: () => void;
}

export const AttendanceRegister: React.FC<AttendanceRegisterProps> = ({
  sessions,
  subjects,
  students,
  teachers,
  currentUid,
  currentName,
  currentEmail,
  currentRole,
  canOverride = false,
  masterConfig,
  initialSessionId,
  preFillSlot,
  onClearPreFill,
}) => {
  const sessionTypeOptions = useMemo(() => {
    const base = masterConfig?.sessionTypes?.length
      ? masterConfig.sessionTypes
      : [...PDF_SESSION_TYPES];
    return Array.from(new Set([...base, ...PDF_SESSION_TYPES]));
  }, [masterConfig]);

  const activityTypeOptions = masterConfig?.activityTypes?.length
    ? masterConfig.activityTypes
    : DEFAULT_ACTIVITY_TYPES;

  const subjectOptions = useMemo(() => {
    if (subjects.length > 0) return subjects;
    return buildPdfSubjects() as Subject[];
  }, [subjects]);

  const teacherNameOptions = useMemo(() => {
    const dbNames = teachers.map((t) => t.fullName);
    return Array.from(new Set([...PDF_FACULTY_NAMES, ...dbNames]));
  }, [teachers]);

  const batchOptions = useMemo(() => {
    const map = new Map<
      string,
      { id: string; label: string; profYear: ProfYear; batch: string }
    >();

    // 1. Live student (profYear + batch) groups take priority (reflects promotions automatically)
    const liveBatches = new Set<string>();
    students.forEach((st) => {
      const py = st.profYear || '1st Prof';
      const bName = st.batch || py;
      liveBatches.add(bName);
      const key = `${py}::${bName}`;
      if (!map.has(key)) {
        const cleanProf = py.replace(/\s*Prof$/i, ' Professional');
        map.set(key, {
          id: `live_${key.replace(/[^a-zA-Z0-9]/g, '_')}`,
          label: `(${bName.replace(/^Batch\s+/i, '')}) BAMS ${cleanProf}`,
          profYear: py,
          batch: bName,
        });
      }
    });

    // 2. Include static roster definitions for batches not yet present in live students
    PDF_BATCH_DEFINITIONS.forEach((b) => {
      const key = `${b.profYear}::${b.batch}`;
      if (!liveBatches.has(b.batch) && !map.has(key)) {
        map.set(key, {
          id: b.id,
          label: b.label,
          profYear: b.profYear,
          batch: b.batch,
        });
      }
    });

    // 3. Ensure every configured Master Prof Year has at least one option
    const coveredProfs = new Set(Array.from(map.values()).map((o) => o.profYear));
    (masterConfig?.profYears || []).forEach((py) => {
      if (!coveredProfs.has(py)) {
        const yrHint =
          py === '1st Prof'
            ? 'Batch 2025'
            : py === '2nd Prof'
              ? 'Batch 2024'
              : py === '3rd Prof'
                ? 'Batch 2023'
                : py === '4th Prof'
                  ? 'Batch 2022'
                  : py;
        const key = `${py}::${yrHint}`;
        map.set(key, {
          id: `custom_${key.replace(/[^a-zA-Z0-9]/g, '_')}`,
          label: `(${yrHint.replace(/^Batch\s+/i, '')}) BAMS ${py}`,
          profYear: py,
          batch: yrHint,
        });
      }
    });

    return Array.from(map.values()).sort(
      (a, b) => a.profYear.localeCompare(b.profYear) || a.batch.localeCompare(b.batch)
    );
  }, [students, masterConfig]);

  const [selectedSessionId, setSelectedSessionId] = useState<string>(
    initialSessionId || sessions[0]?.id || ''
  );
  const [showNewForm, setShowNewForm] = useState(false);

  // Faculty Security PIN verification
  const [pinVerified, setPinVerified] = useState<boolean>(
    currentRole === 'admin' || currentRole === 'co_admin'
  );
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);

  // New session Live Form state (SSPSAMC&H Session-Wise Attendance Form)
  const [selectedTeacherName, setSelectedTeacherName] = useState<string>(
    PDF_FACULTY_NAMES.includes(currentName) ? currentName : teachers[0]?.fullName || PDF_FACULTY_NAMES[0]
  );
  const [subjectId, setSubjectId] = useState(subjectOptions[0]?.id || '');
  const [selectedBatchId, setSelectedBatchId] = useState<string>(PDF_BATCH_DEFINITIONS[0].id);
  const [sessionType, setSessionType] = useState<SessionType>(sessionTypeOptions[0] || 'Theory (Class Hours)');
  const [activityType, setActivityType] = useState<ActivityType>(activityTypeOptions[0] || 'Regular Class');
  const [topicTaught, setTopicTaught] = useState('');
  const [entryMode, setEntryMode] = useState<EntryMode>('live');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [durationHours, setDurationHours] = useState(1);
  const [room, setRoom] = useState('Charaka Lecture Hall 101');
  const [allowSelfMark, setAllowSelfMark] = useState(true);
  const [newNotes, setNewNotes] = useState('');
  const [batchSearch, setBatchSearch] = useState('');
  const [newFormStatusMap, setNewFormStatusMap] = useState<Record<string, StudentAttendanceStatus>>({});
  const [creatingMode, setCreatingMode] = useState<'draft' | 'submit' | null>(null);

  // Active session records & live check-ins
  const [records, setRecords] = useState<SessionStudentRecord[]>([]);
  const [checkIns, setCheckIns] = useState<StudentCheckIn[]>([]);
  const [notes, setNotes] = useState('');
  const [editTopic, setEditTopic] = useState('');
  const [editActivity, setEditActivity] = useState<ActivityType>('Regular Class');
  const [editEntryMode, setEditEntryMode] = useState<EntryMode>('live');
  const [sessionSelfMark, setSessionSelfMark] = useState(true);
  const [busyAction, setBusyAction] = useState<'draft' | 'submit' | 'audit' | 'admin' | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);

  // Admin add/remove student from session
  const [adminAddStudentId, setAdminAddStudentId] = useState<string>('');
  const [adminAddStatus, setAdminAddStatus] = useState<StudentAttendanceStatus>('present');

  // Audited correction modal state (Admin / Principal only)
  const [auditTarget, setAuditTarget] = useState<SessionStudentRecord | null>(null);
  const [auditStatus, setAuditStatus] = useState<StudentAttendanceStatus>('present');
  const [auditReason, setAuditReason] = useState('');

  // Rotating QR Code & Campus Geo-Fence state for active draft session
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [qrAutoRotate, setQrAutoRotate] = useState<boolean>(false);
  const [qrCountdown, setQrCountdown] = useState<number>(30);
  const [rotatingQr, setRotatingQr] = useState<boolean>(false);

  const todayTimetableSlots = useMemo(() => {
    if (!masterConfig?.timetableActive) return [];
    const todayDay = getTodayDayOfWeek();
    if (todayDay === 'Sun') return [];
    return (masterConfig.timetableEntries || [])
      .filter((e) => e.day === todayDay)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [masterConfig?.timetableActive, masterConfig?.timetableEntries]);

  const applyTimetableSlotToForm = (slot: TimetableEntry) => {
    const matchedSub =
      subjectOptions.find((s) => s.code === slot.subjectCode) ||
      subjectOptions.find((s) => s.name.toLowerCase() === slot.subjectName.toLowerCase());
    if (matchedSub) {
      setSubjectId(matchedSub.id);
    }
    if (slot.teacherName) {
      setSelectedTeacherName(slot.teacherName);
    }
    const matchedBatch =
      batchOptions.find((b) => b.batch === slot.batch && b.profYear === slot.profYear) ||
      batchOptions.find((b) => b.profYear === slot.profYear);
    if (matchedBatch) {
      setSelectedBatchId(matchedBatch.id);
    }
    if (slot.sessionType) {
      setSessionType(slot.sessionType);
    }
    setDate(new Date().toISOString().slice(0, 10));
    handleTimeChange(slot.startTime, slot.endTime);
    if (slot.room) setRoom(slot.room);
    setTopicTaught(`${slot.subjectName} — Scheduled ${slot.day} Period`);
    setShowNewForm(true);
    setFeedback(`Pre-filled register from Timetable slot: ${slot.subjectCode} (${slot.startTime}–${slot.endTime}).`);
  };

  useEffect(() => {
    if (preFillSlot) {
      applyTimetableSlotToForm(preFillSlot);
      onClearPreFill?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preFillSlot]);

  useEffect(() => {
    if (initialSessionId) {
      setSelectedSessionId(initialSessionId);
      setShowNewForm(false);
    } else if (!selectedSessionId && sessions.length > 0) {
      setSelectedSessionId(sessions[0].id);
    }
  }, [initialSessionId, sessions, selectedSessionId]);

  useEffect(() => {
    if (!subjectId && subjectOptions.length > 0) {
      setSubjectId(subjectOptions[0].id);
    }
  }, [subjectOptions, subjectId]);

  const selectedBatchDef = useMemo(
    () => batchOptions.find((b) => b.id === selectedBatchId) || batchOptions[0],
    [batchOptions, selectedBatchId]
  );

  const selectedBatchStudents = useMemo(() => {
    if (!selectedBatchDef) return [];
    const exactBoth = students.filter(
      (st) => st.batch === selectedBatchDef.batch && st.profYear === selectedBatchDef.profYear
    );
    if (exactBoth.length > 0) return exactBoth;
    const exactBatch = students.filter((st) => st.batch === selectedBatchDef.batch);
    if (exactBatch.length > 0) return exactBatch;
    return students.filter((st) => st.profYear === selectedBatchDef.profYear);
  }, [students, selectedBatchDef]);

  const filteredBatchStudents = useMemo(() => {
    const q = batchSearch.trim().toLowerCase();
    if (!q) return selectedBatchStudents;
    return selectedBatchStudents.filter(
      (s) => s.fullName.toLowerCase().includes(q) || s.rollNumber.toLowerCase().includes(q)
    );
  }, [selectedBatchStudents, batchSearch]);

  const newFormSummary = useMemo(() => {
    let present = 0;
    let late = 0;
    let absent = 0;
    selectedBatchStudents.forEach((st) => {
      const status = newFormStatusMap[st.id] || 'present';
      if (status === 'present') present += 1;
      else if (status === 'late') late += 1;
      else absent += 1;
    });
    return { present, late, absent, total: selectedBatchStudents.length };
  }, [selectedBatchStudents, newFormStatusMap]);

  const handleSubjectSelect = (nextSubId: string) => {
    setSubjectId(nextSubId);
    const sub = subjectOptions.find((s) => s.id === nextSubId);
    if (!sub) return;
    if (sub.teacherName) {
      setSelectedTeacherName(sub.teacherName);
    }
    const matchingBatch = batchOptions.find((b) => b.profYear === sub.profYear);
    if (matchingBatch) {
      setSelectedBatchId(matchingBatch.id);
    }
  };

  const handleMarkAllBatch = (status: StudentAttendanceStatus) => {
    const next: Record<string, StudentAttendanceStatus> = { ...newFormStatusMap };
    selectedBatchStudents.forEach((st) => {
      next[st.id] = status;
    });
    setNewFormStatusMap(next);
  };

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) || null,
    [sessions, selectedSessionId]
  );

  useEffect(() => {
    if (activeSession) {
      setNotes(activeSession.notes || '');
      setEditTopic(activeSession.topicTaught || '');
      setEditActivity(activeSession.activityType || 'Regular Class');
      setEditEntryMode(activeSession.entryMode || 'live');
      setSessionSelfMark(activeSession.allowStudentSelfMark);
      setQrAutoRotate(Boolean(activeSession.qrRotatingEnabled));
      setQrCountdown(30);
      setConfirmSubmit(false);
      setAuditTarget(null);
    }
  }, [activeSession]);

  // Generate live QR DataURL whenever active draft session or checkInCode updates
  useEffect(() => {
    let cancelled = false;
    if (!activeSession || activeSession.status === 'submitted') {
      setQrDataUrl('');
      return;
    }
    const payload = `SSPSAMCH|SESSION:${activeSession.id}|CODE:${activeSession.checkInCode}`;
    QRCode.toDataURL(payload, { width: 176, margin: 1, color: { dark: '#0c2b20', light: '#ffffff' } })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [activeSession?.id, activeSession?.checkInCode, activeSession?.status]);

  // Auto-rotate QR code every 30s when enabled on an open draft session
  useEffect(() => {
    if (!activeSession || activeSession.status === 'submitted' || !qrAutoRotate || !pinVerified) {
      return;
    }
    const timer = window.setInterval(() => {
      setQrCountdown((prev) => {
        if (prev <= 1) {
          void rotateSessionCheckInCode({
            sessionId: activeSession.id,
            qrRotatingEnabled: true,
            allowStudentSelfMark: true,
          });
          return 30;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeSession?.id, activeSession?.status, qrAutoRotate, pinVerified]);

  const handleManualRotateQr = async () => {
    if (!activeSession || activeSession.status === 'submitted' || !pinVerified) return;
    setRotatingQr(true);
    try {
      const nextCode = await rotateSessionCheckInCode({
        sessionId: activeSession.id,
        qrRotatingEnabled: qrAutoRotate,
        allowStudentSelfMark: true,
      });
      setQrCountdown(30);
      setFeedback(`Check-in QR rotated to ${nextCode}.`);
    } finally {
      setRotatingQr(false);
    }
  };

  const handleToggleAutoRotateQr = async (enabled: boolean) => {
    if (!activeSession || activeSession.status === 'submitted' || !pinVerified) return;
    setQrAutoRotate(enabled);
    setQrCountdown(30);
    await rotateSessionCheckInCode({
      sessionId: activeSession.id,
      newCode: activeSession.checkInCode,
      qrRotatingEnabled: enabled,
      allowStudentSelfMark: true,
    });
  };

  const handleToggleGeoFenceRequired = async (enabled: boolean) => {
    if (!activeSession || activeSession.status === 'submitted' || !pinVerified) return;
    await rotateSessionCheckInCode({
      sessionId: activeSession.id,
      newCode: activeSession.checkInCode,
      geoFenceRequired: enabled,
    });
    setFeedback(
      enabled
        ? 'Campus GPS Geo-Fence enabled for this session check-in.'
        : 'Campus GPS Geo-Fence turned off for this session.'
    );
  };

  useEffect(() => {
    if (!activeSession) {
      setRecords([]);
      setCheckIns([]);
      return;
    }

    const recPath = `attendanceSessions/${activeSession.id}/records`;
    const unsubRecords = onSnapshot(
      query(collection(db, 'attendanceSessions', activeSession.id, 'records')),
      (snap) => {
        const list = snap.docs
          .map((d) => d.data() as SessionStudentRecord)
          .sort((a, b) => a.rollNumber.localeCompare(b.rollNumber));
        setRecords(list);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, recPath)
    );

    const checkPath = `attendanceSessions/${activeSession.id}/checkIns`;
    const unsubCheckIns = onSnapshot(
      query(collection(db, 'attendanceSessions', activeSession.id, 'checkIns')),
      (snap) => {
        setCheckIns(snap.docs.map((d) => d.data() as StudentCheckIn));
      },
      (error) => handleFirestoreError(error, OperationType.LIST, checkPath)
    );

    return () => {
      unsubRecords();
      unsubCheckIns();
    };
  }, [activeSession]);

  const studentsMap = useMemo(() => {
    const map: Record<string, StudentRecord> = {};
    students.forEach((s) => {
      map[s.id] = s;
    });
    return map;
  }, [students]);

  const staffUids = useMemo(() => {
    const set = new Set<string>([currentUid]);
    students.forEach((s) => s.staffUids.forEach((u) => set.add(u)));
    return Array.from(set);
  }, [students, currentUid]);

  const handleVerifyPin = (e: React.FormEvent) => {
    e.preventDefault();
    if (pinInput.trim() === FACULTY_SECURITY_PIN) {
      setPinVerified(true);
      setPinError(null);
    } else {
      setPinError('Incorrect Faculty Security PIN. Use institutional PIN 2422.');
    }
  };

  const handleTimeChange = (start: string, end: string) => {
    setStartTime(start);
    setEndTime(end);
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    if (!Number.isNaN(sh) && !Number.isNaN(eh)) {
      const diff = (eh * 60 + em - (sh * 60 + sm)) / 60;
      if (diff > 0 && diff <= 8) {
        setDurationHours(Number(diff.toFixed(1)));
      }
    }
  };

  const submitSessionForm = async (submitImmediately: boolean) => {
    const subject = subjectOptions.find((s) => s.id === subjectId) || subjectOptions[0];
    if (!subject || !selectedBatchDef) return;

    const matchedTeacher =
      teachers.find((t) => t.fullName === selectedTeacherName) ||
      teachers.find((t) => t.id === subject.teacherId);

    const teacher: TeacherProfile = matchedTeacher || {
      id: subject.teacherId || 't_default',
      ownerUid: currentUid,
      fullName: selectedTeacherName || currentName,
      designation: 'Faculty',
      department: subject.department,
      qualification: 'BAMS, MD',
      employeeCode: 'FAC-SSPS',
      officeHours: 'Mon-Sat',
      bio: '',
      avatarUrl: '',
      assignedSubjects: [subject.code],
      weeklyHours: 12,
      sessionsSubmitted: 0,
      sessionsDraft: 0,
      avgAttendanceRate: 85,
      institutionId: 'bams-ayurveda',
    };

    const initialStatusMap: Record<string, StudentAttendanceStatus> = {};
    selectedBatchStudents.forEach((st) => {
      initialStatusMap[st.id] = newFormStatusMap[st.id] || 'present';
    });

    setCreatingMode(submitImmediately ? 'submit' : 'draft');
    setFeedback(null);
    try {
      const { sessionId, alertCount } = await createAttendanceSession({
        teacherUid: currentUid,
        teacher,
        teacherExistsInDb: Boolean(matchedTeacher),
        subject: { ...subject, profYear: selectedBatchDef.profYear },
        batchLabel: selectedBatchDef.label,
        sessionType,
        activityType,
        topicTaught: topicTaught.trim() || `${subject.name} — ${sessionType}`,
        entryMode,
        date,
        startTime,
        endTime,
        durationHours,
        room,
        allowStudentSelfMark: !submitImmediately && entryMode === 'live' ? allowSelfMark : false,
        notes: newNotes,
        students: selectedBatchStudents,
        initialStatusMap,
        submitImmediately,
        staffUids,
        actorRole: currentRole,
        actorName: currentName,
      });
      setSelectedSessionId(sessionId);
      setShowNewForm(false);
      setTopicTaught('');
      setNewNotes('');
      setNewFormStatusMap({});
      setFeedback(
        submitImmediately
          ? `Final Attendance Submitted for ${selectedBatchDef.label} (${subject.code}).${
              alertCount > 0 ? ` ${alertCount} low-attendance alert(s) triggered.` : ''
            }`
          : `Saved in Draft for ${selectedBatchDef.label} (${subject.code}). You can adjust latecomers anytime before Final Submit.`
      );
    } finally {
      setCreatingMode(null);
    }
  };

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitSessionForm(false);
  };

  const updateStudentRow = (
    studentId: string,
    status: StudentAttendanceStatus,
    customHours?: number
  ) => {
    if (!activeSession || activeSession.status === 'submitted') return;
    const fullHrs = activeSession.durationHours;
    const defaultCredited =
      status === 'present' ? fullHrs : status === 'late' ? Number((fullHrs * 0.5).toFixed(1)) : 0;

    setRecords((prev) =>
      prev.map((r) =>
        r.studentId === studentId
          ? {
              ...r,
              status,
              creditedHours: customHours !== undefined ? customHours : defaultCredited,
              checkInTime:
                status !== 'absent' && !r.checkInTime
                  ? new Date().toTimeString().slice(0, 5)
                  : r.checkInTime,
            }
          : r
      )
    );
  };

  const syncLiveCheckIns = () => {
    if (!activeSession || activeSession.status === 'submitted' || checkIns.length === 0) return;
    const checkedIds = new Set(checkIns.map((c) => c.studentId));
    const checkedUids = new Set(checkIns.map((c) => c.uid));
    setRecords((prev) =>
      prev.map((r) =>
        checkedIds.has(r.studentId) || checkedUids.has(r.studentUid)
          ? {
              ...r,
              status: 'present',
              creditedHours: activeSession.durationHours,
              selfCheckedIn: true,
              checkInTime: r.checkInTime || new Date().toTimeString().slice(0, 5),
              remarks: r.remarks || 'Self check-in synced',
            }
          : r
      )
    );
    setFeedback(`Synced ${checkIns.length} student check-in(s) into the draft register.`);
  };

  const handleSaveDraft = async () => {
    if (!activeSession) return;
    setBusyAction('draft');
    setFeedback(null);
    try {
      await saveSessionDraft({
        session: activeSession,
        records,
        notes,
        topicTaught: editTopic,
        activityType: editActivity,
        entryMode: editEntryMode,
        allowStudentSelfMark: editEntryMode === 'live' ? sessionSelfMark : false,
        actorUid: currentUid,
        actorName: currentName,
        actorRole: currentRole,
      });
      setFeedback('Draft saved safely. You can return anytime to adjust late student arrivals.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSubmitFinal = async () => {
    if (!activeSession) return;
    setBusyAction('submit');
    setFeedback(null);
    try {
      const subject = subjects.find((s) => s.id === activeSession.subjectId);
      const teacher = teachers.find((t) => t.id === activeSession.teacherId);
      const alertCount = await submitSessionFinal({
        session: activeSession,
        records,
        notes,
        topicTaught: editTopic,
        activityType: editActivity,
        entryMode: editEntryMode,
        studentsMap,
        subject,
        teacher,
        actorUid: currentUid,
        actorName: currentName,
        actorRole: currentRole,
      });
      setConfirmSubmit(false);
      setFeedback(
        `Session submitted and locked. Cumulative BAMS hours updated${
          alertCount > 0 ? ` · ${alertCount} automated absenteeism alert(s) triggered.` : '.'
        }`
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleApplyAuditCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSession || !auditTarget || !auditReason.trim()) return;
    setBusyAction('audit');
    try {
      const newHrs =
        auditStatus === 'present'
          ? activeSession.durationHours
          : auditStatus === 'late'
            ? Number((activeSession.durationHours * 0.5).toFixed(1))
            : 0;
      await adminCorrectSubmittedRecord({
        session: activeSession,
        records,
        targetRecord: auditTarget,
        newStatus: auditStatus,
        newCreditedHours: newHrs,
        correctionReason: auditReason.trim(),
        student: studentsMap[auditTarget.studentId],
        actorUid: currentUid,
        actorName: currentName,
        actorRole: currentRole,
      });
      setFeedback(`Audited correction logged for ${auditTarget.studentName}.`);
      setAuditTarget(null);
      setAuditReason('');
    } finally {
      setBusyAction(null);
    }
  };

  const isLocked = activeSession?.status === 'submitted';
  const canAuditCorrect =
    currentRole === 'admin' || currentRole === 'co_admin' || currentRole === 'principal' || canOverride;
  const isAdmin = currentRole === 'admin' || canOverride;

  const unrecordedStudents = useMemo(() => {
    const presentIds = new Set(records.map((r) => r.studentId));
    return students.filter((s) => !presentIds.has(s.id));
  }, [students, records]);

  const handleAdminAddStudent = async () => {
    if (!activeSession || !isAdmin) return;
    const stu = unrecordedStudents.find((s) => s.id === adminAddStudentId) || unrecordedStudents[0];
    if (!stu) return;
    setBusyAction('admin');
    try {
      await adminAddRecordToSession({
        session: activeSession,
        records,
        student: stu,
        status: adminAddStatus,
        actorUid: currentUid,
        actorName: currentName,
      });
      setFeedback(`Added ${stu.fullName} (${adminAddStatus}) to ${activeSession.subjectCode}.`);
      setAdminAddStudentId('');
    } finally {
      setBusyAction(null);
    }
  };

  const handleAdminRemoveStudent = async (rec: SessionStudentRecord) => {
    if (!activeSession || !isAdmin) return;
    setBusyAction('admin');
    try {
      await adminRemoveRecordFromSession({
        session: activeSession,
        records,
        targetRecord: rec,
        student: studentsMap[rec.studentId],
        actorUid: currentUid,
        actorName: currentName,
      });
      setFeedback(`Removed ${rec.studentName}'s attendance entry from ${activeSession.subjectCode}.`);
    } finally {
      setBusyAction(null);
    }
  };

  const handleAdminDeleteSession = async () => {
    if (!activeSession || !isAdmin) return;
    setBusyAction('admin');
    try {
      const code = activeSession.subjectCode;
      await adminDeleteSession({
        session: activeSession,
        actorUid: currentUid,
        actorName: currentName,
      });
      setSelectedSessionId('');
      setFeedback(`Deleted register ${code}.`);
    } finally {
      setBusyAction(null);
    }
  };

  const summaryCounts = useMemo(() => {
    const present = records.filter((r) => r.status === 'present').length;
    const late = records.filter((r) => r.status === 'late').length;
    const absent = records.filter((r) => r.status === 'absent').length;
    return { present, late, absent };
  }, [records]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Hours-Wise Class Register &amp; Activity Log
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Security PIN verified · Topic &amp; class activity tracking · Draft safety for latecomers
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowNewForm((v) => !v)}
          className="btn-3d inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-white rounded-xl self-start sm:self-auto whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          {showNewForm ? 'Back to Registers' : 'Start New Class Session'}
        </button>
      </div>

      {/* Security PIN Gate (Slide 4 & 5) */}
      {!pinVerified && (
        <form
          onSubmit={handleVerifyPin}
          className="surface-3d rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        >
          <div className="flex items-start gap-3">
            <KeyRound className="w-5 h-5 text-emerald-700 mt-0.5 shrink-0" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Faculty Security PIN Required for Edits
              </h2>
              <p className="text-xs text-slate-500">
                Enter your department PIN (<span className="font-mono font-semibold">2422</span>) before creating or submitting class registers.
              </p>
              {pinError && <p className="mt-1 text-xs text-red-700">{pinError}</p>}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <input
              type="password"
              maxLength={8}
              placeholder="PIN (2422)"
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              className="w-28 px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
            />
            <button
              type="submit"
              className="btn-3d px-4 py-2 text-xs font-medium text-white rounded-lg whitespace-nowrap"
            >
              Verify PIN
            </button>
          </div>
        </form>
      )}

      {feedback && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-xs text-emerald-900 flex items-center justify-between gap-3">
          <span>{feedback}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-emerald-800 font-medium hover:underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Today's Scheduled Timetable Quick-Start Bar (Shown ONLY when Timetable is ACTIVE) */}
      {masterConfig?.timetableActive && todayTimetableSlots.length > 0 && (
        <section className="surface-3d rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-stone-900">
              <CalendarClock className="w-4 h-4 text-emerald-800" />
              Today&apos;s Active Timetable ({getTodayDayOfWeek()}) — 1-Click Start Class
            </div>
            <span className="text-[11px] font-mono text-emerald-800 font-semibold">
              {todayTimetableSlots.length} scheduled
            </span>
          </div>
          <div className="flex gap-2.5 overflow-x-auto pb-1">
            {todayTimetableSlots.map((slot) => (
              <button
                key={slot.id}
                type="button"
                onClick={() => applyTimetableSlotToForm(slot)}
                className="text-left min-w-[210px] shrink-0 bg-white border border-amber-900/15 hover:border-emerald-700 rounded-xl p-3 transition-colors"
              >
                <p className="text-[11px] font-mono font-bold text-emerald-900 tabular-nums">
                  {slot.startTime}–{slot.endTime} · {slot.batch}
                </p>
                <p className="text-xs font-bold text-stone-900 truncate mt-0.5">
                  {slot.subjectCode} · {slot.subjectName}
                </p>
                <p className="text-[11px] text-stone-500 truncate">
                  {slot.teacherName} · {slot.room}
                </p>
              </button>
            ))}
          </div>
        </section>
      )}

      {showNewForm && (
        <form
          onSubmit={handleCreateSession}
          className="surface-3d rounded-2xl p-5 sm:p-6 space-y-5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-amber-900/15">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-stone-900">
                SSPSAMC&amp;H Session-Wise Live Attendance Form
              </h2>
              <p className="text-xs text-stone-600">
                Daily Class Register · Select Faculty, Subject Code, Session, Batch &amp; mark student attendance directly
              </p>
            </div>
            <div className="inline-flex items-center gap-1 p-1 surface-3d-inset rounded-lg self-start">
              {(
                [
                  { id: 'live', label: 'Live Class' },
                  { id: 'paper_backup', label: 'Paper Backup SOP' },
                ] as const
              ).map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setEntryMode(mode.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap ${
                    entryMode === mode.id
                      ? 'bg-white text-stone-900 shadow-xs'
                      : 'text-stone-600'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1.5">
                Registered Faculty Email *
              </label>
              <input
                type="email"
                readOnly
                value={currentEmail || 'faculty@sspsamch.edu'}
                className="w-full px-3 py-2 text-xs font-mono bg-stone-100 text-stone-700 border border-amber-900/20 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1.5">
                Teacher Name *
              </label>
              <select
                required
                value={selectedTeacherName}
                onChange={(e) => setSelectedTeacherName(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-amber-900/20 rounded-lg focus:outline-none focus:border-emerald-700"
              >
                {teacherNameOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1.5">
                Subject (Code &amp; Name) *
              </label>
              <select
                value={subjectId}
                onChange={(e) => handleSubjectSelect(e.target.value)}
                required
                className="w-full px-3 py-2 text-xs bg-white border border-amber-900/20 rounded-lg focus:outline-none focus:border-emerald-700"
              >
                {subjectOptions.map((sub) => (
                  <option key={sub.id} value={sub.id}>
                    {sub.code} · {sub.name} ({sub.profYear})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1.5">
                Session *
              </label>
              <select
                value={sessionType}
                onChange={(e) => setSessionType(e.target.value as SessionType)}
                className="w-full px-3 py-2 text-xs bg-white border border-amber-900/20 rounded-lg focus:outline-none focus:border-emerald-700"
              >
                {sessionTypeOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1.5">
                Batch *
              </label>
              <select
                value={selectedBatchId}
                onChange={(e) => setSelectedBatchId(e.target.value)}
                className="w-full px-3 py-2 text-xs font-medium bg-white border border-amber-900/20 rounded-lg focus:outline-none focus:border-emerald-700"
              >
                {batchOptions.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1.5">
                Class Activity Type
              </label>
              <select
                value={activityType}
                onChange={(e) => setActivityType(e.target.value as ActivityType)}
                className="w-full px-3 py-2 text-xs bg-white border border-amber-900/20 rounded-lg focus:outline-none focus:border-emerald-700"
              >
                {activityTypeOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1.5">
                Class Start Date *
              </label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-white border border-amber-900/20 rounded-lg focus:outline-none focus:border-emerald-700"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1.5">
                  Start Time *
                </label>
                <input
                  type="time"
                  required
                  value={startTime}
                  onChange={(e) => handleTimeChange(e.target.value, endTime)}
                  className="w-full px-3 py-2 text-xs font-mono bg-white border border-amber-900/20 rounded-lg focus:outline-none focus:border-emerald-700"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1.5">
                  End Time *
                </label>
                <input
                  type="time"
                  required
                  value={endTime}
                  onChange={(e) => handleTimeChange(startTime, e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono bg-white border border-amber-900/20 rounded-lg focus:outline-none focus:border-emerald-700"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1.5">
                  Duration (Hrs)
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  max="8"
                  required
                  value={durationHours}
                  onChange={(e) => setDurationHours(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-white border border-amber-900/20 rounded-lg focus:outline-none focus:border-emerald-700"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-700 mb-1.5">
                  Hall / Ward *
                </label>
                <input
                  type="text"
                  required
                  maxLength={60}
                  value={room}
                  onChange={(e) => setRoom(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white border border-amber-900/20 rounded-lg focus:outline-none focus:border-emerald-700"
                />
              </div>
            </div>
          </div>

          {/* Live Batch Student Grid (Present / Late / Absent) */}
          <div className="surface-3d-inset rounded-xl p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-stone-900">
                  {selectedBatchDef?.label} · Student Attendance Sheet ({selectedBatchStudents.length} Students)
                </p>
                <p className="text-xs text-stone-600 font-mono tabular-nums mt-0.5">
                  Present: <strong className="text-emerald-800">{newFormSummary.present}</strong> · Late:{' '}
                  <strong className="text-amber-700">{newFormSummary.late}</strong> · Absent:{' '}
                  <strong className="text-red-700">{newFormSummary.absent}</strong>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  placeholder="Search student or roll..."
                  value={batchSearch}
                  onChange={(e) => setBatchSearch(e.target.value)}
                  className="px-3 py-1.5 text-xs bg-white border border-amber-900/20 rounded-lg"
                />
                <button
                  type="button"
                  onClick={() => handleMarkAllBatch('present')}
                  className="btn-3d-secondary px-2.5 py-1.5 text-xs font-medium text-emerald-900 rounded-lg whitespace-nowrap"
                >
                  Mark All Present
                </button>
                <button
                  type="button"
                  onClick={() => handleMarkAllBatch('absent')}
                  className="btn-3d-secondary px-2.5 py-1.5 text-xs font-medium text-red-700 rounded-lg whitespace-nowrap"
                >
                  Mark All Absent
                </button>
              </div>
            </div>

            {filteredBatchStudents.length > 0 ? (
              <div className="max-h-72 overflow-y-auto border border-amber-900/15 rounded-xl bg-white divide-y divide-amber-900/10">
                {filteredBatchStudents.map((st) => {
                  const status = newFormStatusMap[st.id] || 'present';
                  return (
                    <div
                      key={st.id}
                      className="px-3 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <span className="font-mono text-xs text-stone-500 mr-2 tabular-nums">
                          {st.rollNumber}
                        </span>
                        <span className="text-xs font-semibold text-stone-900">{st.fullName}</span>
                      </div>

                      <div className="grid grid-cols-3 gap-1.5 shrink-0">
                        {(['present', 'late', 'absent'] as StudentAttendanceStatus[]).map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() =>
                              setNewFormStatusMap((prev) => ({ ...prev, [st.id]: opt }))
                            }
                            className={`min-h-[38px] sm:min-h-[32px] px-3 text-xs font-semibold rounded-md capitalize transition-colors ${
                              status === opt
                                ? opt === 'present'
                                  ? 'bg-emerald-800 text-white'
                                  : opt === 'late'
                                    ? 'bg-amber-600 text-white'
                                    : 'bg-red-700 text-white'
                                : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                            }`}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-4 bg-white border border-amber-900/15 rounded-xl text-xs text-stone-600">
                No students loaded for this batch yet. Ask Admin to click &quot;Sync Sample SSPSAMCH Data&quot; in Admin Hub.
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1.5">
                Topic Covered / Important Topics *
              </label>
              <input
                type="text"
                maxLength={160}
                required
                placeholder="e.g. Asthi Sharir Osteology Landmarks or Sessional Test 1"
                value={topicTaught}
                onChange={(e) => setTopicTaught(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-amber-900/20 rounded-lg focus:outline-none focus:border-emerald-700"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1.5">
                Any Remarks / Faculty Notes
              </label>
              <input
                type="text"
                maxLength={300}
                placeholder="Optional remarks for Principal / Academic log"
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white border border-amber-900/20 rounded-lg focus:outline-none focus:border-emerald-700"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-amber-900/10">
            {entryMode === 'live' ? (
              <label className="inline-flex items-center gap-2.5 text-xs font-medium text-stone-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowSelfMark}
                  onChange={(e) => setAllowSelfMark(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-700"
                />
                Allow students to submit verified 6-digit self check-in if saved in Draft
              </label>
            ) : (
              <p className="text-xs text-amber-800">
                Emergency SOP: Register will be tagged as a manual Paper Backup sync entry.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3 self-end sm:self-auto">
              <button
                type="button"
                disabled={creatingMode !== null || !pinVerified}
                onClick={() => submitSessionForm(false)}
                className="btn-3d-secondary inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-stone-800 disabled:opacity-60 rounded-xl whitespace-nowrap"
              >
                <Clock className="w-3.5 h-3.5" />
                {creatingMode === 'draft' ? 'Saving Draft...' : 'Save as Draft'}
              </button>
              <button
                type="button"
                disabled={creatingMode !== null || !pinVerified}
                onClick={() => submitSessionForm(true)}
                className="btn-3d inline-flex items-center gap-1.5 px-5 py-2.5 text-xs font-semibold text-white disabled:opacity-60 rounded-xl whitespace-nowrap"
              >
                <Send className="w-3.5 h-3.5" />
                {creatingMode === 'submit' ? 'Submitting...' : 'Final Submit Attendance'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Session Selector + Active Register Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 space-y-2">
          <p className="text-xs font-semibold text-slate-700 px-1">
            Recent Sessions ({sessions.length})
          </p>
          <div className="surface-3d rounded-2xl divide-y divide-slate-100 max-h-[580px] overflow-y-auto">
            {sessions.map((sess) => {
              const isSelected = sess.id === activeSession?.id;
              return (
                <button
                  key={sess.id}
                  type="button"
                  onClick={() => {
                    setSelectedSessionId(sess.id);
                    setShowNewForm(false);
                  }}
                  className={`w-full text-left p-4 transition-colors ${
                    isSelected ? 'bg-emerald-50/70' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-900 truncate">
                      {sess.subjectCode} · {sess.profYear}
                    </span>
                    <span
                      className={`text-xs font-medium shrink-0 ${
                        sess.status === 'draft' ? 'text-amber-700' : 'text-emerald-800'
                      }`}
                    >
                      {sess.status === 'draft' ? 'Draft' : 'Submitted'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600 truncate">
                    {sess.topicTaught || sess.subjectName}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
                    <span>{sess.date}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {sess.startTime}-{sess.endTime} ({sess.durationHours}h)
                    </span>
                    {sess.entryMode === 'paper_backup' && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-sans text-amber-700">Paper Backup</span>
                      </>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-8">
          {activeSession ? (
            <div className="surface-3d rounded-2xl p-5 sm:p-6 space-y-5">
              {/* Session Header */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-4 border-b border-slate-200">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>{activeSession.batchLabel || activeSession.profYear}</span>
                    <span aria-hidden="true">·</span>
                    <span>{activeSession.sessionType}</span>
                    <span aria-hidden="true">·</span>
                    <span>{activeSession.activityType}</span>
                    <span aria-hidden="true">·</span>
                    <span>{activeSession.room}</span>
                  </div>
                  <h2 className="mt-1 text-lg font-bold text-slate-900">
                    {activeSession.subjectCode}: {activeSession.subjectName}
                  </h2>
                  <p className="mt-1 text-xs text-slate-700">
                    Topic: {activeSession.topicTaught || 'Regular Curriculum Class'}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
                    {activeSession.date} · {activeSession.startTime}–{activeSession.endTime} (
                    {activeSession.durationHours} hrs) · {activeSession.teacherName}
                  </p>
                </div>

                <div className="flex flex-col items-start sm:items-end gap-1.5 shrink-0">
                  <span
                    className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                      isLocked ? 'text-emerald-800' : 'text-amber-700'
                    }`}
                  >
                    {isLocked ? <Lock className="w-3.5 h-3.5" /> : <FileEdit className="w-3.5 h-3.5" />}
                    {isLocked ? 'Finalized & Locked' : 'Saved in Draft (Editable)'}
                  </span>

                  {!isLocked && (
                    <div className="text-xs text-slate-600 font-mono tabular-nums">
                      Student Check-In Code:{' '}
                      <strong className="text-slate-900">{activeSession.checkInCode}</strong>
                    </div>
                  )}

                  {isAdmin && (
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={handleAdminDeleteSession}
                      className="inline-flex items-center gap-1 text-xs font-medium text-red-700 hover:text-red-900"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete Register
                    </button>
                  )}
                </div>
              </div>

              {/* Admin Add Student to Session Bar */}
              {isAdmin && unrecordedStudents.length > 0 && (
                <div className="surface-3d-inset rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs font-medium text-stone-800">
                    <UserPlus className="w-4 h-4 text-emerald-800 shrink-0" />
                    <span>Admin Add Student to Register:</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={adminAddStudentId || unrecordedStudents[0]?.id || ''}
                      onChange={(e) => setAdminAddStudentId(e.target.value)}
                      className="px-2.5 py-1.5 text-xs bg-white border border-amber-900/20 rounded-lg max-w-[220px]"
                    >
                      {unrecordedStudents.map((stu) => (
                        <option key={stu.id} value={stu.id}>
                          {stu.rollNumber} · {stu.fullName} ({stu.profYear})
                        </option>
                      ))}
                    </select>
                    <select
                      value={adminAddStatus}
                      onChange={(e) => setAdminAddStatus(e.target.value as StudentAttendanceStatus)}
                      className="px-2.5 py-1.5 text-xs bg-white border border-amber-900/20 rounded-lg"
                    >
                      <option value="present">Present</option>
                      <option value="late">Late</option>
                      <option value="absent">Absent</option>
                    </select>
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={handleAdminAddStudent}
                      className="btn-3d px-3 py-1.5 text-xs font-medium text-white rounded-lg whitespace-nowrap"
                    >
                      Add Entry
                    </button>
                  </div>
                </div>
              )}

              {/* Audited Correction Form (Slide 5 & 17) */}
              {auditTarget && isLocked && canAuditCorrect && (
                <form
                  onSubmit={handleApplyAuditCorrection}
                  className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3"
                >
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-900">
                    <ShieldAlert className="w-4 h-4" />
                    Exceptional Post-Submit Audit Correction: {auditTarget.studentName} (
                    {auditTarget.rollNumber})
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <select
                      value={auditStatus}
                      onChange={(e) => setAuditStatus(e.target.value as StudentAttendanceStatus)}
                      className="px-3 py-2 text-xs bg-white border border-amber-300 rounded-lg"
                    >
                      <option value="present">Present ({activeSession.durationHours}h)</option>
                      <option value="late">
                        Late ({Number((activeSession.durationHours * 0.5).toFixed(1))}h)
                      </option>
                      <option value="absent">Absent (0h)</option>
                    </select>
                    <input
                      type="text"
                      required
                      maxLength={140}
                      placeholder="Mandatory audit reason (e.g. Medical leave approved)"
                      value={auditReason}
                      onChange={(e) => setAuditReason(e.target.value)}
                      className="sm:col-span-2 px-3 py-2 text-xs bg-white border border-amber-300 rounded-lg"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setAuditTarget(null)}
                      className="px-3 py-1.5 text-xs text-slate-700 bg-white border border-slate-200 rounded-lg"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={busyAction === 'audit'}
                      className="px-4 py-1.5 text-xs font-medium text-white bg-emerald-800 hover:bg-emerald-900 rounded-lg"
                    >
                      {busyAction === 'audit' ? 'Logging...' : 'Save Audited Correction'}
                    </button>
                  </div>
                </form>
              )}

              {/* Live Student Check-In Sync Bar + Proxy-Proof Rotating QR & Campus Geo-Fence */}
              {!isLocked && (
                <div className="surface-3d-inset rounded-xl p-4 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 text-xs text-stone-700">
                      <UserCheck className="w-4 h-4 text-emerald-700 shrink-0" />
                      <span>
                        <strong className="font-mono tabular-nums">{checkIns.length}</strong>{' '}
                        student self check-in(s) received via classroom QR / code
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="inline-flex items-center gap-1.5 text-xs text-stone-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={sessionSelfMark}
                          onChange={(e) => setSessionSelfMark(e.target.checked)}
                          className="rounded border-slate-300 text-emerald-700"
                        />
                        Open Check-In
                      </label>
                      <button
                        type="button"
                        onClick={syncLiveCheckIns}
                        disabled={checkIns.length === 0}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-900 bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Sync Check-Ins
                      </button>
                    </div>
                  </div>

                  {sessionSelfMark && (
                    <div className="bg-white border border-amber-900/15 rounded-xl p-4 flex flex-col sm:flex-row items-center gap-4">
                      <div className="shrink-0 bg-white p-2 border border-amber-900/15 rounded-xl">
                        {qrDataUrl ? (
                          <img
                            src={qrDataUrl}
                            alt={`Live QR for code ${activeSession.checkInCode}`}
                            className="w-32 h-32 block"
                          />
                        ) : (
                          <div className="w-32 h-32 flex items-center justify-center bg-stone-50 text-stone-400">
                            <QrCode className="w-8 h-8" />
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0 space-y-2.5 text-center sm:text-left">
                        <div className="flex flex-wrap items-center justify-center sm:justify-between gap-2">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
                              Proxy-Proof Classroom Check-In QR
                            </p>
                            <p className="text-2xl font-mono font-bold tracking-widest text-stone-900 tabular-nums">
                              {activeSession.checkInCode}
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={rotatingQr || !pinVerified}
                            onClick={handleManualRotateQr}
                            className="btn-3d-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-stone-800 rounded-lg whitespace-nowrap"
                          >
                            <RotateCw className={`w-3.5 h-3.5 ${rotatingQr ? 'animate-spin' : ''}`} />
                            Rotate Now
                          </button>
                        </div>

                        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-4 text-xs">
                          <label className="inline-flex items-center gap-1.5 cursor-pointer text-stone-700 font-medium">
                            <input
                              type="checkbox"
                              disabled={!pinVerified}
                              checked={qrAutoRotate}
                              onChange={(e) => handleToggleAutoRotateQr(e.target.checked)}
                              className="rounded border-slate-300 text-emerald-800"
                            />
                            Auto-Rotate QR (30s)
                            {qrAutoRotate && (
                              <span className="font-mono text-emerald-800 font-bold tabular-nums">
                                · {qrCountdown}s
                              </span>
                            )}
                          </label>

                          <label className="inline-flex items-center gap-1.5 cursor-pointer text-stone-700 font-medium">
                            <input
                              type="checkbox"
                              disabled={!pinVerified}
                              checked={Boolean(
                                activeSession.geoFenceRequired ?? masterConfig?.geoFenceEnabled
                              )}
                              onChange={(e) => handleToggleGeoFenceRequired(e.target.checked)}
                              className="rounded border-slate-300 text-emerald-800"
                            />
                            <MapPin className="w-3.5 h-3.5 text-emerald-800" />
                            Campus GPS Check ({masterConfig?.campusRadiusMeters ?? 250}m)
                          </label>
                        </div>
                        <p className="text-[11px] text-stone-500">
                          Display on projector/screen. Rotating every 30 seconds prevents WhatsApp code-sharing proxy attendance.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Summary Strip */}
              <div className="flex flex-wrap items-center gap-6 text-xs font-mono tabular-nums text-slate-700">
                <span>
                  Present: <strong className="text-emerald-800">{summaryCounts.present}</strong>
                </span>
                <span>
                  Late (Partial Hrs):{' '}
                  <strong className="text-amber-700">{summaryCounts.late}</strong>
                </span>
                <span>
                  Absent: <strong className="text-red-700">{summaryCounts.absent}</strong>
                </span>
                <span>
                  Total Batch: <strong>{records.length}</strong>
                </span>
              </div>

              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                      <th className="py-2.5 px-3">Roll No.</th>
                      <th className="py-2.5 px-3">Student Name</th>
                      <th className="py-2.5 px-3">Attendance Status</th>
                      <th className="py-2.5 px-3 text-right">Credited Hrs</th>
                      <th className="py-2.5 px-3 text-right">
                        {isLocked && canAuditCorrect ? 'Audit' : 'Check-In'}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {records.map((rec) => (
                      <tr key={rec.studentId} className="hover:bg-slate-50/70">
                        <td className="py-2.5 px-3 font-mono text-xs text-slate-600 tabular-nums">
                          {rec.rollNumber}
                        </td>
                        <td className="py-2.5 px-3 font-medium text-slate-900">
                          {rec.studentName}
                          {rec.selfCheckedIn && (
                            <span className="ml-2 text-xs text-emerald-700 font-normal">
                              · Verified
                            </span>
                          )}
                          {rec.remarks.startsWith('Audit Correction') && (
                            <span className="ml-2 text-xs text-amber-700 font-normal">
                              · {rec.remarks}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="inline-flex items-center gap-1 p-0.5 bg-slate-100 rounded-md">
                            {(['present', 'late', 'absent'] as StudentAttendanceStatus[]).map(
                              (st) => (
                                <button
                                  key={st}
                                  type="button"
                                  disabled={isLocked || !pinVerified}
                                  onClick={() => updateStudentRow(rec.studentId, st)}
                                  className={`px-2.5 py-1 text-xs font-medium rounded capitalize transition-colors ${
                                    rec.status === st
                                      ? st === 'present'
                                        ? 'bg-emerald-800 text-white'
                                        : st === 'late'
                                          ? 'bg-amber-600 text-white'
                                          : 'bg-red-700 text-white'
                                      : 'text-slate-600 hover:text-slate-900 disabled:opacity-50'
                                  }`}
                                >
                                  {st}
                                </button>
                              )
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {!isLocked && rec.status === 'late' ? (
                            <input
                              type="number"
                              step="0.5"
                              min="0"
                              max={activeSession.durationHours}
                              value={rec.creditedHours}
                              onChange={(e) =>
                                updateStudentRow(
                                  rec.studentId,
                                  'late',
                                  Math.min(
                                    activeSession.durationHours,
                                    Math.max(0, Number(e.target.value))
                                  )
                                )
                              }
                              className="w-16 px-2 py-1 text-right font-mono text-xs tabular-nums border border-slate-200 rounded"
                            />
                          ) : (
                            <span className="font-mono text-xs tabular-nums text-slate-800">
                              {rec.creditedHours.toFixed(1)}h
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-xs text-slate-500 tabular-nums">
                          <div className="inline-flex items-center justify-end gap-2.5">
                            {isLocked && canAuditCorrect ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setAuditTarget(rec);
                                  setAuditStatus(rec.status);
                                }}
                                className="font-sans text-xs font-medium text-emerald-800 hover:underline"
                              >
                                Correct
                              </button>
                            ) : (
                              <span>{rec.checkInTime || '—'}</span>
                            )}
                            {isAdmin && (
                              <button
                                type="button"
                                disabled={busyAction !== null}
                                onClick={() => handleAdminRemoveStudent(rec)}
                                className="font-sans text-xs font-medium text-red-700 hover:underline"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile-Friendly Touch Cards */}
              <div className="md:hidden space-y-3">
                {records.map((rec) => (
                  <div
                    key={rec.studentId}
                    className="border border-slate-200 rounded-lg p-3.5 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{rec.studentName}</p>
                        <p className="text-xs font-mono text-slate-500 tabular-nums">
                          {rec.rollNumber} · {rec.creditedHours.toFixed(1)}h credited
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {isLocked && canAuditCorrect && (
                          <button
                            type="button"
                            onClick={() => {
                              setAuditTarget(rec);
                              setAuditStatus(rec.status);
                            }}
                            className="text-xs font-medium text-emerald-800 hover:underline"
                          >
                            Audit Correct
                          </button>
                        )}
                        {isAdmin && (
                          <button
                            type="button"
                            disabled={busyAction !== null}
                            onClick={() => handleAdminRemoveStudent(rec)}
                            className="text-xs font-medium text-red-700 hover:underline"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      {(['present', 'late', 'absent'] as StudentAttendanceStatus[]).map((st) => (
                        <button
                          key={st}
                          type="button"
                          disabled={isLocked || !pinVerified}
                          onClick={() => updateStudentRow(rec.studentId, st)}
                          className={`min-h-[44px] text-xs font-medium rounded-lg border capitalize transition-colors ${
                            rec.status === st
                              ? st === 'present'
                                ? 'bg-emerald-800 text-white border-emerald-800'
                                : st === 'late'
                                  ? 'bg-amber-600 text-white border-amber-600'
                                  : 'bg-red-700 text-white border-red-700'
                              : 'bg-white text-slate-700 border-slate-200'
                          }`}
                        >
                          {st}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Activity, Topic & Save/Submit Controls */}
              {!isLocked && (
                <div className="pt-2 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Class Activity
                      </label>
                      <select
                        value={editActivity}
                        onChange={(e) => setEditActivity(e.target.value as ActivityType)}
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg"
                      >
                        {activityTypeOptions.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Topic Taught / Activity Detail
                      </label>
                      <input
                        type="text"
                        maxLength={160}
                        value={editTopic}
                        onChange={(e) => setEditTopic(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Entry Mode (SOP)
                      </label>
                      <select
                        value={editEntryMode}
                        onChange={(e) => setEditEntryMode(e.target.value as EntryMode)}
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg"
                      >
                        <option value="live">Live Classroom Entry</option>
                        <option value="paper_backup">Paper Backup Update</option>
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Faculty Remarks
                      </label>
                      <input
                        type="text"
                        maxLength={300}
                        placeholder="e.g. Waiting for 2nd bus hostel batch before final submit"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg"
                      />
                    </div>
                  </div>

                  {confirmSubmit ? (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <p className="text-xs text-amber-900">
                        Submitting locks this register, credits student hours, and triggers automatic alerts for anyone below 75%. Proceed?
                      </p>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setConfirmSubmit(false)}
                          className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={busyAction !== null || !pinVerified}
                          onClick={handleSubmitFinal}
                          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-emerald-800 hover:bg-emerald-900 rounded-lg"
                        >
                          <Check className="w-3.5 h-3.5" />
                          {busyAction === 'submit' ? 'Submitting...' : 'Confirm & Lock'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-end gap-3">
                      <button
                        type="button"
                        disabled={busyAction !== null || !pinVerified}
                        onClick={handleSaveDraft}
                        className="btn-3d-secondary inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-slate-800 disabled:opacity-50 rounded-xl whitespace-nowrap"
                      >
                        <Clock className="w-3.5 h-3.5" />
                        {busyAction === 'draft' ? 'Saving Draft...' : 'Save in Draft'}
                      </button>
                      <button
                        type="button"
                        disabled={busyAction !== null || !pinVerified}
                        onClick={() => setConfirmSubmit(true)}
                        className="btn-3d inline-flex items-center gap-2 px-5 py-2.5 text-xs font-medium text-white disabled:opacity-50 rounded-xl whitespace-nowrap"
                      >
                        <Send className="w-3.5 h-3.5" />
                        Submit Final Attendance
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="surface-3d rounded-2xl p-10 text-center text-sm text-slate-500">
              Select a session on the left or open a new class session.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
