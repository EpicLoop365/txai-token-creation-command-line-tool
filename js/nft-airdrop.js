/* ===== TXAI — NFT Collection Airdrop Tool ===== */
/*
 * Architecture:
 *   1. Validator/project owner fetches staker or token holder addresses
 *   2. User configures NFT collection: name, symbol, description, URI, royalty
 *   3. Preview shows recipient count and confirmation prompt
 *   4. Execute calls /api/nft-airdrop to mint + distribute NFTs
 *   5. Live progress bar and log updates during execution
 *   6. Completion summary: classId, minted count, errors
 *   7. History saved to localStorage for reference
 */

const NFT_AIRDROP_STORAGE_KEY = 'txai_nft_airdrop_history';

let nftAirdropHistory = [];
let nftAirdropInitialized = false;
let nftAirdropRunning = false;

/* ── Init ── */
function nftAirdropInit() {
  if (nftAirdropInitialized) return;
  nftAirdropInitialized = true;
  nftAirdropLoadHistory();
  nftAirdropRenderHistory();

  // Wire up fetch buttons
  const fetchStakersBtn = document.getElementById('nftAdFetchStakers');
  if (fetchStakersBtn) {
    fetchStakersBtn.addEventListener('click', nftAirdropFetchStakers);
  }

  const fetchHoldersBtn = document.getElementById('nftAdFetchHolders');
  if (fetchHoldersBtn) {
    fetchHoldersBtn.addEventListener('click', nftAirdropFetchHolders);
  }

  // Wire up execute button
  const executeBtn = document.getElementById('nftAdExecuteBtn');
  if (executeBtn) {
    executeBtn.addEventListener('click', nftAirdropExecute);
  }

  // Live address count on textarea input
  const recipientsEl = document.getElementById('nftAdRecipients');
  if (recipientsEl) {
    recipientsEl.addEventListener('input', nftAirdropUpdateCount);
  }

  nftAirdropLog('info', 'NFT Airdrop tool ready.');
}

/* ── Update Address Count ── */
function nftAirdropUpdateCount() {
  const recipientsEl = document.getElementById('nftAdRecipients');
  const countEl = document.getElementById('nftAdCount');
  if (!recipientsEl || !countEl) return;

  const addresses = nftAirdropParseRecipients();
  countEl.textContent = addresses.length + ' addresses';
}

/* ── Parse Recipients from Textarea ── */
function nftAirdropParseRecipients() {
  const recipientsEl = document.getElementById('nftAdRecipients');
  if (!recipientsEl) return [];

  const raw = recipientsEl.value.trim();
  if (!raw) return [];

  const lines = raw.split(/\n/).map(s => s.trim()).filter(Boolean);
  const seen = new Set();
  const unique = [];

  for (const addr of lines) {
    if (!seen.has(addr)) {
      seen.add(addr);
      unique.push(addr);
    }
  }

  return unique;
}

/* ── Fetch Stakers ── */
async function nftAirdropFetchStakers() {
  const validatorAddr = (document.getElementById('nftAdValidator').value || '').trim();
  const errorEl = document.getElementById('nftAdError');

  if (!validatorAddr) {
    nftAirdropShowError('Validator address is required.');
    return;
  }

  nftAirdropLog('info', `Fetching stakers for ${validatorAddr.slice(0, 20)}...`);

  try {
    const res = await fetch(`${API_URL}/api/stakers/${encodeURIComponent(validatorAddr)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    const addresses = data.addresses || data.stakers || [];
    if (!addresses.length) {
      nftAirdropLog('info', 'No stakers found for this validator.');
    }

    const recipientsEl = document.getElementById('nftAdRecipients');
    if (recipientsEl) recipientsEl.value = addresses.join('\n');

    nftAirdropUpdateCount();

    if (errorEl) { errorEl.textContent = ''; errorEl.style.display = 'none'; }
    nftAirdropLog('success', `Loaded ${addresses.length} staker address(es).`);

  } catch (err) {
    nftAirdropShowError(`Failed to fetch stakers: ${err.message}`);
  }
}

/* ── Fetch Token Holders ── */
async function nftAirdropFetchHolders() {
  const denom = (document.getElementById('nftAdDenom').value || '').trim();
  const errorEl = document.getElementById('nftAdError');

  if (!denom) {
    nftAirdropShowError('Token denom is required.');
    return;
  }

  nftAirdropLog('info', `Fetching holders for ${escapeHtml(denom)}...`);

  try {
    const res = await fetch(`${API_URL}/api/holders/${encodeURIComponent(denom)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    const addresses = data.addresses || data.holders || [];
    if (!addresses.length) {
      nftAirdropLog('info', 'No holders found for this denom.');
    }

    const recipientsEl = document.getElementById('nftAdRecipients');
    if (recipientsEl) recipientsEl.value = addresses.join('\n');

    nftAirdropUpdateCount();

    if (errorEl) { errorEl.textContent = ''; errorEl.style.display = 'none'; }
    nftAirdropLog('success', `Loaded ${addresses.length} holder address(es).`);

  } catch (err) {
    nftAirdropShowError(`Failed to fetch holders: ${err.message}`);
  }
}

/* ── Execute NFT Airdrop ── */
async function nftAirdropExecute() {
  if (nftAirdropRunning) return;

  const name = (document.getElementById('nftAdName').value || '').trim();
  const symbol = (document.getElementById('nftAdSymbol').value || '').trim();
  const description = (document.getElementById('nftAdDesc').value || '').trim();
  const uri = (document.getElementById('nftAdUri').value || '').trim();
  const royaltyRate = parseFloat(document.getElementById('nftAdRoyalty').value) || 0;
  const recipients = nftAirdropParseRecipients();

  // Validation
  if (!name) return nftAirdropShowResult(false, 'Collection name is required.');
  if (!symbol) return nftAirdropShowResult(false, 'Symbol is required.');
  if (!recipients.length) return nftAirdropShowResult(false, 'At least one recipient address is required.');

  // Confirmation
  if (!confirm(`Airdrop ${recipients.length} NFTs to ${recipients.length} addresses?`)) return;

  const btn = document.getElementById('nftAdExecuteBtn');
  const progressWrap = document.getElementById('nftAdProgress');
  const progressBar = document.getElementById('nftAdProgressBar');
  const progressText = document.getElementById('nftAdProgressText');

  nftAirdropRunning = true;
  if (btn) { btn.disabled = true; btn.textContent = 'Minting...'; }
  if (progressWrap) progressWrap.style.display = 'block';
  if (progressBar) progressBar.style.width = '0%';
  if (progressText) progressText.textContent = 'Starting...';

  nftAirdropLog('info', `Starting NFT airdrop: "${name}" (${symbol}) to ${recipients.length} recipients`);

  try {
    const res = await fetch(`${API_URL}/api/nft-airdrop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        symbol,
        description,
        uri,
        recipients,
        royaltyRate,
      }),
    });

    // Handle streaming progress if available, otherwise standard JSON
    if (res.headers.get('content-type')?.includes('text/event-stream')) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          try {
            const evt = JSON.parse(trimmed.slice(5));
            if (evt.progress != null) {
              const pct = Math.round(evt.progress * 100);
              if (progressBar) progressBar.style.width = pct + '%';
              if (progressText) progressText.textContent = evt.message || `${pct}%`;
            }
            if (evt.type === 'log') {
              nftAirdropLog('info', evt.message);
            }
          } catch {}
        }
      }
    }

    const data = res.headers.get('content-type')?.includes('text/event-stream')
      ? null
      : await res.json();

    if (data && !res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (data && data.error) throw new Error(data.error);

    // Complete
    if (progressBar) progressBar.style.width = '100%';
    if (progressText) progressText.textContent = 'Done';

    const classId = data?.classId || 'N/A';
    const minted = data?.minted || recipients.length;
    const errors = data?.errors || [];

    const summary = `NFT airdrop complete! Class ID: ${classId}. Minted: ${minted}/${recipients.length}.`
      + (errors.length ? ` Errors: ${errors.length}` : '');

    nftAirdropShowResult(true, summary);
    nftAirdropLog('success', summary);

    if (errors.length) {
      for (const e of errors.slice(0, 10)) {
        nftAirdropLog('error', `Mint error: ${e.address || 'unknown'} — ${e.message || e}`);
      }
    }

    // Save to history
    const entry = {
      id: Date.now(),
      name,
      symbol,
      classId,
      recipients: recipients.length,
      minted,
      errors: errors.length,
      date: new Date().toISOString(),
      status: errors.length === 0 ? 'success' : (minted === 0 ? 'failed' : 'partial'),
    };
    nftAirdropHistory.unshift(entry);
    nftAirdropSaveHistory();
    nftAirdropRenderHistory();

  } catch (err) {
    if (progressBar) progressBar.style.width = '100%';
    if (progressText) progressText.textContent = 'Failed';
    nftAirdropShowResult(false, `Airdrop failed: ${err.message}`);
    nftAirdropLog('error', `Airdrop failed: ${err.message}`);

    // Save failed entry to history
    const entry = {
      id: Date.now(),
      name,
      symbol,
      classId: null,
      recipients: recipients.length,
      minted: 0,
      errors: recipients.length,
      date: new Date().toISOString(),
      status: 'failed',
    };
    nftAirdropHistory.unshift(entry);
    nftAirdropSaveHistory();
    nftAirdropRenderHistory();

  } finally {
    nftAirdropRunning = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Execute Airdrop'; }
  }
}

/* ── Render History ── */
function nftAirdropRenderHistory() {
  const listEl = document.getElementById('nftAdHistory');
  if (!listEl) return;

  if (!nftAirdropHistory.length) {
    listEl.innerHTML = '<div class="nft-ad-empty">No NFT airdrops yet.</div>';
    return;
  }

  let html = '';
  for (const entry of nftAirdropHistory) {
    const dateStr = new Date(entry.date).toLocaleString();
    const statusLabel = entry.status === 'success' ? 'Success'
      : entry.status === 'failed' ? 'Failed' : 'Partial';

    html += `
      <div class="nft-ad-history-card ${entry.status}">
        <div>
          <div class="nft-ad-history-name">${escapeHtml(entry.name)}</div>
          <div class="nft-ad-history-meta">${dateStr} · ${entry.recipients} recipients · ${entry.classId ? 'Class: ' + escapeHtml(entry.classId) : 'No class ID'}</div>
        </div>
        <div class="nft-ad-history-status">
          <span class="nft-ad-status-badge ${entry.status}">${statusLabel}</span>
          <span class="nft-ad-history-count">${entry.minted}/${entry.recipients}</span>
        </div>
      </div>`;
  }
  listEl.innerHTML = html;
}

/* ── Show Result ── */
function nftAirdropShowResult(success, msg) {
  const el = document.getElementById('nftAdResult');
  if (!el) return;
  el.className = 'nft-ad-result ' + (success ? 'success' : 'error');
  el.textContent = msg;
  el.style.display = 'block';

  // Auto-hide after 8 seconds
  setTimeout(() => {
    if (el.textContent === msg) {
      el.style.display = 'none';
    }
  }, 8000);
}

/* ── Error Display ── */
function nftAirdropShowError(msg) {
  const errorEl = document.getElementById('nftAdError');
  if (errorEl) {
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
  }
  nftAirdropLog('error', msg);
}

/* ── Logging ── */
function nftAirdropLog(type, msg) {
  const logEl = document.getElementById('nftAdLog');
  if (!logEl) return;
  const entry = document.createElement('div');
  entry.className = 'nft-ad-log-entry ' + type;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logEl.prepend(entry);
  // Keep max 30 entries
  while (logEl.children.length > 30) logEl.removeChild(logEl.lastChild);
}

/* ── Local Storage ── */
function nftAirdropLoadHistory() {
  try {
    const raw = localStorage.getItem(NFT_AIRDROP_STORAGE_KEY);
    nftAirdropHistory = raw ? JSON.parse(raw) : [];
  } catch { nftAirdropHistory = []; }
}

function nftAirdropSaveHistory() {
  try {
    localStorage.setItem(NFT_AIRDROP_STORAGE_KEY, JSON.stringify(nftAirdropHistory));
  } catch {}
}

/* ══════════════════════════════════════════
   Wizard UI Functions
   ══════════════════════════════════════════ */

let nftAdCurrentStep = 1;

/* ── Step Navigation ── */
function nftAdGoStep(step) {
  // Validate before advancing
  if (step === 2 && nftAdCurrentStep === 1) {
    const name = (document.getElementById('nftAdName').value || '').trim();
    if (!name) { document.getElementById('nftAdName').focus(); return; }
  }
  if (step === 3 && nftAdCurrentStep === 2) {
    const addrs = nftAirdropParseRecipients();
    if (addrs.length === 0) { document.getElementById('nftAdRecipients').focus(); return; }
    // Populate review
    document.getElementById('nftAdRevName').textContent = document.getElementById('nftAdName').value;
    document.getElementById('nftAdRevCount').textContent = addrs.length + ' wallets';
    document.getElementById('nftAdRevRoyalty').textContent = (parseFloat(document.getElementById('nftAdRoyalty').value || 0) * 100) + '%';
    document.getElementById('nftAdRevGas').textContent = '~' + (addrs.length * 0.05).toFixed(2) + ' CORE';
  }

  nftAdCurrentStep = step;
  // Show/hide panels
  for (let i = 1; i <= 3; i++) {
    const panel = document.getElementById('nftAdStep' + i);
    if (panel) panel.style.display = i === step ? '' : 'none';
  }
  // Update step indicators
  document.querySelectorAll('#nftAdWizSteps .wiz-step').forEach(el => {
    const s = parseInt(el.dataset.step);
    el.classList.remove('active', 'done');
    if (s === step) el.classList.add('active');
    if (s < step) el.classList.add('done');
  });
  // Scroll to top of wizard
  const wrap = document.getElementById('nftAirdropWrap');
  if (wrap) wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ── Image Upload (drag & drop + file picker) ── */
function nftAdHandleImage(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  nftAdUploadImage(file);
}

async function nftAdUploadImage(file) {
  const zone = document.getElementById('nftAdUploadZone');
  const placeholder = document.getElementById('nftAdUploadPlaceholder');
  const preview = document.getElementById('nftAdPreviewImg');
  const uriInput = document.getElementById('nftAdUri');

  // Show local preview immediately
  const reader = new FileReader();
  reader.onload = function(e) {
    preview.innerHTML = '<img src="' + e.target.result + '">';
    preview.style.display = '';
    placeholder.style.display = 'none';
    zone.classList.add('has-image');
    nftAdUpdatePreviewCard(e.target.result);
  };
  reader.readAsDataURL(file);

  // Upload to imgbb
  try {
    const formData = new FormData();
    formData.append('image', file);
    const res = await fetch('https://api.imgbb.com/1/upload?key=00000000000000000000000000000000', {
      method: 'POST', body: formData
    });
    if (res.ok) {
      const data = await res.json();
      if (data.data && data.data.url) {
        uriInput.value = data.data.url;
        nftAirdropLog('info', 'Image uploaded: ' + data.data.url);
      }
    }
  } catch {
    // Fallback: use local data URL (won't persist on-chain but works for demo)
    nftAirdropLog('info', 'Image set locally (paste a hosted URL for on-chain metadata)');
  }
}

// Drag & drop support
(function() {
  setTimeout(function() {
    const zone = document.getElementById('nftAdUploadZone');
    if (!zone) return;
    zone.addEventListener('dragover', function(e) { e.preventDefault(); zone.style.borderColor = 'var(--accent)'; });
    zone.addEventListener('dragleave', function() { zone.style.borderColor = ''; });
    zone.addEventListener('drop', function(e) {
      e.preventDefault(); zone.style.borderColor = '';
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) nftAdUploadImage(file);
    });
  }, 500);
})();

/* ── Auto-generate symbol from name ── */
(function() {
  setTimeout(function() {
    const nameInput = document.getElementById('nftAdName');
    const symInput = document.getElementById('nftAdSymbol');
    const cardName = document.getElementById('nftAdCardName');
    if (!nameInput || !symInput) return;
    nameInput.addEventListener('input', function() {
      const name = nameInput.value.trim();
      // Generate symbol: first letters of each word, max 6 chars
      const words = name.split(/\s+/).filter(Boolean);
      let sym = words.length > 1
        ? words.map(w => w[0]).join('').toUpperCase().slice(0, 6)
        : name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
      symInput.value = sym || '';
      if (cardName) cardName.textContent = name || 'Your Collection';
    });
  }, 500);
})();

/* ── Royalty preset buttons ── */
function nftAdSetRoyalty(btn, val) {
  document.getElementById('nftAdRoyalty').value = val;
  document.querySelectorAll('.nft-ad-royalty-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const cardRoyalty = document.getElementById('nftAdCardRoyalty');
  if (cardRoyalty) cardRoyalty.textContent = (val * 100) + '% royalty on resales';
}

/* ── Live preview card update ── */
function nftAdUpdatePreviewCard(imgSrc) {
  const cardImg = document.getElementById('nftAdCardImg');
  if (cardImg && imgSrc) {
    cardImg.innerHTML = '<img src="' + imgSrc + '" style="width:100%;height:100%;object-fit:cover;border-radius:8px">';
  }
}

/* ── Source tab switching (Paste / Holders / Stakers) ── */
function nftAdSourceTab(btn, tab) {
  document.querySelectorAll('.nft-ad-source-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('nftAdSrcPaste').style.display = tab === 'paste' ? '' : 'none';
  document.getElementById('nftAdSrcHolders').style.display = tab === 'holders' ? '' : 'none';
  document.getElementById('nftAdSrcStakers').style.display = tab === 'stakers' ? '' : 'none';
}

/* ── CSV Import ── */
function nftAdImportCsv(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    const text = e.target.result;
    // Parse: find anything that looks like a core/testcore address
    const matches = text.match(/(test)?core[a-z0-9]{39,}/g) || [];
    const unique = [...new Set(matches)];
    const ta = document.getElementById('nftAdRecipients');
    if (ta) {
      ta.value = unique.join('\n');
      nftAirdropUpdateCount();
    }
    nftAirdropLog('info', 'Imported ' + unique.length + ' addresses from ' + file.name);
  };
  reader.readAsText(file);
}

/* ── Update address count display ── */
(function() {
  setTimeout(function() {
    const ta = document.getElementById('nftAdRecipients');
    if (!ta) return;
    ta.addEventListener('input', function() {
      nftAirdropUpdateCount();
      const count = nftAirdropParseRecipients().length;
      const cardCount = document.getElementById('nftAdCardCount');
      if (cardCount) cardCount.textContent = count || '?';
    });
  }, 500);
})();
