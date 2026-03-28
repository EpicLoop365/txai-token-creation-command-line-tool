/* ===== TXAI — Analytics Dashboard ===== */
/*
 * Fetches visitor analytics from the API and renders the dashboard.
 * Available to any Creator+ pass holder.
 *
 * The tracker beacon (tracker.js) sends visit events.
 * The API aggregates: IPs, wallets, pass tiers, pages, referrers.
 * This dashboard displays the aggregated data.
 */

const ANALYTICS_STORAGE_KEY = 'txai_analytics_key';

// Get or prompt for analytics key
function analyticsGetKey() {
  let key = localStorage.getItem(ANALYTICS_STORAGE_KEY);
  if (!key) {
    key = prompt('Enter your analytics key:');
    if (key) {
      localStorage.setItem(ANALYTICS_STORAGE_KEY, key);
    }
  }
  return key;
}

// Refresh dashboard
async function analyticsRefresh() {
  const key = analyticsGetKey();
  if (!key) return;

  const summaryCards = document.getElementById('analyticsSummary');
  const recentEl = document.getElementById('analyticsRecent');

  try {
    const res = await fetch(`${API_URL}/api/analytics?key=${encodeURIComponent(key)}`);
    if (!res.ok) {
      const err = await res.json();
      if (recentEl) recentEl.innerHTML = `<div style="color:#ef4444">${escapeHtml(err.error || 'Failed to load')}</div>`;
      if (err.error && err.error.includes('Invalid')) {
        localStorage.removeItem(ANALYTICS_STORAGE_KEY);
      }
      return;
    }

    const data = await res.json();
    analyticsRender(data);
  } catch (err) {
    if (recentEl) recentEl.innerHTML = `<div style="color:#ef4444">Error: ${escapeHtml(err.message)}</div>`;
  }
}

// Render dashboard data
function analyticsRender(data) {
  const s = data.summary;

  // Summary cards
  const el = (id) => document.getElementById(id);
  if (el('analyticsVisitors')) el('analyticsVisitors').textContent = s.last24h.uniqueVisitors;
  if (el('analyticsWallets')) el('analyticsWallets').textContent = s.last24h.walletsConnected;
  if (el('analyticsConversion')) el('analyticsConversion').textContent = s.last24h.conversionRate;
  if (el('analyticsLiveNow')) el('analyticsLiveNow').textContent = s.last1h.uniqueVisitors;

  // Tier bars
  const tiers = data.passTiers || {};
  const total = Math.max(Object.values(tiers).reduce((a, b) => a + b, 0), 1);

  for (const [tier, count] of Object.entries(tiers)) {
    const bar = el('analyticsBar' + tier.charAt(0).toUpperCase() + tier.slice(1));
    const countEl = el('analyticsCount' + tier.charAt(0).toUpperCase() + tier.slice(1));
    if (bar) bar.style.width = ((count / total) * 100) + '%';
    if (countEl) countEl.textContent = count;
  }

  // Recent visitors
  const recentEl = el('analyticsRecent');
  if (recentEl && data.recent) {
    if (data.recent.length === 0) {
      recentEl.innerHTML = '<div style="color:var(--muted)">No visitors tracked yet.</div>';
      return;
    }

    let html = '<table style="width:100%;border-collapse:collapse">';
    html += '<tr style="border-bottom:1px solid var(--border);color:var(--text-dim)">';
    html += '<th style="text-align:left;padding:4px 6px;font-weight:600">Time</th>';
    html += '<th style="text-align:left;padding:4px 6px;font-weight:600">IP</th>';
    html += '<th style="text-align:left;padding:4px 6px;font-weight:600">Wallet</th>';
    html += '<th style="text-align:left;padding:4px 6px;font-weight:600">Tier</th>';
    html += '<th style="text-align:left;padding:4px 6px;font-weight:600">Page</th>';
    html += '</tr>';

    for (const v of data.recent) {
      const time = new Date(v.time).toLocaleTimeString();
      const tierColor = {
        pro: 'var(--green)',
        creator: 'var(--purple)',
        scout: '#6b7280',
        none: 'var(--text-muted)',
      }[v.tier] || 'var(--muted)';

      html += `<tr style="border-bottom:1px solid rgba(255,255,255,.03)">
        <td style="padding:3px 6px;white-space:nowrap">${time}</td>
        <td style="padding:3px 6px">${escapeHtml(v.ip)}</td>
        <td style="padding:3px 6px">${v.wallet ? escapeHtml(v.wallet) : '<span style="opacity:.3">—</span>'}</td>
        <td style="padding:3px 6px;color:${tierColor};font-weight:600">${v.tier}</td>
        <td style="padding:3px 6px">${escapeHtml(v.page)}</td>
      </tr>`;
    }

    html += '</table>';
    recentEl.innerHTML = html;
  }
}

// Embed code generator — for other users to add tracking to their sites
function analyticsGetEmbedCode() {
  return `<!-- TXAI Analytics Tracker -->
<script>const API_URL = '${API_URL}';<\/script>
<script src="https://solomentelabs.com/js/tracker.js"><\/script>`;
}
