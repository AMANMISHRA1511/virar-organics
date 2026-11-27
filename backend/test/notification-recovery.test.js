import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotificationRuntime, notificationRetryPlan } from '../src/notifications.js';

// A deterministic SQL/queue boundary fixture. SQL state survives resetQueue();
// the queue and its retry counters do not. No provider or network is contacted.
function fixture(initial = []) {
  let clock = Date.UTC(2026, 0, 1), available = true, tail = Promise.resolve();
  let records = new Map((initial.length ? initial : [{ id: 1 }]).map(value => [value.id, {
    status: 'pending', attempts: 0, attempt_limit: 4, retry_at: null, lease_until: null,
    delivery_mode: 'configured', ...value,
  }]));
  const jobs = new Map(), events = [];
  let calls = 0, sending = async () => { throw new Error('Synthetic provider failure'); };
  const eligible = (sql, row) => {
    const statuses = sql.match(/status IN \(([^)]+)\)/)?.[1].match(/'([^']+)'/g)?.map(x => x.slice(1, -1));
    return (!statuses || statuses.includes(row.status))
      && (!sql.includes('attempts<attempt_limit') || row.attempts < row.attempt_limit)
      && (!sql.includes('retry_at<=UTC_TIMESTAMP()') || !row.retry_at || Number(row.retry_at) <= clock);
  };
  const query = async (sql, values = []) => {
    if (sql.startsWith('SELECT * FROM notifications')) {
      const row = records.get(values[0]); return row ? [{ ...row }] : [];
    }
    if (sql.startsWith('SELECT id FROM notifications')) return [...records.values()].filter(row => eligible(sql, row)).map(({ id }) => ({ id }));
    if (sql.includes('SET status=CASE')) {
      let affectedRows = 0;
      for (const row of records.values()) if (row.status === 'sending' && (!row.lease_until || Number(row.lease_until) <= clock)) {
        row.status = row.attempts < row.attempt_limit ? 'pending' : 'failed';
        row.lease_until = null; row.retry_at = null; affectedRows++;
      }
      return { affectedRows };
    }
    if (sql.includes("SET status='sending'")) {
      const row = records.get(values[0]);
      if (!row || !eligible(sql, row)) return { affectedRows: 0 };
      row.status = 'sending'; row.attempts++; row.error = null;
      row.lease_until = new Date(clock + 60000); row.retry_at = null;
      return { affectedRows: 1 };
    }
    if (sql.includes('SET status=?,provider_id=')) {
      const [status, provider_id, error, id, attempt] = values, row = records.get(id);
      if (!row || row.status !== 'sending' || row.attempts !== attempt) return { affectedRows: 0 };
      Object.assign(row, { status, provider_id, error, sent_at: new Date(clock), lease_until: null, retry_at: null });
      return { affectedRows: 1 };
    }
    if (sql.includes("SET status='failed',error=?")) {
      const [error, retry_at, id, attempt] = values, row = records.get(id);
      if (!row || row.status !== 'sending' || row.attempts !== attempt) return { affectedRows: 0 };
      Object.assign(row, { status: 'failed', error, retry_at, lease_until: null });
      return { affectedRows: 1 };
    }
    if (sql.includes("SET status='queued'")) {
      const row = records.get(values[0]);
      if (!row || !eligible(sql, row)) return { affectedRows: 0 };
      row.status = 'queued'; return { affectedRows: 1 };
    }
    if (sql.includes('attempt_limit=attempts+?')) {
      const [allowance, id] = values, row = records.get(id);
      Object.assign(row, { status: 'pending', attempt_limit: row.attempts + allowance, error: null, retry_at: null, lease_until: null });
      return { affectedRows: 1 };
    }
    throw new Error('Unexpected notification SQL in fixture');
  };
  const transact = fn => {
    const running = tail.then(async () => {
      const before = structuredClone(records);
      try { return await fn({}); }
      catch (error) { records = before; throw error; }
    });
    tail = running.catch(() => {}); return running;
  };
  const queue = {
    async getJob(id) { return jobs.get(id); },
    async add(name, data, options) {
      if (jobs.has(options.jobId)) return jobs.get(options.jobId);
      const job = { data, options, state: 'waiting',
        async getState() { return this.state; },
        async remove() { if (this.state === 'active') throw new Error('Job is active'); jobs.delete(options.jobId); },
      };
      jobs.set(options.jobId, job); return job;
    },
  };
  const runtime = createNotificationRuntime({
    query, transact, getQueue: () => queue, ready: () => available, now: () => new Date(clock),
    send: async row => { calls++; return sending(row); }, publish: (...args) => events.push(args),
  });
  return {
    runtime, jobs, events, record: (id = 1) => records.get(id), calls: () => calls,
    time: () => clock, advance: milliseconds => { clock += milliseconds; },
    setReady: value => { available = value; }, setSend: fn => { sending = fn; },
    resetQueue: () => jobs.clear(), settle: () => new Promise(resolve => setImmediate(resolve)),
    async run(id = 1) {
      const job = jobs.get(`notification-${id}`); assert.ok(job, 'Expected a recoverable queued notification');
      job.state = 'active';
      try { await runtime.process(job); job.state = 'completed'; return null; }
      catch (error) { job.state = 'failed'; return error; }
    },
  };
}

test('SQL retries survive queue resets and stop after exactly four provider failures', async () => {
  const f = fixture();
  for (let attempt = 1; attempt <= 4; attempt++) {
    await f.runtime.pump();
    assert.equal(f.jobs.get('notification-1').options.attempts, 1);
    assert.ok(await f.run());
    assert.equal(f.record().status, 'failed'); assert.equal(f.record().attempts, attempt);
    const due = f.record().retry_at;
    f.resetQueue(); await f.runtime.pump(); assert.equal(f.jobs.size, 0);
    if (attempt < 4) {
      assert.equal(Number(due) - f.time(), 1000 * 2 ** (attempt - 1));
      f.advance(Number(due) - f.time());
    } else assert.equal(due, null);
  }
  for (let reset = 0; reset < 5; reset++) { f.resetQueue(); f.advance(120000); await f.runtime.pump(); }
  assert.equal(f.calls(), 4); assert.equal(f.jobs.size, 0); assert.equal(f.record().attempts, 4);
});

test('Manual retry persists while Redis is offline and succeeds at lifetime attempt five', async () => {
  const f = fixture([{ id: 1, status: 'failed', attempts: 4 }]);
  f.setReady(false);
  assert.equal(await f.runtime.retry(1), true);
  assert.equal(await f.runtime.retry(1), true);
  assert.equal(f.record().attempts, 4); assert.equal(f.record().attempt_limit, 8);
  assert.equal(f.record().status, 'pending'); assert.equal(f.jobs.size, 0);
  f.setSend(async () => ({ status: 'sent', providerId: 'synthetic-accepted' }));
  f.setReady(true); await f.runtime.pump(); assert.equal(await f.run(), null);
  assert.equal(f.record().status, 'sent'); assert.equal(f.record().attempts, 5);
  assert.equal(await f.runtime.retry(1), false);
});

test('A manual retry starts a fresh bounded backoff cycle without resetting lifetime attempts', () => {
  for (const [attempts, delay] of [[5, 1000], [6, 2000], [7, 4000]]) {
    const plan = notificationRetryPlan({ attempts, attempt_limit: 8 }, new Date(0));
    assert.equal(Number(plan.retryAt), delay);
  }
  assert.equal(notificationRetryPlan({ attempts: 8, attempt_limit: 8 }).retryAt, null);
});

test('A queued duplicate cannot deliver while a SQL sending lease is active', async () => {
  const f = fixture(); let release, started;
  const began = new Promise(resolve => { started = resolve; });
  f.setSend(() => { started(); return new Promise(resolve => { release = resolve; }); });
  await f.runtime.pump();
  const first = f.runtime.process({ data: { id: 1 } }); await began;
  await f.runtime.process({ data: { id: 1 } });
  assert.equal(f.calls(), 1); assert.equal(f.record().attempts, 1);
  assert.equal(await f.runtime.retry(1), false);
  release({ status: 'sent' }); await first;
  assert.equal(f.record().status, 'sent');
});

test('Expired leases recover only within the persisted attempt limit', async () => {
  const f = fixture([
    { id: 1, status: 'sending', attempts: 2, lease_until: new Date(0) },
    { id: 2, status: 'sending', attempts: 4, lease_until: new Date(0) },
    { id: 3, status: 'sending', attempts: 1, lease_until: new Date(Date.UTC(2027, 0, 1)) },
  ]);
  f.setSend(async () => ({ status: 'simulated' }));
  await f.runtime.pump(); assert.deepEqual([...f.jobs.keys()], ['notification-1']);
  assert.equal(f.record(2).status, 'failed'); assert.equal(f.record(2).attempts, 4);
  assert.equal(f.record(3).status, 'sending');
  await f.run(); assert.equal(f.record().attempts, 3); assert.equal(f.record().status, 'simulated');
});

for (const staleFailure of [false, true]) test(`An expired worker's late ${staleFailure ? 'failure' : 'success'} cannot overwrite a recovered attempt`, async () => {
  const f = fixture(); let resolveOld, rejectOld, started;
  const began = new Promise(resolve => { started = resolve; });
  f.setSend(row => row.attempts === 1 ? new Promise((resolve, reject) => {
    resolveOld = resolve; rejectOld = reject; started();
  }) : Promise.resolve({ status: 'accepted', providerId: 'new-attempt' }));
  await f.runtime.pump();
  const old = f.runtime.process({ data: { id: 1 } }); const observedOld = old.catch(error => error);
  await began; f.advance(61000); f.resetQueue(); await f.runtime.pump(); await f.run();
  assert.equal(f.record().attempts, 2); assert.equal(f.record().status, 'accepted');
  if (staleFailure) rejectOld(new Error('Late synthetic provider failure'));
  else resolveOld({ status: 'sent', providerId: 'old-attempt' });
  await observedOld;
  assert.equal(f.record().status, 'accepted'); assert.equal(f.record().provider_id, 'new-attempt');
  assert.equal(f.record().retry_at, null); assert.equal(f.events.length, 1);
});

test('A stale Redis job cannot bypass the durable retry due time or exhausted budget', async () => {
  const f = fixture([{ id: 1, status: 'failed', attempts: 1, retry_at: new Date(Date.UTC(2026, 0, 1) + 4000) },
    { id: 2, status: 'queued', attempts: 4 }]);
  await f.runtime.process({ data: { id: 1 } }); await f.runtime.process({ data: { id: 2 } });
  await f.runtime.pump(); assert.equal(f.calls(), 0); assert.equal(f.jobs.size, 0);
  f.advance(4000); await f.runtime.pump(); assert.deepEqual([...f.jobs.keys()], ['notification-1']);
  await f.run(); assert.equal(f.record().attempts, 2); assert.equal(f.record(2).attempts, 4);
});

test('Terminal delivery states never re-enqueue or accept manual retries after Redis reset', async () => {
  const states = ['sent', 'accepted', 'simulated', 'skipped'];
  const f = fixture(states.map((status, index) => ({ id: index + 1, status })));
  f.resetQueue(); await f.runtime.pump(); assert.equal(f.jobs.size, 0);
  for (const id of [1, 2, 3, 4]) {
    await f.runtime.process({ data: { id } }); assert.equal(await f.runtime.retry(id), false);
  }
  assert.equal(f.calls(), 0); assert.equal(await f.runtime.retry(999), false);
});
