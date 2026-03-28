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
  showHistory: false,
  dryRunResult: null,
  showScheduleForm: false,
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
  _saState = { step: 1, parsed: null, resolved: null, recipients: [], csvFile: null, executing: false, showHistory: false, dryRunResult: null, showScheduleForm: false, exclusions: [], vestingSchedule: null, lastAirdropId: null };
}

/* ── Main HTML ── */

function _saBuildHTML() {
  return '<div class="smart-airdrop-modal">' +
    '<div class="sa-header">' +
      '<div class="sa-header-title">Smart Airdrop Agent</div>' +
      '<div class="sa-header-actions">' +
        '<button class="sa-btn sa-btn-sm sa-btn-secondary" onclick="_saShowHistory()" title="Airdrop History">History</button>' +
        '<button class="sa-btn sa-btn-sm sa-btn-secondary" onclick="_saShowSchedules()" title="Scheduled Airdrops">Scheduled</button>' +
        '<button class="sa-btn sa-btn-sm sa-btn-secondary" onclick="_saShowVestingPlans()" title="Vesting Plans">Vesting</button>' +
        '<button class="sa-close-btn" onclick="smartAirdropClose()">&times;</button>' +
      '</div>' +
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
        _saSummaryItem('Excluded', r.excludedCount || (_saState.exclusions || []).length || 0) +
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

    // Exclusion List section
    html += '<div class="sa-exclusion-section">' +
      '<div class="sa-section-label">Exclusion List' +
        ((_saState.exclusions || []).length > 0 ? ' (' + _saState.exclusions.length + ' excluded)' : '') +
      '</div>' +
      '<textarea class="sa-exclusion-textarea" id="saExclusionInput" rows="3" placeholder="Paste addresses to exclude (one per line)..."></textarea>' +
      '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">' +
        '<button class="sa-btn sa-btn-sm sa-btn-secondary" onclick="_saAddExclusions()">Add to Exclusions</button>' +
        '<button class="sa-btn sa-btn-sm sa-btn-secondary" onclick="_saExcludeKnownExchanges()">Exclude Known Exchanges</button>' +
        '<button class="sa-btn sa-btn-sm sa-btn-secondary" onclick="_saClearExclusions()">Clear Exclusions</button>' +
      '</div>';
    if ((_saState.exclusions || []).length > 0) {
      html += '<div class="sa-exclusion-tags">';
      _saState.exclusions.forEach(function(addr, idx) {
        var short = addr.length > 20 ? addr.slice(0, 10) + '...' + addr.slice(-6) : addr;
        html += '<span class="sa-exclusion-tag" title="' + _saEsc(addr) + '">' + _saEsc(short) +
          '<button onclick="_saRemoveExclusion(' + idx + ')">&times;</button></span>';
      });
      html += '</div>';
    }
    html += '</div>';

    // Excluded count in summary
    if (r.excludedCount && r.excludedCount > 0) {
      // Already included in the summary grid above — show inline note
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

  // Dry Run results (if available)
  if (_saState.dryRunResult) {
    var dr = _saState.dryRunResult;
    html += '<div class="sa-dryrun-card">' +
      '<div class="sa-section-label">Dry Run Results</div>' +
      '<table class="sa-dryrun-batch-table">' +
        '<thead><tr><th>Batch #</th><th>Recipients</th><th>Est. Gas</th></tr></thead><tbody>';
    (dr.batches || []).forEach(function(b) {
      html += '<tr><td>' + b.batchNum + '</td><td>' + b.recipientCount + '</td><td>' + b.estimatedGas.toLocaleString() + '</td></tr>';
    });
    html += '</tbody></table>' +
      '<div class="sa-dryrun-summary">' +
        '<div class="sa-dryrun-row"><span>Total Gas Estimate:</span><b>' + _saEsc(String(dr.totalGasEstimate || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')) + '</b></div>' +
        '<div class="sa-dryrun-row"><span>Total Gas Cost:</span><b>' + _saEsc(dr.totalGasCost || 'N/A') + '</b></div>' +
        '<div class="sa-dryrun-row"><span>Sender Balance:</span><b>' + _saEsc(String(dr.senderBalance || 'N/A')) + '</b></div>' +
        '<div class="sa-dryrun-row"><span>Can Execute:</span><b class="' + (dr.canExecute ? 'sa-pass' : 'sa-fail') + '">' + (dr.canExecute ? 'YES' : 'NO') + '</b></div>' +
      '</div>';
    if (dr.issues && dr.issues.length > 0) {
      html += '<div class="sa-dryrun-issues">';
      dr.issues.forEach(function(issue) {
        html += '<div class="sa-dryrun-issue">' + _saEsc(issue) + '</div>';
      });
      html += '</div>';
    }
    if (dr.canExecute) {
      html += '<button class="sa-btn sa-btn-primary" onclick="_saGoToStep(3)" style="margin-top:10px">Looks good — Execute for real</button>';
    }
    html += '</div>';
  }

  // Dry Run loading
  html += '<div class="sa-loading" id="saLoadingDryRun" style="display:none">' +
    '<div class="sa-spinner"></div>' +
    '<span>Running dry run simulation...</span>' +
  '</div>';

  // Actions
  html += '<div class="smart-airdrop-actions" style="margin-top:16px">' +
    '<button class="sa-btn sa-btn-secondary" onclick="_saGoToStep(1)">Back</button>';
  if (r) {
    html += '<button class="sa-btn sa-btn-secondary" id="saDryRunBtn" onclick="_saDryRun()">Dry Run</button>';
  }
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

    // Vesting Options section
    '<div class="sa-vesting-section" id="saVestingSection">' +
      '<div class="sa-section-label" style="cursor:pointer" onclick="_saToggleVesting()">Vesting Options <span id="saVestingToggleIcon">+</span></div>' +
      '<div id="saVestingOptions" style="display:none">' +
        '<div class="sa-vesting-radios" style="display:flex;flex-wrap:wrap;gap:10px;margin:10px 0">' +
          '<label class="sa-vesting-option"><input type="radio" name="saVestType" value="none" checked onchange="_saVestTypeChanged()"> No vesting</label>' +
          '<label class="sa-vesting-option"><input type="radio" name="saVestType" value="cliff" onchange="_saVestTypeChanged()"> Cliff</label>' +
          '<label class="sa-vesting-option"><input type="radio" name="saVestType" value="linear" onchange="_saVestTypeChanged()"> Linear</label>' +
          '<label class="sa-vesting-option"><input type="radio" name="saVestType" value="cliff_linear" onchange="_saVestTypeChanged()"> Cliff + Linear</label>' +
          '<label class="sa-vesting-option"><input type="radio" name="saVestType" value="milestone" onchange="_saVestTypeChanged()"> Custom Milestones</label>' +
        '</div>' +
        '<div id="saVestCliffFields" style="display:none">' +
          '<label class="sa-form-label">Cliff Date:</label>' +
          '<input type="date" class="sa-delivery-input" id="saVestCliffDate">' +
        '</div>' +
        '<div id="saVestLinearFields" style="display:none">' +
          '<label class="sa-form-label">Start Date:</label>' +
          '<input type="date" class="sa-delivery-input" id="saVestStartDate">' +
          '<label class="sa-form-label">End Date:</label>' +
          '<input type="date" class="sa-delivery-input" id="saVestEndDate">' +
          '<label class="sa-form-label">Interval:</label>' +
          '<select class="sa-delivery-input" id="saVestInterval">' +
            '<option value="1">Monthly</option>' +
            '<option value="3">Quarterly</option>' +
            '<option value="6">Semi-annual</option>' +
            '<option value="12">Annual</option>' +
          '</select>' +
        '</div>' +
        '<div id="saVestCliffLinearFields" style="display:none">' +
          '<label class="sa-form-label">Cliff Date:</label>' +
          '<input type="date" class="sa-delivery-input" id="saVestCLCliffDate">' +
          '<label class="sa-form-label">Linear End Date:</label>' +
          '<input type="date" class="sa-delivery-input" id="saVestCLEndDate">' +
          '<label class="sa-form-label">Interval:</label>' +
          '<select class="sa-delivery-input" id="saVestCLInterval">' +
            '<option value="1">Monthly</option>' +
            '<option value="3">Quarterly</option>' +
            '<option value="6">Semi-annual</option>' +
            '<option value="12">Annual</option>' +
          '</select>' +
        '</div>' +
        '<div id="saVestMilestoneFields" style="display:none">' +
          '<div id="saVestMilestoneRows"></div>' +
          '<button class="sa-btn sa-btn-sm sa-btn-secondary" onclick="_saAddMilestone()" style="margin-top:8px">+ Add Milestone</button>' +
          '<div id="saVestMilestoneTotal" style="font-size:.82rem;color:#9ca3af;margin-top:4px"></div>' +
        '</div>' +
        '<div style="margin-top:12px">' +
          '<button class="sa-btn sa-btn-sm sa-btn-secondary" id="saVestPreviewBtn" onclick="_saPreviewVesting()" style="display:none">Preview Vesting Timeline</button>' +
        '</div>' +
        '<div id="saVestTimeline" style="display:none;margin-top:12px"></div>' +
      '</div>' +
    '</div>' +

    // Schedule form (hidden by default)
    '<div class="sa-schedule-form" id="saScheduleForm" style="display:none">' +
      '<div class="sa-section-label">Schedule Airdrop</div>' +
      '<div class="sa-schedule-options">' +
        '<label class="sa-schedule-option">' +
          '<input type="radio" name="saSchedType" value="time" checked onchange="_saSchedTypeChanged()"> At specific time' +
        '</label>' +
        '<label class="sa-schedule-option">' +
          '<input type="radio" name="saSchedType" value="price" onchange="_saSchedTypeChanged()"> When price reaches...' +
        '</label>' +
      '</div>' +
      '<div id="saSchedTimeFields">' +
        '<label class="sa-form-label">Execute at:</label>' +
        '<input type="datetime-local" class="sa-delivery-input" id="saSchedDateTime">' +
      '</div>' +
      '<div id="saSchedPriceFields" style="display:none">' +
        '<label class="sa-form-label">Denom to watch:</label>' +
        '<input type="text" class="sa-delivery-input" id="saSchedPriceDenom" placeholder="e.g. ucore">' +
        '<label class="sa-form-label">Target price (USD):</label>' +
        '<input type="number" class="sa-delivery-input" id="saSchedPrice" step="any" placeholder="e.g. 0.50">' +
        '<label class="sa-form-label">Direction:</label>' +
        '<select class="sa-delivery-input" id="saSchedDirection">' +
          '<option value="above">Above</option>' +
          '<option value="below">Below</option>' +
        '</select>' +
      '</div>' +
      '<div class="smart-airdrop-actions" style="margin-top:12px">' +
        '<button class="sa-btn sa-btn-secondary" onclick="_saToggleSchedule()">Cancel</button>' +
        '<button class="sa-btn sa-btn-primary" onclick="_saSubmitSchedule()">Schedule Airdrop</button>' +
      '</div>' +
    '</div>' +

    '<div class="smart-airdrop-actions" id="saStep3Actions">' +
      '<button class="sa-btn sa-btn-secondary" id="saBackBtn3" onclick="_saGoToStep(2)">Back</button>' +
      '<button class="sa-btn sa-btn-secondary" id="saScheduleBtn" onclick="_saToggleSchedule()">Schedule Instead</button>' +
      '<button class="sa-btn sa-btn-execute" id="saExecuteBtn" onclick="_saExecuteOrVested()">Execute Airdrop</button>' +
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

    // Try to fetch the latest airdrop ID for receipt link
    try {
      var histRes = await fetch(API_URL + '/api/smart-airdrop/history');
      var histData = await histRes.json();
      if (histData.history && histData.history.length > 0) {
        _saState.lastAirdropId = histData.history[0].id;
      }
    } catch (e) { /* ignore */ }

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
  html += '<div style="margin-top:12px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">';
  if (_saState.lastAirdropId) {
    html += '<a class="sa-btn sa-btn-secondary sa-receipt-link" href="' + API_URL + '/receipt/' + encodeURIComponent(_saState.lastAirdropId) + '" target="_blank" rel="noopener">View Receipt</a>';
    html += '<button class="sa-btn sa-btn-secondary" onclick="_saCopyReceiptLink()">Copy Receipt Link</button>';
  }
  html += '<button class="sa-btn sa-btn-secondary" onclick="smartAirdropClose()">Close</button></div>';
  el.innerHTML = html;
}

/* ── Utility ── */

function _saEsc(str) {
  if (!str) return '';
  var d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/* ── Feature 1: Dry Run ── */

async function _saDryRun() {
  var btn = document.getElementById('saDryRunBtn');
  var loading = document.getElementById('saLoadingDryRun');
  if (btn) btn.disabled = true;
  if (loading) loading.style.display = 'flex';

  try {
    var denom = _saState.parsed?.token || _saState.parsed?.denom || _saState.parsed?.tokenDenom || '';
    var sender = typeof walletAddress !== 'undefined' ? walletAddress : '';
    var network = typeof currentNetwork !== 'undefined' ? currentNetwork : 'testnet';

    var res = await fetch(API_URL + '/api/smart-airdrop/dry-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        denom: denom,
        recipients: _saState.recipients,
        sender: sender,
        network: network,
      }),
    });
    var data = await res.json();
    if (data.error) throw new Error(data.error);

    _saState.dryRunResult = data;
    _saGoToStep(2); // re-render step 2 with dry run results
  } catch (err) {
    alert('Dry run failed: ' + err.message);
  } finally {
    if (btn) btn.disabled = false;
    if (loading) loading.style.display = 'none';
  }
}

/* ── Feature 2: Scheduled Airdrops ── */

function _saToggleSchedule() {
  var form = document.getElementById('saScheduleForm');
  var actions = document.getElementById('saStep3Actions');
  if (!form) return;
  var visible = form.style.display !== 'none';
  form.style.display = visible ? 'none' : 'block';
  if (actions) actions.style.display = visible ? 'flex' : 'none';
}

function _saSchedTypeChanged() {
  var radios = document.querySelectorAll('input[name="saSchedType"]');
  var val = 'time';
  radios.forEach(function(r) { if (r.checked) val = r.value; });
  var timeFields = document.getElementById('saSchedTimeFields');
  var priceFields = document.getElementById('saSchedPriceFields');
  if (timeFields) timeFields.style.display = val === 'time' ? 'block' : 'none';
  if (priceFields) priceFields.style.display = val === 'price' ? 'block' : 'none';
}

async function _saSubmitSchedule() {
  var radios = document.querySelectorAll('input[name="saSchedType"]');
  var scheduleType = 'time';
  radios.forEach(function(r) { if (r.checked) scheduleType = r.value; });

  var denom = _saState.parsed?.token || _saState.parsed?.denom || _saState.parsed?.tokenDenom || '';
  var sender = typeof walletAddress !== 'undefined' ? walletAddress : '';
  var network = typeof currentNetwork !== 'undefined' ? currentNetwork : 'testnet';

  var body = {
    denom: denom,
    recipients: _saState.recipients,
    sender: sender,
    network: network,
    scheduleType: scheduleType,
  };

  if (scheduleType === 'time') {
    var dt = document.getElementById('saSchedDateTime');
    if (!dt || !dt.value) { alert('Select a date/time.'); return; }
    body.executeAt = new Date(dt.value).toISOString();
  } else {
    var trigDenom = (document.getElementById('saSchedPriceDenom')?.value || '').trim();
    var trigPrice = parseFloat(document.getElementById('saSchedPrice')?.value || '');
    var trigDir = document.getElementById('saSchedDirection')?.value || 'above';
    if (!trigDenom || isNaN(trigPrice)) { alert('Fill in all price trigger fields.'); return; }
    body.triggerDenom = trigDenom;
    body.triggerPrice = trigPrice;
    body.triggerDirection = trigDir;
  }

  try {
    var res = await fetch(API_URL + '/api/smart-airdrop/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    var data = await res.json();
    if (data.error) throw new Error(data.error);
    alert('Airdrop scheduled! ID: ' + data.scheduled.id);
    _saToggleSchedule();
  } catch (err) {
    alert('Schedule failed: ' + err.message);
  }
}

async function _saShowSchedules() {
  var container = document.getElementById('saStepContainer');
  if (!container) return;

  container.innerHTML = '<div class="smart-airdrop-step"><div class="sa-loading" style="display:flex"><div class="sa-spinner"></div><span>Loading schedules...</span></div></div>';

  try {
    var res = await fetch(API_URL + '/api/smart-airdrop/schedules');
    var data = await res.json();
    var schedules = data.schedules || [];

    var html = '<div class="smart-airdrop-step">' +
      '<div class="sa-section-label">Scheduled Airdrops</div>';

    if (schedules.length === 0) {
      html += '<div class="sa-empty-msg">No scheduled airdrops yet.</div>';
    } else {
      html += '<div class="sa-schedules-list">';
      schedules.forEach(function(s) {
        var statusClass = 'sa-status-' + s.status;
        var schedInfo = s.scheduleType === 'time' ? ('At: ' + new Date(s.executeAt).toLocaleString()) :
          (s.triggerDirection + ' $' + s.triggerPrice + ' (' + s.triggerDenom + ')');
        html += '<div class="sa-schedule-item ' + statusClass + '">' +
          '<div class="sa-schedule-item-header">' +
            '<span class="sa-schedule-denom">' + _saEsc(s.denom) + '</span>' +
            '<span class="sa-schedule-status">' + _saEsc(s.status) + '</span>' +
          '</div>' +
          '<div class="sa-schedule-item-detail">' + _saEsc(schedInfo) + '</div>' +
          '<div class="sa-schedule-item-detail">' + s.recipients.length + ' recipients</div>' +
          '<div class="sa-schedule-item-detail">Created: ' + new Date(s.createdAt).toLocaleString() + '</div>';
        if (s.status === 'pending') {
          html += '<button class="sa-btn sa-btn-sm sa-btn-danger" onclick="_saCancelSchedule(\'' + s.id + '\')">Cancel</button>';
        }
        if (s.result) {
          html += '<div class="sa-schedule-item-detail">Result: ' + s.result.sent + ' sent, ' + s.result.failed + ' failed</div>';
        }
        html += '</div>';
      });
      html += '</div>';
    }

    html += '<div class="smart-airdrop-actions" style="margin-top:16px">' +
      '<button class="sa-btn sa-btn-secondary" onclick="_saGoToStep(_saState.step)">Back</button>' +
    '</div></div>';

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = '<div class="smart-airdrop-step"><div class="sa-empty-msg">Failed to load schedules: ' + _saEsc(err.message) + '</div>' +
      '<div class="smart-airdrop-actions"><button class="sa-btn sa-btn-secondary" onclick="_saGoToStep(_saState.step)">Back</button></div></div>';
  }
}

async function _saCancelSchedule(id) {
  if (!confirm('Cancel this scheduled airdrop?')) return;
  try {
    var res = await fetch(API_URL + '/api/smart-airdrop/schedule/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id }),
    });
    var data = await res.json();
    if (data.error) throw new Error(data.error);
    _saShowSchedules(); // refresh
  } catch (err) {
    alert('Cancel failed: ' + err.message);
  }
}

/* ── Feature 3: Airdrop History ── */

async function _saShowHistory() {
  var container = document.getElementById('saStepContainer');
  if (!container) return;

  container.innerHTML = '<div class="smart-airdrop-step"><div class="sa-loading" style="display:flex"><div class="sa-spinner"></div><span>Loading history...</span></div></div>';

  try {
    var res = await fetch(API_URL + '/api/smart-airdrop/history');
    var data = await res.json();
    var history = data.history || [];

    var html = '<div class="smart-airdrop-step">' +
      '<div class="sa-section-label">Airdrop History</div>';

    if (history.length === 0) {
      html += '<div class="sa-empty-msg">No airdrop history yet.</div>';
    } else {
      html += '<table class="sa-history-table">' +
        '<thead><tr><th>Date</th><th>Token</th><th>Recipients</th><th>Sent/Failed</th><th>Type</th><th></th></tr></thead><tbody>';
      history.forEach(function(rec) {
        var typeLabel = rec.dryRun ? 'Dry Run' : (rec.scheduled ? 'Scheduled' : 'Manual');
        var statusClass = rec.failed > 0 ? 'sa-history-row-warn' : 'sa-history-row-ok';
        html += '<tr class="sa-history-row ' + statusClass + '" onclick="_saShowHistoryDetail(\'' + rec.id + '\')">' +
          '<td>' + new Date(rec.timestamp).toLocaleString() + '</td>' +
          '<td>' + _saEsc(rec.denom) + '</td>' +
          '<td>' + rec.totalRecipients + '</td>' +
          '<td>' + rec.sent + ' / ' + rec.failed + '</td>' +
          '<td>' + typeLabel + '</td>' +
          '<td><button class="sa-btn sa-btn-sm sa-btn-secondary" onclick="event.stopPropagation();_saExportCsv(\'' + rec.id + '\')">CSV</button></td>' +
        '</tr>';
      });
      html += '</tbody></table>';
    }

    html += '<div class="smart-airdrop-actions" style="margin-top:16px">' +
      '<button class="sa-btn sa-btn-secondary" onclick="_saGoToStep(_saState.step)">Back</button>' +
    '</div></div>';

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = '<div class="smart-airdrop-step"><div class="sa-empty-msg">Failed to load history: ' + _saEsc(err.message) + '</div>' +
      '<div class="smart-airdrop-actions"><button class="sa-btn sa-btn-secondary" onclick="_saGoToStep(_saState.step)">Back</button></div></div>';
  }
}

async function _saShowHistoryDetail(id) {
  var container = document.getElementById('saStepContainer');
  if (!container) return;

  container.innerHTML = '<div class="smart-airdrop-step"><div class="sa-loading" style="display:flex"><div class="sa-spinner"></div><span>Loading details...</span></div></div>';

  try {
    var res = await fetch(API_URL + '/api/smart-airdrop/history/' + encodeURIComponent(id));
    var data = await res.json();
    if (data.error) throw new Error(data.error);
    var rec = data.record;

    var explorerBase = (typeof currentNetwork !== 'undefined' && currentNetwork === 'mainnet')
      ? 'https://explorer.coreum.com/coreum/transactions/'
      : 'https://explorer.testnet-1.coreum.dev/coreum/transactions/';

    var html = '<div class="smart-airdrop-step">' +
      '<div class="sa-section-label">Airdrop Detail</div>' +
      '<div class="sa-history-detail">' +
        '<div class="sa-confirm-row"><span>ID</span><b>' + _saEsc(rec.id) + '</b></div>' +
        '<div class="sa-confirm-row"><span>Date</span><b>' + new Date(rec.timestamp).toLocaleString() + '</b></div>' +
        '<div class="sa-confirm-row"><span>Token</span><b>' + _saEsc(rec.denom) + '</b></div>' +
        '<div class="sa-confirm-row"><span>Network</span><b>' + _saEsc(rec.network) + '</b></div>' +
        '<div class="sa-confirm-row"><span>Recipients</span><b>' + rec.totalRecipients + '</b></div>' +
        '<div class="sa-confirm-row"><span>Total Amount</span><b>' + _saEsc(rec.totalAmount) + '</b></div>' +
        '<div class="sa-confirm-row"><span>Sent / Failed</span><b>' + rec.sent + ' / ' + rec.failed + '</b></div>' +
        '<div class="sa-confirm-row"><span>Duration</span><b>' + (rec.durationMs / 1000).toFixed(1) + 's</b></div>' +
        '<div class="sa-confirm-row"><span>Type</span><b>' + (rec.dryRun ? 'Dry Run' : (rec.scheduled ? 'Scheduled' : 'Manual')) + '</b></div>' +
      '</div>';

    // TX Hashes
    if (rec.txHashes && rec.txHashes.length > 0) {
      html += '<div class="sa-section-label" style="margin-top:12px">Transaction Hashes</div><div class="sa-history-txlist">';
      rec.txHashes.forEach(function(tx) {
        html += '<div class="sa-history-tx"><a href="' + explorerBase + tx + '" target="_blank" rel="noopener">' + tx.slice(0, 16) + '...' + tx.slice(-8) + '</a></div>';
      });
      html += '</div>';
    }

    // Failed addresses
    if (rec.failedAddresses && rec.failedAddresses.length > 0) {
      html += '<div class="sa-section-label" style="margin-top:12px">Failed Addresses</div><div class="sa-history-failed">';
      rec.failedAddresses.forEach(function(fa) {
        html += '<div class="sa-history-failed-row"><span class="sa-row-addr">' + _saEsc(fa.address) + '</span><span class="sa-fail">' + _saEsc(fa.error) + '</span></div>';
      });
      html += '</div>';
    }

    html += '<div class="smart-airdrop-actions" style="margin-top:16px">' +
      '<button class="sa-btn sa-btn-secondary" onclick="_saShowHistory()">Back to History</button>' +
      '<button class="sa-btn sa-btn-secondary" onclick="_saExportCsv(\'' + rec.id + '\')">Export CSV</button>' +
      '<a class="sa-btn sa-btn-secondary sa-receipt-link" href="' + API_URL + '/receipt/' + encodeURIComponent(rec.id) + '" target="_blank" rel="noopener">View Receipt</a>' +
      '<button class="sa-btn sa-btn-primary" onclick="_saShareProof(\'' + rec.id + '\')">Share Proof</button>' +
    '</div></div>';

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = '<div class="smart-airdrop-step"><div class="sa-empty-msg">Failed to load details: ' + _saEsc(err.message) + '</div>' +
      '<div class="smart-airdrop-actions"><button class="sa-btn sa-btn-secondary" onclick="_saShowHistory()">Back</button></div></div>';
  }
}

function _saExportCsv(id) {
  window.open(API_URL + '/api/smart-airdrop/history/' + encodeURIComponent(id) + '/export', '_blank');
}

async function _saShareProof(id) {
  try {
    var res = await fetch(API_URL + '/api/smart-airdrop/history/' + encodeURIComponent(id));
    var data = await res.json();
    if (data.error) throw new Error(data.error);
    var rec = data.record;

    var text = 'Airdrop Proof\n' +
      'Token: ' + rec.denom + '\n' +
      'Network: ' + rec.network + '\n' +
      'Recipients: ' + rec.totalRecipients + '\n' +
      'Sent: ' + rec.sent + ' | Failed: ' + rec.failed + '\n' +
      'Total Amount: ' + rec.totalAmount + '\n' +
      'Date: ' + new Date(rec.timestamp).toLocaleString() + '\n';
    if (rec.txHashes && rec.txHashes.length > 0) {
      text += 'TX Hashes:\n';
      rec.txHashes.slice(0, 5).forEach(function(tx) { text += '  ' + tx + '\n'; });
      if (rec.txHashes.length > 5) text += '  ... and ' + (rec.txHashes.length - 5) + ' more\n';
    }
    text += '\nPowered by TXAI Studio';

    await navigator.clipboard.writeText(text);
    alert('Proof copied to clipboard!');
  } catch (err) {
    alert('Failed to copy proof: ' + err.message);
  }
}

/* ── Feature 4: Exclusion List ── */

function _saAddExclusions() {
  var input = document.getElementById('saExclusionInput');
  if (!input || !input.value.trim()) return;
  var lines = input.value.split(/[\r\n,]+/).map(function(l) { return l.trim(); }).filter(Boolean);
  var existing = new Set(_saState.exclusions || []);
  lines.forEach(function(addr) {
    if ((addr.startsWith('core1') || addr.startsWith('testcore1')) && !existing.has(addr)) {
      existing.add(addr);
    }
  });
  _saState.exclusions = Array.from(existing);
  input.value = '';
  _saReResolveWithExclusions();
}

function _saExcludeKnownExchanges() {
  // Placeholder exchange addresses
  var exchanges = [
    'core1exchangeplaceholder1',
    'core1exchangeplaceholder2',
    'core1exchangeplaceholder3',
  ];
  var existing = new Set(_saState.exclusions || []);
  exchanges.forEach(function(addr) { existing.add(addr); });
  _saState.exclusions = Array.from(existing);
  _saReResolveWithExclusions();
}

function _saClearExclusions() {
  _saState.exclusions = [];
  _saReResolveWithExclusions();
}

function _saRemoveExclusion(idx) {
  _saState.exclusions.splice(idx, 1);
  _saReResolveWithExclusions();
}

function _saReResolveWithExclusions() {
  // Update the parsed intent with exclusion addresses and re-render
  if (_saState.parsed) {
    _saState.parsed.excludeAddresses = _saState.exclusions;
  }
  // Re-render step 2
  _saGoToStep(2);
}

/* ── Feature 5: Receipt Link ── */

function _saCopyReceiptLink() {
  if (!_saState.lastAirdropId) return;
  var url = API_URL + '/receipt/' + encodeURIComponent(_saState.lastAirdropId);
  navigator.clipboard.writeText(url).then(function() {
    alert('Receipt link copied to clipboard!');
  }).catch(function(err) {
    alert('Failed to copy: ' + err.message);
  });
}

/* ── Feature 6: Vesting UI ── */

function _saToggleVesting() {
  var opts = document.getElementById('saVestingOptions');
  var icon = document.getElementById('saVestingToggleIcon');
  if (!opts) return;
  var visible = opts.style.display !== 'none';
  opts.style.display = visible ? 'none' : 'block';
  if (icon) icon.textContent = visible ? '+' : '-';
}

function _saVestTypeChanged() {
  var radios = document.querySelectorAll('input[name="saVestType"]');
  var val = 'none';
  radios.forEach(function(r) { if (r.checked) val = r.value; });

  var fields = ['saVestCliffFields', 'saVestLinearFields', 'saVestCliffLinearFields', 'saVestMilestoneFields'];
  fields.forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  var previewBtn = document.getElementById('saVestPreviewBtn');
  var execBtn = document.getElementById('saExecuteBtn');

  if (val === 'cliff') {
    document.getElementById('saVestCliffFields').style.display = 'block';
  } else if (val === 'linear') {
    document.getElementById('saVestLinearFields').style.display = 'block';
  } else if (val === 'cliff_linear') {
    document.getElementById('saVestCliffLinearFields').style.display = 'block';
  } else if (val === 'milestone') {
    document.getElementById('saVestMilestoneFields').style.display = 'block';
    if (!document.getElementById('saVestMilestoneRows').children.length) {
      _saAddMilestone();
    }
  }

  if (previewBtn) previewBtn.style.display = val !== 'none' ? 'inline-block' : 'none';
  if (execBtn) execBtn.textContent = val !== 'none' ? 'Execute Vested Airdrop' : 'Execute Airdrop';

  // Clear timeline when type changes
  var timeline = document.getElementById('saVestTimeline');
  if (timeline) timeline.style.display = 'none';
}

var _saMilestoneCount = 0;

function _saAddMilestone() {
  var container = document.getElementById('saVestMilestoneRows');
  if (!container) return;
  _saMilestoneCount++;
  var row = document.createElement('div');
  row.className = 'sa-vesting-milestone';
  row.id = 'saMs' + _saMilestoneCount;
  row.innerHTML =
    '<input type="date" class="sa-delivery-input" style="flex:1" data-ms-date>' +
    '<input type="number" class="sa-delivery-input" style="width:80px" placeholder="%" min="0" max="100" data-ms-pct onchange="_saUpdateMilestoneTotal()">' +
    '<button class="sa-row-remove" onclick="this.parentElement.remove();_saUpdateMilestoneTotal()">&times;</button>';
  container.appendChild(row);
  _saUpdateMilestoneTotal();
}

function _saUpdateMilestoneTotal() {
  var pctInputs = document.querySelectorAll('[data-ms-pct]');
  var total = 0;
  pctInputs.forEach(function(inp) { total += parseFloat(inp.value) || 0; });
  var el = document.getElementById('saVestMilestoneTotal');
  if (el) {
    el.textContent = 'Total: ' + total + '% ' + (Math.abs(total - 100) < 0.01 ? '(OK)' : '(must equal 100%)');
    el.style.color = Math.abs(total - 100) < 0.01 ? '#06d6a0' : '#ef4444';
  }
}

function _saGetVestingSchedule() {
  var radios = document.querySelectorAll('input[name="saVestType"]');
  var val = 'none';
  radios.forEach(function(r) { if (r.checked) val = r.value; });

  if (val === 'none') return null;

  var schedule = { type: val };

  if (val === 'cliff') {
    var d = document.getElementById('saVestCliffDate');
    if (!d || !d.value) { alert('Select a cliff date.'); return undefined; }
    schedule.cliffDate = new Date(d.value).toISOString();
  } else if (val === 'linear') {
    var s = document.getElementById('saVestStartDate');
    var e = document.getElementById('saVestEndDate');
    var iv = document.getElementById('saVestInterval');
    if (!s || !s.value || !e || !e.value) { alert('Select start and end dates.'); return undefined; }
    schedule.startDate = new Date(s.value).toISOString();
    schedule.endDate = new Date(e.value).toISOString();
    schedule.intervalMonths = parseInt(iv ? iv.value : '1');
  } else if (val === 'cliff_linear') {
    var cd = document.getElementById('saVestCLCliffDate');
    var ed = document.getElementById('saVestCLEndDate');
    var civ = document.getElementById('saVestCLInterval');
    if (!cd || !cd.value || !ed || !ed.value) { alert('Select cliff date and linear end date.'); return undefined; }
    schedule.cliffDate = new Date(cd.value).toISOString();
    schedule.linearStartDate = new Date(cd.value).toISOString();
    schedule.linearEndDate = new Date(ed.value).toISOString();
    schedule.intervalMonths = parseInt(civ ? civ.value : '1');
  } else if (val === 'milestone') {
    var dateInputs = document.querySelectorAll('[data-ms-date]');
    var pctInputs = document.querySelectorAll('[data-ms-pct]');
    var milestones = [];
    var totalPct = 0;
    for (var i = 0; i < dateInputs.length; i++) {
      var dv = dateInputs[i].value;
      var pv = parseFloat(pctInputs[i].value) || 0;
      if (!dv) { alert('All milestone dates must be filled in.'); return undefined; }
      milestones.push({ date: new Date(dv).toISOString(), percentage: pv });
      totalPct += pv;
    }
    if (Math.abs(totalPct - 100) > 0.01) { alert('Milestone percentages must total 100%. Currently: ' + totalPct + '%'); return undefined; }
    schedule.milestones = milestones;
  }

  return schedule;
}

async function _saPreviewVesting() {
  var schedule = _saGetVestingSchedule();
  if (schedule === undefined) return; // validation error
  if (!schedule) { alert('Select a vesting type first.'); return; }

  var btn = document.getElementById('saVestPreviewBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Loading...'; }

  try {
    var res = await fetch(API_URL + '/api/smart-airdrop/vesting-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipients: _saState.recipients,
        schedule: schedule,
      }),
    });
    var data = await res.json();
    if (data.error) throw new Error(data.error);

    _saRenderVestingTimeline(data.steps, data.totalSteps);
  } catch (err) {
    alert('Vesting preview failed: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Preview Vesting Timeline'; }
  }
}

function _saRenderVestingTimeline(steps, totalSteps) {
  var container = document.getElementById('saVestTimeline');
  if (!container) return;
  container.style.display = 'block';

  // Group steps by date
  var byDate = {};
  steps.forEach(function(s) {
    var dateKey = new Date(s.date).toLocaleDateString();
    if (!byDate[dateKey]) byDate[dateKey] = [];
    byDate[dateKey].push(s);
  });

  var html = '<div class="sa-section-label">Vesting Timeline (' + totalSteps + ' steps)</div>' +
    '<div class="sa-vesting-timeline">';

  var dates = Object.keys(byDate);
  dates.forEach(function(dateKey, idx) {
    var isLast = idx === dates.length - 1;
    var evts = byDate[dateKey];
    html += '<div class="sa-vesting-timeline-item">' +
      '<div class="sa-vesting-timeline-dot' + (isLast ? ' sa-vesting-timeline-dot-last' : '') + '"></div>' +
      '<div class="sa-vesting-timeline-content">' +
        '<div class="sa-vesting-timeline-date">' + _saEsc(dateKey) + '</div>' +
        '<div class="sa-vesting-timeline-detail">' + evts.length + ' action' + (evts.length > 1 ? 's' : '') + ': ' +
          _saEsc(evts[0].action) + (evts.length > 1 ? ' (' + evts.length + ' recipients)' : ' for ' + _saEsc(evts[0].address.slice(0, 12) + '...')) +
        '</div>' +
      '</div>' +
    '</div>';
  });

  html += '</div>';
  container.innerHTML = html;
}

function _saExecuteOrVested() {
  var schedule = _saGetVestingSchedule();
  if (schedule === undefined) return; // validation error shown
  if (schedule) {
    _saState.vestingSchedule = schedule;
    _saExecuteVested();
  } else {
    _saExecute();
  }
}

async function _saExecuteVested() {
  if (_saState.executing) return;
  _saState.executing = true;

  var btn = document.getElementById('saExecuteBtn');
  var backBtn = document.getElementById('saBackBtn3');
  var progressWrap = document.getElementById('saProgressWrap');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating vesting plan...'; }
  if (backBtn) backBtn.disabled = true;
  if (progressWrap) progressWrap.style.display = 'block';

  try {
    var denom = _saState.parsed?.token || _saState.parsed?.denom || _saState.parsed?.tokenDenom || '';
    var sender = typeof walletAddress !== 'undefined' ? walletAddress : '';
    var network = typeof currentNetwork !== 'undefined' ? currentNetwork : 'testnet';

    var res = await fetch(API_URL + '/api/smart-airdrop/execute-vested', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        denom: denom,
        recipients: _saState.recipients,
        sender: sender,
        network: network,
        schedule: _saState.vestingSchedule,
      }),
    });
    var data = await res.json();
    if (data.error) throw new Error(data.error);

    _saState.lastAirdropId = data.record ? data.record.id : null;

    var bar = document.getElementById('saProgressBar');
    var text = document.getElementById('saProgressText');
    if (bar) bar.style.width = '100%';
    if (text) text.textContent = 'Vesting plan created!';

    _saShowFinalSummary(
      _saState.recipients.length,
      0,
      null
    );

    // Show extra info about the plan
    var el = document.getElementById('saFinalSummary');
    if (el) {
      el.innerHTML += '<div style="margin-top:8px;font-size:.85rem;color:#9ca3af">' +
        'Vesting plan <b>' + _saEsc(data.plan.id) + '</b> created with ' + data.totalSteps + ' scheduled unlock steps.' +
      '</div>';
    }
  } catch (err) {
    _saShowFinalSummary(0, _saState.recipients.length, err.message);
  } finally {
    _saState.executing = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Execute Vested Airdrop'; }
  }
}

/* ── Feature 7: Vesting Plans View ── */

async function _saShowVestingPlans() {
  var container = document.getElementById('saStepContainer');
  if (!container) return;

  container.innerHTML = '<div class="smart-airdrop-step"><div class="sa-loading" style="display:flex"><div class="sa-spinner"></div><span>Loading vesting plans...</span></div></div>';

  try {
    var res = await fetch(API_URL + '/api/smart-airdrop/vesting-plans');
    var data = await res.json();
    var plans = data.plans || [];

    var html = '<div class="smart-airdrop-step">' +
      '<div class="sa-section-label">Vesting Plans</div>';

    if (plans.length === 0) {
      html += '<div class="sa-empty-msg">No vesting plans yet.</div>';
    } else {
      html += '<div class="sa-vesting-plans">';
      plans.forEach(function(p) {
        var progress = p.steps.length > 0 ? Math.round((p.completedSteps / p.steps.length) * 100) : 0;
        var statusClass = p.status === 'active' ? 'sa-status-pending' : p.status === 'completed' ? 'sa-status-completed' : 'sa-status-cancelled';
        html += '<div class="sa-schedule-item ' + statusClass + '">' +
          '<div class="sa-schedule-item-header">' +
            '<span class="sa-schedule-denom">' + _saEsc(p.denom) + ' (' + _saEsc(p.schedule.type) + ')</span>' +
            '<span class="sa-schedule-status">' + _saEsc(p.status) + '</span>' +
          '</div>' +
          '<div class="sa-schedule-item-detail">' + p.recipients.length + ' recipients, ' + p.steps.length + ' unlock steps</div>' +
          '<div class="sa-schedule-item-detail">Progress: ' + p.completedSteps + '/' + p.steps.length + ' (' + progress + '%)</div>' +
          '<div class="sa-progress-bar-wrap" style="margin-top:6px;height:6px">' +
            '<div class="sa-progress-bar" style="width:' + progress + '%;height:6px"></div>' +
          '</div>' +
          '<div class="sa-schedule-item-detail">Created: ' + new Date(p.createdAt).toLocaleString() + '</div>' +
        '</div>';
      });
      html += '</div>';
    }

    html += '<div class="smart-airdrop-actions" style="margin-top:16px">' +
      '<button class="sa-btn sa-btn-secondary" onclick="_saGoToStep(_saState.step)">Back</button>' +
    '</div></div>';

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = '<div class="smart-airdrop-step"><div class="sa-empty-msg">Failed to load vesting plans: ' + _saEsc(err.message) + '</div>' +
      '<div class="smart-airdrop-actions"><button class="sa-btn sa-btn-secondary" onclick="_saGoToStep(_saState.step)">Back</button></div></div>';
  }
}

// Expose globally
window.smartAirdropOpen = smartAirdropOpen;
window.smartAirdropClose = smartAirdropClose;
