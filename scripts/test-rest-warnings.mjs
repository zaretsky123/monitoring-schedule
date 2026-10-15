import assert from 'node:assert/strict';
import { validateSchedule } from '../public/workers/validator.js';
import { groupValidationIssues, describeValidationIssue, validationSummary } from '../public/workers/validation-report.js';
import { generateSchedule } from '../public/workers/generator.js';
import { createBlankMonthSchedule } from '../public/workers/sample.js';
import { periodForMonth } from '../public/workers/calendar.js';
const period = periodForMonth(2026,10);
const employees = [{id:'a', name:'Алексеев А. А.',active:true}];
function shift(day,type='D') {
 const start = new Date(Date.UTC(2026,9,day,type==='D'?8:20));
 return {id:`${start.toISOString().slice(0,10)}:${type}`,type,start,end:new Date(+start+12*3600000),employeeId:'a',plannedEmployeeId:'a'};
}
const restIssues = (schedule) => validateSchedule({schedule,employees,period}).issues.filter(i=>i.code==='REST_48H_INSTEAD_OF_FULL_DAYS'||i.code==='NO_TWO_FULL_DAYS_AFTER_BLOCK');
const block = [shift(6),shift(7),shift(8)];
assert.equal(restIssues([...block,shift(10,'N')])[0].severity,'warning');
assert.equal(restIssues([...block,shift(10,'N')])[0].details.restHours,48);
assert.equal(restIssues([...block,shift(10)])[0].severity,'error');
assert.equal(restIssues([...block,shift(10)])[0].details.restHours,36);
assert.equal(restIssues([...block,shift(11)]).length,0,'Two full calendar days need no warning');
assert.equal(restIssues([shift(6),shift(7),shift(9)]).length,0,'Two-shift blocks retain their existing rule');
const almost48=shift(10,'N');almost48.start=new Date(+almost48.start-60000);almost48.end=new Date(+almost48.start+12*3600000);
assert.equal(restIssues([...block,almost48])[0].severity,'error','47h59 is not 48h');
const fourBlock=[shift(5),...block];
assert.equal(restIssues([...fourBlock,shift(10,'N')])[0].severity,'warning','Four-shift blocks also allow 48h');
const warning=restIssues([...block,shift(10,'N')])[0];
const groups=groupValidationIssues([warning,warning,warning,warning]);
assert.equal(groups.length,1);assert.equal(groups[0].issues.length,4);
assert.equal(validationSummary(groups),'1 предупреждение');
assert.ok(describeValidationIssue(warning,employees,[...block,shift(10,'N')]).includes('Алексеев А. А.'));
assert.ok(describeValidationIssue(warning,employees,[]).includes('48 ч'));
const mixed=groupValidationIssues([warning,...restIssues([...block,shift(10)])]);
assert.equal(mixed[0].severity,'error');assert.equal(mixed.length,2);
// A complete timeline keeps unrelated checks satisfied; only the assigned employee's rest differs.
function complete(next) {
 const timeline=createBlankMonthSchedule(period);
 const assignments=[...block,next];
 return timeline.map(s=>assignments.find(a=>a.id===s.id)??{...s,employeeId:`other-${s.id}`,plannedEmployeeId:`other-${s.id}`});
}
function fullCheck(next,absences=[]) {
 const schedule=complete(next);
 const all=[...employees,...schedule.filter(s=>s.employeeId!=='a').map(s=>({id:s.employeeId,name:s.employeeId,active:true}))];
 return validateSchedule({schedule,employees:all,period,absences});
}
assert.equal(fullCheck(shift(10,'N')).valid,true,'Warnings do not block validation');
assert.equal(fullCheck(shift(10)).valid,false,'36h blocks validation');
assert.equal(fullCheck(shift(10,'N'),[{employeeId:'a',start:shift(6).start,end:shift(6).end}]).valid,false,'Availability is still mandatory with warnings');
// Generation must retain fixed assignments that use the newly permitted 48-hour rest.
const generationSource=complete(shift(10,'N'));
const vacant=generationSource.find(s=>s.id==='2026-10-20:D');vacant.employeeId='';
const all=[...employees,{id:'spare',name:'Резерв',active:true},...generationSource.filter(s=>s.employeeId&&s.employeeId!=='a').map(s=>({id:s.employeeId,name:s.employeeId,active:true}))];
const result=generateSchedule({schedule:generationSource,employees:all,period,mode:'optimal',manual:true,beamWidth:2,maxOptions:1,lockedEmployeeIds:all.filter(e=>e.id!=='spare').map(e=>e.id)});
assert.equal(result.found,true,result.reason);
assert.equal(result.options[0].metrics.restWarningCount,1);
assert.equal(result.options[0].schedule.find(s=>s.id===vacant.id).employeeId,'spare');
console.log('Rest rules: 36h / 47h59 blocked; 48h warning; full calendar days preferred; grouped details; other hard rules; generation fallback passed.');
