import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../apps/web/package.json',import.meta.url));
const folder=mkdtempSync(join(tmpdir(),'alisa-catalog-period-'));
const compiler=join(dirname(require.resolve('typescript/package.json')),'bin','tsc');
const source=fileURLToPath(new URL('../../apps/web/src/app/app/catalog/catalog-question.ts',import.meta.url));
execFileSync(compiler,[source,'--module','commonjs','--target','ES2022','--skipLibCheck','--outDir',folder],
  {cwd:folder,env:{...process.env,PATH:dirname(process.execPath)+':'+process.env.PATH},timeout:30000});
const {moscowCalendarDate,catalogQuestion,catalogPeriodError}=require(join(folder,'catalog-question.js'));
after(()=>rmSync(folder,{recursive:true,force:true}));
const today='2026-11-15',dates={from:'2026-11-01',to:'2026-11-10'};
const item={description:'Продажи до удержаний. Описание опубликованного показателя.',kind:'scalar',
  input_policy:{snapshot:false,time_axis:'financial_period',period_required:true}};
test('existing yesterday draft is preserved',()=>{
  assert.equal(catalogQuestion(item,'yesterday',dates,today),'Покажи Продажи до удержаний за вчера');
});
test('custom period is explicit in the draft',()=>{
  assert.equal(catalogQuestion(item,'custom',dates,today),'Покажи Продажи до удержаний с 01.11.2026 по 10.11.2026');
});
test('seven complete Moscow calendar days exclude today',()=>{
  assert.equal(catalogQuestion(item,'last7',dates,today),'Покажи Продажи до удержаний с 08.11.2026 по 14.11.2026');
});
test('seven days cross year and leap-month boundaries',()=>{
  assert.match(catalogQuestion(item,'last7',dates,'2027-01-03'),/27\.12\.2026 по 02\.01\.2027$/);
  assert.match(catalogQuestion(item,'last7',dates,'2024-03-02'),/24\.02\.2024 по 01\.03\.2024$/);
});
for(const [name,range] of Object.entries({missing:{from:'',to:''},reversed:{from:'2026-11-10',to:'2026-11-01'},
  nonexistent:{from:'2026-02-30',to:'2026-03-01'},future:{from:'2026-11-01',to:'2026-11-16'},
  non_date:{from:'<script>',to:'2026-11-10'}})){
  test('invalid period cannot prepare a dated draft: '+name,()=>{
    assert.equal(catalogQuestion(item,'custom',range,today),null);
    assert.equal(typeof catalogPeriodError('custom',range,today),'string');
  });
}
test('same-day and valid leap-day ranges are allowed',()=>{
  assert.equal(catalogPeriodError('custom',{from:'2026-11-15',to:'2026-11-15'},today),null);
  assert.equal(catalogPeriodError('custom',{from:'2024-02-29',to:'2024-02-29'},today),null);
});
test('snapshot ignores report dates, including an incomplete range',()=>{
  assert.equal(catalogQuestion({...item,input_policy:{...item.input_policy,snapshot:true}},'custom',{from:'',to:''},today),'Покажи Продажи до удержаний сейчас');
});
test('report dates never override coefficient admission period',()=>{
  assert.equal(catalogQuestion({...item,kind:'parameter'},'custom',dates,today),'Покажи Продажи до удержаний');
});
test('information without a period is not assigned yesterday',()=>{
  assert.equal(catalogQuestion({...item,kind:'information',input_policy:{snapshot:false,time_axis:'none',period_required:false}},'custom',{from:'',to:''},today),'Покажи Продажи до удержаний');
});
test('maximum question size preserves the chosen dates',()=>{
  const question=catalogQuestion({...item,description:'П'.repeat(1500)},'custom',dates,today);
  assert.equal(question.length,1200);assert.match(question,/с 01\.11\.2026 по 10\.11\.2026$/);
});
test('calendar date uses Moscow midnight rather than host timezone',()=>{
  assert.equal(moscowCalendarDate(new Date('2026-11-14T20:59:59Z')),'2026-11-14');
  assert.equal(moscowCalendarDate(new Date('2026-11-14T21:00:00Z')),'2026-11-15');
});
