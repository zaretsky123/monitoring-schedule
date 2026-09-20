const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function utcDate(year: number, month: number, day: number, hour = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour));
}

export function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

export function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * HOUR_MS);
}

export function hoursBetween(start: Date, end: Date) {
  return (end.getTime() - start.getTime()) / HOUR_MS;
}

export function overlaps(startA: Date, endA: Date, startB: Date, endB: Date) {
  return startA < endB && endA > startB;
}

export function startOfUtcDay(date: Date) {
  return utcDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function startOfUtcWeek(date: Date) {
  const dayStart = startOfUtcDay(date);
  const mondayOffset = (dayStart.getUTCDay() + 6) % 7;
  return addDays(dayStart, -mondayOffset);
}

export function fullCalendarDaysBetween(restStart: Date, restEnd: Date) {
  let cursor = addDays(startOfUtcDay(restStart), 1);
  let count = 0;
  while (addDays(cursor, 1) <= restEnd) {
    if (cursor >= restStart) count += 1;
    cursor = addDays(cursor, 1);
  }
  return count;
}

export function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function periodForMonth(year: number, month: number) {
  return { year, month, start: utcDate(year, month, 1), end: utcDate(year, month + 1, 1) };
}

export function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function parseMonthKey(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return Number.isInteger(year) && month >= 1 && month <= 12 ? { year, month } : null;
}

export function addMonths(year: number, month: number, amount: number) {
  const date = new Date(Date.UTC(year, month - 1 + amount, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

export function formatMonthLabel(year: number, month: number) {
  const value = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(utcDate(year, month, 1));
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatMonthGenitive(year: number, month: number) {
  return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(utcDate(year, month, 1));
}
