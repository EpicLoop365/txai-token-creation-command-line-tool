/* ===== TXAI — DAO Voting Tool ===== */
/* NFT-gated / Token-gated / Open DAO proposal voting */
/* Vanilla JS, no frameworks. */

var _daoState = {
  tab: 'proposals', // 'proposals' | 'create' | 'vote' | 'results'
  proposals: [],
  currentProposal: null,
  currentResults: null,
  eligibility: null,
  loading: false,
  selectedOption: null,
};

/* ── Open / Close ── */

function daoVotingOpen() {
  _daoResetState();
  var overlay = document.getElementById('daoVotingOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'daoVotingOverlay';
    overlay.className = 'dao-overlay';
    overlay.onclick = function(e) { if (e.target === overlay) daoVotingClose(); };
    overlay.innerHTML = _daoBuildHTML();
    document.body.appendChild(overlay);
  } else {
    overlay.innerHTML = _daoBuildHTML();
    overlay.style.display = 'flex';
  }
  requestAnimationFrame(function() { overlay.classList.add('dao-visible'); });
  _daoLoadProposals();
}

function daoVotingClose() {
  var overlay = document.getElementById('daoVotingOverlay');
  if (!overlay) return;
  overlay.classList.remove('dao-visible');
  setTimeout(function() { overlay.style.display = 'none'; }, 300);
}

function _daoResetState() {
  _daoState = {
    tab: 'proposals',
    proposals: [],
    currentProposal: null,
    currentResults: null,
    eligibility: null,
    loading: false,
    selectedOption: null,
  };
}

/* ── API URL helper ── */

function _daoApiUrl() {
  return (typeof API_URL !== 'undefined' && API_URL) ? API_URL : '';
}

function _daoNetwork() {
  return (typeof window._txNetwork !== 'undefined' && window._txNetwork) ? window._txNetwork : 'testnet';
}

function _daoWalletAddress() {
  if (window.txaiWallet && window.txaiWallet.connected) return window.txaiWallet.address;
  if (typeof connectedAddress !== 'undefined' && connectedAddress) return connectedAddress;
  if (typeof dexAgentWallet !== 'undefined' && dexAgentWallet) return dexAgentWallet;
  return '';
}

/* ── Main HTML ── */

function _daoBuildHTML() {
  return '<div class="dao-modal">' +
    '<div class="dao-header">' +
      '<div class="dao-header-title">DAO Voting</div>' +
      '<button class="dao-close-btn" onclick="daoVotingClose()">&times;</button>' +
    '</div>' +
    '<div class="dao-tabs">' +
      '<button class="dao-tab active" id="daoTabProposals" onclick="_daoSwitchTab(\'proposals\')">Active Proposals</button>' +
      '<button class="dao-tab" id="daoTabCreate" onclick="_daoSwitchTab(\'create\')">Create Proposal</button>' +
    '</div>' +
    '<div id="daoContent" class="dao-content">' +
      _daoBuildProposalsList() +
    '</div>' +
  '</div>';
}

function _daoSwitchTab(tab) {
  _daoState.tab = tab;
  // Update tab buttons
  var tabs = document.querySelectorAll('.dao-tab');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('active');
  if (tab === 'proposals') {
    document.getElementById('daoTabProposals').classList.add('active');
    document.getElementById('daoContent').innerHTML = _daoBuildProposalsList();
    _daoLoadProposals();
  } else if (tab === 'create') {
    document.getElementById('daoTabCreate').classList.add('active');
    document.getElementById('daoContent').innerHTML = _daoBuildCreateForm();
    _daoSetupCreateForm();
  }
}

/* ── Proposals List ── */

function _daoBuildProposalsList() {
  if (_daoState.loading) {
    return '<div class="dao-loading">Loading proposals...</div>';
  }
  if (!_daoState.proposals || _daoState.proposals.length === 0) {
    return '<div class="dao-empty">' +
      '<div class="dao-empty-icon">🏛️</div>' +
      '<div class="dao-empty-text">No proposals yet</div>' +
      '<div class="dao-empty-sub">Create the first proposal to get started!</div>' +
    '</div>';
  }

  var html = '<div class="dao-proposals-list">';
  for (var i = 0; i < _daoState.proposals.length; i++) {
    var p = _daoState.proposals[i];
    html += _daoBuildProposalCard(p);
  }
  html += '</div>';
  return html;
}

function _daoBuildProposalCard(p) {
  var gateLabel = p.gateType === 'nft' ? 'NFT' : (p.gateType === 'token' ? 'Token' : 'Open');
  var gateBadgeClass = p.gateType === 'nft' ? 'dao-badge-nft' : (p.gateType === 'token' ? 'dao-badge-token' : 'dao-badge-open');
  var desc = p.description || '';
  if (desc.length > 120) desc = desc.substring(0, 120) + '...';
  var totalVotes = p.votes ? p.votes.length : 0;
  var timeStr = _daoTimeRemaining(p.endTime);
  var statusClass = p.status === 'active' ? 'dao-status-active' : (p.status === 'closed' ? 'dao-status-closed' : 'dao-status-draft');
  var btnLabel = p.status === 'active' ? 'Vote' : (p.status === 'closed' ? 'Results' : 'View');

  return '<div class="dao-proposal-card" onclick="_daoOpenProposal(\'' + p.id + '\')">' +
    '<div class="dao-card-top">' +
      '<span class="dao-badge ' + gateBadgeClass + '">' + gateLabel + '</span>' +
      '<span class="dao-status ' + statusClass + '">' + p.status + '</span>' +
    '</div>' +
    '<div class="dao-card-title">' + _daoEsc(p.title) + '</div>' +
    '<div class="dao-card-desc">' + _daoEsc(desc) + '</div>' +
    '<div class="dao-card-meta">' +
      '<span class="dao-countdown">' + timeStr + '</span>' +
      '<span class="dao-vote-count">' + totalVotes + ' vote' + (totalVotes !== 1 ? 's' : '') + '</span>' +
    '</div>' +
    '<button class="dao-card-btn" onclick="event.stopPropagation(); _daoOpenProposal(\'' + p.id + '\')">' + btnLabel + '</button>' +
  '</div>';
}

function _daoTimeRemaining(endTime) {
  var now = new Date().getTime();
  var end = new Date(endTime).getTime();
  var diff = end - now;
  if (diff <= 0) return 'Ended';
  var days = Math.floor(diff / 86400000);
  var hours = Math.floor((diff % 86400000) / 3600000);
  var mins = Math.floor((diff % 3600000) / 60000);
  if (days > 0) return days + 'd ' + hours + 'h left';
  if (hours > 0) return hours + 'h ' + mins + 'm left';
  return mins + 'm left';
}

/* ── Load Proposals ── */

function _daoLoadProposals() {
  _daoState.loading = true;
  var net = _daoNetwork();
  fetch(_daoApiUrl() + '/api/dao/proposals?network=' + net)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      _daoState.proposals = data.proposals || [];
      _daoState.loading = false;
      if (_daoState.tab === 'proposals') {
        var el = document.getElementById('daoContent');
        if (el) el.innerHTML = _daoBuildProposalsList();
      }
    })
    .catch(function(err) {
      _daoState.loading = false;
      console.error('[dao] Load proposals error:', err);
      var el = document.getElementById('daoContent');
      if (el) el.innerHTML = '<div class="dao-error">Failed to load proposals: ' + err.message + '</div>';
    });
}

/* ── Open Proposal (Vote or Results) ── */

function _daoOpenProposal(id) {
  _daoState.eligibility = null;
  _daoState.selectedOption = null;
  fetch(_daoApiUrl() + '/api/dao/proposals/' + id + '?network=' + _daoNetwork())
    .then(function(r) { return r.json(); })
    .then(function(data) {
      _daoState.currentProposal = data.proposal;
      _daoState.currentResults = data.results;
      var el = document.getElementById('daoContent');
      if (el) el.innerHTML = _daoBuildVoteView();
      // Auto-check eligibility
      _daoCheckEligibility();
    })
    .catch(function(err) {
      console.error('[dao] Load proposal error:', err);
    });
}

/* ── Vote View ── */

function _daoBuildVoteView() {
  var p = _daoState.currentProposal;
  if (!p) return '<div class="dao-error">Proposal not found</div>';

  var gateLabel = p.gateType === 'nft' ? 'NFT Holders Only' : (p.gateType === 'token' ? 'Token Holders Only' : 'Open to All');
  var gateBadgeClass = p.gateType === 'nft' ? 'dao-badge-nft' : (p.gateType === 'token' ? 'dao-badge-token' : 'dao-badge-open');
  var isActive = p.status === 'active';
  var timeStr = _daoTimeRemaining(p.endTime);

  var html = '<div class="dao-vote-view">';

  // Back button
  html += '<button class="dao-back-btn" onclick="_daoSwitchTab(\'proposals\')">&larr; Back to Proposals</button>';

  // Proposal header
  html += '<div class="dao-proposal-header">' +
    '<div class="dao-card-top">' +
      '<span class="dao-badge ' + gateBadgeClass + '">' + gateLabel + '</span>' +
      '<span class="dao-countdown">' + timeStr + '</span>' +
    '</div>' +
    '<h3 class="dao-proposal-title">' + _daoEsc(p.title) + '</h3>' +
    '<p class="dao-proposal-desc">' + _daoEsc(p.description) + '</p>' +
    '<div class="dao-proposal-info">' +
      '<span>Creator: ' + _daoTruncAddr(p.creator) + '</span>' +
      '<span>Power: ' + _daoPowerLabel(p.votingPower) + '</span>' +
      (p.nftClassId ? '<span>NFT Class: ' + _daoEsc(p.nftClassId) + '</span>' : '') +
      (p.tokenDenom ? '<span>Token: ' + _daoEsc(p.tokenDenom) + '</span>' : '') +
    '</div>' +
  '</div>';

  // Eligibility status
  html += '<div id="daoEligibility" class="dao-eligibility">' +
    '<div class="dao-eligibility-loading">Checking eligibility...</div>' +
  '</div>';

  // Vote options
  if (isActive) {
    html += '<div class="dao-vote-options" id="daoVoteOptions">';
    for (var i = 0; i < p.options.length; i++) {
      html += '<label class="dao-vote-option" id="daoOpt' + i + '">' +
        '<input type="radio" name="daoVoteOption" value="' + i + '" onchange="_daoSelectOption(' + i + ')">' +
        '<span class="dao-vote-option-label">' + _daoEsc(p.options[i]) + '</span>' +
      '</label>';
    }
    html += '</div>';
    html += '<button class="dao-submit-vote-btn" id="daoSubmitVote" onclick="_daoSubmitVote()" disabled>Cast Vote</button>';
  }

  // Results bars
  html += '<div class="dao-results-section">' +
    '<h4 class="dao-results-heading">Current Results</h4>' +
    '<div id="daoResultBars">' + _daoBuildResultBars() + '</div>' +
  '</div>';

  // Voter list
  html += '<div class="dao-voter-section">' +
    '<h4 class="dao-results-heading">Voters (' + (p.votes ? p.votes.length : 0) + ')</h4>' +
    '<div class="dao-voter-list" id="daoVoterList">' + _daoBuildVoterList() + '</div>' +
  '</div>';

  // Close proposal (if creator)
  var walletAddr = _daoWalletAddress();
  if (isActive && walletAddr && walletAddr === p.creator) {
    html += '<div class="dao-creator-actions">' +
      '<button class="dao-close-proposal-btn" onclick="_daoCloseProposal()">Close Proposal Early</button>' +
    '</div>';
  }

  // Share results (for closed proposals)
  if (p.status === 'closed') {
    html += '<div class="dao-share-section">' +
      '<button class="dao-share-btn" onclick="_daoShareResults()">Copy Results to Clipboard</button>' +
    '</div>';
  }

  html += '</div>';
  return html;
}

function _daoBuildResultBars() {
  var r = _daoState.currentResults;
  if (!r || !r.options) return '<div class="dao-no-results">No votes yet</div>';

  var colors = ['#7c6dfa', '#06d6a0', '#ef4444', '#f59e0b', '#3b82f6', '#ec4899', '#8b5cf6', '#14b8a6'];
  var html = '';
  for (var i = 0; i < r.options.length; i++) {
    var opt = r.options[i];
    var color = colors[i % colors.length];
    var pct = opt.percentage || 0;
    html += '<div class="dao-results-bar">' +
      '<div class="dao-results-bar-header">' +
        '<span class="dao-results-bar-label">' + _daoEsc(opt.label) + '</span>' +
        '<span class="dao-results-bar-pct">' + pct.toFixed(1) + '% (' + opt.votes + ' vote' + (opt.votes !== 1 ? 's' : '') + ')</span>' +
      '</div>' +
      '<div class="dao-results-bar-track">' +
        '<div class="dao-results-bar-fill" style="width:' + pct + '%;background:' + color + '"></div>' +
      '</div>' +
    '</div>';
  }
  html += '<div class="dao-results-total">Total: ' + r.totalVoters + ' voter' + (r.totalVoters !== 1 ? 's' : '') + ', ' + r.totalPower + ' voting power</div>';
  if (r.status === 'closed') {
    html += '<div class="dao-results-winner">Winner: ' + _daoEsc(r.winningOption) + '</div>';
  }
  return html;
}

function _daoBuildVoterList() {
  var p = _daoState.currentProposal;
  if (!p || !p.votes || p.votes.length === 0) {
    return '<div class="dao-voter-empty">No votes yet</div>';
  }
  var html = '';
  for (var i = 0; i < p.votes.length; i++) {
    var v = p.votes[i];
    var optLabel = (p.options && p.options[v.option]) ? p.options[v.option] : 'Option ' + v.option;
    html += '<div class="dao-voter-row">' +
      '<span class="dao-voter-addr">' + _daoTruncAddr(v.voter) + '</span>' +
      '<span class="dao-voter-choice">' + _daoEsc(optLabel) + '</span>' +
      '<span class="dao-voter-power">Power: ' + v.power + '</span>' +
    '</div>';
  }
  return html;
}

/* ── Eligibility Check ── */

function _daoCheckEligibility() {
  var p = _daoState.currentProposal;
  var wallet = _daoWalletAddress();
  if (!p || !wallet) {
    var el = document.getElementById('daoEligibility');
    if (el) el.innerHTML = '<div class="dao-eligibility-warn">Connect your wallet to check eligibility.</div>';
    return;
  }

  fetch(_daoApiUrl() + '/api/dao/check-eligibility', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ proposalId: p.id, voter: wallet, network: _daoNetwork() }),
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      _daoState.eligibility = data.eligibility;
      var el = document.getElementById('daoEligibility');
      if (!el) return;
      if (data.eligibility && data.eligibility.eligible) {
        el.innerHTML = '<div class="dao-eligibility-pass">Eligible to vote (Voting Power: ' + data.eligibility.power + ')</div>';
        // Check if already voted
        var alreadyVoted = p.votes && p.votes.some(function(v) { return v.voter === wallet; });
        if (alreadyVoted) {
          el.innerHTML = '<div class="dao-eligibility-info">You have already voted on this proposal.</div>';
          var btn = document.getElementById('daoSubmitVote');
          if (btn) btn.disabled = true;
        }
      } else {
        var reason = (data.eligibility && data.eligibility.reason) || (data.error) || 'Not eligible';
        el.innerHTML = '<div class="dao-eligibility-fail">' + _daoEsc(reason) + '</div>';
        var btn = document.getElementById('daoSubmitVote');
        if (btn) btn.disabled = true;
      }
    })
    .catch(function(err) {
      var el = document.getElementById('daoEligibility');
      if (el) el.innerHTML = '<div class="dao-eligibility-warn">Could not check eligibility: ' + err.message + '</div>';
    });
}

/* ── Select Option / Submit Vote ── */

function _daoSelectOption(idx) {
  _daoState.selectedOption = idx;
  var btn = document.getElementById('daoSubmitVote');
  var eligible = _daoState.eligibility && _daoState.eligibility.eligible;
  var p = _daoState.currentProposal;
  var wallet = _daoWalletAddress();
  var alreadyVoted = p && p.votes && p.votes.some(function(v) { return v.voter === wallet; });
  if (btn) btn.disabled = !eligible || alreadyVoted;
}

function _daoSubmitVote() {
  var p = _daoState.currentProposal;
  var wallet = _daoWalletAddress();
  if (!p || !wallet || _daoState.selectedOption === null) return;

  var btn = document.getElementById('daoSubmitVote');
  if (btn) { btn.textContent = 'Submitting...'; btn.disabled = true; }

  fetch(_daoApiUrl() + '/api/dao/vote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proposalId: p.id,
      voter: wallet,
      option: _daoState.selectedOption,
      network: _daoNetwork(),
    }),
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) {
        alert('Vote failed: ' + data.error);
        if (btn) { btn.textContent = 'Cast Vote'; btn.disabled = false; }
        return;
      }
      // Update results
      _daoState.currentResults = data.currentResults;
      // Reload the proposal to get updated votes
      _daoOpenProposal(p.id);
    })
    .catch(function(err) {
      alert('Vote failed: ' + err.message);
      if (btn) { btn.textContent = 'Cast Vote'; btn.disabled = false; }
    });
}

/* ── Close Proposal ── */

function _daoCloseProposal() {
  var p = _daoState.currentProposal;
  var wallet = _daoWalletAddress();
  if (!p || !wallet) return;
  if (!confirm('Close this proposal early? This cannot be undone.')) return;

  fetch(_daoApiUrl() + '/api/dao/close/' + p.id, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creator: wallet }),
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) {
        alert('Failed to close: ' + data.error);
        return;
      }
      _daoOpenProposal(p.id);
    })
    .catch(function(err) {
      alert('Error closing proposal: ' + err.message);
    });
}

/* ── Share Results ── */

function _daoShareResults() {
  var r = _daoState.currentResults;
  var p = _daoState.currentProposal;
  if (!r || !p) return;

  var text = 'DAO Proposal: ' + p.title + '\n';
  text += 'Status: ' + r.status + '\n';
  text += 'Total Voters: ' + r.totalVoters + ' | Total Power: ' + r.totalPower + '\n\n';
  for (var i = 0; i < r.options.length; i++) {
    var o = r.options[i];
    text += o.label + ': ' + o.percentage.toFixed(1) + '% (' + o.votes + ' votes, ' + o.power + ' power)\n';
  }
  text += '\nWinner: ' + r.winningOption + '\n';
  text += 'Powered by TXAI Studio';

  navigator.clipboard.writeText(text).then(function() {
    var btn = document.querySelector('.dao-share-btn');
    if (btn) { btn.textContent = 'Copied!'; setTimeout(function() { btn.textContent = 'Copy Results to Clipboard'; }, 2000); }
  });
}

/* ── Create Proposal Form ── */

function _daoBuildCreateForm() {
  // Default start = now, end = 7 days from now
  var now = new Date();
  var end = new Date(now.getTime() + 7 * 86400000);
  var startStr = _daoLocalISOString(now);
  var endStr = _daoLocalISOString(end);

  return '<div class="dao-create-form">' +
    '<div class="dao-form-group">' +
      '<label class="dao-form-label">Title *</label>' +
      '<input type="text" id="daoCreateTitle" class="dao-form-input" placeholder="Proposal title" maxlength="120">' +
    '</div>' +
    '<div class="dao-form-group">' +
      '<label class="dao-form-label">Description</label>' +
      '<textarea id="daoCreateDesc" class="dao-form-textarea" rows="3" placeholder="Describe what this proposal is about..."></textarea>' +
    '</div>' +

    // Options
    '<div class="dao-form-group">' +
      '<label class="dao-form-label">Voting Options (min 2)</label>' +
      '<div id="daoOptionsContainer">' +
        '<div class="dao-option-row"><input type="text" class="dao-form-input dao-option-input" value="Yes" placeholder="Option"><button class="dao-option-remove" onclick="_daoRemoveOption(this)" title="Remove">&times;</button></div>' +
        '<div class="dao-option-row"><input type="text" class="dao-form-input dao-option-input" value="No" placeholder="Option"><button class="dao-option-remove" onclick="_daoRemoveOption(this)" title="Remove">&times;</button></div>' +
        '<div class="dao-option-row"><input type="text" class="dao-form-input dao-option-input" value="Abstain" placeholder="Option"><button class="dao-option-remove" onclick="_daoRemoveOption(this)" title="Remove">&times;</button></div>' +
      '</div>' +
      '<button class="dao-add-option-btn" onclick="_daoAddOption()">+ Add Option</button>' +
    '</div>' +

    // Gate Type
    '<div class="dao-form-group">' +
      '<label class="dao-form-label">Voting Gate</label>' +
      '<div class="dao-radio-group">' +
        '<label class="dao-radio"><input type="radio" name="daoGateType" value="any_wallet" checked onchange="_daoGateTypeChanged()"> Any Wallet</label>' +
        '<label class="dao-radio"><input type="radio" name="daoGateType" value="nft" onchange="_daoGateTypeChanged()"> NFT Holders</label>' +
        '<label class="dao-radio"><input type="radio" name="daoGateType" value="token" onchange="_daoGateTypeChanged()"> Token Holders</label>' +
      '</div>' +
    '</div>' +

    // NFT gating fields (hidden by default)
    '<div id="daoNftFields" class="dao-form-group" style="display:none">' +
      '<label class="dao-form-label">NFT Class ID *</label>' +
      '<input type="text" id="daoNftClassId" class="dao-form-input" placeholder="e.g. txscout-...">' +
    '</div>' +

    // Token gating fields (hidden by default)
    '<div id="daoTokenFields" class="dao-form-group" style="display:none">' +
      '<label class="dao-form-label">Token Denom *</label>' +
      '<input type="text" id="daoTokenDenom" class="dao-form-input" placeholder="e.g. utestcore">' +
      '<label class="dao-form-label" style="margin-top:8px">Minimum Balance</label>' +
      '<input type="text" id="daoMinBalance" class="dao-form-input" placeholder="1">' +
    '</div>' +

    // Voting Power
    '<div class="dao-form-group">' +
      '<label class="dao-form-label">Voting Power</label>' +
      '<div class="dao-radio-group">' +
        '<label class="dao-radio"><input type="radio" name="daoVotePower" value="equal" checked> Equal (1 vote each)</label>' +
        '<label class="dao-radio"><input type="radio" name="daoVotePower" value="token_weighted"> Token Weighted</label>' +
        '<label class="dao-radio"><input type="radio" name="daoVotePower" value="nft_count"> NFT Count</label>' +
      '</div>' +
    '</div>' +

    // Timing
    '<div class="dao-form-group dao-time-row">' +
      '<div class="dao-time-field">' +
        '<label class="dao-form-label">Start Time</label>' +
        '<input type="datetime-local" id="daoStartTime" class="dao-form-input" value="' + startStr + '">' +
      '</div>' +
      '<div class="dao-time-field">' +
        '<label class="dao-form-label">End Time</label>' +
        '<input type="datetime-local" id="daoEndTime" class="dao-form-input" value="' + endStr + '">' +
      '</div>' +
    '</div>' +

    // Submit
    '<button class="dao-create-btn" id="daoCreateBtn" onclick="_daoCreateProposal()">Create Proposal</button>' +
  '</div>';
}

function _daoSetupCreateForm() {
  // Nothing extra needed — form is ready
}

function _daoGateTypeChanged() {
  var selected = document.querySelector('input[name="daoGateType"]:checked');
  var val = selected ? selected.value : 'any_wallet';
  document.getElementById('daoNftFields').style.display = val === 'nft' ? '' : 'none';
  document.getElementById('daoTokenFields').style.display = val === 'token' ? '' : 'none';
}

function _daoAddOption() {
  var container = document.getElementById('daoOptionsContainer');
  if (!container) return;
  var row = document.createElement('div');
  row.className = 'dao-option-row';
  row.innerHTML = '<input type="text" class="dao-form-input dao-option-input" placeholder="Option"><button class="dao-option-remove" onclick="_daoRemoveOption(this)" title="Remove">&times;</button>';
  container.appendChild(row);
}

function _daoRemoveOption(btn) {
  var container = document.getElementById('daoOptionsContainer');
  if (!container) return;
  var rows = container.querySelectorAll('.dao-option-row');
  if (rows.length <= 2) { alert('At least 2 options are required.'); return; }
  btn.parentElement.remove();
}

function _daoCreateProposal() {
  var wallet = _daoWalletAddress();
  if (!wallet) { alert('Please connect your wallet first.'); return; }

  var title = document.getElementById('daoCreateTitle').value.trim();
  if (!title) { alert('Title is required.'); return; }

  var desc = document.getElementById('daoCreateDesc').value.trim();

  // Gather options
  var optInputs = document.querySelectorAll('.dao-option-input');
  var options = [];
  for (var i = 0; i < optInputs.length; i++) {
    var v = optInputs[i].value.trim();
    if (v) options.push(v);
  }
  if (options.length < 2) { alert('At least 2 voting options are required.'); return; }

  var gateType = document.querySelector('input[name="daoGateType"]:checked').value;
  var votingPower = document.querySelector('input[name="daoVotePower"]:checked').value;

  var startTime = document.getElementById('daoStartTime').value;
  var endTime = document.getElementById('daoEndTime').value;
  if (!startTime || !endTime) { alert('Start and end times are required.'); return; }
  if (new Date(endTime) <= new Date(startTime)) { alert('End time must be after start time.'); return; }

  var body = {
    title: title,
    description: desc,
    options: options,
    gateType: gateType,
    votingPower: votingPower,
    startTime: new Date(startTime).toISOString(),
    endTime: new Date(endTime).toISOString(),
    creator: wallet,
    network: _daoNetwork(),
  };

  // Gate-specific fields
  if (gateType === 'nft') {
    var classId = document.getElementById('daoNftClassId').value.trim();
    if (!classId) { alert('NFT Class ID is required for NFT gating.'); return; }
    body.nftClassId = classId;
  }
  if (gateType === 'token') {
    var denom = document.getElementById('daoTokenDenom').value.trim();
    if (!denom) { alert('Token denom is required for token gating.'); return; }
    body.tokenDenom = denom;
    var minBal = document.getElementById('daoMinBalance').value.trim();
    if (minBal) body.minTokenBalance = minBal;
  }

  var btn = document.getElementById('daoCreateBtn');
  if (btn) { btn.textContent = 'Creating...'; btn.disabled = true; }

  fetch(_daoApiUrl() + '/api/dao/create-proposal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) {
        alert('Failed to create proposal: ' + data.error);
        if (btn) { btn.textContent = 'Create Proposal'; btn.disabled = false; }
        return;
      }
      // Switch to proposals tab and reload
      _daoSwitchTab('proposals');
    })
    .catch(function(err) {
      alert('Error: ' + err.message);
      if (btn) { btn.textContent = 'Create Proposal'; btn.disabled = false; }
    });
}

/* ── Helpers ── */

function _daoEsc(str) {
  if (!str) return '';
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function _daoTruncAddr(addr) {
  if (!addr || addr.length < 16) return addr || '';
  return addr.slice(0, 10) + '...' + addr.slice(-4);
}

function _daoPowerLabel(power) {
  if (power === 'token_weighted') return 'Token Weighted';
  if (power === 'nft_count') return 'NFT Count';
  return 'Equal';
}

function _daoLocalISOString(date) {
  var tzOff = date.getTimezoneOffset() * 60000;
  var local = new Date(date - tzOff);
  return local.toISOString().slice(0, 16);
}
