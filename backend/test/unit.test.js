import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifySignature } from '../src/orders.js';
import { csv, password, parse, cents } from '../src/util.js';
import { validCsrf } from '../src/auth.js';
import { config } from '../src/config.js';

test('webhook HMAC validates exact raw bytes and rejects tampering, malformed or missing signatures',()=>{
 const secret='unit-test-secret',body=Buffer.from('{"event":"payment.captured"}');const signature=createHmac('sha256',secret).update(body).digest('hex');
 assert.equal(verifySignature(body,signature,secret),true);
 assert.equal(verifySignature(Buffer.from(body+' '),signature,secret),false);
 assert.equal(verifySignature(body,'x'.repeat(64),secret),false);
 assert.equal(verifySignature(body,signature,''),false);
 assert.equal(verifySignature(body,undefined,secret),false);
});
test('double submit CSRF verifies signature and both cookie/header values',()=>{
 const nonce='a'.repeat(64),token=nonce+'.'+createHmac('sha256',config.secret).update(nonce).digest('hex');
 assert.equal(validCsrf(token,token),true);assert.equal(validCsrf(token,'wrong'),false);assert.equal(validCsrf('a.b','a.b'),false);assert.equal(validCsrf(undefined,undefined),false);
});
test('CSV export neutralizes spreadsheet formulas and quotes newlines/commas',()=>{
 const result=csv([{name:'=HYPERLINK("https://example.test")',note:'a,b\nquoted "value"'}],['name','note']);
 assert.ok(result.includes('"\'=HYPERLINK(""https://example.test"")"'));assert.ok(result.includes('"a,b\nquoted ""value"""'));
});
test('password validation rejects bcrypt byte truncation and short passwords',()=>{
 assert.throws(()=>parse(password,'short'));
 assert.throws(()=>parse(password,'🙂'.repeat(20)));
 assert.equal(parse(password,'A-valid-local-password!'),'A-valid-local-password!');
});
test('price conversion computes integer paise before order arithmetic',()=>{
 assert.equal(cents(19.99),1999);assert.equal(cents('129.50'),12950);assert.equal(cents(0.1)+cents(0.2),30);
});
