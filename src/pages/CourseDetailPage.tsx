import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  BookOpenCheck, ChevronLeft, Upload, FileText, CheckCircle, Clock,
  AlertCircle, Send, Paperclip, GraduationCap, Play, Download, Star, Award, Trophy, Sparkles, History,
  Users, Presentation, ArrowRight, Plus, Edit2, Trash2, Save, X, Table2, Lock,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  coursesApi,
  type CourseResponse,
  type CourseLessonResponse,
  type LessonSubmissionResponse,
  type GradingCriterionResponse,
  type SubmissionReviewHistoryEntry,
  type HearingSubmissionResponse,
  type CourseSummaryResponse,
} from '../app/api/courses';
import { courseGroupsApi, type CourseGroupResponse } from '../app/api/courseGroups';
import { accountsApi, type GetAllUserResponse } from '../app/api/accounts';
import { filesApi } from '../app/api/files';
import { useAuth } from '../context/AuthContext';
import { toast } from 'sonner';
import { ModeratorCoursePanel } from '../app/components/ModeratorCoursePanel';
import { ModeratorCourseStats } from '../app/components/ModeratorCourseStats';

function sumHearingReviewGrades(sub: HearingSubmissionResponse | undefined): number {
  if (!sub?.reviews?.length) return 0;
  return sub.reviews.reduce((acc, r) => acc + (r.grade ?? 0), 0);
}

/** Этапы слушаний после выбора темы закрыты до активации модератором */
function isHearingLockedForStudent(h: CourseLessonResponse, isModeratorOnly: boolean): boolean {
  if (isModeratorOnly) return false;
  if (h.hearing_stage === 'TOPIC_APPROVAL') return false;
  return !h.hearing_open_for_students;
}

const statusConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  SUBMITTED:      { label: 'На проверке',  color: 'text-yellow-800 bg-yellow-100 border-yellow-200 dark:bg-yellow-950/50 dark:text-yellow-200 dark:border-yellow-800', icon: <Clock className="size-4" /> },
  ACCEPTED:       { label: 'Принято',      color: 'text-emerald-800 bg-emerald-100 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800', icon: <CheckCircle className="size-4" /> },
  NEEDS_REVISION: { label: 'На доработку', color: 'text-red-800 bg-red-100 border-red-200 dark:bg-red-950/40 dark:text-red-200 dark:border-red-800', icon: <AlertCircle className="size-4" /> },
};

export const CourseDetailPage: React.FC = () => {
  const { courseId } = useParams<{ courseId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const isModeratorOnly = user?.role === 'Модератор' || user?.role === 'Администратор';
  const [courseViewTab, setCourseViewTab] = useState<'learn' | 'moderate'>('learn');
  const [mainTab, setMainTab] = useState<'lessons' | 'hearings' | 'summary'>('lessons');

  const [course, setCourse] = useState<CourseResponse | null>(null);
  const [submissions, setSubmissions] = useState<Map<number, LessonSubmissionResponse>>(new Map());
  const [lessonCriteria, setLessonCriteria] = useState<Map<number, GradingCriterionResponse[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [activeLesson, setActiveLesson] = useState<CourseLessonResponse | null>(null);
  const [activeTab, setActiveTab] = useState<'lecture' | 'practice'>('lecture');
  const [showCelebration, setShowCelebration] = useState(false);
  /** Сумма баллов по рецензиям слушаний (групповые этапы) */
  const [hearingPointsTotal, setHearingPointsTotal] = useState(0);
  /** Кол-во принятых этапов слушаний (для прогресса) */
  const [hearingAcceptedCount, setHearingAcceptedCount] = useState(0);
  const fetchData = useCallback(async () => {
    if (!courseId) return;
    setLoading(true);
    try {
      const [courseRes, subsRes] = await Promise.all([
        coursesApi.getCourse(Number(courseId)),
        coursesApi.getMySubmissionsForCourse(Number(courseId)).catch(() => ({ data: [] })),
      ]);
      setCourse(courseRes.data);
      const map = new Map<number, LessonSubmissionResponse>();
      (subsRes.data ?? []).forEach(s => map.set(s.lesson_id, s));
      setSubmissions(map);

      const criteriaMap = new Map<number, GradingCriterionResponse[]>();
      await Promise.all(
          courseRes.data.lessons.map(async (lesson) => {
            try {
              const res = await coursesApi.getLessonCriteria(lesson.id);
              if (res.data?.length) criteriaMap.set(lesson.id, res.data);
            } catch { /* no criteria for this lesson */ }
          }),
      );
      setLessonCriteria(criteriaMap);

      const regular = courseRes.data.lessons.filter(l => l.category !== 'HEARING');
      setActiveLesson(prev => {
        if (prev && regular.some(l => l.id === prev.id)) return prev;
        return regular[0] ?? null;
      });

      let hp = 0;
      let hearingAccepted = 0;
      try {
        const gr = await courseGroupsApi.getMyGroup(Number(courseId));
        const gid = gr.data?.id;
        if (gid != null) {
          for (const hl of courseRes.data.lessons.filter(l => l.category === 'HEARING')) {
            try {
              const hr = await coursesApi.getMyHearingSubmission(hl.id, gid);
              if (hr.data) {
                hp += sumHearingReviewGrades(hr.data);
                if (hr.data.status === 'ACCEPTED') hearingAccepted += 1;
              }
            } catch { /* нет отправки */ }
          }
        }
      } catch { /* нет группы */ }
      setHearingPointsTotal(hp);
      setHearingAcceptedCount(hearingAccepted);

      const acceptedRegular = (subsRes.data ?? []).filter(s => {
        const les = courseRes.data.lessons.find(x => x.id === s.lesson_id);
        return les && les.category !== 'HEARING' && s.status === 'ACCEPTED';
      }).length;
      if (
          user?.role !== 'Модератор' &&
          acceptedRegular > 0 &&
          regular.length > 0 &&
          acceptedRegular === regular.length
      ) {
        setShowCelebration(true);
        setTimeout(() => setShowCelebration(false), 5000);
      }
    } catch {
      toast.error('Ошибка загрузки курса');
    } finally {
      setLoading(false);
    }
  }, [courseId, user?.role]);

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    fetchData();
  }, [user, navigate, fetchData]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!course || !activeLesson) return;
      const regular = course.lessons.filter(l => l.category !== 'HEARING');
      const idx = regular.findIndex(l => l.id === activeLesson.id);
      if (idx < 0) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        if (idx < regular.length - 1) {
          setActiveLesson(regular[idx + 1]);
          setActiveTab('lecture');
        }
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        if (idx > 0) {
          setActiveLesson(regular[idx - 1]);
          setActiveTab('lecture');
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [course, activeLesson]);

  if (loading) {
    return (
        <div className="max-w-6xl mx-auto px-6 py-10">
          <div className="h-10 w-64 bg-muted rounded-xl animate-pulse mb-8" />
          <div className="grid grid-cols-4 gap-6">
            <div className="col-span-1 space-y-2">
              {[1, 2, 3, 4].map(i => <div key={i} className="h-12 bg-muted rounded-xl animate-pulse" />)}
            </div>
            <div className="col-span-3 h-96 bg-muted rounded-2xl animate-pulse" />
          </div>
        </div>
    );
  }

  if (!course) {
    return <div className="max-w-4xl mx-auto px-6 py-20 text-center"><p className="text-muted-foreground text-lg">Курс не найден</p></div>;
  }

  const regularLessons = course.lessons.filter(l => l.category !== 'HEARING');
  const hearingLessons = course.lessons.filter(l => l.category === 'HEARING');

  /** Вводный курс — слушания скрыты везде */
  const isIntroduction = course.is_introduction === true;

  // Если на вкладке слушаний оказались на вводном курсе — возвращаем на уроки
  if (isIntroduction && mainTab === 'hearings') {
    setMainTab('lessons');
  }
  const lessonMaxPoints = (l: CourseLessonResponse) => {
    const lc = lessonCriteria.get(l.id);
    return lc && lc.length > 0 ? lc.reduce((s, c) => s + c.max_points, 0) : l.max_score;
  };


  const completedRegular = regularLessons.filter(l => submissions.get(l.id)?.status === 'ACCEPTED').length;
  const completedCount = completedRegular + hearingAcceptedCount;
  const lessonScoreSum = Array.from(submissions.values()).reduce((s, v) => s + (v.score ?? 0), 0);
  const totalScore = lessonScoreSum + hearingPointsTotal;
  const maxPossible = course.lessons.reduce((sum, l) => sum + lessonMaxPoints(l), 0);
  const totalSteps = course.lessons.length;
  const progressPct = totalSteps > 0 ? Math.round((completedCount / totalSteps) * 100) : 0;
  const isComplete = totalSteps > 0 && completedCount === totalSteps;

  return (
      <div className="max-w-6xl mx-auto px-6 py-10 min-h-[calc(100vh-5rem)] bg-background">
        {/* Celebration overlay */}
        <AnimatePresence>
          {showCelebration && (
              <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
              >
                <div className="bg-card backdrop-blur-sm rounded-3xl p-10 shadow-2xl text-center border border-border">
                  <motion.div
                      animate={{ rotate: [0, 10, -10, 10, 0] }}
                      transition={{ duration: 0.5, repeat: 2 }}
                  >
                    <Trophy className="size-16 text-yellow-500 mx-auto mb-4" />
                  </motion.div>
                  <h2 className="text-2xl font-bold text-foreground mb-2">Курс пройден!</h2>
                  <p className="text-muted-foreground">Вы выполнили все учебные задания. Итого по баллам: {totalScore}</p>
                </div>
              </motion.div>
          )}
        </AnimatePresence>

        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <Link to="/courses" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4">
            <ChevronLeft className="size-4" /> Назад к курсам
          </Link>
          <div className="flex items-center gap-4">
            <div className="size-14 bg-gradient-to-br from-primary to-primary/80 rounded-2xl flex items-center justify-center shadow-lg shadow-primary/20">
              <GraduationCap className="size-7 text-primary-foreground" />
            </div>
            <div className="flex-1">
              <h1 className="text-foreground text-2xl font-bold">{course.name}</h1>
              {course.description && <p className="text-muted-foreground mt-1">{course.description}</p>}
            </div>
            {!isModeratorOnly && isComplete && (
                <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-yellow-50 to-amber-50 text-amber-700 text-xs font-bold rounded-xl border border-amber-200"
                >
                  <Sparkles className="size-3.5" /> Курс пройден
                </motion.div>
            )}
          </div>

          {!isModeratorOnly && (
              /* Stats row — только для ученика */
              <div className="flex flex-wrap gap-4 mt-6">
                <motion.div
                    className="flex items-center gap-2 px-4 py-2 bg-card rounded-xl border border-border cursor-default"
                    whileHover={{ scale: 1.02 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 10 }}
                >
                  <div className="size-8 bg-primary/10 rounded-lg flex items-center justify-center"><BookOpenCheck className="size-4 text-primary" /></div>
                  <div><p className="text-xs text-muted-foreground">Прогресс</p><p className="text-sm font-semibold text-foreground">{completedCount}/{totalSteps} этапов</p></div>
                </motion.div>
                <motion.div
                    className="flex items-center gap-2 px-4 py-2 bg-card rounded-xl border border-border cursor-default"
                    whileHover={{ scale: 1.02 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 10 }}
                >
                  <div className="size-8 bg-destructive/10 rounded-lg flex items-center justify-center"><Star className="size-4 text-destructive" /></div>
                  <div><p className="text-xs text-muted-foreground">Баллы</p><p className="text-sm font-semibold text-foreground">{totalScore}/{maxPossible}</p></div>
                </motion.div>
                <div className="flex-1 min-w-[200px] flex items-center gap-3 px-4 py-2 bg-card rounded-xl border border-border">
                  <div className="flex-1">
                    <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
                      <motion.div
                          className={`h-2.5 rounded-full ${isComplete ? 'bg-gradient-to-r from-emerald-400 to-emerald-500' : 'bg-gradient-to-r from-primary to-primary/80'}`}
                          initial={{ width: 0 }}
                          animate={{ width: `${progressPct}%` }}
                          transition={{ duration: 1, ease: 'easeOut' }}
                      />
                    </div>
                  </div>
                  <span className={`text-xs font-semibold ${isComplete ? 'text-emerald-600' : 'text-muted-foreground'}`}>
              {progressPct}%
            </span>
                </div>
              </div>
          )}
        </motion.div>

        {/* Main tabs: Уроки / Слушания */}
        <div className="flex flex-wrap gap-2 mb-6" role="tablist" aria-label="Разделы курса">
          <button
              type="button"
              role="tab"
              aria-selected={mainTab === 'lessons'}
              onClick={() => setMainTab('lessons')}
              className={`px-4 py-2.5 rounded-xl text-sm font-semibold border transition-all flex items-center gap-2 ${
                  mainTab === 'lessons'
                      ? 'bg-primary text-primary-foreground border-primary shadow-md'
                      : 'bg-card text-muted-foreground border-border hover:bg-muted'
              }`}
          >
            <BookOpenCheck className="size-4" /> Уроки
          </button>
          {!isIntroduction && (
              <button
                  type="button"
                  role="tab"
                  aria-selected={mainTab === 'hearings'}
                  onClick={() => setMainTab('hearings')}
                  className={`px-4 py-2.5 rounded-xl text-sm font-semibold border transition-all flex items-center gap-2 ${
                      mainTab === 'hearings'
                          ? 'bg-primary text-primary-foreground border-primary shadow-md'
                          : 'bg-card text-muted-foreground border-border hover:bg-muted'
                  }`}
              >
                <Presentation className="size-4" /> Слушания (проект)
              </button>
          )}
          {isModeratorOnly && (
              <button
                  type="button"
                  role="tab"
                  aria-selected={mainTab === 'summary'}
                  onClick={() => setMainTab('summary')}
                  className={`px-4 py-2.5 rounded-xl text-sm font-semibold border transition-all flex items-center gap-2 ${
                      mainTab === 'summary'
                          ? 'bg-primary text-primary-foreground border-primary shadow-md'
                          : 'bg-card text-muted-foreground border-border hover:bg-muted'
                  }`}
              >
                <Table2 className="size-4" /> Сводная таблица
              </button>
          )}
        </div>

        {mainTab === 'summary' && isModeratorOnly ? (
            <CourseSummaryTab courseId={Number(courseId)} />
        ) : mainTab === 'hearings' ? (
            isModeratorOnly ? (
                <HearingsModeratorView courseId={Number(courseId)} lessons={course.lessons} />
            ) : (
                <HearingsTab courseId={Number(courseId)} lessons={course.lessons} isModeratorOnly={false} forLaggingStudents={course.for_lagging_students === true} />
            )
        ) : (
            <>
              {isModeratorOnly && (
                  <div className="flex flex-wrap gap-2 mb-6" role="tablist" aria-label="Режим просмотра курса">
                    <button
                        type="button"
                        role="tab"
                        aria-selected={courseViewTab === 'learn'}
                        onClick={() => setCourseViewTab('learn')}
                        className={`px-4 py-2.5 rounded-xl text-sm font-semibold border transition-all ${
                            courseViewTab === 'learn'
                                ? 'bg-primary text-primary-foreground border-primary shadow-md'
                                : 'bg-card text-muted-foreground border-border hover:bg-muted'
                        }`}
                    >
                      Материалы и задания
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={courseViewTab === 'moderate'}
                        onClick={() => setCourseViewTab('moderate')}
                        className={`px-4 py-2.5 rounded-xl text-sm font-semibold border transition-all ${
                            courseViewTab === 'moderate'
                                ? 'bg-primary text-primary-foreground border-primary shadow-md'
                                : 'bg-card text-muted-foreground border-border hover:bg-muted'
                        }`}
                    >
                      Статистика и проверка работ
                    </button>
                  </div>
              )}

              {isModeratorOnly && courseId ? (
                  courseViewTab === 'learn' ? (
                      <ModeratorCoursePanel courseId={Number(courseId)} mode="edit" />
                  ) : (
                      <div className="space-y-6">
                        <ModeratorCourseStats courseId={Number(courseId)} forLaggingStudents={course.for_lagging_students === true} isIntroduction={course.is_introduction === true} lessons={course.lessons} />
                        <ModeratorCoursePanel courseId={Number(courseId)} mode="review" />
                      </div>
                  )
              ) : (
                  <>
                    {/* Main layout: sidebar + content */}
                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                      {/* Sidebar: lesson list */}
                      <motion.div initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }}
                                  className="lg:col-span-1 bg-card rounded-2xl border border-border overflow-hidden self-start sticky top-24">
                        <div className="px-4 py-3 border-b border-border bg-muted/30">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Уроки курса</p>
                        </div>
                        <div className="divide-y divide-border max-h-[60vh] overflow-y-auto">
                          {course.lessons.filter(l => l.category !== 'HEARING').map((lesson, idx) => {
                            const sub = submissions.get(lesson.id);
                            const isActive = activeLesson?.id === lesson.id;
                            return (
                                <motion.button
                                    key={lesson.id}
                                    initial={{ opacity: 0, x: -12 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: idx * 0.05 }}
                                    onClick={() => { setActiveLesson(lesson); setActiveTab('lecture'); }}
                                    className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-all ${isActive ? 'bg-primary/10 border-l-2 border-l-primary' : 'hover:bg-muted/50 border-l-2 border-l-transparent'}`}
                                >
                                  <motion.span
                                      className={`size-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                                          sub?.status === 'ACCEPTED' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300' :
                                              sub?.status === 'NEEDS_REVISION' ? 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300' :
                                                  sub ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950/50 dark:text-yellow-200' :
                                                      'bg-muted text-muted-foreground'
                                      }`}
                                      whileHover={{ scale: 1.15 }}
                                      transition={{ type: 'spring', stiffness: 400, damping: 10 }}
                                  >
                                    {sub?.status === 'ACCEPTED' ? '✓' : lesson.order_number}
                                  </motion.span>
                                  <div className="flex-1 min-w-0">
                                    <span className={`text-sm font-medium truncate block ${isActive ? 'text-primary' : 'text-foreground'}`}>{lesson.title}</span>
                                    {sub?.score != null && (
                                        <span className="text-[10px] text-muted-foreground">{sub.score} баллов</span>
                                    )}
                                  </div>
                                </motion.button>
                            );
                          })}
                        </div>
                      </motion.div>

                      {/* Content area */}
                      <div className="lg:col-span-3">
                        {activeLesson ? (
                            <LessonContent
                                lesson={activeLesson}
                                submission={submissions.get(activeLesson.id) ?? null}
                                criteria={lessonCriteria.get(activeLesson.id) ?? []}
                                activeTab={activeTab}
                                onTabChange={setActiveTab}
                                onSubmissionUpdate={fetchData}
                            />
                        ) : (
                            <div className="bg-card rounded-2xl border border-border p-10 text-center text-muted-foreground">
                              <BookOpenCheck className="size-10 mx-auto mb-3 opacity-30" />
                              <p>Выберите урок для просмотра</p>
                            </div>
                        )}
                      </div>
                    </div>
                  </>
              )}
            </>
        )}
      </div>
  );
};

/* ─── Hearings Moderator View ──────────────────────────────────────────── */

const HearingsModeratorView: React.FC<{ courseId: number; lessons: CourseLessonResponse[] }> = ({ courseId, lessons }) => {
  const [subTab, setSubTab] = useState<'edit' | 'groups'>('edit');
  return (
      <div className="space-y-6">
        <div className="flex gap-2" role="tablist">
          <button role="tab" aria-selected={subTab === 'edit'} onClick={() => setSubTab('edit')}
                  className={`px-4 py-2.5 rounded-xl text-sm font-semibold border transition-all ${subTab === 'edit' ? 'bg-primary text-primary-foreground border-primary shadow-md' : 'bg-card text-muted-foreground border-border hover:bg-muted'}`}>
            Материалы и критерии
          </button>
          <button role="tab" aria-selected={subTab === 'groups'} onClick={() => setSubTab('groups')}
                  className={`px-4 py-2.5 rounded-xl text-sm font-semibold border transition-all ${subTab === 'groups' ? 'bg-primary text-primary-foreground border-primary shadow-md' : 'bg-card text-muted-foreground border-border hover:bg-muted'}`}>
            Группы и проверка работ
          </button>
        </div>
        {subTab === 'edit' ? (
            <ModeratorCoursePanel courseId={courseId} mode="edit" category="HEARING" />
        ) : (
            <HearingsTab courseId={courseId} lessons={lessons} isModeratorOnly={true} />
        )}
      </div>
  );
};

/* ─── Hearings Tab ────────────────────────────────────────────────────────── */

const HEARING_STAGE_LABELS: Record<string, string> = {
  TOPIC_APPROVAL: 'Выбор и согласование темы',
  INTERMEDIATE: 'Промежуточный показ',
  FINAL: 'Финальный показ',
  CONFERENCE_DEFENSE: 'Защита на конференции',
};

const hearingStatusConfig: Record<string, { label: string; color: string }> = {
  ON_REVIEW:       { label: 'На проверке',  color: 'text-yellow-800 bg-yellow-100 border-yellow-200 dark:bg-yellow-950/50 dark:text-yellow-200 dark:border-yellow-800' },
  SUBMITTED:       { label: 'На проверке',  color: 'text-yellow-800 bg-yellow-100 border-yellow-200 dark:bg-yellow-950/50 dark:text-yellow-200 dark:border-yellow-800' },
  ACCEPTED:        { label: 'Принято',      color: 'text-emerald-800 bg-emerald-100 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800' },
  NEEDS_REVISION:  { label: 'На доработку', color: 'text-red-800 bg-red-100 border-red-200 dark:bg-red-950/40 dark:text-red-200 dark:border-red-800' },
  REJECTED:        { label: 'Отклонено',    color: 'text-red-800 bg-red-100 border-red-200 dark:bg-red-950/40 dark:text-red-200 dark:border-red-800' },
};

/** Отдельное состояние формы рецензии для каждой группы (исправляет общий стейт у всех карточек). */
const HearingGroupReviewCard: React.FC<{
  sub: HearingSubmissionResponse;
  groupLabel: string;
  groupDescription?: string | null;
  membersLine: string;
  criteria?: GradingCriterionResponse[];
  onSend: (submissionId: number, comment: string, grade: number | null, status: string) => Promise<void>;
}> = ({ sub, groupLabel, membersLine, criteria = [], onSend }) => {
  const [comment, setComment] = useState('');
  const [grade, setGrade] = useState(5);
  const [criteriaScores, setCriteriaScores] = useState<Record<number, number>>({});
  const [status, setStatus] = useState('ACCEPTED');
  const [sending, setSending] = useState(false);
  const accepted = sub.status === 'ACCEPTED';
  const hasCriteria = criteria.length > 0;

  const totalCriteriaScore = Object.values(criteriaScores).reduce((s, v) => s + v, 0);
  const maxCriteriaScore = criteria.reduce((s, c) => s + c.max_points, 0);

  return (
      <div className="border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">{groupLabel}</p>
            <p className="text-xs text-muted-foreground">{membersLine}</p>
          </div>
          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs border ${hearingStatusConfig[sub.status]?.color ?? ''}`}>
          {hearingStatusConfig[sub.status]?.label}
        </span>
        </div>
        {sub.file_name && (
            <button
                type="button"
                onClick={() => {
                  if (sub.file_name_in_directory && sub.file_name) filesApi.downloadFile(sub.file_name_in_directory, sub.file_name);
                }}
                className="flex items-center gap-2 px-3 py-2 bg-primary/10 rounded-lg border border-primary/20 text-sm text-primary hover:bg-primary/15 transition-colors"
            >
              <Download className="size-4" /> {sub.file_name}
            </button>
        )}
        {sub.reviews?.length > 0 && (
            <div className="text-xs text-muted-foreground space-y-1">
              {[...(sub.reviews ?? [])]
                  .sort((a, b) => new Date(a.reviewed_at.replace(' ', 'T')).getTime() - new Date(b.reviewed_at.replace(' ', 'T')).getTime())
                  .map(r => (
                      <div key={r.id} className="bg-muted/50 rounded-lg p-2 border border-border">
                        <span className="font-medium">{r.moderator_name}</span>
                        {r.grade != null && <> — оценка {r.grade}</>}
                        {r.comment && <p className="mt-0.5">{r.comment}</p>}
                      </div>
                  ))}
            </div>
        )}
        <div className="space-y-3 pt-2 border-t border-border">
          {!accepted && hasCriteria && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2">Оценка по критериям</p>
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {criteria.map(c => {
                    const pts = criteriaScores[c.id] ?? 0;
                    return (
                        <div key={c.id} className="flex items-center gap-3 p-2.5 bg-muted/40 rounded-xl border border-border">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-foreground">{c.order_number}. {c.name}</p>
                            {c.description && <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{c.description}</p>}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <input
                                type="range"
                                min={0}
                                max={c.max_points}
                                value={pts}
                                onChange={e => setCriteriaScores(prev => ({ ...prev, [c.id]: Number(e.target.value) }))}
                                className="w-20 accent-primary"
                            />
                            <span className="text-xs font-bold w-12 text-center rounded-lg py-0.5 text-primary bg-primary/10 border border-primary/20">
                              {pts}/{c.max_points}
                            </span>
                          </div>
                        </div>
                    );
                  })}
                </div>
                <div className="mt-2 flex items-center justify-between px-3 py-1.5 bg-primary/5 rounded-xl border border-primary/20">
                  <span className="text-xs font-semibold text-primary">Итого</span>
                  <span className="text-sm font-bold text-primary">{totalCriteriaScore}/{maxCriteriaScore}</span>
                </div>
              </div>
          )}
          <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2} placeholder="Комментарий..." className="w-full border border-border rounded-lg px-3 py-2 text-sm resize-none bg-background focus:ring-2 focus:ring-primary outline-none" />
          {!accepted && (
              <div className="flex items-center gap-3 flex-wrap">
                {!hasCriteria && (
                    <>
                      <label className="text-xs text-muted-foreground shrink-0">Оценка:</label>
                      <input
                          type="number"
                          min={1}
                          max={10}
                          value={Number.isFinite(grade) ? grade : 5}
                          onChange={e => {
                            const v = Number(e.target.value);
                            if (!Number.isFinite(v)) return;
                            setGrade(v);
                          }}
                          className="w-16 border border-border rounded-lg px-2 py-1.5 text-sm bg-background focus:ring-2 focus:ring-primary outline-none"
                      />
                    </>
                )}
                <select value={status} onChange={e => setStatus(e.target.value)} className="border border-border rounded-lg px-2 py-1.5 text-sm bg-background focus:ring-2 focus:ring-primary outline-none">
                  <option value="ACCEPTED">Принято</option>
                  <option value="NEEDS_REVISION">На доработку</option>
                  <option value="REJECTED">Отклонено</option>
                </select>
              </div>
          )}
          <button
              type="button"
              disabled={sending || !comment.trim()}
              onClick={async () => {
                setSending(true);
                try {
                  if (!accepted) {
                    const finalGrade = hasCriteria ? totalCriteriaScore : grade;
                    if (!hasCriteria && (!Number.isFinite(grade) || grade < 1 || grade > 10)) {
                      toast.error('Оценка должна быть от 1 до 10');
                      return;
                    }
                    await onSend(sub.id, comment, finalGrade, status);
                  } else {
                    await onSend(sub.id, comment, null, 'ACCEPTED');
                  }
                  setComment('');
                } finally {
                  setSending(false);
                }
              }}
              className="ml-auto px-4 py-1.5 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:opacity-90 transition-colors disabled:opacity-50"
          >
            {sending ? '…' : accepted ? 'Отправить комментарий' : 'Отправить рецензию'}
          </button>
        </div>
      </div>
  );
};

const HearingSubmissionListItem: React.FC<{
  sub: HearingSubmissionResponse;
  title: string;
  sender: string;
  selected: boolean;
  onClick: () => void;
}> = ({ sub, title, sender, selected, onClick }) => {
  return (
      <button
          type="button"
          onClick={onClick}
          className={`w-full text-left px-3 py-2 rounded-xl border transition-colors ${
              selected ? 'border-primary/40 bg-primary/5' : 'border-border hover:bg-muted/30'
          }`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{title}</p>
            <p className="text-xs text-muted-foreground truncate">{sender}</p>
          </div>
          <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] border ${hearingStatusConfig[sub.status]?.color ?? ''}`}>
          {hearingStatusConfig[sub.status]?.label ?? sub.status}
        </span>
        </div>
      </button>
  );
};

interface HearingsTabProps {
  courseId: number;
  lessons: CourseLessonResponse[];
  isModeratorOnly: boolean;
  forLaggingStudents?: boolean;
}

const HearingsTab: React.FC<HearingsTabProps> = ({ courseId, lessons, isModeratorOnly, forLaggingStudents = false }) => {
  const { user } = useAuth();
  const [myGroup, setMyGroup] = useState<CourseGroupResponse | null>(null);
  const [allGroups, setAllGroups] = useState<CourseGroupResponse[]>([]);
  const [studentTopicTitle, setStudentTopicTitle] = useState('');
  const [studentTopicDesc, setStudentTopicDesc] = useState('');
  const [creatingMyGroup, setCreatingMyGroup] = useState(false);
  const [selectedClassmateIds, setSelectedClassmateIds] = useState<number[]>([]);
  const [peerHint, setPeerHint] = useState<string | null>(null);
  const [editingMyTopic, setEditingMyTopic] = useState(false);
  const [editTopicTitle, setEditTopicTitle] = useState('');
  const [editTopicDesc, setEditTopicDesc] = useState('');
  const [savingMyTopic, setSavingMyTopic] = useState(false);
  const [hearingLessons, setHearingLessons] = useState<CourseLessonResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeHearing, setActiveHearing] = useState<CourseLessonResponse | null>(null);

  // Student: lesson submissions + групповые слушания (hearing submissions)
  const [studentSubmissions, setStudentSubmissions] = useState<Map<number, LessonSubmissionResponse>>(new Map());
  const [studentHearingSubs, setStudentHearingSubs] = useState<Map<number, HearingSubmissionResponse>>(new Map());
  const [lessonCriteria, setLessonCriteria] = useState<Map<number, GradingCriterionResponse[]>>(new Map());
  const [file, setFile] = useState<File | null>(null);
  const [textContent, setTextContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [hearingComment, setHearingComment] = useState('');
  const [sendingHearingComment, setSendingHearingComment] = useState(false);

  // Moderator: hearing submissions (group-based)
  const [allSubmissions, setAllSubmissions] = useState<Map<number, HearingSubmissionResponse[]>>(new Map());
  const [moderatorStatusFilter, setModeratorStatusFilter] = useState<string>('ALL');
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<number | null>(null);

  // Moderator: group management
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [editingGroup, setEditingGroup] = useState<CourseGroupResponse | null>(null);
  const [groupTitle, setGroupTitle] = useState('');
  const [groupDesc, setGroupDesc] = useState('');
  const [groupSchoolId, setGroupSchoolId] = useState<number | ''>('');
  const [courseSchools, setCourseSchools] = useState<{ id: number; name: string }[]>([]);
  const [selectedStudents, setSelectedStudents] = useState<number[]>([]);
  const [savingGroup, setSavingGroup] = useState(false);

  // Пагинация для учеников школы (модератор) - клиентская
  const [studentsPage, setStudentsPage] = useState(0);
  const [studentsTotalPages, setStudentsTotalPages] = useState(0);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [allSchoolStudents, setAllSchoolStudents] = useState<{ id: number; nickname: string; first_name?: string; last_name?: string }[]>([]);

  // Пагинация для одноклассников (ученик) - клиентская
  const [peersPage, setPeersPage] = useState(0);
  const [peersTotalPages, setPeersTotalPages] = useState(0);
  const [peersLoading, setPeersLoading] = useState(false);
  const [allClassPeers, setAllClassPeers] = useState<GetAllUserResponse[]>([]);

  // Пагинация для групп (модератор) - клиентская
  const [groupsPage, setGroupsPage] = useState(0);
  const [groupsTotalPages, setGroupsTotalPages] = useState(0);
  const [allGroupsPaginated, setAllGroupsPaginated] = useState<CourseGroupResponse[]>([]);
  const GROUPS_PER_PAGE = 6;
  const [enrolledStudentIds, setEnrolledStudentIds] = useState<Set<number>>(new Set());
  const [loadingEnrolled, setLoadingEnrolled] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const hearings = lessons.filter(l => l.category === 'HEARING');
      hearings.sort((a, b) => a.order_number - b.order_number);
      setHearingLessons(hearings);
      setActiveHearing(prev => {
        if (prev && hearings.some(h => h.id === prev.id)) return prev;
        const first = hearings.find(h => !isHearingLockedForStudent(h, isModeratorOnly)) ?? hearings[0];
        return first ?? null;
      });

      const criteriaMap = new Map<number, GradingCriterionResponse[]>();
      await Promise.all(hearings.map(async (h) => {
        try { const r = await coursesApi.getLessonCriteria(h.id); criteriaMap.set(h.id, r.data ?? []); }
        catch { criteriaMap.set(h.id, []); }
      }));
      setLessonCriteria(criteriaMap);

      const [groupsRes, myGroupRes] = await Promise.all([
        courseGroupsApi.getGroups(courseId),
        isModeratorOnly ? Promise.resolve({ data: null }) : courseGroupsApi.getMyGroup(courseId),
      ]);
      const allGroupsData = groupsRes.data ?? [];
      setAllGroups(allGroupsData);
      setGroupsTotalPages(Math.ceil(allGroupsData.length / GROUPS_PER_PAGE));
      setAllGroupsPaginated(allGroupsData.slice(0, GROUPS_PER_PAGE));
      setMyGroup(myGroupRes.data);

      if (!isModeratorOnly) {
        const gid = myGroupRes.data?.id;
        const lessonMap = new Map<number, LessonSubmissionResponse>();
        const hearingMap = new Map<number, HearingSubmissionResponse>();
        await Promise.all(hearings.map(async (h) => {
          if (gid != null && h.category === 'HEARING') {
            try {
              const hr = await coursesApi.getMyHearingSubmission(h.id, gid);
              if (hr.data) hearingMap.set(h.id, hr.data);
            } catch { /* нет отправки по слушанию */ }
          }
          try {
            const r = await coursesApi.getMySubmission(h.id);
            if (r.data) lessonMap.set(h.id, r.data);
          } catch { /* нет работы как урок */ }
        }));
        setStudentHearingSubs(hearingMap);
        setStudentSubmissions(lessonMap);
      }

      if (isModeratorOnly) {
        const allSubsMap = new Map<number, HearingSubmissionResponse[]>();
        await Promise.all(hearings.map(async (h) => {
          try { const r = await coursesApi.getHearingSubmissions(h.id); if (r.data?.length) allSubsMap.set(h.id, r.data); }
          catch { /* empty */ }
        }));
        setAllSubmissions(allSubsMap);
        try { const r = await coursesApi.getCourseSchools(courseId); setCourseSchools(r.data ?? []); } catch {}
      }
    } catch {
      toast.error('Ошибка загрузки слушаний');
    } finally {
      setLoading(false);
    }
  }, [courseId, lessons, isModeratorOnly]);

  // Загрузка групп с клиентской пагинацией
  const loadGroupsPage = (pageNum: number) => {
    const start = pageNum * GROUPS_PER_PAGE;
    const end = start + GROUPS_PER_PAGE;
    setAllGroupsPaginated(allGroups.slice(start, end));
    setGroupsPage(pageNum);
  };

  // Загрузка учеников школы с пагинацией (для модератора)
  const loadSchoolStudents = async (schoolId: number, pageNum: number = 0) => {
    if (!schoolId) return;
    setStudentsLoading(true);
    try {
      const res = await accountsApi.getBySchool(schoolId, pageNum, 20);
      if (pageNum === 0) {
        setAllSchoolStudents(res.data.content);
      } else {
        setAllSchoolStudents(prev => [...prev, ...res.data.content]);
      }
      setStudentsTotalPages(res.data.total_pages);
      setStudentsPage(pageNum);
    } catch {
      toast.error('Ошибка загрузки учеников');
    } finally {
      setStudentsLoading(false);
    }
  };

  // Загрузка одноклассников с пагинацией (для ученика)
  const loadClassPeers = useCallback(async (classId: number, pageNum: number = 0) => {
    setPeersLoading(true);
    try {
      const res = await accountsApi.getByClass(classId, pageNum, 20);

      const hasEnrolledData = enrolledStudentIds.size > 0;

      const peers = (res.data.content ?? []).filter(
          u => u.role === 'Пользователь'
              && u.nickname !== user?.nickname
              // Для lagging-курса показываем только отстающих, для целевого - только не отстающих
              && (forLaggingStudents ? u.is_lagging === true : u.is_lagging !== true)
              && (!hasEnrolledData || enrolledStudentIds.has(u.id))
      );

      if (pageNum === 0) {
        setAllClassPeers(peers);
        if (peers.length === 0) {
          setPeerHint(forLaggingStudents
              ? 'Нет других отстающих одноклассников, зачисленных на этот курс.'
              : 'В классе нет других учеников, зачисленных на этот курс.');
        } else {
          setPeerHint(null);
        }
      } else {
        setAllClassPeers(prev => [...prev, ...peers]);
      }
      setPeersTotalPages(res.data.total_pages);
      setPeersPage(pageNum);
    } catch {
      toast.error('Ошибка загрузки одноклассников');
    } finally {
      setPeersLoading(false);
    }
  }, [enrolledStudentIds, user?.nickname, forLaggingStudents]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Загрузка одноклассников ученика
  useEffect(() => {
    if (isModeratorOnly || !user?.nickname) return;
    let cancelled = false;
    accountsApi.getAccount(user.nickname).then(res => {
      const cid = res.data.classId;
      if (cid == null) {
        if (!cancelled) {
          setAllClassPeers([]);
          setPeerHint('Укажите класс в профиле, чтобы пригласить одноклассников в группу.');
        }
        return;
      }
      // Ждём загрузки enrolledStudentIds перед фильтрацией одноклассников
      if (!cancelled) {
        // Небольшая задержка, чтобы enrolledStudentIds успел загрузиться
        setTimeout(() => {
          if (!cancelled) loadClassPeers(cid, 0);
        }, 300);
      }
    }).catch(() => {
      if (!cancelled) { setAllClassPeers([]); setPeerHint(null); }
    });
    return () => { cancelled = true; };
  }, [isModeratorOnly, user?.nickname, forLaggingStudents, enrolledStudentIds.size]); // ✅ добавить enrolledStudentIds.size

  // Загрузка учеников при выборе школы
  useEffect(() => {
    if (!groupSchoolId) {
      setAllSchoolStudents([]);
      return;
    }
    loadSchoolStudents(Number(groupSchoolId), 0);
  }, [groupSchoolId]);

  useEffect(() => {
    setSelectedSubmissionId(null);
  }, [activeHearing?.id]);

  useEffect(() => {
    if (myGroup) {
      setEditTopicTitle(myGroup.title);
      setEditTopicDesc(myGroup.description ?? '');
    } else {
      setEditingMyTopic(false);
    }
  }, [myGroup?.id, myGroup?.title, myGroup?.description]);


  const handleCreateMyGroup = async () => {
    const t = studentTopicTitle.trim();
    if (!t) return toast.error('Введите тему');

    // Проверяем, не занята ли тема другой группой
    const takenTitles = new Set(allGroups.map(g => g.title.trim().toLowerCase()));
    if (takenTitles.has(t.toLowerCase())) {
      return toast.error('Эта тема уже выбрана другой группой. Пожалуйста, придумайте другое название.');
    }

    setCreatingMyGroup(true);
    try {
      const r = await courseGroupsApi.createMyGroup(courseId, {
        title: t,
        ...(studentTopicDesc.trim() ? { description: studentTopicDesc.trim() } : {}),
        ...(selectedClassmateIds.length > 0 ? { classmate_account_ids: selectedClassmateIds } : {}),
      });
      setMyGroup(r.data);
      setSelectedClassmateIds([]);
      toast.success('Тема сохранена');
      await fetchData();
    } catch (err: any) {
      const d = err.response?.data;
      const msg =
          typeof d === 'string'
              ? d
              : d?.message ?? d?.error ?? (Array.isArray(d?.errors) ? String(d.errors[0]) : null) ?? 'Ошибка сохранения';
      toast.error(msg);
    } finally {
      setCreatingMyGroup(false);
    }
  };

  const handleSaveMyTopic = async () => {
    if (!myGroup) return;
    const t = editTopicTitle.trim();
    if (!t) {
      toast.error('Введите название темы');
      return;
    }
    setSavingMyTopic(true);
    try {
      const r = await courseGroupsApi.updateMyGroupTopic(courseId, myGroup.id, {
        title: t,
        description: editTopicDesc.trim() || undefined,
      });
      setMyGroup(r.data);
      setEditingMyTopic(false);
      toast.success('Тема обновлена');
      await fetchData();
    } catch (err: any) {
      const d = err.response?.data;
      const msg =
          typeof d === 'string'
              ? d
              : d?.message ?? d?.error ?? (Array.isArray(d?.errors) ? String(d.errors[0]) : null) ?? 'Ошибка сохранения';
      toast.error(msg);
    } finally {
      setSavingMyTopic(false);
    }
  };

  const handleSubmit = async () => {
    if (!activeHearing || !myGroup) return;
    setSubmitting(true);
    try {
      if (activeHearing.category === 'HEARING') {
        const existing = studentHearingSubs.get(activeHearing.id);
        if (existing) {
          await coursesApi.resubmitHearing(activeHearing.id, myGroup.id, file ?? undefined);
          toast.success('Работа обновлена');
        } else {
          await coursesApi.submitHearing(activeHearing.id, myGroup.id, file ?? undefined);
          toast.success('Работа отправлена');
        }
      } else {
        const fd = new FormData();
        if (textContent) fd.append('text_content', textContent);
        if (file) fd.append('file', file);
        const activeLessonSub = studentSubmissions.get(activeHearing.id);
        if (activeLessonSub) {
          await coursesApi.updateSubmission(activeHearing.id, fd);
          toast.success('Работа обновлена');
        } else {
          await coursesApi.submitWork(activeHearing.id, fd);
          toast.success('Работа отправлена');
        }
      }
      setFile(null); setTextContent('');
      fetchData();
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Ошибка отправки');
    } finally { setSubmitting(false); }
  };

  const handleReview = async (submissionId: number, comment: string, grade: number | null, status: string) => {
    try {
      await coursesApi.reviewHearing(submissionId, comment, grade, status);
      toast.success('Рецензия сохранена');
      fetchData();
    } catch (err: any) {
      const d = err.response?.data;
      const msg =
          typeof d === 'string'
              ? d
              : d?.message ?? d?.error ?? (Array.isArray(d?.errors) ? String(d.errors[0]) : null) ?? 'Ошибка';
      toast.error(msg);
    }
  };

  const handleSendHearingComment = async () => {
    const h = activeHearingSub;
    if (!h) return;
    const trimmed = hearingComment.trim();
    if (!trimmed) return;
    setSendingHearingComment(true);
    try {
      const r = await coursesApi.addHearingComment(h.id, trimmed);
      setStudentHearingSubs((prev) => {
        const next = new Map(prev);
        next.set(activeHearing!.id, r.data);
        return next;
      });
      setHearingComment('');
      toast.success('Комментарий отправлен');
    } catch (err: any) {
      const d = err.response?.data;
      const msg =
          typeof d === 'string'
              ? d
              : d?.message ?? d?.error ?? (Array.isArray(d?.errors) ? String(d.errors[0]) : null) ?? 'Ошибка';
      toast.error(msg);
    } finally {
      setSendingHearingComment(false);
    }
  };

  const assignedStudentIds = useMemo(() => {
    const ids = new Set<number>();
    allGroups.forEach(g => {
      if (editingGroup && g.id === editingGroup.id) return;
      g.members.forEach(m => ids.add(m.account_id));
    });
    return ids;
  }, [allGroups, editingGroup]);

  const handleSaveGroup = async () => {
    if (!groupTitle.trim()) { toast.error('Введите название группы'); return; }
    if (!groupSchoolId) { toast.error('Выберите школу'); return; }
    if (selectedStudents.length === 0) { toast.error('Выберите хотя бы одного ученика'); return; }
    setSavingGroup(true);
    try {
      if (editingGroup) {
        await courseGroupsApi.updateGroup(courseId, editingGroup.id, { title: groupTitle, description: groupDesc || undefined, student_ids: selectedStudents });
        toast.success('Группа обновлена');
      } else {
        await courseGroupsApi.createGroup(courseId, { title: groupTitle, description: groupDesc || undefined, school_id: Number(groupSchoolId), student_ids: selectedStudents });
        toast.success('Группа создана, тема автоматически отправлена на проверку');
      }
      setShowGroupForm(false); setEditingGroup(null);
      setGroupTitle(''); setGroupDesc(''); setGroupSchoolId(''); setSelectedStudents([]);
      // Обновляем список групп
      const groupsRes = await courseGroupsApi.getGroups(courseId);
      const allGroupsData = groupsRes.data ?? [];
      setAllGroups(allGroupsData);
      setGroupsTotalPages(Math.ceil(allGroupsData.length / GROUPS_PER_PAGE));
      setAllGroupsPaginated(allGroupsData.slice(0, GROUPS_PER_PAGE));
      setGroupsPage(0);
      fetchData();
    } catch (err: any) { toast.error(err.response?.data?.message ?? 'Ошибка'); }
    finally { setSavingGroup(false); }
  };
  const loadEnrolledStudents = useCallback(async () => {
    setLoadingEnrolled(true);
    try {
      const summary = await coursesApi.getCourseSummary(courseId);
      const enrolledIds = new Set<number>();
      summary.data.students.forEach(s => {
        if (s.account_id) {
          enrolledIds.add(s.account_id);
        }
      });
      setEnrolledStudentIds(enrolledIds);
    } catch (error) {
      console.error('Ошибка загрузки зачисленных учеников:', error);
      // В случае ошибки показываем всех (не фильтруем)
      setEnrolledStudentIds(new Set());
    } finally {
      setLoadingEnrolled(false);
    }
  }, [courseId]);

  const openEditGroup = (g: CourseGroupResponse) => {
    setEditingGroup(g);
    setGroupTitle(g.title);
    setGroupDesc(g.description ?? '');
    setGroupSchoolId(g.school_id);
    setSelectedStudents(g.members.map(m => m.account_id));
    setShowGroupForm(true);
  };
  // Добавить useEffect для загрузки при монтировании (после других useEffect)
  useEffect(() => {
    if (!isModeratorOnly && courseId) {
      loadEnrolledStudents();
    }
  }, [isModeratorOnly, courseId, loadEnrolledStudents]);

  if (loading) {
    return <div className="space-y-4">{[1, 2, 3].map(i => <div key={i} className="h-20 bg-muted rounded-2xl animate-pulse" />)}</div>;
  }

  const activeHearingSub = activeHearing ? studentHearingSubs.get(activeHearing.id) : undefined;
  const activeLessonSub = activeHearing ? studentSubmissions.get(activeHearing.id) : null;
  const activeCriteria = activeHearing ? (lessonCriteria.get(activeHearing.id) ?? []) : [];
  return (
      <div className="space-y-6">
        {/* Moderator: manage groups */}
        {isModeratorOnly && (
            <div className="bg-card rounded-2xl border border-border p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Users className="size-4 text-primary" /> Группы ({allGroups.length})
                </h3>
                <div className="flex items-center gap-2">
                  {groupsTotalPages > 1 && (
                      <div className="flex gap-1">
                        <button
                            type="button"
                            onClick={() => loadGroupsPage(groupsPage - 1)}
                            disabled={groupsPage === 0}
                            className="px-2 py-1 text-xs border border-border rounded hover:bg-muted disabled:opacity-50"
                        >
                          ←
                        </button>
                        <span className="text-xs text-muted-foreground px-2 py-1">
                        {groupsPage + 1} / {groupsTotalPages}
                      </span>
                        <button
                            type="button"
                            onClick={() => loadGroupsPage(groupsPage + 1)}
                            disabled={groupsPage + 1 >= groupsTotalPages}
                            className="px-2 py-1 text-xs border border-border rounded hover:bg-muted disabled:opacity-50"
                        >
                          →
                        </button>
                      </div>
                  )}
                  <button
                      onClick={() => { setShowGroupForm(true); setEditingGroup(null); setGroupTitle(''); setGroupDesc(''); setGroupSchoolId(''); setSelectedStudents([]); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-primary/10 text-primary rounded-lg hover:bg-primary/15 transition-colors"
                  >
                    <Plus className="size-3.5" /> Создать группу
                  </button>
                </div>
              </div>
              {allGroupsPaginated.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">Нет созданных групп</div>
              ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {allGroupsPaginated.map(g => {
                      const now = new Date();
                      const missedDeadlines = hearingLessons.filter(hl => {
                        if (!hl.submission_deadline) return false;
                        if (new Date(hl.submission_deadline.includes('T') ? hl.submission_deadline : hl.submission_deadline.replace(' ', 'T')) > now) return false;
                        const subs = allSubmissions.get(hl.id) ?? [];
                        return !subs.some(s => s.group_id === g.id);
                      });
                      const topicApprovalMissed = missedDeadlines.filter(hl => hl.hearing_stage === 'TOPIC_APPROVAL');
                      const isLagging = topicApprovalMissed.length > 0;
                      return (
                          <div key={g.id} className={`border rounded-xl p-3 ${isLagging ? 'border-red-300 bg-red-50/30 dark:bg-red-950/10 dark:border-red-800' : 'border-border'}`}>
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-semibold text-foreground">{g.title}</p>
                                {isLagging && <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-700 rounded border border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800 font-semibold">отстающие</span>}
                              </div>
                              <button onClick={() => openEditGroup(g)} className="p-1 text-muted-foreground hover:text-primary"><Edit2 className="size-3.5" /></button>
                            </div>
                            <p className="text-xs text-muted-foreground mb-2">{g.school_name}</p>
                            {isLagging && (
                                <p className="text-[10px] text-red-600 dark:text-red-400 mb-2">
                                  Пропущено: {missedDeadlines.map(d => d.title).join(', ')}
                                </p>
                            )}
                            <div className="flex flex-wrap gap-1">
                              {g.members.map(m => (
                                  <span key={m.id} className={`text-[10px] px-1.5 py-0.5 rounded border ${m.is_owner ? 'bg-primary/10 text-primary border-primary/20' : 'bg-muted text-muted-foreground border-border'}`}>
                              {m.last_name} {m.first_name}
                            </span>
                              ))}
                            </div>
                          </div>
                      );
                    })}
                  </div>
              )}
              {groupsTotalPages > 1 && (
                  <div className="flex justify-center gap-1 pt-2">
                    <button
                        type="button"
                        onClick={() => loadGroupsPage(groupsPage - 1)}
                        disabled={groupsPage === 0}
                        className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-muted disabled:opacity-50"
                    >
                      ← Предыдущая
                    </button>
                    <span className="px-3 py-1.5 text-xs text-muted-foreground">
                    Страница {groupsPage + 1} из {groupsTotalPages}
                  </span>
                    <button
                        type="button"
                        onClick={() => loadGroupsPage(groupsPage + 1)}
                        disabled={groupsPage + 1 >= groupsTotalPages}
                        className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-muted disabled:opacity-50"
                    >
                      Следующая →
                    </button>
                  </div>
              )}
              {showGroupForm && (
                  <div className="border border-primary/30 rounded-xl p-4 space-y-3 bg-primary/5">
                    <p className="text-sm font-semibold text-foreground">{editingGroup ? 'Редактировать группу' : 'Новая группа'}</p>
                    <input value={groupTitle} onChange={e => setGroupTitle(e.target.value)} placeholder="Название группы (тема проекта)" className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background focus:ring-2 focus:ring-primary outline-none" />
                    <textarea value={groupDesc} onChange={e => setGroupDesc(e.target.value)} placeholder="Описание (необязательно)" rows={2} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background resize-none focus:ring-2 focus:ring-primary outline-none" />
                    {!editingGroup && (
                        <select value={groupSchoolId} onChange={e => setGroupSchoolId(e.target.value ? Number(e.target.value) : '')} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background focus:ring-2 focus:ring-primary outline-none">
                          <option value="">Выберите школу</option>
                          {courseSchools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                    )}
                    {(groupSchoolId || editingGroup) && (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-medium text-muted-foreground">
                              Ученики ({selectedStudents.length} выбрано из {allSchoolStudents.length})
                            </p>
                            {studentsTotalPages > 1 && studentsPage + 1 < studentsTotalPages && (
                                <button
                                    type="button"
                                    onClick={() => loadSchoolStudents(Number(groupSchoolId), studentsPage + 1)}
                                    disabled={studentsLoading}
                                    className="text-[10px] text-primary hover:underline"
                                >
                                  {studentsLoading ? 'Загрузка...' : 'Загрузить ещё'}
                                </button>
                            )}
                          </div>
                          <div className="max-h-48 overflow-y-auto border border-border rounded-lg divide-y divide-border">
                            {allSchoolStudents.map(st => {
                              const taken = assignedStudentIds.has(st.id);
                              const memberGroup = taken ? allGroups.find(g => g.members.some(m => m.account_id === st.id)) : null;
                              const topicSub = memberGroup
                                  ? allSubmissions.get(
                                      hearingLessons.find(hl => hl.hearing_stage === 'TOPIC_APPROVAL')?.id ?? -1
                                  )?.find(s => s.group_id === memberGroup.id)
                                  : null;
                              const groupStatusLabel = taken
                                  ? (topicSub?.status === 'ON_REVIEW' ? 'На проверке' :
                                      topicSub?.status === 'ACCEPTED' ? 'Принято' :
                                          topicSub?.status === 'NEEDS_REVISION' ? 'На доработку' :
                                              'уже в группе')
                                  : null;
                              return (
                                  <label key={st.id} className={`flex items-center gap-2 px-3 py-2 text-sm ${taken ? 'opacity-50 cursor-not-allowed bg-muted/30' : 'hover:bg-muted/50 cursor-pointer'}`}>
                                    <input type="checkbox" disabled={taken} checked={selectedStudents.includes(st.id)} onChange={e => { if (e.target.checked) setSelectedStudents(p => [...p, st.id]); else setSelectedStudents(p => p.filter(x => x !== st.id)); }} className="accent-primary rounded" />
                                    <span>{st.last_name} {st.first_name}</span>
                                    {taken
                                        ? <span className={`text-[10px] ml-auto ${topicSub?.status === 'ON_REVIEW' ? 'text-yellow-600' : topicSub?.status === 'ACCEPTED' ? 'text-emerald-600' : 'text-amber-600'}`}>{groupStatusLabel}</span>
                                        : <span className="text-xs text-muted-foreground ml-auto">@{st.nickname}</span>}
                                  </label>
                              );
                            })}
                            {studentsLoading && allSchoolStudents.length === 0 && (
                                <div className="px-3 py-4 text-center text-xs text-muted-foreground">Загрузка учеников...</div>
                            )}
                            {!studentsLoading && allSchoolStudents.length === 0 && (
                                <p className="px-3 py-2 text-xs text-muted-foreground">Нет учеников{!groupSchoolId && !editingGroup ? ' (выберите школу)' : ''}</p>
                            )}
                          </div>
                        </div>
                    )}
                    <div className="flex gap-2">
                      <button onClick={handleSaveGroup} disabled={savingGroup} className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:opacity-90 transition-colors disabled:opacity-50">
                        <Save className="size-3.5" /> {savingGroup ? 'Сохранение...' : 'Сохранить'}
                      </button>
                      <button onClick={() => { setShowGroupForm(false); setEditingGroup(null); }} className="flex items-center gap-1.5 px-4 py-2 border border-border text-sm font-semibold rounded-lg hover:bg-muted transition-colors">
                        <X className="size-3.5" /> Отмена
                      </button>
                    </div>
                  </div>
              )}
            </div>
        )}

        {/* Student: my group */}
        {!isModeratorOnly && (
            <div className="bg-card rounded-2xl border border-border p-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
                <Users className="size-4 text-primary" /> Моя группа
              </h3>
              {myGroup ? (
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        {!editingMyTopic ? (
                            <>
                              <p className="text-lg font-bold text-foreground">{myGroup.title}</p>
                              {myGroup.description && <p className="text-sm text-muted-foreground mt-1">{myGroup.description}</p>}
                            </>
                        ) : (
                            <div className="space-y-2">
                              <input
                                  value={editTopicTitle}
                                  onChange={(e) => setEditTopicTitle(e.target.value)}
                                  className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-card font-bold"
                              />
                              <textarea
                                  value={editTopicDesc}
                                  onChange={(e) => setEditTopicDesc(e.target.value)}
                                  rows={2}
                                  className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-card resize-none"
                                  placeholder="Описание (необязательно)"
                              />
                            </div>
                        )}
                      </div>
                      {!editingMyTopic ? (
                          <button
                              type="button"
                              onClick={() => setEditingMyTopic(true)}
                              className="shrink-0 px-3 py-2 text-xs font-semibold rounded-xl border border-border bg-muted/50 hover:bg-muted transition-colors"
                          >
                            Изменить тему
                          </button>
                      ) : (
                          <div className="shrink-0 flex flex-col gap-2">
                            <button
                                type="button"
                                onClick={handleSaveMyTopic}
                                disabled={savingMyTopic}
                                className="px-3 py-2 text-xs font-semibold rounded-xl bg-primary text-primary-foreground disabled:opacity-50"
                            >
                              {savingMyTopic ? '...' : 'Сохранить'}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                  setEditingMyTopic(false);
                                  setEditTopicTitle(myGroup.title);
                                  setEditTopicDesc(myGroup.description ?? '');
                                }}
                                className="px-3 py-2 text-xs font-medium rounded-xl border border-border"
                            >
                              Отмена
                            </button>
                          </div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 mt-3">
                      {myGroup.members.map(m => (
                          <span key={m.id} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs border ${m.is_owner ? 'bg-primary/10 text-primary border-primary/20 font-semibold' : 'bg-muted text-muted-foreground border-border'}`}>
                      {m.last_name} {m.first_name}
                    </span>
                      ))}
                    </div>
                  </div>
              ) : (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground">Создать тему</p>
                      <input
                          value={studentTopicTitle}
                          onChange={(e) => setStudentTopicTitle(e.target.value)}
                          placeholder="Тема проекта"
                          className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-card focus:ring-2 focus:ring-primary outline-none"
                      />
                      {studentTopicTitle.trim() && allGroups.some(g => g.title.trim().toLowerCase() === studentTopicTitle.trim().toLowerCase()) && (
                          <p className="text-xs text-red-500 flex items-center gap-1">
                            <AlertCircle className="size-3.5 shrink-0" />
                            Эта тема уже выбрана другой группой
                          </p>
                      )}
                      <textarea
                          value={studentTopicDesc}
                          onChange={(e) => setStudentTopicDesc(e.target.value)}
                          placeholder="Описание (необязательно)"
                          rows={2}
                          className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-card focus:ring-2 focus:ring-primary outline-none resize-none"
                      />
                      {allClassPeers.length > 0 && (
                          <div className="rounded-xl border border-border bg-muted/15 p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-semibold text-muted-foreground">
                                Одноклассники в группу ({selectedClassmateIds.length} выбрано из {allClassPeers.length})
                              </p>
                              {peersTotalPages > 1 && peersPage + 1 < peersTotalPages && (
                                  <button
                                      type="button"
                                      onClick={() => {
                                        accountsApi.getAccount(user!.nickname).then(res => {
                                          const cid = res.data.classId;
                                          if (cid) loadClassPeers(cid, peersPage + 1);
                                        });
                                      }}
                                      disabled={peersLoading}
                                      className="text-[10px] text-primary hover:underline"
                                  >
                                    {peersLoading ? 'Загрузка...' : 'Загрузить ещё'}
                                  </button>
                              )}
                            </div>
                            <div className="max-h-40 overflow-y-auto space-y-1.5">
                              {allClassPeers.map(p => (
                                  <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/40 rounded-lg px-2 py-1">
                                    <input
                                        type="checkbox"
                                        checked={selectedClassmateIds.includes(p.id)}
                                        onChange={(e) => {
                                          if (e.target.checked) setSelectedClassmateIds(x => [...x, p.id]);
                                          else setSelectedClassmateIds(x => x.filter(id => id !== p.id));
                                        }}
                                    />
                                    <span>{p.last_name ?? ''} {p.first_name ?? ''}</span>
                                    <span className="text-xs text-muted-foreground ml-auto">@{p.nickname}</span>
                                  </label>
                              ))}
                              {peersLoading && allClassPeers.length === 0 && (
                                  <div className="px-3 py-4 text-center text-xs text-muted-foreground">Загрузка учеников...</div>
                              )}
                            </div>
                          </div>
                      )}
                      {peerHint && allClassPeers.length === 0 && (
                          <p className="text-[11px] text-muted-foreground leading-relaxed">{peerHint}</p>
                      )}
                      <button
                          type="button"
                          onClick={handleCreateMyGroup}
                          disabled={creatingMyGroup}
                          className="w-full py-2.5 bg-primary/10 text-primary text-sm font-semibold rounded-xl hover:bg-primary/15 disabled:opacity-50 border border-primary/20 transition-colors"
                      >
                        {creatingMyGroup ? 'Сохранение...' : 'Сохранить тему'}
                      </button>
                    </div>
                  </div>
              )}
            </div>
        )}

        {hearingLessons.length === 0 ? (
            <div className="bg-card rounded-2xl border border-border p-10 text-center text-muted-foreground">
              <Presentation className="size-10 mx-auto mb-3 opacity-30" />
              <p>Слушания пока не созданы для этого курса</p>
            </div>
        ) : (
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              {/* Sidebar: hearing lesson list */}
              <div className="lg:col-span-1 bg-card rounded-2xl border border-border overflow-hidden self-start sticky top-24">
                <div className="px-4 py-3 border-b border-border bg-muted/30">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Этапы слушаний</p>
                </div>
                <div className="divide-y divide-border max-h-[60vh] overflow-y-auto">
                  {hearingLessons.map((hl, idx) => {
                    const hSub = studentHearingSubs.get(hl.id);
                    const lSub = studentSubmissions.get(hl.id);
                    const done = hSub?.status === 'ACCEPTED' || lSub?.status === 'ACCEPTED';
                    const isActive = activeHearing?.id === hl.id;
                    const locked = isHearingLockedForStudent(hl, isModeratorOnly);
                    return (
                        <button key={hl.id} type="button" onClick={() => setActiveHearing(hl)} className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-all ${isActive ? 'bg-primary/10 border-l-2 border-l-primary' : 'hover:bg-muted/50 border-l-2 border-l-transparent'} ${locked ? 'opacity-80' : ''}`}>
                      <span className={`size-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${done ? 'bg-emerald-100 text-emerald-800' : (hSub ?? lSub) ? 'bg-yellow-100 text-yellow-800' : 'bg-muted text-muted-foreground'}`}>
                        {done ? '✓' : idx + 1}
                      </span>
                          <div className="flex-1 min-w-0">
                            <span className={`text-sm font-medium truncate block ${isActive ? 'text-primary' : 'text-foreground'}`}>{hl.title}</span>
                            {hl.hearing_stage && <span className="text-[10px] text-muted-foreground">{HEARING_STAGE_LABELS[hl.hearing_stage] ?? hl.hearing_stage}</span>}
                            {hl.submission_deadline && (() => {
                              const dl = new Date(hl.submission_deadline.includes('T') ? hl.submission_deadline : hl.submission_deadline.replace(' ', 'T'));
                              const passed = Date.now() > dl.getTime();
                              const done2 = studentHearingSubs.get(hl.id)?.status === 'ACCEPTED' || studentSubmissions.get(hl.id)?.status === 'ACCEPTED';
                              return (
                                  <span className={`text-[10px] font-medium ${passed && !done2 ? 'text-destructive' : 'text-amber-600 dark:text-amber-400'}`}>
                                  {passed && !done2 ? '⏰ Истёк' : `⏰ до ${dl.toLocaleDateString('ru', { day: '2-digit', month: '2-digit' })} ${dl.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}`}
                                </span>
                              );
                            })()}
                          </div>
                          {locked && <Lock className="size-3.5 text-amber-600 shrink-0" aria-hidden />}
                        </button>
                    );
                  })}
                </div>
              </div>

              {/* Content area */}
              <div className="lg:col-span-3 space-y-5">
                {activeHearing ? (
                    <>
                      {/* Hearing lesson info */}
                      <div className="bg-card rounded-2xl border border-border p-5">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            {activeHearing.hearing_stage && <p className="text-xs text-primary font-semibold mb-1">{HEARING_STAGE_LABELS[activeHearing.hearing_stage]}</p>}
                            <h3 className="text-lg font-bold text-foreground">{activeHearing.title}</h3>
                          </div>
                          <span className="text-xs text-muted-foreground px-2 py-1 bg-muted rounded-lg">Макс. {activeHearing.max_score ?? 100} баллов</span>
                        </div>
                        {activeHearing.practice_description && (
                            <p className="text-sm text-muted-foreground whitespace-pre-line mb-3">
                              {activeHearing.practice_description}
                            </p>
                        )}
                        {activeHearing.submission_deadline && (() => {
                          const dl = new Date(activeHearing.submission_deadline.includes('T') ? activeHearing.submission_deadline : activeHearing.submission_deadline.replace(' ', 'T'));
                          const passed = Date.now() > dl.getTime();
                          const isAccepted = activeHearingSub?.status === 'ACCEPTED';
                          return (
                              <div className={`rounded-xl px-3 py-2 mb-2 text-xs border flex items-center gap-2 ${passed && !isAccepted ? 'bg-destructive/10 border-destructive/30 text-destructive' : 'bg-amber-500/10 border-amber-500/30 text-amber-900 dark:text-amber-200'}`}>
                                <span className="shrink-0">⏰</span>
                                {passed && !isAccepted
                                    ? 'Срок сдачи истёк'
                                    : <>Срок сдачи: {dl.toLocaleString('ru', { dateStyle: 'short', timeStyle: 'short' })}</>
                                }
                              </div>
                          );
                        })()}
                        {activeCriteria.length > 0 && (
                            <div className="border-t border-border pt-3">
                              <p className="text-xs font-semibold text-muted-foreground mb-2">Критерии оценивания:</p>
                              <div className="space-y-1">
                                {activeCriteria.map(c => (
                                    <div key={c.id} className="flex items-center justify-between text-sm">
                                      <span className="text-foreground">{c.name}</span>
                                      <span className="text-xs text-muted-foreground">до {c.max_points} баллов</span>
                                    </div>
                                ))}
                              </div>
                            </div>
                        )}
                      </div>

                      {/* Student: submit work */}
                      {!isModeratorOnly && (() => {
                        const lockedForStudent = isHearingLockedForStudent(activeHearing, isModeratorOnly);
                        const h = activeHearingSub;
                        const l = activeLessonSub;
                        const isHear = activeHearing.category === 'HEARING';
                        const accepted = (isHear && h?.status === 'ACCEPTED') || (!isHear && l?.status === 'ACCEPTED');

                        if (lockedForStudent) {
                          return (
                              <div className="bg-card rounded-2xl border border-amber-200 dark:border-amber-900/40 p-5 flex gap-3 items-start">
                                <Lock className="size-5 text-amber-600 shrink-0 mt-0.5" aria-hidden />
                                <div>
                                  <p className="text-sm font-semibold text-foreground">Этап слушания пока недоступен</p>
                                  <p className="text-sm text-muted-foreground mt-1">Модератор откроет этот этап, когда придёт время. Описание и критерии вы можете посмотреть выше.</p>
                                </div>
                              </div>
                          );
                        }

                        return (
                            <div className="bg-card rounded-2xl border border-border p-5 space-y-3">
                              {activeHearing.hearing_stage === 'TOPIC_APPROVAL' && myGroup && (
                                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 mb-1">
                                    <p className="text-xs font-semibold text-primary">Тема проекта (выбрана группой)</p>
                                    <p className="text-lg font-bold text-foreground mt-1">{myGroup.title}</p>
                                    {myGroup.description && <p className="text-sm text-muted-foreground mt-1">{myGroup.description}</p>}
                                    {h && (
                                        <p className="text-xs text-muted-foreground mt-2">
                                          Статус темы на слушании: <span className="font-medium text-foreground">{hearingStatusConfig[h.status]?.label ?? h.status}</span>
                                        </p>
                                    )}
                                  </div>
                              )}
                              <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                                <Send className="size-4 text-primary" />
                                {h || l ? 'Ваша работа' : 'Отправить работу'}
                              </h4>
                              {isHear && h && (
                                  <div className="space-y-2">
                                    <div className="flex items-center gap-2 flex-wrap">
                              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs border ${hearingStatusConfig[h.status]?.color ?? ''}`}>
                                {hearingStatusConfig[h.status]?.label ?? h.status}
                              </span>
                                    </div>
                                    {h.file_name && (
                                        <button type="button" onClick={() => { if (h.file_name_in_directory && h.file_name) filesApi.downloadFile(h.file_name_in_directory, h.file_name); }}
                                                className="flex items-center gap-2 px-3 py-2 bg-primary/10 rounded-lg border border-primary/20 text-sm text-primary hover:bg-primary/15 transition-colors">
                                          <Download className="size-4" /> {h.file_name}
                                        </button>
                                    )}
                                    {h.reviews?.length > 0 && (
                                        <div className="text-xs text-muted-foreground space-y-1">
                                          {[...(h.reviews ?? [])]
                                              .sort((a, b) => new Date(a.reviewed_at.replace(' ', 'T')).getTime() - new Date(b.reviewed_at.replace(' ', 'T')).getTime())
                                              .map(r => (
                                                  <div key={r.id} className="bg-muted/50 rounded-lg p-2 border border-border">
                                                    <span className="font-medium">{r.moderator_name}</span>
                                                    {r.grade != null && <> — оценка {r.grade}</>}
                                                    {r.comment && <p className="mt-0.5">{r.comment}</p>}
                                                  </div>
                                              ))}
                                        </div>
                                    )}
                                    <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-2">
                                      <p className="text-xs font-semibold text-muted-foreground">Комментарий</p>
                                      <textarea
                                          value={hearingComment}
                                          onChange={(e) => setHearingComment(e.target.value)}
                                          placeholder="Напишите комментарий модератору..."
                                          rows={2}
                                          className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-card focus:ring-2 focus:ring-primary outline-none resize-none"
                                      />
                                      <button
                                          type="button"
                                          onClick={handleSendHearingComment}
                                          disabled={sendingHearingComment || !hearingComment.trim()}
                                          className="w-full py-2.5 bg-primary/10 text-primary text-sm font-semibold rounded-xl hover:bg-primary/15 disabled:opacity-50 border border-primary/20 transition-colors"
                                      >
                                        {sendingHearingComment ? 'Отправка...' : 'Отправить'}
                                      </button>
                                    </div>
                                  </div>
                              )}
                              {!isHear && l && (
                                  <div className="space-y-2">
                                    <div className="flex items-center gap-2 flex-wrap">
                              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs border ${hearingStatusConfig[l.status]?.color ?? statusConfig[l.status]?.color ?? ''}`}>
                                {hearingStatusConfig[l.status]?.label ?? statusConfig[l.status]?.label ?? l.status}
                              </span>
                                      {l.score != null && <span className="text-xs font-semibold text-foreground">{l.score}/{activeHearing.max_score ?? 100}</span>}
                                    </div>
                                    {l.file_name && (
                                        <button type="button" onClick={() => { if (l.file_name_in_directory && l.file_name) filesApi.downloadFile(l.file_name_in_directory, l.file_name); }}
                                                className="flex items-center gap-2 px-3 py-2 bg-primary/10 rounded-lg border border-primary/20 text-sm text-primary hover:bg-primary/15 transition-colors">
                                          <Download className="size-4" /> {l.file_name}
                                        </button>
                                    )}
                                    {l.text_content && <div className="bg-muted/50 rounded-lg p-3 text-sm border border-border whitespace-pre-wrap">{l.text_content}</div>}
                                    {l.reviewer_comment && (
                                        <div className="bg-muted/50 rounded-lg p-3 text-sm border border-border">
                                          <p className="text-xs font-semibold text-muted-foreground mb-1">Комментарий преподавателя:</p>
                                          <p>{l.reviewer_comment}</p>
                                        </div>
                                    )}
                                  </div>
                              )}
                              {!myGroup && isHear && (
                                  <p className="text-sm text-amber-700 dark:text-amber-300">Чтобы сдавать работы по слушаниям, дождитесь распределения в проектную группу.</p>
                              )}
                              {!accepted && myGroup && (
                                  <>
                                    {!isHear && (activeHearing.submission_type === 'TEXT' || activeHearing.submission_type === 'TEXT_AND_FILE') && (
                                        <textarea value={textContent} onChange={e => setTextContent(e.target.value)} rows={4} placeholder="Введите текст работы..." className="w-full border border-border rounded-xl px-4 py-3 text-sm bg-background resize-none focus:ring-2 focus:ring-primary outline-none" />
                                    )}
                                    {(isHear || activeHearing.submission_type === 'FILE' || activeHearing.submission_type === 'TEXT_AND_FILE') && (
                                        <div className="border-2 border-dashed border-border rounded-xl p-4 hover:border-primary/40 transition-colors">
                                          <input type="file" onChange={e => setFile(e.target.files?.[0] ?? null)} className="w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/15" />
                                          {file && <p className="text-xs text-primary mt-2">Выбран: {file.name}</p>}
                                        </div>
                                    )}
                                    <motion.button onClick={handleSubmit} disabled={submitting} whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }}
                                                   className="w-full py-3 bg-gradient-to-r from-primary to-primary/90 text-primary-foreground text-sm font-semibold rounded-xl transition-all disabled:opacity-50 shadow-md hover:opacity-95">
                                      {submitting ? 'Отправка...' : (isHear && h) ? 'Обновить работу' : 'Отправить работу'}
                                    </motion.button>
                                  </>
                              )}
                            </div>
                        );
                      })()}

                      {/* Moderator: review submissions */}
                      {isModeratorOnly && (
                          <div className="bg-card rounded-2xl border border-border p-5 space-y-4">
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                              <h4 className="text-sm font-semibold text-foreground">Работы групп</h4>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">Фильтр:</span>
                                <select
                                    value={moderatorStatusFilter}
                                    onChange={(e) => setModeratorStatusFilter(e.target.value)}
                                    className="border border-border rounded-lg px-2 py-1.5 text-xs bg-background"
                                >
                                  <option value="ALL">Все</option>
                                  <option value="ON_REVIEW">На проверке</option>
                                  <option value="ACCEPTED">Принято</option>
                                  <option value="NEEDS_REVISION">На доработку</option>
                                  <option value="REJECTED">Отклонено</option>
                                </select>
                              </div>
                            </div>

                            {(() => {
                              const subs = (allSubmissions.get(activeHearing.id) ?? []);
                              const filteredSubs = moderatorStatusFilter === 'ALL'
                                  ? subs
                                  : subs.filter(s => s.status === moderatorStatusFilter);
                              if (filteredSubs.length === 0) {
                                return <p className="text-sm text-muted-foreground">Пока нет работ по выбранному фильтру</p>;
                              }

                              const selected = selectedSubmissionId != null
                                  ? filteredSubs.find(s => s.id === selectedSubmissionId) ?? filteredSubs[0]
                                  : filteredSubs[0];
                              const selectedGroup = allGroups.find(g => g.id === selected.group_id);

                              return (
                                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                                    <div className="lg:col-span-1 space-y-2 max-h-[420px] overflow-y-auto pr-1">
                                      {filteredSubs.map(sub => {
                                        const g = allGroups.find(x => x.id === sub.group_id);
                                        const owner = g?.members.find(m => m.is_owner);
                                        const s = owner ?? g?.members[0];
                                        const senderLine = s ? `${s.last_name ?? ''} ${s.first_name ?? ''}`.trim() : '';
                                        return (
                                            <HearingSubmissionListItem
                                                key={sub.id}
                                                sub={sub}
                                                title={g?.title ?? `Группа #${sub.group_id}`}
                                                sender={senderLine || (g?.school_name ? g.school_name : '—')}
                                                selected={selectedSubmissionId === sub.id || (selectedSubmissionId == null && sub.id === selected.id)}
                                                onClick={() => setSelectedSubmissionId(sub.id)}
                                            />
                                        );
                                      })}
                                    </div>

                                    <div className="lg:col-span-2 space-y-3">
                                      <div className="rounded-xl border border-border bg-muted/20 p-4">
                                        <p className="text-xs font-semibold text-muted-foreground">Тема</p>
                                        <p className="text-lg font-bold text-foreground mt-1">{selectedGroup?.title ?? `Группа #${selected.group_id}`}</p>
                                        {selectedGroup?.description && (
                                            <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{selectedGroup.description}</p>
                                        )}
                                      </div>
                                      <HearingGroupReviewCard
                                          sub={selected}
                                          groupLabel={selectedGroup?.title ?? `Группа #${selected.group_id}`}
                                          groupDescription={selectedGroup?.description}
                                          membersLine={(selectedGroup?.members.map(m => `${m.last_name ?? ''} ${m.first_name ?? ''}`.trim()).filter(Boolean).join(', ') ?? '')}
                                          criteria={activeCriteria}
                                          onSend={handleReview}
                                      />
                                    </div>
                                  </div>
                              );
                            })()}
                          </div>
                      )}
                    </>
                ) : (
                    <div className="bg-card rounded-2xl border border-border p-10 text-center text-muted-foreground">
                      <Presentation className="size-8 mx-auto mb-2 opacity-40" />
                      <p className="text-sm">Выберите этап слушания</p>
                    </div>
                )}
              </div>
            </div>
        )}
      </div>
  );
};

/* ─── Lesson Content ─────────────────────────────────────────────────────── */

interface LessonContentProps {
  lesson: CourseLessonResponse;
  submission: LessonSubmissionResponse | null;
  criteria: GradingCriterionResponse[];
  activeTab: 'lecture' | 'practice';
  onTabChange: (tab: 'lecture' | 'practice') => void;
  onSubmissionUpdate: () => void;
}

const LessonContent: React.FC<LessonContentProps> = ({ lesson, submission, criteria, activeTab, onTabChange, onSubmissionUpdate }) => {
  const status = submission ? statusConfig[submission.status] : null;

  return (
      <motion.div key={lesson.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                  className="bg-card rounded-2xl border border-border overflow-hidden">
        {/* Lesson header */}
        <div className="px-6 py-5 border-b border-border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-semibold mb-1">Урок {lesson.order_number}</p>
              <h2 className="text-xl font-bold text-foreground">{lesson.title}</h2>
            </div>
            <div className="flex items-center gap-2">
              {submission?.score != null && (
                  <span className="flex items-center gap-1 px-3 py-1.5 bg-primary/10 text-primary rounded-lg text-sm font-semibold border border-primary/20">
                <Star className="size-3.5" /> {submission.score}/{lesson.max_score}
              </span>
              )}
              {status && (
                  <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border ${status.color}`}>
                {status.icon} {status.label}
              </span>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-5 bg-muted p-1 rounded-xl">
            <button
                onClick={() => onTabChange('lecture')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    activeTab === 'lecture' ? 'bg-card text-primary shadow-sm border border-border' : 'text-muted-foreground hover:text-foreground'
                }`}
            >
              <FileText className="size-4" /> Лекция
            </button>
            <button
                onClick={() => onTabChange('practice')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    activeTab === 'practice' ? 'bg-card text-primary shadow-sm border border-border' : 'text-muted-foreground hover:text-foreground'
                }`}
            >
              <Upload className="size-4" /> Практика
            </button>
          </div>
        </div>

        {/* Tab content */}
        <AnimatePresence mode="wait">
          {activeTab === 'lecture' ? (
              <motion.div key="lecture" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                          className="p-6 space-y-5">
                {/* Video embed */}
                {lesson.video_url && (
                    <div>
                      <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
                        <Play className="size-4 text-red-500" /> Видеоматериал
                      </h4>
                      <div className="aspect-video rounded-xl overflow-hidden bg-slate-900 border border-border">
                        <iframe
                            src={toEmbedUrl(lesson.video_url)}
                            className="w-full h-full"
                            allowFullScreen
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        />
                      </div>
                    </div>
                )}

                {/* Lecture text */}
                {lesson.lecture_content && (
                    <div>
                      <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
                        <FileText className="size-4 text-primary" /> Теоретический материал
                      </h4>
                      <div className="bg-muted/50 rounded-xl p-5 text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                        {lesson.lecture_content}
                      </div>
                    </div>
                )}

                {/* Lecture file */}
                {lesson.lecture_file_name && (
                    <div>
                      <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
                        <Paperclip className="size-4 text-primary" /> Прикреплённый материал
                      </h4>
                      <button
                          onClick={() => {
                            if (lesson.lecture_file_name_in_directory && lesson.lecture_file_name) {
                              filesApi.downloadFile(lesson.lecture_file_name_in_directory, lesson.lecture_file_name);
                            }
                          }}
                          className="flex items-center gap-3 px-4 py-3 bg-primary/10 rounded-xl border border-primary/20 hover:bg-primary/15 transition-colors"
                      >
                        <Download className="size-4 text-primary" />
                        <span className="text-sm font-medium text-primary">{lesson.lecture_file_name}</span>
                      </button>
                    </div>
                )}

                {!lesson.video_url && !lesson.lecture_content && !lesson.lecture_file_name && (
                    <div className="text-center py-10 text-muted-foreground">
                      <FileText className="size-8 mx-auto mb-2 opacity-40" />
                      <p className="text-sm">Лекционный материал пока не добавлен</p>
                    </div>
                )}
              </motion.div>
          ) : (
              <motion.div key="practice" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                          className="p-6 space-y-5">
                {/* Practice description */}
                {lesson.practice_description && (
                    <div>
                      <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
                        <Upload className="size-4 text-primary" /> Задание
                      </h4>
                      <div className="bg-primary/5 rounded-xl p-5 text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap border border-primary/15">
                        {lesson.practice_description}
                      </div>
                    </div>
                )}

                {/* Max score info */}
                {criteria.length > 0 ? (
                    <div className="bg-muted/40 rounded-xl border border-border p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Award className="size-4 text-primary" />
                        <span className="text-sm font-semibold text-foreground">Критерии оценивания</span>
                        <span className="ml-auto text-xs text-muted-foreground">
                    макс. {criteria.reduce((s, c) => s + c.max_points, 0)} баллов
                  </span>
                      </div>
                      <div className="space-y-1.5">
                        {criteria.map(c => (
                            <div key={c.id} className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">{c.order_number}. {c.name}</span>
                              <span className="text-muted-foreground/80 font-medium">0–{c.max_points}</span>
                            </div>
                        ))}
                      </div>
                    </div>
                ) : (
                    <div className="flex items-center gap-2 px-4 py-2 bg-muted/40 rounded-xl border border-border text-sm text-muted-foreground">
                      <Star className="size-4 text-destructive/80" />
                      Максимальный балл за задание: <span className="font-semibold text-foreground">{lesson.max_score}</span>
                    </div>
                )}

                {/* Criterion grades display */}
                {submission?.criterion_grades && submission.criterion_grades.length > 0 && (
                    <div>
                      <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
                        <Award className="size-4 text-primary" /> Оценка по критериям
                      </h4>
                      <div className="space-y-2">
                        {submission.criterion_grades.map(g => {
                          const pct = g.max_points > 0 ? (g.points / g.max_points) * 100 : 0;
                          return (
                              <motion.div
                                  key={g.id}
                                  initial={{ opacity: 0, x: -12 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  className="flex items-center gap-3 p-3 bg-muted/40 rounded-xl border border-border"
                              >
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-foreground">{g.criterion_name}</p>
                                  <div className="mt-1.5 w-full bg-muted rounded-full h-1.5 overflow-hidden">
                                    <motion.div
                                        initial={{ width: 0 }}
                                        animate={{ width: `${pct}%` }}
                                        transition={{ duration: 0.8, ease: 'easeOut' }}
                                        className={`h-1.5 rounded-full ${
                                            pct === 100 ? 'bg-emerald-500' : pct >= 50 ? 'bg-blue-500' : 'bg-amber-500'
                                        }`}
                                    />
                                  </div>
                                </div>
                                <span className={`text-sm font-bold shrink-0 ${
                                    pct === 100 ? 'text-emerald-600' : pct >= 50 ? 'text-blue-600' : 'text-amber-600'
                                }`}>
                          {g.points}/{g.max_points}
                        </span>
                              </motion.div>
                          );
                        })}
                        <div className="flex items-center justify-between px-3 py-2 bg-primary/10 rounded-xl border border-primary/20 mt-1">
                          <span className="text-sm font-semibold text-primary">Итого</span>
                          <span className="text-sm font-bold text-foreground">
                      {submission.criterion_grades.reduce((s, g) => s + g.points, 0)}/
                            {submission.criterion_grades.reduce((s, g) => s + g.max_points, 0)}
                    </span>
                        </div>
                      </div>
                    </div>
                )}

                {/* Submission form */}
                <SubmissionSection lesson={lesson} submission={submission} onUpdate={onSubmissionUpdate} />
              </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
  );
};

/* ─── Submission Section ──────────────────────────────────────────────────── */

interface SubmissionSectionProps {
  lesson: CourseLessonResponse;
  submission: LessonSubmissionResponse | null;
  onUpdate: () => void;
}

const submissionHistoryStatusRu = (s: string) => {
  if (s === 'ACCEPTED') return 'Принято';
  if (s === 'NEEDS_REVISION') return 'На доработку';
  return 'На проверке';
};

const SubmissionSection: React.FC<SubmissionSectionProps> = ({ lesson, submission, onUpdate }) => {
  const [textContent, setTextContent] = useState(submission?.text_content ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [reviewHistory, setReviewHistory] = useState<SubmissionReviewHistoryEntry[]>([]);
  const [studentComment, setStudentComment] = useState('');
  const [sendingStudentComment, setSendingStudentComment] = useState(false);
  const isAccepted = submission?.status === 'ACCEPTED';
  // Можно обновлять работу даже если она принята (для итерационного процесса с банком идей)
  const isUpdate = !!submission;

  const deadlineMs = lesson.submission_deadline
      ? new Date(
          lesson.submission_deadline.includes('T')
              ? lesson.submission_deadline
              : lesson.submission_deadline.replace(' ', 'T'),
      ).getTime()
      : null;
  const deadlineValid = deadlineMs != null && !Number.isNaN(deadlineMs);
  const deadlinePassed = deadlineValid && Date.now() > deadlineMs;

  useEffect(() => {
    setTextContent(submission?.text_content ?? '');
    setFile(null);
  }, [lesson.id, submission?.text_content]);

  useEffect(() => {
    if (!submission?.id) {
      setReviewHistory([]);
      return;
    }
    coursesApi
        .getSubmissionReviewHistory(submission.id)
        .then((r) => setReviewHistory(r.data ?? []))
        .catch(() => setReviewHistory([]));
  }, [submission?.id]);

  const reloadHistory = async () => {
    if (!submission?.id) return;
    try {
      const r = await coursesApi.getSubmissionReviewHistory(submission.id);
      setReviewHistory(r.data ?? []);
    } catch {
      // ignore
    }
  };

  const handleSendStudentComment = async () => {
    if (!submission?.id) return;
    const trimmed = studentComment.trim();
    if (!trimmed) return;
    setSendingStudentComment(true);
    try {
      await coursesApi.addSubmissionReviewReply(submission.id, trimmed);
      setStudentComment('');
      await reloadHistory();
      toast.success('Комментарий отправлен');
    } catch (err: any) {
      const d = err.response?.data;
      const msg =
          typeof d === 'string'
              ? d
              : d?.message ?? d?.error ?? (Array.isArray(d?.errors) ? String(d.errors[0]) : null) ?? 'Ошибка отправки';
      toast.error(msg);
    } finally {
      setSendingStudentComment(false);
    }
  };

  const handleSubmit = async () => {
    const needsText = lesson.submission_type === 'TEXT' || lesson.submission_type === 'TEXT_AND_FILE';
    const needsFile = lesson.submission_type === 'FILE' || lesson.submission_type === 'TEXT_AND_FILE';
    if (needsText && !textContent.trim()) return toast.error('Введите текстовый ответ');
    if (needsFile && !file && !submission?.file_name) return toast.error('Прикрепите файл');

    setSubmitting(true);
    try {
      const formData = new FormData();
      if (textContent.trim()) formData.append('text_content', textContent.trim());
      if (file) formData.append('file', file);

      if (isUpdate) {
        await coursesApi.updateSubmission(lesson.id, formData);
        toast.success('Работа обновлена');
      } else {
        await coursesApi.submitWork(lesson.id, formData);
        toast.success('Работа отправлена!');
      }
      setFile(null);
      setJustSubmitted(true);
      setTimeout(() => setJustSubmitted(false), 2000);
      onUpdate();
    } catch (err: any) {
      const d = err.response?.data;
      const msg =
          typeof d === 'string'
              ? d
              : d?.message ?? d?.error ?? (Array.isArray(d?.errors) ? String(d.errors[0]) : null) ?? 'Ошибка отправки';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
      <div className="bg-card rounded-xl border border-border p-5">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-4">
          <Send className="size-4 text-primary" />
          {submission ? 'Обновить работу' : 'Сдать работу'}
        </h4>

        {deadlineValid && (
            <div
                className={`rounded-xl px-3 py-2 mb-4 text-xs border ${
                    deadlinePassed && !isAccepted
                        ? 'bg-destructive/10 border-destructive/30 text-destructive'
                        : 'bg-amber-500/10 border-amber-500/30 text-amber-900 dark:text-amber-200'
                }`}
            >
              {deadlinePassed && !isAccepted ? (
                  <>Срок сдачи истёк. Отправка и обновление работы недоступны.</>
              ) : (
                  <>
                    Срок сдачи:{' '}
                    {new Date(
                        lesson.submission_deadline!.includes('T')
                            ? lesson.submission_deadline!
                            : lesson.submission_deadline!.replace(' ', 'T'),
                    ).toLocaleString('ru', { dateStyle: 'short', timeStyle: 'short' })}
                  </>
              )}
            </div>
        )}

        {submission && reviewHistory.length > 0 && (
            <div className="rounded-xl border border-border bg-muted/30 p-3 mb-4">
              <p className="text-xs font-semibold text-muted-foreground flex items-center gap-2 mb-2">
                <History className="size-3.5" /> История проверок
              </p>
              <ul className="space-y-2 max-h-48 overflow-y-auto text-xs">
                {reviewHistory.map((h) => (
                    <li key={h.id} className="rounded-lg border border-border bg-background/80 px-2.5 py-2">
                      <div className="flex justify-between gap-2 text-muted-foreground">
                        <span>{new Date(h.created_at.replace(' ', 'T')).toLocaleString('ru')}</span>
                        <span>{h.reviewer_nickname ?? '—'}</span>
                      </div>
                      <div className="text-foreground font-medium mt-0.5">{submissionHistoryStatusRu(h.status_after)}</div>
                      {h.score != null && <div className="text-foreground mt-0.5">Балл: {h.score}</div>}
                      {h.criterion_snapshot?.length > 0 && (
                          <ul className="mt-1 space-y-0.5 text-muted-foreground">
                            {h.criterion_snapshot.map((c) => (
                                <li key={c.criterion_id}>
                                  {c.criterion_name}: {c.points}/{c.max_points}
                                </li>
                            ))}
                          </ul>
                      )}
                      {h.reviewer_comment && (
                          <p className="mt-1 text-foreground whitespace-pre-wrap">{h.reviewer_comment}</p>
                      )}
                    </li>
                ))}
              </ul>
            </div>
        )}

        {submission?.reviewer_comment && (
            <div
                className={`rounded-xl p-4 mb-4 text-sm ${
                    submission.status === 'NEEDS_REVISION'
                        ? 'bg-red-100/80 border border-red-200 text-red-900 dark:bg-red-950/40 dark:text-red-200 dark:border-red-800'
                        : 'bg-emerald-100/80 border border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800'
                }`}
            >
              <span className="font-semibold">Комментарий проверяющего: </span>
              {submission.reviewer_comment}
            </div>
        )}

        {submission?.score != null && (
            <div className="flex items-center gap-2 px-4 py-2 mb-4 bg-primary/10 rounded-xl border border-primary/20">
              <Star className="size-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">
            Оценка: {submission.score}/{submission.max_score ?? lesson.max_score}
          </span>
            </div>
        )}

        {submission?.file_name && (
            <div className="flex items-center gap-2 mb-4 px-3 py-2.5 bg-muted/50 rounded-xl text-sm border border-border">
              <Paperclip className="size-4 text-muted-foreground" />
              <button
                  onClick={() => {
                    if (submission.file_name_in_directory && submission.file_name) {
                      filesApi.downloadFile(submission.file_name_in_directory, submission.file_name);
                    }
                  }}
                  className="text-primary hover:underline font-medium transition-colors"
              >
                {submission.file_name}
              </button>
            </div>
        )}

        {submission?.id && (
            <div className="rounded-xl border border-border bg-muted/20 p-4 mb-4 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">Комментарии</p>
              <textarea
                  value={studentComment}
                  onChange={(e) => setStudentComment(e.target.value)}
                  placeholder="Напишите комментарий (вопрос, уточнение, ответ на замечания)..."
                  rows={2}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 bg-card resize-none"
              />
              <button
                  type="button"
                  onClick={handleSendStudentComment}
                  disabled={sendingStudentComment || !studentComment.trim()}
                  className="w-full py-2.5 bg-primary/10 text-primary text-sm font-semibold rounded-xl hover:bg-primary/15 disabled:opacity-50 border border-primary/20 transition-colors"
              >
                {sendingStudentComment ? 'Отправка...' : 'Отправить комментарий'}
              </button>
            </div>
        )}

        {isAccepted && (
            <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800 px-4 py-3 flex items-center gap-2 text-sm text-emerald-800 dark:text-emerald-200">
              <CheckCircle className="size-4 shrink-0" />
              <span>Работа принята. Вы можете обновить её, но статус вернётся на «На проверке».</span>
            </div>
        )}
        <div className="space-y-3">
          {(lesson.submission_type === 'TEXT' || lesson.submission_type === 'TEXT_AND_FILE') && (
              <textarea
                  value={textContent}
                  onChange={e => setTextContent(e.target.value)}
                  rows={5}
                  disabled={deadlinePassed}
                  className="w-full border border-border rounded-xl px-4 py-3 text-sm resize-none focus:ring-2 focus:ring-primary focus:border-transparent outline-none bg-input-background transition-all disabled:opacity-60"
                  placeholder="Введите ваш ответ..."
              />
          )}

          {(lesson.submission_type === 'FILE' || lesson.submission_type === 'TEXT_AND_FILE') && (
              <div className="border-2 border-dashed border-border rounded-xl p-4 hover:border-primary/40 transition-colors">
                <input
                    type="file"
                    disabled={deadlinePassed}
                    onChange={e => setFile(e.target.files?.[0] ?? null)}
                    className="w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/15 disabled:opacity-60"
                />
                {file && <p className="text-xs text-primary mt-2">Выбран: {file.name}</p>}
              </div>
          )}

          <motion.button
              onClick={handleSubmit}
              disabled={submitting || justSubmitted || deadlinePassed}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              className={`w-full py-3 text-primary-foreground text-sm font-semibold rounded-xl transition-all disabled:opacity-50 shadow-md ${
                  justSubmitted
                      ? 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                      : 'bg-gradient-to-r from-primary to-primary/90 hover:opacity-95'
              }`}
          >
            {justSubmitted ? (
                <span className="flex items-center justify-center gap-2">
                <CheckCircle className="size-4" /> Отправлено!
              </span>
            ) : submitting ? (
                'Отправка...'
            ) : isUpdate ? (
                'Обновить работу'
            ) : (
                'Отправить работу'
            )}
          </motion.button>
        </div>
      </div>
  );
};

// ─── Course Summary Tab ──────────────────────────────────────────────────────

const CourseSummaryTab: React.FC<{ courseId: number }> = ({ courseId }) => {
  const [summary, setSummary] = useState<CourseSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    coursesApi.getCourseSummary(courseId)
        .then(r => setSummary(r.data))
        .catch(() => toast.error('Ошибка загрузки сводки'))
        .finally(() => setLoading(false));
  }, [courseId]);

  if (loading) {
    return <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-12 bg-muted rounded-xl animate-pulse" />)}</div>;
  }
  if (!summary || summary.students.length === 0) {
    return (
        <div className="bg-card rounded-2xl border border-border p-10 text-center text-muted-foreground">
          <Table2 className="size-10 mx-auto mb-3 opacity-30" />
          <p>Ни один ученик ещё не сдавал работы по этому курсу</p>
        </div>
    );
  }

  const regularLessons = summary.lessons.filter(l => l.category === 'LESSON');
  const hearingLessons = summary.lessons.filter(l => l.category === 'HEARING');

  const filtered = search
      ? summary.students.filter(s => {
        const q = search.toLowerCase();
        return (s.last_name?.toLowerCase().includes(q))
            || (s.first_name?.toLowerCase().includes(q))
            || s.nickname.toLowerCase().includes(q);
      })
      : summary.students;

  const scoreColor = (score: number | null, max: number) => {
    if (score == null) return '';
    const pct = max > 0 ? score / max : 0;
    if (pct >= 0.8) return 'text-emerald-700 bg-emerald-50';
    if (pct >= 0.5) return 'text-yellow-700 bg-yellow-50';
    return 'text-red-700 bg-red-50';
  };

  const statusBadge = (status: string | null) => {
    if (!status) return <span className="text-muted-foreground/40">—</span>;
    if (status === 'ACCEPTED') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-200 font-medium">Принято</span>;
    if (status === 'NEEDS_REVISION') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200 font-medium">Доработка</span>;
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-200 font-medium">Сдано</span>;
  };

  return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Поиск по ученику..."
                className="w-full border border-border rounded-xl pl-4 pr-4 py-2.5 text-sm bg-card focus:ring-2 focus:ring-primary outline-none"
            />
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">{filtered.length} учеников</span>
        </div>

        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
              <tr className="bg-muted/40 border-b border-border">
                <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground sticky left-0 bg-muted/40 z-10 min-w-[180px]">Ученик</th>
                {regularLessons.map(l => (
                    <th key={l.id} className="px-2 py-2.5 text-center font-medium text-muted-foreground min-w-[80px]" title={l.title}>
                      <div className="truncate max-w-[80px]">{l.title}</div>
                      <div className="text-[10px] opacity-60">/{l.max_score}</div>
                    </th>
                ))}
                {hearingLessons.map(l => (
                    <th key={l.id} className="px-2 py-2.5 text-center font-medium text-primary/70 min-w-[80px] bg-primary/5" title={l.title}>
                      <div className="truncate max-w-[80px]">{l.title}</div>
                      <div className="text-[10px] opacity-60">/{l.max_score}</div>
                    </th>
                ))}
                <th className="px-3 py-2.5 text-center font-bold text-foreground min-w-[70px]">Итого</th>
              </tr>
              </thead>
              <tbody>
              {filtered.map(s => {
                const maxTotal = summary.lessons.reduce((sum, l) => sum + (l.max_score ?? 0), 0);
                return (
                    <tr
                        key={s.account_id}
                        onClick={() => navigate(`/profile/${s.nickname}`)}
                        className="border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer"
                    >
                      <td className="px-3 py-2.5 sticky left-0 bg-card z-10">
                        <p className="font-medium text-foreground text-xs">{s.last_name} {s.first_name}</p>
                        <p className="text-[10px] text-muted-foreground">@{s.nickname}{s.class_name ? ` · ${s.class_name}` : ''}</p>
                      </td>
                      {regularLessons.map(l => {
                        const sc = s.scores.find(x => x.lesson_id === l.id);
                        return (
                            <td key={l.id} className="px-2 py-2.5 text-center">
                              {sc?.score != null ? (
                                  <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-semibold ${scoreColor(sc.score, l.max_score)}`}>
                              {sc.score}
                            </span>
                              ) : sc?.status ? (
                                  statusBadge(sc.status)
                              ) : (
                                  <span className="text-muted-foreground/30">—</span>
                              )}
                            </td>
                        );
                      })}
                      {hearingLessons.map(l => {
                        const sc = s.scores.find(x => x.lesson_id === l.id);
                        return (
                            <td key={l.id} className="px-2 py-2.5 text-center bg-primary/5">
                              {sc?.score != null ? (
                                  <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-semibold ${scoreColor(sc.score, l.max_score)}`}>
                              {sc.score}
                            </span>
                              ) : (
                                  statusBadge(sc?.status ?? null)
                              )}
                            </td>
                        );
                      })}
                      <td className="px-3 py-2.5 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-lg text-xs font-bold ${scoreColor(s.total_score, maxTotal)}`}>
                        {s.total_score}
                      </span>
                      </td>
                    </tr>
                );
              })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
  );
};

function toEmbedUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com') && u.searchParams.get('v')) {
      return `https://www.youtube.com/embed/${u.searchParams.get('v')}`;
    }
    if (u.hostname === 'youtu.be') {
      return `https://www.youtube.com/embed${u.pathname}`;
    }
    if (u.hostname.includes('rutube.ru')) {
      const match = u.pathname.match(/\/video\/([a-f0-9]+)/);
      if (match) return `https://rutube.ru/play/embed/${match[1]}`;
    }
  } catch { /* ignore */ }
  return url;
}