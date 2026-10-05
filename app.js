'use strict';

const STORAGE_KEY = 'rogerCareState_v1';
const DOC_DB = 'rogerCareDocuments_v1';
const DOC_STORE = 'documents';
const RECOVERY_STORE = 'recoverySnapshots';
const BACKUP_META_KEY = 'rogerCareBackupStatus_v1';
const PENDING_CLOUD_KEY = 'rogerCarePendingCloud_v1';
const SUPABASE_URL = 'https://gkotvodoqwdhmdeigrra.supabase.co';
const SUPABASE_KEY = 'sb_publishable_r-j23v_ip3FsemJ8JNtoog_79reT8ur';
const SITE_URL = 'https://cornhskr1.github.io/roger-care-mvp/';
let cloud = null, cloudRevision = null, cloudUpdatedAt = null, cloudAvailable = false;
let ownerSession = null, ownerCanEdit = false, unpublishedLocal = false, cloudBusy = false;
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
const DEFAULT_CARE_TEAM = [
  {id:'ksu',kind:'specialty',role:'Oncology / specialty hospital',name:'K-State Veterinary Health Center',phone:'785-532-5690',address:'1800 Denison Ave, Manhattan, KS 66506-5600',afterHours:'Veterinary Health Center emergency and critical care is available 24/7.',notes:'Small Animal Desk',source:'K-State Veterinary Health Center website, checked 10/4/2026'},
  {id:'optimum',kind:'primary',role:'Primary veterinary clinic',name:'Optimum Veterinary Medical Group',phone:'402-466-1383',address:'8531 Lexington Ave, Lincoln, NE 68505',afterHours:'Call the clinic for urgent or emergency needs during clinic hours.',notes:'',source:'Optimum Veterinary Medical Group website, checked 10/4/2026'},
  {id:'emergency',kind:'emergency',role:'Preferred emergency hospital',name:'',phone:'',address:'',afterHours:'',notes:'',source:''}
];
function mergeCareTeam(rows=[]){
  const byId=new Map((Array.isArray(rows)?rows:[]).filter(row=>row?.id).map(row=>[row.id,row]));
  return DEFAULT_CARE_TEAM.map(base=>({...base,...(byId.get(base.id)||{})}));
}

const els = {};
let state = null;
let timelineFilter = 'all';
let careTeamMode = false;
let selectedTreatmentWindow = 'all';
const comparison={primary:'energy',secondary:'nausea',view:'calendar',range:'all',cycles:new Set(),from:'2026-08-14',to:'2026-10-03',selectedDate:null};
const NAUSEA_SIGN_LABELS={
  lip_licking:'lip licking / smacking',
  repeated_swallowing:'repeated swallowing',
  drooling:'drooling / extra saliva',
  pacing_restlessness:'pacing / restlessness',
  stomach_noises:'stomach noises / gurgling',
  food_interest_change:'approached food, then walked away'
};
const APPETITE_BEHAVIOR_LABELS={
  ate_normally:'ate normally',
  needed_encouragement:'needed encouragement',
  hand_fed:'hand-fed',
  treats_only:'wanted treats / special food only',
  approached_then_left:'approached food, then walked away',
  more_interest:'more interested in food than usual'
};
const ENERGY_BEHAVIOR_LABELS={
  normal_routine:'normal routine',
  more_resting:'resting more than usual',
  less_play:'less play / engagement',
  less_following:'less following / interaction',
  slower_movement:'slower getting up or moving',
  needed_prompting:'needed prompting for usual activity'
};
const ENERGY_LEVEL_LABELS={
  normal:"Roger's normal",
  'slightly reduced':'slightly below normal',
  low:'clearly below normal',
  'very low':'very low'
};
const STOOL_CONSISTENCY_LABELS={
  hard_dry:'hard / dry',
  formed_firm:'formed / firm',
  soft_formed:'soft but still formed',
  very_soft:'very soft / loses shape',
  unformed:'unformed / mushy',
  watery:'watery / liquid'
};
const STOOL_FLAG_LABELS={
  bright_red_blood:'bright-red blood',
  black_tarry:'black / tarry appearance',
  mucus:'mucus',
  straining:'straining',
  urgency:'urgency',
  unusual_color:'unusual color',
  large_volume:'larger volume than usual',
  small_frequent:'small / frequent stools'
};
const VOMIT_FLAG_LABELS={
  bright_red_blood:'bright-red blood in vomit',
  coffee_ground_like:'dark material resembling coffee grounds'
};
const VET_GUIDANCE_ON_FILE={
  cerenia:{
    id:'ksu-cerenia-2026-10-02',
    title:'Cerenia / maropitant',
    instruction:'Give 1 tablet by mouth every 24 hours as needed for chemotherapy-associated nausea or vomiting.',
    source:'K-State VHC Oncology discharge',
    sourceDate:'2026-10-02',
    kind:'medication'
  },
  metronidazole:{
    id:'ksu-metronidazole-2026-10-02',
    title:'Metronidazole',
    instruction:'Give 1 tablet by mouth every 12 hours as needed for chemotherapy-associated diarrhea. Administer with food.',
    source:'K-State VHC Oncology discharge',
    sourceDate:'2026-10-02',
    kind:'medication'
  },
  prednisoneBleed:{
    id:'ksu-prednisone-bleed-2026-10-02',
    title:'Prednisone safety instruction',
    instruction:'Discontinue prednisone and contact a veterinarian if Roger develops dark, tarry stool or vomit that resembles coffee grounds.',
    source:'K-State VHC Oncology discharge',
    sourceDate:'2026-10-02',
    kind:'urgent'
  }
};
let comparisonCyclesReady=false;
let journalShowAll = false;
let recoveredFromSnapshot = false;
let backupPreparedAt = null;
let backupPreparedStateAt = null;
let importDraft = null;
let questionDraftSource = null;
const careSnapshotRange={mode:'treatment',from:'',to:''};

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
  ['statusHero','metricStrip','latestObservation','journalBrief','upcomingCare','nextVisitQuestions','careTeamQuick','careTeamFields','careSnapshotPreview','clinicalCourse','cycleClinicalReview','homeCostSummary','openItems','journalSummary','journalEntries','journalTrend','nauseaTimingInsight','timelineEntries','costSummary','estimateComparison','costEntries','profileDetails','documentList','profilePhoto','profileInitial','petName','patientIds','petSubtitle','careModeButton','journalDialog','medicationDialog','costDialog','medicationSummary','medicationHistory'].forEach(id => els[id] = q(`#${id}`));
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
  try{unpublishedLocal=localStorage.getItem(PENDING_CLOUD_KEY)==='1';}catch(_){unpublishedLocal=false;}
  try{localStorage.removeItem('rogerCareCloudBase_v1');}catch(_){}
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
    }),
    careTeam:mergeCareTeam(savedPlan.careTeam||canonical.carePlan?.careTeam||[]),
    questions:Array.isArray(savedPlan.questions)?structuredClone(savedPlan.questions):structuredClone(canonical.carePlan?.questions||[]),
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
  next.carePlan = next.carePlan||{visits:structuredClone(DEFAULT_VISITS),vetCallInstructions:'',vetCallSource:'',careTeam:structuredClone(DEFAULT_CARE_TEAM),questions:[]};
  if(!Array.isArray(next.carePlan.visits)||!next.carePlan.visits.length)next.carePlan.visits=structuredClone(DEFAULT_VISITS);
  next.carePlan.careTeam=mergeCareTeam(next.carePlan.careTeam);
  next.carePlan.questions=Array.isArray(next.carePlan.questions)?next.carePlan.questions:[];

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
  next.schemaVersion = Math.max(Number(next.schemaVersion||0),16);
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
    if(!ownerCanEdit){toast('This device is view-only. Edit Roger Care from the owner device.',true);return false;}
    await persist();
    unpublishedLocal=true;
    try{localStorage.setItem(PENDING_CLOUD_KEY,'1');}catch(_){}
    syncMessage='Saved on this device. Syncing automatically.';
    renderSharedStatus();
    setTimeout(()=>publishCloudMirror(),0);
    return true;
  }catch(_){
    toast('Could not save on this device. Keep this screen open and create a file backup.',true);
    return false;
  }
}

async function connectCloud(){
  if(!globalThis.supabase?.createClient){
    cloudAvailable=false;
    syncMessage='Cloud unavailable. This device still has its local copy.';
    renderSharedStatus();
    return;
  }

  cloud=globalThis.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{
    auth:{detectSessionInUrl:true,persistSession:true,autoRefreshToken:true}
  });

  const {data:{session}}=await cloud.auth.getSession();
  ownerSession=session;
  await checkOwner();
  await initializeCloudMode();

  cloud.auth.onAuthStateChange((_event,next)=>{
    ownerSession=next;
    setTimeout(async()=>{
      await checkOwner();
      await initializeCloudMode();
      renderAll();
    },0);
  });

  const retryPending=async()=>{
    if(ownerCanEdit&&unpublishedLocal&&!cloudBusy)await publishCloudMirror();
  };

  window.addEventListener('online',retryPending);
  window.addEventListener('focus',async()=>{
    await checkOwner();
    if(ownerCanEdit){
      await readCloudMetadata();
      if(unpublishedLocal)await publishCloudMirror();
    }else if(!unpublishedLocal){
      await readCloudViewer();
    }
    renderAll();
  });

  setInterval(async()=>{
    if(document.hidden||cloudBusy)return;
    if(ownerCanEdit){
      if(unpublishedLocal)await publishCloudMirror();
    }else if(!unpublishedLocal){
      await readCloudViewer();
      renderAll();
    }
  },30000);
}

async function initializeCloudMode(){
  if(ownerCanEdit){
    await readCloudMetadata();
    if(unpublishedLocal)await publishCloudMirror();
    else syncMessage=cloudAvailable?'Saved & synced.':'Saved on this device. Cloud will retry automatically.';
  }else if(unpublishedLocal){
    syncMessage='Saved on this device. Sign in as the owner here to sync this pending change.';
  }else{
    await readCloudViewer();
  }
  renderSharedStatus();
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

async function readCloudMetadata(){
  if(!cloud)return false;
  const {data,error}=await cloud.from('roger_shared_record')
    .select('revision,updated_at')
    .eq('id','roger')
    .single();

  if(error){
    cloudAvailable=false;
    syncMessage='Saved on this device. Cloud will retry automatically.';
    renderSharedStatus();
    return false;
  }

  cloudAvailable=true;
  cloudRevision=Number(data.revision);
  cloudUpdatedAt=data.updated_at;
  return true;
}

async function readCloudViewer(){
  if(!cloud||cloudBusy)return false;
  cloudBusy=true;
  try{
    const {data,error}=await cloud.from('roger_shared_record')
      .select('record,revision,updated_at')
      .eq('id','roger')
      .single();

    if(error||!data?.record?.profile){
      cloudAvailable=false;
      syncMessage='The shared Roger Care record could not be reached.';
      return false;
    }

    const photo=state.profile?.photoDataUrl;
    state=migrateState(data.record);
    if(photo)state.profile.photoDataUrl=photo;
    cloudRevision=Number(data.revision);
    cloudUpdatedAt=data.updated_at;
    cloudAvailable=true;
    unpublishedLocal=false;
    try{localStorage.removeItem(PENDING_CLOUD_KEY);}catch(_){}
    await persist(false);
    syncMessage='Viewing the latest shared record.';
    return true;
  }finally{
    cloudBusy=false;
    renderSharedStatus();
  }
}

async function publishCloudMirror(){
  if(!cloud||!ownerCanEdit||cloudBusy||!unpublishedLocal)return false;
  cloudBusy=true;
  const submitted=cloudRecord();
  const submittedSavedAt=state._savedAt;
  let publishAgain=false;

  try{
    const {data,error}=await cloud.rpc('roger_replace_record',{p_record:submitted});
    if(error||!data){
      cloudAvailable=false;
      syncMessage='Saved on this device. Cloud will retry automatically.';
      return false;
    }

    cloudAvailable=true;
    cloudRevision=Number(data.revision);
    cloudUpdatedAt=data.updated_at;

    if(state._savedAt===submittedSavedAt){
      unpublishedLocal=false;
      try{localStorage.removeItem(PENDING_CLOUD_KEY);}catch(_){}
      syncMessage='Saved & synced.';
    }else{
      unpublishedLocal=true;
      try{localStorage.setItem(PENDING_CLOUD_KEY,'1');}catch(_){}
      syncMessage='Saved on this device. Syncing the newest change.';
      publishAgain=true;
    }

    return true;
  }finally{
    cloudBusy=false;
    renderSharedStatus();
    if(publishAgain)setTimeout(()=>publishCloudMirror(),0);
  }
}

function parseOwnerSignInLink(input){
  const url=new URL(String(input||'').trim());
  if(url.protocol!=='https:'||url.hostname!==new URL(SUPABASE_URL).hostname||url.pathname!=='/auth/v1/verify')throw new Error('Unexpected sign-in link');
  const token=url.searchParams.get('token_hash')||url.searchParams.get('token');
  const type=url.searchParams.get('type');
  if(!token||!/^[a-zA-Z0-9_-]{32,256}$/.test(token)||!['email','magiclink'].includes(type))throw new Error('Invalid sign-in link');
  return {token_hash:token,type};
}

function renderSharedStatus(){
  const status=q('#sharedStatus'),controls=q('#sharedControls');
  if(!status||!controls||!state)return;

  const synced=ownerCanEdit&&cloudAvailable&&!unpublishedLocal&&cloudRevision>0;
  const viewer=!ownerCanEdit&&!unpublishedLocal;
  const title=ownerCanEdit
    ? (synced?'Saved & synced':'Saved on this device')
    : (viewer?'View-only':'Saved on this device');
  const message=ownerCanEdit
    ? (synced
        ? 'Your phone is the master Roger Care record. The cloud mirror is current.'
        : 'Your latest changes are safe here. Roger Care will keep syncing automatically.')
    : (viewer
        ? 'This device shows the latest shared Roger Care record and cannot edit it.'
        : 'A pending local change is safe here. Sign in as the owner on this device to sync it.');

  status.className=`shared-status ${synced?'is-synced':'is-local'}`;
  status.innerHTML=`<strong>${esc(title)}</strong><span>${esc(message)}</span>${cloudUpdatedAt&&(synced||viewer)?`<small>Cloud updated: ${esc(new Date(cloudUpdatedAt).toLocaleString())}</small>`:''}`;

  controls.innerHTML=ownerCanEdit
    ? `<div class="sync-summary ${synced?'is-synced':'is-local'}"><strong>${esc(title)}</strong><p>${esc(message)}</p>${cloudUpdatedAt?`<p class="field-help">Cloud mirror updated ${esc(new Date(cloudUpdatedAt).toLocaleString())}.</p>`:''}</div><details class="sync-advanced"><summary>Owner sign-in</summary><p class="field-help">This is the editing device. Other devices can view Roger Care without signing in.</p><button id="signOutOwner" class="text-button" type="button">Sign out</button></details>`
    : `<div class="sync-summary is-local"><strong>${esc(viewer?'View-only':'Owner sign-in needed')}</strong><p>${esc(message)}</p></div><details class="sync-advanced"><summary>Owner sign-in</summary><p class="field-help">Only sign in here if this is the one device you want to use for editing Roger Care.</p><form id="ownerLogin"><label class="field"><span>Your email</span><input type="email" name="email" autocomplete="email" required></label><button class="secondary-button" type="submit">Email me a sign-in link</button></form><form id="ownerLinkPaste"><label class="field"><span>Paste unused email link</span><input type="text" name="link" inputmode="url" autocomplete="off" spellcheck="false" required></label><button class="secondary-button" type="submit">Sign in with link</button></form></details>`;

  q('#ownerLogin')?.addEventListener('submit',async event=>{
    event.preventDefault();
    const email=event.currentTarget.elements.email.value.trim();
    const {error}=await cloud.auth.signInWithOtp({email,options:{emailRedirectTo:SITE_URL}});
    const emailLimit=error&&(error.status===429||error.code==='over_email_send_rate_limit');
    toast(error
      ? (emailLimit?'Email limit reached. Wait an hour after the last email, then request one new link.':'Sign-in email could not be sent. Please try again later.')
      : 'Copy the unused sign-in link from the email and paste it here.',
      Boolean(error));
  });

  q('#ownerLinkPaste')?.addEventListener('submit',async event=>{
    event.preventDefault();
    const input=event.currentTarget.elements.link;
    let credentials;
    try{credentials=parseOwnerSignInLink(input.value);}
    catch(_){return toast('That is not an unused Roger Care sign-in link.',true);}
    input.value='';
    const {error}=await cloud.auth.verifyOtp(credentials);
    if(error)return toast('That link could not be used. Request a fresh one and copy it without opening it.',true);
    const {data:{session}}=await cloud.auth.getSession();
    ownerSession=session;
    await checkOwner();
    await initializeCloudMode();
    renderAll();
    toast(ownerCanEdit?'Owner device connected. Changes will sync automatically.':'Signed in, but this account does not have owner access.');
  });

  q('#signOutOwner')?.addEventListener('click',async()=>{
    await cloud.auth.signOut();
    ownerSession=null;
    ownerCanEdit=false;
    if(!unpublishedLocal)await readCloudViewer();
    renderAll();
  });

  for(const selector of ['#openJournalComposer','#journalAddButton','#medicationAddButton','#costAddButton','#profilePhotoButton','#carePlanForm button[type=submit]','#careTeamForm button[type=submit]','#questionForm button[type=submit]','#wellbeingForm button[type=submit]']){
    const node=q(selector);if(node)node.disabled=!ownerCanEdit;
  }
  qa('[data-edit-observation],[data-edit-medication],[data-edit-cost],[data-question-observation],[data-question-status]').forEach(node=>node.disabled=!ownerCanEdit);
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
  q('#stoolRows').addEventListener('click',event=>{if(event.target.closest('[data-remove-stool]')){event.target.closest('.stool-input-row').remove();renderSafetyPrompt();}});
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
  const nauseaNone=q('#nauseaNoneObserved');
  const nauseaChoices=qa('input[name="nauseaSigns"]');
  nauseaNone?.addEventListener('change',()=>{
    if(!nauseaNone.checked)return;
    nauseaChoices.forEach(box=>{box.checked=false;});
    q('#nauseaOther').value='';
  });
  nauseaChoices.forEach(box=>box.addEventListener('change',()=>{if(box.checked&&nauseaNone)nauseaNone.checked=false;}));
  q('#nauseaOther')?.addEventListener('input',event=>{if(event.target.value.trim()&&nauseaNone)nauseaNone.checked=false;});
  const vomitNone=q('#vomitNoneObserved');
  const vomitChoices=qa('input[name="vomitFlags"]');
  vomitNone?.addEventListener('change',()=>{
    if(!vomitNone.checked)return;
    vomitChoices.forEach(box=>{box.checked=false;});
    renderSafetyPrompt();
  });
  vomitChoices.forEach(box=>box.addEventListener('change',()=>{if(box.checked&&vomitNone)vomitNone.checked=false;renderSafetyPrompt();}));
  q('#journalForm')?.addEventListener('input',renderSafetyPrompt);
  q('#journalForm')?.addEventListener('change',renderSafetyPrompt);
  qa('[data-snapshot-range]').forEach(button=>button.addEventListener('click',()=>{
    careSnapshotRange.mode=button.dataset.snapshotRange;
    const latest=latestCareActivityDate();
    if(careSnapshotRange.mode==='custom'&&latest){
      if(!careSnapshotRange.to)careSnapshotRange.to=latest;
      if(!careSnapshotRange.from)careSnapshotRange.from=addDays(latest,-6);
    }
    renderCareSnapshotPreview();
  }));
  q('#careSnapshotFrom')?.addEventListener('change',event=>{careSnapshotRange.from=event.target.value;renderCareSnapshotPreview();});
  q('#careSnapshotTo')?.addEventListener('change',event=>{careSnapshotRange.to=event.target.value;renderCareSnapshotPreview();});
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
    const ask=event.target.closest('[data-question-observation]');
    if(ask){
      const row=state.observations.find(o=>o.id===ask.dataset.questionObservation);
      if(row){questionDraftSource={type:'observation',id:row.id,date:row.date};navigate('home');renderQuestions();const input=q('#questionInput');if(input){input.value=`Ask about ${fmtDate(row.date)}: `;input.focus();input.setSelectionRange(input.value.length,input.value.length);}}
    }
    const statusButton=event.target.closest('[data-question-status]');
    if(statusButton&&ownerCanEdit){
      const item=(state.carePlan?.questions||[]).find(question=>question.id===statusButton.dataset.questionStatus);
      if(item){item.status=item.status==='resolved'?'open':'resolved';item.resolvedAt=item.status==='resolved'?new Date().toISOString():null;saveChanges().then(ok=>{if(ok){renderQuestions();toast(item.status==='resolved'?'Question marked asked':'Question reopened');}});}
    }
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
    if(field&&!['medications','nauseaSigns','nauseaNoneObserved','appetiteBehaviors','energyBehaviors','vomitFlags','vomitNoneObserved'].includes(name)){
      const selected=value??'';
      if(field.tagName==='SELECT'&&selected!==''&&![...field.options].some(option=>option.value===String(selected))){
        const option=new Option(String(selected),String(selected));option.dataset.historical='';field.add(option);
      }
      field.value=selected;
    }
  }
  if(row)form.elements.namedItem('medications').value=(row.medications||[]).join(', ');
  const appetitePercent=row?.appetitePercent;
  qa('input[name="appetiteAmount"]').forEach(box=>{box.checked=appetitePercent!==null&&appetitePercent!==undefined&&appetitePercent!==''&&Number(box.value)===Number(appetitePercent);});
  const appetiteBehaviors=Array.isArray(row?.appetiteBehaviors)?row.appetiteBehaviors:[];
  qa('input[name="appetiteBehaviors"]').forEach(box=>{box.checked=appetiteBehaviors.includes(box.value);});
  q('#appetiteOther').value=row?.appetiteOther||'';
  const appetiteLegacy=q('#appetiteLegacyHint');
  const hasLegacyAppetite=Boolean(row&&row.appetite&&row.appetitePercent===undefined&&!Array.isArray(row.appetiteBehaviors)&&!row.appetiteOther);
  appetiteLegacy.hidden=!hasLegacyAppetite;
  appetiteLegacy.textContent=hasLegacyAppetite?`Historical entry: appetite was recorded as "${row.appetite}". It will stay unchanged unless you add the new detail above.`:'';
  const energyLevel=row?.energyBaselineLevel||'';
  qa('input[name="energyLevel"]').forEach(box=>{box.checked=box.value===energyLevel;});
  const energyBehaviors=Array.isArray(row?.energyBehaviors)?row.energyBehaviors:[];
  qa('input[name="energyBehaviors"]').forEach(box=>{box.checked=energyBehaviors.includes(box.value);});
  q('#energyOther').value=row?.energyOther||'';
  const energyLegacy=q('#energyLegacyHint');
  const hasLegacyEnergy=Boolean(row&&row.energy&&!row.energyBaselineLevel&&!Array.isArray(row.energyBehaviors)&&!row.energyOther);
  energyLegacy.hidden=!hasLegacyEnergy;
  energyLegacy.textContent=hasLegacyEnergy?`Historical entry: energy was recorded as "${row.energy}". It will stay unchanged unless you add the new detail above.`:'';
  const savedSigns=Array.isArray(row?.nauseaSigns)?row.nauseaSigns:[];
  qa('input[name="nauseaSigns"]').forEach(box=>{box.checked=savedSigns.includes(box.value);});
  q('#nauseaNoneObserved').checked=Boolean(row?.nauseaNoneObserved);
  q('#nauseaOther').value=row?.nauseaOther||'';
  const legacyHint=q('#nauseaLegacyHint');
  const hasLegacyNausea=Boolean(row&&Number(row.nausea)>0&&!Array.isArray(row.nauseaSigns)&&!row.nauseaOther);
  legacyHint.hidden=!hasLegacyNausea;
  legacyHint.textContent=hasLegacyNausea?`Historical entry: nausea was previously recorded as ${Number(row.nausea)===1?'signs observed':Number(row.nausea)===2?'moderate':'severe'}. It will stay unchanged unless you select behaviors above or mark none observed.`:'';
  const savedVomitFlags=Array.isArray(row?.vomitFlags)?row.vomitFlags:[];
  qa('input[name="vomitFlags"]').forEach(box=>{box.checked=savedVomitFlags.includes(box.value);});
  q('#vomitNoneObserved').checked=Boolean(row?.vomitNoneObserved);
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
  renderSafetyPrompt();
  els.journalDialog.showModal();
}

function todayAppEntry(){
  return [...state.observations].reverse().find(o=>o.date===todayIso()&&!o.rawEntry&&o.source==='owner_observation');
}

function addStoolRow(row={}){
  const wrap=document.createElement('div');wrap.className='stool-input-row';
  const consistencyOptions=Object.entries(STOOL_CONSISTENCY_LABELS).map(([value,label])=>`<option value="${value}">${label}</option>`).join('');
  const flagChoices=Object.entries(STOOL_FLAG_LABELS).map(([value,label])=>`<label class="stool-flag-choice"><input type="checkbox" data-stool-flag value="${value}"><span>${label}</span></label>`).join('');
  wrap.innerHTML=`<div class="stool-input-main"><label class="field"><span>When</span><select data-stool-period><option>AM</option><option>PM</option><option>Before bed</option><option>Overnight</option><option>Other</option></select></label><label class="field"><span>Time (optional)</span><input data-stool-time type="time"></label><label class="field"><span>Roger's existing score (1–8, optional)</span><input data-stool-score type="number" min="1" max="8" step="1" inputmode="numeric"></label></div><label class="field stool-consistency-field"><span>What did the consistency look like?</span><select data-stool-consistency><option value="">Not logged</option>${consistencyOptions}</select></label><div class="stool-consistency-help">Describe what you saw. The existing 1–8 score stays available so Roger's historical trend remains comparable.</div><div class="stool-flags"><div class="stool-flags-label">Anything else you observed?</div><div class="stool-flag-grid">${flagChoices}</div></div><div class="stool-input-detail"><label class="field"><span>Other detail</span><input data-stool-notes placeholder="Color, amount, timing, anything unusual…"></label><label class="field stool-status"><span>Status</span><select data-stool-status><option value="observed">Observed</option><option value="not observed">Not observed</option><option value="none">No stool</option></select></label><button class="text-button" type="button" data-remove-stool aria-label="Remove bowel movement">Remove</button></div>`;
  q('#stoolRows').append(wrap);
  wrap.querySelector('[data-stool-period]').value=['AM','PM','Before bed','Overnight'].includes(row.period)?row.period:row.period?'Other':'AM';
  wrap.querySelector('[data-stool-time]').value=row.time||'';
  wrap.querySelector('[data-stool-score]').value=row.score??'';
  wrap.querySelector('[data-stool-consistency]').value=row.consistency||'';
  const flags=Array.isArray(row.flags)?row.flags:[];
  wrap.querySelectorAll('[data-stool-flag]').forEach(box=>{box.checked=flags.includes(box.value);});
  wrap.querySelector('[data-stool-notes]').value=row.notes||'';
  wrap.querySelector('[data-stool-status]').add(new Option('Not recorded','not recorded'),2);
  wrap.querySelector('[data-stool-status]').value=row.status||'observed';
}

function collectStoolRows(){
  return qa('#stoolRows .stool-input-row').map(el=>{
    const period=el.querySelector('[data-stool-period]').value;
    const time=el.querySelector('[data-stool-time]').value;
    const scoreText=el.querySelector('[data-stool-score]').value;
    const consistency=el.querySelector('[data-stool-consistency]').value;
    const flags=[...el.querySelectorAll('[data-stool-flag]:checked')].map(box=>box.value).filter(value=>STOOL_FLAG_LABELS[value]);
    const notes=el.querySelector('[data-stool-notes]').value.trim();
    const status=el.querySelector('[data-stool-status]').value;
    return {period,time:time||null,score:status==='observed'&&scoreText!==''?Number(scoreText):null,status,consistency:status==='observed'?consistency:'',flags:status==='observed'?flags:[],notes};
  }).filter(x=>x.status!=='observed'||x.score!==null||x.time||x.consistency||x.flags.length||x.notes);
}

function stoolFlagLabels(row){
  return (Array.isArray(row?.flags)?row.flags:[]).map(value=>STOOL_FLAG_LABELS[value]||value);
}
function stoolHasFlag(row,flag){return Array.isArray(row?.flags)&&row.flags.includes(flag);}
function observationHasStoolFlag(o,flag){return (o.stoolEvents||[]).some(row=>row.status==='observed'&&stoolHasFlag(row,flag));}
function stoolIsLoose(row){
  return ['very_soft','unformed','watery'].includes(row?.consistency)||Number(row?.score)>=6||/diarrhea|loose|watery|liquid|unformed|mushy/i.test(String(row?.notes||''));
}
function stoolEventSummary(row){
  const parts=[];
  if(row.score!==null&&row.score!==undefined&&row.score!=='')parts.push(`score ${row.score}`);
  if(row.consistency)parts.push(STOOL_CONSISTENCY_LABELS[row.consistency]||row.consistency);
  const flags=stoolFlagLabels(row);if(flags.length)parts.push(flags.join(', '));
  if(row.notes)parts.push(row.notes);
  return parts.join(' · ')||'observed';
}

function vomitFlagLabels(o){return (Array.isArray(o?.vomitFlags)?o.vomitFlags:[]).map(value=>VOMIT_FLAG_LABELS[value]||value);}
function journalSafetySignals(){
  const form=q('#journalForm');if(!form)return {tier:null,reasons:[]};
  const vomiting=Number(form.elements.namedItem('vomiting')?.value||0);
  const vomitFlags=qa('input[name="vomitFlags"]:checked').map(box=>box.value);
  const stoolFlags=qa('#stoolRows [data-stool-flag]:checked').map(box=>box.value);
  const urgent=[],contact=[];
  if(vomitFlags.includes('coffee_ground_like'))urgent.push('dark material resembling coffee grounds in vomit');
  if(vomitFlags.includes('bright_red_blood'))urgent.push('bright-red blood in vomit');
  if(stoolFlags.includes('black_tarry'))urgent.push('black / tarry stool');
  if(stoolFlags.includes('bright_red_blood'))contact.push('bright-red blood in stool');
  if(vomiting>=3)contact.push(`${vomiting} vomiting episodes logged today`);
  return urgent.length?{tier:'urgent',reasons:[...urgent,...contact]}:contact.length?{tier:'contact',reasons:contact}:{tier:null,reasons:[]};
}
function safetyContactActions(tier){
  const team=mergeCareTeam(state?.carePlan?.careTeam||[]);
  const emergency=team.find(contact=>contact.kind==='emergency'&&phoneHref(contact.phone));
  const specialty=team.find(contact=>contact.id==='ksu'&&phoneHref(contact.phone));
  const primary=team.find(contact=>contact.id==='optimum'&&phoneHref(contact.phone));
  const ordered=tier==='urgent'?[emergency,specialty,primary]:[specialty,primary,emergency];
  const seen=new Set();
  return ordered.filter(Boolean).filter(contact=>{if(seen.has(contact.id))return false;seen.add(contact.id);return true;}).slice(0,3).map((contact,index)=>`<a class="${index===0?'primary':''}" href="${esc(phoneHref(contact.phone))}">Call ${esc(contact.kind==='emergency'?'emergency hospital':contact.id==='ksu'?'K-State':'Optimum')}</a>`).join('');
}
function renderSafetyPrompt(){
  const root=q('#safetyPrompt'),form=q('#journalForm'),details=q('.vomit-fieldset');if(!root||!form)return;
  const vomiting=Number(form.elements.namedItem('vomiting')?.value||0);
  if(details)details.hidden=!(vomiting>0||qa('input[name="vomitFlags"]:checked').length);
  if(vomiting<=0){qa('input[name="vomitFlags"]').forEach(box=>{box.checked=false;});if(q('#vomitNoneObserved'))q('#vomitNoneObserved').checked=false;}
  renderJournalVetGuidance();
  const signal=journalSafetySignals();
  if(!signal.tier){root.hidden=true;root.className='safety-prompt';root.innerHTML='';return;}
  const urgent=signal.tier==='urgent';
  const title=urgent?'Urgent veterinary attention':'Contact Roger’s veterinary team';
  const copy=urgent?'These observations can be associated with gastrointestinal bleeding. Contact Roger’s veterinary team or emergency hospital now for guidance.':'Blood in the stool or more than two vomiting episodes in a day warrants prompt veterinary guidance. Contact Roger’s veterinary team today.';
  const instructions=state?.carePlan?.vetCallInstructions?`<div class="safety-prompt-note"><strong>Roger-specific instructions on file:</strong> ${esc(state.carePlan.vetCallInstructions)}</div>`:'';
  root.hidden=false;root.className=`safety-prompt ${signal.tier}`;
  root.innerHTML=`<div class="safety-prompt-title">${esc(title)}</div><div class="safety-prompt-copy">${esc(copy)}</div><div class="safety-prompt-reasons"><strong>What you recorded:</strong> ${esc(signal.reasons.join('; '))}</div><div class="safety-prompt-actions">${safetyContactActions(signal.tier)}</div>${instructions}<div class="safety-prompt-note">This prompt does not diagnose the cause. If Roger appears severely ill, weak, collapses, or has trouble breathing, seek emergency veterinary care.</div>`;
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
    if(['ownerLogin','ownerLinkPaste'].includes(event.target.id)||ownerCanEdit)return;
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
    const editId=String(fd.get('editId')||'');
    const existing=editId?state.observations.find(o=>o.id===editId):null;
    const appetiteAmount=fd.get('appetiteAmount');
    const appetitePercent=appetiteAmount===null||appetiteAmount===''?null:Number(appetiteAmount);
    const appetiteBehaviors=fd.getAll('appetiteBehaviors').map(String).filter(value=>APPETITE_BEHAVIOR_LABELS[value]);
    const appetiteOther=String(fd.get('appetiteOther')||'').trim();
    const legacyAppetite=existing&&existing.appetite&&existing.appetitePercent===undefined&&!Array.isArray(existing.appetiteBehaviors)&&!existing.appetiteOther;
    let appetite='';
    if(appetitePercent!==null)appetite=appetitePercent>100?'increased':appetitePercent===0?'refused food':appetitePercent>=90?'normal':'decreased';
    else if(appetiteBehaviors.length)appetite=appetiteBehaviors.includes('more_interest')?'increased':appetiteBehaviors.includes('ate_normally')?'normal':'decreased';
    else if(legacyAppetite)appetite=existing.appetite;
    const energyBaselineLevel=String(fd.get('energyLevel')||'');
    const energyBehaviors=fd.getAll('energyBehaviors').map(String).filter(value=>ENERGY_BEHAVIOR_LABELS[value]);
    const energyOther=String(fd.get('energyOther')||'').trim();
    const legacyEnergy=existing&&existing.energy&&!existing.energyBaselineLevel&&!Array.isArray(existing.energyBehaviors)&&!existing.energyOther;
    const energy=energyBaselineLevel||(legacyEnergy?existing.energy:'');
    const nauseaSigns=fd.getAll('nauseaSigns').map(String).filter(value=>NAUSEA_SIGN_LABELS[value]);
    const nauseaNoneObserved=fd.get('nauseaNoneObserved')==='1';
    const nauseaOther=String(fd.get('nauseaOther')||'').trim();
    const legacyNausea=existing&&!Array.isArray(existing.nauseaSigns)&&!existing.nauseaOther&&existing.nausea!==null&&existing.nausea!==undefined&&existing.nausea!=='';
    const nausea=nauseaNoneObserved?0:(nauseaSigns.length||nauseaOther?1:(legacyNausea?Number(existing.nausea):null));
    const vomitFlags=fd.getAll('vomitFlags').map(String).filter(value=>VOMIT_FLAG_LABELS[value]);
    const vomitNoneObserved=fd.get('vomitNoneObserved')==='1';
    const vomiting=fd.get('vomiting')===''?null:Number(fd.get('vomiting'));
    if(vomitFlags.length&&!(Number(vomiting)>0))return toast('Enter at least one vomiting episode before describing the vomit.',true);
    const tracked=['vomiting','hydration','urination','pain','mood','play','sleep','rogerThings','gi','medications','notes'];
    const appetiteTracked=appetitePercent!==null||appetiteBehaviors.length>0||Boolean(appetiteOther)||legacyAppetite;
    const energyTracked=Boolean(energyBaselineLevel)||energyBehaviors.length>0||Boolean(energyOther)||legacyEnergy;
    const nauseaTracked=nauseaNoneObserved||nauseaSigns.length>0||Boolean(nauseaOther)||legacyNausea;
    if(!stoolEvents.length&&!appetiteTracked&&!energyTracked&&!nauseaTracked&&!tracked.some(key=>String(fd.get(key)??'').trim()))return toast('Add a note or at least one observation before saving',true);
    const obs = {
      id: uid('obs'), date: fd.get('date'), appetite,appetitePercent,appetiteBehaviors,appetiteOther,energy,energyBaselineLevel,energyBehaviors,energyOther,
      nausea,nauseaSigns,nauseaOther,nauseaNoneObserved,vomiting,vomitFlags,vomitNoneObserved,
      stool:stoolEvents.map(s=>`${s.period}${s.time?' '+s.time:''}: ${s.status==='observed'?stoolEventSummary(s):s.status}`).join(' | '),stoolEvents,
      hydration: fd.get('hydration'), urination: fd.get('urination'), pain:fd.get('pain')===''?null:Number(fd.get('pain')),
      mood:fd.get('mood'),play:fd.get('play'),sleep:fd.get('sleep'),rogerThings:fd.get('rogerThings'),gi:fd.get('gi'),
      medications: String(fd.get('medications') || '').split(',').map(x=>x.trim()).filter(Boolean),
      notes: String(fd.get('notes')||'').trim(), source:'owner_observation'
    };
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

  q('#questionForm').addEventListener('submit',async event=>{
    event.preventDefault();
    const input=q('#questionInput'),text=String(input?.value||'').trim();
    if(!text)return;
    state.carePlan.questions=Array.isArray(state.carePlan.questions)?state.carePlan.questions:[];
    state.carePlan.questions.push({id:uid('question'),text,createdAt:new Date().toISOString(),status:'open',resolvedAt:null,source:questionDraftSource?structuredClone(questionDraftSource):null});
    if(!await saveChanges())return;
    input.value='';questionDraftSource=null;renderQuestions();toast('Question saved for the next visit');
  });

  q('#careTeamForm').addEventListener('submit',async event=>{
    event.preventDefault();const fd=new FormData(event.currentTarget);
    const current=mergeCareTeam(state.carePlan?.careTeam||[]);
    state.carePlan.careTeam=current.map(contact=>({
      ...contact,
      name:String(fd.get(`${contact.id}-name`)||'').trim(),
      phone:String(fd.get(`${contact.id}-phone`)||'').trim(),
      address:String(fd.get(`${contact.id}-address`)||'').trim(),
      afterHours:String(fd.get(`${contact.id}-afterHours`)||'').trim(),
      notes:String(fd.get(`${contact.id}-notes`)||'').trim(),
      source:'Owner-entered care team update'
    }));
    if(!await saveChanges())return;renderCareTeam();toast('Care team & emergency plan saved');
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
  renderProfile(); renderHome(); renderCareSnapshotPreview(); renderQuestions(); renderCareTeam(); renderClinicalReview(); renderUpcomingCare(); renderTreatmentOverlay(); renderJournal(); renderWellbeing(); renderMedications(); renderTimeline(); renderCosts(); renderProfileDetails(); renderDocuments(); renderBackupStatus(); renderSharedStatus();
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
  const last=meta.confirmedAt?new Date(meta.confirmedAt).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):null;
  const message=current
    ? `File backup confirmed ${last}. This is separate from cloud sync.`
    : `${last?`Last file backup: ${last}. `:''}File backup is separate from cloud sync and also protects document files stored only on this device.`;
  const home=q('#homeBackupStatus'),more=q('#backupStatus');
  if(home)home.innerHTML=`<strong>${current?'File backup current':'File backup available'}</strong><span>${esc(message)}</span><button type="button" data-open-backup>${current?'View backup':'Backup options'}</button>`;
  if(more)more.innerHTML=`<strong>${current?'File backup current':'Optional file backup'}</strong><p>${esc(message)}</p>${recoveredFromSnapshot?'<p>A local recovery copy was used at startup. Creating a fresh file backup is recommended.</p>':''}`;
  q('#confirmBackupSaved').hidden=!backupPreparedAt;
}

function phoneHref(value){const clean=String(value||'').replace(/[^\d+]/g,'');return clean?`tel:${clean}`:'';}
function directionsHref(address){return address?`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`:'';}
function renderQuestions(){
  const root=els.nextVisitQuestions,context=q('#questionContext');if(!root)return;
  const questions=[...(state.carePlan?.questions||[])].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
  const open=questions.filter(item=>item.status!=='resolved'),resolved=questions.filter(item=>item.status==='resolved');
  const itemHtml=item=>{const source=item.source?.type==='observation'&&item.source?.date?` · from ${fmtDate(item.source.date)} journal entry`:'';return `<article class="question-item ${item.status==='resolved'?'resolved':''}"><div class="question-item-text">${esc(item.text)}</div><div class="question-item-meta">Added ${item.createdAt?new Date(item.createdAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'date unknown'}${source}</div><div class="question-item-actions"><button class="text-button" type="button" data-question-status="${esc(item.id)}">${item.status==='resolved'?'Reopen':'Mark asked'}</button></div></article>`;};
  const openHtml=open.length?open.map(itemHtml).join(''):'<div class="empty-state">No open questions. Add one whenever something occurs to you.</div>';
  const history=resolved.length?`<details class="question-history"><summary>${resolved.length} asked / resolved question${resolved.length===1?'':'s'}</summary><div class="question-list">${resolved.map(itemHtml).join('')}</div></details>`:'';
  root.innerHTML=openHtml+history;
  if(context){context.hidden=!questionDraftSource;context.textContent=questionDraftSource?.date?`Linked to Roger's ${fmtDate(questionDraftSource.date)} journal entry. The question will keep that context.`:'';}
  qa('[data-question-status]').forEach(button=>button.disabled=!ownerCanEdit);
}

function renderCareTeam(){
  const plan=state.carePlan||{};
  const team=mergeCareTeam(plan.careTeam||[]);
  const emergency=team.find(contact=>contact.kind==='emergency');
  const emergencyReady=Boolean(emergency?.name&&emergency?.phone&&emergency?.address);
  const contactCard=contact=>{
    const displayName=contact.name||(contact.kind==='emergency'?'Add emergency hospital':'Provider not set');
    const phone=phoneHref(contact.phone),directions=directionsHref(contact.address);
    const actions=[phone?`<a class="care-action ${contact.kind==='emergency'?'primary':''}" href="${esc(phone)}">Call</a>`:'',directions?`<a class="care-action" href="${esc(directions)}" target="_blank" rel="noopener">Directions</a>`:''].filter(Boolean).join('');
    const meta=[contact.phone,contact.address,contact.afterHours].filter(Boolean).map(esc).join(' · ');
    return `<article class="care-contact ${contact.kind==='emergency'?'emergency':''}"><div class="care-contact-head"><div><div class="care-contact-role">${esc(contact.role)}</div><div class="care-contact-name">${esc(displayName)}</div></div>${contact.kind==='emergency'&&!contact.name?'<span class="chip warn">not set</span>':''}</div><div class="care-contact-meta">${meta||'Contact details not saved yet.'}</div>${actions?`<div class="care-contact-actions">${actions}</div>`:''}</article>`;
  };
  if(els.careTeamQuick)els.careTeamQuick.innerHTML=`<div class="emergency-plan-status ${emergencyReady?'':'incomplete'}"><div><strong>${emergencyReady?'Emergency plan ready':'Emergency plan incomplete'}</strong><span>${emergencyReady?`Preferred emergency hospital: ${esc(emergency.name)}.`:'Choose the emergency hospital you would use after hours and save its phone number and address before you need them.'}</span></div></div><div class="care-team-list">${team.map(contactCard).join('')}</div>`;
  if(els.careTeamFields)els.careTeamFields.innerHTML=team.map(contact=>`<section class="care-team-edit-card ${contact.kind==='emergency'?'emergency':''}"><div class="care-team-edit-head"><div><div class="care-team-edit-title">${esc(contact.name||(contact.kind==='emergency'?'Emergency hospital':'Provider'))}</div><div class="care-team-edit-role">${esc(contact.role)}</div></div>${contact.kind==='emergency'?`<span class="chip ${emergencyReady?'info':'warn'}">${emergencyReady?'plan ready':'complete this'}</span>`:''}</div><div class="care-team-edit-grid"><label class="field"><span>Provider name</span><input name="${esc(contact.id)}-name" value="${esc(contact.name||'')}" placeholder="${contact.kind==='emergency'?'Emergency hospital name':'Provider name'}"></label><label class="field"><span>Phone</span><input name="${esc(contact.id)}-phone" type="tel" value="${esc(contact.phone||'')}" placeholder="Phone number"></label><label class="field wide"><span>Address</span><input name="${esc(contact.id)}-address" value="${esc(contact.address||'')}" placeholder="Street address, city, state"></label><label class="field wide"><span>After-hours / call instructions</span><input name="${esc(contact.id)}-afterHours" value="${esc(contact.afterHours||'')}" placeholder="Who to call or where to go after hours"></label><label class="field wide"><span>Notes</span><input name="${esc(contact.id)}-notes" value="${esc(contact.notes||'')}" placeholder="Department, doctor, entrance, parking, etc."></label></div></section>`).join('');
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
    ['DOCUMENTED COSTS',money(totalPaid()),'through '+fmtDate(state.costs[state.costs.length-1].date)]
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

  els.homeCostSummary.innerHTML = `<div class="estimate-grid"><div class="estimate-box"><div class="section-kicker">DOCUMENTED CARE COSTS</div><div class="estimate-value">${money(totalPaid())}</div><div class="estimate-note">${money(confirmedPaid())} confirmed · ${money(provisionalPaid())} provisional/unresolved. Includes the mixed surgery/dental day.</div></div><div class="estimate-box"><div class="section-kicker">ORIGINAL K-STATE COURSE ESTIMATE</div><div class="estimate-value">$3,500–$4,000</div><div class="estimate-note">8/4 oncology note; primary-vet pre-treatment bloodwork was excluded from the per-injection estimate.</div></div></div>`;

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
  const appetiteKnown=rows.filter(r=>r.observations.some(appetiteIsKnown)),appetiteReduced=rows.filter(r=>r.observations.some(appetiteIsReduced));
  const nausea=rows.filter(r=>r.values.nausea>0),loose=rows.filter(r=>r.values.looseStool===1);
  const bloody=rows.filter(r=>r.observations.some(o=>observationHasStoolFlag(o,'bright_red_blood')||observationHasStoolFlag(o,'black_tarry')||[o.gi,o.notes,...(o.stoolEvents||[]).map(s=>s.notes)].some(v=>/\bblood\b/i.test(String(v||'')))));
  const scores=rows.map(r=>r.values.stoolScore).filter(v=>v!==null);
  const sentences=[`${rows.length} of ${daysBetween(treatment.date,last.date)+1} days logged since chemo #${treatment.number} (${fmtDate(treatment.date)}–${fmtDate(last.date)}).`];
  if(energyKnown.length)sentences.push(`Energy was reduced or low on ${reduced.length} of ${energyKnown.length} days with an energy entry${last.values.energy===3&&reduced.length?' and was recorded as normal on the latest day':''}.`);
  if(appetiteKnown.length)sentences.push(`Appetite was below Roger's normal on ${appetiteReduced.length} of ${appetiteKnown.length} days with an appetite entry.`);
  const symptoms=[];
  if(nausea.length)symptoms.push(`nausea signs on ${nausea.length} day${nausea.length===1?'':'s'}`);
  if(loose.length)symptoms.push(`loose stool or diarrhea on ${loose.length} day${loose.length===1?'':'s'}`);
  if(bloody.length)symptoms.push(`blood or black/tarry appearance on ${bloody.length} day${bloody.length===1?'':'s'}`);
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
    const pre=preCounts[0],nausea=days.filter(r=>r.values.nausea>0).length,appetiteReduced=days.filter(r=>r.observations.some(appetiteIsReduced)).length,loose=days.filter(r=>r.values.looseStool===1).length;
    const blood=days.filter(r=>r.observations.some(o=>observationHasStoolFlag(o,'bright_red_blood')||observationHasStoolFlag(o,'black_tarry')||[o.gi,o.notes,...(o.stoolEvents||[]).map(s=>s.notes)].some(text=>/\bblood\b/i.test(String(text||''))))).length;
    const supportive=(state.medicationAdministrations||[]).filter(a=>a.date>=window.start&&a.date<window.endExclusive&&a.status==='given');
    const courses=(state.medicationCourses||[]).filter(c=>c.startDate<window.endExclusive&&courseRecordedEnd(c)>=window.start&&c.status?.includes('owner-confirmed'));
    const medSummary=[...courses.map(c=>`${medicationName(c.medicationId)} course reported through ${fmtDate(courseRecordedEnd(c))}`),...[...new Set(supportive.map(a=>a.medicationId))].map(id=>`${medicationName(id)} ${new Set(supportive.filter(a=>a.medicationId===id).map(a=>a.date)).size} dated administration(s)`) ].join('; ');
    const lowestText=lowest?`${lowest.displayValue||lowest.value} ${lowest.unit} on day +${daysBetween(t.date,lowest.date)} (${fmtDate(lowest.date)})`:'No post-dose count stored';
    return `<details class="clinical-review-cycle" ${index===0?'open':''}><summary><span><strong>Chemo #${t.number} · ${fmtDate(t.date)}</strong><small>${t.doseMg} mg (${t.doseMgM2} mg/m²) · ${t.weightLb} lb</small></span><span class="review-cue">Review</span></summary><div class="clinical-review-grid">
      <div><strong>Before dose</strong><span>${pre?`Neutrophils ${esc(pre.displayValue||pre.value)} ${esc(pre.unit)} · ${fmtDate(pre.date)}`:'No CBC within two days stored'}</span></div>
      <div><strong>After dose</strong><span>Lowest measured neutrophils: ${esc(lowestText)}</span></div>
      <div><strong>Home observations</strong><span>${days.length} day(s) logged · appetite below normal ${appetiteReduced} · nausea ${nausea} · loose stool/diarrhea ${loose} · blood or black/tarry stool ${blood}. Blank symptom days are not assumed symptom-free.</span></div>
      <div><strong>Medication context</strong><span>${esc(medSummary||'No medication use recorded in this period')}</span></div>
      <div class="review-wide"><strong>Next recorded decision</strong><span>${next?`${fmtDate(next.date)} · ${esc(next.doseReason||'Reason not recorded')}`:'Next dose is scheduled; no decision recorded yet.'}</span></div>
    </div></details>`;
  }).join('');
}

function appetiteIsKnown(o){
  return (o.appetitePercent!==null&&o.appetitePercent!==undefined&&o.appetitePercent!=='')||Boolean(o.appetite);
}
function appetiteIsReduced(o){
  if(o.appetitePercent!==null&&o.appetitePercent!==undefined&&o.appetitePercent!==''&&Number.isFinite(Number(o.appetitePercent)))return Number(o.appetitePercent)<90;
  return /decreased|refused/i.test(String(o.appetite||''));
}
function appetiteIsRefused(o){
  if(o.appetitePercent!==null&&o.appetitePercent!==undefined&&o.appetitePercent!==''&&Number.isFinite(Number(o.appetitePercent)))return Number(o.appetitePercent)===0;
  return /refused/i.test(String(o.appetite||''));
}
function appetiteLabels(o){
  const labels=(Array.isArray(o.appetiteBehaviors)?o.appetiteBehaviors:[]).map(value=>APPETITE_BEHAVIOR_LABELS[value]||value);
  if(String(o.appetiteOther||'').trim())labels.push(String(o.appetiteOther).trim());
  return labels;
}
function appetiteSummary(o){
  const labels=appetiteLabels(o);
  const hasPercent=o.appetitePercent!==null&&o.appetitePercent!==undefined&&o.appetitePercent!==''&&Number.isFinite(Number(o.appetitePercent));
  let base='';
  if(hasPercent)base=Number(o.appetitePercent)>100?'appetite: more than usual':`appetite: ~${Number(o.appetitePercent)}% of normal`;
  else if(o.appetite)base=`appetite: ${o.appetite}`;
  return [base,labels.length?labels.join(', '):''].filter(Boolean).join(' · ');
}
function energyLabels(o){
  const labels=(Array.isArray(o.energyBehaviors)?o.energyBehaviors:[]).map(value=>ENERGY_BEHAVIOR_LABELS[value]||value);
  if(String(o.energyOther||'').trim())labels.push(String(o.energyOther).trim());
  return labels;
}
function energySummary(o){
  const labels=energyLabels(o);
  const base=o.energyBaselineLevel?`energy: ${ENERGY_LEVEL_LABELS[o.energyBaselineLevel]||o.energyBaselineLevel}`:o.energy?`energy: ${o.energy}`:'';
  return [base,labels.length?labels.join(', '):''].filter(Boolean).join(' · ');
}
function nauseaLabels(o){
  const labels=(Array.isArray(o.nauseaSigns)?o.nauseaSigns:[]).map(value=>NAUSEA_SIGN_LABELS[value]||value);
  if(String(o.nauseaOther||'').trim())labels.push(String(o.nauseaOther).trim());
  return labels;
}
function nauseaSummary(o){
  const labels=nauseaLabels(o);
  if(labels.length)return `nausea-associated: ${labels.join(', ')}`;
  if(Number(o.nausea)>0)return Number(o.nausea)===1?'nausea signs (legacy entry)':`${['none','mild','moderate','severe'][Number(o.nausea)]} nausea (legacy entry)`;
  return '';
}
function compactObservation(o){
  const parts=[];
  const appetiteText=appetiteSummary(o);if(appetiteText)parts.push(appetiteText);
  const energyText=energySummary(o);if(energyText)parts.push(energyText);
  const nauseaText=nauseaSummary(o);if(nauseaText)parts.push(nauseaText);
  if(o.vomiting){const findings=vomitFlagLabels(o);parts.push(`${o.vomiting} vomit${Number(o.vomiting)===1?'':'s'}${findings.length?'; '+findings.join(', '):''}`);}
  const stools=(o.stoolEvents||[]).filter(s=>s.status==='observed');
  const scored=stools.map(s=>Number(s.score)).filter(n=>Number.isFinite(n)&&n>0);
  if(stools.length){const flagged=stools.find(s=>stoolFlagLabels(s).length)||stools.find(s=>s.consistency)||stools.at(-1);parts.push(`${stools.length} stool${stools.length===1?'':'s'}${scored.length?', highest '+Math.max(...scored):''}${flagged?'; '+stoolEventSummary(flagged):''}`);}
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
  const appetiteText=appetiteSummary(o);if(appetiteText&&/decreased|refused|~(?:0|25|50|75)%/.test(appetiteText))parts.push(appetiteText);
  const energyText=energySummary(o);if(energyText&&/below|very low|reduced|low/.test(energyText))parts.push(energyText);
  const nauseaText=nauseaSummary(o);if(nauseaText)parts.push(nauseaText);
  if(Number(o.vomiting)>0){const findings=vomitFlagLabels(o);parts.push(`${o.vomiting} vomiting event${Number(o.vomiting)===1?'':'s'}${findings.length?'; '+findings.join(', '):''}`);}
  const stools=(o.stoolEvents||[]).filter(s=>s.status==='observed');
  const scores=stools.map(s=>Number(s.score)).filter(n=>Number.isFinite(n)&&n>0);
  if(stools.length){const flagged=stools.find(s=>stoolFlagLabels(s).length)||stools.find(s=>s.consistency)||stools.at(-1);parts.push(`${stools.length} stool${stools.length===1?'':'s'}${scores.length?', highest '+Math.max(...scores):''}${flagged?'; '+stoolEventSummary(flagged):''}`);}
  else if(o.stool)parts.push(`stool ${o.stool}`);
  return `${fmtDate(o.date).replace(', 2026','')} · ${parts.join(', ')||o.notes.slice(0,80)}`;
}

function symptomSeverity(o){
  let s=0;
  s=Math.max(s,Number(o.nausea)||0,Number(o.pain)||0);
  if(Number(o.vomiting)>0) s=Math.max(s,2);
  if((o.vomitFlags||[]).some(flag=>['bright_red_blood','coffee_ground_like'].includes(flag))||observationHasStoolFlag(o,'black_tarry'))s=Math.max(s,3);
  if(Number(o.vomiting)>=3)s=Math.max(s,2);
  const observedStools=(o.stoolEvents||[]).filter(row=>row.status==='observed');
  const scores=observedStools.map(row=>Number(row.score)).filter(n=>Number.isFinite(n)&&n>0);
  const stool=scores.length?Math.max(...scores):parseFloat(o.stool);
  if(Number.isFinite(stool) && stool>=6) s=Math.max(s,2);
  if(observedStools.some(stoolIsLoose))s=Math.max(s,2);
  if(observationHasStoolFlag(o,'bright_red_blood')||observationHasStoolFlag(o,'black_tarry'))s=Math.max(s,2);
  if(appetiteIsRefused(o))s=Math.max(s,2);
  else if(appetiteIsReduced(o))s=Math.max(s,1);
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
      const stoolLine=stools.length?`<div class="journal-stool-line"><strong>${stools.length} bowel movement${stools.length===1?'':'s'}</strong> · ${stools.map(s=>`${esc(s.period||'Other')}${s.time?' '+esc(s.time):''}: ${esc(stoolEventSummary(s))}`).join(' · ')}</div>`:'';
      return `<div class="journal-source"><div class="row-between"><div class="item-meta"><strong>${o.rawEntry?'Original owner journal':'App entry'}</strong>${o.weightLb?` · ${esc(o.weightLb)} lb`:''}</div><div class="row-actions"><button class="text-button" type="button" data-question-observation="${esc(o.id)}">Ask at next visit</button><button class="text-button" type="button" data-edit-observation="${esc(o.id)}">${o.rawEntry?'Correct':'Edit entry'}</button></div></div><div class="chip-row">${observationChips(o)}</div>${stoolLine}<div class="item-copy">${esc(o.notes)}</div>${o.recordClarification?`<div class="record-clarification"><strong>Confirmed correction:</strong> ${esc(o.recordClarification)}</div>`:''}${o.medications?.length?`<div class="item-meta journal-med-line"><strong>Medication noted:</strong> ${esc(o.medications.join(', '))}</div>`:''}${o.rawEntry?`<details class="original-entry"><summary>Full original entry</summary><pre>${esc(o.rawEntry)}</pre></details>`:''}</div>`;
    }).join('');
    const severity=entries.reduce((a,b)=>symptomSeverity(a)>symptomSeverity(b)?a:b);
    return `<article class="observation-card"><div class="row-between"><div class="item-title">${fmtDate(date)}${entries.length>1?` <small class="journal-source-count">· ${entries.length} notes</small>`:''}</div>${severityChip(severity)}</div>${sources}</article>`;
  }).join('');
}
function observationChips(o){
  const chips=[];
  const appetiteText=appetiteSummary(o);if(appetiteText)chips.push(appetiteText);
  const energyText=energySummary(o);if(energyText)chips.push(energyText);
  const nauseaText=nauseaSummary(o);if(nauseaText)chips.push(nauseaText);else if(o.nauseaNoneObserved)chips.push('no nausea-associated behaviors observed');
  if(Number(o.vomiting)>0){const findings=vomitFlagLabels(o);chips.push(`vomiting: ${o.vomiting}${findings.length?' · '+findings.join(', '):''}`);}
  if(o.stool&&!o.stoolEvents?.length)chips.push(`stool: ${o.stool}`);
  if(o.hydration)chips.push(`water: ${o.hydration}`);
  if(o.urination)chips.push(`${o.urination}`);
  if(Number(o.pain)>0)chips.push(`pain: ${o.pain}/3`);
  if(o.rogerThings)chips.push(`Roger things: ${o.rogerThings}`);
  return chips.map(x=>`<span class="chip">${esc(x)}</span>`).join('');
}

const COMPARE_METRICS={
  energy:{label:'Energy level',min:0,max:4,ticks:[0,1,2,3,4],names:['Very low','Low','Slightly reduced','Normal','High'],unit:'',kind:'owner'},
  nausea:{label:'Nausea observations',min:0,max:3,ticks:[0,1,2,3],names:['None observed','Behaviors observed','Legacy moderate','Legacy severe'],unit:'',kind:'owner'},
  stoolCount:{label:'Bowel movements',min:0,ticks:[0,2,4,6],unit:'',kind:'owner'},
  stoolScore:{label:'Highest stool score',min:1,max:8,ticks:[1,4,6,8],unit:'',kind:'owner'},
  looseStool:{label:'Loose stool / diarrhea',min:0,max:1,ticks:[0,1],names:['Not observed','Loose/unformed/watery'],unit:'',kind:'owner'},
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
    const nausea=entries.map(o=>{
      if(o.nausea!==null&&o.nausea!==undefined&&o.nausea!=='')return Number(o.nausea);
      return isNauseaAssociatedObservation(o)?1:null;
    }).filter(v=>v!==null&&Number.isFinite(v));
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
      looseStool:/diarrhea/i.test(entries.map(o=>`${o.gi||''} ${o.notes||''}`).join(' '))||stools.some(stoolIsLoose)||scores.some(s=>s>=6)?1:(scores.length||stools.some(s=>s.consistency))?0:null,
      cerenia:d.medications.filter(a=>a.medicationId==='med-cerenia'&&a.status==='given').length,
      neutrophils:labFor('Neutrophils'),
      hematocrit:labFor('Hematocrit'),platelets:labFor('Platelets'),alt:labFor('ALT'),alp:labFor('ALP'),
      weight:ownerWeight??treatmentWeight??null
    }};
  });
}
function isNauseaAssociatedObservation(o){
  if(!o)return false;
  if(Boolean(o.nauseaNoneObserved)&&!Number(o.nausea)&&!(o.nauseaSigns||[]).length&&!String(o.nauseaOther||'').trim())return false;
  if(Number(o.nausea)>0)return true;
  if(Array.isArray(o.nauseaSigns)&&o.nauseaSigns.length)return true;
  if(String(o.nauseaOther||'').trim())return true;
  const text=[o.gi,o.notes,o.rawEntry].filter(Boolean).join(' ').toLowerCase();
  if(/\bno nausea\b|no nausea signs/.test(text))return false;
  return /nausea|lip lick|repeated swallow|drool|borborygmi|gurgling|stomach noise/.test(text);
}
function nauseaObservationLabel(o){
  const labels=nauseaLabels(o);
  if(labels.length)return labels.join(', ');
  const text=[o.gi,o.nauseaOther].filter(Boolean).join(' · ');
  if(text)return text.replace(/\s+/g,' ').trim();
  return 'nausea-associated behavior';
}
function nauseaTimingPattern(){
  const treatments=[...(state.treatments||[])].sort((a,b)=>a.date.localeCompare(b.date));
  if(!treatments.length)return null;
  const latest=treatments.at(-1);
  const prior=treatments.slice(0,-1);
  const offsets=[];
  const cycleOffsets=[];
  for(let i=0;i<prior.length;i++){
    const treatment=prior[i],next=treatments[i+1];
    const endExclusive=next?.date||addDays(treatment.date,8);
    const seen=new Set();
    for(const o of state.observations||[]){
      if(o.date<treatment.date||o.date>=endExclusive||!isNauseaAssociatedObservation(o))continue;
      const offset=daysBetween(treatment.date,o.date);
      if(offset<0||offset>7)continue;
      seen.add(offset);offsets.push(offset);
    }
    if(seen.size)cycleOffsets.push({number:treatment.number,offsets:[...seen].sort((a,b)=>a-b)});
  }
  if(!offsets.length)return {latest,cycleOffsets,eventCount:0};
  const sorted=[...offsets].sort((a,b)=>a-b);
  const qIndex=q=>Math.max(0,Math.min(sorted.length-1,Math.round((sorted.length-1)*q)));
  const observedStart=sorted[0],observedEnd=sorted.at(-1);
  const coreStart=sorted[qIndex(.25)],coreEnd=sorted[qIndex(.75)];
  const current=(state.observations||[])
    .filter(o=>o.date>=latest.date&&isNauseaAssociatedObservation(o))
    .sort((a,b)=>a.date.localeCompare(b.date));
  const latestCurrent=current.at(-1)||null;
  const currentCerenia=(state.medicationAdministrations||[])
    .filter(a=>a.medicationId==='med-cerenia'&&a.status==='given'&&a.date>=latest.date)
    .sort((a,b)=>a.date.localeCompare(b.date)||(a.time||'').localeCompare(b.time||''));
  return {
    latest,cycleOffsets,eventCount:offsets.length,cycleCount:cycleOffsets.length,
    observedStart,observedEnd,coreStart,coreEnd,
    todayOffset:daysBetween(latest.date,todayIso()),
    latestCurrent,
    latestCurrentOffset:latestCurrent?daysBetween(latest.date,latestCurrent.date):null,
    currentCerenia
  };
}
function renderNauseaTimingInsight(){
  const root=els.nauseaTimingInsight;
  if(!root)return;
  const active=comparison.primary==='nausea'||comparison.secondary==='nausea'||comparison.primary==='cerenia'||comparison.secondary==='cerenia';
  if(!active){root.hidden=true;root.innerHTML='';return;}
  const pattern=nauseaTimingPattern();
  root.hidden=false;
  if(!pattern?.eventCount){
    root.innerHTML='<div class="section-kicker">NAUSEA TIMING</div><strong>Roger does not have enough prior post-chemo nausea observations yet to establish a personal timing pattern.</strong><p>The chart will build this from his own recorded observations over time.</p>';
    return;
  }
  const today=pattern.todayOffset>=0?`Today is day +${pattern.todayOffset} after chemo #${pattern.latest.number}.`:'';
  const latest=pattern.latestCurrent
    ? `Latest nausea-associated observation: ${fmtDate(pattern.latestCurrent.date)} (day +${pattern.latestCurrentOffset}) · ${nauseaObservationLabel(pattern.latestCurrent)}.`
    : `No nausea-associated observation is recorded yet after chemo #${pattern.latest.number}.`;
  const guidance=pattern.latestCurrent?guidanceForObservation(pattern.latestCurrent):[];
  root.innerHTML=`<div class="section-kicker">ROGER'S NAUSEA TIMING</div><strong>${esc(today)} Prior first-week observations span day +${pattern.observedStart} through day +${pattern.observedEnd}; most of the recorded timing clusters around day +${pattern.coreStart} through day +${pattern.coreEnd}.</strong><p>${esc(latest)} Light shading shows Roger's full recorded range; darker shading shows the central cluster. Teal diamonds mark Cerenia doses actually recorded.</p>${guidanceCardsHtml(guidance)}`;
}
function observationHasDiarrhea(o){
  const stools=(o?.stoolEvents||[]).filter(row=>row.status==='observed');
  if(stools.some(stoolIsLoose))return true;
  const text=[o?.stool,o?.gi,o?.notes,o?.rawEntry].filter(Boolean).join(' ');
  return /diarrhea|watery stool|liquid stool/i.test(text);
}
function observationHasKsuBleedWarning(o){
  return observationHasStoolFlag(o,'black_tarry')||
    (o?.vomitFlags||[]).includes('coffee_ground_like')||
    /dark[, ]+tarry stool|coffee[- ]?ground/i.test([o?.stool,o?.gi,o?.notes,o?.rawEntry].filter(Boolean).join(' '));
}
function guidanceForObservation(o){
  if(!o)return [];
  const items=[];
  if(observationHasKsuBleedWarning(o)){
    items.push({...VET_GUIDANCE_ON_FILE.prednisoneBleed,reason:'You recorded a black/tarry stool or coffee-ground-like vomit finding.'});
    return items;
  }
  if(isNauseaAssociatedObservation(o)||Number(o.vomiting)>0){
    const detail=isNauseaAssociatedObservation(o)?nauseaObservationLabel(o):`${Number(o.vomiting)} vomiting episode${Number(o.vomiting)===1?'':'s'} recorded`;
    items.push({...VET_GUIDANCE_ON_FILE.cerenia,reason:`Matched observation: ${detail}.`});
  }
  if(observationHasDiarrhea(o)){
    items.push({...VET_GUIDANCE_ON_FILE.metronidazole,reason:'Matched observation: diarrhea / loose or watery stool.'});
  }
  return items;
}
function guidanceForObservations(observations=[]){
  const map=new Map();
  for(const observation of observations){
    for(const item of guidanceForObservation(observation)){
      if(!map.has(item.id))map.set(item.id,item);
    }
  }
  return [...map.values()];
}
function guidanceCardsHtml(items=[]){
  if(!items.length)return '';
  return `<section class="vet-guidance-stack">${items.map(item=>`<article class="vet-guidance-card ${item.kind==='urgent'?'urgent':''}"><div class="section-kicker">VETERINARY GUIDANCE ON FILE</div><strong>${esc(item.title)}</strong><p class="vet-guidance-instruction">${esc(item.instruction)}</p><p class="vet-guidance-reason">${esc(item.reason||'Shown because it matches the observation you recorded.')}</p><div class="vet-guidance-source">${esc(item.source)} · ${fmtDate(item.sourceDate)}</div></article>`).join('')}<p class="vet-guidance-footnote">Roger Care is matching your observation to veterinary instructions already on file. It is not creating a new medication or treatment recommendation.</p></section>`;
}
function journalGuidanceDraft(){
  const form=q('#journalForm');
  if(!form)return null;
  const nauseaSigns=qa('input[name="nauseaSigns"]:checked').map(box=>box.value);
  const nauseaOther=String(form.elements.namedItem('nauseaOther')?.value||'').trim();
  const vomitingRaw=form.elements.namedItem('vomiting')?.value;
  return {
    nausea:nauseaSigns.length||nauseaOther?1:0,
    nauseaSigns,
    nauseaOther,
    vomiting:vomitingRaw===''||vomitingRaw==null?null:Number(vomitingRaw),
    vomitFlags:qa('input[name="vomitFlags"]:checked').map(box=>box.value),
    stoolEvents:collectStoolRows(),
    gi:String(form.elements.namedItem('gi')?.value||''),
    notes:''
  };
}
function renderJournalVetGuidance(){
  const root=q('#journalVetGuidance');
  if(!root)return;
  const items=guidanceForObservation(journalGuidanceDraft());
  root.hidden=!items.length;
  root.innerHTML=items.length?guidanceCardsHtml(items):'';
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
  const guidance=guidanceForObservations(day.observations);
  target.innerHTML=`<strong>${fmtDate(date)}</strong><div class="compare-detail-values"><span>${esc(COMPARE_METRICS[a].label)}: <strong>${esc(comparisonValue(a,day.values[a],day))}</strong></span>${b!=='none'?`<span>${esc(COMPARE_METRICS[b].label)}: <strong>${esc(comparisonValue(b,day.values[b],day))}</strong></span>`:''}</div>${notes}${day.qualityOfLife.map(x=>`<div class="compare-note">Weekly wellbeing: ${x.score}/10${x.notes?' · '+esc(x.notes):''} · owner check-in</div>`).join('')}${labs}${day.treatments.map(t=>`<div class="compare-note">Vinblastine #${t.number} · ${esc(t.source)}</div>`).join('')}${events.length?`<div class="compare-note"><strong>Other events:</strong> ${esc(events.join(' · '))}</div>`:''}${guidanceCardsHtml(guidance)}`;
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
  renderNauseaTimingInsight();
  q('#compareCyclePicker').innerHTML=treatments.map(t=>`<button class="compare-cycle ${comparison.cycles.has(t.number)?'active':''}" type="button" data-compare-cycle="${t.number}" aria-pressed="${comparison.cycles.has(t.number)}">#${t.number}<small>${fmtDate(t.date).replace(', 2026','')}</small></button>`).join('');
  if(comparison.view==='aligned'){renderAlignedComparison(treatments);return;}
  const rows=comparisonRows();let range=comparisonRange(rows);
  if(!range||range.error){els.journalTrend.innerHTML=`<p class="empty-state">${range?.error||'Add a dated journal entry to start comparing.'}</p>`;q('#compareDayDetail').innerHTML='';return;}
  const nauseaRequested=comparison.primary==='nausea'||comparison.secondary==='nausea'||comparison.primary==='cerenia'||comparison.secondary==='cerenia';
  if(nauseaRequested&&comparison.range!=='custom'&&todayIso()>range.to){
    const allowToday=comparison.range!=='cycles'||[...(state.treatments||[])].filter(t=>comparison.cycles.has(t.number)).some(t=>inCycleWindow(todayIso(),cycleWindowFor(t,[...(state.treatments||[])].sort((a,b)=>a.number-b.number))));
    if(allowToday)range={...range,to:todayIso()};
  }
  const visible=rows.filter(r=>range.contains(r.date));
  if(!visible.length){els.journalTrend.innerHTML='<p class="empty-state">No recorded values in this range.</p>';q('#compareDayDetail').innerHTML='';return;}
  const keys=[comparison.primary,...(comparison.secondary==='none'?[]:[comparison.secondary])];
  const span=Math.max(1,dateNumber(range.to)-dateNumber(range.from));
  const W=Math.max(740,Math.min(1500,span*16+140)),H=keys.length===2?412:248,L=111,R=24,top=65,laneH=115,gap=64;
  const x=date=>L+(W-L-R)*(dateNumber(date)-dateNumber(range.from))/span;
  let svg='';
  const nauseaMode=keys.includes('nausea')||keys.includes('cerenia');
  const nauseaPattern=nauseaMode?nauseaTimingPattern():null;
  const plotTop=38,plotBottom=H-32,dayWidth=Math.max(5,(W-L-R)/Math.max(1,span));
  if(nauseaPattern?.eventCount){
    for(const t of treatments){
      const fullLeft=Math.max(L,x(addDays(t.date,nauseaPattern.observedStart))-dayWidth/2);
      const fullRight=Math.min(W-R,x(addDays(t.date,nauseaPattern.observedEnd))+dayWidth/2);
      if(fullRight>fullLeft)svg+=`<rect x="${fullLeft}" y="${plotTop}" width="${fullRight-fullLeft}" height="${plotBottom-plotTop}" rx="5" fill="#e9c56d" opacity=".16"><title>Roger's recorded nausea-associated range after chemo: day +${nauseaPattern.observedStart} to +${nauseaPattern.observedEnd}</title></rect>`;
      const coreLeft=Math.max(L,x(addDays(t.date,nauseaPattern.coreStart))-dayWidth/2);
      const coreRight=Math.min(W-R,x(addDays(t.date,nauseaPattern.coreEnd))+dayWidth/2);
      if(coreRight>coreLeft)svg+=`<rect x="${coreLeft}" y="${plotTop}" width="${coreRight-coreLeft}" height="${plotBottom-plotTop}" rx="5" fill="#d9a63e" opacity=".13"><title>Most recorded nausea timing: day +${nauseaPattern.coreStart} to +${nauseaPattern.coreEnd}</title></rect>`;
    }
    for(const row of visible){
      if(!row.observations.some(isNauseaAssociatedObservation))continue;
      const xx=x(row.date);
      svg+=`<line x1="${xx}" x2="${xx}" y1="58" y2="72" stroke="#c98a2d" stroke-width="3" stroke-linecap="round"><title>${esc(fmtDate(row.date))} · nausea-associated observation</title></line><circle cx="${xx}" cy="76" r="4" fill="#c98a2d" stroke="#fff" stroke-width="1.2"><title>${esc(fmtDate(row.date))} · nausea-associated observation</title></circle>`;
    }
    for(const med of state.medicationAdministrations||[]){
      if(med.medicationId!=='med-cerenia'||med.status!=='given'||med.date<range.from||med.date>range.to)continue;
      const xx=x(med.date),yy=48;
      svg+=`<polygon points="${xx},${yy-6} ${xx+6},${yy} ${xx},${yy+6} ${xx-6},${yy}" fill="#197c91" stroke="#fff" stroke-width="1.5"><title>${esc(fmtDate(med.date))} · Cerenia ${esc(med.dose||'dose recorded')}${med.time?' · '+esc(med.time):''}</title></polygon>`;
    }
    const today=todayIso();
    if(today>=range.from&&today<=range.to&&nauseaPattern.todayOffset>=0){
      const xx=x(today);
      svg+=`<line x1="${xx}" x2="${xx}" y1="${plotTop}" y2="${plotBottom}" stroke="#9b6a20" stroke-width="2.5" stroke-dasharray="6 4"/><circle cx="${xx}" cy="54" r="4.5" fill="#9b6a20" stroke="#fff" stroke-width="1.2"/><text x="${xx+7}" y="58" font-size="11" font-weight="900" fill="#7b5318">Today · +${nauseaPattern.todayOffset}</text>`;
    }
  }
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
  els.journalTrend.innerHTML=`<div class="journal-trend-scroll"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(label)} over time, with treatment and CBC dates">${svg}</svg></div><div class="trend-legend"><span><i class="trend-owner"></i>Owner track</span><span><i class="trend-chemo"></i>Treatment</span><span><i class="trend-cbc"></i>CBC</span>${nauseaPattern?.eventCount?'<span><i class="trend-nausea-window"></i>Usual nausea window</span><span><i class="trend-nausea-observed"></i>Nausea observed</span><span><i class="trend-cerenia"></i>Cerenia</span><span><i class="trend-today"></i>Today</span>':''}</div>`;
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
  const nauseaMode=keys.includes('nausea')||keys.includes('cerenia');
  const nauseaPattern=nauseaMode?nauseaTimingPattern():null;
  let svg='';
  if(nauseaPattern?.eventCount){
    const step=(W-L-R)/13;
    const fullLeft=Math.max(L,x(nauseaPattern.observedStart)-step/2),fullRight=Math.min(W-R,x(nauseaPattern.observedEnd)+step/2);
    const coreLeft=Math.max(L,x(nauseaPattern.coreStart)-step/2),coreRight=Math.min(W-R,x(nauseaPattern.coreEnd)+step/2);
    if(fullRight>fullLeft)svg+=`<rect x="${fullLeft}" y="61" width="${fullRight-fullLeft}" height="${H-96}" rx="5" fill="#e9c56d" opacity=".16"><title>Roger's prior recorded nausea range: day +${nauseaPattern.observedStart} to +${nauseaPattern.observedEnd}</title></rect>`;
    if(coreRight>coreLeft)svg+=`<rect x="${coreLeft}" y="61" width="${coreRight-coreLeft}" height="${H-96}" rx="5" fill="#d9a63e" opacity=".13"><title>Most recorded timing: day +${nauseaPattern.coreStart} to +${nauseaPattern.coreEnd}</title></rect>`;
    if(nauseaPattern.todayOffset>=0&&nauseaPattern.todayOffset<=13){
      const xx=x(nauseaPattern.todayOffset);
      svg+=`<line x1="${xx}" x2="${xx}" y1="61" y2="${H-35}" stroke="#9b6a20" stroke-width="2.5" stroke-dasharray="6 4"/><circle cx="${xx}" cy="55" r="4.5" fill="#9b6a20" stroke="#fff" stroke-width="1.2"/><text x="${xx+7}" y="58" font-size="11" font-weight="900" fill="#7b5318">Today · +${nauseaPattern.todayOffset}</text>`;
    }
  }
  svg+=`<line x1="${x(0)}" x2="${x(0)}" y1="61" y2="${H-35}" stroke="#512888" stroke-width="1.5" opacity=".5"/>`;
  for(let offset=0;offset<=13;offset++){
    svg+=`<line x1="${x(offset)}" x2="${x(offset)}" y1="67" y2="${H-35}" stroke="#edf0f4"/><text x="${x(offset)}" y="${H-12}" font-size="11" text-anchor="middle" fill="#707181">${offset}</text>`;
  }
  plotted.forEach(({t,days},i)=>days.forEach(({offset,row})=>{
    const cx=x(offset),color=colors[i%colors.length];
    if(row.labs.some(l=>l.metric==='Neutrophils'))svg+=`<circle cx="${cx}" cy="28" r="4" fill="#b44f5c"><title>Cycle #${t.number}, day ${offset}: CBC on ${esc(fmtDate(row.date))}</title></circle>`;
    if(row.observations.some(isNauseaAssociatedObservation))svg+=`<circle cx="${cx}" cy="52" r="4.5" fill="#c98a2d" stroke="#fff" stroke-width="1.2"><title>Cycle #${t.number}, day ${offset}: nausea-associated observation</title></circle>`;
    if(row.medications.some(m=>m.medicationId==='med-cerenia'&&m.status==='given'))svg+=`<polygon points="${cx},34 ${cx+5},39 ${cx},44 ${cx-5},39" fill="#197c91" stroke="#fff" stroke-width="1"><title>Cycle #${t.number}, day ${offset}: Cerenia given</title></polygon>`;
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
  els.journalTrend.innerHTML=`<p class="field-help">Treatment day 0 is the dose date. Each color is one treatment; a line stops where a value was not recorded or the next treatment began.</p><div class="journal-trend-scroll"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(keys.map(k=>COMPARE_METRICS[k].label).join(' and '))} aligned by days after chemotherapy">${svg}</svg></div><div class="trend-legend">${legend}${nauseaPattern?.eventCount?'<span><i class="trend-nausea-window"></i>Usual nausea window</span><span><i class="trend-nausea-observed"></i>Nausea observed</span><span><i class="trend-cerenia"></i>Cerenia</span><span><i class="trend-today"></i>Today</span>':''}</div><p class="field-help">Red dots: CBC · amber dots: nausea-associated observations · teal diamonds: Cerenia · small squares: other medication or food context. Tap a plotted point for the dated note.</p>`;
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
  els.costSummary.innerHTML=`<div class="cost-total"><div class="section-kicker" style="color:#eee8f8">DOCUMENTED CARE COSTS</div><div class="cost-big">${money(total)}</div><div class="cost-sub">${money(confirmed)} confirmed · ${money(provisional)} provisional/unresolved</div></div>${categoryMeters()}`;

  const treatmentAfterPlan=state.costs.filter(c=>c.date>'2026-08-04').reduce((s,c)=>s+Number(c.amountPaid||0),0);
  els.estimateComparison.innerHTML=`<div class="estimate-grid">
    <div class="estimate-box">
      <div class="section-kicker">K-STATE ESTIMATE · 8/4</div>
      <div class="estimate-value">$3,500–$4,000</div>
      <div class="estimate-note">Complete 8-dose treatment course. K-State estimated about $250 per chemo injection; outside pre-treatment bloodwork was not included in that per-injection figure. Restaging was estimated at about $700.</div>
    </div>
    <div class="estimate-box">
      <div class="section-kicker">DOCUMENTED SINCE 8/4</div>
      <div class="estimate-value">${money(treatmentAfterPlan)}</div>
      <div class="estimate-note">Recorded costs after the treatment plan was established, excluding the 8/4 staging visit itself. This includes provisional amounts. Three chemo treatments and final restaging remain planned.</div>
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
  q('#shareCareSummary').addEventListener('click',async()=>{
    try{
      const pdf=buildCareSummaryPdf(),blob=new Blob([pdf],{type:'application/pdf'}),file=new File([blob],'roger-care-snapshot.pdf',{type:'application/pdf'});
      if(navigator.share&&navigator.canShare?.({files:[file]})){
        await navigator.share({title:'Roger Care Snapshot',text:'Roger’s Care Snapshot',files:[file]});
      }else{
        downloadText('roger-care-snapshot.pdf',pdf,'application/pdf');
        toast('Sharing is not available here, so the Care Snapshot PDF was downloaded instead.');
      }
    }catch(error){if(error?.name!=='AbortError')toast('Could not share the Care Snapshot. Try Download PDF instead.',true);}
  });
  q('#downloadCareSummary').addEventListener('click',()=>{try{downloadText('roger-care-snapshot.pdf',buildCareSummaryPdf(),'application/pdf');toast('Care Snapshot PDF downloaded');}catch(_){toast('Could not create the Care Snapshot PDF. Check the selected date range.',true);}});
  q('#printCareSummary').addEventListener('click',()=>{try{const html=buildCareSummaryHtml(),w=window.open('','_blank');if(!w)return toast('Pop-up blocked. Use Download instead.',true);w.document.write(html);w.document.close();w.focus();setTimeout(()=>w.print(),300);}catch(_){toast('Could not create the complete record. Check the selected date range.',true);}});
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
      state=migrateState(incoming);await persist();unpublishedLocal=true;
      try{localStorage.setItem(PENDING_CLOUD_KEY,'1');}catch(_){}
      syncMessage='Backup restored on this device. Syncing automatically.';
      await loadDocuments();renderAll();
      if(ownerCanEdit)setTimeout(()=>publishCloudMirror(),0);
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
function mostCommonLabels(values,limit=3){
  const counts=new Map();for(const value of values.filter(Boolean))counts.set(value,(counts.get(value)||0)+1);
  return [...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,limit).map(([label,count])=>({label,count}));
}
function latestCareActivityDate(){
  return [
    ...(state.observations||[]).map(row=>row.date),
    ...(state.medicationAdministrations||[]).map(row=>row.date),
    ...(state.labs||[]).map(row=>row.date),
    ...(state.treatments||[]).map(row=>row.date),
    ...(state.milestones||[]).map(row=>row.date)
  ].filter(Boolean).sort().at(-1)||todayIso();
}
function latestCareVisit(end=latestCareActivityDate()){
  const labDates=[...new Set((state.labs||[]).filter(row=>row.date<=end).map(row=>row.date))];
  const visits=[
    ...(state.treatments||[]).filter(row=>row.date<=end).map(row=>({date:row.date,label:`Chemo #${row.number} treatment`,kind:'treatment'})),
    ...labDates.map(date=>({date,label:'CBC / lab visit',kind:'lab'}))
  ];
  const priority={lab:0,treatment:1};
  visits.sort((a,b)=>a.date.localeCompare(b.date)||(priority[a.kind]-priority[b.kind]));
  return visits.at(-1)||null;
}
function resolveCareSnapshotRange(){
  const latest=latestCareActivityDate();
  if(careSnapshotRange.mode==='custom'){
    const from=careSnapshotRange.from||addDays(latest,-6),to=careSnapshotRange.to||latest;
    if(from>to)throw new Error('Care Snapshot start date is after the end date.');
    return {mode:'custom',start:from,end:to,label:'Custom period',context:`${fmtDate(from)} – ${fmtDate(to)}`};
  }
  if(careSnapshotRange.mode==='7days'){
    return {mode:'7days',start:addDays(latest,-6),end:latest,label:'Last 7 days',context:`${fmtDate(addDays(latest,-6))} – ${fmtDate(latest)}`};
  }
  if(careSnapshotRange.mode==='visit'){
    const visit=latestCareVisit(latest);
    const start=visit?.date||latestTreatment().date;
    return {mode:'visit',start,end:latest,label:'Since last visit',context:visit?`${visit.label} · ${fmtDate(visit.date)}`:`From ${fmtDate(start)}`};
  }
  const treatment=latestTreatment();
  return {mode:'treatment',start:treatment.date,end:latest,label:`Since chemo #${treatment.number}`,context:`Treatment on ${fmtDate(treatment.date)}`};
}
function careSnapshotData(){
  const range=resolveCareSnapshotRange();
  const {start,end}=range;
  const treatment=[...(state.treatments||[])].filter(row=>row.date<=end).sort((a,b)=>a.date.localeCompare(b.date)).at(-1)||null;
  const rows=comparisonRows().filter(row=>row.date>=start&&row.date<=end&&row.observations.length);
  const observations=(state.observations||[]).filter(o=>o.date>=start&&o.date<=end);
  const appetiteRows=rows.filter(row=>row.observations.some(appetiteIsKnown));
  const appetiteReduced=appetiteRows.filter(row=>row.observations.some(appetiteIsReduced));
  const appetitePercents=observations.map(o=>Number(o.appetitePercent)).filter(n=>Number.isFinite(n)&&n>=0);
  const minAppetite=appetitePercents.length?Math.min(...appetitePercents):null;
  const energyRows=rows.filter(row=>row.values.energy!==null);
  const energyReduced=energyRows.filter(row=>row.values.energy<3);
  const nauseaRows=rows.filter(row=>row.values.nausea!==null);
  const nauseaDays=nauseaRows.filter(row=>row.values.nausea>0);
  const nauseaDates=nauseaDays.map(row=>row.date);
  const nauseaTop=mostCommonLabels(observations.flatMap(o=>nauseaLabels(o)));
  const stoolRows=rows.filter(row=>row.values.stoolCount!==null||row.values.stoolScore!==null);
  const looseDays=stoolRows.filter(row=>row.values.looseStool===1);
  const bloodDays=rows.filter(row=>row.observations.some(o=>observationHasStoolFlag(o,'bright_red_blood')||observationHasStoolFlag(o,'black_tarry')||[o.gi,o.notes,...(o.stoolEvents||[]).map(s=>s.notes)].some(value=>/\bblood\b|black\s*\/?\s*tarry|tarry/i.test(String(value||'')))));
  const brightRedStoolDays=rows.filter(row=>row.observations.some(o=>observationHasStoolFlag(o,'bright_red_blood')||[o.gi,o.notes,...(o.stoolEvents||[]).map(s=>s.notes)].some(value=>/bright\s*red.*blood|blood.*bright\s*red/i.test(String(value||'')))));
  const blackTarryDays=rows.filter(row=>row.observations.some(o=>observationHasStoolFlag(o,'black_tarry')||[o.gi,o.notes,...(o.stoolEvents||[]).map(s=>s.notes)].some(value=>/black\s*\/?\s*tarry|tarry/i.test(String(value||'')))));
  const stoolScores=stoolRows.map(row=>row.values.stoolScore).filter(value=>value!==null&&Number.isFinite(Number(value))).map(Number);
  const vomitingRows=rows.filter(row=>row.observations.some(o=>o.vomiting!==null&&o.vomiting!==undefined&&o.vomiting!==''));
  const vomitingEpisodes=vomitingRows.reduce((sum,row)=>sum+Math.max(0,...row.observations.map(o=>Number(o.vomiting)||0)),0);
  const vomitFindings=[...new Set(observations.flatMap(o=>vomitFlagLabels(o)))];
  const weightPoints=[
    ...state.treatments.filter(t=>t.date>=start&&t.date<=end&&Number(t.weightLb)>0).map(t=>({date:t.date,value:Number(t.weightLb),source:`Chemo #${t.number}`})),
    ...observations.filter(o=>Number(o.weightLb)>0).map(o=>({date:o.date,value:Number(o.weightLb),source:'owner / clinic journal'}))
  ].sort((a,b)=>a.date.localeCompare(b.date));
  const priorWeight=[...(state.treatments||[])].filter(t=>t.date<=end&&Number(t.weightLb)>0).sort((a,b)=>a.date.localeCompare(b.date)).at(-1);
  const latestWeight=weightPoints.at(-1)||(priorWeight?{date:priorWeight.date,value:Number(priorWeight.weightLb),source:`Chemo #${priorWeight.number}`}:null);
  const window={start,endExclusive:addDays(end,1),displayEnd:end};
  const cerenia=medicationStats('med-cerenia',window);
  const cereniaDates=[...new Set(cerenia.given.map(a=>a.date))];
  const cereniaOnNausea=nauseaDates.filter(date=>cereniaDates.includes(date)).length;
  const supportive=(state.medicationAdministrations||[]).filter(a=>a.status==='given'&&a.date>=start&&a.date<=end);
  const supportiveCounts=[...new Set(supportive.map(a=>a.medicationId))].map(id=>({name:medicationName(id),count:supportive.filter(a=>a.medicationId===id).length}));
  const pred=(state.medicationCourses||[]).filter(course=>course.medicationId==='med-prednisone'&&course.startDate<=end&&(!course.endDate||course.endDate>=start)).sort((a,b)=>a.startDate.localeCompare(b.startDate)).at(-1)||null;
  const predRecordedThrough=pred?courseRecordedEnd(pred):null;
  const predThrough=predRecordedThrough?(predRecordedThrough>end?end:predRecordedThrough):null;
  const latestNeut=(state.labs||[]).filter(l=>l.metric==='Neutrophils'&&l.date<=end).sort((a,b)=>a.date.localeCompare(b.date)).at(-1)||null;
  const questions=(state.carePlan?.questions||[]).filter(question=>question.status!=='resolved');
  const appetiteText=!appetiteRows.length?'Not specifically recorded in this period.':appetiteReduced.length?`Below Roger's normal on ${appetiteReduced.length} of ${appetiteRows.length} logged appetite day${appetiteRows.length===1?'':'s'}.${minAppetite!==null?` Lowest recorded intake: about ${minAppetite}% of normal.`:''}`:`At or near Roger's normal on all ${appetiteRows.length} logged appetite day${appetiteRows.length===1?'':'s'}.`;
  const energyText=!energyRows.length?'Not specifically recorded in this period.':energyReduced.length?`Below Roger's normal on ${energyReduced.length} of ${energyRows.length} logged energy day${energyRows.length===1?'':'s'}.`:`At Roger's normal level on all ${energyRows.length} logged energy day${energyRows.length===1?'':'s'}.`;
  const nauseaText=!nauseaRows.length?'Not specifically recorded in this period.':nauseaDays.length?`Nausea-associated behaviors recorded on ${nauseaDays.length} of ${nauseaRows.length} days with a nausea observation.${nauseaTop.length?` Most frequent: ${nauseaTop.map(item=>item.label).join(', ')}.`:''}`:`No nausea-associated behaviors recorded on ${nauseaRows.length} day${nauseaRows.length===1?'':'s'} with a nausea observation.`;
  const stoolText=!stoolRows.length?'No bowel-movement observations recorded in this period.':`${looseDays.length} of ${stoolRows.length} logged stool day${stoolRows.length===1?'':'s'} had loose, unformed, watery, or legacy score 6+ stool.${stoolScores.length?` Highest recorded legacy score: ${Math.max(...stoolScores)}.`:''}${bloodDays.length?` Blood or black/tarry appearance was recorded on ${bloodDays.length} day${bloodDays.length===1?'':'s'}${blackTarryDays.length?` (${blackTarryDays.length} black/tarry)`:''}.`:''}`;
  const vomitingText=!vomitingRows.length?'Vomiting was not specifically recorded in this period.':vomitingEpisodes?`${vomitingEpisodes} vomiting episode${vomitingEpisodes===1?'':'s'} recorded across ${vomitingRows.length} logged day${vomitingRows.length===1?'':'s'}.${vomitFindings.length?` Appearance findings: ${vomitFindings.join(', ')}.`:''}`:`No vomiting recorded on ${vomitingRows.length} day${vomitingRows.length===1?'':'s'} with a vomiting entry.`;
  const weightText=!latestWeight?'No weight is recorded by the end of this period.':latestWeight.date<start?`Most recent recorded weight before this period: ${latestWeight.value} lb on ${fmtDate(latestWeight.date)}.`:`Latest recorded weight in this period: ${latestWeight.value} lb on ${fmtDate(latestWeight.date)} (${latestWeight.source}).`;
  const medicationParts=[];
  if(pred)medicationParts.push(`Prednisone ${pred.dose||'dose unrecorded'} ${pred.frequency||''}${predThrough?`, owner-confirmed through ${fmtDate(predThrough)}`:''}`);
  medicationParts.push(`Cerenia: ${cerenia.given.length} recorded dose${cerenia.given.length===1?'':'s'}`);
  for(const med of supportiveCounts.filter(item=>item.name!=='Cerenia'&&item.name!=='Prednisone'))medicationParts.push(`${med.name}: ${med.count} recorded administration${med.count===1?'':'s'}`);
  const medicationText=medicationParts.join('. ')+'.';
  const treatmentInRange=Boolean(treatment&&treatment.date>=start&&treatment.date<=end);
  const clinicalParts=[];
  if(treatment)clinicalParts.push(treatmentInRange
    ? `Chemo #${treatment.number}: ${treatment.doseMg} mg vinblastine (${treatment.doseMgM2} mg/m²) on ${fmtDate(treatment.date)}.`
    : `Most recent vinblastine before this period was chemo #${treatment.number} on ${fmtDate(treatment.date)} (${treatment.doseMg} mg; ${treatment.doseMgM2} mg/m²).`);
  if(latestNeut)clinicalParts.push(`Latest stored neutrophils as of the end of this period: ${latestNeut.displayValue||latestNeut.value} ${latestNeut.unit} on ${fmtDate(latestNeut.date)}.`);
  const clinicalText=clinicalParts.join(' ')||'No vinblastine treatment or neutrophil result is recorded by the end of this period.';
  return {
    range,treatment,start,end,rows,observations,
    appetiteRows,appetiteReduced,minAppetite,
    energyRows,energyReduced,
    nauseaRows,nauseaDays,nauseaDates,nauseaTop,
    stoolRows,looseDays,bloodDays,brightRedStoolDays,blackTarryDays,stoolScores,
    vomitingRows,vomitingEpisodes,vomitFindings,
    latestWeight,cerenia,cereniaDates,cereniaOnNausea,pred,predThrough,latestNeut,
    appetiteText,energyText,nauseaText,stoolText,vomitingText,weightText,medicationText,clinicalText,questions
  };
}
function careSnapshotNarrative(snapshot){
  const paragraphs=[];
  const calendarDays=Math.max(1,daysBetween(snapshot.start,snapshot.end)+1);
  const loggedDays=snapshot.rows.length;
  const periodLead=snapshot.range.mode==='treatment'
    ? `Since chemo #${snapshot.treatment.number}`
    : snapshot.range.mode==='visit'
      ? 'Since the last documented visit'
      : snapshot.range.mode==='7days'
        ? 'Over the last 7 days'
        : `From ${fmtDate(snapshot.start)} through ${fmtDate(snapshot.end)}`;
  const coverageLead=loggedDays&&loggedDays<calendarDays
    ? `${periodLead}, I have ${loggedDays} of ${calendarDays} days logged, so this is a partial picture.`
    : loggedDays
      ? `${periodLead}, I have ${loggedDays} day${loggedDays===1?'':'s'} of home observations recorded.`
      : `${periodLead}, I do not have home observations logged.`;

  const urgent=[];
  if(snapshot.blackTarryDays.length)urgent.push(`black/tarry stool on ${snapshot.blackTarryDays.length} day${snapshot.blackTarryDays.length===1?'':'s'}`);
  if(snapshot.vomitFindings.includes('bright-red blood in vomit'))urgent.push('bright-red blood in vomit');
  if(snapshot.vomitFindings.includes('dark material resembling coffee grounds'))urgent.push('dark material resembling coffee grounds in vomit');
  if(snapshot.brightRedStoolDays.length)urgent.push(`bright-red blood in stool on ${snapshot.brightRedStoolDays.length} day${snapshot.brightRedStoolDays.length===1?'':'s'}`);

  const changes=[];
  if(snapshot.appetiteRows.length){
    if(snapshot.appetiteReduced.length)changes.push(`his appetite was below normal on ${snapshot.appetiteReduced.length} of ${snapshot.appetiteRows.length} logged appetite day${snapshot.appetiteRows.length===1?'':'s'}${snapshot.minAppetite!==null?`, with the lowest recorded intake around ${snapshot.minAppetite}% of normal`:''}`);
    else changes.push(`his appetite stayed at or near his normal level on the ${snapshot.appetiteRows.length} day${snapshot.appetiteRows.length===1?'':'s'} I logged it`);
  }
  if(snapshot.energyRows.length){
    if(snapshot.energyReduced.length)changes.push(`his energy was below his usual baseline on ${snapshot.energyReduced.length} of ${snapshot.energyRows.length} logged day${snapshot.energyRows.length===1?'':'s'}`);
    else changes.push(`his energy stayed at his usual baseline on the ${snapshot.energyRows.length} day${snapshot.energyRows.length===1?'':'s'} I logged it`);
  }

  const nausea=[];
  if(snapshot.nauseaRows.length){
    if(snapshot.nauseaDays.length){
      const behaviors=snapshot.nauseaTop.length?snapshot.nauseaTop.map(item=>item.label).join(', '):'the behaviors recorded in the journal';
      nausea.push(`I noticed nausea-associated behaviors on ${snapshot.nauseaDays.length} day${snapshot.nauseaDays.length===1?'':'s'}, most often ${behaviors}`);
      if(snapshot.cerenia.given.length)nausea.push(`Cerenia was recorded ${snapshot.cerenia.given.length} time${snapshot.cerenia.given.length===1?'':'s'} in this period${snapshot.cereniaOnNausea?`, including on ${snapshot.cereniaOnNausea} of those nausea-observation day${snapshot.cereniaOnNausea===1?'':'s'}`:''}`);
    }else nausea.push(`I did not record nausea-associated behaviors on the ${snapshot.nauseaRows.length} day${snapshot.nauseaRows.length===1?'':'s'} when I specifically logged them`);
  }

  const gi=[];
  if(snapshot.stoolRows.length){
    if(snapshot.looseDays.length)gi.push(`stool was loose, unformed, watery, or a legacy score of 6+ on ${snapshot.looseDays.length} of ${snapshot.stoolRows.length} logged stool day${snapshot.stoolRows.length===1?'':'s'}`);
    else gi.push(`I did not record loose or diarrheic stool on the ${snapshot.stoolRows.length} stool day${snapshot.stoolRows.length===1?'':'s'} logged in this period`);
  }
  if(snapshot.vomitingRows.length){
    if(snapshot.vomitingEpisodes)gi.push(`I recorded ${snapshot.vomitingEpisodes} vomiting episode${snapshot.vomitingEpisodes===1?'':'s'} across ${snapshot.vomitingRows.length} logged day${snapshot.vomitingRows.length===1?'':'s'}`);
    else gi.push(`I did not record vomiting on the ${snapshot.vomitingRows.length} day${snapshot.vomitingRows.length===1?'':'s'} when vomiting was specifically logged`);
  }

  let first=coverageLead;
  if(urgent.length)first+=` The most important finding${urgent.length===1?'':'s'} I recorded ${urgent.length===1?'was':'were'} ${urgent.join('; ')}.`;
  else if(changes.length)first+=` The main things I noticed were that ${changes.join('; and ')}.`;
  else if(loggedDays)first+=' The summary below reflects only the structured items I specifically logged.';
  paragraphs.push(first);

  const details=[...(!urgent.length?[]:changes),...nausea,...gi];
  if(details.length)paragraphs.push(details.join('. ')+'.');

  const closing=[];
  const treatmentWeight=Number(snapshot.treatment?.weightLb);
  const latestWeight=Number(snapshot.latestWeight?.value);
  if(Number.isFinite(latestWeight)){
    if(snapshot.latestWeight.date<snapshot.start)closing.push(`The most recent weight I have before this period is ${latestWeight.toFixed(1)} lb from ${fmtDate(snapshot.latestWeight.date)}`);
    else if(snapshot.treatment&&snapshot.treatment.date<=snapshot.latestWeight.date&&Number.isFinite(treatmentWeight)){
      const delta=latestWeight-treatmentWeight;
      const deltaText=Math.abs(delta)>=0.1?` (${delta>0?'+':''}${delta.toFixed(1)} lb from chemo #${snapshot.treatment.number})`:'';
      closing.push(`His latest recorded weight is ${latestWeight.toFixed(1)} lb on ${fmtDate(snapshot.latestWeight.date)}${deltaText}`);
    }else closing.push(`His latest recorded weight is ${latestWeight.toFixed(1)} lb on ${fmtDate(snapshot.latestWeight.date)}`);
  }
  if(snapshot.pred){
    const dose=[snapshot.pred.dose,snapshot.pred.frequency].filter(Boolean).join(' ');
    closing.push(`Prednisone is recorded as ${dose||'prescribed'}${snapshot.predThrough?`, and I have daily dosing confirmed through ${fmtDate(snapshot.predThrough)}`:''}`);
  }
  if(snapshot.questions.length)closing.push(`I have ${snapshot.questions.length} question${snapshot.questions.length===1?'':'s'} saved that I want to make sure I ask the care team`);
  if(closing.length)paragraphs.push(closing.join('. ')+'.');

  return paragraphs;
}

function renderCareSnapshotPreview(){
  const root=els.careSnapshotPreview;if(!root||!state)return;
  qa('[data-snapshot-range]').forEach(button=>button.classList.toggle('active',button.dataset.snapshotRange===careSnapshotRange.mode));
  const custom=q('#careSnapshotCustomRange'),from=q('#careSnapshotFrom'),to=q('#careSnapshotTo');
  if(custom)custom.hidden=careSnapshotRange.mode!=='custom';
  if(careSnapshotRange.mode==='custom'){
    const latest=latestCareActivityDate();
    if(!careSnapshotRange.to)careSnapshotRange.to=latest;
    if(!careSnapshotRange.from)careSnapshotRange.from=addDays(latest,-6);
    if(from)from.value=careSnapshotRange.from;if(to)to.value=careSnapshotRange.to;
  }
  let snapshot;
  try{snapshot=careSnapshotData();}catch(error){root.innerHTML=`<div class="alert">${esc(error.message||'Choose a valid Care Snapshot date range.')}</div>`;return;}
  const range=snapshot.start===snapshot.end?fmtDate(snapshot.start):`${fmtDate(snapshot.start)} – ${fmtDate(snapshot.end)}`;
  const narrative=careSnapshotNarrative(snapshot);
  const items=[['APPETITE',snapshot.appetiteText],['ENERGY',snapshot.energyText],['NAUSEA-ASSOCIATED',snapshot.nauseaText],['GI / STOOL',snapshot.stoolText],['VOMITING',snapshot.vomitingText],['MEDICATIONS',snapshot.medicationText]];
  root.innerHTML=`<div class="care-snapshot-period"><div><strong>${esc(snapshot.range.label)}</strong><span>${esc(range)} · ${esc(snapshot.range.context)} · ${snapshot.rows.length} day${snapshot.rows.length===1?'':'s'} with owner observations</span></div><span class="chip info">${snapshot.questions.length} open question${snapshot.questions.length===1?'':'s'}</span></div><section class="care-snapshot-narrative"><div class="care-snapshot-label">KEY OBSERVATIONS</div>${narrative.map(paragraph=>`<p>${esc(paragraph)}</p>`).join('')}</section><div class="care-snapshot-grid">${items.map(([label,value])=>`<div class="care-snapshot-item"><div class="care-snapshot-label">${label}</div><div class="care-snapshot-value">${esc(value)}</div></div>`).join('')}</div><div class="care-snapshot-note">The summary above is generated only from Roger's recorded observations, medications, labs, and questions. Missing or unlogged days remain unknown.</div>`;
}

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
  const p=state.profile,snapshot=careSnapshotData(),plan=state.carePlan||{visits:[]};
  const range=snapshot.start===snapshot.end?fmtDate(snapshot.start):`${fmtDate(snapshot.start)} - ${fmtDate(snapshot.end)}`;
  line(`${p.fullName||p.name} | CARE SNAPSHOT`,18,true,0,27);
  wrap(`KSU ${p.patientIds?.ksu||'unrecorded'} | Optimum ${p.patientIds?.optimum||'unrecorded'} | ${p.breed} | Prepared ${new Date().toLocaleDateString('en-US')}`,9);
  heading(`How has ${p.name} been doing?`);
  wrap(`${snapshot.range.label} | ${range} | ${snapshot.range.context} | ${snapshot.rows.length} day(s) with owner observations.`,9);
  wrap(`Diagnosis: ${p.diagnosis}. Status: ${p.currentStatus}.`);
  const narrative=careSnapshotNarrative(snapshot);
  heading('Key observations');
  narrative.forEach(paragraph=>wrap(paragraph,10,false,8));
  heading('Structured detail');
  wrap(`Appetite: ${snapshot.appetiteText}`,9,false,8);
  wrap(`Energy: ${snapshot.energyText}`,9,false,8);
  wrap(`Nausea-associated observations: ${snapshot.nauseaText}`,9,false,8);
  wrap(`GI / stool: ${snapshot.stoolText}`,9,false,8);
  wrap(`Vomiting: ${snapshot.vomitingText}`,9,false,8);
  wrap(`Weight: ${snapshot.weightText}`,9,false,8);
  heading('Treatment & medication context');
  wrap(snapshot.clinicalText,9,false,8);
  wrap(snapshot.medicationText,9,false,8);
  heading('Questions for care team');
  if(snapshot.questions.length)snapshot.questions.forEach((question,index)=>wrap(`${index+1}. ${question.text}${question.source?.date?` (from ${fmtDate(question.source.date)} journal entry)`:''}`,9,false,8));
  else wrap('No open owner questions recorded.',9,false,8);
  heading('Upcoming care');
  for(const v of plan.visits||[])wrap(`${v.label}: ${v.date?fmtDate(v.date):'TBD'}`,9,false,8);
  wrap(`When to call the vet: ${plan.vetCallInstructions||'Awaiting vet-specific instructions.'}`,9,false,8);
  line('Owner observations are reported separately from clinical records. Missing or unlogged days remain unknown. This snapshot supports discussion with the veterinary team; it does not diagnose cause.',9,false,0,15);
  page();line('Clinical history | concise review',16,true,0,25);
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
    const commands=lines.map(item=>`BT /${item.bold?'F2':'F1'} ${item.size} Tf 1 0 0 1 ${item.x} ${item.y} Tm (${clean(item.text)}) Tj ET`).join('\n')+`\nBT /F1 8 Tf 1 0 0 1 45 30 Tm (Roger Oberle | Care Snapshot | ${index+1} / ${pages.length}) Tj ET`;
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
  const p=state.profile,t=latestTreatment(),plan=state.carePlan||{visits:[]},snapshot=careSnapshotData();
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
  const openQuestions=(plan.questions||[]).filter(question=>question.status!=='resolved');
  const questionRows=openQuestions.map(question=>`<li>${esc(question.text)}${question.source?.date?` <small>(from ${fmtDate(question.source.date)} journal entry)</small>`:''}</li>`).join('');
  const docs=documents.map(d=>`<li>${esc(d.name)} · ${fmtDate(d.date)} · ${esc(d.provider||d.type)}</li>`).join('');
  const correctionCount=state.recordCorrections?.length||0;
  const correctionRows=(state.recordCorrections||[]).map(c=>{
    const changed=Object.entries(c.after||{}).filter(([key,value])=>key!=='id'&&JSON.stringify(value)!==JSON.stringify(c.before?.[key])).map(([key,value])=>`${key}: ${JSON.stringify(c.before?.[key]??'')} → ${JSON.stringify(value)}`).join('; ');
    return `<li>${esc(c.at?.slice(0,10)||'Date unknown')} · ${esc(c.collection)} · ${esc(c.id)}: ${esc(changed||'No field differences')}</li>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(p.fullName||p.name)} Care Snapshot</title><style>body{font-family:Arial,sans-serif;max-width:1000px;margin:24px auto;padding:0 18px;color:#17201d;line-height:1.4}h1{margin-bottom:4px}h2{margin:20px 0 7px;border-bottom:1px solid #ddd;padding-bottom:5px}p{margin:7px 0}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border-bottom:1px solid #ddd;padding:7px;text-align:left;vertical-align:top}li{margin:4px 0}.note{background:#f3f6f5;padding:12px;border-radius:8px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.snapshot-item{border:1px solid #ddd;border-radius:9px;padding:10px}.snapshot-item strong{display:block;margin-bottom:4px}.small{font-size:12px;color:#555}.snapshot{border:2px solid #d9d1e8;border-radius:12px;padding:16px}@media print{body{margin:0;padding:0;font-size:11px}.snapshot{border:0;padding:0;break-after:page}.grid{gap:8px}h2{margin-top:13px}li{margin:2px 0}tr{break-inside:avoid}}</style></head><body>
  <section class="snapshot"><h1>${esc(p.fullName||p.name)} · Care Snapshot</h1><p><strong>${esc(snapshot.range.label)}:</strong> ${fmtDate(snapshot.start)}${snapshot.end!==snapshot.start?`–${fmtDate(snapshot.end)}`:''} · ${esc(snapshot.range.context)} · Prepared ${new Date().toLocaleDateString('en-US')}</p><p><strong>KSU:</strong> ${esc(p.patientIds?.ksu||'Not recorded')} · <strong>Optimum:</strong> ${esc(p.patientIds?.optimum||'Not recorded')} · ${esc(p.breed)} · DOB ${fmtDate(p.dob)}</p>
  <p class="note"><strong>Diagnosis:</strong> ${esc(p.diagnosis)}<br><strong>Status:</strong> ${esc(p.currentStatus)}</p>
  <h2>How has ${esc(p.name)} been doing?</h2><div class="note"><strong>Key observations</strong>${careSnapshotNarrative(snapshot).map(paragraph=>`<p>${esc(paragraph)}</p>`).join('')}</div><h2>Structured detail</h2><div class="grid"><div class="snapshot-item"><strong>Appetite</strong>${esc(snapshot.appetiteText)}</div><div class="snapshot-item"><strong>Energy</strong>${esc(snapshot.energyText)}</div><div class="snapshot-item"><strong>Nausea-associated observations</strong>${esc(snapshot.nauseaText)}</div><div class="snapshot-item"><strong>GI / stool</strong>${esc(snapshot.stoolText)}</div><div class="snapshot-item"><strong>Vomiting</strong>${esc(snapshot.vomitingText)}</div><div class="snapshot-item"><strong>Weight</strong>${esc(snapshot.weightText)}</div></div>
  <h2>Treatment & medication context</h2><p>${esc(snapshot.clinicalText)}</p><p>${esc(snapshot.medicationText)}</p>
  <h2>Questions for care team</h2><ul>${questionRows||'<li>No open owner questions recorded.</li>'}</ul>
  <h2>Upcoming care</h2><ul>${visits}</ul><p><strong>When to call the vet:</strong> ${esc(plan.vetCallInstructions||'Vet-specific instructions pending.')}${plan.vetCallSource?` (${esc(plan.vetCallSource)})`:''}</p>
  <p class="small">Owner observations are reported separately from clinical records. Missing or unlogged days remain unknown. This Care Snapshot supports discussion with the veterinary team and does not diagnose cause.</p></section>
  <h2>Medication courses</h2><table><thead><tr><th>Medication</th><th>Reported dates</th><th>Dose / frequency</th><th>Basis</th></tr></thead><tbody>${courseRows}</tbody></table>
  <h2>PRN / visit medications</h2><table><thead><tr><th>Medication</th><th>Logged use</th><th>Last given</th><th>Prescription on file</th></tr></thead><tbody>${prnRows}</tbody></table>
  <h2>Clinical course</h2><table><thead><tr><th>Date</th><th>Treatment</th><th>Dose</th><th>mg/m²</th><th>Weight</th><th>Dose context</th></tr></thead><tbody>${rows}</tbody></table>
  <h2>Selected labs</h2><table><thead><tr><th>Date</th><th>Metric</th><th>Result</th><th>Context</th><th>Source</th></tr></thead><tbody>${labs}</tbody></table>
  <h2>Owner-observed course</h2><table><thead><tr><th>Date</th><th>Structured observation</th><th>Medication noted</th><th>Original / corrected note</th></tr></thead><tbody>${obsRows}</tbody></table>
  <h2>Document index</h2><ul>${docs||'<li>No source files uploaded to this device.</li>'}</ul><p class="small">The document index lists on-device files; this HTML summary does not attach them. ${correctionCount} owner correction${correctionCount===1?'':'s'} recorded in the app history.</p>
  <h2>Owner corrections</h2><ul>${correctionRows||'<li>No corrections recorded.</li>'}</ul>
  <h2>Record checks</h2><ul><li>Verify the duplicate vinblastine billing lines on the 10/2 K-State invoice; clinical note states 2.0 mg total.</li><li>Reconcile the 7/14 Optimum surgery/dental invoice when received.</li><li>Amoxicillin dose and frequency remain unrecorded.</li></ul>
  <h2>Family financial burden</h2><p><strong>${money(totalPaid())}</strong> documented care costs to date (${money(confirmedPaid())} confirmed; ${money(provisionalPaid())} provisional/unresolved). Bank and payment-account details are excluded.</p>
  <p class="small">Clinical, lab, and pathology facts remain attributed to their sources. Owner observations are labeled separately. Corrections are retained in the app backup.</p></body></html>`;
}

function toast(message,isError=false){
  const node=q('#toastTemplate').content.firstElementChild.cloneNode(true);node.textContent=message;if(isError)node.classList.add('error');q('#toastRegion').appendChild(node);setTimeout(()=>node.remove(),2800);
}

document.addEventListener('DOMContentLoaded',boot);
