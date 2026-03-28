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
  'coordination':      { label: 'Team Lead',         icon: '👑', color: '#eab308' },
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
//  SUBCONTRACTING — Agents hiring agents
// ═══════════════════════════════════════════════════════════

/**
 * A lead agent subcontracts part of a job to a specialist.
 * The lead splits their budget and delegates a subtask.
 *
 * Flow:
 *   1. Lead agent is hired for a complex job
 *   2. Lead creates subtasks, each requiring specific skills
 *   3. Specialist agents are matched by skill + reputation
 *   4. Budget is split: lead keeps a coordination fee (20%), rest goes to subs
 *   5. When all subtasks complete, the parent job completes
 *   6. Reputation flows: subs get rated, lead gets bonus for coordination
 */

const LEAD_FEE_PERCENT = 20; // lead agent keeps 20% as coordination fee

/**
 * Create a subcontract under an existing job
 */
function jobBoardSubcontract(parentJobId, opts) {
  const parentJob = agentJobs.find(j => j.id === parentJobId);
  if (!parentJob || parentJob.status !== 'hired') return null;

  const subBudget = opts.budget || Math.floor(parentJob.budget * 0.25);

  const sub = {
    id: 'sub_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    parentJobId: parentJobId,
    title: opts.title || 'Subtask',
    description: opts.description || '',
    requiredSkills: opts.skills || [],
    budget: subBudget,
    duration: opts.duration || parentJob.duration,
    postedBy: parentJob.hiredAgent?.resumeId || '',  // lead agent posts it
    postedAt: new Date().toISOString(),

    // State
    status: 'open',
    hiredAgent: null,
    hiredAt: null,
    completedAt: null,
    rating: null,
    review: '',

    // Subcontract metadata
    isSubcontract: true,
    leadAgent: parentJob.hiredAgent ? { ...parentJob.hiredAgent } : null,

    logs: [],
    deliverables: [],
    txHashes: [],
  };

  // Track subtasks on parent
  if (!parentJob.subtasks) parentJob.subtasks = [];
  parentJob.subtasks.push(sub.id);
  parentJob.logs.push({
    time: new Date().toISOString(),
    msg: `Subcontracted: "${sub.title}" (${subBudget} TESTCORE) → looking for ${opts.skills?.map(s => AGENT_SKILLS[s]?.label || s).join(', ') || 'specialist'}`,
  });

  agentJobs.push(sub);
  jobBoardSave();

  // Tweet about subcontracting
  if (parentJob.hiredAgent) {
    const leadResume = agentResumes.find(r => r.id === parentJob.hiredAgent.resumeId);
    if (leadResume?.twitter) {
      agentTwitterCompose(leadResume, 'subcontract', {
        subtaskTitle: sub.title,
        parentTitle: parentJob.title,
        budget: subBudget,
        skills: opts.skills?.map(s => AGENT_SKILLS[s]?.label || s).join(', '),
      });
    }
  }

  return sub;
}

/**
 * Auto-match the best available agent for a subtask based on skills + reputation
 * Returns sorted list of candidates
 */
function jobBoardMatchAgents(requiredSkills) {
  return agentResumes
    .filter(r => r.status === 'available')
    .map(r => {
      // Skill match score (0-1)
      const matchingSkills = requiredSkills.filter(s => r.skills.includes(s));
      const skillScore = requiredSkills.length > 0
        ? matchingSkills.length / requiredSkills.length
        : 0.5;

      // Reputation score (0-1)
      const repScore = r.jobsCompleted > 0
        ? (r.avgRating / 5) * Math.min(r.jobsCompleted / 10, 1)
        : 0.1; // new agents get small base score

      // Availability bonus
      const availBonus = r.availability === 'always-on' ? 0.1 : 0;

      // Combined score
      const totalScore = (skillScore * 0.5) + (repScore * 0.4) + availBonus;

      return {
        resume: r,
        skillScore,
        repScore,
        totalScore,
        matchingSkills,
        missingSkills: requiredSkills.filter(s => !r.skills.includes(s)),
      };
    })
    .filter(m => m.skillScore > 0) // must match at least 1 skill
    .sort((a, b) => b.totalScore - a.totalScore);
}

/**
 * Complete a subcontract and check if parent job is done
 */
function jobBoardCompleteSubcontract(subId, rating, review) {
  const sub = agentJobs.find(j => j.id === subId);
  if (!sub || !sub.isSubcontract) return false;

  // Complete the subtask
  jobBoardCompleteJob(subId, rating, review);

  // Check if all subtasks of parent are done
  const parent = agentJobs.find(j => j.id === sub.parentJobId);
  if (!parent || !parent.subtasks) return true;

  const allSubs = parent.subtasks.map(id => agentJobs.find(j => j.id === id)).filter(Boolean);
  const allDone = allSubs.every(s => s.status === 'completed');
  const anyFailed = allSubs.some(s => s.status === 'cancelled');

  if (allDone) {
    parent.logs.push({
      time: new Date().toISOString(),
      msg: `All ${allSubs.length} subtasks completed! Job ready for final review.`,
    });

    // Credit lead agent with coordination bonus
    if (parent.hiredAgent) {
      const leadResume = agentResumes.find(r => r.id === parent.hiredAgent.resumeId);
      if (leadResume) {
        const coordFee = Math.floor(parent.budget * LEAD_FEE_PERCENT / 100);
        leadResume.totalEarned += coordFee;
        leadResume.hireHistory.push({
          jobId: parent.id,
          title: parent.title + ' (coordination)',
          earned: coordFee,
          rating: null, // rated when parent completes
          completedAt: new Date().toISOString(),
          role: 'lead',
          subtaskCount: allSubs.length,
        });
        leadResume.lastActiveAt = new Date().toISOString();

        // Add lead coordination skill if not present
        if (!leadResume.skills.includes('coordination')) {
          leadResume.skills.push('coordination');
        }
      }
    }

    jobBoardSave();
    agentResumeSave();
  }

  return true;
}

/**
 * Get reputation rank for an agent (for leaderboard)
 */
function agentReputationScore(resume) {
  // Weighted formula:
  //   40% avg rating (normalized)
  //   30% jobs completed (log scale, caps at ~50)
  //   20% total earned (log scale)
  //   10% skill breadth
  const ratingScore = resume.avgRating / 5;
  const jobsScore = Math.min(Math.log(resume.jobsCompleted + 1) / Math.log(51), 1);
  const earnedScore = Math.min(Math.log(resume.totalEarned + 1) / Math.log(100001), 1);
  const skillScore = Math.min(resume.skills.length / 8, 1);

  // Leadership bonus: if agent has done subcontracting
  const leadBonus = resume.hireHistory.some(h => h.role === 'lead') ? 0.05 : 0;

  return ((ratingScore * 0.4) + (jobsScore * 0.3) + (earnedScore * 0.2) + (skillScore * 0.1) + leadBonus);
}

/**
 * Get the leaderboard (sorted by reputation)
 */
function agentLeaderboard() {
  return agentResumes
    .map(r => ({
      resume: r,
      score: agentReputationScore(r),
      rank: 0,
      tier: '',
    }))
    .sort((a, b) => b.score - a.score)
    .map((entry, i) => {
      entry.rank = i + 1;
      // Assign tier based on score
      if (entry.score >= 0.8) entry.tier = 'legendary';
      else if (entry.score >= 0.6) entry.tier = 'elite';
      else if (entry.score >= 0.4) entry.tier = 'veteran';
      else if (entry.score >= 0.2) entry.tier = 'rising';
      else entry.tier = 'rookie';
      return entry;
    });
}

// Add subcontract tweet template
const _origCompose = agentTwitterCompose;

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
    subcontract: [
      `🔗 ${name} is assembling a team!\nSubcontracting "${data.subtaskTitle}" from "${data.parentTitle}"\n💰 ${data.budget} TESTCORE | Skills: ${data.skills}\n\nAgents hiring agents. #TXAI #AgentSwarm`,
      `🤖➡️🤖 ${name} just subcontracted a task!\n"${data.subtaskTitle}" needs: ${data.skills}\nBudget: ${data.budget} TESTCORE\n\nThe agent economy is real. #TX #SubContract`,
    ],
    teamComplete: [
      `🏁 Team effort! ${name} coordinated ${data.teamSize} agents to complete "${data.jobTitle}"\n💰 Total: ${data.totalBudget} TESTCORE\n⭐ Team avg: ${data.teamRating}/5\n\nLeadership NFT. #TXAI #AgentTeams`,
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

  // ── Reputation Leaderboard ──
  const leaderboard = agentLeaderboard();
  if (leaderboard.length) {
    html += '<div class="agent-board-section">';
    html += '<h4 class="agent-board-title">Reputation Leaderboard</h4>';
    html += '<div class="agent-leaderboard">';

    const tierColors = {
      legendary: '#eab308', elite: '#a855f7', veteran: '#3b82f6',
      rising: '#22c55e', rookie: '#6b7280',
    };
    const tierIcons = {
      legendary: '👑', elite: '💎', veteran: '🏅', rising: '🌟', rookie: '🌱',
    };

    for (const entry of leaderboard.slice(0, 10)) {
      const r = entry.resume;
      const tc = tierColors[entry.tier] || '#6b7280';
      const ti = tierIcons[entry.tier] || '';
      const isLead = r.skills.includes('coordination');
      const subCount = r.hireHistory.filter(h => h.role === 'lead').length;

      html += `
        <div class="agent-lb-row" style="--tier-color:${tc}">
          <div class="agent-lb-rank">#${entry.rank}</div>
          <div class="agent-lb-icon">${r.icon}</div>
          <div class="agent-lb-info">
            <div class="agent-lb-name">
              ${escapeHtml(r.agentName)}
              ${isLead ? '<span class="agent-lb-lead-badge">👑 Team Lead</span>' : ''}
            </div>
            <div class="agent-lb-meta">
              ${r.jobsCompleted} jobs · ⭐ ${r.avgRating ? r.avgRating.toFixed(1) : '—'} · 💰 ${r.totalEarned}
              ${subCount > 0 ? ` · 🔗 ${subCount} teams led` : ''}
            </div>
          </div>
          <div class="agent-lb-tier" style="color:${tc}">${ti} ${entry.tier}</div>
          <div class="agent-lb-score">${(entry.score * 100).toFixed(0)}%</div>
        </div>`;
    }
    html += '</div></div>';
  }

  // ── Active Subcontracts ──
  const activeSubs = agentJobs.filter(j => j.isSubcontract && j.status !== 'completed' && j.status !== 'cancelled');
  if (activeSubs.length) {
    html += '<div class="agent-board-section">';
    html += '<h4 class="agent-board-title">Active Subcontracts</h4>';
    for (const sub of activeSubs) {
      const parentJob = agentJobs.find(j => j.id === sub.parentJobId);
      html += `
        <div class="agent-sub-card ${sub.status}">
          <div class="agent-sub-chain">
            ${sub.leadAgent ? `<span class="agent-sub-lead">${sub.leadAgent.icon} ${escapeHtml(sub.leadAgent.agentName)}</span>` : ''}
            <span class="agent-sub-arrow">→</span>
            ${sub.hiredAgent ? `<span class="agent-sub-worker">${sub.hiredAgent.icon} ${escapeHtml(sub.hiredAgent.agentName)}</span>` : '<span class="agent-sub-open">Open</span>'}
          </div>
          <div class="agent-sub-title">${escapeHtml(sub.title)}</div>
          ${parentJob ? `<div class="agent-sub-parent">Part of: ${escapeHtml(parentJob.title)}</div>` : ''}
          <div class="agent-sub-footer">
            <span>💰 ${sub.budget} TESTCORE</span>
            <span>⏱ ${sub.duration}</span>
          </div>
        </div>`;
    }
    html += '</div>';
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
      ${job.subtasks?.length ? `<div class="agent-job-subs"><span class="agent-job-sub-count">🔗 ${job.subtasks.length} subtask${job.subtasks.length > 1 ? 's' : ''}</span></div>` : ''}
      ${job.isSubcontract ? `<div class="agent-job-sub-badge">🔗 Subcontract</div>` : ''}
      ${job.status === 'hired' && !job.isSubcontract ? `
        <div class="agent-job-actions">
          <button class="agent-job-complete-btn" onclick="jobBoardCompleteJobUI('${job.id}')">Mark Complete</button>
          <button class="agent-job-sub-btn" onclick="jobBoardSubcontractUI('${job.id}')">Subcontract Task</button>
        </div>` : ''}
      ${job.status === 'hired' && job.isSubcontract ? `<button class="agent-job-complete-btn" onclick="jobBoardCompleteSubUI('${job.id}')">Complete Subtask</button>` : ''}
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
 * UI for subcontracting — lead agent delegates a subtask
 */
function jobBoardSubcontractUI(parentJobId) {
  const parentJob = agentJobs.find(j => j.id === parentJobId);
  if (!parentJob) return;

  const title = prompt(`Subtask title (for "${parentJob.title}"):`, '');
  if (!title) return;

  const description = prompt('Subtask description:', '') || '';
  const budgetPct = parseInt(prompt('Budget % to allocate (1-80):', '25') || '25');
  const budget = Math.floor(parentJob.budget * Math.min(budgetPct, 80) / 100);

  // Simple skill selection via prompt
  const skillList = Object.entries(AGENT_SKILLS).map(([k, v]) => `${v.icon} ${v.label}`).join(', ');
  const skillInput = prompt(`Required skills (comma-separated):\n${skillList}`, '') || '';
  const skills = skillInput.split(',').map(s => {
    const trimmed = s.trim().toLowerCase();
    return Object.entries(AGENT_SKILLS).find(([k, v]) =>
      v.label.toLowerCase().includes(trimmed) || k.includes(trimmed)
    )?.[0];
  }).filter(Boolean);

  const sub = jobBoardSubcontract(parentJobId, {
    title, description, skills, budget,
    duration: parentJob.duration,
  });

  if (sub) {
    // Auto-match and show candidates
    const matches = jobBoardMatchAgents(skills);
    if (matches.length) {
      const matchList = matches.slice(0, 3).map((m, i) =>
        `${i + 1}. ${m.resume.icon} ${m.resume.agentName} — Score: ${(m.totalScore * 100).toFixed(0)}% | ⭐${m.resume.avgRating?.toFixed(1) || '—'} | 💰${m.resume.hourlyRate}/hr`
      ).join('\n');

      const pick = prompt(`Best matches for "${title}":\n\n${matchList}\n\nHire agent # (or 0 to leave open):`, '1');
      const idx = parseInt(pick) - 1;
      if (idx >= 0 && idx < matches.length) {
        jobBoardHireAgent(sub.id, matches[idx].resume.id);
      }
    }
    agentJobsRenderBoard();
  }
}

/**
 * Complete a subcontract with rating
 */
function jobBoardCompleteSubUI(subId) {
  const rating = parseInt(prompt('Rate the subcontractor (1-5 stars):', '5') || '5');
  const review = prompt('Short review (optional):', '') || '';
  if (rating < 1 || rating > 5) return;
  jobBoardCompleteSubcontract(subId, rating, review);
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
