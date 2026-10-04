import React, { useCallback, useEffect, useState, useMemo } from 'react';
import {
  Lightbulb, Search, Plus, Edit2, Trash2, ChevronDown, Loader2,
  MessageSquare, ExternalLink, X, Send, Users, ArrowUpDown, BookOpen,
} from 'lucide-react';
import { ideaBankApi, type IdeaBankEntryResponse } from '../app/api/ideaBank';
import { coursesApi, type CourseShortResponse } from '../app/api/courses';
import { courseGroupsApi, type CourseGroupResponse } from '../app/api/courseGroups';
import { accountsApi } from '../app/api/accounts';
import { Pagination } from '../app/components/Pagination';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

export const IdeaBankPage: React.FC = () => {
  const { isModerator, isAdmin } = useAuth();
  const navigate = useNavigate();

  const [ideas, setIdeas] = useState<IdeaBankEntryResponse[]>([]);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortBy, setSortBy] = useState<'date_desc' | 'date_asc' | 'score_desc' | 'score_asc'>('date_desc');
  const [filterCourseId, setFilterCourseId] = useState<number | ''>('');
  const [filterCourseText, setFilterCourseText] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingIdea, setEditingIdea] = useState<IdeaBankEntryResponse | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formComments, setFormComments] = useState('');
  const [formScore, setFormScore] = useState<number | ''>('');

  // assign-to-group modal
  const [assignIdea, setAssignIdea] = useState<IdeaBankEntryResponse | null>(null);
  const [detailsIdea, setDetailsIdea] = useState<IdeaBankEntryResponse | null>(null);
  const [myCourses, setMyCourses] = useState<Array<{ course_id: number; course_name: string }>>([]);
  const [assignCourseId, setAssignCourseId] = useState<number | ''>('');
  const [courseSchools, setCourseSchools] = useState<Array<{ id: number; name: string }>>([]);
  const [courseGroups, setCourseGroups] = useState<CourseGroupResponse[]>([]);
  const [assigning, setAssigning] = useState(false);

  // create group (same as hearings)
  const [groupSchoolId, setGroupSchoolId] = useState<number | ''>('');
  const [schoolStudents, setSchoolStudents] = useState<Array<{ id: number; nickname: string; first_name?: string; last_name?: string }>>([]);
  const [selectedStudents, setSelectedStudents] = useState<number[]>([]);
  const [creatingGroup, setCreatingGroup] = useState(false);

  useEffect(() => {
    if (!isModerator) { toast.error('Недостаточно прав'); navigate('/'); return; }
    // Admin sees all courses; moderator sees only assigned ones
    const loadCourses: Promise<Array<{ course_id: number; course_name: string }>> = isAdmin
        ? coursesApi.adminGetAll(0, 200).then(r =>
            (r.data.content ?? []).map((c: CourseShortResponse) => ({ course_id: c.id, course_name: c.name }))
        )
        : coursesApi.myAssignedCourses().then(r =>
            (r.data ?? []).map((c: any) => ({ course_id: c.course_id, course_name: c.course_name }))
        );
    loadCourses.then(list => setMyCourses(list)).catch(() => setMyCourses([]));
  }, [isModerator, isAdmin]);

  const openAssign = (idea: IdeaBankEntryResponse) => {
    setAssignIdea(idea);
    setAssignCourseId('');
    setCourseSchools([]);
    setCourseGroups([]);
    setGroupSchoolId('');
    setSchoolStudents([]);
    setSelectedStudents([]);
  };

  useEffect(() => {
    if (!assignIdea || !assignCourseId) return;
    const cid = Number(assignCourseId);
    Promise.all([
      coursesApi.getCourseSchools(cid).then(r => setCourseSchools(r.data ?? [])).catch(() => setCourseSchools([])),
      courseGroupsApi.getGroups(cid).then(r => setCourseGroups(r.data ?? [])).catch(() => setCourseGroups([])),
    ]).catch(() => {});
  }, [assignIdea?.id, assignCourseId]);

  useEffect(() => {
    if (!groupSchoolId || !assignCourseId) { setSchoolStudents([]); return; }
    // Загружаем только зачисленных на курс учеников из выбранной школы
    coursesApi.getCourseSummary(Number(assignCourseId))
        .then(r => {
          const allEnrolled = (r.data?.students ?? []).map((s: any) => ({
            id: s.account_id,
            nickname: s.nickname,
            first_name: s.first_name,
            last_name: s.last_name,
          }));
          // Дополнительно фильтруем по выбранной школе через getBySchool для получения school_id
          accountsApi.getBySchool(Number(groupSchoolId), 0, 500)
              .then(sr => {
                const schoolIds = new Set((sr.data?.content ?? []).map((s: any) => s.id));
                setSchoolStudents(allEnrolled.filter(s => schoolIds.has(s.id)));
              })
              .catch(() => setSchoolStudents(allEnrolled));
        })
        .catch(() => setSchoolStudents([]));
  }, [groupSchoolId, assignCourseId]);

  const handleAssignToGroup = async (groupId: number) => {
    if (!assignIdea) return;
    setAssigning(true);
    try {
      await ideaBankApi.assignToGroup(assignIdea.id, groupId);
      toast.success('Тема передана группе');
      setAssignIdea(null);
      fetchIdeas(page);
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? 'Ошибка');
    } finally {
      setAssigning(false);
    }
  };

  const handleCreateGroupFromIdea = async () => {
    if (!assignIdea) return;
    if (!assignCourseId) return toast.error('Выберите курс');
    if (!groupSchoolId) return toast.error('Выберите школу');
    if (selectedStudents.length === 0) return toast.error('Выберите учеников');
    setCreatingGroup(true);
    try {
      const cid = Number(assignCourseId);
      const r = await courseGroupsApi.createGroup(cid, {
        title: assignIdea.title,
        description: assignIdea.description ?? undefined,
        school_id: Number(groupSchoolId),
        student_ids: selectedStudents,
      });
      await ideaBankApi.assignToGroup(assignIdea.id, r.data.id);
      toast.success('Создана группа и тема назначена');
      setAssignIdea(null);
      fetchIdeas(page);
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? 'Ошибка создания группы');
    } finally {
      setCreatingGroup(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchIdeas = useCallback(async (p = 0) => {
    setLoading(true);
    try {
      const res = await ideaBankApi.getAll(
          p,
          10,
          debouncedSearch || undefined,
          sortBy,
          undefined,
          undefined,
          filterCourseId !== '' ? Number(filterCourseId) : undefined,
      );
      setIdeas(res.data.content);
      setTotalPages(res.data.total_pages);
      setPage(p);
    } catch { toast.error('Ошибка загрузки идей'); } finally { setLoading(false); }
  }, [debouncedSearch, sortBy, filterCourseId]);

  useEffect(() => { fetchIdeas(0); }, [fetchIdeas]);

  const handleAdd = async () => {
    if (!formTitle.trim()) return;
    try {
      await ideaBankApi.create({
        title: formTitle.trim(),
        description: formDesc.trim() || undefined,
        comments: formComments.trim() || undefined,
        score: formScore === '' ? undefined : Number(formScore),
      });
      toast.success('Идея добавлена');
      closeModal();
      fetchIdeas(0);
    } catch (e: any) { toast.error(e.response?.data?.message ?? 'Ошибка'); }
  };

  const handleUpdate = async () => {
    if (!editingIdea) return;
    try {
      await ideaBankApi.update(editingIdea.id, {
        title: formTitle.trim() || undefined,
        description: formDesc.trim(),
        comments: formComments.trim(),
        score: formScore === '' ? undefined : Number(formScore),
      });
      toast.success('Идея обновлена');
      closeModal();
      fetchIdeas(page);
    } catch (e: any) { toast.error(e.response?.data?.message ?? 'Ошибка'); }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Удалить идею?')) return;
    try {
      await ideaBankApi.delete(id);
      toast.success('Удалено');
      fetchIdeas(page);
    } catch { toast.error('Ошибка удаления'); }
  };

  const openEdit = (idea: IdeaBankEntryResponse) => {
    setEditingIdea(idea);
    setFormTitle(idea.title);
    setFormDesc(idea.description ?? '');
    setFormComments(idea.comments ?? '');
    setFormScore(idea.score ?? 0);
    setShowAddModal(true);
  };

  const closeModal = () => {
    setShowAddModal(false);
    setEditingIdea(null);
    setFormTitle('');
    setFormDesc('');
    setFormComments('');
    setFormScore('');
  };

  return (
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center gap-4 mb-8">
          <div className="size-14 shrink-0 bg-gradient-to-br from-amber-400 to-orange-500 rounded-2xl flex items-center justify-center shadow-lg shadow-amber-200">
            <Lightbulb className="size-7 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-foreground">Банк идей</h1>
            <p className="text-muted-foreground text-base mt-0.5">Архив тем проектов для повторного использования</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-8">
          {/* Поиск по названию */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Поиск по названию..."
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          {/* Поиск по курсу — текстовый */}
          <div className="relative">
            <BookOpen className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
                value={filterCourseText}
                onChange={e => {
                  const val = e.target.value;
                  setFilterCourseText(val);
                  if (!val.trim()) { setFilterCourseId(''); return; }
                  const match = myCourses.find(c => c.course_name.toLowerCase() === val.toLowerCase());
                  setFilterCourseId(match ? match.course_id : '');
                }}
                list="idea-bank-courses-list"
                placeholder="Поиск по курсу..."
                className="w-full pl-9 pr-8 py-2.5 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                autoComplete="off"
            />
            {filterCourseText && (
                <button onClick={() => { setFilterCourseText(''); setFilterCourseId(''); }} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted transition">
                  <X className="size-3.5 text-muted-foreground" />
                </button>
            )}
            <datalist id="idea-bank-courses-list">
              {myCourses.map(c => <option key={c.course_id} value={c.course_name} />)}
            </datalist>
          </div>
          {/* Сортировка + кнопка добавить */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <ArrowUpDown className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as typeof sortBy)}
                  className="w-full pl-9 pr-8 py-2.5 rounded-xl border border-border bg-card text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="date_desc">Новые сначала</option>
                <option value="date_asc">Старые сначала</option>
                <option value="score_desc">Баллы ↓</option>
                <option value="score_asc">Баллы ↑</option>
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            </div>
            <button
                onClick={() => { setEditingIdea(null); setFormTitle(''); setFormDesc(''); setFormComments(''); setShowAddModal(true); }}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium text-sm shadow-sm hover:opacity-90 transition disabled:opacity-40 shrink-0"
            >
              <Plus className="size-4" />
              Добавить
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {loading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="size-5 animate-spin mr-2" />
                <span className="text-sm">Загрузка...</span>
              </div>
          ) : ideas.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Lightbulb className="size-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">Банк идей пуст</p>
              </div>
          ) : (
              <div className="flex flex-col gap-4">
                {ideas.map(idea => (
                    <button
                        key={idea.id}
                        type="button"
                        onClick={() => setDetailsIdea(idea)}
                        className="text-left w-full rounded-2xl border border-border bg-card p-6 shadow-sm hover:shadow-md transition-shadow"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <p className="text-base font-semibold text-foreground leading-snug">{idea.title}</p>
                          <p className="text-[11px] text-muted-foreground mt-1">
                            @{idea.created_by_nickname} · {new Date(idea.created_at).toLocaleDateString('ru-RU')}
                            {idea.course_name && (
                                <span className="ml-1.5 px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100 text-[10px] font-medium">{idea.course_name}</span>
                            )}
                          </p>
                        </div>
                        <span className="px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 shrink-0">
                      {idea.score ?? 0} баллов
                    </span>
                      </div>
                    </button>
                ))}
              </div>
          )}

          {totalPages > 1 && (
              <Pagination currentPage={page} totalPages={totalPages} onPageChange={fetchIdeas} />
          )}
        </div>

        {/* Add/Edit modal */}
        {showAddModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={closeModal}>
              <div className="bg-card rounded-2xl shadow-xl border border-border w-full max-w-lg p-6 mx-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-foreground">
                    {editingIdea ? 'Редактировать идею' : 'Новая идея'}
                  </h3>
                  <button onClick={closeModal} className="p-1 rounded-lg hover:bg-muted transition">
                    <X className="size-4" />
                  </button>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Название темы *</label>
                    <input
                        value={formTitle}
                        onChange={e => setFormTitle(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Описание</label>
                    <textarea
                        value={formDesc}
                        onChange={e => setFormDesc(e.target.value)}
                        rows={3}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Комментарии / заметки</label>
                    <textarea
                        value={formComments}
                        onChange={e => setFormComments(e.target.value)}
                        rows={3}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
                        placeholder="Идеи, обсуждения, контекст..."
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Баллы</label>
                    <input
                        type="number"
                        min={0}
                        value={formScore}
                        onChange={e => setFormScore(e.target.value === '' ? '' : Number(e.target.value))}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                        placeholder="0"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-5">
                  <button
                      onClick={closeModal}
                      className="px-4 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted transition"
                  >
                    Отмена
                  </button>
                  <button
                      onClick={editingIdea ? handleUpdate : handleAdd}
                      disabled={!formTitle.trim()}
                      className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium shadow-sm hover:opacity-90 transition disabled:opacity-40"
                  >
                    {editingIdea ? 'Сохранить' : 'Добавить'}
                  </button>
                </div>
              </div>
            </div>
        )}

        {/* Assign to group modal */}
        {assignIdea && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setAssignIdea(null)}>
              <div className="bg-card rounded-2xl shadow-xl border border-border w-full max-w-2xl p-6 mx-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">Передать тему группе</h3>
                    <p className="text-xs text-muted-foreground mt-1">{assignIdea.title}</p>
                  </div>
                  <button onClick={() => setAssignIdea(null)} className="p-1 rounded-lg hover:bg-muted transition">
                    <X className="size-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Курс</label>
                    <div className="relative">
                      <select
                          value={assignCourseId}
                          onChange={(e) => setAssignCourseId(e.target.value ? Number(e.target.value) : '')}
                          className="w-full pr-8 px-3 py-2 rounded-lg border border-border bg-background text-sm appearance-none"
                      >
                        <option value="">Выберите курс</option>
                        {myCourses.map(c => (
                            <option key={c.course_id} value={c.course_id}>{c.course_name}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="block text-xs font-medium text-muted-foreground">Школа группы</label>
                  <div className="relative">
                    <select
                        value={groupSchoolId}
                        onChange={(e) => setGroupSchoolId(e.target.value ? Number(e.target.value) : '')}
                        className="w-full pr-8 px-3 py-2 rounded-lg border border-border bg-background text-sm appearance-none"
                        disabled={!assignCourseId}
                    >
                      <option value="">Выберите школу</option>
                      {courseSchools.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                  </div>

                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">Ученики ({selectedStudents.length} выбрано)</p>
                    <div className="max-h-64 overflow-y-auto border border-border rounded-xl divide-y divide-border">
                      {(() => {
                        const busyIds = new Set<number>();
                        courseGroups.forEach(g => g.members.forEach(m => busyIds.add(m.account_id)));
                        return schoolStudents.filter(s => !busyIds.has(s.id));
                      })().map(st => (
                          <label key={st.id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={selectedStudents.includes(st.id)}
                                onChange={e => {
                                  if (e.target.checked) setSelectedStudents(p => [...p, st.id]);
                                  else setSelectedStudents(p => p.filter(x => x !== st.id));
                                }}
                            />
                            <span className="text-foreground">{st.last_name} {st.first_name}</span>
                            <span className="text-xs text-muted-foreground ml-auto">@{st.nickname}</span>
                          </label>
                      ))}
                      {groupSchoolId && schoolStudents.length === 0 && (
                          <p className="px-3 py-2 text-xs text-muted-foreground">Нет учеников</p>
                      )}
                      {!groupSchoolId && (
                          <p className="px-3 py-2 text-xs text-muted-foreground">Выберите школу</p>
                      )}
                    </div>
                  </div>

                  <button
                      type="button"
                      onClick={handleCreateGroupFromIdea}
                      disabled={!assignCourseId || !groupSchoolId || selectedStudents.length === 0 || creatingGroup || assigning}
                      className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50"
                  >
                    {creatingGroup ? '...' : 'Создать группу и передать тему'}
                  </button>
                </div>
              </div>
            </div>
        )}

        {/* Idea details modal */}
        {detailsIdea && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDetailsIdea(null)}>
              <div className="bg-card rounded-2xl shadow-xl border border-border w-full max-w-2xl p-6 mx-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold text-foreground truncate">{detailsIdea.title}</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      @{detailsIdea.created_by_nickname} · {new Date(detailsIdea.created_at).toLocaleDateString('ru-RU')} · {detailsIdea.score ?? 0} баллов
                    </p>
                    {detailsIdea.course_name && (
                        <span className="inline-block mt-1 px-2 py-0.5 rounded-lg bg-blue-50 text-blue-600 border border-blue-100 text-[10px] font-medium">
                          {detailsIdea.course_name}
                        </span>
                    )}
                  </div>
                  <button onClick={() => setDetailsIdea(null)} className="p-1 rounded-lg hover:bg-muted transition">
                    <X className="size-4" />
                  </button>
                </div>

                {detailsIdea.description && (
                    <div className="mb-4">
                      <p className="text-xs font-medium text-muted-foreground mb-1">Описание</p>
                      <p className="text-sm text-foreground whitespace-pre-wrap">{detailsIdea.description}</p>
                    </div>
                )}
                {detailsIdea.comments && (
                    <div className="mb-4">
                      <p className="text-xs font-medium text-muted-foreground mb-1">История / комментарии</p>
                      <p className="text-sm text-foreground whitespace-pre-wrap">{detailsIdea.comments}</p>
                    </div>
                )}

                <div className="flex items-center justify-between gap-2">
                  {detailsIdea.source_project_id ? (
                      <button
                          onClick={() => navigate(`/projects/${detailsIdea.source_project_id}`)}
                          className="flex items-center gap-1 text-sm text-primary hover:underline"
                      >
                        <ExternalLink className="size-4" /> Проект #{detailsIdea.source_project_id}
                      </button>
                  ) : <span />}
                  <div className="flex gap-2">
                    <button
                        onClick={() => { openAssign(detailsIdea); setDetailsIdea(null); }}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold"
                    >
                      <Send className="size-4" />
                      Назначить
                    </button>
                    <button
                        onClick={() => openEdit(detailsIdea)}
                        className="px-4 py-2 rounded-xl text-sm font-semibold border border-border hover:bg-muted transition"
                    >
                      Редактировать
                    </button>
                    <button
                        onClick={() => handleDelete(detailsIdea.id)}
                        className="px-4 py-2 rounded-xl text-sm font-semibold text-red-600 border border-border hover:bg-red-50 transition"
                    >
                      Удалить
                    </button>
                  </div>
                </div>
              </div>
            </div>
        )}
      </div>
  );
};