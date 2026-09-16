import { addDays, fullCalendarDaysBetween, hoursBetween, overlaps, startOfUtcWeek } from "./calendar";
import type { Absence, Employee, Period, Shift, ValidationIssue } from "./types";

function issue(code: string, message: string, details: Record<string, unknown> = {}): ValidationIssue {
  return { code, message, details };
}

function employeeShifts(schedule: Shift[], employeeId: string) {
  return schedule.filter((shift) => shift.employeeId === employeeId).sort((a, b) => a.start.getTime() - b.start.getTime());
}

function validateCoverage(schedule: Shift[], period: Period) {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  for (const shift of schedule) {
    if (!shift.employeeId) issues.push(issue("UNCOVERED_SHIFT", `Смена ${shift.id} не закрыта`, { shiftId: shift.id }));
    if (seen.has(shift.id)) issues.push(issue("DUPLICATE_SHIFT", `Смена ${shift.id} продублирована`, { shiftId: shift.id }));
    seen.add(shift.id);
    if (hoursBetween(shift.start, shift.end) !== 12) issues.push(issue("INVALID_SHIFT_LENGTH", `Смена ${shift.id} длится не 12 часов`, { shiftId: shift.id }));
  }

  const relevant = schedule.filter((shift) => overlaps(shift.start, shift.end, period.start, period.end)).sort((a, b) => a.start.getTime() - b.start.getTime());
  let cursor = period.start;
  for (const shift of relevant) {
    const coveredStart = shift.start < period.start ? period.start : shift.start;
    const coveredEnd = shift.end > period.end ? period.end : shift.end;
    if (coveredStart > cursor) issues.push(issue("COVERAGE_GAP", "В графике есть незакрытый временной интервал", { start: cursor.toISOString(), end: coveredStart.toISOString() }));
    if (coveredStart < cursor) issues.push(issue("COVERAGE_OVERLAP", "Две смены перекрывают один временной интервал", { shiftId: shift.id }));
    if (coveredEnd > cursor) cursor = coveredEnd;
  }
  if (cursor < period.end) issues.push(issue("COVERAGE_GAP", "График не закрывает конец месяца", { start: cursor.toISOString(), end: period.end.toISOString() }));
  return issues;
}

function validateAbsences(schedule: Shift[], absences: Absence[]) {
  const issues: ValidationIssue[] = [];
  for (const absence of absences) {
    for (const shift of schedule) {
      if (shift.employeeId === absence.employeeId && overlaps(shift.start, shift.end, absence.start, absence.end)) {
        issues.push(issue("EMPLOYEE_UNAVAILABLE", `${absence.employeeId} недоступен на смене ${shift.id}`, { employeeId: absence.employeeId, shiftId: shift.id }));
      }
    }
  }
  return issues;
}

function validateEmployeeSequence(shifts: Shift[], employeeId: string) {
  const issues: ValidationIssue[] = [];
  if (!shifts.length) return issues;
  let blockLength = 1;
  for (let index = 1; index < shifts.length; index += 1) {
    const previous = shifts[index - 1];
    const current = shifts[index];
    const restHours = hoursBetween(previous.end, current.start);
    if (restHours < 12) {
      issues.push(issue("REST_UNDER_12H", `${employeeId}: между сменами меньше 12 часов отдыха`, { employeeId, previousShiftId: previous.id, currentShiftId: current.id, restHours }));
      blockLength = 1;
      continue;
    }
    if (restHours === 12) {
      blockLength += 1;
      if (blockLength > 4) issues.push(issue("WORK_BLOCK_OVER_4", `${employeeId}: рабочий блок превышает четыре смены`, { employeeId, currentShiftId: current.id, blockLength }));
      continue;
    }
    if (blockLength >= 3) {
      const fullDays = fullCalendarDaysBetween(previous.end, current.start);
      if (fullDays < 2) issues.push(issue("NO_TWO_FULL_DAYS_AFTER_BLOCK", `${employeeId}: после блока из ${blockLength} смен нет двух полных выходных`, { employeeId, previousShiftId: previous.id, currentShiftId: current.id, blockLength, fullDays }));
    }
    blockLength = 1;
  }
  return issues;
}

function hasWorkOnDay(shifts: Shift[], dayStart: Date, dayEnd: Date) {
  return shifts.some((shift) => overlaps(shift.start, shift.end, dayStart, dayEnd));
}

function monthlyFreeDays(schedule: Shift[], employeeId: string, period: Period) {
  const shifts = employeeShifts(schedule, employeeId);
  const freeDays: boolean[] = [];
  for (let day = period.start; day < period.end; day = addDays(day, 1)) freeDays.push(!hasWorkOnDay(shifts, day, addDays(day, 1)));
  return freeDays;
}

export function countMonthlyFullOffDays(schedule: Shift[], employeeId: string, period: Period) {
  return monthlyFreeDays(schedule, employeeId, period).filter(Boolean).length;
}

export function countMonthlyOffPairs(schedule: Shift[], employeeId: string, period: Period) {
  const freeDays = monthlyFreeDays(schedule, employeeId, period);
  let pairs = 0;
  for (let index = 0; index < freeDays.length - 1;) {
    if (freeDays[index] && freeDays[index + 1]) { pairs += 1; index += 2; }
    else index += 1;
  }
  return pairs;
}

function validateMonthlyPairs(schedule: Shift[], employees: Employee[], period: Period) {
  return employees.flatMap((employee) => {
    const pairs = countMonthlyOffPairs(schedule, employee.id, period);
    return pairs < 2 ? [issue("MONTHLY_OFF_PAIRS_UNDER_2", `${employee.name}: в месяце меньше двух пар полных выходных`, { employeeId: employee.id, pairs })] : [];
  });
}

function validateWeeklyRest(schedule: Shift[], employees: Employee[], period: Period) {
  const issues: ValidationIssue[] = [];
  const firstWeek = startOfUtcWeek(period.start);
  const lastWeek = startOfUtcWeek(new Date(period.end.getTime() - 1));
  for (let weekStart = firstWeek; weekStart <= lastWeek; weekStart = addDays(weekStart, 7)) {
    const weekEnd = addDays(weekStart, 7);
    for (const employee of employees) {
      let workHours = 0;
      for (const shift of employeeShifts(schedule, employee.id)) {
        if (!overlaps(shift.start, shift.end, weekStart, weekEnd)) continue;
        const overlapStart = shift.start > weekStart ? shift.start : weekStart;
        const overlapEnd = shift.end < weekEnd ? shift.end : weekEnd;
        workHours += hoursBetween(overlapStart, overlapEnd);
      }
      const freeHours = 168 - workHours;
      if (freeHours < 42) issues.push(issue("WEEKLY_REST_UNDER_42H", `${employee.name}: за календарную неделю меньше 42 часов отдыха`, { employeeId: employee.id, weekStart: weekStart.toISOString(), freeHours }));
    }
  }
  return issues;
}

export function validateSchedule({ schedule, employees, period, absences = [] }: { schedule: Shift[]; employees: Employee[]; period: Period; absences?: Absence[] }) {
  const issues = [...validateCoverage(schedule, period), ...validateAbsences(schedule, absences)];
  for (const employee of employees) issues.push(...validateEmployeeSequence(employeeShifts(schedule, employee.id), employee.id));
  issues.push(...validateMonthlyPairs(schedule, employees, period));
  issues.push(...validateWeeklyRest(schedule, employees, period));
  return { valid: issues.length === 0, issues };
}

export function describeWorkBlocks(schedule: Shift[], employeeId: string, period: Period) {
  const shifts = employeeShifts(schedule, employeeId).filter((shift) => shift.start >= period.start && shift.start < period.end);
  const blocks: Shift[][] = [];
  let block: Shift[] = [];
  for (const shift of shifts) {
    if (!block.length) { block = [shift]; continue; }
    const previous = block[block.length - 1];
    if (hoursBetween(previous.end, shift.start) === 12) block.push(shift);
    else { blocks.push(block); block = [shift]; }
  }
  if (block.length) blocks.push(block);
  return blocks.map((items) => ({ length: items.length, shiftIds: items.map((item) => item.id) }));
}

export function findWorkBlock(schedule: Shift[], employeeId: string, shiftId: string) {
  const shifts = employeeShifts(schedule, employeeId);
  const targetIndex = shifts.findIndex((shift) => shift.id === shiftId);
  if (targetIndex < 0) return [];
  let start = targetIndex;
  let end = targetIndex;
  while (start > 0 && hoursBetween(shifts[start - 1].end, shifts[start].start) === 12) start -= 1;
  while (end < shifts.length - 1 && hoursBetween(shifts[end].end, shifts[end + 1].start) === 12) end += 1;
  return shifts.slice(start, end + 1);
}
