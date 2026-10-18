#!/usr/bin/env node
'use strict';
// Complete-report regression coverage uses invented records only. The optional
// browser suite runs on an ephemeral localhost origin and blocks every other
// origin. It never reads the production seed, credentials, or live care data.
// Run: node scripts/test-complete-report.cjs [--browser] [--webkit]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const os = require('node:os');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const GENERATED_AT = '2026-10-17T12:34:56.000Z';
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [GENERATED_AT])); }
  static now() { return Date.parse(GENERATED_AT); }
}
const options = {generatedAt:GENERATED_AT, documentIndexStatus:'available', recordSavedAt:'2026-10-16T21:30:00.000Z', sharedUpdatedAt:'2026-10-16T21:31:00.000Z', unpublishedLocal:false};
const clone = value => structuredClone(value);
const json = value => JSON.stringify(value);
const escape = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const MARKUP = 'SYN-markup <img src="https://invalid.example/pixel" onerror="globalThis.SYN_EXECUTED=true"><script>globalThis.SYN_EXECUTED=true</script> & "quoted" <svg onload="globalThis.SYN_EXECUTED=true"></svg>';
const UNICODE = 'SYN-Unicode café naïve µL μg mg/m² ≥ ≤ → – “original” 🐾 中文';
const LONG_TOKEN = 'SYN-LONG-TOKEN-' + 'x'.repeat(720) + '-LAST';
const LONG_NOTE = 'SYN-LONG-RAW-FIRST\n' + Array.from({length:110}, (_, i) => `SYN-RAW-LINE-${String(i).padStart(3,'0')}: Original invented owner wording, full line retained; no clinical interpretation. ${i % 10 === 0 ? UNICODE : ''}`).join('\n') + '\nSYN-LONG-RAW-LAST';
const extra = label => ({nested:{value:`SYN-extra-${label}`,items:[`SYN-array-${label}`,{deep:`SYN-deep-${label}`,zero:0,no:false,missing:null}]}});
function fixture() {
  return {
    schemaVersion:16,_savedAt:options.recordSavedAt,journalCoverageThrough:'2026-10-15',
    profile:{name:'Synthetic pet',fullName:'SYN-full-name',breed:'SYN-breed',sex:'Female',reproductiveStatus:'Spayed',dob:'2021-03-02',patientIds:{ksu:'SYN-patient-specialty',optimum:'SYN-patient-primary'},diagnosis:'SYN-diagnosis',currentStatus:'SYN-current-status',notes:'SYN-profile-note',photoDataUrl:'SYN-OMIT-profile-photo',...extra('profile')},
    carePlan:{
      visits:[{id:'SYN-visit-scheduled',label:'SYN-scheduled-visit-label',date:'2026-10-23',time:'13:05',status:'scheduled',source:'SYN-visit-source',notes:'SYN-visit-note',...extra('scheduled-visit')},{id:'SYN-visit-cancelled',label:'SYN-cancelled-visit-label',date:'2026-10-10',status:'cancelled',source:'SYN-cancelled-source',cancellationReason:'SYN-cancelled-reason'},{id:'SYN-visit-tbd',label:'SYN-undated-visit-label',date:null,status:'planned',source:'SYN-tbd-source'}],
      questions:['open','resolved','deferred','unknown'].map((status,index)=>({id:`SYN-question-${status}`,text:`SYN-question-text-${status}`,status,createdAt:'2026-08-10T12:00:00Z',resolvedAt:index===1?'2026-09-10T12:00:00Z':null,answer:`SYN-answer-${status}`,source:{date:'2026-08-14',observationId:'SYN-observation-first',text:`SYN-question-source-${status}`},...extra(`question-${status}`)})),
      careTeam:[{id:'ksu',name:'SYN-team-name',phone:'555-0100',address:'SYN-team-address',role:'SYN-team-role',notes:'SYN-team-note',source:'SYN-team-source',...extra('team')}],
      vetCallInstructions:'SYN-vet-call-instruction',vetCallSource:'SYN-vet-call-source',...extra('care-plan')
    },
    treatments:Array.from({length:4},(_,index)=>({id:`SYN-treatment-${index}`,number:index+1,date:['2026-08-14','2026-08-28','2026-09-11','2026-10-02'][index],drug:'Vinblastine',doseMg:1.1+index/10,doseMgM2:1.01+index/10,weightLb:40+index,prednisone:`SYN-treatment-prednisone-${index}`,doseReason:`SYN-dose-reason-${index}`,clinicalSummary:`SYN-clinical-summary-${index}`,recordCheck:`SYN-record-check-${index}`,source:`SYN-treatment-source-${index}`,...extra(`treatment-${index}`)})),
    labs:[{id:'SYN-lab-lymph',date:'2026-08-12',metric:'Lymphocytes',value:1.37,displayValue:'1.37',unit:'K/µL',source:'SYN-lymph-source',context:'SYN-lymph-context',referenceRange:{low:0.5,high:4.9,notes:'SYN-lymph-reference'},...extra('lymph')},{id:'SYN-lab-alp',date:'2026-10-01',metric:'ALP',value:2000,displayValue:'>2,000',unit:'U/L',source:'SYN-alp-source',context:'SYN-alp-lower-bound',qualifier:'greater-than',...extra('alp')},{id:'SYN-lab-neut',date:'2026-10-09',metric:'Neutrophils',value:4.7,unit:'K/µL',source:'SYN-neut-source',context:'SYN-neut-context'}],
    medications:[{id:'med-prednisone',name:'Prednisone',tabletStrengthMg:5,prescribedDose:'SYN-prescription-prednisone',instructions:'SYN-prescription-instructions',source:'SYN-prescription-source',...extra('prescription')},{id:'med-cerenia',name:'Cerenia',tabletStrengthMg:24,prescribedDose:'SYN-prescription-cerenia'},{id:'med-amoxicillin',name:'Amoxicillin',prescribedDose:'SYN-prescription-unknown'}],
    medicationCourses:[{id:'SYN-course-confirmed',medicationId:'med-prednisone',startDate:'2026-08-13',endDate:'2026-08-20',confirmedThrough:'2026-08-18',dose:'10 mg',frequency:'Every 24 hours',status:'owner-confirmed daily given',source:'SYN-course-source',notes:'SYN-course-not-individual-dose-log',...extra('confirmed-course')},{id:'SYN-course-prescribed',medicationId:'med-prednisone',startDate:'2026-09-01',endDate:null,confirmedThrough:null,dose:'5 mg',frequency:'Every 24 hours',status:'prescribed; administration not confirmed',source:'SYN-prescribed-course-source',notes:'SYN-prescribed-not-given'}],
    medicationAdministrations:[{id:'SYN-dose-early-am',medicationId:'med-cerenia',date:'2026-08-15',time:'07:05',dose:'12 mg',status:'given',reason:'SYN-dose-early-am-reason',source:'SYN-dose-early-am-source',...extra('dose-am')},{id:'SYN-dose-early-pm',medicationId:'med-cerenia',date:'2026-08-15',time:'19:35',dose:'12 mg',status:'given',reason:'SYN-dose-early-pm-reason',source:'SYN-dose-early-pm-source'},{id:'SYN-dose-held',medicationId:'med-prednisone',date:'2026-08-16',time:'08:10',dose:'10 mg',status:'held',reason:'SYN-held-reason',source:'SYN-held-source'},{id:'SYN-dose-unknown',medicationId:'med-prednisone',date:'2026-08-17',time:'09:20',dose:'',status:'unknown',reason:'SYN-unknown-reason',source:'SYN-unknown-source'}],
    observations:[
      {id:'SYN-observation-first',date:'2026-08-14',time:'06:45',source:'SYN-owner-source-first',appetite:'normal',appetitePercent:0,appetiteBehaviors:['hand_fed'],energy:'low',energyBehaviors:['more_resting'],hydration:'SYN-hydration',mood:'SYN-mood',gi:'SYN-gi',sleep:'SYN-sleep',play:'SYN-play',rogerThings:'SYN-roger-things',urination:'SYN-urination',pain:'SYN-pain',nausea:0,nauseaSigns:[],nauseaNoneObserved:true,nauseaOther:'SYN-nausea-other',vomiting:0,vomitFlags:[],weightLb:39.25,medications:['SYN-journal-medication'],notes:'SYN-original-note-first. Original clinical note mentions $47; financial exclusions are not redaction.',rawEntry:LONG_NOTE,recordClarification:'SYN-record-clarification',stoolEvents:[{id:'SYN-stool-unobserved',status:'not observed',period:'AM',time:'06:00',score:null,notes:'SYN-stool-unobserved-note'},{id:'SYN-stool-unscored',status:'observed',period:'AM',time:'07:00',score:null,notes:'SYN-stool-unscored-note'},{id:'SYN-stool-scored-a',status:'observed',period:'PM',time:'17:10',score:4,consistency:'soft_formed',flags:['mucus'],notes:'SYN-stool-scored-a-note',...extra('stool')},{id:'SYN-stool-scored-b',status:'observed',period:'PM',time:'21:30',score:6,notes:'SYN-stool-scored-b-note'}],...extra('observation-first')},
      {id:'SYN-observation-second-same-date',date:'2026-08-14',time:'20:50',source:'SYN-owner-source-second',weightLb:40.75,notes:'SYN-original-note-second',rawEntry:'SYN-raw-second\nSYN-raw-second-line',stoolEvents:[{status:'none',notes:'SYN-no-stool-note'}],...extra('observation-second')},
      ...Array.from({length:5},(_,index)=>({id:`SYN-observation-later-${index}`,date:`2026-10-${String(11+index).padStart(2,'0')}`,notes:`SYN-original-note-later-${index}`,rawEntry:`SYN-raw-later-${index}`,source:`SYN-owner-source-later-${index}`,stoolEvents:[]})),
      {id:'SYN-observation-markup',date:'2026-10-15',notes:MARKUP,rawEntry:UNICODE+'\n'+LONG_TOKEN,source:'SYN-owner-markup-source',stoolEvents:[]}
    ],
    qualityOfLife:[{id:'SYN-qol-zero',date:'2026-08-15',score:0,notes:'SYN-qol-zero-note',source:'SYN-qol-source',...extra('qol')},{id:'SYN-qol-missing',date:'2026-10-15',score:null,notes:'SYN-qol-missing-note'}],
    milestones:[{id:'SYN-milestone',date:'2026-08-12',type:'clinical',title:'SYN-milestone-title',detail:'SYN-milestone-detail',source:'SYN-milestone-source',...extra('milestone')}],
    sourceNotes:[{id:'SYN-source-note',date:'2026-08-11',text:'SYN-source-note-text',source:'SYN-source-note-source',...extra('source-note')},'SYN-plain-source-note'],
    recordCorrections:[{collection:'observations',id:'SYN-observation-first',at:'2026-10-16T10:01:00Z',before:{notes:'SYN-correction-before-note',vomiting:null,nested:{text:'SYN-correction-before-deep'}},after:{notes:'SYN-correction-after-note',vomiting:0,nested:{text:'SYN-correction-after-deep'}},reason:'SYN-correction-reason',...extra('correction')},{collection:'carePlanVisits',id:'SYN-visit-cancelled',at:'2026-10-16T10:02:00Z',before:{date:'2026-10-09',status:'scheduled',notes:'SYN-visit-correction-before'},after:{date:'2026-10-10',status:'cancelled',notes:'SYN-visit-correction-after'}},{collection:'costs',id:'SYN-FIN-cost-a',at:'2026-10-16T10:03:00Z',before:{amountPaid:135,notes:'SYN-FIN-cost-correction-before'},after:{amountPaid:137.25,notes:'SYN-FIN-cost-correction-after'}},{collection:'medicationPurchases',id:'SYN-FIN-purchase-a',at:'2026-10-16T10:04:00Z',before:{amountPaid:19,notes:'SYN-FIN-purchase-correction-before'},after:{amountPaid:20,notes:'SYN-FIN-purchase-correction-after'}}],
    importHistory:[{key:'treatment:1',filename:'SYN-treatment-import.pdf',date:'2026-08-14',reviewedAt:'2026-10-16T09:00:00Z',evidence:{summary:'SYN-import-clinical-evidence',nested:['SYN-import-clinical-nested']},...extra('import')},{key:'cbc:2026-10-09',filename:'SYN-lab-import.pdf',date:'2026-10-09',evidence:'SYN-import-lab-evidence'},{key:'invoice:synthetic-1',filename:'SYN-FIN-invoice-import.pdf',date:'2026-08-14',evidence:'SYN-FIN-invoice-evidence'}],
    costs:[{id:'SYN-FIN-cost-a',date:'2026-08-14',amountPaid:137.25,provider:'SYN-FIN-provider-a',label:'SYN-FIN-cost-label-a',status:'confirmed',source:'SYN-FIN-cost-source-a',...extra('FIN-cost')},{id:'SYN-FIN-cost-b',date:'2026-09-11',amountPaid:62.5,provider:'SYN-FIN-provider-b',label:'SYN-FIN-cost-label-b',status:'unresolved',source:'SYN-FIN-cost-source-b'},{id:'SYN-FIN-cost-zero',date:'2026-09-12',amountPaid:0,status:'confirmed',label:'SYN-FIN-zero'},{id:'SYN-FIN-cost-null',amountPaid:null,status:'provisional',label:'SYN-FIN-null'},{id:'SYN-FIN-cost-empty',amountPaid:'',status:'provisional',label:'SYN-FIN-empty'},{id:'SYN-FIN-cost-absent',status:'unknown',label:'SYN-FIN-absent'}],
    medicationPurchases:[{id:'SYN-FIN-purchase-a',medicationId:'med-cerenia',costId:'SYN-FIN-cost-a',date:'2026-08-14',quantity:3,tabletStrengthMg:24,amountPaid:20,status:'confirmed',source:'SYN-FIN-purchase-source',...extra('FIN-purchase')},{id:'SYN-FIN-purchase-b',medicationId:'med-prednisone',costId:'SYN-FIN-cost-a',quantity:10,amountPaid:15,status:'confirmed'},{id:'SYN-FIN-purchase-orphan',medicationId:'med-cerenia',costId:'SYN-FIN-no-such-cost',amountPaid:12,status:'unresolved'},{id:'SYN-FIN-purchase-overallocated',medicationId:'med-cerenia',costId:'SYN-FIN-cost-b',amountPaid:200,status:'provisional'}],
    ownerSession:{access_token:'SYN-OMIT-auth-access-token',refresh_token:'SYN-OMIT-auth-refresh-token'},localStorage:{password:'SYN-OMIT-storage-password'},unrelatedState:'SYN-OMIT-unrelated-state'
  };
}
function documentFixture() {
  return [{id:'SYN-document-a',date:'2026-08-14',name:'SYN-document-name.pdf',type:'application/pdf',provider:'SYN-document-provider',note:'SYN-document-note',filename:'SYN-document-filename.pdf',size:321,createdAt:'2026-10-16T08:00:00Z',source:'SYN-document-source',file:'SYN-OMIT-document-file',blob:'SYN-OMIT-document-blob',dataUrl:'SYN-OMIT-document-dataurl',metadata:{original:'SYN-document-metadata',nested:{note:'SYN-document-nested-note',dataUrl:'SYN-OMIT-nested-dataurl'}},...extra('document')},{id:'SYN-document-b',date:'2026-10-09',name:'SYN-second-document.pdf',provider:'SYN-second-document-provider',note:'SYN-second-document-note'}];
}
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); }
  return value;
}
function strings(value) {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}
function assertSentinels(html, value, label) {
  for (const text of strings(value).filter(text=>text.includes('SYN-'))) assert(html.includes(escape(text)), `${label}: exact text retained: ${text.slice(0,95)}`);
}
function dataRows(model, key) {
  assert(Array.isArray(model.records[key]), `${key}: collection remains available`);
  return model.records[key].map(row=>row.data);
}
const tests=[];
const test=(name,run)=>tests.push({name,run});
let reporter;
function compileTests() {
  reporter = require(path.join(root,'handoff-report.js'));
  const build=(value=fixture(),docs=documentFixture(),overrides={})=>reporter.buildModel(value,docs,{...options,...overrides});
  test('exports an independent CommonJS/browser API without touching the DOM or storage',()=>{
    assert.equal(typeof reporter.buildModel,'function');assert.equal(typeof reporter.renderHtml,'function');
    const sandbox=vm.createContext({console,Date,Intl,structuredClone});
    vm.runInContext(fs.readFileSync(path.join(root,'handoff-report.js'),'utf8'),sandbox,{filename:'handoff-report.js'});
    assert.equal(typeof sandbox.RogerHandoff.buildModel,'function');assert.equal(typeof sandbox.RogerHandoff.renderHtml,'function');
    const model=build();assert.equal(model.financial,null,'Financial ledgers default off');
    assert.match(reporter.renderHtml(model),/<!doctype html>/i);
  });
  test('every clinical record, original index, field, nested extra and primitive survives independently',()=>{
    const source=fixture(),model=build(source);
    for(const key of ['observations','treatments','labs','medications','medicationCourses','medicationAdministrations','qualityOfLife','milestones','sourceNotes']){
      assert.deepEqual(dataRows(model,key),source[key],key+' is lossless');
      model.records[key].forEach((row,index)=>{assert.equal(row.originalIndex,index,key+' preserves storage order identity');assert.equal(row.id,source[key][index]?.id??null);});
    }
    const expectedProfile=clone(source.profile);delete expectedProfile.photoDataUrl;
    assert.deepEqual(model.profile,expectedProfile);assert.deepEqual(model.carePlan,source.carePlan);
    const html=reporter.renderHtml(model);
    for(const key of ['observations','treatments','labs','medications','medicationCourses','medicationAdministrations','qualityOfLife','milestones','sourceNotes'])assertSentinels(html,source[key],key);
    assertSentinels(html,expectedProfile,'profile');assertSentinels(html,source.carePlan,'care plan');
  });
  test('old doses, same-day administration times, held/unknown status and prescription distinctions survive',()=>{
    const value=fixture(),model=build(value),html=reporter.renderHtml(model);
    assert.equal(dataRows(model,'medicationAdministrations').length,4);
    for(const dose of value.medicationAdministrations){assert(html.includes(dose.date));assert(html.includes(dose.time));assert(html.includes(dose.status));}
    assert(html.includes('2026-08-15'),'No September cutoff');
    assert.match(html,/prescrib/i);assert.match(html,/course/i);assert.match(html,/administration|dose log/i);
    assert.equal(dataRows(model,'medicationCourses')[1].confirmedThrough,null,'Prescription is not converted into administration');
  });
  test('conflicting same-day weights and sources, missing/zero vomiting, full stool event distinctions remain separate',()=>{
    const model=build(),rows=dataRows(model,'observations');
    assert.equal(rows[0].date,rows[1].date);assert.equal(rows[0].weightLb,39.25);assert.equal(rows[1].weightLb,40.75);assert.equal(dataRows(model,'treatments')[0].weightLb,40);
    assert.equal(rows[0].vomiting,0);assert.equal(Object.hasOwn(rows[1],'vomiting'),false);
    assert.deepEqual(rows[0].stoolEvents.map(row=>row.status),['not observed','observed','observed','observed']);assert.equal(rows[1].stoolEvents[0].status,'none');
    assert.equal(rows[0].stoolEvents[1].score,null);assert.deepEqual(rows[0].stoolEvents.slice(2).map(row=>row.time),['17:10','21:30']);
    assert.equal(dataRows(model,'qualityOfLife')[0].score,0);assert.equal(dataRows(model,'qualityOfLife')[1].score,null);
    assert.match(reporter.renderHtml(model),/unknown|not recorded/i);
  });
  test('all notes and cycles, arbitrary lab metrics, ALP source display and numeric lower bound are retained',()=>{
    const source=fixture(),model=build(source),html=reporter.renderHtml(model);
    assert.equal(dataRows(model,'observations').length,8);assert.equal(dataRows(model,'treatments').length,4);
    const alp=dataRows(model,'labs').find(row=>row.metric==='ALP');assert.equal(alp.value,2000);assert.equal(alp.displayValue,'>2,000');assert.equal(alp.unit,'U/L');
    assert.match(html,/Lymphocytes/);assert(html.includes('&gt;2,000'));assert(html.includes('K/µL'));
    assert(html.includes(escape(LONG_NOTE)),'Entire multi-page raw entry is retained without truncation');
    assert(html.includes(escape(UNICODE)));assert(html.includes(escape(LONG_TOKEN)));
  });
  test('all question statuses, scheduled/cancelled plans, clinical corrections and import evidence survive',()=>{
    const source=fixture(),model=build(source),html=reporter.renderHtml(model);
    assert.deepEqual(model.carePlan.questions.map(row=>row.status),['open','resolved','deferred','unknown']);
    assert.deepEqual(model.carePlan.visits.map(row=>row.status),['scheduled','cancelled','planned']);
    assert.deepEqual(dataRows(model,'recordCorrections'),source.recordCorrections.slice(0,2));
    assert.deepEqual(dataRows(model,'importHistory'),source.importHistory.slice(0,2));
    assertSentinels(html,source.recordCorrections.slice(0,2),'clinical corrections');assertSentinels(html,source.importHistory.slice(0,2),'clinical imports');
    assert.match(html,/scheduled|planned/i);assert.match(html,/do(?:es)? not (?:confirm|prove)|not (?:confirmation|proof)|not.*(?:completed|administered)/i);
  });
  test('document metadata is complete while files/binary/photo/auth/storage contents never enter report',()=>{
    const source=fixture(),docs=documentFixture(),model=build(source,docs),html=reporter.renderHtml(model);
    const expected=clone(docs);delete expected[0].file;delete expected[0].blob;delete expected[0].dataUrl;delete expected[0].metadata.nested.dataUrl;
    assert.deepEqual(dataRows(model,'documents'),expected);assertSentinels(html,expected,'document metadata');
    assert(!json(model).includes('SYN-OMIT-'));assert(!html.includes('SYN-OMIT-'));
    assert.match(html,/not (?:attached|embedded)|does not (?:attach|embed)|files.*excluded/i);
  });
  test('available empty document index is not confused with unavailable or still-unverified index',()=>{
    const available=reporter.renderHtml(build(fixture(),[],{documentIndexStatus:'available'}));
    const unavailable=reporter.renderHtml(build(fixture(),[],{documentIndexStatus:'unavailable'}));
    const loading=reporter.renderHtml(build(fixture(),[],{documentIndexStatus:'loading'}));
    assert.notEqual(available,unavailable);assert.notEqual(available,loading);
    assert.match(available,/no (?:uploaded |source |local |saved )?(?:documents|files)|0 (?:documents|files)|empty/i);
    assert.match(unavailable,/unavailable|could not|couldn.t|not available/i);assert.match(loading,/loading|unverified|not verified|not.*available/i);
  });
  test('default generated clock and unverified document status remain truthful',()=>{
    const started=Date.now();
    for(const value of [{},{generatedAt:undefined}]){
      const model=reporter.buildModel(fixture(),[],value),timestamp=Date.parse(model.metadata.generatedAt);
      assert(Number.isFinite(timestamp));assert(timestamp>=started&&timestamp<=Date.now(),'Missing or undefined generatedAt uses the current clock');
    }
    const model=build(fixture(),[],{documentIndexStatus:'unverified'}),html=reporter.renderHtml(model);
    assert.equal(model.metadata.documentIndexStatus,'unverified');
    assert.match(html,/Document index status: unverified/);assert.doesNotMatch(html,/Document index status: available/);
    assert.match(html,/has not been verified|not verified|unverified/i);
  });
  test('derived weights omit missing blanks, retain zero/invalid values, and respect nested dates/sources in stable chronological order',()=>{
    const source=fixture();
    source.treatments=[{id:'SYN-weight-treatment',date:'2026-10-02',source:'SYN-weight-clinic-source',weightLb:null,weightKg:'',bodyWeight:0,weightHistory:[
      {date:'2026-08-01',value:22,unit:'kg',source:'SYN-weight-history-own-source'},
      {date:'not-a-date',value:'SYN-weight-invalid-value',unit:'lb',source:'SYN-weight-history-invalid-source'},
      {date:'2026-07-01',value:null,unit:'kg',source:'SYN-weight-null-source'},
      {date:'2026-07-02',value:'  ',unit:'kg',source:'SYN-weight-blank-source'}
    ]}];
    source.observations=[{id:'SYN-weight-observation',date:'2026-08-01',weightLb:48,source:'SYN-weight-owner-source'},
      {id:'SYN-weight-nested',date:'2026-07-01',weight:'SYN-weight-unknown-value',source:'SYN-weight-record-source',nested:{weights:[{date:'2026-06-01',value:23,unit:'kg',source:'SYN-weight-nested-own-source'}]}}];
    const before=json(source),model=build(source);
    assert.deepEqual(model.weights.map(row=>row.date),['2026-06-01','2026-07-01','2026-08-01','2026-08-01','2026-10-02','not-a-date']);
    assert.deepEqual(model.weights.slice(2,4).map(row=>row.collection),['treatments','observations'],'Same-day ties retain original stable order');
    assert.equal(model.weights[0].source,'SYN-weight-nested-own-source');assert.equal(model.weights[0].unit,'kg');
    assert.equal(model.weights[2].source,'SYN-weight-history-own-source');assert.equal(model.weights[2].unit,'kg');
    assert.equal(model.weights[4].value,0);assert.equal(model.weights[5].value.value,'SYN-weight-invalid-value');
    assert(!model.weights.some(row=>row.value===null||row.value===''));
    assert.deepEqual(dataRows(model,'treatments'),source.treatments);assert.deepEqual(dataRows(model,'observations'),source.observations);assert.equal(json(source),before);
  });
  test('credential-shaped profile/document metadata is omitted without redacting ordinary clinical/source prose',()=>{
    const source=fixture(),docs=documentFixture();
    Object.assign(source.profile,{access_token:'SYN-OMIT-profile-token',authToken:'SYN-OMIT-profile-auth',session:{id:'SYN-OMIT-profile-session'},password:'SYN-OMIT-profile-password',apiKey:'SYN-OMIT-profile-api-key'});
    docs[0].metadata.credentials={password:'SYN-OMIT-doc-password'};docs[0].metadata.nested.refresh_token='SYN-OMIT-doc-token';
    docs[0].metadata.nested.apiKey='SYN-OMIT-doc-api-key';
    source.observations[0].notes='SYN-prose-preserved: owner used the word password and API key in original notes.';
    docs[0].note='SYN-document-prose: original note mentions session and token, not credentials.';
    const before=json([source,docs]),model=build(source,docs),html=reporter.renderHtml(model);
    assert(!json(model).includes('SYN-OMIT-'));assert(!html.includes('SYN-OMIT-'));
    assert(html.includes(source.observations[0].notes));assert(html.includes(docs[0].note));assert.equal(json([source,docs]),before);
  });
  test('financial opt-out removes ledgers and their audit/import rows but does not pretend to redact clinical notes',()=>{
    const model=build(),html=reporter.renderHtml(model);
    assert.equal(model.financial,null);assert(!Object.hasOwn(model.records,'costs'));assert(!Object.hasOwn(model.records,'medicationPurchases'));
    assert(!json(model).includes('SYN-FIN-'));assert(!html.includes('SYN-FIN-'));
    assert(html.includes('Original clinical note mentions $47'));
    assert.match(html,/not.*redact|not.*redaction|original.*(?:money|financial)|(?:clinical|source).*notes.*(?:money|financial|amount)/i);
  });
  test('financial opt-in uses only costs, preserves zero and unknown amounts/statuses, and flags allocations',()=>{
    const source=fixture(),model=build(source,documentFixture(),{includeFinancialLedgers:true}),html=reporter.renderHtml(model);
    for(const key of ['costs','medicationPurchases','recordCorrections','importHistory']){assert.deepEqual(dataRows(model,key),source[key]);assertSentinels(html,source[key],key);}
    assert.equal(model.financial.totalAmountPaid,199.75,'Purchase allocations do not add to costs');
    assert.equal(model.financial.numericAmountCount,3);assert.equal(model.financial.unknownAmountCount,3,'Missing/null/blank are unknown, not zero');
    assert(json(model.financial.byStatus).includes('confirmed'));assert(json(model.financial.byStatus).includes('unresolved'));assert(json(model.financial.byStatus).includes('provisional'));
    assert(model.financial.issues.length>=2,'Unlinked and overallocated purchases require distinct visible issues');
    assert.match(html,/unlinked|missing cost|no (?:matching|linked).*cost|not.*linked/i);assert.match(html,/exceed|inconsisten|over.allocat/i);
  });
  test('extra prescription/journal collections and unusual nested fields are retained without prototype or markup execution',()=>{
    const source=fixture();
    source.prescriptions=[{id:'SYN-extra-prescription',instructions:'SYN-extra-prescription-instructions',...extra('extra-prescription')}];
    source.journalEntries=[{id:'SYN-extra-journal',date:'2026-07-01',rawEntry:'SYN-extra-journal-raw',weightKg:17.5,...extra('extra-journal')}];
    source.observations[0].extraFields=JSON.parse('{"__proto__":{"polluted":"SYN-prototype-field"},"constructor":"SYN-constructor-field","<img src=x onerror=synthetic()>":"SYN-key-markup-value"}');
    const model=build(source),html=reporter.renderHtml(model);
    for(const key of ['prescriptions','journalEntries']){assert.deepEqual(dataRows(model,key),source[key]);assertSentinels(html,source[key],key);}
    assert.deepEqual(dataRows(model,'observations')[0].extraFields,source.observations[0].extraFields);
    assert.equal({}.polluted,undefined);assert(html.includes('&lt;img src=x onerror=synthetic()&gt;'));assert.doesNotMatch(html,/<img\b/i);
    assert(model.weights.some(row=>row.collection==='journalEntries'&&row.value===17.5&&row.unit==='kg'));
  });
  test('financial unknown-only and inconsistent-link cases do not fabricate a zero total or a valid allocation',()=>{
    const source=fixture();source.costs=[{id:'SYN-FIN-unknown-only',amountPaid:null,status:'unknown'}];
    source.medicationPurchases=[{id:'SYN-FIN-inconsistent',costId:'SYN-FIN-unknown-only',linkedCostId:'SYN-FIN-missing',amountPaid:10,status:'unresolved'}];
    const model=build(source,[],{includeFinancialLedgers:true});
    assert.equal(model.financial.totalAmountPaid,null);assert.equal(model.financial.numericAmountCount,0);assert.equal(model.financial.unknownAmountCount,1);
    assert.match(model.financial.issues.join(' '),/inconsistent/i);assert.match(reporter.renderHtml(model),/unknown|not recorded/i);
  });
  test('UTF-8 standalone HTML escapes source markup, needs no script/assets, and prints expanded appendices',()=>{
    const html=reporter.renderHtml(build());
    assert.match(html,/<meta\b[^>]*charset=["']?utf-8/i);assert.match(html,/<meta\b[^>]*name=["']viewport/i);
    assert(html.includes(escape(MARKUP)));assert(html.includes(escape(UNICODE)));
    assert.doesNotMatch(html,/<(?:script|iframe|object|embed|img|svg|link)\b/i);
    assert.doesNotMatch(html,/<[^>]+\son(?:load|error|click)=/i);
    assert.doesNotMatch(html,/@import\b|url\(\s*["']?(?:https?:|\/\/)/i);
    assert.match(html,/@media print/);assert.match(html,/overflow-wrap\s*:\s*(?:anywhere|break-word)|word-break\s*:\s*break-(?:all|word)/);
    for(const tag of html.match(/<details\b[^>]*>/gi)||[])assert(/\bopen(?:\s|=|>)/i.test(tag),'Source appendices are expanded by default');
    assert.match(html,/appendi|full source|original.*record/i);
  });
  test('build and render are pure, deterministic with a supplied clock, and do not alias input data',()=>{
    const source=deepFreeze(fixture()),docs=deepFreeze(documentFixture()),before=json([source,docs]);
    const model=build(source,docs),modelBefore=json(model);const html=reporter.renderHtml(deepFreeze(model));
    assert.equal(json([source,docs]),before);assert.equal(json(model),modelBefore);assert.equal(reporter.renderHtml(build(source,docs)),html);
    const mutableSource=fixture(),mutableDocs=documentFixture(),independent=build(mutableSource,mutableDocs);
    mutableSource.observations[0].notes='SYN-later-mutation';mutableDocs[0].metadata.original='SYN-later-document-mutation';
    assert(!json(independent).includes('SYN-later-'));
  });
  test('app wrapper stays independent of snapshot ranges and preserves state/document/UI/auth/storage contracts',()=>{
    const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
    const ctx=vm.createContext({console,structuredClone,Date:FixedDate,Intl,RogerHandoff:reporter,document:{addEventListener(){},querySelector(){return null;},querySelectorAll(){return [];}}});
    vm.runInContext(source+`\n globalThis.reportTestApi={set(value,docs){state=value;documents=docs;},range(value){Object.assign(careSnapshotRange,value);},build:buildCompleteTreatmentReport,state(){return JSON.stringify(state);},docs(){return JSON.stringify(documents);}};`,ctx,{filename:'app.js'});
    const value=fixture(),docs=documentFixture();ctx.reportTestApi.set(value,docs);
    const before=json([value,docs]),reportOptions={generatedAt:GENERATED_AT,documentIndex:{rows:docs,status:'available'}};
    const first=ctx.reportTestApi.build(reportOptions);
    assert(ctx.reportTestApi.build({documentIndex:reportOptions.documentIndex}).includes(GENERATED_AT),'Real UI exports default to the current generated timestamp');
    for(const mode of ['14days','7days','treatment','visit','custom']){
      ctx.reportTestApi.range({mode,from:'2026-10-14',to:'2026-10-15'});assert.equal(ctx.reportTestApi.build(reportOptions),first,mode+' never filters full report');
    }
    assert.equal(json([value,docs]),before);assert.equal(ctx.reportTestApi.state(),json(value));assert.equal(ctx.reportTestApi.docs(),json(docs));
    assert(first.includes('SYN-dose-early-am'));assert(first.includes('SYN-original-note-first'));
    const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
    for(const id of ['completeReportIncludeCosts','previewCompleteReport','printCareSummary','downloadCompleteReport'])assert.equal((index.match(new RegExp(`id=["']${id}["']`,'g'))||[]).length,1,id+' is present once');
    const input=index.match(/<input\b[^>]*id=["']completeReportIncludeCosts["'][^>]*>/i)?.[0];assert(input);assert(!/\bchecked(?:\s|=|>)/i.test(input),'Financial checkbox defaults off');
    assert(index.indexOf('handoff-report.js')<index.indexOf('src="app.js'),'Reporter loads before the app');
    const worker=fs.readFileSync(path.join(root,'sw.js'),'utf8');
    const core=worker.match(/const CORE = \[[^;]+;/)?.[0]||'';
    assert(core.includes('./handoff-report.js'),'Service-worker core caches the report module');
    const appShell=worker.slice(worker.indexOf('const isAppShell'),worker.indexOf('if (isAppShell)'));
    assert(appShell.includes("includes('/handoff-report.js')"),'Report module participates in network-first app-shell upgrades');
    assert.match(worker.slice(worker.indexOf('if (isAppShell)')),/fetch\(event\.request, \{cache:'no-store'\}\)/);
  });
}
function runUnitTests() {
  compileTests();let failed=0;
  for(const {name,run} of tests){try{run();console.log('PASS',name);}catch(error){failed++;console.error('FAIL',name);console.error(error.stack);}}
  console.log(`Complete-report unit checks: ${tests.length-failed}/${tests.length} passed`);
  if(failed)process.exitCode=1;
  return !failed;
}
async function runBrowserTests() {
  const playwright=require('playwright'),webkit=process.argv.includes('--webkit'),engine=webkit?'webkit':'chromium';
  // Existing fixture is invented too; it is used only to boot the app. The
  // comprehensive report fixture replaces in-memory records after boot.
  const bootFixture=clone(require('./test-navigation.cjs').fixture);
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/data/seed.json'){res.setHeader('Content-Type','application/json');res.end(json(bootFixture));return;}
    if(pathname.startsWith('/data/')){res.writeHead(404);res.end();return;}
    const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    try{res.setHeader('Content-Type',({'.js':'application/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'})[path.extname(file)]||'text/plain');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${server.address().port}`;
  let browser,currentPage,currentWidth;
  const artifactDir=process.env.QA_SCREENSHOT_DIR;
  if(artifactDir)fs.mkdirSync(artifactDir,{recursive:true});
  const pdfDir=artifactDir||fs.mkdtempSync(path.join(os.tmpdir(),'roger-complete-report-'));
  const capture=async(page,label,{fullPage=false}={})=>{if(artifactDir)await page.screenshot({path:path.join(artifactDir,`${engine}-${currentWidth}-complete-report-${label}.png`),fullPage});};
  try{
    browser=await playwright[engine].launch(webkit?{headless:true}:{executablePath:process.env.CHROMIUM_PATH||playwright.chromium.executablePath(),headless:true,args:['--no-sandbox']});
    const viewports=webkit?[{width:390,height:844},{width:320,height:700}]:[{width:1280,height:900},{width:390,height:844},{width:320,height:700}];
    for(const viewport of viewports){
      currentWidth=viewport.width;
      const context=await browser.newContext({viewport,serviceWorkers:'block',timezoneId:'UTC',acceptDownloads:true});
      const errors=[],networkWrites=[],reportRequests=[];
      context.on('page',p=>p.on('pageerror',error=>errors.push(error.message)));
      await context.route('**/*',route=>{const request=route.request();if(!['GET','HEAD'].includes(request.method()))networkWrites.push({method:request.method(),url:request.url()});return new URL(request.url()).origin===origin?route.continue():route.abort();});
      const page=await context.newPage();currentPage=page;
      context.on('request',request=>{try{if(request.frame().page()!==page)reportRequests.push(request.url());}catch{reportRequests.push(request.url());}});
      await page.clock.setFixedTime(new Date(GENERATED_AT));
      await page.goto(origin,{waitUntil:'networkidle'});
      await page.waitForFunction(()=>document.querySelector('#journalEntries').children.length>0);
      assert.deepEqual(errors,[],'No synthetic boot errors');
      await page.evaluate(async({value,docs})=>{
        state=value;await replaceDocuments(docs);await loadDocuments();
        ownerCanEdit=false;ownerSession=null;renderCareSnapshotPreview();renderSharedStatus();
        globalThis.__reportWrites=[];
        const transaction=IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction=function(stores,mode,...rest){if(mode&&mode!=='readonly')globalThis.__reportWrites.push({stores,mode});return transaction.call(this,stores,mode,...rest);};
        const nativeOpen=window.open.bind(window);
        globalThis.__reportNativeOpen=nativeOpen;
        window.open=(...args)=>{const popup=nativeOpen(...args);if(popup)popup.print=()=>{popup.__completeReportPrintCalls=(popup.__completeReportPrintCalls||0)+1;};return popup;};
      },{value:fixture(),docs:documentFixture()});
      const stored=()=>page.evaluate(()=>({state:JSON.stringify(state),docs:JSON.stringify(documents),localStorage:JSON.stringify({...localStorage}),sessionStorage:JSON.stringify({...sessionStorage}),ownerCanEdit,ownerSession}));
      const initial=await stored();
      await page.locator('.bottom-nav [data-nav="more"]').click();await page.locator('#more-panel-menu [data-nav="snapshot"]').click();
      const ids=['#completeReportIncludeCosts','#previewCompleteReport','#printCareSummary','#downloadCompleteReport'];
      for(const selector of ids){assert(await page.locator(selector).isVisible(),selector+' is accessible in view-only mode');assert(await page.locator(selector).isEnabled(),selector+' is permitted in view-only mode');}
      assert.equal(await page.locator('#completeReportIncludeCosts').isChecked(),false);
      const ensureFits=async(p,label)=>assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)),`${engine} ${viewport.width}px ${label} has no horizontal overflow`);
      await ensureFits(page,'controls');await capture(page,'controls');
      const buildExpected=()=>page.evaluate(async()=>{const index=await readCompleteReportDocuments();return buildCompleteTreatmentReport({includeFinancialLedgers:document.querySelector('#completeReportIncludeCosts').checked,generatedAt:new Date().toISOString(),documentIndex:index});});
      const expected=await buildExpected();
      const openReport=async selector=>{
        const pending=context.waitForEvent('page');await page.locator(selector).click();const popup=await pending;
        await popup.waitForFunction(()=>document.body?.textContent?.includes('SYN-full-name'));
        await ensureFits(popup,'standalone report');
        assert.equal(await popup.locator('script,img,iframe,object,embed,svg,link').count(),0,'Report loads no executable or external assets');
        assert.equal(await popup.evaluate(()=>globalThis.SYN_EXECUTED),undefined);
        const text=await popup.locator('body').innerText();
        for(const sentinel of ['SYN-dose-early-am','SYN-dose-early-pm','SYN-original-note-first','SYN-original-note-later-4','SYN-LONG-RAW-FIRST','SYN-LONG-RAW-LAST','SYN-document-nested-note','SYN-correction-before-deep','SYN-correction-after-deep'])assert(text.includes(sentinel),'Visible report includes '+sentinel);
        assert.equal(await popup.locator('details:not([open])').count(),0,'All source appendices are expanded');
        return popup;
      };
      const popup=await openReport('#previewCompleteReport');
      assert(!(await popup.locator('body').innerText()).includes('SYN-FIN-'));
      assert((await popup.locator('body').innerText()).includes(UNICODE));
      await capture(popup,'overview');
      await popup.getByText('SYN-LONG-RAW-LAST',{exact:false}).last().scrollIntoViewIfNeeded();await capture(popup,'expanded-raw-tail');
      if(!webkit){
        await popup.emulateMedia({media:'print'});await popup.evaluate(()=>scrollTo(0,0));await capture(popup,'print-layout-top');
        const pdfPath=path.join(pdfDir,`${engine}-${viewport.width}-complete-treatment-report.pdf`);
        await popup.pdf({path:pdfPath,format:'A4',printBackground:true,preferCSSPageSize:true});
        fs.writeFileSync(path.join(pdfDir,`${engine}-${viewport.width}-complete-treatment-report.html`),expected,'utf8');
        const extracted=execFileSync('pdftotext',['-layout',pdfPath,'-'],{encoding:'utf8',maxBuffer:16*1024*1024});
        fs.writeFileSync(path.join(pdfDir,`${engine}-${viewport.width}-complete-treatment-report.txt`),extracted,'utf8');
        const normalized=extracted.replace(/\s+/g,' '),compact=extracted.replace(/\s+/g,'');
        const model=reporter.buildModel(fixture(),documentFixture(),options);
        const markers=new Set(strings(model).flatMap(value=>[...value.matchAll(/SYN-[A-Za-z0-9-]+/g)].map(match=>match[0])));
        for(const marker of markers){
          if(marker.startsWith('SYN-LONG-TOKEN-'))continue;
          assert(compact.includes(marker),`Printed PDF preserves source marker: ${marker}`);
        }
        assert(compact.includes(LONG_TOKEN),'The complete long unbroken token survives print pagination');
        for(const text of ['café','naïve','µL','μg','mg/m²','≥','≤','→','中文','>2,000','K/µL','U/L'])assert(normalized.includes(text),'Printed Unicode/result text survives: '+text);
        const info=execFileSync('pdfinfo',[pdfPath],{encoding:'utf8'}),pages=Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
        assert(pages>=3,'The long raw journal and expanded appendices paginate across several pages');
        // Render a genuine first printed page, rather than labeling a screen
        // screenshot as a PDF preview. This is a CI review artifact too.
        execFileSync('pdftoppm',['-f','1','-singlefile','-scale-to','1400','-png',pdfPath,path.join(pdfDir,`${engine}-${viewport.width}-complete-report-first-pdf-page`)]);
        console.log(`PASS PDF ${viewport.width}px: ${pages} pages, ${markers.size} original source markers, full long token, Unicode, laboratory bounds/units and first-page raster`);
        await popup.emulateMedia({media:'screen'});
      }
      await popup.close();
      for(let repeat=0;repeat<2;repeat++){
        for(const mode of ['14days','7days','treatment','visit','custom']){await page.locator(`[data-snapshot-range="${mode}"]`).click();assert.equal(await buildExpected(),expected,mode+' never filters complete report');}
        await page.locator('.bottom-nav [data-nav="journal"]').click();await page.goBack();await page.waitForFunction(()=>normalizeRoute(location.hash)==='snapshot');
        const repeated=await openReport('#previewCompleteReport');await repeated.close();
      }
      const printPopup=await openReport('#printCareSummary');
      await printPopup.waitForFunction(()=>globalThis.__completeReportPrintCalls===1);await printPopup.close();
      const downloadOne=async(label)=>{
        const pending=page.waitForEvent('download');await page.locator('#downloadCompleteReport').click();const download=await pending;
        assert.match(download.suggestedFilename(),/\.html$/i);const file=await download.path();const downloaded=fs.readFileSync(file,'utf8');
        assert.equal(downloaded,await buildExpected(),label+' download is exact UTF-8 report HTML');
        if(artifactDir)await download.saveAs(path.join(artifactDir,`${engine}-${viewport.width}-${label}.html`));return downloaded;
      };
      assert(!(await downloadOne('complete-report-default')).includes('SYN-FIN-'));
      await page.locator('#completeReportIncludeCosts').check();
      assert((await downloadOne('complete-report-with-finances')).includes('SYN-FIN-cost-a'));
      const financialPopup=await openReport('#previewCompleteReport');assert((await financialPopup.locator('body').innerText()).includes('SYN-FIN-cost-a'));await financialPopup.close();
      await page.locator('#completeReportIncludeCosts').uncheck();assert.equal(await buildExpected(),expected);
      // A blocked popup must not fall back to changing data or a hidden export.
      await page.evaluate(()=>{globalThis.__workingOpen=window.open;window.open=()=>null;});
      await page.locator('#previewCompleteReport').click();
      await page.waitForFunction(()=>/pop.?up|new (?:tab|window)|allow.*(?:window|tab)|blocked.*report window/i.test(document.querySelector('#toastRegion')?.textContent||''));
      await page.evaluate(()=>{window.open=()=>{throw Error('Synthetic blocked window');};});
      await page.locator('#previewCompleteReport').click();
      await page.waitForFunction(()=>/blocked.*report window/i.test(document.querySelector('#toastRegion')?.textContent||''));
      await page.evaluate(()=>{window.open=globalThis.__workingOpen;});
      // Failed document access is not equivalent to a successful empty index.
      await page.evaluate(()=>{globalThis.__workingOpenDocDb=openDocDb;openDocDb=async()=>{throw Error('Synthetic document index unavailable');};});
      const unavailable=await page.evaluate(async()=>readCompleteReportDocuments());assert.equal(unavailable.status,'unavailable');
      const pendingUnavailable=context.waitForEvent('page');await page.locator('#previewCompleteReport').click();const unavailablePopup=await pendingUnavailable;
      await unavailablePopup.waitForFunction(()=>/unavailable|could not|not available/i.test(document.body?.textContent||''));
      assert.match(await unavailablePopup.locator('body').innerText(),/unavailable|could not|not available/i);await unavailablePopup.close();
      await page.evaluate(()=>{openDocDb=globalThis.__workingOpenDocDb;});
      // The user's financial choice is captured at the tap, not after the
      // asynchronous document-index read; interrupting a popup is harmless.
      await page.evaluate(()=>{
        globalThis.__workingReader=readCompleteReportDocuments;
        readCompleteReportDocuments=()=>new Promise(resolve=>{globalThis.__resolveReportIndex=resolve;});
      });
      const pendingChoice=context.waitForEvent('page');await page.locator('#previewCompleteReport').click();const choicePopup=await pendingChoice;
      await page.locator('#completeReportIncludeCosts').check();
      await page.evaluate(async()=>globalThis.__resolveReportIndex(await globalThis.__workingReader()));
      await choicePopup.waitForFunction(()=>document.body?.textContent?.includes('SYN-LONG-RAW-LAST'));
      assert(!(await choicePopup.locator('body').innerText()).includes('SYN-FIN-'),'A later toggle cannot alter the export already requested');
      await choicePopup.close();await page.locator('#completeReportIncludeCosts').uncheck();
      const pendingClosed=context.waitForEvent('page');await page.locator('#previewCompleteReport').click();const closedPopup=await pendingClosed;
      await closedPopup.close();await page.evaluate(async()=>globalThis.__resolveReportIndex(await globalThis.__workingReader()));
      await page.evaluate(()=>{readCompleteReportDocuments=globalThis.__workingReader;});
      assert.deepEqual(await stored(),initial,'Preview, print, download, repeated flows and errors preserve state/documents/storage/auth exactly');
      assert.deepEqual(await page.evaluate(()=>globalThis.__reportWrites),[],'Report flows never write IndexedDB');
      assert.deepEqual(networkWrites,[],'No network writes');assert.deepEqual(reportRequests,[],'Standalone HTML makes no asset/script requests');assert.deepEqual(errors,[],'No runtime errors');
      await ensureFits(page,'final controls');console.log(`PASS browser ${engine} ${viewport.width}px: view-only, real popup, exact UTF-8 download, print, repeated ranges/history, financial opt-in, blocked popup, unavailable index, immutable records/storage, zero network writes`);
      await context.close();
    }
  }catch(error){if(currentPage&&!currentPage.isClosed())try{await capture(currentPage,'failure');}catch{}throw error;}
  finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
module.exports={fixture,documentFixture,GENERATED_AT,LONG_NOTE,UNICODE,runUnitTests,runBrowserTests};
if(require.main===module)(async()=>{if(runUnitTests()&&process.argv.includes('--browser'))await runBrowserTests();})().catch(error=>{console.error(error);process.exitCode=1;});
