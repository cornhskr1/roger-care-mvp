#!/usr/bin/env node
'use strict';
// Synthetic text and in-memory records only. No PDFs, seed data, disk storage,
// network, owner account, credentials or production record are loaded.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const RogerImport=require('../import-analysis.js');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
// Reuse the existing production gate at runtime without copying patient
// identifiers into a new test artifact. Fail closed if its shape changes.
const parserSource=fs.readFileSync(path.join(root,'import-analysis.js'),'utf8');
const gateMatches=[...parserSource.matchAll(/if\(!\/([A-Z]+)\\s\+([A-Z]+)\/i\.test\(normalized\)\|\|!\(isLab\|\|isOptimum\?\/PATIENT ID:\\s\*([0-9]+)\/i\.test\(normalized\):\/([A-Z0-9]+)\/i\.test\(normalized\)\)\)/g)];
assert.equal(gateMatches.length,1,'Exactly one recognizable production patient gate');
const patientHeader=`${gateMatches[0][1]} ${gateMatches[0][2]} ${gateMatches[0][4]}`;
const nodes=new Map();
function node(selector){
  if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',textContent:'',value:'',files:[],listeners:{},reset(){this.resets=(this.resets||0)+1;},addEventListener(type,fn){this.listeners[type]=fn;}});
  return nodes.get(selector);
}
const toasts=[];
const context=vm.createContext({console,Date,Intl,structuredClone,RogerImport,
  document:{addEventListener(){},querySelector:node},
  FormData:class{constructor(form){this.values=form.values;}get(key){return this.values[key]??null;}},
  syntheticSaveOk:true,syntheticSaveCount:0,toasts,
});
vm.runInContext(source+`
  saveChanges=async()=>{syntheticSaveCount++;return syntheticSaveOk;};
  renderAll=()=>{};
  toast=(message,error)=>toasts.push({message,error});
  bindImport();
  globalThis.testApi={
    set(value,draft,canEdit=true){state=structuredClone(value);importDraft=structuredClone(draft);ownerCanEdit=canEdit;},
    state(){return structuredClone(state);},draft(){return structuredClone(importDraft);},
    apply:applyReviewedSummary,
    render(){renderImportReview();return document.querySelector('#importReview').innerHTML;},
    failReading(){readImportPdf=async()=>{throw Error('This record has no readable text. No changes were made.');};}
  };
`,context,{filename:'app.js'});
const api=context.testApi;
const json=value=>JSON.parse(JSON.stringify(value));
const DATE='2026-01-16';
// Visit/dose/weight content is invented, not a copied care record.
const summaryText=weight=>`${patientHeader}\nFriday, January 16, 2026\n${weight}\nTreatments Performed\nVinblastine (2 mg; 2.5 mg/m2) treatment #2 of 8\nMedications`;
const draft=(weight='Weight: 20 kg')=>RogerImport.analyze(summaryText(weight),'summary','synthetic-summary.pdf');
const treatment=(overrides={})=>({id:'synthetic-treatment',number:2,date:DATE,drug:'Vinblastine',doseMg:2,doseMgM2:2.5,weightLb:42,
  prednisone:'Original synthetic course',doseReason:'Original synthetic reason',clinicalSummary:'Original synthetic summary',source:'Original synthetic clinic source',customField:{keep:true},...overrides});
const fixture=(treatments=[treatment()])=>({profile:{name:'Synthetic dog'},treatments,
  recordCorrections:[{collection:'observations',id:'old-audit',before:{notes:'before'},after:{notes:'after'},at:'2026-01-01T00:00:00Z'}],
  importHistory:[{key:'unrelated-import',filename:'synthetic-old.pdf'}],observations:[{id:'original-note',rawEntry:'Verbatim synthetic note'}],
  labs:[{metric:'Synthetic lab',value:9}],costs:[{id:'synthetic-cost',amountPaid:10}],medicationPurchases:[{id:'synthetic-purchase'}],
  medicationCourses:[{id:'synthetic-course'}],_savedAt:'synthetic-before'});
const values=(overrides={})=>({date:DATE,doseMg:'2',doseMgM2:'2.5',weight:'20',weightUnit:'kg',...overrides});
const tests=[];
const test=(name,run)=>tests.push({name,run});
async function submit(formValues=values()){
  return node('#importReview').listeners.submit({target:{id:'importConfirm',values:formValues},preventDefault(){}});
}
function set(value=fixture(),d=draft(),canEdit=true){api.set(value,d,canEdit);context.syntheticSaveOk=true;context.syntheticSaveCount=0;toasts.length=0;}

for(const [label,value,unit,pounds] of [
  ['Weight: 44 lb',44,'lb',44],['Weight: 44.1 lbs',44.1,'lb',44.1],['Weight 20kg',20,'kg',44.09],
  ['Body weight: 20 KG',20,'kg',44.09],['Current weight: 44 LB',44,'lb',44],['Weight (kg): 20',20,'kg',44.09],['Weight (lbs): 44.1',44.1,'lb',44.1],['Weight (kg): 20 kg',20,'kg',44.09],
  ['The patient weighed 20 kg (44.1 lb)',44.1,'lb',44.1],['The patient weighed 44.1 lbs (20 kg)',44.1,'lb',44.1],
  ['Weight:\n20 kg',20,'kg',44.09]
])test('explicit weight: '+label,()=>{
  const d=draft(label);assert.equal(d.weightLb,pounds);assert.equal(d.weightExtraction.value,value);assert.equal(d.weightExtraction.unit,unit);assert.equal(d.weightExtraction.status,'extracted');
});

test('missing, unitless, target and non-weight values are not inferred',()=>{
  for(const text of ['', 'Weight: 20', '20 kg', 'Dose: 20 mg', 'Target weight: 20 kg', 'Previous weight: 20 kg', 'Ideal weight: 20 kg', 'Weight: 20 kg/m2', 'The patient previously weighed 40 lb', 'Weight (kg): 22,5', 'Weight (kg): 22.5.7', 'Weight (kg): 22e3', 'The patient weighed 40 lb at his last visit.', 'The patient weighed 40 lb previously.']){
    const d=draft(text);assert.equal(d.weightLb,null,text);assert.equal(d.weightExtraction.status,'missing',text);
  }
});
test('equivalent repeated labels are supported; conflicting labels stay unknown',()=>{
  assert.equal(draft('Weight: 20 kg\nWeight: 20 kg').weightLb,44.09);
  assert.equal(draft('Weight: 20 kg\nWeight: 44.09 lb').weightLb,44.09);
  for(const text of ['Weight: 20 kg\nWeight: 50 lb','Weight: 20 kg (90 lb)','Weight: 20 kg (20 kg)','Weight: 0 lb', 'Weight: 20 kg (90 lb/m2)', 'Weight: 20 kg (90 unknown)', 'Weight (kg): 20 lb', 'Weight (lb): 20 kg', 'Weight (kg): 20 mg/kg', 'Weight (kg): 20 pounds']){
    const d=draft(text);assert.equal(d.weightLb,null);assert.equal(d.weightExtraction.status,'ambiguous');
  }
});
test('conversion requires an explicit unit and positive finite decimal',()=>{
  assert.equal(RogerImport.weightToLb('20','kg'),44.09);
  assert.equal(RogerImport.weightToLb('44.125','lb'),44.125,'Explicit pound precision is not rounded');
  for(const value of ['', ' ',null,undefined])assert.equal(RogerImport.weightToLb(value,'lb'),null);
  for(const value of ['0','-2','NaN','Infinity','20 lbs','1e2','1,2','1.2.3',String(Number.MAX_VALUE)])assert.throws(()=>RogerImport.weightToLb(value,'kg'),/positive weight/);
  for(const unit of ['',null,'g','oz'])assert.throws(()=>RogerImport.weightToLb('20',unit),/positive weight/);
});
test('no readable/recognized summary cannot create a draft',()=>{
  for(const text of ['', 'Weight: 20 kg', `${patientHeader}\nFriday, January 16, 2026\nWeight: 20 kg`])assert.throws(()=>RogerImport.analyze(text,'summary','synthetic-scan.pdf'));
});
test('weight-only correction preserves all other records, clinical fields and dose source',()=>{
  const before=fixture();set(before);api.apply(draft(),values());const after=api.state();
  assert.equal(after.treatments.length,1);assert.equal(after.treatments[0].weightLb,44.09);
  for(const [key,value] of Object.entries(before.treatments[0]))if(key!=='weightLb')assert.deepEqual(json(after.treatments[0][key]),value,key);
  for(const key of Object.keys(before))if(!['treatments','recordCorrections'].includes(key))assert.deepEqual(json(after[key]),before[key],key);
  assert.deepEqual(json(after.recordCorrections[0]),before.recordCorrections[0]);
  assert.deepEqual(json(after.recordCorrections[1].before),before.treatments[0]);
  assert.equal(after.recordCorrections[1].after.weightLb,44.09);assert.equal(after.recordCorrections[1].id,'synthetic-treatment');
  assert.equal(after.recordCorrections[1].after.weightReview.source,'pdf-extracted-owner-reviewed');
  assert.equal(after.recordCorrections[1].after.weightReview.extracted.value,20);assert.equal(after.recordCorrections[1].after.weightReview.extracted.unit,'kg');
  assert.equal(after.recordCorrections[1].after.weightReview.value,20);assert.equal(after.recordCorrections[1].after.weightReview.unit,'kg');
});
test('manually added and corrected weights are distinguished from extraction',()=>{
  for(const [d,weight] of [[draft(''), '43.5'],[draft(),'43.5']]){
    set(fixture(),d);api.apply(d,values({weight,weightUnit:'lb'}));const review=api.state().treatments[0].weightReview;
    assert.equal(review.source,'owner-entered');assert.equal(review.value,43.5);assert.equal(review.weightLb,43.5);
    assert.equal(review.extracted?.weightLb??null,d.weightLb);
  }
});
test('editing the extracted value or unit records manual provenance even at equivalent weight',()=>{
  set();api.apply(draft(),values({weight:'44.09',weightUnit:'lb'}));assert.equal(api.state().treatments[0].weightReview.source,'owner-entered');
  set();api.apply(draft(),values({weight:'20.00001'}));assert.equal(api.state().treatments[0].weightReview.source,'owner-entered');
});
test('manual kg entry after missing extraction uses checked conversion',()=>{
  const d=draft('');set(fixture(),d);api.apply(d,values());
  assert.equal(api.state().treatments[0].weightLb,44.09);assert.equal(api.state().treatments[0].weightReview.source,'owner-entered');
});
test('blank or absent review never erases prior weight or provenance',()=>{
  for(const weight of ['', ' ',null,undefined]){
    const prior=treatment({weightLb:44.125,weightReview:{source:'prior-owner-entry',value:44.125,unit:'lb'}}),before=fixture([prior]);
    set(before);api.apply(draft(),values({weight}));assert.deepEqual(json(api.state()),before);
  }
});
test('blank review preserves known weight while a dose correction is audited',()=>{
  const prior=treatment({weightReview:{source:'prior-entry'}});set(fixture([prior]));api.apply(draft(),values({doseMg:'2.1',weight:''}));
  const after=api.state(),last=after.recordCorrections.at(-1);assert.equal(after.treatments[0].weightLb,42);assert.deepEqual(json(after.treatments[0].weightReview),prior.weightReview);
  assert.equal(after.treatments[0].doseMg,2.1);assert.equal(after.treatments[0].source,'K-State patient summary · synthetic-summary.pdf');
  assert(!Object.hasOwn(last.after,'weightLb'));assert(!Object.hasOwn(last.after,'weightReview'));assert.deepEqual(json(last.before),prior);
});
test('new treatment with blank weight remains unknown, not zero',()=>{
  set(fixture([]),draft(''));api.apply(draft(''),values({weight:''}));const after=api.state();
  assert.equal(after.treatments.length,1);assert.equal(after.treatments[0].weightLb,null);assert(!Object.hasOwn(after.treatments[0],'weightReview'));
});
test('new treatment is added once and repeat review is idempotent',()=>{
  set(fixture([]));api.apply(draft(),values());const after=api.state();api.apply(draft(),values());assert.deepEqual(json(api.state()),json(after));
});
test('repeat correction does not duplicate treatment or audit entries',()=>{
  set();api.apply(draft(),values());const after=api.state();api.apply(draft(),values());assert.deepEqual(json(api.state()),json(after));
});
test('number stored as a string still matches, avoiding duplicate import',()=>{
  set(fixture([treatment({number:'2'})]));api.apply(draft(),values());assert.equal(api.state().treatments.length,1);assert.equal(api.state().treatments[0].id,'synthetic-treatment');
});
test('ambiguous treatment number and occupied ID stop before any mutation',()=>{
  for(const rows of [[treatment(),treatment({id:'duplicate'})],[treatment({id:'chemo-2',number:3})],[treatment({id:null})],[treatment({number:3}),treatment()]]){
    const before=fixture(rows);set(before);assert.throws(()=>api.apply(draft(),values()),/Resolve/);assert.deepEqual(json(api.state()),before);
    assert.match(api.render(),/Resolve/);assert.doesNotMatch(api.render(),/<form/);
  }
});
test('invalid reviewed weight and dose cannot mutate a treatment or audit',()=>{
  for(const changes of [{weight:'0'},{weight:'-1'},{weight:'Infinity'},{weight:'20',weightUnit:''},{doseMg:'0'},{doseMgM2:'no'}]){
    const before=fixture();set(before);assert.throws(()=>api.apply(draft(),values(changes)));assert.deepEqual(json(api.state()),before);
  }
});
test('review exposes explicit unit, existing value, extraction and missing flags without changing state',()=>{
  set();const before=api.state(),html=api.render();assert.match(html,/name="weight"/);assert.match(html,/value="20"/);assert.match(html,/<option value="kg" selected>/);assert.match(html,/Existing: .*42 lb/);assert.match(html,/Read from PDF: Weight: 20 kg/);assert.doesNotMatch(html,/Values already reconcile/);assert.deepEqual(json(api.state()),json(before));
  set(fixture(),draft(''));const missing=api.render();assert.match(missing,/Weight was not found/);assert.match(missing,/Leave blank to keep the existing 42 lb/);assert.match(missing,/name="weight"[^>]+value=""/);assert.doesNotMatch(missing,/Values already reconcile/);
  set(fixture([]),draft(''));assert.match(api.render(),/Leave blank to keep weight unknown/);
  set(fixture(),draft('Weight: 20 kg (90 lb)'));assert.match(api.render(),/conflicting or invalid/);
});
test('already reconciled includes weight and never treats missing weight as zero',()=>{
  set(fixture([treatment({weightLb:44.09})]));assert.match(api.render(),/Values already reconcile/);
  set(fixture([treatment({weightLb:null})]));assert.doesNotMatch(api.render(),/Values already reconcile/);
});
test('dynamic evidence and filenames are escaped in review HTML',()=>{
  const d=draft();d.filename='<img src=x onerror=alert(1)>';d.weightExtraction.evidence='<script>bad()</script>';set(fixture(),d);const html=api.render();assert.doesNotMatch(html,/<img|<script>/);assert.match(html,/&lt;script&gt;/);
});
test('bound save reads manual fields, preserves unrelated history and repeat import count',async()=>{
  const before=fixture(),d=draft('');set(before,d);await submit(values({weight:'43.5',weightUnit:'lb'}));const after=api.state();
  assert.equal(after.treatments[0].weightLb,43.5);assert.equal(after.treatments[0].weightReview.source,'owner-entered');assert.equal(context.syntheticSaveCount,1);assert.equal(api.draft(),null);
  assert.deepEqual(json(after.importHistory[0]),before.importHistory[0]);assert.equal(after.importHistory.filter(row=>row.key==='treatment:2').length,1);
  set(after,d);await submit(values({weight:'43.5',weightUnit:'lb'}));const again=api.state();assert.equal(again.treatments.length,1);assert.equal(again.recordCorrections.length,after.recordCorrections.length);assert.equal(again.importHistory.filter(row=>row.key==='treatment:2').length,1);
});
test('failed save restores exact pre-import state and leaves review available',async()=>{
  const before=fixture();set(before);context.syntheticSaveOk=false;await submit();assert.deepEqual(json(api.state()),before);assert(api.draft());assert.match(toasts.at(-1).message,/Could not save/);
});
test('invalid submit does not call save or leave partial changes',async()=>{
  const before=fixture();set(before);await submit(values({weight:'-1'}));assert.deepEqual(json(api.state()),before);assert.equal(context.syntheticSaveCount,0);assert.match(toasts.at(-1).message,/positive weight/);
});
test('viewer and absent draft cannot save manual values',async()=>{
  const before=fixture();set(before,draft(),false);await submit();assert.deepEqual(json(api.state()),before);assert.equal(context.syntheticSaveCount,0);assert.match(toasts.at(-1).message,/Connect the owner/);
  set(before,null);await submit();assert.deepEqual(json(api.state()),before);assert.equal(context.syntheticSaveCount,0);
});
test('failed text extraction clears older draft and cannot save stale treatment',async()=>{
  const before=fixture();set(before);api.failReading();node('#analyzeFile').files=[{name:'synthetic-scan.pdf'}];node('#analyzeType').value='summary';const button={disabled:false};
  await node('#analyzeForm').listeners.submit({preventDefault(){},submitter:button});assert.equal(api.draft(),null);assert.equal(button.disabled,false);assert.match(node('#importReview').innerHTML,/no readable text/);
  await submit();assert.deepEqual(json(api.state()),before);assert.equal(context.syntheticSaveCount,0);
});
async function browserChecks(){
  const http=require('node:http');
  const {chromium}=require('playwright');
  const browserFixture=structuredClone(require('./test-navigation.cjs').fixture);
  const server=http.createServer((req,res)=>{
    const relative=new URL(req.url,'http://synthetic').pathname;
    if(relative==='/data/seed.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(browserFixture));return;}
    const file=path.join(root,relative==='/'?'index.html':relative);
    if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    try{
      const mime={'.js':'application/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
      res.setHeader('Content-Type',mime[path.extname(file)]||'text/plain');res.end(fs.readFileSync(file));
    }catch(_){res.writeHead(404);res.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${server.address().port}`;
  let browser,currentPage,currentViewport;
  try{
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
    for(const viewport of [{width:1280,height:900},{width:390,height:844},{width:320,height:700}]){
      currentViewport=viewport;
      const browserContext=await browser.newContext({viewport,serviceWorkers:'block',timezoneId:'UTC'});
      // Only synthetic assets on this ephemeral local server may be requested.
      await browserContext.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
      const page=await browserContext.newPage();currentPage=page;
      const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(origin,{waitUntil:'networkidle'});
      await page.waitForFunction(()=>document.querySelector('#journalEntries')?.children.length>0);
      await page.evaluate(value=>{
        // No login is attempted. Synthetic capability and in-memory persistence
        // isolate the actual form/handler from all storage and backend writes.
        ownerCanEdit=true;cloud=null;ownerSession=null;
        state={...state,treatments:value.treatments,recordCorrections:value.recordCorrections,importHistory:value.importHistory};
        window.syntheticWeightInitial=structuredClone(state);
        window.syntheticWeightSaves=0;window.syntheticWeightSaveOk=true;
        saveChanges=async()=>{window.syntheticWeightSaves++;return window.syntheticWeightSaveOk;};
        renderAll();navigate('more/documents');
      },fixture());
      const storage=await page.evaluate(()=>JSON.stringify({...localStorage}));
      const snapshot=()=>page.evaluate(()=>JSON.parse(JSON.stringify(state)));
      const reset=async()=>page.evaluate(()=>{
        state=structuredClone(window.syntheticWeightInitial);importDraft=null;
        window.syntheticWeightSaves=0;window.syntheticWeightSaveOk=true;
        document.querySelector('#importReview').innerHTML='';renderAll();navigate('more/documents');
      });
      const analyze=async(text,scan=false)=>{
        await page.evaluate(({text,scan})=>{
          // Test the real analyze/review/save path with synthetic extraction.
          // PDF.js/OCR are not invoked or represented as browser-tested here.
          readImportPdf=async()=>{if(scan)throw Error('This record has no readable text. No changes were made.');return text;};
        },{text,scan});
        await page.locator('#analyzeType').selectOption('summary');
        await page.locator('#analyzeFile').setInputFiles({name:'synthetic-summary.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nSynthetic placeholder, no clinical content.')});
        await page.locator('#analyzeForm button[type="submit"]').click();
        if(scan)await page.waitForFunction(()=>document.querySelector('#importReview').textContent.includes('no readable text'));
        else await page.locator('#importConfirm').waitFor({state:'visible'});
      };
      const save=async()=>{
        await page.locator('#importConfirm .import-check input[type="checkbox"]').check();
        await page.locator('#importConfirm button[type="submit"]').click();
        await page.waitForFunction(()=>document.querySelector('#importReview').textContent.includes('Reviewed values saved'));
      };

      await analyze(summaryText('Weight: 20 kg'));
      assert.equal(await page.locator('[name="weight"]').inputValue(),'20');
      assert.equal(await page.locator('[name="weightUnit"]').inputValue(),'kg');
      assert.match(await page.locator('#importWeightHelp').textContent(),/Read from PDF/);
      await page.locator('[name="weightUnit"]').selectOption('lb');
      await page.locator('[name="weight"]').fill('43.5');
      assert.equal(await page.locator('[name="weightUnit"]').inputValue(),'lb');
      assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),'Review fits viewport');
      if(process.env.QA_SCREENSHOT_DIR){fs.mkdirSync(process.env.QA_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.QA_SCREENSHOT_DIR,`${viewport.width}-weight-review.png`),fullPage:true});}
      const initial=await snapshot();
      await page.locator('.bottom-nav [data-nav="home"]').click();
      assert.deepEqual(await snapshot(),initial,'Navigating away from an unsaved review does not modify data');
      await page.goBack();
      await page.locator('#importConfirm').waitFor({state:'visible'});
      assert.deepEqual(await snapshot(),initial,'Back does not save the pending review');

      await reset();await analyze(summaryText('Weight: 20 kg'));await save();
      let saved=await snapshot();assert.equal(saved.treatments.length,1);assert.equal(saved.treatments[0].weightLb,44.09);assert.equal(saved.treatments[0].weightReview.source,'pdf-extracted-owner-reviewed');
      assert.equal(saved.treatments[0].source,initial.treatments[0].source,'Weight-only save preserves clinical source');
      for(const key of ['prednisone','doseReason','clinicalSummary','customField'])assert.deepEqual(saved.treatments[0][key],initial.treatments[0][key]);
      assert.deepEqual(saved.recordCorrections.at(-1).before,initial.treatments[0]);

      await reset();await analyze(summaryText(''));
      assert.match(await page.locator('#importWeightHelp').textContent(),/Weight was not found/);
      assert.equal(await page.locator('[name="weight"]').inputValue(),'');
      assert.match(await page.locator('#importWeightHelp').textContent(),/keep the existing 42 lb/);
      await save();saved=await snapshot();assert.deepEqual(saved.treatments,initial.treatments,'Blank review preserves old weight and all clinical fields');
      assert.deepEqual(saved.recordCorrections,initial.recordCorrections,'Blank unchanged review adds no correction');

      await reset();await analyze(summaryText(''));
      await page.locator('[name="weight"]').fill('20');await page.locator('[name="weightUnit"]').selectOption('kg');await save();
      saved=await snapshot();assert.equal(saved.treatments[0].weightLb,44.09);assert.equal(saved.treatments[0].weightReview.source,'owner-entered');
      await analyze(summaryText(''));
      await page.locator('[name="weight"]').fill('20');await page.locator('[name="weightUnit"]').selectOption('kg');await save();
      const repeated=await snapshot();assert.equal(repeated.treatments.length,1);assert.equal(repeated.recordCorrections.length,saved.recordCorrections.length);assert.equal(repeated.importHistory.filter(row=>row.key==='treatment:2').length,1);

      await reset();await analyze(summaryText(''));
      await page.locator('[name="weight"]').fill('-1');await page.locator('#importConfirm .import-check input').check();
      assert.equal(await page.locator('#importConfirm').evaluate(form=>form.checkValidity()),false);
      await page.locator('#importConfirm button[type="submit"]').click();assert.deepEqual(await snapshot(),initial);
      await page.locator('[name="weight"]').fill('0');await page.locator('#importConfirm button[type="submit"]').click();
      assert.deepEqual(await snapshot(),initial);assert.equal(await page.evaluate(()=>window.syntheticWeightSaves),0);
      assert(await page.locator('#importConfirm').isVisible(),'Invalid zero is rejected by save handler without dismissing review');

      await reset();await analyze(summaryText('Weight: 20 kg'));
      await page.evaluate(()=>{window.syntheticWeightSaveOk=false;});
      await page.locator('#importConfirm .import-check input').check();await page.locator('#importConfirm button[type="submit"]').click();
      await page.waitForFunction(()=>window.syntheticWeightSaves===1);
      assert.deepEqual(await snapshot(),initial,'Rejected synthetic persistence restores the full record');
      assert(await page.locator('#importConfirm').isVisible());

      await reset();await analyze(summaryText('Weight: 20 kg'));await analyze('',true);
      assert.equal(await page.locator('#importConfirm').count(),0,'Scan failure cannot expose a stale editable draft');
      assert.equal(await page.evaluate(()=>importDraft),null);assert.deepEqual(await snapshot(),initial);
      assert.doesNotMatch(await page.locator('#importReview').textContent(),/reading its first page|OCR/i,'Summary scan has no unsupported OCR claim');
      assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage})),storage,'Synthetic review never modifies browser storage');
      assert.deepEqual(errors,[],'No browser runtime errors');
      console.log(`BROWSER ${viewport.width}x${viewport.height}: actual lb/kg review, missing/blank/manual weight, audit/source preservation, repeat/invalid/failed save, navigation-before-save, scan failure, no storage/backend writes passed`);
      await browserContext.close();
    }
  }catch(error){
    if(process.env.QA_SCREENSHOT_DIR&&currentPage&&!currentPage.isClosed()){
      fs.mkdirSync(process.env.QA_SCREENSHOT_DIR,{recursive:true});
      await currentPage.screenshot({path:path.join(process.env.QA_SCREENSHOT_DIR,`failure-${currentViewport?.width||'unknown'}-weight-review.png`),fullPage:true}).catch(()=>{});
    }
    throw error;
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}

(async()=>{
  for(const {name,run} of tests){await run();console.log('PASS '+name);}
  console.log(`${tests.length} synthetic weight-import checks passed.`);
  if(process.argv.includes('--browser'))await browserChecks();
})().catch(error=>{console.error(error);process.exitCode=1;});
