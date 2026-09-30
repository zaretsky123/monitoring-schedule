import assert from "node:assert/strict";

import { coefficientHoursForEmployee } from "../public/workers/coefficients.js";

function period(year, month) {
  return {
    year, month,
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}

function shift(date, type, employeeId = "fio-1") {
  const start = new Date(`${date}T${type === "D" ? "08" : "20"}:00:00Z`);
  return {
    id: `${date}:${type}`, type, start,
    end: new Date(start.getTime() + 12 * 3_600_000),
    employeeId, plannedEmployeeId: employeeId,
  };
}

function assertBreakdown(date, type, expected, label) {
  const result = coefficientHoursForEmployee([shift(date, type)], "fio-1", period(Number(date.slice(0, 4)), Number(date.slice(5, 7))));
  assert.deepEqual(result, { payableHours: 10, ...expected }, label);
  assert.equal(result.regularHours + result.nightHours + result.holidayHours, 10, `${label}: час не должен попадать в две категории`);
}

assertBreakdown("2026-10-01", "D", { regularHours: 10, nightHours: 0, holidayHours: 0, weightedHours: 10 }, "Обычный день");
assertBreakdown("2026-11-04", "D", { regularHours: 0, nightHours: 0, holidayHours: 10, weightedHours: 20 }, "Праздничный день");
assertBreakdown("2026-10-01", "N", { regularHours: 4, nightHours: 6, holidayHours: 0, weightedHours: 11.2 }, "Обычная ночь");
assertBreakdown("2026-11-03", "N", { regularHours: 2, nightHours: 2, holidayHours: 6, weightedHours: 16.4 }, "Ночь перед праздником");
assertBreakdown("2026-11-04", "N", { regularHours: 2, nightHours: 4, holidayHours: 4, weightedHours: 14.8 }, "Ночь после праздника");
assertBreakdown("2027-01-01", "N", { regularHours: 0, nightHours: 0, holidayHours: 10, weightedHours: 20 }, "Оба дня праздничные");
assertBreakdown("2026-10-03", "D", { regularHours: 10, nightHours: 0, holidayHours: 0, weightedHours: 10 }, "Обычная суббота");
assertBreakdown("2026-12-31", "D", { regularHours: 10, nightHours: 0, holidayHours: 0, weightedHours: 10 }, "Перенесённый выходной не является праздником");

const crossing = [shift("2026-12-31", "N")];
const december = coefficientHoursForEmployee(crossing, "fio-1", period(2026, 12));
const january = coefficientHoursForEmployee(crossing, "fio-1", period(2027, 1));
assert.deepEqual(december, { regularHours: 2, nightHours: 2, holidayHours: 0, payableHours: 4, weightedHours: 4.4 });
assert.deepEqual(january, { regularHours: 0, nightHours: 0, holidayHours: 6, payableHours: 6, weightedHours: 12 });
assert.equal(december.weightedHours + january.weightedHours, 16.4, "Переходящая праздничная смена не должна терять часы на границе года");

const ordinaryCrossing = [shift("2026-10-31", "N")];
const october = coefficientHoursForEmployee(ordinaryCrossing, "fio-1", period(2026, 10));
const november = coefficientHoursForEmployee(ordinaryCrossing, "fio-1", period(2026, 11));
assert.equal(october.weightedHours, 4.4);
assert.equal(november.weightedHours, 6.8);
assert.equal(october.weightedHours + november.weightedHours, 11.2);

assert.equal(coefficientHoursForEmployee([shift("2026-11-04", "D", "fio-2")], "fio-1", period(2026, 11)).weightedHours, 0, "Чужую смену не учитываем");
const original = [shift("2026-11-03", "N", "fio-1"), shift("2026-11-04", "D", "fio-2")];
const replaced = [{ ...original[0], employeeId: "fio-2" }, original[1]];
const originalTotals = ["fio-1", "fio-2"].map((id) => coefficientHoursForEmployee(original, id, period(2026, 11)).weightedHours);
const replacedTotals = ["fio-1", "fio-2"].map((id) => coefficientHoursForEmployee(replaced, id, period(2026, 11)).weightedHours);
assert.deepEqual(originalTotals, [16.4, 20]);
assert.deepEqual(replacedTotals, [0, 36.4]);
assert.equal(originalTotals[0] + originalTotals[1], replacedTotals[0] + replacedTotals[1], "Перестановка не создаёт и не теряет оплачиваемые часы");
assert.equal(coefficientHoursForEmployee([], "fio-1", period(2028, 1)), null, "Без календаря нового года не показываем ложный ноль");

console.log("Коэффициенты, перестановка и границы месяцев: проверки пройдены.");
