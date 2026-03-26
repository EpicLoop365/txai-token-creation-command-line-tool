/* ===== TXAI - NFT Collection & Minting ===== */

// ─── Issue NFT Class ────────────────────────────────────────────────────────

async function nftIssueClass(){
  const symbol = document.getElementById('nftSymbol').value.trim();
  const name = document.getElementById('nftName').value.trim();
  const description = document.getElementById('nftDescription').value.trim();
  const uri = document.getElementById('nftUri').value.trim();
  const royaltyPct = parseFloat(document.getElementById('nftRoyalty').value) || 0;

  if(!symbol || !name){
    nftShowResult('nftCreateResult', false, 'Symbol and Name are required.');
    return;
  }
  if(!/^[a-zA-Z][a-zA-Z0-9]{0,19}$/.test(symbol)){
    nftShowResult('nftCreateResult', false, 'Symbol must be 1-20 alphanumeric characters starting with a letter.');
    return;
  }

  const features = {};
  if(document.getElementById('nftFeatBurning').checked) features.burning = true;
  if(document.getElementById('nftFeatFreezing').checked) features.freezing = true;
  if(document.getElementById('nftFeatWhitelisting').checked) features.whitelisting = true;
  if(document.getElementById('nftFeatDisableSending').checked) features.disableSending = true;
  if(document.getElementById('nftFeatSoulbound').checked) features.soulbound = true;

  const royaltyRate = royaltyPct > 0 ? (royaltyPct / 100).toString() : undefined;

  nftSetLoading('nftCreateBtn', 'nftCreateBtnText', 'nftCreateSpinner', true);
  document.getElementById('nftCreateResult').style.display = 'none';

  try {
    const res = await fetch(`${API_URL}/api/nft/issue-class`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, name, description, uri, features, royaltyRate }),
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    const classId = data.classId || '';
    nftShowResult('nftCreateResult', true,
      `Collection created! Class: ${classId}`,
      data.explorerUrl, classId);

    // Auto-fill the mint class ID
    if(classId) document.getElementById('nftMintClassId').value = classId;

  } catch(err){
    nftShowResult('nftCreateResult', false, `Failed: ${err.message}`);
  } finally {
    nftSetLoading('nftCreateBtn', 'nftCreateBtnText', 'nftCreateSpinner', false);
  }
}

// ─── Mint NFT ───────────────────────────────────────────────────────────────

async function nftMintToken(){
  const batchMode = document.getElementById('nftBatchMode').checked;

  if(batchMode){
    await nftBatchMint();
    return;
  }

  const classId = document.getElementById('nftMintClassId').value.trim();
  const id = document.getElementById('nftMintId').value.trim();
  const uri = document.getElementById('nftMintUri').value.trim();
  const recipient = document.getElementById('nftMintRecipient').value.trim();

  if(!classId || !id){
    nftShowResult('nftMintResult', false, 'Class ID and NFT ID are required.');
    return;
  }

  nftSetLoading('nftMintBtn', 'nftMintBtnText', 'nftMintSpinner', true);
  document.getElementById('nftMintResult').style.display = 'none';

  try {
    const body = { classId, id, uri: uri || undefined, recipient: recipient || undefined };
    const res = await fetch(`${API_URL}/api/nft/mint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    nftShowResult('nftMintResult', true,
      `Minted NFT "${id}" in ${classId.split('-')[0].toUpperCase()}`,
      data.explorerUrl);

  } catch(err){
    nftShowResult('nftMintResult', false, `Mint failed: ${err.message}`);
  } finally {
    nftSetLoading('nftMintBtn', 'nftMintBtnText', 'nftMintSpinner', false);
  }
}

async function nftBatchMint(){
  const classId = document.getElementById('nftMintClassId').value.trim();
  const count = parseInt(document.getElementById('nftBatchCount').value) || 10;
  const prefix = document.getElementById('nftBatchPrefix').value || 'nft-';
  const uri = document.getElementById('nftMintUri').value.trim();
  const recipient = document.getElementById('nftMintRecipient').value.trim();

  if(!classId){
    nftShowResult('nftMintResult', false, 'Class ID is required.');
    return;
  }
  if(count < 1 || count > 100){
    nftShowResult('nftMintResult', false, 'Batch count must be 1-100.');
    return;
  }

  nftSetLoading('nftMintBtn', 'nftMintBtnText', 'nftMintSpinner', true);
  document.getElementById('nftMintResult').style.display = 'none';

  let minted = 0, failed = 0;
  const startNum = Date.now() % 100000; // Unique offset

  for(let i = 0; i < count; i++){
    const nftId = `${prefix}${startNum + i}`;
    try {
      document.getElementById('nftMintBtnText').textContent = `Minting ${i+1}/${count}...`;
      const body = { classId, id: nftId, uri: uri || undefined, recipient: recipient || undefined };
      const res = await fetch(`${API_URL}/api/nft/mint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if(res.ok && data.success) minted++;
      else failed++;
    } catch {
      failed++;
    }
  }

  const success = minted > 0;
  nftShowResult('nftMintResult', success,
    `Batch complete: ${minted} minted, ${failed} failed`);

  nftSetLoading('nftMintBtn', 'nftMintBtnText', 'nftMintSpinner', false);
  document.getElementById('nftMintBtnText').textContent = '\u26A1 Mint NFT';
}

function nftToggleBatch(){
  const on = document.getElementById('nftBatchMode').checked;
  document.getElementById('nftBatchFields').style.display = on ? 'flex' : 'none';
  document.getElementById('nftMintId').disabled = on;
  document.getElementById('nftMintId').style.opacity = on ? '0.5' : '1';
  document.getElementById('nftMintBtnText').textContent = on ? '\u26A1 Batch Mint' : '\u26A1 Mint NFT';
}

// ─── Browse NFTs ────────────────────────────────────────────────────────────

async function nftBrowse(){
  const input = document.getElementById('nftBrowseInput').value.trim();
  if(!input){
    return;
  }

  const classCard = document.getElementById('nftClassCard');
  const grid = document.getElementById('nftGrid');
  const empty = document.getElementById('nftEmpty');
  classCard.style.display = 'none';
  grid.innerHTML = '<div class="nft-loading">Loading...</div>';
  empty.style.display = 'none';

  try {
    // Detect if input is a wallet address or classId
    const isAddress = input.startsWith('testcore') || input.startsWith('core');

    if(isAddress){
      // Query NFTs owned by address
      const res = await fetch(`${API_URL}/api/nft/nfts?owner=${encodeURIComponent(input)}`);
      const data = await res.json();
      if(!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      const nfts = data.nfts || [];
      if(nfts.length === 0){
        grid.innerHTML = '';
        empty.style.display = 'block';
        return;
      }
      nftRenderGrid(nfts);

    } else {
      // Query class info + NFTs in that class
      const [classRes, nftsRes] = await Promise.all([
        fetch(`${API_URL}/api/nft/class?classId=${encodeURIComponent(input)}`),
        fetch(`${API_URL}/api/nft/nfts?classId=${encodeURIComponent(input)}`),
      ]);

      if(classRes.ok){
        const classData = await classRes.json();
        const cls = classData.class;
        if(cls){
          document.getElementById('nftClassName').textContent = `${cls.name} (${cls.symbol})`;
          document.getElementById('nftClassId').textContent = cls.id || input;
          document.getElementById('nftClassIssuer').textContent = `Issuer: ${(cls.issuer || '').slice(0, 16)}...`;
          const royalty = parseFloat(cls.royaltyRate || cls.royalty_rate || '0');
          document.getElementById('nftClassRoyalty').textContent = royalty > 0
            ? `Royalty: ${(royalty * 100).toFixed(1)}%`
            : 'Royalty: None';

          // Render feature badges
          const featureEl = document.getElementById('nftClassFeatures');
          const features = cls.features || [];
          const featureLabels = {
            'burning': '🔥 Burning', 'freezing': '❄️ Freezing',
            'whitelisting': '✅ Whitelisting', 'disable_sending': '🚫 No Sending',
            'soulbound': '🔗 Soulbound'
          };
          featureEl.innerHTML = features.map(f =>
            `<span class="nft-feature-badge">${featureLabels[f] || f}</span>`
          ).join('');

          classCard.style.display = 'block';
        }
      }

      if(nftsRes.ok){
        const nftsData = await nftsRes.json();
        const nfts = nftsData.nfts || [];
        if(nfts.length === 0){
          grid.innerHTML = '';
          empty.style.display = 'block';
        } else {
          nftRenderGrid(nfts);
        }
      } else {
        grid.innerHTML = '';
        empty.style.display = 'block';
      }
    }

  } catch(err){
    grid.innerHTML = `<div class="nft-error">Error: ${escapeHtml(err.message)}</div>`;
  }
}

function nftRenderGrid(nfts){
  const grid = document.getElementById('nftGrid');
  grid.innerHTML = nfts.map(nft => {
    const classSymbol = (nft.classId || nft.class_id || '').split('-')[0].toUpperCase();
    const nftId = nft.id || '?';
    const uri = nft.uri || '';
    const hasImage = uri && (uri.endsWith('.png') || uri.endsWith('.jpg') || uri.endsWith('.gif') || uri.endsWith('.webp') || uri.includes('ipfs'));

    return `<div class="nft-card">
      <div class="nft-card-preview">${hasImage
        ? `<img src="${escapeHtml(uri)}" alt="${escapeHtml(nftId)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        : ''}<div class="nft-card-placeholder" ${hasImage ? 'style="display:none"' : ''}>🎨</div>
      </div>
      <div class="nft-card-info">
        <div class="nft-card-id">${escapeHtml(nftId)}</div>
        <div class="nft-card-class">${escapeHtml(classSymbol)}</div>
      </div>
    </div>`;
  }).join('');
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function nftSetLoading(btnId, textId, spinnerId, loading){
  const btn = document.getElementById(btnId);
  const text = document.getElementById(textId);
  const spinner = document.getElementById(spinnerId);
  btn.disabled = loading;
  btn.style.opacity = loading ? '0.7' : '1';
  spinner.style.display = loading ? 'inline-block' : 'none';
  if(loading) text.style.opacity = '0.5';
  else text.style.opacity = '1';
}

function nftShowResult(containerId, success, msg, explorerUrl, classId){
  const container = document.getElementById(containerId);
  const icon = container.querySelector('.nft-result-icon');
  const msgEl = container.querySelector('.nft-result-msg');
  const link = container.querySelector('.nft-result-link');
  const classIdEl = container.querySelector('.nft-result-classid');

  container.style.display = 'block';
  icon.textContent = success ? '✓' : '✗';
  icon.className = 'nft-result-icon ' + (success ? 'success' : 'error');
  msgEl.textContent = msg;

  if(link){
    if(explorerUrl){
      link.href = explorerUrl;
      link.style.display = 'inline-block';
    } else {
      link.style.display = 'none';
    }
  }

  if(classIdEl){
    if(classId){
      classIdEl.textContent = `Class ID: ${classId}`;
      classIdEl.style.display = 'block';
    } else {
      classIdEl.style.display = 'none';
    }
  }
}
