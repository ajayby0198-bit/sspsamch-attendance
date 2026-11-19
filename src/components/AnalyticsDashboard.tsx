import React, { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertCircle,
  BookOpen,
  Calendar,
  Clock,
  FileEdit,
  TrendingUp,
} from 'lucide-react';
import {
  AttendanceAlert,
  AttendanceSession,
  DEFAULT_PROF_YEARS,
  InteractionLog,
  MasterConfig,
  ProfYear,
  StudentRecord,
  Subject,
  TeacherProfile,
} from '../types';
import { BatchTelemetryMetric, Campus3DStage } from './Campus3DStage';
import { RolePieChartCard } from './RolePieChartCard';

interface AnalyticsDashboardProps {
  sessions: AttendanceSession[];
  students: StudentRecord[];
  subjects: Subject[];
  teachers: TeacherProfile[];
  alerts: AttendanceAlert[];
  interactionLogs: InteractionLog[];
  masterConfig?: MasterConfig | null;
  onNavigateToRegister: (sessionId?: string) => void;
  onNavigateToAlerts: () => void;
}

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({
  sessions,
  students,
  subjects,
  teachers,
  alerts,
  interactionLogs,
  masterConfig,
  onNavigateToRegister,
  onNavigateToAlerts,
}) => {
  const [profFilter, setProfFilter] = useState<'All' | ProfYear>('All');
  const [batchFilter, setBatchFilter] = useState<string>('All');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');

  const profYearTabs = useMemo(() => {
    const base = masterConfig?.profYears?.length ? masterConfig.profYears : DEFAULT_PROF_YEARS;
    return ['All', ...base];
  }, [masterConfig]);

  const availableBatchesInProf = useMemo(() => {
    const pool = profFilter === 'All' ? students : students.filter((s) => s.profYear === profFilter);
    const set = new Set(pool.map((s) => s.batch).filter(Boolean));
    return ['All', ...Array.from(set).sort()];
  }, [students, profFilter]);

  const effectiveBatchFilter = availableBatchesInProf.includes(batchFilter) ? batchFilter : 'All';

  const filteredStudents = useMemo(
    () =>
      students.filter((s) => {
        if (profFilter !== 'All' && s.profYear !== profFilter) return false;
        if (effectiveBatchFilter !== 'All' && s.batch !== effectiveBatchFilter) return false;
        return true;
      }),
    [students, profFilter, effectiveBatchFilter]
  );

  const filteredSessions = useMemo(
    () =>
      sessions.filter((s) => {
        if (profFilter !== 'All' && s.profYear !== profFilter) return false;
        if (effectiveBatchFilter !== 'All') {
          const labelLower = (s.batchLabel || '').toLowerCase();
          const batchToken = effectiveBatchFilter.replace(/^Batch\s+/i, '').toLowerCase();
          if (labelLower) {
            if (!labelLower.includes(effectiveBatchFilter.toLowerCase()) && !labelLower.includes(batchToken)) {
              return false;
            }
          } else {
            return false;
          }
        }
        if (dateFrom && s.date < dateFrom) return false;
        if (dateTo && s.date > dateTo) return false;
        return true;
      }),
    [sessions, profFilter, effectiveBatchFilter, dateFrom, dateTo]
  );

  const filteredSubjects = useMemo(
    () => (profFilter === 'All' ? subjects : subjects.filter((s) => s.profYear === profFilter)),
    [subjects, profFilter]
  );

  const applyPresetRange = (days: number | 'today' | 'all') => {
    const today = new Date();
    const toStr = today.toISOString().slice(0, 10);
    if (days === 'all') {
      setDateFrom('');
      setDateTo('');
      return;
    }
    if (days === 'today') {
      setDateFrom(toStr);
      setDateTo(toStr);
      return;
    }
    const fromDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    setDateFrom(fromDate);
    setDateTo(toStr);
  };

  const kpis = useMemo(() => {
    const submittedInRange = filteredSessions.filter((s) => s.status === 'submitted');
    const totalHoursDelivered = submittedInRange.reduce((acc, s) => acc + s.durationHours, 0);
    const openDrafts = filteredSessions.filter((s) => s.status === 'draft').length;

    let rangeWeightedPct = 0;
    if (dateFrom || dateTo) {
      let attendedSum = 0;
      let totalSum = 0;
      filteredSessions.forEach((s) => {
        attendedSum += s.presentCount + s.lateCount;
        totalSum += s.totalStudents;
      });
      rangeWeightedPct = totalSum > 0 ? Number(((attendedSum / totalSum) * 100).toFixed(1)) : 0;
    }

    const avgAttendance =
      dateFrom || dateTo
        ? rangeWeightedPct
        : filteredStudents.length > 0
          ? Number(
              (
                filteredStudents.reduce((acc, s) => acc + s.attendancePercent, 0) /
                filteredStudents.length
              ).toFixed(1)
            )
          : 0;
    const unresolvedAlerts = alerts.filter(
      (a) => !a.resolved && (profFilter === 'All' || a.profYear === profFilter)
    ).length;
    return {
      totalHoursDelivered,
      openDrafts,
      avgAttendance,
      unresolvedAlerts,
      submittedCount: submittedInRange.length,
    };
  }, [filteredSessions, filteredStudents, alerts, profFilter, dateFrom, dateTo]);

  const liveBatchesFor3D = useMemo<BatchTelemetryMetric[]>(() => {
    const base = masterConfig?.profYears?.length ? masterConfig.profYears : DEFAULT_PROF_YEARS;
    const metrics: BatchTelemetryMetric[] = [];
    base.forEach((profYear) => {
      const list = students.filter((s) => s.profYear === profYear);
      const uniqueBatches = Array.from(new Set(list.map((s) => s.batch).filter(Boolean))).sort();
      if (uniqueBatches.length > 0) {
        uniqueBatches.forEach((bName) => {
          const subList = list.filter((s) => s.batch === bName);
          const avg =
            subList.length > 0
              ? Number(
                  (subList.reduce((acc, s) => acc + s.attendancePercent, 0) / subList.length).toFixed(1)
                )
              : 0;
          metrics.push({
            label: bName,
            profYear,
            avgPercent: avg,
            studentCount: subList.length,
          });
        });
      } else {
        const fallbackLabel =
          profYear === '1st Prof'
            ? 'Batch 2025'
            : profYear === '2nd Prof'
              ? 'Batch 2024'
              : profYear === '3rd Prof'
                ? 'Batch 2023'
                : profYear === '4th Prof'
                  ? 'Batch 2022'
                  : profYear;
        metrics.push({
          label: fallbackLabel,
          profYear,
          avgPercent: 0,
          studentCount: 0,
        });
      }
    });
    return metrics;
  }, [students, masterConfig]);

  // Slide 9 Diagnostics: Lowest batch, repeated absentees, morning vs afternoon trend
  const diagnostics = useMemo(() => {
    const profGroups: Record<string, { sum: number; count: number }> = {};
    students.forEach((s) => {
      if (!profGroups[s.profYear]) profGroups[s.profYear] = { sum: 0, count: 0 };
      profGroups[s.profYear].sum += s.attendancePercent;
      profGroups[s.profYear].count += 1;
    });
    const batchAverages = Object.entries(profGroups)
      .map(([prof, val]) => ({
        prof,
        avg: Number((val.sum / val.count).toFixed(1)),
      }))
      .sort((a, b) => a.avg - b.avg);

    const repeatedAbsentees = [...filteredStudents]
      .filter((s) => s.consecutiveAbsences >= 2 || s.attendancePercent < 75)
      .sort((a, b) => b.consecutiveAbsences - a.consecutiveAbsences);

    const morningSessions = filteredSessions.filter((s) => Number(s.startTime.slice(0, 2)) < 12);
    const afternoonSessions = filteredSessions.filter((s) => Number(s.startTime.slice(0, 2)) >= 12);

    const calcRate = (list: AttendanceSession[]) => {
      if (list.length === 0) return { attendance: 0, absence: 0, count: 0 };
      let totalAtt = 0;
      let totalStu = 0;
      list.forEach((s) => {
        totalAtt += s.presentCount + s.lateCount;
        totalStu += s.totalStudents;
      });
      const attendance = totalStu > 0 ? Math.round((totalAtt / totalStu) * 100) : 0;
      return { attendance, absence: Math.max(0, 100 - attendance), count: list.length };
    };

    const morningStats = calcRate(morningSessions);
    const afternoonStats = calcRate(afternoonSessions);

    return {
      lowestBatch: batchAverages[0] || null,
      batchAverages,
      repeatedAbsentees,
      shiftComparison: [
        { shift: 'Morning (< 12:00)', attendance: morningStats.attendance, absence: morningStats.absence, sessions: morningStats.count },
        { shift: 'Afternoon (≥ 12:00)', attendance: afternoonStats.attendance, absence: afternoonStats.absence, sessions: afternoonStats.count },
      ],
    };
  }, [students, filteredStudents, filteredSessions]);

  const sessionTrendData = useMemo(() => {
    return [...filteredSessions]
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
      .map((s) => {
        const attended = s.presentCount + s.lateCount;
        const rate = s.totalStudents > 0 ? Math.round((attended / s.totalStudents) * 100) : 0;
        return {
          name: `${s.subjectCode} (${s.date.slice(5)})`,
          attendanceRate: rate,
          scheduledHrs: s.durationHours,
        };
      });
  }, [filteredSessions]);

  const interactionChartData = useMemo(() => {
    const buckets: Record<
      string,
      { hour: string; drafts: number; submissions: number; checkIns: number; resolutions: number }
    > = {};
    const defaultHours = ['09:00', '10:00', '13:00', '14:00', '15:00', '16:00'];
    defaultHours.forEach((h) => {
      buckets[h] = { hour: h, drafts: 0, submissions: 0, checkIns: 0, resolutions: 0 };
    });

    interactionLogs.forEach((log) => {
      const h = log.hourBucket || '09:00';
      if (!buckets[h]) {
        buckets[h] = { hour: h, drafts: 0, submissions: 0, checkIns: 0, resolutions: 0 };
      }
      if (log.actionType === 'draft_saved') buckets[h].drafts += 1;
      else if (log.actionType === 'session_submitted' || log.actionType === 'correction_audit')
        buckets[h].submissions += 1;
      else if (log.actionType === 'student_checkin') buckets[h].checkIns += 1;
      else buckets[h].resolutions += 1;
    });

    return Object.values(buckets).sort((a, b) => a.hour.localeCompare(b.hour));
  }, [interactionLogs]);

  const subjectHoursData = useMemo(() => {
    return filteredSubjects.map((sub) => ({
      code: sub.code,
      delivered: sub.deliveredHours,
      required: sub.requiredTheoryHours + sub.requiredPracticalHours,
    }));
  }, [filteredSubjects]);

  const standingBreakdown = useMemo(() => {
    const nominal = filteredStudents.filter((s) => s.standing === 'nominal').length;
    const warning = filteredStudents.filter((s) => s.standing === 'warning').length;
    const critical = filteredStudents.filter((s) => s.standing === 'critical').length;
    return [
      { label: 'Nominal (75%+)', count: nominal, color: '#15803d' },
      { label: 'Warning (65-74%)', count: warning, color: '#d97706' },
      { label: 'Critical (<65%)', count: critical, color: '#dc2626' },
    ];
  }, [filteredStudents]);

  const standingPieData = useMemo(
    () =>
      standingBreakdown.map((item) => ({
        name: item.label,
        value: item.count,
        color: item.color,
      })),
    [standingBreakdown]
  );

  const sessionMarksPieData = useMemo(() => {
    const present = filteredSessions.reduce((acc, s) => acc + s.presentCount, 0);
    const late = filteredSessions.reduce((acc, s) => acc + s.lateCount, 0);
    const absent = filteredSessions.reduce((acc, s) => acc + s.absentCount, 0);
    return [
      { name: 'Present Marks', value: present, color: '#15803d' },
      { name: 'Late / Half Marks', value: late, color: '#d97706' },
      { name: 'Absent Marks', value: absent, color: '#dc2626' },
    ];
  }, [filteredSessions]);

  const openDraftSessions = useMemo(
    () => filteredSessions.filter((s) => s.status === 'draft'),
    [filteredSessions]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Institutional Attendance &amp; Interaction Analytics
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            SSPSAMCH · NCISM AYU0638 · Live batch monitoring, 3D spatial telemetry &amp; activity logs
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Quick Date-Range Presets + Custom Picker */}
          <div className="flex items-center gap-1 p-1 surface-3d-inset rounded-lg">
            <button
              type="button"
              onClick={() => applyPresetRange('today')}
              className="px-2.5 py-1 text-xs font-medium rounded-md text-stone-700 hover:bg-white transition-colors whitespace-nowrap"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => applyPresetRange(7)}
              className="px-2.5 py-1 text-xs font-medium rounded-md text-stone-700 hover:bg-white transition-colors whitespace-nowrap"
            >
              7 Days
            </button>
            <button
              type="button"
              onClick={() => applyPresetRange(30)}
              className="px-2.5 py-1 text-xs font-medium rounded-md text-stone-700 hover:bg-white transition-colors whitespace-nowrap"
            >
              30 Days
            </button>
            <button
              type="button"
              onClick={() => applyPresetRange('all')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                !dateFrom && !dateTo ? 'bg-white text-stone-900 shadow-xs' : 'text-stone-700 hover:bg-white'
              }`}
            >
              All
            </button>
          </div>

          <div className="flex items-center gap-2 surface-3d rounded-lg px-2.5 py-1.5 text-xs">
            <Calendar className="w-3.5 h-3.5 text-amber-800 shrink-0" />
            <input
              type="date"
              aria-label="From date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="font-mono text-xs text-stone-700 bg-transparent focus:outline-none"
            />
            <span className="text-stone-400">–</span>
            <input
              type="date"
              aria-label="To date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="font-mono text-xs text-stone-700 bg-transparent focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 p-1 surface-3d-inset rounded-lg overflow-x-auto max-w-full">
            {profYearTabs.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => {
                  setProfFilter(tab);
                  setBatchFilter('All');
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  profFilter === tab
                    ? 'bg-white text-stone-900 shadow-xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {availableBatchesInProf.length > 2 && (
            <select
              aria-label="Filter by Admission Batch"
              value={effectiveBatchFilter}
              onChange={(e) => setBatchFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs font-medium surface-3d rounded-lg text-stone-800"
            >
              {availableBatchesInProf.map((b) => (
                <option key={b} value={b}>
                  {b === 'All' ? 'All Batches' : b}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {(dateFrom || dateTo) && (
        <div className="surface-3d rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <span className="font-medium text-stone-800">
            Showing Date-Range Progress:{' '}
            <strong className="font-mono text-emerald-900">
              {dateFrom || 'Start'} → {dateTo || 'Latest'}
            </strong>
          </span>
          <div className="flex flex-wrap items-center gap-4 font-mono tabular-nums text-stone-700">
            <span>
              Sessions: <strong className="text-stone-900">{filteredSessions.length}</strong>
            </span>
            <span>
              Submitted Hrs:{' '}
              <strong className="text-emerald-900">{kpis.totalHoursDelivered.toFixed(1)}h</strong>
            </span>
            <span>
              Period Rate: <strong className="text-emerald-900">{kpis.avgAttendance}%</strong>
            </span>
          </div>
        </div>
      )}

      {/* 4-Column 3D KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="surface-3d-interactive rounded-xl p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Mean Attendance</span>
            <TrendingUp className="w-4 h-4 text-emerald-700" />
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {kpis.avgAttendance}%
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            {diagnostics.lowestBatch
              ? `Lowest: ${diagnostics.lowestBatch.prof} (${diagnostics.lowestBatch.avg}%)`
              : `Across ${filteredStudents.length} students`}
          </p>
        </div>

        <div className="surface-3d-interactive rounded-xl p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Submitted Class Hours</span>
            <Clock className="w-4 h-4 text-emerald-700" />
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {kpis.totalHoursDelivered.toFixed(1)} hrs
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            {filteredSessions.filter((s) => s.status === 'submitted').length} finalized registers
          </p>
        </div>

        <button
          type="button"
          onClick={() => onNavigateToRegister(openDraftSessions[0]?.id)}
          className="text-left surface-3d-interactive rounded-xl p-5"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Pending Draft Registers</span>
            <FileEdit className="w-4 h-4 text-amber-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-amber-700 font-mono tabular-nums">
            {kpis.openDrafts}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Hold for late arrivals · Click to review
          </p>
        </button>

        <button
          type="button"
          onClick={onNavigateToAlerts}
          className="text-left surface-3d-interactive rounded-xl p-5"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Absenteeism Alerts</span>
            <AlertCircle className="w-4 h-4 text-red-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-red-700 font-mono tabular-nums">
            {kpis.unresolvedAlerts}
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            {diagnostics.repeatedAbsentees.length} student(s) flagged &lt;75%
          </p>
        </button>
      </div>

      {/* Interactive 3D Spatial Batch Telemetry Diorama */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-8">
          <Campus3DStage batches={liveBatchesFor3D} compact />
        </div>
        <div className="lg:col-span-4 surface-3d rounded-xl p-5 flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Live 3D Batch Standing Pillars
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Drag to orbit 3D view · Pillar height &amp; material reflect live NCISM 75% compliance
            </p>
            <div className="mt-4 divide-y divide-slate-100">
              {liveBatchesFor3D.map((b) => (
                <div
                  key={`${b.profYear}-${b.label}`}
                  className="py-2.5 flex items-center justify-between text-xs"
                >
                  <div>
                    <p className="font-semibold text-slate-900">
                      {b.label} ({b.profYear})
                    </p>
                    <p className="text-slate-500 tabular-nums">{b.studentCount} active students</p>
                  </div>
                  <span
                    className={`font-mono font-bold tabular-nums ${
                      b.avgPercent >= 75
                        ? 'text-emerald-800'
                        : b.avgPercent >= 65
                          ? 'text-amber-700'
                          : 'text-red-700'
                    }`}
                  >
                    {b.avgPercent}%
                  </span>
                </div>
              ))}
            </div>
          </div>
          <p className="pt-3 border-t border-slate-100 text-[11px] text-slate-500">
            Green ≥75% NCISM · Amber 65–74% Warning · Crimson &lt;65% Critical
          </p>
        </div>
      </div>

      {/* Pie Charts Row: Standing + Session Distribution */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <RolePieChartCard
          title="Student NCISM Standing Distribution (Pie Chart)"
          subtitle={`Eligibility breakdown for ${profFilter === 'All' ? 'All Prof Years' : profFilter}`}
          data={standingPieData}
          centerValue={String(filteredStudents.length)}
          centerLabel="Students"
          emptyMessage="No students in selected Prof filter."
        />
        <RolePieChartCard
          title="Class Attendance Marks Breakdown (Pie Chart)"
          subtitle={`Present vs Late vs Absent marks across ${filteredSessions.length} class session(s)`}
          data={sessionMarksPieData}
          centerValue={`${kpis.avgAttendance}%`}
          centerLabel="Mean Rate"
          emptyMessage="No class session marks recorded in range."
        />
      </div>

      {/* Primary Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 surface-3d rounded-xl p-5">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Session Attendance Rate (%)
              </h2>
              <p className="text-xs text-slate-500">
                Hourly class attendance across lectures, practicals &amp; clinical wards
              </p>
            </div>
            <span className="text-xs font-mono text-emerald-800 tabular-nums">
              Target ≥ 75%
            </span>
          </div>

          <div className="h-64 w-full">
            {sessionTrendData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sessionTrendData} margin={{ top: 10, right: 12, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="attGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#047857" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#047857" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      borderColor: '#e2e8f0',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="attendanceRate"
                    name="Attendance %"
                    stroke="#065f46"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#attGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                No session analytics recorded for this filter or date range.
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-5 surface-3d rounded-xl p-5">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-slate-900">
              User Interaction &amp; Portal Activity Graph
            </h2>
            <p className="text-xs text-slate-500">
              Live teacher drafts, submissions, student check-ins &amp; audit actions by hour
            </p>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={interactionChartData} margin={{ top: 10, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="hour" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    borderColor: '#e2e8f0',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                  <Bar dataKey="checkIns" name="Student Check-Ins" stackId="a" fill="#14533c" />
                  <Bar dataKey="drafts" name="Draft Saves" stackId="a" fill="#c6923a" />
                  <Bar dataKey="submissions" name="Submits / Audits" stackId="a" fill="#1c1917" />
                  <Bar dataKey="resolutions" name="Governance / Resources" stackId="a" fill="#78716c" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Diagnostic Insights Row (Slide 9: Morning vs Afternoon, Teacher Classes, Topics) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 surface-3d rounded-xl p-5">
          <h2 className="text-sm font-semibold text-slate-900">
            Morning vs Afternoon Absence Trend
          </h2>
          <p className="text-xs text-slate-500 mb-4">
            Compare attendance &amp; absence rates across pre-noon and post-noon sessions
          </p>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={diagnostics.shiftComparison} margin={{ top: 5, right: 10, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="shift" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} />
                <Tooltip />
                <Bar dataKey="attendance" name="Attendance %" fill="#065f46" radius={[3, 3, 0, 0]} />
                <Bar dataKey="absence" name="Absence %" fill="#dc2626" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-4 surface-3d rounded-xl p-5 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-900">
              Recorded Topics &amp; Activities
            </h2>
            <BookOpen className="w-4 h-4 text-emerald-700" />
          </div>
          <div className="divide-y divide-slate-100 flex-1 overflow-y-auto max-h-52">
            {filteredSessions.map((sess) => (
              <button
                key={sess.id}
                type="button"
                onClick={() => onNavigateToRegister(sess.id)}
                className="w-full text-left py-2.5 hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-slate-900 truncate">
                    {sess.subjectCode} · {sess.activityType}
                  </span>
                  <span className="font-mono text-slate-500 tabular-nums shrink-0">
                    {sess.date}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-600 truncate">
                  {sess.topicTaught || sess.subjectName}
                </p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {sess.teacherName} · {sess.entryMode === 'paper_backup' ? 'Paper Backup Sync' : 'Live Class'}
                </p>
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-4 surface-3d rounded-xl p-5 flex flex-col">
          <h2 className="text-sm font-semibold text-slate-900 mb-1">
            Faculty Class Volume &amp; Standing
          </h2>
          <p className="text-xs text-slate-500 mb-3">
            Submitted vs draft registers recorded by faculty
          </p>
          <div className="divide-y divide-slate-100 flex-1 overflow-y-auto max-h-52">
            {teachers.map((t) => (
              <div key={t.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900 truncate">{t.fullName}</p>
                  <p className="text-slate-500 truncate">{t.department}</p>
                </div>
                <div className="text-right font-mono tabular-nums shrink-0">
                  <span className="text-emerald-800 font-semibold">{t.sessionsSubmitted}</span>
                  {t.sessionsDraft > 0 && (
                    <span className="text-amber-700 ml-1.5">+{t.sessionsDraft} draft</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Subject Hours & Standing Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 surface-3d rounded-xl p-5">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-slate-900">
              BAMS Subject Hours Delivered vs NCISM Curriculum Target
            </h2>
            <p className="text-xs text-slate-500">
              Cumulative theory + practical/clinical hours logged per subject
            </p>
          </div>
          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={subjectHoursData} margin={{ top: 8, right: 10, left: -14, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="code" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} />
                <Tooltip />
                <Bar dataKey="delivered" name="Delivered Hours" fill="#065f46" radius={[3, 3, 0, 0]} />
                <Bar dataKey="required" name="Required NCISM Hours" fill="#cbd5e1" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-6 surface-3d rounded-xl p-5 flex flex-col">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-slate-900">
              Standing Breakdown &amp; Repeated Absentees
            </h2>
            <p className="text-xs text-slate-500">
              Batch eligibility &amp; recent audit/interaction stream
            </p>
          </div>

          <div className="h-28 w-full mb-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={standingBreakdown} layout="vertical" margin={{ top: 0, right: 20, left: 20, bottom: 0 }}>
                <XAxis type="number" allowDecimals={false} hide />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={125}
                  tick={{ fontSize: 11, fill: '#334155' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip />
                <Bar dataKey="count" name="Students" barSize={16} radius={[0, 4, 4, 0]}>
                  {standingBreakdown.map((entry) => (
                    <Cell key={entry.label} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="border-t border-slate-200 pt-3 flex-1 overflow-y-auto max-h-40 divide-y divide-slate-100">
            {interactionLogs.slice(0, 6).map((log) => (
              <div key={log.id} className="py-2 flex items-start justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <p className="text-slate-800 font-medium truncate">{log.label}</p>
                  <p className="text-slate-500 mt-0.5">
                    {log.actorName} · <span className="capitalize">{log.actorRole}</span>
                  </p>
                </div>
                <span className="font-mono text-slate-500 tabular-nums shrink-0">
                  {log.hourBucket}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
