import React, { useMemo, useState } from 'react';
import { BookOpen, Clock, FileEdit, GraduationCap, Save } from 'lucide-react';
import { updateTeacherProfile } from '../services/bamsFirestore';
import { AttendanceSession, Subject, TeacherProfile, UserRole } from '../types';
import { RolePieChartCard } from './RolePieChartCard';

interface TeacherProfilesViewProps {
  teachers: TeacherProfile[];
  subjects: Subject[];
  sessions: AttendanceSession[];
  currentUid: string;
  currentRole: UserRole;
  onOpenSession: (sessionId: string) => void;
}

export const TeacherProfilesView: React.FC<TeacherProfilesViewProps> = ({
  teachers,
  subjects,
  sessions,
  currentUid,
  currentRole,
  onOpenSession,
}) => {
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>(teachers[0]?.id || '');
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState(false);
  const [officeHours, setOfficeHours] = useState('');
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);

  const selectedTeacher = useMemo(
    () => teachers.find((t) => t.id === selectedTeacherId) || teachers[0] || null,
    [teachers, selectedTeacherId]
  );

  const teacherSubjects = useMemo(
    () =>
      selectedTeacher
        ? subjects.filter(
            (s) =>
              s.teacherId === selectedTeacher.id ||
              selectedTeacher.assignedSubjects.includes(s.code)
          )
        : [],
    [selectedTeacher, subjects]
  );

  const teacherSessions = useMemo(
    () =>
      selectedTeacher
        ? sessions.filter((s) => s.teacherId === selectedTeacher.id)
        : [],
    [selectedTeacher, sessions]
  );

  const teacherPieData = useMemo(() => {
    if (!selectedTeacher) return [];
    const present = teacherSessions.reduce((acc, s) => acc + s.presentCount, 0);
    const late = teacherSessions.reduce((acc, s) => acc + s.lateCount, 0);
    const absent = teacherSessions.reduce((acc, s) => acc + s.absentCount, 0);
    if (present + late + absent > 0) {
      return [
        { name: 'Present Students', value: present, color: '#15803d' },
        { name: 'Late / Half Marks', value: late, color: '#d97706' },
        { name: 'Absent Students', value: absent, color: '#dc2626' },
      ];
    }
    return [
      { name: 'Submitted Registers', value: selectedTeacher.sessionsSubmitted, color: '#14533c' },
      { name: 'Draft Registers', value: selectedTeacher.sessionsDraft, color: '#c6923a' },
    ];
  }, [selectedTeacher, teacherSessions]);

  const canEditSelected =
    selectedTeacher &&
    (currentRole === 'admin' ||
      currentRole === 'co_admin' ||
      currentRole === 'principal' ||
      selectedTeacher.ownerUid === currentUid);

  const startEdit = () => {
    if (!selectedTeacher) return;
    setOfficeHours(selectedTeacher.officeHours);
    setBio(selectedTeacher.bio);
    setEditing(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTeacher) return;
    setSaving(true);
    try {
      await updateTeacherProfile(selectedTeacher.id, { officeHours, bio });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
          BAMS Faculty &amp; Teacher Profiles
        </h1>
        <p className="mt-1 text-xs text-slate-500">
          Unified faculty directory · Subject allocations · Draft &amp; submitted session compliance
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Faculty Cards List */}
        <div className="lg:col-span-5 space-y-3">
          {teachers.map((t) => {
            const isSelected = selectedTeacher?.id === t.id;
            const initials = t.fullName
              .replace(/^Dr\.\s*/i, '')
              .split(' ')
              .map((p) => p[0])
              .join('')
              .slice(0, 2);

            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setSelectedTeacherId(t.id);
                  setEditing(false);
                }}
                className={`w-full text-left surface-3d-interactive rounded-xl p-4 flex items-start gap-4 ${
                  isSelected
                    ? 'border-emerald-700 ring-1 ring-emerald-700/25'
                    : ''
                }`}
              >
                <div className="w-14 h-14 rounded-xl overflow-hidden border border-slate-200 bg-slate-100 shrink-0 flex items-center justify-center">
                  {t.avatarUrl && !imgErrors[t.id] ? (
                    <img
                      src={t.avatarUrl}
                      alt={t.fullName}
                      referrerPolicy="no-referrer"
                      onError={() => setImgErrors((prev) => ({ ...prev, [t.id]: true }))}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-sm font-bold text-emerald-900">{initials}</span>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold text-slate-900 truncate">
                      {t.fullName}
                    </h2>
                    <span className="font-mono text-xs text-emerald-800 font-semibold tabular-nums shrink-0">
                      {t.avgAttendanceRate}%
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 truncate">
                    {t.designation} · {t.department}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
                    <span>{t.employeeCode}</span>
                    <span aria-hidden="true">·</span>
                    <span>{t.weeklyHours}h/wk</span>
                    <span aria-hidden="true">·</span>
                    <span>{t.sessionsSubmitted} submitted</span>
                    {t.sessionsDraft > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-amber-700">{t.sessionsDraft} draft</span>
                      </>
                    )}
                  </div>
                </div>
              </button>
            );
          })}

          {teachers.length === 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-xs text-slate-500">
              No faculty profiles loaded yet.
            </div>
          )}
        </div>

        {/* Selected Teacher Profile Detail */}
        <div className="lg:col-span-7">
          {selectedTeacher ? (
            <div className="surface-3d rounded-xl p-5 sm:p-6 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-5 border-b border-slate-200">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-xl overflow-hidden border border-slate-200 bg-slate-100 shrink-0 flex items-center justify-center">
                    {selectedTeacher.avatarUrl && !imgErrors[selectedTeacher.id] ? (
                      <img
                        src={selectedTeacher.avatarUrl}
                        alt={selectedTeacher.fullName}
                        referrerPolicy="no-referrer"
                        onError={() =>
                          setImgErrors((prev) => ({ ...prev, [selectedTeacher.id]: true }))
                        }
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <GraduationCap className="w-6 h-6 text-emerald-800" />
                    )}
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">
                      {selectedTeacher.fullName}
                    </h2>
                    <p className="text-xs text-slate-600 mt-0.5">
                      {selectedTeacher.designation} · {selectedTeacher.department}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      {selectedTeacher.qualification} · {selectedTeacher.employeeCode}
                    </p>
                  </div>
                </div>

                {canEditSelected && !editing && (
                  <button
                    type="button"
                    onClick={startEdit}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg self-start whitespace-nowrap"
                  >
                    <FileEdit className="w-3.5 h-3.5" />
                    Edit Profile
                  </button>
                )}
              </div>

              {editing ? (
                <form onSubmit={handleSave} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      Office Hours
                    </label>
                    <input
                      type="text"
                      maxLength={100}
                      value={officeHours}
                      onChange={(e) => setOfficeHours(e.target.value)}
                      className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5">
                      Academic Specialization &amp; Bio
                    </label>
                    <textarea
                      rows={3}
                      maxLength={500}
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      className="w-full px-3.5 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={saving}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-emerald-800 hover:bg-emerald-900 rounded-lg"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(false)}
                      className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-slate-700 leading-relaxed">{selectedTeacher.bio}</p>
                  <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-emerald-700" />
                      Office Hours: <strong className="text-slate-900">{selectedTeacher.officeHours}</strong>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      Weekly Load: <strong className="text-slate-900">{selectedTeacher.weeklyHours} hrs</strong>
                    </span>
                  </div>
                </div>
              )}

              {/* Faculty Profile Pie Chart */}
              <div className="pt-2">
                <RolePieChartCard
                  compact
                  title={`${selectedTeacher.fullName} — Class Attendance & Compliance Pie Chart`}
                  subtitle={`${teacherSessions.length} session(s) · Avg class attendance ${selectedTeacher.avgAttendanceRate}%`}
                  data={teacherPieData}
                  centerValue={`${selectedTeacher.avgAttendanceRate}%`}
                  centerLabel="Avg Rate"
                  emptyMessage="No class registers recorded yet for this faculty member."
                />
              </div>

              {/* Assigned BAMS Subjects */}
              <div className="pt-4 border-t border-slate-200">
                <h3 className="text-xs font-semibold text-slate-700 mb-3">
                  Assigned BAMS Curriculum Subjects
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {teacherSubjects.map((sub) => (
                    <div
                      key={sub.id}
                      className="border border-slate-200 rounded-lg p-3.5 flex items-start gap-2.5"
                    >
                      <BookOpen className="w-4 h-4 text-emerald-700 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 truncate">
                          {sub.code} · {sub.name}
                        </p>
                        <p className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
                          {sub.profYear} · {sub.deliveredHours} /{' '}
                          {sub.requiredTheoryHours + sub.requiredPracticalHours} hrs
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Faculty Session Log */}
              <div className="pt-4 border-t border-slate-200">
                <h3 className="text-xs font-semibold text-slate-700 mb-3">
                  Recent Class Registers ({teacherSessions.length})
                </h3>
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                  {teacherSessions.map((sess) => (
                    <div
                      key={sess.id}
                      className="p-3 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900 truncate">
                          {sess.subjectCode} · {sess.sessionType} ({sess.durationHours}h)
                        </p>
                        <p className="text-slate-500 font-mono tabular-nums mt-0.5">
                          {sess.date} · {sess.startTime}-{sess.endTime} ·{' '}
                          {sess.presentCount + sess.lateCount}/{sess.totalStudents} attended
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onOpenSession(sess.id)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md border whitespace-nowrap shrink-0 ${
                          sess.status === 'draft'
                            ? 'border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100'
                            : 'border-slate-200 text-slate-700 bg-white hover:bg-slate-50'
                        }`}
                      >
                        {sess.status === 'draft' ? 'Resume Draft' : 'View Audit'}
                      </button>
                    </div>
                  ))}
                  {teacherSessions.length === 0 && (
                    <div className="p-4 text-center text-xs text-slate-500">
                      No sessions logged for this faculty member yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
