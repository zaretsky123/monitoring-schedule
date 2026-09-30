// Нерабочие праздничные даты РФ. Обычные и перенесённые выходные здесь не указаны.
// Источники (сверять ежегодно до составления графиков нового года):
// https://www.consultant.ru/law/ref/calendar/proizvodstvennye/2026/
// https://www.consultant.ru/law/ref/calendar/proizvodstvennye/2027/
const FEDERAL_HOLIDAYS: Record<number, ReadonlySet<string>> = {
  2026: new Set([
    "2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08",
    "2026-02-23", "2026-03-08", "2026-05-01", "2026-05-09", "2026-06-12", "2026-11-04",
  ]),
  2027: new Set([
    "2027-01-01", "2027-01-02", "2027-01-03", "2027-01-04", "2027-01-05", "2027-01-06", "2027-01-07", "2027-01-08",
    "2027-02-23", "2027-03-08", "2027-05-01", "2027-05-09", "2027-06-12", "2027-11-04",
  ]),
};

export function hasHolidayCalendar(year: number) {
  return Object.hasOwn(FEDERAL_HOLIDAYS, year);
}

export function isFederalHoliday(date: string) {
  const year = Number(date.slice(0, 4));
  if (!hasHolidayCalendar(year)) throw new Error(`Календарь праздников за ${year} год не загружен`);
  return FEDERAL_HOLIDAYS[year].has(date);
}
