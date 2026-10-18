#!/usr/bin/env node
'use strict';
// Synthetic records only. The optional browser suite uses a fresh localhost
// origin, blocks all other requests, and never reads the production seed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const beforeReadabilityCommit = '6e44381b4830df786f3ae7cd328597178cce0609';
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-06-30T12:00:00Z'])); }
  static now() { return Date.parse('2026-06-30T12:00:00Z'); }
}
function loadApi(code) {
  const preview = {innerHTML:''};
  const document = {addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }};
  const context = vm.createContext({console, structuredClone, Date:FixedDate, Intl, document, preview, RogerHandoff:require('../handoff-report.js')});
  vm.runInContext(code + `
    globalThis.testApi = {
      set(value, from='2026-06-16', to='2026-06-29', mode='custom') {
        state = structuredClone(value);
        Object.assign(careSnapshotRange, {mode,from,to});
        els.careSnapshotPreview = preview;
      },
      data: careSnapshotData,
      narrative: careSnapshotNarrative,
      state() { return JSON.stringify(state); },
      render() { renderCareSnapshotPreview(); return preview.innerHTML; },
      pdf: buildCareSummaryPdf,
      html: buildCareSummaryHtml,
    };
  `, context, {filename:'app.js'});
  return context.testApi;
}
const api = loadApi(source);
const baseline = loadApi(execFileSync('git', ['show', `${beforeReadabilityCommit}:app.js`], {cwd:root,encoding:'utf8'}));
const date = day => `2026-06-${String(day).padStart(2,'0')}`;
const observation = (day, overrides={}) => ({id:`readability-observation-${day}`,date:date(day),notes:'',stoolEvents:[],...overrides});
const dose = (day, overrides={}) => ({id:`readability-dose-${day}`,medicationId:'med-cerenia',date:date(day),dose:'12 mg',status:'given',source:'Synthetic dose record',...overrides});
const treatment = (day, number=32) => ({id:`readability-treatment-${day}`,number,date:date(day),drug:'Vinblastine',doseMg:1.5,doseMgM2:1.3,weightLb:28,source:'Synthetic treatment record'});
const fixture = (overrides={}) => ({
  schemaVersion:16,
  profile:{name:'Example pet',fullName:'Synthetic Readability Pet',breed:'Synthetic breed',sex:'Female',reproductiveStatus:'Spayed',dob:'2021-01-01',patientIds:{ksu:'SYNTHETIC-A',optimum:'SYNTHETIC-B'},diagnosis:'Synthetic diagnosis',currentStatus:'Synthetic status'},
  observations:[],medicationCourses:[],medicationAdministrations:[],medicationPurchases:[],costs:[],qualityOfLife:[],labs:[],milestones:[],sourceNotes:[],
  carePlan:{questions:[],visits:[],careTeam:[],vetCallInstructions:'',vetCallSource:''},
  treatments:[treatment(16)],
  medications:[{id:'med-prednisone',name:'Prednisone',tabletStrengthMg:5,prescribedDose:'Synthetic only'},{id:'med-cerenia',name:'Cerenia',tabletStrengthMg:24}],
  ...overrides,
});
function snapshot(value, from=date(16), to=date(29), mode='custom') {
  api.set(value,from,to,mode);
  const data=api.data();
  return {data,brief:api.narrative(data,{brief:true})};
}
const points = brief => brief.points.join(' ');
const generated = brief => [brief.lead,...brief.points,brief.important,brief.timingNote,brief.unknown].filter(Boolean).join(' ');
const json = value => JSON.stringify(value);
const escape = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tests=[];
const test=(name,run)=>tests.push({name,run});

test('empty and note-only periods stay unknown rather than symptom-free',()=>{
  for(const observations of [[],[observation(18,{notes:'Synthetic time in the garden.'})]]) {
    const {brief}=snapshot(fixture({observations}));
    assert.match(brief.unknown,/not recorded.*unknown/);
    assert.doesNotMatch(generated(brief),/symptom.free|no vomiting|no nausea|no loose stool|normal stools/i);
    if(!observations.length){assert.match(brief.lead,/No home observations/);assert.equal(brief.points.length,0);}
  }
});
test('sparse normal findings keep exact dates and missing drinking is not normal',()=>{
  const {brief}=snapshot(fixture({observations:[observation(18,{appetite:'normal',energy:'normal',vomiting:0}),observation(27,{notes:'Synthetic note only.'})]}));
  assert.match(points(brief),/Appetite was close to normal on Jun 18\./);
  assert.match(points(brief),/No vomiting noted on Jun 18\./);
  assert.match(points(brief),/Usual energy on Jun 18\./);
  assert.match(points(brief),/Drinking was not recorded/);
  assert.doesNotMatch(points(brief),/throughout|stayed|Drinking was normal|symptom.free/);
});
test('positive findings retain dates, lowest intake and separate symptom-free observations',()=>{
  const {brief}=snapshot(fixture({observations:[
    observation(17,{appetitePercent:45,energy:'low',nauseaSigns:['lip_licking'],vomiting:2,stoolEvents:[{status:'observed',score:7}]}),
    observation(19,{appetitePercent:120,energy:'normal',nauseaNoneObserved:true,vomiting:0}),
    observation(22,{appetitePercent:100}),
  ]}));
  assert.match(points(brief),/below normal on Jun 17,.*45%/);
  assert.match(points(brief),/higher than usual on Jun 19,/);
  assert.match(points(brief),/near-normal entry again on Jun 22\./);
  assert.match(points(brief),/2 vomiting episodes on Jun 17,/);
  assert.match(points(brief),/loose stool or diarrhea noted on Jun 17\./);
  assert.match(points(brief),/Lip licking or smacking noted on Jun 17\./);
  assert.match(points(brief),/No nausea signs noted on Jun 19\./);
  assert.doesNotMatch(points(brief),/normal stools|recovered|tolerated|helped|effective/i);
});
test('negations, unrelated subjects and reminders never become positive symptoms',()=>{
  for(const text of ['No loose stool or blood.','Loose skin and watery eyes.','Watch for diarrhea.','Watery stool absent.','No nausea signs.']) {
    const {data,brief}=snapshot(fixture({observations:[observation(18,{gi:text})]}));
    assert.equal(data.looseDays.length,0,text);
    assert.equal(data.bloodDays.length,0,text);
    assert.equal(data.nauseaDays.length,0,text);
    assert.equal(brief.important,'',text);
    assert.doesNotMatch(points(brief),/loose stool or diarrhea noted|Nausea-related observations noted/,text);
  }
});
test('uncertain stool wording stays visible, quoted and unconfirmed',()=>{
  const text='Could this be watery stool?';
  const {brief}=snapshot(fixture({observations:[observation(18,{gi:text,stoolEvents:[{status:'observed',score:3,consistency:'formed_firm'}]})]}));
  assert.doesNotMatch(points(brief),/not loose|no loose stool|no diarrhea/);
  assert.match(brief.review.join(' '),/Jun 18, 2026.*Could this be watery stool\?.*not counted as confirmed symptoms/);
  const html=api.render(),details=html.indexOf('<details class="care-snapshot-details"');
  assert(html.indexOf('care-snapshot-review')<details);
  assert(html.indexOf(escape(text))<details);
});
test('blood and vomit-appearance warnings stay before collapsed details without reassurance',()=>{
  const {brief}=snapshot(fixture({observations:[
    observation(17,{vomiting:0,stoolEvents:[{status:'observed',score:3,flags:['black_tarry']}]}),
    observation(18,{vomitFlags:['coffee_ground_like'],stoolEvents:[{status:'observed',flags:['bright_red_blood']}]}),
  ]}));
  assert.match(brief.important,/black\/tarry stool on Jun 17, 2026/);
  assert.match(brief.important,/coffee grounds.*Jun 18, 2026/);
  assert.match(brief.important,/bright-red blood in stool on Jun 18, 2026/);
  assert.doesNotMatch(points(brief),/No vomiting|normal stools/i);
  const html=api.render();
  assert(html.indexOf('care-snapshot-important')<html.indexOf('care-snapshot-points'));
  assert(html.indexOf(escape(brief.important))<html.indexOf('<details class="care-snapshot-details"'));
  assert.match(html,/<details class="care-snapshot-details">/);
});
test('latest-treatment range excludes old observations and supports a two-day overview',()=>{
  const {data,brief}=snapshot(fixture({treatments:[treatment(2,31),treatment(16,32)],observations:[
    observation(3,{energy:'low',vomiting:4,notes:'Synthetic previous cycle only.'}),
    observation(16,{appetite:'normal',hydration:'normal',energy:'low',vomiting:0,stoolEvents:[{status:'observed',score:6}]}),
    observation(17,{appetite:'normal',hydration:'normal',energy:'low',vomiting:0,nauseaSigns:['stomach_noises']}),
  ]}),null,null,'treatment');
  assert.equal(data.start,date(16));assert.equal(data.end,date(17));assert.equal(data.treatment.number,32);
  assert.equal(brief.lead,'2 days with home notes.');
  assert.match(points(brief),/Lower energy both days/);
  assert.match(points(brief),/Stomach noises or gurgling noted on Jun 17\./);
  assert.doesNotMatch(generated(brief),/Jun 3|4 vomiting|previous cycle/);
  assert(brief.points.length>=3&&brief.points.length<=5);
});
test('low energy alone is never promoted to nausea or a medication benefit',()=>{
  const {data,brief}=snapshot(fixture({observations:[observation(17,{energy:'low'}),observation(19,{energy:'normal'})],medicationAdministrations:[dose(17)]}));
  assert.equal(data.nauseaDays.length,0);
  assert.match(points(brief),/Lower energy on 1 day \(Jun 17\)/);
  assert.match(points(brief),/Cerenia was recorded as given on 1 day/);
  assert.doesNotMatch(points(brief),/nausea signs were noted|with nausea signs|Nausea-related observations|helped|effective|prevented|recovered/);
});
test('prior nausea timing remains a comparison, not a current symptom or cause',()=>{
  const old=[3,5,7].map(day=>observation(day,{nausea:1}));
  const value=fixture({treatments:[treatment(2,31),treatment(16,32)],observations:[...old,observation(17,{energy:'low'}),observation(19,{energy:'low'}),observation(24,{energy:'low'}),observation(29,{energy:'normal'})]});
  let result=snapshot(value);
  assert(result.data.energyNauseaTiming.window);
  assert.equal(result.data.nauseaDays.length,0);
  assert.match(result.brief.timingNote,/earlier nausea window.*does not explain the cause/);
  assert.doesNotMatch(points(result.brief),/Nausea-related observations|nausea signs noted|caused by/);
  result=snapshot(value,date(2),date(10));
  assert.equal(result.data.energyNauseaTiming.window,null);assert.equal(result.brief.timingNote,'');
  result=snapshot(value,date(10),date(29));
  assert.equal(result.data.energyNauseaTiming.window,null);assert.equal(result.brief.timingNote,'');
});
test('Cerenia counts unique given dates, excludes held/unknown/out-of-range, and preserves overlap',()=>{
  const {brief}=snapshot(fixture({observations:[observation(17,{nausea:1}),observation(20,{nausea:0})],medicationAdministrations:[
    dose(17),dose(17,{id:'second-same-date'}),dose(18,{status:'held'}),dose(19,{status:'unknown'}),dose(20),dose(29),
  ]}),date(16),date(22));
  assert.match(points(brief),/given on 2 days \(Jun 17; Jun 20\), including 1 day with nausea signs/);
  assert.doesNotMatch(points(brief),/3 doses|given on 3 days|Jun 29|helped|effective/);
});
test('owner-confirmed courses are counted without pretending they are explicit dose logs',()=>{
  const course=(id,start,end)=>({id,medicationId:'med-cerenia',startDate:date(start),confirmedThrough:date(end),dose:'12 mg',frequency:'Every 24 hours',status:'owner-confirmed daily given',source:'Synthetic course'});
  const {brief}=snapshot(fixture({medicationCourses:[course('course-a',16,19),course('course-b',17,20)],medicationAdministrations:[dose(18,{status:'held'})]}));
  assert.match(points(brief),/Cerenia was recorded as given on 4 days/);
  assert.doesNotMatch(points(brief),/I logged|dose logs|explicit|given on 7 days/);
});
test('raw nausea typos and markup remain exact source text, never generated prose or executable HTML',()=>{
  const raw='Synthetik grggle <img src=x onerror="syntheticOnly()"> & "quote"\nOriginal line two.';
  const legacy='Synthetic unlisted sign <script>syntheticOnly()</script>';
  const value=fixture({observations:[observation(18,{nauseaOther:raw,nauseaSigns:['stomach_noises',legacy],notes:'Synthetic exact owner note.'})]});
  const before=json(value),{brief}=snapshot(value),stateBefore=api.state();
  assert(brief.rawNotes.some(note=>note.date===date(18)&&note.text===raw));
  assert(brief.rawNotes.some(note=>note.text===legacy));
  assert(!generated(brief).includes(raw));assert(!generated(brief).includes(legacy));
  assert(!brief.nauseaDetail.includes('Synthetik'));assert(!brief.nauseaDetail.includes('<img'));
  assert.match(points(brief),/Stomach noises or gurgling/);
  const html=api.render(),details=html.indexOf('<details class="care-snapshot-details"');
  assert(html.indexOf(escape(raw))>details);assert(html.indexOf(escape(legacy))>details);
  assert.doesNotMatch(html,/<img src=x|<script>syntheticOnly/);
  assert.equal(api.state(),stateBefore);assert.equal(json(value),before);
});
test('source-only nausea observations point to exact wording rather than invent a behavior',()=>{
  const raw='Synthetic odd gesture, speling preserved.';
  const {brief}=snapshot(fixture({observations:[observation(18,{nauseaOther:raw})]}));
  assert.match(points(brief),/Other nausea notes on Jun 18; original wording/);
  assert(!generated(brief).includes(raw));assert.equal(brief.rawNotes[0].text,raw);
});
test('same-day drinking disagreements stay dated and unresolved in visible review text',()=>{
  const {brief}=snapshot(fixture({observations:[observation(18,{hydration:'normal'}),observation(18,{id:'second-water',hydration:'decreased drinking'})]}));
  assert.doesNotMatch(points(brief),/Drinking was normal/);
  assert.match(brief.review.join(' '),/Jun 18, 2026: “normal”; “decreased drinking”/);
});
test('dense nausea details retain full date spans and explicit negative dates',()=>{
  const observations=Array.from({length:14},(_,index)=>observation(index+16,index===4?{nauseaNoneObserved:true}:{nauseaSigns:['stomach_noises']}));
  observations[7].nauseaOther='Synthetic raw descriptor, kept exact.';
  const {brief}=snapshot(fixture({observations}));
  assert.match(brief.nauseaDetail,/Nausea-associated behaviors on Jun 16–19, 2026; Jun 21–29, 2026/);
  assert.match(brief.nauseaDetail,/No nausea signs observed on Jun 20, 2026/);
  assert.match(brief.nauseaDetail,/stomach noises \/ gurgling/);
  assert(!brief.nauseaDetail.includes(observations[7].nauseaOther));
  assert.match(brief.nauseaDetail,/Original wording appears below/);
  assert(api.render().includes(escape(brief.nauseaDetail)));
});
test('cross-year summaries retain years so sparse dates cannot be confused',()=>{
  const value=fixture({treatments:[{...treatment(16),date:'2025-12-28'}],observations:[
    {...observation(17,{energy:'normal',appetite:'normal'}),date:'2025-12-29'},
    {...observation(19,{energy:'low',vomiting:0}),date:'2026-01-02'},
  ]});
  const {brief}=snapshot(value,'2025-12-28','2026-01-03');
  assert.match(points(brief),/Appetite was close to normal on Dec 29, 2025/);
  assert.match(points(brief),/Lower energy on 1 day \(Jan 2, 2026\)/);
  assert.match(points(brief),/No vomiting noted on Jan 2, 2026/);
});
test('preview uses one short lead, a list, one unknown-data note and no repeated custom dates',()=>{
  const {brief}=snapshot(fixture({observations:[observation(18,{appetite:'normal',energy:'low',vomiting:0}),observation(19,{nauseaSigns:['lip_licking']})]}),date(18),date(19));
  const html=api.render(),period=html.slice(0,html.indexOf('<section class="care-snapshot-narrative"'));
  assert.equal((html.match(/class="care-snapshot-lead"/g)||[]).length,1);
  assert.equal((html.match(/class="care-snapshot-points"/g)||[]).length,1);
  assert.equal((html.match(/<li>/g)||[]).length,brief.points.length);
  assert.equal((html.match(/Days and symptoms not recorded are unknown\./g)||[]).length,1);
  assert.equal((period.match(/Jun 18, 2026/g)||[]).length,1);
  assert.equal((period.match(/Jun 19, 2026/g)||[]).length,1);
  assert(brief.lead.length<80);assert.doesNotMatch(html,/Please add your overall impression/);
});
test('preview leaves state and exports unchanged; narrative stays byte-identical to the baseline',()=>{
  const cases=[fixture(),fixture({observations:[observation(18,{appetite:'normal',energy:'low',nauseaOther:'Synthetic original typo.',vomiting:0,notes:'Synthetic full owner note.\nLine two.'})],medicationAdministrations:[dose(18)]}),fixture({observations:[observation(17,{gi:'Possible blood in stool?'}),observation(20,{stoolEvents:[{status:'observed',flags:['black_tarry']}],vomitFlags:['coffee_ground_like']})]})];
  for(const value of cases){
    const original=json(value);api.set(value);baseline.set(value);
    const saved=api.state(),before={narrative:json(api.narrative(api.data())),html:api.html(),pdf:api.pdf()};
    api.narrative(api.data(),{brief:true});api.render();api.render();
    assert.equal(json(api.narrative(api.data())),before.narrative);
    assert.equal(before.narrative,json(baseline.narrative(baseline.data())));
    assert.equal(api.html(),before.html);
    assert.equal(api.pdf(),before.pdf);
    assert.equal(api.state(),saved);assert.equal(json(value),original);
  }
});

function runUnitTests(){
  let passed=0;
  for(const {name,run} of tests){try{run();passed++;console.log(`PASS ${name}`);}catch(error){console.error(`FAIL ${name}\n${error.stack}`);process.exitCode=1;}}
  console.log(`${passed}/${tests.length} snapshot readability checks passed.`);
  return passed===tests.length;
}

async function runBrowserTests(){
  const {chromium}=require('playwright');
  const base=require('./test-navigation.cjs').fixture;
  const raw='Synthetic grggle <img src=x onerror="syntheticOnly()"> & "exact"\n'+('unbroken-synthetic-source'.repeat(30));
  const value={...structuredClone(base),...fixture({treatments:[treatment(2,1),treatment(16,2)],observations:[
    observation(15,{notes:'Synthetic earlier owner note.'}),
    observation(16,{appetite:'normal',hydration:'normal',energy:'low',vomiting:0,stoolEvents:[{status:'observed',score:6}],notes:'Synthetic first current owner note.\nExact second line.'}),
    observation(17,{appetite:'normal',hydration:'normal',energy:'low',vomiting:0,nauseaSigns:['stomach_noises'],nauseaOther:raw,notes:'Synthetic latest owner note. <b>Literal markup</b>.'}),
  ],medicationAdministrations:[dose(17)],
  labs:[{id:'readability-neutrophils',date:date(15),metric:'Neutrophils',value:4.5,unit:'K/uL',source:'Synthetic lab'},{id:'readability-hct',date:date(15),metric:'Hematocrit',value:41,unit:'%',source:'Synthetic lab'}],
  costs:[{id:'readability-cost',date:date(16),provider:'Synthetic provider',label:'Synthetic visit',amountPaid:20,category:'treatment',status:'confirmed',source:'Synthetic receipt'}],
  }),journalCoverageThrough:date(17)};
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/data/seed.json'){res.setHeader('Content-Type','application/json');res.end(json(value));return;}
    if(pathname.startsWith('/data/')){res.writeHead(404);res.end();return;}
    const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    try{res.setHeader('Content-Type',({'.js':'application/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'})[path.extname(file)]||'text/plain');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${server.address().port}`;
  let browser,currentPage,currentWidth;
  const capture=async label=>{
    if(!process.env.QA_SCREENSHOT_DIR)return;
    fs.mkdirSync(process.env.QA_SCREENSHOT_DIR,{recursive:true});
    await currentPage.screenshot({path:path.join(process.env.QA_SCREENSHOT_DIR,`${currentWidth}-snapshot-readability-${label}.png`),fullPage:true});
  };
  try{
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||chromium.executablePath(),headless:true,args:['--no-sandbox']});
    for(const viewport of [{width:1280,height:900},{width:390,height:844},{width:320,height:700}]){
      const context=await browser.newContext({viewport,serviceWorkers:'block',timezoneId:'UTC'});
      const page=await context.newPage();currentPage=page;currentWidth=viewport.width;
      const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
      await page.clock.install({time:new Date('2026-06-18T12:00:00Z')});
      await page.goto(origin,{waitUntil:'networkidle'});
      await page.waitForFunction(()=>document.querySelector('#journalEntries').children.length>0);
      assert.deepEqual(errors,[],'No boot errors');
      const stored=()=>page.evaluate(()=>({state:JSON.stringify(state),storage:JSON.stringify({...localStorage})}));
      const initial=await stored();
      await page.locator('.bottom-nav [data-nav="more"]').click();
      await page.locator('#more-panel-menu [data-nav="snapshot"]').click();
      await page.locator('[data-snapshot-range="treatment"]').click();
      const preview=page.locator('#careSnapshotPreview');
      const ensureFits=async()=>assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1)),`${viewport.width}px snapshot has no horizontal overflow`);
      const expected=await page.evaluate(()=>careSnapshotNarrative(careSnapshotData(),{brief:true}));
      assert.equal(await preview.locator('.care-snapshot-lead').textContent(),expected.lead);
      assert.deepEqual(await preview.locator('.care-snapshot-points > li').allTextContents(),expected.points);
      assert(expected.points.length>=3&&expected.points.length<=5);
      assert.match(await preview.locator('.care-snapshot-points').textContent(),/Lower energy both days/);
      assert.equal(await preview.locator('.care-snapshot-points > li').first().evaluate(node=>getComputedStyle(node).fontWeight),'400');
      assert.equal(await preview.locator('.care-snapshot-details').getAttribute('open'),null);
      assert.equal(await preview.locator('.care-snapshot-source-note p').textContent(),raw);
      assert.equal(await preview.locator('.care-snapshot-source-note img, .care-snapshot-source-note script').count(),0);
      assert(!(await preview.locator('.care-snapshot-narrative').textContent()).includes(raw));
      await ensureFits();await capture('collapsed');
      const exportBefore=await page.evaluate(()=>({narrative:JSON.stringify(careSnapshotNarrative(careSnapshotData())),html:buildCareSummaryHtml(),pdf:buildCareSummaryPdf()}));
      for(let repeat=0;repeat<2;repeat++){
        for(const mode of ['14days','visit','7days','custom','treatment']){
          await page.locator(`[data-snapshot-range="${mode}"]`).click();
          assert.equal(await preview.locator('.care-snapshot-lead').count(),1);
          await ensureFits();
        }
        await preview.locator('[data-nav="journal/trends"]').click();
        assert.equal(await page.evaluate(()=>normalizeRoute(location.hash)),'journal/trends');
        await page.goBack();
        await page.waitForFunction(()=>normalizeRoute(location.hash)==='snapshot');
        assert.equal(await page.locator('[data-snapshot-range].active').getAttribute('data-snapshot-range'),'treatment');
        assert.deepEqual(await preview.locator('.care-snapshot-points > li').allTextContents(),expected.points);
      }
      const originalNotes=await page.evaluate(()=>careSnapshotData().recentOwnerNotes.map(note=>note.text));
      assert.deepEqual(await preview.locator('.care-snapshot-owner-note-text').allTextContents(),originalNotes);
      for(const summary of await preview.locator('.care-snapshot-owner-note > summary').all())await summary.click();
      await preview.locator('.care-snapshot-details > summary').click();
      assert(await preview.locator('.care-snapshot-source-note p').isVisible());
      assert.equal(await preview.locator('.care-snapshot-source-note p').textContent(),raw);
      await ensureFits();await capture('details');
      assert.deepEqual(await page.evaluate(()=>({narrative:JSON.stringify(careSnapshotNarrative(careSnapshotData())),html:buildCareSummaryHtml(),pdf:buildCareSummaryPdf()})),exportBefore,'Display changes preserve all exports');
      assert.deepEqual(await stored(),initial,'Navigation, range switches and expanding source text never mutate clinical state or storage');
      // Warning fixture exists only in this isolated page's memory. It is never saved.
      await page.evaluate(()=>{
        state.observations.push({id:'synthetic-warning',date:'2026-06-17',notes:'Could this be blood in stool?',gi:'Could this be blood in stool?',stoolEvents:[{status:'observed',flags:['black_tarry']}],vomitFlags:['coffee_ground_like']});
        renderCareSnapshotPreview();
      });
      assert(await preview.locator('.care-snapshot-important').isVisible());
      assert(await preview.locator('.care-snapshot-review').isVisible());
      assert.equal(await preview.locator('.care-snapshot-details').getAttribute('open'),null);
      assert.equal(await preview.locator('.care-snapshot-details .care-snapshot-important, .care-snapshot-details .care-snapshot-review').count(),0);
      assert.match(await preview.locator('.care-snapshot-important').textContent(),/black\/tarry stool.*coffee grounds/);
      assert.doesNotMatch(await preview.locator('.care-snapshot-points').textContent(),/No vomiting|normal stools/i);
      await ensureFits();await capture('warnings');
      await page.locator('[data-snapshot-range="custom"]').click();
      await page.locator('#careSnapshotFrom').fill('2026-06-16');await page.locator('#careSnapshotTo').fill('2026-06-17');await page.locator('#careSnapshotTo').blur();
      const period=await preview.locator('.care-snapshot-period').textContent();
      assert.equal((period.match(/Jun 16, 2026/g)||[]).length,1);assert.equal((period.match(/Jun 17, 2026/g)||[]).length,1);
      assert.deepEqual(errors,[],'No browser runtime errors');
      console.log(`PASS browser ${viewport.width}px: short lead, bullets, exact source notes, warnings, repeated ranges/history, unchanged records/exports, no overflow`);
      await context.close();
    }
  }catch(error){if(currentPage&&!currentPage.isClosed())try{await capture('failure');}catch{}throw error;}
  finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}

if(require.main===module)(async()=>{
  if(!runUnitTests())return;
  if(process.argv.includes('--browser'))await runBrowserTests();
})().catch(error=>{console.error(error);process.exitCode=1;});
