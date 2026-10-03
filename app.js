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
  merged.medicationPurchases = mergeById(canonical.medicationPurchases, migratedSaved.medicationPurchases, false);

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
  next.medicationPurchases = Array.isArray(next.medicationPurchases) ? next.medicationPurchases : [];

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
  next.schemaVersion = Math.max(Number(next.schemaVersion||0),4);
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
    q('#costForm').reset();
    q('#costDate').value = todayIso();
    configureMedicationPurchase();
    els.costDialog.showModal();
  });
  q('#costCategory').addEventListener('change',configureMedicationPurchase);
  q('#purchaseMedication').addEventListener('change',()=>{
    q('#purchaseStrength').value=state.medications.find(m=>m.id===q('#purchaseMedication').value)?.tabletStrengthMg||'';
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
    const isMedication=fd.get('category')==='medication';
    const amount=Number(fd.get('amountPaid'));
    const quantity=Number(fd.get('purchaseQuantity')),strength=Number(fd.get('purchaseStrength'));
    if(isMedication&&(!fd.get('purchaseMedication')||quantity<=0||strength<=0))return toast('Enter medication, tablet quantity, and tablet strength',true);
    const parentId=isMedication?String(fd.get('purchaseCostId')||''):'';
    const parent=state.costs.find(c=>c.id===parentId);
    if(parentId&&!parent)return toast('Select an existing visit bill',true);
    if(parent){
      const allocated=state.medicationPurchases.filter(p=>p.costId===parentId).reduce((n,p)=>n+Number(p.amountPaid),0);
      if(allocated+amount>Number(parent.amountPaid)+.005)return toast('Medication allocations exceed the selected bill amount',true);
    }
    const costId=parentId||uid('cost');
    if(!parent)state.costs.push({
      id: costId, date: fd.get('date'), provider: fd.get('provider'), label: fd.get('label'),
      amountPaid: amount, category: fd.get('category'), status:'confirmed', source:'owner_entered'
    });
    if(isMedication)state.medicationPurchases.push({
      id:uid('purchase'),medicationId:fd.get('purchaseMedication'),date:fd.get('date'),
      quantity,tabletStrengthMg:strength,amountPaid:amount,costId,status:'confirmed',
      source:String(fd.get('provider'))+' · '+String(fd.get('label'))
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
      tabletQuantity: fd.get('tabletQuantity') === '' ? null : Number(fd.get('tabletQuantity')),
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
  q('#medicationForm').reset();
  const select=q('#medicationSelect');
  select.innerHTML=(state.medications||[]).map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
  q('#medicationDate').value=todayIso();
  q('#medicationTime').value='';
  selectMedicationDefaultDose();
  select.onchange=selectMedicationDefaultDose;
  q('#medicationDate').onchange=selectMedicationDefaultDose;
  q('#medicationDose').oninput=suggestTabletQuantity;
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
  suggestTabletQuantity();
  hint.innerHTML=`<strong>Prescribed:</strong> ${esc(med.prescribedDose)}<br><strong>Use:</strong> ${esc(med.indication)}`;
}

function suggestTabletQuantity(){
  const med=state.medications.find(m=>m.id===q('#medicationSelect').value);
  const match=q('#medicationDose').value.match(/^(\d+(?:\.\d+)?)\s*mg$/i);
  q('#medicationTabletQuantity').value=match&&med?.tabletStrengthMg?Number(match[1])/med.tabletStrengthMg:'';
}

function configureMedicationPurchase(){
  const isMedication=q('#costCategory').value==='medication';
  q('#medicationPurchaseFields').hidden=!isMedication;
  for(const id of ['purchaseMedication','purchaseQuantity','purchaseStrength'])q('#'+id).required=isMedication;
  const previous=q('#purchaseMedication').value;
  q('#purchaseMedication').innerHTML=state.medications.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
  q('#purchaseMedication').value=previous||'med-cerenia';
  q('#purchaseStrength').value=state.medications.find(m=>m.id===q('#purchaseMedication').value)?.tabletStrengthMg||'';
  q('#purchaseCostId').innerHTML='<option value="">New expense — add to total care cost</option>'+state.costs.map(c=>`<option value="${esc(c.id)}">Included in: ${fmtDate(c.date)} · ${esc(c.label)} · ${money(c.amountPaid)}</option>`).join('');
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
  const root=q('#treatmentOverlayChart'),detail=q('#treatmentOverlayDetail');
  const selector=q('#overlayMetric'),windowSelector=q('#treatmentWindowSelector'),windowDetails=q('#treatmentWindowDetails');
  if(!root||!detail||!selector||!windowSelector||!windowDetails||!state)return;
  const metric=selector.value||'Neutrophils';
  q('#overlayBloodLegend').textContent=metric;
  const allTreatments=[...state.treatments].sort((a,b)=>a.date.localeCompare(b.date));
  renderTreatmentWindowSelector(windowSelector,allTreatments);
  const selectedCycle=allTreatments.find(t=>String(t.number)===selectedTreatmentWindow);
  const window=selectedCycle?cycleWindowFor(selectedCycle,allTreatments):null;
  const startDate=window?.start||allTreatments[0]?.date;
  if(!startDate){root.innerHTML='<div class="empty-state">No treatment data available yet.</div>';return;}
  const inView=date=>window?inCycleWindow(date,window):date>=startDate;
  const blood=state.labs.filter(p=>p.metric===metric&&inView(p.date)).sort((a,b)=>a.date.localeCompare(b.date));
  const symptoms=state.observations.filter(o=>inView(o.date)).map(o=>({...o,severity:symptomSeverity(o)})).filter(o=>o.severity>0);
  const medications=(state.medicationAdministrations||[]).filter(a=>inView(a.date)).sort((a,b)=>a.date.localeCompare(b.date)||(a.time||'').localeCompare(b.time||''));
  const treatments=selectedCycle?[selectedCycle]:allTreatments;
  const endDate=window?.displayEnd||[...blood,...symptoms,...medications,...treatments].map(p=>p.date).sort().at(-1)||startDate;
  const days=Math.max(1,daysBetween(startDate,endDate));
  const laneMeds=[...new Set(medications.map(a=>a.medicationId))].sort((a,b)=>(a==='med-cerenia'?-1:b==='med-cerenia'?1:a.localeCompare(b)));
  const viewport=root.clientWidth||340;
  const W=viewport>=680?viewport:Math.max(viewport,selectedCycle?160+days*48:680),L=130,R=26;
  const doseTop=52,doseBottom=108,bloodTop=160,bloodBottom=274,medTop=340;
  const medBottom=medTop+Math.max(1,laneMeds.length)*32;
  const symptomTop=medBottom+56,symptomBottom=symptomTop+54,axisY=symptomBottom+38,H=axisY+28;
  const x=date=>L+daysBetween(startDate,date)/days*(W-L-R);
  const thresholdMap={Neutrophils:2,Hematocrit:25,Platelets:75},unitMap={Neutrophils:'K/µL',Hematocrit:'%',Platelets:'K/µL'};
  const threshold=thresholdMap[metric],unit=unitMap[metric]||'';
  const doseValues=allTreatments.map(t=>Number(t.doseMgM2)||0),low=Math.min(...doseValues)-.1,high=Math.max(...doseValues)+.1;
  const yDose=value=>doseBottom-(Number(value)-low)/(high-low)*(doseBottom-doseTop);
  const bloodMax=Math.max(...blood.map(p=>Number(p.value)),threshold||0,1)*1.18;
  const yBlood=value=>bloodBottom-Number(value)/bloodMax*(bloodBottom-bloodTop);
  const shortDate=date=>date.split('-').slice(1).map(Number).join('/');
  const hit=(kind,index,cx,cy,label,shape='circle',fill='#5e7895',held=false)=>`<g class="chart-hit" role="button" tabindex="0" data-kind="${kind}" data-index="${index}" aria-label="${esc(label)}"><title>${esc(label)}</title><rect x="${cx-14}" y="${cy-14}" width="28" height="28" fill="transparent"/>${shape==='square'?`<rect x="${cx-6}" y="${cy-6}" width="12" height="12" rx="3" fill="${held?'#fff':fill}" stroke="${held?fill:'#fff'}" stroke-width="2"/>`:`<circle cx="${cx}" cy="${cy}" r="6" fill="${fill}" stroke="#fff" stroke-width="2"/>`}</g>`;
  let svg=`<rect width="${W}" height="${H}" fill="#fff"/>`;
  // Every medication date shares a dashed guide across all four lanes.
  const guideDates=[...new Set([...medications,...treatments].map(p=>p.date))];
  if(selectedCycle)for(let i=0;i<=days;i++)svg+=`<line x1="${x(addDays(startDate,i))}" x2="${x(addDays(startDate,i))}" y1="38" y2="${symptomBottom+5}" stroke="#edf0f5"/>`;
  guideDates.forEach(date=>svg+=`<line data-guide-date="${date}" x1="${x(date)}" x2="${x(date)}" y1="38" y2="${symptomBottom+5}" stroke="#667085" stroke-opacity=".35" stroke-dasharray="4 5"/>`);
  svg+=`<line id="selectedEventGuide" x1="0" x2="0" y1="38" y2="${symptomBottom+5}" stroke="#512888" stroke-width="2" stroke-dasharray="4 5" visibility="hidden"/>`;
  const heading=(label,y,color)=>`<text x="8" y="${y}" font-size="13" font-weight="800" fill="${color}">${esc(label)}</text>`;
  svg+=heading('VINBLASTINE · mg/m²',22,'#512888');
  svg+=heading(`${metric.toUpperCase()} · ${unit}`,140,'#b44f5c');
  svg+=heading('MEDICATIONS · □ given  ▫ held',medTop-24,'#667085');
  svg+=heading('OWNER OBSERVATIONS · severity',symptomTop-22,'#5e7895');
  [doseBottom+18,bloodBottom+20,medBottom+8,symptomBottom].forEach(y=>svg+=`<line x1="8" x2="${W-R}" y1="${y}" y2="${y}" stroke="#dedfea"/>`);
  if(treatments.length>1)svg+=`<path d="${treatments.map((t,i)=>`${i?'L':'M'}${x(t.date)},${yDose(t.doseMgM2)}`).join(' ')}" fill="none" stroke="#512888" stroke-width="3"/>`;
  treatments.forEach((t,i)=>{
    const yy=yDose(t.doseMgM2),xx=x(t.date);
    svg+=hit('treatment',i,xx,yy,`${fmtDate(t.date)} · Chemo #${t.number} · ${t.doseMgM2} mg/m²`,'circle','#512888');
    svg+=`<text x="${xx}" y="${yy-16}" text-anchor="middle" font-size="12" font-weight="800" fill="#512888">#${t.number} · ${t.doseMgM2}</text>`;
  });
  for(let i=0;i<3;i++){
    const value=bloodMax*(2-i)/2,yy=yBlood(value);
    svg+=`<line x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}" stroke="#e7e8ef"/><text x="${L-8}" y="${yy+4}" text-anchor="end" font-size="12" fill="#707181">${metric==='Platelets'?Math.round(value):value.toFixed(1)}</text>`;
  }
  svg+=`<line x1="${L}" x2="${W-R}" y1="${yBlood(threshold)}" y2="${yBlood(threshold)}" stroke="#707181" stroke-dasharray="6 5"/><text x="${W-R}" y="${yBlood(threshold)-7}" text-anchor="end" font-size="12" fill="#707181">treatment threshold</text>`;
  if(blood.length>1)svg+=`<path d="${blood.map((p,i)=>`${i?'L':'M'}${x(p.date)},${yBlood(p.value)}`).join(' ')}" fill="none" stroke="#b44f5c" stroke-width="3"/>`;
  blood.forEach((p,i)=>{
    svg+=hit('blood',i,x(p.date),yBlood(p.value),`${fmtDate(p.date)} · ${metric} ${p.value} ${unit}`,'circle','#b44f5c');
    svg+=`<text x="${x(p.date)}" y="${yBlood(p.value)-16}" text-anchor="middle" font-size="12" font-weight="800" fill="#b44f5c">${esc(p.displayValue||p.value)}</text>`;
  });
  laneMeds.forEach((id,row)=>{
    const y=medTop+row*32;
    svg+=`<text x="8" y="${y+4}" font-size="12" fill="#667085">${esc(medicationName(id).split(' / ')[0])}</text><line x1="${L}" x2="${W-R}" y1="${y}" y2="${y}" stroke="#edf0f5"/>`;
  });
  if(!medications.length)svg+=`<text x="8" y="${medTop+4}" font-size="13" fill="#707181">No medication doses recorded in this window</text>`;
  medications.forEach((a,i)=>{
    const same=medications.filter(b=>b.date===a.date&&b.medicationId===a.medicationId),position=same.indexOf(a);
    const offset=same.length>1?(position-(same.length-1)/2)*14:0;
    svg+=hit('medication',i,x(a.date)+offset,medTop+laneMeds.indexOf(a.medicationId)*32,`${fmtDate(a.date)} · ${medicationName(a.medicationId)} ${a.dose} · ${a.status}`,'square',a.medicationId==='med-cerenia'?'#512888':'#667085',a.status==='held');
  });
  symptoms.forEach((o,i)=>{
    const yy=symptomBottom-Math.min(3,o.severity)/3*(symptomBottom-symptomTop);
    svg+=`<line x1="${x(o.date)}" x2="${x(o.date)}" y1="${symptomBottom}" y2="${yy}" stroke="#5e7895" stroke-width="4"/>`;
    svg+=hit('symptom',i,x(o.date),yy,`${fmtDate(o.date)} · ${compactObservation(o)}`);
  });
  [0,3].forEach(n=>svg+=`<text x="${L-8}" y="${symptomBottom-n/3*(symptomBottom-symptomTop)+4}" text-anchor="end" font-size="12" fill="#707181">${n}</text>`);
  const dates=selectedCycle?Array.from({length:days+1},(_,i)=>addDays(startDate,i)):treatments.map(t=>t.date);
  dates.forEach((date,i)=>{
    svg+=`<line x1="${x(date)}" x2="${x(date)}" y1="${symptomBottom+5}" y2="${symptomBottom+13}" stroke="#707181"/><text x="${x(date)}" y="${axisY}" text-anchor="middle" font-size="13" fill="#454556">${selectedCycle?shortDate(date):`#${treatments[i].number}`}</text>`;
    if(!selectedCycle)svg+=`<text x="${x(date)}" y="${axisY+17}" text-anchor="middle" font-size="12" fill="#707181">${shortDate(date)}</text>`;
  });
  root.innerHTML=`<svg style="font-family:system-ui,sans-serif" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="group" aria-label="Treatment, bloodwork, medication and observation timelines">${svg}</svg>`;
  root.querySelectorAll('.chart-hit').forEach(node=>{
    const show=()=>{
      const kind=node.dataset.kind,i=Number(node.dataset.index);
      const point=({blood,treatment:treatments,symptom:symptoms,medication:medications})[kind][i];
      const guide=root.querySelector('#selectedEventGuide');guide.setAttribute('x1',x(point.date));guide.setAttribute('x2',x(point.date));guide.setAttribute('visibility','visible');
      const when=`${fmtDate(point.date)}${selectedCycle?` · Day +${daysBetween(startDate,point.date)}`:''}`;
      if(kind==='blood')detail.innerHTML=`<strong>${when} · ${esc(metric)} ${esc(point.displayValue||point.value)} ${esc(point.unit)}</strong>${esc(point.context)} · ${esc(point.source)}`;
      else if(kind==='treatment')detail.innerHTML=`<strong>${when} · Chemo #${point.number}</strong>Vinblastine ${point.doseMg} mg · ${point.doseMgM2} mg/m² · ${point.weightLb} lb. ${esc(point.doseReason)}`;
      else if(kind==='symptom')detail.innerHTML=`<strong>${when} · Owner observations</strong>${esc(compactObservation(point))}. ${esc(point.notes)}`;
      else detail.innerHTML=`<strong>${when}${point.time?` · ${esc(point.time)}`:''} · ${esc(medicationName(point.medicationId))} ${esc(point.dose)}</strong>${esc(point.status)}${point.status==='given'&&tabletQuantity(point)!=null?` · ${tabletQuantity(point)} tablet(s)`:''} · ${esc(point.reason||'No reason recorded')}`;
    };
    node.addEventListener('click',show);node.addEventListener('focus',show);node.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();show();}});
  });
  detail.innerHTML=selectedCycle?`<strong>Chemo #${selectedCycle.number} · ${fmtDate(startDate)}–${fmtDate(endDate)}</strong>Calendar dates align every lane. Swipe the chart for later dates; tap a marker for dose and source details.`:'<strong>All treatment cycles</strong>Purple: treatment. Red: bloodwork. Separate medication and blue observation lanes share the same dates. Tap a marker to highlight its date.';
  windowDetails.innerHTML=selectedCycle?renderCycleDetails(selectedCycle,window):'';
  q('#treatmentMedicationSummary').innerHTML=renderMedicationOverview(window);
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
      ...state.costs.map(x=>x.date),
      ...state.medicationAdministrations.map(x=>x.date),
      ...state.medicationPurchases.map(x=>x.date)
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
  const allTreatments=state.treatments.slice().sort((a,b)=>a.number-b.number);
  const labs=state.labs.filter(x=>inCycleWindow(x.date,window)).sort((a,b)=>a.date.localeCompare(b.date)||a.metric.localeCompare(b.metric));
  const observations=state.observations.filter(x=>inCycleWindow(x.date,window)).sort((a,b)=>a.date.localeCompare(b.date));
  const medications=(state.medicationAdministrations||[]).filter(x=>inCycleWindow(x.date,window)).sort((a,b)=>a.date.localeCompare(b.date)||(a.time||'').localeCompare(b.time||''));
  const costs=state.costs.filter(x=>inCycleWindow(x.date,window));
  const cyclePaid=costs.reduce((sum,c)=>sum+Number(c.amountPaid||0),0);

  const neut=labs.filter(l=>l.metric==='Neutrophils'&&Number.isFinite(Number(l.value)));
  const nadir=neut.length?neut.reduce((a,b)=>Number(a.value)<=Number(b.value)?a:b):null;
  const latestNeut=neut.length?neut[neut.length-1]:null;
  const worstObs=observations.length?observations.reduce((a,b)=>symptomSeverity(a)>=symptomSeverity(b)?a:b):null;
  const nextTreatment=allTreatments.find(t=>t.number===treatment.number+1);
  const recovery=latestNeut
    ? `${latestNeut.displayValue||latestNeut.value} ${latestNeut.unit} on ${fmtDate(latestNeut.date).replace(', 2026','')}${Number(latestNeut.value)>=2?' · above threshold':' · below threshold'}`
    : 'No neutrophil result stored in this window';
  const nextDecision=nextTreatment?nextTreatment.doseReason:'Final documented treatment so far';

  const labRows=labs.length?labs.map(l=>`<div class="cycle-result-row"><div>${fmtDate(l.date).replace(', 2026','')}</div><div class="cycle-result-value">${esc(l.metric)}<br>${esc(l.displayValue||l.value)} ${esc(l.unit)}</div><div class="cycle-result-context">${esc(l.context)}<br>${esc(l.source)}</div></div>`).join(''):'<div class="empty-state">No bloodwork is stored in this treatment window yet.</div>';

  const obsRows=observations.length?observations.map(o=>`<div class="cycle-observation owner-cycle-observation"><div class="cycle-observation-title">${fmtDate(o.date)} · ${esc(compactObservation(o)||'owner observation')}</div><div class="cycle-observation-copy">${esc(o.notes)}${o.medications?.length?`<br><strong>Medication noted in journal:</strong> ${esc(o.medications.join(', '))}`:''}</div></div>`).join(''):'<div class="empty-state">No owner observations are stored in this treatment window yet.</div>';

  return `<section class="cycle-summary">
    <div class="row-between"><div><div class="section-kicker">CHEMO #${treatment.number} · ${fmtDate(treatment.date)}</div><div class="item-title">Complete treatment window</div></div><span class="chip info">${fmtDate(window.start).replace(', 2026','')}–${fmtDate(window.displayEnd).replace(', 2026','')}</span></div>

    <div class="cycle-kpis">
      <div class="cycle-kpi ksu-cycle"><div class="cycle-kpi-label">DOSE</div><div class="cycle-kpi-value">${treatment.doseMg} mg<br>${treatment.doseMgM2} mg/m²</div></div>
      <div class="cycle-kpi"><div class="cycle-kpi-label">WEIGHT</div><div class="cycle-kpi-value">${treatment.weightLb} lb</div></div>
      <div class="cycle-kpi"><div class="cycle-kpi-label">LAB RESULTS</div><div class="cycle-kpi-value">${labs.length}</div></div>
      <div class="cycle-kpi"><div class="cycle-kpi-label">PAID IN WINDOW</div><div class="cycle-kpi-value">${money(cyclePaid)}</div></div>
    </div>

    <div class="cycle-insights">
      <div class="cycle-insight blood-insight"><div class="cycle-insight-label">LOWEST NEUTROPHILS</div><div class="cycle-insight-value">${nadir?`${nadir.value} ${nadir.unit} · ${fmtDate(nadir.date).replace(', 2026','')}`:'Not captured'}</div></div>
      <div class="cycle-insight owner-insight"><div class="cycle-insight-label">WORST OWNER-OBSERVED PERIOD</div><div class="cycle-insight-value">${worstObs?esc(symptomSummary(worstObs)):'No significant symptom entry'}</div></div>
      <div class="cycle-insight blood-insight"><div class="cycle-insight-label">RECOVERY / LATEST COUNT</div><div class="cycle-insight-value">${esc(recovery)}</div></div>
      <div class="cycle-insight ksu-insight"><div class="cycle-insight-label">NEXT DOSE DECISION</div><div class="cycle-insight-value">${esc(nextDecision)}</div></div>
    </div>

    <div class="cycle-section"><div class="cycle-section-title ksu-title">WHY THIS DOSE</div><div class="item-copy" style="margin-top:0">${esc(treatment.doseReason)}</div></div>
    <div class="cycle-section"><div class="cycle-section-title blood-title">BLOODWORK & CHEMISTRY</div>${labRows}</div>
    <div class="cycle-section"><div class="cycle-section-title owner-title">OWNER-OBSERVED SYMPTOMS</div>${obsRows}</div>
    <div class="cycle-section"><div class="cycle-section-title owner-title">MEDICATION ADMINISTRATIONS</div>${medications.length?medications.map(a=>`<div class="cycle-observation medication-cycle-observation"><div class="cycle-observation-title">${fmtDate(a.date)}${a.time?` · ${esc(a.time)}`:''} · ${esc(medicationName(a.medicationId))} ${esc(a.dose||'')}</div><div class="cycle-observation-copy">${esc(a.status)}${a.reason?` · ${esc(a.reason)}`:''}</div></div>`).join(''):'<div class="empty-state">No structured medication administrations in this cycle.</div>'}</div>
    ${treatment.recordCheck?`<div class="alert"><strong>Record check:</strong> ${esc(treatment.recordCheck)}</div>`:''}
  </section>`;
}

function symptomSummary(o){
  const parts=[];
  if(Number(o.nausea)>0) parts.push(`${['none','mild','moderate','severe'][Number(o.nausea)]} nausea`);
  if(Number(o.vomiting)>0) parts.push(`${o.vomiting} vomiting event${Number(o.vomiting)===1?'':'s'}`);
  if(o.stool) parts.push(`stool ${o.stool}`);
  if(String(o.energy||'').toLowerCase().includes('low')||String(o.energy||'').toLowerCase().includes('reduced')) parts.push(`energy ${o.energy}`);
  return `${fmtDate(o.date).replace(', 2026','')} · ${parts.join(', ')||o.notes.slice(0,80)}`;
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

function tabletQuantity(administration){
  if(administration.status!=='given')return 0;
  if(administration.tabletQuantity!=null&&Number.isFinite(Number(administration.tabletQuantity)))return Number(administration.tabletQuantity);
  // Physical tablet counts need a known tablet strength and a simple recorded mg dose.
  const med=state.medications.find(m=>m.id===administration.medicationId);
  const match=String(administration.dose||'').match(/^(\d+(?:\.\d+)?)\s*mg$/i);
  return med?.tabletStrengthMg&&match?Number(match[1])/med.tabletStrengthMg:null;
}

function medicationStats(id,window=null){
  const given=state.medicationAdministrations.filter(a=>a.medicationId===id&&a.status==='given'&&(!window||inCycleWindow(a.date,window)));
  const quantities=given.map(tabletQuantity);
  const purchases=state.medicationPurchases.filter(p=>p.medicationId===id&&(!window||inCycleWindow(p.date,window)));
  const purchased=purchases.reduce((n,p)=>n+Number(p.quantity||0),0);
  const spent=purchases.reduce((n,p)=>n+Number(p.amountPaid||0),0);
  return {given,tablets:quantities.reduce((n,q)=>n+(q||0),0),unknown:quantities.filter(q=>q==null).length,purchases,purchased,spent,unitCost:purchased?spent/purchased:null,last:given.map(a=>a.date).sort().at(-1)};
}

function renderMedicationOverview(window=null){
  const c=medicationStats('med-cerenia',window),total=medicationStats('med-cerenia');
  const nauseaDates=new Set(state.observations.filter(o=>Number(o.nausea)>0&&(!window||inCycleWindow(o.date,window))).map(o=>o.date));
  const medDates=new Set(c.given.map(a=>a.date)),treated=[...nauseaDates].filter(d=>medDates.has(d)).length;
  const heading=window?'Cerenia in this treatment window':'Cerenia across Roger’s care';
  const cycles=[...state.treatments].sort((a,b)=>a.number-b.number);
  const cycleCounts=cycles.map(t=>{
    const n=medicationStats('med-cerenia',cycleWindowFor(t,cycles));
    return `<div class="cerenia-cycle"><span>Chemo #${t.number}</span><strong>${n.tablets}${n.unknown?' + ?':''}</strong><small>tablets given</small></div>`;
  }).join('');
  return `<section class="medication-overview"><div class="section-kicker">MEDICATION USE & COST</div><h3>${heading}</h3>
    <div class="medication-kpis"><div><strong>${c.tablets}${c.unknown?' + ?':''}</strong><span>60 mg tablets given</span></div><div><strong>${nauseaDates.size}</strong><span>recorded nausea days</span></div><div class="owner-only"><strong>${total.purchased}</strong><span>tablets purchased to date</span></div><div class="owner-only"><strong>${money(total.spent)}</strong><span>Cerenia spent to date</span></div></div>
    <p class="medication-note">${treated} of ${nauseaDates.size} recorded nausea days${nauseaDates.size?` (${Math.round(treated/nauseaDates.size*100)}%)`:""} have a Cerenia dose logged on the same date. ${c.last?`Last given: ${fmtDate(c.last)}.`:'No Cerenia dose logged in this window.'} Counts reflect recorded administrations; daily prescriptions alone do not add pills.</p>
    <div class="medication-note owner-only">Average purchase cost: ${total.unitCost==null?'not recorded':money(total.unitCost)+' / tablet'}. ${window?`${c.purchased} tablets purchased for ${money(c.spent)} during this window. `:''}Medication spending is already included in the visit or purchase bills.</div>
    ${!window?`<div class="cerenia-cycle-grid">${cycleCounts}</div>`:''}
  </section>`;
}

function renderMedicationLedger(){
  return `<div class="medication-ledger">${state.medications.map(m=>{
    const a=medicationStats(m.id),held=state.medicationAdministrations.filter(x=>x.medicationId===m.id&&x.status==='held').length;
    const purchases=a.purchases.map(p=>`<div class="medication-purchase-row"><span>${fmtDate(p.date)} · ${p.quantity} × ${p.tabletStrengthMg} mg<br><small>${esc(p.source)}</small></span><strong>${money(p.amountPaid)}<br><small>${money(p.amountPaid/p.quantity)} / tablet</small></strong></div>`).join('');
    return `<article class="medication-ledger-card"><h3>${esc(m.name)}${m.tabletStrengthMg?` · ${m.tabletStrengthMg} mg tablets`:''}</h3><div class="medication-kpis"><div><strong>${a.tablets}${a.unknown?' + ?':''}</strong><span>tablets documented given</span></div><div><strong>${a.given.length}</strong><span>doses logged${held?` · ${held} held`:''}</span></div><div class="owner-only"><strong>${a.purchases.length?a.purchased:'—'}</strong><span>tablets purchased</span></div><div class="owner-only"><strong>${a.purchases.length?money(a.spent):'—'}</strong><span>documented spending</span></div></div><p class="medication-note">${esc(m.prescribedDose)}${a.unknown?` · ${a.unknown} administration(s) lack a confirmed tablet quantity.`:''}${a.last?` · Last given ${fmtDate(a.last)}.`:''}</p><div class="owner-only">${purchases||'<p class="medication-note">Purchase details not recorded.</p>'}</div></article>`;
  }).join('')}</div>`;
}

function renderMedications(){
  const administrations=[...(state.medicationAdministrations||[])].sort((a,b)=>b.date.localeCompare(a.date)||(b.time||'').localeCompare(a.time||''));
  const given=administrations.filter(a=>a.status==='given');
  const cerenia=given.filter(a=>a.medicationId==='med-cerenia');
  const metro=given.filter(a=>a.medicationId==='med-metronidazole');
  const traz=given.filter(a=>a.medicationId==='med-trazodone');
  const currentPred=(state.medicationCourses||[]).find(c=>c.medicationId==='med-prednisone'&&!c.endDate);

  els.medicationSummary.innerHTML=`<div class="summary-grid medication-grid">
    <div class="summary-tile med-summary owner-med"><div class="summary-value">${medicationStats('med-cerenia').tablets}</div><div class="summary-label">CERENIA TABLETS</div><div class="item-meta">60 mg PRN</div></div>
    <div class="summary-tile med-summary owner-med"><div class="summary-value">${medicationStats('med-metronidazole').tablets}</div><div class="summary-label">METRONIDAZOLE TABLETS</div><div class="item-meta">250 mg PRN</div></div>
    <div class="summary-tile med-summary ksu-med"><div class="summary-value">${currentPred?.dose||'10 mg'}</div><div class="summary-label">PREDNISONE NOW</div><div class="item-meta">every 24 hours</div></div>
    <div class="summary-tile med-summary neutral-med"><div class="summary-value">${traz.length}</div><div class="summary-label">TRAZODONE DAYS</div><div class="item-meta">200 mg pre-visit</div></div>
  </div>`;

  els.medicationSummary.innerHTML += renderMedicationOverview() + renderMedicationLedger();

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
  q('#medicationCostBreakdown').innerHTML=renderMedicationLedger();
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
