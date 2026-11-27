// ioredis status='ready' precedes subscription acknowledgements on reconnect.
// Keep command connectivity distinct from this process's live-message readiness.
export function subscriptionReadiness(client, channel) {
  let enabled = false, acknowledged = false, generation = 0;
  const clear = () => { generation++; acknowledged = false; };
  async function subscribe() {
    const attempt = ++generation; acknowledged = false;
    if (client.status !== 'ready') return false;
    try {
      await client.subscribe(channel);
      if (generation === attempt && client.status === 'ready') acknowledged = true;
    } catch { /* A later ready event retries; readiness remains false. */ }
    return acknowledged;
  }
  for (const event of ['close', 'end', 'reconnecting']) client.on(event, clear);
  client.on('ready', () => { if (enabled) void subscribe(); });
  return {
    // Enable after the adapter's initial subscriptions have been queued.
    enable() { enabled = true; return subscribe(); },
    ready() { return acknowledged && client.status === 'ready'; },
  };
}

export function acknowledgedPublications(results, expected) {
  return Array.isArray(results) && results.length === expected && expected > 0
    && results.every(result => Array.isArray(result) && !result[0] && Number(result[1]) > 0);
}
