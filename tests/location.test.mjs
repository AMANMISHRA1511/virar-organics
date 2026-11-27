/** Pure location/address rules. Fixtures never contact a geocoding service. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLocationSuggestion, mergeLocationSuggestion, emptyAddress, addressPayload } from '../frontend/src/location.js';

const provider = {
  locality: 'Synthetic Locality', city: 'Virar', principalSubdivision: 'Maharashtra',
  postcode: '401303', countryCode: 'IN', countryName: 'India',
};
const coords = { latitude: 19.4559, longitude: 72.8114, accuracy: 17.6 };

test('An Indian location response suggests locality/city/state/PIN and retains measured accuracy', () => {
  const value = parseLocationSuggestion(provider, coords);
  assert.equal(value.area, 'Synthetic Locality'); assert.equal(value.city, 'Virar');
  assert.equal(value.state, 'Maharashtra'); assert.equal(value.pincode, '401303');
  assert.equal(value.lat, coords.latitude); assert.equal(value.lng, coords.longitude);
  assert.equal(value.accuracy, 18); assert.equal(value.warning, '');
  for (const key of ['flat', 'building', 'landmark', 'name', 'phone']) assert.equal(value[key], undefined, key);
});

test('Missing city uses locality while absent or invalid PIN requires manual entry', () => {
  for (const postcode of [undefined, '', '40130', '4013037', 'ABC123']) {
    const value = parseLocationSuggestion({ ...provider, city: '', postcode }, coords);
    assert.equal(value.city, 'Synthetic Locality'); assert.equal(value.pincode, '');
    assert.match(value.warning, /PIN.*manually/i);
  }
});

test('Foreign or unconfirmed country does not treat a six-digit postcode as an Indian PIN', () => {
  for (const countryCode of ['US', '', undefined]) {
    const value = parseLocationSuggestion({ ...provider, countryCode }, coords);
    assert.equal(value.pincode, ''); assert.match(value.warning, /outside India|could not be confirmed/i);
  }
});

test('Provider failures and unavailable or invalid coordinates require manual entry', () => {
  for (const data of [null, { error: 'Lookup failed' }, { errorCode: 403 }]) {
    assert.throws(() => parseLocationSuggestion(data, coords), /manually/i);
  }
  for (const input of [undefined, {}, { latitude: null, longitude: null }, { latitude: 91, longitude: 0 }, { latitude: 0, longitude: 181 }, { latitude: NaN, longitude: 72 }]) {
    assert.throws(() => parseLocationSuggestion(provider, input), /valid coordinates|manually/i, JSON.stringify(input));
  }
});

test('A delayed location suggestion preserves all manually edited and unit-level fields', () => {
  const current = {
    ...emptyAddress({ name: 'Synthetic customer', phone: '+919000001234' }),
    flat: 'B-19', building: 'Manually typed building', landmark: 'Manual landmark',
    area: 'Manual area', city: 'Manual city', state: 'Manual state', pincode: '401305',
  };
  const suggestion = { ...parseLocationSuggestion(provider, coords), flat: 'Incorrect inferred flat', building: 'Incorrect inferred building', name: 'Wrong name', phone: 'Wrong phone' };
  const merged = mergeLocationSuggestion(current, suggestion, ['area', 'city', 'state', 'pincode']);
  for (const field of ['name', 'phone', 'flat', 'building', 'landmark', 'area', 'city', 'state', 'pincode']) {
    assert.equal(merged[field], current[field], field);
  }
  assert.equal(merged.lat, null); assert.equal(merged.lng, null); assert.equal(merged.accuracy, null);
  assert.equal(current.lat, null, 'Merging does not mutate the caller address');
});

test('Flat-only manual edits keep location suggestions and their matching delivery coordinates', () => {
  const current = { ...emptyAddress(), flat: 'B-19', building: 'Manual building' };
  const merged = mergeLocationSuggestion(current, parseLocationSuggestion(provider, coords), ['flat', 'building']);
  assert.equal(merged.flat, 'B-19'); assert.equal(merged.building, 'Manual building'); assert.equal(merged.city, 'Virar');
  assert.equal(merged.lat, coords.latitude); assert.equal(merged.lng, coords.longitude); assert.equal(merged.accuracy, 18);
});

test('Missing suggestions preserve existing text and a dirty empty field stays empty', () => {
  const current = { ...emptyAddress(), area: 'Existing area', city: '', state: 'Existing state', pincode: '401305' };
  const merged = mergeLocationSuggestion(current, { area: '', city: 'Suggested city', state: '', pincode: '', lat: 0, lng: 0, accuracy: null }, ['city']);
  assert.equal(merged.area, 'Existing area'); assert.equal(merged.city, '');
  assert.equal(merged.state, 'Existing state'); assert.equal(merged.pincode, '401305');
  assert.equal(merged.lat, null); assert.equal(merged.lng, null);
});

test('Manual address payload composes the delivery lines without inventing coordinates', () => {
  const value = addressPayload({ ...emptyAddress(), flat: '12', building: 'Synthetic Building', area: 'Synthetic Area', landmark: 'Manual landmark', city: 'Virar', pincode: '401303' });
  assert.equal(value.line1, '12, Synthetic Building, Synthetic Area'); assert.equal(value.line2, 'Manual landmark');
  assert.equal(value.lat, null); assert.equal(value.lng, null); assert.equal(value.accuracy, null);
  assert.equal(value.country, 'India');
});

test('Legacy address lines and legitimate zero coordinates survive payload normalization', () => {
  const value = addressPayload({ line1: 'Legacy delivery line', line2: 'Legacy landmark', lat: 0, lng: 0, accuracy: 0, is_default: true });
  assert.equal(value.line1, 'Legacy delivery line'); assert.equal(value.line2, 'Legacy landmark');
  assert.equal(value.lat, 0); assert.equal(value.lng, 0); assert.equal(value.accuracy, 0);
  assert.equal(value.is_default, true);
});
