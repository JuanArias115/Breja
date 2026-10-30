let scriptReady,currentWidget,generation=0;
function load(){
 if(window.turnstile)return Promise.resolve(window.turnstile);
 if(!scriptReady)scriptReady=new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;
  const timer=setTimeout(()=>{script.remove();scriptReady=null;reject(new Error('human_verification_unavailable'));},12000);
  script.onload=()=>{clearTimeout(timer);if(window.turnstile)resolve(window.turnstile);else{scriptReady=null;reject(new Error('human_verification_unavailable'));}};
  script.onerror=()=>{clearTimeout(timer);script.remove();scriptReady=null;reject(new Error('human_verification_unavailable'));};document.head.append(script);
 });
 return scriptReady;
}
export function clearTurnstile(){generation++;if(currentWidget!==undefined&&window.turnstile){window.turnstile.remove(currentWidget);currentWidget=undefined;}}
export async function mountTurnstile(element,sitekey,action,language,onStatus){
 clearTurnstile();const version=generation,sdk=await load();if(!element.isConnected||version!==generation)return;
 currentWidget=sdk.render(element,{sitekey,action,language,theme:'light',size:'flexible',callback:()=>onStatus('human_verified'),'expired-callback':()=>onStatus('human_verification_required'),'error-callback':()=>onStatus('human_verification_unavailable')});
}
export function turnstileToken(form){const token=form.querySelector('[name="cf-turnstile-response"]')?.value;if(!token)throw new Error('human_verification_required');return token;}
