import { addDays, addHours, dateKey, daysInMonth, periodForMonth, utcDate } from "./calendar";
import type { Employee, Period, Shift } from "./types";

export const EMPLOYEES: Employee[] = [
  { id: "fio-1", name: "ФИО 1", active: true },
  { id: "fio-2", name: "ФИО 2", active: true },
  { id: "fio-3", name: "ФИО 3", active: true },
  { id: "fio-4", name: "ФИО 4", active: true },
];

const DAY_PATTERN = ["fio-2", "fio-2", "fio-4", "fio-4", "fio-1", "fio-1", "fio-3", "fio-3"];
const NIGHT_PATTERN = ["fio-1", "fio-3", "fio-3", "fio-2", "fio-2", "fio-4", "fio-4", "fio-1"];

function mod(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}

const PATTERN_ANCHOR = utcDate(2026, 10, 1);

function patternOffset(date: Date) {
  return Math.round((date.getTime() - PATTERN_ANCHOR.getTime()) / 86_400_000);
}

export function createPatternSchedule(period: Period): Shift[] {
  const dayCount = daysInMonth(period.year, period.month);
  const shifts: Shift[] = [];
  for (let offset = -7; offset <= dayCount + 6; offset += 1) {
    const date = addDays(period.start, offset);
    const cycleOffset = patternOffset(date);
    const dayEmployee = DAY_PATTERN[mod(cycleOffset, DAY_PATTERN.length)];
    const nightEmployee = NIGHT_PATTERN[mod(cycleOffset, NIGHT_PATTERN.length)];
    shifts.push({
      id: `${dateKey(date)}:D`, type: "D", start: addHours(date, 8), end: addHours(date, 20),
      plannedEmployeeId: dayEmployee, employeeId: dayEmployee,
    });
    shifts.push({
      id: `${dateKey(date)}:N`, type: "N", start: addHours(date, 20), end: addHours(date, 32),
      plannedEmployeeId: nightEmployee, employeeId: nightEmployee,
    });
  }
  return shifts;
}

export function createBlankMonthSchedule(period: Period, carryInEmployeeId = ""): Shift[] {
  const dayCount = daysInMonth(period.year, period.month);
  const shifts: Shift[] = [];
  for (let offset = -1; offset < dayCount; offset += 1) {
    const date = addDays(period.start, offset);
    if (offset >= 0) {
      shifts.push({
        id: `${dateKey(date)}:D`, type: "D", start: addHours(date, 8), end: addHours(date, 20),
        plannedEmployeeId: "", employeeId: "",
      });
    }
    shifts.push({
      id: `${dateKey(date)}:N`, type: "N", start: addHours(date, 20), end: addHours(date, 32),
      plannedEmployeeId: offset === -1 ? carryInEmployeeId : "", employeeId: offset === -1 ? carryInEmployeeId : "",
    });
  }
  return shifts;
}

export function createOctober2026Schedule(): Shift[] {
  return createPatternSchedule(periodForMonth(2026, 10));
}

export function createBlankOctober2026Schedule(): Shift[] {
  return createBlankMonthSchedule(periodForMonth(2026, 10));
}

export function octoberPeriod() {
  return periodForMonth(2026, 10);
}

export const employeeNameById = Object.fromEntries(EMPLOYEES.map((employee) => [employee.id, employee.name]));
export const employeeIdByName = Object.fromEntries(EMPLOYEES.map((employee) => [employee.name, employee.id]));
