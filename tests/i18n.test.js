import test from 'node:test';
import assert from 'node:assert/strict';
const storage=new Map([['breja-language','es']]);
globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};
globalThis.document={documentElement:{lang:''}};
const i18n=await import('../public/i18n.js');

test('Spanish covers every message and preserves interpolation variables',()=>{
 for(const [key,values] of Object.entries(i18n.messages)){
  assert.equal(typeof values[2],'string',key);
  assert.deepEqual((values[2].match(/\{\w+\}/g)||[]).sort(),(values[0].match(/\{\w+\}/g)||[]).sort(),key);
 }
 assert.equal(i18n.lang,'es');assert.equal(i18n.t('hello',{name:'Ana'}),'Hola, Ana.');
 assert.equal(i18n.t('intro'),'');assert.match(i18n.date('2026-10-23T12:00:00Z'),/oct/);
 assert.equal(i18n.money(500),new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(5));
 i18n.setLanguage('de');assert.equal(document.documentElement.lang,'de');
 i18n.setLanguage('es');assert.equal(storage.get('breja-language'),'es');
 for(const key of ['tagline','hero'])for(const value of i18n.messages[key])assert.doesNotMatch(value,/saturday|samstag|sábado/i);
});
