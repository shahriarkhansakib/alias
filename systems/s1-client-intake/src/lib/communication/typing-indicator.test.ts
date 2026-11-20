import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TypingStateManager, TypingState } from "@/lib/communication/typing-state-manager";
import { AiTypingService } from "@/lib/communication/ai-typing-service";

describe("Unified Dynamic Typing Indicator System", () => {
  const conversationId1 = "conv_client_test_001";
  const conversationId2 = "conv_client_test_002";
  const adminId = "admin_agent_007";

  beforeEach(() => {
    vi.useFakeTimers();
    TypingStateManager.clearTyping(conversationId1);
    TypingStateManager.clearTyping(conversationId2);
  });

  afterEach(() => {
    TypingStateManager.clearTyping(conversationId1);
    TypingStateManager.clearTyping(conversationId2);
    vi.useRealTimers();
  });

  // 1. Admin starts typing -> Client sees dots
  it("Scenario 1: Admin starts typing -> State becomes isTyping=true", () => {
    const state = TypingStateManager.setAdminTyping(conversationId1, adminId, true);
    expect(state.isTyping).toBe(true);
    expect(state.source).toBe("admin");
    expect(state.actorId).toBe(adminId);

    const retrieved = TypingStateManager.getTypingState(conversationId1);
    expect(retrieved.isTyping).toBe(true);
    expect(retrieved.source).toBe("admin");
  });

  // 2. Admin continues typing -> Dots remain visible
  it("Scenario 2: Admin continues typing -> Dots remain visible and extend expiration", () => {
    TypingStateManager.setAdminTyping(conversationId1, adminId, true);
    vi.advanceTimersByTime(1500);

    // Refresh typing (keystroke before timeout)
    TypingStateManager.setAdminTyping(conversationId1, adminId, true);
    vi.advanceTimersByTime(1500);

    const state = TypingStateManager.getTypingState(conversationId1);
    expect(state.isTyping).toBe(true);
  });

  // 3. Admin stops typing -> Dots disappear after inactivity timeout (2.5s)
  it("Scenario 3: Admin stops typing -> Dots disappear after inactivity timeout", () => {
    TypingStateManager.setAdminTyping(conversationId1, adminId, true);
    expect(TypingStateManager.getTypingState(conversationId1).isTyping).toBe(true);

    // Advance past the 2.5s auto-expire timer
    vi.advanceTimersByTime(2600);

    const state = TypingStateManager.getTypingState(conversationId1);
    expect(state.isTyping).toBe(false);
  });

  // 4. Admin sends message -> Dots disappear immediately
  it("Scenario 4: Admin sends message -> Typing state cleared immediately", () => {
    TypingStateManager.setAdminTyping(conversationId1, adminId, true);
    expect(TypingStateManager.getTypingState(conversationId1).isTyping).toBe(true);

    TypingStateManager.clearTyping(conversationId1);

    const state = TypingStateManager.getTypingState(conversationId1);
    expect(state.isTyping).toBe(false);
    expect(state.source).toBeNull();
  });

  // 5. Short AI response -> Shorter typing duration (1-50 chars = 1.5s)
  it("Scenario 5: Short AI response (1-50 chars) produces 1500ms target typing duration", () => {
    const shortText = "Hello! We can help with your campaign.";
    expect(shortText.length).toBeLessThanOrEqual(50);

    const duration = AiTypingService.calculateTargetTypingDuration(shortText);
    expect(duration).toBe(1500);
  });

  // 6. Long AI response -> Longer typing duration (500+ chars = 6500ms+)
  it("Scenario 6: Medium and Long AI responses produce proportional typing durations", () => {
    // 51-150 chars -> 2500ms
    const mediumText = "A".repeat(100);
    expect(AiTypingService.calculateTargetTypingDuration(mediumText)).toBe(2500);

    // 151-300 chars -> 4000ms
    const longText = "B".repeat(250);
    expect(AiTypingService.calculateTargetTypingDuration(longText)).toBe(4000);

    // 301-500 chars -> 5000ms
    const veryLongText = "C".repeat(450);
    expect(AiTypingService.calculateTargetTypingDuration(veryLongText)).toBe(5000);

    // 500+ chars -> 6500ms+
    const extensiveText = "D".repeat(600);
    expect(AiTypingService.calculateTargetTypingDuration(extensiveText)).toBeGreaterThanOrEqual(6500);
  });

  // 7. AI generation takes longer than target duration -> No extra waiting
  it("Scenario 7: AI generation takes longer than target duration -> remainingDelay is 0", () => {
    const targetDurationMs = 2500;
    const elapsedTimeMs = 3200; // Gemini took 3.2s to generate

    const remainingDelay = AiTypingService.calculateRemainingDelay(targetDurationMs, elapsedTimeMs);
    expect(remainingDelay).toBe(0); // Max(0, 2500 - 3200) = 0, no extra wait!
  });

  // 7b. AI generation faster than target -> waits only remaining difference
  it("Scenario 7b: AI generation faster than target -> remainingDelay is target - elapsed", () => {
    const targetDurationMs = 4000;
    const elapsedTimeMs = 1200;

    const remainingDelay = AiTypingService.calculateRemainingDelay(targetDurationMs, elapsedTimeMs);
    expect(remainingDelay).toBe(2800);
  });

  // 8. Admin starts typing during AI generation -> Admin takes priority
  it("Scenario 8: Admin starts typing during AI generation -> Admin takes priority immediately", () => {
    // AI starts typing
    TypingStateManager.setAiTyping(conversationId1, true, 5000);
    expect(TypingStateManager.getTypingState(conversationId1).source).toBe("ai");

    // Admin starts typing
    TypingStateManager.setAdminTyping(conversationId1, adminId, true);
    const state = TypingStateManager.getTypingState(conversationId1);

    expect(state.isTyping).toBe(true);
    expect(state.source).toBe("admin");

    // Subsequent AI event cannot override Admin
    const aiOverrideAttempt = TypingStateManager.setAiTyping(conversationId1, true, 3000);
    expect(aiOverrideAttempt).toBeNull();
    expect(TypingStateManager.getTypingState(conversationId1).source).toBe("admin");
  });

  // 9. Admin sends a reply during AI generation -> AI cannot deliver stale response
  it("Scenario 9: Admin sends reply during AI generation -> cancelAiTyping immediately cancels AI state", () => {
    TypingStateManager.setAiTyping(conversationId1, true, 4000);
    expect(TypingStateManager.getTypingState(conversationId1).isTyping).toBe(true);

    // Admin sends reply: cancels AI typing
    TypingStateManager.cancelAiTyping(conversationId1);
    expect(TypingStateManager.getTypingState(conversationId1).isTyping).toBe(false);
  });

  // 10. Stop Auto-Reply -> AI typing stops and pending AI delivery is prevented
  it("Scenario 10: Stop Auto-Reply -> AI typing stops immediately", () => {
    TypingStateManager.setAiTyping(conversationId1, true, 5000);
    expect(TypingStateManager.getTypingState(conversationId1).isTyping).toBe(true);

    TypingStateManager.cancelAiTyping(conversationId1);

    const state = TypingStateManager.getTypingState(conversationId1);
    expect(state.isTyping).toBe(false);
  });

  // 11. Admin disconnects / switches conversation -> Typing state cleared
  it("Scenario 11: Admin disconnects or switches conversation -> Previous conversation typing cleared", () => {
    TypingStateManager.setAdminTyping(conversationId1, adminId, true);
    expect(TypingStateManager.getTypingState(conversationId1).isTyping).toBe(true);

    // Switch or disconnect
    TypingStateManager.setAdminTyping(conversationId1, adminId, false);

    expect(TypingStateManager.getTypingState(conversationId1).isTyping).toBe(false);
  });

  // 12. Multiple conversations -> No cross-conversation typing events
  it("Scenario 12: Multiple conversations -> Strictly isolated by conversationId", () => {
    TypingStateManager.setAdminTyping(conversationId1, adminId, true);

    expect(TypingStateManager.getTypingState(conversationId1).isTyping).toBe(true);
    expect(TypingStateManager.getTypingState(conversationId2).isTyping).toBe(false);

    TypingStateManager.setAiTyping(conversationId2, true, 3000);
    expect(TypingStateManager.getTypingState(conversationId2).isTyping).toBe(true);
    expect(TypingStateManager.getTypingState(conversationId2).source).toBe("ai");
    expect(TypingStateManager.getTypingState(conversationId1).source).toBe("admin");
  });

  // 13. Client reconnects -> No stale typing indicator
  it("Scenario 13: Client reconnects after timeout -> Returns isTyping=false", () => {
    TypingStateManager.setAdminTyping(conversationId1, adminId, true);
    // Advance past timeout
    vi.advanceTimersByTime(3000);

    // Reconnecting client requests typing state
    const state = TypingStateManager.getTypingState(conversationId1);
    expect(state.isTyping).toBe(false);
  });

  // 14. Real-time subscriber notification (SSE integration)
  it("Scenario 14: Real-time subscriber receives instant state transitions", () => {
    const receivedEvents: boolean[] = [];

    const unsubscribe = TypingStateManager.subscribe(conversationId1, (state) => {
      receivedEvents.push(state.isTyping);
    });

    TypingStateManager.setAdminTyping(conversationId1, adminId, true);
    expect(receivedEvents).toEqual([true]);

    TypingStateManager.clearTyping(conversationId1);
    expect(receivedEvents).toEqual([true, false]);

    unsubscribe();
  });
});
