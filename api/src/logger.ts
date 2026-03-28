/**
 * logger.ts — Structured JSON Logging for TXAI Studio
 *
 * Provides:
 *   - JSON-formatted log output with timestamps, levels, scopes, and correlation IDs
 *   - Express middleware for automatic request/response logging
 *   - Duration tracking per request
 *   - Log levels: debug, info, warn, error
 *   - Environment-controlled verbosity (LOG_LEVEL env var)
 */

// ─── TYPES ──────────────────────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  scope: string;
  message: string;
  correlationId?: string;
  durationMs?: number;
  data?: Record<string, unknown>;
  error?: string;
  stack?: string;
}

// ─── LEVEL PRIORITY ─────────────────────────────────────────────────────────

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info";

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel];
}

// ─── CORRELATION ID ─────────────────────────────────────────────────────────

let _correlationCounter = 0;

export function generateCorrelationId(): string {
  _correlationCounter++;
  return `req-${Date.now().toString(36)}-${_correlationCounter.toString(36)}`;
}

// ─── CORE LOGGER ────────────────────────────────────────────────────────────

function emit(entry: LogEntry): void {
  const line = JSON.stringify(entry);
  switch (entry.level) {
    case "error":
      console.error(line);
      break;
    case "warn":
      console.warn(line);
      break;
    default:
      console.log(line);
  }
}

export function log(
  level: LogLevel,
  scope: string,
  message: string,
  extra?: {
    correlationId?: string;
    durationMs?: number;
    data?: Record<string, unknown>;
    error?: Error | string;
  }
): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    scope,
    message,
  };

  if (extra?.correlationId) entry.correlationId = extra.correlationId;
  if (extra?.durationMs !== undefined) entry.durationMs = extra.durationMs;
  if (extra?.data) entry.data = extra.data;

  if (extra?.error) {
    if (extra.error instanceof Error) {
      entry.error = extra.error.message;
      if (level === "error") entry.stack = extra.error.stack;
    } else {
      entry.error = extra.error;
    }
  }

  emit(entry);
}

// ─── CONVENIENCE METHODS ────────────────────────────────────────────────────

export function createScopedLogger(scope: string) {
  return {
    debug: (msg: string, extra?: Parameters<typeof log>[3]) => log("debug", scope, msg, extra),
    info: (msg: string, extra?: Parameters<typeof log>[3]) => log("info", scope, msg, extra),
    warn: (msg: string, extra?: Parameters<typeof log>[3]) => log("warn", scope, msg, extra),
    error: (msg: string, extra?: Parameters<typeof log>[3]) => log("error", scope, msg, extra),
  };
}

// ─── EXPRESS MIDDLEWARE ──────────────────────────────────────────────────────

import type { Request, Response, NextFunction } from "express";

// Extend Express Request to carry correlation ID
declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
      _startTime?: number;
    }
  }
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const correlationId = generateCorrelationId();
  req.correlationId = correlationId;
  req._startTime = Date.now();

  // Log incoming request
  log("info", "http", `${req.method} ${req.path}`, {
    correlationId,
    data: {
      method: req.method,
      path: req.path,
      query: Object.keys(req.query).length > 0 ? req.query as Record<string, unknown> : undefined,
      ip: req.ip,
      userAgent: req.get("user-agent"),
    },
  });

  // Hook into response finish
  const originalEnd = res.end;
  res.end = function (this: Response, ...args: Parameters<Response["end"]>) {
    const durationMs = Date.now() - (req._startTime || Date.now());
    const level: LogLevel = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";

    log(level, "http", `${req.method} ${req.path} → ${res.statusCode}`, {
      correlationId,
      durationMs,
      data: {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
      },
    });

    return originalEnd.apply(this, args);
  } as Response["end"];

  next();
}

// ─── AIRDROP PIPELINE LOGGER ────────────────────────────────────────────────

export const airdropLog = createScopedLogger("airdrop");
export const daoLog = createScopedLogger("dao");
export const vestingLog = createScopedLogger("vesting");
export const scheduleLog = createScopedLogger("schedule");
export const preflightLog = createScopedLogger("preflight");
export const authLog = createScopedLogger("auth");
