import { z } from 'zod';
import { text, phone } from './util.js';

// Coordinates are optional delivery hints, never proof of a house or account identity.
// Keep apartment-level fields separate because browser location cannot supply them.
const fields = {
  name: text(100, 2), phone,
  flat: text(100).default(''), building: text(150).default(''), area: text(150).default(''), landmark: text(200).default(''),
  line1: text(500).default(''), line2: text(250).default(''), city: text(100, 2), state: text(100).default(''),
  pincode: z.string().trim().regex(/^\d{6}$/, 'Enter a six-digit Indian pincode'),
  country: z.enum(['India', 'IN']).default('India').transform(() => 'India'),
  lat: z.number().finite().min(-90).max(90).nullable().optional().default(null),
  lng: z.number().finite().min(-180).max(180).nullable().optional().default(null),
  accuracy: z.number().finite().min(0).max(10000000).nullable().optional().default(null),
};
export const addressFields = z.object(fields);
function checkAddress(address, ctx) {
  if ((address.lat == null) !== (address.lng == null)) ctx.addIssue({code:'custom',path:['lat'],message:'Supply both latitude and longitude, or neither.'});
  if (address.accuracy != null && address.lat == null) ctx.addIssue({code:'custom',path:['accuracy'],message:'Accuracy requires coordinates.'});
  const line = address.line1 || [address.flat, address.building, address.area].filter(Boolean).join(', ');
  if (line.length < 5 || line.length > 500) ctx.addIssue({code:'custom',path:['line1'],message:'Enter a delivery address between 5 and 500 characters, using street or apartment details.'});
}
export function addressSnapshot(value) {
  return {...value, line1:value.line1 || [value.flat, value.building, value.area].filter(Boolean).join(', ')};
}
export const checkoutAddressSchema = addressFields.superRefine(checkAddress).transform(addressSnapshot);
export const savedAddressSchema = addressFields.extend({label:text(40,1).default('Home'),is_default:z.boolean().default(false)}).superRefine(checkAddress).transform(addressSnapshot);
export const savedAddressPatchSchema = addressFields.extend({label:text(40,1),is_default:z.boolean()}).partial();
