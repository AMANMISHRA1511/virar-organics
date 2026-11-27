import { randomUUID } from 'node:crypto';
import { z } from 'zod';
export const fail = (message, status = 400, code) => Object.assign(new Error(message), { status, code });
export const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
export const parse = (schema, body) => { const result = schema.safeParse(body); if (!result.success) throw fail(result.error.issues.map(i => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '), 422, 'VALIDATION'); return result.data; };
export const idSchema = z.coerce.number().int().positive();
export const id = value => parse(idSchema, value);
export const text = (max = 500, min = 0) => z.string().trim().min(min).max(max);
export const email = z.string().trim().toLowerCase().email().max(190);
export const phone = z.string().trim().regex(/^\+?[0-9 ()-]{8,20}$/, 'Enter a valid phone number');
export const password = z.string().min(10).max(72).refine(v => Buffer.byteLength(v, 'utf8') <= 72, 'Password must contain at most 72 UTF-8 bytes.');
export const latitude = z.coerce.number().min(-90).max(90);
export const longitude = z.coerce.number().min(-180).max(180);
export const pagination = req => ({ page: Math.max(1, Math.min(100000, Number(req.query.page) || 1)) | 0, limit: Math.max(1, Math.min(100, Number(req.query.limit) || 24)) | 0 });
export async function paged(req, executor, sql, countSql, params = []) { const { page, limit } = pagination(req); const [items] = await executor.query(`${sql} LIMIT ? OFFSET ?`, [...params, limit, (page - 1) * limit]); const [[{ total }]] = await executor.execute(countSql, params); return { items, total: Number(total), page, limit }; }
export const money = value => Math.round(Number(value) * 100) / 100;
export const cents = value => Math.round(Number(value) * 100);
export const requestId = (req, res, next) => { req.requestId = randomUUID(); res.set('X-Request-ID', req.requestId); next(); };
export function csv(rows, keys) { const cell = v => { const s = String(v ?? ''); return '"' + (/^\s*[=+@\-]|^[\t\r\n]/.test(s) ? "'" : '') + s.replaceAll('"', '""') + '"'; }; return '\uFEFF' + [keys.map(cell).join(','), ...rows.map(r => keys.map(k => cell(r[k])).join(','))].join('\r\n'); }
export const dateOnly = z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v, 'Invalid date')]).nullable().optional();
