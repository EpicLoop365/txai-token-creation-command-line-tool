/* ===== TXAI - AI Advisor Chat ===== */
function chatFromStarter(text){
  document.getElementById('chatInput').value = text;
  sendChatMessage();
}

function renderChatMessage(role, content, configCard){
  const container = document.getElementById('chatMessages');
  // Remove welcome screen on first message
  const welcome = container.querySelector('.chat-welcome');
  if(welcome) welcome.remove();

  const msg = document.createElement('div');
  msg.className = 'chat-msg ' + role;

  const avatar = document.createElement('div');
  avatar.className = 'chat-msg-avatar';
  avatar.textContent = role === 'user' ? 'You' : 'AI';

  const bubble = document.createElement('div');
  bubble.className = 'chat-msg-bubble';
  bubble.innerHTML = formatChatMarkdown(content);

  msg.appendChild(avatar);
  msg.appendChild(bubble);
  container.appendChild(msg);

  // Add config card if present
  if(configCard){
    const card = document.createElement('div');
    card.className = 'chat-msg assistant';
    card.style.maxWidth = '85%';
    card.innerHTML = '<div class="chat-msg-avatar" style="visibility:hidden">AI</div>' + buildConfigCard(configCard);
    container.appendChild(card);
  }

  container.scrollTop = container.scrollHeight;
}

function formatChatMarkdown(text){
  // Simple markdown: **bold**, bullet points, line breaks
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^\s*[-•]\s+(.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^/, '<p>').replace(/$/, '</p>');
}

function buildConfigCard(cfg){
  const features = cfg.features || {};
  const enabledFeatures = Object.entries(features).filter(([,v])=>v).map(([k])=>k).join(', ') || 'none';
  return '<div class="chat-config-card">' +
    '<div class="chat-config-title">✨ Suggested Token Config</div>' +
    '<div class="chat-config-grid">' +
    '<span class="chat-config-label">Name:</span><span class="chat-config-value">' + escapeHtml(cfg.name || 'Unknown') + '</span>' +
    '<span class="chat-config-label">Symbol:</span><span class="chat-config-value">$' + escapeHtml((cfg.symbol || cfg.name || '').toUpperCase()) + '</span>' +
    '<span class="chat-config-label">Supply:</span><span class="chat-config-value">' + Number(cfg.supply || 1000000).toLocaleString() + '</span>' +
    '<span class="chat-config-label">Decimals:</span><span class="chat-config-value">' + (cfg.decimals || 6) + '</span>' +
    '<span class="chat-config-label">Features:</span><span class="chat-config-value">' + escapeHtml(enabledFeatures) + '</span>' +
    (cfg.description ? '<span class="chat-config-label">Desc:</span><span class="chat-config-value">' + escapeHtml(cfg.description) + '</span>' : '') +
    '</div>' +
    '<button class="chat-deploy-btn" onclick=\'deployFromChat(' + JSON.stringify(JSON.stringify(cfg)) + ')\'>🚀 Deploy This Token (Testnet)</button>' +
    '</div>';
}

function showChatTyping(){
  const container = document.getElementById('chatMessages');
  const typing = document.createElement('div');
  typing.className = 'chat-typing';
  typing.id = 'chatTyping';
  typing.innerHTML = '<div class="chat-msg-avatar" style="background:var(--green);color:var(--bg);width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.75rem;font-weight:700">AI</div>' +
    '<div class="chat-typing-dots"><span></span><span></span><span></span></div>';
  container.appendChild(typing);
  container.scrollTop = container.scrollHeight;
}

function hideChatTyping(){
  const el = document.getElementById('chatTyping');
  if(el) el.remove();
}

async function sendChatMessage(){
  if(chatBusy) return;
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if(!text) return;

  input.value = '';
  chatBusy = true;
  document.getElementById('chatSendBtn').disabled = true;

  // Add user message
  chatHistory.push({ role: 'user', content: text });
  renderChatMessage('user', text);

  // Show typing indicator
  showChatTyping();

  try {
    const resp = await fetch(API_URL + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: chatHistory }),
    });

    hideChatTyping();

    if(!resp.ok){
      const err = await resp.json().catch(() => ({ error: 'Request failed' }));
      renderChatMessage('assistant', '⚠️ ' + (err.error || 'Something went wrong. Please try again.'));
      chatBusy = false;
      document.getElementById('chatSendBtn').disabled = false;
      return;
    }

    const data = await resp.json();
    chatHistory.push({ role: 'assistant', content: data.reply });
    renderChatMessage('assistant', data.reply, data.suggestedConfig);

  } catch(err){
    hideChatTyping();
    renderChatMessage('assistant', '⚠️ Could not reach the server. Please try again.');
  }

  chatBusy = false;
  document.getElementById('chatSendBtn').disabled = false;
  document.getElementById('chatInput').focus();
}

function deployFromChat(cfgJson){
  const cfg = JSON.parse(cfgJson);
  // Build a description string from the config
  const features = cfg.features || {};
  const enabledFeatures = Object.entries(features).filter(([,v])=>v).map(([k])=>k).join(', ');
  const desc = cfg.name + ', ' + Number(cfg.supply || 1000000).toLocaleString() + ' supply' +
    (enabledFeatures ? ', ' + enabledFeatures : '');

  // Switch to Create tab in Live mode
  switchTab('create');
  if(!liveMode) toggleMode(); // switch to live mode

  // Fill the input and trigger deploy
  document.getElementById('demoInput').value = desc;
  setTimeout(() => runDemo(), 300);
}

