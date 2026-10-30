export function dayKey(value,zone){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value)).map(p=>[p.type,p.value]));
 return `${parts.year}-${parts.month}-${parts.day}`;
}
export function moveMonth(month,offset){const [year,m]=month.split('-').map(Number);return new Date(Date.UTC(year,m-1+offset,1)).toISOString().slice(0,7);}
export function calendarDays(month){
 const [year,m]=month.split('-').map(Number),first=new Date(Date.UTC(year,m-1,1)),offset=(first.getUTCDay()+6)%7;
 return Array.from({length:42},(_,i)=>new Date(Date.UTC(year,m-1,1-offset+i)).toISOString().slice(0,10));
}
export function groupMatches(matches,zone){const grouped={};for(const m of [...matches].sort((a,b)=>a.starts_at.localeCompare(b.starts_at))){const key=dayKey(m.starts_at,zone);(grouped[key]??=[]).push(m);}return grouped;}
