// A deliberately bounded dialect adapter for this application's parameterized SQL.
// Values never enter SQL text. Unknown insert/upsert shapes fail rather than
// silently changing constraint or idempotency behavior.
const insertKeys = Object.freeze({
  schema_migrations: 'version', users: 'id', categories: 'id', products: 'id',
  settings: 'id', carts: 'user_id', orders: 'id', order_items: 'id',
  order_activity: 'id', leads: 'id', lead_notes: 'id', audit_log: 'id',
  payment_events: 'id', notifications: 'id', uploads: 'id',
  google_challenges: 'id', phone_verifications: 'id', account_addresses: 'id',
  catalogue_state: 'id', realtime_events: 'id', in_app_notifications: 'id',
});
const upsertKeys = Object.freeze({ settings: 'id', carts: 'user_id', uploads: 'filename' });
const aliases = new Map(['ordersToday', 'revenueMonth', 'totalOrders', 'newLeads',
  'todayFollowups', 'lowStock'].map(name => [name.toLowerCase(), name]));
const unitNames = new Set(['SECOND', 'MINUTE', 'HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR']);
const significant = token => token && token.kind !== 'space' && token.kind !== 'comment';
const upper = token => token?.kind === 'word' ? token.text.toUpperCase() : token?.text;
const next = (tokens, index) => { while (index < tokens.length && !significant(tokens[index])) index++; return index; };

export function tokenizeSql(sql) {
  if (typeof sql !== 'string') throw new TypeError('SQL must be a string.');
  const tokens = []; let i = 0;
  while (i < sql.length) {
    const start = i, ch = sql[i];
    if (/\s/.test(ch)) { while (/\s/.test(sql[++i] || '') && i < sql.length); tokens.push({ kind: 'space', text: sql.slice(start, i) }); continue; }
    if (sql.startsWith('--', i) || ch === '#') { while (i < sql.length && sql[i] !== '\n') i++; tokens.push({ kind: 'comment', text: sql.slice(start, i) }); continue; }
    if (sql.startsWith('/*', i)) { const end = sql.indexOf('*/', i + 2); if (end < 0) throw new Error('Unclosed SQL comment.'); i = end + 2; tokens.push({ kind: 'comment', text: sql.slice(start, i) }); continue; }
    if (["'", '"', '`'].includes(ch)) {
      const quote = ch; i++; let closed = false;
      while (i < sql.length) {
        if (sql[i] === '\\' && quote === "'") { i += 2; continue; }
        if (sql[i] === quote) { if (sql[i + 1] === quote) { i += 2; continue; } i++; closed = true; break; }
        i++;
      }
      if (!closed) throw new Error('Unclosed SQL quote.');
      const value = sql.slice(start, i);
      tokens.push({ kind: quote === "'" ? 'string' : 'identifier', text: quote === '`' ? '"' + value.slice(1, -1).replaceAll('``', '`').replaceAll('"', '""') + '"' : value }); continue;
    }
    if (ch === '$') {
      const delimiter = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];
      if (delimiter) { const end = sql.indexOf(delimiter, i + delimiter.length); if (end < 0) throw new Error('Unclosed SQL dollar quote.'); i = end + delimiter.length; tokens.push({ kind: 'string', text: sql.slice(start, i) }); continue; }
      const parameter = sql.slice(i).match(/^\$[1-9][0-9]*/)?.[0];
      if (parameter) { i += parameter.length; tokens.push({ kind: 'nativeParameter', text: parameter }); continue; }
    }
    if (ch === '?') { i++; tokens.push({ kind: 'parameter', text: '?' }); continue; }
    if (/[A-Za-z_]/.test(ch)) { i++; while (i < sql.length && /[A-Za-z_0-9$]/.test(sql[i])) i++; tokens.push({ kind: 'word', text: sql.slice(start, i) }); continue; }
    if (/[0-9]/.test(ch)) { i++; while (i < sql.length && /[0-9.]/.test(sql[i])) i++; tokens.push({ kind: 'number', text: sql.slice(start, i) }); continue; }
    i++; tokens.push({ kind: 'punctuation', text: ch });
  }
  return tokens;
}

function closeParen(tokens, open) {
  let depth = 0;
  for (let i = open; i < tokens.length; i++) {
    if (tokens[i].kind !== 'punctuation') continue;
    if (tokens[i].text === '(') depth++;
    else if (tokens[i].text === ')' && --depth === 0) return i;
  }
  throw new Error('Unbalanced SQL parentheses.');
}
function splitArguments(tokens) {
  const args = []; let start = 0, depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind !== 'punctuation') continue;
    if (tokens[i].text === '(') depth++;
    else if (tokens[i].text === ')') depth--;
    else if (tokens[i].text === ',' && depth === 0) { args.push(tokens.slice(start, i)); start = i + 1; }
  }
  if (tokens.some(significant)) args.push(tokens.slice(start));
  return args;
}
function functionSql(name, args, fallback, excludedValues) {
  switch (name) {
    case 'UTC_TIMESTAMP': if (args.length === 0) return 'CURRENT_TIMESTAMP'; break;
    case 'DATABASE': if (args.length === 0) return 'current_database()'; break;
    case 'DATE_ADD': if (args.length === 2) return `(${args[0]} + ${args[1]})`; break;
    case 'DATE_SUB': if (args.length === 2) return `(${args[0]} - ${args[1]})`; break;
    case 'TIMESTAMPDIFF': {
      const divisors = { SECOND: 1, MINUTE: 60, HOUR: 3600, DAY: 86400 };
      const divisor = divisors[args[0]?.toUpperCase()];
      if (args.length === 3 && divisor) return `TRUNC(EXTRACT(EPOCH FROM ((${args[2]}) - (${args[1]}))) / ${divisor})`;
      break;
    }
    case 'CONVERT_TZ':
      if (args.length === 3 && args[1] === "'+00:00'" && args[2] === "'+05:30'") return `(${args[0]} AT TIME ZONE 'Asia/Kolkata')`;
      throw new Error('Unsupported timezone conversion. Add an explicit audited PostgreSQL equivalent.');
    case 'DATE_FORMAT': {
      const formats = { "'%Y-%m'": "'YYYY-MM'", "'%Y-%m-%d'": "'YYYY-MM-DD'" };
      if (args.length === 2 && formats[args[1]]) return `TO_CHAR(${args[0]}, ${formats[args[1]]})`;
      throw new Error('Unsupported date format. Add an explicit audited PostgreSQL equivalent.');
    }
    case 'CAST': return `CAST(${args.join(', ').replace(/\bAS\s+CHAR\s*$/i, 'AS TEXT')})`;
    case 'VALUES':
      if (excludedValues && args.length === 1 && /^[a-z_][a-z_0-9]*$/i.test(args[0])) return `EXCLUDED.${args[0]}`;
      break;
    case 'GET_LOCK': case 'RELEASE_LOCK':
      throw new Error('MySQL named locks have no implicit PostgreSQL substitute. Use an explicit advisory-lock operation.');
  }
  return fallback;
}

function render(tokens, state, excludedValues = false) {
  const output = [];
  for (let i = 0; i < tokens.length;) {
    const token = tokens[i], name = upper(token);
    if (token.kind === 'parameter') { output.push('$' + (++state.parameters)); i++; continue; }
    if (token.kind === 'nativeParameter') { state.nativeParameters.add(Number(token.text.slice(1))); output.push(token.text); i++; continue; }
    if (token.kind !== 'word') { output.push(token.text); i++; continue; }
    const following = next(tokens, i + 1);
    if (name === 'INTERVAL') {
      let numberIndex = following, sign = '';
      if (tokens[numberIndex]?.text === '-') { sign = '-'; numberIndex = next(tokens, numberIndex + 1); }
      const unitIndex = next(tokens, numberIndex + 1), unit = upper(tokens[unitIndex]);
      if (tokens[numberIndex]?.kind === 'number' && /^\d+$/.test(tokens[numberIndex].text) && unitNames.has(unit)) {
        output.push(`INTERVAL '${sign}${tokens[numberIndex].text} ${unit.toLowerCase()}'`); i = unitIndex + 1; continue;
      }
    }
    if (tokens[following]?.text === '(') {
      const closing = closeParen(tokens, following);
      const args = splitArguments(tokens.slice(following + 1, closing)).map(arg => render(arg, state, excludedValues).trim());
      const fallback = token.text + tokens.slice(i + 1, following).map(t => t.text).join('') + '(' + args.join(', ') + ')';
      output.push(functionSql(name, args, fallback, excludedValues)); i = closing + 1; continue;
    }
    // JSON fields require a text cast for the reference-protection searches.
    let end = i, identifier = token.text;
    while (tokens[next(tokens, end + 1)]?.text === '.') {
      const part = next(tokens, next(tokens, end + 1) + 1);
      if (tokens[part]?.kind !== 'word') break;
      identifier += '.' + tokens[part].text; end = part;
    }
    const afterIdentifier = next(tokens, end + 1);
    const comparison = upper(tokens[afterIdentifier]) === 'NOT' ? next(tokens, afterIdentifier + 1) : afterIdentifier;
    if (['images', 'content'].includes(tokens[end].text.toLowerCase()) && upper(tokens[comparison]) === 'LIKE') {
      output.push(`CAST(${identifier} AS TEXT)`); i = end + 1; continue;
    }
    if (name === 'LIKE') output.push('ILIKE');
    else if (aliases.has(token.text.toLowerCase())) output.push('"' + aliases.get(token.text.toLowerCase()) + '"');
    else output.push(token.text);
    i++;
  }
  return output.join('');
}

function sequenceAt(tokens, index, words) {
  let position = index;
  for (const word of words) { position = next(tokens, position); if (upper(tokens[position]) !== word) return null; position++; }
  return position;
}
export function compilePostgres(sql, values = []) {
  const tokens = tokenizeSql(sql.trim());
  let last = tokens.length - 1; while (last >= 0 && !significant(tokens[last])) last--;
  if (tokens[last]?.text === ';') tokens.splice(last, 1);
  if (tokens.some(t => t.kind === 'punctuation' && t.text === ';')) throw new Error('Application queries must contain one SQL statement.');
  const first = next(tokens, 0), isInsert = upper(tokens[first]) === 'INSERT';
  let ignore = false, insertKey = null, table;
  if (isInsert) {
    const second = next(tokens, first + 1);
    if (upper(tokens[second]) === 'IGNORE') { ignore = true; tokens.splice(second, 1); }
    const into = next(tokens, first + 1), tableIndex = next(tokens, into + 1);
    if (upper(tokens[into]) !== 'INTO' || tokens[tableIndex]?.kind !== 'word') throw new Error('Unsupported INSERT shape.');
    table = tokens[tableIndex].text.toLowerCase(); insertKey = insertKeys[table];
    if (!insertKey) throw new Error('Unregistered insert table. Add its primary key to the PostgreSQL adapter.');
  }
  let upsertStart = -1, upsertEnd;
  for (let i = 0; i < tokens.length; i++) {
    if (upper(tokens[i]) !== 'ON') continue;
    const end = sequenceAt(tokens, i, ['ON', 'DUPLICATE', 'KEY', 'UPDATE']);
    if (end !== null) { upsertStart = i; upsertEnd = end; break; }
  }
  const state = { parameters: 0, nativeParameters: new Set() };
  let text;
  if (upsertStart >= 0) {
    const conflictKey = upsertKeys[table];
    if (!isInsert || ignore || !conflictKey) throw new Error('Unsupported upsert target. Add an explicit conflict key.');
    text = render(tokens.slice(0, upsertStart), state).trimEnd() + ` ON CONFLICT (${conflictKey}) DO UPDATE SET ` + render(tokens.slice(upsertEnd), state, true).trimStart();
  } else {
    text = render(tokens, state).trim();
    if (ignore) text += ' ON CONFLICT DO NOTHING';
  }
  if (isInsert && !tokens.some(t => upper(t) === 'RETURNING')) text += ` RETURNING ${insertKey}`;
  if (state.parameters && state.nativeParameters.size) throw new Error('Do not mix SQL placeholder styles.');
  const parameterCount = state.parameters || Math.max(0, ...state.nativeParameters);
  if (parameterCount !== values.length) throw new Error('SQL parameter count does not match bound values.');
  const parameters = values.map(value => {
    if (value === undefined) throw new TypeError('SQL parameters cannot be undefined; use null explicitly.');
    // PostgreSQL SMALLINT flag columns intentionally preserve mysql2's 0/1 rows.
    // Buffers, dates, JSON strings and every other bound value remain untouched.
    return typeof value === 'boolean' ? Number(value) : value;
  });
  return { text, values: parameters, insertKey };
}

export function safeInteger(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new RangeError('Database integer exceeds JavaScript safe-integer precision.');
  return number;
}
export function finiteDecimal(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new RangeError('Database returned a non-finite decimal.');
  return number;
}
export function normalizePostgresError(error) {
  if (!error || typeof error !== 'object') return error;
  const codes = { '23505': 'ER_DUP_ENTRY', '23503': 'ER_ROW_IS_REFERENCED_2',
    '23514': 'ER_CHECK_CONSTRAINT_VIOLATED', '23502': 'ER_BAD_NULL_ERROR',
    '40P01': 'ER_LOCK_DEADLOCK', '40001': 'ER_LOCK_DEADLOCK',
    '42P01': 'ER_NO_SUCH_TABLE', '42703': 'ER_BAD_FIELD_ERROR',
    '22001': 'ER_DATA_TOO_LONG', '22003': 'ER_WARN_DATA_OUT_OF_RANGE' };
  if (codes[error.code]) { error.sqlState = error.code; error.code = codes[error.code]; }
  return error;
}
