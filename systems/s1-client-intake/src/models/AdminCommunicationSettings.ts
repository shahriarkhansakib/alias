import mongoose, { Schema, Document } from "mongoose";

export type AdminCommunicationMode = "ADMIN_ACTIVE" | "ADMIN_AWAY" | "MESSAGING_OFF";
export type AdminPresenceStatus = "ACTIVE" | "AWAY";

export interface IAdminCommunicationSettings extends Document {
  autoReplyGlobalEnabled: boolean;
  mode: AdminCommunicationMode;
  manualModeOverride: boolean;
  adminPresence: AdminPresenceStatus;
  adminLastSeenAt: Date;
  awayTimeoutSeconds: number;
  countdownDurationSeconds: number;
  defaultTone: "professional" | "friendly" | "detailed";
  settingsRevision: number;
  lastAiEvaluatedAt?: Date;
  lastDispatchedAt?: Date;
  updatedBy: string;
  updatedAt: Date;
}

const AdminCommunicationSettingsSchema = new Schema(
  {
    autoReplyGlobalEnabled: { type: Boolean, default: false },
    mode: {
      type: String,
      enum: ["ADMIN_ACTIVE", "ADMIN_AWAY", "MESSAGING_OFF"],
      default: "ADMIN_ACTIVE",
    },
    manualModeOverride: { type: Boolean, default: false },
    adminPresence: { type: String, enum: ["ACTIVE", "AWAY"], default: "ACTIVE" },
    adminLastSeenAt: { type: Date, default: Date.now },
    awayTimeoutSeconds: { type: Number, default: 180 },
    countdownDurationSeconds: { type: Number, default: 10 },
    defaultTone: { type: String, enum: ["professional", "friendly", "detailed"], default: "professional" },
    settingsRevision: { type: Number, default: 1 },
    lastAiEvaluatedAt: { type: Date },
    lastDispatchedAt: { type: Date },
    updatedBy: { type: String, default: "system" },
  },
  { timestamps: true }
);

export default mongoose.models.AdminCommunicationSettings ||
  mongoose.model<IAdminCommunicationSettings>("AdminCommunicationSettings", AdminCommunicationSettingsSchema);
