/* ===== TXAI - txdb: Hybrid On-Chain + Local Database ===== */
/*
 * txdb is a dual-layer persistence system for AI agents:
 *
 *   Layer 1 (localStorage) — fast cache, instant reads, browser-scoped
 *   Layer 2 (TX blockchain) — permanent storage via transaction memos
 *
 * Every write goes to localStorage immediately. Critical data (tokens, swarms)
 * also gets written to the blockchain as a self-transfer with structured memo:
 *
 *   txdb:v1:tokens:{"s":"GEMS","d":"gems-testcore1...","tx":"A1B2C3..."}
 *
 * The chain is the source of truth. localStorage is the fast cache.
 * scan() rebuilds local state from on-chain history.
 */

const TXDB_KEY = 'txai_db';
const TXDB_VERSION = '2.0.0';

/* ── Core Read / Write (Local) ── */
function txdbLoad() {
  try {
    const raw = localStorage.getItem(TXDB_KEY);
    if (!raw) return txdbDefault();
    const db = JSON.parse(raw);
    if (db.version !== TXDB_VERSION) return txdbMigrate(db);
    return db;
  } catch (err) {
    console.warn('txdb: Failed to load, using defaults', err);
    return txdbDefault();
  }
}

function txdbSave(db) {
  try {
    db.lastUpdated = Date.now();
    localStorage.setItem(TXDB_KEY, JSON.stringify(db));
  } catch (err) {
    console.warn('txdb: Failed to save', err);
  }
}

function txdbDefault() {
  return {
    version: TXDB_VERSION,
    lastUpdated: Date.now(),
    createdTokens: [],
    swarmHistory: [],
    dexSessions: [],
    chainIndex: [],       // txHashes of on-chain writes
    preferences: {
      lastUsedToken: '',
      lastTab: 'create',
    },
  };
}

function txdbMigrate(oldDb) {
  const db = txdbDefault();
  if (oldDb.createdTokens) db.createdTokens = oldDb.createdTokens;
  if (oldDb.swarmHistory) db.swarmHistory = oldDb.swarmHistory;
  if (oldDb.dexSessions) db.dexSessions = oldDb.dexSessions;
  if (oldDb.chainIndex) db.chainIndex = oldDb.chainIndex;
  if (oldDb.preferences) Object.assign(db.preferences, oldDb.preferences);
  txdbSave(db);
  return db;
}

/* ── On-Chain Write ── */
async function txdbChainWrite(collection, data) {
  try {
    const res = await fetch(`${API_URL}/api/txdb/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collection, data }),
    });
    const result = await res.json();
    if (result.error) throw new Error(result.error);

    // Track the on-chain write locally
    const db = txdbLoad();
    db.chainIndex.unshift({
      txHash: result.txHash,
      collection,
      height: result.height,
      bytesUsed: result.bytesUsed,
      timestamp: Date.now(),
    });
    if (db.chainIndex.length > 200) db.chainIndex = db.chainIndex.slice(0, 200);
    txdbSave(db);

    console.log(`txdb: Wrote to chain → ${collection} (${result.bytesUsed}/256 chars) tx:${result.txHash.slice(0, 12)}...`);
    return result;
  } catch (err) {
    console.warn('txdb: Chain write failed, data saved locally only:', err.message);
    return null;
  }
}

/* ── On-Chain Read ── */
async function txdbChainRead(txHash) {
  try {
    const res = await fetch(`${API_URL}/api/txdb/read/${txHash}`);
    const result = await res.json();
    if (result.error) return null;
    return result;
  } catch (err) {
    console.warn('txdb: Chain read failed:', err.message);
    return null;
  }
}

/* ── On-Chain Scan — rebuild local state from chain ── */
async function txdbChainScan(address, collection) {
  try {
    let url = `${API_URL}/api/txdb/scan?address=${encodeURIComponent(address)}`;
    if (collection) url += `&collection=${encodeURIComponent(collection)}`;

    const res = await fetch(url);
    const result = await res.json();
    if (result.error) throw new Error(result.error);

    console.log(`txdb: Scanned chain for ${address.slice(0, 12)}... → ${result.totalFound} entries`);
    return result;
  } catch (err) {
    console.warn('txdb: Chain scan failed:', err.message);
    return { entries: [], totalFound: 0 };
  }
}

/* ── Sync: Pull on-chain data into local cache ── */
async function txdbSync(address) {
  const result = await txdbChainScan(address);
  if (!result.entries || result.entries.length === 0) return 0;

  const db = txdbLoad();
  let imported = 0;

  for (const entry of result.entries) {
    if (entry.collection === 'tokens') {
      const d = entry.data;
      const exists = db.createdTokens.some(t => t.denom === (d.d || d.denom));
      if (!exists) {
        db.createdTokens.unshift({
          denom: d.d || d.denom || '',
          symbol: d.s || d.symbol || '',
          name: d.n || d.name || '',
          txHash: d.tx || d.txHash || entry.txHash,
          supply: d.sup || d.supply || '',
          decimals: d.dec || d.decimals || 6,
          features: d.f || d.features || {},
          walletAddress: address,
          network: 'testnet',
          timestamp: new Date(entry.timestamp || Date.now()).getTime(),
          chainTxHash: entry.txHash,
        });
        imported++;
      }
    } else if (entry.collection === 'swarms') {
      const d = entry.data;
      const exists = db.swarmHistory.some(r => r.chainTxHash === entry.txHash);
      if (!exists) {
        db.swarmHistory.unshift({
          id: d.id || Date.now(),
          token: d.tok || d.token || '',
          denom: d.d || d.denom || '',
          status: d.st || d.status || 'completed',
          orders: d.o || d.orders || 0,
          fills: d.fl || d.fills || 0,
          timestamp: new Date(entry.timestamp || Date.now()).getTime(),
          chainTxHash: entry.txHash,
        });
        imported++;
      }
    }
  }

  if (imported > 0) {
    txdbSave(db);
    console.log(`txdb: Synced ${imported} records from chain`);
  }
  return imported;
}

/* ── Created Tokens (local + chain) ── */
function txdbAddToken(tokenData) {
  const db = txdbLoad();
  const exists = db.createdTokens.some(t => t.denom === tokenData.denom);
  if (!exists) {
    db.createdTokens.unshift({
      denom: tokenData.denom || '',
      symbol: tokenData.symbol || tokenData.name || '',
      name: tokenData.name || '',
      txHash: tokenData.txHash || '',
      supply: tokenData.supply || '',
      decimals: tokenData.decimals || 6,
      features: tokenData.features || {},
      walletAddress: tokenData.walletAddress || '',
      network: tokenData.network || 'testnet',
      timestamp: Date.now(),
    });
    if (db.createdTokens.length > 50) db.createdTokens = db.createdTokens.slice(0, 50);
    txdbSave(db);

    // Also write to chain (non-blocking) — use compact keys to fit 256 chars
    const sym = (tokenData.symbol || tokenData.name || '').slice(0, 12);
    const denom = (tokenData.denom || '').slice(0, 80);
    txdbChainWrite('tokens', {
      s: sym,
      d: denom,
      tx: (tokenData.txHash || '').slice(0, 64),
      sup: tokenData.supply || '',
      f: Object.keys(tokenData.features || {}).join(','),
    });
  }
  return db;
}

function txdbGetTokens() {
  return txdbLoad().createdTokens;
}

function txdbGetTokenByDenom(denom) {
  return txdbLoad().createdTokens.find(t => t.denom === denom) || null;
}

/* ── Swarm History (local + chain) ── */
function txdbAddSwarmRun(runData) {
  const db = txdbLoad();
  db.swarmHistory.unshift({
    id: runData.id || Date.now(),
    token: runData.token || '',
    denom: runData.denom || '',
    status: runData.status || 'running',
    startTime: runData.startTime || new Date().toISOString(),
    duration: runData.duration || '',
    orders: runData.orders || 0,
    fills: runData.fills || 0,
    timestamp: Date.now(),
  });
  if (db.swarmHistory.length > 100) db.swarmHistory = db.swarmHistory.slice(0, 100);
  txdbSave(db);
  return db;
}

function txdbUpdateSwarmRun(id, updates) {
  const db = txdbLoad();
  const run = db.swarmHistory.find(r => r.id === id);
  if (run) {
    Object.assign(run, updates);
    txdbSave(db);

    // Write final state to chain when completed
    if (updates.status === 'completed' || updates.status === 'stopped') {
      txdbChainWrite('swarms', {
        tok: (run.token || '').slice(0, 12),
        d: (run.denom || '').slice(0, 80),
        st: run.status,
        o: run.orders || 0,
        fl: run.fills || 0,
      });
    }
  }
  return db;
}

function txdbGetSwarmHistory() {
  return txdbLoad().swarmHistory;
}

/* ── DEX Sessions (local only — too much data for memo) ── */
function txdbAddDexSession(sessionData) {
  const db = txdbLoad();
  db.dexSessions.unshift({
    id: Date.now(),
    baseDenom: sessionData.baseDenom || '',
    orders: sessionData.orders || 0,
    fills: sessionData.fills || 0,
    startTime: sessionData.startTime || new Date().toISOString(),
    endTime: new Date().toISOString(),
    log: sessionData.log || [],
  });
  if (db.dexSessions.length > 50) db.dexSessions = db.dexSessions.slice(0, 50);
  txdbSave(db);
  return db;
}

function txdbGetDexSessions() {
  return txdbLoad().dexSessions;
}

/* ── User Preferences ── */
function txdbSetPref(key, value) {
  const db = txdbLoad();
  db.preferences[key] = value;
  txdbSave(db);
}

function txdbGetPref(key, fallback) {
  const db = txdbLoad();
  return db.preferences[key] !== undefined ? db.preferences[key] : fallback;
}

/* ── Utility ── */
function txdbClear() {
  localStorage.removeItem(TXDB_KEY);
}

function txdbExport() {
  return JSON.stringify(txdbLoad(), null, 2);
}

function txdbImport(jsonStr) {
  try {
    const data = JSON.parse(jsonStr);
    if (data.version) {
      txdbSave(data);
      return true;
    }
  } catch {}
  return false;
}

/* ── Chain Index Stats ── */
function txdbChainStats() {
  const db = txdbLoad();
  return {
    totalChainWrites: db.chainIndex.length,
    lastWrite: db.chainIndex[0] || null,
    byCollection: db.chainIndex.reduce((acc, e) => {
      acc[e.collection] = (acc[e.collection] || 0) + 1;
      return acc;
    }, {}),
  };
}

const _txdbInit = txdbLoad();
console.log(`txdb v${TXDB_VERSION}: ${_txdbInit.createdTokens.length} tokens, ${_txdbInit.swarmHistory.length} swarm runs, ${(_txdbInit.chainIndex || []).length} chain writes`);
