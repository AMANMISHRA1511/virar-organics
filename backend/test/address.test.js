import test from 'node:test';
import assert from 'node:assert/strict';
import { checkoutAddressSchema, savedAddressSchema } from '../src/address-schema.js';
import { parse } from '../src/util.js';
const base={name:'Synthetic customer',phone:'+919000001234',city:'Virar',pincode:'401303'};

test('Structured apartment fields become a compatible order address without trusting owner or privilege fields',()=>{
  const result=parse(savedAddressSchema,{...base,flat:'A-17',building:'Synthetic building',area:'Test locality',landmark:'Test gate',user_id:999,role:'admin',lat:19.4559,lng:72.8114,accuracy:12});
  assert.equal(result.line1,'A-17, Synthetic building, Test locality');assert.equal(result.country,'India');
  assert.equal(result.flat,'A-17');assert.equal(result.accuracy,12);assert.equal(result.user_id,undefined);assert.equal(result.role,undefined);
  const legacy=parse(checkoutAddressSchema,{...base,line1:'Legacy street address'});assert.equal(legacy.line1,'Legacy street address');assert.equal(legacy.lat,null);assert.equal(legacy.flat,'');
});

test('Delivery coordinates reject coercion, missing pairs, invalid ranges and unbound accuracy',()=>{
  const valid={...base,line1:'Synthetic delivery address'};
  for(const change of [{lat:'19.45',lng:72.81},{lat:true,lng:72.81},{lat:91,lng:72.81},{lat:19.45,lng:-181},{lat:19.45},{lng:72.81},{lat:null,lng:72.81},{accuracy:10},{lat:19.45,lng:72.81,accuracy:-1},{lat:NaN,lng:72.81}])assert.throws(()=>parse(checkoutAddressSchema,{...valid,...change}),undefined,JSON.stringify(change));
  assert.equal(parse(checkoutAddressSchema,{...valid,lat:0,lng:0,accuracy:0}).lat,0);
});
