import fs from 'node:fs/promises';
import { db, rows, json, transaction } from './src/db.js';
import { upgradeDefaultBrandSettings } from './src/branding.js';
import { queueEvent } from './src/infra.js';
import { config } from './src/config.js';

async function migrateBranding(c) {
  const [applied] = await rows('SELECT version FROM schema_migrations WHERE version=6 FOR UPDATE', [], c);
  if (applied) return { alreadyApplied: true, changedFields: [] };
  const [settings] = await rows('SELECT content FROM settings WHERE id=1 FOR UPDATE', [], c);
  const result = upgradeDefaultBrandSettings(json(settings?.content));
  if (result.changedFields.length) {
    await rows('UPDATE settings SET content=? WHERE id=1', [JSON.stringify(result.content)], c);
    await queueEvent(c, 'settings', {}, ['public']);
  }
  await rows('INSERT INTO schema_migrations(version) VALUES(6)', [], c);
  return { alreadyApplied: false, changedFields: result.changedFields };
}


// One-time, non-destructive rollout for explicitly requested Naigaon East
// deliveries and maps. Other saved delivery zones and settings are preserved.
async function migrateNaigaonDelivery(c) {
  const [applied] = await rows('SELECT version FROM schema_migrations WHERE version=8 FOR UPDATE', [], c);
  if (applied) return { alreadyApplied: true };
  const [saved] = await rows('SELECT content FROM settings WHERE id=1 FOR UPDATE', [], c);
  if (saved) {
    const settings = json(saved.content, {});
    const zones = Array.isArray(settings.deliveryZones) ? settings.deliveryZones : [];
    if (zones.length && !zones.some(zone => Array.isArray(zone.pincodes) && zone.pincodes.includes('401208'))) {
      zones.push({ name: 'Naigaon East', pincodes: ['401208'] });
    }
    // Map display can be changed again from Admin > Settings.
    const updated = { ...settings, deliveryZones: zones, mapEnabled: true };
    await rows('UPDATE settings SET content=? WHERE id=1', [JSON.stringify(updated)], c);
    await queueEvent(c, 'settings', {}, ['public']);
  }
  await rows('INSERT IGNORE INTO schema_migrations(version) VALUES(8)', [], c);
  return { alreadyApplied: false };
}

async function migratePostgres() {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    // Serialize first-start DDL too, when no schema_migrations row exists yet.
    // This is a transaction-scoped PostgreSQL lock, never a translated GET_LOCK.
    await connection.runScript('SELECT pg_advisory_xact_lock(170121, 7)');
    const tables = await rows("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='users'", [], connection);
    if (tables.length && !(await rows("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='users' AND column_name='session_version'", [], connection)).length) {
      throw new Error('An incompatible existing database was found. Back it up and choose a new application database; migration never replaces existing data.');
    }
    await connection.runScript(await fs.readFile(new URL('./schema-postgres.sql', import.meta.url), 'utf8'));
    const branding = await migrateBranding(connection);
    await rows('INSERT IGNORE INTO schema_migrations(version) VALUES(7)', [], connection);
    await migrateNaigaonDelivery(connection);
    await connection.commit();
    console.log('PostgreSQL schema v7 ready (non-destructive, repeatable).');
    console.log(JSON.stringify({ brandingMigration: 6, ...branding }));
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

try {
 if (config.dbClient === 'postgres') {
  await migratePostgres();
 } else {
  const tables = await rows('SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', ['users']);
  if (tables.length) {
    const columns = await rows("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME=?", ['session_version']);
    if (!columns.length) throw new Error('An older prototype database exists. Back it up and choose a new empty DB_NAME (for example mitti_v2). This migration never destroys existing data.');
  }
  const sql = await fs.readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  for (const statement of sql.split(';').filter(s => s.trim())) await db.query(statement);
  const notificationColumns = await rows("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='notifications' AND COLUMN_NAME='lease_until'");
  if (!notificationColumns.length) await db.query('ALTER TABLE notifications ADD COLUMN lease_until DATETIME NULL');
  const deliveryModeColumns = await rows("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='notifications' AND COLUMN_NAME='delivery_mode'");
  if (!deliveryModeColumns.length) await db.query("ALTER TABLE notifications ADD COLUMN delivery_mode VARCHAR(20) NOT NULL DEFAULT 'simulated'");
  const retryColumns = new Set((await rows("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='notifications'")).map(c=>c.COLUMN_NAME));
  for (const [column, definition] of Object.entries({ attempt_limit: 'INT NOT NULL DEFAULT 4', retry_at: 'DATETIME NULL' })) {
    if (!retryColumns.has(column)) await db.query(`ALTER TABLE notifications ADD COLUMN ${column} ${definition}`);
  }
  const userAdditions = {google_sub:'VARCHAR(255) NULL UNIQUE',google_email:'VARCHAR(190) NULL',password_login_enabled:'BOOLEAN NOT NULL DEFAULT TRUE',phone_verified:'BOOLEAN NOT NULL DEFAULT FALSE',phone_verification_method:'VARCHAR(20) NULL',phone_verified_at:'DATETIME NULL'};
  const existingUserColumns = new Set((await rows("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users'")).map(c=>c.COLUMN_NAME));
  for(const [column, definition] of Object.entries(userAdditions)) if(!existingUserColumns.has(column)) await db.query(`ALTER TABLE users ADD COLUMN ${column} ${definition}`);
  const leadUserColumn = await rows("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='leads' AND COLUMN_NAME='user_id'");
  if (!leadUserColumn.length) await db.query('ALTER TABLE leads ADD COLUMN user_id INT UNSIGNED NULL, ADD INDEX idx_leads_customer(user_id,id), ADD CONSTRAINT fk_leads_customer FOREIGN KEY(user_id) REFERENCES users(id)');
  const [lineColumn]=await rows("SELECT CHARACTER_MAXIMUM_LENGTH maximum_length FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='account_addresses' AND COLUMN_NAME='line1'");
  if(Number(lineColumn?.maximum_length)<500)await db.query('ALTER TABLE account_addresses MODIFY COLUMN line1 VARCHAR(500) NOT NULL');
  const uploadColumns = new Set((await rows("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='uploads'")).map(c=>c.COLUMN_NAME));
  for (const [column, definition] of Object.entries({ storage: "VARCHAR(20) NOT NULL DEFAULT 'filesystem' CHECK(storage IN ('filesystem','database'))", content: 'LONGBLOB NULL', mime_type: "VARCHAR(100) NOT NULL DEFAULT 'image/webp'" })) {
    if (!uploadColumns.has(column)) await db.query(`ALTER TABLE uploads ADD COLUMN ${column} ${definition}`);
  }
  await db.query('INSERT IGNORE INTO schema_migrations(version) VALUES(5)');
  const branding = await transaction(migrateBranding);
  await rows('INSERT IGNORE INTO schema_migrations(version) VALUES(7)');
  await transaction(migrateNaigaonDelivery);
  console.log('MySQL schema v7 ready (non-destructive, repeatable).');
  console.log(JSON.stringify({ brandingMigration: 6, ...branding }));
 }
} finally { await db.end(); }
