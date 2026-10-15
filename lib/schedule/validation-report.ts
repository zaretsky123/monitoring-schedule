import type { Employee, Shift, ValidationIssue } from "./types";

export type IssueGroup = { code: string; severity: "error" | "warning"; title: string; issues: ValidationIssue[] };
const titles: Record<string, string> = {
  REST_48H_INSTEAD_OF_FULL_DAYS: "Отдых от 48 часов вместо двух полных календарных дней",
  NO_TWO_FULL_DAYS_AFTER_BLOCK: "Недостаточный отдых после рабочего блока",
  REST_UNDER_12H: "Между сменами меньше 12 часов отдыха",
  WORK_BLOCK_OVER_5: "Рабочий блок превышает пять смен",
  MONTHLY_OFF_PAIRS_UNDER_2: "В месяце меньше двух пар полных выходных",
  WEEKLY_REST_UNDER_42H: "За календарную неделю меньше 42 часов отдыха",
  EMPLOYEE_UNAVAILABLE: "Смена назначена в период недоступности",
  EMPLOYMENT_UNAVAILABLE: "Смена вне периода работы сотрудника",
  UNKNOWN_EMPLOYEE: "Сотрудник не включён в состав месяца",
  UNCOVERED_SHIFT: "Незаполненные смены",
  DUPLICATE_SHIFT: "Повторяющиеся смены",
  INVALID_SECOND_SLOT: "Некорректное второе назначение",
  INVALID_SHIFT_LENGTH: "Продолжительность смены отличается от 12 часов",
  COVERAGE_GAP: "В графике отсутствует временной интервал",
  COVERAGE_OVERLAP: "Временные интервалы смен пересекаются",
};

export function groupValidationIssues(issues: ValidationIssue[]): IssueGroup[] {
  const groups = new Map<string, IssueGroup>();
  for (const item of issues) {
    const severity = item.severity === "warning" ? "warning" : "error";
    const key = `${severity}:${item.code}`;
    if (!groups.has(key)) groups.set(key, { code: item.code, severity, title: titles[item.code] ?? "Замечание к графику", issues: [] });
    groups.get(key)!.issues.push(item);
  }
  return [...groups.values()].sort((a, b) => Number(a.severity === "warning") - Number(b.severity === "warning"));
}

export function countLabel(count: number, forms: [string, string, string]) {
  const last = count % 10, lastTwo = count % 100;
  return `${count} ${forms[lastTwo >= 11 && lastTwo <= 14 ? 2 : last === 1 ? 0 : last >= 2 && last <= 4 ? 1 : 2]}`;
}

export function validationSummary(groups: IssueGroup[]) {
  const errors = groups.filter((group) => group.severity === "error").length;
  const warnings = groups.length - errors;
  return [errors ? countLabel(errors, ["ошибка", "ошибки", "ошибок"]) : "", warnings ? countLabel(warnings, ["предупреждение", "предупреждения", "предупреждений"]) : ""].filter(Boolean).join(" · ") || "Без замечаний";
}

const dateTime = (value: unknown) => {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value ?? "") : new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(date);
};

export function describeValidationIssue(item: ValidationIssue, employees: Employee[], schedule: Shift[]) {
  const d = item.details;
  const employee = employees.find((person) => person.id === d.employeeId);
  const name = employee?.name ?? String(d.employeeId ?? "");
  const previous = schedule.find((shift) => shift.id === d.previousShiftId);
  const current = schedule.find((shift) => shift.id === (d.currentShiftId ?? d.shiftId));
  if (item.code === "REST_48H_INSTEAD_OF_FULL_DAYS" || item.code === "NO_TWO_FULL_DAYS_AFTER_BLOCK") {
    return `${name}: ${dateTime(d.restStart ?? previous?.end)} → ${dateTime(d.restEnd ?? current?.start)}. Отдых ${d.restHours} ч, полных календарных дней: ${d.fullDays}. После блока из ${d.blockLength} смен.${item.severity === "warning" ? " Можно закрепить с подтверждением." : " Нужно минимум 48 часов или два полных календарных дня."}`;
  }
  if (item.code === "REST_UNDER_12H") return `${name}: ${dateTime(previous?.end)} → ${dateTime(current?.start)}. Отдых ${d.restHours} ч, требуется минимум 12 ч.`;
  if (item.code === "WORK_BLOCK_OVER_5") return `${name}: ${d.blockLength} смен подряд, последняя — ${dateTime(current?.start)}.`;
  if (item.code === "MONTHLY_OFF_PAIRS_UNDER_2") return `${name}: пар полных выходных — ${d.pairs}, требуется минимум 2.`;
  if (item.code === "WEEKLY_REST_UNDER_42H") return `${name}: неделя с ${dateTime(d.weekStart)}. Отдых ${d.freeHours} ч, требуется минимум 42 ч.`;
  let message = item.message;
  for (const person of [...employees].sort((a, b) => b.id.length - a.id.length)) message = message.split(person.id).join(person.name);
  if (current) return `${name ? `${name} · ` : ""}${dateTime(current.start)}–${dateTime(current.end)}. ${message}`;
  if (d.start && d.end) return `${dateTime(d.start)} → ${dateTime(d.end)}. ${message}`;
  return message;
}
