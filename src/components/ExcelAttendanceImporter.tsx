import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Calendar,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  MailPlus,
  Sparkles,
  Upload,
  Users,
  XCircle,
} from 'lucide-react';
import {
  adminBulkImportStudentAttendance,
  adminCreateAccessInvite,
  adminImportGoogleFormAttendance,
  BulkAttendanceUpdateItem,
  GoogleFormSessionImportPayload,
} from '../services/bamsFirestore';
import {
  AccessInvite,
  AttendanceSession,
  DEFAULT_PROF_YEARS,
  DEFAULT_ROLE_PERMISSIONS,
  MasterConfig,
  ProfYear,
  StudentAttendanceStatus,
  StudentRecord,
  Subject,
  TeacherProfile,
  UserProfile,
  VALIDATION_LIMITS,
} from '../types';
import { findBestFuzzyMatch } from '../utils/smartHelpers';

interface ExcelAttendanceImporterProps {
  students: StudentRecord[];
  sessions: AttendanceSession[];
  subjects: Subject[];
  teachers: TeacherProfile[];
  users: UserProfile[];
  invites: AccessInvite[];
  masterConfig?: MasterConfig | null;
  actorUid: string;
  actorName: string;
  staffUids: string[];
  onImported: (message: string) => void;
}

// ---------- Shared Helpers ----------

function normalizeHeader(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function normalizeNameForMatch(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickValue(row: Record<string, unknown>, candidates: string[]): unknown {
  const entries = Object.entries(row);
  for (const cand of candidates) {
    const exact = entries.find(([k]) => normalizeHeader(k) === cand);
    if (exact !== undefined && exact[1] !== '' && exact[1] !== null && exact[1] !== undefined) {
      return exact[1];
    }
  }
  for (const cand of candidates) {
    const partial = entries.find(([k]) => normalizeHeader(k).includes(cand));
    if (partial !== undefined && partial[1] !== '' && partial[1] !== null && partial[1] !== undefined) {
      return partial[1];
    }
  }
  return undefined;
}

function parseNumeric(val: unknown): number | null {
  if (val === undefined || val === null || val === '') return null;
  const num = typeof val === 'number' ? val : Number(String(val).replace(/,/g, '').trim());
  return Number.isFinite(num) ? num : null;
}

function namesLookCompatible(excelName: string, portalName: string): boolean {
  const cleanA = normalizeNameForMatch(excelName);
  const cleanB = normalizeNameForMatch(portalName);
  if (!cleanA || !cleanB) return true;
  if (cleanA === cleanB || cleanA.includes(cleanB) || cleanB.includes(cleanA)) return true;
  const tokensA = cleanA.split(' ').filter((t) => t.length >= 2);
  const tokensB = cleanB.split(' ').filter((t) => t.length >= 2);
  if (tokensA.length === 0 || tokensB.length === 0) return false;
  return tokensA[0] === tokensB[0];
}

function excelSerialToDate(serial: number): Date {
  // Excel epoch: Dec 30, 1899 in UTC days
  const utcDays = Math.floor(serial - 25569);
  const utcMs = utcDays * 86400 * 1000;
  const fractionalDay = serial - Math.floor(serial);
  const dayMs = Math.round(fractionalDay * 86400 * 1000);
  return new Date(utcMs + dayMs);
}

function parseExcelDate(val: unknown): string | null {
  if (val === undefined || val === null || val === '') return null;
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof val === 'number' && val > 20000 && val < 90000) {
    const dObj = excelSerialToDate(val);
    const y = dObj.getUTCFullYear();
    const m = String(dObj.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dObj.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const str = String(val).trim();
  if (!str) return null;
  const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
  }
  // Google Forms / US Excel exports commonly use M/D/YYYY (e.g. 8/19/2026, 3/2/2026)
  const slashMatch = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (slashMatch) {
    let p1 = Number(slashMatch[1]);
    let p2 = Number(slashMatch[2]);
    let yr = Number(slashMatch[3]);
    if (yr < 100) yr += 2000;
    // If first part > 12, it must be DD/MM/YYYY; otherwise treat as MM/DD/YYYY (Google Sheets default)
    let month = p1;
    let day = p2;
    if (p1 > 12 && p2 <= 12) {
      day = p1;
      month = p2;
    }
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${yr}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

function parseExcelTime(val: unknown): { hhmm: string; isSuspiciousAm: boolean } {
  const fallback = { hhmm: '09:00', isSuspiciousAm: false };
  if (val === undefined || val === null || val === '') return fallback;

  let hours = 9;
  let minutes = 0;
  let parsed = false;

  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    hours = val.getHours();
    minutes = val.getMinutes();
    parsed = true;
  } else if (typeof val === 'number') {
    const frac = val >= 1 ? val - Math.floor(val) : val;
    const totalMins = Math.round(frac * 24 * 60);
    hours = Math.floor(totalMins / 60) % 24;
    minutes = totalMins % 60;
    parsed = true;
  } else {
    const str = String(val).trim();
    const match = str.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i);
    if (match) {
      hours = Number(match[1]);
      minutes = Number(match[2]);
      const meridiem = match[3]?.toUpperCase();
      if (meridiem === 'PM' && hours < 12) hours += 12;
      if (meridiem === 'AM' && hours === 12) hours = 0;
      parsed = true;
    }
  }

  if (!parsed || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return fallback;
  }
  const hhmm = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  // BAMS classes run daytime; 00:00–05:59 AM almost always indicates a Google Form AM/PM typo
  const isSuspiciousAm = hours >= 0 && hours < 6;
  return { hhmm, isSuspiciousAm };
}

function addHoursToTime(hhmm: string, addHours: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const startMins = (Number.isFinite(h) ? h : 9) * 60 + (Number.isFinite(m) ? m : 0);
  const endMins = Math.min(23 * 60 + 59, startMins + Math.round(addHours * 60));
  const eh = String(Math.floor(endMins / 60)).padStart(2, '0');
  const em = String(endMins % 60).padStart(2, '0');
  return `${eh}:${em}`;
}

function formatTimestampCompact(val: unknown): string {
  if (!val) return '';
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return val.toISOString().slice(0, 16).replace('T', ' ');
  }
  if (typeof val === 'number' && val > 20000) {
    return excelSerialToDate(val).toISOString().slice(0, 16).replace('T', ' ');
  }
  return String(val).trim().slice(0, 32);
}

function parseStudentHeader(header: string): { serial: number | null; name: string } | null {
  const trimmed = header.trim();
  // Google Forms checkbox grid headers look like: " [1 ABHAY PRATAP MAURYA]" or "[1\tABHAY PRATAP MAURYA]"
  const bracketMatch = trimmed.match(/^\[?\s*(\d{1,3})\s+([^\]]+?)\s*\]?$/);
  if (bracketMatch) {
    return {
      serial: Number(bracketMatch[1]),
      name: bracketMatch[2].replace(/\]$/, '').trim(),
    };
  }
  return null;
}

function parseCellStatus(val: unknown): StudentAttendanceStatus | null {
  if (val === undefined || val === null) return null;
  const s = String(val).trim().toLowerCase();
  if (!s) return null;
  if (s === 'present' || s === 'p' || s === '1' || s === 'yes' || s.startsWith('present')) {
    return 'present';
  }
  if (s === 'absent' || s === 'a' || s === '0' || s === 'no' || s.startsWith('absent')) {
    return 'absent';
  }
  if (s.includes('late') || s === 'l' || s.includes('half') || s.includes('leave')) {
    return 'late';
  }
  return null;
}

function defaultBatchForProf(prof: string, firstProfDefaultBatch = 'Batch 2025'): string {
  const lower = prof.toLowerCase();
  if (lower.includes('4th') || lower.includes('fourth') || lower.includes('final')) return 'Batch 2022';
  if (lower.includes('3rd') || lower.includes('third')) return 'Batch 2023';
  if (lower.includes('2nd') || lower.includes('second')) return 'Batch 2024';
  if (lower.includes('1st') || lower.includes('first')) return firstProfDefaultBatch;
  const yr = prof.match(/(20\d{2})/);
  if (yr) return `Batch ${yr[1]}`;
  return prof.trim().slice(0, 20) || 'Batch 2025';
}

function buildAutoRollPrefix(batch: string): string {
  const yrMatch = batch.match(/(\d{2})$/);
  return `BAMS${yrMatch ? yrMatch[1] : '25'}`;
}

function extractBatchYearToken(text: string): string | null {
  const m = text.match(/(20\d{2})/);
  return m ? `Batch ${m[1]}` : null;
}

function detectExplicitProfFromText(
  lower: string,
  customProfYears: string[]
): ProfYear | null {
  if (lower.includes('4th') || lower.includes('fourth') || lower.includes('final')) {
    return '4th Prof';
  }
  if (lower.includes('3rd') || lower.includes('third')) {
    return '3rd Prof';
  }
  if (lower.includes('2nd') || lower.includes('second')) {
    return '2nd Prof';
  }
  if (lower.includes('1st') || lower.includes('first')) {
    return '1st Prof';
  }
  for (const cp of customProfYears) {
    const cleanCp = cp.trim().toLowerCase();
    if (cleanCp && lower && (lower.includes(cleanCp) || cleanCp.includes(lower))) {
      return cp;
    }
  }
  return null;
}

function resolveBatchFromText(params: {
  batchText: string;
  forcedProf: 'auto' | ProfYear;
  forcedBatch: 'auto' | string;
  customProfYears?: string[];
  batchToLiveProf?: Map<string, ProfYear>;
  profToDefaultLiveBatch?: Map<ProfYear, string>;
}): { profYear: ProfYear; batch: string; batchLabel: string } {
  const lower = params.batchText.toLowerCase();
  const explicitYearBatch = extractBatchYearToken(params.batchText);
  const explicitProf = detectExplicitProfFromText(lower, params.customProfYears || []);

  // Resolve Prof Year (supports forced Prof, explicit Prof in sheet, live promoted batch->prof, or year inference)
  let profYear: ProfYear = '1st Prof';
  if (params.forcedProf !== 'auto') {
    profYear = params.forcedProf;
  } else if (explicitProf) {
    profYear = explicitProf;
  } else if (explicitYearBatch && params.batchToLiveProf?.get(explicitYearBatch)) {
    profYear = params.batchToLiveProf.get(explicitYearBatch)!;
  } else if (explicitYearBatch === 'Batch 2022') {
    profYear = '4th Prof';
  } else if (explicitYearBatch === 'Batch 2023') {
    profYear = '3rd Prof';
  } else if (explicitYearBatch === 'Batch 2024') {
    profYear = '2nd Prof';
  } else {
    profYear = '1st Prof';
  }

  // Resolve Batch (supports forced Batch, explicit year in sheet, live batch for that Prof, or default fallback)
  let batch = 'Batch 2025';
  if (params.forcedBatch !== 'auto') {
    batch = params.forcedBatch;
  } else if (explicitYearBatch) {
    batch = explicitYearBatch;
  } else if (params.profToDefaultLiveBatch?.get(profYear)) {
    batch = params.profToDefaultLiveBatch.get(profYear)!;
  } else {
    batch = defaultBatchForProf(profYear);
  }

  const cleanProfDisplay = profYear.replace(/\s*Prof$/i, ' Professional');
  const yrShort = batch.replace(/^Batch\s+/i, '');
  const batchLabel =
    params.forcedProf !== 'auto' || params.forcedBatch !== 'auto'
      ? `(${yrShort}) BAMS ${cleanProfDisplay}`
      : params.batchText.trim() || `(${yrShort}) BAMS ${cleanProfDisplay}`;

  return { profYear, batch, batchLabel };
}

function matchSubjectForRow(
  subjectText: string,
  profYear: ProfYear,
  subjects: Subject[]
): Subject | null {
  const clean = normalizeNameForMatch(subjectText);
  if (!clean) return null;
  // Prefer exact or strong substring match within same profYear first
  const sameProf = subjects.filter((s) => s.profYear === profYear);
  const candidates = [...sameProf, ...subjects.filter((s) => s.profYear !== profYear)];

  for (const sub of candidates) {
    const subClean = normalizeNameForMatch(sub.name);
    const codeClean = normalizeNameForMatch(sub.code);
    if (clean === subClean || clean === codeClean) return sub;
  }
  for (const sub of candidates) {
    const subClean = normalizeNameForMatch(sub.name);
    if (subClean.includes(clean) || clean.includes(subClean)) return sub;
  }
  // Token overlap fallback (e.g. "Agad Tantra avum Vidhi Vaidyak" vs "... Vaidyaka")
  const tokensA = clean.split(' ').filter((w) => w.length >= 4);
  let best: { sub: Subject; score: number } | null = null;
  for (const sub of candidates) {
    const subClean = normalizeNameForMatch(sub.name);
    const matches = tokensA.filter((t) => subClean.includes(t.slice(0, 5))).length;
    if (matches >= 1 && (!best || matches > best.score)) {
      best = { sub, score: matches };
    }
  }
  return best ? best.sub : null;
}

function buildSafeSessionId(
  date: string,
  startTime: string,
  subjectCode: string,
  batch: string,
  rowIndex: number,
  seenIds: Set<string>
): string {
  const raw = `gf_${date}_${startTime}_${subjectCode}_${batch}`
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 110);
  if (!seenIds.has(raw)) {
    seenIds.add(raw);
    return raw;
  }
  const withRow = `${raw.slice(0, 100)}_r${rowIndex}`;
  seenIds.add(withRow);
  return withRow;
}

// ---------- Types ----------

interface ParsedSummaryRow {
  rowNum: number;
  rollNumber: string;
  excelName: string;
  profYearInput: ProfYear;
  batchInput: string;
  scheduledInput: number;
  theoryInput: number;
  practicalInput: number;
  attendedInput: number;
  consecutiveInput: number;
  matchedStudent: StudentRecord | null;
  virtualStudent: StudentRecord | null;
  errorMsg: string | null;
  nameWarning: string | null;
}

interface ParsedGoogleFormRow {
  rowNum: number;
  sessionId: string;
  dedupKey: string;
  isDuplicate: boolean;
  skipReason: string | null;
  qualityWarning: string | null;
  timestampLabel: string;
  teacherEmail: string;
  teacherName: string;
  matchedTeacher: TeacherProfile | null;
  securityPin: string;
  rawSubject: string;
  matchedSubject: Subject | null;
  subjectCode: string;
  subjectName: string;
  profYear: ProfYear;
  batch: string;
  batchLabel: string;
  date: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  sessionType: string;
  presentCount: number;
  lateCount: number;
  absentCount: number;
  studentMarks: Array<{
    student: StudentRecord;
    status: StudentAttendanceStatus;
    creditedHours: number;
    headerName: string;
    isNewStudent?: boolean;
  }>;
  unmatchedColumns: string[];
}

export const ExcelAttendanceImporter: React.FC<ExcelAttendanceImporterProps> = ({
  students,
  sessions,
  subjects,
  teachers,
  users,
  invites,
  masterConfig,
  actorUid,
  actorName,
  staffUids,
  onImported,
}) => {
  const [activeModeTab, setActiveModeTab] = useState<'google_form' | 'summary'>('google_form');

  // --- Shared / Google Form Importer State ---
  const gfInputRef = useRef<HTMLInputElement | null>(null);
  const [gfFileName, setGfFileName] = useState('');
  const [gfTargetProf, setGfTargetProf] = useState<'auto' | ProfYear>('auto');
  const [gfTargetBatch, setGfTargetBatch] = useState<'auto' | string>('auto');
  const [defaultDuration, setDefaultDuration] = useState<number>(1);
  const [defaultSessionType, setDefaultSessionType] = useState<string>('Theory (Class Hours)');
  const [pinFilter, setPinFilter] = useState<string>('');
  const [skipDuplicates, setSkipDuplicates] = useState<boolean>(true);
  const [saveSessionsToo, setSaveSessionsToo] = useState<boolean>(true);
  const [autoEnrollMissing, setAutoEnrollMissing] = useState<boolean>(true);
  const [gfImportMode, setGfImportMode] = useState<'add' | 'replace'>('add');
  const [gfRawSheetRows, setGfRawSheetRows] = useState<Record<string, unknown>[]>([]);
  const [gfParseError, setGfParseError] = useState<string | null>(null);
  const [gfPreviewTab, setGfPreviewTab] = useState<'sessions' | 'students' | 'faculty'>('sessions');
  const [gfImporting, setGfImporting] = useState(false);
  const [invitingAll, setInvitingAll] = useState(false);
  const [inviteStatusMsg, setInviteStatusMsg] = useState<string | null>(null);
  const [smartFixAppliedMsg, setSmartFixAppliedMsg] = useState<string | null>(null);

  // --- Summary Balance Importer State ---
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [templateBatch, setTemplateBatch] = useState<string>('All');
  const [summaryDefaultProf, setSummaryDefaultProf] = useState<'auto' | ProfYear>('auto');
  const [importMode, setImportMode] = useState<'replace' | 'add'>('replace');
  const [fileName, setFileName] = useState<string>('');
  const [parsedRows, setParsedRows] = useState<ParsedSummaryRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const profYearOptions = useMemo(
    () => (masterConfig?.profYears?.length ? masterConfig.profYears : DEFAULT_PROF_YEARS),
    [masterConfig]
  );

  const batches = useMemo(() => {
    const set = new Set<string>([
      'Batch 2026',
      'Batch 2025',
      'Batch 2024',
      'Batch 2023',
      'Batch 2022',
    ]);
    students.forEach((s) => {
      if (s.batch) set.add(s.batch);
    });
    profYearOptions.forEach((py) => set.add(defaultBatchForProf(py)));
    return ['All', ...Array.from(set).sort()];
  }, [students, profYearOptions]);

  const batchToLiveProf = useMemo(() => {
    const map = new Map<string, ProfYear>();
    students.forEach((s) => {
      if (s.batch && s.profYear && !map.has(s.batch)) {
        map.set(s.batch, s.profYear);
      }
    });
    return map;
  }, [students]);

  const profToDefaultLiveBatch = useMemo(() => {
    const map = new Map<ProfYear, string>();
    students.forEach((s) => {
      if (s.profYear && s.batch && !map.has(s.profYear)) {
        map.set(s.profYear, s.batch);
      }
    });
    return map;
  }, [students]);

  const studentsByRoll = useMemo(() => {
    const map = new Map<string, StudentRecord>();
    students.forEach((s) => map.set(s.rollNumber.trim().toUpperCase(), s));
    return map;
  }, [students]);

  const studentsByBatch = useMemo(() => {
    const map = new Map<string, StudentRecord[]>();
    students.forEach((s) => {
      const list = map.get(s.batch) || [];
      list.push(s);
      map.set(s.batch, list);
    });
    return map;
  }, [students]);

  const existingDedupKeys = useMemo(() => {
    const set = new Set<string>();
    const idSet = new Set<string>();
    sessions.forEach((s) => {
      idSet.add(s.id);
      const yrBatch = extractBatchYearToken(s.batchLabel || '') || s.profYear;
      set.add(`${s.date}|${s.startTime}|${s.subjectCode.toUpperCase()}|${yrBatch}`);
    });
    return { keys: set, ids: idSet };
  }, [sessions]);

  // ---------- Google Form Parsing ----------
  const handleGoogleFormFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setGfParseError(null);
    setInviteStatusMsg(null);
    setGfFileName(file.name);

    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        setGfParseError('Excel file me koi sheet nahi mili.');
        setGfRawSheetRows([]);
        return;
      }

      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        workbook.Sheets[firstSheetName],
        { defval: '' }
      );

      if (rawRows.length === 0) {
        setGfParseError('Uploaded Google Form Excel sheet khali hai.');
        setGfRawSheetRows([]);
        return;
      }

      const firstKeys = Object.keys(rawRows[0] || {});
      const hasStudentCols = firstKeys.some((k) => parseStudentHeader(k) !== null);
      if (!hasStudentCols) {
        setGfParseError(
          'Is sheet me "[1 STUDENT NAME]" wale Google Form student columns nahi mile. Agar aapke pass Roll Number summary sheet hai, to upar "Student Summary Balance Sheet" tab use karein.'
        );
        setGfRawSheetRows([]);
        return;
      }

      setGfRawSheetRows(rawRows);
    } catch (err) {
      setGfParseError(err instanceof Error ? err.message : 'Unable to read Google Form Excel file.');
      setGfRawSheetRows([]);
    } finally {
      if (gfInputRef.current) gfInputRef.current.value = '';
    }
  };

  const parsedGoogleForm = useMemo(() => {
    if (gfRawSheetRows.length === 0) {
      return {
        rows: [] as ParsedGoogleFormRow[],
        studentAggregates: [] as Array<{
          student: StudentRecord;
          scheduledAdded: number;
          attendedAdded: number;
          theoryAdded: number;
          practicalAdded: number;
          classesCount: number;
          presentCount: number;
          absentCount: number;
          trailingConsecutiveAbsences: number;
          updateItem: BulkAttendanceUpdateItem;
        }>,
        extractedFaculty: [] as Array<{
          email: string;
          teacherName: string;
          classCount: number;
          subjects: string[];
          status: 'active_user' | 'pending_user' | 'invited' | 'not_registered';
        }>,
        unmatchedColumnSet: [] as string[],
      };
    }

    const seenSessionIds = new Set<string>();
    const allKeys = Object.keys(gfRawSheetRows[0] || {});
    const studentColumnDefs = allKeys
      .map((rawKey) => ({ rawKey, parsed: parseStudentHeader(rawKey) }))
      .filter(
        (item): item is { rawKey: string; parsed: { serial: number | null; name: string } } =>
          item.parsed !== null
      );

    const unmatchedColumnSet = new Set<string>();
    const virtualNewStudents = new Map<string, StudentRecord>();
    const teacherMap = new Map<
      string,
      { email: string; teacherName: string; classCount: number; subjects: Set<string> }
    >();

    const parsedList: ParsedGoogleFormRow[] = gfRawSheetRows.map((raw, idx) => {
      const rowNum = idx + 2;
      const timestampLabel = formatTimestampCompact(
        pickValue(raw, ['timestamp', 'submittedat', 'time'])
      );
      const teacherEmail = String(
        pickValue(raw, ['emailaddress', 'email', 'facultyemail']) || ''
      )
        .trim()
        .toLowerCase();
      const securityPin = String(
        pickValue(raw, ['entersecuritypin', 'securitypin', 'pin']) || ''
      ).trim();
      const teacherName = String(
        pickValue(raw, ['teachername', 'facultyname', 'teacher']) || 'BAMS Faculty'
      ).trim();
      const rawSubject = String(
        pickValue(raw, ['subject', 'subjectname', 'course']) || 'BAMS Class'
      ).trim();
      const rawDate = pickValue(raw, ['classstartdate', 'date', 'classdate']);
      const rawTime = pickValue(raw, ['classstarttime', 'starttime', 'classtime', 'time']);
      const rawBatch = String(pickValue(raw, ['batch', 'prof', 'profyear', 'class']) || '').trim();

      const resolvedBatch = resolveBatchFromText({
        batchText: rawBatch,
        forcedProf: gfTargetProf,
        forcedBatch: gfTargetBatch,
        customProfYears: profYearOptions,
        batchToLiveProf,
        profToDefaultLiveBatch,
      });
      const parsedDate = parseExcelDate(rawDate);
      const { hhmm: startTime, isSuspiciousAm } = parseExcelTime(rawTime);
      const duration = Math.min(8, Math.max(0.5, defaultDuration));
      const endTime = addHoursToTime(startTime, duration);

      const matchedSub = matchSubjectForRow(rawSubject, resolvedBatch.profYear, subjects);
      const subjectCode = matchedSub
        ? matchedSub.code
        : `GF-${rawSubject
            .replace(/[^a-zA-Z0-9]/g, '')
            .toUpperCase()
            .slice(0, 8) || 'SUB'}`;
      const subjectName = matchedSub ? matchedSub.name : rawSubject;

      const matchedTeacher =
        teachers.find((t) => namesLookCompatible(teacherName, t.fullName)) || null;

      if (teacherEmail) {
        const prev = teacherMap.get(teacherEmail) || {
          email: teacherEmail,
          teacherName,
          classCount: 0,
          subjects: new Set<string>(),
        };
        prev.classCount += 1;
        prev.subjects.add(subjectName);
        teacherMap.set(teacherEmail, prev);
      }

      const batchStudents = studentsByBatch.get(resolvedBatch.batch) || [];
      const studentMarks: ParsedGoogleFormRow['studentMarks'] = [];
      const rowUnmatched: string[] = [];

      studentColumnDefs.forEach(({ rawKey, parsed }) => {
        const status = parseCellStatus(raw[rawKey]);
        if (!status) return; // Blank cell -> student not in this row's batch!

        let matched: StudentRecord | undefined;
        let isNew = false;

        // 1. Prefer serial + compatible name inside row's batch
        if (parsed.serial !== null) {
          const rollSuffix = `-${String(parsed.serial).padStart(3, '0')}`;
          const byRoll = batchStudents.find((s) => s.rollNumber.endsWith(rollSuffix));
          if (byRoll && namesLookCompatible(parsed.name, byRoll.fullName)) {
            matched = byRoll;
          }
        }
        // 2. Exact or compatible name match inside row's batch
        const cleanTarget = normalizeNameForMatch(parsed.name);
        if (!matched) {
          matched = batchStudents.find(
            (s) => normalizeNameForMatch(s.fullName) === cleanTarget
          );
        }
        if (!matched) {
          matched = batchStudents.find((s) => namesLookCompatible(parsed.name, s.fullName));
        }
        // 3. Cross-roster exact normalized name fallback (in case student exists under another prof/batch tag)
        if (!matched && cleanTarget) {
          matched = students.find(
            (s) => normalizeNameForMatch(s.fullName) === cleanTarget
          );
        }
        // 4. Auto-enroll missing student for 1st/2nd/3rd/4th/custom Prof when enabled
        if (!matched && autoEnrollMissing && parsed.name.trim().length >= 2) {
          const batchSlug = resolvedBatch.batch.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
          const nameSlug = parsed.name
            .replace(/[^a-zA-Z0-9]/g, '_')
            .toLowerCase()
            .slice(0, 24);
          const serialStr =
            parsed.serial !== null ? String(parsed.serial).padStart(3, '0') : String(rowNum);
          const vId = `gf_${batchSlug}_${serialStr}_${nameSlug}`.slice(0, 64);
          let virtual = virtualNewStudents.get(vId);
          if (!virtual) {
            const rollPrefix = buildAutoRollPrefix(resolvedBatch.batch);
            virtual = {
              id: vId,
              uid: vId,
              rollNumber: `${rollPrefix}-${serialStr}`,
              fullName: parsed.name.trim().slice(0, 90),
              profYear: resolvedBatch.profYear,
              batch: resolvedBatch.batch.slice(0, 20),
              totalHoursScheduled: 0,
              totalHoursAttended: 0,
              theoryHoursAttended: 0,
              practicalHoursAttended: 0,
              attendancePercent: 100,
              consecutiveAbsences: 0,
              standing: 'nominal',
              staffUids: staffUids.slice(0, VALIDATION_LIMITS.maxStaffList),
            };
            virtualNewStudents.set(vId, virtual);
          }
          matched = virtual;
          isNew = true;
        }

        if (matched) {
          const creditedHours =
            status === 'present'
              ? duration
              : status === 'late'
                ? Number((duration * 0.5).toFixed(1))
                : 0;
          studentMarks.push({
            student: matched,
            status,
            creditedHours,
            headerName: rawKey.trim(),
            isNewStudent: isNew,
          });
        } else {
          rowUnmatched.push(`${rawKey.trim()} (${resolvedBatch.batch})`);
          unmatchedColumnSet.add(`${rawKey.trim()} → ${resolvedBatch.batch}`);
        }
      });

      const dedupKey = `${parsedDate || 'invalid'}|${startTime}|${subjectCode.toUpperCase()}|${resolvedBatch.batch}`;
      const sessionId = buildSafeSessionId(
        parsedDate || 'nodate',
        startTime,
        subjectCode,
        resolvedBatch.batch,
        rowNum,
        seenSessionIds
      );

      const isDuplicate =
        Boolean(parsedDate) &&
        (existingDedupKeys.keys.has(dedupKey) || existingDedupKeys.ids.has(sessionId));

      let skipReason: string | null = null;
      if (!parsedDate) {
        skipReason = 'Invalid/Missing Class Start Date';
      } else if (pinFilter.trim() && securityPin !== pinFilter.trim()) {
        skipReason = `PIN "${securityPin || 'blank'}" != ${pinFilter.trim()}`;
      } else if (studentMarks.length === 0) {
        skipReason = `No Present/Absent marks matched for ${resolvedBatch.batch}`;
      } else if (skipDuplicates && isDuplicate) {
        skipReason = 'Already imported (Duplicate Class)';
      }

      const warnings: string[] = [];
      if (isSuspiciousAm) warnings.push(`Check AM/PM time (${startTime})`);
      if (!matchedSub) warnings.push(`New subject "${rawSubject}"`);
      if (rowUnmatched.length > 0) warnings.push(`${rowUnmatched.length} column(s) unmatched`);

      return {
        rowNum,
        sessionId,
        dedupKey,
        isDuplicate,
        skipReason,
        qualityWarning: warnings.length > 0 ? warnings.join(' · ') : null,
        timestampLabel,
        teacherEmail,
        teacherName,
        matchedTeacher,
        securityPin,
        rawSubject,
        matchedSubject: matchedSub,
        subjectCode,
        subjectName,
        profYear: resolvedBatch.profYear,
        batch: resolvedBatch.batch,
        batchLabel: resolvedBatch.batchLabel,
        date: parsedDate || '',
        startTime,
        endTime,
        durationHours: duration,
        sessionType: defaultSessionType,
        presentCount: studentMarks.filter((m) => m.status === 'present').length,
        lateCount: studentMarks.filter((m) => m.status === 'late').length,
        absentCount: studentMarks.filter((m) => m.status === 'absent').length,
        studentMarks,
        unmatchedColumns: rowUnmatched,
      };
    });

    // Aggregate chronologically per student across all active (non-skipped) rows
    const activeRowsChronological = parsedList
      .filter((r) => !r.skipReason)
      .sort(
        (a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)
      );

    const perStudent = new Map<
      string,
      {
        student: StudentRecord;
        isNewStudent: boolean;
        scheduledAdded: number;
        attendedAdded: number;
        theoryAdded: number;
        practicalAdded: number;
        classesCount: number;
        presentCount: number;
        absentCount: number;
        trailingConsecutiveAbsences: number;
      }
    >();

    const isTheory = defaultSessionType.toLowerCase().includes('theory');

    activeRowsChronological.forEach((row) => {
      row.studentMarks.forEach(({ student, status, creditedHours, isNewStudent }) => {
        const curr = perStudent.get(student.id) || {
          student,
          isNewStudent: Boolean(isNewStudent),
          scheduledAdded: 0,
          attendedAdded: 0,
          theoryAdded: 0,
          practicalAdded: 0,
          classesCount: 0,
          presentCount: 0,
          absentCount: 0,
          trailingConsecutiveAbsences: 0,
        };
        curr.scheduledAdded = Number((curr.scheduledAdded + row.durationHours).toFixed(1));
        curr.attendedAdded = Number((curr.attendedAdded + creditedHours).toFixed(1));
        if (isTheory) {
          curr.theoryAdded = Number((curr.theoryAdded + creditedHours).toFixed(1));
        } else {
          curr.practicalAdded = Number((curr.practicalAdded + creditedHours).toFixed(1));
        }
        curr.classesCount += 1;
        if (status === 'absent') {
          curr.absentCount += 1;
          curr.trailingConsecutiveAbsences += 1;
        } else {
          curr.presentCount += 1;
          curr.trailingConsecutiveAbsences = 0;
        }
        perStudent.set(student.id, curr);
      });
    });

    const studentAggregates = Array.from(perStudent.values())
      .sort((a, b) => a.student.rollNumber.localeCompare(b.student.rollNumber))
      .map((agg) => {
        const s = agg.student;
        const nextScheduled =
          gfImportMode === 'replace' || agg.isNewStudent
            ? agg.scheduledAdded
            : Number((s.totalHoursScheduled + agg.scheduledAdded).toFixed(1));
        const nextAttended =
          gfImportMode === 'replace' || agg.isNewStudent
            ? agg.attendedAdded
            : Number((s.totalHoursAttended + agg.attendedAdded).toFixed(1));
        const nextTheory =
          gfImportMode === 'replace' || agg.isNewStudent
            ? agg.theoryAdded
            : Number((s.theoryHoursAttended + agg.theoryAdded).toFixed(1));
        const nextPractical =
          gfImportMode === 'replace' || agg.isNewStudent
            ? agg.practicalAdded
            : Number((s.practicalHoursAttended + agg.practicalAdded).toFixed(1));
        const nextConsecutive =
          gfImportMode === 'replace' || agg.isNewStudent
            ? agg.trailingConsecutiveAbsences
            : agg.trailingConsecutiveAbsences > 0
              ? s.consecutiveAbsences + agg.trailingConsecutiveAbsences
              : 0;
        const cappedAttended =
          nextScheduled > 0 ? Math.min(nextScheduled, nextAttended) : nextAttended;
        const nextPercent =
          nextScheduled > 0
            ? Math.min(100, Number(((cappedAttended / nextScheduled) * 100).toFixed(1)))
            : 100;

        return {
          ...agg,
          updateItem: {
            student: s,
            nextScheduled,
            nextAttended: cappedAttended,
            nextTheory,
            nextPractical,
            nextConsecutive,
            nextPercent,
            isNewStudent: agg.isNewStudent,
          },
        };
      });

    const extractedFaculty = Array.from(teacherMap.values())
      .map((t) => {
        const userMatch = users.find((u) => u.email?.toLowerCase() === t.email);
        const inviteMatch = invites.find((inv) => inv.email.toLowerCase() === t.email);
        const status: 'active_user' | 'pending_user' | 'invited' | 'not_registered' =
          userMatch?.approvalStatus === 'active'
            ? 'active_user'
            : userMatch
              ? 'pending_user'
              : inviteMatch?.status === 'invited'
                ? 'invited'
                : 'not_registered';
        return {
          email: t.email,
          teacherName: t.teacherName,
          classCount: t.classCount,
          subjects: Array.from(t.subjects),
          status,
        };
      })
      .sort((a, b) => b.classCount - a.classCount);

    return {
      rows: parsedList,
      studentAggregates,
      extractedFaculty,
      unmatchedColumnSet: Array.from(unmatchedColumnSet),
    };
  }, [
    gfRawSheetRows,
    gfTargetProf,
    gfTargetBatch,
    profYearOptions,
    batchToLiveProf,
    profToDefaultLiveBatch,
    autoEnrollMissing,
    defaultDuration,
    defaultSessionType,
    pinFilter,
    skipDuplicates,
    gfImportMode,
    subjects,
    teachers,
    students,
    studentsByBatch,
    existingDedupKeys,
    staffUids,
    users,
    invites,
  ]);

  const validGfRows = useMemo(
    () => parsedGoogleForm.rows.filter((r) => !r.skipReason),
    [parsedGoogleForm.rows]
  );
  const skippedGfRows = useMemo(
    () => parsedGoogleForm.rows.filter((r) => Boolean(r.skipReason)),
    [parsedGoogleForm.rows]
  );
  const unregisteredFaculty = useMemo(
    () => parsedGoogleForm.extractedFaculty.filter((f) => f.status === 'not_registered'),
    [parsedGoogleForm.extractedFaculty]
  );

  // Smart Auto-Fix Suggestions: detects 01:00–05:59 AM typos, misspelled Subjects, and misspelled Faculty names
  const smartAutoFixes = useMemo(() => {
    if (gfRawSheetRows.length === 0) {
      return {
        amTimeFixes: 0,
        subjectFixes: [] as Array<{ rowIdx: number; from: string; to: string }>,
        teacherFixes: [] as Array<{ rowIdx: number; from: string; to: string }>,
        totalFixes: 0,
      };
    }

    let amTimeFixes = 0;
    const subjectFixes: Array<{ rowIdx: number; from: string; to: string }> = [];
    const teacherFixes: Array<{ rowIdx: number; from: string; to: string }> = [];

    gfRawSheetRows.forEach((raw, rowIdx) => {
      const rawTime = pickValue(raw, ['classstarttime', 'starttime', 'classtime', 'time']);
      const parsedTime = parseExcelTime(rawTime);
      if (parsedTime.isSuspiciousAm) {
        amTimeFixes += 1;
      }

      const rawSub = String(pickValue(raw, ['subject', 'subjectname', 'course']) || '').trim();
      if (rawSub && subjects.length > 0) {
        const parsedRow = parsedGoogleForm.rows[rowIdx];
        if (parsedRow && !parsedRow.matchedSubject) {
          const bestSub = findBestFuzzyMatch(rawSub, subjects, (s) => s.name, 0.48);
          if (bestSub && bestSub.item.name.toLowerCase() !== rawSub.toLowerCase()) {
            subjectFixes.push({ rowIdx, from: rawSub, to: bestSub.item.name });
          }
        }
      }

      const rawTeacher = String(
        pickValue(raw, ['teachername', 'facultyname', 'teacher']) || ''
      ).trim();
      if (rawTeacher && teachers.length > 0) {
        const parsedRow = parsedGoogleForm.rows[rowIdx];
        if (parsedRow && !parsedRow.matchedTeacher) {
          const bestTeacher = findBestFuzzyMatch(rawTeacher, teachers, (t) => t.fullName, 0.52);
          if (bestTeacher && bestTeacher.item.fullName.toLowerCase() !== rawTeacher.toLowerCase()) {
            teacherFixes.push({ rowIdx, from: rawTeacher, to: bestTeacher.item.fullName });
          }
        }
      }
    });

    return {
      amTimeFixes,
      subjectFixes,
      teacherFixes,
      totalFixes: amTimeFixes + subjectFixes.length + teacherFixes.length,
    };
  }, [gfRawSheetRows, parsedGoogleForm.rows, subjects, teachers]);

  const handleApplySmartFixes = () => {
    if (gfRawSheetRows.length === 0 || smartAutoFixes.totalFixes === 0) return;

    const findColKey = (row: Record<string, unknown>, candidates: string[]): string | null => {
      const keys = Object.keys(row);
      for (const c of candidates) {
        const exact = keys.find((k) => normalizeHeader(k) === c);
        if (exact) return exact;
      }
      for (const c of candidates) {
        const partial = keys.find((k) => normalizeHeader(k).includes(c));
        if (partial) return partial;
      }
      return null;
    };

    const subMap = new Map(smartAutoFixes.subjectFixes.map((f) => [f.rowIdx, f.to]));
    const teachMap = new Map(smartAutoFixes.teacherFixes.map((f) => [f.rowIdx, f.to]));

    const nextRows = gfRawSheetRows.map((raw, idx) => {
      const copy: Record<string, unknown> = { ...raw };

      const timeKey = findColKey(copy, ['classstarttime', 'starttime', 'classtime', 'time']);
      if (timeKey) {
        const parsedT = parseExcelTime(copy[timeKey]);
        if (parsedT.isSuspiciousAm) {
          const [h, m] = parsedT.hhmm.split(':').map(Number);
          const pmHour = h === 0 ? 12 : h + 12;
          copy[timeKey] = `${String(pmHour).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        }
      }

      const fixedSub = subMap.get(idx);
      if (fixedSub) {
        const subKey = findColKey(copy, ['subject', 'subjectname', 'course']);
        if (subKey) copy[subKey] = fixedSub;
      }

      const fixedTeacher = teachMap.get(idx);
      if (fixedTeacher) {
        const teachKey = findColKey(copy, ['teachername', 'facultyname', 'teacher']);
        if (teachKey) copy[teachKey] = fixedTeacher;
      }

      return copy;
    });

    setGfRawSheetRows(nextRows);
    setSmartFixAppliedMsg(
      `Applied ${smartAutoFixes.totalFixes} Smart Auto-Fix(es) — ${smartAutoFixes.amTimeFixes} AM→PM time fix(es), ${smartAutoFixes.subjectFixes.length} subject match(es), ${smartAutoFixes.teacherFixes.length} teacher name match(es).`
    );
  };

  const handlePreInviteExtractedFaculty = async () => {
    if (unregisteredFaculty.length === 0) return;
    setInvitingAll(true);
    setInviteStatusMsg(null);
    let created = 0;
    try {
      for (const fac of unregisteredFaculty) {
        await adminCreateAccessInvite({
          email: fac.email,
          displayName: fac.teacherName,
          role: 'teacher',
          profYear: 'All Profs',
          department: fac.subjects[0] || 'Ayurveda Faculty',
          rollOrEmpId: `FAC-GF-${String(Math.floor(100 + Math.random() * 900))}`,
          permissions: DEFAULT_ROLE_PERMISSIONS.teacher,
          existingUsers: users,
          actorUid,
          actorName,
          allStaffUids: staffUids,
        });
        created += 1;
      }
      setInviteStatusMsg(
        `${created} teacher email(s) ko auto-access PIN ke saath Faculty Invite list me add kar diya gaya.`
      );
    } finally {
      setInvitingAll(false);
    }
  };

  const handleConfirmGoogleFormImport = async () => {
    if (validGfRows.length === 0 || parsedGoogleForm.studentAggregates.length === 0) return;
    setGfImporting(true);
    try {
      const mergedStaff = Array.from(new Set([...staffUids, actorUid])).slice(
        0,
        VALIDATION_LIMITS.maxStaffList
      );
      const subjectHourDeltas: Record<string, number> = {};
      const existingSubjectsMap: Record<string, Subject> = {};
      subjects.forEach((s) => {
        existingSubjectsMap[s.id] = s;
      });

      const sessionsToCreate: GoogleFormSessionImportPayload[] = validGfRows.map((r) => {
        if (r.matchedSubject) {
          subjectHourDeltas[r.matchedSubject.id] =
            (subjectHourDeltas[r.matchedSubject.id] || 0) + r.durationHours;
        }
        const safeSubId = r.matchedSubject ? r.matchedSubject.id : r.subjectCode;
        const safeTeacherId = r.matchedTeacher ? r.matchedTeacher.id : 't_pdf_001';
        const noteText = `Google Form Import · Email: ${r.teacherEmail || 'n/a'}${
          r.timestampLabel ? ` · Submitted: ${r.timestampLabel}` : ''
        }${r.securityPin ? ` · PIN: ${r.securityPin}` : ''}`;

        return {
          sessionId: r.sessionId,
          sessionDoc: {
            id: r.sessionId,
            teacherUid: actorUid,
            teacherId: safeTeacherId,
            teacherName: r.teacherName,
            subjectId: safeSubId,
            subjectCode: r.subjectCode,
            subjectName: r.subjectName,
            profYear: r.profYear,
            batchLabel: r.batchLabel,
            sessionType: r.sessionType,
            activityType: 'Regular Class',
            topicTaught: `${r.subjectName} (${r.batch}) — Imported from Google Form`,
            entryMode: 'paper_backup',
            date: r.date,
            startTime: r.startTime,
            endTime: r.endTime,
            durationHours: r.durationHours,
            room: 'Google Form Sheet',
            status: 'submitted',
            allowStudentSelfMark: false,
            checkInCode: r.securityPin || 'GF2026',
            presentCount: r.presentCount,
            lateCount: r.lateCount,
            absentCount: r.absentCount,
            totalStudents: r.studentMarks.length,
            notes: noteText.slice(0, VALIDATION_LIMITS.notesMax),
            staffUids: mergedStaff,
          },
          records: r.studentMarks.map((m) => ({
            studentId: m.student.id,
            studentUid: m.student.uid,
            rollNumber: m.student.rollNumber,
            studentName: m.student.fullName,
            status: m.status,
            creditedHours: m.creditedHours,
            selfCheckedIn: false,
            checkInTime: m.status !== 'absent' ? r.startTime : '',
            remarks: `Google Form (${r.date})`,
            teacherUid: actorUid,
            staffUids: mergedStaff,
          })),
        };
      });

      const res = await adminImportGoogleFormAttendance({
        sessionsToCreate,
        studentUpdates: parsedGoogleForm.studentAggregates.map((a) => a.updateItem),
        subjectHourDeltas,
        existingSubjectsMap,
        saveSessions: saveSessionsToo,
        mode: gfImportMode,
        sourceLabel: gfFileName || 'Google Form Sheet',
        actorUid,
        actorName,
        staffUids: mergedStaff,
      });

      setGfRawSheetRows([]);
      setGfFileName('');
      onImported(
        `Google Form Excel imported: ${res.sessionsSaved} class register(s) aur ${res.studentsUpdated} student(s) successfully update ho gaye.`
      );
    } finally {
      setGfImporting(false);
    }
  };

  // ---------- Summary Template & Upload Handlers ----------
  const handleDownloadTemplate = async () => {
    const XLSX = await import('xlsx');
    const existingList = students.filter((s) => {
      if (summaryDefaultProf !== 'auto' && s.profYear !== summaryDefaultProf) return false;
      if (templateBatch !== 'All' && s.batch !== templateBatch) return false;
      return true;
    });

    const fallbackProf = summaryDefaultProf === 'auto' ? '1st Prof' : summaryDefaultProf;
    const fallbackBatch =
      templateBatch === 'All'
        ? defaultBatchForProf(fallbackProf)
        : templateBatch;

    const sheetRows =
      existingList.length > 0
        ? existingList.map((s) => ({
            'Roll Number': s.rollNumber,
            'Student Name': s.fullName,
            'Prof Year': s.profYear,
            Batch: s.batch,
            'Scheduled Hours': s.totalHoursScheduled,
            'Theory Attended': s.theoryHoursAttended,
            'Practical Attended': s.practicalHoursAttended,
            'Total Attended': s.totalHoursAttended,
            'Consecutive Absences': s.consecutiveAbsences,
          }))
        : [
            {
              'Roll Number': `${buildAutoRollPrefix(fallbackBatch)}-001`,
              'Student Name': 'SAMPLE STUDENT NAME',
              'Prof Year': fallbackProf,
              Batch: fallbackBatch,
              'Scheduled Hours': 100,
              'Theory Attended': 50,
              'Practical Attended': 35,
              'Total Attended': 85,
              'Consecutive Absences': 0,
            },
          ];

    const ws = XLSX.utils.json_to_sheet(sheetRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'BAMS Attendance');
    const safeProf = fallbackProf.replace(/\s+/g, '_');
    const safeBatch = templateBatch.replace(/\s+/g, '_');
    XLSX.writeFile(wb, `SSPSAMCH_Attendance_Template_${safeProf}_${safeBatch}.xlsx`);
  };

  const handleSummaryFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError(null);
    setFileName(file.name);

    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        setParseError('Excel file me koi sheet nahi mili.');
        setParsedRows([]);
        return;
      }

      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        workbook.Sheets[firstSheetName],
        { defval: '' }
      );

      if (rawRows.length === 0) {
        setParseError('Uploaded Excel sheet khali hai.');
        setParsedRows([]);
        return;
      }

      const seenRolls = new Set<string>();
      const analyzed: ParsedSummaryRow[] = rawRows.map((raw, index) => {
        const rowNum = index + 2;
        const rollRaw = pickValue(raw, ['rollnumber', 'rollno', 'roll', 'enrollmentno', 'id']);
        const rollNumber = String(rollRaw || '').trim().toUpperCase();
        const excelName = String(
          pickValue(raw, ['studentname', 'fullname', 'name', 'student']) || ''
        ).trim();
        const rawProf = String(pickValue(raw, ['profyear', 'prof', 'year']) || '').trim();
        const rawBatch = String(pickValue(raw, ['batch']) || '').trim();
        const resolvedBatch = resolveBatchFromText({
          batchText: `${rawProf} ${rawBatch}`.trim(),
          forcedProf: summaryDefaultProf,
          forcedBatch: templateBatch === 'All' ? 'auto' : templateBatch,
          customProfYears: profYearOptions,
          batchToLiveProf,
          profToDefaultLiveBatch,
        });

        const scheduledVal = parseNumeric(
          pickValue(raw, [
            'scheduledhours',
            'totalhoursscheduled',
            'totalscheduled',
            'scheduled',
            'totalhours',
            'totalclasses',
          ])
        );
        const theoryVal = parseNumeric(
          pickValue(raw, ['theoryattended', 'theoryhoursattended', 'theoryhours', 'theory'])
        );
        const practicalVal = parseNumeric(
          pickValue(raw, [
            'practicalattended',
            'practicalhoursattended',
            'practicalhours',
            'practical',
            'clinical',
          ])
        );
        const totalAttendedVal = parseNumeric(
          pickValue(raw, [
            'totalattended',
            'totalhoursattended',
            'attendedhours',
            'attended',
            'presenthours',
            'present',
          ])
        );
        const consecutiveVal =
          parseNumeric(pickValue(raw, ['consecutiveabsences', 'consecutive'])) ?? 0;

        const matched = rollNumber ? studentsByRoll.get(rollNumber) || null : null;
        let virtualStudent: StudentRecord | null = null;
        if (!matched && rollNumber && excelName && autoEnrollMissing) {
          const cleanId = `sum_${rollNumber.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`.slice(
            0,
            64
          );
          virtualStudent = {
            id: cleanId,
            uid: cleanId,
            rollNumber,
            fullName: excelName.slice(0, 90),
            profYear: resolvedBatch.profYear,
            batch: (rawBatch || resolvedBatch.batch).slice(0, 20),
            totalHoursScheduled: 0,
            totalHoursAttended: 0,
            theoryHoursAttended: 0,
            practicalHoursAttended: 0,
            attendancePercent: 100,
            consecutiveAbsences: 0,
            standing: 'nominal',
            staffUids: staffUids.slice(0, VALIDATION_LIMITS.maxStaffList),
          };
        }

        let errorMsg: string | null = null;
        if (!rollNumber) {
          errorMsg = 'Missing Roll Number';
        } else if (!matched && !virtualStudent) {
          errorMsg = `Roll "${rollNumber}" BAMS roster me nahi mila (Auto-Enroll on karein ya Student Name column bharein)`;
        } else if (seenRolls.has(rollNumber)) {
          errorMsg = `Duplicate Roll "${rollNumber}" in Excel`;
        }

        if (rollNumber) seenRolls.add(rollNumber);

        const hasTheoryOrPrac = theoryVal !== null || practicalVal !== null;
        const theory = theoryVal ?? 0;
        const practical = practicalVal ?? 0;
        const attended =
          totalAttendedVal !== null
            ? totalAttendedVal
            : hasTheoryOrPrac
              ? theory + practical
              : NaN;

        let resolvedTheory = theory;
        let resolvedPractical = practical;
        if (!hasTheoryOrPrac && Number.isFinite(attended)) {
          resolvedTheory = Number((attended * 0.6).toFixed(1));
          resolvedPractical = Number(Math.max(0, attended - resolvedTheory).toFixed(1));
        }

        const scheduled = scheduledVal ?? NaN;
        if (!errorMsg) {
          if (!Number.isFinite(scheduled) || scheduled < 0) {
            errorMsg = 'Invalid Scheduled Hours';
          } else if (!Number.isFinite(attended) || attended < 0) {
            errorMsg = 'Invalid Attended Hours';
          } else if (resolvedTheory < 0 || resolvedPractical < 0) {
            errorMsg = 'Negative Theory/Practical Hours';
          } else if (attended > scheduled) {
            errorMsg = `Attended (${attended}h) > Scheduled (${scheduled}h)`;
          } else if (consecutiveVal < 0) {
            errorMsg = 'Invalid Consecutive Absences';
          }
        }

        const nameWarning =
          matched && excelName && !namesLookCompatible(excelName, matched.fullName)
            ? `Excel name "${excelName}" differs from "${matched.fullName}"`
            : !matched && virtualStudent
              ? `New student auto-enroll (${virtualStudent.profYear} · ${virtualStudent.batch})`
              : null;

        return {
          rowNum,
          rollNumber,
          excelName,
          profYearInput: resolvedBatch.profYear,
          batchInput: virtualStudent?.batch || resolvedBatch.batch,
          scheduledInput: Number.isFinite(scheduled) ? scheduled : 0,
          theoryInput: resolvedTheory,
          practicalInput: resolvedPractical,
          attendedInput: Number.isFinite(attended) ? attended : 0,
          consecutiveInput: consecutiveVal,
          matchedStudent: matched,
          virtualStudent,
          errorMsg,
          nameWarning,
        };
      });

      setParsedRows(analyzed);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Unable to read Excel file.');
      setParsedRows([]);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const previewComputations = useMemo(() => {
    return parsedRows.map((row) => {
      const targetStu = row.matchedStudent || row.virtualStudent;
      if (!targetStu || row.errorMsg) {
        return { row, updateItem: null as BulkAttendanceUpdateItem | null };
      }
      const isNew = !row.matchedStudent && Boolean(row.virtualStudent);
      const nextScheduled =
        importMode === 'replace' || isNew
          ? row.scheduledInput
          : targetStu.totalHoursScheduled + row.scheduledInput;
      const nextTheory =
        importMode === 'replace' || isNew
          ? row.theoryInput
          : targetStu.theoryHoursAttended + row.theoryInput;
      const nextPractical =
        importMode === 'replace' || isNew
          ? row.practicalInput
          : targetStu.practicalHoursAttended + row.practicalInput;
      const nextAttended =
        importMode === 'replace' || isNew
          ? row.attendedInput
          : targetStu.totalHoursAttended + row.attendedInput;
      const nextConsecutive =
        importMode === 'replace' || isNew ? row.consecutiveInput : targetStu.consecutiveAbsences;
      const cappedAttended =
        nextScheduled > 0 ? Math.min(nextScheduled, nextAttended) : nextAttended;
      const nextPercent =
        nextScheduled > 0
          ? Math.min(100, Number(((cappedAttended / nextScheduled) * 100).toFixed(1)))
          : 100;

      return {
        row,
        updateItem: {
          student: targetStu,
          nextScheduled,
          nextAttended: cappedAttended,
          nextTheory,
          nextPractical,
          nextConsecutive,
          nextPercent,
          isNewStudent: isNew,
        },
      };
    });
  }, [parsedRows, importMode]);

  const validItems = useMemo(
    () =>
      previewComputations
        .map((p) => p.updateItem)
        .filter((item): item is BulkAttendanceUpdateItem => item !== null),
    [previewComputations]
  );

  const errorCount = useMemo(
    () => parsedRows.filter((r) => Boolean(r.errorMsg)).length,
    [parsedRows]
  );
  const warningCount = useMemo(
    () => parsedRows.filter((r) => !r.errorMsg && Boolean(r.nameWarning)).length,
    [parsedRows]
  );

  const handleConfirmSummaryImport = async () => {
    if (validItems.length === 0) return;
    setImporting(true);
    try {
      const updatedCount = await adminBulkImportStudentAttendance({
        items: validItems,
        mode: importMode,
        sourceLabel: fileName || 'Excel Sheet',
        actorUid,
        actorName,
        staffUids,
      });
      setParsedRows([]);
      setFileName('');
      onImported(
        `Successfully imported Excel attendance for ${updatedCount} student(s) (${
          importMode === 'replace' ? 'Opening Balance Set' : 'Added to Existing Hours'
        }).`
      );
    } finally {
      setImporting(false);
    }
  };

  return (
    <section className="surface-3d rounded-2xl p-5 sm:p-6 space-y-5">
      {/* Header & Mode Switcher */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-amber-900/10 pb-4">
        <div>
          <h2 className="text-base font-bold text-stone-900 flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-emerald-900" />
            Bulk Excel / CSV Attendance Import (Previous Portal Migration)
          </h2>
          <p className="mt-1 text-xs text-stone-600 leading-relaxed">
            Seedha apni Google Form Response Sheet (Class-by-Class) ya Student Summary Sheet upload karke preview check karne ke baad ek saath save karein.
          </p>
        </div>

        <div className="inline-flex bg-[#F3EAD8] p-1 rounded-xl border border-amber-900/15 shrink-0">
          <button
            type="button"
            onClick={() => setActiveModeTab('google_form')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap ${
              activeModeTab === 'google_form'
                ? 'btn-3d text-white'
                : 'text-stone-700 hover:text-stone-950'
            }`}
          >
            1. Google Form Class Sheet
          </button>
          <button
            type="button"
            onClick={() => setActiveModeTab('summary')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap ${
              activeModeTab === 'summary'
                ? 'btn-3d text-white'
                : 'text-stone-700 hover:text-stone-950'
            }`}
          >
            2. Student Summary Sheet
          </button>
        </div>
      </div>

      {/* ================================================================= */}
      {/* TAB 1: GOOGLE FORM CLASS-BY-CLASS SHEET IMPORTER                  */}
      {/* ================================================================= */}
      {activeModeTab === 'google_form' && (
        <div className="space-y-5">
          {/* Mapping & Options Bar */}
          <div className="surface-3d-inset rounded-xl p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                  Target Prof Year (All Profs)
                </label>
                <select
                  aria-label="Target Prof Year for Excel Import"
                  value={gfTargetProf}
                  onChange={(e) => setGfTargetProf(e.target.value)}
                  className="w-full px-2.5 py-2 text-xs bg-white border border-amber-900/20 rounded-lg text-stone-800"
                >
                  <option value="auto">Auto-Detect from Sheet (All Profs)</option>
                  {profYearOptions.map((py) => (
                    <option key={py} value={py}>
                      Force: {py}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                  Admission Batch (Multi-Batch)
                </label>
                <select
                  aria-label="Target Admission Batch for Excel Import"
                  value={gfTargetBatch}
                  onChange={(e) => setGfTargetBatch(e.target.value)}
                  className="w-full px-2.5 py-2 text-xs bg-white border border-amber-900/20 rounded-lg text-stone-800"
                >
                  <option value="auto">Auto-Detect Year (2022–2026)</option>
                  {batches
                    .filter((b) => b !== 'All')
                    .map((b) => (
                      <option key={b} value={b}>
                        Force: {b}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                  Hours Per Form Class
                </label>
                <select
                  value={defaultDuration}
                  onChange={(e) => setDefaultDuration(Number(e.target.value))}
                  className="w-full px-2.5 py-2 text-xs bg-white border border-amber-900/20 rounded-lg text-stone-800"
                >
                  <option value={0.5}>0.5 Hour / class</option>
                  <option value={1}>1 Hour / class (Default)</option>
                  <option value={1.5}>1.5 Hours / class</option>
                  <option value={2}>2 Hours / class</option>
                  <option value={3}>3 Hours / class</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                  Session Type
                </label>
                <select
                  value={defaultSessionType}
                  onChange={(e) => setDefaultSessionType(e.target.value)}
                  className="w-full px-2.5 py-2 text-xs bg-white border border-amber-900/20 rounded-lg text-stone-800"
                >
                  <option value="Theory (Class Hours)">Theory (Class Hours)</option>
                  <option value="Practical (Lab Hours)">Practical (Lab Hours)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-stone-700 mb-1">
                  Security PIN Filter (Optional)
                </label>
                <input
                  type="text"
                  value={pinFilter}
                  onChange={(e) => setPinFilter(e.target.value)}
                  placeholder="e.g. 2026 (blank = allow all)"
                  className="w-full px-2.5 py-2 text-xs bg-white border border-amber-900/20 rounded-lg text-stone-800"
                />
              </div>
            </div>

            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-2 border-t border-amber-900/10">
              <div className="flex flex-wrap items-center gap-4 text-xs text-stone-800">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={saveSessionsToo}
                    onChange={(e) => setSaveSessionsToo(e.target.checked)}
                    className="rounded border-amber-900/30 text-emerald-900"
                  />
                  <span className="font-medium">
                    Save Date-Wise Class Registers &amp; Subject Hours (Recommended)
                  </span>
                </label>

                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={skipDuplicates}
                    onChange={(e) => setSkipDuplicates(e.target.checked)}
                    className="rounded border-amber-900/30 text-emerald-900"
                  />
                  <span>Skip Already Imported Classes</span>
                </label>

                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoEnrollMissing}
                    onChange={(e) => setAutoEnrollMissing(e.target.checked)}
                    className="rounded border-amber-900/30 text-emerald-900"
                  />
                  <span>Auto-Enroll New Students (All Profs)</span>
                </label>

                <div className="inline-flex items-center gap-1.5 bg-white px-2.5 py-1 rounded-lg border border-amber-900/20">
                  <span className="text-[11px] text-stone-500">Totals:</span>
                  <button
                    type="button"
                    onClick={() => setGfImportMode('add')}
                    className={`px-2 py-0.5 text-[11px] font-semibold rounded ${
                      gfImportMode === 'add' ? 'bg-emerald-900 text-white' : 'text-stone-700'
                    }`}
                  >
                    Add Hours
                  </button>
                  <button
                    type="button"
                    onClick={() => setGfImportMode('replace')}
                    className={`px-2 py-0.5 text-[11px] font-semibold rounded ${
                      gfImportMode === 'replace' ? 'bg-emerald-900 text-white' : 'text-stone-700'
                    }`}
                  >
                    Replace Balance
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <input
                  ref={gfInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleGoogleFormFileUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => gfInputRef.current?.click()}
                  className="btn-3d-gold inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold rounded-lg whitespace-nowrap"
                >
                  <Upload className="w-4 h-4" />
                  Upload Google Form Excel (.xlsx / .csv)
                </button>
              </div>
            </div>

            <p className="text-[11px] text-stone-500">
              {gfFileName
                ? `Loaded file: ${gfFileName}`
                : 'Columns auto-detected: Timestamp, Email address, Teacher Name, Subject, Class Start Time, Class Start Date, Batch, "[1 STUDENT NAME]"... Blank cells automatically ignore hote hain.'}
            </p>
          </div>

          {gfParseError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
              {gfParseError}
            </div>
          )}

          {/* Google Form Preview */}
          {parsedGoogleForm.rows.length > 0 && (
            <div className="space-y-4">
              {/* Summary Strip + Confirm Bar */}
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-[#FAF6EE] border border-amber-900/15 rounded-xl p-4">
                <div className="flex flex-wrap items-center gap-4 text-xs">
                  <span className="inline-flex items-center gap-1.5 font-bold text-emerald-900">
                    <Calendar className="w-4 h-4" />
                    Ready Classes: {validGfRows.length}
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-bold text-stone-900">
                    <Users className="w-4 h-4 text-emerald-900" />
                    Students Matched: {parsedGoogleForm.studentAggregates.length}
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-semibold text-amber-800">
                    <BookOpen className="w-4 h-4" />
                    Teachers Detected: {parsedGoogleForm.extractedFaculty.length}
                  </span>
                  {skippedGfRows.length > 0 && (
                    <span className="inline-flex items-center gap-1.5 font-semibold text-stone-600">
                      <XCircle className="w-4 h-4 text-stone-500" />
                      Skipped / Duplicate Rows: {skippedGfRows.length}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setGfRawSheetRows([]);
                      setGfFileName('');
                    }}
                    className="btn-3d-secondary px-3 py-2 text-xs font-medium text-stone-700 rounded-lg"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    disabled={
                      gfImporting ||
                      validGfRows.length === 0 ||
                      parsedGoogleForm.studentAggregates.length === 0
                    }
                    onClick={handleConfirmGoogleFormImport}
                    className="btn-3d inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 rounded-lg whitespace-nowrap"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {gfImporting
                      ? 'Saving Classes & Students...'
                      : `Confirm & Import ${validGfRows.length} Class(es) · ${parsedGoogleForm.studentAggregates.length} Student(s)`}
                  </button>
                </div>
              </div>

              {/* Smart Auto-Fix Suggestions Banner */}
              {smartAutoFixes.totalFixes > 0 && (
                <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1 text-xs">
                    <p className="font-bold text-amber-950 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-amber-700 shrink-0" />
                      Smart Excel Auto-Fix Detected {smartAutoFixes.totalFixes} Data Quality Issue(s)
                    </p>
                    <p className="text-amber-900">
                      {smartAutoFixes.amTimeFixes > 0 &&
                        `${smartAutoFixes.amTimeFixes} suspicious 1–5 AM class time(s) (auto-convert to PM) · `}
                      {smartAutoFixes.subjectFixes.length > 0 &&
                        `${smartAutoFixes.subjectFixes.length} misspelled subject name(s) · `}
                      {smartAutoFixes.teacherFixes.length > 0 &&
                        `${smartAutoFixes.teacherFixes.length} misspelled teacher name(s)`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleApplySmartFixes}
                    className="btn-3d-gold inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg whitespace-nowrap shrink-0"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Apply All Smart Fixes ({smartAutoFixes.totalFixes})
                  </button>
                </div>
              )}

              {smartFixAppliedMsg && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 text-xs text-emerald-900 flex items-center justify-between gap-2">
                  <span>{smartFixAppliedMsg}</span>
                  <button
                    type="button"
                    onClick={() => setSmartFixAppliedMsg(null)}
                    className="font-semibold hover:underline"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {/* Preview Sub-tabs */}
              <div className="flex flex-wrap items-center gap-2 border-b border-amber-900/10 pb-2">
                <button
                  type="button"
                  onClick={() => setGfPreviewTab('sessions')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${
                    gfPreviewTab === 'sessions'
                      ? 'bg-emerald-900 text-white'
                      : 'bg-white border border-amber-900/15 text-stone-700'
                  }`}
                >
                  Class Sessions ({parsedGoogleForm.rows.length})
                </button>
                <button
                  type="button"
                  onClick={() => setGfPreviewTab('students')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${
                    gfPreviewTab === 'students'
                      ? 'bg-emerald-900 text-white'
                      : 'bg-white border border-amber-900/15 text-stone-700'
                  }`}
                >
                  Student Before → After ({parsedGoogleForm.studentAggregates.length})
                </button>
                <button
                  type="button"
                  onClick={() => setGfPreviewTab('faculty')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${
                    gfPreviewTab === 'faculty'
                      ? 'bg-emerald-900 text-white'
                      : 'bg-white border border-amber-900/15 text-stone-700'
                  }`}
                >
                  Extracted Faculty Emails ({parsedGoogleForm.extractedFaculty.length})
                </button>
              </div>

              {/* Sub-tab 1: Class Sessions Table */}
              {gfPreviewTab === 'sessions' && (
                <div className="overflow-x-auto max-h-80 border border-amber-900/15 rounded-xl bg-white/95">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-[#FAF6EE] border-b border-amber-900/15 text-xs font-semibold text-stone-700">
                      <tr>
                        <th className="py-2.5 px-3">Row</th>
                        <th className="py-2.5 px-3">Date &amp; Time</th>
                        <th className="py-2.5 px-3">Batch</th>
                        <th className="py-2.5 px-3">Teacher &amp; Subject</th>
                        <th className="py-2.5 px-3">Marks (P / L / A)</th>
                        <th className="py-2.5 px-3">Check</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-amber-900/10 text-xs">
                      {parsedGoogleForm.rows.map((r) => (
                        <tr
                          key={`${r.rowNum}-${r.sessionId}`}
                          className={
                            r.skipReason
                              ? 'bg-stone-100/80 text-stone-500'
                              : r.qualityWarning
                                ? 'bg-amber-50/50'
                                : 'hover:bg-emerald-50/30'
                          }
                        >
                          <td className="py-2 px-3 font-mono">#{r.rowNum}</td>
                          <td className="py-2 px-3 font-mono tabular-nums whitespace-nowrap">
                            <p className="font-semibold text-stone-900">{r.date || '—'}</p>
                            <p className="text-[11px] text-stone-500">{r.startTime}</p>
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap">
                            <p className="font-semibold text-stone-900">{r.batch}</p>
                            <p className="text-[11px] text-stone-500">{r.profYear}</p>
                          </td>
                          <td className="py-2 px-3">
                            <p className="font-semibold text-stone-900">{r.teacherName}</p>
                            <p className="text-[11px] text-emerald-900">
                              {r.subjectCode} · {r.subjectName}
                            </p>
                          </td>
                          <td className="py-2 px-3 font-mono tabular-nums whitespace-nowrap">
                            <span className="text-emerald-800 font-semibold">{r.presentCount}P</span>
                            {r.lateCount > 0 && (
                              <span className="text-amber-700 ml-1.5">{r.lateCount}L</span>
                            )}
                            <span className="text-red-700 ml-1.5">{r.absentCount}A</span>
                          </td>
                          <td className="py-2 px-3">
                            {r.skipReason ? (
                              <span className="text-stone-600 font-medium">{r.skipReason}</span>
                            ) : r.qualityWarning ? (
                              <span className="text-amber-800 font-medium">{r.qualityWarning}</span>
                            ) : (
                              <span className="text-emerald-800 font-semibold">Ready</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Sub-tab 2: Student Before -> After Table */}
              {gfPreviewTab === 'students' && (
                <div className="overflow-x-auto max-h-80 border border-amber-900/15 rounded-xl bg-white/95">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-[#FAF6EE] border-b border-amber-900/15 text-xs font-semibold text-stone-700">
                      <tr>
                        <th className="py-2.5 px-3">Roll &amp; Name</th>
                        <th className="py-2.5 px-3">Batch</th>
                        <th className="py-2.5 px-3">Excel Classes</th>
                        <th className="py-2.5 px-3">Current Portal</th>
                        <th className="py-2.5 px-3">After Import</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-amber-900/10 text-xs">
                      {parsedGoogleForm.studentAggregates.map((agg) => (
                        <tr key={agg.student.id} className="hover:bg-emerald-50/30">
                          <td className="py-2 px-3">
                            <p className="font-mono font-semibold text-stone-900">
                              {agg.student.rollNumber}
                            </p>
                            <p className="text-stone-600">{agg.student.fullName}</p>
                          </td>
                          <td className="py-2 px-3 text-stone-700 whitespace-nowrap">
                            {agg.student.batch}
                          </td>
                          <td className="py-2 px-3 font-mono tabular-nums whitespace-nowrap">
                            <span className="text-emerald-800 font-semibold">
                              {agg.presentCount}P
                            </span>{' '}
                            / <span className="text-red-700">{agg.absentCount}A</span> (
                            {agg.classesCount} cls)
                          </td>
                          <td className="py-2 px-3 font-mono tabular-nums text-stone-600 whitespace-nowrap">
                            {agg.student.totalHoursAttended}/{agg.student.totalHoursScheduled}h (
                            {agg.student.attendancePercent}%)
                          </td>
                          <td className="py-2 px-3 font-mono tabular-nums font-semibold text-emerald-950 whitespace-nowrap">
                            {agg.updateItem.nextAttended}/{agg.updateItem.nextScheduled}h (
                            {agg.updateItem.nextPercent}%)
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Sub-tab 3: Extracted Faculty Emails + Pre-Invite */}
              {gfPreviewTab === 'faculty' && (
                <div className="space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-[#FAF6EE] border border-amber-900/15 rounded-xl p-3">
                    <p className="text-xs text-stone-700">
                      Sheet se <strong>{parsedGoogleForm.extractedFaculty.length}</strong> unique
                      teacher emails detect hue hain. Jo abhi portal par invited nahi hain unhe 1
                      click me Faculty Invite list me add kar sakte hain.
                    </p>
                    {unregisteredFaculty.length > 0 && (
                      <button
                        type="button"
                        disabled={invitingAll}
                        onClick={handlePreInviteExtractedFaculty}
                        className="btn-3d inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white rounded-lg whitespace-nowrap shrink-0"
                      >
                        <MailPlus className="w-3.5 h-3.5" />
                        {invitingAll
                          ? 'Inviting...'
                          : `Pre-Invite ${unregisteredFaculty.length} Unregistered Faculty`}
                      </button>
                    )}
                  </div>

                  {inviteStatusMsg && (
                    <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900">
                      {inviteStatusMsg}
                    </div>
                  )}

                  {parsedGoogleForm.unmatchedColumnSet.length > 0 && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
                      <p className="font-semibold flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4" />
                        Unmatched Student Columns ({parsedGoogleForm.unmatchedColumnSet.length}):
                      </p>
                      <p className="mt-1 text-[11px] font-mono">
                        {parsedGoogleForm.unmatchedColumnSet.slice(0, 12).join(', ')}
                      </p>
                    </div>
                  )}

                  <div className="overflow-x-auto max-h-72 border border-amber-900/15 rounded-xl bg-white/95">
                    <table className="w-full text-left border-collapse">
                      <thead className="sticky top-0 bg-[#FAF6EE] border-b border-amber-900/15 text-xs font-semibold text-stone-700">
                        <tr>
                          <th className="py-2.5 px-3">Teacher Name</th>
                          <th className="py-2.5 px-3">Email Address</th>
                          <th className="py-2.5 px-3">Classes</th>
                          <th className="py-2.5 px-3">Portal Access Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-amber-900/10 text-xs">
                        {parsedGoogleForm.extractedFaculty.map((f) => (
                          <tr key={f.email} className="hover:bg-emerald-50/30">
                            <td className="py-2 px-3 font-semibold text-stone-900">
                              {f.teacherName}
                            </td>
                            <td className="py-2 px-3 font-mono text-stone-700">{f.email}</td>
                            <td className="py-2 px-3 font-mono">{f.classCount}</td>
                            <td className="py-2 px-3 font-semibold">
                              {f.status === 'active_user' ? (
                                <span className="text-emerald-800">Active User</span>
                              ) : f.status === 'pending_user' ? (
                                <span className="text-amber-700">Pending Approval</span>
                              ) : f.status === 'invited' ? (
                                <span className="text-emerald-700">Pre-Invited</span>
                              ) : (
                                <span className="text-stone-600">Not Registered Yet</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 2: STUDENT SUMMARY BALANCE SHEET IMPORTER                     */}
      {/* ================================================================= */}
      {activeModeTab === 'summary' && (
        <div className="space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <p className="text-xs text-stone-600">
              Sabhi Profs (1st, 2nd, 3rd, 4th Prof &amp; Custom) ke students ka summary data template download karke Roll Number + Prof Year ke saath upload karein.
            </p>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <select
                aria-label="Target Prof Year for Summary Template or Upload"
                value={summaryDefaultProf}
                onChange={(e) => setSummaryDefaultProf(e.target.value)}
                className="px-2.5 py-2 text-xs bg-white border border-amber-900/20 rounded-lg text-stone-800"
              >
                <option value="auto">All Profs (Auto-Detect Sheet)</option>
                {profYearOptions.map((py) => (
                  <option key={py} value={py}>
                    {py}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter template batch"
                value={templateBatch}
                onChange={(e) => setTemplateBatch(e.target.value)}
                className="px-2.5 py-2 text-xs bg-white border border-amber-900/20 rounded-lg text-stone-800"
              >
                {batches.map((b) => (
                  <option key={b} value={b}>
                    {b === 'All' ? 'All Batches' : b}
                  </option>
                ))}
              </select>
              <label className="inline-flex items-center gap-1.5 text-xs text-stone-700 px-2">
                <input
                  type="checkbox"
                  checked={autoEnrollMissing}
                  onChange={(e) => setAutoEnrollMissing(e.target.checked)}
                  className="rounded border-amber-900/30 text-emerald-900"
                />
                <span>Auto-Enroll Missing</span>
              </label>
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="btn-3d-secondary inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-stone-900 rounded-lg whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5 text-emerald-900" />
                Download Excel Template (.xlsx)
              </button>
            </div>
          </div>

          <div className="surface-3d-inset rounded-xl p-4 grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
            <div className="lg:col-span-7 space-y-2">
              <p className="text-xs font-semibold text-stone-800">
                Select Import Method (Galat calculation se bachne ke liye):
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setImportMode('replace')}
                  className={`p-3 rounded-lg border text-left transition-all ${
                    importMode === 'replace'
                      ? 'btn-3d text-white border-emerald-950'
                      : 'bg-white border-amber-900/20 text-stone-800'
                  }`}
                >
                  <p className="text-xs font-bold">1. Replace (Opening Balance)</p>
                  <p
                    className={`text-[11px] mt-0.5 ${
                      importMode === 'replace' ? 'text-emerald-100' : 'text-stone-500'
                    }`}
                  >
                    Pichhle portal ka exact total hours direct set karein
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setImportMode('add')}
                  className={`p-3 rounded-lg border text-left transition-all ${
                    importMode === 'add'
                      ? 'btn-3d text-white border-emerald-950'
                      : 'bg-white border-amber-900/20 text-stone-800'
                  }`}
                >
                  <p className="text-xs font-bold">2. Add to Existing Hours</p>
                  <p
                    className={`text-[11px] mt-0.5 ${
                      importMode === 'add' ? 'text-emerald-100' : 'text-stone-500'
                    }`}
                  >
                    Is portal me chal rahi classes me old hours jod dein
                  </p>
                </button>
              </div>
            </div>

            <div className="lg:col-span-5 flex flex-col sm:flex-row lg:flex-col items-stretch gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleSummaryFileUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="btn-3d-gold inline-flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold rounded-lg whitespace-nowrap"
              >
                <Upload className="w-4 h-4" />
                Upload Filled Summary Excel / CSV
              </button>
              <p className="text-[11px] text-stone-600 text-center">
                {fileName
                  ? `Loaded: ${fileName}`
                  : 'Roll Number se strict match hota hai · Preview ke baad hi save hoga'}
              </p>
            </div>
          </div>

          {parseError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
              {parseError}
            </div>
          )}

          {parsedRows.length > 0 && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex flex-wrap items-center gap-4">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-900">
                    <CheckCircle2 className="w-4 h-4" />
                    Ready to Update: {validItems.length} student(s)
                  </span>
                  {warningCount > 0 && (
                    <span className="inline-flex items-center gap-1.5 font-semibold text-amber-800">
                      <AlertTriangle className="w-4 h-4" />
                      Name Warnings: {warningCount}
                    </span>
                  )}
                  {errorCount > 0 && (
                    <span className="inline-flex items-center gap-1.5 font-semibold text-red-700">
                      <XCircle className="w-4 h-4" />
                      Skipped Errors: {errorCount}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setParsedRows([]);
                      setFileName('');
                    }}
                    className="btn-3d-secondary px-3 py-2 text-xs font-medium text-stone-700 rounded-lg"
                  >
                    Clear Preview
                  </button>
                  <button
                    type="button"
                    disabled={importing || validItems.length === 0}
                    onClick={handleConfirmSummaryImport}
                    className="btn-3d inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 rounded-lg whitespace-nowrap"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {importing
                      ? 'Saving to Database...'
                      : `Confirm & Import ${validItems.length} Student(s)`}
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto max-h-80 border border-amber-900/15 rounded-xl bg-white/90">
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-[#FAF6EE] border-b border-amber-900/15 text-xs font-semibold text-stone-700">
                    <tr>
                      <th className="py-2.5 px-3">Row</th>
                      <th className="py-2.5 px-3">Roll &amp; Student</th>
                      <th className="py-2.5 px-3">Current Portal</th>
                      <th className="py-2.5 px-3">After Import</th>
                      <th className="py-2.5 px-3">Verification Check</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-900/10 text-xs">
                    {previewComputations.map(({ row, updateItem }) => (
                      <tr
                        key={`${row.rowNum}-${row.rollNumber}`}
                        className={
                          row.errorMsg
                            ? 'bg-red-50/70'
                            : row.nameWarning
                              ? 'bg-amber-50/60'
                              : 'hover:bg-emerald-50/30'
                        }
                      >
                        <td className="py-2 px-3 font-mono text-stone-500">#{row.rowNum}</td>
                        <td className="py-2 px-3">
                          <p className="font-mono font-semibold text-stone-900">
                            {row.rollNumber || '—'}
                          </p>
                          <p className="text-stone-600">
                            {row.matchedStudent
                              ? row.matchedStudent.fullName
                              : row.virtualStudent
                                ? `${row.virtualStudent.fullName} (New)`
                                : row.excelName || 'Unknown'}
                          </p>
                        </td>
                        <td className="py-2 px-3 font-mono tabular-nums text-stone-600">
                          {row.matchedStudent
                            ? `${row.matchedStudent.totalHoursAttended}/${row.matchedStudent.totalHoursScheduled}h (${row.matchedStudent.attendancePercent}%)`
                            : row.virtualStudent
                              ? `New (${row.profYearInput})`
                              : '—'}
                        </td>
                        <td className="py-2 px-3 font-mono tabular-nums font-semibold text-emerald-950">
                          {updateItem
                            ? `${updateItem.nextAttended}/${updateItem.nextScheduled}h (${updateItem.nextPercent}%)`
                            : '—'}
                        </td>
                        <td className="py-2 px-3">
                          {row.errorMsg ? (
                            <span className="text-red-700 font-semibold">{row.errorMsg}</span>
                          ) : row.nameWarning ? (
                            <span className="text-amber-800 font-medium">{row.nameWarning}</span>
                          ) : (
                            <span className="text-emerald-800 font-medium">
                              Matched ({row.theoryInput}h Theory + {row.practicalInput}h Prac)
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
