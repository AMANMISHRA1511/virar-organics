export const BRAND_NAME = 'Virar Organics';
export const defaultBrandSettings = Object.freeze({
  storeName: BRAND_NAME,
  footer: `${BRAND_NAME} · Rooted in goodness.`,
  contactEmail: 'hello@virarorganics.test',
});

// These exact values shipped in v2.1. Do not perform a broad text replacement:
// an installation may have its own copy, contacts, images or branding.
const legacyDefaults = Object.freeze({
  storeName: 'Mitti & Meadow',
  footer: 'Mitti & Meadow · Rooted in goodness.',
  contactEmail: 'hello@mitti.test',
});

export function upgradeDefaultBrandSettings(content) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return { content, changedFields: [] };
  const name = content.storeName;
  // A custom name opts the whole settings document out of this default-brand update.
  if (name !== undefined && name !== legacyDefaults.storeName && name !== BRAND_NAME) return { content, changedFields: [] };
  const updated = { ...content }, changedFields = [];
  for (const [field, previous] of Object.entries(legacyDefaults)) {
    if (content[field] === previous) {
      updated[field] = defaultBrandSettings[field];
      changedFields.push(field);
    }
  }
  return { content: changedFields.length ? updated : content, changedFields };
}
