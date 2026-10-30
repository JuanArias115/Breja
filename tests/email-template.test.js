import test from 'node:test';import assert from 'node:assert/strict';import { statementHtml } from '../server/email-template.js';
test('statement HTML preserves escaped content and renders movements, balance, crest and account link',()=>{
 const body='Hola Test,\nBreja FC · 2026-09\n6/9/2026 · Partido <script>alert(1)</script> · 5,00 €\nSaldo al cierre del mes: 5,00 €\nInstrucciones & notas';const html=statementHtml(body,'https://breja.example.test');
 assert.match(html,/Tu resumen mensual/);assert.match(html,/2026-09/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/Instrucciones &amp; notas/);assert.match(html,/https:\/\/breja.example.test\/assets\/crest.png/);assert.match(html,/href="https:\/\/breja.example.test\/account"/);assert.match(html,/font-size:34px/);
 assert.match(statementHtml('SAMPLE DATA ONLY\nHi Test,','https://example.test'),/DO NOT PAY/);assert.match(statementHtml('Hallo Test,','https://example.test'),/Deine Monatsübersicht/);assert.throws(()=>statementHtml(body,'javascript:alert(1)'));
});
