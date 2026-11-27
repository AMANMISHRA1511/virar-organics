import test from 'node:test';
import assert from 'node:assert/strict';
import { makeOrderBillPdf } from '../src/order-bill-pdf.js';

const sample = {
 id:37, name:'Customer',email:'buyer@example.invalid',status:'Pending',
 payment_method:'cod',payment_status:'cod', created_at:'2026-11-28T00:00:00Z',
 address:{line1:'Flat 3 Bapane Road',city:'Naigaon East',pincode:'401208'},
 subtotal:240,delivery_charge:35,total:275,
 items:[{name:'Organic Basmati Rice',quantity:2,price:120,unit:'kg'}]
};
test('A4 bill has valid header, reference, INR total and cross reference offset',()=>{
 const pdf=makeOrderBillPdf(sample,{storeName:'Virar Organics'});
 assert.ok(Buffer.isBuffer(pdf));
 const content=pdf.toString('ascii');
 assert.equal(content.slice(0,8),'%PDF-1.4');
 assert.match(content,/VO-000037/);
 assert.match(content,/ORDER TOTAL: Rs\. 275\.00/);
 assert.match(content,/NOT A GST TAX INVOICE/);
 assert.match(content,/\/MediaBox \[0 0 595 842\]/);
 const ptr=Number(content.match(/startxref\n(\d+)\n%%EOF/)[1]);
 assert.equal(content.slice(ptr,ptr+5),'xref\n');
});
test('multi-page document supports long orders and escaping',()=>{
 const many={...sample,items:Array.from({length:100},(_,i)=>({name:'Test (product) '+i,quantity:1,price:1}))};
 const content=makeOrderBillPdf(many).toString('ascii');
 assert.match(content,/\/Count [2-9]\d* \/Kids/);
 assert.match(content,/Test \\(product\\)/);
});
test('invalid orders are rejected',()=>{
 assert.throws(()=>makeOrderBillPdf({id:1}),/Invalid bill data/);
});
