import { dbConnect } from "@/lib/db/connect";
import AdminCommunicationSettings, {
  AdminCommunicationMode,
  AdminPresenceStatus,
  IAdminCommunicationSettings,
} from "@/models/AdminCommunicationSettings";
import AdminAutoReplyJob from "@/models/AdminAutoReplyJob";
import AdminAiGenerationJob from "@/models/AdminAiGenerationJob";
import AdminClientThread from "@/models/AdminClientThread";

export interface EffectiveCommunicationState {
  settings: IAdminCommunicationSettings;
  effectiveMode: AdminCommunicationMode;
  presence: AdminPresenceStatus;
  isManualOverride: boolean;
  stats: {
    pendingAiJobs: number;
    pendingAutoReplyJobs: number;
    adminControlledThreads: number;
    totalThreads: number;
  };
}

export class PresenceService {
  /**
   * Get or initialize default settings.
   */
  static async getSettings(): Promise<IAdminCommunicationSettings> {
    try {
      await dbConnect();
      const mongoose = await import("mongoose");
      if (mongoose.default.connection.readyState === 1) {
        let settings = await AdminCommunicationSettings.findOne();
        if (!settings) {
          settings = await AdminCommunicationSettings.create({
            mode: "ADMIN_ACTIVE",
            manualModeOverride: false,
            adminPresence: "ACTIVE",
            adminLastSeenAt: new Date(),
            awayTimeoutSeconds: 180,
            autoReplyGlobalEnabled: false,
            countdownDurationSeconds: 10,
            defaultTone: "professional",
            settingsRevision: 1,
            updatedBy: "system",
          });
        }
        return settings;
      }
    } catch {}

    // Resilient fallback for unit testing / disconnected environments
    return {
      mode: "ADMIN_ACTIVE",
      manualModeOverride: false,
      adminPresence: "ACTIVE",
      adminLastSeenAt: new Date(),
      awayTimeoutSeconds: 180,
      autoReplyGlobalEnabled: false,
      countdownDurationSeconds: 10,
      defaultTone: "professional",
      settingsRevision: 1,
      updatedBy: "system",
      save: async () => {},
    } as any;
  }

  /**
   * Compute effective mode and presence.
   * Priority:
   * 1. MESSAGING_OFF always overrides everything.
   * 2. manualModeOverride enforces chosen mode (ADMIN_ACTIVE or ADMIN_AWAY).
   * 3. Automatic heartbeat timeout: if now - lastSeenAt > awayTimeoutSeconds, mode is ADMIN_AWAY.
   *    Otherwise, mode is ADMIN_ACTIVE.
   */
  static computeEffectiveState(settings: IAdminCommunicationSettings): {
    effectiveMode: AdminCommunicationMode;
    presence: AdminPresenceStatus;
    isManualOverride: boolean;
  } {
    // Priority 1: MESSAGING_OFF overrides everything
    if (settings.mode === "MESSAGING_OFF") {
      return {
        effectiveMode: "MESSAGING_OFF",
        presence: settings.adminPresence || "AWAY",
        isManualOverride: settings.manualModeOverride ?? true,
      };
    }

    // Priority 2: Manual override
    if (settings.manualModeOverride) {
      const mode = settings.mode === "ADMIN_AWAY" ? "ADMIN_AWAY" : "ADMIN_ACTIVE";
      const presence: AdminPresenceStatus = mode === "ADMIN_ACTIVE" ? "ACTIVE" : "AWAY";
      return {
        effectiveMode: mode,
        presence,
        isManualOverride: true,
      };
    }

    // Priority 3: Automatic presence detection
    const now = Date.now();
    const lastSeen = settings.adminLastSeenAt
      ? new Date(settings.adminLastSeenAt).getTime()
      : 0;
    const timeoutMs = (settings.awayTimeoutSeconds || 180) * 1000;
    const isPresent = lastSeen > 0 && now - lastSeen <= timeoutMs;

    const presence: AdminPresenceStatus = isPresent ? "ACTIVE" : "AWAY";
    const effectiveMode: AdminCommunicationMode = isPresent ? "ADMIN_ACTIVE" : "ADMIN_AWAY";

    return {
      effectiveMode,
      presence,
      isManualOverride: false,
    };
  }

  /**
   * Record admin presence heartbeat.
   * Updates lastSeenAt and updates presence/mode if not manually locked.
   */
  static async recordHeartbeat(adminName: string = "System Admin"): Promise<EffectiveCommunicationState> {
    await dbConnect();
    const settings = await this.getSettings();
    const now = new Date();

    settings.adminLastSeenAt = now;
    settings.adminPresence = "ACTIVE";

    // If in automatic mode, ensure mode reflects active presence
    if (!settings.manualModeOverride && settings.mode !== "MESSAGING_OFF") {
      settings.mode = "ADMIN_ACTIVE";
    }

    settings.updatedBy = adminName;
    await settings.save();

    return await this.getState();
  }

  /**
   * Set communication mode with manual override flag.
   */
  static async setMode(params: {
    mode: AdminCommunicationMode;
    manualOverride?: boolean;
    adminName?: string;
  }): Promise<EffectiveCommunicationState> {
    await dbConnect();
    const settings = await this.getSettings();
    const { mode, manualOverride = true, adminName = "System Admin" } = params;

    settings.mode = mode;
    settings.manualModeOverride = manualOverride;
    settings.updatedBy = adminName;
    settings.settingsRevision = (settings.settingsRevision || 1) + 1;

    if (mode === "ADMIN_ACTIVE") {
      settings.adminPresence = "ACTIVE";
      settings.adminLastSeenAt = new Date();
      settings.autoReplyGlobalEnabled = false; // Never auto-reply in ACTIVE mode
    } else if (mode === "ADMIN_AWAY") {
      settings.adminPresence = "AWAY";
      settings.autoReplyGlobalEnabled = true; // Auto-reply active for AWAY
    } else if (mode === "MESSAGING_OFF") {
      settings.autoReplyGlobalEnabled = false;
    }

    await settings.save();

    // Enforce Invalidation Rules:
    // 1. MESSAGING_OFF cancels ALL pending/processing auto-reply AND AI generation jobs
    if (mode === "MESSAGING_OFF") {
      await AdminAutoReplyJob.updateMany(
        { status: { $in: ["PENDING", "PROCESSING"] } },
        {
          $set: {
            status: "CANCELLED",
            cancelledReason: "MESSAGING_OFF_MODE_ACTIVATED",
          },
        }
      );
      await AdminAiGenerationJob.updateMany(
        { status: { $in: ["PENDING", "PROCESSING"] } },
        {
          $set: {
            status: "CANCELLED",
            lastError: "MESSAGING_OFF_MODE_ACTIVATED",
          },
        }
      );
    }

    // 2. ADMIN_ACTIVE cancels ALL pending/processing auto-reply jobs
    if (mode === "ADMIN_ACTIVE") {
      await AdminAutoReplyJob.updateMany(
        { status: { $in: ["PENDING", "PROCESSING"] } },
        {
          $set: {
            status: "CANCELLED",
            cancelledReason: "ADMIN_ACTIVE_PREVENTS_AUTO_REPLY",
          },
        }
      );
    }

    return await this.getState();
  }

  /**
   * Get full state including computed effective mode, presence, and stats.
   */
  static async getState(): Promise<EffectiveCommunicationState> {
    await dbConnect();
    const settings = await this.getSettings();
    const { effectiveMode, presence, isManualOverride } = this.computeEffectiveState(settings);

    // Collect live dashboard stats
    let pendingAiJobs = 0;
    let pendingAutoReplyJobs = 0;
    let adminControlledThreads = 0;
    let totalThreads = 0;
    try {
      const mongoose = await import("mongoose");
      if (mongoose.default.connection.readyState === 1) {
        [pendingAiJobs, pendingAutoReplyJobs, adminControlledThreads, totalThreads] =
          await Promise.all([
            AdminAiGenerationJob.countDocuments({ status: "PENDING" }),
            AdminAutoReplyJob.countDocuments({ status: "PENDING" }),
            AdminClientThread.countDocuments({ adminControlled: true }),
            AdminClientThread.countDocuments(),
          ]);
      }
    } catch {}

    return {
      settings,
      effectiveMode,
      presence,
      isManualOverride,
      stats: {
        pendingAiJobs,
        pendingAutoReplyJobs,
        adminControlledThreads,
        totalThreads,
      },
    };
  }
}
