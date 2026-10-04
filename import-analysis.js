/* Deterministic proposals only. Nothing in this module writes to Roger's record. */
(function(root){
  'use strict';
  const dateFromText=text=>{
    const long=text.match(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(20\d{2})/i);
    if(long){const month=['january','february','march','april','may','june','july','august','september','october','november','december'].indexOf(long[1].toLowerCase())+1;return `${long[3]}-${String(month).padStart(2,'0')}-${long[2].padStart(2,'0')}`;}
    const short=text.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2}|\d{2})\b/);
    return short?`${short[3].length===2?'20'+short[3]:short[3]}-${short[1].padStart(2,'0')}-${short[2].padStart(2,'0')}`:null;
  };
  const num=value=>Number(String(value).replace(/,/g,''));
  function analyze(text,kind,filename=''){
    const normalized=String(text||'').replace(/[\u00a0\u202f]/g,' ').replace(/²/g,'2');
    const isLab=kind==='lab',isOptimum=kind==='optimumInvoice';
    if(!/ROGER\s+OBERLE/i.test(normalized)||!(isLab||isOptimum?/PATIENT ID:\s*20618/i.test(normalized):/CA264F93/i.test(normalized)))throw Error('This file does not clearly identify Roger and his patient ID. No changes were made.');
    const resultDate=isLab?normalized.match(/DATE OF RESULT:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i):null;
    const optimumDate=isOptimum?normalized.match(/Invoice Date:\s*(\d{1,2})-([A-Za-z]{3})\s+(20\d{2})/i):null;
    const optimumIso=optimumDate?`${optimumDate[3]}-${String(['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(optimumDate[2].toLowerCase())+1).padStart(2,'0')}-${optimumDate[1].padStart(2,'0')}`:null;
    const date=optimumIso||dateFromText(resultDate?resultDate[1]:normalized);
    if(!date)throw Error('The visit date could not be read. No changes were made.');
    if(isOptimum){
      const invoice=normalized.match(/Invoice Number:\s*(\d+)/i);
      const due=normalized.match(/AMOUNT\s+DUE\s*\$?\s*([\d,]+\.\d{2})/i);
      const balance=normalized.match(/INVOICE\s+BALANCE\s*\$?\s*([\d,]+\.\d{2})/i);
      if(!invoice||!due||!balance||Math.abs(num(due[1])-num(balance[1]))>.005)throw Error('Optimum invoice number and final amount could not be reconciled. No changes were made.');
      const category=/\bCBC\b|Chem\s*10|Blood Draw/i.test(normalized)?'monitoring':'other';
      return {kind,date,invoiceNumber:invoice[1],amountPaid:num(due[1]),category,paymentUnconfirmed:true,filename,evidence:`Invoice #${invoice[1]} · Amount due $${due[1]} · Invoice balance $${balance[1]}`};
    }
    if(isLab){
      const values={};
      for(const metric of ['Neutrophils','Hematocrit','Platelets']){
        const line=normalized.split('\n').find(x=>new RegExp(`^\\s*${metric}\\s+\\d`, 'i').test(x));
        const number=line?.match(new RegExp(`^\\s*${metric}\\s+([\\d,.]+)`, 'i'));
        if(!number)throw Error(`${metric} could not be read from the current-result column. No changes were made.`);
        values[metric]=num(number[1]);
      }
      return {kind,date,values,filename,evidence:`Current results: neutrophils ${values.Neutrophils} K/µL · hematocrit ${values.Hematocrit}% · platelets ${values.Platelets} K/µL`};
    }
    if(kind==='summary'){
      const section=normalized.split(/Treatments Performed/i)[1]?.split(/Potential side effects|Medications|Diagnostics/i)[0]||'';
      const dose=section.match(/Vinblastine\s*\(\s*(\d+(?:\.\d+)?)\s*mg\s*;\s*(\d+(?:\.\d+)?)\s*mg\s*\/\s*m2\s*\)/i);
      const ordinal=section.match(/treatment\s*#\s*(\d+)\s*of\s*8/i)||normalized.match(/vinblastine treatment\s*#\s*(\d+)\s*\/\s*8/i);
      if(!dose||!ordinal)throw Error('The administered dose or treatment number is unclear. No changes were made.');
      if(num(ordinal[1])<1||num(ordinal[1])>8)throw Error('The treatment number is outside Roger’s 8-dose course. No changes were made.');
      const weight=normalized.match(/weighed\s*\d+(?:\.\d+)?\s*kg\s*\(\s*(\d+(?:\.\d+)?)\s*lb\s*\)/i);
      return {kind,date,number:num(ordinal[1]),doseMg:num(dose[1]),doseMgM2:num(dose[2]),weightLb:weight?num(weight[1]):null,filename,evidence:dose[0]};
    }
    if(kind==='invoice'){
      const invoice=normalized.match(/Invoice\s*#\s*(\d+)/i);
      const paid=normalized.match(/(?:Payments Total|Payments)\s*:?\s*\$\s*([\d,]+\.\d{2})/i);
      const total=normalized.match(/\bTotal\s*\$\s*([\d,]+\.\d{2})/i);
      if(!invoice||!paid||!total||Math.abs(num(paid[1])-num(total[1]))>.005)throw Error('Invoice number, total, or payment could not be reconciled. No changes were made.');
      const cerenia=normalized.match(/Cerenia\s*60\s*mg[^\n]*?\b(\d+)\s*tab[^\n]*?\$\s*([\d,]+\.\d{2})\s*(?:LG\d+\s*)?\$\s*([\d,]+\.\d{2})/i);
      return {kind,date,invoiceNumber:invoice[1],amountPaid:num(paid[1]),cereniaQuantity:cerenia?num(cerenia[1]):null,cereniaPaid:cerenia?num(cerenia[3]):null,filename,evidence:`Invoice #${invoice[1]} · Total $${total[1]} · Payments $${paid[1]}`};
    }
    throw Error('Select K-State patient summary or invoice. No changes were made.');
  }
  const api={analyze,dateFromText};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.RogerImport=api;
})(typeof window!=='undefined'?window:globalThis);
