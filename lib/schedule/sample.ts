import { addDays, addHours, dateKey, utcDate } from "./calendar";
import type { Employee, Shift } from "./types";

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

export function createOctober2026Schedule(): Shift[] {
  const octoberFirst = utcDate(2026, 10, 1);
  const shifts: Shift[] = [];
  for (let offset = -7; offset <= 37; offset += 1) {
    const date = addDays(octoberFirst, offset);
    const dayEmployee = DAY_PATTERN[mod(offset, DAY_PATTERN.length)];
    const nightEmployee = NIGHT_PATTERN[mod(offset, NIGHT_PATTERN.length)];
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

export function createBlankOctober2026Schedule(): Shift[] {
  const octoberFirst = utcDate(2026, 10, 1);
  const shifts: Shift[] = [];
  for (let offset = -1; offset <= 30; offset += 1) {
    const date = addDays(octoberFirst, offset);
    if (offset >= 0) {
      shifts.push({
        id: `${dateKey(date)}:D`, type: "D", start: addHours(date, 8), end: addHours(date, 20),
        plannedEmployeeId: "", employeeId: "",
      });
    }
    shifts.push({
      id: `${dateKey(date)}:N`, type: "N", start: addHours(date, 20), end: addHours(date, 32),
      plannedEmployeeId: "", employeeId: "",
    });
  }
  return shifts;
}

export function octoberPeriod() {
  return { year: 2026, month: 10, start: utcDate(2026, 10, 1), end: utcDate(2026, 11, 1) };
}

export const employeeNameById = Object.fromEntries(EMPLOYEES.map((employee) => [employee.id, employee.name]));
export const employeeIdByName = Object.fromEntries(EMPLOYEES.map((employee) => [employee.name, employee.id]));
