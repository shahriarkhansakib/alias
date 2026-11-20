/**
 * AI Dynamic Typing Duration Service.
 *
 * Implements realistic dynamic typing timing grounded in actual generated response length:
 * | AI Response Length | Target Typing Duration |
 * | 1–50 characters    | 1.5 seconds            |
 * | 51–150 characters  | 2.5 seconds            |
 * | 151–300 characters | 4.0 seconds            |
 * | 301–500 characters | 5.0 seconds            |
 * | 500+ characters    | 6.5 seconds (max 8s)   |
 *
 * Formula:
 * remainingDelay = Math.max(0, targetTypingDuration - elapsedTimeMs)
 */

export interface AiTypingConfig {
  minDurationMs?: number;
  maxDurationMs?: number;
}

export class AiTypingService {
  /**
   * Calculate target typing duration (in milliseconds) based on response length.
   */
  static calculateTargetTypingDuration(
    content: string,
    config?: AiTypingConfig
  ): number {
    const charCount = (content || "").trim().length;
    const minMs = config?.minDurationMs ?? 1200;
    const maxMs = config?.maxDurationMs ?? 8000;

    let targetMs: number;
    if (charCount <= 50) {
      targetMs = 1500;
    } else if (charCount <= 150) {
      targetMs = 2500;
    } else if (charCount <= 300) {
      targetMs = 4000;
    } else if (charCount <= 500) {
      targetMs = 5000;
    } else {
      // 500+ characters: scale smoothly up to 6500-8000ms
      const extraChars = charCount - 500;
      targetMs = Math.min(maxMs, 6500 + Math.floor(extraChars * 3));
    }

    return Math.max(minMs, Math.min(maxMs, targetMs));
  }

  /**
   * Calculate the remaining delay that the server or background job needs to wait
   * while the typing indicator is active before delivering the message.
   *
   * @param targetDurationMs The computed target duration for the response length.
   * @param elapsedTimeMs The actual wall-clock time already spent generating the reply.
   * @returns The remaining milliseconds to wait (>= 0). If elapsed >= target, returns 0.
   */
  static calculateRemainingDelay(
    targetDurationMs: number,
    elapsedTimeMs: number
  ): number {
    return Math.max(0, targetDurationMs - elapsedTimeMs);
  }

  /**
   * Helper that waits for remainingDelay with support for cancellation checking.
   */
  static async waitRemainingDelay(
    remainingDelayMs: number,
    shouldCancelCheck?: () => Promise<boolean> | boolean
  ): Promise<boolean> {
    if (remainingDelayMs <= 0) return true;

    const stepMs = 100;
    let waited = 0;

    while (waited < remainingDelayMs) {
      if (shouldCancelCheck) {
        const cancelled = await shouldCancelCheck();
        if (cancelled) return false;
      }
      const sleepTime = Math.min(stepMs, remainingDelayMs - waited);
      await new Promise((resolve) => setTimeout(resolve, sleepTime));
      waited += sleepTime;
    }

    return true;
  }
}
