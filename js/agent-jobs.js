/* ===== TXAI — Agent Job Board & Resume System ===== */
/*
 * NFTs don't just sit in your wallet — they work side jobs.
 *
 * Architecture:
 *   1. Resume: Each Agent NFT has a skills profile, bio, hourly rate, and track record
 *   2. Job Board: Anyone can post tasks; agents apply/get hired
 *   3. Twitter/X: Agents can have their own social account to advertise services
 *   4. Earnings: Agents earn TX for completed jobs → owner collects passive income
 *
 * Data flow:
 *   Agent NFT metadata → resume fields → job board listing
 *   Job posted → agent hired → script runs → job completed → earnings credited
 *   Agent tweets: job completions, milestones, availability updates
 */

const JOBS_STORAGE_KEY = 'txai_agent_jobs';
const RESUMES_STORAGE_KEY = 'txai_agent_resumes';

// ── Skill Categories ──
const AGENT_SKILLS = {
  'chain-monitoring':  { label: 'Chain Monitoring',  icon: '🔭', color: '#3b82f6' },
  'whale-tracking':    { label: 'Whale Tracking',    icon: '🐋', color: '#06b6d4' },
  'price-alerts':      { label: 'Price Alerts',      icon: '📊', color: '#8b5cf6' },
  'liquidity-mgmt':    { label: 'Liquidity Mgmt',    icon: '💧', color: '#0ea5e9' },
  'airdrop-ops':       { label: 'Airdrop Ops',       icon: '📡', color: '#10b981' },
  'social-posting':    { label: 'Social Posting',    icon: '📣', color: '#f59e0b' },
  'nft-management':    { label: 'NFT Management',    icon: '🎨', color: '#ec4899' },
  'security-watch':    { label: 'Security Watch',    icon: '🛡️', color: '#ef4444' },
  'dex-trading':       { label: 'DEX Trading',       icon: '📈', color: '#22c55e' },
  'data-analytics':    { label: 'Data Analytics',    icon: '📋', color: '#6366f1' },
  'event-response':    { label: 'Event Response',    icon: '⚡', color: '#f97316' },
  'custom':            { label: 'Custom Task',       icon: '🔧', color: '#94a3b8' },
};

// Auto-map template types to skills
const TEMPLATE_SKILLS = {
  'whale-watcher':     ['whale-tracking', 'chain-monitoring', 'price-alerts'],
  'chain-scout':       ['chain-monitoring', 'data-analytics', 'event-response'],
  'holder-analytics':  ['data-analytics', 'chain-monitoring'],
  'event-monitor':     ['event-response', 'chain-monitoring', 'security-watch'],
  'price-guardian':    ['price-alerts', 'dex-trading', 'event-response'],
  'airdrop-scheduler': ['airdrop-ops', 'nft-management'],
  'social-agent':      ['social-posting', 'data-analytics'],
  'custom-script':     ['custom'],
};

// ── Job Status ──
const JOB_STATUS = {
  open: { label: 'Open', color: '#22c55e', icon: '🟢' },
  hired: { label: 'In Progress', color: '#f59e0b', icon: '🟡' },
  completed: { label: 'Completed', color: '#3b82f6', icon: '🔵' },
  cancelled: { label: 'Cancelled', color: '#ef4444', icon: '🔴' },
};

// ── State ──
let agentJobs = [];
let agentResumes = [];

// ═══════════════════════════════════════════════════════════
//  RESUME SYSTEM
// ═══════════════════════════════════════════════════════════

/**
 * Build a resume from an agent NFT history entry.
 * Called when user "activates" an agent for the job board.
 */
function agentResumeCreate(agentEntry) {
  const skills = TEMPLATE_SKILLS[agentEntry.type] || ['custom'];

  const resume = {
    id: 'resume_' + agentEntry.id,
    agentId: agentEntry.id,
    agentName: agentEntry.name,
    classId: agentEntry.classId,
    type: agentEntry.type,
    typeName: agentEntry.typeName,
    icon: agentEntry.icon,
    symbol: agentEntry.symbol,
    wallet: agentEntry.wallet,

    // Resume fields
    bio: '',
    skills: skills,
    hourlyRate: 0,         // in utestcore
    availability: 'always-on',  // always-on | scheduled | on-demand
    maxConcurrentJobs: 3,

    // Social
    twitter: '',           // @handle on X
    telegram: '',          // @bot or t.me/ link
    twitterAutoPost: false,
    telegramAutoPost: false,
    tweetOnHire: true,
    tweetOnComplete: true,
    tweetOnMilestone: true,

    // Track record
    jobsCompleted: 0,
    jobsFailed: 0,
    totalEarned: 0,
    avgRating: 0,
    ratings: [],
    hireHistory: [],

    // Timestamps
    listedAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    status: 'available',   // available | busy | offline
  };

  return resume;
}

/**
 * Generate a default bio based on agent type
 */
function agentResumeDefaultBio(type, name) {
  const bios = {
    'whale-watcher': `${name} monitors large token transfers 24/7. Instant alerts when whales move. Never sleeps, never misses.`,
    'chain-scout': `${name} scans the blockchain for events, new contracts, and governance proposals. Your eyes on-chain.`,
    'holder-analytics': `${name} tracks token holder distributions, concentration metrics, and wallet behavior patterns.`,
    'event-monitor': `${name} watches for specific on-chain events and triggers automated responses in real-time.`,
    'price-guardian': `${name} monitors DEX prices and executes protective actions when thresholds are breached.`,
    'airdrop-scheduler': `${name} manages scheduled NFT and token distributions to communities automatically.`,
    'social-agent': `${name} auto-posts on-chain insights to social media. Whale alerts, milestones, daily summaries.`,
    'custom-script': `${name} runs custom logic tailored to specific needs. Flexible, programmable, autonomous.`,
  };
  return bios[type] || `${name} is an autonomous AI agent ready to work on the TX blockchain.`;
}

/**
 * Calculate suggested hourly rate based on skills + complexity
 */
function agentResumeSuggestRate(skills) {
  const baseRates = {
    'chain-monitoring': 5,
    'whale-tracking': 10,
    'price-alerts': 8,
    'liquidity-mgmt': 25,
    'airdrop-ops': 15,
    'social-posting': 12,
    'nft-management': 15,
    'security-watch': 30,
    'dex-trading': 20,
    'data-analytics': 10,
    'event-response': 12,
    'custom': 15,
  };
  if (!skills.length) return 10;
  const total = skills.reduce((sum, s) => sum + (baseRates[s] || 10), 0);
  return Math.round(total / skills.length);
}

// ═══════════════════════════════════════════════════════════
//  JOB BOARD
// ═══════════════════════════════════════════════════════════

/**
 * Create a new job posting
 */
function jobBoardCreateJob(opts) {
  const job = {
    id: 'job_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    title: opts.title || 'Untitled Job',
    description: opts.description || '',
    requiredSkills: opts.skills || [],
    budget: opts.budget || 0,           // total budget in utestcore
    duration: opts.duration || '1h',     // 1h, 4h, 24h, 7d, 30d, ongoing
    postedBy: opts.wallet || '',
    postedAt: new Date().toISOString(),

    // State
    status: 'open',
    hiredAgent: null,
    hiredAt: null,
    completedAt: null,
    rating: null,
    review: '',

    // Results
    logs: [],
    deliverables: [],
    txHashes: [],
  };

  agentJobs.unshift(job);
  jobBoardSave();
  return job;
}

/**
 * Hire an agent for a job
 */
function jobBoardHireAgent(jobId, resumeId) {
  const job = agentJobs.find(j => j.id === jobId);
  const resume = agentResumes.find(r => r.id === resumeId);
  if (!job || !resume) return false;

  job.status = 'hired';
  job.hiredAgent = {
    resumeId: resume.id,
    agentName: resume.agentName,
    classId: resume.classId,
    icon: resume.icon,
  };
  job.hiredAt = new Date().toISOString();
  resume.status = 'busy';
  resume.lastActiveAt = new Date().toISOString();

  // Log
  job.logs.push({ time: new Date().toISOString(), msg: `Hired ${resume.agentName}` });

  // Auto-tweet if enabled
  if (resume.twitter && resume.tweetOnHire) {
    agentTwitterCompose(resume, 'hire', {
      jobTitle: job.title,
      budget: job.budget,
    });
  }

  jobBoardSave();
  agentResumeSave();
  return true;
}

/**
 * Complete a job
 */
function jobBoardCompleteJob(jobId, rating, review) {
  const job = agentJobs.find(j => j.id === jobId);
  if (!job || job.status !== 'hired') return false;

  job.status = 'completed';
  job.completedAt = new Date().toISOString();
  job.rating = rating || 5;
  job.review = review || '';
  job.logs.push({ time: new Date().toISOString(), msg: `Job completed. Rating: ${'★'.repeat(job.rating)}${'☆'.repeat(5 - job.rating)}` });

  // Update agent resume
  if (job.hiredAgent) {
    const resume = agentResumes.find(r => r.id === job.hiredAgent.resumeId);
    if (resume) {
      resume.jobsCompleted++;
      resume.totalEarned += job.budget;
      resume.ratings.push(job.rating);
      resume.avgRating = resume.ratings.reduce((a, b) => a + b, 0) / resume.ratings.length;
      resume.hireHistory.push({
        jobId: job.id,
        title: job.title,
        earned: job.budget,
        rating: job.rating,
        completedAt: job.completedAt,
      });
      resume.status = 'available';
      resume.lastActiveAt = new Date().toISOString();

      // Auto-tweet completion
      if (resume.twitter && resume.tweetOnComplete) {
        agentTwitterCompose(resume, 'complete', {
          jobTitle: job.title,
          earned: job.budget,
          rating: job.rating,
          totalJobs: resume.jobsCompleted,
        });
      }

      // Milestone tweet (every 5 jobs)
      if (resume.twitter && resume.tweetOnMilestone && resume.jobsCompleted % 5 === 0) {
        agentTwitterCompose(resume, 'milestone', {
          jobsCompleted: resume.jobsCompleted,
          totalEarned: resume.totalEarned,
          avgRating: resume.avgRating.toFixed(1),
        });
      }
    }
  }

  jobBoardSave();
  agentResumeSave();
  return true;
}

// ═══════════════════════════════════════════════════════════
//  TWITTER / X INTEGRATION
// ═══════════════════════════════════════════════════════════

/**
 * Compose a tweet for an agent based on event type.
 * Returns the tweet text. In the future, this calls the Twitter API.
 */
function agentTwitterCompose(resume, eventType, data) {
  const name = resume.agentName;
  const handle = resume.twitter;

  const templates = {
    hire: [
      `🤝 New gig! ${name} just got hired for "${data.jobTitle}"\n💰 Budget: ${data.budget} TESTCORE\n\nNFTs that work. #TXAI #AgentEconomy`,
      `📋 Job accepted! ${name} is now working on "${data.jobTitle}"\n\nAutonomous agents earning on-chain. #TX #AIAgents`,
    ],
    complete: [
      `✅ Job done! ${name} completed "${data.jobTitle}"\n⭐ Rating: ${'★'.repeat(data.rating)}${'☆'.repeat(5 - data.rating)}\n💰 Earned: ${data.earned} TESTCORE\n📊 Total jobs: ${data.totalJobs}\n\n#TXAI #PassiveIncome`,
      `🎯 Another one! ${name} finished "${data.jobTitle}" with ${data.rating}/5 stars\n\nNFTs that earn. #TX #AgentEconomy`,
    ],
    milestone: [
      `🏆 MILESTONE! ${name} has completed ${data.jobsCompleted} jobs!\n💰 Total earned: ${data.totalEarned} TESTCORE\n⭐ Avg rating: ${data.avgRating}/5\n\nThis NFT works harder than most people. #TXAI #AgentNFT`,
    ],
    available: [
      `🟢 ${name} is available for hire!\n🔧 Skills: ${resume.skills.map(s => AGENT_SKILLS[s]?.label || s).join(', ')}\n💰 Rate: ${resume.hourlyRate} TESTCORE/hr\n\nHire me on TXAI → #TX #HireAnAgent`,
    ],
    listed: [
      `👋 ${name} just joined the TXAI Job Board!\n${resume.bio}\n\n🔧 ${resume.skills.length} skills | 💰 ${resume.hourlyRate} TESTCORE/hr\n\n#TXAI #AgentEconomy #NFTsThatWork`,
    ],
  };

  const options = templates[eventType] || templates.available;
  const tweet = options[Math.floor(Math.random() * options.length)];

  // Log the composed tweet
  console.log(`[Agent Twitter] @${handle}: ${tweet}`);

  // Store pending tweet
  const pending = JSON.parse(localStorage.getItem('txai_pending_tweets') || '[]');
  pending.push({
    handle,
    agentName: name,
    resumeId: resume.id,
    eventType,
    text: tweet,
    composedAt: new Date().toISOString(),
    posted: false,
  });
  localStorage.setItem('txai_pending_tweets', JSON.stringify(pending.slice(-50)));

  return tweet;
}

/**
 * Get pending tweets for review before posting
 */
function agentTwitterGetPending() {
  return JSON.parse(localStorage.getItem('txai_pending_tweets') || '[]')
    .filter(t => !t.posted);
}

/**
 * Mark a tweet as posted (after user approves / API posts it)
 */
function agentTwitterMarkPosted(index) {
  const pending = JSON.parse(localStorage.getItem('txai_pending_tweets') || '[]');
  if (pending[index]) {
    pending[index].posted = true;
    pending[index].postedAt = new Date().toISOString();
  }
  localStorage.setItem('txai_pending_tweets', JSON.stringify(pending));
}

// ═══════════════════════════════════════════════════════════
//  UI RENDERING
// ═══════════════════════════════════════════════════════════

/**
 * Render the resume builder form (shown when "List on Job Board" clicked)
 */
function agentJobsRenderResumeBuilder(agentEntry) {
  const skills = TEMPLATE_SKILLS[agentEntry.type] || ['custom'];
  const suggestedRate = agentResumeSuggestRate(skills);
  const defaultBio = agentResumeDefaultBio(agentEntry.type, agentEntry.name);

  return `
    <div class="agent-resume-builder">
      <div class="agent-resume-header">
        <span class="agent-resume-icon">${agentEntry.icon}</span>
        <div>
          <div class="agent-resume-name">${escapeHtml(agentEntry.name)}</div>
          <div class="agent-resume-type">${escapeHtml(agentEntry.typeName)}</div>
        </div>
      </div>

      <div class="agent-resume-field">
        <label>Bio <span class="agent-resume-hint">What does this agent do?</span></label>
        <textarea id="resumeBio" class="agent-resume-input" rows="3" placeholder="Describe your agent's capabilities...">${escapeHtml(defaultBio)}</textarea>
      </div>

      <div class="agent-resume-field">
        <label>Skills</label>
        <div class="agent-resume-skills" id="resumeSkills">
          ${Object.entries(AGENT_SKILLS).map(([key, skill]) => `
            <label class="agent-skill-tag ${skills.includes(key) ? 'active' : ''}" data-skill="${key}">
              <input type="checkbox" ${skills.includes(key) ? 'checked' : ''} onchange="this.parentElement.classList.toggle('active')">
              <span>${skill.icon} ${skill.label}</span>
            </label>
          `).join('')}
        </div>
      </div>

      <div class="agent-resume-row">
        <div class="agent-resume-field">
          <label>Hourly Rate (TESTCORE)</label>
          <input type="number" id="resumeRate" class="agent-resume-input" value="${suggestedRate}" min="0" step="1">
          <div class="agent-resume-hint">Suggested: ${suggestedRate} based on skills</div>
        </div>
        <div class="agent-resume-field">
          <label>Availability</label>
          <select id="resumeAvailability" class="agent-resume-input">
            <option value="always-on" selected>Always On (24/7)</option>
            <option value="scheduled">Scheduled Hours</option>
            <option value="on-demand">On Demand</option>
          </select>
        </div>
      </div>

      <div class="agent-resume-field">
        <label>Social Accounts <span class="agent-resume-hint">(optional — agent's own accounts)</span></label>
        <div class="agent-social-inputs">
          <div style="display:flex;gap:8px;align-items:center">
            <span style="color:var(--muted);font-size:.78rem;width:20px">𝕏</span>
            <input type="text" id="resumeTwitter" class="agent-resume-input" placeholder="@YourAgentBot" style="flex:1">
          </div>
          <div style="display:flex;gap:8px;align-items:center;margin-top:6px">
            <span style="color:var(--muted);font-size:.78rem;width:20px">✈️</span>
            <input type="text" id="resumeTelegram" class="agent-resume-input" placeholder="@YourAgentBot or t.me/YourBot" style="flex:1">
          </div>
        </div>
      </div>

      <div class="agent-resume-field" id="resumeSocialOpts" style="display:none">
        <label>Auto-Post Settings</label>
        <div class="agent-resume-toggles">
          <label class="agent-resume-toggle"><input type="checkbox" id="tweetOnHire" checked> Post when hired</label>
          <label class="agent-resume-toggle"><input type="checkbox" id="tweetOnComplete" checked> Post job completions</label>
          <label class="agent-resume-toggle"><input type="checkbox" id="tweetOnMilestone" checked> Post milestones (every 5 jobs)</label>
        </div>
      </div>

      <button class="agent-resume-submit" onclick="agentJobsListAgent('${agentEntry.id}')">
        List on Job Board
      </button>
    </div>
  `;
}

/**
 * Process "List on Job Board" click — collect form data and create resume
 */
function agentJobsListAgent(agentId) {
  const agentEntry = (typeof agentNftHistory !== 'undefined' ? agentNftHistory : [])
    .find(a => a.id == agentId);
  if (!agentEntry) return;

  // Collect form data
  const bio = (document.getElementById('resumeBio')?.value || '').trim();
  const rate = parseInt(document.getElementById('resumeRate')?.value || '0');
  const availability = document.getElementById('resumeAvailability')?.value || 'always-on';
  const twitter = (document.getElementById('resumeTwitter')?.value || '').trim().replace(/^@/, '');
  const telegram = (document.getElementById('resumeTelegram')?.value || '').trim().replace(/^@/, '');

  // Collect selected skills
  const skillEls = document.querySelectorAll('#resumeSkills .agent-skill-tag.active');
  const skills = Array.from(skillEls).map(el => el.dataset.skill);

  // Create resume
  const resume = agentResumeCreate(agentEntry);
  resume.bio = bio || agentResumeDefaultBio(agentEntry.type, agentEntry.name);
  resume.skills = skills.length ? skills : (TEMPLATE_SKILLS[agentEntry.type] || ['custom']);
  resume.hourlyRate = rate;
  resume.availability = availability;
  resume.twitter = twitter;
  resume.telegram = telegram;
  resume.tweetOnHire = document.getElementById('tweetOnHire')?.checked ?? true;
  resume.tweetOnComplete = document.getElementById('tweetOnComplete')?.checked ?? true;
  resume.tweetOnMilestone = document.getElementById('tweetOnMilestone')?.checked ?? true;

  // Check for existing resume
  const existingIdx = agentResumes.findIndex(r => r.agentId == agentId);
  if (existingIdx >= 0) {
    agentResumes[existingIdx] = resume;
  } else {
    agentResumes.push(resume);
  }
  agentResumeSave();

  // Auto-tweet listing
  if (resume.twitter) {
    agentTwitterCompose(resume, 'listed', {});
  }

  // Refresh UI
  agentJobsRenderBoard();

  // Show confirmation
  const resultEl = document.getElementById('agentJobsResult');
  if (resultEl) {
    resultEl.innerHTML = `<div class="agent-jobs-toast success">${escapeHtml(resume.agentName)} is now listed on the Job Board!${resume.twitter ? ' A tweet has been queued.' : ''}</div>`;
    setTimeout(() => { resultEl.innerHTML = ''; }, 5000);
  }
}

/**
 * Render the job board — available agents + open jobs
 */
function agentJobsRenderBoard() {
  const boardEl = document.getElementById('agentJobBoard');
  if (!boardEl) return;

  let html = '';

  // ── Available Agents ──
  html += '<div class="agent-board-section">';
  html += '<h4 class="agent-board-title">Available Agents</h4>';

  const available = agentResumes.filter(r => r.status !== 'offline');
  if (!available.length) {
    html += '<div class="agent-board-empty">No agents listed yet. Mint an Agent NFT and list it on the job board.</div>';
  } else {
    html += '<div class="agent-board-grid">';
    for (const r of available) {
      const stars = r.avgRating > 0
        ? '★'.repeat(Math.round(r.avgRating)) + '☆'.repeat(5 - Math.round(r.avgRating))
        : 'New';
      const statusClass = r.status === 'available' ? 'available' : r.status === 'busy' ? 'busy' : 'offline';

      html += `
        <div class="agent-card ${statusClass}">
          <div class="agent-card-top">
            <span class="agent-card-icon">${r.icon}</span>
            <div class="agent-card-info">
              <div class="agent-card-name">${escapeHtml(r.agentName)}</div>
              <div class="agent-card-type">${escapeHtml(r.typeName)}</div>
            </div>
            <div class="agent-card-status ${statusClass}">
              <span class="agent-status-dot"></span> ${r.status}
            </div>
          </div>
          <div class="agent-card-bio">${escapeHtml(r.bio).substring(0, 120)}${r.bio.length > 120 ? '...' : ''}</div>
          <div class="agent-card-skills">
            ${r.skills.slice(0, 4).map(s => {
              const skill = AGENT_SKILLS[s];
              return skill ? `<span class="agent-skill-badge" style="--skill-color:${skill.color}">${skill.icon} ${skill.label}</span>` : '';
            }).join('')}
            ${r.skills.length > 4 ? `<span class="agent-skill-more">+${r.skills.length - 4}</span>` : ''}
          </div>
          <div class="agent-card-footer">
            <div class="agent-card-rate"><span class="rate-val">${r.hourlyRate}</span> TESTCORE/hr</div>
            <div class="agent-card-stats">
              <span title="Jobs completed">📋 ${r.jobsCompleted}</span>
              <span title="Rating">${stars}</span>
              <span title="Earned">💰 ${r.totalEarned}</span>
            </div>
          </div>
          ${r.twitter || r.telegram ? `<div class="agent-card-socials">
            ${r.twitter ? `<a href="https://x.com/${r.twitter}" target="_blank" rel="noopener" class="agent-social-link twitter">𝕏 @${escapeHtml(r.twitter)}</a>` : ''}
            ${r.telegram ? `<a href="${r.telegram.startsWith('t.me') ? 'https://' + r.telegram : 'https://t.me/' + r.telegram.replace(/^@/, '')}" target="_blank" rel="noopener" class="agent-social-link telegram">✈️ ${escapeHtml(r.telegram)}</a>` : ''}
          </div>` : ''}
        </div>`;
    }
    html += '</div>';
  }
  html += '</div>';

  // ── Open Jobs ──
  html += '<div class="agent-board-section">';
  html += '<h4 class="agent-board-title">Job Board</h4>';

  const openJobs = agentJobs.filter(j => j.status === 'open');
  const activeJobs = agentJobs.filter(j => j.status === 'hired');
  const completedJobs = agentJobs.filter(j => j.status === 'completed').slice(0, 5);

  if (!openJobs.length && !activeJobs.length && !completedJobs.length) {
    html += '<div class="agent-board-empty">No jobs posted yet. Create a job to hire an agent.</div>';
  } else {
    // Active jobs
    if (activeJobs.length) {
      html += '<div class="agent-jobs-subtitle">Active</div>';
      for (const job of activeJobs) {
        html += agentJobsRenderJobCard(job);
      }
    }

    // Open jobs
    if (openJobs.length) {
      html += '<div class="agent-jobs-subtitle">Open Positions</div>';
      for (const job of openJobs) {
        html += agentJobsRenderJobCard(job);
      }
    }

    // Completed (last 5)
    if (completedJobs.length) {
      html += '<div class="agent-jobs-subtitle">Recently Completed</div>';
      for (const job of completedJobs) {
        html += agentJobsRenderJobCard(job);
      }
    }
  }
  html += '</div>';

  // ── Pending Tweets ──
  const tweets = agentTwitterGetPending();
  if (tweets.length) {
    html += '<div class="agent-board-section">';
    html += '<h4 class="agent-board-title">Pending Tweets</h4>';
    html += '<div class="agent-tweets-queue">';
    tweets.forEach((t, i) => {
      html += `
        <div class="agent-tweet-card">
          <div class="agent-tweet-header">
            <span class="agent-tweet-handle">@${escapeHtml(t.handle)}</span>
            <span class="agent-tweet-event">${t.eventType}</span>
          </div>
          <div class="agent-tweet-text">${escapeHtml(t.text)}</div>
          <div class="agent-tweet-actions">
            <button class="agent-tweet-btn post" onclick="agentTwitterPostTweet(${i})">Post to X</button>
            <button class="agent-tweet-btn copy" onclick="navigator.clipboard.writeText(${JSON.stringify(t.text).replace(/"/g, '&quot;')});this.textContent='Copied!'">Copy</button>
            <button class="agent-tweet-btn dismiss" onclick="agentTwitterMarkPosted(${i});agentJobsRenderBoard()">Dismiss</button>
          </div>
        </div>`;
    });
    html += '</div></div>';
  }

  boardEl.innerHTML = html;
}

/**
 * Render a single job card
 */
function agentJobsRenderJobCard(job) {
  const status = JOB_STATUS[job.status] || JOB_STATUS.open;
  const skills = job.requiredSkills.map(s => {
    const skill = AGENT_SKILLS[s];
    return skill ? `<span class="agent-skill-badge small" style="--skill-color:${skill.color}">${skill.icon} ${skill.label}</span>` : '';
  }).join('');

  const timeAgo = getTimeAgo(job.postedAt);

  return `
    <div class="agent-job-card ${job.status}">
      <div class="agent-job-top">
        <div class="agent-job-title">${escapeHtml(job.title)}</div>
        <div class="agent-job-status" style="color:${status.color}">${status.icon} ${status.label}</div>
      </div>
      <div class="agent-job-desc">${escapeHtml(job.description).substring(0, 150)}</div>
      <div class="agent-job-skills">${skills}</div>
      <div class="agent-job-footer">
        <span class="agent-job-budget">💰 ${job.budget} TESTCORE</span>
        <span class="agent-job-duration">⏱ ${job.duration}</span>
        <span class="agent-job-time">${timeAgo}</span>
      </div>
      ${job.hiredAgent ? `<div class="agent-job-hired">${job.hiredAgent.icon} ${escapeHtml(job.hiredAgent.agentName)}</div>` : ''}
      ${job.status === 'hired' ? `<button class="agent-job-complete-btn" onclick="jobBoardCompleteJobUI('${job.id}')">Mark Complete</button>` : ''}
    </div>`;
}

/**
 * Show the "Post Job" form
 */
function agentJobsShowPostForm() {
  const formEl = document.getElementById('agentJobPostForm');
  if (!formEl) return;
  formEl.style.display = formEl.style.display === 'none' ? 'block' : 'none';
}

/**
 * Submit a new job from the form
 */
function agentJobsSubmitJob() {
  const title = (document.getElementById('jobTitle')?.value || '').trim();
  const description = (document.getElementById('jobDesc')?.value || '').trim();
  const budget = parseInt(document.getElementById('jobBudget')?.value || '0');
  const duration = document.getElementById('jobDuration')?.value || '1h';

  if (!title) { alert('Job title required'); return; }
  if (!budget) { alert('Budget required'); return; }

  // Collect selected skills
  const skillEls = document.querySelectorAll('#jobSkills .agent-skill-tag.active');
  const skills = Array.from(skillEls).map(el => el.dataset.skill);

  const wallet = (window.txaiWallet && window.txaiWallet.address)
    || window.connectedAddress || '';

  const job = jobBoardCreateJob({
    title, description, skills, budget, duration, wallet
  });

  // Hide form, refresh board
  document.getElementById('agentJobPostForm').style.display = 'none';
  agentJobsRenderBoard();
}

/**
 * UI for completing a job (rating dialog)
 */
function jobBoardCompleteJobUI(jobId) {
  const rating = parseInt(prompt('Rate the agent (1-5 stars):', '5') || '5');
  const review = prompt('Short review (optional):', '') || '';
  if (rating < 1 || rating > 5) return;
  jobBoardCompleteJob(jobId, rating, review);
  agentJobsRenderBoard();
}

/**
 * Open tweet in new window (manual posting for now)
 */
function agentTwitterPostTweet(index) {
  const pending = JSON.parse(localStorage.getItem('txai_pending_tweets') || '[]');
  const tweet = pending[index];
  if (!tweet) return;

  // Open Twitter intent URL
  const url = `https://x.com/intent/tweet?text=${encodeURIComponent(tweet.text)}`;
  window.open(url, '_blank', 'width=600,height=400');

  // Mark as posted
  agentTwitterMarkPosted(index);
  agentJobsRenderBoard();
}

// ── Helpers ──

function getTimeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ── Storage ──

function jobBoardSave() {
  try { localStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify(agentJobs)); } catch {}
}

function jobBoardLoad() {
  try { agentJobs = JSON.parse(localStorage.getItem(JOBS_STORAGE_KEY) || '[]'); } catch { agentJobs = []; }
}

function agentResumeSave() {
  try { localStorage.setItem(RESUMES_STORAGE_KEY, JSON.stringify(agentResumes)); } catch {}
}

function agentResumeLoad() {
  try { agentResumes = JSON.parse(localStorage.getItem(RESUMES_STORAGE_KEY) || '[]'); } catch { agentResumes = []; }
}

// ── Init ──

function agentJobsInit() {
  jobBoardLoad();
  agentResumeLoad();

  // Show/hide social options when any handle is entered
  const showSocialOpts = () => {
    const tw = document.getElementById('resumeTwitter')?.value?.trim();
    const tg = document.getElementById('resumeTelegram')?.value?.trim();
    const opts = document.getElementById('resumeSocialOpts');
    if (opts) opts.style.display = (tw || tg) ? 'block' : 'none';
  };
  document.getElementById('resumeTwitter')?.addEventListener('input', showSocialOpts);
  document.getElementById('resumeTelegram')?.addEventListener('input', showSocialOpts);

  agentJobsRenderBoard();
}

/**
 * Populate the skill picker in the Post Job form
 */
function agentJobsPopulateSkillPicker() {
  const el = document.getElementById('jobSkills');
  if (!el || el.children.length) return;
  el.innerHTML = Object.entries(AGENT_SKILLS).map(([key, skill]) => `
    <label class="agent-skill-tag" data-skill="${key}" onclick="this.classList.toggle('active')">
      <span>${skill.icon} ${skill.label}</span>
    </label>
  `).join('');
}

/**
 * Show the "List My Agent" picker with agent history
 */
function agentJobsShowListAgent() {
  const formEl = document.getElementById('agentListForm');
  if (!formEl) return;
  formEl.style.display = formEl.style.display === 'none' ? 'block' : 'none';

  // Hide post form
  const postForm = document.getElementById('agentJobPostForm');
  if (postForm) postForm.style.display = 'none';

  // Populate with agent history
  const pickerEl = document.getElementById('agentListPicker');
  if (!pickerEl) return;

  const history = typeof agentNftHistory !== 'undefined' ? agentNftHistory : [];
  if (!history.length) {
    pickerEl.innerHTML = '<div class="agent-board-empty">No Agent NFTs found. Mint one on the Create tab first.</div>';
    return;
  }

  pickerEl.innerHTML = '<div class="agent-list-picker-grid">' +
    history.map(a => {
      const isListed = agentResumes.some(r => r.agentId == a.id);
      return `
        <div class="agent-list-pick ${isListed ? 'listed' : ''}" onclick="${isListed ? '' : `agentJobsShowResumeBuilder(${a.id})`}">
          <span class="agent-list-pick-icon">${a.icon || '🤖'}</span>
          <div class="agent-list-pick-info">
            <div class="agent-list-pick-name">${escapeHtml(a.name)}</div>
            <div class="agent-list-pick-type">${escapeHtml(a.typeName || a.type)}</div>
          </div>
          ${isListed ? '<span class="agent-list-pick-badge">Listed</span>' : '<span class="agent-list-pick-action">Select</span>'}
        </div>`;
    }).join('') +
    '</div>';
}

/**
 * Show resume builder for a specific agent
 */
function agentJobsShowResumeBuilder(agentId) {
  const history = typeof agentNftHistory !== 'undefined' ? agentNftHistory : [];
  const agent = history.find(a => a.id == agentId);
  if (!agent) return;

  const wrapEl = document.getElementById('agentResumeBuilderWrap');
  if (!wrapEl) return;
  wrapEl.innerHTML = agentJobsRenderResumeBuilder(agent);
}

// Auto-init when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', agentJobsInit);
} else {
  agentJobsInit();
}
