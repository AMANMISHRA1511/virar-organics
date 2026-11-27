import mysql from 'mysql2/promise';
import { config, validateDatabaseConfig } from './config.js';
import { createPostgresPool } from './postgres.js';
validateDatabaseConfig();
export const db = config.dbClient === 'postgres' ? createPostgresPool(config) : mysql.createPool(config.db);
// MySQL TIMESTAMP values must be read in UTC regardless of the host/server timezone.
if (config.dbClient === 'mysql') db.on('connection', connection => { connection.query("SET time_zone = '+00:00'"); });
export const rows = async (sql, values = [], executor = db) => (await executor.execute(sql, values))[0];
export const json = (value, fallback = null) => { if (value == null) return fallback; if (typeof value !== 'string') return value; try { return JSON.parse(value); } catch { return fallback; } };
export async function transaction(fn) {
  for (let attempt = 0; ; attempt++) {
    const connection = await db.getConnection();
    try { await connection.beginTransaction(); const result = await fn(connection); await connection.commit(); return result; }
    catch (error) { await connection.rollback(); if (error.code === 'ER_LOCK_DEADLOCK' && attempt < 2) continue; throw error; }
    finally { connection.release(); }
  }
}
