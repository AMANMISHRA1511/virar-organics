import test from 'node:test';
import assert from 'node:assert/strict';
import { BRAND_NAME, defaultBrandSettings, upgradeDefaultBrandSettings } from '../src/branding.js';

const shipped={storeName:'Mitti & Meadow',footer:'Mitti & Meadow · Rooted in goodness.',contactEmail:'hello@mitti.test'};

test('Brand upgrade changes only exact shipped values and retains images and unrelated settings',()=>{
  const input={...shipped,logo:'/uploads/custom-logo.webp',banner:'/uploads/customer-banner.webp',contactPhone:'+919000001234',description:'Custom copy mentioning Mitti & Meadow',social:{instagram:'https://example.test/custom'},deliveryCharge:49};
  const result=upgradeDefaultBrandSettings(input);
  assert.deepEqual(result.changedFields,['storeName','footer','contactEmail']);
  assert.deepEqual(result.content,{...input,...defaultBrandSettings});
  assert.deepEqual(input.storeName,'Mitti & Meadow');
  assert.deepEqual(upgradeDefaultBrandSettings(result.content).changedFields,[]);
});

test('Brand upgrade preserves custom content and contacts when only the shipped store name changes',()=>{
  const input={...shipped,footer:'Our own farm message',contactEmail:'owner@example.test',heading:'Our custom heading'};
  const result=upgradeDefaultBrandSettings(input);
  assert.deepEqual(result.changedFields,['storeName']);
  assert.deepEqual(result.content,{...input,storeName:BRAND_NAME});
});

test('A custom store name preserves the entire settings document, including remaining old defaults',()=>{
  for(const storeName of ['Another Farm','Mitti & Meadow - Local Team','']) {
    const input={...shipped,storeName,logo:'/uploads/own-logo.webp'};
    const result=upgradeDefaultBrandSettings(input);
    assert.equal(result.content,input);assert.deepEqual(result.changedFields,[]);
  }
});

test('Missing or already-new names allow exact legacy fields to migrate without inventing saved settings',()=>{
  const missing={footer:shipped.footer,contactEmail:'custom@example.test'};
  assert.deepEqual(upgradeDefaultBrandSettings(missing).content,{footer:defaultBrandSettings.footer,contactEmail:'custom@example.test'});
  const renamed={...shipped,storeName:BRAND_NAME};
  assert.deepEqual(upgradeDefaultBrandSettings(renamed).content,defaultBrandSettings);
  for(const content of [null,[],false,'not-an-object'])assert.equal(upgradeDefaultBrandSettings(content).content,content);
});
