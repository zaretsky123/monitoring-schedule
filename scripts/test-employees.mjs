import assert from "node:assert/strict";
import { isEmployeeAvailable, isEmployeeRecord, compactEmployeeName, absencePeriod, shiftAbsences } from "../public/workers/employees.js";
import { generateSchedule } from "../public/workers/generator.js";
import { validateSchedule } from "../public/workers/validator.js";
import { periodForMonth, addDays, addHours, dateKey } from "../public/workers/calendar.js";

const shift = { start: new Date("2026-10-02T20:00:00Z"), end: new Date("2026-10-03T08:00:00Z") };
const ordinary = { id: "ordinary", name: "Иван Иванов", active: true, startDate: "2026-10-02" };
assert.equal(isEmployeeAvailable(ordinary, shift), true);
assert.equal(isEmployeeAvailable({ ...ordinary, startDate: "2026-10-03" }, shift), false);
assert.equal(isEmployeeAvailable({ ...ordinary, active: false, endDateTime: "2026-10-03T08:00" }, shift), true);
assert.equal(isEmployeeAvailable({ ...ordinary, active: false, endDateTime: "2026-10-03T07:59" }, shift), false);
assert.equal(isEmployeeAvailable({ ...ordinary, active: false }, shift), false);
assert.equal(isEmployeeAvailable({ ...ordinary, isTest: true }, shift), true);
assert.equal(isEmployeeRecord(ordinary), true);
assert.equal(isEmployeeRecord({ ...ordinary, name: " " }), false);
assert.equal(isEmployeeRecord({ ...ordinary, startDate: "bad-date" }), false);
assert.equal(isEmployeeRecord({ ...ordinary, endDateTime: "bad-date" }), false);

assert.deepEqual(compactEmployeeName("Алексеев Александр Сергеевич"), { surname: "Алексеев", initials: "А. С." });
assert.deepEqual(compactEmployeeName("ФИО 1"), { surname: "ФИО 1", initials: "" });
const inclusive = absencePeriod("2026-10-01", "2026-10-08", "days");
assert.equal(inclusive.end.toISOString(), "2026-10-09T00:00:00.000Z");
assert.equal(absencePeriod("2026-10-08", "2026-10-01", "days"), null);
assert.equal(absencePeriod("", "", "days"), null);
const exact = absencePeriod("2026-10-02T20:00", "2026-10-03T08:00", "time");
assert.equal(exact.end.toISOString(), shift.end.toISOString());
assert.equal(shiftAbsences("ordinary", shift, [{ employeeId: "ordinary", ...inclusive }]).length, 1);
assert.equal(shiftAbsences("other", shift, [{ employeeId: "ordinary", ...inclusive }]).length, 0);
assert.equal(shiftAbsences("ordinary", { start: inclusive.end, end: addHours(inclusive.end,12) }, [{ employeeId: "ordinary", ...inclusive }]).length, 0);
assert.equal(isEmployeeRecord({ ...ordinary, hourlyRate: -1 }), false);
assert.equal(isEmployeeRecord({ ...ordinary, hourlyRate: 250.5 }), true);

const period = periodForMonth(2026, 10);
const employees = Array.from({ length: 8 }, (_, index) => ({
  id: `employee-${index}`, name: index < 2 ? "Одинаковое ФИО" : `Сотрудник ${index + 1}`, active: true,
  isTest: index === 7, startDate: index === 7 ? "2026-10-15" : undefined,
}));
const blank = [];
for (let offset = -1; offset < 31; offset += 1) {
  const date = addDays(period.start, offset);
  for (const type of offset < 0 ? ["N"] : ["D", "N"]) {
    blank.push({ id: `${dateKey(date)}:${type}`, type, start: addHours(date, type === "D" ? 8 : 20), end: addHours(date, type === "D" ? 20 : 32), employeeId: "", plannedEmployeeId: "" });
  }
}
const started = performance.now();
const result = generateSchedule({ schedule: blank, employees, period, seedDays: 8, mode: "optimal", manual: true, maxOptions: 3 });
assert.equal(result.found, true, result.reason);
assert.ok(result.options.length > 0 && result.options.length <= 3);
for (const option of result.options) {
  assert.equal(validateSchedule({ schedule: option.schedule, employees, period }).valid, true);
  assert.ok(option.schedule.every((item) => item.employeeId));
  assert.ok(option.schedule.every((item) => item.employeeId !== "employee-7" || item.start >= new Date("2026-10-15T00:00:00Z")));
  assert.equal(Object.keys(option.metrics.workHours).length, 8);
}
console.log(`Сотрудники: даты начала/увольнения, одинаковые ФИО, тестовый флаг, расчёт с 8 участниками проверены (${((performance.now() - started) / 1000).toFixed(2)} с).`);

const { secondSlot, setReinforcements, shiftSlots } = await import('../public/workers/slots.js');
const { solveSchedule } = await import('../public/workers/solver.js');
const { coefficientHoursForEmployee } = await import('../public/workers/coefficients.js');
const manual = blank.map(s=>({...s}));
for (const day of [1,9,17,25]) Object.assign(manual.find(s=>s.id===`2026-10-${String(day).padStart(2,'0')}:D`), {employeeId:'employee-0',plannedEmployeeId:'employee-0'});
let reinforced = setReinforcements(manual,['2026-10-01:D','2026-10-03:N','2026-10-12:D'],period.start,period.end);
Object.assign(reinforced.find(s=>s.id==='2026-10-01:D:2'),{employeeId:'employee-1',plannedEmployeeId:'employee-1'});
const absent = [{employeeId:'employee-2',start:new Date('2026-10-03T20:00:00Z'),end:new Date('2026-10-04T08:00:00Z')}];
const dual = generateSchedule({schedule:reinforced,employees,period,mode:'optimal',manual:true,lockedEmployeeIds:['employee-0'],absences:absent,maxOptions:1});
assert.equal(dual.found,true,dual.reason);
const dualSchedule=dual.options[0].schedule;
assert.equal(dualSchedule.filter(s=>s.employeeId==='employee-0'&&s.start>=period.start&&s.start<period.end).length,4,'Locked employee keeps exactly four manual shifts');
assert.equal(dualSchedule.find(s=>s.id==='2026-10-01:D:2').employeeId,'employee-1','Second manual assignment preserved');
for (const id of ['2026-10-01:D','2026-10-03:N','2026-10-12:D']) {
 const slots=shiftSlots(dualSchedule,id);assert.equal(slots.length,2);assert.ok(slots.every(s=>s.employeeId));assert.notEqual(slots[0].employeeId,slots[1].employeeId);
}
assert.equal(validateSchedule({schedule:dualSchedule,employees,period,absences:absent}).valid,true);
assert.ok(shiftSlots(dualSchedule,'2026-10-03:N').every(s=>s.employeeId!=='employee-2'));
const same=dualSchedule.map(s=>s.id==='2026-10-01:D:2'?{...s,employeeId:'employee-0'}:s);
assert.equal(validateSchedule({schedule:same,employees,period}).valid,false,'Cannot assign same employee twice');
assert.equal(setReinforcements(reinforced,[],period.start,period.end).filter(s=>s.slot===2).length,1,'Removing preference preserves manually assigned second slot');
const seedDual=generateSchedule({schedule:reinforced.map(s=>({...s,employeeId:s.start<addDays(period.start,8)?s.employeeId:'',plannedEmployeeId:s.start<addDays(period.start,8)?s.plannedEmployeeId:''})),employees,period,mode:'pattern',manual:false,maxOptions:1});
// Incomplete primary seed is still rejected, even when reinforcement is selected.
assert.equal(seedDual.found,false);
const extraEmployees=[...employees,{id:'replacement-a',name:'Замена А',active:true},{id:'replacement-b',name:'Замена Б',active:true}];
const base=result.options[0].schedule;
const primary=base.find(s=>s.id==='2026-10-10:D');
const extra={...secondSlot(primary),employeeId:'replacement-a',plannedEmployeeId:'replacement-a'};
const replacement=solveSchedule({schedule:[...base,extra],employees:extraEmployees,period,absences:[{employeeId:'replacement-a',start:extra.start,end:extra.end}],recalculationStart:extra.start,requiredAssignments:{[extra.id]:'replacement-b'},maxExtraChanges:0,maxOptions:1});
assert.equal(replacement.found,true,replacement.reason);
assert.equal(replacement.options[0].schedule.find(s=>s.id===primary.id).employeeId,primary.employeeId,'Replacing second employee preserves first');
assert.equal(replacement.options[0].schedule.find(s=>s.id===extra.id).employeeId,'replacement-b');
assert.equal(coefficientHoursForEmployee([primary,extra],'replacement-a',period).payableHours,10,'Second employee receives own paid hours');
console.log('Два сотрудника: усиленные дневные/ночные смены, 4 ручные смены с замочком, недоступность, отдельная замена и коэффициенты проверены.');

const seeded = setReinforcements(base.map(s=>s.start>=addDays(period.start,8)&&s.start<period.end?{...s,employeeId:"",plannedEmployeeId:""}:{...s}),['2026-10-03:N','2026-10-16:D'],period.start,period.end);
const seededResult=generateSchedule({schedule:seeded,employees,period,mode:'pattern',maxOptions:1});
assert.equal(seededResult.found,true,seededResult.reason);
assert.equal(validateSchedule({schedule:seededResult.options[0].schedule,employees,period}).valid,true);
for(const id of ['2026-10-03:N','2026-10-16:D']) assert.equal(new Set(shiftSlots(seededResult.options[0].schedule,id).map(s=>s.employeeId)).size,2);
console.log('Усиление в режиме образца: заполнение второго места в первых восьми днях и после них проверено.');
