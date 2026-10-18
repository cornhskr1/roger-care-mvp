#!/usr/bin/env node
'use strict';
// Invented records only. The optional browser suite serves a synthetic seed on
// an ephemeral localhost origin and blocks every other origin. It never reads
// production seed data or authenticates, publishes, imports, or saves records.
// Run: node scripts/test-treatment-status.cjs [--browser]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const reporter = require(path.join(root, 'handoff-report.js'));
const {fixture:bootFixture} = require('./test-navigation.cjs');
const NOW = '2026-10-18T12:00:00.000Z';
const AS_OF = '2026-10-18';
const SAVED_AT = '2026-10-17T22:43:12.000Z';
const ORIGINAL = 'SYN-original: Vinblastine 5/8; historical wording & follow-up unknown.';
const CURRENT = 'Vinblastine treatment 6 of 8 recorded';
const UNKNOWN = 'Treatment progress not recorded';
const clone = value => structuredClone(value);
const json = value => JSON.stringify(value);
const plain = value => JSON.parse(json(value));
const esc = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const text = html => html.replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW])); }
  static now() { return Date.parse(NOW); }
}
function deepFreeze(value) {
  if(value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);Object.values(value).forEach(deepFreeze);
  }
  return value;
}
function treatment(number=6, overrides={}) {
  return {...clone(bootFixture.treatments[0]),id:`SYN-status-treatment-${number}`,number,date:'2026-10-10',drug:'Vinblastine',source:`SYN-treatment-source-${number}`,...overrides};
}
function fixture() {
  const value=clone(bootFixture);
  value._savedAt=SAVED_AT;
  value.profile={...value.profile,name:'Synthetic pet',fullName:'SYN-status-pet',currentStatus:ORIGINAL};
  const dates=['2026-08-01','2026-08-15','2026-08-29','2026-09-12','2026-09-26','2026-10-10'];
  value.treatments=dates.map((date,index)=>treatment(index+1,{date}));
  value.carePlan.visits=[{id:'SYN-planned-seventh',label:'SYN-next planned treatment #7',date:'2026-10-24',status:'scheduled',source:'SYN-plan-only'}];
  return value;
}
function progress(rows, options={}) { return reporter.treatmentProgress(rows,{asOfDate:AS_OF,...options}); }
function section(html,id) {
  const opening=new RegExp(`<([a-z][a-z0-9]*)\\b[^>]*\\bid=["']${id}["'][^>]*>`,'i').exec(html);
  assert(opening,`Report section #${id} exists`);
  const tags=new RegExp(`<(/?)${opening[1]}\\b[^>]*>`,'gi');tags.lastIndex=opening.index;
  let depth=0,tag;
  while((tag=tags.exec(html))) {
    depth+=tag[1]?-1:1;
    if(!depth)return html.slice(opening.index,tags.lastIndex);
  }
  assert.fail(`Report section #${id} closes`);
}
function currentProfileLine(html) {
  const line=[...html.matchAll(/<div class="profile-line">([\s\S]*?)<\/div>\s*<\/div>/g)].find(match=>/Current status/i.test(match[1]));
  assert(line,'Profile keeps one clearly labeled Current status row');
  return text(line[0]);
}
function originalProfileNote(html) {
  const start=html.search(/<details\b[^>]*\bid=["']historicalProfileStatus["'][^>]*>/);
  assert(start>=0,'Profile keeps a separate historical note disclosure');
  const end=html.indexOf('</details>',start);
  assert(end>start,'Historical note disclosure closes');
  return html.slice(start,end+'</details>'.length);
}
function assertHistoricalNote(html,label) {
  const note=text(html);
  assert.match(note,/original|historical/i,label+' identifies source text as historical');
  assert.match(note,/date (?:is )?(?:unknown|not recorded)|unknown date/i,label+' does not invent a date');
  assert(note.includes(ORIGINAL),label+' preserves original wording verbatim');
  assert(!note.includes(SAVED_AT),label+' does not date the source from the whole-record save timestamp');
}
function pdfText(pdf) {
  assert(pdf.startsWith('%PDF-1.4'),'Short export is a real PDF');
  return [...pdf.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map(match=>match[1].replace(/\\([\\()])/g,'$1')).join(' ').replace(/\s+/g,' ');
}
function createApp() {
  const profileNode={innerHTML:''},writes=[];
  const storage={getItem(){return null;},setItem(){writes.push('setItem');},removeItem(){writes.push('removeItem');},clear(){writes.push('clear');}};
  const context=vm.createContext({console,structuredClone,Date:FixedDate,Intl,RogerHandoff:reporter,localStorage:storage,sessionStorage:storage,document:{addEventListener(){},querySelector(){return null;},querySelectorAll(){return [];}}});
  context.profileNode=profileNode;
  vm.runInContext(fs.readFileSync(path.join(root,'app.js'),'utf8')+`\n
    globalThis.statusTestApi={
      set(value){state=value;documents=[];els.profileDetails=profileNode;Object.assign(careSnapshotRange,{mode:'custom',from:'2026-10-01',to:'2026-10-18'});},
      status:recordedTreatmentStatus,
      range(value){Object.assign(careSnapshotRange,value);},
      profile(){renderProfileDetails();return profileNode.innerHTML;},
      pdf:buildCareSummaryPdf,html:buildCareSummaryHtml,full:buildCompleteTreatmentReport,
      state(){return JSON.stringify(state);}
    };`,context,{filename:'app.js'});
  return {api:context.statusTestApi,writes};
}
const tests=[];
const test=(name,run)=>tests.push({name,run});
test('shared helper is exported in CommonJS and the standalone browser module',()=>{
  assert.equal(typeof reporter.treatmentProgress,'function');
  const sandbox=vm.createContext({console,Date:FixedDate,Intl,structuredClone});
  vm.runInContext(fs.readFileSync(path.join(root,'handoff-report.js'),'utf8'),sandbox,{filename:'handoff-report.js'});
  assert.equal(typeof sandbox.RogerHandoff.treatmentProgress,'function');
  assert.deepEqual(plain(sandbox.RogerHandoff.treatmentProgress([treatment()],{asOfDate:AS_OF})),plain(progress([treatment()])));
});
test('empty, missing, and invalid treatment collections remain unknown, not stale 5/8',()=>{
  for(const rows of [[],undefined,null,{},'not a treatment collection']) {
    const result=progress(rows);
    assert.equal(result.number,null);assert.equal(result.date,null);assert.equal(result.drug,null);
    assert.equal(result.text,UNKNOWN);assert.deepEqual(result.sourceRecordIndices,[]);
    assert.doesNotMatch(result.text,/5\s*(?:\/|of)\s*8|complete|normal/i);
  }
});
test('highest recorded number is not array length and does not invent earlier doses',()=>{
  const result=progress([treatment()]);
  assert.equal(result.number,6);assert.equal(result.plannedTotal,8);assert.equal(result.date,'2026-10-10');
  assert.equal(result.drug,'Vinblastine');assert.equal(result.text,CURRENT);assert.deepEqual(result.sourceRecordIndices,[0]);
  assert.doesNotMatch(result.text,/six (?:doses|treatments)|all|complete|1 of 8/i);
});
test('out-of-order and duplicate records retain every source and do not inflate progress',()=>{
  const rows=[treatment(2),treatment(6),treatment(1),treatment(6,{id:'SYN-duplicate-six'}),treatment(4)];
  const before=json(rows),result=progress(deepFreeze(rows));
  assert.equal(result.number,6);assert.equal(result.text,CURRENT);assert.deepEqual(result.sourceRecordIndices,[1,3]);
  assert.equal(json(rows),before,'No sorting, deletion, or deduplication of input');
});
test('explicit non-administration statuses are never promoted into recorded treatment',()=>{
  const accepted=[undefined,null,'','  ','completed','given','administered','performed','recorded','confirmed',' COMPLETED '];
  for(const status of accepted) assert.equal(progress([treatment(6,{status})]).number,6,`Accepted treatment status ${String(status)}`);
  for(const status of ['scheduled','planned','held','cancelled','canceled','skipped','unknown','not given','pending','prescribed']) {
    assert.equal(progress([treatment(6),treatment(7,{status})]).number,6,`Excluded ${status}`);
    assert.equal(progress([treatment(7,{status})]).text,UNKNOWN,`${status} alone remains unknown`);
  }
});
test('future valid dates are excluded using the supplied as-of day, including same-day boundary',()=>{
  const rows=[treatment(6),treatment(7,{date:'2026-10-19'}),treatment(8,{date:'2026-10-24',status:'completed'})];
  assert.equal(progress(rows).number,6);
  assert.equal(progress(rows,{asOfDate:'2026-10-19'}).number,7);
  assert.equal(progress(rows,{asOfDate:'2026-10-24'}).number,8);
  assert.equal(progress(rows,{asOfDate:'2026-10-09'}).text,UNKNOWN);
});
test('invalid numbers cannot become zero, a boolean, a fraction, or a bogus highest treatment',()=>{
  for(const number of [undefined,null,'','  ',false,true,0,-1,6.5,'6.5','six',NaN,Infinity,-Infinity,{},[]]) {
    const result=progress([treatment(6,{number})]);
    assert.equal(result.number,null,`Reject ${String(number)}`);assert.equal(result.text,UNKNOWN);
  }
  assert.equal(progress([treatment(' 6 ')]).text,CURRENT,'Numeric strings remain compatible with imported data');
  const over=progress([treatment(9)]);
  assert.equal(over.number,9);assert.match(over.text,/treatment 9 recorded/i);assert.doesNotMatch(over.text,/of 8/);
  assert.equal(progress([treatment(6)],{plannedTotal:12}).text,'Vinblastine treatment 6 of 12 recorded');
});
test('unknown and invalid dates remain unknown instead of being fabricated from the clock',()=>{
  for(const date of [undefined,null,'','invalid','2026-02-30']) {
    const result=progress([treatment(6,{date})]);
    assert.equal(result.number,6);assert.equal(result.date,null);assert.equal(result.text,CURRENT);
  }
  const result=progress([treatment(6,{drug:''})]);
  assert.equal(result.drug,null);assert.equal(result.text,'Treatment 6 of 8 recorded');
});
test('conflicting highest-number source dates and drugs are not silently resolved',()=>{
  const rows=deepFreeze([treatment(6),treatment(6,{date:'2026-10-11',drug:'SYN-other-drug'})]);
  const result=progress(rows);
  assert.equal(result.number,6);assert.equal(result.date,null);assert.equal(result.drug,null);
  assert.deepEqual(result.sourceRecordIndices,[0,1]);assert.match(result.note,/conflict|differ|inconsistent/i);
  assert.equal(result.text,'Treatment 6 of 8 recorded');
  assert.deepEqual(progress(rows),result,'A supplied date makes results deterministic');
});
test('real app profile shows derived progress and isolates the undated historical source',()=>{
  const {api,writes}=createApp(),source=deepFreeze(fixture()),before=json(source);api.set(source);
  const status=api.status(),html=api.profile();
  assert.equal(status.number,6);assert.match(status.text,/^Vinblastine treatment 6 of 8 recorded.*Oct 10, 2026$/);
  assert(currentProfileLine(html).includes(CURRENT));assert(!currentProfileLine(html).includes(ORIGINAL));
  assertHistoricalNote(originalProfileNote(html),'Profile');
  assert.equal(api.state(),before);assert.deepEqual(writes,[],'Reading and rendering never write storage');
});
test('short PDF and HTML exports use current derived progress while preserving original text separately',()=>{
  const {api,writes}=createApp(),source=deepFreeze(fixture()),before=json(source);api.set(source);
  const pdf=pdfText(api.pdf()),html=api.html(),htmlText=text(html);
  for(const [label,output] of [['PDF',pdf],['HTML',htmlText]]) {
    assert(output.includes(CURRENT),label+' current summary matches recorded treatment');
    assert(output.includes(ORIGINAL),label+' preserves complete historical wording');
    assert.match(output,/original|historical/i);assert.match(output,/date (?:is )?(?:unknown|not recorded)|unknown date/i);
    assert(output.indexOf(CURRENT)<output.indexOf(ORIGINAL),label+' current summary comes before historical note');
    assert(!output.includes(SAVED_AT),label+' never uses record-save time as the note date');
    assert.doesNotMatch(output,/\b(?:Current status|Status):\s*SYN-original/i,label+' old note is not current');
  }
  assert.equal(api.state(),before);assert.deepEqual(writes,[]);
});
test('app derives progress again after in-memory state refresh and never falls back for empty records',()=>{
  const {api,writes}=createApp(),source=fixture();api.set(source);
  assert.equal(api.status().number,6);
  const updated=fixture();updated.treatments.push(treatment(7,{date:'2026-10-18'}));api.set(deepFreeze(updated));
  assert.equal(api.status().number,7);assert.match(currentProfileLine(api.profile()),/treatment 7 of 8 recorded/);
  const empty=fixture();empty.treatments=[];api.set(deepFreeze(empty));
  assert.equal(api.status().text,UNKNOWN);assert(currentProfileLine(api.profile()).includes(UNKNOWN));
  assertHistoricalNote(originalProfileNote(api.profile()),'Empty profile');
  for(const output of [text(api.html()),pdfText(api.pdf())]) {
    assert(output.includes(UNKNOWN));assert(output.includes(ORIGINAL));
    assert.doesNotMatch(output,/\b(?:Current status|Status):\s*SYN-original/i);
  }
  assert.deepEqual(writes,[]);
});
test('full report has independent derived progress and retains every original record and source field',()=>{
  const source=fixture();source.treatments=[source.treatments[5],source.treatments[0],{...source.treatments[5],id:'SYN-duplicate-six'},treatment(7,{status:'scheduled'})];
  const before=json(source),model=reporter.buildModel(deepFreeze(source),[],{generatedAt:NOW,documentIndexStatus:'available'});
  assert.equal(model.progress.number,6);assert.equal(model.progress.text,CURRENT);
  assert.equal(model.profile.currentStatus,ORIGINAL);
  assert.deepEqual(model.records.treatments.map(row=>row.data),source.treatments);
  assert.deepEqual(model.records.treatments.map(row=>row.originalIndex),[0,1,2,3]);
  const modelBefore=json(model),html=reporter.renderHtml(deepFreeze(model));
  assert(text(section(html,'treatment-progress')).includes(CURRENT));
  assert(!section(html,'treatment-progress').includes(esc(ORIGINAL)),'Current report summary excludes stale source text');
  const original=section(html,'profile');
  assert.match(text(original),/Original profile status \(historical text\)/);
  assertHistoricalNote(original,'Full report profile');
  assert(html.includes('SYN-duplicate-six'),'Duplicate source record remains in report');
  assert(html.includes('SYN-next planned treatment #7'),'Plan remains separate and intact');
  assert.equal(json(source),before);assert.equal(json(model),modelBefore);
});
test('full report has an explicit unknown summary for empty data and uses generated date as cutoff',()=>{
  const source=fixture();source.treatments=[];
  let model=reporter.buildModel(source,[],{generatedAt:NOW});
  assert.equal(model.progress.text,UNKNOWN);assert(text(section(reporter.renderHtml(model),'treatment-progress')).includes(UNKNOWN));
  assert.equal(model.profile.currentStatus,ORIGINAL);
  source.treatments=[treatment(6),treatment(7,{date:'2026-10-19'})];
  model=reporter.buildModel(source,[],{generatedAt:NOW});assert.equal(model.progress.number,6);
  model=reporter.buildModel(source,[],{generatedAt:'2026-10-19T12:00:00Z'});assert.equal(model.progress.number,7);
  model=reporter.buildModel(source,[],{generatedAt:'2026-10-19T12:00:00Z',asOfDate:AS_OF});assert.equal(model.progress.number,6,'An explicit as-of date wins over generation time');
});
test('live app status ignores snapshot-range filters and keeps the current cutoff in full exports',()=>{
  const {api}=createApp(),source=fixture();source.treatments.push(treatment(7,{date:'2026-10-19'}));api.set(deepFreeze(source));
  for(const mode of ['14days','7days','treatment','visit','custom']) {
    api.range({mode,from:'2026-08-01',to:'2026-08-01'});
    assert.equal(api.status().number,6,mode+' does not filter current progress');
    assert(text(api.html()).includes(CURRENT),mode+' HTML status remains current');
    assert(pdfText(api.pdf()).includes(CURRENT),mode+' PDF status remains current');
    const full=api.full({generatedAt:'2026-10-24T12:00:00Z',documentIndex:{rows:[],status:'available'}});
    assert(text(section(full,'treatment-progress')).includes(CURRENT),mode+' full export uses live as-of date, not future generation metadata');
  }
});
test('multiline historical wording and markup remain escaped and lossless, never executed or relabeled',()=>{
  const original='SYN-original-first\nSYN-original-second <img src="https://invalid.example/pixel" onerror="globalThis.SYN_STATUS_EXECUTED=true"> & "verbatim"\nSYN-original-last';
  const source=fixture();source.profile.currentStatus=original;
  const {api,writes}=createApp();api.set(deepFreeze(source));
  const profile=originalProfileNote(api.profile()),short=api.html();
  const model=reporter.buildModel(source,[],{generatedAt:NOW}),full=section(reporter.renderHtml(model),'profile');
  assert.equal(model.profile.currentStatus,original,'Model keeps original multiline source text');
  for(const [label,html] of [['Profile',profile],['Short HTML',short],['Full HTML',full]]) {
    assert(html.includes(esc(original)),label+' contains exact escaped original, including line breaks');
    assert.doesNotMatch(html,/<img\b|<script\b/i,label+' does not turn source markup into elements');
  }
  assert(pdfText(api.pdf()).includes(original.replace(/\s+/g,' ')),'PDF text retains all original words and markup literally');
  assert.equal(api.state(),json(source));assert.deepEqual(writes,[]);
});
test('profile, short exports, and full report retain uncertainty and above-plan warnings',()=>{
  const cases=[
    ['missing source date',[treatment(6,{date:''}),treatment(6)],/date is unknown/i],
    ['conflicting dates',[treatment(6),treatment(6,{date:'2026-10-11'})],/disagree/i],
    ['conflicting drugs',[treatment(6),treatment(6,{drug:'SYN-other-drug'})],/disagree/i],
    ['above planned total',[treatment(9)],/exceeds the planned total/i]
  ];
  for(const [label,rows,warning] of cases) {
    const source=fixture();source.treatments=rows;
    const expected=progress(rows);assert.match(expected.warning,warning,label+' has a helper warning');
    const {api,writes}=createApp();api.set(deepFreeze(source));
    const full=api.full({generatedAt:NOW,documentIndex:{rows:[],status:'available'}});
    for(const [destination,output] of [['Profile',currentProfileLine(api.profile())],['Short HTML',text(api.html())],['Short PDF',pdfText(api.pdf())],['Full report',text(section(full,'treatment-progress'))]]) {
      assert(output.includes(expected.warning),`${destination} retains ${label} warning verbatim`);
      assert.match(output,warning,`${destination} makes ${label} visible`);
    }
    assert.equal(api.state(),json(source));assert.deepEqual(writes,[]);
  }
});

function runUnitTests() {
  let failures=0;
  for(const {name,run} of tests) {
    try {run();console.log('PASS',name);} catch(error) {failures++;console.error('FAIL',name);console.error(error.stack);}
  }
  console.log(`Treatment-status unit checks: ${tests.length-failures}/${tests.length} passed`);
  if(failures)process.exitCode=1;
  return failures===0;
}
async function runBrowserTests() {
  const {chromium}=require('playwright');
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/data/seed.json') {res.setHeader('Content-Type','application/json');res.end(json(fixture()));return;}
    if(pathname.startsWith('/data/')) {res.writeHead(404);res.end();return;}
    const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(root+path.sep)) {res.writeHead(403);res.end();return;}
    try {res.setHeader('Content-Type',({'.js':'application/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'})[path.extname(file)]||'text/plain');res.end(fs.readFileSync(file));}
    catch {res.writeHead(404);res.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||chromium.executablePath(),headless:true,args:['--no-sandbox']});
    for(const viewport of [{width:1280,height:900},{width:390,height:844},{width:320,height:700}]) {
      const context=await browser.newContext({viewport,serviceWorkers:'block',timezoneId:'UTC'}),errors=[],networkWrites=[];
      context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
      await context.route('**/*',route=>{
        const request=route.request();
        if(!['GET','HEAD'].includes(request.method()))networkWrites.push({method:request.method(),url:request.url()});
        return new URL(request.url()).origin===origin?route.continue():route.abort();
      });
      const page=await context.newPage();await page.clock.setFixedTime(new Date(NOW));
      await page.goto(origin,{waitUntil:'networkidle'});
      await page.waitForFunction(()=>document.querySelector('#journalEntries').children.length>0);
      await page.evaluate(value=>{
        state=value;ownerCanEdit=false;ownerSession=null;renderAll();
        globalThis.__statusStorageWrites=[];
        for(const name of ['setItem','removeItem','clear']) {
          const original=Storage.prototype[name];
          Storage.prototype[name]=function(...args){globalThis.__statusStorageWrites.push({name,args});return original.apply(this,args);};
        }
        const transaction=IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction=function(stores,mode,...rest){if(mode&&mode!=='readonly')globalThis.__statusStorageWrites.push({stores,mode});return transaction.call(this,stores,mode,...rest);};
      },fixture());
      const snapshot=()=>page.evaluate(()=>({state:JSON.stringify(state),documents:JSON.stringify(documents),localStorage:JSON.stringify({...localStorage}),sessionStorage:JSON.stringify({...sessionStorage}),ownerCanEdit,ownerSession}));
      const initial=await snapshot();
      const current=()=>page.locator('#profileDetails .profile-line').filter({has:page.locator('.profile-key',{hasText:/^Current status$/})});
      const fit=async label=>assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),`${viewport.width}px ${label}: no horizontal overflow`);
      const assertProfile=async number=>{
        await page.waitForFunction(()=>normalizeRoute(location.hash)==='more/profile');
        assert.match(await current().innerText(),new RegExp(`Vinblastine treatment ${number} of 8 recorded`));
        assert(!(await current().innerText()).includes(ORIGINAL));
        const note=page.locator('#historicalProfileStatus');
        assert.equal(await note.count(),1);assert.match(await note.innerText(),/original|historical/i);
        if(await note.getAttribute('open')===null)await note.locator('summary').click();
        assertHistoricalNote(await note.innerHTML(),'Visible browser profile');
        assert(await note.isVisible());await fit('expanded historical profile');
      };
      await page.locator('.bottom-nav [data-nav="more"]').click();
      await page.locator('#more-panel-menu [data-nav="more/profile"]').click();
      await assertProfile(6);
      if(process.env.QA_SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.QA_SCREENSHOT_DIR,{recursive:true});
        await page.screenshot({path:path.join(process.env.QA_SCREENSHOT_DIR,`${viewport.width}-treatment-status-profile.png`),fullPage:true});
      }
      await page.locator('.bottom-nav [data-nav="timeline"]').click();
      await page.goBack();await assertProfile(6);await page.goForward();
      await page.waitForFunction(()=>normalizeRoute(location.hash)==='timeline/history');
      await page.goBack();await assertProfile(6);
      // A newly loaded in-memory record must be reflected on the next render;
      // this deliberately does not run imports, recovery, persistence, or auth.
      const updated=fixture();updated.treatments.push(treatment(7,{date:'2026-10-18'}));
      await page.evaluate(value=>{state=value;renderAll();},updated);
      assert(await page.locator('#historicalProfileStatus').evaluate(node=>node.open),'Refreshing state preserves an expanded historical note');
      await assertProfile(7);
      const refreshed=await snapshot();
      assert.equal(refreshed.localStorage,initial.localStorage);assert.equal(refreshed.sessionStorage,initial.sessionStorage);
      assert.equal(refreshed.state,json(updated),'Rendering state refresh leaves all loaded fields verbatim');
      await page.locator('.bottom-nav [data-nav="more"]').click();
      await page.locator('#more-panel-menu [data-nav="snapshot"]').click();
      const exported=await page.evaluate(()=>({html:buildCareSummaryHtml(),pdf:buildCareSummaryPdf(),full:buildCompleteTreatmentReport({generatedAt:new Date().toISOString(),documentIndex:{rows:[],status:'available'}})}));
      for(const output of [text(exported.html),pdfText(exported.pdf),text(section(exported.full,'treatment-progress'))])assert(output.includes('Vinblastine treatment 7 of 8 recorded'),'Every exporter reads refreshed treatment status');
      for(const output of [text(exported.html),pdfText(exported.pdf),text(section(exported.full,'profile'))])assert(output.includes(ORIGINAL),'Every exporter retains original profile text');
      await fit('snapshot exports');
      const pending=context.waitForEvent('page');await page.locator('#previewCompleteReport').click();const popup=await pending;
      await popup.waitForSelector('#treatment-progress');
      assert.match(await popup.locator('#treatment-progress').innerText(),/Vinblastine treatment 7 of 8 recorded/);
      assertHistoricalNote(await popup.locator('#profile').innerHTML(),'Browser full report profile');
      assert(!(await popup.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),`${viewport.width}px full report fits`);
      await popup.close();
      assert.deepEqual(await snapshot(),refreshed,'Navigation and exports preserve refreshed records, documents, storage, and auth');
      assert.deepEqual(await page.evaluate(()=>globalThis.__statusStorageWrites),[],'Status rendering and exports perform no storage writes');
      assert.deepEqual(networkWrites,[],'No network writes or authentication');assert.deepEqual(errors,[],'No browser runtime errors');
      console.log(`PASS ${viewport.width}x${viewport.height}: profile, expanded historical wording, Back/Forward, state refresh, short exports, full-report preview, and no mutations`);
      await context.close();
    }
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
if(require.main===module)(async()=>{if(runUnitTests()&&process.argv.includes('--browser'))await runBrowserTests();})().catch(error=>{console.error(error);process.exitCode=1;});
