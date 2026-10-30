import { AppError, fail, text } from './store.js';

export function firebaseConfig(env=process.env){
 if(!env.FIREBASE_CONFIG)return null;
 let raw;try{raw=JSON.parse(env.FIREBASE_CONFIG);}catch{throw new Error('FIREBASE_CONFIG must be valid JSON');}
 const config=Object.fromEntries(['apiKey','authDomain','projectId','appId'].map(key=>[key,raw[key]]));
 if(Object.values(config).some(v=>typeof v!=='string'||!v)||!/^[a-z0-9.-]+$/i.test(config.authDomain)||!/^[a-z0-9-]+$/i.test(config.projectId))throw new Error('Incomplete Firebase web configuration');
 return config;
}
let auth;
export async function verifyGoogleToken(token,config){
 fail(config,'google_not_configured',503);text(token,16000);
 try{
  if(!auth){const [{initializeApp,getApps},{getAuth}]=await Promise.all([import('firebase-admin/app'),import('firebase-admin/auth')]);const app=getApps().find(a=>a.name==='breja-auth')||initializeApp({projectId:config.projectId},'breja-auth');auth=getAuth(app);}
  const decoded=await auth.verifyIdToken(token);
  const now=Date.now()/1000;
  fail(Number.isFinite(decoded.auth_time)&&decoded.auth_time<=now+60&&decoded.auth_time>now-300,'google_auth_expired',401);
  return decoded;
 }catch(error){if(error instanceof AppError)throw error;throw new AppError('google_auth_failed',401);}
}
// Called only after the Admin SDK verifies signature, issuer, audience and expiry.
export function linkGoogleUser(store,claims,language='en',adminEmail=''){
 fail(claims.email_verified===true&&claims.firebase?.sign_in_provider==='google.com','google_auth_failed',401);
 const uid=text(claims.uid,128),email=text(claims.email,254).toLowerCase();fail(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'google_auth_failed',401);
 return store.transaction(()=>{
  let user=store.get('SELECT * FROM users WHERE firebase_uid=?',uid);
  if(user){fail(user.email===email,'google_account_conflict',409);return user;}
  user=store.get('SELECT * FROM users WHERE email=?',email);
  fail(!user?.firebase_uid,'google_account_conflict',409);
  if(!user){const initialAdmin=email===adminEmail.toLowerCase();user=store.addUser({email,name:typeof claims.name==='string'?claims.name.slice(0,100):email.split('@')[0],language},initialAdmin?'admin':'member',initialAdmin?'approved':'onboarding');}
  store.run('UPDATE users SET firebase_uid=? WHERE id=?',uid,user.id);store.audit(user.id,'auth.google.link',user.id);
  return store.get('SELECT * FROM users WHERE id=?',user.id);
 });
}
