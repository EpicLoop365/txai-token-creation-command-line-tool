/**
 * @txai/agent-sdk — RuntimeAgent
 *
 * A RuntimeAgent is an autonomous script-based agent that runs on a schedule,
 * queries the real blockchain, and can alert, tweet, and earn reputation.
 *
 * Unlike the base Agent (which is a wallet wrapper), RuntimeAgent has:
 * - A script that executes on an interval
 * - Real chain context (balances, stakers, delegations, block height)
 * - Alert and logging system
 * - Optional Twitter integration
 * - Resume/reputation tracking
 *
 * @example
 * ```typescript
 * import { RuntimeAgent } from '@txai/agent-sdk';
 *
 * const watcher = new RuntimeAgent({
 *   name: 'Whale Watcher',
 *   network: 'testnet',
 *   interval: 60, // seconds
 *   script: `
 *     const bal = await chain.getBalance('testcore1abc...', 'utestcore');
 *     if (parseInt(bal.amount) > 10000000) {
 *       agent.alert('Whale detected: ' + bal.amount + ' utestcore');
 *     }
 *     agent.log('Checked balance: ' + bal.amount);
 *   `,
 * });
 *
 * watcher.onAlert((msg) => console.log('ALERT:', msg));
 * watcher.onLog((msg) => console.log('LOG:', msg));
 *
 * await watcher.start();
 * // ... runs every 60 seconds
 * watcher.stop();
 * ```
 */

import { NetworkName, NetworkConfig } from "./types";

// ─── Network configs (duplicated to keep SDK self-contained) ────────────

const NETWORKS: Record<string, { restEndpoint: string }> = {
  testnet: { restEndpoint: "https://full-node.testnet-1.coreum.dev:1317" },
  mainnet: { restEndpoint: "https://full-node.mainnet-1.coreum.dev:1317" },
  devnet: { restEndpoint: "https://full-node.devnet-1.coreum.dev:1317" },
};

// ─── Types ──────────────────────────────────────────────────────────────

export interface RuntimeAgentConfig {
  name: string;
  network?: NetworkName;
  interval: number;        // seconds between executions
  script: string;          // JavaScript code to execute
  timeout?: number;        // ms, default 10000
  apiUrl?: string;         // TXAI API URL for remote registration
}

export interface ExecutionLog {
  timestamp: number;
  status: "ok" | "alert" | "error";
  message: string;
  duration: number;
}

export interface RuntimeAgentStats {
  execCount: number;
  alertCount: number;
  errorCount: number;
  earnings: number;
  reputation: number;
  uptime: number;          // ms since start
}

// ─── Chain Context (passed to agent scripts) ─────────────────────────────

function buildChainContext(restBase: string, networkName: string) {
  return {
    query: async (path: string) => {
      const resp = await fetch(`${restBase}${path}`);
      return resp.json();
    },

    getBalance: async (addr: string, denom?: string) => {
      const resp = await fetch(`${restBase}/cosmos/bank/v1beta1/balances/${addr}`);
      const data = await resp.json() as any;
      if (denom) {
        const bal = data.balances?.find((b: any) => b.denom === denom);
        return { amount: bal?.amount || "0", denom };
      }
      return data.balances || [];
    },

    getStakers: async (validator: string, limit = 100) => {
      const resp = await fetch(
        `${restBase}/cosmos/staking/v1beta1/validators/${validator}/delegations?pagination.limit=${limit}`
      );
      const data = await resp.json() as any;
      return (data.delegation_responses || []).map((d: any) => ({
        delegator: d.delegation?.delegator_address || "",
        amount: d.balance?.amount || "0",
      }));
    },

    getDelegations: async (addr: string) => {
      const resp = await fetch(`${restBase}/cosmos/staking/v1beta1/delegations/${addr}`);
      const data = await resp.json() as any;
      return (data.delegation_responses || []).map((d: any) => ({
        validator: d.delegation?.validator_address || "",
        amount: d.balance?.amount || "0",
        denom: d.balance?.denom || "utestcore",
      }));
    },

    getHeight: async () => {
      const resp = await fetch(`${restBase}/cosmos/base/tendermint/v1beta1/blocks/latest`);
      const data = await resp.json() as any;
      return data.block?.header?.height || "0";
    },

    send: async (to: string, amount: string, denom: string) => {
      return { txHash: "pending_approval", status: "queued" };
    },

    network: networkName,
    restBase,
  };
}

// ─── RuntimeAgent Class ──────────────────────────────────────────────────

export class RuntimeAgent {
  readonly name: string;
  readonly networkName: NetworkName;
  readonly interval: number;
  readonly script: string;
  readonly timeout: number;

  private _timer: ReturnType<typeof setInterval> | null = null;
  private _startedAt = 0;
  private _logs: ExecutionLog[] = [];
  private _maxLogs = 200;

  private _execCount = 0;
  private _alertCount = 0;
  private _errorCount = 0;
  private _earnings = 0;
  private _reputation = 50;

  private _onAlert: ((msg: string) => void) | null = null;
  private _onLog: ((msg: string) => void) | null = null;
  private _onExec: ((log: ExecutionLog) => void) | null = null;

  constructor(config: RuntimeAgentConfig) {
    this.name = config.name;
    this.networkName = config.network || "testnet";
    this.interval = config.interval;
    this.script = config.script;
    this.timeout = config.timeout || 10000;
  }

  // ─── Event Handlers ─────────────────────────────────────────────────

  onAlert(handler: (msg: string) => void): RuntimeAgent {
    this._onAlert = handler;
    return this;
  }

  onLog(handler: (msg: string) => void): RuntimeAgent {
    this._onLog = handler;
    return this;
  }

  onExecution(handler: (log: ExecutionLog) => void): RuntimeAgent {
    this._onExec = handler;
    return this;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────

  get running(): boolean {
    return this._timer !== null;
  }

  get stats(): RuntimeAgentStats {
    return {
      execCount: this._execCount,
      alertCount: this._alertCount,
      errorCount: this._errorCount,
      earnings: this._earnings,
      reputation: this._reputation,
      uptime: this._startedAt ? Date.now() - this._startedAt : 0,
    };
  }

  get logs(): readonly ExecutionLog[] {
    return this._logs;
  }

  /**
   * Start the agent — executes immediately, then on interval.
   */
  async start(): Promise<void> {
    if (this._timer) return;
    this._startedAt = Date.now();

    // Run immediately
    await this._execute();

    // Then schedule
    this._timer = setInterval(() => this._execute(), this.interval * 1000);
  }

  /**
   * Stop the agent.
   */
  stop(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /**
   * Run the script once (without scheduling).
   */
  async runOnce(): Promise<ExecutionLog> {
    return this._execute();
  }

  // ─── Remote Registration ────────────────────────────────────────────

  /**
   * Register this agent with the TXAI API for server-side execution.
   */
  async registerRemote(apiUrl: string, classId = "sdk", nftId?: string): Promise<any> {
    const resp = await fetch(`${apiUrl}/api/runtime/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classId,
        nftId: nftId || this.name.toLowerCase().replace(/\s+/g, "-"),
        name: this.name,
        template: "custom-script",
        interval: this.interval,
        script: this.script,
      }),
    });
    return resp.json();
  }

  // ─── Private Execution ──────────────────────────────────────────────

  private async _execute(): Promise<ExecutionLog> {
    const start = Date.now();
    const alerts: string[] = [];
    const logs: string[] = [];

    const net = NETWORKS[this.networkName] || NETWORKS.testnet;
    const chain = buildChainContext(net.restEndpoint, this.networkName);

    const agentCtx = {
      alert: (msg: string) => {
        alerts.push(msg);
        if (this._onAlert) this._onAlert(msg);
      },
      log: (msg: string) => {
        logs.push(msg);
        if (this._onLog) this._onLog(msg);
      },
      id: this.name,
      name: this.name,
      owner: "sdk",
    };

    let log: ExecutionLog;

    try {
      const fn = new Function("chain", "agent", `
        return (async () => {
          ${this.script}
        })();
      `);

      await Promise.race([
        fn(chain, agentCtx),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Script timeout (${this.timeout}ms)`)), this.timeout)
        ),
      ]);

      const duration = Date.now() - start;
      const hasAlerts = alerts.length > 0;

      log = {
        timestamp: Date.now(),
        status: hasAlerts ? "alert" : "ok",
        message: hasAlerts
          ? alerts.join("; ")
          : logs.length > 0
            ? logs.join("; ")
            : "OK",
        duration,
      };

      if (hasAlerts) this._alertCount++;
      this._reputation = Math.min(100, this._reputation + 0.1);
    } catch (err: any) {
      log = {
        timestamp: Date.now(),
        status: "error",
        message: err.message || "Unknown error",
        duration: Date.now() - start,
      };

      this._errorCount++;
      this._reputation = Math.max(0, this._reputation - 1);
    }

    this._execCount++;
    this._logs.push(log);
    if (this._logs.length > this._maxLogs) this._logs.shift();

    if (this._onExec) this._onExec(log);

    return log;
  }
}
