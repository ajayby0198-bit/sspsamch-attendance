import React, { useMemo, useState } from 'react';
import { Bell, BookMarked, FileText, Award, MessageSquare, Plus } from 'lucide-react';
import {
  publishLearningResource,
  submitFeedback,
  updateFeedbackStatus,
} from '../services/bamsFirestore';
import {
  FeedbackCategory,
  FeedbackItem,
  FeedbackStatus,
  LearningResource,
  ProfYear,
  ResourceCategory,
  Subject,
  UserRole,
} from '../types';

interface LearningRepositoryViewProps {
  resources: LearningResource[];
  feedbackItems: FeedbackItem[];
  subjects: Subject[];
  currentUid: string;
  currentName: string;
  currentRole: UserRole;
  staffUids: string[];
}

export const LearningRepositoryView: React.FC<LearningRepositoryViewProps> = ({
  resources,
  feedbackItems,
  subjects,
  currentUid,
  currentName,
  currentRole,
  staffUids,
}) => {
  const [catFilter, setCatFilter] = useState<'all' | ResourceCategory>('all');
  const [showPublish, setShowPublish] = useState(false);

  // Publish resource form
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<ResourceCategory>('notes');
  const [profYear, setProfYear] = useState<ProfYear | 'All'>('1st Prof');
  const [subjectCode, setSubjectCode] = useState(subjects[0]?.code || 'BAMS-101');
  const [description, setDescription] = useState('');
  const [scoreSummary, setScoreSummary] = useState('');
  const [publishing, setPublishing] = useState(false);

  // Feedback form
  const [fbCategory, setFbCategory] = useState<FeedbackCategory>('Academic');
  const [fbMessage, setFbMessage] = useState('');
  const [submittingFb, setSubmittingFb] = useState(false);

  const canPublish =
    currentRole === 'admin' ||
    currentRole === 'co_admin' ||
    currentRole === 'principal' ||
    currentRole === 'teacher';
  const canReviewFeedback =
    currentRole === 'admin' || currentRole === 'co_admin' || currentRole === 'principal';

  const filteredResources = useMemo(
    () =>
      catFilter === 'all' ? resources : resources.filter((r) => r.category === catFilter),
    [resources, catFilter]
  );

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    setPublishing(true);
    try {
      await publishLearningResource({
        title,
        category,
        profYear,
        subjectCode,
        description,
        scoreSummary,
        authorUid: currentUid,
        authorName: currentName,
        authorRole: currentRole,
        staffUids,
      });
      setTitle('');
      setDescription('');
      setScoreSummary('');
      setShowPublish(false);
    } finally {
      setPublishing(false);
    }
  };

  const handleFeedbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fbMessage.trim()) return;
    setSubmittingFb(true);
    try {
      await submitFeedback({
        authorUid: currentUid,
        authorName: currentName,
        authorRole: currentRole,
        category: fbCategory,
        message: fbMessage,
        staffUids,
      });
      setFbMessage('');
    } finally {
      setSubmittingFb(false);
    }
  };

  const categoryLabel = (cat: ResourceCategory) => {
    if (cat === 'notes') return 'Study Notes';
    if (cat === 'test_paper') return 'Test Paper';
    if (cat === 'marks') return 'Internal Marks';
    return 'Notification';
  };

  const categoryIcon = (cat: ResourceCategory) => {
    if (cat === 'notes') return <BookMarked className="w-4 h-4 text-emerald-700" />;
    if (cat === 'test_paper') return <FileText className="w-4 h-4 text-slate-700" />;
    if (cat === 'marks') return <Award className="w-4 h-4 text-amber-700" />;
    return <Bell className="w-4 h-4 text-red-700" />;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Learning Repository &amp; Feedback Loop
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Notes, previous test papers, internal marks, college notifications &amp; continuous improvement
          </p>
        </div>

        {canPublish && (
          <button
            type="button"
            onClick={() => setShowPublish((v) => !v)}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-white bg-emerald-800 hover:bg-emerald-900 rounded-lg btn-3d self-start sm:self-auto whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            {showPublish ? 'Close Form' : 'Publish Resource / Notice'}
          </button>
        )}
      </div>

      {showPublish && canPublish && (
        <form
          onSubmit={handlePublish}
          className="surface-3d rounded-xl p-5 sm:p-6 space-y-4"
        >
          <h2 className="text-sm font-semibold text-slate-900">
            Publish Notes, Test Paper, Marks, or Notification
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Title</label>
              <input
                type="text"
                required
                maxLength={140}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as ResourceCategory)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              >
                <option value="notes">Study Notes</option>
                <option value="test_paper">Test Paper</option>
                <option value="marks">Internal Marks</option>
                <option value="notification">Notification</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Batch / Prof</label>
              <select
                value={profYear}
                onChange={(e) => setProfYear(e.target.value as ProfYear | 'All')}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              >
                <option value="1st Prof">1st Prof</option>
                <option value="2nd Prof">2nd Prof</option>
                <option value="3rd Prof">3rd Prof</option>
                <option value="All">All Batches</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Subject Code</label>
              <input
                type="text"
                required
                maxLength={24}
                value={subjectCode}
                onChange={(e) => setSubjectCode(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Metric / Summary Tag
              </label>
              <input
                type="text"
                maxLength={100}
                placeholder="e.g. Max Marks: 50 or Unit 4"
                value={scoreSummary}
                onChange={(e) => setScoreSummary(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Description</label>
              <input
                type="text"
                required
                maxLength={400}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={publishing}
              className="px-5 py-2 text-xs font-medium text-white bg-emerald-800 hover:bg-emerald-900 rounded-lg"
            >
              {publishing ? 'Publishing...' : 'Publish to Repository'}
            </button>
          </div>
        </form>
      )}

      {/* Repository Filter Bar */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg self-start inline-flex overflow-x-auto max-w-full">
        {(
          [
            { id: 'all', label: 'All Resources' },
            { id: 'notes', label: 'Notes' },
            { id: 'test_paper', label: 'Test Papers' },
            { id: 'marks', label: 'Internal Marks' },
            { id: 'notification', label: 'Notifications' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setCatFilter(tab.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
              catFilter === tab.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Resource Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredResources.map((res) => (
          <div key={res.id} className="surface-3d-interactive rounded-xl p-5 space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                {categoryIcon(res.category)}
                {categoryLabel(res.category)}
              </span>
              <span className="font-mono tabular-nums">
                {res.subjectCode} · {res.profYear}
              </span>
            </div>
            <h3 className="text-sm font-semibold text-slate-900">{res.title}</h3>
            <p className="text-xs text-slate-600 leading-relaxed">{res.description}</p>
            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>{res.authorName}</span>
              <span className="font-mono text-emerald-800 font-medium">{res.scoreSummary}</span>
            </div>
          </div>
        ))}
        {filteredResources.length === 0 && (
          <div className="md:col-span-2 surface-3d-interactive rounded-xl p-8 text-center text-xs text-slate-500">
            No items in this category yet.
          </div>
        )}
      </div>

      {/* Public Feedback & Continuous Improvement Loop (Slide 18) */}
      <section className="surface-3d-interactive rounded-xl p-5 sm:p-6 space-y-5">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-emerald-700" />
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Institutional Feedback &amp; Improvement Suggestions
            </h2>
            <p className="text-xs text-slate-500">
              Students, faculty, and parents can suggest improvements; Principal &amp; Admin review and implement updates
            </p>
          </div>
        </div>

        <form onSubmit={handleFeedbackSubmit} className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          <select
            value={fbCategory}
            onChange={(e) => setFbCategory(e.target.value as FeedbackCategory)}
            className="sm:col-span-3 px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg"
          >
            <option value="Academic">Academic</option>
            <option value="Attendance">Attendance</option>
            <option value="Resources">Resources</option>
            <option value="Usability">Portal Usability</option>
          </select>
          <input
            type="text"
            required
            minLength={5}
            maxLength={400}
            placeholder="Suggest an academic, attendance, or learning resource improvement..."
            value={fbMessage}
            onChange={(e) => setFbMessage(e.target.value)}
            className="sm:col-span-7 px-3.5 py-2 text-xs bg-white border border-slate-200 rounded-lg"
          />
          <button
            type="submit"
            disabled={submittingFb}
            className="sm:col-span-2 px-4 py-2 text-xs font-medium text-white bg-emerald-800 hover:bg-emerald-900 disabled:opacity-60 rounded-lg whitespace-nowrap"
          >
            {submittingFb ? 'Sending...' : 'Submit'}
          </button>
        </form>

        <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
          {feedbackItems.map((item) => (
            <div
              key={item.id}
              className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
            >
              <div className="min-w-0">
                <p className="text-slate-800">{item.message}</p>
                <p className="mt-1 text-slate-500">
                  {item.authorName} · <span className="capitalize">{item.authorRole}</span> ·{' '}
                  {item.category}
                </p>
              </div>
              {canReviewFeedback ? (
                <select
                  value={item.status}
                  onChange={(e) => updateFeedbackStatus(item.id, e.target.value as FeedbackStatus)}
                  className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md capitalize shrink-0 self-start sm:self-center"
                >
                  <option value="submitted">Submitted</option>
                  <option value="reviewed">Reviewed</option>
                  <option value="implemented">Implemented</option>
                </select>
              ) : (
                <span className="capitalize font-medium text-emerald-800 shrink-0">
                  {item.status}
                </span>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
