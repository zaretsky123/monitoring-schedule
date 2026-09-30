import { addDays, fullCalendarDaysBetween } from "./calendar";
import { validateSchedule } from "./validator";
import type { Absence, Employee, GeneratedScheduleOption, GenerationMode, Period, Shift } from "./types";

type SearchState = {
  assignments: number[];
  lastEnds: number[];
  blockLengths: number[];
  counts: number[];
  dayCounts: number[];
  nightCounts: number[];
  patternMismatches: number;
  score: number;
  tieKey: string;
};

function employeeIndexById(employees: Employee[]) {
  return new Map(employees.map((employee, index) => [employee.id, index]));
}

function transitionSequence(state: SearchState, employeeIndex: number, shift: Shift) {
  const lastEnd = state.lastEnds[employeeIndex];
  let blockLength = state.blockLengths[employeeIndex] || 0;
  if (Number.isFinite(lastEnd)) {
    const restHours = (shift.start.getTime() - lastEnd) / 3_600_000;
    if (restHours < 12) return null;
    if (restHours === 12) {
      blockLength += 1;
      if (blockLength > 5) return null;
    } else {
      if (blockLength >= 3 && fullCalendarDaysBetween(new Date(lastEnd), shift.start) < 2) return null;
      blockLength = 1;
    }
  } else blockLength = 1;
  return blockLength;
}

function scoreState(state: SearchState, mode: GenerationMode) {
  const loadSpread = Math.max(...state.counts) - Math.min(...state.counts);
  const daySpread = Math.max(...state.dayCounts) - Math.min(...state.dayCounts);
  const nightSpread = Math.max(...state.nightCounts) - Math.min(...state.nightCounts);
  const personalTypeImbalance = state.dayCounts.reduce((sum, count, index) => sum + Math.abs(count - state.nightCounts[index]), 0);
  const patternPenalty = mode === "pattern" ? state.patternMismatches * 10_000 : state.patternMismatches * 2;
  return patternPenalty + loadSpread * 140 + (daySpread + nightSpread) * 35 + personalTypeImbalance * 4;
}

function optionMetrics(schedule: Shift[], employees: Employee[], period: Period, mode: GenerationMode, patternTargets: Map<string, string>) {
  const workHours: Record<string, number> = {};
  const dayShifts: Record<string, number> = {};
  const nightShifts: Record<string, number> = {};
  for (const employee of employees) {
    const monthly = schedule.filter((shift) => shift.start >= period.start && shift.start < period.end && shift.employeeId === employee.id);
    workHours[employee.id] = monthly.length * 12;
    dayShifts[employee.id] = monthly.filter((shift) => shift.type === "D").length;
    nightShifts[employee.id] = monthly.filter((shift) => shift.type === "N").length;
  }
  const targetEntries = [...patternTargets.entries()];
  const patternMatches = targetEntries.filter(([shiftId, employeeId]) => schedule.find((shift) => shift.id === shiftId)?.employeeId === employeeId).length;
  const hours = Object.values(workHours);
  return {
    patternMatches,
    patternTotal: targetEntries.length,
    workHours,
    dayShifts,
    nightShifts,
    loadSpreadHours: Math.max(...hours) - Math.min(...hours),
    mode,
  };
}

function buildPatternTargets(schedule: Shift[], period: Period, seedDays: number) {
  const targets = new Map<string, string>();
  const seedEnd = addDays(period.start, seedDays);
  const seed = schedule.filter((shift) => shift.start >= period.start && shift.start < seedEnd && shift.employeeId);
  const pattern = new Map(seed.map((shift) => {
    const dayIndex = Math.floor((shift.start.getTime() - period.start.getTime()) / 86_400_000);
    return [`${shift.type}:${dayIndex}`, shift.employeeId] as const;
  }));
  for (const shift of schedule.filter((item) => item.start >= seedEnd && item.start < period.end)) {
    const dayIndex = Math.floor((shift.start.getTime() - period.start.getTime()) / 86_400_000);
    const employeeId = pattern.get(`${shift.type}:${dayIndex % seedDays}`);
    if (employeeId) targets.set(shift.id, employeeId);
  }
  return targets;
}

function seedFailureReason(schedule: Shift[], employees: Employee[], period: Period, seedDays: number) {
  const seedEnd = addDays(period.start, seedDays);
  const seedShifts = schedule
    .filter((shift) => shift.employeeId && shift.start < seedEnd)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const indexById = employeeIndexById(employees);
  const state: SearchState = {
    assignments: [],
    lastEnds: employees.map(() => Number.NEGATIVE_INFINITY),
    blockLengths: employees.map(() => 0),
    counts: employees.map(() => 0),
    dayCounts: employees.map(() => 0),
    nightCounts: employees.map(() => 0),
    patternMismatches: 0,
    score: 0,
    tieKey: "",
  };
  for (const shift of seedShifts) {
    const employeeIndex = indexById.get(shift.employeeId);
    if (employeeIndex === undefined) return `В первых восьми днях указана неизвестная запись сотрудника (${shift.id}).`;
    const nextBlock = transitionSequence(state, employeeIndex, shift);
    if (nextBlock === null) return `Первые восемь дней нельзя продолжить: назначение ${shift.id} нарушает отдых или допустимую длину рабочего блока.`;
    state.lastEnds[employeeIndex] = shift.end.getTime();
    state.blockLengths[employeeIndex] = nextBlock;
  }
  return "";
}

export function generateSchedule({
  schedule,
  employees,
  period,
  seedDays = 8,
  mode,
  manual = false,
  lockedEmployeeIds = [],
  absences = [],
  maxOptions = 3,
  beamWidth = mode === "pattern" ? 4_000 : 7_000,
}: {
  schedule: Shift[];
  employees: Employee[];
  period: Period;
  seedDays?: number;
  mode: GenerationMode;
  manual?: boolean;
  lockedEmployeeIds?: string[];
  absences?: Absence[];
  maxOptions?: number;
  beamWidth?: number;
}) {
  const activeEmployees = employees.filter((employee) => employee.active);
  if (!activeEmployees.length) return { found: false as const, options: [], reason: "Нет активных сотрудников для формирования графика." };
  if (manual) return generateManualSchedule(schedule, activeEmployees, period, lockedEmployeeIds, absences, maxOptions, beamWidth);
  const seedEnd = addDays(period.start, seedDays);
  const requiredSeed = schedule.filter((shift) => shift.start >= period.start && shift.start < seedEnd);
  const emptySeed = requiredSeed.filter((shift) => !shift.employeeId);
  if (emptySeed.length) return { found: false as const, options: [], reason: `Сначала заполните первые восемь дней: осталось ${emptySeed.length} смен.` };
  const boundary = schedule.find((shift) => shift.start < period.start && shift.end > period.start);
  if (!boundary?.employeeId) return { found: false as const, options: [], reason: "Сначала назначьте ночную смену, входящую в первое число месяца." };
  const seedReason = seedFailureReason(schedule, activeEmployees, period, seedDays);
  if (seedReason) return { found: false as const, options: [], reason: seedReason };

  const mutable = schedule
    .filter((shift) => shift.start >= seedEnd && shift.start < period.end)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  if (!mutable.length) return { found: false as const, options: [], reason: "После заданного фрагмента в месяце не осталось смен для расчёта." };
  const mutableIds = new Set(mutable.map((shift) => shift.id));
  const indexById = employeeIndexById(activeEmployees);
  const patternTargets = buildPatternTargets(schedule, period, seedDays);
  const initial: SearchState = {
    assignments: [],
    lastEnds: activeEmployees.map(() => Number.NEGATIVE_INFINITY),
    blockLengths: activeEmployees.map(() => 0),
    counts: activeEmployees.map(() => 0),
    dayCounts: activeEmployees.map(() => 0),
    nightCounts: activeEmployees.map(() => 0),
    patternMismatches: 0,
    score: 0,
    tieKey: "",
  };
  const fixedPast = schedule
    .filter((shift) => shift.employeeId && shift.start < seedEnd)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  for (const shift of fixedPast) {
    const employeeIndex = indexById.get(shift.employeeId);
    if (employeeIndex === undefined) continue;
    const nextBlock = transitionSequence(initial, employeeIndex, shift);
    if (nextBlock === null) return { found: false as const, options: [], reason: `Исходный фрагмент нарушает правила около смены ${shift.id}.` };
    initial.lastEnds[employeeIndex] = shift.end.getTime();
    initial.blockLengths[employeeIndex] = nextBlock;
    if (shift.start >= period.start) {
      initial.counts[employeeIndex] += 1;
      if (shift.type === "D") initial.dayCounts[employeeIndex] += 1;
      else initial.nightCounts[employeeIndex] += 1;
    }
  }

  let beam = [initial];
  for (const shift of mutable) {
    const nextStates: SearchState[] = [];
    const targetId = patternTargets.get(shift.id);
    for (const state of beam) {
      for (let employeeIndex = 0; employeeIndex < activeEmployees.length; employeeIndex += 1) {
        if (lockedEmployeeIds.includes(activeEmployees[employeeIndex].id)) continue;
        const nextBlock = transitionSequence(state, employeeIndex, shift);
        if (nextBlock === null) continue;
        const next: SearchState = {
          assignments: [...state.assignments, employeeIndex],
          lastEnds: [...state.lastEnds],
          blockLengths: [...state.blockLengths],
          counts: [...state.counts],
          dayCounts: [...state.dayCounts],
          nightCounts: [...state.nightCounts],
          patternMismatches: state.patternMismatches + (targetId && targetId !== activeEmployees[employeeIndex].id ? 1 : 0),
          score: 0,
          tieKey: `${state.tieKey}${employeeIndex}`,
        };
        next.lastEnds[employeeIndex] = shift.end.getTime();
        next.blockLengths[employeeIndex] = nextBlock;
        next.counts[employeeIndex] += 1;
        if (shift.type === "D") next.dayCounts[employeeIndex] += 1;
        else next.nightCounts[employeeIndex] += 1;
        next.score = scoreState(next, mode);
        nextStates.push(next);
      }
    }
    nextStates.sort((first, second) => first.score - second.score || first.tieKey.localeCompare(second.tieKey));
    beam = nextStates.slice(0, beamWidth);
    if (!beam.length) return { found: false as const, options: [], reason: `После смены ${shift.id} продолжить график без нарушения отдыха невозможно.` };
  }

  const options: GeneratedScheduleOption[] = [];
  for (const state of beam) {
    const assignmentById = new Map(mutable.map((shift, index) => [shift.id, activeEmployees[state.assignments[index]].id]));
    const candidate = schedule.map((shift) => {
      if (!mutableIds.has(shift.id)) return { ...shift };
      const employeeId = assignmentById.get(shift.id) ?? "";
      return { ...shift, employeeId, plannedEmployeeId: employeeId };
    });
    const validationSchedule = candidate.filter((shift) => shift.employeeId || (shift.start >= period.start && shift.start < period.end));
    const validation = validateSchedule({ schedule: validationSchedule, employees: activeEmployees, period });
    if (!validation.valid) continue;
    const metrics = optionMetrics(candidate, activeEmployees, period, mode, patternTargets);
    const key = mutable.map((shift) => assignmentById.get(shift.id)).join("|");
    options.push({ key, mode, schedule: candidate, metrics });
    if (options.length >= maxOptions) break;
  }
  if (!options.length) {
    return {
      found: false as const,
      options: [],
      reason: "Допустимое продолжение не найдено: первые восемь дней приводят к нарушению месячных выходных или недельного отдыха. Измените одно из назначений до голубой линии.",
    };
  }
  return { found: true as const, recommendedKey: options[0].key, options };
}

function generateManualSchedule(
  schedule: Shift[], employees: Employee[], period: Period, lockedEmployeeIds: string[], absences: Absence[], maxOptions: number, beamWidth: number,
) {
  const locked = new Set(lockedEmployeeIds);
  const indexById = employeeIndexById(employees);
  const boundary = schedule.find((shift) => shift.start < period.start && shift.end > period.start);
  const slots = schedule.filter((shift) => (shift.start >= period.start && shift.start < period.end) || shift.id === boundary?.id)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const empty = slots.filter((shift) => !shift.employeeId);
  if (!empty.length) return { found: false as const, options: [], reason: "Все смены уже назначены вручную." };
  for (const shift of slots) {
    if (shift.employeeId && !indexById.has(shift.employeeId)) return { found: false as const, options: [], reason: `Смена ${shift.id} назначена сотруднику вне выбранного состава.` };
    if (shift.employeeId && absences.some((absence) => absence.employeeId === shift.employeeId && shift.start < absence.end && shift.end > absence.start)) return { found: false as const, options: [], reason: `Смена ${shift.id} назначена сотруднику в период его недоступности.` };
  }
  // A regular rotation provides a complete candidate when the draft is still mostly empty.
  // It also avoids pruning every feasible continuation by the load-only beam score.
  if (employees.length === 4 && locked.size === 0) {
    const dayRotation = [1, 1, 3, 3, 0, 0, 2, 2];
    const nightRotation = [0, 2, 2, 1, 1, 3, 3, 0];
    const rotationOptions: GeneratedScheduleOption[] = [];
    const anchor = Date.UTC(2026, 9, 1);
    for (let phase = 0; phase < 8; phase += 1) {
      const assignments = new Map<string, string>();
      for (const shift of empty) {
        const day = Math.round((Date.UTC(shift.start.getUTCFullYear(), shift.start.getUTCMonth(), shift.start.getUTCDate()) - anchor) / 86_400_000);
        const index = ((day + phase) % 8 + 8) % 8;
        assignments.set(shift.id, employees[(shift.type === "D" ? dayRotation : nightRotation)[index]].id);
      }
      const candidate = schedule.map((shift) => {
        const employeeId = assignments.get(shift.id);
        return employeeId ? { ...shift, employeeId, plannedEmployeeId: employeeId } : { ...shift };
      });
      const validation = validateSchedule({ schedule: candidate.filter((shift) => shift.employeeId || (shift.start >= period.start && shift.start < period.end)), employees, period, absences });
      if (!validation.valid) continue;
      rotationOptions.push({ key: empty.map((shift) => assignments.get(shift.id)).join("|"), mode: "optimal", schedule: candidate, metrics: optionMetrics(candidate, employees, period, "optimal", new Map()) });
    }
    rotationOptions.sort((a, b) => a.metrics.loadSpreadHours - b.metrics.loadSpreadHours || a.key.localeCompare(b.key));
    if (rotationOptions.length) return { found: true as const, recommendedKey: rotationOptions[0].key, options: rotationOptions.slice(0, maxOptions) };
  }
  const earlier = schedule.filter((shift) => shift.employeeId && shift.end <= slots[0].start)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const initial: SearchState = {
    assignments: [], lastEnds: employees.map(() => Number.NEGATIVE_INFINITY), blockLengths: employees.map(() => 0),
    counts: employees.map(() => 0), dayCounts: employees.map(() => 0), nightCounts: employees.map(() => 0),
    patternMismatches: 0, score: 0, tieKey: "",
  };
  for (const shift of earlier) {
    const index = indexById.get(shift.employeeId);
    if (index === undefined) continue;
    const block = transitionSequence(initial, index, shift);
    if (block === null) return { found: false as const, options: [], reason: `Смена ${shift.id} в предыдущем месяце нарушает правила отдыха.` };
    initial.lastEnds[index] = shift.end.getTime();
    initial.blockLengths[index] = block;
  }
  let beam = [initial];
  for (const shift of slots) {
    const nextStates: SearchState[] = [];
    const candidates = shift.employeeId ? [indexById.get(shift.employeeId)!] : employees
      .map((employee, index) => locked.has(employee.id) || absences.some((absence) => absence.employeeId === employee.id && shift.start < absence.end && shift.end > absence.start) ? -1 : index).filter((index) => index >= 0);
    for (const state of beam) for (const index of candidates) {
      const block = transitionSequence(state, index, shift);
      if (block === null) continue;
      const next: SearchState = {
        assignments: shift.employeeId ? state.assignments : [...state.assignments, index],
        lastEnds: [...state.lastEnds], blockLengths: [...state.blockLengths], counts: [...state.counts],
        dayCounts: [...state.dayCounts], nightCounts: [...state.nightCounts], patternMismatches: 0, score: 0,
        tieKey: shift.employeeId ? state.tieKey : `${state.tieKey}${index}`,
      };
      next.lastEnds[index] = shift.end.getTime();
      next.blockLengths[index] = block;
      if (shift.start >= period.start) {
        next.counts[index] += 1;
        if (shift.type === "D") next.dayCounts[index] += 1;
        else next.nightCounts[index] += 1;
      }
      next.score = scoreState(next, "optimal");
      nextStates.push(next);
    }
    nextStates.sort((a, b) => a.score - b.score || a.tieKey.localeCompare(b.tieKey));
    beam = nextStates.slice(0, beamWidth);
    if (!beam.length) return { found: false as const, options: [], reason: `На смене ${shift.id} нельзя продолжить график: проверьте ручные назначения и замочки сотрудников.` };
  }
  const options: GeneratedScheduleOption[] = [];
  for (const state of beam) {
    const assignmentById = new Map(empty.map((shift, index) => [shift.id, employees[state.assignments[index]].id]));
    const candidate = schedule.map((shift) => {
      const employeeId = assignmentById.get(shift.id);
      return employeeId ? { ...shift, employeeId, plannedEmployeeId: employeeId } : { ...shift };
    });
    const validation = validateSchedule({ schedule: candidate.filter((shift) => shift.employeeId || (shift.start >= period.start && shift.start < period.end)), employees, period, absences });
    if (!validation.valid) continue;
    const key = empty.map((shift) => assignmentById.get(shift.id)).join("|");
    if (options.some((option) => option.key === key)) continue;
    options.push({ key, mode: "optimal", schedule: candidate, metrics: optionMetrics(candidate, employees, period, "optimal", new Map()) });
    if (options.length === maxOptions) break;
  }
  return options.length
    ? { found: true as const, recommendedKey: options[0].key, options }
    : { found: false as const, options: [], reason: "При заданных назначениях и блокировках допустимый график не найден. Проверьте отдых и выходные; попробуйте снять один замочек." };
}
