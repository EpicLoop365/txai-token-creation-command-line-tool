/* ===== TXAI Smart Token Studio - Configuration ===== */

/* API & Mode */
const API_URL = 'https://txai-token-creation-production.up.railway.app';
let liveMode = true;
let chatMode = false;
let chatHistory = [];
let chatBusy = false;
let demoRunning = false;
let _pendingPreset = null;
let customizeOpen = false;

/* DEX Constants */
const DEX_QUOTE_DENOM = 'utestcore';
const DEX_QUOTE_SYMBOL = 'TX';
const DEX_DECIMALS = 6;
const DEX_REFRESH_MS = 10000;

let dexSide = 'buy';
let dexOrderType = 'limit';
let dexBaseDenom = '';
let dexRefreshTimer = null;
let dexChatHistory = [];
let dexAgentWallet = '';
let dexLastOrderbook = null;
let dexPrevOrderbook = null;
let dexTradeLog = [];
let dexSessionLog = [];
let dexBalances = {};

/* ---- Wallet Connection ---- */
let walletMode = 'agent';          // 'agent' | 'keplr' | 'leap'
let connectedAddress = '';
let connectedOfflineSigner = null;

const COREUM_CHAIN_ID = 'coreum-testnet-1';
const COREUM_REST = 'https://full-node.testnet-1.coreum.dev:1317';

const COREUM_CHAIN_INFO = {
  chainId: 'coreum-testnet-1',
  chainName: 'Coreum Testnet',
  rpc: 'https://full-node.testnet-1.coreum.dev:26657',
  rest: 'https://full-node.testnet-1.coreum.dev:1317',
  bip44: { coinType: 990 },
  bech32Config: {
    bech32PrefixAccAddr: 'testcore',
    bech32PrefixAccPub: 'testcorepub',
    bech32PrefixValAddr: 'testcorevaloper',
    bech32PrefixValPub: 'testcorevaloperpub',
    bech32PrefixConsAddr: 'testcorevalcons',
    bech32PrefixConsPub: 'testcorevalconspub',
  },
  currencies: [{ coinDenom: 'TESTCORE', coinMinimalDenom: 'utestcore', coinDecimals: 6 }],
  feeCurrencies: [{
    coinDenom: 'TESTCORE', coinMinimalDenom: 'utestcore', coinDecimals: 6,
    gasPriceStep: { low: 0.1, average: 0.15, high: 0.25 }
  }],
  stakeCurrency: { coinDenom: 'TESTCORE', coinMinimalDenom: 'utestcore', coinDecimals: 6 },
  features: [],
};


/* Shared Utilities */
function escapeHtml(str){
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}


function sleep(ms){return new Promise(r=>setTimeout(r,ms))}

function syntaxHL(json){
  return json.replace(/(".*?")\s*:/g,'<span class="jk">$1</span>:')
    .replace(/:\s*(".*?")/g,': <span class="js">$1</span>')
    .replace(/:\s*(\d+\.?\d*)/g,': <span class="jn">$1</span>')
    .replace(/:\s*(true|false|null)/g,': <span class="jb">$1</span>');
}

function streamLine(el,text){
  let i=0;
  return new Promise(r=>{
    const iv=setInterval(()=>{if(i<text.length){el.textContent+=text[i++]}else{clearInterval(iv);el.textContent+='
';r()}},8);
  });
}

