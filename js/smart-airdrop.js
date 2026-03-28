/* ===== TXAI — Smart Airdrop Agent ===== */
/* 3-step flow: Prompt -> Review -> Execute */
/* Vanilla JS, no frameworks. */

let _saState = {
  step: 1,
  parsed: null,
  resolved: null,
  recipients: [],
  csvFile: null,
  executing: false,
};

/* ── Open / Close ── */

function smartAirdropOpen() {
  _saResetState();
  let overlay = document.getElementById('smartAirdropOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'smartAirdropOverlay';
    overlay.className = 'smart-airdrop-overlay';
    overlay.onclick = function(e) { if (e.target === overlay) smartAirdropClose(); };
    overlay.innerHTML = _saBuildHTML();
    document.body.appendChild(overlay);
  } else {
    overlay.innerHTML = _saBuildHTML();
    overlay.style.display = 'flex';
  }
  requestAnimationFrame(function() { overlay.classList.add('sa-visible'); });
  _saSetupDragDrop();
}

function smartAirdropClose() {
  var overlay = document.getElementById('smartAirdropOverlay');
  if (!overlay) return;
  overlay.classList.remove('sa-visible');
  setTimeout(function() { overlay.style.display = 'none'; }, 300);
}

function _saResetState() {
  _saState = { step: 1, parsed: null, resolved: null, recipients: [], csvFile: null, executing: false };
}

/* ── Main HTML ── */

function _saBuildHTML() {
  return '<div class="smart-airdrop-modal">' +
    '<div class="sa-header">' +
      '<div class="sa-header-title">Smart Airdrop Agent</div>' +
      '<button class="sa-close-btn" onclick="smartAirdropClose()">&times;</button>' +
    '</div>' +
    '<div class="sa-steps-indicator">' +
      '<div class="sa-step-dot active" id="saStepDot1">1</div>' +
      '<div class="sa-step-line"></div>' +
      '<div class="sa-step-dot" id="saStepDot2">2</div>' +
      '<div class="sa-step-line"></div>' +
      '<div class="sa-step-dot" id="saStepDot3">3</div>' +
    '</div>' +
    '<div id="saStepContainer">' +
      _saBuildStep1() +
    '</div>' +
  '</div>';
}

/* ── Step 1: Prompt Input ── */

function _saBuildStep1() {
  return '<div class="smart-airdrop-step" id="saStep1">' +
    '<div class="sa-section-label">Describe your airdrop</div>' +
    '<textarea class="sa-prompt-input" id="saPromptInput" rows="4" placeholder="e.g. Airdrop 100 MYTOKEN to all stakers of validator testcorevaloper1..."></textarea>' +
    '<div class="sa-quick-actions">' +
      '<button class="sa-quick-btn" onclick="_saQuickAction(\'Stakers of \')">Stakers of...</button>' +
      '<button class="sa-quick-btn" onclick="_saQuickAction(\'NFT holders of \')">NFT holders of...</button>' +
      '<button class="sa-quick-btn" onclick="_saQuickAction(\'Token holders of \')">Token holders of...</button>' +
      '<button class="sa-quick-btn" onclick="document.getElementById(\'saCsvInput\').click()">Upload CSV</button>' +
    '</div>' +
    '<div class="sa-csv-zone" id="saCsvZone">' +
      '<input type="file" id="saCsvInput" accept=".csv,.txt" style="display:none" onchange="_saCsvSelected(this)">' +
      '<div class="sa-csv-zone-inner" id="saCsvZoneInner">' +
        '<div class="sa-csv-icon">CSV</div>' +
        '<div class="sa-csv-text">Drag & drop a CSV file, or click to browse</div>' +
        '<div class="sa-csv-hint">Format: address,amount (one per line)</div>' +
      '</div>' +
      '<div class="sa-csv-file-name" id="saCsvFileName" style="display:none"></div>' +
    '</div>' +
    '<div class="sa-paste-area">' +
      '<div class="sa-section-label" style="margin-top:12px">Or paste addresses directly</div>' +
      '<textarea class="sa-paste-input" id="saPasteInput" rows="3" placeholder="Paste addresses (one per line or comma-separated)"></textarea>' +
    '</div>' +
    '<div class="smart-airdrop-actions">' +
      '<button class="sa-btn sa-btn-secondary" onclick="smartAirdropClose()">Cancel</button>' +
      '<button class="sa-btn sa-btn-primary" id="saParseBtn" onclick="_saParse()">Parse</button>' +
    '</div>' +
    '<div class="sa-loading" id="saLoading1" style="display:none">' +
      '<div class="sa-spinner"></div>' +
      '<span>Claude is parsing your airdrop request...</span>' +
    '</div>' +
  '</div>';
}

function _saQuickAction(prefix) {
  var ta = document.getElementById('saPromptInput');
  if (ta) {
    ta.value = prefix;
    ta.focus();
    ta.setSelectionRange(prefix.length, prefix.length);
  }
}

function _saCsvSelected(input) {
  if (input.files && input.files[0]) {
    _saState.csvFile = input.files[0];
    var nameEl = document.getElementById('saCsvFileName');
    var innerEl = document.getElementById('saCsvZoneInner');
    if (nameEl && innerEl) {
      nameEl.textContent = input.files[0].name;
      nameEl.style.display = 'block';
      innerEl.style.display = 'none';
    }
  }
}

function _saSetupDragDrop() {
  var zone = document.getElementById('saCsvZone');
  if (!zone) return;
  zone.addEventListener('click', function(e) {
    if (e.target.closest('#saCsvInput')) return;
    document.getElementById('saCsvInput').click();
  });
  zone.addEventListener('dragover', function(e) {
    e.preventDefault();
    zone.classList.add('sa-drag-over');
  });
  zone.addEventListener('dragleave', function() {
    zone.classList.remove('sa-drag-over');
  });
  zone.addEventListener('drop', function(e) {
    e.preventDefault();
    zone.classList.remove('sa-drag-over');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      document.getElementById('saCsvInput').files = e.dataTransfer.files;
      _saCsvSelected(document.getElementById('saCsvInput'));
    }
  });
}

/* ── Parse call ── */

async function _saParse() {
  var prompt = (document.getElementById('saPromptInput')?.value || '').trim();
  var pasteAddresses = (document.getElementById('saPasteInput')?.value || '').trim();
  var csvData = null;

  if (_saState.csvFile) {
    csvData = await _saReadFile(_saState.csvFile);
  }

  if (!prompt && !pasteAddresses && !csvData) {
    alert('Enter an airdrop description, paste addresses, or upload a CSV.');
    return;
  }

  var btn = document.getElementById('saParseBtn');
  var loading = document.getElementById('saLoading1');
  if (btn) btn.disabled = true;
  if (loading) loading.style.display = 'flex';

  try {
    var body = { prompt: prompt };
    if (csvData) body.csv = csvData;
    if (pasteAddresses) body.addresses = pasteAddresses;

    var res = await fetch(API_URL + '/api/smart-airdrop/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    var data = await res.json();

    if (data.error) throw new Error(data.error);

    _saState.parsed = data;
    _saState.step = 2;
    _saGoToStep(2);
  } catch (err) {
    alert('Parse failed: ' + err.message);
  } finally {
    if (btn) btn.disabled = false;
    if (loading) loading.style.display = 'none';
  }
}

function _saReadFile(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function(e) { resolve(e.target.result); };
    reader.onerror = function() { reject(new Error('Failed to read file')); };
    reader.readAsText(file);
  });
}

/* ── Step Navigation ── */

function _saGoToStep(step) {
  _saState.step = step;

  // Update dots
  for (var i = 1; i <= 3; i++) {
    var dot = document.getElementById('saStepDot' + i);
    if (dot) {
      dot.classList.toggle('active', i <= step);
      dot.classList.toggle('completed', i < step);
    }
  }

  var container = document.getElementById('saStepContainer');
  if (!container) return;

  if (step === 1) container.innerHTML = _saBuildStep1();
  else if (step === 2) container.innerHTML = _saBuildStep2();
  else if (step === 3) container.innerHTML = _saBuildStep3();

  if (step === 1) _saSetupDragDrop();
}

/* ── Step 2: Review & Edit ── */

function _saBuildStep2() {
  var p = _saState.parsed || {};
  var r = _saState.resolved;

  var html = '<div class="smart-airdrop-step" id="saStep2">';

  // Parsed intent summary
  html += '<div class="sa-intent-summary">' +
    '<div class="sa-section-label">Parsed Intent</div>' +
    '<div class="sa-intent-detail"><span>Token:</span> <b>' + _saEsc(p.token || p.denom || 'N/A') + '</b></div>' +
    '<div class="sa-intent-detail"><span>Amount per address:</span> <b>' + _saEsc(String(p.amountEach || p.amount || 'N/A')) + '</b></div>' +
    '<div class="sa-intent-detail"><span>Sources:</span> <b>' + _saEsc((p.sources || []).map(function(s) { return s.type || s; }).join(', ') || 'manual') + '</b></div>' +
    (p.limit ? '<div class="sa-intent-detail"><span>Limit:</span> <b>' + _saEsc(String(p.limit)) + '</b></div>' : '') +
  '</div>';

  // Resolve button (if not yet resolved)
  if (!r) {
    html += '<div class="smart-airdrop-actions" style="margin:16px 0">' +
      '<button class="sa-btn sa-btn-primary" id="saResolveBtn" onclick="_saResolve()">Resolve Addresses</button>' +
    '</div>' +
    '<div class="sa-loading" id="saLoading2" style="display:none">' +
      '<div class="sa-spinner"></div>' +
      '<span>Resolving addresses from on-chain data...</span>' +
    '</div>';
  }

  // After resolution
  if (r) {
    // Summary card
    html += '<div class="smart-airdrop-summary">' +
      '<div class="sa-summary-title">Airdrop Summary</div>' +
      '<div class="sa-summary-grid">' +
        _saSummaryItem('Recipients', r.totalRecipients || _saState.recipients.length) +
        _saSummaryItem('Total Tokens', r.totalTokens || 'N/A') +
        _saSummaryItem('Sender Balance', r.senderBalance || 'N/A') +
        _saSummaryItem('Gas Estimate', r.gasEstimate || 'N/A') +
        _saSummaryItem('Invalid Removed', r.invalidCount || 0) +
        _saSummaryItem('Duplicates Removed', r.duplicatesRemoved || 0) +
      '</div>' +
    '</div>';

    // Source breakdown
    if (r.sourceBreakdown && r.sourceBreakdown.length > 0) {
      html += '<div class="sa-source-breakdown">' +
        '<div class="sa-section-label">Source Breakdown</div>';
      r.sourceBreakdown.forEach(function(sb) {
        html += '<div class="sa-source-row">' +
          '<span class="sa-source-type">' + _saEsc(sb.source || sb.type) + '</span>' +
          '<span class="sa-source-count">' + _saEsc(String(sb.count || 0)) + ' addresses</span>' +
        '</div>';
      });
      html += '</div>';
    }

    // Preflight results
    if (r.preflight) {
      html += '<div class="sa-preflight-results">' +
        '<div class="sa-section-label">Preflight Checks</div>';
      (r.preflight.checks || []).forEach(function(c) {
        var icon = c.severity === 'error' ? 'X' : c.severity === 'warning' ? '!' : '-';
        var cls = 'sa-preflight-' + (c.severity || 'info');
        html += '<div class="sa-preflight-item ' + cls + '">' +
          '<span class="sa-preflight-icon">' + icon + '</span>' +
          '<span>' + _saEsc(c.message) + '</span>' +
        '</div>';
      });
      html += '</div>';
    }

    // Scrollable address list
    html += '<div class="sa-section-label" style="margin-top:16px">Recipients (' + _saState.recipients.length + ')</div>' +
      '<div class="smart-airdrop-recipients" id="saRecipientsList">';
    _saState.recipients.forEach(function(rec, idx) {
      html += _saRecipientRow(rec, idx);
    });
    html += '</div>';

    // Delivery options
    html += '<div class="sa-delivery-options">' +
      '<div class="sa-section-label">Delivery Options</div>' +
      '<div class="sa-delivery-row">' +
        '<input class="sa-delivery-input" id="saEmailInput" type="email" placeholder="Email address...">' +
        '<button class="sa-btn sa-btn-secondary sa-btn-sm" onclick="_saSendReview(\'email\')">Email List</button>' +
      '</div>' +
      '<div class="sa-delivery-row">' +
        '<input class="sa-delivery-input" id="saTelegramInput" type="text" placeholder="Telegram chat ID...">' +
        '<button class="sa-btn sa-btn-secondary sa-btn-sm" onclick="_saSendReview(\'telegram\')">Send to Telegram</button>' +
      '</div>' +
    '</div>';
  }

  // Actions
  html += '<div class="smart-airdrop-actions" style="margin-top:16px">' +
    '<button class="sa-btn sa-btn-secondary" onclick="_saGoToStep(1)">Back</button>';
  if (r && r.preflight && r.preflight.canProceed !== false) {
    html += '<button class="sa-btn sa-btn-primary" onclick="_saGoToStep(3)">Continue to Execute</button>';
  } else if (r) {
    html += '<button class="sa-btn sa-btn-primary" disabled title="Preflight checks must pass">Continue to Execute</button>';
  }
  html += '</div></div>';

  return html;
}

function _saSummaryItem(label, value) {
  return '<div class="sa-summary-item">' +
    '<div class="sa-summary-value">' + _saEsc(String(value)) + '</div>' +
    '<div class="sa-summary-label">' + _saEsc(label) + '</div>' +
  '</div>';
}

function _saRecipientRow(rec, idx) {
  var addr = rec.address || '';
  var short = addr.length > 20 ? addr.slice(0, 12) + '...' + addr.slice(-6) : addr;
  return '<div class="smart-airdrop-row" id="saRow' + idx + '">' +
    '<span class="sa-row-addr" title="' + _saEsc(addr) + '">' + _saEsc(short) + '</span>' +
    '<span class="sa-row-amount" id="saAmt' + idx + '" onclick="_saEditAmount(' + idx + ')" title="Click to edit">' + _saEsc(String(rec.amount || 0)) + '</span>' +
    '<button class="sa-row-remove" onclick="_saRemoveRecipient(' + idx + ')" title="Remove">&times;</button>' +
  '</div>';
}

function _saRemoveRecipient(idx) {
  _saState.recipients.splice(idx, 1);
  // Re-render just the list
  var listEl = document.getElementById('saRecipientsList');
  if (listEl) {
    var html = '';
    _saState.recipients.forEach(function(rec, i) {
      html += _saRecipientRow(rec, i);
    });
    listEl.innerHTML = html;
  }
}

function _saEditAmount(idx) {
  var el = document.getElementById('saAmt' + idx);
  if (!el) return;
  var current = _saState.recipients[idx].amount;
  var input = document.createElement('input');
  input.type = 'number';
  input.className = 'sa-edit-amount-input';
  input.value = current;
  input.step = 'any';
  el.innerHTML = '';
  el.appendChild(input);
  input.focus();
  input.select();

  function save() {
    var val = parseFloat(input.value);
    if (!isNaN(val) && val >= 0) {
      _saState.recipients[idx].amount = val;
    }
    el.textContent = String(_saState.recipients[idx].amount);
    el.onclick = function() { _saEditAmount(idx); };
  }

  input.addEventListener('blur', save);
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    if (e.key === 'Escape') {
      el.textContent = String(current);
      el.onclick = function() { _saEditAmount(idx); };
    }
  });
}

/* ── Resolve call ── */

async function _saResolve() {
  var btn = document.getElementById('saResolveBtn');
  var loading = document.getElementById('saLoading2');
  if (btn) btn.disabled = true;
  if (loading) loading.style.display = 'flex';

  try {
    var res = await fetch(API_URL + '/api/smart-airdrop/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parsed: _saState.parsed }),
    });
    var data = await res.json();

    if (data.error) throw new Error(data.error);

    _saState.resolved = data;
    _saState.recipients = (data.recipients || []).map(function(r) {
      return { address: r.address, amount: r.amount };
    });

    // Re-render step 2 with resolved data
    _saGoToStep(2);
  } catch (err) {
    alert('Resolve failed: ' + err.message);
  } finally {
    if (btn) btn.disabled = false;
    if (loading) loading.style.display = 'none';
  }
}

/* ── Send review ── */

async function _saSendReview(method) {
  var target = '';
  if (method === 'email') {
    target = (document.getElementById('saEmailInput')?.value || '').trim();
    if (!target) { alert('Enter an email address.'); return; }
  } else {
    target = (document.getElementById('saTelegramInput')?.value || '').trim();
    if (!target) { alert('Enter a Telegram chat ID.'); return; }
  }

  try {
    var res = await fetch(API_URL + '/api/smart-airdrop/send-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: method,
        target: target,
        recipients: _saState.recipients,
        summary: _saState.resolved,
      }),
    });
    var data = await res.json();
    if (data.error) throw new Error(data.error);
    alert('Review sent via ' + method + '!');
  } catch (err) {
    alert('Failed to send review: ' + err.message);
  }
}

/* ── Step 3: Confirm & Execute ── */

function _saBuildStep3() {
  var r = _saState.resolved || {};
  var totalRecipients = _saState.recipients.length;
  var totalTokens = r.totalTokens || _saState.recipients.reduce(function(s, rec) { return s + (rec.amount || 0); }, 0);

  var html = '<div class="smart-airdrop-step" id="saStep3">' +
    '<div class="sa-section-label">Confirm Airdrop</div>' +
    '<div class="sa-confirm-card">' +
      '<div class="sa-confirm-row"><span>Token</span><b>' + _saEsc(_saState.parsed?.token || _saState.parsed?.denom || 'N/A') + '</b></div>' +
      '<div class="sa-confirm-row"><span>Recipients</span><b>' + totalRecipients + '</b></div>' +
      '<div class="sa-confirm-row sa-confirm-total"><span>Total Tokens</span><b>' + _saEsc(String(totalTokens)) + '</b></div>' +
      '<div class="sa-confirm-row"><span>Gas Estimate</span><b>' + _saEsc(String(r.gasEstimate || 'N/A')) + '</b></div>' +
    '</div>' +
    '<div class="smart-airdrop-progress" id="saProgressWrap" style="display:none">' +
      '<div class="sa-progress-bar-wrap">' +
        '<div class="sa-progress-bar" id="saProgressBar" style="width:0%"></div>' +
      '</div>' +
      '<div class="sa-progress-text" id="saProgressText">Preparing...</div>' +
      '<div class="sa-progress-counts" id="saProgressCounts"></div>' +
    '</div>' +
    '<div class="sa-final-summary" id="saFinalSummary" style="display:none"></div>' +
    '<div class="smart-airdrop-actions">' +
      '<button class="sa-btn sa-btn-secondary" id="saBackBtn3" onclick="_saGoToStep(2)">Back</button>' +
      '<button class="sa-btn sa-btn-execute" id="saExecuteBtn" onclick="_saExecute()">Execute Airdrop</button>' +
    '</div>' +
  '</div>';

  return html;
}

/* ── Execute via SSE ── */

async function _saExecute() {
  if (_saState.executing) return;
  _saState.executing = true;

  var btn = document.getElementById('saExecuteBtn');
  var backBtn = document.getElementById('saBackBtn3');
  var progressWrap = document.getElementById('saProgressWrap');
  if (btn) { btn.disabled = true; btn.textContent = 'Executing...'; }
  if (backBtn) backBtn.disabled = true;
  if (progressWrap) progressWrap.style.display = 'block';

  var totalSent = 0;
  var totalFailed = 0;
  var totalBatches = 0;
  var currentBatch = 0;

  try {
    var url = API_URL + '/api/smart-airdrop/execute';
    var response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
      body: JSON.stringify({
        recipients: _saState.recipients,
        parsed: _saState.parsed,
      }),
    });

    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';

    while (true) {
      var result = await reader.read();
      if (result.done) break;

      buffer += decoder.decode(result.value, { stream: true });
      var lines = buffer.split('\n');
      buffer = lines.pop();

      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line.startsWith('data:')) continue;
        var jsonStr = line.slice(5).trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;

        try {
          var event = JSON.parse(jsonStr);
          _saHandleEvent(event);

          if (event.type === 'progress') {
            currentBatch = event.batch || currentBatch;
            totalBatches = event.totalBatches || totalBatches;
            totalSent += (event.sent || 0);
            totalFailed += (event.failed || 0);
          } else if (event.type === 'complete') {
            totalSent = event.totalSent || totalSent;
            totalFailed = event.totalFailed || totalFailed;
          }
        } catch (parseErr) {
          // skip malformed events
        }
      }
    }

    // Final summary
    _saShowFinalSummary(totalSent, totalFailed);
  } catch (err) {
    _saShowFinalSummary(totalSent, totalFailed, err.message);
  } finally {
    _saState.executing = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Execute Airdrop'; }
  }
}

function _saHandleEvent(event) {
  if (event.type === 'progress') {
    var pct = event.totalBatches ? Math.round((event.batch / event.totalBatches) * 100) : 0;
    var bar = document.getElementById('saProgressBar');
    var text = document.getElementById('saProgressText');
    var counts = document.getElementById('saProgressCounts');
    if (bar) bar.style.width = pct + '%';
    if (text) text.textContent = 'Batch ' + event.batch + ' / ' + event.totalBatches;
    if (counts) {
      counts.innerHTML =
        '<span class="sa-count-ok">' + (event.sent || 0) + ' sent</span>' +
        '<span class="sa-count-fail">' + (event.failed || 0) + ' failed</span>';
    }
  } else if (event.type === 'complete') {
    var bar = document.getElementById('saProgressBar');
    var text = document.getElementById('saProgressText');
    if (bar) bar.style.width = '100%';
    if (text) text.textContent = 'Complete';
  } else if (event.type === 'error') {
    var text = document.getElementById('saProgressText');
    if (text) text.textContent = 'Error: ' + (event.message || 'Unknown error');
  }
}

function _saShowFinalSummary(sent, failed, errorMsg) {
  var el = document.getElementById('saFinalSummary');
  if (!el) return;
  el.style.display = 'block';

  var html = '<div class="sa-final-icon">' + (failed === 0 && !errorMsg ? 'OK' : '!!') + '</div>';
  html += '<div class="sa-final-stats">' +
    '<div class="sa-final-stat sa-final-ok"><b>' + sent + '</b> sent</div>' +
    '<div class="sa-final-stat sa-final-fail"><b>' + failed + '</b> failed</div>' +
  '</div>';
  if (errorMsg) {
    html += '<div class="sa-final-error">' + _saEsc(errorMsg) + '</div>';
  }
  html += '<div style="margin-top:12px"><button class="sa-btn sa-btn-secondary" onclick="smartAirdropClose()">Close</button></div>';
  el.innerHTML = html;
}

/* ── Utility ── */

function _saEsc(str) {
  if (!str) return '';
  var d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// Expose globally
window.smartAirdropOpen = smartAirdropOpen;
window.smartAirdropClose = smartAirdropClose;
