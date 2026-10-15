'use strict';
// Synthetic fixtures only. No seed data, browser storage, network, or live record.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({
  console, structuredClone, Date, Intl,
  document: {addEventListener() {}},
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8') + `
  globalThis.testApi = {
    set(value, from='2026-10-02', to='2026-10-14') {
      state = structuredClone(value);
      Object.assign(careSnapshotRange, {mode:'custom',from,to});
    },
    data: careSnapshotData, narrative: careSnapshotNarrative,
    chartEnd(index=0) { return chartCourseEnd(state.medicationCourses[index]); },
    spans(index=0) { return medicationCourseSpans(state.medicationCourses[index]); },
    summary(index=0, range={}) { return medicationCourseSummary(state.medicationCourses[index], range); },
    state() { return structuredClone(state); },
    medicationLedger: renderMedicationLedger,
    pdf: buildCareSummaryPdf,
    html: buildCareSummaryHtml,
    ownerNotes: careSnapshotOwnerNotesHtml,
    notePdfText: pdfOwnerNoteText,
  };
`, context, {filename:'app.js'});
const api = context.testApi;
const date = day => `2026-10-${String(day).padStart(2,'0')}`;
const course = (overrides={}) => ({
  id:'synthetic-pred', medicationId:'med-prednisone', startDate:date(2),
  endDate:null, confirmedThrough:date(3), dose:'10 mg', frequency:'Every 24 hours',
  status:'owner-confirmed daily given through 10/3; prescribed daily thereafter',
  source:'synthetic owner course', ...overrides,
});
const dose = (day, overrides={}) => ({
  id:`synthetic-dose-${day}`, medicationId:'med-prednisone', date:date(day),
  dose:'10 mg', status:'given', source:'synthetic owner entry', ...overrides,
});
const observation = (day, overrides={}) => ({
  id:`synthetic-observation-${day}`, date:date(day), notes:'', stoolEvents:[], ...overrides,
});
const fixture = (overrides={}) => ({
  profile:{name:'Example dog'}, observations:[], medicationCourses:[],
  medicationAdministrations:[], medicationPurchases:[], costs:[], qualityOfLife:[],
  labs:[], milestones:[], carePlan:{questions:[]},
  treatments:[{id:'synthetic-treatment',date:date(2),number:5,doseMg:2,doseMgM2:2.2,weightLb:44,source:'synthetic clinic record'}],
  medications:[
    {id:'med-prednisone',name:'Prednisone',tabletStrengthMg:20,prescribedDose:'Synthetic prescription'},
    {id:'med-cerenia',name:'Cerenia / maropitant',tabletStrengthMg:60},
    {id:'med-other',name:'Other medicine'},
  ], ...overrides,
});
const tests = [];
function test(name, run) { tests.push({name,run}); }
function snapshot(value, from=date(2), to=date(14)) { api.set(value,from,to); return api.data(); }
function narrative(data) { return api.narrative(data).join('\n'); }
function assertUnknown(text) { assert.match(text,/not specifically|not described|unknown|no home observations/i); }

test('no observations stays unknown and preserves available clinical context', () => {
  const data=snapshot(fixture());
  assertUnknown(data.appetiteText);assertUnknown(data.energyText);assertUnknown(data.nauseaText);assertUnknown(data.vomitingText);
  assert.match(narrative(data),/no home observations recorded/i);
  assert.doesNotMatch(narrative(data),/no nausea signs|no vomiting observed|symptom.free/i);
  assert.match(data.clinicalText,/2 mg vinblastine \(2.2 mg\/m²\)/);
});
test('an empty journal day does not become symptom-free', () => {
  const data=snapshot(fixture({observations:[observation(5,{notes:'Enjoyed sitting outside'})]}));
  assertUnknown(data.nauseaText);assertUnknown(data.vomitingText);
  assert.match(narrative(data),/There are gaps in my notes/);
  assert.doesNotMatch(narrative(data),/\d+ of \d+|no nausea signs|no vomiting/i);
});
test('blank/null intake never becomes zero percent; actual zero is retained', () => {
  let data=snapshot(fixture({observations:[observation(4,{appetite:'decreased',appetitePercent:null}),observation(5,{appetite:'normal',appetitePercent:''})]}));
  assert.equal(data.minAppetite,null);assert.doesNotMatch(data.appetiteText,/0%/);
  data=snapshot(fixture({observations:[observation(4,{appetitePercent:0})]}));
  assert.equal(data.minAppetite,0);assert.match(data.appetiteText,/0%/);
});
test('sparse appetite/energy normal findings apply only to their dates', () => {
  const data=snapshot(fixture({observations:[observation(4,{appetite:'normal',energy:'normal'}),observation(12,{notes:'General note'})]}));
  assert.equal(data.appetiteRows.length,1);assert.equal(data.energyRows.length,1);
  assert.match(data.appetiteText,/Oct 4/);assert.doesNotMatch(data.appetiteText,/all|stayed/);
  assert.match(narrative(data),/Symptoms I did not specifically record remain unknown/);
});
test('increased appetite and high energy are not labeled baseline normal', () => {
  const data=snapshot(fixture({observations:[observation(5,{appetite:'increased',appetitePercent:125,energy:'high'})]}));
  assert.match(data.appetiteText,/More appetite than usual/);assert.match(data.energyText,/More energy than usual/);
  assert.doesNotMatch(narrative(data),/close to normal|usual level when/);
});
test('explicit negative nausea and vomiting are distinct from missing observations', () => {
  const data=snapshot(fixture({observations:[observation(4,{nausea:0,vomiting:0}),observation(5,{nausea:null,vomiting:null}),observation(6,{nauseaNoneObserved:true})]}));
  assert.equal(data.nauseaNoneDays.length,2);assert.equal(data.vomitingNoneDays.length,1);
  assert.match(data.nauseaText,/No nausea signs observed/);assert.match(data.vomitingText,/No vomiting observed on Oct 4/);
  assert.doesNotMatch(data.vomitingText,/Oct 5|Oct 6/);
});
test('positive nausea and multiple daily notes retain findings without double-counting dates', () => {
  const data=snapshot(fixture({observations:[observation(4,{nausea:1,nauseaSigns:['lip_licking']}),observation(4,{id:'second',nausea:0}),observation(5,{nausea:0})]}));
  assert.equal(data.nauseaDays.length,1);assert.equal(data.nauseaNoneDays.length,1);
  assert.match(data.nauseaText,/lip licking/);assert.match(data.nauseaText,/No nausea signs observed on Oct 5/);
});
test('unscored movements and no stool are not described as normal/diarrhea-free', () => {
  const data=snapshot(fixture({observations:[observation(4,{stoolEvents:[{status:'observed',score:null}]}),observation(5,{stoolEvents:[{status:'none'}]})]}));
  assert.equal(data.characterizedStoolDays.length,0);assert.equal(data.looseDays.length,0);
  assert.match(data.stoolText,/No bowel movement was reported on Oct 5/);
  assert.doesNotMatch(narrative(data),/did not record loose|normal stool|diarrhea.free/i);
});
test('not observed/not recorded stool rows do not add observed symptoms', () => {
  const data=snapshot(fixture({observations:[observation(4,{stoolEvents:[{status:'not observed',score:8,flags:['black_tarry'],notes:'watery'}]}),observation(5,{stoolEvents:[{status:'not recorded',score:null}]})]}));
  assert.equal(data.looseDays.length,0);assert.equal(data.bloodDays.length,0);assert.equal(data.stoolRows.length,0);
});
test('no blood, no tarry stool, and no diarrhea are not positive flags', () => {
  const data=snapshot(fixture({observations:[observation(4,{gi:'No blood or black/tarry stool. No diarrhea.',notes:'Blood test tomorrow',stoolEvents:[{status:'observed',score:4,notes:'No blood; no watery stool'}]})]}));
  assert.equal(data.bloodDays.length,0);assert.equal(data.blackTarryDays.length,0);assert.equal(data.looseDays.length,0);
  assert.doesNotMatch(narrative(data),/My notes include/);
});
test('positive findings after a negation survive, with dates and source uncertainty', () => {
  const data=snapshot(fixture({observations:[observation(4,{gi:'No diarrhea, but bright red blood in stool'}),observation(5,{stoolEvents:[{status:'observed',notes:'Darker, possible blood'}]}),observation(6,{stoolEvents:[{status:'observed',consistency:'watery',flags:['black_tarry']}]})]}));
  assert.equal(data.bloodDays.length,2);assert.equal(data.noteReviews.length,1);assert.equal(data.brightRedStoolDays.length,1);assert.equal(data.blackTarryDays.length,1);assert.equal(data.looseDays.length,1);
  assert.match(narrative(data),/possible blood/);assert.match(narrative(data),/black\/tarry stool on Oct 6/);
});
test('vomit red flags remain visible even when episode count is absent', () => {
  const data=snapshot(fixture({observations:[observation(6,{vomitFlags:['coffee_ground_like']}),observation(7,{vomiting:2,vomitFlags:['bright_red_blood']})]}));
  assert.equal(data.vomitingEpisodes,2);assert.match(data.vomitingText,/coffee grounds/);assert.match(narrative(data),/bright-red blood in vomit on Oct 7/);
  assert.doesNotMatch(data.vomitingText,/No vomiting observed/);
});
test('consecutive same-dose prednisone extends to the last explicit date without mutating course', () => {
  const source=fixture({medicationCourses:[course()],medicationAdministrations:Array.from({length:11},(_,i)=>dose(i+4))});
  const before=JSON.stringify(source),data=snapshot(source);
  assert.equal(data.predThrough,date(14));assert.equal(api.chartEnd(),date(14));
  assert.match(data.medicationText,/Oct 2–14, 2026/);assert.match(narrative(data),/Oct 2–14, 2026/);
  assert.equal(JSON.stringify(api.state()),before);assert.equal(JSON.stringify(source),before);
});
test('dose comparison accepts equivalent simple mg formatting', () => {
  snapshot(fixture({medicationCourses:[course()],medicationAdministrations:[dose(4,{dose:'10.0 MG'})]}));
  assert.equal(api.chartEnd(),date(4));
});
test('a gap stops the continuous band but preserves later specifically logged doses', () => {
  const data=snapshot(fixture({medicationCourses:[course()],medicationAdministrations:[dose(4),dose(6)]}));
  assert.equal(api.chartEnd(),date(4));assert.equal(data.predThrough,date(4));
  assert.match(data.predSummary,/Oct 6/);assert.doesNotMatch(data.predSummary,/Oct 5/);
  assert.doesNotMatch(data.predSummary,/through Oct 6/);
});
test('held and conflicting same-day doses are excluded from continuous course', () => {
  const data=snapshot(fixture({medicationCourses:[course()],medicationAdministrations:[dose(4),dose(5,{status:'held'}),dose(6),dose(7),dose(7,{id:'held-seven',status:'held'})]}));
  assert.equal(api.chartEnd(),date(4));assert.equal(data.predExceptions.length,3);
  assert.match(data.medicationText,/10 mg held on Oct 5/);assert.match(data.medicationText,/Oct 7/);
});
test('changed and unknown doses are reported separately rather than extending an old regimen', () => {
  const data=snapshot(fixture({medicationCourses:[course()],medicationAdministrations:[dose(4),dose(5,{dose:'5 mg'}),dose(6,{dose:''}),dose(7)]}));
  assert.equal(api.chartEnd(),date(4));assert.match(data.medicationText,/5 mg given on Oct 5/);assert.match(data.medicationText,/dose not recorded given on Oct 6/);
  assert.match(data.predSummary,/Oct 7/);assert.doesNotMatch(data.predSummary,/Oct 5|Oct 6/);
});
test('explicit contradiction inside stored confirmedThrough is not silently overwritten', () => {
  const data=snapshot(fixture({medicationCourses:[course({confirmedThrough:date(8)})],medicationAdministrations:[dose(5,{dose:'5 mg'})]}));
  assert.equal(api.chartEnd(),date(4));assert.match(data.medicationText,/5 mg given on Oct 5/);
  assert.doesNotMatch(data.predSummary,/Oct 2, 2026–Oct 8/);
  assert.equal(api.state().medicationCourses[0].confirmedThrough,date(8));
});
test('closed courses do not absorb later doses and a new regimen limits an open course', () => {
  snapshot(fixture({medicationCourses:[course({endDate:date(3)})],medicationAdministrations:[dose(4)]}));
  assert.equal(api.chartEnd(),date(3));
  const data=snapshot(fixture({medicationCourses:[course(),course({id:'new-course',startDate:date(5),confirmedThrough:date(7),dose:'5 mg'})],medicationAdministrations:[dose(4),dose(5)]}));
  assert.equal(api.chartEnd(0),date(4));assert.equal(api.chartEnd(1),null);
  assert.match(data.medicationText,/5 mg/);assert.match(data.medicationText,/10 mg given on Oct 5/);
});
test('custom range excludes future evidence and includes each relevant prednisone regimen', () => {
  const data=snapshot(fixture({medicationCourses:[course({endDate:date(5)}),course({id:'second-course',startDate:date(6),confirmedThrough:date(7),dose:'5 mg'})],medicationAdministrations:[dose(8,{dose:'5 mg'}),dose(9,{dose:'5 mg'})]}),date(4),date(8));
  assert.equal(data.predThrough,date(8));assert.match(data.medicationText,/10 mg/);assert.match(data.medicationText,/5 mg/);
  assert.doesNotMatch(data.medicationText,/Oct 9|Oct 2|Oct 3/);
});
test('custom period after a course confirmation does not invent current use', () => {
  const data=snapshot(fixture({medicationCourses:[course()]}),date(10),date(14));
  assert.match(data.predSummary,/last supported dose before this period was Oct 3/);
  assert.doesNotMatch(data.predSummary,/daily use confirmed for Oct 10/);
});
test('non-daily or unconfirmed prescriptions never gain inferred daily extension', () => {
  snapshot(fixture({medicationCourses:[course({frequency:'Every 48 hours'})],medicationAdministrations:[dose(4)]}));assert.equal(api.chartEnd(),date(3));
  snapshot(fixture({medicationCourses:[course({status:'prescribed'})],medicationAdministrations:[dose(4)]}));assert.equal(api.chartEnd(),date(3));
});
test('Cerenia uses medication ID, retains dose/status/dates, and is not duplicated by display name', () => {
  const data=snapshot(fixture({medicationAdministrations:[dose(5,{medicationId:'med-cerenia',dose:'60 mg'}),dose(7,{medicationId:'med-cerenia',dose:'30 mg',status:'held'})]}));
  assert.equal((data.medicationText.match(/Cerenia/g)||[]).length,1);
  assert.match(data.medicationText,/60 mg given on Oct 5/);assert.match(data.medicationText,/30 mg held on Oct 7/);
  assert.equal(data.cerenia.given.length,1);
});
test('latest prior journal weight and lab cutoff remain source-faithful', () => {
  const data=snapshot(fixture({observations:[observation(8,{weightLb:45})],labs:[{metric:'Neutrophils',date:date(7),value:4,unit:'K/µL'},{metric:'Neutrophils',date:date(14),value:8,unit:'K/µL'}]}),date(10),date(12));
  assert.equal(data.latestWeight.date,date(8));assert.match(data.weightText,/before this period: 45 lb/);
  assert.equal(data.latestNeut.value,4);assert.doesNotMatch(data.clinicalText,/8 K/);
});
test('medication ledger no longer asserts uninterrupted dosing across a gap', () => {
  snapshot(fixture({medicationCourses:[course()],medicationAdministrations:[dose(6)]}));
  const html=api.medicationLedger();assert.doesNotMatch(html,/Owner confirms daily use from .* through/);assert.match(html,/Oct 6/);
});
test('medication journal can omit purchases while Costs retains them', () => {
  snapshot(fixture({medicationCourses:[course()],medicationPurchases:[{medicationId:'med-prednisone',date:date(2),quantity:20,tabletStrengthMg:20,amountPaid:15,source:'synthetic invoice'}]}));
  const usage=api.medicationLedger(false),costs=api.medicationLedger();
  assert.doesNotMatch(usage,/tablets purchased|documented spending|synthetic invoice|Purchase details not recorded/);
  assert.match(usage,/daily use confirmed/);assert.match(costs,/synthetic invoice/);
});
test('snapshot functions never require a treatment or weight to produce a summary', () => {
  const data=snapshot(fixture({treatments:[],observations:[]}));
  assert.equal(data.latestWeight,null);assert.match(narrative(data),/no home observations/);
  assert.doesNotMatch(narrative(data),/0.0 lb|NaN|undefined/);
});
test('PDF preserves dates and wraps the long source/unknown-data caveat', () => {
  snapshot(fixture({medicationCourses:[course()],medicationAdministrations:[dose(4)]}));
  const pdf=api.pdf();
  assert.match(pdf,/daily use confirmed for Oct 2-4, 2026/);
  const lines=[...pdf.matchAll(/BT \/F[12] ([0-9.]+) Tf 1 0 0 1 ([0-9.]+) [0-9.]+ Tm \((.*)\) Tj ET/g)];
  const sourceLines=lines.filter(match=>/Owner observations are|unlogged days remain unknown|diagnose cause/.test(match[3]));
  assert.ok(sourceLines.length>=2,'source caveat should occupy multiple wrapped lines');
  for(const match of sourceLines)assert.ok(Number(match[2])+match[3].length*Number(match[1])*0.6<=567,'source caveat must stay inside the right margin');
  assert.match(pdf,/Care plan dates on file/);
});
test('commas preserve negation across symptom lists and compound descriptions', () => {
  for(const text of ['No blood, black/tarry stool, or diarrhea.','No black, tarry stool.','No nausea, lip licking or drooling.']){
    const data=snapshot(fixture({observations:[observation(4,{gi:text})]}));
    assert.equal(data.bloodDays.length,0,text);assert.equal(data.blackTarryDays.length,0,text);assert.equal(data.looseDays.length,0,text);assert.equal(data.nauseaDays.length,0,text);
    assert.doesNotMatch(narrative(data),/My notes include|I noticed/);
  }
});
test('clinical blood testing is not bleeding even beside a stool description', () => {
  for(const text of ['Stool was normal after his blood test.','Normal stool after blood was drawn.','Stool normal; blood pressure discussed.']){
    const data=snapshot(fixture({observations:[observation(4,{notes:text})]}));assert.equal(data.bloodDays.length,0,text);
  }
  const data=snapshot(fixture({observations:[observation(4,{notes:'Blood in stool after the blood test.'})]}));assert.equal(data.bloodDays.length,1);
});
test('conditional advice and discussion do not become observations', () => {
  for(const text of ['Watch for blood in stool.','Call the vet if black/tarry stool develops.','Discussed nausea with vet.','Monitor for diarrhea.']){
    const data=snapshot(fixture({observations:[observation(4,{gi:text})]}));
    assert.equal(data.bloodDays.length,0,text);assert.equal(data.blackTarryDays.length,0,text);assert.equal(data.looseDays.length,0,text);assert.equal(data.nauseaDays.length,0,text);
    assert.doesNotMatch(narrative(data),/My notes include|I noticed/);
  }
});
test('uncertain questions are quoted for review rather than counted as confirmed symptoms', () => {
  const data=snapshot(fixture({observations:[observation(4,{gi:'Could this be tarry stool?'}),observation(5,{notes:'Possible blood in stool after the blood test.'}),observation(6,{nauseaOther:'Could this be nausea?',nausea:1})]}));
  assert.equal(data.bloodDays.length,0);assert.equal(data.blackTarryDays.length,0);assert.equal(data.nauseaDays.length,0);assert.equal(data.noteReviews.length,3);
  assert.match(narrative(data),/Could this be tarry stool\?/);assert.match(narrative(data),/Possible blood in stool after the blood test/);
  assert.match(narrative(data),/not counted as confirmed symptoms/);assert.doesNotMatch(narrative(data),/I noticed/);
});
test('structured positive flags survive conflicting negative/instructional notes', () => {
  const data=snapshot(fixture({observations:[observation(4,{gi:'No blood, black/tarry stool, or diarrhea.',stoolEvents:[{status:'observed',flags:['black_tarry'],consistency:'watery'}],nausea:0,nauseaSigns:['drooling'],notes:'Discussed nausea with vet.'})]}));
  assert.equal(data.blackTarryDays.length,1);assert.equal(data.looseDays.length,1);assert.equal(data.nauseaDays.length,1);
  assert.match(narrative(data),/I noticed drooling \/ extra saliva on Oct 4/);
});
test('explicit new observations after a comma or contrast still count', () => {
  for(const text of ['No blood, stool was watery.','No diarrhea, but bright red blood in stool.','Blood in stool, discussed with vet.']){
    const data=snapshot(fixture({observations:[observation(4,{gi:text})]}));
    assert.ok(data.looseDays.length||data.bloodDays.length,text);
  }
});
test('supported course spans retain dates after an internal held dose without bridging it', () => {
  snapshot(fixture({medicationCourses:[course({confirmedThrough:date(8)})],medicationAdministrations:[dose(5,{status:'held'})]}));
  assert.equal(JSON.stringify(api.spans()),JSON.stringify([{start:date(2),end:date(4)},{start:date(6),end:date(8)}]));
});
test('course spans keep gaps unknown and preserve regimen boundaries', () => {
  snapshot(fixture({medicationCourses:[course(),course({id:'second',startDate:date(8),confirmedThrough:date(10),dose:'5 mg'})],medicationAdministrations:[dose(4),dose(6),dose(7)]}));
  assert.equal(JSON.stringify(api.spans()),JSON.stringify([{start:date(2),end:date(4)},{start:date(6),end:date(7)}]));
  assert.equal(JSON.stringify(api.spans(1)),JSON.stringify([{start:date(8),end:date(10)}]));
  const data=api.data();assert.match(data.medicationText,/A missing dose log does not mean a dose was missed/);assert.match(narrative(data),/A missing dose log does not mean a dose was missed/);
});
test('recent owner notes are newest-first, distinct, nonempty, and bounded to the selected dates', () => {
  const data=snapshot(fixture({observations:[
    observation(1,{notes:'Outside before'}),observation(4,{notes:'First note'}),observation(5,{notes:'Repeated note'}),
    observation(6,{notes:'Second note'}),observation(7,{notes:'Repeated note'}),observation(8,{notes:'   \n '}),
    observation(9,{notes:'Latest note'}),observation(14,{notes:'Outside after'})
  ]}),date(4),date(9));
  assert.equal(JSON.stringify(data.recentOwnerNotes.map(note=>[note.date,note.text])),JSON.stringify([[date(9),'Latest note'],[date(7),'Repeated note'],[date(6),'Second note']]));
  assert.equal(data.recentOwnerNotes.length,3);
});
test('same-day owner notes retain their exact wording and deterministic newest-entry order', () => {
  const original='  Synthetic wording & <important> \nSecond line — unchanged ✅  ';
  const value=fixture({observations:[observation(4,{id:'earlier',notes:'Earlier same-day note'}),observation(4,{id:'later',notes:original})]});
  const before=JSON.stringify(value),data=snapshot(value,date(4),date(4));
  assert.equal(data.recentOwnerNotes[0].id,'later');assert.equal(data.recentOwnerNotes[0].text,original);
  assert.equal(JSON.stringify(api.state()),before);assert.equal(JSON.stringify(value),before);
});
test('owner notes escape markup without truncating or interpreting source wording', () => {
  const original='<script>syntheticOnly()</script> & "quoted"\n'+'Long original phrase. '.repeat(80)+'FINAL ORIGINAL WORDS ✅';
  const data=snapshot(fixture({observations:[observation(4,{notes:original})]}));
  const interactive=api.ownerNotes(data,{interactive:true}),exported=api.ownerNotes(data);
  for(const html of [interactive,exported]){
    assert.match(html,/&lt;script&gt;syntheticOnly\(\)&lt;\/script&gt;/);assert.doesNotMatch(html,/<script>/);
    assert.match(html,/FINAL ORIGINAL WORDS ✅/);assert.equal((html.match(/Long original phrase\./g)||[]).length,80);
    assert.match(html,/white-space:pre-wrap/);assert.match(html,/overflow-wrap:anywhere/);assert.match(html,/Oct 4, 2026/);
  }
  assert.match(interactive,/data-nav="journal"/);assert.doesNotMatch(exported,/data-nav=/);
});
test('full HTML export contains the original-note section after the concise snapshot', () => {
  const value=fixture({observations:[observation(4,{notes:'Synthetic exact original note.\nSecond original line.'})]});
  const before=JSON.stringify(value);snapshot(value);const html=api.html();
  assert.match(html,/Recent owner notes · original wording/);assert.match(html,/Synthetic exact original note\.\nSecond original line\./);
  assert.ok(html.indexOf('Recent owner notes · original wording')<html.indexOf('<h2>Medication courses</h2>'));
  assert.equal(JSON.stringify(api.state()),before);
});
test('PDF notes use a separate page, retain full text, and disclose unsupported characters', () => {
  const original='Synthetic owner’s wording — unchanged. ✅\n'+'syntheticword '.repeat(500)+'LAST_SENTENCE_RETAINED';
  snapshot(fixture({observations:[observation(4,{notes:original})]}));const pdf=api.pdf();
  assert.ok(pdf.indexOf('Recent owner notes')>pdf.indexOf('Treatment & medication context'));
  assert.ok(pdf.indexOf('Recent owner notes')<pdf.indexOf('Clinical history | concise review'));
  const renderedText=[...pdf.matchAll(/\((.*?)\) Tj ET/g)].map(match=>match[1].replace(/\\([\\()])/g,'$1')).join(' ');
  assert.match(renderedText,/PDF text rendering/);assert.match(renderedText,/exact original wording in Journal/);assert.match(renderedText,/bracketed Unicode codes/);
  assert.match(pdf,/\[U\+2705\]/);assert.equal((pdf.match(/syntheticword/g)||[]).length,500);assert.match(pdf,/LAST_SENTENCE_RETAINED/);
  assert.equal(api.notePdfText('owner’s — words'),'owner\'s - words');assert.doesNotMatch(api.notePdfText('owner’s — words'),/U\+2019|U\+2014/);
  assert.equal(api.data().recentOwnerNotes[0].text,original);
});
test('empty notes show an honest empty state and never create an empty PDF note page', () => {
  const data=snapshot(fixture({observations:[observation(4,{notes:' \n '})]}));
  assert.equal(data.recentOwnerNotes.length,0);assert.match(api.ownerNotes(data,{interactive:true}),/No written owner notes/);
  assert.doesNotMatch(api.pdf(),/Recent owner notes/);
});
test('identical wording on different dates remains separate; exact same-date duplicates collapse', () => {
  const data=snapshot(fixture({observations:[observation(4,{notes:'Repeated wording'}),observation(5,{id:'five-original',notes:'Repeated wording'}),observation(5,{id:'five-copy',notes:'Repeated wording'}),observation(6,{notes:'Repeated wording'})]}));
  assert.equal(JSON.stringify(data.recentOwnerNotes.map(note=>note.date)),JSON.stringify([date(6),date(5),date(4)]));
  assert.equal(data.recentOwnerNotes[1].id,'five-copy');
});
test('PDF pagination keeps short source blocks together without orphan-only overflow pages', () => {
  for(const visitCount of [0,5,7,9,12]){
    const visits=Array.from({length:visitCount},(_,index)=>({id:`synthetic-visit-${index}`,date:date(index+2),label:`Synthetic planned visit ${index+1}`}));
    snapshot(fixture({carePlan:{questions:[],visits},observations:[observation(4,{notes:'First synthetic original note.'}),observation(5,{notes:'Second synthetic original note.'})]}));
    const pdf=api.pdf(),streams=[...pdf.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map(match=>match[1]);
    const bodyLines=stream=>[...stream.matchAll(/1 0 0 1 [0-9.]+ ([0-9.]+) Tm \((.*?)\) Tj ET/g)].filter(match=>Number(match[1])>30).map(match=>match[2]);
    for(const stream of streams)assert.ok(bodyLines(stream).length>3,`no mostly blank orphan page with ${visitCount} visits`);
    const sourcePage=streams.find(stream=>stream.includes('Source and record checks'));
    assert.ok(sourcePage);assert.match(bodyLines(sourcePage).join(' '),/Record checks:[\s\S]*dose and frequency/);
    const notesPage=streams.find(stream=>stream.includes('Recent owner notes'));
    assert.ok(notesPage);assert.ok(bodyLines(notesPage).length>5);
  }
});
test('unrelated loose/watery GI prose never turns formed stool into a loose-stool finding', () => {
  for(const text of ['Loose skin around the mouth; drooling.','Loose jowls and watery eyes.','Drooling with watery saliva.','Loose skin around the mouth, stool was formed.','Stool was soft but formed; liquid medication was given.','Possible loose skin around his mouth; stool was formed.']){
    const value=fixture({observations:[observation(4,{gi:text,notes:text,stoolEvents:[{status:'observed',consistency:'soft_formed',score:4}]})]});
    const before=JSON.stringify(value),data=snapshot(value);
    assert.equal(data.looseDays.length,0,text);assert.doesNotMatch(data.stoolText,/Loose stool or diarrhea was described/);
    assert.doesNotMatch(narrative(data),/Loose stool or diarrhea was described/);assert.equal(data.noteReviews.length,0,text);
    assert.equal(JSON.stringify(api.state()),before);assert.equal(JSON.stringify(value),before);
  }
});
test('unrelated GI prose alone remains unknown for stool consistency', () => {
  const data=snapshot(fixture({observations:[observation(4,{gi:'Loose skin around the mouth and watery saliva.'})]}));
  assert.equal(data.looseDays.length,0);assert.equal(data.stoolRows.length,0);assert.match(data.stoolText,/No bowel-movement observations/);
});
test('explicit stool-linked prose and dedicated stool descriptions retain true findings', () => {
  for(const text of ['Loose stool in the evening.','Watery bowel movement.','Liquid poop.','Stool was loose.','Stools: watery.','His bowel movements were unformed.','No blood, stool was watery.','Diarrhea overnight.']){
    const data=snapshot(fixture({observations:[observation(4,{gi:text})]}));assert.equal(data.looseDays.length,1,text);
  }
  for(const text of ['loose','watery','liquid','unformed','mushy']){
    const data=snapshot(fixture({observations:[observation(4,{stoolEvents:[{status:'observed',notes:text}]})]}));assert.equal(data.looseDays.length,1,text);
  }
});
test('stool-specific context preserves negation, uncertainty, and independent structured positives', () => {
  let data=snapshot(fixture({observations:[observation(4,{gi:'No loose or watery stools; watery saliva only.',stoolEvents:[{status:'observed',consistency:'formed_firm'}]})]}));
  assert.equal(data.looseDays.length,0);
  data=snapshot(fixture({observations:[observation(4,{gi:'Could this be watery stool?'})]}));
  assert.equal(data.looseDays.length,0);assert.equal(data.noteReviews.length,1);assert.match(narrative(data),/Could this be watery stool/);
  data=snapshot(fixture({observations:[observation(4,{gi:'Watery saliva; no diarrhea.',stoolEvents:[{status:'observed',consistency:'watery',flags:['bright_red_blood']}]})]}));
  assert.equal(data.looseDays.length,1);assert.equal(data.brightRedStoolDays.length,1);
});
test('bare GI adjectives without a stool subject remain unknown', () => {
  for(const text of ['loose','watery','liquid','unformed','mushy']){
    const data=snapshot(fixture({observations:[observation(4,{gi:text})]}));assert.equal(data.looseDays.length,0,text);assert.equal(data.stoolRows.length,0,text);
  }
});
test('dedicated stool notes still exclude explicitly unrelated subjects', () => {
  for(const text of ['loose skin around mouth','loose jowls','watery saliva','watery eyes','liquid medication','mushy food']){
    const data=snapshot(fixture({observations:[observation(4,{stoolEvents:[{status:'observed',consistency:'formed_firm',notes:text}]})]}));assert.equal(data.looseDays.length,0,text);
  }
});
test('trailing negatives apply equally to dedicated stool and event notes', () => {
  for(const field of ['stool','event']){
    for(const text of ['Loose stools were not observed','Watery stool absent','Blood in stool was not seen']){
      const entry=observation(4,field==='event'?{stoolEvents:[{status:'observed',notes:text}]}:{stool:text});
      const data=snapshot(fixture({observations:[entry]}));
      assert.equal(data.looseDays.length,0,`${field}: ${text}`);assert.equal(data.bloodDays.length,0,`${field}: ${text}`);
      assert.equal(data.noteReviews.length,0,`${field}: ${text}`);
    }
  }
});
test('blood outside stool context is not converted to stool bleeding', () => {
  for(const text of ['Blood in saliva, stool formed.','Stool formed, blood from mouth.','Blood work reviewed, stool formed.']){
    const data=snapshot(fixture({observations:[observation(4,{gi:text})]}));assert.equal(data.bloodDays.length,0,text);
  }
  for(const text of ['Bright red blood in stool.','Stool had blood.','Black/tarry stool.']){
    const data=snapshot(fixture({observations:[observation(4,{gi:text})]}));assert.equal(data.bloodDays.length,1,text);
  }
});
test('compact stool-context table preserves direct links and rejects adjacent unrelated subjects', () => {
  const cases=[
    ['gi','Normal stool with watery saliva',0,0],
    ['gi','Normal stool with loose skin around mouth',0,0],
    ['gi','Stool with blood from gums',0,0],
    ['gi','Blood mixed in stool',0,1],
    ['gi','Blood noted in stool',0,1],
    ['gi','Blood streaks on stool',0,1],
    ['gi','Stool had red blood',0,1],
    ['gi','Bright red blood mixed with stool',0,1],
    ['gi','Watery stool absent',0,0],
    ['gi','Watery eyes; mushy food; liquid medicine',0,0],
    ['gi','Unformed feces',1,0],
    ['event','black/tarry saliva',0,0],
    ['event','black/tarry stool',0,1],
    ['event','saliva was watery',0,0],
    ['event','skin was loose',0,0],
    ['event','Watery; possible blood?',1,0,1]
  ];
  for(const [field,text,loose,blood,review] of cases){
    const entry=observation(4,{stoolEvents:[{status:'observed',score:3,consistency:'formed_firm',notes:''}]});
    if(field==='event')entry.stoolEvents[0].notes=text;else entry[field]=text;
    const value=fixture({observations:[entry]}),before=JSON.stringify(value),data=snapshot(value);
    assert.equal(data.looseDays.length,loose,text);assert.equal(data.bloodDays.length,blood,text);
    if(review!==undefined)assert.equal(data.noteReviews.length,review,text);
    api.html();api.pdf();assert.equal(JSON.stringify(api.state()),before,text);assert.equal(JSON.stringify(value),before,text);
  }
});
let passed=0;
for(const {name,run} of tests){try{run();console.log(`PASS ${name}`);passed++;}catch(error){console.error(`FAIL ${name}\n${error.stack}`);process.exitCode=1;}}
console.log(`${passed}/${tests.length} Care Snapshot tests passed.`);
