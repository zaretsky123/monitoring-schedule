import { dateKey } from "./calendar";
import { hasHolidayCalendar, isFederalHoliday } from "./holidays";
import type { Period, Shift } from "./types";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export type CoefficientHours = {
  regularHours: number;
  nightHours: number;
  holidayHours: number;
  payableHours: number;
  weightedHours: number;
};

export function coefficientHoursForEmployee(schedule: Shift[], employeeId: string, period: Period): CoefficientHours | null {
  if (!hasHolidayCalendar(period.year)) return null;

  let regularMinutes = 0;
  let nightMinutes = 0;
  let holidayMinutes = 0;

  function addInterval(start: number, end: number) {
    const clippedStart = Math.max(start, period.start.getTime());
    const clippedEnd = Math.min(end, period.end.getTime());
    if (clippedStart >= clippedEnd) return;

    // Все действующие смены состоят из целых часов; деление на часовые
    // отрезки позволяет без округления учитывать полночь и границы месяцев.
    for (let cursor = clippedStart; cursor < clippedEnd;) {
      const date = new Date(cursor);
      const nextHour = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours() + 1);
      const segmentEnd = Math.min(clippedEnd, nextHour);
      const minutes = (segmentEnd - cursor) / MINUTE_MS;
      if (isFederalHoliday(dateKey(date))) holidayMinutes += minutes;
      else if (date.getUTCHours() >= 22 || date.getUTCHours() < 6) nightMinutes += minutes;
      else regularMinutes += minutes;
      cursor = segmentEnd;
    }
  }

  for (const shift of schedule) {
    if (shift.employeeId !== employeeId || shift.end <= period.start || shift.start >= period.end) continue;
    if (shift.type === "D") {
      // 08:00–20:00: 10 расчётных часов в том же календарном дне.
      // Место двухчасового отдыха в дневной смене на коэффициент не влияет.
      const minutes = (shift.end.getTime() - shift.start.getTime()) / MINUTE_MS - 120;
      if (minutes < 0) throw new Error(`Некорректная дневная смена ${shift.id}`);
      if (isFederalHoliday(dateKey(shift.start))) holidayMinutes += minutes;
      else regularMinutes += minutes;
    } else {
      // 20:00–00:00 и 02:00–08:00: 00:00–02:00 исключаем только здесь.
      const start = shift.start.getTime();
      addInterval(start, start + 4 * HOUR_MS);
      addInterval(start + 6 * HOUR_MS, shift.end.getTime());
    }
  }

  return {
    regularHours: regularMinutes / 60,
    nightHours: nightMinutes / 60,
    holidayHours: holidayMinutes / 60,
    payableHours: (regularMinutes + nightMinutes + holidayMinutes) / 60,
    // Считаем целыми минутами и десятыми долями коэффициента (10/12/20).
    weightedHours: (regularMinutes * 10 + nightMinutes * 12 + holidayMinutes * 20) / 600,
  };
}
