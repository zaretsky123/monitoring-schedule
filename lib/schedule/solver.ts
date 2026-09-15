import { overlaps } from "./calendar";
import { countMonthlyOffPairs, describeWorkBlocks, validateSchedule } from "./validator";
import type { Absence, Employee, Period, ScheduleOption, Shift } from "./types";

function combinations<T>(items: T[], count: number, start = 0, prefix: T[] = [], result: T[][] = []): T[][] {
  if (prefix.length === count) { result.push([...prefix]); return result; }
  for (let index = start; index <= items.length - (count - prefix.length); index += 1) {
    prefix.push(items[index]);
    combinations(items, count, index + 1, prefix, result);
    prefix.pop();
  }
  return result;
}

function enumerateAssignments(
  positions: Shift[],
  employees: Employee[],
  requiredAssignments: Record<string, string>,
  onAssignment: (assignment: Record<string, string>) => boolean | void,
  index = 0,
  current: Record<string, string> = {},
): boolean {
  if (index === positions.length) return Boolean(onAssignment({ ...current }));
  const shift = positions[index];
  const required = requiredAssignments[shift.id];
  const choices = required ? employees.filter((employee) => employee.id === required) : employees.filter((employee) => employee.active && employee.id !== shift.employeeId);
  for (const employee of choices) {
    current[shift.id] = employee.id;
    if (enumerateAssignments(positions, employees, requiredAssignments, onAssignment, index + 1, current)) return true;
  }
  delete current[shift.id];
  return false;
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
    changeSpanHours: (lastChangedAt - firstChangedAt) / 3_600_000,
  };
}

function compareOptions(a: ScheduleOption, b: ScheduleOption) {
  return a.metrics.changedCount - b.metrics.changedCount || a.metrics.maxPositiveOverload - b.metrics.maxPositiveOverload || a.metrics.loadSpread - b.metrics.loadSpread || a.metrics.affectedEmployeeCount - b.metrics.affectedEmployeeCount || a.metrics.changeSpanHours - b.metrics.changeSpanHours || a.key.localeCompare(b.key);
}

function createOption(schedule: Shift[], employees: Employee[], period: Period): ScheduleOption {
  const metrics = buildMetrics(schedule, employees, period);
  return { key: metrics.changes.map((item) => `${item.shiftId}:${item.toEmployeeId}`).join("|"), schedule, metrics };
}

export function solveSchedule({
  schedule,
  employees,
  period,
  absences,
  recalculationStart,
  requiredAssignments = {},
  maxExtraChanges = 2,
  maxOptions = 3,
}: {
  schedule: Shift[];
  employees: Employee[];
  period: Period;
  absences: Absence[];
  recalculationStart: Date;
  requiredAssignments?: Record<string, string>;
  maxExtraChanges?: number;
  maxOptions?: number;
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
  const maximumChanges = minimumRequired + maxExtraChanges;

  for (let changeCount = minimumRequired; changeCount <= maximumChanges; changeCount += 1) {
    const extraCount = changeCount - minimumRequired;
    const positionSets = combinations(optional, extraCount);
    const candidates: ScheduleOption[] = [];
    for (const extras of positionSets) {
      const positions = [...affectedOriginalShifts, ...extras].sort((a, b) => a.start.getTime() - b.start.getTime());
      const shouldStop = enumerateAssignments(positions, employees, requiredAssignments, (assignments) => {
        const candidateSchedule = applyAssignments(baseline, assignments);
        const validation = validateSchedule({ schedule: candidateSchedule, employees, period, absences });
        if (!validation.valid) return false;
        const option = createOption(candidateSchedule, employees, period);
        if (!candidates.some((item) => item.key === option.key)) candidates.push(option);
        return candidates.length >= 80;
      });
      if (shouldStop || candidates.length >= 80) break;
    }
    if (candidates.length) {
      candidates.sort(compareOptions);
      validByChangeCount.set(changeCount, candidates);
      if (validByChangeCount.size >= 2) break;
    }
  }

  if (!validByChangeCount.size) return { found: false as const, options: [], reason: `В пределах ${maxExtraChanges} дополнительных перестановок допустимый график не найден` };
  const counts = [...validByChangeCount.keys()].sort((a, b) => a - b);
  const minimumChangeCount = counts[0];
  const minimumOption = validByChangeCount.get(minimumChangeCount)![0];
  let recommended = minimumOption;
  const nextOptions = validByChangeCount.get(minimumChangeCount + 1) ?? [];
  if (nextOptions.length && minimumOption.metrics.maxPositiveOverload - nextOptions[0].metrics.maxPositiveOverload >= 12) recommended = nextOptions[0];
  const ordered = [recommended];
  for (const count of counts) for (const option of validByChangeCount.get(count)!) if (!ordered.some((item) => item.key === option.key)) ordered.push(option);
  return { found: true as const, minimumChangeCount, recommendedKey: recommended.key, options: ordered.slice(0, maxOptions) };
}
