#!/usr/bin/env node
'use strict';
// Synthetic records only. No production seed, patient identifier, source file,
// owner account, credentials, remote request, or live persistence is used.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
const TODAY='2026-10-17';
const FixedDate=class extends Date{constructor(...args){super(...(args.length?args:[`${TODAY}T12:00:00Z`]));}static now(){return new Date(`${TODAY}T12:00:00Z`).valueOf();}};
const json=value=>JSON.parse(JSON.stringify(value));
const visit=(overrides={})=>({id:'synthetic-existing',label:'Synthetic follow-up',date:'2026-10-20',time:'09:15',source:'Synthetic scheduling note',customField:{keep:'original'},...overrides});
const fixture=(visits=[visit()])=>({schemaVersion:16,profile:{name:'Synthetic pet'},carePlan:{visits,vetCallInstructions:'Synthetic instructions',vetCallSource:'Synthetic source',careTeam:[],questions:[{id:'synthetic-question',text:'Synthetic question'}]},recordCorrections:[{collection:'observations',id:'synthetic-observation',before:{notes:'Older synthetic note'},after:{notes:'Original synthetic note'},at:'2026-10-01T12:00:00Z'}],observations:[{id:'synthetic-observation',date:'2026-10-01',notes:'Original synthetic note',rawEntry:'Original synthetic wording'}],treatments:[{id:'synthetic-treatment',date:'2026-10-02',notes:'Unchanged synthetic treatment'}],labs:[{id:'synthetic-lab',date:'2026-10-02',metric:'Synthetic marker',value:3}],costs:[{id:'synthetic-cost',date:'2026-10-02',amountPaid:7}],qualityOfLife:[],medications:[],medicationAdministrations:[],medicationPurchases:[],medicationCourses:[],importHistory:[{key:'synthetic-import',filename:'synthetic-record.pdf'}],milestones:[],_savedAt:'2026-10-16T12:00:00Z'});
const groupsFixture=()=>[visit({id:'synthetic-later',date:'2026-10-21',time:null}),visit({id:'synthetic-yesterday',label:'Synthetic past plan',date:'2026-10-16',time:'15:00'}),visit({id:'synthetic-today-late',label:'Synthetic today later',date:TODAY,time:'15:30'}),visit({id:'synthetic-tbd',label:'Synthetic undated plan',date:null,time:null}),visit({id:'synthetic-today-early',label:'Synthetic today early',date:TODAY,time:'08:15'}),visit({id:'synthetic-older',label:'Synthetic older plan',date:'2026-10-01',time:null})];
const nodes=new Map(),documentListeners={};
function node(selector){
  if(!nodes.has(selector)){
    const result={id:selector.startsWith('#')?selector.slice(1):'',innerHTML:'',textContent:'',value:'',disabled:false,hidden:false,open:false,dataset:{},listeners:{},children:[],
      reset(){for(const field of this.fields?.values()||[])field.value='';},
      addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);},
      showModal(){this.open=true;},close(){this.open=false;for(const fn of this.listeners.close||[])fn({target:this});},
      focus(){},setAttribute(){},removeAttribute(){},classList:{add(){},remove(){},toggle(){}},
      querySelector(sel){if(sel==='button[type="submit"]')return node(selector+' submit');const name=/\[name=["']?([^\]"']+)/.exec(sel)?.[1];return name?this.elements.namedItem(name):null;},
      querySelectorAll(){return [];},getBoundingClientRect(){return {top:0};}
    };
    result.fields=new Map();const namedItem=name=>{if(!result.fields.has(name))result.fields.set(name,{value:'',disabled:false,focus(){}});return result.fields.get(name);};result.elements=new Proxy({namedItem},{get(target,key){return key in target?target[key]:namedItem(key);}});
    nodes.set(selector,result);
  }
  return nodes.get(selector);
}
const toasts=[],storage=new Map();
const context=vm.createContext({console,Date:FixedDate,Intl,URL,structuredClone,Map,Set,setTimeout:()=>{},clearTimeout(){},setInterval:()=>{},
  document:{addEventListener(type,fn){(documentListeners[type]??=[]).push(fn);},querySelector:node,querySelectorAll(selector){return selector==='dialog[open]'?[...nodes.values()].filter(n=>n.open):selector.includes('[data-edit-appointment]')?[node('synthetic edit appointment')]:[];}},
  FormData:class{constructor(form){this.form=form;}get(key){return this.form.values?.[key]??this.form.elements.namedItem(key).value??null;}has(key){return Boolean(this.form.values&&Object.hasOwn(this.form.values,key));}},
  location:{hash:'#more/plan'},history:{pushState(_a,_b,hash){context.location.hash=hash;}},window:{scrollTo(){},addEventListener(){}},
  localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)},
  syntheticCanonical:fixture(),syntheticSaveOk:true,syntheticSaveCount:0,syntheticSaveWait:null,syntheticSaved:null,syntheticSaveStamp:null,syntheticRenderThrows:0,toasts,
  fetch:async()=>({json:async()=>structuredClone(context.syntheticCanonical)})
});
vm.runInContext(source+`
  saveChanges=async()=>{syntheticSaveCount++;if(syntheticSaveStamp)state._savedAt=syntheticSaveStamp;if(syntheticSaveWait)await syntheticSaveWait;if(syntheticSaveOk)syntheticSaved=structuredClone(state);return syntheticSaveOk;};
  latestRecoverySnapshot=async()=>null;
  persist=async()=>{};
  renderAll=()=>{if(syntheticRenderThrows>0){syntheticRenderThrows--;throw Error('Synthetic display refresh failed');}};
  toast=(message,error)=>toasts.push({message,error});
  cacheEls();bindAppointments();
  globalThis.testApi={
    set(value,canEdit=true){state=structuredClone(value);ownerCanEdit=canEdit;},state(){return structuredClone(state);},
    merge:mergeCarePlanVisits,mergeState:mergeCanonicalSeed,groups:appointmentGroups,when:appointmentWhen,apply:applyAppointment,
    open:openAppointmentDialog,load:loadState,navigate,mutate(fn){fn(state);},status(saving=false){appointmentSaving=saving;renderSharedStatus();appointmentSaving=false;},
    render(){renderUpcomingCare();renderTimeline();return {plan:document.querySelector('#upcomingCare').innerHTML,home:document.querySelector('#homeNextVisit').innerHTML,timeline:document.querySelector('#timelineUpcoming').innerHTML,recorded:document.querySelector('#timelineEntries').innerHTML};}
  };
`,context,{filename:'app.js'});
const api=context.testApi;
function set(value=fixture(),canEdit=true){node('#appointmentDialog').close();api.set(value,canEdit);context.syntheticSaveOk=true;context.syntheticSaveCount=0;context.syntheticSaveWait=null;context.syntheticSaved=null;context.syntheticSaveStamp=null;context.syntheticRenderThrows=0;toasts.length=0;node('#appointmentForm').values=null;}
const values=(overrides={})=>({label:'Synthetic bloodwork',date:'2026-10-22',time:'10:30',source:'Synthetic owner scheduling note',...overrides});
const newDraft=(overrides={})=>({id:'synthetic-new',isNew:true,before:null,...overrides});
const editDraft=(row=visit())=>({id:row.id,isNew:false,before:structuredClone(row)});
const testCases=[];
const test=(name,run)=>testCases.push({name,run});
async function submit(overrides=values()){
  const form=node('#appointmentForm');form.values=overrides;
  const event={target:form,currentTarget:form,submitter:node('#appointmentForm submit'),preventDefault(){}};
  for(const fn of form.listeners.submit||[])await fn(event);
}
function unchangedExcept(before,after,keys){for(const key of Object.keys(before))if(!keys.includes(key))assert.deepEqual(json(after[key]),before[key],key+' is preserved');}

test('canonical merge preserves custom visits, time, edited label, source and unknown fields',()=>{
  const canonical=[visit({label:'Canonical synthetic title',time:null})],saved=[visit({label:'Owner synthetic title',time:'10:45'}),visit({id:'synthetic-custom',date:'2026-09-01',time:'13:00'})];
  const before=json({canonical,saved});const merged=api.merge(canonical,saved,16);
  assert.equal(merged.length,2);assert.deepEqual(json(merged.find(v=>v.id===saved[0].id)),saved[0]);assert.deepEqual(json(merged.find(v=>v.id==='synthetic-custom')),saved[1]);assert.deepEqual({canonical,saved},before,'Merge does not mutate either visit input');
});
test('merge retains conflicting duplicate historical IDs for explicit owner review',()=>{
  const one=visit({time:'08:30'}),two=visit({time:'14:15'});const rows=json(api.merge([visit()],[one,two],16));assert.equal(rows.length,2);assert.deepEqual(rows,[one,two]);
});
test('canonical-only additions and every saved historical visit remain present',()=>{
  const canonical=[visit(),visit({id:'synthetic-added-by-seed',date:'2026-10-29'})],saved=[visit({date:null,time:null}),visit({id:'synthetic-retired-canonical',date:'2025-05-03',time:'00:00'})];
  const merged=json(api.merge(canonical,saved,16));assert.equal(merged.length,3);assert.equal(merged.find(v=>v.id==='synthetic-existing').date,null);assert.equal(merged.find(v=>v.id==='synthetic-retired-canonical').time,'00:00');assert(merged.some(v=>v.id==='synthetic-added-by-seed'));
});
test('state merge and JSON/reload retain all appointment details and correction history',async()=>{
  const canonical=fixture(),saved=fixture([visit({label:'Edited synthetic title',time:'18:25'}),visit({id:'synthetic-custom',label:'Synthetic custom appointment',date:'2025-01-01',time:null})]);
  saved.recordCorrections.push({collection:'carePlanVisits',id:'synthetic-existing',before:visit(),after:saved.carePlan.visits[0],at:'2026-10-17T12:00:00Z'});
  const merged=json(api.mergeState(structuredClone(canonical),structuredClone(saved)));
  assert.deepEqual(merged.carePlan.visits,saved.carePlan.visits);assert.deepEqual(merged.recordCorrections,saved.recordCorrections);
  context.syntheticCanonical=canonical;storage.set('rogerCareState_v1',JSON.stringify(saved));await api.load();
  assert.deepEqual(json(api.state().carePlan.visits),saved.carePlan.visits);assert.deepEqual(json(api.state().recordCorrections),saved.recordCorrections);storage.clear();
});
test('upcoming, past and undated groups are complete, ordered and read-only',()=>{
  const visits=groupsFixture(),before=structuredClone(visits),groups=json(api.groups(visits,TODAY));
  assert.deepEqual(groups.upcoming.map(v=>v.id),['synthetic-today-early','synthetic-today-late','synthetic-later']);
  assert.deepEqual(groups.past.map(v=>v.id),['synthetic-yesterday','synthetic-older']);assert.deepEqual(groups.undated.map(v=>v.id),['synthetic-tbd']);
  assert.equal(groups.upcoming.length+groups.past.length+groups.undated.length,visits.length);assert.deepEqual(visits,before);
});
test('today remains upcoming regardless of appointment clock time',()=>{
  const groups=api.groups([visit({date:TODAY,time:'00:01'})],TODAY);assert.equal(groups.upcoming.length,1);assert.equal(groups.past.length,0);
});
test('optional time is visible without inventing midnight for unknown time',()=>{
  assert.match(api.when(visit()),/9:15|09:15/);assert.match(api.when(visit({time:'00:00'})),/12:00|00:00/);
  assert.doesNotMatch(api.when(visit({time:null})),/12:00|00:00/);assert.match(api.when(visit({date:null,time:null})),/TBD|confirm|unknown/i);
});
test('rendering separates past schedules and preserves recorded history exactly',()=>{
  const before=fixture(groupsFixture());set(before);const html=api.render();
  assert.match(html.plan,/Past|Earlier/i);assert.match(html.plan,/Synthetic past plan/);assert.match(html.plan,/Synthetic undated plan/);
  assert.match(html.home,/Synthetic today early/);assert.doesNotMatch(html.home,/Synthetic past plan|Synthetic older plan/);
  assert.match(html.timeline,/Earlier|Past/i);assert.doesNotMatch(html.recorded,/Synthetic past plan|Synthetic today early/);assert.deepEqual(json(api.state()),before);
});
test('past-date disclosure remains open across background renders',()=>{
  set(fixture(groupsFixture()));node('#pastAppointments').open=true;const before=json(api.state());assert.match(api.render().plan,/<details id="pastAppointments"[^>]* open>/);assert.deepEqual(json(api.state()),before);node('#pastAppointments').open=false;
});
test('instruction draft remains intact across appointment and background renders',()=>{
  set();delete node('#carePlanForm').dataset.loadedInstructions;api.render();assert.equal(node('#vetCallInstructions').value,'Synthetic instructions');node('#vetCallInstructions').value='Unsaved synthetic instruction';node('#vetCallSource').value='Unsaved synthetic source';api.render();api.render();assert.equal(node('#vetCallInstructions').value,'Unsaved synthetic instruction');assert.equal(node('#vetCallSource').value,'Unsaved synthetic source');assert.equal(api.state().carePlan.vetCallInstructions,'Synthetic instructions');
});
test('background status renders preserve pending-save and viewer control restrictions',()=>{
  set();api.status(true);assert.equal(node('#appointmentSaveButton').disabled,true);api.status(false);assert.equal(node('#appointmentSaveButton').disabled,false);assert.equal(node('#appointmentAddButton').disabled,false);set(fixture(),false);api.status();assert.equal(node('#appointmentSaveButton').disabled,true);assert.equal(node('#appointmentAddButton').disabled,true);assert.equal(node('synthetic edit appointment').disabled,true);
});
test('new appointment adds once, audits full new row and preserves unrelated data',()=>{
  const before=fixture();set(before);assert.equal(api.apply(values(),newDraft()),true);const after=json(api.state());
  assert.equal(after.carePlan.visits.length,2);assert.deepEqual(after.carePlan.visits[0],before.carePlan.visits[0]);assert.equal(after.carePlan.visits[1].time,'10:30');
  const audit=after.recordCorrections.at(-1);assert.equal(audit.collection,'carePlanVisits');assert.equal(audit.id,'synthetic-new');assert.equal(audit.before,null);assert.deepEqual(audit.after,after.carePlan.visits[1]);assert(audit.at);
  unchangedExcept(before,after,['carePlan','recordCorrections']);unchangedExcept(before.carePlan,after.carePlan,['visits']);
});
test('repeated new draft is idempotent and duplicate appointment under a different ID is rejected',()=>{
  set();const draft=newDraft();api.apply(values(),draft);const before=json(api.state());assert.equal(api.apply(values(),draft),false);assert.deepEqual(json(api.state()),before);assert.throws(()=>api.apply(values(),newDraft({id:'synthetic-another-id'})));assert.deepEqual(json(api.state()),before);
});
test('optional date and time stay unknown, never guessed',()=>{
  for(const changes of [{time:''},{date:'',time:''}]){set();api.apply(values(changes),newDraft());const row=api.state().carePlan.visits.at(-1);assert.equal(row.time??null,null);if(changes.date==='')assert.equal(row.date,null);}
});
test('editing an old visit retains its identity and full historical audit',()=>{
  const old=visit({date:'2026-09-01',time:'14:05'}),before=fixture([old]);set(before);
  api.apply(values({label:'Updated synthetic title',date:'2026-09-02',time:'15:20'}),editDraft(old));const after=json(api.state());
  assert.equal(after.carePlan.visits.length,1);assert.equal(after.carePlan.visits[0].id,old.id);assert.deepEqual(after.carePlan.visits[0].customField,old.customField);
  assert.deepEqual(after.recordCorrections.at(-1).before,old);assert.deepEqual(after.recordCorrections.at(-1).after,after.carePlan.visits[0]);assert.deepEqual(after.recordCorrections[0],before.recordCorrections[0]);
});
test('unchanged edit adds no audit or mutation',()=>{
  const before=fixture(),row=before.carePlan.visits[0];set(before);assert.equal(api.apply(row,editDraft(row)),false);assert.deepEqual(json(api.state()),before);
});
test('legacy date-only appointment no-op preserves source and absence of time',()=>{
  const row=visit();delete row.time;const before=fixture([row]);set(before);assert.equal(api.apply({...row,time:''},editDraft(row)),false);assert.deepEqual(json(api.state()),before);
});
test('clearing a known time keeps the original time in correction history',()=>{
  const row=visit();set(fixture([row]));api.apply({...row,time:''},editDraft(row));const after=json(api.state());assert.equal(after.carePlan.visits[0].time,null);assert.equal(after.recordCorrections.at(-1).before.time,'09:15');assert.equal(after.recordCorrections.at(-1).after.time,null);
});
test('invalid label/date/time, orphan time, duplicate or missing identity never mutate',()=>{
  for(const invalid of [{label:''},{label:'   '},{date:'not-a-date'},{date:'2026-02-30'},{date:'2026-13-01'},{time:'25:00'},{time:'12:60'},{time:'9:30'},{time:'10:00:01'},{date:'',time:'10:30'}]){const before=fixture();set(before);assert.throws(()=>api.apply(values(invalid),newDraft()),JSON.stringify(invalid));assert.deepEqual(json(api.state()),before);}
  for(const draft of [newDraft({id:''}),newDraft({id:'synthetic-existing'}),{id:'not-present',isNew:false,before:visit()}]){const before=fixture();set(before);assert.throws(()=>api.apply(values(),draft));assert.deepEqual(json(api.state()),before);}
  const duplicate=fixture([visit(),visit()]);set(duplicate);assert.throws(()=>api.apply(values(),editDraft()));assert.deepEqual(json(api.state()),duplicate);
});
test('stale edited record fails closed rather than overwriting a newer change',()=>{
  const current=visit({time:'11:00'}),before=fixture([current]);set(before);assert.throws(()=>api.apply(values(),editDraft(visit())));assert.deepEqual(json(api.state()),before);
});
test('viewer cannot apply an appointment directly',()=>{
  const before=fixture();set(before,false);assert.throws(()=>api.apply(values(),newDraft()));assert.deepEqual(json(api.state()),before);
});
test('opening, changing fields and canceling do not modify or save records',()=>{
  const before=fixture();set(before);api.open();node('#appointmentForm').elements.namedItem('label').value='Unsaved synthetic draft';node('#appointmentDialog').close();assert.deepEqual(json(api.state()),before);assert.equal(context.syntheticSaveCount,0);
});
test('bound save uses fields, closes dialog, and saves exactly one auditable appointment',async()=>{
  const before=fixture();set(before);api.open();await submit();const after=json(api.state());assert.equal(after.carePlan.visits.length,2);assert.equal(after.carePlan.visits.at(-1).label,'Synthetic bloodwork');assert.equal(after.carePlan.visits.at(-1).time,'10:30');assert.equal(after.recordCorrections.length,before.recordCorrections.length+1);assert.equal(context.syntheticSaveCount,1);assert.equal(node('#appointmentDialog').open,false);
  await submit();assert.deepEqual(json(api.state()),after);assert.equal(context.syntheticSaveCount,1,'A repeated stale submit does not create another visit');
});
test('in-flight repeat submissions are idempotent',async()=>{
  set();api.open();let release;context.syntheticSaveWait=new Promise(resolve=>{release=resolve;});
  const first=submit();await Promise.resolve();const second=submit();await Promise.resolve();assert.equal(context.syntheticSaveCount,1);release();await Promise.all([first,second]);assert.equal(api.state().carePlan.visits.length,2);assert.equal(api.state().recordCorrections.length,2);
});
test('failed save restores the exact previous state and keeps the draft retryable',async()=>{
  const before=fixture();set(before);api.open();context.syntheticSaveOk=false;await submit();assert.deepEqual(json(api.state()),before);assert.equal(node('#appointmentDialog').open,true);assert.match(toasts.at(-1).message,/save|unchanged|kept/i);
  context.syntheticSaveOk=true;await submit();assert.equal(api.state().carePlan.visits.length,2);assert.equal(context.syntheticSaveCount,2);
});
test('failed appointment persistence restores its own timestamp when nothing else changed',async()=>{
  const before=fixture();set(before);api.open();context.syntheticSaveStamp='2026-10-17T12:00:00Z';context.syntheticSaveOk=false;await submit();assert.deepEqual(json(api.state()),before);
});
test('successful save is not rolled back when the display refresh fails',async()=>{
  set();api.open();context.syntheticSaveStamp='2026-10-17T12:00:00Z';context.syntheticRenderThrows=1;await submit();const after=json(api.state());assert.equal(after.carePlan.visits.length,2);assert.equal(after.recordCorrections.length,2);assert.deepEqual(after,json(context.syntheticSaved));assert.match(toasts.at(-1).message,/saved.*display|saved.*refresh/i);assert.equal(node('#appointmentSaveButton').disabled,false);
});
test('failed edit save restores full original visit, custom fields and old audit',async()=>{
  const before=fixture();set(before);api.open('synthetic-existing');context.syntheticSaveOk=false;await submit();assert.deepEqual(json(api.state()),before);assert.equal(node('#appointmentDialog').open,true);
});
test('failed save rollback preserves an unrelated concurrent edit',async()=>{
  set();api.open();let release;context.syntheticSaveWait=new Promise(resolve=>{release=resolve;});context.syntheticSaveOk=false;const pending=submit();await Promise.resolve();
  const concurrent={id:'synthetic-concurrent',date:'2026-10-17',notes:'Concurrent synthetic observation'};api.mutate(state=>{state.observations.push(concurrent);state.recordCorrections.push({collection:'observations',id:concurrent.id,before:null,after:concurrent,at:'2026-10-17T12:00:01Z'});state._savedAt='2026-10-17T12:00:01Z';});release();await pending;
  const after=json(api.state());assert.deepEqual(after.carePlan.visits,fixture().carePlan.visits);assert.deepEqual(after.observations.at(-1),concurrent);assert.equal(after.recordCorrections.at(-1).id,concurrent.id);assert.equal(after._savedAt,'2026-10-17T12:00:01Z');
});
test('failed rollback also preserves newer unaudited additions and their save timestamp',async()=>{
  set();api.open();let release;context.syntheticSaveWait=new Promise(resolve=>{release=resolve;});context.syntheticSaveOk=false;context.syntheticSaveStamp='2026-10-17T12:00:00Z';const pending=submit();await Promise.resolve();
  const concurrent={id:'synthetic-unaudited-add',date:'2026-10-17',notes:'Concurrent synthetic addition'};api.mutate(state=>{state.observations.push(concurrent);state._savedAt='2026-10-17T12:00:02Z';});release();await pending;const after=json(api.state());assert.deepEqual(after.carePlan.visits,fixture().carePlan.visits);assert.deepEqual(after.recordCorrections,fixture().recordCorrections);assert.deepEqual(after.observations.at(-1),concurrent);assert.equal(after._savedAt,'2026-10-17T12:00:02Z');
});
test('invalid bound submission neither saves nor dismisses the draft',async()=>{
  const before=fixture();set(before);api.open();await submit(values({date:'2026-02-30'}));assert.deepEqual(json(api.state()),before);assert.equal(context.syntheticSaveCount,0);assert.equal(node('#appointmentDialog').open,true);
});
test('viewer blocked even if capability changes after the dialog was opened',async()=>{
  const before=fixture();set(before);api.open();api.set(before,false);await submit();assert.deepEqual(json(api.state()),before);assert.equal(context.syntheticSaveCount,0);
});
test('navigation closes an unsaved dialog without persisting or changing records',()=>{
  const before=fixture();set(before);api.open();api.navigate('home');assert.equal(node('#appointmentDialog').open,false);assert.deepEqual(json(api.state()),before);assert.equal(context.syntheticSaveCount,0);
});
test('dynamic appointment names and sources are escaped, with no deletion or calendar actions',()=>{
  set(fixture([visit({label:'<img src=x onerror=alert(1)>',source:'<script>synthetic()</script>'})]));const html=api.render();assert.doesNotMatch(html.plan,/<img|<script>/);assert.match(html.plan,/&lt;img/);
  const index=fs.readFileSync(path.join(root,'index.html'),'utf8'),dialog=index.match(/<dialog\b[^>]*id="appointmentDialog"[\s\S]*?<\/dialog>/)?.[0];assert(dialog,'Appointment dialog exists');assert.doesNotMatch(dialog,/delete|remove appointment|calendar|\.ics/i);
});

async function browserChecks(){
  const http=require('node:http');const {chromium}=require('playwright');
  const browserFixture=structuredClone(require('./test-navigation.cjs').fixture);
  browserFixture.carePlan.visits=groupsFixture();browserFixture.recordCorrections=fixture().recordCorrections;
  const server=http.createServer((req,res)=>{
    const relative=new URL(req.url,'http://synthetic').pathname;
    if(relative==='/data/seed.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(browserFixture));return;}
    if(relative.startsWith('/data/')){res.writeHead(404);res.end();return;}
    const file=path.join(root,relative==='/'?'index.html':relative);
    if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    try{const mime={'.js':'application/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};res.setHeader('Content-Type',mime[path.extname(file)]||'text/plain');res.end(fs.readFileSync(file));}catch(_){res.writeHead(404);res.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${server.address().port}`;let browser,currentPage,currentViewport;
  try{
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
    for(const viewport of [{width:1280,height:900},{width:390,height:844},{width:320,height:700}]){
      currentViewport=viewport;const browserContext=await browser.newContext({viewport,serviceWorkers:'block',timezoneId:'UTC'});
      await browserContext.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
      const page=await browserContext.newPage();currentPage=page;const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.clock.install({time:new Date(`${TODAY}T12:00:00Z`)});await page.goto(origin,{waitUntil:'networkidle'});await page.waitForFunction(()=>document.querySelector('#journalEntries')?.children.length>0);
      await page.evaluate(()=>{ownerCanEdit=true;cloud=null;ownerSession=null;window.syntheticAppointmentInitial=structuredClone(state);window.syntheticAppointmentSaveOk=true;window.syntheticAppointmentSaves=0;window.syntheticAppointmentWait=null;
        saveChanges=async()=>{window.syntheticAppointmentSaves++;if(window.syntheticAppointmentWait)await window.syntheticAppointmentWait;if(window.syntheticAppointmentSaveOk)window.syntheticAppointmentSaved=structuredClone(state);return window.syntheticAppointmentSaveOk;};renderAll();navigate('more/plan');});
      const storageBefore=await page.evaluate(()=>JSON.stringify({...localStorage}));const snapshot=()=>page.evaluate(()=>JSON.parse(JSON.stringify(state)));const initial=await snapshot();
      if(process.env.QA_SCREENSHOT_DIR){fs.mkdirSync(process.env.QA_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.QA_SCREENSHOT_DIR,`${viewport.width}-appointment-plan.png`),fullPage:true});}
      const reset=async()=>page.evaluate(()=>{document.querySelector('#appointmentDialog').close();state=structuredClone(window.syntheticAppointmentInitial);window.syntheticAppointmentSaveOk=true;window.syntheticAppointmentSaves=0;window.syntheticAppointmentWait=null;renderAll();navigate('more/plan');});
      const open=async()=>{await page.locator('#appointmentAddButton').click();await page.locator('#appointmentDialog').waitFor({state:'visible'});};
      const fill=async(changes={})=>{const entry={label:'Synthetic custom bloodwork',date:'2026-10-23',time:'10:45',source:'Synthetic owner note',...changes};for(const [key,value] of Object.entries(entry))await page.locator(`#appointmentForm [name="${key}"]`).fill(value);};
      const save=async()=>{await page.locator('#appointmentForm button[type="submit"]').click();await page.locator('#appointmentDialog').waitFor({state:'hidden'});};
      assert.match(await page.locator('#upcomingCare').textContent(),/Past|Earlier/);assert.match(await page.locator('#homeNextVisit').textContent(),/Synthetic today early/);assert.doesNotMatch(await page.locator('#homeNextVisit').textContent(),/Synthetic past plan/);
      await open();await fill();await page.locator('#appointmentForm [name="label"]').focus();await page.evaluate(()=>{renderAll();renderSharedStatus();});assert.equal(await page.locator('#appointmentForm [name="label"]').inputValue(),'Synthetic custom bloodwork');assert.equal(await page.locator('#appointmentForm [name="time"]').inputValue(),'10:45');assert(await page.locator('#appointmentForm [name="label"]').evaluate(input=>document.activeElement===input),'Background render retains field focus');assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'Appointment dialog fits viewport');
      if(process.env.QA_SCREENSHOT_DIR){fs.mkdirSync(process.env.QA_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.QA_SCREENSHOT_DIR,`${viewport.width}-appointment-form.png`),fullPage:true});}
      const cancel=page.getByRole('button',{name:'Cancel',exact:true});await cancel.click();assert.deepEqual(await snapshot(),initial,'Cancel keeps full state unchanged');assert.equal(await page.evaluate(()=>window.syntheticAppointmentSaves),0);
      await open();await fill();await page.locator('#appointmentDialog [aria-label="Close"]').click();assert.deepEqual(await snapshot(),initial,'Close keeps full state unchanged');await open();await fill();await page.keyboard.press('Escape');await page.locator('#appointmentDialog').waitFor({state:'hidden'});assert.deepEqual(await snapshot(),initial);
      await open();await fill();await page.evaluate(()=>navigate('home'));assert.deepEqual(await snapshot(),initial);assert.equal(await page.locator('#appointmentDialog').isVisible(),false);await page.goBack();assert.deepEqual(await snapshot(),initial);await page.goForward();assert.deepEqual(await snapshot(),initial);

      await reset();await open();await fill();await save();let after=await snapshot();const added=after.carePlan.visits.find(v=>v.label==='Synthetic custom bloodwork');assert(added);assert.equal(added.time,'10:45');assert.equal(after.carePlan.visits.length,initial.carePlan.visits.length+1);assert.deepEqual(after.recordCorrections.at(-1).after,added);assert.deepEqual(after.recordCorrections.at(-1).before,null);unchangedExcept(initial,after,['carePlan','recordCorrections']);
      const merged=await page.evaluate(canonical=>JSON.parse(JSON.stringify(mergeCanonicalSeed(canonical,JSON.parse(JSON.stringify(state))))),browserFixture);assert.deepEqual(merged.carePlan.visits,after.carePlan.visits,'JSON round trip and canonical merge preserve new appointments and their times');
      await page.locator(`[data-edit-appointment="${added.id}"]`).click();const countBeforeNoop=await page.evaluate(()=>window.syntheticAppointmentSaves);await save();assert.deepEqual(await snapshot(),after,'No-op edit retains all source and audit fields');assert.equal(await page.evaluate(()=>window.syntheticAppointmentSaves),countBeforeNoop);await page.locator(`[data-edit-appointment="${added.id}"]`).click();assert.equal(await page.locator('#appointmentForm [name="time"]').inputValue(),'10:45');await fill({label:'Synthetic edited appointment',date:'2026-10-01',time:'14:05'});await save();after=await snapshot();assert.equal(after.carePlan.visits.length,initial.carePlan.visits.length+1);assert.deepEqual(after.recordCorrections.at(-1).before,added);assert.equal(after.carePlan.visits.find(v=>v.id===added.id).time,'14:05');assert.match(await page.locator('#upcomingCare').textContent(),/Synthetic edited appointment/);assert.doesNotMatch(await page.locator('#homeNextVisit').textContent(),/Synthetic edited appointment/);

      await reset();await open();await fill({time:''});await save();after=await snapshot();assert.equal(after.carePlan.visits.at(-1).time??null,null);
      await reset();await open();await fill({date:'',time:''});await save();after=await snapshot();assert.equal(after.carePlan.visits.at(-1).date,null);assert.equal(after.carePlan.visits.at(-1).time??null,null);

      await reset();await open();await fill();await page.evaluate(()=>{window.syntheticAppointmentSaveOk=false;});await page.locator('#appointmentForm button[type="submit"]').click();await page.waitForFunction(()=>window.syntheticAppointmentSaves===1);assert.deepEqual(await snapshot(),initial);assert(await page.locator('#appointmentDialog').isVisible());assert.equal(await page.locator('#appointmentForm [name="label"]').inputValue(),'Synthetic custom bloodwork');await page.evaluate(()=>{window.syntheticAppointmentSaveOk=true;});await save();assert.equal((await snapshot()).carePlan.visits.length,initial.carePlan.visits.length+1);

      await reset();await open();await fill();await page.evaluate(()=>{window.syntheticAppointmentWait=new Promise(resolve=>{window.syntheticAppointmentRelease=resolve;});document.querySelector('#appointmentForm').requestSubmit();document.querySelector('#appointmentForm').requestSubmit();});assert.equal(await page.evaluate(()=>window.syntheticAppointmentSaves),1);await page.evaluate(()=>window.syntheticAppointmentRelease());await page.locator('#appointmentDialog').waitFor({state:'hidden'});after=await snapshot();assert.equal(after.carePlan.visits.length,initial.carePlan.visits.length+1);assert.equal(after.recordCorrections.length,initial.recordCorrections.length+1);

      await reset();await open();await fill({label:''});assert.equal(await page.locator('#appointmentForm').evaluate(form=>form.checkValidity()),false);await page.locator('#appointmentForm button[type="submit"]').click();assert.deepEqual(await snapshot(),initial);assert.equal(await page.evaluate(()=>window.syntheticAppointmentSaves),0);
      await reset();await open();await fill();await page.evaluate(()=>{ownerCanEdit=false;document.querySelector('#appointmentForm').requestSubmit();});assert.deepEqual(await snapshot(),initial);assert.equal(await page.evaluate(()=>window.syntheticAppointmentSaves),0);await page.locator('#appointmentDialog').evaluate(dialog=>dialog.close());await page.evaluate(()=>{openAppointmentDialog();});assert.equal(await page.locator('#appointmentDialog').isVisible(),false);
      assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage})),storageBefore,'Synthetic editing never writes browser storage');assert.deepEqual(errors,[],'No browser runtime errors');
      console.log(`BROWSER ${viewport.width}x${viewport.height}: add/edit/time/TBD, past/history, audit and unrelated-state preservation, cancel/Escape/navigation, repeat/invalid/failed save, viewer block and isolated merge passed`);await browserContext.close();
    }
  }catch(error){if(process.env.QA_SCREENSHOT_DIR&&currentPage&&!currentPage.isClosed()){fs.mkdirSync(process.env.QA_SCREENSHOT_DIR,{recursive:true});await currentPage.screenshot({path:path.join(process.env.QA_SCREENSHOT_DIR,`failure-${currentViewport?.width||'unknown'}-appointment.png`),fullPage:true}).catch(()=>{});}throw error;}
  finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
(async()=>{for(const {name,run} of testCases){await run();console.log('PASS '+name);}console.log(`${testCases.length} synthetic appointment checks passed.`);if(process.argv.includes('--browser'))await browserChecks();})().catch(error=>{console.error(error);process.exitCode=1;});
