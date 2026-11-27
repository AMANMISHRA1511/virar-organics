import test from 'node:test';
import assert from 'node:assert/strict';
import { makeOrderBillPdf } from '../src/order-bill-pdf.js';
const example=(count=2)=>({
 id:25,created_at:'2026-11-28T01:00:00Z',status:'Pending',payment_method:'cod',
 payment_status:'cod',name:'Sample Customer',email:'sample@example.test',
 address:{line1:'Flat 5',city:'Virar',state:'Maharashtra',pincode:'401303'},
 subtotal:count*100,delivery_charge:35,total:count*100+35,
 items:Array.from({length:count},(_,i)=>({name:'Organic Rice '+i,quantity:1,price:100,unit:'1 kg'})),
});
test('generates downloadable PDF with correct order values',()=>{
 const data=makeOrderBillPdf(example(),{storeName:'Virar Organics'}).toString('ascii');
 assert.match(data,/^%PDF-1.4/);
 assert.match(data,/VO-000025/);
 assert.match(data,/Rs\. 235\.00/);
 assert.match(data,/NOT A GST TAX INVOICE/);
 assert.match(data,/xref\n0 \d+\n/);
 assert.match(data,/%%EOF\n$/);
});
test('paginates long orders',()=>{
 const data=makeOrderBillPdf(example(80)).toString('ascii');
 assert.ok((data.match(/\/Type \/Page /g)||[]).length>1);
 assert.match(data,/Organic Rice 79/);
});
test('escapes user content in PDF',()=>{
 const o=example();o.items[0].name='Rice (special) \\ sample';
 const data=makeOrderBillPdf(o).toString('ascii');
 assert.match(data,/Rice \\(special\\) \\\\ sample/);
});
test('rejects missing order data',()=>{
 assert.throws(()=>makeOrderBillPdf({id:0,items:[]}),/Invalid bill data/);
});
