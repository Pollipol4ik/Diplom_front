import React, { useCallback, useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Users, UserCheck, FileStack, School, Loader2 } from 'lucide-react';
import { coursesApi, type CourseLessonResponse, type LessonSubmissionResponse, type HearingSubmissionResponse } from '../api/courses';
import { toast } from 'sonner';

const STATUS_LABELS: Record<string, string> = {
  SUBMITTED: 'На проверке',
  ACCEPTED: 'Принято',
  NEEDS_REVISION: 'На доработку',
};

const CHART_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];

export interface ModeratorCourseStatsProps {
  courseId: number;
  forLaggingStudents?: boolean;
  isIntroduction?: boolean;
  lessons: CourseLessonResponse[];
}

export const ModeratorCourseStats: React.FC<ModeratorCourseStatsProps> = ({ courseId, forLaggingStudents, isIntroduction, lessons }) => {
  const [loading, setLoading] = useState(true);
  const [studentCount, setStudentCount] = useState<number | null>(null);
  const [submissions, setSubmissions] = useState<LessonSubmissionResponse[]>([]);
  const [hearingSubsByLesson, setHearingSubsByLesson] = useState<Map<number, HearingSubmissionResponse[]>>(new Map());

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      // Получаем сводку — бэкенд теперь включает всех учеников школ курса
      const summaryRes = await coursesApi.getCourseSummary(courseId);
      setStudentCount(summaryRes.data.students.length);

      const pageSize = 150;
      let page = 0;
      let totalPages = 1;
      const all: LessonSubmissionResponse[] = [];
      do {
        const r = await coursesApi.getSubmissionsByCourse(courseId, undefined, page, pageSize);
        all.push(...(r.data.content ?? []));
        totalPages = r.data.total_pages;
        page++;
      } while (page < totalPages);
      setSubmissions(all);

      // Загружаем hearing submissions для всех hearing-уроков
      const hearingLessons = lessons.filter(l => l.category === 'HEARING');
      const hearingMap = new Map<number, HearingSubmissionResponse[]>();
      await Promise.all(
          hearingLessons.map(async (l) => {
            try {
              const r = await coursesApi.getHearingSubmissions(l.id);
              hearingMap.set(l.id, r.data ?? []);
            } catch {
              hearingMap.set(l.id, []);
            }
          }),
      );
      setHearingSubsByLesson(hearingMap);
    } catch {
      toast.error('Не удалось загрузить статистику курса');
      setStudentCount(null);
      setSubmissions([]);
      setHearingSubsByLesson(new Map());
    } finally {
      setLoading(false);
    }
  }, [courseId, lessons]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const uniqueAuthors = new Set(submissions.map((s) => s.account_id)).size;
  const totalTurnIns = submissions.length;

  const byStatus: Record<string, number> = {};
  submissions.forEach((s) => {
    byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
  });
  const pieData = Object.entries(byStatus).map(([key, value]) => ({
    name: STATUS_LABELS[key] ?? key,
    value,
  }));

  const perLesson: Record<number, { title: string; count: number; order: number }> = {};
  const displayLessons = isIntroduction
      ? lessons.filter(l => l.category !== 'HEARING')
      : lessons;
  displayLessons.forEach((l) => {
    perLesson[l.id] = { title: l.title, count: 0, order: l.order_number };
  });
  submissions.forEach((s) => {
    // For introductory courses skip hearing-related submissions
    if (isIntroduction) {
      const lesson = lessons.find(l => l.id === s.lesson_id);
      if (lesson?.category === 'HEARING') return;
    }
    if (!perLesson[s.lesson_id]) {
      perLesson[s.lesson_id] = {
        title: s.lesson_title || `Урок #${s.lesson_id}`,
        count: 0,
        order: 999,
      };
    }
    perLesson[s.lesson_id].count += 1;
  });

  // Добавляем hearing submissions в статистику по урокам
  if (!isIntroduction) {
    hearingSubsByLesson.forEach((subs, lessonId) => {
      if (!perLesson[lessonId]) {
        const lesson = lessons.find(l => l.id === lessonId);
        if (lesson) {
          perLesson[lessonId] = { title: lesson.title, count: 0, order: lesson.order_number };
        }
      }
      if (perLesson[lessonId]) {
        perLesson[lessonId].count += subs.length;
      }
    });
  }

  const barData = Object.entries(perLesson)
      .map(([, v]) => ({
        name:
            v.title.length > 22
                ? `${v.title.slice(0, 20)}…`
                : v.title,
        fullTitle: v.title,
        count: v.count,
        order: v.order,
      }))
      .sort((a, b) => a.order - b.order);

  if (loading) {
    return (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card px-6 py-12 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          <span className="text-sm">Загрузка статистики…</span>
        </div>
    );
  }

  return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
              icon={<School className="size-5 text-primary" />}
              label={forLaggingStudents ? 'Отстающих в курсе' : isIntroduction ? 'Учеников (вводный курс)' : 'Учеников в курсе'}
              value={studentCount == null ? '—' : String(studentCount)}
              hint={forLaggingStudents ? 'Ученики с флагом отстающий' : isIntroduction ? 'Все ученики школ курса' : 'Ученики, переведённые на целевой курс'}
          />
          <StatCard
              icon={<Users className="size-5 text-primary" />}
              label="Уникальных авторов работ"
              value={String(uniqueAuthors)}
              hint="Сколько разных учеников сдало хотя бы одну работу"
          />
          <StatCard
              icon={<FileStack className="size-5 text-primary" />}
              label="Всего сдач"
              value={String(totalTurnIns)}
              hint="Все записи работ по урокам"
          />
          <StatCard
              icon={<UserCheck className="size-5 text-primary" />}
              label="Принято работ"
              value={String(byStatus.ACCEPTED ?? 0)}
              hint="Статус «Принято»"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-foreground mb-1">Распределение по статусам</h3>
            <p className="text-xs text-muted-foreground mb-3">Доля сдач по этапу проверки</p>
            {pieData.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Пока нет сданных работ</p>
            ) : (
                <div className="h-[240px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={88}>
                        {pieData.map((_, i) => (
                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                          contentStyle={{
                            background: 'var(--card)',
                            border: '1px solid var(--border)',
                            borderRadius: '12px',
                            color: 'var(--card-foreground)',
                          }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-foreground mb-1">Сдачи по урокам</h3>
            <p className="text-xs text-muted-foreground mb-3">Сколько работ пришло по каждому заданию</p>
            {barData.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Нет данных по урокам</p>
            ) : (
                <div className="h-[260px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={barData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border opacity-60" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-28} textAnchor="end" height={70} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip
                          formatter={(value: number) => [value, 'Сдач']}
                          labelFormatter={(_, payload) =>
                              payload?.[0]?.payload?.fullTitle ? String(payload[0].payload.fullTitle) : ''
                          }
                          contentStyle={{
                            background: 'var(--card)',
                            border: '1px solid var(--border)',
                            borderRadius: '12px',
                            color: 'var(--card-foreground)',
                          }}
                      />
                      <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                        {barData.map((_, i) => (
                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
            )}
          </div>
        </div>
      </div>
  );
};

function StatCard(props: { icon: React.ReactNode; label: string; value: string; hint: string }) {
  return (
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5">{props.icon}</div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground leading-tight">{props.label}</p>
            <p className="text-2xl font-bold text-foreground tabular-nums mt-1">{props.value}</p>
            <p className="text-[11px] text-muted-foreground/80 mt-1.5 leading-snug">{props.hint}</p>
          </div>
        </div>
      </div>
  );
}