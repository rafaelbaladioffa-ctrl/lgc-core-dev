type LocalDate = { year:number;month:number;day:number };
const formatters = new Map<string,Intl.DateTimeFormat>();
function parts(date:Date,zone:string) {
 let formatter=formatters.get(zone);if(!formatter){formatter=new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});formatters.set(zone,formatter);}
 const p=Object.fromEntries(formatter.formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
 return {year:p.year,month:p.month,day:p.day,hour:p.hour,minute:p.minute,second:p.second};
}
function localInstant(date:LocalDate,hour:number,zone:string) {
 const target=Date.UTC(date.year,date.month-1,date.day,hour);let instant=target;
 // IANA conversion at business-window boundaries (outside DST transition hours).
 for(let i=0;i<4;i++){const p=parts(new Date(instant),zone);const represented=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);const delta=target-represented;if(!delta)break;instant+=delta;}
 return new Date(instant);
}
function next(date:LocalDate):LocalDate{const d=new Date(Date.UTC(date.year,date.month-1,date.day+1));return{year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:d.getUTCDate()};}
function workday(date:LocalDate,holidays:Set<string>){const weekday=new Date(Date.UTC(date.year,date.month-1,date.day)).getUTCDay();return weekday!==0&&weekday!==6&&!holidays.has(`${date.year}-${String(date.month).padStart(2,'0')}-${String(date.day).padStart(2,'0')}`);}
export function addBusinessMinutes(start:Date,minutes:number,holidays:string[]=[],zone='America/Sao_Paulo') {
 let date:LocalDate=parts(start,zone);let instant=new Date(start);let remaining=Math.max(0,minutes*60);const excluded=new Set(holidays);
 while(remaining>0){
  if(workday(date,excluded)){const open=localInstant(date,8,zone),close=localInstant(date,18,zone);if(instant<open)instant=open;const available=Math.max(0,(close.getTime()-instant.getTime())/1000);if(remaining<=available)return new Date(instant.getTime()+remaining*1000);remaining-=available;}
  date=next(date);instant=localInstant(date,8,zone);
 }
 return instant;
}
export function businessSecondsBetween(start:Date,end:Date,holidays:string[]=[],zone='America/Sao_Paulo') {
 if(end<=start)return 0;let date:LocalDate=parts(start,zone);let total=0;const excluded=new Set(holidays);
 while(localInstant(date,8,zone)<end){if(workday(date,excluded)){const open=localInstant(date,8,zone).getTime(),close=localInstant(date,18,zone).getTime();total+=Math.max(0,Math.min(end.getTime(),close)-Math.max(start.getTime(),open))/1000;}date=next(date);}
 return Math.floor(total);
}
