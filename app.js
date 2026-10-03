'use strict';

const STORAGE_KEY = 'rogerCareState_v1';
const DOC_DB = 'rogerCareDocuments_v1';
const DOC_STORE = 'documents';

const els = {};
let state = null;
let timelineFilter = 'all';
let careTeamMode = false;

const q = sel => document.querySelector(sel);
const qa = sel => [...document.querySelectorAll(sel)];
const money = value => Number(value || 0).toLocaleString('en-US', {style:'currency', currency:'USD'});
const esc = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
const fmtDate = iso => {
  if (!iso) return 'Unknown date';
  const [y,m,d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y,m-1,d,12)).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
};
const todayIso = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
};
const uid = prefix => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2,8)}`;

async function boot(){
  cacheEls();
  bindNav();
  bindDialogs();
  bindForms();
  bindExports();
  bindProfilePhoto();
  bindOverlayControls();
  await loadState();
  await loadDocuments();
  renderAll();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

function cacheEls(){
  ['statusHero','metricStrip','latestObservation','clinicalCourse','homeCostSummary','openItems','journalSummary','journalEntries','timelineEntries','costSummary','estimateComparison','costEntries','profileDetails','documentList','profilePhoto','profileInitial','petName','petSubtitle','careModeButton','journalDialog','costDialog'].forEach(id => els[id] = q(`#${id}`));
}

async function loadState(){
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try { state = JSON.parse(saved); return; } catch (_) {}
  }
  const response = await fetch('./data/seed.json');
  state = await response.json();
  persist();
}

function persist(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function bindNav(){
  qa('[data-nav]').forEach(btn => btn.addEventListener('click', () => navigate(btn.dataset.nav)));
}
function navigate(view){
  qa('.view').forEach(v => v.classList.toggle('active', v.dataset.view === view));
  qa('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.nav === view));
  window.scrollTo({top:0,behavior:'smooth'});
}

function bindDialogs(){
  q('#openJournalComposer').addEventListener('click', openJournalDialog);
  q('#journalAddButton').addEventListener('click', openJournalDialog);
  q('#costAddButton').addEventListener('click', () => {
    q('#costDate').value = todayIso();
    els.costDialog.showModal();
  });
  qa('[data-close-dialog]').forEach(btn => btn.addEventListener('click', () => q(`#${btn.dataset.closeDialog}`).close()));
  qa('.sheet-dialog').forEach(d => d.addEventListener('click', event => {
    const r = d.getBoundingClientRect();
    if (event.clientY < r.top) d.close();
  }));
  q('#careModeButton').addEventListener('click', () => {
    careTeamMode = !careTeamMode;
    document.body.classList.toggle('care-team-mode', careTeamMode);
    q('#careModeButton').setAttribute('aria-pressed', String(careTeamMode));
    q('#careModeButton').textContent = careTeamMode ? 'Owner view' : 'Care team';
    toast(careTeamMode ? 'Care-team view enabled' : 'Owner view enabled');
  });
  qa('[data-timeline-filter]').forEach(btn => btn.addEventListener('click', () => {
    timelineFilter = btn.dataset.timelineFilter;
    qa('[data-timeline-filter]').forEach(b => b.classList.toggle('active', b === btn));
    renderTimeline();
  }));
}

function openJournalDialog(){
  q('#journalDate').value = todayIso();
  q('#journalForm').reset();
  q('#journalDate').value = todayIso();
  els.journalDialog.showModal();
}

function bindForms(){
  q('#journalForm').addEventListener('submit', event => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const obs = {
      id: uid('obs'), date: fd.get('date'), appetite: fd.get('appetite'), energy: fd.get('energy'),
      nausea: Number(fd.get('nausea') || 0), vomiting: Number(fd.get('vomiting') || 0), stool: fd.get('stool'),
      hydration: fd.get('hydration'), urination: fd.get('urination'), pain: Number(fd.get('pain') || 0),
      medications: String(fd.get('medications') || '').split(',').map(x=>x.trim()).filter(Boolean),
      notes: fd.get('notes'), source:'owner_observation'
    };
    state.observations.push(obs);
    state.observations.sort((a,b)=>a.date.localeCompare(b.date));
    persist(); renderAll(); els.journalDialog.close(); toast('Observation saved');
  });

  q('#costForm').addEventListener('submit', event => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    state.costs.push({
      id: uid('cost'), date: fd.get('date'), provider: fd.get('provider'), label: fd.get('label'),
      amountPaid: Number(fd.get('amountPaid')), category: fd.get('category'), status:'confirmed', source:'owner_entered'
    });
    state.costs.sort((a,b)=>a.date.localeCompare(b.date));
    persist(); renderAll(); els.costDialog.close(); event.currentTarget.reset(); toast('Cost saved');
  });

  q('#documentForm').addEventListener('submit', async event => {
    event.preventDefault();
    const file = q('#documentFile').files[0];
    if (!file) return;
    try {
      await saveDocument({
        id: uid('doc'), file, date:q('#documentDate').value, type:q('#documentType').value,
        provider:q('#documentProvider').value.trim(), note:q('#documentNote').value.trim(), name:file.name,
        mime:file.type || 'application/octet-stream', size:file.size, createdAt:new Date().toISOString()
      });
      event.currentTarget.reset(); q('#documentDate').value = todayIso();
      await loadDocuments(); renderDocuments(); toast('Document saved on this device');
    } catch (err) { toast('Could not save document on this device', true); }
  });
}

function bindProfilePhoto(){
  q('#profilePhotoButton').addEventListener('click', () => q('#profilePhotoInput').click());
  q('#profilePhotoInput').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      const dataUrl = await compressImage(file, 720, 0.82);
      state.profile.photoDataUrl = dataUrl; persist(); renderProfile(); toast('Profile photo updated');
    } catch (_) { toast('Could not use that photo', true); }
  });
}

function compressImage(file,maxSize,quality){
  return new Promise((resolve,reject)=>{
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1,maxSize/Math.max(img.width,img.height));
      const canvas = document.createElement('canvas'); canvas.width=Math.round(img.width*scale); canvas.height=Math.round(img.height*scale);
      canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
      URL.revokeObjectURL(url); resolve(canvas.toDataURL('image/jpeg',quality));
    };
    img.onerror = () => {URL.revokeObjectURL(url); reject(new Error('image'));};
    img.src=url;
  });
}

function bindOverlayControls(){
  const metric = q('#overlayMetric');
  if (!metric) return;
  metric.addEventListener('change', renderTreatmentOverlay);
}

function renderAll(){
  renderProfile(); renderHome(); renderTreatmentOverlay(); renderJournal(); renderTimeline(); renderCosts(); renderProfileDetails(); renderDocuments();
}

function renderProfile(){
  const p = state.profile;
  els.petName.textContent = p.name;
  els.petSubtitle.textContent = `${p.breed} · ${p.sex} · ${p.reproductiveStatus}`;
  if (p.photoDataUrl) { els.profilePhoto.src=p.photoDataUrl; els.profilePhoto.hidden=false; els.profileInitial.hidden=true; }
  else { els.profilePhoto.hidden=true; els.profileInitial.hidden=false; els.profileInitial.textContent=p.name.slice(0,1).toUpperCase(); }
}

function totalPaid(){ return state.costs.reduce((s,c)=>s+Number(c.amountPaid||0),0); }
function confirmedPaid(){ return state.costs.filter(c=>c.status==='confirmed').reduce((s,c)=>s+Number(c.amountPaid||0),0); }
function provisionalPaid(){ return state.costs.filter(c=>c.status!=='confirmed').reduce((s,c)=>s+Number(c.amountPaid||0),0); }
function latestTreatment(){ return [...state.treatments].sort((a,b)=>b.number-a.number)[0]; }
function latestObservation(){ return [...state.observations].sort((a,b)=>b.date.localeCompare(a.date))[0]; }
function metricLatest(name){ return [...state.labs].filter(x=>x.metric===name).sort((a,b)=>b.date.localeCompare(a.date))[0]; }

function renderHome(){
  const t = latestTreatment();
  els.statusHero.innerHTML = `
    <div class="hero-row"><div><div class="hero-title">Treatment ${t.number} of 8 complete</div><div class="hero-sub">${esc(state.profile.diagnosis)}</div></div><div class="status-pill">Restaging: no metastasis identified</div></div>
    <div class="progress-wrap"><div class="progress-track"><div class="progress-fill" style="width:${(t.number/8)*100}%"></div></div><div class="progress-copy"><span>${t.number}/8 vinblastine</span><span>${Math.round((t.number/8)*100)}%</span></div></div>`;
  const neut=metricLatest('Neutrophils'), hct=metricLatest('Hematocrit');
  els.metricStrip.innerHTML = [
    ['LATEST WEIGHT',`${t.weightLb} lb`,fmtDate(t.date)],
    ['VINBLASTINE',`${t.doseMg} mg`,`${t.doseMgM2} mg/m²`],
    ['NEUTROPHILS',`${neut.value} ${neut.unit}`,fmtDate(neut.date)],
    ['HEMATOCRIT',`${hct.value}${hct.unit}`,fmtDate(hct.date)],
    ['OWNER PAID',money(totalPaid()),'through '+fmtDate(state.costs[state.costs.length-1].date)]
  ].map(m=>`<div class="metric-card"><div class="metric-label">${m[0]}</div><div class="metric-value">${m[1]}</div><div class="metric-note">${m[2]}</div></div>`).join('');

  const obs=latestObservation();
  els.latestObservation.innerHTML = obs ? `<div class="row-between"><div><div class="item-title">${fmtDate(obs.date)}</div><div class="item-meta">Latest owner observation</div></div>${severityChip(obs)}</div><div class="item-copy">${esc(obs.notes)}</div>` : 'No observations yet.';

  els.clinicalCourse.innerHTML = state.treatments.map(tr => {
    const nextObs = state.observations.find(o=>o.date>=tr.date && daysBetween(tr.date,o.date)<=5);
    const postLab = state.labs.filter(l=>l.metric==='Neutrophils' && l.date>tr.date && daysBetween(tr.date,l.date)<=9).sort((a,b)=>a.date.localeCompare(b.date))[0];
    const pieces=[];
    pieces.push(`${tr.doseMg} mg (${tr.doseMgM2} mg/m²)`);
    if(postLab) pieces.push(`neutrophils ${postLab.value} ${postLab.unit} ${daysBetween(tr.date,postLab.date)}d later`);
    if(nextObs) pieces.push(`owner: ${compactObservation(nextObs)}`);
    return `<div class="course-row"><div class="course-date">${fmtDate(tr.date)}</div><div class="course-title">Chemo #${tr.number}</div><div class="course-copy">${esc(pieces.join(' → '))}</div></div>`;
  }).join('');

  els.homeCostSummary.innerHTML = `<div class="estimate-grid"><div class="estimate-box"><div class="section-kicker">TOTAL PAID</div><div class="estimate-value">${money(totalPaid())}</div><div class="estimate-note">All documented care since mass workup, including the mixed surgery/dental day.</div></div><div class="estimate-box"><div class="section-kicker">ORIGINAL K-STATE COURSE ESTIMATE</div><div class="estimate-value">$3,500–$4,000</div><div class="estimate-note">8/4 oncology note; primary-vet pre-treatment bloodwork was excluded from the per-injection estimate.</div></div></div>`;

  const open=[];
  open.push('Treatments #6–#8 and final restaging remain in the planned protocol.');
  open.push('Verify the duplicate vinblastine billing lines on the 10/2 K-State invoice.');
  open.push('Reconcile the 7/14 Optimum surgery/dental invoice when received.');
  els.openItems.innerHTML = open.map(x=>`<div class="open-item"><span class="open-dot"></span><div class="item-copy" style="margin:0">${esc(x)}</div></div>`).join('');
}

function compactObservation(o){
  const parts=[]; if(o.energy)parts.push(`energy ${o.energy}`); if(o.nausea)parts.push(`nausea ${['none','mild','moderate','severe'][o.nausea]}`); if(o.vomiting)parts.push(`${o.vomiting} vomit`); if(o.stool)parts.push(`stool ${o.stool}`); return parts.join(', ') || o.notes.slice(0,60);
}
function severityChip(o){
  if(o.nausea>=2 || o.vomiting>0 || Number(o.pain)>=2) return '<span class="chip warn">symptoms logged</span>';
  return '<span class="chip">stable / mild</span>';
}
function daysBetween(a,b){ return Math.round((new Date(`${b}T12:00:00Z`)-new Date(`${a}T12:00:00Z`))/86400000); }

function renderTreatmentOverlay(){
  const root = q('#treatmentOverlayChart');
  const detail = q('#treatmentOverlayDetail');
  const selector = q('#overlayMetric');
  const legend = q('#overlayBloodLegend');
  if (!root || !detail || !selector || !state) return;

  const metric = selector.value || 'Neutrophils';
  if (legend) legend.textContent = metric;

  const blood = state.labs
    .filter(x => x.metric === metric)
    .slice()
    .sort((a,b) => a.date.localeCompare(b.date));
  const treatments = state.treatments.slice().sort((a,b) => a.date.localeCompare(b.date));
  const symptoms = state.observations
    .map(o => ({...o, severity: symptomSeverity(o)}))
    .filter(o => o.severity > 0)
    .sort((a,b) => a.date.localeCompare(b.date));

  if (!blood.length || !treatments.length) {
    root.innerHTML = '<div class="empty-state">Not enough treatment/lab data to draw the overlay yet.</div>';
    return;
  }

  const allDates = [
    ...blood.map(x => x.date),
    ...treatments.map(x => x.date),
    ...symptoms.map(x => x.date)
  ].sort();
  const start = treatments[0].date;
  const end = allDates[allDates.length - 1];
  const startMs = Date.parse(start + 'T12:00:00Z');
  const endMs = Date.parse(end + 'T12:00:00Z');
  const span = Math.max(1, endMs - startMs);

  const W=360, H=278, L=42, R=38, T=34, B=58;
  const plotBottom=194, symptomY=222;
  const x = date => L + ((Date.parse(date + 'T12:00:00Z') - startMs) / span) * (W-L-R);

  const thresholdMap = {Neutrophils:2, Hematocrit:25, Platelets:75};
  const unitMap = {Neutrophils:'K/µL', Hematocrit:'%', Platelets:'K/µL'};
  const threshold = thresholdMap[metric];
  const unit = unitMap[metric] || '';

  const bloodMaxRaw = Math.max(...blood.map(x=>Number(x.value)||0), threshold || 0);
  const bloodMax = Math.max(1, bloodMaxRaw * 1.12);
  const yBlood = value => plotBottom - (Number(value) / bloodMax) * (plotBottom-T);

  const doseMin=1.8, doseMax=2.65;
  const yDose = value => plotBottom - ((Number(value)-doseMin)/(doseMax-doseMin))*(plotBottom-T);

  let svg = '';
  // Horizontal grid + left blood axis.
  for(let i=0;i<4;i++){
    const value = bloodMax * (3-i)/3;
    const yy = T + i*(plotBottom-T)/3;
    const label = metric==='Platelets' ? Math.round(value) : (value<10 ? value.toFixed(1) : Math.round(value));
    svg += `<line x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}" stroke="#dce4df" stroke-width="1"/>`;
    svg += `<text x="${L-6}" y="${yy+4}" text-anchor="end" font-size="9" fill="#68766f">${label}</text>`;
  }
  svg += `<text x="6" y="18" font-size="9" font-weight="700" fill="#3e6f5d">${metric} ${unit}</text>`;

  // Right dose scale.
  [2.0,2.3,2.6].forEach(v=>{
    const yy=yDose(v);
    svg += `<text x="${W-3}" y="${yy+3}" text-anchor="end" font-size="8.5" fill="#97672c">${v.toFixed(1)}</text>`;
  });
  svg += `<text x="${W-3}" y="18" text-anchor="end" font-size="9" font-weight="700" fill="#97672c">Dose mg/m²</text>`;

  // Treatment event guides spanning the clinical plot into the symptom lane.
  treatments.forEach((tr,i)=>{
    const xx=x(tr.date);
    svg += `<line x1="${xx}" y1="${T}" x2="${xx}" y2="${symptomY+8}" stroke="#97672c" stroke-opacity=".24" stroke-dasharray="3 4"/>`;
    svg += `<text x="${xx}" y="29" text-anchor="middle" font-size="8.5" font-weight="800" fill="#97672c">#${tr.number}</text>`;
  });

  // Threshold.
  if (threshold != null && threshold <= bloodMax){
    const yy=yBlood(threshold);
    svg += `<line x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}" stroke="#68766f" stroke-dasharray="5 4" stroke-width="1.2"/>`;
    svg += `<text x="${W-R-2}" y="${yy-4}" text-anchor="end" font-size="8.5" fill="#68766f">treatment threshold</text>`;
  }

  // Blood line and points.
  const bloodPath = blood.map((p,i)=>`${i?'L':'M'}${x(p.date)},${yBlood(p.value)}`).join(' ');
  svg += `<path d="${bloodPath}" fill="none" stroke="#3e6f5d" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  blood.forEach((p,i)=>{
    const xx=x(p.date), yy=yBlood(p.value);
    svg += `<circle class="chart-hit" tabindex="0" data-kind="blood" data-index="${i}" cx="${xx}" cy="${yy}" r="5.5" fill="#3e6f5d" stroke="#fff" stroke-width="2.5"/>`;
  });

  // Dose line and points.
  const dosePath = treatments.map((tr,i)=>`${i?'L':'M'}${x(tr.date)},${yDose(tr.doseMgM2)}`).join(' ');
  svg += `<path d="${dosePath}" fill="none" stroke="#97672c" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  treatments.forEach((tr,i)=>{
    const xx=x(tr.date), yy=yDose(tr.doseMgM2);
    svg += `<circle class="chart-hit" tabindex="0" data-kind="treatment" data-index="${i}" cx="${xx}" cy="${yy}" r="5.5" fill="#97672c" stroke="#fff" stroke-width="2.5"/>`;
  });

  // Symptom lane.
  svg += `<line x1="${L}" y1="${symptomY}" x2="${W-R}" y2="${symptomY}" stroke="#dce4df"/>`;
  svg += `<text x="${L-6}" y="${symptomY+3}" text-anchor="end" font-size="8.5" fill="#944c4c">Sx</text>`;
  symptoms.forEach((o,i)=>{
    const xx=x(o.date), r=4.5 + Math.min(3,o.severity)*1.2;
    svg += `<circle class="chart-hit" tabindex="0" data-kind="symptom" data-index="${i}" cx="${xx}" cy="${symptomY}" r="${r}" fill="#944c4c" fill-opacity=".88" stroke="#fff" stroke-width="2"/>`;
  });

  // Date labels use treatment anchors, because those are the most meaningful dates here.
  treatments.forEach(tr=>{
    const xx=x(tr.date);
    const d=fmtDate(tr.date).replace(', 2026','');
    svg += `<text x="${xx}" y="260" text-anchor="middle" font-size="8" fill="#68766f">${d}</text>`;
  });

  root.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Treatment response overlay chart">${svg}</svg>`;

  root.querySelectorAll('.chart-hit').forEach(node=>{
    const show = () => {
      const kind=node.dataset.kind, i=Number(node.dataset.index);
      if(kind==='blood'){
        const p=blood[i];
        detail.innerHTML=`<strong>${fmtDate(p.date)} · ${esc(metric)} ${esc(p.displayValue||p.value)} ${esc(p.unit)}</strong>${esc(p.context)} · ${esc(p.source)}`;
      } else if(kind==='treatment'){
        const tr=treatments[i];
        detail.innerHTML=`<strong>${fmtDate(tr.date)} · Chemo #${tr.number}</strong>Vinblastine ${tr.doseMg} mg · ${tr.doseMgM2} mg/m² · ${tr.weightLb} lb. ${esc(tr.doseReason)}`;
      } else {
        const o=symptoms[i];
        const meds=o.medications?.length ? ` Medication: ${esc(o.medications.join(', '))}.` : '';
        detail.innerHTML=`<strong>${fmtDate(o.date)} · Owner-observed symptoms</strong>${esc(compactObservation(o))}. ${esc(o.notes)}${meds}`;
      }
    };
    node.addEventListener('click',show);
    node.addEventListener('focus',show);
  });

  const first=treatments[0];
  const firstPost=blood.find(p=>p.date>first.date);
  detail.innerHTML = firstPost
    ? `<strong>Start at chemo #1</strong>${fmtDate(first.date)} · ${first.doseMg} mg (${first.doseMgM2} mg/m²), followed by ${metric.toLowerCase()} ${firstPost.displayValue||firstPost.value} ${firstPost.unit} on ${fmtDate(firstPost.date)}.`
    : 'Tap a chemo, lab, or symptom marker to inspect that point.';
}

function symptomSeverity(o){
  let s=0;
  s=Math.max(s,Number(o.nausea)||0,Number(o.pain)||0);
  if(Number(o.vomiting)>0) s=Math.max(s,2);
  const stool=parseFloat(o.stool);
  if(Number.isFinite(stool) && stool>=6) s=Math.max(s,2);
  if(String(o.energy||'').toLowerCase().includes('low')) s=Math.max(s,1);
  return s;
}

function renderJournal(){
  const obs=[...state.observations].sort((a,b)=>b.date.localeCompare(a.date));
  const nauseaDays=obs.filter(o=>Number(o.nausea)>0).length, medDays=obs.filter(o=>o.medications?.length).length;
  els.journalSummary.innerHTML = [
    [obs.length,'ENTRIES'],[nauseaDays,'NAUSEA DAYS'],[medDays,'SUPPORTIVE-MED DAYS'],[obs.filter(o=>Number(o.vomiting)>0).reduce((s,o)=>s+Number(o.vomiting),0),'VOMITING EVENTS']
  ].map(x=>`<div class="summary-tile"><div class="summary-value">${x[0]}</div><div class="summary-label">${x[1]}</div></div>`).join('');
  els.journalEntries.innerHTML = obs.map(o=>`<article class="observation-card"><div class="row-between"><div><div class="item-title">${fmtDate(o.date)}</div><div class="item-meta">Owner observation</div></div>${severityChip(o)}</div><div class="chip-row">${observationChips(o)}</div><div class="item-copy">${esc(o.notes)}</div>${o.medications?.length?`<div class="item-meta" style="margin-top:8px"><strong>Medication:</strong> ${esc(o.medications.join(', '))}</div>`:''}</article>`).join('');
}
function observationChips(o){
  const chips=[];
  if(o.appetite)chips.push(`appetite: ${o.appetite}`); if(o.energy)chips.push(`energy: ${o.energy}`); if(o.nausea)chips.push(`nausea: ${['none','mild','moderate','severe'][o.nausea]}`); if(o.vomiting)chips.push(`vomiting: ${o.vomiting}`); if(o.stool)chips.push(`stool: ${o.stool}`); if(o.hydration)chips.push(`hydration: ${o.hydration}`); if(o.urination)chips.push(`${o.urination}`); if(o.pain)chips.push(`pain: ${o.pain}/3`);
  return chips.map(x=>`<span class="chip">${esc(x)}</span>`).join('');
}

function renderTimeline(){
  const events=[];
  state.milestones.forEach(x=>events.push({date:x.date,kind:'clinical',source:x.source,title:x.title,detail:x.detail}));
  state.treatments.forEach(x=>events.push({date:x.date,kind:'clinical',source:x.source,title:`Vinblastine #${x.number} · ${x.doseMg} mg`,detail:`${x.doseMgM2} mg/m² · ${x.weightLb} lb · ${x.doseReason}`}));
  state.labs.forEach(x=>{ if(['Neutrophils','ALT','ALP'].includes(x.metric)) events.push({date:x.date,kind:'clinical',source:x.source,title:`${x.metric}: ${x.displayValue||x.value} ${x.unit}`,detail:x.context}); });
  state.observations.forEach(x=>events.push({date:x.date,kind:'owner',source:'Owner observation',title:'Home observation',detail:x.notes}));
  const filtered=events.filter(x=>timelineFilter==='all'||x.kind===timelineFilter).sort((a,b)=>b.date.localeCompare(a.date));
  els.timelineEntries.innerHTML=filtered.map(x=>`<article class="timeline-entry ${x.kind==='owner'?'owner':''}"><div class="timeline-date">${fmtDate(x.date).replace(', 2026','')}</div><div class="timeline-line"><div class="timeline-dot"></div></div><div class="timeline-content"><div class="source-label">${esc(x.source)}</div><div class="item-title">${esc(x.title)}</div><div class="item-copy">${esc(x.detail)}</div></div></article>`).join('');
}

function renderCosts(){
  const total=totalPaid(), confirmed=confirmedPaid(), provisional=provisionalPaid();
  els.costSummary.innerHTML=`<div class="cost-total"><div class="section-kicker" style="color:#dce8e3">TOTAL OWNER-PAID CARE</div><div class="cost-big">${money(total)}</div><div class="cost-sub">${money(confirmed)} confirmed · ${money(provisional)} provisional/unresolved</div></div>${categoryMeters()}`;
  const estimate=state.sourceNotes.find(x=>x.id==='src-ksu-0804');
  const treatmentAfterPlan=state.costs.filter(c=>c.date>'2026-08-04').reduce((s,c)=>s+Number(c.amountPaid||0),0);
  els.estimateComparison.innerHTML=`<div class="estimate-grid"><div class="estimate-box"><div class="section-kicker">SOURCE ESTIMATE · 8/4</div><div class="estimate-value">$3,500–$4,000</div><div class="estimate-note">Complete treatment course, per K-State oncology note. ${esc(estimate?.summary||'')}</div></div><div class="estimate-box"><div class="section-kicker">PAID SINCE 8/4</div><div class="estimate-value">${money(treatmentAfterPlan)}</div><div class="estimate-note">Treatment-course spending after the 8/4 oncology plan; the 8/4 staging visit itself is excluded from this comparison.</div></div></div>`;
  els.costEntries.innerHTML=[...state.costs].sort((a,b)=>b.date.localeCompare(a.date)).map(c=>`<article class="cost-card"><div class="row-between"><div><div class="item-title">${esc(c.label)}</div><div class="item-meta">${fmtDate(c.date)} · ${esc(c.provider)}</div></div><div class="cost-amount">${money(c.amountPaid)}</div></div><div class="chip-row"><span class="chip ${c.status==='confirmed'?'':'warn'}">${esc(c.status)}</span><span class="chip info">${esc(c.category.replaceAll('_',' '))}</span></div></article>`).join('');
}
function categoryMeters(){
  const groups={}; state.costs.forEach(c=>{groups[c.category]=(groups[c.category]||0)+Number(c.amountPaid||0);});
  const rows=Object.entries(groups).sort((a,b)=>b[1]-a[1]); const max=Math.max(...rows.map(r=>r[1]),1);
  return `<section class="card" style="box-shadow:none;margin-top:10px"><div class="section-kicker">BY CARE TYPE</div>${rows.map(([k,v])=>`<div class="cost-meter"><div class="cost-meter-row"><span>${esc(k.replaceAll('_',' '))}</span><strong>${money(v)}</strong></div><div class="meter-track"><div class="meter-fill" style="width:${(v/max)*100}%"></div></div></div>`).join('')}</section>`;
}

function renderProfileDetails(){
  const p=state.profile;
  els.profileDetails.innerHTML=[['Name',p.name],['Species',p.species],['Breed',p.breed],['Sex',`${p.sex} · ${p.reproductiveStatus}`],['DOB',fmtDate(p.dob)],['Diagnosis',p.diagnosis],['Current status',p.currentStatus]].map(x=>`<div class="profile-line"><div class="profile-key">${x[0]}</div><div class="profile-value">${esc(x[1])}</div></div>`).join('');
}

// Documents: IndexedDB stores the actual file blob locally.
let documents=[];
function openDocDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DOC_DB,1);
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(DOC_STORE))db.createObjectStore(DOC_STORE,{keyPath:'id'});};
    req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
  });
}
async function saveDocument(record){
  const db=await openDocDb(); return new Promise((resolve,reject)=>{const tx=db.transaction(DOC_STORE,'readwrite');tx.objectStore(DOC_STORE).put(record);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
}
async function loadDocuments(){
  try{const db=await openDocDb();documents=await new Promise((resolve,reject)=>{const tx=db.transaction(DOC_STORE,'readonly');const req=tx.objectStore(DOC_STORE).getAll();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error);});}catch(_){documents=[];}
}
function renderDocuments(){
  els.documentList.innerHTML=documents.length?documents.sort((a,b)=>b.date.localeCompare(a.date)).map(d=>`<article class="document-card"><div class="row-between"><div><div class="item-title">${esc(d.name)}</div><div class="item-meta">${fmtDate(d.date)} · ${esc(d.provider||d.type)}</div></div><button type="button" class="text-button" data-open-doc="${esc(d.id)}">Open</button></div>${d.note?`<div class="item-copy">${esc(d.note)}</div>`:''}</article>`).join(''):'<div class="empty-state">No documents saved on this device yet.</div>';
  qa('[data-open-doc]').forEach(btn=>btn.addEventListener('click',()=>openDocument(btn.dataset.openDoc)));
}
async function openDocument(id){
  const d=documents.find(x=>x.id===id); if(!d)return; const url=URL.createObjectURL(d.file); window.open(url,'_blank','noopener'); setTimeout(()=>URL.revokeObjectURL(url),60000);
}

function bindExports(){
  q('#downloadCareSummary').addEventListener('click',()=>downloadText('roger-care-team-summary.html',buildCareSummaryHtml(),'text/html'));
  q('#printCareSummary').addEventListener('click',()=>{const w=window.open('','_blank');if(!w)return toast('Pop-up blocked. Use Download instead.',true);w.document.write(buildCareSummaryHtml());w.document.close();w.focus();setTimeout(()=>w.print(),300);});
  q('#exportBackup').addEventListener('click',()=>downloadText('roger-care-backup.json',JSON.stringify(state,null,2),'application/json'));
  q('#importBackup').addEventListener('change',async event=>{const f=event.target.files[0];if(!f)return;try{const parsed=JSON.parse(await f.text());if(!parsed.profile||!parsed.treatments||!parsed.costs)throw new Error('shape');state=parsed;persist();renderAll();toast('Backup imported');}catch(_){toast('That backup could not be imported',true);}event.target.value='';});
}
function downloadText(filename,text,type){const blob=new Blob([text],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function buildCareSummaryHtml(){
  const p=state.profile,t=latestTreatment(),total=totalPaid();
  const rows=state.treatments.map(x=>`<tr><td>${fmtDate(x.date)}</td><td>#${x.number}</td><td>${x.doseMg} mg</td><td>${x.doseMgM2}</td><td>${x.weightLb} lb</td><td>${esc(x.doseReason)}</td></tr>`).join('');
  const labs=state.labs.filter(x=>['Neutrophils','Hematocrit','Platelets','ALT','ALP'].includes(x.metric)).sort((a,b)=>a.date.localeCompare(b.date)).map(x=>`<tr><td>${fmtDate(x.date)}</td><td>${esc(x.metric)}</td><td>${esc(x.displayValue||x.value)} ${esc(x.unit)}</td><td>${esc(x.context)}</td><td>${esc(x.source)}</td></tr>`).join('');
  const obs=[...state.observations].sort((a,b)=>a.date.localeCompare(b.date)).map(o=>`<tr><td>${fmtDate(o.date)}</td><td>${esc(compactObservation(o))}</td><td>${esc(o.medications?.join(', ')||'')}</td><td>${esc(o.notes)}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(p.name)} care-team summary</title><style>body{font-family:Arial,sans-serif;max-width:1000px;margin:32px auto;padding:0 18px;color:#17201d}h1{margin-bottom:4px}h2{margin-top:28px;border-bottom:1px solid #ddd;padding-bottom:6px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border-bottom:1px solid #ddd;padding:7px;text-align:left;vertical-align:top}.note{background:#f3f6f5;padding:12px;border-radius:8px}.money{font-size:28px;font-weight:700}</style></head><body><h1>${esc(p.name)} — longitudinal oncology summary</h1><p>${esc(p.breed)} · ${esc(p.sex)} · ${esc(p.reproductiveStatus)} · DOB ${fmtDate(p.dob)}</p><div class="note"><strong>Diagnosis:</strong> ${esc(p.diagnosis)}<br><strong>Current status:</strong> Vinblastine ${t.number}/8 complete.</div><h2>Clinical course</h2><p>Mid-protocol restaging on 9/18 found no evidence of mast cell tumor involvement in liver/spleen cytology and no ultrasonographic evidence of metastatic disease in the supplied K-State record.</p><table><thead><tr><th>Date</th><th>Treatment</th><th>Dose</th><th>mg/m²</th><th>Weight</th><th>Dose context</th></tr></thead><tbody>${rows}</tbody></table><h2>Selected labs</h2><table><thead><tr><th>Date</th><th>Metric</th><th>Result</th><th>Context</th><th>Source</th></tr></thead><tbody>${labs}</tbody></table><h2>Owner-observed course</h2><table><thead><tr><th>Date</th><th>Structured observation</th><th>Medication</th><th>Original note</th></tr></thead><tbody>${obs}</tbody></table><h2>Family financial burden</h2><div class="money">${money(total)} paid to date</div><p>Amounts shown are care costs only. No bank, card, payment-account, balance or transaction-source information is included.</p><p><strong>K-State 8/4 treatment estimate:</strong> approximately $3,500–$4,000 for the complete treatment course; approximately $250 per chemotherapy injection excluding primary-veterinarian pre-treatment bloodwork; restaging approximately $700.</p><h2>Record integrity</h2><p>Owner observations remain labeled as owner-reported. Clinical notes, labs and pathology remain labeled by source. Conflicting statements are not silently reconciled.</p></body></html>`;
}

function toast(message,isError=false){
  const node=q('#toastTemplate').content.firstElementChild.cloneNode(true);node.textContent=message;if(isError)node.classList.add('error');q('#toastRegion').appendChild(node);setTimeout(()=>node.remove(),2800);
}

document.addEventListener('DOMContentLoaded',boot);
