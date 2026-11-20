import mongoose, { Schema, Document } from "mongoose";

export interface IAdminAutoReplyJob extends Document {
  threadId: mongoose.Types.ObjectId;
  threadGeneration: number;
  settingsRevision: number;
  messageId: mongoose.Types.ObjectId;
  idempotencyKey: string;
  claimToken?: string;
  scheduledExecuteAt: Date;
  proposedReply: string;
  tone: "professional" | "friendly" | "detailed";
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "CANCELLED" | "BLOCKED_SAFETY" | "FAILED";
  cancelledReason?: string;
  attempts: number;
  lockedAt: Date | null;
  lockedBy: string | null;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AdminAutoReplyJobSchema = new Schema(
  {
    threadId: { type: Schema.Types.ObjectId, ref: "AdminClientThread", required: true },
    threadGeneration: { type: Number, required: true },
    settingsRevision: { type: Number, required: true },
    messageId: { type: Schema.Types.ObjectId, ref: "AdminClientMessage", required: true },
    idempotencyKey: { type: String, required: true },
    claimToken: { type: String },
    scheduledExecuteAt: { type: Date, required: true },
    proposedReply: { type: String, required: true },
    tone: { type: String, enum: ["professional", "friendly", "detailed"], required: true },
    status: {
      type: String,
      enum: ["PENDING", "PROCESSING", "COMPLETED", "CANCELLED", "BLOCKED_SAFETY", "FAILED"],
      default: "PENDING",
    },
    cancelledReason: { type: String },
    attempts: { type: Number, default: 0 },
    lockedAt: { type: Date, default: null },
    lockedBy: { type: String, default: null },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

AdminAutoReplyJobSchema.index({ status: 1, scheduledExecuteAt: 1 }, { background: true });
AdminAutoReplyJobSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true, background: true });
AdminAutoReplyJobSchema.index({ threadId: 1, status: 1 }, { background: true });
AdminAutoReplyJobSchema.index({ status: 1, lockedAt: 1 }, { background: true });

export default mongoose.models.AdminAutoReplyJob ||
  mongoose.model<IAdminAutoReplyJob>("AdminAutoReplyJob", AdminAutoReplyJobSchema);
