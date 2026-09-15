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
