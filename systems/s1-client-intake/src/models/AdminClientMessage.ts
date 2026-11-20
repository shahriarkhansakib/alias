import mongoose, { Schema, Document } from "mongoose";

export interface IAdminClientMessage extends Document {
  threadId: mongoose.Types.ObjectId;
  campaignId: mongoose.Types.ObjectId;
  clientId: mongoose.Types.ObjectId;
  sender: "client" | "admin" | "ai_auto";
  senderName: string;
  content: string;
  idempotencyKey?: string;
  aiStatus: "NOT_STARTED" | "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";
  aiError?: string;
  aiAnalysis?: {
    suggestions: {
      professional: string;
      friendly: string;
      detailed: string;
    };
    recommendedTone: "professional" | "friendly" | "detailed";
    confidenceScore: number;
    safetyPassed: boolean;
    safetyFlags: string[];
    provider?: "gemini" | "fallback";
    providerModel?: string;
    relevantScriptIds?: string[];
    scriptVersion?: number;
    requiresAdminReview?: boolean;
    noRelevantScriptFound?: boolean;
    matchedScriptTitles?: string[];
  };
  autoReplyStatus?: "NOT_SCHEDULED" | "PENDING" | "EXECUTED" | "CANCELLED" | "BLOCKED_SAFETY";
  readByAdmin: boolean;
  readByClient: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const AdminClientMessageSchema = new Schema(
  {
    threadId: { type: Schema.Types.ObjectId, ref: "AdminClientThread", required: true },
    campaignId: { type: Schema.Types.ObjectId, ref: "Campaign", required: true },
    clientId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    sender: { type: String, enum: ["client", "admin", "ai_auto"], required: true },
    senderName: { type: String, required: true },
    content: { type: String, required: true },
    idempotencyKey: { type: String },
    aiStatus: {
      type: String,
      enum: ["NOT_STARTED", "PENDING", "PROCESSING", "COMPLETED", "FAILED", "CANCELLED"],
      default: "NOT_STARTED",
    },
    aiError: { type: String },
    aiAnalysis: { type: Schema.Types.Mixed },
    autoReplyStatus: {
      type: String,
      enum: ["NOT_SCHEDULED", "PENDING", "EXECUTED", "CANCELLED", "BLOCKED_SAFETY"],
      default: "NOT_SCHEDULED",
    },
    readByAdmin: { type: Boolean, default: false },
    readByClient: { type: Boolean, default: false },
  },
  { timestamps: true }
);

AdminClientMessageSchema.index({ threadId: 1, createdAt: 1 }, { background: true });
AdminClientMessageSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true, background: true });

export default mongoose.models.AdminClientMessage ||
  mongoose.model<IAdminClientMessage>("AdminClientMessage", AdminClientMessageSchema);
