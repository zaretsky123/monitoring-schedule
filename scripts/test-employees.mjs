import assert from "node:assert/strict";
import { isEmployeeAvailable, isEmployeeRecord, compactEmployeeName, absencePeriod, shiftAbsences } from "../public/workers/employees.js";
import { generateSchedule } from "../public/workers/generator.js";
import { validateSchedule } from "../public/workers/validator.js";
import { periodForMonth, addDays, addHours, dateKey } from "../public/workers/calendar.js";

const shift = { start: new Date("2026-10-02T20:00:00Z"), end: new Date("2026-10-03T08:00:00Z") };
const ordinary = { id: "ordinary", name: "Иван Иванов", active: true, startDate: "2026-10-02" };
assert.equal(isEmployeeAvailable(ordinary, shift), true);
assert.equal(isEmployeeAvailable({ ...ordinary, startDate: "2026-10-03" }, shift), false);
assert.equal(isEmployeeAvailable({ ...ordinary, active: false, endDateTime: "2026-10-03T08:00" }, shift), true);
assert.equal(isEmployeeAvailable({ ...ordinary, active: false, endDateTime: "2026-10-03T07:59" }, shift), false);
assert.equal(isEmployeeAvailable({ ...ordinary, active: false }, shift), false);
assert.equal(isEmployeeAvailable({ ...ordinary, isTest: true }, shift), true);
assert.equal(isEmployeeRecord(ordinary), true);
assert.equal(isEmployeeRecord({ ...ordinary, name: " " }), false);
assert.equal(isEmployeeRecord({ ...ordinary, startDate: "bad-date" }), false);
assert.equal(isEmployeeRecord({ ...ordinary, endDateTime: "bad-date" }), false);

assert.deepEqual(compactEmployeeName("Алексеев Александр Сергеевич"), { surname: "Алексеев", initials: "А. С." });
assert.deepEqual(compactEmployeeName("ФИО 1"), { surname: "ФИО 1", initials: "" });
const inclusive = absencePeriod("2026-10-01", "2026-10-08", "days");
assert.equal(inclusive.end.toISOString(), "2026-10-09T00:00:00.000Z");
assert.equal(absencePeriod("2026-10-08", "2026-10-01", "days"), null);
assert.equal(absencePeriod("", "", "days"), null);
const exact = absencePeriod("2026-10-02T20:00", "2026-10-03T08:00", "time");
assert.equal(exact.end.toISOString(), shift.end.toISOString());
assert.equal(shiftAbsences("ordinary", shift, [{ employeeId: "ordinary", ...inclusive }]).length, 1);
assert.equal(shiftAbsences("other", shift, [{ employeeId: "ordinary", ...inclusive }]).length, 0);
assert.equal(shiftAbsences("ordinary", { start: inclusive.end, end: addHours(inclusive.end,12) }, [{ employeeId: "ordinary", ...inclusive }]).length, 0);
assert.equal(isEmployeeRecord({ ...ordinary, hourlyRate: -1 }), false);
assert.equal(isEmployeeRecord({ ...ordinary, hourlyRate: 250.5 }), true);

const period = periodForMonth(2026, 10);
const employees = Array.from({ length: 8 }, (_, index) => ({
  id: `employee-${index}`, name: index < 2 ? "Одинаковое ФИО" : `Сотрудник ${index + 1}`, active: true,
  isTest: index === 7, startDate: index === 7 ? "2026-10-15" : undefined,
}));
const blank = [];
for (let offset = -1; offset < 31; offset += 1) {
  const date = addDays(period.start, offset);
  for (const type of offset < 0 ? ["N"] : ["D", "N"]) {
    blank.push({ id: `${dateKey(date)}:${type}`, type, start: addHours(date, type === "D" ? 8 : 20), end: addHours(date, type === "D" ? 20 : 32), employeeId: "", plannedEmployeeId: "" });
  }
}
const started = performance.now();
const result = generateSchedule({ schedule: blank, employees, period, seedDays: 8, mode: "optimal", manual: true, maxOptions: 3 });
assert.equal(result.found, true, result.reason);
assert.ok(result.options.length > 0 && result.options.length <= 3);
for (const option of result.options) {
  assert.equal(validateSchedule({ schedule: option.schedule, employees, period }).valid, true);
  assert.ok(option.schedule.every((item) => item.employeeId));
  assert.ok(option.schedule.every((item) => item.employeeId !== "employee-7" || item.start >= new Date("2026-10-15T00:00:00Z")));
  assert.equal(Object.keys(option.metrics.workHours).length, 8);
}
console.log(`Сотрудники: даты начала/увольнения, одинаковые ФИО, тестовый флаг, расчёт с 8 участниками проверены (${((performance.now() - started) / 1000).toFixed(2)} с).`);
