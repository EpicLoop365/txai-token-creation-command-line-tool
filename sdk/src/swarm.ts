/**
 * @txai/agent-sdk — Swarm
 *
 * A Swarm coordinates multiple Agents to execute complex blockchain strategies.
 * Think of it as an orchestrator — it manages agent lifecycles, funding,
 * communication, and strategy execution.
 *
 * @example
 * ```typescript
 * import { Swarm, Agent, MarketMakerStrategy } from '@txai/agent-sdk';
 *
 * const swarm = new Swarm({ network: 'testnet' });
 *
 * const buyer = swarm.addAgent(new Agent({ name: 'MM-A', role: 'buyer' }));
 * const seller = swarm.addAgent(new Agent({ name: 'MM-B', role: 'seller' }));
 * const taker = swarm.addAgent(new Agent({ name: 'Taker', role: 'taker' }));
 *
 * await swarm.initAll();
 * await swarm.fundAll(3);
 *
 * await swarm.execute(new MarketMakerStrategy({
 *   baseDenom: 'mytoken-testcore1abc...',
 *   basePrice: 0.001,
 * }));
 *
 * swarm.disconnectAll();
 * ```
 */

import { Agent } from "./agent";
import { SwarmConfig, SwarmEventHandler, NetworkName } from "./types";

export class Swarm {
  readonly networkName: NetworkName;
  private _agents: Agent[] = [];
  private _running = false;
  private _onEvent: SwarmEventHandler | null;
  private _abortSignal?: AbortSignal;

  constructor(config: SwarmConfig = {}) {
    this.networkName = config.network || "testnet";
    this._onEvent = config.onEvent || null;
    this._abortSignal = config.abortSignal;
  }

  /** All agents in this swarm */
  get agents(): readonly Agent[] {
    return this._agents;
  }

  /** Whether a strategy is currently running */
  get running(): boolean {
    return this._running;
  }

  /** Number of agents in the swarm */
  get size(): number {
    return this._agents.length;
  }

  // ─── Agent Management ────────────────────────────────────────────────

  /**
   * Add an agent to the swarm.
   */
  addAgent(agent: Agent): Agent {
    this._agents.push(agent);
    return agent;
  }

  /**
   * Create and add an agent in one call.
   */
  createAgent(name: string, role: string): Agent {
    const agent = new Agent({
      name,
      role,
      network: this.networkName,
    });
    this._agents.push(agent);
    return agent;
  }

  /**
   * Get an agent by name.
   */
  getAgent(name: string): Agent | undefined {
    return this._agents.find((a) => a.name === name);
  }

  /**
   * Get agents by role.
   */
  getAgentsByRole(role: string): Agent[] {
    return this._agents.filter((a) => a.role === role);
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────

  /**
   * Initialize all agents (create wallets, connect to chain).
   */
  async initAll(): Promise<void> {
    this.emit("phase", { phase: "init", message: "Initializing agents..." });

    for (const agent of this._agents) {
      await agent.init();
      this.emit("wallet", {
        agent: agent.name,
        role: agent.role,
        address: agent.address,
      });
    }
  }

  /**
   * Fund all agents from the testnet faucet.
   */
  async fundAll(requests = 3, delayMs = 5000): Promise<void> {
    this.emit("phase", { phase: "funding", message: "Funding agents..." });

    for (const agent of this._agents) {
      const result = await agent.fundFromFaucet(requests, delayMs);
      this.emit("funding", {
        agent: agent.name,
        success: result.success,
        total: result.total,
      });
    }
  }

  /**
   * Disconnect all agents and clean up.
   */
  disconnectAll(): void {
    for (const agent of this._agents) {
      try {
        agent.disconnect();
      } catch {
        /* ignore */
      }
    }
    this._running = false;
  }

  // ─── Strategy Execution ──────────────────────────────────────────────

  /**
   * Execute a strategy using the agents in this swarm.
   */
  async execute(strategy: Strategy): Promise<StrategyResult> {
    if (this._running) {
      throw new Error("A strategy is already running.");
    }

    this._running = true;

    try {
      this.emit("phase", {
        phase: "strategy",
        message: `Executing ${strategy.name}...`,
      });

      const result = await strategy.run(this, this.emit.bind(this));

      this.emit("done", { ...result, success: true });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      this.emit("error", { message });
      return { success: false, error: message };
    } finally {
      this._running = false;
    }
  }

  // ─── Events ──────────────────────────────────────────────────────────

  /**
   * Set the event handler.
   */
  onEvent(handler: SwarmEventHandler): void {
    this._onEvent = handler;
  }

  /**
   * Emit an event.
   */
  emit(event: string, data: Record<string, unknown>): void {
    if (this._onEvent) {
      this._onEvent(event as any, data);
    }
  }

  /**
   * Check if the swarm should abort.
   */
  get aborted(): boolean {
    return this._abortSignal?.aborted ?? false;
  }
}

// ─── Strategy Interface ──────────────────────────────────────────────────────

export interface Strategy {
  /** Human-readable strategy name */
  readonly name: string;

  /**
   * Execute the strategy using the swarm's agents.
   * @param swarm The swarm providing agents
   * @param emit Callback to emit progress events
   */
  run(
    swarm: Swarm,
    emit: (event: string, data: Record<string, unknown>) => void
  ): Promise<StrategyResult>;
}

export interface StrategyResult {
  success: boolean;
  error?: string;
  ordersPlaced?: number;
  fills?: number;
  [key: string]: unknown;
}
