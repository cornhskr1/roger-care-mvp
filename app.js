'use strict';

const STORAGE_KEY = 'rogerCareState_v1';
const DOC_DB = 'rogerCareDocuments_v1';
const DOC_STORE = 'documents';
const RECOVERY_STORE = 'recoverySnapshots';
const BACKUP_META_KEY = 'rogerCareBackupStatus_v1';
const SUPABASE_URL = 'https://gkotvodoqwdhmdeigrra.supabase.co';
const SUPABASE_KEY = 'sb_publishable_r-j23v_ip3FsemJ8JNtoog_79reT8ur';
const SITE_URL = 'https://cornhskr1.github.io/roger-care-mvp/';
let cloud = null, cloudRevision = null, cloudUpdatedAt = null, cloudAvailable = false;
let ownerSession = null, ownerCanEdit = false, unpublishedLocal = false, cloudBusy = false;
let ownerPairCode = null;
let manualPublishRequired = false;
let syncMessage = '';
const DEFAULT_VISITS = [
  {id:'cbc-6',label:'CBC before chemo #6',date:'2026-10-15',source:'Owner-reported appointment schedule, 10/3/2026'},
  {id:'chemo-6',label:'Vinblastine #6',date:'2026-10-16',source:'Owner-reported appointment schedule, 10/3/2026'},
  {id:'cbc-7',label:'CBC before chemo #7',date:'2026-10-29',source:'Owner-reported appointment schedule, 10/3/2026'},
  {id:'chemo-7',label:'Vinblastine #7',date:'2026-10-30',source:'Owner-reported appointment schedule, 10/3/2026'},
  {id:'cbc-8',label:'CBC before chemo #8',date:'2026-11-12',source:'Owner-reported appointment schedule, 10/3/2026'},
  {id:'chemo-8',label:'Vinblastine #8',date:'2026-11-13',source:'Owner-reported appointment schedule, 10/3/2026'},
  {id:'restaging',label:'Final restaging',date:null,source:'Owner reported TBD, 10/3/2026'}
];

const els = {};
let state = null;
let timelineFilter = 'all';
let careTeamMode = false;
let selectedTreatmentWindow = 'all';
const comparison={primary:'energy',secondary:'nausea',view:'calendar',range:'all',cycles:new Set(),from:'2026-08-14',to:'2026-10-03',selectedDate:null};
let comparisonCyclesReady=false;
let journalShowAll = false;
let recoveredFromSnapshot = false;
let backupPreparedAt = null;
let backupPreparedStateAt = null;
let importDraft = null;

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
  bindImport();
  bindExports();
  bindProfilePhoto();
  bindOverlayControls();
  bindRefreshControl();
  await loadState();
  await connectCloud();
  await loadDocuments();
  renderAll();
  if(recoveredFromSnapshot)toast('Recovered Roger’s entries from a local recovery copy. Download a complete backup now.');
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js', {updateViaCache:'none'}).catch(() => {});
  }
}

function cacheEls(){
  ['statusHero','metricStrip','latestObservation','journalBrief','upcomingCare','clinicalCourse','cycleClinicalReview','homeCostSummary','openItems','journalSummary','journalEntries','journalTrend','timelineEntries','costSummary','estimateComparison','costEntries','profileDetails','documentList','profilePhoto','profileInitial','petName','patientIds','petSubtitle','careModeButton','journalDialog','medicationDialog','costDialog','medicationSummary','medicationHistory'].forEach(id => els[id] = q(`#${id}`));
}

async function loadState(){
  const response = await fetch('./data/seed.json', {cache:'no-store'});
  const canonical = await response.json();

  let saved = null;
  let raw = null;
  try{raw=localStorage.getItem(STORAGE_KEY);}catch(_){}
  if (raw) {
    try { saved = JSON.parse(raw); } catch (_) {}
  }
  const snapshot=await latestRecoverySnapshot();
  if(snapshot?.state?.profile&&(!saved?.profile||snapshot.savedAt>String(saved._savedAt||''))){
    saved=snapshot.state;
    recoveredFromSnapshot=true;
  }

  state = saved ? mergeCanonicalSeed(canonical, saved) : canonical;
  state = migrateState(state);
  unpublishedLocal=Boolean(saved?._savedAt);
  manualPublishRequired=unpublishedLocal;
  await persist(false);
}

function mergeCanonicalSeed(canonical, saved){
  const merged = structuredClone(canonical);
  const savedSchemaVersion=Number(saved.schemaVersion||0);

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
  merged.qualityOfLife = mergeById(canonical.qualityOfLife||[],migratedSaved.qualityOfLife||[],true);
  merged.costs = mergeById(canonical.costs, migratedSaved.costs, true);
  merged.treatments = mergeById(canonical.treatments, migratedSaved.treatments, true);
  const labKey=x=>x.id||`${x.date}|${x.metric}`;
  const labMap=new Map((canonical.labs||[]).map(x=>[labKey(x),x]));
  (migratedSaved.labs||[]).forEach(x=>labMap.set(labKey(x),{...labMap.get(labKey(x)),...x}));
  merged.labs=[...labMap.values()];
  merged.importHistory=migratedSaved.importHistory||[];
  merged.medicationAdministrations = mergeById(canonical.medicationAdministrations, migratedSaved.medicationAdministrations, false);
  merged.medications = mergeById(canonical.medications, migratedSaved.medications, false);
  merged.medicationCourses = mergeById(canonical.medicationCourses, migratedSaved.medicationCourses, false);
  merged.medicationPurchases = mergeById(canonical.medicationPurchases, migratedSaved.medicationPurchases, false);
  const savedPlan=migratedSaved.carePlan||{};
  merged.carePlan={
    ...structuredClone(canonical.carePlan),
    vetCallInstructions:savedPlan.vetCallInstructions||'',
    vetCallSource:savedPlan.vetCallSource||'',
    visits:canonical.carePlan.visits.map(visit=>{
      const prior=savedPlan.visits?.find(v=>v.id===visit.id);
      return savedSchemaVersion>=7&&prior?{...visit,date:prior.date||null,source:prior.source||visit.source}:visit;
    })
  };
  merged.recordCorrections = migratedSaved.recordCorrections||[];
  merged._savedAt = migratedSaved._savedAt||null;
  for (const correction of merged.recordCorrections){
    const rows=merged[correction.collection];
    if(!['observations','medicationAdministrations','costs','qualityOfLife','treatments'].includes(correction.collection)||!Array.isArray(rows))continue;
    const index=rows.findIndex(row=>row.id===correction.id);
    if(index>=0)rows[index]={...rows[index],...correction.after};
  }

  // Owner-entered items have generated IDs and are not present in canonical data.
  for (const row of migratedSaved.observations || []) if (String(row.id||'').includes('-') && !merged.observations.some(x=>x.id===row.id)) merged.observations.push(row);
  for (const row of migratedSaved.costs || []) if (String(row.id||'').startsWith('cost-') && !merged.costs.some(x=>x.id===row.id)) merged.costs.push(row);
  for (const row of migratedSaved.medicationAdministrations || []) if (!merged.medicationAdministrations.some(x=>x.id===row.id)) merged.medicationAdministrations.push(row);

  merged.observations.sort((a,b)=>a.date.localeCompare(b.date));
  merged.costs.sort((a,b)=>a.date.localeCompare(b.date)||String(a.id).localeCompare(String(b.id)));
  merged.medicationAdministrations.sort((a,b)=>a.date.localeCompare(b.date)||(a.time||'').localeCompare(b.time||''));
  merged.journalCoverageThrough = [canonical.journalCoverageThrough,migratedSaved.journalCoverageThrough].filter(Boolean).sort().at(-1);
  return merged;
}

function migrateState(input){
  const next = input || {};
  next.costs = Array.isArray(next.costs) ? next.costs : [];
  next.treatments = Array.isArray(next.treatments) ? next.treatments : [];
  next.labs = Array.isArray(next.labs) ? next.labs : [];
  next.importHistory = Array.isArray(next.importHistory) ? next.importHistory : [];
  next.observations = Array.isArray(next.observations) ? next.observations : [];
  next.qualityOfLife = Array.isArray(next.qualityOfLife) ? next.qualityOfLife : [];
  next.medications = Array.isArray(next.medications) ? next.medications : [];
  next.medicationCourses = Array.isArray(next.medicationCourses) ? next.medicationCourses : [];
  next.medicationAdministrations = Array.isArray(next.medicationAdministrations) ? next.medicationAdministrations : [];
  next.medicationPurchases = Array.isArray(next.medicationPurchases) ? next.medicationPurchases : [];
  next.recordCorrections = Array.isArray(next.recordCorrections) ? next.recordCorrections : [];
  next.carePlan = next.carePlan||{visits:structuredClone(DEFAULT_VISITS),vetCallInstructions:'',vetCallSource:''};
  if(!Array.isArray(next.carePlan.visits)||!next.carePlan.visits.length)next.carePlan.visits=structuredClone(DEFAULT_VISITS);

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
  next.schemaVersion = Math.max(Number(next.schemaVersion||0),8);
  return next;
}

async function persist(changed=true){
  if(changed)state._savedAt=new Date().toISOString();
  if(changed){backupPreparedAt=null;backupPreparedStateAt=null;}
  let local=false,snapshot=false;
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));local=true;}catch(_){}
  if(changed)try{await saveRecoverySnapshot(state);snapshot=true;}catch(_){}
  if(changed&&!local&&!snapshot)throw new Error('No local storage available');
  if(changed)renderBackupStatus();
  return {local,snapshot};
}
async function saveChanges(){
  try{
    if(!ownerCanEdit){toast('Sign in as the owner before editing the shared record.',true);return false;}
    await persist();
    unpublishedLocal=true;
    if(manualPublishRequired||cloudRevision===0||readBackupMeta().confirmedStateAt!==state._savedAt&&cloudRevision===null){
      syncMessage='Saved on this device. Tap Publish this device’s record once to share it.';
      renderSharedStatus();return true;
    }
    const ok=await publishCloud(false);
    if(!ok)toast('Saved on this device. The shared copy is still waiting.',true);
    renderSharedStatus();
    return true;
  }
  catch(_){toast('Could not save on this device. Keep this screen open and export a backup.',true);return false;}
}

async function connectCloud(){
  if(!globalThis.supabase?.createClient){syncMessage='Shared record unavailable. This device still has its local copy.';return;}
  cloud=globalThis.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{detectSessionInUrl:true,persistSession:true,autoRefreshToken:true}});
  const {data:{session}}=await cloud.auth.getSession();
  ownerSession=session;
  cloud.auth.onAuthStateChange((_event,next)=>{ownerSession=next;setTimeout(async()=>{await checkOwner();renderSharedStatus();},0);});
  await readCloud(true);
  await checkOwner();
  window.addEventListener('focus',async()=>{await checkOwner();if(!unpublishedLocal){await readCloud(false);renderAll();}});
  setInterval(()=>{if(!document.hidden&&!unpublishedLocal)readCloud(false).then(()=>renderAll());},60000);
}
async function checkOwner(){
  ownerCanEdit=false;
  if(cloud&&ownerSession){
    const {data,error}=await cloud.rpc('roger_can_edit');
    ownerCanEdit=!error&&data===true;
  }
  renderSharedStatus();
}
function cloudRecord(){
  const copy=structuredClone(state);
  if(copy.profile)delete copy.profile.photoDataUrl;
  return copy;
}
function parseOwnerSignInLink(input){
  const url=new URL(String(input||'').trim());
  if(url.protocol!=='https:'||url.hostname!==new URL(SUPABASE_URL).hostname||url.pathname!=='/auth/v1/verify')throw new Error('Unexpected sign-in link');
  const token=url.searchParams.get('token_hash')||url.searchParams.get('token');
  const type=url.searchParams.get('type');
  if(!token||!/^[a-zA-Z0-9_-]{32,256}$/.test(token)||!['email','magiclink'].includes(type))throw new Error('Invalid sign-in link');
  return {token_hash:token,type};
}
async function readCloud(initial=false){
  if(!cloud||cloudBusy||unpublishedLocal&&!initial)return;
  const {data,error}=await cloud.from('roger_shared_record').select('record,revision,updated_at').eq('id','roger').single();
  if(error){cloudAvailable=false;syncMessage='Shared record could not be reached. Local copy is safe on this device.';renderSharedStatus();return;}
  cloudAvailable=true;cloudRevision=Number(data.revision);cloudUpdatedAt=data.updated_at;
  if(data.revision>0&&data.record?.profile){
    if(initial&&unpublishedLocal&&String(state._savedAt||'')>String(data.record._savedAt||'')){
      syncMessage='This device has newer local changes. Back up and review before publishing.';
    }else{
      const photo=state.profile?.photoDataUrl;
      state=migrateState(data.record);
      if(photo)state.profile.photoDataUrl=photo;
      unpublishedLocal=false;
      manualPublishRequired=false;
      await persist(false);
      syncMessage='Shared record current.';
    }
  }else syncMessage=unpublishedLocal?'This device has entries waiting for their first upload.':'Shared record has not been published yet.';
  renderSharedStatus();
}
async function publishCloud(firstUpload){
  if(!cloud||!ownerCanEdit||cloudRevision===null){syncMessage='Not uploaded. Check the connection and sign-in.';renderSharedStatus();return false;}
  if(cloudBusy)return false;
  cloudBusy=true;
  try{
    const {data,error}=await cloud.from('roger_shared_record')
      .update({record:cloudRecord(),revision:cloudRevision+1})
      .eq('id','roger').eq('revision',cloudRevision)
      .select('revision,updated_at').maybeSingle();
    if(error||!data){
      syncMessage='Not uploaded. Another version may be online. Keep this device open and download a backup before resolving it.';
      toast(syncMessage,true);return false;
    }
    cloudRevision=Number(data.revision);cloudUpdatedAt=data.updated_at;
    unpublishedLocal=false;syncMessage='Saved to shared record.';
    manualPublishRequired=false;
    if(firstUpload)toast('Roger’s record is now shared. Your device copy remains.');
    return true;
  }finally{cloudBusy=false;renderSharedStatus();}
}
function renderSharedStatus(){
  const status=q('#sharedStatus'),controls=q('#sharedControls');if(!status||!controls||!state)return;
  const label=!cloudAvailable?'On this device':unpublishedLocal?'Not yet shared':cloudRevision>0?'Shared and current':'Ready for first upload';
  status.innerHTML=`<strong>${esc(label)}</strong><span>${esc(syncMessage||'Checking shared record…')}</span>${cloudUpdatedAt&&cloudRevision>0&&!unpublishedLocal?`<small>Online update: ${esc(new Date(cloudUpdatedAt).toLocaleString())}</small>`:''}`;
  const appEntries=state.observations.filter(row=>row.source==='owner_observation'&&!row.rawEntry);
  const readyToPublish=cloudRevision!==0||appEntries.length>0;
  controls.innerHTML=ownerCanEdit
    ? `<strong>Signed in as owner</strong><p>${esc(syncMessage)}</p>${unpublishedLocal?`<p>${appEntries.length} app journal entr${appEntries.length===1?'y':'ies'} found on this device. Check your latest entry before the first upload.</p><button id="publishLocal" class="primary-button" type="button" ${!readyToPublish?'disabled':''}>${cloudRevision===0?'Publish this device’s record':'Publish local changes'}</button><p>${cloudRevision===0&&!appEntries.length?'Your app journal entry is in the Home Screen app. Connect that app below and publish from there.':'This sends journal, medications, labs, care plan, and costs to the shared link. The photo and document files stay on this device.'}</p>`:''}<button id="createOwnerPair" class="secondary-button" type="button">Connect Home Screen app</button>${ownerPairCode?'<label class="field"><span>One-time sign-in for Home Screen app</span><input id="ownerPairCode" type="password" readonly autocomplete="off"></label><button id="copyOwnerPair" class="secondary-button" type="button">Copy sign-in</button><p class="field-help">Now open the Home Screen app, paste under Owner sign-in, and tap Connect. Do not send this sign-in in chat.</p>':''}<button id="signOutOwner" class="text-button" type="button">Sign out</button>`
    : `<strong>${ownerSession?'Signed in; owner access is pending':'Owner sign-in'}</strong><p>${ownerSession?'Your entries remain on this device until owner access is assigned.':'Connect this Home Screen app once using the browser window that already says “Signed in as owner.” After that, save journal entries here and they will update the shared record.'}</p>${!ownerSession?'<form id="ownerPairPaste"><label class="field"><span>Paste sign-in copied from the browser</span><input type="password" name="code" autocomplete="off" spellcheck="false" required></label><button class="secondary-button" type="submit">Connect this app</button></form><details><summary>Use an email link instead</summary><p class="field-help">An email link works only once. Opening or previewing it in Mail or Safari can use it before this app does.</p><form id="ownerLogin"><label class="field"><span>Your email</span><input type="email" name="email" autocomplete="email" required></label><button class="secondary-button" type="submit">Email me a new link</button></form><form id="ownerLinkPaste"><label class="field"><span>Paste the unused email link</span><input type="text" name="link" inputmode="url" autocomplete="off" spellcheck="false" required></label><button class="secondary-button" type="submit">Sign in with link</button></form><p class="field-help">Do not send sign-in information in chat.</p></details>':'<button id="signOutOwner" class="text-button" type="button">Sign out</button>'}`;
  if(ownerPairCode&&q('#ownerPairCode'))q('#ownerPairCode').value=ownerPairCode;
  q('#createOwnerPair')?.addEventListener('click',async event=>{
    const button=event.currentTarget;button.disabled=true;
    const {data,error}=await cloud.functions.invoke('roger-pair',{body:{}});
    button.disabled=false;
    if(error||data?.kind!=='roger-owner-pair-v1'||!data.token_hash)return toast('Could not create a sign-in. Check the owner session in this browser.',true);
    ownerPairCode=JSON.stringify(data);renderSharedStatus();toast('One-time sign-in ready. Tap Copy sign-in.');
  });
  q('#copyOwnerPair')?.addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText(ownerPairCode);toast('Copied. Paste it in the Home Screen app.');}
    catch(_){toast('Could not copy. Press and hold the sign-in field and choose Copy.',true);}
  });
  q('#ownerPairPaste')?.addEventListener('submit',async event=>{
    event.preventDefault();const input=event.currentTarget.elements.code;
    let payload;try{payload=JSON.parse(input.value);}catch(_){}
    input.value='';
    if(payload?.kind!=='roger-owner-pair-v1'||!payload.token_hash||payload.type!=='magiclink')return toast('Paste the one-time sign-in copied from Roger Care in the browser.',true);
    const {error}=await cloud.auth.verifyOtp({token_hash:payload.token_hash,type:payload.type});
    if(error)return toast('That sign-in has already been used or expired. Create a new one in the signed-in browser.',true);
    const {data:{session}}=await cloud.auth.getSession();ownerSession=session;await checkOwner();renderAll();
    try{await navigator.clipboard.writeText('');}catch(_){}
    toast(ownerCanEdit?'Connected. Your journal is still here. Tap Publish this device’s record once.':'Signed in, but owner access is pending.');
  });
  q('#ownerLogin')?.addEventListener('submit',async event=>{
    event.preventDefault();const email=event.currentTarget.elements.email.value.trim();
    const {error}=await cloud.auth.signInWithOtp({email,options:{emailRedirectTo:SITE_URL}});
    const emailLimit=error&&(error.status===429||error.code==='over_email_send_rate_limit');
    toast(error?(emailLimit?'Email limit reached. Wait an hour after the last email, then request one new link. Roger’s journal is safe.':'Sign-in email could not be sent. Please try again later.'):'In the email, press and hold Sign in, then Copy Link. Paste it here without opening it.',Boolean(error));
  });
  q('#ownerLinkPaste')?.addEventListener('submit',async event=>{
    event.preventDefault();
    const input=event.currentTarget.elements.link;
    let credentials;
    try{credentials=parseOwnerSignInLink(input.value);}
    catch(_){return toast('That is not an unused Roger Care sign-in link. Request a new link and copy it from the email.',true);}
    input.value='';
    const {error}=await cloud.auth.verifyOtp(credentials);
    if(error)return toast('That link could not be used. Request a fresh one, then copy it without opening it.',true);
    const {data:{session}}=await cloud.auth.getSession();
    ownerSession=session;await checkOwner();renderAll();
    toast(ownerCanEdit?'Signed in here. Your journal is still on this device.':'Signed in, but owner access is pending.');
  });
  q('#signOutOwner')?.addEventListener('click',async()=>{await cloud.auth.signOut();ownerSession=null;ownerCanEdit=false;renderSharedStatus();});
  q('#publishLocal')?.addEventListener('click',async()=>{
    if(cloudRevision===0&&!appEntries.length)return toast('Your app journal entries are missing from this browser. Import their backup first.',true);
    if(cloudRevision>0&&!window.confirm('Publish this device’s local record over the currently shared version? Keep your backup for comparison.'))return;
    const ok=await publishCloud(true);if(ok)renderAll();
  });
  for(const selector of ['#openJournalComposer','#journalAddButton','#medicationAddButton','#costAddButton','#profilePhotoButton','#carePlanForm button[type=submit]','#wellbeingForm button[type=submit]']){
    const node=q(selector);if(node)node.disabled=!ownerCanEdit;
  }
  qa('[data-edit-observation],[data-edit-medication],[data-edit-cost]').forEach(node=>node.disabled=!ownerCanEdit);
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
  q('#openJournalComposer').addEventListener('click', () => openJournalDialog(todayAppEntry()?.id||''));
  q('#journalAddButton').addEventListener('click', () => openJournalDialog());
  q('#medicationAddButton').addEventListener('click', () => openMedicationDialog());
  q('#addStoolRow').addEventListener('click',()=>addStoolRow());
  q('#stoolRows').addEventListener('click',event=>{if(event.target.closest('[data-remove-stool]'))event.target.closest('.stool-input-row').remove();});
  q('#comparePrimary').addEventListener('change',event=>{comparison.primary=event.target.value;if(comparison.secondary===comparison.primary){comparison.secondary='none';q('#compareSecondary').value='none';}renderJournalTrend();});
  q('#compareSecondary').addEventListener('change',event=>{comparison.secondary=event.target.value;if(comparison.secondary===comparison.primary){comparison.secondary='none';event.target.value='none';}renderJournalTrend();});
  qa('[data-compare-range]').forEach(btn=>btn.addEventListener('click',()=>{comparison.range=btn.dataset.compareRange;comparison.selectedDate=null;renderJournalTrend();}));
  qa('[data-compare-view]').forEach(btn=>btn.addEventListener('click',()=>{comparison.view=btn.dataset.compareView;comparison.selectedDate=null;renderJournalTrend();}));
  q('#compareCyclePicker').addEventListener('click',event=>{const button=event.target.closest('[data-compare-cycle]');if(!button)return;const n=Number(button.dataset.compareCycle);if(comparison.cycles.has(n))comparison.cycles.delete(n);else comparison.cycles.add(n);comparison.selectedDate=null;renderJournalTrend();});
  for(const [id,key] of [['compareFrom','from'],['compareTo','to']])q(`#${id}`).addEventListener('change',event=>{comparison[key]=event.target.value;comparison.selectedDate=null;renderJournalTrend();});
  q('#journalTrend').addEventListener('click',event=>{const hit=event.target.closest('[data-compare-date]');if(hit){comparison.selectedDate=hit.dataset.compareDate;renderComparisonDetail();}});
  q('#journalTrend').addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target.closest('[data-compare-date]')){event.preventDefault();comparison.selectedDate=event.target.closest('[data-compare-date]').dataset.compareDate;renderComparisonDetail();}});
  q('#journalHistoryToggle').addEventListener('click',()=>{journalShowAll=!journalShowAll;renderJournal();});
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
  document.addEventListener('click',event=>{
    const journal=event.target.closest('[data-edit-observation]');
    if(journal)openJournalDialog(journal.dataset.editObservation);
    const medication=event.target.closest('[data-edit-medication]');
    if(medication)openMedicationDialog(medication.dataset.editMedication);
    const cost=event.target.closest('[data-edit-cost]');
    if(cost)openCostCorrectionDialog(cost.dataset.editCost);
  });
}

function openCostCorrectionDialog(id){
  const row=state.costs.find(c=>c.id===id);if(!row)return;
  const form=q('#costCorrectionForm');
  for(const name of ['date','amountPaid','provider','label'])form.elements.namedItem(name).value=row[name]??'';
  form.elements.namedItem('editId').value=id;
  q('#costCorrectionDialog').showModal();
}

function openJournalDialog(id=''){
  const form=q('#journalForm');form.reset();form.querySelectorAll('option[data-historical]').forEach(option=>option.remove());q('#journalEditId').value=id;
  const row=state.observations.find(o=>o.id===id);
  if(row)for(const [name,value] of Object.entries(row)){
    const field=form.elements.namedItem(name);
    if(field&&name!=='medications'){
      const selected=value??'';
      if(field.tagName==='SELECT'&&selected!==''&&![...field.options].some(option=>option.value===String(selected))){
        const option=new Option(String(selected),String(selected));option.dataset.historical='';field.add(option);
      }
      field.value=selected;
    }
  }
  if(row)form.elements.namedItem('medications').value=(row.medications||[]).join(', ');
  q('#stoolRows').replaceChildren();
  const legacyStool=String(row?.stool||'');
  const legacyPeriod=/\b(Before bed|Overnight|AM|PM)\b/i.exec(legacyStool)?.[1];
  const legacyScore=/\b([1-8])\b/.exec(legacyStool)?.[1];
  const simpleLegacy=/^(?:AM|PM|Before bed|Overnight)?\s*[-:]?\s*[1-8](?:\s*(?:AM|PM|Before bed|Overnight))?$/i.test(legacyStool.trim());
  const events=row?.stoolEvents?.length?row.stoolEvents:legacyStool?[{period:legacyPeriod?({am:'AM',pm:'PM','before bed':'Before bed',overnight:'Overnight'}[legacyPeriod.toLowerCase()]):'Other',score:legacyScore?Number(legacyScore):null,status:'observed',notes:simpleLegacy?'':legacyStool}]:[];
  if(events.length)events.forEach(addStoolRow);else addStoolRow();
  q('#journalDate').value=row?.date||todayIso();
  q('#journalDialogTitle').textContent=row?(row.rawEntry?'Correct original note':'Edit daily entry'):'New daily entry';
  q('#journalSaveButton').textContent=row?'Save changes':'Save entry';
  q('#journalEditHelp').textContent=row?.rawEntry?'The original text below this entry stays intact. Your changes are saved with a correction record.':'Start now and come back later to add more to this same day.';
  els.journalDialog.showModal();
}

function todayAppEntry(){
  return [...state.observations].reverse().find(o=>o.date===todayIso()&&!o.rawEntry&&o.source==='owner_observation');
}

function addStoolRow(row={}){
  const wrap=document.createElement('div');wrap.className='stool-input-row';
  wrap.innerHTML=`<div class="stool-input-main"><label class="field"><span>When</span><select data-stool-period><option>AM</option><option>PM</option><option>Before bed</option><option>Overnight</option><option>Other</option></select></label><label class="field"><span>Time (optional)</span><input data-stool-time type="time"></label><label class="field"><span>Score (1–8)</span><input data-stool-score type="number" min="1" max="8" step="1" inputmode="numeric"></label></div><div class="stool-input-detail"><label class="field"><span>Notes (blood, urgency, volume…)</span><input data-stool-notes placeholder="Optional detail"></label><label class="field stool-status"><span>Status</span><select data-stool-status><option value="observed">Observed</option><option value="not observed">Not observed</option><option value="none">No stool</option></select></label><button class="text-button" type="button" data-remove-stool aria-label="Remove bowel movement">Remove</button></div>`;
  q('#stoolRows').append(wrap);
  wrap.querySelector('[data-stool-period]').value=['AM','PM','Before bed','Overnight'].includes(row.period)?row.period:row.period?'Other':'AM';
  wrap.querySelector('[data-stool-time]').value=row.time||'';
  wrap.querySelector('[data-stool-score]').value=row.score??'';
  wrap.querySelector('[data-stool-notes]').value=row.notes||'';
  wrap.querySelector('[data-stool-status]').add(new Option('Not recorded','not recorded'),2);
  wrap.querySelector('[data-stool-status]').value=row.status||'observed';
}

function collectStoolRows(){
  return qa('#stoolRows .stool-input-row').map(el=>{
    const period=el.querySelector('[data-stool-period]').value;
    const time=el.querySelector('[data-stool-time]').value;
    const scoreText=el.querySelector('[data-stool-score]').value;
    const notes=el.querySelector('[data-stool-notes]').value.trim();
    const status=el.querySelector('[data-stool-status]').value;
    return {period,time:time||null,score:status==='observed'&&scoreText!==''?Number(scoreText):null,status,notes};
  }).filter(x=>x.status!=='observed'||x.score!==null||x.time||x.notes);
}

function recordCorrection(collection,id,after){
  const rows=state[collection],index=rows.findIndex(row=>row.id===id);
  if(index<0)return false;
  const before=structuredClone(rows[index]);
  rows[index]={...before,...after};
  state.recordCorrections.push({collection,id,before,after:structuredClone(after),at:new Date().toISOString()});
  return true;
}

function bindForms(){
  document.addEventListener('submit',event=>{
    if(['ownerLogin','ownerLinkPaste','ownerPairPaste'].includes(event.target.id)||ownerCanEdit)return;
    event.preventDefault();event.stopImmediatePropagation();
    toast('Only Roger’s owner can change this record. Sign in first.',true);
  },true);
  q('#wellbeingForm').addEventListener('submit',async event=>{
    event.preventDefault();const fd=new FormData(event.currentTarget),date=String(fd.get('date')||''),score=Number(fd.get('score'));
    if(!date||!Number.isInteger(score)||score<0||score>10)return toast('Choose a date and a score from 0 to 10',true);
    const existing=state.qualityOfLife.find(x=>x.date===date),entry={id:existing?.id||uid('qol'),date,score,notes:String(fd.get('notes')||'').trim(),source:'owner weekly check-in'};
    if(existing)recordCorrection('qualityOfLife',existing.id,entry);else state.qualityOfLife.push(entry);
    if(!await saveChanges())return;event.currentTarget.reset();renderAll();toast(existing?'Weekly check-in corrected':'Weekly check-in saved');
  });
  q('#journalForm').addEventListener('submit', async event => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const stoolEvents=collectStoolRows();
    const tracked=['appetite','energy','nausea','vomiting','hydration','urination','pain','mood','play','sleep','rogerThings','gi','medications','notes'];
    if(!stoolEvents.length&&!tracked.some(key=>String(fd.get(key)??'').trim()))return toast('Add a note or at least one observation before saving',true);
    const obs = {
      id: uid('obs'), date: fd.get('date'), appetite: fd.get('appetite'), energy: fd.get('energy'),
      nausea:fd.get('nausea')===''?null:Number(fd.get('nausea')), vomiting:fd.get('vomiting')===''?null:Number(fd.get('vomiting')),
      stool:stoolEvents.map(s=>`${s.period}${s.time?' '+s.time:''}: ${s.status==='observed'?(s.score??'unscored'):s.status}${s.notes?' ('+s.notes+')':''}`).join(' | '),stoolEvents,
      hydration: fd.get('hydration'), urination: fd.get('urination'), pain:fd.get('pain')===''?null:Number(fd.get('pain')),
      mood:fd.get('mood'),play:fd.get('play'),sleep:fd.get('sleep'),rogerThings:fd.get('rogerThings'),gi:fd.get('gi'),
      medications: String(fd.get('medications') || '').split(',').map(x=>x.trim()).filter(Boolean),
      notes: String(fd.get('notes')||'').trim(), source:'owner_observation'
    };
    const editId=String(fd.get('editId')||'');
    if(editId){if(!recordCorrection('observations',editId,{...obs,id:editId}))return toast('Entry no longer found',true);}
    else state.observations.push(obs);
    state.observations.sort((a,b)=>a.date.localeCompare(b.date));
    if(!state.journalCoverageThrough||obs.date>state.journalCoverageThrough)state.journalCoverageThrough=obs.date;
    if(!await saveChanges())return; renderAll(); els.journalDialog.close(); toast(editId?'Entry updated':'Entry saved');
  });

  q('#costForm').addEventListener('submit', async event => {
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
    if(!await saveChanges())return; renderAll(); els.costDialog.close(); event.currentTarget.reset(); toast('Cost saved');
  });

  q('#medicationForm').addEventListener('submit', async event => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const editId=String(fd.get('editId')||'');
    const administration={
      id:uid('medadm'),
      medicationId:fd.get('medicationId'),
      date:fd.get('date'),
      time:fd.get('time') || null,
      dose:String(fd.get('dose')||'').trim(),
      tabletQuantity: fd.get('tabletQuantity') === '' ? null : Number(fd.get('tabletQuantity')),
      status:fd.get('status') || 'given',
      reason:String(fd.get('reason')||'').trim(),
      source:'owner journal'
    };
    if(editId){if(!recordCorrection('medicationAdministrations',editId,{...administration,id:editId}))return toast('Dose no longer found',true);}
    else state.medicationAdministrations.push(administration);
    state.medicationAdministrations.sort((a,b)=>a.date.localeCompare(b.date)||(a.time||'').localeCompare(b.time||''));
    if(administration.medicationId==='med-prednisone'&&administration.status==='given'){
      const course=state.medicationCourses.find(c=>c.medicationId==='med-prednisone'&&!c.endDate);
      if(course?.confirmedThrough&&administration.date===addDays(course.confirmedThrough,1))course.confirmedThrough=administration.date;
    }
    if(!await saveChanges())return; renderAll(); els.medicationDialog.close(); event.currentTarget.reset(); toast(editId?'Medication record corrected':'Medication administration saved');
  });

  q('#carePlanForm').addEventListener('submit',async event=>{
    event.preventDefault();const fd=new FormData(event.currentTarget);
    const instructions=String(fd.get('vetCallInstructions')||'').trim(),source=String(fd.get('vetCallSource')||'').trim();
    if(instructions&&!source)return toast('Add the vet instruction source or date',true);
    state.carePlan.visits.forEach(v=>{const date=String(fd.get(v.id)||'')||null;if(date!==v.date){v.date=date;v.source=date?'Owner-entered appointment update':'Owner marked date TBD';}});
    state.carePlan.vetCallInstructions=instructions;
    state.carePlan.vetCallSource=source;
    if(!await saveChanges())return;renderUpcomingCare();toast('Care plan saved');
  });

  q('#costCorrectionForm').addEventListener('submit',async event=>{
    event.preventDefault();const fd=new FormData(event.currentTarget),id=String(fd.get('editId')||'');
    const amount=Number(fd.get('amountPaid'));
    const allocated=state.medicationPurchases.filter(p=>p.costId===id).reduce((n,p)=>n+Number(p.amountPaid||0),0);
    if(!Number.isFinite(amount)||amount<allocated-.005)return toast(`Amount cannot be below allocated medication purchases (${money(allocated)})`,true);
    if(!recordCorrection('costs',id,{date:fd.get('date'),amountPaid:amount,provider:String(fd.get('provider')||'').trim(),label:String(fd.get('label')||'').trim()}))return toast('Cost no longer found',true);
    if(!await saveChanges())return;renderAll();q('#costCorrectionDialog').close();toast('Cost corrected');
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
      await loadDocuments(); renderDocuments();
      try{await persist();toast('Document saved on this device');}
      catch(_){toast('Document saved, but backup status could not update. Export a complete backup now.',true);}
    } catch (err) { toast('Could not save document on this device', true); }
  });
}

function openMedicationDialog(id=''){
  q('#medicationForm').reset();
  const select=q('#medicationSelect');
  select.innerHTML=(state.medications||[]).map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
  q('#medicationDate').value=todayIso();
  q('#medicationTime').value='';
  selectMedicationDefaultDose();
  select.onchange=selectMedicationDefaultDose;
  q('#medicationDate').onchange=selectMedicationDefaultDose;
  q('#medicationDose').oninput=suggestTabletQuantity;
  q('#medicationEditId').value=id;
  const row=state.medicationAdministrations.find(a=>a.id===id);
  if(row){
    for(const name of ['medicationId','date','time','dose','tabletQuantity','status','reason']){
      const field=q('#medicationForm').elements.namedItem(name);
      if(field)field.value=row[name]??'';
    }
    selectMedicationDefaultDose();q('#medicationDose').value=row.dose||'';
    q('#medicationTabletQuantity').value=row.tabletQuantity??'';
  }
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
      state.profile.photoDataUrl = dataUrl; if(!await saveChanges())return; renderProfile(); toast('Profile photo updated');
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
  renderProfile(); renderHome(); renderClinicalReview(); renderUpcomingCare(); renderTreatmentOverlay(); renderJournal(); renderWellbeing(); renderMedications(); renderTimeline(); renderCosts(); renderProfileDetails(); renderDocuments(); renderBackupStatus(); renderSharedStatus();
}
function renderWellbeing(){
  const rows=[...(state.qualityOfLife||[])].sort((a,b)=>b.date.localeCompare(a.date));
  const form=q('#wellbeingForm');if(form&&!form.elements.date.value)form.elements.date.value=todayIso();
  q('#wellbeingHistory').innerHTML=rows.length?rows.slice(0,6).map(x=>`<div class="wellbeing-row"><strong>${fmtDate(x.date)} · ${x.score}/10</strong>${x.notes?`<span>${esc(x.notes)}</span>`:''}</div>`).join(''):'<p class="empty-state">No weekly check-in yet. The daily journal remains available as-is.</p>';
}

function readBackupMeta(){try{return JSON.parse(localStorage.getItem(BACKUP_META_KEY)||'{}')}catch(_){return {}}}
function renderBackupStatus(){
  if(!state)return;
  const meta=readBackupMeta(),current=Boolean(meta.confirmedStateAt&&meta.confirmedStateAt===state._savedAt);
  const last=meta.confirmedAt?new Date(meta.confirmedAt).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'No off-device copy confirmed';
  const message=current?`Backup confirmed ${last}. Keep the dated file outside this device.`:`${last}. Changes on this device need a new backup.`;
  const home=q('#homeBackupStatus'),more=q('#backupStatus');
  if(home)home.innerHTML=`<strong>${current?'Backup up to date':'Backup needed'}</strong><span>${esc(message)}</span><button type="button" data-open-backup>${current?'View backup':'Back up now'}</button>`;
  if(more)more.innerHTML=`<strong>${current?'Backup up to date':'Backup needed'}</strong><p>${esc(message)}</p>${recoveredFromSnapshot?'<p>Local recovery copy was used at startup. Export a complete file now.</p>':''}`;
  q('#confirmBackupSaved').hidden=!backupPreparedAt;
}

function renderUpcomingCare(){
  const plan=state.carePlan||{visits:[]};
  els.upcomingCare.innerHTML=`<div class="care-plan-list">${(plan.visits||[]).map(v=>`<div class="care-plan-row"><strong>${esc(v.label)}</strong><span>${v.date?fmtDate(v.date):'TBD'}</span></div>`).join('')}</div><p class="medication-note"><strong>When to call:</strong> ${plan.vetCallInstructions?esc(plan.vetCallInstructions):'Awaiting Roger’s veterinarian’s instructions.'}${plan.vetCallSource?` <small>(${esc(plan.vetCallSource)})</small>`:''}</p>`;
  q('#carePlanFields').innerHTML=(plan.visits||[]).map(v=>`<label class="field"><span>${esc(v.label)}</span><input type="date" name="${esc(v.id)}" value="${esc(v.date||'')}"></label>`).join('');
  q('#vetCallInstructions').value=plan.vetCallInstructions||'';
  q('#vetCallSource').value=plan.vetCallSource||'';
}

function renderProfile(){
  const p = state.profile;
  els.petName.textContent = p.fullName||p.name;
  els.patientIds.innerHTML = [['KSU',p.patientIds?.ksu],['Optimum',p.patientIds?.optimum]].filter(([,id])=>id).map(([clinic,id])=>`<span><strong>${clinic}:</strong> ${esc(id)}</span>`).join('');
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
  q('#openJournalComposer').textContent=todayAppEntry()?"Continue today's entry":'Log today';
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
  renderJournalBrief(t);

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
  open.push('CBC and treatment dates for #6–#8 are scheduled; final restaging date remains TBD.');
  open.push('Verify the duplicate vinblastine billing lines on the 10/2 K-State invoice.');
  open.push('Reconcile the 7/14 Optimum surgery/dental invoice when received.');
  els.openItems.innerHTML = open.map(x=>`<div class="open-item"><span class="open-dot"></span><div class="item-copy" style="margin:0">${esc(x)}</div></div>`).join('');
}

function renderJournalBrief(treatment){
  const rows=comparisonRows().filter(r=>r.date>=treatment.date&&r.observations.length);
  if(!rows.length){els.journalBrief.innerHTML='<p class="empty-state">No journal days recorded since this treatment yet.</p>';return;}
  const last=rows.at(-1),reduced=rows.filter(r=>r.values.energy!==null&&r.values.energy<3),energyKnown=rows.filter(r=>r.values.energy!==null);
  const nausea=rows.filter(r=>r.values.nausea>0),loose=rows.filter(r=>r.values.looseStool===1);
  const bloody=rows.filter(r=>r.observations.some(o=>[o.gi,o.notes,...(o.stoolEvents||[]).map(s=>s.notes)].some(v=>/\bblood\b/i.test(String(v||'')))));
  const scores=rows.map(r=>r.values.stoolScore).filter(v=>v!==null);
  const sentences=[`${rows.length} of ${daysBetween(treatment.date,last.date)+1} days logged since chemo #${treatment.number} (${fmtDate(treatment.date)}–${fmtDate(last.date)}).`];
  if(energyKnown.length)sentences.push(`Energy was reduced or low on ${reduced.length} of ${energyKnown.length} days with an energy entry${last.values.energy===3&&reduced.length?' and was recorded as normal on the latest day':''}.`);
  const symptoms=[];
  if(nausea.length)symptoms.push(`nausea signs on ${nausea.length} day${nausea.length===1?'':'s'}`);
  if(loose.length)symptoms.push(`loose stool or diarrhea on ${loose.length} day${loose.length===1?'':'s'}`);
  if(bloody.length)symptoms.push(`blood mentioned on ${bloody.length} day${bloody.length===1?'':'s'}`);
  if(symptoms.length)sentences.push(`Journaled: ${symptoms.join('; ')}.`);
  else if(scores.length)sentences.push(`Highest recorded stool score: ${Math.max(...scores)}. Symptoms without entries are unknown.`);
  const note=rows.slice().reverse().flatMap(r=>r.observations.filter(o=>!o.rawEntry&&String(o.notes||'').trim().length>45).map(o=>({date:o.date,text:o.notes}))).at(0);
  els.journalBrief.innerHTML=`<p class="journal-brief-copy">${sentences.map(esc).join(' ')}</p>${note?`<div class="journal-brief-note"><strong>Your note · ${fmtDate(note.date)}</strong><span>${esc(note.text.length>200?note.text.slice(0,197)+'…':note.text)}</span></div>`:''}<p class="field-help">Drawn from dated journal entries. A day without an entry is not counted as symptom-free.</p>`;
}

function renderClinicalReview(){
  if(!els.cycleClinicalReview)return;
  const treatments=[...state.treatments].sort((a,b)=>a.number-b.number),rows=comparisonRows();
  els.cycleClinicalReview.innerHTML=treatments.slice().reverse().map((t,index)=>{
    const window=cycleWindowFor(t,treatments),next=treatments.find(x=>x.number===t.number+1);
    const days=rows.filter(r=>r.date>=window.start&&r.date<window.endExclusive&&r.observations.length);
    const postCounts=state.labs.filter(l=>l.metric==='Neutrophils'&&l.date>t.date&&l.date<window.endExclusive);
    const lowest=postCounts.length?postCounts.reduce((a,b)=>Number(a.value)<=Number(b.value)?a:b):null;
    const preCounts=state.labs.filter(l=>l.metric==='Neutrophils'&&l.date<=t.date&&daysBetween(l.date,t.date)<=2).sort((a,b)=>b.date.localeCompare(a.date));
    const pre=preCounts[0],nausea=days.filter(r=>r.values.nausea>0).length,loose=days.filter(r=>r.values.looseStool===1).length;
    const blood=days.filter(r=>r.observations.some(o=>[o.gi,o.notes,...(o.stoolEvents||[]).map(s=>s.notes)].some(text=>/\bblood\b/i.test(String(text||''))))).length;
    const supportive=(state.medicationAdministrations||[]).filter(a=>a.date>=window.start&&a.date<window.endExclusive&&a.status==='given');
    const courses=(state.medicationCourses||[]).filter(c=>c.startDate<window.endExclusive&&courseRecordedEnd(c)>=window.start&&c.status?.includes('owner-confirmed'));
    const medSummary=[...courses.map(c=>`${medicationName(c.medicationId)} course reported through ${fmtDate(courseRecordedEnd(c))}`),...[...new Set(supportive.map(a=>a.medicationId))].map(id=>`${medicationName(id)} ${new Set(supportive.filter(a=>a.medicationId===id).map(a=>a.date)).size} dated administration(s)`) ].join('; ');
    const lowestText=lowest?`${lowest.displayValue||lowest.value} ${lowest.unit} on day +${daysBetween(t.date,lowest.date)} (${fmtDate(lowest.date)})`:'No post-dose count stored';
    return `<details class="clinical-review-cycle" ${index===0?'open':''}><summary><span><strong>Chemo #${t.number} · ${fmtDate(t.date)}</strong><small>${t.doseMg} mg (${t.doseMgM2} mg/m²) · ${t.weightLb} lb</small></span><span class="review-cue">Review</span></summary><div class="clinical-review-grid">
      <div><strong>Before dose</strong><span>${pre?`Neutrophils ${esc(pre.displayValue||pre.value)} ${esc(pre.unit)} · ${fmtDate(pre.date)}`:'No CBC within two days stored'}</span></div>
      <div><strong>After dose</strong><span>Lowest measured neutrophils: ${esc(lowestText)}</span></div>
      <div><strong>Home observations</strong><span>${days.length} day(s) logged · nausea ${nausea} · loose stool/diarrhea ${loose} · blood mentioned ${blood}. Blank symptom days are not assumed symptom-free.</span></div>
      <div><strong>Medication context</strong><span>${esc(medSummary||'No medication use recorded in this period')}</span></div>
      <div class="review-wide"><strong>Next recorded decision</strong><span>${next?`${fmtDate(next.date)} · ${esc(next.doseReason||'Reason not recorded')}`:'Next dose is scheduled; no decision recorded yet.'}</span></div>
    </div></details>`;
  }).join('');
}

function compactObservation(o){
  const parts=[]; if(o.energy)parts.push(`energy ${o.energy}`); if(o.nausea)parts.push(o.nausea===1?'nausea signs':`nausea ${['none','mild','moderate','severe'][o.nausea]}`); if(o.vomiting)parts.push(`${o.vomiting} vomit`);
  const stools=(o.stoolEvents||[]).filter(s=>s.status==='observed');
  const scored=stools.map(s=>Number(s.score)).filter(n=>Number.isFinite(n)&&n>0);
  if(stools.length)parts.push(`${stools.length} stool${stools.length===1?'':'s'}${scored.length?', highest '+Math.max(...scored):''}`);
  else if(o.stool)parts.push(`stool ${o.stool}`);
  return parts.join(', ') || (o.notes||'').slice(0,60);
}
function severityChip(o){
  const severity=symptomSeverity(o);
  if(severity>=2)return '<span class="chip warn">symptoms logged</span>';
  if(severity>=1)return '<span class="chip info">signs logged</span>';
  return '<span class="chip">owner note</span>';
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
  const courses=(state.medicationCourses||[]).filter(c=>courseRecordedEnd(c)&&c.startDate<=(window?.displayEnd||'9999-12-31')&&courseRecordedEnd(c)>=startDate);
  const treatments=selectedCycle?[selectedCycle]:allTreatments;
  const endDate=window?.displayEnd||[...blood,...symptoms,...medications,...treatments].map(p=>p.date).concat(courses.map(courseRecordedEnd)).sort().at(-1)||startDate;
  const days=Math.max(1,daysBetween(startDate,endDate));
  const laneMeds=[...new Set([...medications.map(a=>a.medicationId),...courses.map(c=>c.medicationId)])].sort((a,b)=>(a==='med-cerenia'?-1:b==='med-cerenia'?1:a.localeCompare(b)));
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
  const guideDates=[...new Set([...medications,...treatments].map(p=>p.date).concat(courses.map(c=>c.startDate).filter(d=>d>=startDate&&d<=endDate)))];
  if(selectedCycle)for(let i=0;i<=days;i++)svg+=`<line x1="${x(addDays(startDate,i))}" x2="${x(addDays(startDate,i))}" y1="38" y2="${symptomBottom+5}" stroke="#edf0f5"/>`;
  guideDates.forEach(date=>svg+=`<line data-guide-date="${date}" x1="${x(date)}" x2="${x(date)}" y1="38" y2="${symptomBottom+5}" stroke="#667085" stroke-opacity=".35" stroke-dasharray="4 5"/>`);
  svg+=`<line id="selectedEventGuide" x1="0" x2="0" y1="38" y2="${symptomBottom+5}" stroke="#512888" stroke-width="2" stroke-dasharray="4 5" visibility="hidden"/>`;
  const heading=(label,y,color)=>`<text x="8" y="${y}" font-size="13" font-weight="800" fill="${color}">${esc(label)}</text>`;
  svg+=heading('VINBLASTINE · mg/m²',22,'#512888');
  svg+=heading(`${metric.toUpperCase()} · ${unit}`,140,'#b44f5c');
  svg+=heading('MEDICATIONS · ▰ reported course  □ given  ▫ held',medTop-24,'#667085');
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
  courses.forEach((c,i)=>{
    const left=x(c.startDate<startDate?startDate:c.startDate),right=x(courseRecordedEnd(c)>endDate?endDate:courseRecordedEnd(c));
    const y=medTop+laneMeds.indexOf(c.medicationId)*32;
    const label=`${medicationName(c.medicationId)} · ${fmtDate(c.startDate)}–${fmtDate(courseRecordedEnd(c))} · reported course`;
    svg+=`<g class="chart-hit" role="button" tabindex="0" data-kind="course" data-index="${i}" aria-label="${esc(label)}"><title>${esc(label)}</title><line x1="${left}" x2="${Math.max(left+3,right)}" y1="${y}" y2="${y}" stroke="${c.medicationId==='med-prednisone'?'#512888':'#667085'}" stroke-width="8" opacity=".58" stroke-linecap="round"/><line x1="${left}" x2="${Math.max(left+3,right)}" y1="${y}" y2="${y}" stroke="transparent" stroke-width="28"/></g>`;
  });
  if(!medications.length&&!courses.length)svg+=`<text x="8" y="${medTop+4}" font-size="13" fill="#707181">No medication use recorded in this window</text>`;
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
      const point=({blood,treatment:treatments,symptom:symptoms,medication:medications,course:courses})[kind][i];
      const date=kind==='course'?(point.startDate<startDate?startDate:point.startDate):point.date;
      const guide=root.querySelector('#selectedEventGuide');guide.setAttribute('x1',x(date));guide.setAttribute('x2',x(date));guide.setAttribute('visibility','visible');
      if(kind==='course'){
        detail.innerHTML=`<strong>${esc(medicationName(point.medicationId))} · ${fmtDate(point.startDate)}–${fmtDate(courseRecordedEnd(point))}</strong>${esc(point.dose||'Dose unrecorded')} · ${esc(point.frequency||'Frequency unrecorded')}. ${esc(point.status)}. ${esc(point.source)}`;
        return;
      }
      const when=`${fmtDate(point.date)}${selectedCycle?` · Day +${daysBetween(startDate,point.date)}`:''}`;
      if(kind==='blood')detail.innerHTML=`<strong>${when} · ${esc(metric)} ${esc(point.displayValue||point.value)} ${esc(point.unit)}</strong>${esc(point.context)} · ${esc(point.source)}`;
      else if(kind==='treatment')detail.innerHTML=`<strong>${when} · Chemo #${point.number}</strong>Vinblastine ${point.doseMg} mg · ${point.doseMgM2} mg/m² · ${point.weightLb} lb. ${esc(point.doseReason)}`;
      else if(kind==='symptom')detail.innerHTML=`<strong>${when} · Owner observations</strong>${esc(compactObservation(point))}. ${esc(point.notes)}`;
      else detail.innerHTML=`<strong>${when}${point.time?` · ${esc(point.time)}`:''} · ${esc(medicationName(point.medicationId))} ${esc(point.dose)}</strong>${esc(point.status)}${point.status==='given'&&tabletQuantity(point)!=null?` · ${tabletQuantity(point)} tablet(s)`:''} · ${esc(point.reason||'No reason recorded')}`;
    };
    node.addEventListener('click',show);node.addEventListener('focus',show);node.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();show();}});
  });
  detail.innerHTML=selectedCycle?`<strong>Chemo #${selectedCycle.number} · ${fmtDate(startDate)}–${fmtDate(endDate)}</strong>Calendar dates align every lane. Swipe the chart for later dates; tap a course bar or dose marker for details.`:'<strong>All treatment cycles</strong>Purple: treatment. Red: bloodwork. Medication course bars, dose markers, and blue observations share the same dates. Tap an event for details.';
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

function courseRecordedEnd(course){
  return course.endDate||course.confirmedThrough||null;
}

function reportedCourseDays(id,window=null){
  const explicit=new Set((state.medicationAdministrations||[]).filter(a=>a.medicationId===id).map(a=>a.date));
  const days=[];
  for(const course of state.medicationCourses||[]){
    if(course.medicationId!==id||!course.status?.includes('owner-confirmed daily given')||!courseRecordedEnd(course))continue;
    for(let date=course.startDate;date<=courseRecordedEnd(course);date=addDays(date,1)){
      if(!explicit.has(date)&&(!window||inCycleWindow(date,window)))days.push({medicationId:id,date,dose:course.dose,status:'given',reason:'Owner-confirmed daily course',source:course.source,reportedFromCourse:course.id});
    }
  }
  return days;
}

function renderCycleDetails(treatment,window){
  const allTreatments=state.treatments.slice().sort((a,b)=>a.number-b.number);
  const labs=state.labs.filter(x=>inCycleWindow(x.date,window)).sort((a,b)=>a.date.localeCompare(b.date)||a.metric.localeCompare(b.metric));
  const observations=state.observations.filter(x=>inCycleWindow(x.date,window)).sort((a,b)=>a.date.localeCompare(b.date));
  const medications=(state.medicationAdministrations||[]).filter(x=>inCycleWindow(x.date,window)).sort((a,b)=>a.date.localeCompare(b.date)||(a.time||'').localeCompare(b.time||''));
  const courses=(state.medicationCourses||[]).filter(c=>courseRecordedEnd(c)&&c.startDate<=window.displayEnd&&courseRecordedEnd(c)>=window.start);
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
    <div class="cycle-section"><div class="cycle-section-title owner-title">MEDICATION USE</div>${courses.map(c=>`<div class="cycle-observation medication-cycle-observation"><div class="cycle-observation-title">${esc(medicationName(c.medicationId))} · ${fmtDate(c.startDate)}–${fmtDate(courseRecordedEnd(c))}</div><div class="cycle-observation-copy">${esc(c.dose||'Dose unrecorded')} · ${esc(c.frequency||'Frequency unrecorded')} · ${esc(c.status)}</div></div>`).join('')}${medications.map(a=>`<div class="cycle-observation medication-cycle-observation"><div class="cycle-observation-title">${fmtDate(a.date)}${a.time?` · ${esc(a.time)}`:''} · ${esc(medicationName(a.medicationId))} ${esc(a.dose||'')}</div><div class="cycle-observation-copy">${esc(a.status)}${a.reason?` · ${esc(a.reason)}`:''}</div></div>`).join('')}${!courses.length&&!medications.length?'<div class="empty-state">No medication use recorded in this cycle.</div>':''}</div>
    ${treatment.recordCheck?`<div class="alert"><strong>Record check:</strong> ${esc(treatment.recordCheck)}</div>`:''}
  </section>`;
}

function symptomSummary(o){
  const parts=[];
  if(Number(o.nausea)>0) parts.push(Number(o.nausea)===1?'nausea signs':`${['none','mild','moderate','severe'][Number(o.nausea)]} nausea`);
  if(Number(o.vomiting)>0) parts.push(`${o.vomiting} vomiting event${Number(o.vomiting)===1?'':'s'}`);
  const stools=(o.stoolEvents||[]).filter(s=>s.status==='observed');
  const scores=stools.map(s=>Number(s.score)).filter(n=>Number.isFinite(n)&&n>0);
  if(stools.length)parts.push(`${stools.length} stool${stools.length===1?'':'s'}${scores.length?', highest '+Math.max(...scores):''}`);
  else if(o.stool)parts.push(`stool ${o.stool}`);
  if(String(o.energy||'').toLowerCase().includes('low')||String(o.energy||'').toLowerCase().includes('reduced')) parts.push(`energy ${o.energy}`);
  return `${fmtDate(o.date).replace(', 2026','')} · ${parts.join(', ')||o.notes.slice(0,80)}`;
}

function symptomSeverity(o){
  let s=0;
  s=Math.max(s,Number(o.nausea)||0,Number(o.pain)||0);
  if(Number(o.vomiting)>0) s=Math.max(s,2);
  const scores=(o.stoolEvents||[]).filter(row=>row.status==='observed').map(row=>Number(row.score)).filter(n=>Number.isFinite(n)&&n>0);
  const stool=scores.length?Math.max(...scores):parseFloat(o.stool);
  if(Number.isFinite(stool) && stool>=6) s=Math.max(s,2);
  if(/low|reduced/i.test(o.energy||'')) s=Math.max(s,1);
  return s;
}

function renderJournal(){
  const obs=[...state.observations].sort((a,b)=>b.date.localeCompare(a.date));
  const byDate=new Map();
  obs.forEach(o=>{if(!byDate.has(o.date))byDate.set(o.date,[]);byDate.get(o.date).push(o);});
  const days=[...byDate.entries()];
  const shown=journalShowAll?days:days.slice(0,7);
  const nauseaDays=new Set(obs.filter(o=>Number(o.nausea)>0).map(o=>o.date)).size;
  const medDays=new Set([...state.medicationAdministrations.filter(a=>a.status==='given').map(a=>a.date),...reportedCourseDays('med-prednisone').map(a=>a.date)]).size;
  els.journalSummary.innerHTML = [
    [new Set(obs.map(o=>o.date)).size,'DAYS WITH ENTRIES'],
    [nauseaDays,'NAUSEA DAYS'],
    [medDays,'MEDICATION DAYS'],
    [fmtDate([state.journalCoverageThrough,obs[0]?.date].filter(Boolean).sort().at(-1)||'2026-10-03').replace(', 2026',''),'ENTRIES THROUGH']
  ].map(x=>`<div class="summary-tile"><div class="summary-value">${x[0]}</div><div class="summary-label">${x[1]}</div></div>`).join('');
  renderJournalTrend();
  q('#journalHistoryToggle').textContent=journalShowAll?'Show recent entries':`Show all ${days.length} days`;
  els.journalEntries.innerHTML = shown.map(([date,entries])=>{
    entries.sort((a,b)=>Number(Boolean(b.rawEntry))-Number(Boolean(a.rawEntry)));
    const sources=entries.map(o=>{
      const stools=(o.stoolEvents||[]).filter(s=>s.status==='observed');
      const stoolLine=stools.length?`<div class="journal-stool-line"><strong>${stools.length} bowel movement${stools.length===1?'':'s'}</strong> · ${stools.map(s=>`${esc(s.period||'Other')}${s.time?' '+esc(s.time):''}: ${s.score==null?'unscored':esc(s.score)}${s.notes&&(/blood|urgenc|diarrhea/i.test(s.notes))?' · '+esc(s.notes):''}`).join(' · ')}</div>`:'';
      return `<div class="journal-source"><div class="row-between"><div class="item-meta"><strong>${o.rawEntry?'Original owner journal':'App entry'}</strong>${o.weightLb?` · ${esc(o.weightLb)} lb`:''}</div><button class="text-button" type="button" data-edit-observation="${esc(o.id)}">${o.rawEntry?'Correct':'Edit entry'}</button></div><div class="chip-row">${observationChips(o)}</div>${stoolLine}<div class="item-copy">${esc(o.notes)}</div>${o.recordClarification?`<div class="record-clarification"><strong>Confirmed correction:</strong> ${esc(o.recordClarification)}</div>`:''}${o.medications?.length?`<div class="item-meta journal-med-line"><strong>Medication noted:</strong> ${esc(o.medications.join(', '))}</div>`:''}${o.rawEntry?`<details class="original-entry"><summary>Full original entry</summary><pre>${esc(o.rawEntry)}</pre></details>`:''}</div>`;
    }).join('');
    const severity=entries.reduce((a,b)=>symptomSeverity(a)>symptomSeverity(b)?a:b);
    return `<article class="observation-card"><div class="row-between"><div class="item-title">${fmtDate(date)}${entries.length>1?` <small class="journal-source-count">· ${entries.length} notes</small>`:''}</div>${severityChip(severity)}</div>${sources}</article>`;
  }).join('');
}
function observationChips(o){
  const chips=[];
  if(o.appetite)chips.push(`appetite: ${o.appetite}`); if(o.energy)chips.push(`energy: ${o.energy}`); if(Number(o.nausea)>0)chips.push(`nausea signs${Number(o.nausea)>1?` · ${['','', 'moderate','severe'][o.nausea]}`:''}`); if(Number(o.vomiting)>0)chips.push(`vomiting: ${o.vomiting}`); if(o.stool&&!o.stoolEvents?.length)chips.push(`stool: ${o.stool}`); if(o.hydration)chips.push(`water: ${o.hydration}`); if(o.urination)chips.push(`${o.urination}`); if(Number(o.pain)>0)chips.push(`pain: ${o.pain}/3`);if(o.rogerThings)chips.push(`Roger things: ${o.rogerThings}`);
  return chips.map(x=>`<span class="chip">${esc(x)}</span>`).join('');
}

const COMPARE_METRICS={
  energy:{label:'Energy level',min:0,max:4,ticks:[0,1,2,3,4],names:['Very low','Low','Slightly reduced','Normal','High'],unit:'',kind:'owner'},
  nausea:{label:'Nausea signs',min:0,max:3,ticks:[0,1,2,3],names:['None','Signs','Moderate','Severe'],unit:'',kind:'owner'},
  stoolCount:{label:'Bowel movements',min:0,ticks:[0,2,4,6],unit:'',kind:'owner'},
  stoolScore:{label:'Highest stool score',min:1,max:8,ticks:[1,4,6,8],unit:'',kind:'owner'},
  looseStool:{label:'Loose stool / diarrhea',min:0,max:1,ticks:[0,1],names:['No score ≥6','Score ≥6 / noted'],unit:'',kind:'owner'},
  rogerThings:{label:'Roger things',min:0,max:2,ticks:[0,1,2],names:['None','Reduced','Yes'],unit:'',kind:'owner'},
  qol:{label:'Weekly wellbeing',min:0,max:10,ticks:[0,5,10],unit:'/10',kind:'owner'},
  cerenia:{label:'Cerenia doses logged',min:0,ticks:[0,1,2],unit:'',kind:'medication'},
  neutrophils:{label:'Neutrophils',min:0,ticks:[0,5,10,15],unit:' K/µL',kind:'lab'},
  hematocrit:{label:'Hematocrit',min:0,ticks:[0,15,30,45],unit:'%',kind:'lab'},
  platelets:{label:'Platelets',min:0,ticks:[0,150,300,450],unit:' K/µL',kind:'lab'},
  alt:{label:'ALT',min:0,ticks:[0,100,200,400],unit:' U/L',kind:'lab'},
  alp:{label:'ALP',min:0,ticks:[0,500,1000,2000],unit:' U/L',kind:'lab'},
  weight:{label:'Weight',ticks:[],unit:' lb',kind:'weight'}
};
const dateNumber=date=>Date.parse(`${date}T12:00:00Z`)/86400000;
function energyLevel(text){
  const v=String(text||'').toLowerCase();
  if(!v)return null;
  if(v.includes('very low'))return 0;
  if(v.includes('low'))return 1;
  if(v.includes('reduced'))return 2;
  if(v.includes('normal'))return 3;
  if(v.includes('high'))return 4;
  return null;
}
function rogerThingsLevel(text){const value=String(text||'').toLowerCase();if(!value)return null;if(/none|no interest|not himself/.test(value))return 0;if(/reduced|less/.test(value))return 1;if(/yes|normal/.test(value))return 2;return null;}
function comparisonRows(){
  const byDate=new Map();
  const row=date=>{if(!byDate.has(date))byDate.set(date,{date,observations:[],labs:[],medications:[],treatments:[],qualityOfLife:[]});return byDate.get(date);};
  (state.observations||[]).forEach(o=>row(o.date).observations.push(o));
  (state.qualityOfLife||[]).forEach(o=>row(o.date).qualityOfLife.push(o));
  (state.labs||[]).forEach(l=>row(l.date).labs.push(l));
  (state.medicationAdministrations||[]).forEach(a=>row(a.date).medications.push(a));
  (state.treatments||[]).forEach(t=>row(t.date).treatments.push(t));
  return [...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(d=>{
    const entries=d.observations;
    const originalStools=entries.filter(o=>o.rawEntry).flatMap(o=>o.stoolEvents||[]).filter(s=>s.status==='observed');
    const matchedOriginal=new Set();
    const addedStools=entries.filter(o=>!o.rawEntry).flatMap(o=>o.stoolEvents||[]).filter(s=>s.status==='observed').filter(s=>{
      const index=originalStools.findIndex((prior,i)=>!matchedOriginal.has(i)&&Number(prior.score)===Number(s.score)&&(!s.period||!prior.period||String(prior.period).toLowerCase()===String(s.period).toLowerCase()));
      if(index<0)return true;matchedOriginal.add(index);return false;
    });
    const stools=[...originalStools,...addedStools];
    const legacy=entries.filter(o=>!o.stoolEvents?.length&&o.stool).map(o=>({score:Number.parseFloat(o.stool),period:/\b(AM|PM|Before bed|Overnight)\b/i.exec(o.stool)?.[1]?.toLowerCase()})).filter(s=>Number.isFinite(s.score)&&!stools.some(existing=>Number(existing.score)===s.score&&(!s.period||String(existing.period).toLowerCase()===s.period)));
    const scores=[...stools.map(s=>Number(s.score)).filter(n=>Number.isFinite(n)&&n>0),...legacy.map(s=>s.score)];
    const energy=entries.map(o=>energyLevel(o.energy)).filter(v=>v!==null);
    const rogerThings=entries.map(o=>rogerThingsLevel(o.rogerThings)).filter(v=>v!==null);
    const nausea=entries.map(o=>o.nausea).filter(v=>v!==null&&v!==undefined&&v!=='').map(Number);
    const labFor=metric=>{const lab=d.labs.filter(l=>l.metric===metric).at(-1);return lab?Number(lab.value):null;};
    const ownerWeight=entries.map(o=>Number(o.weightLb)).filter(n=>Number.isFinite(n)&&n>0).at(-1);
    const treatmentWeight=d.treatments.map(t=>Number(t.weightLb)).filter(n=>Number.isFinite(n)&&n>0).at(-1);
    return {...d,values:{
      energy:energy.length?Math.min(...energy):null,
      rogerThings:rogerThings.length?Math.min(...rogerThings):null,
      qol:d.qualityOfLife.length?Number(d.qualityOfLife.at(-1).score):null,
      nausea:nausea.length?Math.max(...nausea):null,
      stoolCount:stools.length+legacy.length||((entries.some(o=>o.stoolEvents?.some(s=>s.status==='none')))?0:null),
      stoolScore:scores.length?Math.max(...scores):null,
      looseStool:/diarrhea/i.test(entries.map(o=>`${o.gi||''} ${o.notes||''}`).join(' '))||scores.some(s=>s>=6)?1:scores.length?0:null,
      cerenia:d.medications.filter(a=>a.medicationId==='med-cerenia'&&a.status==='given').length,
      neutrophils:labFor('Neutrophils'),
      hematocrit:labFor('Hematocrit'),platelets:labFor('Platelets'),alt:labFor('ALT'),alp:labFor('ALP'),
      weight:ownerWeight??treatmentWeight??null
    }};
  });
}
function comparisonRange(rows){
  if(!rows.length)return null;
  const firstOwner=rows.find(r=>r.observations.length)?.date||rows[0].date;
  const latest=rows.at(-1).date;
  if(comparison.range==='custom'){
    if(!comparison.from||!comparison.to||comparison.from>comparison.to)return {error:'Choose a valid start and end date.'};
    return {from:comparison.from,to:comparison.to,contains:date=>date>=comparison.from&&date<=comparison.to};
  }
  if(comparison.range==='cycles'){
    const treatments=[...(state.treatments||[])].sort((a,b)=>a.number-b.number);
    const windows=treatments.filter(t=>comparison.cycles.has(t.number)).map(t=>cycleWindowFor(t,treatments));
    if(!windows.length)return {error:'Select at least one treatment period.'};
    const from=windows[0].start,to=windows.at(-1).displayEnd<latest?windows.at(-1).displayEnd:latest;
    return {from,to,contains:date=>windows.some(w=>date>=w.start&&date<w.endExclusive)};
  }
  return {from:firstOwner,to:latest,contains:date=>date>=firstOwner&&date<=latest};
}
function comparisonScale(key,rows){
  const m=COMPARE_METRICS[key],values=rows.map(r=>r.values[key]).filter(v=>v!==null&&Number.isFinite(v));
  if(key==='weight'){const min=values.length?Math.floor(Math.min(...values)-1):0,max=values.length?Math.ceil(Math.max(...values)+1):10;return {...m,min,max,ticks:[min,Math.round((min+max)/2),max]};}
  if(m.max!==undefined)return m;
  const baseline=m.ticks?.at(-1)||2,max=Math.max(baseline,...values);
  return {...m,max,ticks:max===baseline?m.ticks:[0,Math.round(max/2),max]};
}
function comparisonValue(key,value,row=null){
  if(value===null||value===undefined||!Number.isFinite(value))return 'Not recorded';
  const metric=COMPARE_METRICS[key];
  const labName={neutrophils:'Neutrophils',hematocrit:'Hematocrit',platelets:'Platelets',alt:'ALT',alp:'ALP'}[key];
  if(labName&&row){const lab=row.labs?.filter(l=>l.metric===labName).at(-1);if(lab?.displayValue)return `${lab.displayValue} ${lab.unit} (plotted at ${value})`;}
  return metric.names?.[value]||`${value}${metric.unit}`;
}
function comparisonEventsForDate(date,day){
  const events=[];
  for(const course of state.medicationCourses||[])if(course.startDate===date)events.push(`${medicationName(course.medicationId)} course: ${course.dose||'dose unrecorded'}`);
  for(const med of day.medications)events.push(`${medicationName(med.medicationId)} ${med.dose||''} ${med.status}`.trim());
  const words=day.observations.map(o=>`${o.notes||''} ${o.rawEntry||''}`).join(' ');
  if(/cat food/i.test(words))events.push('Cat food mentioned');
  if(/increased food|food to 1C/i.test(words))events.push('Food amount changed');
  return [...new Set(events)];
}
function renderComparisonDetail(){
  const target=q('#compareDayDetail'),date=comparison.selectedDate,day=comparisonRows().find(row=>row.date===date);
  if(!day){target.innerHTML='<p class="empty-state">Tap a date on either track to inspect the recorded values.</p>';return;}
  const a=comparison.primary,b=comparison.secondary;
  const notes=day.observations.map(o=>`<div class="compare-note"><strong>${o.rawEntry?'Original owner journal':'App entry'}:</strong> ${esc(o.notes||'No further note')}${o.recordClarification?`<br><strong>Confirmed correction:</strong> ${esc(o.recordClarification)}`:''}</div>`).join('');
  const labs=day.labs.map(l=>`<div class="compare-note">${esc(l.metric)}: ${esc(l.displayValue||l.value)} ${esc(l.unit)} · ${esc(l.source)}</div>`).join('');
  const events=comparisonEventsForDate(date,day);
  target.innerHTML=`<strong>${fmtDate(date)}</strong><div class="compare-detail-values"><span>${esc(COMPARE_METRICS[a].label)}: <strong>${esc(comparisonValue(a,day.values[a],day))}</strong></span>${b!=='none'?`<span>${esc(COMPARE_METRICS[b].label)}: <strong>${esc(comparisonValue(b,day.values[b],day))}</strong></span>`:''}</div>${notes}${day.qualityOfLife.map(x=>`<div class="compare-note">Weekly wellbeing: ${x.score}/10${x.notes?' · '+esc(x.notes):''} · owner check-in</div>`).join('')}${labs}${day.treatments.map(t=>`<div class="compare-note">Vinblastine #${t.number} · ${esc(t.source)}</div>`).join('')}${events.length?`<div class="compare-note"><strong>Other events:</strong> ${esc(events.join(' · '))}</div>`:''}`;
}
function renderJournalTrend(){
  if(!els.journalTrend)return;
  const treatments=[...(state.treatments||[])].sort((a,b)=>a.number-b.number);
  if(!comparisonCyclesReady){treatments.forEach(t=>comparison.cycles.add(t.number));comparisonCyclesReady=true;}
  qa('[data-compare-view]').forEach(btn=>{const active=btn.dataset.compareView===comparison.view;btn.classList.toggle('active',active);btn.setAttribute('aria-pressed',String(active));});
  qa('[data-compare-range]').forEach(btn=>{const active=btn.dataset.compareRange===comparison.range;btn.classList.toggle('active',active);btn.setAttribute('aria-pressed',String(active));});
  q('.compare-range').hidden=comparison.view==='aligned';
  q('#compareCyclePicker').hidden=comparison.view!=='aligned'&&comparison.range!=='cycles';
  q('#compareCustomDates').hidden=comparison.view==='aligned'||comparison.range!=='custom';
  q('#compareCyclePicker').innerHTML=treatments.map(t=>`<button class="compare-cycle ${comparison.cycles.has(t.number)?'active':''}" type="button" data-compare-cycle="${t.number}" aria-pressed="${comparison.cycles.has(t.number)}">#${t.number}<small>${fmtDate(t.date).replace(', 2026','')}</small></button>`).join('');
  if(comparison.view==='aligned'){renderAlignedComparison(treatments);return;}
  const rows=comparisonRows(),range=comparisonRange(rows);
  if(!range||range.error){els.journalTrend.innerHTML=`<p class="empty-state">${range?.error||'Add a dated journal entry to start comparing.'}</p>`;q('#compareDayDetail').innerHTML='';return;}
  const visible=rows.filter(r=>range.contains(r.date));
  if(!visible.length){els.journalTrend.innerHTML='<p class="empty-state">No recorded values in this range.</p>';q('#compareDayDetail').innerHTML='';return;}
  const keys=[comparison.primary,...(comparison.secondary==='none'?[]:[comparison.secondary])];
  const span=Math.max(1,dateNumber(range.to)-dateNumber(range.from));
  const W=Math.max(740,Math.min(1500,span*16+140)),H=keys.length===2?412:248,L=111,R=24,top=65,laneH=115,gap=64;
  const x=date=>L+(W-L-R)*(dateNumber(date)-dateNumber(range.from))/span;
  let svg='';
  for(const t of treatments){if(t.date<range.from||t.date>range.to)continue;svg+=`<line x1="${x(t.date)}" x2="${x(t.date)}" y1="38" y2="${H-32}" stroke="#512888" stroke-width="1" opacity=".35"/><text x="${x(t.date)+4}" y="20" font-size="11" font-weight="800" fill="#512888">#${t.number}</text>`;}
  const cbcDates=[...new Set((state.labs||[]).filter(l=>l.metric==='Neutrophils'&&l.date>=range.from&&l.date<=range.to).map(l=>l.date))];
  for(const date of cbcDates)svg+=`<circle cx="${x(date)}" cy="32" r="4" fill="#b44f5c"><title>${esc(fmtDate(date))} · CBC</title></circle>`;
  keys.forEach((key,lane)=>{
    const metric=comparisonScale(key,visible),yTop=top+lane*(laneH+gap),bottom=yTop+laneH,color=metric.kind==='lab'?'#b44f5c':metric.kind==='medication'?'#512888':lane?'#197c91':'#5e7895';
    const y=value=>bottom-(value-metric.min)/(metric.max-metric.min||1)*laneH;
    svg+=`<text x="${L}" y="${yTop-14}" font-size="14" font-weight="800" fill="${color}">${esc(metric.label)}${metric.unit?` · ${esc(metric.unit.trim())}`:''}</text>`;
    for(const tick of metric.ticks){if(tick<metric.min||tick>metric.max)continue;svg+=`<line x1="${L}" x2="${W-R}" y1="${y(tick)}" y2="${y(tick)}" stroke="#e5e7ef"/><text x="${L-8}" y="${y(tick)+4}" text-anchor="end" font-size="11" fill="#707181">${esc(metric.names?.[tick]||tick)}</text>`;}
    let segment=[];const flush=()=>{if(segment.length>1)svg+=`<polyline points="${segment.join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;segment=[];};
    let previous=null;
    for(const row of visible){const value=row.values[key];if(value===null||!Number.isFinite(value)){flush();previous=null;continue;}if(previous&&dateNumber(row.date)-dateNumber(previous)>1)flush();segment.push(`${x(row.date)},${y(value)}`);previous=row.date;}
    flush();
    for(const row of visible){const value=row.values[key];if(value===null||!Number.isFinite(value))continue;svg+=`<circle cx="${x(row.date)}" cy="${y(value)}" r="4.5" fill="${color}" stroke="#fff" stroke-width="1.5"><title>${esc(fmtDate(row.date))} · ${esc(metric.label)}: ${esc(comparisonValue(key,value,row))}</title></circle>`;}
  });
  const tickStep=Math.max(1,Math.ceil(span/8));
  for(let offset=0;offset<=span;offset+=tickStep){const date=addDays(range.from,offset);svg+=`<text x="${x(date)}" y="${H-12}" text-anchor="middle" font-size="11" fill="#707181">${date.slice(5).replace('-','/')}</text>`;}
  if(span%tickStep)svg+=`<text x="${x(range.to)}" y="${H-12}" text-anchor="end" font-size="11" fill="#707181">${range.to.slice(5).replace('-','/')}</text>`;
  for(const row of visible){const values=keys.map(key=>`${COMPARE_METRICS[key].label}: ${comparisonValue(key,row.values[key],row)}`).join(' · ');svg+=`<rect x="${x(row.date)-7}" y="40" width="14" height="${H-73}" fill="transparent" role="button" tabindex="0" data-compare-date="${row.date}" aria-label="${esc(fmtDate(row.date))}: ${esc(values)}"><title>${esc(fmtDate(row.date))} · ${esc(values)}. Tap for source notes.</title></rect>`;}
  const label=keys.map(key=>COMPARE_METRICS[key].label).join(' and ');
  els.journalTrend.innerHTML=`<div class="journal-trend-scroll"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(label)} over time, with treatment and CBC dates">${svg}</svg></div><div class="trend-legend"><span><i class="trend-owner"></i>Owner track</span><span><i class="trend-chemo"></i>Treatment</span><span><i class="trend-cbc"></i>CBC</span></div>`;
  if(!visible.some(r=>r.date===comparison.selectedDate))comparison.selectedDate=visible.at(-1).date;
  renderComparisonDetail();
}

function renderAlignedComparison(treatments){
  const chosen=treatments.filter(t=>comparison.cycles.has(t.number)),rows=comparisonRows(),byDate=new Map(rows.map(r=>[r.date,r]));
  if(!chosen.length){els.journalTrend.innerHTML='<p class="empty-state">Select at least one treatment period.</p>';q('#compareDayDetail').innerHTML='';return;}
  const plotted=chosen.map(t=>{
    const window=cycleWindowFor(t,treatments),days=[];
    for(let offset=0;offset<=13;offset++){const date=addDays(t.date,offset);if(date>=window.endExclusive)break;const row=byDate.get(date);if(row)days.push({offset,row});}
    return {t,days};
  });
  const all=plotted.flatMap(p=>p.days.map(d=>d.row));
  const keys=[comparison.primary,...(comparison.secondary==='none'?[]:[comparison.secondary])];
  const W=790,H=keys.length===2?424:255,L=130,R=26,top=83,laneH=115,gap=76;
  const x=offset=>L+(W-L-R)*offset/13;
  const colors=['#512888','#237a91','#9d6180','#577794','#8b7b44','#4c816b','#994b57','#68779c'];
  let svg=`<line x1="${x(0)}" x2="${x(0)}" y1="61" y2="${H-35}" stroke="#512888" stroke-width="1.5" opacity=".5"/>`;
  for(let offset=0;offset<=13;offset++){
    svg+=`<line x1="${x(offset)}" x2="${x(offset)}" y1="67" y2="${H-35}" stroke="#edf0f4"/><text x="${x(offset)}" y="${H-12}" font-size="11" text-anchor="middle" fill="#707181">${offset}</text>`;
  }
  plotted.forEach(({t,days},i)=>days.forEach(({offset,row})=>{
    const cx=x(offset),color=colors[i%colors.length];
    if(row.labs.some(l=>l.metric==='Neutrophils'))svg+=`<circle cx="${cx}" cy="28" r="4" fill="#b44f5c"><title>Cycle #${t.number}, day ${offset}: CBC on ${esc(fmtDate(row.date))}</title></circle>`;
    const events=comparisonEventsForDate(row.date,row);
    if(events.length)svg+=`<rect x="${cx-3}" y="42" width="6" height="6" fill="${color}"><title>Cycle #${t.number}, day ${offset}: ${esc(events.join('; '))}</title></rect>`;
  }));
  keys.forEach((key,lane)=>{
    const metric=comparisonScale(key,all),yTop=top+lane*(laneH+gap),bottom=yTop+laneH;
    const y=value=>bottom-(value-metric.min)/(metric.max-metric.min||1)*laneH;
    svg+=`<text x="${L}" y="${yTop-15}" font-size="14" font-weight="800" fill="#303848">${esc(metric.label)}${metric.unit?` · ${esc(metric.unit.trim())}`:''}</text>`;
    for(const tick of metric.ticks){if(tick<metric.min||tick>metric.max)continue;svg+=`<line x1="${L}" x2="${W-R}" y1="${y(tick)}" y2="${y(tick)}" stroke="#e5e7ef"/><text x="${L-8}" y="${y(tick)+4}" text-anchor="end" font-size="11" fill="#707181">${esc(metric.names?.[tick]||tick)}</text>`;}
    plotted.forEach(({t,days},i)=>{
      const color=colors[i%colors.length];let segment=[],last=null;
      const flush=()=>{if(segment.length>1)svg+=`<polyline points="${segment.join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>`;segment=[];};
      for(const {offset,row} of days){const value=row.values[key];if(value===null||!Number.isFinite(value)){flush();last=null;continue;}if(last!==null&&offset-last>1)flush();segment.push(`${x(offset)},${y(value)}`);last=offset;}
      flush();
      for(const {offset,row} of days){const value=row.values[key];if(value===null||!Number.isFinite(value))continue;const title=`Cycle #${t.number} · day ${offset} · ${fmtDate(row.date)} · ${metric.label}: ${comparisonValue(key,value,row)}`;svg+=`<circle cx="${x(offset)}" cy="${y(value)}" r="5" fill="${color}" stroke="white" stroke-width="1.5"><title>${esc(title)}</title></circle><circle cx="${x(offset)}" cy="${y(value)}" r="12" fill="transparent" role="button" tabindex="0" data-compare-date="${row.date}" aria-label="${esc(title)}"><title>${esc(title)}. Tap for source notes.</title></circle>`;}
    });
  });
  const legend=chosen.map((t,i)=>`<span><i style="background:${colors[i%colors.length]}"></i>Chemo #${t.number} · ${fmtDate(t.date).replace(', 2026','')}</span>`).join('');
  els.journalTrend.innerHTML=`<p class="field-help">Treatment day 0 is the dose date. Each color is one treatment; a line stops where a value was not recorded or the next treatment began.</p><div class="journal-trend-scroll"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(keys.map(k=>COMPARE_METRICS[k].label).join(' and '))} aligned by days after chemotherapy">${svg}</svg></div><div class="trend-legend">${legend}</div><p class="field-help">Red dots: CBC · small squares: medication or food context. Tap a plotted point for the dated note.</p>`;
  if(!all.some(r=>r.date===comparison.selectedDate))comparison.selectedDate=all.at(-1)?.date||null;
  renderComparisonDetail();
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
  const reported=reportedCourseDays(id,window);
  const given=[...state.medicationAdministrations.filter(a=>a.medicationId===id&&a.status==='given'&&(!window||inCycleWindow(a.date,window))),...reported];
  const quantities=given.map(tabletQuantity);
  const purchases=state.medicationPurchases.filter(p=>p.medicationId===id&&(!window||inCycleWindow(p.date,window)));
  const purchased=purchases.reduce((n,p)=>n+Number(p.quantity||0),0);
  const spent=purchases.reduce((n,p)=>n+Number(p.amountPaid||0),0);
  return {given,reported,tablets:quantities.reduce((n,q)=>n+(q||0),0),unknown:quantities.filter(q=>q==null).length,purchases,purchased,spent,unitCost:purchased?spent/purchased:null,last:given.map(a=>a.date).sort().at(-1)};
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
    const courseOnly=!a.given.length&&state.medicationCourses.some(c=>c.medicationId===m.id);
    const purchases=a.purchases.map(p=>`<div class="medication-purchase-row"><span>${fmtDate(p.date)} · ${p.quantity} × ${p.tabletStrengthMg} mg<br><small>${esc(p.source)}</small></span><strong>${money(p.amountPaid)}<br><small>${money(p.amountPaid/p.quantity)} / tablet</small></strong></div>`).join('');
    const courseDays=state.medicationCourses.filter(c=>c.medicationId===m.id&&c.status?.includes('owner-confirmed seven-day')).reduce((n,c)=>n+daysBetween(c.startDate,courseRecordedEnd(c))+1,0);
    return `<article class="medication-ledger-card"><h3>${esc(m.name)}${m.tabletStrengthMg?` · ${m.tabletStrengthMg} mg tablets`:''}</h3><div class="medication-kpis"><div><strong>${courseOnly?'—':a.tablets}${a.unknown?' + ?':''}</strong><span>${a.reported.length?'tablet equivalents, owner-reported':'tablets documented given'}</span></div><div><strong>${courseDays||a.given.length}</strong><span>${courseDays?'course days reported':a.reported.length?'daily doses reported':'doses logged'}${held?` · ${held} held`:''}</span></div><div class="owner-only"><strong>${a.purchases.length?a.purchased:'—'}</strong><span>tablets purchased</span></div><div class="owner-only"><strong>${a.purchases.length?money(a.spent):'—'}</strong><span>documented spending</span></div></div><p class="medication-note">${esc(m.prescribedDose)}${courseDays?' · Seven days after the 8/20 neutrophil result (250/µL); dose, frequency, and tablet count unrecorded.':''}${a.reported.length?` · Owner confirms daily use from ${fmtDate(a.reported[0].date)} through ${fmtDate(a.last)}; ${a.tablets} ${m.tabletStrengthMg} mg tablet equivalents across ${a.given.length} days. Future prescribed days are not counted.`:''}${courseOnly&&!courseDays?' · Use is recorded as a course; individual tablet counts are not itemized.':''}${a.unknown?` · ${a.unknown} administration(s) lack a confirmed tablet quantity.`:''}${a.last&&!a.reported.length?` · Last given ${fmtDate(a.last)}.`:''}</p><div class="owner-only">${purchases||'<p class="medication-note">Purchase details not recorded.</p>'}</div></article>`;
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

  els.medicationHistory.innerHTML=(state.medications||[]).map(m=>{
    const rows=administrations.filter(a=>a.medicationId===m.id);
    const courses=(state.medicationCourses||[]).filter(c=>c.medicationId===m.id);
    if(!rows.length&&!courses.length)return '';
    const history=rows.map(a=>`<div class="medication-history-row"><div><strong>${fmtDate(a.date)}${a.time?' · '+esc(a.time):''}</strong> · ${esc(a.dose||'dose not recorded')} <span class="chip ${a.status==='held'?'warn':'info'}">${esc(a.status)}</span>${a.reason?`<div class="item-meta">${esc(a.reason)}</div>`:''}</div><button class="text-button" type="button" data-edit-medication="${esc(a.id)}">Correct</button></div>`).join('');
    return `<details class="medication-group"><summary><strong>${esc(m.name)}</strong><span>${courses.length?`${courses.length} reported course${courses.length===1?'':'s'} · `:''}${rows.length} dated record${rows.length===1?'':'s'}</span></summary><div class="medication-group-body">${courses.map(c=>`<p class="medication-note">${fmtDate(c.startDate)}–${fmtDate(courseRecordedEnd(c))} · ${esc(c.dose||'Dose unrecorded')} · ${esc(c.status)}</p>`).join('')}${history}</div></details>`;
  }).join('');
}

function renderTimeline(){
  const events=[];
  (state.carePlan?.visits||[]).filter(v=>v.date).forEach(v=>events.push({date:v.date,kind:'planned',source:v.source,title:v.label,detail:'Upcoming appointment · no treatment or lab result yet'}));
  state.milestones.forEach(x=>events.push({date:x.date,kind:'clinical',source:x.source,title:x.title,detail:x.detail}));
  state.treatments.forEach(x=>events.push({date:x.date,kind:'clinical',source:x.source,title:`Vinblastine #${x.number} · ${x.doseMg} mg`,detail:`${x.doseMgM2} mg/m² · ${x.weightLb} lb · ${x.doseReason}`}));
  state.labs.forEach(x=>{ if(['Neutrophils','ALT','ALP'].includes(x.metric)) events.push({date:x.date,kind:'lab',source:x.source,title:`${x.metric}: ${x.displayValue||x.value} ${x.unit}`,detail:x.context}); });
  state.observations.forEach(x=>events.push({date:x.date,kind:'owner',source:'Owner observation',title:'Home observation',detail:x.notes}));
  const filtered=events.filter(x=>timelineFilter==='all'||x.kind===timelineFilter||(timelineFilter==='clinical'&&['lab','planned'].includes(x.kind))).sort((a,b)=>b.date.localeCompare(a.date));
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
        <div class="row-actions"><div class="cost-amount">${money(c.amountPaid)}</div><button class="text-button" type="button" data-edit-cost="${esc(c.id)}">Correct</button></div>
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
  els.profileDetails.innerHTML=[['Name',p.fullName||p.name],['KSU patient ID',p.patientIds?.ksu],['Optimum patient ID',p.patientIds?.optimum],['Species',p.species],['Breed',p.breed],['Sex',`${p.sex} · ${p.reproductiveStatus}`],['DOB',fmtDate(p.dob)],['Diagnosis',p.diagnosis],['Current status',p.currentStatus]].filter(([,value])=>value).map(x=>`<div class="profile-line"><div class="profile-key">${x[0]}</div><div class="profile-value">${esc(x[1])}</div></div>`).join('');
}

// Documents: IndexedDB stores the actual file blob locally.
let documents=[];
function openDocDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DOC_DB,2);
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(DOC_STORE))db.createObjectStore(DOC_STORE,{keyPath:'id'});if(!db.objectStoreNames.contains(RECOVERY_STORE))db.createObjectStore(RECOVERY_STORE,{keyPath:'id'});};
    req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
  });
}
async function latestRecoverySnapshot(){
  try{
    const db=await openDocDb();
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(RECOVERY_STORE,'readonly'),req=tx.objectStore(RECOVERY_STORE).openCursor(null,'prev');
      req.onsuccess=()=>resolve(req.result?.value||null);req.onerror=()=>reject(req.error);
    });
  }catch(_){return null;}
}
async function saveRecoverySnapshot(value){
  const db=await openDocDb();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(RECOVERY_STORE,'readwrite'),store=tx.objectStore(RECOVERY_STORE);
    store.put({id:`${new Date().toISOString()}-${Math.random().toString(16).slice(2)}`,savedAt:value._savedAt||'',state:structuredClone(value)});
    const keys=store.getAllKeys();
    keys.onsuccess=()=>{for(const old of keys.result.slice(0,-5))store.delete(old);};
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
  });
}
async function saveDocument(record){
  const db=await openDocDb(); return new Promise((resolve,reject)=>{const tx=db.transaction(DOC_STORE,'readwrite');tx.objectStore(DOC_STORE).put(record);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
}
async function replaceDocuments(records){
  const db=await openDocDb();return new Promise((resolve,reject)=>{
    const tx=db.transaction(DOC_STORE,'readwrite'),store=tx.objectStore(DOC_STORE);
    store.clear();records.forEach(record=>store.put(record));
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
  });
}
async function loadDocuments(){
  try{const db=await openDocDb();documents=await new Promise((resolve,reject)=>{const tx=db.transaction(DOC_STORE,'readonly');const req=tx.objectStore(DOC_STORE).getAll();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error);});}catch(_){documents=[];}
}
function renderDocuments(){
  els.documentList.innerHTML=documents.length?documents.sort((a,b)=>b.date.localeCompare(a.date)).map(d=>`<article class="document-card"><div class="row-between"><div><div class="item-title">${esc(d.name)}</div><div class="item-meta">${fmtDate(d.date)} · ${esc(d.provider||d.type)}</div></div><button type="button" class="text-button" data-open-doc="${esc(d.id)}">Open</button></div>${d.note?`<div class="item-copy">${esc(d.note)}</div>`:''}</article>`).join(''):'<div class="empty-state">No documents saved on this device yet.</div>';
  qa('[data-open-doc]').forEach(btn=>btn.addEventListener('click',()=>openDocument(btn.dataset.openDoc)));
}

function bindImport(){
  q('#analyzeForm').addEventListener('submit',async event=>{
    event.preventDefault();
    const file=q('#analyzeFile').files[0],kind=q('#analyzeType').value,button=event.submitter;
    if(!file||!file.name.toLowerCase().endsWith('.pdf'))return toast('Choose a PDF.',true);
    importDraft=null;
    const panel=q('#importReview');panel.textContent='Reading the PDF on this device…';
    button.disabled=true;
    try{
      const text=await readImportPdf(file,kind,panel);
      importDraft=RogerImport.analyze(text,kind,file.name);
      renderImportReview();
    }catch(error){panel.innerHTML=`<p class="alert">${esc(error.message||'Could not read this PDF. No changes were made.')}</p>`;}
    finally{button.disabled=false;}
  });
  q('#importReview').addEventListener('submit',async event=>{
    if(event.target.id!=='importConfirm')return;
    event.preventDefault();
    if(!ownerCanEdit)return toast('Connect the owner app before saving an import.',true);
    if(!importDraft)return;
    const fd=new FormData(event.target),draft=importDraft;
    const date=String(fd.get('date')||'');
    if(!/^20\d\d-\d\d-\d\d$/.test(date)||Number.isNaN(new Date(date+'T12:00:00Z').getTime()))return toast('Check the date.',true);
    const before=structuredClone(state);
    try{
      if(draft.kind==='summary'){
        const doseMg=Number(fd.get('doseMg')),doseMgM2=Number(fd.get('doseMgM2'));
        if(![doseMg,doseMgM2].every(n=>Number.isFinite(n)&&n>0&&n<20))throw Error('Check the dose fields.');
        const existing=state.treatments.find(x=>x.number===draft.number);
        if(existing){recordCorrection('treatments',existing.id,{date,doseMg,doseMgM2,weightLb:draft.weightLb??existing.weightLb,source:`K-State patient summary · ${draft.filename}`});}
        else state.treatments.push({id:`chemo-${draft.number}`,number:draft.number,date,drug:'Vinblastine',doseMg,doseMgM2,weightLb:draft.weightLb,prednisone:'See patient summary',doseReason:'See K-State patient summary',clinicalSummary:'Dose transcribed from Treatments Performed.',source:`K-State patient summary · ${draft.filename}`});
        state.treatments.sort((a,b)=>a.number-b.number);
      }else if(draft.kind==='lab'){
        for(const metric of ['Neutrophils','Hematocrit','Platelets']){
          const value=Number(fd.get(metric));
          if(!Number.isFinite(value)||value<0||value>100000)throw Error(`Check ${metric}.`);
          const existing=state.labs.find(x=>x.date===date&&x.metric===metric);
          const update={date,metric,value,displayValue:String(value),unit:metric==='Hematocrit'?'%':'K/µL',source:`IDEXX CBC · ${draft.filename}`,context:'Current-result column; owner reviewed'};
          if(existing)Object.assign(existing,update);else state.labs.push(update);
        }
        state.labs.sort((a,b)=>a.date.localeCompare(b.date));
      }else{
        const amount=Number(fd.get('amountPaid'));
        if(!Number.isFinite(amount)||amount<0||amount>100000)throw Error('Check the amount paid.');
        if(draft.paymentUnconfirmed&&fd.get('paymentConfirmed')!=='yes')throw Error('Confirm payment before adding this amount to owner-paid costs.');
        const category=draft.paymentUnconfirmed?String(fd.get('category')||'other'):'treatment';
        if(draft.paymentUnconfirmed&&!['monitoring','diagnosis','staging','treatment','restaging','medication','mixed','other'].includes(category))throw Error('Check the cost category.');
        const existing=invoiceCostMatch(draft);
        const optimum=draft.kind==='optimumInvoice',provider=optimum?'Optimum Veterinary':'K-State Veterinary Health Center',source=`${optimum?'Optimum':'K-State'} invoice #${draft.invoiceNumber}`;
        const id=existing?.id||`cost-${optimum?'optimum':'ksu'}-invoice-${draft.invoiceNumber}`;
        if(existing)recordCorrection('costs',existing.id,{date,amountPaid:amount,category:optimum?category:existing.category,status:'confirmed',source});
        else state.costs.push({id,date,provider,label:`${optimum?'Optimum':'K-State'} visit · invoice #${draft.invoiceNumber}`,amountPaid:amount,category,status:'confirmed',source});
        state.costs.sort((a,b)=>a.date.localeCompare(b.date));
        if(draft.cereniaQuantity&&draft.cereniaPaid!=null&&!state.medicationPurchases.some(p=>p.costId===id&&p.medicationId==='med-cerenia')){
          state.medicationPurchases.push({id:`purchase-cerenia-invoice-${draft.invoiceNumber}`,medicationId:'med-cerenia',date,quantity:draft.cereniaQuantity,tabletStrengthMg:60,amountPaid:draft.cereniaPaid,costId:id,status:'confirmed',source:`K-State invoice #${draft.invoiceNumber}`});
        }
      }
      state.importHistory=state.importHistory||[];
      const key=draft.kind==='invoice'||draft.kind==='optimumInvoice'?`invoice:${draft.invoiceNumber}`:draft.kind==='lab'?`cbc:${date}`:`treatment:${draft.number}`;
      state.importHistory=state.importHistory.filter(x=>x.key!==key);
      state.importHistory.push({key,filename:draft.filename,date,reviewedAt:new Date().toISOString(),evidence:draft.evidence});
      if(!await saveChanges())throw Error('Could not save the reviewed values.');
      importDraft=null;q('#analyzeForm').reset();renderAll();q('#importReview').innerHTML='<p class="privacy-note">Reviewed values saved. The timeline, charts, and costs now use the same record. Check Home for shared sync status.</p>';
    }catch(error){state=before;renderAll();toast(error.message||'Import not saved.',true);}
  });
}

function invoiceCostMatch(draft){
  const optimum=draft.kind==='optimumInvoice',clinic=optimum?'Optimum':'K-State';
  const byInvoice=state.costs.find(c=>String(c.source||'').includes(`invoice #${draft.invoiceNumber}`)||c.id===`cost-${optimum?'optimum':'ksu'}-invoice-${draft.invoiceNumber}`);
  if(byInvoice)return byInvoice;
  const sameDay=state.costs.filter(c=>c.date===draft.date&&new RegExp(clinic,'i').test(c.provider||''));
  if(sameDay.length>1)throw Error(`More than one ${clinic} cost is recorded on this date. Resolve the existing costs before importing this invoice.`);
  return sameDay[0]||null;
}

function renderImportReview(){
  const d=importDraft;if(!d)return;
  let match;
  try{match=d.kind==='summary'?state.treatments.find(x=>x.number===d.number):d.kind==='lab'?state.labs.find(x=>x.date===d.date&&x.metric==='Neutrophils'):invoiceCostMatch(d);}
  catch(error){q('#importReview').innerHTML=`<p class="alert">${esc(error.message)}</p>`;return;}
  const current=match?(d.kind==='summary'?`Existing: ${fmtDate(match.date)} · ${match.doseMg} mg · ${match.doseMgM2} mg/m²`:d.kind==='lab'?`Existing neutrophils: ${match.value} K/µL on ${fmtDate(match.date)}`:`Existing: ${fmtDate(match.date)} · ${money(match.amountPaid)}`):'No matching record yet';
  const already=match&&match.date===d.date&&(d.kind==='summary'?Number(match.doseMg)===d.doseMg&&Number(match.doseMgM2)===d.doseMgM2:d.kind==='lab'?['Neutrophils','Hematocrit','Platelets'].every(metric=>Number(state.labs.find(x=>x.date===d.date&&x.metric===metric)?.value)===d.values[metric]):Number(match.amountPaid)===d.amountPaid);
  const fields=d.kind==='summary'?`<div class="form-grid two"><label class="field"><span>Vinblastine administered (mg)</span><input name="doseMg" type="number" step="0.01" min="0.01" value="${d.doseMg}" required></label><label class="field"><span>Dose per body area (mg/m²)</span><input name="doseMgM2" type="number" step="0.01" min="0.01" value="${d.doseMgM2}" required></label></div><p class="field-help">The administered dose comes from “Treatments Performed.” Billing lines never set this value.</p>`:d.kind==='lab'?`<div class="form-grid two">${['Neutrophils','Hematocrit','Platelets'].map(metric=>`<label class="field"><span>${metric} (${metric==='Hematocrit'?'%':'K/µL'})</span><input name="${metric}" type="number" step="0.01" min="0" value="${d.values[metric]}" required></label>`).join('')}</div><p class="field-help">Only the current-result column is proposed. Older columns in the PDF are not imported again.</p>`:`<label class="field"><span>${d.paymentUnconfirmed?'Invoice amount due':'Total paid'}</span><input name="amountPaid" type="number" step="0.01" min="0" value="${d.amountPaid.toFixed(2)}" required></label>${d.paymentUnconfirmed?`<label class="field"><span>Cost category</span><select name="category">${[['monitoring','Monitoring'],['diagnosis','Diagnosis'],['staging','Initial staging'],['treatment','Treatment'],['restaging','Restaging'],['medication','Medication'],['mixed','Mixed care'],['other','Other']].map(([value,label])=>`<option value="${value}" ${d.category===value?'selected':''}>${label}</option>`).join('')}</select></label><p class="field-help">This Optimum invoice shows an amount due, not a payment receipt. Confirm you paid it before adding it to owner-paid totals.</p><label class="import-check"><input type="checkbox" name="paymentConfirmed" value="yes" required> I paid this amount</label>`:`<p class="field-help">${d.cereniaQuantity?`${d.cereniaQuantity} Cerenia tablets · ${money(d.cereniaPaid)} within this total. `:''}The invoice’s vinblastine lines are billing entries, not administered doses.</p>`}`;
  q('#importReview').innerHTML=`<form id="importConfirm" class="form-stack"><h3>${d.kind==='summary'?`Chemo #${d.number} · administered dose`:d.kind==='lab'?'CBC · current results':`Invoice #${esc(d.invoiceNumber)} · ${d.paymentUnconfirmed?'amount due':'paid cost'}`}</h3><p class="item-meta">${esc(d.filename)}<br>${esc(d.evidence)}</p><p class="privacy-note">${esc(current)}${already?' · Values already match; saving only records the reviewed source.':''}</p><label class="field"><span>Visit date</span><input name="date" type="date" value="${esc(d.date)}" required></label>${fields}<label class="import-check"><input type="checkbox" required> I checked these values against the PDF</label><button class="primary-button" type="submit">Save reviewed values</button></form>`;
}

async function readImportPdf(file,kind,panel){
  const pdfjs=await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.mjs';
  const pdf=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
  if(pdf.numPages>12)throw Error('This PDF is longer than the supported care record format. No changes were made.');
  const pages=[];
  for(let n=1;n<=pdf.numPages;n++){
    const page=await pdf.getPage(n),content=await page.getTextContent();
    pages.push(content.items.map(x=>(x.str||'')+(x.hasEOL?'\n':' ')).join(''));
  }
  const text=pages.join('\n');
  if(text.includes('Treatments Performed')||kind==='invoice'&&/Invoice\s*#/.test(text)||kind==='optimumInvoice'&&/Invoice Number:/i.test(text)||kind==='lab'&&/DATE OF RESULT/i.test(text))return text;
  if(!['invoice','optimumInvoice'].includes(kind))throw Error('This record has no readable text. No changes were made.');
  panel.textContent='This invoice is a scan. Reading its first page on this device…';
  await new Promise((resolve,reject)=>{
    if(globalThis.Tesseract)return resolve();
    const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';script.onload=resolve;script.onerror=()=>reject(Error('The scan reader could not load. No changes were made.'));document.head.append(script);
  });
  const page=await pdf.getPage(1),viewport=page.getViewport({scale:2.5}),canvas=document.createElement('canvas');
  canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
  const worker=await Tesseract.createWorker('eng');
  try{return (await worker.recognize(canvas)).data.text;}finally{await worker.terminate();}
}
async function openDocument(id){
  const d=documents.find(x=>x.id===id); if(!d)return; const url=URL.createObjectURL(d.file); window.open(url,'_blank','noopener'); setTimeout(()=>URL.revokeObjectURL(url),60000);
}

function bindExports(){
  document.addEventListener('click',event=>{if(!event.target.closest('[data-open-backup]'))return;navigate('more');q('#backupStatus').scrollIntoView({block:'center',behavior:'smooth'});});
  q('#downloadCareSummary').addEventListener('click',()=>{try{downloadText('roger-vet-handoff.pdf',buildCareSummaryPdf(),'application/pdf');toast('Vet handoff PDF downloaded');}catch(_){toast('Could not create the PDF. Use Print handoff instead.',true);}});
  q('#printCareSummary').addEventListener('click',()=>{const w=window.open('','_blank');if(!w)return toast('Pop-up blocked. Use Download instead.',true);w.document.write(buildCareSummaryHtml());w.document.close();w.focus();setTimeout(()=>w.print(),300);});
  q('#exportBackup').addEventListener('click',async()=>{
    try{await loadDocuments();const packed=await Promise.all(documents.map(async d=>{
      const {file,...metadata}=d;return {...metadata,dataUrl:await blobToDataUrl(file)};
    }));
      const backedState=structuredClone(state),createdAt=new Date().toISOString();
      const contents=JSON.stringify({state:backedState,documents:packed});
      const digest=await backupDigest(contents);
      const backup={format:'roger-care-backup',version:digest?3:2,createdAt,state:backedState,documents:packed,integrity:digest?{algorithm:'SHA-256',digest}:null};
      const clock=new Date(),stamp=`${todayIso()}-${String(clock.getHours()).padStart(2,'0')}${String(clock.getMinutes()).padStart(2,'0')}${String(clock.getSeconds()).padStart(2,'0')}`;
      downloadText(`roger-care-backup-${stamp}.json`,JSON.stringify(backup,null,2),'application/json');
      backupPreparedAt=createdAt;backupPreparedStateAt=state._savedAt;
      renderBackupStatus();
      q('#backupStatus').insertAdjacentHTML('beforeend','<p>Download started. Save the file outside this browser, then use the confirmation button below.</p>');
      toast(`Backup prepared with ${packed.length} document${packed.length===1?'':'s'}`);
    }catch(_){toast('Could not export complete backup',true);}
  });
  q('#confirmBackupSaved').addEventListener('click',()=>{
    if(!backupPreparedAt||backupPreparedStateAt!==state._savedAt)return toast('The record changed. Download a fresh backup first.',true);
    try{localStorage.setItem(BACKUP_META_KEY,JSON.stringify({confirmedAt:new Date().toISOString(),confirmedStateAt:backupPreparedStateAt}));}
    catch(_){return toast('Could not record backup status. Keep your downloaded file safe.',true);}
    backupPreparedAt=null;backupPreparedStateAt=null;renderBackupStatus();renderSharedStatus();toast('Off-device backup marked saved');
  });
  q('#importBackup').addEventListener('change',async event=>{
    const f=event.target.files[0];if(!f)return;
    try{
      const parsed=JSON.parse(await f.text());
      const incoming=parsed.format==='roger-care-backup'?parsed.state:parsed;
      if(!incoming?.profile||!Array.isArray(incoming.treatments)||!Array.isArray(incoming.costs))throw new Error('shape');
      const hasDocuments=parsed.format==='roger-care-backup';
      if(hasDocuments&&!Array.isArray(parsed.documents))throw new Error('documents');
      if(parsed.version>=3){
        if(parsed.integrity?.algorithm!=='SHA-256'||!parsed.integrity.digest)throw new Error('integrity missing');
        const actual=await backupDigest(JSON.stringify({state:incoming,documents:parsed.documents}));
        if(!actual||actual!==parsed.integrity.digest)throw new Error('integrity mismatch');
      }
      const restored=hasDocuments?parsed.documents.map(d=>{
        if(!d.id||!d.name||!d.dataUrl?.startsWith('data:'))throw new Error('document');
        const {dataUrl,...metadata}=d;
        return {...metadata,file:dataUrlToBlob(dataUrl)};
      }):null;
      if(!window.confirm(`Restore this backup? It will replace the app's current entries${hasDocuments?' and uploaded documents':''} on this device.`))return;
      if(restored)await replaceDocuments(restored);
      state=migrateState(incoming);await persist();unpublishedLocal=true;manualPublishRequired=true;syncMessage='Backup restored on this device. Confirm a fresh backup before publishing.';await loadDocuments();renderAll();
      toast(hasDocuments?'Complete backup restored':'Older backup restored; existing device documents kept');
    }catch(_){toast('That backup could not be imported',true);}
    finally{event.target.value='';}
  });
}
async function backupDigest(value){
  if(!globalThis.crypto?.subtle)return null;
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
function blobToDataUrl(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});}
function dataUrlToBlob(url){const [header,payload]=url.split(',',2);if(!header?.includes(';base64')||!payload)throw new Error('data');const binary=atob(payload),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return new Blob([bytes],{type:header.slice(5).split(';')[0]||'application/octet-stream'});}
function downloadText(filename,text,type){const blob=new Blob([text],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function pdfPlain(value){
  return String(value??'').replace(/[\u2018\u2019]/g,"'").replace(/[\u2013\u2014]/g,'-').replace(/\u2192/g,' -> ').replace(/\u00b5/g,'u').replace(/\u00b2/g,'2').replace(/\u2265/g,'>=')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7e\n]/g,' ');
}
function buildCareSummaryPdf(){
  const pages=[[]],margin=45;let y=747;
  const page=()=>{pages.push([]);y=747;};
  const line=(value,size=10,bold=false,indent=0,leading=14)=>{
    if(y<55)page();pages.at(-1).push({text:pdfPlain(value),size,bold,x:margin+indent,y});y-=leading;
  };
  const wrap=(value,size=10,bold=false,indent=0)=>{
    for(const paragraph of pdfPlain(value).split('\n')){
      const words=paragraph.split(/\s+/).filter(Boolean);let current='';
      for(const word of words){if((current+' '+word).trim().length>Math.max(52,82-Math.round(indent/8))&&current){line(current,size,bold,indent,size+4);current='';}current+=(current?' ':'')+word;}
      line(current||' ',size,bold,indent,size+4);
    }
  };
  const heading=value=>{y-=7;if(y<75)page();line(value,13,true,0,19);};
  const p=state.profile,neut=state.labs.filter(l=>l.metric==='Neutrophils').sort((a,b)=>a.date.localeCompare(b.date));
  const nadir=neut.reduce((a,b)=>!a||Number(b.value)<Number(a.value)?b:a,null),latest=neut.at(-1),pred=medicationStats('med-prednisone');
  line(`${p.fullName||p.name} | Veterinary handoff`,18,true,0,27);
  wrap(`KSU ${p.patientIds?.ksu||'unrecorded'} | Optimum ${p.patientIds?.optimum||'unrecorded'} | ${p.breed} | Prepared ${new Date().toLocaleDateString('en-US')}`,9);
  heading('Visit snapshot');
  wrap(`Diagnosis: ${p.diagnosis}. Status: ${p.currentStatus}.`);
  wrap(`Neutrophils: lowest ${nadir?`${nadir.displayValue||nadir.value} ${nadir.unit} on ${fmtDate(nadir.date)}`:'not recorded'}; latest ${latest?`${latest.displayValue||latest.value} ${latest.unit} on ${fmtDate(latest.date)}`:'not recorded'}.`);
  wrap(`Prednisone: prescribed 10 mg every 24 hours from Oct 2; owner reports daily administration through ${pred.last?fmtDate(pred.last):'date unrecorded'}. Later doses are not inferred.`);
  wrap('Amoxicillin: owner reports seven days after the Aug 20 count of 250/uL; dose and frequency unrecorded.');
  const plan=state.carePlan||{visits:[]};
  heading('Upcoming care');
  for(const v of plan.visits||[])wrap(`${v.label}: ${v.date?fmtDate(v.date):'TBD'}`,9,false,8);
  wrap(`When to call the vet: ${plan.vetCallInstructions||'Awaiting vet-specific instructions.'}`);
  heading('Recent owner notes');
  const days=[...new Set(state.observations.map(o=>o.date))].sort().slice(-3).reverse();
  for(const date of days){const entries=state.observations.filter(o=>o.date===date);for(const o of entries){const note=String(o.notes||'No note');wrap(`${fmtDate(date)} [${o.rawEntry?'original journal':'app entry'}]: ${note.length>150?note.slice(0,147)+'...':note}`,9,false,8);}}
  line('Owner observations are labeled separately from clinical records.',9,false,0,15);
  page();line('Treatment history | concise review',16,true,0,25);
  const treatments=[...state.treatments].sort((a,b)=>a.number-b.number),rows=comparisonRows();
  for(const t of treatments){
    const window=cycleWindowFor(t,treatments);
    const inWindow=rows.filter(r=>r.date>=window.start&&r.date<window.endExclusive);
    const counts=inWindow.flatMap(r=>r.labs).filter(l=>l.metric==='Neutrophils'&&Number.isFinite(Number(l.value)));
    const lowest=counts.length?counts.reduce((a,b)=>Number(a.value)<=Number(b.value)?a:b):null;
    const nauseaDays=inWindow.filter(r=>r.values.nausea>0).length,looseDays=inWindow.filter(r=>r.values.looseStool===1).length;
    heading(`Chemo #${t.number} | ${fmtDate(t.date)} | ${t.doseMg} mg (${t.doseMgM2} mg/m2)`);
    wrap(`Lowest recorded neutrophils: ${lowest?`${lowest.displayValue||lowest.value} ${lowest.unit} (${fmtDate(lowest.date)}, day +${daysBetween(t.date,lowest.date)})`:'no result in this period'}; nausea noted ${nauseaDays} day(s); loose stool/diarrhea noted ${looseDays} day(s).`,9,false,8);
    if(t.doseReason)wrap(`Dose note: ${t.doseReason}`,9,false,8);
  }
  heading('Medication courses');
  for(const c of state.medicationCourses||[])wrap(`${medicationName(c.medicationId)}: ${fmtDate(c.startDate)} to ${fmtDate(courseRecordedEnd(c))}; ${c.dose||'dose unrecorded'}; ${c.frequency||'frequency unrecorded'}; ${c.status}`,9,false,8);
  heading('Recent supportive medication');
  const supportive=(state.medicationAdministrations||[]).filter(a=>a.date>='2026-09-18');
  for(const id of [...new Set(supportive.map(a=>a.medicationId))]){
    const events=supportive.filter(a=>a.medicationId===id).sort((a,b)=>a.date.localeCompare(b.date));
    wrap(`${medicationName(id)}: ${events.map(a=>`${fmtDate(a.date).replace(', 2026','')} ${a.status}${a.dose?' '+a.dose:''}`).join('; ')}`,9,false,8);
  }
  heading('Source and record checks');
  wrap('CBC values come from the loaded clinical record. Symptoms and medication use are owner reported. The complete dated journal, correction history, and uploaded documents are available in the app and complete backup.',9);
  wrap('Record checks: verify the Oct 2 vinblastine invoice lines; reconcile the July 14 Optimum invoice; confirm amoxicillin dose and frequency.');
  const clean=value=>pdfPlain(value).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
  const objects=['','<< /Type /Catalog /Pages 2 0 R >>','','<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>','<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>'];
  const kids=[];
  pages.forEach((lines,index)=>{
    const pageId=objects.length,contentId=pageId+1;kids.push(`${pageId} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`);
    const commands=lines.map(item=>`BT /${item.bold?'F2':'F1'} ${item.size} Tf 1 0 0 1 ${item.x} ${item.y} Tm (${clean(item.text)}) Tj ET`).join('\n')+`\nBT /F1 8 Tf 1 0 0 1 45 30 Tm (Roger Oberle | ${index+1} / ${pages.length}) Tj ET`;
    objects.push(`<< /Length ${commands.length} >>\nstream\n${commands}\nendstream`);
  });
  objects[2]=`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;
  let pdf='%PDF-1.4\n',offsets=[0];
  for(let id=1;id<objects.length;id++){offsets[id]=pdf.length;pdf+=`${id} 0 obj\n${objects[id]}\nendobj\n`;}
  const xref=pdf.length;pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for(let id=1;id<objects.length;id++)pdf+=`${String(offsets[id]).padStart(10,'0')} 00000 n \n`;
  pdf+=`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf;
}
function buildCareSummaryHtml(){
  const p=state.profile,t=latestTreatment(),plan=state.carePlan||{visits:[]};
  const rows=state.treatments.map(x=>`<tr><td>${fmtDate(x.date)}</td><td>#${x.number}</td><td>${x.doseMg} mg</td><td>${x.doseMgM2}</td><td>${x.weightLb} lb</td><td>${esc(x.doseReason)}</td></tr>`).join('');
  const labs=state.labs.filter(x=>['Neutrophils','Hematocrit','Platelets','ALT','ALP'].includes(x.metric)).sort((a,b)=>a.date.localeCompare(b.date)).map(x=>`<tr><td>${fmtDate(x.date)}</td><td>${esc(x.metric)}</td><td>${esc(x.displayValue||x.value)} ${esc(x.unit)}</td><td>${esc(x.context)}</td><td>${esc(x.source)}</td></tr>`).join('');
  const obs=[...state.observations].sort((a,b)=>a.date.localeCompare(b.date));
  const obsRows=obs.map(o=>`<tr><td>${fmtDate(o.date)}</td><td>${esc(compactObservation(o))}</td><td>${esc(o.medications?.join(', ')||'')}</td><td>${esc(o.notes)}</td></tr>`).join('');
  const recentObs=obs.slice(-5).reverse().map(o=>`<li><strong>${fmtDate(o.date)}:</strong> ${esc(o.notes)}</li>`).join('');
  const neut=state.labs.filter(l=>l.metric==='Neutrophils').sort((a,b)=>a.date.localeCompare(b.date));
  const nadir=neut.reduce((a,b)=>!a||Number(b.value)<Number(a.value)?b:a,null),latest=neut.at(-1);
  const pred=medicationStats('med-prednisone');
  const courseRows=(state.medicationCourses||[]).map(c=>`<tr><td>${esc(medicationName(c.medicationId))}</td><td>${fmtDate(c.startDate)}–${fmtDate(courseRecordedEnd(c))}</td><td>${esc(c.dose||'Unknown')} · ${esc(c.frequency||'Frequency unknown')}</td><td>${esc(c.status)}<br><small>${esc(c.source)}</small></td></tr>`).join('');
  const prnRows=(state.medications||[]).filter(m=>!['med-prednisone','med-amoxicillin'].includes(m.id)).map(m=>{const a=medicationStats(m.id);return `<tr><td>${esc(m.name)}</td><td>${a.given.length} given; ${state.medicationAdministrations.filter(x=>x.medicationId===m.id&&x.status==='held').length} held</td><td>${a.last?fmtDate(a.last):'No dose logged'}</td><td>${esc(m.prescribedDose)}</td></tr>`;}).join('');
  const medicationEvents=state.medicationAdministrations.filter(a=>a.medicationId==='med-metronidazole').map(a=>`${fmtDate(a.date)}${a.time?' '+a.time:''}: ${a.dose} ${a.status} (${a.reason||'reason unrecorded'})`).join('; ');
  const visits=(plan.visits||[]).map(v=>`<li>${esc(v.label)}: <strong>${v.date?fmtDate(v.date):'Date TBD'}</strong> <small>(${esc(v.source||'Source unrecorded')})</small></li>`).join('');
  const docs=documents.map(d=>`<li>${esc(d.name)} · ${fmtDate(d.date)} · ${esc(d.provider||d.type)}</li>`).join('');
  const correctionCount=state.recordCorrections?.length||0;
  const correctionRows=(state.recordCorrections||[]).map(c=>{
    const changed=Object.entries(c.after||{}).filter(([key,value])=>key!=='id'&&JSON.stringify(value)!==JSON.stringify(c.before?.[key])).map(([key,value])=>`${key}: ${JSON.stringify(c.before?.[key]??'')} → ${JSON.stringify(value)}`).join('; ');
    return `<li>${esc(c.at?.slice(0,10)||'Date unknown')} · ${esc(c.collection)} · ${esc(c.id)}: ${esc(changed||'No field differences')}</li>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(p.fullName||p.name)} vet handoff</title><style>body{font-family:Arial,sans-serif;max-width:1000px;margin:24px auto;padding:0 18px;color:#17201d;line-height:1.4}h1{margin-bottom:4px}h2{margin:20px 0 7px;border-bottom:1px solid #ddd;padding-bottom:5px}p{margin:7px 0}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border-bottom:1px solid #ddd;padding:7px;text-align:left;vertical-align:top}li{margin:4px 0}.note{background:#f3f6f5;padding:12px;border-radius:8px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.small{font-size:12px;color:#555}.snapshot{border:2px solid #d9d1e8;border-radius:12px;padding:16px}@media print{body{margin:0;padding:0;font-size:11px}.snapshot{border:0;padding:0;break-after:page}.grid{gap:8px}h2{margin-top:13px}li{margin:2px 0}tr{break-inside:avoid}}</style></head><body>
  <section class="snapshot"><h1>${esc(p.fullName||p.name)} · vet handoff</h1><p><strong>KSU:</strong> ${esc(p.patientIds?.ksu||'Not recorded')} · <strong>Optimum:</strong> ${esc(p.patientIds?.optimum||'Not recorded')} · ${esc(p.breed)} · DOB ${fmtDate(p.dob)}</p>
  <p class="note"><strong>Diagnosis:</strong> ${esc(p.diagnosis)}<br><strong>Status:</strong> ${esc(p.currentStatus)}. Source-backed restaging on 9/18 found no metastatic involvement in the supplied K-State record.</p>
  <div class="grid"><div><h2>Key bloodwork</h2><p><strong>Neutrophil nadir:</strong> ${nadir?`${esc(nadir.displayValue||nadir.value)} ${esc(nadir.unit)} on ${fmtDate(nadir.date)}`:'Not recorded'} (250/µL on 8/20).<br><strong>Latest:</strong> ${latest?`${esc(latest.displayValue||latest.value)} ${esc(latest.unit)} on ${fmtDate(latest.date)}`:'Not recorded'}.</p><p>Chemo #3 was delayed one week after the 9/3 count of 1.79 K/µL.</p></div>
  <div><h2>Medication now / recently</h2><p><strong>Prednisone:</strong> prescribed 10 mg every 24 hours from 10/2; owner-confirmed daily administration through ${pred.last?fmtDate(pred.last):'date unknown'} (${pred.given.length} days total). Do not infer subsequent doses.</p><p><strong>Amoxicillin:</strong> seven-day owner-reported course 8/20–8/26 after neutrophils 250/µL; dose and frequency not recorded.</p><p><strong>Metronidazole:</strong> ${esc(medicationEvents||'No administrations logged')}.</p></div></div>
  <h2>Upcoming care</h2><ul>${visits}</ul><p><strong>When to call the vet:</strong> ${esc(plan.vetCallInstructions||'Vet-specific instructions pending.')}${plan.vetCallSource?` (${esc(plan.vetCallSource)})`:''}</p>
  <h2>Recent owner observations</h2><ul>${recentObs}</ul><p class="small">Owner observations and medication use are owner reported. Dates without a confirmed visit or dose remain pending; this handoff is a record for discussion with the care team.</p></section>
  <h2>Medication courses</h2><table><thead><tr><th>Medication</th><th>Reported dates</th><th>Dose / frequency</th><th>Basis</th></tr></thead><tbody>${courseRows}</tbody></table>
  <h2>PRN / visit medications</h2><table><thead><tr><th>Medication</th><th>Logged use</th><th>Last given</th><th>Prescription on file</th></tr></thead><tbody>${prnRows}</tbody></table>
  <h2>Clinical course</h2><table><thead><tr><th>Date</th><th>Treatment</th><th>Dose</th><th>mg/m²</th><th>Weight</th><th>Dose context</th></tr></thead><tbody>${rows}</tbody></table>
  <h2>Selected labs</h2><table><thead><tr><th>Date</th><th>Metric</th><th>Result</th><th>Context</th><th>Source</th></tr></thead><tbody>${labs}</tbody></table>
  <h2>Owner-observed course</h2><table><thead><tr><th>Date</th><th>Structured observation</th><th>Medication noted</th><th>Original / corrected note</th></tr></thead><tbody>${obsRows}</tbody></table>
  <h2>Document index</h2><ul>${docs||'<li>No source files uploaded to this device.</li>'}</ul><p class="small">The document index lists on-device files; this HTML summary does not attach them. ${correctionCount} owner correction${correctionCount===1?'':'s'} recorded in the app history.</p>
  <h2>Owner corrections</h2><ul>${correctionRows||'<li>No corrections recorded.</li>'}</ul>
  <h2>Record checks</h2><ul><li>Verify the duplicate vinblastine billing lines on the 10/2 K-State invoice; clinical note states 2.0 mg total.</li><li>Reconcile the 7/14 Optimum surgery/dental invoice when received.</li><li>Amoxicillin dose and frequency remain unrecorded.</li></ul>
  <h2>Family financial burden</h2><p><strong>${money(totalPaid())}</strong> documented owner-paid care to date. Amounts shown are care costs only; bank and payment-account details are excluded.</p>
  <p class="small">Clinical, lab, and pathology facts remain attributed to their sources. Owner observations are labeled separately. Corrections are retained in the app backup.</p></body></html>`;
}

function toast(message,isError=false){
  const node=q('#toastTemplate').content.firstElementChild.cloneNode(true);node.textContent=message;if(isError)node.classList.add('error');q('#toastRegion').appendChild(node);setTimeout(()=>node.remove(),2800);
}

document.addEventListener('DOMContentLoaded',boot);
