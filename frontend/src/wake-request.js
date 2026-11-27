// Free hosting can take a minute to wake. Retry safe reads only; checkout,
// uploads and all other mutations are never replayed by this transport.
const transient = new Set([502, 503, 504]);
function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
export async function wakeRequest(url, options = {}, dependencies = {}) {
  const send = dependencies.fetch || globalThis.fetch;
  if (!['GET', 'HEAD'].includes((options.method || 'GET').toUpperCase())) return send(url, options);
  const pause = dependencies.wait || wait;
  const timeout = dependencies.timeout || (ms => AbortSignal.timeout(ms));
  for (let attempt = 0; attempt < 4; attempt++) {
    options.signal?.throwIfAborted();
    const signal = options.signal ? AbortSignal.any([options.signal, timeout(26000)]) : timeout(26000);
    let response;
    try {
      response = await send(url, { ...options, signal });
    } catch (error) {
      if (options.signal?.aborted || attempt === 3 || !['TypeError', 'TimeoutError'].includes(error.name)) throw error;
      await pause(1000, options.signal);
      continue;
    }
    if (!transient.has(response.status) || attempt === 3) return response;
    await response.body?.cancel();
    await pause(1000, options.signal);
  }
}
