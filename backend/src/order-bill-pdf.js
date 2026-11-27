// Lightweight, self-contained PDF document generator for order bills.
// All input is first reduced to printable ASCII before being written as PDF
// literal strings. No external rendering or third-party document services.
function printSafe(value) {
  return String(value ?? '').replace(/₹/g,'Rs. ').replace(/[–—]/g,'-')
    .replace(/[‘’]/g,"'").replace(/[“”]/g,'"')
    .normalize('NFKD').replace(/[^\x20-\x7E]/g,'?');
}
function escapeText(input) {
  return printSafe(input).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
}
function wrapText(value, width=86) {
  const result=[];
  for (const part of printSafe(value).split(/\r?\n/)) {
    let rest=part.trim();
    if (!rest) {result.push('');continue;}
    while(rest.length>width) {
      let n=rest.lastIndexOf(' ',width);
      if(n<width/3)n=width;
      result.push(rest.slice(0,n).trimEnd());rest=rest.slice(n).trimStart();
    }
    result.push(rest);
  }
  return result;
}
function rupees(amount) {
  const n=Number(amount);
  return 'Rs. '+(Number.isFinite(n)?n:0).toFixed(2);
}
export function makeOrderBillPdf(order,settings={}) {
  if(!order||!Number.isSafeInteger(Number(order.id))||!Array.isArray(order.items))
    throw new Error('Invalid bill data.');
  const reference='VO-'+String(order.id).padStart(6,'0');
  const address=order.address||{};
  const addressParts=[
    address.flat,address.building,address.line1,address.area,
    address.landmark,address.line2,address.city,address.state,
    address.pincode,address.country||'India'
  ].filter(Boolean);
  const payment=order.payment_method==='cod'?'Cash on Delivery':
    order.payment_method==='razorpay'?'Razorpay TEST - not a real payment':'Simulated payment - no real money';
  const lines=[
    'VIRAR ORGANICS - ORDER BILL',
    '',
    'Bill reference: '+reference,
    'Order placed: '+(order.created_at?new Date(order.created_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):'Not available'),
    'Order status: '+(order.status||'Pending'),
    'Payment method: '+payment,
    'Payment status: '+(order.payment_status||'pending'),
    '',
    'SELLER: '+(settings.storeName||'Virar Organics'),
    settings.address||'',settings.contactEmail||'',settings.contactPhone||'',
    '',
    'BILL TO: '+(address.name||order.name||'Customer'),
    'Email: '+(order.email||''),
    'Delivery: '+addressParts.join(', '),
    'Phone: '+(address.phone||order.phone||''),
    '',
    'ITEMS',
    '---------------------------------------------------------------------------',
  ];
  for(const item of order.items) {
    const qty=Number(item.quantity)||0,price=Number(item.price)||0;
    lines.push(item.name+(item.unit?' ('+item.unit+')':''));
    lines.push('  '+qty+' x '+rupees(price)+'     Line total: '+rupees(Math.round(qty*Math.round(price*100))/100));
  }
  lines.push('---------------------------------------------------------------------------');
  lines.push('Subtotal: '+rupees(order.subtotal));
  lines.push('Delivery: '+rupees(order.delivery_charge));
  lines.push('ORDER TOTAL: '+rupees(order.total));
  lines.push('');
  lines.push('ORDER BILL ONLY. NOT A GST TAX INVOICE.');
  lines.push('Tax and GSTIN are not represented here; no tax amounts are invented.');
  if(order.payment_status!=='paid')lines.push('Payment is not confirmed as received.');
  const printable=lines.flatMap(v=>wrapText(v,84));
  const pages=[];
  for(let i=0;i<printable.length;i+=44)pages.push(printable.slice(i,i+44));
  if(!pages.length)pages.push(['VIRAR ORGANICS - ORDER BILL']);
  const objects=new Map([
    [1,'<< /Type /Catalog /Pages 2 0 R >>'],
    [3,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'],
  ]);
  const refs=[];
  for(let n=0;n<pages.length;n++){
    const pageId=4+n*2,streamId=pageId+1;
    refs.push(pageId+' 0 R');
    const stream=pages[n].map((line,i)=>
      'BT /F1 '+(i===0?17:10)+' Tf 48 '+(790-i*16)+' Td ('+escapeText(line)+') Tj ET'
    ).join('\n')+'\n';
    objects.set(pageId,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents '+streamId+' 0 R >>');
    objects.set(streamId,'<< /Length '+stream.length+' >>\nstream\n'+stream+'endstream');
  }
  objects.set(2,'<< /Type /Pages /Count '+pages.length+' /Kids ['+refs.join(' ')+'] >>');
  const max=Math.max(...objects.keys());const offsets=[0];
  let pdf='%PDF-1.4\n';
  for(let i=1;i<=max;i++){
    offsets[i]=pdf.length;
    pdf+=i+' 0 obj\n'+objects.get(i)+'\nendobj\n';
  }
  const start=pdf.length;
  pdf+='xref\n0 '+(max+1)+'\n0000000000 65535 f \n';
  for(let i=1;i<=max;i++)pdf+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';
  pdf+='trailer\n<< /Size '+(max+1)+' /Root 1 0 R >>\nstartxref\n'+start+'\n%%EOF\n';
  return Buffer.from(pdf,'ascii');
}
