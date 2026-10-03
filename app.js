'use strict';

const STORAGE_KEY = 'rogerCareState_v1';
const DOC_DB = 'rogerCareDocuments_v1';
const DOC_STORE = 'documents';

const els = {};
let state = null;
let timelineFilter = 'all';
let careTeamMode = false;
let selectedTreatmentWindow = 'all';

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
  bindRefreshControl();
  await loadState();
  await loadDocuments();
  renderAll();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js', {updateViaCache:'none'}).catch(() => {});
  }
}

function cacheEls(){
  ['statusHero','metricStrip','latestObservation','clinicalCourse','homeCostSummary','openItems','journalSummary','journalEntries','timelineEntries','costSummary','estimateComparison','costEntries','profileDetails','documentList','profilePhoto','profileInitial','petName','petSubtitle','careModeButton','journalDialog','medicationDialog','costDialog','medicationSummary','medicationHistory'].forEach(id => els[id] = q(`#${id}`));
}

async function loadState(){
  const response = await fetch('./data/seed.json', {cache:'no-store'});
  const canonical = await response.json();

  let saved = null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { saved = JSON.parse(raw); } catch (_) {}
  }

  state = saved ? mergeCanonicalSeed(canonical, saved) : canonical;
  state = migrateState(state);
  persist();
}

function mergeCanonicalSeed(canonical, saved){
  const merged = structuredClone(canonical);

  // Preserve owner personalization and all owner-created records while allowing
  // corrected canonical clinical/journal backfill to flow in on refresh.
  if (saved.profile?.photoDataUrl) merged.profile.photoDataUrl = saved.profile.photoDataUrl;

  const mergeById = (canonicalRows=[], savedRows=[], keepSaved=true) => {
    const map = new Map(canonicalRows.map(row => [row.id, row]));
    savedRows.forEach(row => {
      if (!row?.id) return;
      if (!map.has(row.id) || keepSaved) map.set(row.id, {...map.get(row.id), ...row});
    });
    return [...map.values()];
  };

  const migratedSaved = migrateState(saved);
  merged.observations = mergeById(canonical.observations, migratedSaved.observations, false);
  merged.costs = mergeById(canonical.costs, migratedSaved.costs, false);
  merged.medicationAdministrations = mergeById(canonical.medicationAdministrations, migratedSaved.medicationAdministrations, false);
  merged.medications = mergeById(canonical.medications, migratedSaved.medications, false);
  merged.medicationCourses = mergeById(canonical.medicationCourses, migratedSaved.medicationCourses, false);

  // Owner-entered items have generated IDs and are not present in canonical data.
  for (const row of migratedSaved.observations || []) if (String(row.id||'').includes('-') && !merged.observations.some(x=>x.id===row.id)) merged.observations.push(row);
  for (const row of migratedSaved.costs || []) if (String(row.id||'').startsWith('cost-') && !merged.costs.some(x=>x.id===row.id)) merged.costs.push(row);
  for (const row of migratedSaved.medicationAdministrations || []) if (!merged.medicationAdministrations.some(x=>x.id===row.id)) merged.medicationAdministrations.push(row);

  merged.observations.sort((a,b)=>a.date.localeCompare(b.date));
  merged.costs.sort((a,b)=>a.date.localeCompare(b.date)||String(a.id).localeCompare(String(b.id)));
  merged.medicationAdministrations.sort((a,b)=>a.date.localeCompare(b.date)||(a.time||'').localeCompare(b.time||''));
  return merged;
}

function migrateState(input){
  const next = input || {};
  next.costs = Array.isArray(next.costs) ? next.costs : [];
  next.observations = Array.isArray(next.observations) ? next.observations : [];
  next.medications = Array.isArray(next.medications) ? next.medications : [];
  next.medicationCourses = Array.isArray(next.medicationCourses) ? next.medicationCourses : [];
  next.medicationAdministrations = Array.isArray(next.medicationAdministrations) ? next.medicationAdministrations : [];

  const combinedIndex = next.costs.findIndex(c => c.id === 'cost-0918' || c.category === 'treatment_restaging');
  if (combinedIndex >= 0) {
    next.costs.splice(combinedIndex, 1,
      {
        id:'cost-0918-treatment',date:'2026-09-18',provider:'K-State Veterinary Health Center',
        label:'Chemo #4 treatment',amountPaid:193.50,category:'treatment',status:'confirmed',source:'invoice',
        components:[['Oncology recheck',36.50],['Chemo administration',78.00],['Hazardous drug preparation',55.00],['Vinblastine',24.00]]
      },
      {
        id:'cost-0918-restaging',date:'2026-09-18',provider:'K-State Veterinary Health Center',
        label:'Mid-protocol restaging',amountPaid:667.25,category:'restaging',status:'confirmed',source:'invoice',
        components:[['Abdominal ultrasound',403.75],['Cytology ×2',115.50],['Ultrasound-guided liver/spleen aspirates',130.00],['Atipamezole',5.52],['Butorphanol',7.50],['Dexmedetomidine',4.98]]
      }
    );
  }
  next.schemaVersion = Math.max(Number(next.schemaVersion||0),3);
  return next;
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
  q('#medicationAddButton').addEventListener('click', openMedicationDialog);
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

  q('#medicationForm').addEventListener('submit', event => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    state.medicationAdministrations.push({
      id:uid('medadm'),
      medicationId:fd.get('medicationId'),
      date:fd.get('date'),
      time:fd.get('time') || null,
      dose:String(fd.get('dose')||'').trim(),
      status:fd.get('status') || 'given',
      reason:String(fd.get('reason')||'').trim(),
      source:'owner journal'
    });
    state.medicationAdministrations.sort((a,b)=>a.date.localeCompare(b.date)||(a.time||'').localeCompare(b.time||''));
    persist(); renderAll(); els.medicationDialog.close(); event.currentTarget.reset(); toast('Medication administration saved');
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

function openMedicationDialog(){
  const select=q('#medicationSelect');
  select.innerHTML=(state.medications||[]).map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
  q('#medicationDate').value=todayIso();
  q('#medicationTime').value='';
  selectMedicationDefaultDose();
  select.onchange=selectMedicationDefaultDose;
  q('#medicationDate').onchange=selectMedicationDefaultDose;
  els.medicationDialog.showModal();
}

function selectMedicationDefaultDose(){
  const medId=q('#medicationSelect')?.value;
  const date=q('#medicationDate')?.value||todayIso();
  const med=(state.medications||[]).find(m=>m.id===medId);
  const dose=q('#medicationDose');
  const hint=q('#medicationPrescriptionHint');
  if(!med||!dose||!hint)return;
  dose.value=defaultDoseForMedication(medId,date);
  hint.innerHTML=`<strong>Prescribed:</strong> ${esc(med.prescribedDose)}<br><strong>Use:</strong> ${esc(med.indication)}`;
}

function defaultDoseForMedication(medId,date){
  if(medId==='med-prednisone') return date>='2026-10-02'?'10 mg':'20 mg';
  if(medId==='med-cerenia') return '60 mg';
  if(medId==='med-metronidazole') return '250 mg';
  if(medId==='med-trazodone') return '200 mg';
  return '';
}

function medicationName(id){
  return (state.medications||[]).find(m=>m.id===id)?.name || id || 'Medication';
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

function bindRefreshControl(){
  const button = q('#refreshAppButton');
  if (!button) return;
  button.addEventListener('click', async () => {
    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = '…';
    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration) await registration.update();
      }
      const next = new URL(location.href);
      next.searchParams.set('refresh', Date.now().toString());
      location.replace(next.pathname + next.search);
    } catch (_) {
      button.disabled = false;
      button.textContent = oldText;
      toast('Could not refresh right now', true);
    }
  });
}

function renderAll(){
  renderProfile(); renderHome(); renderTreatmentOverlay(); renderJournal(); renderMedications(); renderTimeline(); renderCosts(); renderProfileDetails(); renderDocuments();
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
  const coverage=state.journalCoverageThrough;
  els.latestObservation.innerHTML = obs ? `<div class="row-between"><div><div class="item-title">${fmtDate(obs.date)}</div><div class="item-meta">Latest structured owner observation · journal current through ${fmtDate(coverage||obs.date)}</div></div>${severityChip(obs)}</div><div class="item-copy">${esc(obs.notes)}</div>` : 'No observations yet.';

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
  const root=q('#treatmentOverlayChart');
  const detail=q('#treatmentOverlayDetail');
  const selector=q('#overlayMetric');
  const legend=q('#overlayBloodLegend');
  const windowSelector=q('#treatmentWindowSelector');
  const windowDetails=q('#treatmentWindowDetails');
  if(!root||!detail||!selector||!windowSelector||!windowDetails||!state)return;

  const metric=selector.value||'Neutrophils';
  if(legend)legend.textContent=metric;

  const allTreatments=state.treatments.slice().sort((a,b)=>a.date.localeCompare(b.date));
  renderTreatmentWindowSelector(windowSelector,allTreatments);

  const selectedCycle=selectedTreatmentWindow==='all'
    ? null
    : allTreatments.find(t=>String(t.number)===String(selectedTreatmentWindow));
  const window=selectedCycle?cycleWindowFor(selectedCycle,allTreatments):null;
  const firstTreatmentDate=allTreatments[0]?.date;

  const bloodAll=state.labs.filter(x=>x.metric===metric).slice().sort((a,b)=>a.date.localeCompare(b.date));
  const symptomAll=state.observations
    .map(o=>({...o,severity:symptomSeverity(o)}))
    .filter(o=>o.severity>0)
    .sort((a,b)=>a.date.localeCompare(b.date));

  const blood=selectedCycle
    ? bloodAll.filter(p=>inCycleWindow(p.date,window))
    : bloodAll.filter(p=>p.date>=firstTreatmentDate);
  const symptoms=selectedCycle
    ? symptomAll.filter(o=>inCycleWindow(o.date,window))
    : symptomAll.filter(o=>o.date>=firstTreatmentDate);
  const treatments=selectedCycle?[selectedCycle]:allTreatments;

  if(!treatments.length){
    root.innerHTML='<div class="empty-state">No treatment data available yet.</div>';
    windowDetails.innerHTML='';
    return;
  }

  const startDate=selectedCycle?window.start:firstTreatmentDate;
  const endDate=selectedCycle
    ? window.displayEnd
    : [...blood.map(x=>x.date),...symptoms.map(x=>x.date),...treatments.map(x=>x.date)].sort().at(-1);
  const startMs=Date.parse(startDate+'T12:00:00Z');
  let endMs=Date.parse(endDate+'T12:00:00Z');
  if(endMs<=startMs)endMs=startMs+7*86400000;
  const span=Math.max(1,endMs-startMs);

  // Three aligned tracks: dose, bloodwork and symptoms. One shared time axis.
  const W=360,H=334,L=48,R=14;
  const doseTop=38,doseBottom=94;
  const bloodTop=124,bloodBottom=218;
  const symptomTop=250,symptomBottom=286;
  const axisY=316;
  const x=date=>L+((Date.parse(date+'T12:00:00Z')-startMs)/span)*(W-L-R);

  const thresholdMap={Neutrophils:2,Hematocrit:25,Platelets:75};
  const unitMap={Neutrophils:'K/µL',Hematocrit:'%',Platelets:'K/µL'};
  const threshold=thresholdMap[metric],unit=unitMap[metric]||'';

  const doseValues=allTreatments.map(t=>Number(t.doseMgM2)||0);
  const doseLow=Math.min(...doseValues)-0.08;
  const doseHigh=Math.max(...doseValues)+0.08;
  const yDose=value=>doseBottom-((Number(value)-doseLow)/(doseHigh-doseLow))*(doseBottom-doseTop);

  const bloodValues=blood.map(x=>Number(x.value)||0);
  const bloodMaxRaw=Math.max(...bloodValues,threshold||0,1);
  const bloodMax=Math.max(1,bloodMaxRaw*1.12);
  const yBlood=value=>bloodBottom-(Number(value)/bloodMax)*(bloodBottom-bloodTop);

  let svg='';

  // Lane labels and separators.
  svg+=`<text x="4" y="${doseTop-9}" font-size="9" font-weight="800" fill="#512888">DOSE · mg/m²</text>`;
  svg+=`<line x1="${L}" y1="${doseBottom+10}" x2="${W-R}" y2="${doseBottom+10}" stroke="#dedfea"/>`;
  svg+=`<text x="4" y="${bloodTop-9}" font-size="9" font-weight="800" fill="#5e7895">${metric.toUpperCase()} · ${unit}</text>`;
  svg+=`<line x1="${L}" y1="${bloodBottom+10}" x2="${W-R}" y2="${bloodBottom+10}" stroke="#dedfea"/>`;
  svg+=`<text x="4" y="${symptomTop-8}" font-size="9" font-weight="800" fill="#9a5364">OWNER SYMPTOMS</text>`;

  // Treatment vertical guides anchor all tracks to the same cycles.
  treatments.forEach(tr=>{
    const xx=x(tr.date);
    svg+=`<line x1="${xx}" y1="${doseTop-3}" x2="${xx}" y2="${symptomBottom+2}" stroke="#512888" stroke-opacity=".15" stroke-dasharray="3 4"/>`;
  });

  // Dose track.
  if(treatments.length>1){
    const path=treatments.map((tr,i)=>`${i?'L':'M'}${x(tr.date)},${yDose(tr.doseMgM2)}`).join(' ');
    svg+=`<path d="${path}" fill="none" stroke="#512888" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  treatments.forEach((tr,i)=>{
    const xx=x(tr.date),yy=yDose(tr.doseMgM2);
    svg+=`<circle class="chart-hit" tabindex="0" data-kind="treatment" data-index="${i}" cx="${xx}" cy="${yy}" r="6" fill="#512888" stroke="#fff" stroke-width="2.5"/>`;
    svg+=`<text x="${xx}" y="${yy-10}" text-anchor="middle" font-size="8.5" font-weight="800" fill="#512888">#${tr.number} · ${tr.doseMgM2}</text>`;
  });

  // Bloodwork track with its own scale and treatment threshold.
  for(let i=0;i<3;i++){
    const value=bloodMax*(2-i)/2;
    const yy=bloodTop+i*(bloodBottom-bloodTop)/2;
    const label=metric==='Platelets'?Math.round(value):(value<10?value.toFixed(1):Math.round(value));
    svg+=`<line x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}" stroke="#e7e8ef"/>`;
    svg+=`<text x="${L-6}" y="${yy+3}" text-anchor="end" font-size="8" fill="#707181">${label}</text>`;
  }
  if(threshold!=null&&threshold<=bloodMax){
    const yy=yBlood(threshold);
    svg+=`<line x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}" stroke="#707181" stroke-dasharray="5 4" stroke-width="1.2"/>`;
    svg+=`<text x="${W-R-2}" y="${yy-4}" text-anchor="end" font-size="8" fill="#707181">treatment threshold</text>`;
  }
  if(blood.length>1){
    const path=blood.map((p,i)=>`${i?'L':'M'}${x(p.date)},${yBlood(p.value)}`).join(' ');
    svg+=`<path d="${path}" fill="none" stroke="#5e7895" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  blood.forEach((p,i)=>{
    const xx=x(p.date),yy=yBlood(p.value);
    svg+=`<circle class="chart-hit" tabindex="0" data-kind="blood" data-index="${i}" cx="${xx}" cy="${yy}" r="5.5" fill="#5e7895" stroke="#fff" stroke-width="2.5"/>`;
    svg+=`<text x="${xx}" y="${yy-9}" text-anchor="middle" font-size="7.8" font-weight="750" fill="#5e7895">${p.displayValue||p.value}</text>`;
  });

  // Symptom severity track: height means severity; a small blue square means medication was given.
  svg+=`<line x1="${L}" y1="${symptomBottom}" x2="${W-R}" y2="${symptomBottom}" stroke="#dedfea"/>`;
  symptoms.forEach((o,i)=>{
    const xx=x(o.date);
    const yy=symptomBottom-(Math.min(3,o.severity)/3)*(symptomBottom-symptomTop);
    svg+=`<line x1="${xx}" y1="${symptomBottom}" x2="${xx}" y2="${yy}" stroke="#9a5364" stroke-width="4" stroke-linecap="round"/>`;
    svg+=`<circle class="chart-hit" tabindex="0" data-kind="symptom" data-index="${i}" cx="${xx}" cy="${yy}" r="5" fill="#9a5364" stroke="#fff" stroke-width="2"/>`;
    if(o.medications?.length){
      svg+=`<rect class="chart-hit" tabindex="0" data-kind="symptom" data-index="${i}" x="${xx-3.5}" y="${symptomBottom+5}" width="7" height="7" rx="1.5" fill="#5e7895"/>`;
    }
  });
  svg+=`<text x="${L-7}" y="${symptomTop+3}" text-anchor="end" font-size="7.5" fill="#707181">3</text>`;
  svg+=`<text x="${L-7}" y="${symptomBottom+3}" text-anchor="end" font-size="7.5" fill="#707181">0</text>`;

  // Shared time axis.
  svg+=`<line x1="${L}" y1="${axisY-12}" x2="${W-R}" y2="${axisY-12}" stroke="#dedfea"/>`;
  const labels=selectedCycle?[window.start,window.displayEnd]:treatments.map(t=>t.date);
  [...new Set(labels)].forEach((d,i,arr)=>{
    const xx=x(d);
    const anchor=i===0?'start':i===arr.length-1?'end':'middle';
    const dateLabel=fmtDate(d).replace(', 2026','');
    const dayLabel=selectedCycle?(`Day +${Math.max(0,daysBetween(window.start,d))}`):'';
    svg+=`<text x="${xx}" y="${axisY}" text-anchor="${anchor}" font-size="8" fill="#707181">${dateLabel}</text>`;
    if(dayLabel)svg+=`<text x="${xx}" y="${axisY+11}" text-anchor="${anchor}" font-size="7.5" fill="#9a5364">${dayLabel}</text>`;
  });

  root.innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Aligned treatment response tracks">${svg}</svg>`;

  root.querySelectorAll('.chart-hit').forEach(node=>{
    const show=()=>{
      const kind=node.dataset.kind,i=Number(node.dataset.index);
      if(kind==='blood'){
        const p=blood[i];
        detail.innerHTML=`<strong>${fmtDate(p.date)} · ${esc(metric)} ${esc(p.displayValue||p.value)} ${esc(p.unit)}</strong>${esc(p.context)} · ${esc(p.source)}`;
      }else if(kind==='treatment'){
        const tr=treatments[i];
        detail.innerHTML=`<strong>${fmtDate(tr.date)} · Chemo #${tr.number}</strong>Vinblastine ${tr.doseMg} mg · ${tr.doseMgM2} mg/m² · ${tr.weightLb} lb. ${esc(tr.doseReason)}`;
      }else{
        const o=symptoms[i];
        const meds=o.medications?.length?` Medication: ${esc(o.medications.join(', '))}.`:'';
        detail.innerHTML=`<strong>${fmtDate(o.date)} · Owner-observed symptoms</strong>${esc(compactObservation(o))}. ${esc(o.notes)}${meds}`;
      }
    };
    node.addEventListener('click',show);
    node.addEventListener('focus',show);
  });

  if(selectedCycle){
    detail.innerHTML=`<strong>Chemo #${selectedCycle.number} treatment window</strong>${fmtDate(window.start)} through ${fmtDate(window.displayEnd)} · ${selectedCycle.doseMg} mg (${selectedCycle.doseMgM2} mg/m²). Select a point above for exact source detail.`;
    windowDetails.innerHTML=renderCycleDetails(selectedCycle,window);
  }else{
    detail.innerHTML='<strong>All treatment cycles</strong>Purple shows dose, blue shows bloodwork, and the symptom track shows owner-observed severity. Select a treatment above to zoom into one complete cycle.';
    windowDetails.innerHTML='';
  }
}

function renderTreatmentWindowSelector(container,treatments){
  container.innerHTML=[
    `<button type="button" class="treatment-window-button ${selectedTreatmentWindow==='all'?'active':''}" data-treatment-window="all">All<small>course</small></button>`,
    ...treatments.map(t=>`<button type="button" class="treatment-window-button ${String(selectedTreatmentWindow)===String(t.number)?'active':''}" data-treatment-window="${t.number}">#${t.number}<small>${fmtDate(t.date).replace(', 2026','')}</small></button>`)
  ].join('');
  container.querySelectorAll('[data-treatment-window]').forEach(btn=>btn.addEventListener('click',()=>{
    selectedTreatmentWindow=btn.dataset.treatmentWindow;
    renderTreatmentOverlay();
  }));
}

function cycleWindowFor(treatment,treatments){
  const idx=treatments.findIndex(t=>t.number===treatment.number);
  const next=treatments[idx+1];
  const start=treatment.date;
  let endExclusive;
  if(next) endExclusive=next.date;
  else{
    const candidateDates=[
      ...state.labs.map(x=>x.date),
      ...state.observations.map(x=>x.date),
      ...state.costs.map(x=>x.date)
    ].filter(d=>d>=start).sort();
    const last=candidateDates.at(-1)||start;
    const minimum=addDays(start,14);
    endExclusive=last>minimum?addDays(last,1):minimum;
  }
  return {start,endExclusive,displayEnd:addDays(endExclusive,-1)};
}

function addDays(iso,days){
  const d=new Date(iso+'T12:00:00Z');
  d.setUTCDate(d.getUTCDate()+days);
  return d.toISOString().slice(0,10);
}

function inCycleWindow(date,window){
  return date>=window.start&&date<window.endExclusive;
}

function renderCycleDetails(treatment,window){
  const labs=state.labs.filter(x=>inCycleWindow(x.date,window)).sort((a,b)=>a.date.localeCompare(b.date)||a.metric.localeCompare(b.metric));
  const observations=state.observations.filter(x=>inCycleWindow(x.date,window)).sort((a,b)=>a.date.localeCompare(b.date));
  const medications=(state.medicationAdministrations||[]).filter(x=>inCycleWindow(x.date,window)).sort((a,b)=>a.date.localeCompare(b.date)||(a.time||'').localeCompare(b.time||''));
  const costs=state.costs.filter(x=>inCycleWindow(x.date,window));
  const cyclePaid=costs.reduce((sum,c)=>sum+Number(c.amountPaid||0),0);

  const labRows=labs.length?labs.map(l=>`<div class="cycle-result-row"><div>${fmtDate(l.date).replace(', 2026','')}</div><div class="cycle-result-value">${esc(l.metric)}<br>${esc(l.displayValue||l.value)} ${esc(l.unit)}</div><div class="cycle-result-context">${esc(l.context)}<br>${esc(l.source)}</div></div>`).join(''):'<div class="empty-state">No bloodwork is stored in this treatment window yet.</div>';

  const obsRows=observations.length?observations.map(o=>`<div class="cycle-observation"><div class="cycle-observation-title">${fmtDate(o.date)} · ${esc(compactObservation(o)||'owner observation')}</div><div class="cycle-observation-copy">${esc(o.notes)}${o.medications?.length?`<br><strong>Medication:</strong> ${esc(o.medications.join(', '))}`:''}</div></div>`).join(''):'<div class="empty-state">No owner observations are stored in this treatment window yet.</div>';

  return `<section class="cycle-summary">
    <div class="row-between"><div><div class="section-kicker">CHEMO #${treatment.number} · ${fmtDate(treatment.date)}</div><div class="item-title">Complete treatment window</div></div><span class="chip info">${fmtDate(window.start).replace(', 2026','')}–${fmtDate(window.displayEnd).replace(', 2026','')}</span></div>
    <div class="cycle-kpis">
      <div class="cycle-kpi"><div class="cycle-kpi-label">DOSE</div><div class="cycle-kpi-value">${treatment.doseMg} mg<br>${treatment.doseMgM2} mg/m²</div></div>
      <div class="cycle-kpi"><div class="cycle-kpi-label">WEIGHT</div><div class="cycle-kpi-value">${treatment.weightLb} lb</div></div>
      <div class="cycle-kpi"><div class="cycle-kpi-label">LAB RESULTS</div><div class="cycle-kpi-value">${labs.length}</div></div>
      <div class="cycle-kpi"><div class="cycle-kpi-label">PAID IN WINDOW</div><div class="cycle-kpi-value">${money(cyclePaid)}</div></div>
    </div>
    <div class="cycle-section"><div class="cycle-section-title">WHY THIS DOSE</div><div class="item-copy" style="margin-top:0">${esc(treatment.doseReason)}</div></div>
    <div class="cycle-section"><div class="cycle-section-title">BLOODWORK & CHEMISTRY</div>${labRows}</div>
    <div class="cycle-section"><div class="cycle-section-title">OWNER-OBSERVED SYMPTOMS</div>${obsRows}</div>
    <div class="cycle-section"><div class="cycle-section-title">MEDICATION ADMINISTRATIONS</div>${medications.length?medications.map(a=>`<div class="cycle-observation"><div class="cycle-observation-title">${fmtDate(a.date)}${a.time?` · ${esc(a.time)}`:''} · ${esc(medicationName(a.medicationId))} ${esc(a.dose||'')}</div><div class="cycle-observation-copy">${esc(a.status)}${a.reason?` · ${esc(a.reason)}`:''}</div></div>`).join(''):'<div class="empty-state">No structured medication administrations in this cycle.</div>'}</div>
    ${treatment.recordCheck?`<div class="alert"><strong>Record check:</strong> ${esc(treatment.recordCheck)}</div>`:''}
  </section>`;
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
  const nauseaDays=obs.filter(o=>Number(o.nausea)>0).length;
  const medDays=new Set((state.medicationAdministrations||[]).filter(a=>a.status==='given').map(a=>a.date)).size;
  els.journalSummary.innerHTML = [
    [obs.length,'STRUCTURED ENTRIES'],
    [nauseaDays,'NAUSEA DAYS'],
    [medDays,'MEDICATION DAYS'],
    [fmtDate(state.journalCoverageThrough||obs[0]?.date||'2026-10-02').replace(', 2026',''),'CURRENT THROUGH']
  ].map(x=>`<div class="summary-tile"><div class="summary-value">${x[0]}</div><div class="summary-label">${x[1]}</div></div>`).join('');
  els.journalEntries.innerHTML = obs.map(o=>`<article class="observation-card"><div class="row-between"><div><div class="item-title">${fmtDate(o.date)}</div><div class="item-meta">Owner observation</div></div>${severityChip(o)}</div><div class="chip-row">${observationChips(o)}</div><div class="item-copy">${esc(o.notes)}</div>${o.medications?.length?`<div class="item-meta" style="margin-top:8px"><strong>Medication:</strong> ${esc(o.medications.join(', '))}</div>`:''}</article>`).join('');
}
function observationChips(o){
  const chips=[];
  if(o.appetite)chips.push(`appetite: ${o.appetite}`); if(o.energy)chips.push(`energy: ${o.energy}`); if(o.nausea)chips.push(`nausea: ${['none','mild','moderate','severe'][o.nausea]}`); if(o.vomiting)chips.push(`vomiting: ${o.vomiting}`); if(o.stool)chips.push(`stool: ${o.stool}`); if(o.hydration)chips.push(`hydration: ${o.hydration}`); if(o.urination)chips.push(`${o.urination}`); if(o.pain)chips.push(`pain: ${o.pain}/3`);
  return chips.map(x=>`<span class="chip">${esc(x)}</span>`).join('');
}

function renderMedications(){
  const administrations=[...(state.medicationAdministrations||[])].sort((a,b)=>b.date.localeCompare(a.date)||(b.time||'').localeCompare(a.time||''));
  const given=administrations.filter(a=>a.status==='given');
  const cerenia=given.filter(a=>a.medicationId==='med-cerenia');
  const metro=given.filter(a=>a.medicationId==='med-metronidazole');
  const traz=given.filter(a=>a.medicationId==='med-trazodone');
  const currentPred=(state.medicationCourses||[]).find(c=>c.medicationId==='med-prednisone'&&!c.endDate);

  els.medicationSummary.innerHTML=`<div class="summary-grid medication-grid">
    <div class="summary-tile med-summary owner-med"><div class="summary-value">${cerenia.length}</div><div class="summary-label">CERENIA GIVEN</div><div class="item-meta">60 mg PRN</div></div>
    <div class="summary-tile med-summary owner-med"><div class="summary-value">${metro.length}</div><div class="summary-label">METRONIDAZOLE</div><div class="item-meta">250 mg PRN</div></div>
    <div class="summary-tile med-summary ksu-med"><div class="summary-value">${currentPred?.dose||'10 mg'}</div><div class="summary-label">PREDNISONE NOW</div><div class="item-meta">every 24 hours</div></div>
    <div class="summary-tile med-summary neutral-med"><div class="summary-value">${traz.length}</div><div class="summary-label">TRAZODONE DAYS</div><div class="item-meta">200 mg pre-visit</div></div>
  </div>`;

  els.medicationHistory.innerHTML=administrations.map(a=>{
    const med=(state.medications||[]).find(m=>m.id===a.medicationId);
    const time=a.time?` · ${esc(a.time)}`:'';
    const prescribed=med?.prescribedDose?`<div class="item-meta"><strong>Prescribed:</strong> ${esc(med.prescribedDose)}</div>`:'';
    return `<article class="observation-card medication-card">
      <div class="row-between"><div><div class="item-title">${esc(medicationName(a.medicationId))} · ${esc(a.dose||'dose not recorded')}</div><div class="item-meta">${fmtDate(a.date)}${time}</div></div><span class="chip ${a.status==='held'?'warn':'info'}">${esc(a.status)}</span></div>
      ${a.reason?`<div class="item-copy">${esc(a.reason)}</div>`:''}
      ${prescribed}
    </article>`;
  }).join('');
}

function renderTimeline(){
  const events=[];
  state.milestones.forEach(x=>events.push({date:x.date,kind:'clinical',source:x.source,title:x.title,detail:x.detail}));
  state.treatments.forEach(x=>events.push({date:x.date,kind:'clinical',source:x.source,title:`Vinblastine #${x.number} · ${x.doseMg} mg`,detail:`${x.doseMgM2} mg/m² · ${x.weightLb} lb · ${x.doseReason}`}));
  state.labs.forEach(x=>{ if(['Neutrophils','ALT','ALP'].includes(x.metric)) events.push({date:x.date,kind:'lab',source:x.source,title:`${x.metric}: ${x.displayValue||x.value} ${x.unit}`,detail:x.context}); });
  state.observations.forEach(x=>events.push({date:x.date,kind:'owner',source:'Owner observation',title:'Home observation',detail:x.notes}));
  const filtered=events.filter(x=>timelineFilter==='all'||x.kind===timelineFilter||(timelineFilter==='clinical'&&x.kind==='lab')).sort((a,b)=>b.date.localeCompare(a.date));
  els.timelineEntries.innerHTML=filtered.map(x=>`<article class="timeline-entry ${x.kind==='owner'?'owner':x.kind==='lab'?'lab':''}"><div class="timeline-date">${fmtDate(x.date).replace(', 2026','')}</div><div class="timeline-line"><div class="timeline-dot"></div></div><div class="timeline-content"><div class="source-label">${esc(x.source)}</div><div class="item-title">${esc(x.title)}</div><div class="item-copy">${esc(x.detail)}</div></div></article>`).join('');
}

function renderCosts(){
  const total=totalPaid(),confirmed=confirmedPaid(),provisional=provisionalPaid();
  els.costSummary.innerHTML=`<div class="cost-total"><div class="section-kicker" style="color:#eee8f8">TOTAL OWNER-PAID CARE</div><div class="cost-big">${money(total)}</div><div class="cost-sub">${money(confirmed)} confirmed · ${money(provisional)} provisional/unresolved</div></div>${categoryMeters()}`;

  const treatmentAfterPlan=state.costs.filter(c=>c.date>'2026-08-04').reduce((s,c)=>s+Number(c.amountPaid||0),0);
  els.estimateComparison.innerHTML=`<div class="estimate-grid">
    <div class="estimate-box">
      <div class="section-kicker">K-STATE ESTIMATE · 8/4</div>
      <div class="estimate-value">$3,500–$4,000</div>
      <div class="estimate-note">Complete 8-dose treatment course. K-State estimated about $250 per chemo injection; outside pre-treatment bloodwork was not included in that per-injection figure. Restaging was estimated at about $700.</div>
    </div>
    <div class="estimate-box">
      <div class="section-kicker">PAID SINCE 8/4</div>
      <div class="estimate-value">${money(treatmentAfterPlan)}</div>
      <div class="estimate-note">Spending after the treatment plan was established, excluding the 8/4 staging visit itself. Three chemo treatments and final restaging remain planned.</div>
    </div>
  </div>`;

  els.costEntries.innerHTML=[...state.costs]
    .sort((a,b)=>b.date.localeCompare(a.date)||String(b.id).localeCompare(String(a.id)))
    .map(c=>`<article class="cost-card">
      <div class="row-between">
        <div><div class="item-title">${esc(c.label)}</div><div class="item-meta">${fmtDate(c.date)} · ${esc(c.provider)}</div></div>
        <div class="cost-amount">${money(c.amountPaid)}</div>
      </div>
      <div class="chip-row">
        <span class="chip ${c.status==='confirmed'?'':'warn'}">${esc(c.status)}</span>
        <span class="chip info">${esc(categoryLabel(c.category))}</span>
      </div>
      ${renderCostComponents(c)}
    </article>`).join('');
}

function renderCostComponents(cost){
  if(!Array.isArray(cost.components)||!cost.components.length)return '';
  return `<div class="cost-components">${cost.components.map(part=>`<div class="cost-component-row"><span>${esc(part[0])}</span><strong>${money(part[1])}</strong></div>`).join('')}</div>`;
}

function categoryLabel(category){
  const labels={
    mixed_surgery_dental:'Surgery + dental day',
    treatment:'Chemo treatment',
    staging:'Initial staging',
    restaging:'Restaging',
    monitoring:'Monitoring labs',
    diagnosis:'Initial diagnosis',
    medication_unresolved:'Unresolved medication',
    medication:'Medication',
    mixed:'Mixed care',
    other:'Other'
  };
  return labels[category]||String(category||'Other').replaceAll('_',' ');
}

function careColor(category){
  const colors={
    mixed_surgery_dental:'#77839a',
    treatment:'#512888',
    staging:'#6c4aa0',
    restaging:'#8469b4',
    monitoring:'#5e7895',
    diagnosis:'#7893ad',
    medication_unresolved:'#a17383',
    medication:'#7289a4',
    mixed:'#777c91',
    other:'#8b8d9a'
  };
  return colors[category]||'#777c91';
}

function categoryMeters(){
  const groups={};
  state.costs.forEach(c=>{groups[c.category]=(groups[c.category]||0)+Number(c.amountPaid||0);});
  const rows=Object.entries(groups).sort((a,b)=>b[1]-a[1]);
  const max=Math.max(...rows.map(r=>r[1]),1);
  return `<section class="card" style="box-shadow:none;margin-top:10px">
    <div class="section-kicker">BY CARE TYPE</div>
    ${rows.map(([k,v])=>`<div class="cost-meter">
      <div class="cost-meter-row"><span>${esc(categoryLabel(k))}</span><strong>${money(v)}</strong></div>
      <div class="meter-track"><div class="meter-fill" style="width:${(v/max)*100}%;background:${careColor(k)}"></div></div>
    </div>`).join('')}
  </section>`;
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
