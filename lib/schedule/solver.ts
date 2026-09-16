import { hoursBetween, overlaps } from "./calendar";
import { countMonthlyOffPairs, describeWorkBlocks, validateSchedule } from "./validator";
import type { Absence, Employee, Period, ScheduleOption, Shift } from "./types";

function* combinations<T>(items: T[], count: number, start = 0, prefix: T[] = []): Generator<T[]> {
  if (prefix.length === count) { yield [...prefix]; return; }
  for (let index = start; index <= items.length - (count - prefix.length); index += 1) {
    prefix.push(items[index]);
    yield* combinations(items, count, index + 1, prefix);
    prefix.pop();
  }
}

function shiftsConflict(first: Shift, second: Shift) {
  const [earlier, later] = first.start <= second.start ? [first, second] : [second, first];
  return hoursBetween(earlier.end, later.start) < 12;
}

function enumerateAssignments(
  positions: Shift[],
  employees: Employee[],
  schedule: Shift[],
  absences: Absence[],
  requiredAssignments: Record<string, string>,
  shouldStop: () => boolean,
  onVisit: () => void,
  onAssignment: (assignment: Record<string, string>) => void,
  index = 0,
  current: Record<string, string> = {},
): void {
  if (shouldStop()) return;
  onVisit();
  if (index === positions.length) { onAssignment({ ...current }); return; }
  const shift = positions[index];
  const required = requiredAssignments[shift.id];
  const mutableIds = new Set(positions.map((position) => position.id));
  const choices = employees.filter((employee) => {
    if (!employee.active) return false;
    if (required ? employee.id !== required : employee.id === shift.employeeId) return false;
    if (absences.some((absence) => absence.employeeId === employee.id && overlaps(shift.start, shift.end, absence.start, absence.end))) return false;
    const fixedConflict = schedule.some((other) => !mutableIds.has(other.id) && other.employeeId === employee.id && shiftsConflict(shift, other));
    if (fixedConflict) return false;
    return positions.slice(0, index).some((other) => current[other.id] === employee.id && shiftsConflict(shift, other)) === false;
  });
  for (const employee of choices) {
    current[shift.id] = employee.id;
    enumerateAssignments(positions, employees, schedule, absences, requiredAssignments, shouldStop, onVisit, onAssignment, index + 1, current);
    if (shouldStop()) break;
  }
  delete current[shift.id];
}

function applyAssignments(schedule: Shift[], assignments: Record<string, string>) {
  return schedule.map((shift) => assignments[shift.id] ? { ...shift, employeeId: assignments[shift.id] } : { ...shift });
}

function changedShifts(schedule: Shift[], period: Period) {
  return schedule
    .filter((shift) => shift.start >= period.start && shift.start < period.end)
    .filter((shift) => shift.employeeId !== (shift.baseEmployeeId ?? shift.employeeId))
    .map((shift) => ({ shiftId: shift.id, type: shift.type, fromEmployeeId: shift.baseEmployeeId ?? shift.employeeId, toEmployeeId: shift.employeeId }));
}

function buildMetrics(schedule: Shift[], employees: Employee[], period: Period) {
  const changes = changedShifts(schedule, period);
  const hours: ScheduleOption["metrics"]["hours"] = {};
  for (const employee of employees) {
    const plannedCount = schedule.filter((shift) => shift.start >= period.start && shift.start < period.end && shift.plannedEmployeeId === employee.id).length;
    const resultingCount = schedule.filter((shift) => shift.start >= period.start && shift.start < period.end && shift.employeeId === employee.id).length;
    hours[employee.id] = {
      planned: plannedCount * 12,
      resulting: resultingCount * 12,
      delta: (resultingCount - plannedCount) * 12,
      offPairs: countMonthlyOffPairs(schedule, employee.id, period),
      blocks: describeWorkBlocks(schedule, employee.id, period),
    };
  }
  const affected = new Set<string>();
  for (const change of changes) { affected.add(change.fromEmployeeId); affected.add(change.toEmployeeId); }
  const deltas = Object.values(hours).map((item) => item.delta);
  const changedDates = changes.map((item) => schedule.find((shift) => shift.id === item.shiftId)?.start.getTime() ?? period.start.getTime());
  const firstChangedAt = changedDates.length ? Math.min(...changedDates) : period.start.getTime();
  const lastChangedAt = changedDates.length ? Math.max(...changedDates) : period.start.getTime();
  return {
    changes,
    changedCount: changes.length,
    affectedEmployeeCount: affected.size,
    hours,
    maxPositiveOverload: Math.max(0, ...deltas),
    loadSpread: Math.max(...deltas) - Math.min(...deltas),
    totalLoadDeviation: deltas.reduce((sum, delta) => sum + Math.abs(delta), 0),
    changeSpanHours: (lastChangedAt - firstChangedAt) / 3_600_000,
  };
}

function compareOptions(a: ScheduleOption, b: ScheduleOption) {
  return a.metrics.changedCount - b.metrics.changedCount || a.metrics.maxPositiveOverload - b.metrics.maxPositiveOverload || a.metrics.loadSpread - b.metrics.loadSpread || a.metrics.totalLoadDeviation - b.metrics.totalLoadDeviation || a.metrics.affectedEmployeeCount - b.metrics.affectedEmployeeCount || a.metrics.changeSpanHours - b.metrics.changeSpanHours || a.key.localeCompare(b.key);
}

function createOption(schedule: Shift[], employees: Employee[], period: Period): ScheduleOption {
  const metrics = buildMetrics(schedule, employees, period);
  return { key: metrics.changes.map((item) => `${item.shiftId}:${item.toEmployeeId}`).join("|"), schedule, metrics };
}

function keepBestOption(options: ScheduleOption[], option: ScheduleOption, limit: number) {
  if (options.some((item) => item.key === option.key)) return;
  options.push(option);
  options.sort(compareOptions);
  if (options.length > limit) options.pop();
}

export function solveSchedule({
  schedule,
  employees,
  period,
  absences,
  recalculationStart,
  requiredAssignments = {},
  maxExtraChanges,
  maxOptions = 3,
  maxEvaluatedAssignments = 300_000,
}: {
  schedule: Shift[];
  employees: Employee[];
  period: Period;
  absences: Absence[];
  recalculationStart: Date;
  requiredAssignments?: Record<string, string>;
  maxExtraChanges?: number;
  maxOptions?: number;
  maxEvaluatedAssignments?: number;
}) {
  const baseline = schedule.map((shift) => ({ ...shift, baseEmployeeId: shift.employeeId }));
  const affectedOriginalShifts = baseline.filter((shift) =>
    shift.start >= period.start && shift.start < period.end &&
    absences.some((absence) => shift.employeeId === absence.employeeId && overlaps(shift.start, shift.end, absence.start, absence.end)),
  );
  if (!affectedOriginalShifts.length) return { found: false as const, options: [], reason: "Выбранный период не затрагивает смены сотрудника" };

  const mandatoryIds = new Set(affectedOriginalShifts.map((shift) => shift.id));
  const mutable = baseline.filter((shift) => shift.start >= recalculationStart && shift.start >= period.start && shift.start < period.end);
  const optional = mutable.filter((shift) => !mandatoryIds.has(shift.id));
  const validByChangeCount = new Map<number, ScheduleOption[]>();
  const minimumRequired = mandatoryIds.size;
  const extraLimit = maxExtraChanges === undefined ? optional.length : Math.min(maxExtraChanges, optional.length);
  const maximumChanges = minimumRequired + extraLimit;
  let evaluatedAssignments = 0;
  let searchLimitReached = false;

  for (let changeCount = minimumRequired; changeCount <= maximumChanges; changeCount += 1) {
    const extraCount = changeCount - minimumRequired;
    const candidates: ScheduleOption[] = [];
    for (const extras of combinations(optional, extraCount)) {
      const positions = [...affectedOriginalShifts, ...extras].sort((a, b) => a.start.getTime() - b.start.getTime());
      enumerateAssignments(positions, employees, baseline, absences, requiredAssignments, () => evaluatedAssignments >= maxEvaluatedAssignments, () => {
        evaluatedAssignments += 1;
      }, (assignments) => {
        const candidateSchedule = applyAssignments(baseline, assignments);
        const validation = validateSchedule({ schedule: candidateSchedule, employees, period, absences });
        if (!validation.valid) return;
        const option = createOption(candidateSchedule, employees, period);
        keepBestOption(candidates, option, maxOptions);
      });
      if (evaluatedAssignments >= maxEvaluatedAssignments) {
        searchLimitReached = true;
        break;
      }
    }
    if (searchLimitReached) break;
    if (candidates.length) {
      validByChangeCount.set(changeCount, candidates);
      const optionCount = [...validByChangeCount.values()].reduce((sum, items) => sum + items.length, 0);
      if (optionCount >= maxOptions) break;
    }
  }

  if (!validByChangeCount.size) {
    const reason = searchLimitReached
      ? "Поиск достиг безопасного вычислительного лимита. Система не будет ошибочно утверждать, что решения нет — требуется расширенный расчёт."
      : maxExtraChanges !== undefined && extraLimit < optional.length
        ? `В пределах ${extraLimit} дополнительных перестановок допустимый график не найден`
        : "Допустимый график не существует даже после проверки всех доступных будущих перестановок";
    return { found: false as const, options: [], reason };
  }
  const counts = [...validByChangeCount.keys()].sort((a, b) => a - b);
  const minimumChangeCount = counts[0];
  const recommended = validByChangeCount.get(minimumChangeCount)![0];
  const ordered = [recommended];
  for (const count of counts) for (const option of validByChangeCount.get(count)!) if (!ordered.some((item) => item.key === option.key)) ordered.push(option);
  return { found: true as const, minimumChangeCount, recommendedKey: recommended.key, options: ordered.slice(0, maxOptions) };
}
