// Technical telemetry uses a closed vocabulary. Never persist raw errors, URLs,
// request bodies, headers, email addresses, user IDs or financial audit details.
export const HEALTH_EVENTS=['system.started','system.stopping','system.task_failed','system.request_failed','access.login','access.logout','access.code_requested','access.denied','access.limited','access.verification_failed','membership.submitted','membership.reviewed','member.role_changed','member.anonymized','settings.updated','venue.updated','match.updated','news.created','profile.updated','mail.sent','mail.retry','mail.failed','mail.cancelled','mail.budget_exhausted'];
const scopes=['system','access','membership','members','settings','venues','matches','news','profile','mail','health','other'];
const codes=['ok','unauthorized','forbidden','membership_required','rate_limited','invalid_code','invalid_origin','invalid_host','invalid_content_type','human_verification_required','human_verification_unavailable','google_auth_failed','google_auth_expired','google_account_conflict','google_not_configured','internal_error','email_network_error','mail_budget_exhausted','retry_limit','expired','recipient_unavailable'];
const auditEvents={'match.guests':'match.updated','membership.submit':'membership.submitted','membership.approved':'membership.reviewed','membership.rejected':'membership.reviewed','member.role':'member.role_changed','member.anonymize':'member.anonymized','settings.update':'settings.updated','venue.create':'venue.updated','venue.update':'venue.updated','venue.archive':'venue.updated','venue.restore':'venue.updated','match.create':'match.updated','match.publish':'match.updated','match.cancel':'match.updated','profile.photo.update':'profile.updated','profile.photo.remove':'profile.updated'};
export function requestScope(path){
 if(/^\/api\/auth\/(request|verify|google|logout|development)$/.test(path))return 'access';
 if(path==='/api/membership/application'||/^\/api\/admin\/applications\/[^/]+$/.test(path))return 'membership';
 if(/^\/api\/admin\/members(?:\/[^/]+(?:\/role)?)?$/.test(path))return 'members';
 if(path==='/api/dev/health')return 'health';
 for(const scope of ['settings','venues','matches','news'])if(new RegExp('^/api/(?:admin/)?'+scope+'(?:/|$)').test(path))return scope;
 if(/^\/api\/profile(?:\/photo)?$/.test(path))return 'profile';
 return 'other';
}
export function createTelemetry(store){
 const prune=()=>{
  store.run('DELETE FROM technical_events WHERE last_at<?',new Date(store.clock().getTime()-30*86400000).toISOString());
  store.run('DELETE FROM technical_events WHERE id NOT IN (SELECT id FROM technical_events ORDER BY last_at DESC,id DESC LIMIT 2000)');
 };
 function record(event,{level='info',scope='system',role='system',code='ok',status=0}={}){
  if(!HEALTH_EVENTS.includes(event))return;
  level=['info','warning','error'].includes(level)?level:'error';scope=scopes.includes(scope)?scope:'other';
  role=['admin','dev','member','anonymous','system'].includes(role)?role:'anonymous';
  code=codes.includes(code)||/^email_provider_[45]\d{2}$/.test(code)?code:'internal_error';
  status=Number.isInteger(status)&&status>=100&&status<=599?status:0;
  try{
   const now=store.now(),bucket=Math.floor(store.clock().getTime()/60000);
   store.run(`INSERT INTO technical_events (bucket,event,level,scope,role,code,status,occurrences,first_at,last_at) VALUES (?,?,?,?,?,?,?,1,?,?) ON CONFLICT(bucket,event,level,scope,role,code,status) DO UPDATE SET occurrences=MIN(occurrences+1,100000000),last_at=excluded.last_at`,bucket,event,level,scope,role,code,status,now,now);
   prune();
  }catch{console.error('Technical log unavailable');}
 }
 store.onAudit=(action,actor)=>{
  const event=auditEvents[action];if(!event)return;
  const role=store.get('SELECT role FROM users WHERE id=?',actor)?.role||'system';
  const group=event.split('.')[0],scope={member:'members',venue:'venues',match:'matches'}[group]||group;
  record(event,{role,scope});
 };
 return {record,prune,report(){
  prune();
  const columns='event,level,scope,role,code,status,occurrences,first_at,last_at';
  return {activity:store.all(`SELECT ${columns} FROM technical_events WHERE level<>'error' ORDER BY last_at DESC,id DESC LIMIT 100`),errors:store.all(`SELECT ${columns} FROM technical_events WHERE level='error' ORDER BY last_at DESC,id DESC LIMIT 100`),errors24h:store.get("SELECT COALESCE(SUM(occurrences),0) n FROM technical_events WHERE level='error' AND last_at>=?",new Date(store.clock().getTime()-86400000).toISOString()).n};
 }};
}
export function recordRequestFailure(telemetry,req,path,error){
 const code=error.code,role=req.healthRole||'anonymous',scope=requestScope(path),status=error.status||500;
 if(status>=500)telemetry.record('system.request_failed',{level:'error',scope,role,code:code||'internal_error',status});
 else if(status===429)telemetry.record('access.limited',{level:'warning',scope,role,code:'rate_limited',status});
 else if(status===401||['invalid_code','human_verification_required','google_auth_failed','google_auth_expired','google_account_conflict'].includes(code))telemetry.record('access.verification_failed',{level:'warning',scope,role,code,status});
 else if(status===403)telemetry.record('access.denied',{level:'warning',scope,role,code,status});
}
