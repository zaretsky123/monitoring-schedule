import { addDays, fullCalendarDaysBetween } from "./calendar";
import { validateSchedule } from "./validator";
import type { Employee, GeneratedScheduleOption, GenerationMode, Period, Shift } from "./types";

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
      if (blockLength > 4) return null;
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
  maxOptions = 3,
  beamWidth = mode === "pattern" ? 4_000 : 7_000,
}: {
  schedule: Shift[];
  employees: Employee[];
  period: Period;
  seedDays?: number;
  mode: GenerationMode;
  maxOptions?: number;
  beamWidth?: number;
}) {
  const activeEmployees = employees.filter((employee) => employee.active);
  if (!activeEmployees.length) return { found: false as const, options: [], reason: "Нет активных сотрудников для формирования графика." };
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
