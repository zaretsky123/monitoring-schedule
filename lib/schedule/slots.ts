import type { Shift } from "./types";

export function baseShiftId(shift: Pick<Shift, "id" | "slot">) {
  return shift.slot === 2 ? shift.id.replace(/:2$/, "") : shift.id;
}

export function shiftSlots(schedule: Shift[], baseId: string) {
  return schedule.filter((shift) => baseShiftId(shift) === baseId);
}

export function secondSlot(primary: Shift): Shift {
  return { ...primary, id: `${baseShiftId(primary)}:2`, slot: 2, employeeId: "", plannedEmployeeId: "", baseEmployeeId: undefined };
}

export function setReinforcements(schedule: Shift[], selected: string[], start: Date, end: Date) {
  const keys = new Set(selected);
  const result = schedule.filter((shift) => shift.slot !== 2 || shift.start < start || shift.start >= end || keys.has(baseShiftId(shift)) || Boolean(shift.employeeId));
  for (const primary of result.filter((shift) => shift.slot !== 2 && shift.start >= start && shift.start < end)) {
    if (keys.has(primary.id) && !result.some((shift) => shift.slot === 2 && baseShiftId(shift) === primary.id)) result.push(secondSlot(primary));
  }
  return result.sort((a,b) => a.start.getTime() - b.start.getTime() || (a.slot ?? 1) - (b.slot ?? 1));
}
