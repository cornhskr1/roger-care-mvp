#!/usr/bin/env node
'use strict';
// Isolated browser regression coverage. All records, accounts, and links are
// synthetic, cloud/auth methods are in-memory stubs, and external requests are
// blocked. No live records, saved browser profile, or owner credentials used.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const fixture={
  schemaVersion:16,
  profile:{name:'Synthetic pet',fullName:'Synthetic test pet',patientIds:{},breed:'Test',sex:'Male',reproductiveStatus:'Neutered',dob:'2020-01-01',diagnosis:'Synthetic',currentStatus:'Synthetic'},
  carePlan:{visits:[{id:'test-visit',label:'Synthetic visit',date:'2026-10-20',source:'Synthetic'}],careTeam:[],questions:[],vetCallInstructions:'',vetCallSource:''},
  sourceNotes:[],treatments:[{id:'test-treatment',number:1,date:'2026-10-02',drug:'Vinblastine',doseMg:2,doseMgM2:1.2,weightLb:50,source:'Synthetic'}],labs:[{id:'test-neutrophils',date:'2026-10-09',metric:'Neutrophils',value:5,unit:'K/uL',source:'Synthetic'},{id:'test-hematocrit',date:'2026-10-09',metric:'Hematocrit',value:40,unit:'%',source:'Synthetic'}],observations:[],costs:[{id:'test-cost',date:'2026-10-02',amountPaid:50,category:'treatment',status:'confirmed',source:'Synthetic'}],milestones:[],medications:[],medicationCourses:[],medicationAdministrations:[],medicationPurchases:[]
};

(async()=>{
  const server=http.createServer((req,res)=>{
    const relative=new URL(req.url,'http://fixture.invalid').pathname;
    if(relative==='/data/seed.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(fixture));return;}
    const file=path.join(root,relative==='/'?'index.html':relative);
    if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    try{res.setHeader('Content-Type',({'.js':'application/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'})[path.extname(file)]||'text/plain');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  let browser;
  try{
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
    for(const viewport of [{width:1280,height:900},{width:390,height:844},{width:320,height:700}]){
      const context=await browser.newContext({viewport,serviceWorkers:'block',timezoneId:'UTC'});
      await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
      await context.addInitScript(record=>{
        const test=window.__signinTest={reads:0,viewerReads:0,metadataReads:0,emails:0,verifications:0,signOuts:0,writes:0,canEdit:false,session:null,callback:null,pauseEmail:false,emailError:null,verifyError:true};
        window.supabase={createClient:()=>({
          auth:{
            getSession:async()=>({data:{session:test.session}}),
            onAuthStateChange:callback=>{test.callback=callback;return {data:{subscription:{unsubscribe(){}}}};},
            signInWithOtp:async()=>{test.emails++;if(test.pauseEmail)await new Promise(resolve=>{test.finishEmail=resolve;});return {error:test.emailError};},
            verifyOtp:async()=>{test.verifications++;if(test.verifyError)return {error:{message:'Synthetic expired link'}};test.canEdit=true;test.session={user:{id:'synthetic-owner'}};test.callback('SIGNED_IN',test.session);return {error:null};},
            signOut:async()=>{test.signOuts++;test.session=null;test.canEdit=false;test.callback('SIGNED_OUT',null);return {error:null};}
          },
          rpc:async name=>{if(name==='roger_can_edit')return {data:test.canEdit,error:null};test.writes++;throw new Error('Unexpected write in synthetic sign-in test');},
          from:()=>({select(columns){this.columns=columns;return this;},eq(){return this;},async single(){test.reads++;if(this.columns.startsWith('record,'))test.viewerReads++;else test.metadataReads++;return {data:{record:structuredClone(record),revision:test.reads,updated_at:'2026-10-17T12:00:00Z'},error:null};}})
        })};
      },fixture);
      const page=await context.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.clock.install({time:new Date('2026-10-17T12:00:00Z')});
      await page.goto(origin,{waitUntil:'networkidle'});
      await page.waitForFunction(()=>typeof state!=='undefined'&&cloudRevision>0&&!!document.querySelector('#ownerLogin'));
      await page.evaluate(()=>navigate('more/backup'));
      const disclosure=page.locator('#sharedControls details'),email=page.locator('#ownerLogin input'),link=page.locator('#ownerLinkPaste input');
      const open=()=>disclosure.evaluate(node=>node.open);
      await disclosure.locator('summary').click();
      await page.evaluate(()=>{window.__originalDetails=document.querySelector('#sharedControls details');window.__originalLink=document.querySelector('#ownerLinkPaste input');});
      // The reported reset happens even with an empty form. Cover actual focus
      // refresh, a full periodic poll, and multiple redundant auth callbacks.
      let reads=await page.evaluate(()=>__signinTest.reads);
      await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
      await page.waitForFunction(previous=>__signinTest.reads>previous&&!cloudBusy,reads);
      assert(await open(),'Empty disclosure survives focus refresh');
      reads=await page.evaluate(()=>__signinTest.reads);
      await page.clock.runFor(30001);
      await page.waitForFunction(previous=>__signinTest.reads>previous&&!cloudBusy,reads);
      assert(await open(),'Empty disclosure survives 30-second poll');
      await email.fill('owner@example.test');
      const draft='synthetic unused link draft';
      await link.fill(draft);await link.focus();
      await link.evaluate(node=>node.setSelectionRange(3,14,'backward'));
      for(let i=0;i<3;i++){
        reads=await page.evaluate(()=>__signinTest.reads);
        await page.evaluate(()=>__signinTest.callback('INITIAL_SESSION',null));
        await page.clock.runFor(1);
        await page.waitForFunction(previous=>__signinTest.reads>previous&&!cloudBusy,reads);
      }
      await page.evaluate(async()=>{await readCloudViewer();renderAll();renderSharedStatus();});
      assert.deepEqual(await link.evaluate(node=>({same:node===__originalLink,focused:node===document.activeElement,value:node.value,start:node.selectionStart,end:node.selectionEnd,direction:node.selectionDirection})),{same:true,focused:true,value:draft,start:3,end:14,direction:'backward'},'Draft, element identity, focus and selection survive repeated background renders');
      assert.equal(await email.inputValue(),'owner@example.test');assert(await open());
      assert(await disclosure.evaluate(node=>node===__originalDetails),'Disclosure is not recreated');
      // Pending-local viewer status changes the summary, not the sign-in form.
      await page.evaluate(()=>{unpublishedLocal=true;renderSharedStatus();});
      assert.match(await page.locator('#sharedControls .sync-summary').innerText(),/Owner sign-in needed/);
      assert.equal(await link.inputValue(),draft);assert(await open());
      await page.evaluate(()=>{unpublishedLocal=false;renderSharedStatus();});
      assert.match(await page.locator('#sharedControls .sync-summary').innerText(),/View-only/);
      // Deliberate collapse stays collapsed, and reopening does not lose input.
      await disclosure.locator('summary').click();assert(!(await open()));
      await page.evaluate(()=>renderAll());assert(!(await open()));
      await disclosure.locator('summary').click();assert.equal(await link.inputValue(),draft);
      await page.evaluate(()=>navigate('journal/entries'));
      await page.goBack();await page.waitForFunction(()=>location.hash==='#more/backup');
      assert(await open());assert.equal(await link.inputValue(),draft);
      await page.goForward();await page.waitForFunction(()=>location.hash==='#journal/entries');
      await page.goBack();await page.waitForFunction(()=>location.hash==='#more/backup');
      assert.equal(await link.inputValue(),draft);
      // Retained nodes must not collect duplicate submit handlers. A delayed
      // request and rate-limit failure leave the email and disclosure intact.
      await page.evaluate(()=>{for(let i=0;i<8;i++)renderSharedStatus();__signinTest.pauseEmail=true;__signinTest.emailError={status:429};});
      await page.locator('#ownerLogin button').click();
      assert.equal(await page.evaluate(()=>__signinTest.emails),1);
      await page.evaluate(()=>renderAll());assert(await open());assert.equal(await email.inputValue(),'owner@example.test');
      await page.evaluate(()=>__signinTest.finishEmail());
      await page.waitForFunction(()=>document.querySelector('#toastRegion').textContent.includes('Email limit reached'));
      assert.equal(await page.evaluate(()=>__signinTest.emails),1);
      // A syntactically valid synthetic token is generated only in memory. The
      // mock never sends it to Supabase, and assertions never print its value.
      await page.evaluate(()=>{document.querySelector('#ownerLinkPaste input').value=SUPABASE_URL+'/auth/v1/verify?token_hash='+('synthetic_'.repeat(5))+'&type=email';});
      await page.locator('#ownerLinkPaste button').click();
      await page.waitForFunction(()=>__signinTest.verifications===1);
      assert.equal(await link.inputValue(),'','Submitted link is cleared, including rejected/expired links');
      assert(await open(),'Rejected sign-in stays open for a fresh attempt');
      await page.evaluate(()=>renderAll());assert.equal(await link.inputValue(),'');
      assert.equal(await page.evaluate(()=>__signinTest.verifications),1,'No duplicate verification listeners');
      const persisted=await page.evaluate(()=>({storage:JSON.stringify({...localStorage,...sessionStorage}),record:JSON.stringify(state),html:document.querySelector('#sharedControls').innerHTML}));
      for(const value of Object.values(persisted)){
        assert(!value.includes('owner@example.test'),'Email is not copied into persisted state or markup');
        assert(!value.includes('synthetic_'.repeat(5)),'Pasted token is not copied into persisted state or markup');
        assert(!value.includes(draft),'Draft link is not copied into persisted state or markup');
      }
      // Successful sign-in swaps to owner controls. The owner never reads the
      // shared record over its master or publishes absent a pending local edit.
      const beforeSuccessViewerReads=await page.evaluate(()=>__signinTest.viewerReads);
      await page.evaluate(()=>{__signinTest.verifyError=false;document.querySelector('#ownerLinkPaste input').value=SUPABASE_URL+'/auth/v1/verify?token_hash='+('synthetic_'.repeat(5))+'&type=email';});
      await page.locator('#ownerLinkPaste button').click();
      await page.clock.runFor(1);
      await page.waitForFunction(()=>ownerCanEdit&&!!document.querySelector('#signOutOwner'));
      assert.equal(await page.locator('#ownerLogin').count(),0);assert.equal(await page.locator('#ownerLinkPaste').count(),0);
      assert.equal(await page.evaluate(()=>__signinTest.verifications),2);
      assert.equal(await page.evaluate(()=>__signinTest.writes),0);
      assert.equal(await page.evaluate(()=>__signinTest.viewerReads),beforeSuccessViewerReads,'Sign-in does not pull the shared record over the owner master');
      await disclosure.locator('summary').click();
      await page.evaluate(()=>{for(let i=0;i<8;i++)renderSharedStatus();});
      assert(await open(),'Owner disclosure stays open across refreshes');
      // Sync now remains single-bound even on retained owner buttons.
      reads=await page.evaluate(()=>__signinTest.reads);
      await page.locator('#sharedControls [data-check-cloud]').click();
      await page.waitForFunction(previous=>__signinTest.reads>previous,reads);
      assert.equal(await page.evaluate(()=>__signinTest.reads),reads+1);
      await page.locator('#signOutOwner').click();await page.clock.runFor(1);
      await page.waitForFunction(()=>!ownerCanEdit&&!!document.querySelector('#ownerLogin'));
      assert.equal(await page.evaluate(()=>__signinTest.signOuts),1);
      assert(!(await open()),'Actual owner/viewer transition resets disclosure');
      assert.equal(await email.inputValue(),'','Old email does not return after sign-out');
      assert.equal(await link.inputValue(),'','Old link does not return after sign-out');
      assert.equal(await page.evaluate(()=>__signinTest.writes),0,'No synthetic flow writes a record');
      assert.deepEqual(errors,[],'No browser runtime errors');
      console.log(`PASS ${viewport.width}x${viewport.height}: empty/draft sign-in, focus and polling, repeated auth callbacks, selection, collapse, Back/Forward, pending-local status, delayed/rate-limited email, rejected/repeated/successful link, sign-out, single-bound handlers, no secret persistence`);
      await context.close();
    }
  }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
