#!/usr/bin/env node
'use strict';
// Dependency-free DOM-identity model. This proves render lifecycle behavior,
// not browser layout or native focus behavior (covered by test-owner-signin).
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const current=fs.readFileSync(path.join(root,'app.js'),'utf8');
function statusFunction(source){
  const start=source.indexOf('function renderSharedStatus(){');
  const end=source.indexOf('\n// Navigation is URL/UI state only.',start);
  assert(start>=0&&end>start,'Status renderer boundaries exist');
  return source.slice(start,end);
}
function harness(source){
  const nodes=new Map(),calls={emails:0,verify:0,sync:0,signOut:0};
  const makeNode=()=>({dataset:{},innerHTML:'',className:'',value:'',disabled:false,listeners:{},addEventListener(type,handler){(this.listeners[type]??=[]).push(handler);}});
  const status=makeNode(),controls=makeNode();let html='',mounts=0,summary,details;
  Object.defineProperty(controls,'innerHTML',{get:()=>html,set:value=>{
    html=value;mounts++;summary=makeNode();details={open:false};
    for(const selector of ['#ownerLogin','#ownerLinkPaste','#signOutOwner','#syncButton'])nodes.delete(selector);
    if(value.includes('id="ownerLogin"')){
      const login=makeNode(),paste=makeNode();
      login.elements={email:{value:''}};paste.elements={link:{value:''}};
      nodes.set('#ownerLogin',login);nodes.set('#ownerLinkPaste',paste);
    }else{nodes.set('#signOutOwner',makeNode());nodes.set('#syncButton',makeNode());}
  }});
  controls.querySelector=selector=>selector==='.sync-summary'?summary:null;
  nodes.set('#sharedStatus',status);nodes.set('#sharedControls',controls);
  const context=vm.createContext({
    Date,Boolean,Number,String,console,
    q:selector=>nodes.get(selector)||null,
    qa:selector=>selector==='[data-check-cloud]'?(nodes.has('#syncButton')?[nodes.get('#syncButton')]:[]):[],
    esc:value=>String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])),
    state:{profile:{name:'Synthetic'}},ownerCanEdit:false,unpublishedLocal:false,cloudAvailable:true,cloudRevision:1,cloudUpdatedAt:null,cloudBusy:false,
    SITE_URL:'https://synthetic.invalid/',ownerSession:null,
    cloud:{auth:{signInWithOtp:async()=>{calls.emails++;return {error:null};},verifyOtp:async()=>{calls.verify++;return {error:{message:'Synthetic rejected link'}};},signOut:async()=>{calls.signOut++;}}},
    toast(){},parseOwnerSignInLink:()=>({token_hash:'synthetic',type:'email'}),
    readCloudMetadata:async()=>{calls.sync++;return true;},readCloudViewer:async()=>true,
    renderAll(){},checkOwner:async()=>{},initializeCloudMode:async()=>{},
  });
  vm.runInContext(statusFunction(source),context);
  return {nodes,calls,context,render:()=>vm.runInContext('renderSharedStatus()',context),get details(){return details;},get summary(){return summary;},get mounts(){return mounts;},
    async dispatch(node,type){const event={currentTarget:node,preventDefault(){}};if(node['on'+type])await node['on'+type](event);for(const handler of node.listeners[type]||[])await handler(event);}};
}
function retainDraft(h){
  h.render();const login=h.nodes.get('#ownerLogin'),paste=h.nodes.get('#ownerLinkPaste'),details=h.details;
  login.elements.email.value='owner@example.test';paste.elements.link.value='synthetic draft';details.open=true;
  for(let i=0;i<12;i++)h.render();
  assert.equal(h.nodes.get('#ownerLogin'),login,'Email form retained');
  assert.equal(h.nodes.get('#ownerLinkPaste'),paste,'Link form retained');
  assert.equal(h.details,details,'Disclosure retained');assert(details.open);assert.equal(h.mounts,1);
  assert.equal(login.elements.email.value,'owner@example.test');assert.equal(paste.elements.link.value,'synthetic draft');
  return {login,paste,details};
}
(async()=>{
  // Fixed pre-fix commit, not a moving main ref, keeps the negative control valid.
  const original=execFileSync('git',['show','ec71fc0f33aa42ddd3a548ae977cd0d5c1c44466:app.js'],{cwd:root,encoding:'utf8'});
  assert.throws(()=>retainDraft(harness(original)),/Email form retained/,'Original renderer reproduces the form reset');
  const h=harness(current),{login,paste,details}=retainDraft(h);
  h.context.unpublishedLocal=true;h.render();assert.match(h.summary.innerHTML,/Owner sign-in needed/);assert.equal(h.nodes.get('#ownerLogin'),login);
  h.context.unpublishedLocal=false;h.render();assert.match(h.summary.innerHTML,/View-only/);
  details.open=false;h.render();assert.equal(h.details.open,false,'Deliberate collapse is retained');
  await h.dispatch(login,'submit');assert.equal(h.calls.emails,1,'Repeated renders send one email per submit');
  await h.dispatch(paste,'submit');assert.equal(h.calls.verify,1,'Repeated renders verify once');assert.equal(paste.elements.link.value,'','Link cleared on rejected submission');
  h.context.ownerCanEdit=true;h.render();assert.equal(h.mounts,2);assert(!h.nodes.has('#ownerLogin'));assert(!h.nodes.has('#ownerLinkPaste'));assert(!h.details.open);
  h.details.open=true;const signOut=h.nodes.get('#signOutOwner');for(let i=0;i<12;i++)h.render();assert.equal(h.nodes.get('#signOutOwner'),signOut);assert(h.details.open);
  await h.dispatch(h.nodes.get('#syncButton'),'click');assert.equal(h.calls.sync,1,'One metadata read per owner sync click');
  await h.dispatch(signOut,'click');assert.equal(h.calls.signOut,1,'One sign-out per click');
  h.context.ownerCanEdit=false;h.render();assert.equal(h.mounts,3);assert.equal(h.nodes.get('#ownerLogin').elements.email.value,'');assert.equal(h.nodes.get('#ownerLinkPaste').elements.link.value,'');
  console.log('PASS original-reset negative control; retained form/disclosure drafts; pending-local status; deliberate collapse; single-bound auth/sync handlers; submitted-link clearing; mode-transition clearing');
})().catch(error=>{console.error(error);process.exitCode=1;});
