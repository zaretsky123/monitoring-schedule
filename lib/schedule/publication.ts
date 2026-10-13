import type { Period, Shift } from "./types";
import { baseShiftId, shiftSlots } from "./slots";

export function publicationSummary(schedule: Shift[], period: Period) {
  const relevant = schedule.filter((shift) => shift.slot !== 2 && shift.start < period.end && shift.end > period.start);
  const month = relevant.filter((shift) => shift.start >= period.start);
  const assigned = (shift: Shift) => shiftSlots(schedule, shift.id).filter((slot) => Boolean(slot.employeeId));
  return {
    monthCount: month.length,
    coveredMonthCount: month.filter((shift) => assigned(shift).length > 0).length,
    assignmentCount: schedule.filter((shift) => shift.start >= period.start && shift.start < period.end && shift.employeeId).length,
    emptyMonthIds: month.filter((shift) => assigned(shift).length === 0).map((shift) => shift.id),
    emptyIncomingIds: relevant.filter((shift) => shift.start < period.start && assigned(shift).length === 0).map((shift) => shift.id),
    singleReinforcementIds: relevant.filter((shift) => shiftSlots(schedule, shift.id).length > 1 && assigned(shift).length === 1).map((shift) => shift.id),
  };
}

export function preparePublishedSchedule(schedule: Shift[], period: Period): Shift[] {
  const relevant = new Set(schedule.filter((shift) => shift.slot !== 2 && shift.start < period.end && shift.end > period.start).map((shift) => shift.id));
  const promotions = new Map<string, Shift>();
  for (const primary of schedule.filter((shift) => shift.slot !== 2 && relevant.has(shift.id) && !shift.employeeId)) {
    const owner = shiftSlots(schedule, primary.id).find((shift) => shift.slot === 2 && shift.employeeId);
    if (owner) promotions.set(primary.id, owner);
  }
  const promotedIds = new Set([...promotions.values()].map((shift) => shift.id));
  return schedule.flatMap((shift) => {
    if (promotedIds.has(shift.id) || shift.slot === 2 && relevant.has(baseShiftId(shift)) && !shift.employeeId) return [];
    const owner = promotions.get(shift.id);
    const employeeId = owner?.employeeId ?? shift.employeeId;
    return [{ ...shift, employeeId, plannedEmployeeId: employeeId }];
  });
}
