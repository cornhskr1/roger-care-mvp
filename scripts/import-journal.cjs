const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'data/journal-original.txt'), 'utf8');
const seedPath = path.join(root, 'data/seed.json');
const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

const matches = [...source.matchAll(/^([0-9]{1,2})\/([0-9]{1,2})\t/gm)];
const value = (text, key) => text.match(new RegExp(`^${key}: (.*)$`, 'mi'))?.[1]?.trim() || '';
const score = text => {
  const found = text.match(/\b([1-8])(?:\s*[-–]\s*([1-8]))?\b/);
  return found ? Number(found[2] || found[1]) : null;
};
function stools(text, date) {
  const events=[];
  const parts=text.split('|');
  for (const part of parts) {
    const period=part.match(/^\s*(AM|PM|Before [Bb]ed)\s*-/)?.[1] || (part.includes('No AM stool') ? 'AM' : 'Unspecified');
    const description=part.trim();
    const status=/did not observe|\bPM\s*-\s*$|\bBefore Bed\s*-\s*$/.test(description) ? 'not observed' : /No AM stool/.test(description) ? 'none' : 'observed';
    if (date==='2026-08-15' && period==='PM') {
      events.push({period:'PM',score:4,status:'observed',notes:'First log was normal (4)'});
      events.push({period:'PM',score:5,status:'observed',notes:'followed by soft stool (5)'});
    } else if(date==='2026-09-29' && period==='AM') {
      events.push({period:'AM',score:4,status:'observed',notes:'AM - 4'});
      events.push({period:'AM',score:3,status:'observed',notes:'then 3'});
    } else if(date==='2026-09-29' && period==='PM') {
      events.push({period:'PM',score:4,status:'observed',notes:'PM - 4'});
      events.push({period:'PM',score:4,status:'observed',notes:'then another 4'});
    } else {
      const count=description.includes('(x2)') ? 2 : 1;
      for(let i=0;i<count;i++)events.push({period,score:status==='observed'?score(description):null,status,notes:description});
    }
  }
  if(date==='2026-09-24')events.unshift({period:'Overnight',score:7,status:'observed',notes:'Diarrhea with blood at 1am, from Notes field'});
  if(date==='2026-09-29')events.push({period:'Time unrecorded',score:null,status:'observed',notes:'Six stools total in Notes field; five scores itemized above'});
  return events;
}

const observations=matches.map((match,i)=>{
  const date=`2026-${match[1].padStart(2,'0')}-${match[2].padStart(2,'0')}`;
  const rawEntry=source.slice(match.index, matches[i+1]?.index ?? source.length).trimEnd();
  const header=rawEntry.split('\n')[0];
  const rawStool=value(rawEntry,'Stool');
  const gi=value(rawEntry,'GI');
  const medications=value(rawEntry,'Medications').split(/\s*[,/&]\s*|\s+&\s+/).map(s=>s.trim()).filter(Boolean);
  const nausea=/nausea signs|lip licking|repeated swallowing|drooling|borborygmi/i.test(gi) ? 1 : /no nausea/i.test(gi) ? 0 : null;
  const vomiting=/no vomiting/i.test(gi) ? 0 : null;
  const weight=header.match(/\b(\d+(?:\.\d+)?)lbs\b/i);
  const stoolEvents=stools(rawStool,date);
  return {
    id:`obs-${match[1].padStart(2,'0')}${match[2].padStart(2,'0')}`,date,
    appetite:value(rawEntry,'Appetite') || header.match(/Appetite: (.*)$/)?.[1]?.trim() || '',
    hydration:value(rawEntry,'Water'),energy:value(rawEntry,'Energy'),mood:value(rawEntry,'Mood/Behavior'),
    gi, nausea,vomiting,stool:rawStool,stoolEvents,
    play:value(rawEntry,'Play/Engagement'),sleep:value(rawEntry,'Sleep'),rogerThings:value(rawEntry,'Roger Things'),
    urination:date==='2026-09-23'?'peed in house':'',pain:null,
    medications,weightLb:weight?Number(weight[1]):null,
    notes:value(rawEntry,'Notes'),rawEntry,source:'owner journal supplied 10/3/2026'
  };
});

if(observations.length!==51 || observations[0].date!=='2026-08-14' || observations.at(-1).date!=='2026-10-03')throw Error('Journal date coverage unexpected');
for(let i=1;i<observations.length;i++){
  const prev=new Date(`${observations[i-1].date}T12:00:00Z`);prev.setUTCDate(prev.getUTCDate()+1);
  if(observations[i].date!==prev.toISOString().slice(0,10))throw Error(`Missing day before ${observations[i].date}`);
}
seed.observations=observations;
seed.journalCoverageThrough='2026-10-03';
seed.schemaVersion=8;
fs.writeFileSync(seedPath, JSON.stringify(seed,null,2)+'\n');
console.log(`Imported ${observations.length} complete daily source entries, ${observations.flatMap(o=>o.stoolEvents).length} bowel records.`);
