import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
    ArrowLeft, Search, Award, FileSpreadsheet,
    GraduationCap, RefreshCw, Users, School, CheckCircle
} from 'lucide-react';
import { coursesApi, type CourseShortResponse, type CourseLessonResponse, type GradingCriterionResponse, type HearingSubmissionResponse } from '../app/api/courses';
import { courseGroupsApi, type CourseGroupResponse } from '../app/api/courseGroups';
import { useAuth } from '../context/AuthContext';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';

interface DefenseRow {
    group_id: number;
    group_title: string;
    members: string;
    school: string;
    submission_id: number | null;
    /** grades — баллы по критериям (criterion_id -> points) */
    grades: Record<number, number | null>;
    total: number | null;
    /** Оценка по ревью (если нужен отдельный балл помимо суммы критериев) */
    reviewGrade: number | null;
}

export const AdminCourseWorksPage: React.FC = () => {
    const { courseId } = useParams<{ courseId: string }>();
    const { isAdmin } = useAuth();
    const navigate = useNavigate();

    const [course, setCourse] = useState<CourseShortResponse | null>(null);
    const [loading, setLoading] = useState(true);

    const [defenseLoading, setDefenseLoading] = useState(false);
    const [defenseLesson, setDefenseLesson] = useState<CourseLessonResponse | null>(null);
    const [defenseCriteria, setDefenseCriteria] = useState<GradingCriterionResponse[]>([]);
    const [defenseRows, setDefenseRows] = useState<DefenseRow[]>([]);
    const [defenseSearch, setDefenseSearch] = useState('');

    useEffect(() => {
        if (!isAdmin) { toast.error('Недостаточно прав'); navigate('/admin'); return; }
        loadData();
    }, [courseId, isAdmin]);

    const loadData = async () => {
        setLoading(true);
        try {
            const [courseRes, lessonsRes] = await Promise.all([
                coursesApi.adminGetAllCourses(0, 200).then(r => r.data.content.find((c: CourseShortResponse) => c.id === Number(courseId))),
                coursesApi.getLessons(Number(courseId)),
            ]);
            if (!courseRes) { toast.error('Курс не найден'); navigate('/admin'); return; }
            setCourse(courseRes);
            const defLesson = lessonsRes.data.find((l: CourseLessonResponse) => l.hearing_stage === 'CONFERENCE_DEFENSE');
            if (defLesson) {
                setDefenseLesson(defLesson);
                await loadDefenseData(defLesson);
            }
        } catch { toast.error('Ошибка загрузки'); } finally { setLoading(false); }
    };

    const loadDefenseData = async (lesson: CourseLessonResponse) => {
        setDefenseLoading(true);
        try {
            const [criteriaRes, groupsRes, subsRes] = await Promise.all([
                coursesApi.getLessonCriteria(lesson.id),
                courseGroupsApi.getGroups(Number(courseId)),
                coursesApi.getHearingSubmissions(lesson.id),
            ]);

            const crit: GradingCriterionResponse[] = criteriaRes.data ?? [];
            setDefenseCriteria(crit);

            const groups: CourseGroupResponse[] = groupsRes.data ?? [];
            const subs: HearingSubmissionResponse[] = subsRes.data ?? [];

            // Создаём карту: group_id -> hearing_submission
            const subByGroup = new Map<number, HearingSubmissionResponse>(subs.map(s => [s.group_id, s]));

            // Для каждой группы извлекаем оценки из ревью
            const rows: DefenseRow[] = groups.map(g => {
                const sub = subByGroup.get(g.id);

                // Инициализируем пустые оценки по критериям
                const grades: Record<number, number | null> = {};
                crit.forEach(c => { grades[c.id] = null; });

                let reviewGrade: number | null = null;
                let total: number | null = null;

                if (sub && sub.reviews && sub.reviews.length > 0) {
                    // Берём последнюю (актуальную) рецензию
                    const latestReview = [...sub.reviews].sort(
                        (a, b) => new Date(b.reviewed_at).getTime() - new Date(a.reviewed_at).getTime()
                    )[0];

                    reviewGrade = latestReview.grade ?? null;

                    // Если в ревью есть grade — это сумма баллов по критериям
                    // Для распределения по отдельным критериям нужны детальные данные
                    // В текущей модели hearing_review хранит только суммарный grade
                    // TODO: если нужно распределение по критериям, нужно расширить модель
                    if (reviewGrade !== null) {
                        total = reviewGrade;
                    }
                }

                const members = (g.members ?? [])
                    .map(m => [m.last_name, m.first_name].filter(Boolean).join(' ') || m.nickname)
                    .join(', ');

                return {
                    group_id: g.id,
                    group_title: g.title,
                    members,
                    school: g.school_name ?? '—',
                    submission_id: sub?.id ?? null,
                    grades,
                    total,
                    reviewGrade,
                };
            }).sort((a, b) => (b.total ?? -1) - (a.total ?? -1));

            setDefenseRows(rows);
        } catch (e: any) {
            toast.error(e.response?.data?.message ?? 'Ошибка загрузки данных защиты');
        } finally {
            setDefenseLoading(false);
        }
    };

    const exportXlsx = () => {
        if (!course || defenseRows.length === 0) return;
        const headers = ['Тема / Группа', 'Участники (ФИО)', 'Школа', 'Статус',
            ...defenseCriteria.map((c, i) => `К${i+1}. ${c.name} (0-${c.max_points})`), 'Итого баллов'];
        const data = defenseRows.map(r => [
            r.group_title,
            r.members,
            r.school,
            r.submission_id ? (r.total !== null ? 'Проверено' : 'Сдано') : 'Не сдано',
            ...defenseCriteria.map(c => r.grades[c.id] ?? ''),
            r.total ?? ''
        ]);
        const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
        ws['!cols'] = [{wch:40},{wch:36},{wch:22},{wch:12},...defenseCriteria.map(()=>({wch:16})),{wch:12}];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Защита проекта');
        XLSX.writeFile(wb, `Итоги_защиты_${course.name.replace(/[^а-яА-ЯёЁa-zA-Z0-9]/g,'_')}.xlsx`);
    };

    const maxTotal = defenseCriteria.reduce((s, c) => s + c.max_points, 0);
    const reviewedCount = defenseRows.filter(r => r.total !== null).length;

    const filtered = useMemo(() => {
        if (!defenseSearch.trim()) return defenseRows;
        const q = defenseSearch.toLowerCase();
        return defenseRows.filter(r =>
            r.group_title.toLowerCase().includes(q) ||
            r.members.toLowerCase().includes(q) ||
            r.school.toLowerCase().includes(q)
        );
    }, [defenseRows, defenseSearch]);

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="max-w-screen-xl mx-auto px-6 py-8 space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Link to="/courses" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
                    <ArrowLeft className="size-4" /> Назад к курсам
                </Link>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="w-11 h-11 bg-gradient-to-br from-indigo-600 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200">
                        <Award className="size-5 text-white" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-foreground">Итоги защиты проектов</h1>
                        <p className="text-sm text-muted-foreground mt-0.5">{course?.name}</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <button onClick={loadData} className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground border border-border rounded-xl hover:bg-muted transition-colors">
                        <RefreshCw className="size-4" /> Обновить
                    </button>
                    {defenseRows.length > 0 && (
                        <button onClick={exportXlsx} className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm">
                            <FileSpreadsheet className="size-4" /> Скачать XLSX
                        </button>
                    )}
                </div>
            </div>

            {/* No defense lesson */}
            {!defenseLesson && !defenseLoading && (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                    <Award className="size-12 text-muted-foreground/30 mb-4" />
                    <p className="text-muted-foreground font-medium">Этап «Защита проекта» не найден в этом курсе</p>
                    <p className="text-sm text-muted-foreground/70 mt-1">Убедитесь, что в курсе есть урок с hearing_stage = CONFERENCE_DEFENSE</p>
                </div>
            )}

            {defenseLesson && (
                <>
                    {/* Criteria legend */}
                    <AnimatePresence>
                        {defenseCriteria.length > 0 && (
                            <motion.div
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="bg-card rounded-2xl border border-border p-5 shadow-sm"
                            >
                                <div className="flex items-center justify-between mb-3">
                                    <h2 className="text-sm font-bold text-foreground">Критерии оценивания</h2>
                                    <div className="flex gap-2 text-xs">
                                        <span className="bg-blue-50 text-blue-700 font-semibold px-2.5 py-1 rounded-full border border-blue-100">
                                            Максимум: {maxTotal} баллов
                                        </span>
                                        <span className="bg-emerald-50 text-emerald-700 font-semibold px-2.5 py-1 rounded-full border border-emerald-100">
                                            Проверено: {reviewedCount} / {defenseRows.length}
                                        </span>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
                                    {defenseCriteria.map((c, i) => (
                                        <div key={c.id} className="bg-slate-50 rounded-xl px-3 py-2 border border-slate-100">
                                            <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide">К{i+1}</p>
                                            <p className="text-xs font-medium text-slate-800 mt-0.5 leading-tight line-clamp-2">{c.name}</p>
                                            <p className="text-xs text-blue-600 font-bold mt-1">0–{c.max_points} б.</p>
                                        </div>
                                    ))}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Controls */}
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="relative flex-1 min-w-[220px]">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                            <input
                                type="text"
                                value={defenseSearch}
                                onChange={e => setDefenseSearch(e.target.value)}
                                placeholder="Поиск по теме, ФИО, школе..."
                                className="w-full h-10 pl-9 pr-3 bg-card border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                            />
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Users className="size-4" />
                            <span>Групп: <b className="text-foreground">{filtered.length}</b></span>
                            <span>· Сдали: <b className="text-foreground">{filtered.filter(r => r.submission_id).length}</b></span>
                            {reviewedCount > 0 && (
                                <span>· Ср. балл: <b className="text-foreground">
                                    {(defenseRows.filter(r => r.total != null).reduce((s, r) => s + (r.total ?? 0), 0) / reviewedCount).toFixed(1)}
                                </b> / {maxTotal}</span>
                            )}
                        </div>
                    </div>

                    {/* Loading */}
                    {defenseLoading && (
                        <div className="flex items-center justify-center py-16 gap-3 text-muted-foreground">
                            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                            Загрузка данных защиты...
                        </div>
                    )}

                    {/* Table */}
                    {!defenseLoading && filtered.length > 0 && (
                        <motion.div
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden"
                        >
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                    <tr className="bg-muted/50 border-b border-border">
                                        <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3 min-w-[200px] sticky left-0 bg-muted/50">
                                            Тема / Группа
                                        </th>
                                        <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3 min-w-[180px]">
                                            <span className="flex items-center gap-1"><Users className="size-3.5" />Участники</span>
                                        </th>
                                        <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3 min-w-[130px]">
                                            <span className="flex items-center gap-1"><School className="size-3.5" />Школа</span>
                                        </th>
                                        {defenseCriteria.map((c, i) => (
                                            <th key={c.id} className="text-center text-xs font-semibold text-muted-foreground px-2 py-3 min-w-[56px]">
                                                <div className="flex flex-col items-center gap-0.5">
                                                    <span className="text-blue-600 font-bold">К{i+1}</span>
                                                    <span className="text-muted-foreground font-normal">{c.max_points}б</span>
                                                </div>
                                            </th>
                                        ))}
                                        <th className="text-center text-xs font-bold text-foreground px-3 py-3 min-w-[70px] bg-blue-50 border-l border-blue-100">
                                            Итого
                                            <div className="text-muted-foreground font-normal">{maxTotal}б</div>
                                        </th>
                                    </tr>
                                    </thead>
                                    <tbody>
                                    {filtered.map((row) => {
                                        const pct = row.total != null && maxTotal > 0 ? (row.total / maxTotal) * 100 : null;
                                        return (
                                            <tr key={row.group_id} className={`border-b border-border hover:bg-muted/30 transition-colors ${!row.submission_id ? 'opacity-70' : ''}`}>
                                                <td className="px-4 py-3 sticky left-0 bg-card hover:bg-muted/30">
                                                    <div className="font-semibold text-foreground text-sm leading-tight">{row.group_title}</div>
                                                    {!row.submission_id && (
                                                        <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full font-medium mt-1 inline-block">Не сдано</span>
                                                    )}
                                                    {row.submission_id && row.total === null && (
                                                        <span className="text-[10px] text-yellow-600 bg-yellow-50 px-1.5 py-0.5 rounded-full font-medium mt-1 inline-block flex items-center gap-0.5 w-fit">
                                                            На проверке
                                                        </span>
                                                    )}
                                                    {row.submission_id && row.total !== null && (
                                                        <span className="text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full font-medium mt-1 inline-block flex items-center gap-0.5 w-fit">
                                                            <CheckCircle className="size-2.5" /> Проверено
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-xs text-muted-foreground">{row.members || '—'}</td>
                                                <td className="px-4 py-3 text-xs text-muted-foreground">{row.school}</td>
                                                {defenseCriteria.map(c => {
                                                    const pts = row.grades[c.id];
                                                    const filled = pts != null;
                                                    return (
                                                        <td key={c.id} className="px-2 py-3 text-center">
                                                            {filled ? (
                                                                <span className={`inline-flex items-center justify-center w-9 h-7 rounded-lg text-sm font-bold
                                                                    ${pts === c.max_points ? 'bg-emerald-100 text-emerald-700' :
                                                                    pts === 0 ? 'bg-red-50 text-red-500' :
                                                                        'bg-blue-50 text-blue-700'}`}>
                                                                    {pts}
                                                                </span>
                                                            ) : <span className="text-muted-foreground/40 text-xs">—</span>}
                                                        </td>
                                                    );
                                                })}
                                                <td className="px-3 py-3 text-center bg-blue-50/40 border-l border-blue-100">
                                                    {row.total != null ? (
                                                        <div className="flex flex-col items-center gap-1">
                                                            <span className="text-base font-bold text-foreground">{row.total}</span>
                                                            {pct != null && (
                                                                <div className="w-12 h-1 bg-slate-200 rounded-full">
                                                                    <div
                                                                        className={`h-full rounded-full ${pct >= 80 ? 'bg-emerald-500' : pct >= 60 ? 'bg-blue-500' : pct >= 40 ? 'bg-yellow-500' : 'bg-red-400'}`}
                                                                        style={{ width: `${pct}%` }}
                                                                    />
                                                                </div>
                                                            )}
                                                        </div>
                                                    ) : <span className="text-muted-foreground/40 text-xs">—</span>}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    </tbody>
                                </table>
                            </div>
                        </motion.div>
                    )}

                    {!defenseLoading && defenseRows.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-16 text-center">
                            <GraduationCap className="size-10 text-muted-foreground/30 mb-3" />
                            <p className="text-muted-foreground">Нет групп или работы ещё не поданы</p>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};