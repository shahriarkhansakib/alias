/**
 * Unified In-Memory Typing State Manager.
 *
 * Provides real-time typing coordination with zero database reads/writes per keystroke.
 * Enforces strict priority rules:
 * - Admin typing ALWAYS supersedes AI typing.
 * - Inactive typing states auto-expire after 2500ms to avoid stuck indicators.
 * - Isolated strictly by conversation / campaign / thread ID.
 * - Backed by an event subscriber model for Server-Sent Events (SSE) broadcasting.
 */

export interface TypingState {
  conversationId: string;
  campaignId?: string;
  threadId?: string;
  isTyping: boolean;
  source: "admin" | "ai" | null;
  actorId?: string;
  generation?: number;
  updatedAt: number;
  expiresAt: number;
}

type TypingListener = (state: TypingState) => void;

class TypingStateManagerClass {
  // Keyed by unified identifier (campaignId or conversationId or threadId)
  private states = new Map<string, TypingState>();
  // Alias mapping: threadId -> campaignId, conversationId -> campaignId
  private aliasMap = new Map<string, string>();
  // Active listeners per unified key
  private listeners = new Map<string, Set<TypingListener>>();
  // Active expiration timeouts
  private timers = new Map<string, NodeJS.Timeout>();

  /**
   * Register aliases between threadId, campaignId, and conversationId.
   */
  registerAlias(primaryKey: string, alias: string): void {
    if (!primaryKey || !alias || primaryKey === alias) return;
    this.aliasMap.set(alias, primaryKey);
  }

  /**
   * Resolve any alias to the primary canonical key.
   */
  resolveKey(key: string): string {
    if (!key) return "";
    return this.aliasMap.get(key) || key;
  }

  /**
   * Get current typing state for a conversation/campaign/thread.
   */
  getTypingState(rawKey: string): TypingState {
    const key = this.resolveKey(rawKey);
    const state = this.states.get(key);
    const now = Date.now();

    if (!state || now >= state.expiresAt || !state.isTyping) {
      return {
        conversationId: key,
        isTyping: false,
        source: null,
        updatedAt: now,
        expiresAt: now,
      };
    }

    return state;
  }

  /**
   * Admin sets typing state.
   * Admin typing ALWAYS has priority: immediately cancels any active AI typing.
   */
  setAdminTyping(
    targetKey: string,
    adminId: string,
    isTyping: boolean,
    aliases?: string[]
  ): TypingState {
    const key = this.resolveKey(targetKey);

    if (aliases) {
      for (const a of aliases) {
        this.registerAlias(key, a);
      }
    }

    // Clear any existing expiration timer
    const existingTimer = this.timers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.timers.delete(key);
    }

    const now = Date.now();
    const timeoutDuration = 2500; // Auto-expire after 2.5 seconds of silence

    const nextState: TypingState = {
      conversationId: key,
      isTyping,
      source: isTyping ? "admin" : null,
      actorId: isTyping ? adminId : undefined,
      updatedAt: now,
      expiresAt: isTyping ? now + timeoutDuration : now,
    };

    this.states.set(key, nextState);

    if (isTyping) {
      // Set auto-expire timer
      const timer = setTimeout(() => {
        this.expireTyping(key, "admin");
      }, timeoutDuration);

      if (timer.unref) timer.unref();
      this.timers.set(key, timer);
    }

    this.notify(key, nextState);
    return nextState;
  }

  /**
   * AI sets typing state.
   * AI typing can only activate if Admin is NOT currently typing.
   */
  setAiTyping(
    targetKey: string,
    isTyping: boolean,
    durationMs: number = 5000,
    aliases?: string[]
  ): TypingState | null {
    const key = this.resolveKey(targetKey);

    if (aliases) {
      for (const a of aliases) {
        this.registerAlias(key, a);
      }
    }

    const current = this.getTypingState(key);

    // PRIORITY RULE: Admin typing supersedes AI typing. Do not override active Admin typing.
    if (current.isTyping && current.source === "admin") {
      return null;
    }

    // Clear any existing expiration timer
    const existingTimer = this.timers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.timers.delete(key);
    }

    const now = Date.now();
    const expiresAt = isTyping ? now + Math.max(1000, durationMs) : now;

    const nextState: TypingState = {
      conversationId: key,
      isTyping,
      source: isTyping ? "ai" : null,
      updatedAt: now,
      expiresAt,
    };

    this.states.set(key, nextState);

    if (isTyping) {
      const timer = setTimeout(() => {
        this.expireTyping(key, "ai");
      }, Math.max(1000, durationMs));

      if (timer.unref) timer.unref();
      this.timers.set(key, timer);
    }

    this.notify(key, nextState);
    return nextState;
  }

  /**
   * Immediately cancel any AI typing state for a conversation
   * (e.g. when Admin takes over, sends a manual message, or clicks Stop Auto-Reply).
   */
  cancelAiTyping(targetKey: string): void {
    const key = this.resolveKey(targetKey);
    const current = this.states.get(key);
    if (current && current.source === "ai") {
      const existingTimer = this.timers.get(key);
      if (existingTimer) {
        clearTimeout(existingTimer);
        this.timers.delete(key);
      }
      const now = Date.now();
      const nextState: TypingState = {
        conversationId: key,
        isTyping: false,
        source: null,
        updatedAt: now,
        expiresAt: now,
      };
      this.states.set(key, nextState);
      this.notify(key, nextState);
    }
  }

  /**
   * Clear all typing state for a conversation (e.g. message delivered, thread switched).
   */
  clearTyping(targetKey: string): void {
    const key = this.resolveKey(targetKey);
    const existingTimer = this.timers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.timers.delete(key);
    }
    const now = Date.now();
    const nextState: TypingState = {
      conversationId: key,
      isTyping: false,
      source: null,
      updatedAt: now,
      expiresAt: now,
    };
    this.states.set(key, nextState);
    this.notify(key, nextState);
  }

  /**
   * Handle natural timeout expiration.
   */
  private expireTyping(key: string, expectedSource: "admin" | "ai"): void {
    const current = this.states.get(key);
    if (current && current.source === expectedSource && current.isTyping) {
      const now = Date.now();
      const expiredState: TypingState = {
        conversationId: key,
        isTyping: false,
        source: null,
        updatedAt: now,
        expiresAt: now,
      };
      this.states.set(key, expiredState);
      this.timers.delete(key);
      this.notify(key, expiredState);
    }
  }

  /**
   * Subscribe to real-time typing events for a conversation.
   * Returns an unsubscribe function.
   */
  subscribe(targetKey: string, listener: TypingListener): () => void {
    const key = this.resolveKey(targetKey);
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(listener);

    return () => {
      const activeSet = this.listeners.get(key);
      if (activeSet) {
        activeSet.delete(listener);
        if (activeSet.size === 0) {
          this.listeners.delete(key);
        }
      }
    };
  }

  /**
   * Notify all active subscribers of state changes.
   */
  private notify(key: string, state: TypingState): void {
    const set = this.listeners.get(key);
    if (set) {
      for (const listener of set) {
        try {
          listener(state);
        } catch (err) {
          console.warn("[TypingStateManager] Listener error:", err);
        }
      }
    }
  }
}

// Preserve singleton across Next.js HMR reloads
const globalRef = globalThis as unknown as { __typingStateManager?: TypingStateManagerClass };
export const TypingStateManager =
  globalRef.__typingStateManager || (globalRef.__typingStateManager = new TypingStateManagerClass());
