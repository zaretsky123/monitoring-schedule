import type { Employee, Shift } from "./types";

export const MAX_MONTH_EMPLOYEES = 8;

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
    && (employee.archivedAt === undefined || typeof employee.archivedAt === "string");
}
