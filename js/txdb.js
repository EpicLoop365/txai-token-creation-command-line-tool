/* ===== TXAI - txdb: Persistent localStorage Database ===== */
/* Stores swarm history, created tokens, user preferences, and DEX session data */

const TXDB_KEY = 'txai_db';
const TXDB_VERSION = '1.0.0';

/* ── Core Read / Write ── */
function txdbLoad() {
  try {
    const raw = localStorage.getItem(TXDB_KEY);
    if (!raw) return txdbDefault();
    const db = JSON.parse(raw);
    // Version migration if needed
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
    preferences: {
      lastUsedToken: '',
      lastTab: 'create',
    },
  };
}

function txdbMigrate(oldDb) {
  // Simple migration: preserve data, update version
  const db = txdbDefault();
  if (oldDb.createdTokens) db.createdTokens = oldDb.createdTokens;
  if (oldDb.swarmHistory) db.swarmHistory = oldDb.swarmHistory;
  if (oldDb.dexSessions) db.dexSessions = oldDb.dexSessions;
  if (oldDb.preferences) Object.assign(db.preferences, oldDb.preferences);
  txdbSave(db);
  return db;
}

/* ── Created Tokens ── */
function txdbAddToken(tokenData) {
  const db = txdbLoad();
  // Avoid duplicates by denom
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
    // Keep last 50 tokens
    if (db.createdTokens.length > 50) db.createdTokens = db.createdTokens.slice(0, 50);
    txdbSave(db);
  }
  return db;
}

function txdbGetTokens() {
  return txdbLoad().createdTokens;
}

function txdbGetTokenByDenom(denom) {
  return txdbLoad().createdTokens.find(t => t.denom === denom) || null;
}

/* ── Swarm History ── */
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
  // Keep last 100 runs
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
  }
  return db;
}

function txdbGetSwarmHistory() {
  return txdbLoad().swarmHistory;
}

/* ── DEX Sessions ── */
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
  // Keep last 50 sessions
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

console.log('txdb: Loaded', txdbLoad().createdTokens.length, 'tokens,', txdbLoad().swarmHistory.length, 'swarm runs');
