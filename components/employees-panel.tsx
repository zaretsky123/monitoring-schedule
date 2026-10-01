"use client";

import { useState } from "react";
import { Archive, Pencil, Plus, Search, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { Employee } from "@/lib/schedule/types";

type Props = {
  employees: Employee[];
  memberIds: string[];
  monthLabel: string;
  onSave: (employee: Employee) => string | null;
  onArchive: (employee: Employee) => void;
  onDelete: (employee: Employee) => string | null;
  onMembership: () => void;
  isUsed: (employeeId: string) => boolean;
};

export function EmployeesPanel({ employees, memberIds, monthLabel, onSave, onArchive, onDelete, onMembership, isUsed }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("current");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDateTime, setEndDateTime] = useState("");
  const [active, setActive] = useState(true);
  const [isTest, setIsTest] = useState(false);
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Employee | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Employee | null>(null);

  function edit(employee: Employee | null) {
    setEditing(employee);
    setName(employee?.name ?? "");
    setStartDate(employee?.startDate ?? "");
    setEndDateTime(employee?.endDateTime ?? "");
    setActive(employee?.active ?? true);
    setIsTest(employee?.isTest ?? false);
    setError("");
    setEditorOpen(true);
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) { setError("Укажите ФИО сотрудника"); return; }
    if (!active && !endDateTime) { setError("Укажите последний допустимый момент окончания смены"); return; }
    if (startDate && endDateTime && `${startDate}T00:00` >= endDateTime) { setError("Окончание работы должно быть позже даты начала"); return; }
    const employee: Employee = {
      ...(editing ?? { id: crypto.randomUUID() }), name: name.trim(), active, isTest,
      startDate: startDate || undefined, endDateTime: active ? undefined : endDateTime || undefined,
    };
    const message = onSave(employee);
    if (message) { setError(message); return; }
    setEditorOpen(false);
  }

  const visible = employees.filter((employee) => {
    if (!employee.name.toLocaleLowerCase("ru").includes(query.toLocaleLowerCase("ru"))) return false;
    if (filter === "archived") return Boolean(employee.archivedAt);
    if (employee.archivedAt) return false;
    if (filter === "working") return employee.active;
    if (filter === "dismissed") return !employee.active;
    if (filter === "test") return Boolean(employee.isTest);
    return true;
  });

  return <section className="staff-card" aria-labelledby="staff-title">
    <div className="staff-heading"><div><h2 id="staff-title">Сотрудники</h2><p>Общий список сотрудников для всех месяцев</p></div><Button onClick={() => edit(null)}><Plus />Добавить сотрудника</Button></div>
    <div className="staff-month"><Users /><span><strong>{monthLabel}</strong><small>{memberIds.length} из 8 участников · добавление в список не назначает смены</small></span><Button variant="outline" onClick={onMembership}>Состав месяца</Button></div>
    <div className="staff-filters"><label className="staff-search"><Search /><input placeholder="Поиск по ФИО" aria-label="Поиск по ФИО" value={query} onChange={(event) => setQuery(event.target.value)} /></label><select aria-label="Фильтр сотрудников" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="current">Все сотрудники</option><option value="working">Работают</option><option value="dismissed">Уволены</option><option value="test">Тестовые</option><option value="archived">Архив</option></select></div>
    {error && !editorOpen && <p role="alert" className="staff-error">{error}</p>}
    <div className="staff-table-wrap"><table className="staff-table"><thead><tr><th>Сотрудник</th><th>Статус</th><th>Период работы</th><th>Этот месяц</th><th><span className="sr-only">Действия</span></th></tr></thead><tbody>{visible.map((employee) => <tr key={employee.id}>
      <td><strong>{employee.name}</strong>{employee.isTest && <span className="staff-test-badge">Тестовый</span>}<small className="staff-id" title={employee.id}>ID: {employee.id}</small></td>
      <td><span className={`staff-status ${employee.active ? "staff-working" : "staff-dismissed"}`}>{employee.archivedAt ? "В архиве" : employee.active ? "Работает" : "Уволен"}</span></td>
      <td>{employee.startDate ? new Intl.DateTimeFormat("ru", { timeZone: "UTC" }).format(new Date(`${employee.startDate}T00:00:00Z`)) : "Начало не ограничено"}{employee.endDateTime && <small>До {employee.endDateTime.replace("T", " ")}</small>}</td>
      <td>{memberIds.includes(employee.id) ? "Участвует" : "Не включён"}</td>
      <td><div className="staff-actions"><Button size="icon" variant="ghost" aria-label={`Редактировать ${employee.name}`} onClick={() => edit(employee)}><Pencil /></Button>{employee.isTest ? <Button size="icon" variant="ghost" aria-label={`Удалить ${employee.name}`} onClick={() => { setError(""); setDeleteTarget(employee); }}><Trash2 /></Button> : !employee.archivedAt ? <Button size="icon" variant="ghost" aria-label={`Архивировать ${employee.name}`} onClick={() => setArchiveTarget(employee)}><Archive /></Button> : <Button size="sm" variant="outline" onClick={() => { const message = onSave({ ...employee, archivedAt: undefined }); if (message) setError(message); }}>Вернуть</Button>}</div></td>
    </tr>)}</tbody></table>{!visible.length && <div className="staff-empty"><Users /><strong>{query ? "Сотрудники не найдены" : "В этом списке пока нет сотрудников"}</strong><p>Добавьте сотрудника вручную или измените фильтр.</p></div>}</div>

    <Sheet open={editorOpen} onOpenChange={setEditorOpen}><SheetContent className="employee-sheet sm:max-w-[460px]"><SheetHeader className="sheet-header-custom"><SheetTitle>{editing ? "Карточка сотрудника" : "Добавить сотрудника"}</SheetTitle><SheetDescription>{editing ? "ФИО можно менять: назначения связаны с постоянным ID." : "Сотрудник появится в общем списке. В состав месяца его можно включить отдельно."}</SheetDescription></SheetHeader><form className="staff-form sheet-body" onSubmit={save}>
      <label>ФИО<input autoFocus required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>Доступен с<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /><small>Можно оставить пустым, если дата начала не ограничена.</small></label>
      <label>Статус<select value={active ? "working" : "dismissed"} onChange={(event) => setActive(event.target.value === "working")}><option value="working">Работает</option><option value="dismissed">Уволен</option></select></label>
      {!active && <label>Последнее допустимое окончание смены<input type="datetime-local" required value={endDateTime} onChange={(event) => setEndDateTime(event.target.value)} /><small>Смена должна закончиться не позже этого момента. Поздние назначения потребуется перераспределить.</small></label>}
      <label className="staff-test-toggle"><input type="checkbox" role="switch" checked={isTest} disabled={Boolean(editing && isUsed(editing.id))} onChange={(event) => setIsTest(event.target.checked)} /><span><strong>Тестовый сотрудник</strong><small>{editing && isUsed(editing.id) ? "Тип закреплён после включения в график." : "Те же возможности; графики с ним помечаются как тестовые."}</small></span></label>
      {editing && <p className="staff-form-id">Постоянный ID: {editing.id}</p>}
      {error && <p role="alert" className="staff-error">{error}</p>}<div className="staff-form-footer"><Button variant="outline" type="button" onClick={() => setEditorOpen(false)}>Отмена</Button><Button type="submit">{editing ? "Сохранить" : "Добавить"}</Button></div>
    </form></SheetContent></Sheet>

    <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Удалить тестового сотрудника?</AlertDialogTitle><AlertDialogDescription>{deleteTarget?.name} будет удалён из списка и тестовых графиков вместе со своими назначениями. Освободившиеся смены потребуется заполнить заново.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Отмена</AlertDialogCancel><AlertDialogAction onClick={() => { if (deleteTarget) { const message = onDelete(deleteTarget); if (message) setError(message); } setDeleteTarget(null); }}>Удалить</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={Boolean(archiveTarget)} onOpenChange={(open) => { if (!open) setArchiveTarget(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Перенести сотрудника в архив?</AlertDialogTitle><AlertDialogDescription>{archiveTarget?.name} останется в прошлых графиках и истории. Для новых месяцев он больше не будет предложен. Период работы меняется в карточке сотрудника.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Отмена</AlertDialogCancel><AlertDialogAction onClick={() => { if (archiveTarget) onArchive(archiveTarget); setArchiveTarget(null); }}>В архив</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}
