#!/usr/bin/env node
'use strict';
// Offline-only navigation regression test. Uses an ephemeral local origin and
// synthetic records; no production service, account, files, or saved data used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const expectedRoutes = {
  home: ['#openJournalComposer', '#homeMedicationButton', '#latestObservation', '#homeNextVisit', '#homeCareContacts', '#homeBackupStatus'],
  'journal/entries': ['#journalEntries', '#journalHistoryToggle', '#journalAddButton'],
  'journal/trends': ['#journalSummary', '#journalBrief', '#journalTrend', '#wellbeingForm'],
  medications: ['#medicationSummary', '#medicationHistory', '#medicationAddButton'],
  'timeline/history': ['#timelineUpcoming', '#timelineEntries'],
  'timeline/chart': ['#metricStrip', '#treatmentWindowSelector', '#treatmentOverlayChart', '#treatmentOverlayDetail', '#treatmentMedicationSummary'],
  'timeline/review': ['#statusHero', '#cycleClinicalReview'],
  costs: ['#costSummary', '#costEntries', '#homeCostSummary', '#openItems', '#medicationCostBreakdown'],
  'more/menu': ['#more-panel-menu'],
  'more/questions': ['#questionForm', '#nextVisitQuestions'],
  'more/contacts': ['#careTeamQuick', '#careTeamForm'],
  'more/plan': ['#upcomingCare', '#carePlanForm'],
  'more/documents': ['#analyzeForm', '#documentForm', '#documentList'],
  'more/backup': ['#sharedControls', '#backupStatus', '#exportBackup'],
  'more/profile': ['#profileDetails'],
  snapshot: ['#careSnapshotPreview', '#shareCareSummary', '#downloadCareSummary', '#printCareSummary']
};
const fixture = {
  schemaVersion: 16,
  profile: {name:'Test pet', fullName:'Synthetic Test Pet', patientIds:{ksu:'TEST-KSU', optimum:'TEST-OPT'}, breed:'Test breed',sex:'Male',reproductiveStatus:'Neutered',dob:'2020-01-01',diagnosis:'Synthetic diagnosis',currentStatus:'Synthetic status'},
  carePlan: {visits:[{id:'test-past',label:'Earlier planned visit',date:'2026-10-01',source:'Synthetic plan'},{id:'test-today',label:'Today planned visit',date:'2026-10-15',source:'Synthetic plan'},{id:'test-future',label:'Later planned visit',date:'2026-10-20',source:'Synthetic plan'},{id:'test-tbd',label:'Undated plan',date:null,source:'Synthetic plan'}],vetCallInstructions:'Test call instructions',vetCallSource:'Synthetic source',careTeam:[{id:'ksu',name:'Synthetic specialty',phone:'555-0100',address:'Test address'},{id:'optimum',name:'Synthetic primary',phone:'555-0101',address:'Test address'},{id:'emergency',name:'',phone:'',address:''}],questions:[{id:'question-test',text:'Synthetic question?',status:'open',createdAt:'2026-10-10T12:00:00Z'}]},
  sourceNotes:[],
  treatments:[{id:'test-treatment-1',number:1,date:'2026-10-02',drug:'Vinblastine',doseMg:2,doseMgM2:1.2,weightLb:50,prednisone:'Synthetic',doseReason:'Synthetic reason',clinicalSummary:'Synthetic summary',source:'Synthetic clinical record'}],
  labs:[{id:'test-lab-1',date:'2026-10-09',metric:'Neutrophils',value:5,unit:'K/uL',source:'Synthetic lab',context:'Synthetic result'},{id:'test-lab-2',date:'2026-10-09',metric:'Hematocrit',value:40,unit:'%',source:'Synthetic lab',context:'Synthetic result'}],
  observations:Array.from({length:12},(_,i)=>({id:`test-observation-${i}`,date:`2026-10-${String(i+2).padStart(2,'0')}`,appetite:'normal',energy:'normal',nausea:0,vomiting:0,stoolEvents:[{period:'AM',score:3,status:'observed'}],notes:`Synthetic observation ${i}`,medications:[],rawEntry:i===0?'Synthetic original wording':'',source:'owner_observation'})),
  costs:[{id:'cost-test',date:'2026-10-02',provider:'Synthetic provider',label:'Synthetic cost',amountPaid:50,category:'treatment',status:'confirmed',source:'Synthetic invoice'}],
  milestones:[{date:'2026-10-03',type:'clinical',title:'Synthetic milestone',detail:'Synthetic detail',source:'Synthetic source'}],
  journalCoverageThrough:'2026-10-13',
  medications:[{id:'med-prednisone',name:'Prednisone',prescribedDose:'10 mg daily',tabletStrengthMg:10},{id:'med-cerenia',name:'Cerenia',prescribedDose:'As prescribed',tabletStrengthMg:60},{id:'med-amoxicillin',name:'Amoxicillin',prescribedDose:'Not recorded'}],
  medicationCourses:[{id:'test-course-1',medicationId:'med-prednisone',startDate:'2026-10-02',endDate:'2026-10-05',dose:'20 mg',frequency:'daily',status:'owner-confirmed daily given',source:'Synthetic confirmation'},{id:'test-course-2',medicationId:'med-prednisone',startDate:'2026-10-06',endDate:null,confirmedThrough:'2026-10-13',dose:'10 mg',frequency:'daily',status:'owner-confirmed daily given',source:'Synthetic confirmation'}],
  medicationAdministrations:[{id:'test-dose',medicationId:'med-cerenia',date:'2026-10-04',dose:'60 mg',status:'given',source:'Synthetic observation'}],medicationPurchases:[]
};
function staticChecks() {
  const before = execFileSync('git', ['show','b2941ebb:index.html'], {cwd:root,encoding:'utf8'});
  const after = fs.readFileSync(path.join(root,'index.html'),'utf8');
  const ids = html => [...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  const oldIds = ids(before), newIds = ids(after);
  assert.deepEqual(oldIds.filter(id=>!newIds.includes(id)), [], 'All existing element IDs must be preserved');
  assert.deepEqual(newIds.filter((id,i)=>newIds.indexOf(id)!==i), [], 'No duplicate IDs');
  const beforeApp=execFileSync('git',['show','b2941ebb:app.js'],{cwd:root,encoding:'utf8'});
  const afterApp=fs.readFileSync(path.join(root,'app.js'),'utf8');
  const protectedFunctions=['mergeCanonicalSeed','migrateState','persist','saveChanges','connectCloud','initializeCloudMode','checkOwner','cloudRecord','readCloudMetadata','readCloudViewer','publishCloudMirror','parseOwnerSignInLink','loadState','bindForms','bindImport','bindProfilePhoto','readBackupMeta','renderBackupStatus','openDocDb','latestRecoverySnapshot','saveRecoverySnapshot','saveDocument','replaceDocuments','loadDocuments','renderDocuments','openDocument'];
  const extract = (source,name) => {
    const start=source.search(new RegExp(`(?:async )?function ${name}\\(`));
    assert(start>=0, name+' exists');
    const next=source.slice(start+1).search(/\n(?:async )?function /);
    return source.slice(start,next<0?source.length:start+1+next);
  };
  for(const name of protectedFunctions) assert.equal(extract(afterApp,name),extract(beforeApp,name),name+' implementation unchanged');
  for(const key of ['STORAGE_KEY','DOC_DB','DOC_STORE','RECOVERY_STORE','BACKUP_META_KEY','PENDING_CLOUD_KEY','SUPABASE_URL','SUPABASE_KEY','SITE_URL']) {
    const re=new RegExp(`const ${key} = [^;]+;`);
    assert.equal(afterApp.match(re)?.[0],beforeApp.match(re)?.[0], key+' unchanged');
  }
  const changed = execFileSync('git',['diff','--name-only','b2941ebb'],{cwd:root,encoding:'utf8'}).trim().split('\n');
  assert(!changed.some(p=>p.startsWith('data/')||p.startsWith('supabase/')), 'Seed/schema contracts unchanged');
  return `${oldIds.length} pre-existing IDs retained; storage, migration, and sync implementations unchanged`;
}
function vmChecks() {
  // A small deterministic DOM model checks route/state mechanics. This does
  // not stand in for layout, browser rendering, focus, or browser accessibility.
  const nodes=[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<([a-z][\w-]*)\b([^<>]*)>/gi)].map(match=>{
    const attrs=Object.fromEntries([...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
    const classes=new Set((attrs.class||'').split(/\s+/).filter(Boolean));
    const node={attrs,tagName:match[1],hidden:/\bhidden(?:\s|$)/.test(match[2]),disabled:false,innerHTML:'',value:attrs.value||'',clientWidth:780,dataset:{},
      classList:{contains:c=>classes.has(c),toggle:(c,force)=>{const on=force??!classes.has(c);on?classes.add(c):classes.delete(c);return on;}},
      setAttribute:(k,v)=>{attrs[k]=String(v);},removeAttribute:k=>{delete attrs[k];},getAttribute:k=>attrs[k]??null,querySelectorAll:()=>[],querySelector:()=>null,addEventListener:()=>{},scrollIntoView:()=>{}};
    for(const [key,value] of Object.entries(attrs))if(key.startsWith('data-'))node.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;
    node.closest=selector=>selector==='[data-nav]'&&node.dataset.nav?node:null;
    return node;
  });
  const match=(node,selector)=>{
    if(selector.startsWith('.section-tabs '))selector=selector.slice('.section-tabs '.length);
    if(selector.includes(' '))return false;
    const id=/^#([^\[.]+)/.exec(selector);if(id&&node.attrs.id!==id[1])return false;
    const cls=/^\.([^\[.]+)/.exec(selector);if(cls&&!node.classList.contains(cls[1]))return false;
    const attr=/\[([^\]^=]+)(\^=|=)?(?:"([^"]*)")?\]/.exec(selector);
    if(attr){const val=node.attrs[attr[1]];if(val===undefined)return false;if(attr[2]==='='&&val!==attr[3])return false;if(attr[2]==='^='&&!val.startsWith(attr[3]))return false;}
    return Boolean(id||cls||attr);
  };
  const listeners={},windowListeners={},location={hash:''};
  const document={querySelector:sel=>nodes.find(node=>match(node,sel))||null,querySelectorAll:sel=>nodes.filter(node=>match(node,sel)),addEventListener:(name,fn)=>{(listeners[name]??=[]).push(fn);}};
  const stack=[''];let cursor=0;
  const history={pushState:(_a,_b,hash)=>{stack.splice(++cursor);stack.push(hash);location.hash=hash;},back:()=>{if(cursor>0){location.hash=stack[--cursor];for(const fn of windowListeners.popstate||[])fn();}},forward:()=>{if(cursor<stack.length-1){location.hash=stack[++cursor];for(const fn of windowListeners.popstate||[])fn();}},get length(){return stack.length;}};
  const FixedDate=class extends Date{constructor(...args){super(...(args.length?args:['2026-10-15T12:00:00Z']));}static now(){return new Date('2026-10-15T12:00:00Z').valueOf();}};
  const sandbox={document,location,history,window:{addEventListener:(name,fn)=>{(windowListeners[name]??=[]).push(fn);},scrollTo:()=>{}},console,structuredClone,Map,Set,Date:FixedDate,URL,setTimeout:()=>{},clearTimeout:()=>{},setInterval:()=>{}};
  const ctx=vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(root,'app.js'),'utf8'),ctx);
  vm.runInContext('cacheEls();bindNav();',ctx);
  const click=route=>{const node=nodes.find(n=>n.dataset.nav===route);assert(node,'Route control exists: '+route);for(const fn of listeners.click||[])fn({target:node});};
  const active=()=>nodes.find(n=>n.classList.contains('view')&&n.classList.contains('active'))?.dataset.view;
  assert.equal(active(),'home');
  assert.deepEqual(nodes.filter(n=>n.classList.contains('nav-item')).map(n=>n.dataset.nav),['home','journal','medications','timeline','more']);
  assert.equal(nodes.filter(n=>Object.hasOwn(n.dataset,'journalPanel')).length,2,'Journal contains Entries and Trends only');
  for(const route of Object.keys(expectedRoutes)){
    const input=route==='more/menu'?'more':route;
    click(input);
    assert.equal(active(),route.split('/')[0]);
    for(const group of ['journal','timeline','more']){
      const key=group+'Panel';const panels=nodes.filter(n=>Object.hasOwn(n.dataset,key));
      assert.equal(panels.filter(n=>!n.hidden).length,1,group+' has exactly one selected subsection');
      if(route.startsWith(group+'/'))assert.equal(panels.find(n=>!n.hidden).dataset[key],route.split('/')[1]);
    }
    assert.equal(nodes.filter(n=>n.attrs['aria-current']==='page').length,1);
    assert.equal(nodes.find(n=>n.attrs['aria-current']==='page').dataset.nav,['costs','snapshot'].includes(route)?'more':route.split('/')[0]);
  }
  click('journal');assert.equal(location.hash,'#journal/entries');
  click('journal/trends');click('timeline');history.back();assert.equal(location.hash,'#journal/trends');assert.equal(active(),'journal');history.forward();assert.equal(active(),'timeline');
  const count=history.length;click('timeline');click('timeline');assert.equal(history.length,count);
  vm.runInContext("navigate('unknown/route')",ctx);assert.equal(active(),'home');
  const normalization=vm.runInContext("JSON.stringify(['journal','journal/nope','journal/medications','timeline','more','snapshot','__proto__'].map(normalizeRoute))",ctx);
  assert.deepEqual(JSON.parse(normalization),['journal/entries','journal/entries','medications','timeline/history','more/menu','snapshot','home']);
  ctx.fixture=structuredClone(fixture);vm.runInContext('state=fixture;',ctx);
  const original=JSON.stringify(ctx.fixture);
  for(const route of Object.keys(expectedRoutes))vm.runInContext(`navigate(${JSON.stringify(route)})`,ctx);
  vm.runInContext('renderUpcomingCare(); renderTimeline();',ctx);
  assert.match(document.querySelector('#homeNextVisit').innerHTML,/Today planned visit/);
  const upcoming=document.querySelector('#timelineUpcoming').innerHTML;
  assert.match(upcoming,/Today planned visit[\s\S]*Later planned visit/);
  assert(!/planned visit/.test(document.querySelector('#timelineEntries').innerHTML));
  assert.match(document.querySelector('#timelineEntries').innerHTML,/Oct 13/);
  vm.runInContext("timelineFilter='owner';renderTimeline()",ctx);assert(document.querySelector('#timelineUpcoming').hidden);
  assert.equal(JSON.stringify(ctx.fixture),original,'Navigation and timeline/plan rendering preserve record exactly');
  console.log('VM: 16 routes, defaults, fallback, history, repeated clicks, selected panels, chronological recorded/appointment separation, and immutable navigation passed');
}
module.exports={fixture,expectedRoutes};
if(require.main===module)(async()=>{
  console.log('STATIC:', staticChecks());
  vmChecks();
  if(!process.argv.includes('--browser'))return;
  const { chromium } = require('playwright');
  const server=http.createServer((req,res)=>{
    const relative=new URL(req.url,'http://test').pathname;
    if(relative==='/data/seed.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(fixture));return;}
    const file=path.join(root,relative==='/'?'index.html':relative);
    if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    try{const mime={'.js':'application/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};res.setHeader('Content-Type',mime[path.extname(file)]||'text/plain');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  let browser, currentPage, currentViewport;
  try{
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
    for(const viewport of [{width:1280,height:900},{width:390,height:844},{width:320,height:700}]){
      const context=await browser.newContext({viewport,serviceWorkers:'block',timezoneId:'UTC'});
      const page=await context.newPage();currentPage=page;currentViewport=viewport;
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
      await page.clock.install({time:new Date('2026-10-15T12:00:00Z')});
      await page.goto(origin,{waitUntil:'networkidle'});
      await page.waitForFunction(()=>document.querySelector('#journalEntries').children.length>0);
      assert.deepEqual(errors,[], 'No boot errors');
      const snapshot=()=>page.evaluate(()=>({state:JSON.stringify(state),storage:JSON.stringify({...localStorage})}));
      const initial=await snapshot();
      const go=async route=>{
        const group=route.split('/')[0];
        if(['snapshot','costs'].includes(group)){
          await page.locator('.bottom-nav [data-nav="more"]').click();
          await page.locator(`#more-panel-menu [data-nav="${group}"]`).click();
        }else{
          await page.locator(`.bottom-nav [data-nav="${group}"]`).click();
          if(route.includes('/')&&!['journal/entries','timeline/history','more/menu'].includes(route))await page.locator(`[data-nav="${route}"]:visible`).first().click();
        }
        assert.equal(await page.evaluate(()=>normalizeRoute(location.hash)),route);
      };
      const checkRoute=async route=>{
        await go(route);
        assert.equal(await page.locator('.view.active').count(),1);
        for(const id of expectedRoutes[route])assert(await page.locator(id).isVisible(), `${viewport.width} ${route}: ${id} accessible`);
        assert.equal(await page.locator('.nav-item[aria-current="page"]').count(),1);
        assert.equal(await page.locator('.nav-item[aria-current="page"]').getAttribute('data-nav'),['costs','snapshot'].includes(route)?'more':route.split('/')[0]);
        const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
        assert(!overflow, `${viewport.width} ${route}: no whole-page horizontal overflow`);
        if(process.env.QA_SCREENSHOT_DIR&&['home','journal/entries','medications','costs','more/menu','timeline/chart','snapshot'].includes(route)){
          fs.mkdirSync(process.env.QA_SCREENSHOT_DIR,{recursive:true});
          await page.screenshot({path:path.join(process.env.QA_SCREENSHOT_DIR,`${viewport.width}-${route.replace('/','-')}.png`),fullPage:true});
        }
      };
      assert.deepEqual(await page.locator('.bottom-nav [data-nav]').evaluateAll(nodes=>nodes.map(node=>node.dataset.nav)),['home','journal','medications','timeline','more']);
      for(const route of Object.keys(expectedRoutes))await checkRoute(route);
      await go('medications');
      assert.equal(await page.locator('#medicationSummary .medication-overview').count(),0,'Cost overview does not crowd medication history');
      const totals=page.locator('#medicationSummary .medication-use-totals');
      assert.equal(await totals.getAttribute('open'),null,'Medication totals are collapsed by default');
      assert(!(await totals.locator('.medication-ledger').isVisible()),'Collapsed totals keep history prominent');
      await totals.locator('summary').click();
      assert(await totals.locator('.medication-ledger').isVisible(),'Medication use totals expand');
      assert.match(await totals.textContent(),/Prednisone[\s\S]*tablet equivalents, owner-reported[\s\S]*Cerenia/,'Full medication ledger retained');
      assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1)),'Expanded medication totals fit the page');
      await totals.locator('summary').click();
      assert(await page.locator('#medicationHistory').isVisible(),'Dose history stays accessible');
      await go('costs');
      assert(await page.locator('#medicationCostBreakdown .medication-overview').isVisible(),'Medication cost overview remains accessible under Costs');
      assert.match(await page.locator('#medicationCostBreakdown').textContent(),/Cerenia across Roger’s care[\s\S]*Average purchase cost/,'Cost context retained');
      await page.evaluate(()=>{location.hash='#journal/medications';});
      await page.waitForFunction(()=>document.querySelector('.view.active')?.dataset.view==='medications');
      assert(await page.locator('#medicationAddButton').isVisible(),'Legacy medication deep link still works');
      await go('journal/entries');
      assert.equal(await page.locator('#journalEntries .observation-card').count(),7,'Latest 7 daily entries on default journal');
      assert(await page.locator('#journalEntries').evaluate(el=>el.getBoundingClientRect().top<400),'Daily entries at top');
      await page.locator('#journalHistoryToggle').click();
      assert.equal(await page.locator('#journalEntries .observation-card').count(),12);
      await page.locator('#journalHistoryToggle').click();
      await go('journal/trends');
      await page.locator('.bottom-nav [data-nav="timeline"]').click();
      await page.goBack();
      assert.equal(await page.evaluate(()=>location.hash),'#journal/trends','Back restores subsection');
      assert(await page.locator('#journal-panel-trends').isVisible());
      await page.goForward();
      assert(await page.locator('#timeline-panel-history').isVisible(),'Forward restores destination');
      const length=await page.evaluate(()=>history.length);
      for(let i=0;i<3;i++)await page.locator('.bottom-nav [data-nav="timeline"]').click();
      assert.equal(await page.evaluate(()=>history.length),length,'Repeated click no duplicate history');
      assert.match(await page.locator('#homeNextVisit').textContent(),/Today planned visit/);
      assert.match(await page.locator('#timelineUpcoming').textContent(),/Today planned visit[\s\S]*Later planned visit/);
      assert(!/planned visit/.test(await page.locator('#timelineEntries').textContent()),'Plans never become recorded history');
      assert.match(await page.locator('#timelineEntries .timeline-date').first().textContent(),/Oct 13/,'Recorded newest first');
      await page.locator('[data-timeline-filter="owner"]').click();
      assert(!(await page.locator('#timelineUpcoming').isVisible()),'Owner filter hides upcoming');
      await page.locator('[data-timeline-filter="all"]').click();
      await go('timeline/chart');
      const band=await page.locator('[data-kind="course"] line[stroke="#512888"]').evaluateAll(lines=>lines.map(e=>({x1:Number(e.getAttribute('x1')),x2:Number(e.getAttribute('x2')),width:Number(e.getAttribute('stroke-width'))})));
      assert.equal(band.length,2,'Both prednisone course bands retained');
      assert(Math.abs(band[0].x2-band[1].x1)<0.01,'Adjacent prednisone courses form continuous purple band');
      assert(band[0].width>band[1].width,'Dose thickness retained');
      assert.equal((await page.locator('#treatmentWindowDetails').textContent()).trim(),'','All-cycle view has no selected-cycle details');
      await page.locator('#treatmentWindowSelector [data-treatment-window="1"]').click();
      assert(await page.locator('#treatmentWindowDetails').isVisible(),'Selecting a treatment exposes cycle details');
      assert.match(await page.locator('#treatmentWindowDetails').textContent(),/Synthetic reason/,'Selected-cycle source detail retained');
      assert.match(await page.locator('#treatmentWindowDetails').textContent(),/MEDICATION USE/,'Selected-cycle medication history retained');
      await page.locator('#treatmentOverlayChart [data-kind="treatment"]').first().click();
      assert.match(await page.locator('#treatmentOverlayDetail').textContent(),/Chemo #1[\s\S]*Synthetic reason/,'Treatment marker exposes recorded dose context');
      const course=page.locator('#treatmentOverlayChart [data-kind="course"]').first();
      const courseLine=course.locator('line[stroke="#512888"]');
      // SVG horizontal strokes have a zero-height geometry box. Use a real
      // pointer at the visible stroke rather than forcing Playwright's group click.
      await courseLine.evaluate(line=>line.scrollIntoView({block:'center',inline:'center',behavior:'auto'}));
      await courseLine.evaluate(line=>window.scrollBy(0,line.getBoundingClientRect().top-window.innerHeight*0.4));
      const point=await courseLine.evaluate(line=>{
        const rect=line.getBoundingClientRect(),x=(rect.left+rect.right)/2,y=rect.top;
        const hit=document.elementFromPoint(x,y),nav=document.querySelector('.bottom-nav').getBoundingClientRect();
        return {x,y,width:window.innerWidth,height:window.innerHeight,navTop:nav.top,hitCourse:Boolean(hit&&line.parentElement.contains(hit))};
      });
      assert(point.x>0&&point.x<point.width&&point.y>0&&point.y<point.height,'Course stroke midpoint is in the viewport');
      assert(point.y<point.navTop-16,'Fixed navigation does not cover the course stroke');
      assert(point.hitCourse,'Real hit-testing reaches the course stroke');
      await page.mouse.click(point.x,point.y);
      assert.match(await page.locator('#treatmentOverlayDetail').textContent(),/Prednisone[\s\S]*Synthetic confirmation/,'Course pointer click exposes owner-confirmed regimen and source');
      await course.focus();
      assert(await course.evaluate(node=>document.activeElement===node),'Course marker receives keyboard focus');
      await page.keyboard.press('Enter');
      assert.match(await page.locator('#treatmentOverlayDetail').textContent(),/Prednisone[\s\S]*Synthetic confirmation/,'Course keyboard activation preserves source detail');
      await page.locator('#treatmentWindowSelector [data-treatment-window="all"]').click();
      assert.equal((await page.locator('#treatmentWindowDetails').textContent()).trim(),'','Returning to All clears selected-cycle detail');
      await go('more/profile');
      assert.match(await page.locator('#profileDetails').textContent(),/TEST-KSU[\s\S]*TEST-OPT/);
      await go('more/backup');
      assert.equal(await page.locator('#importBackup').count(),1);
      await page.locator('#sharedControls summary').click();
      assert(await page.locator('#ownerLogin').isVisible(),'Existing login controls accessible; not submitted');
      assert(await page.locator('#ownerLinkPaste').isVisible());
      await go('snapshot');
      for(const mode of ['treatment','visit','7days','custom']){
        await page.locator(`[data-snapshot-range="${mode}"]`).click();
        assert((await page.locator('#careSnapshotPreview').textContent()).length>100);
      }
      await page.locator('#careSnapshotFrom').fill('2026-10-04');await page.locator('#careSnapshotTo').fill('2026-10-08');
      await page.locator('#careSnapshotTo').blur();
      assert.match(await page.locator('#careSnapshotPreview').textContent(),/Oct 4, 2026.*Oct 8, 2026/);
      const expectedNotes=await page.evaluate(()=>careSnapshotData().recentOwnerNotes.map(note=>note.text));
      assert.equal(expectedNotes.length,3,'Three most recent distinct notes in range');
      assert.deepEqual(await page.locator('#careSnapshotPreview .care-snapshot-owner-note-text').allTextContents(),expectedNotes,'Recent note text is verbatim');
      for(let i=0;i<3;i++)await page.locator('#careSnapshotPreview .care-snapshot-owner-note summary').nth(i).click();
      assert(await page.locator('#careSnapshotPreview .care-snapshot-owner-note-text').first().isVisible(),'Full note expands');
      assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1)),'Expanded notes do not overflow the page');
      await page.locator('#careSnapshotPreview [data-nav="journal"]').click();
      assert(await page.locator('#journal-panel-entries').isVisible(),'Recent notes link directly to Journal');
      await go('snapshot');
      const exports=await page.evaluate(()=>({pdf:buildCareSummaryPdf().slice(0,8),html:buildCareSummaryHtml().includes('Synthetic Test Pet')}));
      assert.equal(exports.pdf,'%PDF-1.4');assert(exports.html);
      // View-only assertions never request a sign-in or submit an edit.
      await page.evaluate(()=>{ownerCanEdit=false;renderSharedStatus();});
      for(const id of ['openJournalComposer','homeMedicationButton','journalAddButton','medicationAddButton','costAddButton','profilePhotoButton'])assert(await page.locator('#'+id).isDisabled(),id+' disabled for viewer');
      for(const id of ['carePlanForm','careTeamForm','questionForm','wellbeingForm'])assert(await page.locator('#'+id+' button[type="submit"]').isDisabled(),id+' disabled for viewer');
      // Owner editor entry points are exercised only with synthetic in-memory
      // capability; nothing is saved and every request outside localhost is blocked.
      await page.evaluate(()=>{ownerCanEdit=true;renderSharedStatus();});
      for(const [route,button,dialog] of [['home','#openJournalComposer','journalDialog'],['home','#homeMedicationButton','medicationDialog'],['journal/entries','#journalAddButton','journalDialog'],['medications','#medicationAddButton','medicationDialog'],['costs','#costAddButton','costDialog']]){
        await go(route);await page.locator(button).click();assert(await page.locator('#'+dialog).isVisible());
        const captureMedication=route==='medications'&&dialog==='medicationDialog';
        if(captureMedication){
          await page.locator('#medicationDialog .sheet-head').scrollIntoViewIfNeeded();
          assert(await page.locator('#medicationDialog .sheet-head').evaluate(node=>{
            const rect=node.getBoundingClientRect(),sheet=node.closest('dialog').getBoundingClientRect();
            return rect.top>=sheet.top&&rect.bottom<=Math.min(sheet.bottom,innerHeight);
          }),'Medication editor header can be scrolled fully into view');
          assert(await page.locator('#medicationDate').evaluate(node=>{
            const rect=node.getBoundingClientRect(),sheet=node.closest('dialog').getBoundingClientRect();
            return rect.top>=sheet.top&&rect.bottom<=Math.min(sheet.bottom,innerHeight);
          }),'Medication date is readable at the top of the editor');
          if(process.env.QA_SCREENSHOT_DIR){
            fs.mkdirSync(process.env.QA_SCREENSHOT_DIR,{recursive:true});
            await page.screenshot({path:path.join(process.env.QA_SCREENSHOT_DIR,`${viewport.width}-medication-editor-top.png`),fullPage:false});
          }
        }
        const draftField=dialog==='journalDialog'?'textarea[name=notes]':dialog==='medicationDialog'?'textarea[name=reason]':'input[name=label]';
        await page.locator(`#${dialog} ${draftField}`).fill('Unsaved synthetic draft, cancel this');
        if(captureMedication){
          await page.locator('#medicationDialog .sheet-actions').scrollIntoViewIfNeeded();
          assert(await page.locator('#medicationDialog .sheet-actions').evaluate(node=>{
            const rect=node.getBoundingClientRect(),sheet=node.closest('dialog').getBoundingClientRect();
            return rect.top>=sheet.top&&rect.bottom<=Math.min(sheet.bottom,innerHeight);
          }),'Medication Cancel and Save actions can be scrolled fully into view');
        }
        if(process.env.QA_SCREENSHOT_DIR&&captureMedication){
          fs.mkdirSync(process.env.QA_SCREENSHOT_DIR,{recursive:true});
          await page.screenshot({path:path.join(process.env.QA_SCREENSHOT_DIR,`${viewport.width}-medication-editor.png`),fullPage:false});
        }
        await page.locator(`#${dialog} [data-close-dialog="${dialog}"]`).last().click();
        assert(!(await page.locator('#'+dialog).isVisible()));
        assert.equal(await page.evaluate(()=>normalizeRoute(location.hash)),route,'Cancel keeps current route');
      }
      await go('journal/entries');await page.locator('[data-edit-observation]').first().click();
      await page.locator('#journalDialog [data-close-dialog]').first().click();
      await go('home');await go('journal/entries');await page.locator('#journalAddButton').click();
      await page.locator('#journalDialog textarea[name=notes]').fill('Unsaved draft interrupted by Back');
      await page.goBack();assert.equal(await page.evaluate(()=>location.hash),'#home');
      assert(!(await page.locator('#journalDialog').isVisible()),'Back closes interrupted editor');
      await page.goForward();assert(await page.locator('#journal-panel-entries').isVisible());
      assert(!(await page.locator('#journalDialog').isVisible()),'Forward does not resurrect editor');
      assert.deepEqual(await snapshot(),initial,'Navigation, range changes and editor cancellations do not mutate clinical data or localStorage');
      assert.deepEqual(errors,[], 'No browser runtime errors');
      console.log(`PASS ${viewport.width}x${viewport.height}: ${Object.keys(expectedRoutes).length} destinations, history/repeated clicks, journal-first, controls, exports, edit/cancel, continuous prednisone band, no record mutations`);
      await context.close();
    }
  }catch(error){
    if(process.env.QA_SCREENSHOT_DIR&&currentPage&&!currentPage.isClosed()){
      fs.mkdirSync(process.env.QA_SCREENSHOT_DIR,{recursive:true});
      const capture=path.join(process.env.QA_SCREENSHOT_DIR,`failure-${currentViewport?.width||'unknown'}.png`);
      try{await currentPage.screenshot({path:capture,fullPage:true});console.error('Failure screenshot:',capture);}catch(captureError){console.error('Screenshot unavailable:',captureError.message);}
    }
    throw error;
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
