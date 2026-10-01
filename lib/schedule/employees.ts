import type { Absence, Employee, Shift } from "./types";
import { addDays } from "./calendar";

export const MAX_MONTH_EMPLOYEES = 8;

export function compactEmployeeName(name: string) {
  const parts = name.trim().split(/\s+/);
  if (/^ФИО\s+\d+$/i.test(name.trim()) || parts.length === 1) return { surname: name.trim(), initials: "" };
  return { surname: parts[0], initials: parts.slice(1, 3).map((part) => `${Array.from(part)[0]}.`).join(" ") };
}

export function shiftAbsences(employeeId: string, shift: Pick<Shift, "start" | "end">, absences: Absence[]) {
  return absences.filter((absence) => absence.employeeId === employeeId && shift.start < absence.end && shift.end > absence.start);
}

export function absencePeriod(startValue: string, endValue: string, mode: "days" | "time") {
  // Date-only periods include the entire final day. Time periods use exact endpoints.
  const start = new Date(mode === "days" ? `${startValue}T00:00:00Z` : `${startValue}Z`);
  const end = mode === "days" ? addDays(new Date(`${endValue}T00:00:00Z`), 1) : new Date(`${endValue}Z`);
  return !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && start < end ? { start, end } : null;
}

export function isEmployeeAvailable(employee: Employee, shift: Pick<Shift, "start" | "end">) {
  if (!employee.active && !employee.endDateTime) return false;
  if (employee.startDate && shift.start < new Date(`${employee.startDate}T00:00:00Z`)) return false;
  if (employee.endDateTime && shift.end > new Date(`${employee.endDateTime}Z`)) return false;
  return true;
}

export function isEmployeeRecord(value: unknown): value is Employee {
  if (!value || typeof value !== "object") return false;
  const employee = value as Employee;
  return typeof employee.id === "string" && employee.id.length > 0
    && typeof employee.name === "string" && employee.name.trim().length > 0
    && typeof employee.active === "boolean"
    && (employee.isTest === undefined || typeof employee.isTest === "boolean")
    && (employee.startDate === undefined || /^\d{4}-\d{2}-\d{2}$/.test(employee.startDate) && !Number.isNaN(Date.parse(`${employee.startDate}T00:00:00Z`)))
    && (employee.endDateTime === undefined || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(employee.endDateTime) && !Number.isNaN(Date.parse(`${employee.endDateTime}Z`)))
    && (employee.archivedAt === undefined || typeof employee.archivedAt === "string")
    && (employee.hourlyRate === undefined || typeof employee.hourlyRate === "number" && Number.isFinite(employee.hourlyRate) && employee.hourlyRate >= 0);
}
