import fs from 'node:fs/promises';
import { db, rows, json, transaction } from './src/db.js';
import { upgradeDefaultBrandSettings } from './src/branding.js';
import { queueEvent } from './src/infra.js';
try {
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
  const userAdditions = {google_sub:'VARCHAR(255) NULL UNIQUE',google_email:'VARCHAR(190) NULL',password_login_enabled:'BOOLEAN NOT NULL DEFAULT TRUE',phone_verified:'BOOLEAN NOT NULL DEFAULT FALSE',phone_verification_method:'VARCHAR(20) NULL',phone_verified_at:'DATETIME NULL'};
  const existingUserColumns = new Set((await rows("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users'")).map(c=>c.COLUMN_NAME));
  for(const [column, definition] of Object.entries(userAdditions)) if(!existingUserColumns.has(column)) await db.query(`ALTER TABLE users ADD COLUMN ${column} ${definition}`);
  const leadUserColumn = await rows("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='leads' AND COLUMN_NAME='user_id'");
  if (!leadUserColumn.length) await db.query('ALTER TABLE leads ADD COLUMN user_id INT UNSIGNED NULL, ADD INDEX idx_leads_customer(user_id,id), ADD CONSTRAINT fk_leads_customer FOREIGN KEY(user_id) REFERENCES users(id)');
  const [lineColumn]=await rows("SELECT CHARACTER_MAXIMUM_LENGTH maximum_length FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='account_addresses' AND COLUMN_NAME='line1'");
  if(Number(lineColumn?.maximum_length)<500)await db.query('ALTER TABLE account_addresses MODIFY COLUMN line1 VARCHAR(500) NOT NULL');
  await db.query('INSERT IGNORE INTO schema_migrations(version) VALUES(5)');
  const branding = await transaction(async c => {
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
  });
  console.log('Schema v6 ready (non-destructive, repeatable).');
  console.log(JSON.stringify({ brandingMigration: 6, ...branding }));
} finally { await db.end(); }
