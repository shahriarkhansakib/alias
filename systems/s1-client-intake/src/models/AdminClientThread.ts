import mongoose, { Schema, Document } from "mongoose";

export interface IAdminClientThread extends Document {
  campaignId: mongoose.Types.ObjectId;
  clientId: mongoose.Types.ObjectId;
  clientName: string;
  clientEmail: string;
  businessName: string;
  threadGeneration: number;
  activeJobId: mongoose.Types.ObjectId | null;
  lastMessageSnippet: string;
  lastMessageAt: Date;
  lastSender: "client" | "admin" | "ai_auto";
  lastAutoRepliedAt?: Date;
  unreadAdminCount: number;
  unreadClientCount: number;
  adminControlled: boolean;
  adminControlledAt?: Date;
  adminControlledBy?: string;
  aiAutoReplyAllowed: boolean;
  /** Per-thread AI auto-reply switch. Admin can toggle OFF without full mode change. */
  perThreadAiEnabled: boolean;
  /** Timestamp of the last client message used to show countdown in UI */
  lastClientMessageAt?: Date;
  /** ID of the pending AI generation job for countdown display */
  pendingAiJobId?: mongoose.Types.ObjectId | null;
  /** When the pending AI generation will start (for countdown display) */
  aiJobScheduledStartAt?: Date | null;
  /** Thread classification: intake (campaign onboarding) vs direct (general communication) */
  threadType?: "intake" | "direct";
  status: "active" | "archived";
  createdAt: Date;
  updatedAt: Date;
}

const AdminClientThreadSchema = new Schema(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: "Campaign", required: true },
    clientId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    clientName: { type: String, default: "" },
    clientEmail: { type: String, default: "" },
    businessName: { type: String, default: "" },
    threadGeneration: { type: Number, default: 1 },
    activeJobId: { type: Schema.Types.ObjectId, ref: "AdminAutoReplyJob", default: null },
    lastMessageSnippet: { type: String, default: "" },
    lastMessageAt: { type: Date, default: Date.now },
    lastSender: { type: String, enum: ["client", "admin", "ai_auto"], default: "client" },
    lastAutoRepliedAt: { type: Date },
    unreadAdminCount: { type: Number, default: 0 },
    unreadClientCount: { type: Number, default: 0 },
    adminControlled: { type: Boolean, default: false },
    adminControlledAt: { type: Date },
    adminControlledBy: { type: String },
    aiAutoReplyAllowed: { type: Boolean, default: true },
    perThreadAiEnabled: { type: Boolean, default: true },
    lastClientMessageAt: { type: Date },
    pendingAiJobId: { type: Schema.Types.ObjectId, ref: "AdminAiGenerationJob", default: null },
    aiJobScheduledStartAt: { type: Date, default: null },
    threadType: { type: String, enum: ["intake", "direct"], default: "intake" },
    status: { type: String, enum: ["active", "archived"], default: "active" },
  },
  { timestamps: true }
);

AdminClientThreadSchema.index({ campaignId: 1, clientId: 1 }, { unique: true, background: true });
AdminClientThreadSchema.index({ lastMessageAt: -1 }, { background: true });

export default mongoose.models.AdminClientThread ||
  mongoose.model<IAdminClientThread>("AdminClientThread", AdminClientThreadSchema);
