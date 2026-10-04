import React, { useEffect, useState } from 'react';
import { Download, Edit2, FileText, History, Lock, Paperclip, Plus, Send, Trash2, Unlock } from 'lucide-react';
import { toast } from 'sonner';

import {
  coursesApi,
  type CourseLessonResponse,
  type GradingCriterionResponse,
  type LessonSubmissionResponse,
  type CriterionScoreInput,
  type SubmissionReviewHistoryEntry,
  type CreateLessonRequest,
  apiDeadlineToDatetimeLocal,
  datetimeLocalToApiDeadline,
} from '../api/courses';
import { filesApi } from '../api/files';
import { Modal } from './Modal';
import { Pagination } from './Pagination';

export interface ModeratorCoursePanelProps {
  courseId: number;
  /** edit — только уроки и критерии; review — только проверка работ */
  mode: 'edit' | 'review';
  /** Filter lessons by category. Default is 'LESSON' (regular lessons). */
  category?: 'LESSON' | 'HEARING';
}

export const ModeratorCoursePanel: React.FC<ModeratorCoursePanelProps> = ({ courseId, mode, category = 'LESSON' }) => {

  const [lessons, setLessons] = useState<CourseLessonResponse[]>([]);
  const [lessonsLoading, setLessonsLoading] = useState(false);
  const [lessonCriteriaMap, setLessonCriteriaMap] = useState<Map<number, GradingCriterionResponse[]>>(new Map());

  const [lessonModalOpen, setLessonModalOpen] = useState(false);
  const [editingLesson, setEditingLesson] = useState<CourseLessonResponse | null>(null);
  const [savingLesson, setSavingLesson] = useState(false);
  const [lessonForm, setLessonForm] = useState({
    title: '',
    lecture_content: '',
    practice_description: '',
    submission_type: 'TEXT' as 'TEXT' | 'FILE' | 'TEXT_AND_FILE',
    order_number: 1,
    video_url: '',
    max_score: 100,
    deadline_local: '',
    hearing_open_for_students: false,
    hearing_stage: '' as import('../api/courses').HearingStage | '',
  });

  const [lessonCriteriaFormInline, setLessonCriteriaFormInline] = useState<
      Array<{ name: string; description: string; max_points: number }>
  >([]);
  const [lectureFile, setLectureFile] = useState<File | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);

  const [reviewLesson, setReviewLesson] = useState<CourseLessonResponse | null>(null);
  const [reviewScope, setReviewScope] = useState<'lesson' | 'course'>('lesson');
  const [courseSubmissions, setCourseSubmissions] = useState<LessonSubmissionResponse[]>([]);
  const [courseSubPage, setCourseSubPage] = useState(0);
  const [courseSubTotalPages, setCourseSubTotalPages] = useState(0);
  const [courseSubLoading, setCourseSubLoading] = useState(false);
  const [courseSubStatusFilter, setCourseSubStatusFilter] = useState('');
  const [submissions, setSubmissions] = useState<LessonSubmissionResponse[]>([]);
  const [subPage, setSubPage] = useState(0);
  const [subTotalPages, setSubTotalPages] = useState(0);
  const [subLoading, setSubLoading] = useState(false);

  const [reviewModal, setReviewModal] = useState<LessonSubmissionResponse | null>(null);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewStatus, setReviewStatus] = useState<'ACCEPTED' | 'NEEDS_REVISION'>('ACCEPTED');
  const [reviewScore, setReviewScore] = useState<number | ''>('');
  const [reviewCriteriaScores, setReviewCriteriaScores] = useState<Record<number, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [reviewHistory, setReviewHistory] = useState<SubmissionReviewHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [moderatorComment, setModeratorComment] = useState('');
  const [addingModeratorComment, setAddingModeratorComment] = useState(false);

  const loadLessons = async (cid: number) => {
    setLessonsLoading(true);
    try {
      const lessonsRes = await coursesApi.getLessons(cid);
      const fetched = (lessonsRes.data ?? []).filter(l => (l.category ?? 'LESSON') === category);
      setLessons(fetched);

      const criteriaMap = new Map<number, GradingCriterionResponse[]>();
      await Promise.all(
          fetched.map(async (l) => {
            try {
              const res = await coursesApi.getLessonCriteria(l.id);
              criteriaMap.set(l.id, res.data ?? []);
            } catch {
              criteriaMap.set(l.id, []);
            }
          }),
      );
      setLessonCriteriaMap(criteriaMap);
      setReviewLesson(null);
    } catch {
      toast.error('Ошибка загрузки уроков');
      setLessons([]);
      setLessonCriteriaMap(new Map());
    } finally {
      setLessonsLoading(false);
    }
  };

  useEffect(() => {
    if (!courseId) { setLessons([]); setLessonCriteriaMap(new Map()); setReviewLesson(null); return; }
    loadLessons(courseId);
  }, [courseId]);

  useEffect(() => {
    if (!reviewModal) {
      setReviewHistory([]);
      setModeratorComment('');
      return;
    }
    let cancelled = false;
    setHistoryLoading(true);
    coursesApi
        .getSubmissionReviewHistory(reviewModal.id)
        .then((r) => {
          if (!cancelled) setReviewHistory(r.data ?? []);
        })
        .catch(() => {
          if (!cancelled) setReviewHistory([]);
        })
        .finally(() => {
          if (!cancelled) setHistoryLoading(false);
        });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- перезагрузка при смене работы
  }, [reviewModal?.id]);

  const openLessonModal = (lesson?: CourseLessonResponse) => {
    setLectureFile(null);
    if (lesson) {
      setEditingLesson(lesson);
      setLessonForm({
        title: lesson.title,
        lecture_content: lesson.lecture_content ?? '',
        practice_description: lesson.practice_description ?? '',
        submission_type: lesson.submission_type,
        order_number: lesson.order_number,
        video_url: lesson.video_url ?? '',
        max_score: lesson.max_score ?? 100,
        deadline_local: apiDeadlineToDatetimeLocal(lesson.submission_deadline),
        hearing_open_for_students: lesson.hearing_stage === 'TOPIC_APPROVAL' ? true : (lesson.hearing_open_for_students ?? false),
        hearing_stage: lesson.hearing_stage ?? '',
      });
      const existing = lessonCriteriaMap.get(lesson.id) ?? [];
      const confDefaultPanel = lesson.hearing_stage === 'CONFERENCE_DEFENSE' && existing.length === 0
          ? ([{"name": "Актуальность выбранной проблемы", "description": "Актуальность и значимость выбранной проблемы, наличие вариантов эффективного решения.", "max_points": 3}, {"name": "Логичность и полнота представленных материалов", "description": "Содержательность, информативность, глубина проработки темы, логическая завершённость.", "max_points": 4}, {"name": "Практическая реализуемость работы", "description": "Результаты работы имеют практическое значение и могут быть применены.", "max_points": 6}, {"name": "Внедрение в практику", "description": "Степень внедрения: наличие опытного образца, рабочей модели, апробация на целевой аудитории.", "max_points": 5}, {"name": "Обоснование использованных методов", "description": "Обоснование выбора методов исследования, технологий, применения современного оборудования.", "max_points": 3}, {"name": "Применение практических навыков", "description": "Изобретательность, техническая сложность, оригинальность, завершённость, качество выполнения.", "max_points": 5}, {"name": "Самостоятельность выполнения работы", "description": "Соответствие уровня материала уровню понимания на защите. Личный вклад участников.", "max_points": 4}, {"name": "Умение аргументировать заключения и выводы", "description": "Аргументированность выводов, опора на факты и теоретическую базу.", "max_points": 4}, {"name": "Умение отвечать на вопросы", "description": "Чёткость и обоснованность ответов с использованием принятой терминологии.", "max_points": 4}, {"name": "Культура публичного выступления", "description": "Логика, грамотность изложения, ораторское мастерство, эмоциональность, внешний вид.", "max_points": 3}, {"name": "Качество презентационных материалов", "description": "Аккуратность, эстетика оформления, отсутствие грамматических ошибок.", "max_points": 3}, {"name": "Наличие отзыва вуза/предприятия-партнёра", "description": "Наличие отзыва, указывающего на полученный результат и дальнейшее развитие работы.", "max_points": 1}] as Array<{name:string;description:string;max_points:number}>)
          : null;
      setLessonCriteriaFormInline(
          existing.length > 0
              ? existing.map(c => ({ name: c.name, description: c.description ?? '', max_points: c.max_points }))
              : confDefaultPanel ?? [],
      );
      if (confDefaultPanel) setLessonForm(f => ({ ...f, max_score: 45 }));
    } else {
      setEditingLesson(null);
      setLessonForm({
        title: '',
        lecture_content: '',
        practice_description: '',
        submission_type: category === 'HEARING' ? 'FILE' : 'TEXT',
        order_number: category === 'HEARING' ? 900 + lessons.length + 1 : lessons.length + 1,
        video_url: '',
        max_score: category === 'HEARING' ? 0 : 100,
        deadline_local: '',
        hearing_open_for_students: category === 'HEARING',
        hearing_stage: '',
      });
      setLessonCriteriaFormInline([]);
    }
    setLessonModalOpen(true);
  };

  const handleUploadLectureFile = async () => {
    if (!lectureFile || !courseId || !editingLesson) return;
    setUploadingFile(true);
    try {
      await coursesApi.adminUploadLectureFile(courseId, editingLesson.id, lectureFile);
      toast.success('Файл лекции загружен');
      setLectureFile(null);
      await loadLessons(courseId);
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Ошибка загрузки файла');
    } finally {
      setUploadingFile(false);
    }
  };

  const handleDeleteLesson = async (l: CourseLessonResponse) => {
    if (!courseId) return;
    if (!window.confirm(`Удалить урок «${l.title}»? Все сданные работы по нему будут удалены.`)) return;
    try {
      await coursesApi.deleteLesson(courseId, l.id);
      toast.success('Урок удалён');
      if (reviewLesson?.id === l.id) setReviewLesson(null);
      await loadLessons(courseId);
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Ошибка удаления урока');
    }
  };

  const handleSaveLesson = async () => {
    if (!courseId) return;
    if (!lessonForm.title.trim()) return toast.error('Введите название урока');
    if (category === 'HEARING' && !editingLesson && !lessonForm.hearing_stage) {
      return toast.error('Выберите этап слушания');
    }
    setSavingLesson(true);
    try {
      const validCriteriaForScore = lessonCriteriaFormInline.filter(c => c.name.trim());
      const { deadline_local, hearing_open_for_students, hearing_stage, ...rest } = lessonForm;
      const payload: CreateLessonRequest = {
        ...rest,
        submission_deadline: datetimeLocalToApiDeadline(deadline_local),
        category: category,
      };
      if (category === 'HEARING') {
        if (hearing_stage) {
          payload.hearing_stage = hearing_stage;
        }
        payload.hearing_open_for_students = hearing_stage === 'TOPIC_APPROVAL'
            ? true
            : hearing_open_for_students;
      }
      if (validCriteriaForScore.length > 0) {
        payload.max_score = validCriteriaForScore.reduce((s, c) => s + (c.max_points || 0), 0);
      }

      let savedLessonId: number;
      if (editingLesson) {
        await coursesApi.adminUpdateLesson(courseId, editingLesson.id, payload);
        savedLessonId = editingLesson.id;
        toast.success('Урок обновлён');
      } else {
        const res = await coursesApi.adminAddLesson(courseId, payload);
        savedLessonId = res.data.id;
        toast.success('Урок добавлен');
      }

      const validCriteria = lessonCriteriaFormInline.filter(c => c.name.trim());
      if (validCriteria.length > 0) {
        const criteriaRes = await coursesApi.setLessonCriteria(savedLessonId, validCriteria);
        setLessonCriteriaMap(prev => {
          const next = new Map(prev);
          next.set(savedLessonId, criteriaRes.data);
          return next;
        });
      }

      if (lectureFile) {
        await coursesApi.adminUploadLectureFile(courseId, savedLessonId, lectureFile);
        setLectureFile(null);
        toast.success('Файл лекции загружен');
      }

      setLessonModalOpen(false);
      await loadLessons(courseId);
    } catch (err: any) {
      const d = err.response?.data;
      const msg =
          typeof d === 'string'
              ? d
              : d?.message ?? (typeof d === 'object' && d !== null ? JSON.stringify(d) : null) ?? 'Ошибка сохранения урока';
      toast.error(msg);
    } finally {
      setSavingLesson(false);
    }
  };

  const handleAddModeratorComment = async () => {
    if (!reviewModal || !moderatorComment.trim()) return;
    setAddingModeratorComment(true);
    try {
      await coursesApi.addModeratorComment(reviewModal.id, moderatorComment.trim());
      toast.success('Комментарий добавлен');
      setModeratorComment('');
      const r = await coursesApi.getSubmissionReviewHistory(reviewModal.id);
      setReviewHistory(r.data ?? []);
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Ошибка добавления комментария');
    } finally {
      setAddingModeratorComment(false);
    }
  };

  const handleToggleLessonOpen = async (lesson: CourseLessonResponse) => {
    if (!courseId) return;
    if (lesson.hearing_stage === 'TOPIC_APPROVAL') return;
    const newOpen = !lesson.hearing_open_for_students;
    try {
      await coursesApi.adminUpdateLesson(courseId, lesson.id, {
        title: lesson.title,
        lecture_content: lesson.lecture_content ?? '',
        practice_description: lesson.practice_description ?? '',
        submission_type: lesson.submission_type,
        order_number: lesson.order_number,
        video_url: lesson.video_url ?? undefined,
        max_score: lesson.max_score,
        submission_deadline: lesson.submission_deadline ?? null,
        category: lesson.category,
        hearing_stage: lesson.hearing_stage ?? undefined,
        hearing_open_for_students: newOpen,
      });
      toast.success(newOpen ? 'Этап открыт для учеников' : 'Этап закрыт для учеников');
      await loadLessons(courseId);
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Ошибка обновления');
    }
  };

  const loadCourseSubmissions = async (p = 0) => {
    if (!courseId) return;
    setCourseSubLoading(true);
    try {
      const r = await coursesApi.getSubmissionsByCourse(
          courseId,
          courseSubStatusFilter || undefined,
          p,
          15,
      );
      setCourseSubmissions(r.data.content);
      setCourseSubTotalPages(r.data.total_pages);
      setCourseSubPage(p);
    } catch {
      toast.error('Ошибка загрузки работ по курсу');
      setCourseSubmissions([]);
    } finally {
      setCourseSubLoading(false);
    }
  };

  useEffect(() => {
    if (mode !== 'review' || reviewScope !== 'course' || !courseId) return;
    loadCourseSubmissions(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- загрузка по вкладке и фильтру
  }, [mode, reviewScope, courseId, courseSubStatusFilter]);

  const statusLabel = (s: string) => {
    if (s === 'ACCEPTED') return { text: 'Принята', cls: 'text-emerald-600 bg-emerald-50 border-emerald-100' };
    if (s === 'NEEDS_REVISION') return { text: 'На доработку', cls: 'text-amber-600 bg-amber-50 border-amber-100' };
    return { text: 'Сдана', cls: 'text-blue-600 bg-blue-50 border-blue-100' };
  };

  const openReview = async (lesson: CourseLessonResponse, p = 0) => {
    setReviewLesson(lesson);
    setSubLoading(true);
    try {
      const r = await coursesApi.getSubmissionsByLesson(lesson.id, p, 10);
      setSubmissions(r.data.content);
      setSubTotalPages(r.data.total_pages);
      setSubPage(p);
    } catch {
      toast.error('Ошибка загрузки работ');
    } finally {
      setSubLoading(false);
    }
  };

  const lessonIdForCriteria = reviewLesson?.id ?? reviewModal?.lesson_id ?? null;
  const currentCriteria =
      lessonIdForCriteria != null ? (lessonCriteriaMap.get(lessonIdForCriteria) ?? []) : [];

  const handleGradeWithCriteria = async () => {
    if (!reviewModal) return;
    setSubmitting(true);
    try {
      const grades: CriterionScoreInput[] = currentCriteria.map(c => ({ criterion_id: c.id, points: reviewCriteriaScores[c.id] ?? 0 }));
      await coursesApi.gradeSubmission(reviewModal.id, grades, reviewComment || undefined, reviewStatus);
      toast.success('Оценка сохранена');
      setReviewModal(null);
      setReviewComment('');
      setReviewCriteriaScores({});
      if (reviewLesson) openReview(reviewLesson, subPage);
      if (reviewScope === 'course') loadCourseSubmissions(courseSubPage);
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Ошибка сохранения');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReview = async () => {
    if (!reviewModal) return;
    setSubmitting(true);
    try {
      await coursesApi.reviewSubmission(reviewModal.id, reviewStatus, reviewComment, reviewScore === '' ? undefined : reviewScore);
      toast.success('Оценка сохранена');
      setReviewModal(null);
      setReviewComment('');
      setReviewScore('');
      if (reviewLesson) openReview(reviewLesson, subPage);
      if (reviewScope === 'course') loadCourseSubmissions(courseSubPage);
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Ошибка сохранения');
    } finally {
      setSubmitting(false);
    }
  };

  const formatDeadlineLine = (raw: string | null | undefined) => {
    if (!raw) return null;
    const d = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
    if (Number.isNaN(d.getTime())) return null;
    return `До ${d.toLocaleString('ru', { dateStyle: 'short', timeStyle: 'short' })}`;
  };

  const historyStatusRu = (s: string) => {
    if (s === 'ACCEPTED') return 'Принято';
    if (s === 'NEEDS_REVISION') return 'На доработку';
    return 'На проверке';
  };

  const openSubmissionReview = (sub: LessonSubmissionResponse) => {
    setReviewModal(sub);
    setReviewComment(sub.reviewer_comment ?? '');
    setReviewStatus('ACCEPTED');
    setReviewScore('');
    setModeratorComment('');
    const scores: Record<number, number> = {};
    if (sub.criterion_grades?.length) {
      sub.criterion_grades.forEach((g) => {
        scores[g.criterion_id] = g.points;
      });
    }
    setReviewCriteriaScores(scores);
  };

  const submissionRowActions = (sub: LessonSubmissionResponse) => {
    const s = statusLabel(sub.status);
    return (
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {sub.score != null && (
              <span className="text-xs font-semibold text-muted-foreground">
            {sub.score}/{sub.max_score ?? '?'}
          </span>
          )}
          <span className={`text-[11px] px-2 py-0.5 rounded-lg border font-medium ${s.cls}`}>{s.text}</span>
          {sub.status === 'ACCEPTED' ? (
              <button
                  onClick={() => openSubmissionReview(sub)}
                  className="flex items-center gap-1 px-2.5 py-1 bg-muted text-foreground text-xs font-semibold rounded-lg hover:bg-muted/80 transition-colors border border-border"
                  type="button"
              >
                <FileText className="size-3" /> Просмотр
              </button>
          ) : (
              <button
                  onClick={() => openSubmissionReview(sub)}
                  className="flex items-center gap-1 px-2.5 py-1 bg-primary/10 text-primary text-xs font-semibold rounded-lg hover:bg-primary/15 transition-colors border border-primary/20"
                  type="button"
              >
                <Send className="size-3" /> Проверить
              </button>
          )}
        </div>
    );
  };

  const courseWideReviewPanel =
      mode === 'review' ? (
          <div className="lg:col-span-3 space-y-4">
            <div className="bg-card rounded-2xl border border-border shadow-sm">
              <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-muted/20">
                <div>
                  <h4 className="text-sm font-semibold text-foreground">Все работы по курсу</h4>
                  <p className="text-xs text-muted-foreground mt-0.5">Список сдач учеников по всем урокам</p>
                </div>
              </div>
              {courseSubLoading ? (
                  <div className="p-6 text-center text-muted-foreground text-sm">Загрузка...</div>
              ) : courseSubmissions.length === 0 ? (
                  <div className="p-6 text-center text-muted-foreground text-sm">Работ пока нет</div>
              ) : (
                  <>
                    <div className="divide-y divide-border">
                      {courseSubmissions.map((sub) => (
                          <div
                              key={sub.id}
                              className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-5 py-3 hover:bg-muted/30"
                          >
                            <div className="flex items-start gap-3 min-w-0">
                              <div className="size-8 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center text-primary-foreground text-xs font-bold shrink-0">
                                {sub.account_nickname?.[0]?.toUpperCase() ?? '?'}
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-foreground">{sub.account_nickname}</p>
                                <p className="text-xs text-primary font-medium truncate">{sub.lesson_title}</p>
                                <p className="text-xs text-muted-foreground">
                                  {new Date(sub.submitted_at).toLocaleString('ru')}
                                </p>
                              </div>
                            </div>
                            {submissionRowActions(sub)}
                          </div>
                      ))}
                    </div>
                    <Pagination
                        currentPage={courseSubPage}
                        totalPages={courseSubTotalPages}
                        onPageChange={(p) => loadCourseSubmissions(p)}
                    />
                  </>
              )}
            </div>
          </div>
      ) : null;

  const lessonListCard = (
      <div className={mode === 'edit' ? 'w-full' : 'lg:col-span-1'}>
        <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-muted/30">
            <span className="text-sm font-semibold text-foreground">{category === 'HEARING' ? 'Этапы слушаний' : 'Уроки'}</span>
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-lg">{lessons.length}</span>
          </div>
          {lessonsLoading ? (
              <div className="p-6 text-center text-muted-foreground text-sm">Загрузка...</div>
          ) : lessons.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-sm">Уроков пока нет</div>
          ) : (
              <div className="divide-y divide-border">
                {lessons
                    .slice()
                    .sort((a, b) => a.order_number - b.order_number)
                    .map((l) => {
                      const lc = lessonCriteriaMap.get(l.id) ?? [];
                      const isHearing = category === 'HEARING';
                      const isAlwaysOpen = l.hearing_stage === 'TOPIC_APPROVAL';
                      const isOpen = isAlwaysOpen || !!l.hearing_open_for_students;
                      return (
                          <div key={l.id} className={`flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors ${isHearing && !isOpen ? 'opacity-70' : ''}`}>
                            {mode === 'review' ? (
                                <button
                                    onClick={() => openReview(l, 0)}
                                    className={`flex items-center gap-3 text-left min-w-0 flex-1 ${
                                        reviewLesson?.id === l.id ? 'text-primary' : 'text-foreground'
                                    }`}
                                    type="button"
                                >
                        <span className="size-7 bg-primary/10 rounded-lg flex items-center justify-center text-xs font-bold text-primary border border-primary/20 shrink-0">
                          {l.order_number}
                        </span>
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium truncate">{l.title}</p>
                                    <p className="text-[11px] text-muted-foreground">
                                      {lc.length > 0 ? `${lc.length} критериев` : `Макс. балл: ${l.max_score}`}
                                      {formatDeadlineLine(l.submission_deadline) && (
                                          <span className="block text-amber-700 dark:text-amber-300 mt-0.5">
                                {formatDeadlineLine(l.submission_deadline)}
                              </span>
                                      )}
                                    </p>
                                  </div>
                                  {isHearing && (
                                      <span className={`ml-auto shrink-0 text-[10px] px-1.5 py-0.5 rounded border font-medium ${isOpen ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800' : 'bg-muted text-muted-foreground border-border'}`}>
                            {isAlwaysOpen ? 'Всегда открыт' : isOpen ? 'Открыт' : 'Закрыт'}
                          </span>
                                  )}
                                </button>
                            ) : (
                                <div className="flex items-center gap-3 text-left min-w-0 flex-1 text-foreground">
                        <span className="size-7 bg-primary/10 rounded-lg flex items-center justify-center text-xs font-bold text-primary border border-primary/20 shrink-0">
                          {l.order_number}
                        </span>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium truncate">{l.title}</p>
                                    <p className="text-[11px] text-muted-foreground">
                                      {lc.length > 0 ? `${lc.length} критериев` : `Макс. балл: ${l.max_score}`}
                                      {formatDeadlineLine(l.submission_deadline) && (
                                          <span className="block text-amber-700 dark:text-amber-300 mt-0.5">
                                {formatDeadlineLine(l.submission_deadline)}
                              </span>
                                      )}
                                    </p>
                                  </div>
                                  {isHearing && (
                                      <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border font-medium ${isOpen ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800' : 'bg-muted text-muted-foreground border-border'}`}>
                            {isAlwaysOpen ? 'Всегда открыт' : isOpen ? 'Открыт' : 'Закрыт'}
                          </span>
                                  )}
                                </div>
                            )}
                            {mode === 'edit' && (
                                <div className="flex items-center gap-1.5 pl-2 shrink-0">
                                  {isHearing && !isAlwaysOpen && (
                                      <button
                                          onClick={() => handleToggleLessonOpen(l)}
                                          className={`p-1.5 rounded-lg transition-colors ${isOpen ? 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30' : 'text-muted-foreground hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'}`}
                                          title={isOpen ? 'Закрыть этап для учеников' : 'Открыть этап для учеников'}
                                          type="button"
                                      >
                                        {isOpen ? <Unlock className="size-4" /> : <Lock className="size-4" />}
                                      </button>
                                  )}
                                  <button
                                      onClick={() => openLessonModal(l)}
                                      className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                                      title="Редактировать урок"
                                      type="button"
                                  >
                                    <Edit2 className="size-4" />
                                  </button>
                                  <button
                                      onClick={() => handleDeleteLesson(l)}
                                      className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                      title="Удалить урок"
                                      type="button"
                                  >
                                    <Trash2 className="size-4" />
                                  </button>
                                </div>
                            )}
                          </div>
                      );
                    })}
              </div>
          )}
        </div>
      </div>
  );

  const reviewColumn =
      mode === 'review' ? (
          <div className="lg:col-span-2 space-y-4">
            {!reviewLesson ? (
                <div className="bg-card rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
                  <FileText className="size-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Выберите урок слева, чтобы увидеть работы</p>
                </div>
            ) : (
                <div className="bg-card rounded-2xl border border-border shadow-sm">
                  <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-muted/20">
                    <div>
                      <h4 className="text-sm font-semibold text-foreground">Работы: {reviewLesson.title}</h4>
                      <p className="text-xs text-muted-foreground mt-0.5">Сданные практические задания</p>
                    </div>
                    <button
                        onClick={() => setReviewLesson(null)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"
                        type="button"
                    >
                      ✕
                    </button>
                  </div>
                  {subLoading ? (
                      <div className="p-6 text-center text-muted-foreground text-sm">Загрузка...</div>
                  ) : submissions.length === 0 ? (
                      <div className="p-6 text-center text-muted-foreground text-sm">Работ пока нет</div>
                  ) : (
                      <>
                        <div className="divide-y divide-border">
                          {submissions.map((sub) => (
                              <div key={sub.id} className="flex items-center justify-between px-5 py-3 hover:bg-muted/30 gap-3">
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="size-8 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center text-primary-foreground text-xs font-bold shrink-0">
                                    {sub.account_nickname?.[0]?.toUpperCase() ?? '?'}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium text-foreground">{sub.account_nickname}</p>
                                    <p className="text-xs text-muted-foreground">{new Date(sub.submitted_at).toLocaleDateString('ru')}</p>
                                  </div>
                                </div>
                                {submissionRowActions(sub)}
                              </div>
                          ))}
                        </div>
                        <Pagination currentPage={subPage} totalPages={subTotalPages} onPageChange={(p) => openReview(reviewLesson, p)} />
                      </>
                  )}
                </div>
            )}
          </div>
      ) : null;

  return (
      <div className="space-y-4">
        <div className="bg-card rounded-2xl border border-border p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-foreground text-base font-semibold">
              {mode === 'edit' ? 'Материалы и задания' : 'Проверка работ'}
            </h2>
            <p className="text-muted-foreground text-xs mt-0.5">
              {mode === 'edit'
                  ? 'Создание и редактирование уроков, лекций, практики и критериев оценивания'
                  : 'Просмотр сданных работ и выставление оценок'}
            </p>
          </div>
          {mode === 'edit' && (
              <button
                  onClick={() => openLessonModal()}
                  className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground text-sm font-semibold rounded-xl hover:opacity-90"
                  type="button"
              >
                <Plus className="size-4" />
                Новый урок
              </button>
          )}
        </div>

        {mode === 'review' && (
            <div className="flex flex-wrap gap-2 items-center">
              <button
                  type="button"
                  onClick={() => setReviewScope('lesson')}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-all ${
                      reviewScope === 'lesson'
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-card text-muted-foreground border-border hover:bg-muted'
                  }`}
              >
                По урокам
              </button>
              <button
                  type="button"
                  onClick={() => setReviewScope('course')}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-all ${
                      reviewScope === 'course'
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-card text-muted-foreground border-border hover:bg-muted'
                  }`}
              >
                Все работы курса
              </button>
              {reviewScope === 'course' && (
                  <select
                      value={courseSubStatusFilter}
                      onChange={(e) => setCourseSubStatusFilter(e.target.value)}
                      className="border border-border rounded-xl px-3 py-2 text-sm bg-card text-foreground"
                  >
                    <option value="">Все статусы</option>
                    <option value="SUBMITTED">На проверке</option>
                    <option value="NEEDS_REVISION">На доработку</option>
                    <option value="ACCEPTED">Принятые</option>
                  </select>
              )}
            </div>
        )}

        <div
            className={`grid grid-cols-1 gap-4 ${
                mode === 'edit' ? '' : mode === 'review' && reviewScope === 'lesson' ? 'lg:grid-cols-3' : ''
            }`}
        >
          {mode === 'edit' && lessonListCard}
          {mode === 'review' && reviewScope === 'lesson' && (
              <>
                {lessonListCard}
                {reviewColumn}
              </>
          )}
          {mode === 'review' && reviewScope === 'course' && courseWideReviewPanel}
        </div>

        <Modal
            open={lessonModalOpen}
            onClose={() => setLessonModalOpen(false)}
            title={
              editingLesson
                  ? `Редактировать: ${editingLesson.title}`
                  : category === 'HEARING'
                      ? 'Новый этап контрольного слушания'
                      : 'Создание нового урока'
            }
        >
          <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-foreground">
              <span className="size-5 bg-blue-100 dark:bg-primary/20 text-blue-600 dark:text-primary rounded-md flex items-center justify-center text-xs font-bold">
                1
              </span>
                Основная информация
              </div>
              <div className="grid grid-cols-[1fr_100px] gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 dark:text-muted-foreground mb-1">
                    Название урока <span className="text-red-400">*</span>
                  </label>
                  <input
                      value={lessonForm.title}
                      onChange={(e) => setLessonForm((f) => ({ ...f, title: e.target.value }))}
                      placeholder="Например: Введение в проектную деятельность"
                      className="w-full border border-slate-200 dark:border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-slate-50 dark:bg-input-background"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 dark:text-muted-foreground mb-1">№ п/п</label>
                  <input
                      type="number"
                      min={1}
                      value={lessonForm.order_number}
                      onChange={(e) => setLessonForm((f) => ({ ...f, order_number: Number(e.target.value) }))}
                      className="w-full border border-slate-200 dark:border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-slate-50 dark:bg-input-background text-center"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(['TEXT', 'FILE', 'TEXT_AND_FILE'] as const).map((t) => {
                  const labels: Record<string, string> = {
                    TEXT: 'Текстовый ответ',
                    FILE: 'Загрузка файла',
                    TEXT_AND_FILE: 'Текст + файл',
                  };
                  const active = lessonForm.submission_type === t;
                  return (
                      <button
                          key={t}
                          type="button"
                          onClick={() => setLessonForm((f) => ({ ...f, submission_type: t }))}
                          className={`py-2 text-xs font-medium rounded-xl border transition-all ${
                              active
                                  ? 'bg-blue-50 dark:bg-primary/15 text-blue-700 dark:text-primary border-blue-200 dark:border-primary/30 ring-2 ring-blue-100 dark:ring-primary/20'
                                  : 'bg-slate-50 dark:bg-muted text-slate-500 dark:text-muted-foreground border-slate-200 dark:border-border hover:bg-slate-100 dark:hover:bg-muted/80'
                          }`}
                      >
                        {labels[t]}
                      </button>
                  );
                })}
              </div>
            </div>

            {/* Выбор этапа слушания — только для HEARING */}
            {category === 'HEARING' && (
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-500 dark:text-muted-foreground">
                    Этап слушания <span className="text-red-400">*</span>
                  </label>
                  <select
                      value={lessonForm.hearing_stage}
                      onChange={(e) => {
                        const stage = e.target.value as import('../api/courses').HearingStage | '';
                        // При выборе CONFERENCE_DEFENSE автоматически подставляем 12 критериев МосПолитех
                        if (stage === 'CONFERENCE_DEFENSE' && lessonCriteriaFormInline.length === 0) {
                          setLessonCriteriaFormInline([
                            {
                              name: "Актуальность выбранной проблемы",
                              description: "Актуальность и значимость выбранной проблемы, наличие вариантов эффективного решения.",
                              max_points: 3
                            },
                            {
                              name: "Логичность и полнота представленных материалов",
                              description: "Содержательность, информативность, глубина проработки темы, логическая завершённость.",
                              max_points: 4
                            },
                            {
                              name: "Практическая реализуемость работы",
                              description: "Результаты работы имеют практическое значение и могут быть применены.",
                              max_points: 6
                            },
                            {
                              name: "Внедрение в практику",
                              description: "Степень внедрения: наличие опытного образца, рабочей модели, апробация на целевой аудитории.",
                              max_points: 5
                            },
                            {
                              name: "Обоснование использованных методов",
                              description: "Обоснование выбора методов исследования, технологий, применения современного оборудования.",
                              max_points: 3
                            },
                            {
                              name: "Применение практических навыков",
                              description: "Изобретательность, техническая сложность, оригинальность, завершённость, качество выполнения.",
                              max_points: 5
                            },
                            {
                              name: "Самостоятельность выполнения работы",
                              description: "Соответствие уровня материала уровню понимания на защите. Личный вклад участников.",
                              max_points: 4
                            },
                            {
                              name: "Умение аргументировать заключения и выводы",
                              description: "Аргументированность выводов, опора на факты и теоретическую базу.",
                              max_points: 4
                            },
                            {
                              name: "Умение отвечать на вопросы",
                              description: "Чёткость и обоснованность ответов с использованием принятой терминологии.",
                              max_points: 4
                            },
                            {
                              name: "Культура публичного выступления",
                              description: "Логика, грамотность изложения, ораторское мастерство, эмоциональность, внешний вид.",
                              max_points: 3
                            },
                            {
                              name: "Качество презентационных материалов",
                              description: "Аккуратность, эстетика оформления, отсутствие грамматических ошибок.",
                              max_points: 3
                            },
                            {
                              name: "Наличие отзыва вуза/предприятия-партнёра",
                              description: "Наличие отзыва, указывающего на полученный результат и дальнейшее развитие работы.",
                              max_points: 1
                            }
                          ]);
                          setLessonForm(f => ({ ...f, max_score: 45 }));
                        }
                        setLessonForm(f => ({
                          ...f,
                          hearing_stage: stage,
                          // TOPIC_APPROVAL всегда открыт
                          hearing_open_for_students: stage === 'TOPIC_APPROVAL' ? true : f.hearing_open_for_students,
                        }));
                      }}
                      disabled={!!editingLesson}
                      className="w-full border border-slate-200 dark:border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-slate-50 dark:bg-input-background disabled:opacity-60"
                  >
                    <option value="">— Выберите этап —</option>
                    <option value="TOPIC_APPROVAL">Выбор и согласование темы</option>
                    <option value="INTERMEDIATE">Промежуточный показ</option>
                    <option value="FINAL">Финальный показ</option>
                    <option value="CONFERENCE_DEFENSE">Защита на конференции</option>
                  </select>
                  {editingLesson && (
                      <p className="text-[11px] text-slate-400 dark:text-muted-foreground">
                        Этап нельзя изменить после создания.
                      </p>
                  )}
                </div>
            )}

            <hr className="border-slate-100 dark:border-border" />

            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-foreground">
              <span className="size-5 bg-blue-100 dark:bg-primary/20 text-blue-600 dark:text-primary rounded-md flex items-center justify-center text-xs font-bold">
                2
              </span>
                {category === 'HEARING' ? 'Задание слушания' : 'Материалы урока'}
              </div>
              {category !== 'HEARING' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-500 dark:text-muted-foreground mb-1">
                      Теоретический материал (лекция)
                    </label>
                    <textarea
                        value={lessonForm.lecture_content}
                        onChange={(e) => setLessonForm((f) => ({ ...f, lecture_content: e.target.value }))}
                        placeholder="Введите содержание лекции..."
                        rows={4}
                        className="w-full border border-slate-200 dark:border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-slate-50 dark:bg-input-background resize-none"
                    />
                  </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-muted-foreground mb-1">
                  {category === 'HEARING' ? 'Описание задания для слушания' : 'Описание практического задания'} <span className="text-red-400">*</span>
                </label>
                <textarea
                    value={lessonForm.practice_description}
                    onChange={(e) => setLessonForm((f) => ({ ...f, practice_description: e.target.value }))}
                    placeholder="Опишите, что ученик должен сделать..."
                    rows={3}
                    className="w-full border border-slate-200 dark:border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-slate-50 dark:bg-input-background resize-none"
                />
              </div>
              {category !== 'HEARING' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-500 dark:text-muted-foreground mb-1">
                      Ссылка на видео (необязательно)
                    </label>
                    <input
                        value={lessonForm.video_url}
                        onChange={(e) => setLessonForm((f) => ({ ...f, video_url: e.target.value }))}
                        placeholder="https://youtube.com/watch?v=..."
                        className="w-full border border-slate-200 dark:border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-slate-50 dark:bg-input-background"
                    />
                  </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-muted-foreground mb-1">
                  Срок сдачи работы
                </label>
                <input
                    type="datetime-local"
                    value={lessonForm.deadline_local}
                    onChange={(e) => setLessonForm((f) => ({ ...f, deadline_local: e.target.value }))}
                    className="w-full border border-slate-200 dark:border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-slate-50 dark:bg-input-background"
                />
                <p className="text-[11px] text-slate-400 dark:text-muted-foreground mt-1">Пусто — без ограничения по времени</p>
              </div>
              {category === 'HEARING' && (
                  <label className="flex items-start gap-2 cursor-pointer rounded-xl border border-slate-200 dark:border-border px-3 py-2.5 bg-slate-50/80 dark:bg-muted/30">
                    <input
                        type="checkbox"
                        className="mt-1 rounded border-slate-300"
                        checked={lessonForm.hearing_open_for_students}
                        disabled={editingLesson?.hearing_stage === 'TOPIC_APPROVAL'}
                        onChange={(e) => setLessonForm((f) => ({ ...f, hearing_open_for_students: e.target.checked }))}
                    />
                    <span className="text-xs text-slate-600 dark:text-muted-foreground leading-snug">
                  <span className="font-medium text-slate-800 dark:text-foreground">Открыть этап для учеников.</span>{' '}
                      Этап «Выбор и согласование темы» всегда доступен; этапы 2–4 по умолчанию закрыты, пока вы их не активируете.
                </span>
                  </label>
              )}
              {editingLesson && category !== 'HEARING' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-500 dark:text-muted-foreground mb-1">
                      Файл лекции (PDF, презентация)
                    </label>
                    <div className="flex gap-2">
                      <input
                          type="file"
                          onChange={(e) => setLectureFile(e.target.files?.[0] ?? null)}
                          className="flex-1 text-sm text-slate-500 dark:text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 dark:file:bg-primary/15 file:text-blue-700 dark:file:text-primary hover:file:bg-blue-100"
                      />
                      {lectureFile && (
                          <button
                              onClick={handleUploadLectureFile}
                              disabled={uploadingFile}
                              type="button"
                              className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50"
                          >
                            {uploadingFile ? '...' : 'Загрузить'}
                          </button>
                      )}
                    </div>
                    {editingLesson.lecture_file_name && (
                        <p className="text-xs text-blue-500 dark:text-primary mt-1">Текущий файл: {editingLesson.lecture_file_name}</p>
                    )}
                  </div>
              )}
            </div>

            <hr className="border-slate-100 dark:border-border" />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-foreground">
                <span className="size-5 bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded-md flex items-center justify-center text-xs font-bold">
                  3
                </span>
                  Критерии оценивания
                </div>
                <button
                    type="button"
                    onClick={() =>
                        setLessonCriteriaFormInline((prev) => [...prev, { name: '', description: '', max_points: 10 }])
                    }
                    className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-blue-600 dark:text-primary bg-blue-50 dark:bg-primary/15 rounded-lg hover:bg-blue-100 dark:hover:bg-primary/20 border border-blue-100 dark:border-primary/25 transition-colors"
                >
                  <Plus className="size-3" /> Добавить критерий
                </button>
              </div>
              <p className="text-xs text-slate-400 dark:text-muted-foreground">
                Критерии определяют, по каким пунктам оценивается работа ученика. Макс. балл за урок = сумма баллов по всем
                критериям.
              </p>
              {lessonCriteriaFormInline.length === 0 ? (
                  <div className="border border-dashed border-slate-200 dark:border-border rounded-xl p-4 text-center text-slate-400 dark:text-muted-foreground text-xs">
                    Критерии не добавлены. Оценка будет выставляться вручную.
                  </div>
              ) : (
                  <div className="space-y-2">
                    {lessonCriteriaFormInline.map((c, idx) => (
                        <div
                            key={idx}
                            className="flex items-start gap-2 p-3 bg-slate-50 dark:bg-muted/40 rounded-xl border border-slate-100 dark:border-border"
                        >
                    <span className="size-6 bg-amber-50 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400 rounded-lg flex items-center justify-center text-[10px] font-bold border border-amber-100 dark:border-amber-500/30 shrink-0 mt-0.5">
                      {idx + 1}
                    </span>
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <input
                                value={c.name}
                                onChange={(e) => {
                                  const next = [...lessonCriteriaFormInline];
                                  next[idx] = { ...next[idx], name: e.target.value };
                                  setLessonCriteriaFormInline(next);
                                }}
                                placeholder="Название критерия"
                                className="w-full border border-slate-200 dark:border-border rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white dark:bg-card"
                            />
                            <input
                                value={c.description}
                                onChange={(e) => {
                                  const next = [...lessonCriteriaFormInline];
                                  next[idx] = { ...next[idx], description: e.target.value };
                                  setLessonCriteriaFormInline(next);
                                }}
                                placeholder="Описание (необязательно)"
                                className="w-full border border-slate-200 dark:border-border rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white dark:bg-card text-slate-500 dark:text-muted-foreground"
                            />
                          </div>
                          <div className="shrink-0 flex items-center gap-1.5">
                            <div className="text-center">
                              <label className="block text-[9px] text-slate-400 dark:text-muted-foreground mb-0.5">Макс.</label>
                              <input
                                  type="number"
                                  min={1}
                                  value={c.max_points}
                                  onChange={(e) => {
                                    const next = [...lessonCriteriaFormInline];
                                    next[idx] = { ...next[idx], max_points: Number(e.target.value) };
                                    setLessonCriteriaFormInline(next);
                                  }}
                                  className="w-14 border border-slate-200 dark:border-border rounded-lg px-2 py-1.5 text-xs text-center focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white dark:bg-card"
                              />
                            </div>
                            <button
                                type="button"
                                onClick={() => setLessonCriteriaFormInline((prev) => prev.filter((_, i) => i !== idx))}
                                className="p-1 text-slate-400 hover:text-red-500 transition-colors mt-3.5"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        </div>
                    ))}
                    <div className="flex items-center justify-between px-3 py-2 bg-blue-50 dark:bg-primary/10 rounded-xl border border-blue-100 dark:border-primary/20">
                      <span className="text-xs font-semibold text-blue-700 dark:text-primary">Макс. балл за урок (сумма критериев)</span>
                      <span className="text-sm font-bold text-blue-800 dark:text-foreground">
                    {lessonCriteriaFormInline.reduce((s, c) => s + (c.max_points || 0), 0)}
                  </span>
                    </div>
                  </div>
              )}
            </div>

            <hr className="border-slate-100 dark:border-border" />

            <div className="flex gap-3 pt-1">
              <button
                  onClick={handleSaveLesson}
                  disabled={savingLesson}
                  type="button"
                  className="flex-1 py-2.5 bg-gradient-to-r from-blue-600 to-blue-500 text-white text-sm font-semibold rounded-xl hover:from-blue-700 hover:to-blue-600 shadow-md shadow-blue-100 dark:shadow-none disabled:opacity-60"
              >
                {savingLesson ? 'Сохранение...' : editingLesson ? 'Сохранить изменения' : 'Создать урок'}
              </button>
              <button
                  onClick={() => setLessonModalOpen(false)}
                  type="button"
                  className="flex-1 py-2.5 bg-slate-100 dark:bg-muted text-slate-700 dark:text-foreground text-sm font-medium rounded-xl hover:bg-slate-200 dark:hover:bg-muted/80"
              >
                Отмена
              </button>
            </div>
          </div>
        </Modal>

        <Modal
            open={!!reviewModal}
            onClose={() => setReviewModal(null)}
            title={
              reviewModal?.status === 'ACCEPTED'
                  ? `Работа: ${reviewModal?.account_nickname ?? ''}`
                  : `Проверить работу: ${reviewModal?.account_nickname ?? ''}`
            }
        >
          <div className="p-6 space-y-4">
            {reviewModal && (
                <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground flex items-center gap-2">
                    <History className="size-3.5" /> История проверок
                  </p>
                  {historyLoading ? (
                      <p className="text-xs text-muted-foreground">Загрузка…</p>
                  ) : reviewHistory.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Пока нет записей (после следующих проверок появятся здесь)</p>
                  ) : (
                      <ul className="space-y-2 max-h-40 overflow-y-auto text-xs">
                        {reviewHistory.map((h) => {
                          const isStudentReply = (h as any).entry_kind === 'STUDENT_REPLY';
                          return (
                              <li key={h.id} className={`rounded-lg border px-2.5 py-2 ${isStudentReply ? 'border-primary/20 bg-primary/5' : 'border-border bg-card/80'}`}>
                                <div className="flex justify-between gap-2 text-muted-foreground">
                                  <span>{new Date(h.created_at.replace(' ', 'T')).toLocaleString('ru')}</span>
                                  <span className={isStudentReply ? 'text-primary' : ''}>
                          {isStudentReply ? '👤 ' : '📋 '}{h.reviewer_nickname ?? '—'}
                        </span>
                                </div>
                                {!isStudentReply && <div className="text-foreground mt-0.5 font-medium">{historyStatusRu(h.status_after)}</div>}
                                {h.score != null && (
                                    <div className="text-foreground mt-0.5">Балл: {h.score}</div>
                                )}
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
                          );
                        })}
                      </ul>
                  )}
                </div>
            )}

            {reviewModal && (
                <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Сданная работа</p>
                  {reviewModal.text_content != null && String(reviewModal.text_content).trim() !== '' ? (
                      <div>
                        <p className="text-xs font-medium text-foreground mb-1.5">Текст</p>
                        <div className="text-sm text-foreground whitespace-pre-wrap rounded-lg border border-border bg-card px-3 py-2.5 max-h-48 overflow-y-auto">
                          {reviewModal.text_content}
                        </div>
                      </div>
                  ) : null}
                  {reviewModal.file_name && reviewModal.file_name_in_directory ? (
                      <div>
                        <p className="text-xs font-medium text-foreground mb-1.5">Файл</p>
                        <button
                            type="button"
                            onClick={() =>
                                filesApi.downloadFile(reviewModal.file_name_in_directory!, reviewModal.file_name!)
                            }
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card text-sm font-medium text-primary hover:bg-muted/50 transition-colors"
                        >
                          <Paperclip className="size-4 shrink-0" />
                          <span className="truncate">{reviewModal.file_name}</span>
                          <Download className="size-4 shrink-0 opacity-70" />
                        </button>
                      </div>
                  ) : null}
                  {!reviewModal.text_content?.trim() && !reviewModal.file_name ? (
                      <p className="text-sm text-muted-foreground">Нет текста и файла в ответе (проверьте данные на сервере).</p>
                  ) : null}
                </div>
            )}

            {reviewModal?.status === 'ACCEPTED' && reviewModal.score != null && (
                <div className="rounded-xl border border-border px-3 py-2 bg-primary/5 text-sm">
                  <span className="text-muted-foreground">Итоговый балл: </span>
                  <span className="font-semibold text-foreground">
                {reviewModal.score}/{reviewModal.max_score ?? '—'}
              </span>
                </div>
            )}

            {reviewModal?.status === 'ACCEPTED' && reviewModal.criterion_grades && reviewModal.criterion_grades.length > 0 && (
                <div className="rounded-xl border border-border p-3 bg-muted/20">
                  <p className="text-xs font-semibold text-muted-foreground mb-2">Оценки по критериям</p>
                  <ul className="space-y-1 text-sm">
                    {reviewModal.criterion_grades.map((g) => (
                        <li key={g.id} className="flex justify-between gap-2">
                          <span className="text-foreground">{g.criterion_name}</span>
                          <span className="font-medium tabular-nums">
                      {g.points}/{g.max_points}
                    </span>
                        </li>
                    ))}
                  </ul>
                </div>
            )}

            {reviewModal?.status === 'ACCEPTED' && reviewModal.reviewer_comment && (
                <div className="rounded-xl border border-border p-3 text-sm bg-muted/20">
                  <p className="text-xs font-semibold text-muted-foreground mb-1">Комментарий при проверке</p>
                  <p className="text-foreground whitespace-pre-wrap">{reviewModal.reviewer_comment}</p>
                </div>
            )}

            {reviewModal?.status === 'ACCEPTED' ? (
                <div className="space-y-3 pt-1">
                  <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground">Добавить комментарий к работе</p>
                    <textarea
                        value={moderatorComment}
                        onChange={e => setModeratorComment(e.target.value)}
                        placeholder="Дополнительные замечания, рекомендации..."
                        rows={2}
                        className="w-full border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 bg-card resize-none"
                    />
                    <div className="flex gap-2">
                      <button
                          onClick={handleAddModeratorComment}
                          disabled={addingModeratorComment || !moderatorComment.trim()}
                          className="flex-1 py-2 bg-primary/10 text-primary text-sm font-semibold rounded-xl hover:bg-primary/15 disabled:opacity-50 border border-primary/20 transition-colors"
                          type="button"
                      >
                        {addingModeratorComment ? 'Сохранение...' : 'Добавить комментарий'}
                      </button>
                      <button
                          onClick={() => { setReviewModal(null); setModeratorComment(''); }}
                          className="px-4 py-2 bg-muted text-foreground text-sm font-medium rounded-xl hover:bg-muted/80 transition-colors"
                          type="button"
                      >
                        Закрыть
                      </button>
                    </div>
                  </div>
                </div>
            ) : currentCriteria.length > 0 ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Статус</label>
                    <div className="flex gap-2">
                      <button
                          onClick={() => setReviewStatus('ACCEPTED')}
                          className={`flex-1 py-2 text-sm font-semibold rounded-xl border transition-all ${
                              reviewStatus === 'ACCEPTED'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                          }`}
                          type="button"
                      >
                        Принять
                      </button>
                      <button
                          onClick={() => setReviewStatus('NEEDS_REVISION')}
                          className={`flex-1 py-2 text-sm font-semibold rounded-xl border transition-all ${
                              reviewStatus === 'NEEDS_REVISION'
                                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                                  : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                          }`}
                          type="button"
                      >
                        На доработку
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-2">Оценка по критериям</label>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {currentCriteria.map(c => {
                        const pts = reviewCriteriaScores[c.id] ?? 0;
                        return (
                            <div key={c.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-slate-700">{c.order_number}. {c.name}</p>
                                {c.description && <p className="text-xs text-slate-400 mt-0.5">{c.description}</p>}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <input
                                    type="range"
                                    min={0}
                                    max={c.max_points}
                                    value={pts}
                                    onChange={e => setReviewCriteriaScores(prev => ({ ...prev, [c.id]: Number(e.target.value) }))}
                                    className="w-20 accent-blue-600"
                                />
                                <span className="text-sm font-bold w-12 text-center rounded-lg py-0.5 text-blue-700 bg-blue-50">
                            {pts}/{c.max_points}
                          </span>
                              </div>
                            </div>
                        );
                      })}
                    </div>
                    <div className="mt-3 flex items-center justify-between px-3 py-2 bg-blue-50 rounded-xl border border-blue-100">
                      <span className="text-sm font-semibold text-blue-700">Итого</span>
                      <span className="text-sm font-bold text-blue-800">
                    {Object.values(reviewCriteriaScores).reduce((s, v) => s + v, 0)}/{currentCriteria.reduce((s, c) => s + c.max_points, 0)}
                  </span>
                    </div>
                  </div>
                </div>
            ) : (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Оценка</label>
                    <div className="flex gap-2">
                      <button
                          onClick={() => setReviewStatus('ACCEPTED')}
                          className={`flex-1 py-2 text-sm font-semibold rounded-xl border transition-all ${
                              reviewStatus === 'ACCEPTED'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                          }`}
                          type="button"
                      >
                        Принять
                      </button>
                      <button
                          onClick={() => setReviewStatus('NEEDS_REVISION')}
                          className={`flex-1 py-2 text-sm font-semibold rounded-xl border transition-all ${
                              reviewStatus === 'NEEDS_REVISION'
                                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                                  : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                          }`}
                          type="button"
                      >
                        На доработку
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Балл (0–{reviewModal?.max_score ?? '?'})</label>
                    <input
                        type="number"
                        min={0}
                        max={reviewModal?.max_score ?? undefined}
                        value={reviewScore}
                        onChange={e => setReviewScore(e.target.value === '' ? '' : Number(e.target.value))}
                        placeholder="Введите баллы"
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-slate-50"
                    />
                  </div>
                </>
            )}

            {reviewModal?.status !== 'ACCEPTED' && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Комментарий (необязательно)</label>
                    <textarea
                        value={reviewComment}
                        onChange={e => setReviewComment(e.target.value)}
                        placeholder="Замечания, рекомендации..."
                        rows={3}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-slate-50 resize-none"
                    />
                  </div>
                  <div className="flex gap-3">
                    <button
                        onClick={currentCriteria.length > 0 ? handleGradeWithCriteria : handleReview}
                        disabled={submitting}
                        className="flex-1 py-2.5 bg-gradient-to-r from-blue-600 to-blue-500 text-white text-sm font-semibold rounded-xl hover:from-blue-700 hover:to-blue-600 disabled:opacity-60"
                        type="button"
                    >
                      {submitting ? 'Сохранение...' : 'Сохранить оценку'}
                    </button>
                    <button
                        onClick={() => setReviewModal(null)}
                        className="flex-1 py-2.5 bg-slate-100 text-slate-700 text-sm font-medium rounded-xl hover:bg-slate-200"
                        type="button"
                    >
                      Отмена
                    </button>
                  </div>
                </>
            )}
          </div>
        </Modal>
      </div>
  );
};