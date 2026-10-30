let ready;
export function prepareGoogle(config){
 if(!config)return Promise.resolve(null);
 if(!ready)ready=Promise.all([import('https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js'),import('https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js')]).then(async([app,sdk])=>{
  const auth=sdk.getAuth(app.initializeApp(config));await sdk.setPersistence(auth,sdk.inMemoryPersistence);return {auth,sdk};
 }).catch(error=>{ready=null;throw error;});
 return ready;
}
export async function googleToken(config,language){
 const {auth,sdk}=await prepareGoogle(config);auth.languageCode=language;
 const provider=new sdk.GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});
 try{const result=await sdk.signInWithPopup(auth,provider);return await result.user.getIdToken(true);}
 finally{await sdk.signOut(auth);}
}
