/* Complete treatment handoff: pure, read-only, dependency-free and printable.
 * The report is an inventory of saved records, not a claim that every event was logged.
 * Browser: RogerHandoff.buildModel(state, documents, options), renderHtml(model).
 * CommonJS: require('./handoff-report.js'). The model never references input objects.
 */
(function(root){
  'use strict';

  const own=(value,key)=>value!==null&&typeof value==='object'&&Object.prototype.hasOwnProperty.call(value,key);
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const esc=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const numeric=value=>typeof value==='number'&&Number.isFinite(value);
  const definitions=[
    ['treatments','Treatment records','treatments'],
    ['labs','All laboratory results','labs'],
    ['medications','Prescriptions and medication reference','prescriptions'],
    ['prescriptions','Additional prescription records','additional-prescriptions'],
    ['medicationCourses','Reported medication courses','courses'],
    ['medicationAdministrations','Individual medication administrations','administrations'],
    ['observations','Daily journal and original observations','journal'],
    ['journalEntries','Additional journal entries','additional-journal'],
    ['qualityOfLife','Quality-of-life check-ins','quality-of-life'],
    ['milestones','Clinical milestones','milestones'],
    ['sourceNotes','Source notes','source-notes'],
    ['recordCorrections','Correction history','corrections'],
    ['importHistory','Reviewed import history','imports'],
    ['documents','Browser document index','documents'],
    ['costs','Financial cost ledger','costs'],
    ['medicationPurchases','Medication purchase allocations','purchases']
  ];
  const optionalCollections=new Set(['prescriptions','journalEntries']);
  const financialCollections=new Set(['costs','medicationPurchases']);

  function clone(value,seen=new WeakMap()){
    if(value===null||typeof value!=='object')return value;
    if(seen.has(value))return seen.get(value);
    if(value instanceof Date)return new Date(value.getTime());
    const result=Array.isArray(value)?new Array(value.length):{};
    seen.set(value,result);
    for(const key of Object.keys(value))Object.defineProperty(result,key,{value:clone(value[key],seen),enumerable:true,writable:true,configurable:true});
    return result;
  }
  function isBinary(value){
    return (typeof Blob!=='undefined'&&value instanceof Blob)||(typeof ArrayBuffer!=='undefined'&&(value instanceof ArrayBuffer||ArrayBuffer.isView(value)));
  }
  function withoutPayloads(value,mode,seen=new WeakMap()){
    if(value===null||typeof value!=='object')return value;
    if(seen.has(value))return seen.get(value);
    if(value instanceof Date)return new Date(value.getTime());
    const result=Array.isArray(value)?[]:{};
    seen.set(value,result);
    for(const key of Object.keys(value)){
      const item=value[key],lower=key.toLowerCase(),compact=lower.replace(/[^a-z0-9]/g,'');
      const credential=/^(?:(?:access|refresh|id|auth|session)?token|password|passwd|secret|clientsecret|apikey|authorization|authentication|auth|session|credentials|cookie|cookies|privatekey|recoverycode)$/.test(compact);
      const payload=mode==='documents'?['file','blob','dataurl'].includes(lower):['photodataurl','photoblob','photofile','photobinary','photodata'].includes(lower)||(lower==='photo'&&(isBinary(item)||typeof item==='string'&&/^(?:data:|blob:)/i.test(item)));
      if(payload||credential||isBinary(item))continue;
      Object.defineProperty(result,key,{value:withoutPayloads(item,mode,seen),enumerable:true,writable:true,configurable:true});
    }
    return result;
  }
  function collectionStatus(value,present){
    return !present?'not recorded':value===null?'null':Array.isArray(value)?value.length?'recorded':'empty array':'recorded non-array value';
  }
  function wrap(value,name,filter){
    const values=Array.isArray(value)?value:value===undefined?[]:[value];
    return values.map((data,index)=>({key:`${name}-${index}`,originalIndex:index,id:own(data,'id')?clone(data.id):null,data:clone(data)})).filter(row=>!filter||filter(row.data));
  }
  function isoDay(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}(?:$|T|\s)/.test(value))return null;
    const day=value.slice(0,10),parsed=new Date(day+'T00:00:00Z');
    return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===day?day:null;
  }
  function span(values){
    const dates=values.map(isoDay).filter(Boolean).sort();
    return {start:dates[0]||null,end:dates.at(-1)||null,datedRecordCount:dates.length,undatedRecordCount:values.length-dates.length};
  }
  function recordValue(row,key){return object(row?.data)&&own(row.data,key)?row.data[key]:undefined;}
  function weightsFrom(records){
    const weights=[];
    for(const collection of ['treatments','observations','journalEntries'])for(const record of records[collection]||[]){
      if(!object(record.data))continue;
      const visit=(value,path,parents)=>{
        if(value===null||typeof value!=='object'||parents.has(value))return;
        const next=new Set(parents);next.add(value);
        for(const key of Object.keys(value)){
          const child=value[key],field=path?`${path}.${key}`:key;
          // Structured values only. Blank/null fields remain in the original record,
          // but are not presented as measurements. No prose parsing or conversions.
          if(/^(?:(?:body|current)?weight(?:lb|lbs|kg|kgs|oz|g)?|weightHistory|weights)$/i.test(key)){
            const add=(measurement,measurementField)=>{
              if(measurement===null||measurement===undefined||typeof measurement==='string'&&!measurement.trim())return;
              if(object(measurement)&&own(measurement,'value')&&(measurement.value===null||measurement.value===undefined||typeof measurement.value==='string'&&!measurement.value.trim()))return;
              const context=object(measurement)?measurement:value;
              const date=own(context,'date')?context.date:own(value,'date')?value.date:record.data.date;
              const source=own(context,'source')?context.source:own(value,'source')?value.source:record.data.source;
              const unit=/weight(?:lb|lbs)$/i.test(key)?'lb':/weight(?:kg|kgs)$/i.test(key)?'kg':/weightoz$/i.test(key)?'oz':/weightg$/i.test(key)?'g':own(context,'unit')?context.unit:own(context,'weightUnit')?context.weightUnit:own(value,'weightUnit')?value.weightUnit:own(value,'unit')?value.unit:null;
              weights.push({key:`weight-${weights.length}`,collection,recordKey:record.key,originalIndex:record.originalIndex,id:clone(record.id),date:clone(date),field:measurementField,value:clone(measurement),unit:clone(unit),source:clone(source),weightSource:own(context,'weightSource')?clone(context.weightSource):own(value,'weightSource')?clone(value.weightSource):undefined});
            };
            if(Array.isArray(child))child.forEach((measurement,index)=>add(measurement,`${field}[${index}]`));
            else add(child,field);
          }else if(child!==null&&typeof child==='object')visit(child,field,next);
        }
      };
      visit(record.data,'',new Set());
    }
    // Chronological derived view only. Original collection order is untouched.
    return weights.sort((a,b)=>{const left=isoDay(a.date),right=isoDay(b.date);return left&&right?left.localeCompare(right):left?-1:right?1:0;});
  }
  function financialSummary(costs,purchases){
    let total=0,numericAmountCount=0,unknownAmountCount=0;
    const statuses=new Map(),issues=[],allocations=[];
    for(const row of costs){
      const amount=recordValue(row,'amountPaid'),status=recordValue(row,'status');
      if(!statuses.has(status))statuses.set(status,{status:clone(status),count:0,numericAmountCount:0,unknownAmountCount:0,totalAmountPaid:null});
      const bucket=statuses.get(status);bucket.count++;
      if(numeric(amount)){total+=amount;numericAmountCount++;bucket.numericAmountCount++;bucket.totalAmountPaid=(bucket.totalAmountPaid??0)+amount;}
      else{unknownAmountCount++;bucket.unknownAmountCount++;}
    }
    for(const row of purchases){
      const data=object(row.data)?row.data:{},hasLink=own(data,'linkedCostId')||own(data,'costId');
      const linkedCostId=own(data,'linkedCostId')?data.linkedCostId:data.costId;
      const matches=hasLink&&linkedCostId!==null&&linkedCostId!==''?costs.filter(cost=>own(cost.data,'id')&&cost.data.id===linkedCostId):[];
      const entry={purchaseKey:row.key,purchaseId:clone(row.id),linkedCostId:clone(linkedCostId),linkedCostKeys:matches.map(match=>match.key),amountPaid:clone(data.amountPaid),status:clone(data.status),issues:[]};
      if(!hasLink||linkedCostId===null||linkedCostId==='')entry.issues.push('Unlinked purchase: not included in the cost-ledger sum.');
      else if(!matches.length)entry.issues.push('Linked cost record not found.');
      else if(matches.length>1)entry.issues.push('Ambiguous allocation: multiple cost records have this ID.');
      if(own(data,'linkedCostId')&&own(data,'costId')&&data.linkedCostId!==data.costId)entry.issues.push('Inconsistent costId and linkedCostId references.');
      if(!numeric(data.amountPaid))entry.issues.push('Purchase amount is unknown or not a finite recorded number.');
      if(numeric(data.amountPaid)&&data.amountPaid<0)entry.issues.push('Negative purchase allocation: review the original record.');
      if(matches.length===1&&!numeric(recordValue(matches[0],'amountPaid')))entry.issues.push('Linked cost amount is unknown; allocation cannot be reconciled.');
      allocations.push(entry);
    }
    for(const cost of costs){
      const linked=allocations.filter(entry=>entry.linkedCostKeys.length===1&&entry.linkedCostKeys[0]===cost.key);
      const amount=recordValue(cost,'amountPaid'),allocated=linked.reduce((sum,entry)=>sum+(numeric(entry.amountPaid)?entry.amountPaid:0),0);
      if(numeric(amount)&&linked.length&&allocated>amount+.005){
        const message=`Allocations exceed the recorded cost amount for ${cost.key}.`;
        issues.push(message);for(const entry of linked)entry.issues.push(message);
      }
    }
    for(const entry of allocations)for(const issue of entry.issues)issues.push(`${entry.purchaseKey}: ${issue}`);
    const currencies=[...new Set(costs.map(row=>recordValue(row,'currency')).filter(value=>typeof value==='string'&&value.trim()))];
    if(currencies.length>1)issues.push('Multiple recorded currencies: the arithmetic sum is not a converted or comparable monetary total.');
    return {totalAmountPaid:numericAmountCount?total:null,numericAmountCount,unknownAmountCount,byStatus:[...statuses.values()],allocations,issues,currencies};
  }

  function buildModel(state,documents,options={}){
    state=object(state)?state:{};options=object(options)?options:{};
    const includeFinancialLedgers=options.includeFinancialLedgers===true;
    const status=['available','loading','unavailable','unverified'].includes(options.documentIndexStatus)?options.documentIndexStatus:Array.isArray(documents)?'available':'unavailable';
    const records={},collectionStates={},omitted={financialCorrections:0,financialImports:0};
    for(const [name] of definitions){
      if(financialCollections.has(name)&&!includeFinancialLedgers)continue;
      if(optionalCollections.has(name)&&!own(state,name))continue;
      let input=name==='documents'?documents:state[name];
      const present=name==='documents'?Array.isArray(documents):own(state,name);
      if(name==='documents')input=Array.isArray(documents)?documents.map(value=>withoutPayloads(value,'documents')):[];
      collectionStates[name]=collectionStatus(input,present);
      records[name]=wrap(input,name,data=>{
        if(includeFinancialLedgers||!object(data))return true;
        if(name==='recordCorrections'&&financialCollections.has(data.collection)){omitted.financialCorrections++;return false;}
        if(name==='importHistory'&&(/^invoice:/i.test(String(data.key??''))||/^(?:invoice|optimumInvoice)$/i.test(String(data.kind??'')))){omitted.financialImports++;return false;}
        return true;
      });
    }
    const profile=own(state,'profile')?withoutPayloads(state.profile,'profile'):undefined;
    const carePlan=own(state,'carePlan')?clone(state.carePlan):undefined;
    const clinicalNames=['treatments','labs','observations','journalEntries','medicationAdministrations','qualityOfLife','milestones'];
    const clinicalRows=clinicalNames.flatMap(name=>records[name]||[]);
    const visits=object(carePlan)&&Array.isArray(carePlan.visits)?carePlan.visits:[];
    const counts=Object.fromEntries(Object.entries(records).map(([name,rows])=>[name,rows.length]));
    const metadata={
      generatedAt:options.generatedAt===undefined?new Date().toISOString():clone(options.generatedAt),
      recordSavedAt:own(options,'recordSavedAt')?clone(options.recordSavedAt):own(options,'_savedAt')?clone(options._savedAt):clone(state._savedAt),
      sharedUpdatedAt:own(options,'sharedUpdatedAt')?clone(options.sharedUpdatedAt):undefined,
      unpublishedLocal:options.unpublishedLocal===true,
      documentIndexStatus:status,includeFinancialLedgers,
      schemaVersion:clone(state.schemaVersion),journalCoverageThrough:clone(state.journalCoverageThrough)
    };
    return {version:1,title:'Complete treatment report',metadata,profile,carePlan,records,collectionStates,counts,omitted,
      clinicalDateSpan:span(clinicalRows.map(row=>recordValue(row,'date'))),scheduledDateSpan:span(visits.map(visit=>object(visit)?visit.date:undefined)),
      weights:weightsFrom(records),financial:includeFinancialLedgers?financialSummary(records.costs,records.medicationPurchases):null};
  }

  function label(key){
    const labels={id:'Record ID',rawEntry:'Original journal wording',recordClarification:'Record clarification',stoolEvents:'Stool events',clinicalSummary:'Clinical summary',recordCheck:'Saved record check',amountPaid:'Recorded amount paid',doseMg:'Dose (mg)',doseMgM2:'Dose (mg/m²)',weightLb:'Weight (lb)',weightKg:'Weight (kg)',_savedAt:'Record saved at',vetCallInstructions:'Veterinary call instructions',vetCallSource:'Instruction source',careTeam:'Care team',qualityOfLife:'Quality of life',sourceNotes:'Source notes',linkedCostId:'Linked cost ID',costId:'Linked cost ID'};
    return labels[key]||String(key).replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/[_-]/g,' ').replace(/^./,char=>char.toUpperCase());
  }
  function scalar(value){
    if(value===undefined)return '<span class="unknown">Not recorded (missing)</span>';
    if(value===null)return '<span class="unknown">Not recorded (null)</span>';
    if(value==='')return '<span class="unknown">Empty text (recorded blank)</span>';
    if(typeof value==='boolean')return esc(value?'true':'false');
    if(value instanceof Date)return esc(Number.isFinite(value.getTime())?value.toISOString():'Invalid date');
    return esc(value);
  }
  function readable(value,parents=new Set()){
    if(value===null||typeof value!=='object'||value instanceof Date)return `<span class="value">${scalar(value)}</span>`;
    if(parents.has(value))return '<span class="unknown">Circular reference</span>';
    const next=new Set(parents);next.add(value);
    if(Array.isArray(value))return value.length?`<ol class="field-list">${Array.from({length:value.length},(_,index)=>`<li><span class="item-number">Item ${index+1}</span>${readable(value[index],next)}</li>`).join('')}</ol>`:'<span class="unknown">Empty list (0 items)</span>';
    const keys=Object.keys(value);
    if(!keys.length)return '<span class="unknown">Empty object (0 fields)</span>';
    return `<dl class="fields">${keys.map(key=>`<div class="field"><dt>${esc(label(key))}<small class="field-key">${esc(key)}</small></dt><dd>${readable(value[key],next)}</dd></div>`).join('')}</dl>`;
  }
  function selected(data,keys){
    if(!object(data))return readable(data);
    const found=keys.filter(key=>own(data,key));
    if(!found.length)return '<span class="unknown">See the full original record below.</span>';
    return `<dl class="ledger-fields">${found.map(key=>`<div><dt>${esc(label(key))}</dt><dd>${readable(data[key])}</dd></div>`).join('')}</dl>`;
  }
  function dateText(range){return range.start?`${esc(range.start)} to ${esc(range.end)}`:'No valid dated records';}
  function medicationLabel(model,data){
    if(!object(data))return 'Medication record';
    const matches=(model.records.medications||[]).filter(row=>object(row.data)&&own(data,'medicationId')&&row.data.id===data.medicationId);
    if(matches.length===1&&own(matches[0].data,'name'))return String(matches[0].data.name);
    return own(data,'medicationId')?String(data.medicationId):'Medication not recorded';
  }
  function heading(model,name,row){
    const data=object(row.data)?row.data:{};
    let title='Record';
    if(name==='treatments')title=own(data,'number')?`Treatment #${data.number}`:'Treatment';
    else if(name==='labs')title=own(data,'metric')?String(data.metric):'Laboratory result';
    else if(name==='medications'||name==='prescriptions')title=own(data,'name')?String(data.name):'Prescription / reference';
    else if(name==='medicationCourses'||name==='medicationAdministrations'||name==='medicationPurchases')title=medicationLabel(model,data);
    else if(name==='observations'||name==='journalEntries')title='Journal entry';
    else if(name==='qualityOfLife')title='Quality-of-life check-in';
    else if(name==='milestones')title=own(data,'title')?String(data.title):'Milestone';
    else if(name==='documents')title=own(data,'name')?String(data.name):'Document metadata';
    else if(name==='costs')title=own(data,'label')?String(data.label):'Cost record';
    else if(name==='recordCorrections')title=`Correction${own(data,'collection')?` · ${data.collection}`:''}`;
    else if(name==='importHistory')title=own(data,'key')?String(data.key):'Reviewed import';
    else if(name==='sourceNotes')title='Source note';
    const date=own(data,'date')?data.date:own(data,'startDate')?data.startDate:own(data,'at')?data.at:null;
    return `${esc(title)}${date!==null?` · ${scalar(date)}`:''}`;
  }
  function ledgerKeys(name){
    const common=['date','time','status','source'];
    const keys={
      treatments:['number','drug','medication','doseMg','doseMgM2','dose','doseReason','weightLb','weightKg'],
      labs:['metric','displayValue','value','unit','units','referenceRange','flag'],
      medications:['name','prescribedDose','dose','frequency','tabletStrengthMg','route','startDate','endDate'],
      prescriptions:['name','medicationId','prescribedDose','dose','frequency','route','startDate','endDate'],
      medicationCourses:['medicationId','startDate','endDate','confirmedThrough','dose','frequency','reason'],
      medicationAdministrations:['medicationId','dose','tabletQuantity','route','reason'],
      observations:['appetite','appetitePercent','energy','energyBaselineLevel','nausea','nauseaSigns','nauseaNoneObserved','vomiting','vomitFlags','vomitNoneObserved','stool','pain','weightLb','weightKg'],
      journalEntries:[],qualityOfLife:['score'],milestones:['title'],
      sourceNotes:['title'],recordCorrections:['collection','id','at'],importHistory:['key','filename','reviewedAt'],
      documents:['name','type','provider','size','lastModified'],costs:['provider','category','label','amountPaid','currency'],
      medicationPurchases:['medicationId','quantity','tabletStrengthMg','amountPaid','currency','costId','linkedCostId']
    };
    return [...new Set([...common,...(keys[name]||[])])];
  }
  function sectionIntro(name){
    const notes={
      treatments:'Every saved treatment record is listed. Saved clinical summaries, record checks and source fields are retained without adding new clinical conclusions.',
      labs:'All saved laboratory metrics are included, not just charted values. Display values and numeric values remain separate; units and source context are not converted.',
      medications:'Prescription instructions and medication reference information are not proof that a dose was administered.',
      prescriptions:'Additional saved prescriptions. These instructions are not proof that a dose was administered.',
      medicationCourses:'Reported courses are separate from individual dose logs. Original start/end dates, confirmation boundaries and statuses are unchanged. Prescribed days are not expanded into assumed administrations.',
      medicationAdministrations:'Each individually recorded administration is retained, including time, dose, status, reason and source. Held or other statuses are not relabeled as given. Times are shown as saved; no time zone is assumed unless recorded. A missing log does not establish that a dose was given or missed.',
      observations:'All saved journal entries appear below, with their complete original wording, stool events and additional fields. Missing observations remain unknown; they are not normal findings.',
      journalEntries:'Additional saved journal entries, without date filtering or deduplication.',
      recordCorrections:'Audit entries preserve the complete saved before and after values. They describe changes, not additional administrations or visits.',
      documents:'This index covers only files available in this browser. File contents are not attached to this report and are not provided by the shared read-only link. An empty available index is different from an unavailable or still-loading index.',
      costs:'Every included cost record retains its original status and components. The arithmetic sum uses finite numeric costs.amountPaid only, including all statuses; it is not a confirmed-payment total. Missing amounts are unknown, not zero.',
      medicationPurchases:'Purchases are separate allocations, not additional spending in the cost-ledger sum. Linked cost IDs and reconciliation issues appear below; no purchase is counted a second time.'
    };
    return notes[name]||'All saved entries and their original fields are retained, in original record order.';
  }
  function recordsSection(model,name,title,id){
    const rows=model.records[name]||[];
    let extra='';
    if(name==='documents')extra=`<p class="notice">Document index status: ${esc(model.metadata.documentIndexStatus)}. ${model.metadata.documentIndexStatus==='available'?`${rows.length} browser document metadata record(s) available.`:model.metadata.documentIndexStatus==='loading'?'Loading is incomplete; this is not evidence that there are no files.':model.metadata.documentIndexStatus==='unverified'?'The browser file index has not been verified; any supplied metadata may be incomplete. This is not evidence that there are no files.':'The browser file index could not be established; this is not evidence that there are no files.'}</p>`;
    if(name==='medicationPurchases'&&model.financial)extra+=model.financial.allocations.map(entry=>`<div class="allocation"><strong>Allocation for <a href="#${esc(entry.purchaseKey)}">${esc(entry.purchaseKey)}</a></strong>${selected(entry,['linkedCostId','linkedCostKeys','amountPaid','status'])}${entry.issues.length?`<ul>${entry.issues.map(issue=>`<li>${esc(issue)}</li>`).join('')}</ul>`:'<p>One matching cost record found. Purchase amounts are not added to the cost total.</p>'}</div>`).join('');
    return `<section class="appendix" id="${id}"><h2>${esc(title)} <span class="count">(${rows.length})</span></h2><p>${esc(sectionIntro(name))}</p>${extra}${rows.length?rows.map(row=>`<article class="record" id="${esc(row.key)}"><h3>${heading(model,name,row)}</h3><p class="record-reference">Original collection: ${esc(name)} · original index: ${row.originalIndex} (item ${row.originalIndex+1}) · record ID: ${scalar(row.id)}</p>${selected(row.data,ledgerKeys(name))}<h4>Full original record</h4>${readable(row.data)}</article>`).join(''):`<p class="empty">No entries supplied in this collection (${esc(model.collectionStates[name]||'not recorded')}). This does not establish that no real-life events occurred.</p>`}</section>`;
  }
  function weightSection(model){
    return `<section class="appendix" id="weights"><h2>Full sourced weight history <span class="count">(${model.weights.length})</span></h2><p>All nonblank structured weight values in treatment and journal records are shown, including same-day and differing readings. Null and blank weight fields remain in the original records below, not as measurements. Measurements are not averaged, merged, converted or extracted from prose. Additional narrative weight mentions remain in the original journal and treatment records.</p>${model.weights.length?model.weights.map(row=>`<article class="weight-record"><h3>${scalar(row.date)} · ${esc(row.field)}</h3><p>From <a href="#${esc(row.recordKey)}">${esc(row.collection)} item ${row.originalIndex+1}</a>; original index ${row.originalIndex} · record ID: ${scalar(row.id)}</p>${selected(row,['value','unit','source','weightSource'])}</article>`).join(''):'<p class="empty">No structured weight fields were recorded. This is not a zero weight or evidence that no weight was measured.</p>'}</section>`;
  }
  function financialOverview(model){
    if(!model.financial)return '<p>Financial ledgers are excluded. Cost and purchase records, their financial corrections and invoice-key imports are omitted. Original clinical/source notes, care-plan text and document metadata remain unchanged and may mention costs; this is not a financial redaction guarantee.</p>';
    const data=model.financial;
    return `<div class="notice"><h3>Financial ledger inclusion</h3><p>Recorded numeric amountPaid sum: <strong>${data.totalAmountPaid===null?'Unknown (no numeric amounts)':esc(data.totalAmountPaid.toFixed(2))}</strong>. ${data.numericAmountCount} numeric amount(s); ${data.unknownAmountCount} unknown/non-numeric amount(s). Currency is not inferred or converted. All original statuses remain separate. Medication purchase allocations are not added to this sum.</p><h4>By original status</h4><ul>${data.byStatus.map(item=>`<li>${scalar(item.status)}: ${item.count} record(s), ${item.numericAmountCount} numeric amount(s), ${item.unknownAmountCount} unknown amount(s); numeric sum ${item.totalAmountPaid===null?'unknown':esc(item.totalAmountPaid.toFixed(2))}.</li>`).join('')}</ul>${data.issues.length?`<h4>Allocation / accounting checks</h4><ul>${data.issues.map(issue=>`<li>${esc(issue)}</li>`).join('')}</ul>`:''}</div>`;
  }
  function renderHtml(model){
    if(!model||model.version!==1||!model.records)throw new Error('Build a complete treatment report model first.');
    const patient=object(model.profile)&&own(model.profile,'name')?String(model.profile.name):'Patient';
    const included=definitions.filter(([name])=>own(model.records,name));
    const counts=included.map(([name,title,id])=>`<li><a href="#${id}">${esc(title)}</a><strong>${model.counts[name]}</strong></li>`).join('');
    const metadata=selected(model.metadata,['generatedAt','recordSavedAt','sharedUpdatedAt','schemaVersion','journalCoverageThrough']);
    const sourceCounts=included.filter(([name])=>model.records[name].length&&!['documents','recordCorrections','importHistory','costs','medicationPurchases'].includes(name)).map(([name,title])=>({collection:title,records:model.records[name].length,withoutSource:model.records[name].filter(row=>{const source=recordValue(row,'source');return source===undefined||source===null||source==='';}).length}));
    const sourceTotal=sourceCounts.reduce((sum,item)=>sum+item.records,0),sourceMissing=sourceCounts.reduce((sum,item)=>sum+item.withoutSource,0);
    const sourceSummary=sourceTotal?`<p>${sourceMissing} of ${sourceTotal} clinical record(s) lack an explicit source field. Any other provenance fields are retained in the originals; a source label is attribution, not independent verification.</p>`:'<p>No clinical records supplied for source counts.</p>';
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${esc(patient)} · Complete treatment report</title><style>
      :root{color-scheme:light;font-family:Arial,Helvetica,sans-serif;color:#17212b;background:#f4f6f8;font-size:16px;line-height:1.5}*{box-sizing:border-box}body{margin:0}main{max-width:980px;margin:auto;padding:32px;background:#fff}h1{font-size:2rem;line-height:1.15;margin:.25em 0}h2{font-size:1.4rem;margin-top:1.5em;border-bottom:2px solid #b6c6d4;padding-bottom:.35em}h3{font-size:1.08rem;margin:1em 0 .4em}h4{font-size:1rem;margin:1em 0 .3em}p,li,dd,.value{overflow-wrap:anywhere;word-break:normal}p{margin:.6em 0}.kicker{letter-spacing:.08em;text-transform:uppercase;font-size:.78rem;color:#415a70}.subtitle{font-size:1.2rem}.notice{background:#f0f5f8;border-left:4px solid #54758f;padding:12px 16px;margin:18px 0}.unknown,.record-reference,.field-key{color:#53616c}.record-reference{font-size:.78rem}.count{font-size:.85em;font-weight:normal}.index{columns:2;padding-left:1.3em}.inventory{list-style:none;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px 22px}.inventory li{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid #dde5eb;padding:5px 0}.inventory strong{flex:none}a{color:#244e70;text-decoration:underline}.record,.weight-record,.allocation{padding:0 0 18px;margin:20px 0;border-bottom:1px solid #bfcbd4}.fields,.ledger-fields{margin:.4em 0}.field,.ledger-fields>div{display:grid;grid-template-columns:minmax(130px,23%) minmax(0,1fr);gap:8px 16px;border-bottom:1px solid #e7ecf0;padding:5px 0}dt{font-weight:bold;overflow-wrap:anywhere}dd{margin:0;min-width:0}.field-key{display:block;font-weight:normal;font-size:.7rem}.value{white-space:pre-wrap}.field-list{padding-left:22px;margin:3px 0}.field-list>li{padding:5px 0}.item-number{display:block;color:#53616c;font-size:.75rem}.fields .fields .field{display:block;border-left:2px solid #e0e6eb;padding-left:10px}.fields .fields dt{margin-bottom:3px}.empty{color:#53616c}.appendix{margin-top:3rem}.print-help{font-size:.88rem;color:#415a70}footer{border-top:1px solid #bfcbd4;margin-top:3rem;padding-top:1rem;font-size:.85rem}
      @media(max-width:600px){main{padding:18px 14px}h1{font-size:1.6rem}.index{columns:1}.inventory{grid-template-columns:1fr}.field,.ledger-fields>div{display:block}dt{margin-bottom:3px}.fields .fields .field{padding-left:8px}}
      @page{size:auto;margin:16mm 14mm}@media print{:root{font-size:10pt;background:#fff;color:#000}main{max-width:none;padding:0}a{color:inherit;text-decoration:none}.print-help{display:none}.appendix{break-before:page;page-break-before:always;margin-top:0}h1,h2,h3,h4,dt{break-after:avoid;page-break-after:avoid}.record,.weight-record,.allocation,.fields,.field,.field-list,.field-list>li,dd,.value,p{break-inside:auto;page-break-inside:auto}.notice{background:none;border:1px solid #8e9ba5}.inventory li{break-inside:avoid}p{orphans:2;widows:2}.field-key{color:#555}}
    </style></head><body><main><header><p class="kicker">All saved dates · Clinical handoff</p><h1>Complete treatment report</h1><p class="subtitle">${esc(patient)}</p><p class="print-help">For a PDF, use your browser’s Print → Save as PDF. All appendices are expanded; no interactive controls or network connection are required.</p></header><section id="overview"><h2>Overview and scope</h2><p>This report covers all recorded dates. The Care Snapshot period and chart filters do not limit it.</p><p>It shows what is saved in Roger Care, not proof that every visit, symptom or dose was logged. Original clinic documents should accompany it.</p><p><strong>Dated clinical record span:</strong> ${dateText(model.clinicalDateSpan)}. ${model.clinicalDateSpan.datedRecordCount} dated record(s); ${model.clinicalDateSpan.undatedRecordCount} record(s) without a valid date. This span uses treatment, lab, journal, administration, wellbeing and milestone dates, not prescriptions or scheduled visits.</p><p><strong>Scheduled care dates (separate):</strong> ${dateText(model.scheduledDateSpan)}. A scheduled visit is a plan, not confirmation that care occurred.</p>${metadata}<p class="notice">${model.metadata.unpublishedLocal?'Unpublished local changes were present when this report was generated. Shared-link readers may see an older record.':'This report uses the record loaded in this browser. A shared update time does not confirm that every local change or file is available through the shared link.'}</p><p>Unknown, null, empty, zero and false values remain distinct. Original entry order, IDs, sources and conflicting/same-day records are preserved; no duplicates are collapsed. Counts describe records, not unique events or administered doses.</p>${financialOverview(model)}<h3>Report index and record counts</h3><ul class="inventory"><li><a href="#profile">Patient profile</a><span>All saved fields</span></li>${counts}<li><a href="#weights">Structured weight values</a><strong>${model.weights.length}</strong></li><li><a href="#care-plan">Care plan, contacts and scheduled visits</a><span>All saved fields</span></li></ul><h3>Source availability</h3><p>Attribution is printed with each record. Records without a source are not treated as verified clinical findings.</p>${sourceSummary}</section><section class="appendix" id="profile"><h2>Patient profile</h2><p>Saved profile fields are retained; photo binary data is excluded.</p>${readable(model.profile)}</section>${included.map(([name,title,id])=>recordsSection(model,name,title,id)).join('')}${weightSection(model)}<section class="appendix" id="care-plan"><h2>Care plan, contacts and scheduled visits</h2><p>Full saved instructions, care-team contacts, all question statuses and visits follow. Visits listed here are scheduled plans, not evidence that an examination, test or treatment was performed. Dates and statuses are not rewritten based on today’s date.</p>${readable(model.carePlan)}</section><footer>Prepared from the supplied saved record. Original wording is retained, including uncertainty and contradictions. File attachments must be supplied separately. Missing records are unknown, not normal findings.</footer></main></body></html>`;
  }
  const api={buildModel,renderHtml};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.RogerHandoff=api;
})(typeof window!=='undefined'?window:globalThis);
