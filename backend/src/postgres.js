import pg from 'pg';
import { compilePostgres, finiteDecimal, normalizePostgresError, safeInteger } from './postgres-dialect.js';

// Match the existing API contract: safe numeric IDs/counts and decimals, DATE
// strings for follow-ups, UTC Date objects for timestamps, and bytea Buffers.
const parsers = {
  getTypeParser(oid, format) {
    if (format !== 'binary') {
      if (oid === 20) return safeInteger;
      if (oid === 1700) return finiteDecimal;
      if (oid === 1082) return value => value;
      if (oid === 1114) return value => new Date(value.replace(' ', 'T') + 'Z');
    }
    return pg.types.getTypeParser(oid, format);
  },
};

function wrapExecutor(executor) {
  async function query(sql, values = []) {
    const compiled = compilePostgres(sql, values);
    try {
      const result = await executor.query({ text: compiled.text, values: compiled.values, types: parsers });
      if (['SELECT', 'SHOW', 'EXPLAIN'].includes(result.command)) return [result.rows, result.fields];
      const inserted = compiled.insertKey ? result.rows[0]?.[compiled.insertKey] : undefined;
      return [{ affectedRows: result.rowCount ?? 0, insertId: typeof inserted === 'number' ? inserted : 0 }, result.fields];
    } catch (error) { throw normalizePostgresError(error); }
  }
  return { query, execute: query };
}

export function createPostgresPool(config) {
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: config.db.connectionLimit,
    idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000,
    options: '-c timezone=UTC', types: parsers });
  // Idle connection errors must not crash the API; request errors still propagate.
  pool.on('error', error => console.warn(JSON.stringify({ level: 'warn', message: 'Idle PostgreSQL connection interrupted.', code: error.code || 'DATABASE_CONNECTION' })));
  const adapter = wrapExecutor(pool);
  adapter.getConnection = async () => {
    const client = await pool.connect();
    const control = async sql => { try { return await client.query(sql); } catch (error) { throw normalizePostgresError(error); } };
    return { ...wrapExecutor(client),
      beginTransaction: () => control('BEGIN'), commit: () => control('COMMIT'),
      rollback: () => control('ROLLBACK'), release: () => client.release(),
      // Only migrations use this for trusted, checked-in PostgreSQL DDL.
      runScript: sql => client.query(sql),
    };
  };
  adapter.end = () => pool.end();
  adapter.runScript = sql => pool.query(sql);
  return adapter;
}
