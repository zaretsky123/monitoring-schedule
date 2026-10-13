import assert from "node:assert/strict";
import { publicationSummary, preparePublishedSchedule } from "../public/workers/publication.js";
import { createBlankMonthSchedule, createPatternSchedule } from "../public/workers/sample.js";
import { periodForMonth } from "../public/workers/calendar.js";
import { secondSlot } from "../public/workers/slots.js";
import { validateSchedule } from "../public/workers/validator.js";

const period = periodForMonth(2026, 10);
const source = createPatternSchedule(period);
for (const primary of source.filter((shift) => shift.start >= period.start && shift.start < period.end).slice(0,22)) {
  source.push({ ...secondSlot(primary), employeeId: primary.id === '2026-10-02:D' ? '' : 'fifth', plannedEmployeeId: '' });
}
source.push(secondSlot(source.find((shift) => shift.id === '2026-09-30:N')));
const summary = publicationSummary(source, period);
assert.equal(summary.monthCount,62);
assert.equal(summary.coveredMonthCount,62);
assert.equal(summary.assignmentCount,83);
assert.deepEqual(summary.emptyMonthIds,[]);
assert.deepEqual(summary.emptyIncomingIds,[]);
assert.deepEqual(summary.singleReinforcementIds,['2026-09-30:N','2026-10-02:D']);
const fingerprint = (schedule) => schedule.filter((shift) => shift.employeeId).map((shift) => `${shift.employeeId}|${shift.start.toISOString()}|${shift.end.toISOString()}`).sort();
const before = JSON.stringify(source);
const published = preparePublishedSchedule(source,period);
assert.deepEqual(fingerprint(published),fingerprint(source),'Every employee/date/hour assignment survives publication');
assert.equal(JSON.stringify(source),before,'Publication does not mutate the draft');
assert.equal(published.some((shift) => shift.id === '2026-10-02:D:2'),false);
assert.equal(published.filter((shift) => shift.slot === 2 && shift.start >= period.start && shift.start < period.end).length,21,'Filled second places survive');

const promotion = createBlankMonthSchedule(period);
const primary = promotion.find((shift) => shift.id === '2026-10-02:D');
promotion.push({ ...secondSlot(primary), employeeId: 'fifth', plannedEmployeeId: 'fifth' });
const promoted = preparePublishedSchedule(promotion,period);
assert.equal(promoted.find((shift) => shift.id === primary.id).employeeId,'fifth','Removing the first of two people retains the remaining owner');
assert.equal(promoted.some((shift) => shift.id === `${primary.id}:2`),false);
assert.deepEqual(fingerprint(promoted),fingerprint(promotion));
assert.equal(publicationSummary(promotion,period).coveredMonthCount,1);
assert.equal(publicationSummary(promotion,period).emptyMonthIds.length,61);
assert.deepEqual(publicationSummary(promotion,period).emptyIncomingIds,['2026-09-30:N']);
assert.equal(publicationSummary(promotion,period).singleReinforcementIds.length,1);

const dualNight = createBlankMonthSchedule(period,'first');
dualNight.push({ ...secondSlot(dualNight[0]), employeeId:'second', plannedEmployeeId:'second' });
assert.equal(preparePublishedSchedule(dualNight,period).filter((shift)=>shift.start<period.start&&shift.employeeId).length,2,'Both incoming night workers survive');

const employees = ['fio-1','fio-2','fio-3','fio-4','fifth'].map((id)=>({id,name:id,active:true}));
const valid = createPatternSchedule(period);
valid.push(secondSlot(valid.find((shift)=>shift.id==='2026-10-02:D')));
const checked = validateSchedule({schedule:valid,employees,period});
assert.deepEqual(checked.issues.filter((issue)=>issue.code!=='UNCOVERED_SHIFT'),[],'Unused second place is the sole old validation problem');
assert.equal(validateSchedule({schedule:preparePublishedSchedule(valid,period),employees,period}).valid,true);
const unavailable = [{employeeId:'fio-2',start:new Date('2026-10-02T08:00:00Z'),end:new Date('2026-10-02T20:00:00Z')}];
assert.ok(validateSchedule({schedule:valid,employees,period,absences:unavailable}).issues.some((issue)=>issue.code==='EMPLOYEE_UNAVAILABLE'),'Absence remains a mandatory check');
console.log('Publication: 83 assignments / 62 covered shifts; current/incoming warnings; unused second slots; preserved owners/hours/dual nights; source immutability and mandatory availability checks passed.');
