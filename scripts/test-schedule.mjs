import assert from "node:assert/strict";

import { solveSchedule } from "../public/workers/solver.js";
import { validateSchedule } from "../public/workers/validator.js";

const employees = [1, 2, 3, 4].map((number) => ({
  id: `fio-${number}`,
  name: `ФИО ${number}`,
  active: true,
}));
const dayPattern = ["fio-2", "fio-2", "fio-4", "fio-4", "fio-1", "fio-1", "fio-3", "fio-3"];
const nightPattern = ["fio-1", "fio-3", "fio-3", "fio-2", "fio-2", "fio-4", "fio-4", "fio-1"];
const octoberFirst = new Date(Date.UTC(2026, 9, 1));
const period = {
  year: 2026,
  month: 10,
  start: octoberFirst,
  end: new Date(Date.UTC(2026, 10, 1)),
};

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 3_600_000);
}

function mod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function createSchedule() {
  const schedule = [];
  for (let offset = -7; offset <= 37; offset += 1) {
    const date = addHours(octoberFirst, offset * 24);
    const dateKey = date.toISOString().slice(0, 10);
    for (const [type, startHour, endHour, employeeId] of [
      ["D", 8, 20, dayPattern[mod(offset, dayPattern.length)]],
      ["N", 20, 32, nightPattern[mod(offset, nightPattern.length)]],
    ]) {
      schedule.push({
        id: `${dateKey}:${type}`,
        type,
        start: addHours(date, startHour),
        end: addHours(date, endHour),
        employeeId,
        plannedEmployeeId: employeeId,
      });
    }
  }
  return schedule;
}

function createScheduleForMonth(year, month) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const anchor = Date.UTC(2026, 9, 1);
  const schedule = [];
  for (let offset = -7; offset <= dayCount + 6; offset += 1) {
    const date = addHours(start, offset * 24);
    const cycleOffset = Math.round((date.getTime() - anchor) / 86_400_000);
    const dateKey = date.toISOString().slice(0, 10);
    for (const [type, startHour, endHour, employeeId] of [
      ["D", 8, 20, dayPattern[mod(cycleOffset, dayPattern.length)]],
      ["N", 20, 32, nightPattern[mod(cycleOffset, nightPattern.length)]],
    ]) {
      schedule.push({
        id: `${dateKey}:${type}`,
        type,
        start: addHours(date, startHour),
        end: addHours(date, endHour),
        employeeId,
        plannedEmployeeId: employeeId,
      });
    }
  }
  return { schedule, period: { year, month, start, end }, dayCount };
}

function absenceFor(schedule, shiftId) {
  const shift = schedule.find((item) => item.id === shiftId);
  assert.ok(shift, `Смена ${shiftId} должна существовать`);
  return { employeeId: shift.employeeId, start: shift.start, end: shift.end };
}

function assertNoAbsenceOverlap(schedule, absences) {
  for (const absence of absences) {
    const overlaps = schedule.filter((shift) => (
      shift.employeeId === absence.employeeId
      && shift.start < absence.end
      && shift.end > absence.start
    ));
    assert.deepEqual(overlaps.map((shift) => shift.id), []);
  }
}

const original = createSchedule();
assert.equal(validateSchedule({ schedule: original, employees, period }).valid, true, "Исходный график должен быть допустимым");

const firstAbsence = absenceFor(original, "2026-10-14:N");
const request = {
  schedule: original,
  employees,
  period,
  absences: [firstAbsence],
  recalculationStart: firstAbsence.start,
  maxOptions: 3,
};
const normalOrder = solveSchedule(request);
const reverseOrder = solveSchedule({ ...request, employees: [...employees].reverse() });
assert.equal(normalOrder.found, true, "Для одиночной неявки должны находиться варианты");
assert.equal(reverseOrder.found, true, "Порядок сотрудников не должен влиять на наличие вариантов");
if (!normalOrder.found || !reverseOrder.found) process.exit(1);

assert.deepEqual(
  normalOrder.options.map((option) => option.key),
  reverseOrder.options.map((option) => option.key),
  "Перестановка порядка ФИО не должна менять лучшие варианты",
);
assert.equal(
  normalOrder.options[0].metrics.changedCount,
  Math.min(...normalOrder.options.map((option) => option.metrics.changedCount)),
  "Рекомендуемый вариант должен иметь минимальное число изменений",
);

const withoutExpansion = solveSchedule({ ...request, maxExtraChanges: 0 });
assert.equal(withoutExpansion.found, false, "Проверочный сценарий должен требовать дополнительную перестановку");
assert.ok(normalOrder.minimumChangeCount > 1, "Автоматический поиск должен расшириться дальше обязательной замены");

const afterFirst = normalOrder.options[0].schedule.map(({ baseEmployeeId: _baseEmployeeId, ...shift }) => shift);
const secondAbsence = absenceFor(afterFirst, "2026-10-10:D");
const combined = solveSchedule({
  schedule: afterFirst,
  employees,
  period,
  absences: [firstAbsence, secondAbsence],
  recalculationStart: secondAbsence.start,
  maxOptions: 3,
});
assert.equal(combined.found, true, "Последующая неявка более ранней датой должна пересчитываться");
if (!combined.found) process.exit(1);
for (const option of combined.options) {
  assertNoAbsenceOverlap(option.schedule, [firstAbsence, secondAbsence]);
  assert.equal(
    validateSchedule({ schedule: option.schedule, employees, period, absences: [firstAbsence, secondAbsence] }).valid,
    true,
    "Каждый предложенный вариант должен проходить полную проверку",
  );
}

for (const [year, month, expectedDays] of [[2027, 2, 28], [2028, 2, 29], [2026, 11, 30], [2026, 12, 31]]) {
  const sample = createScheduleForMonth(year, month);
  assert.equal(sample.dayCount, expectedDays, `${year}-${month}: неверное количество дней`);
  assert.equal(
    sample.schedule.filter((shift) => shift.start >= sample.period.start && shift.start < sample.period.end).length,
    expectedDays * 2,
    `${year}-${month}: должно быть по две начинающиеся смены на день`,
  );
  assert.equal(
    validateSchedule({ schedule: sample.schedule, employees, period: sample.period }).valid,
    true,
    `${year}-${month}: универсальный шаблон должен проходить обязательные проверки`,
  );
}

const octoberBoundary = createScheduleForMonth(2026, 10);
const novemberBoundary = createScheduleForMonth(2026, 11);
const octoberCarryOut = octoberBoundary.schedule.find((shift) => shift.type === "N" && shift.start < novemberBoundary.period.start && shift.end > novemberBoundary.period.start);
const novemberCarryIn = novemberBoundary.schedule.find((shift) => shift.id === octoberCarryOut?.id);
assert.ok(octoberCarryOut, "Октябрь должен содержать ночную смену, переходящую в ноябрь");
assert.equal(novemberCarryIn?.employeeId, octoberCarryOut?.employeeId, "На границе месяцев должна сохраняться одна и та же ночная смена и сотрудник");

console.log("Алгоритм и месяцы: 22 проверки пройдено.");
