import mongoose, { Schema, Document } from "mongoose";

export const MAX_AI_GENERATION_ATTEMPTS = 3;

export interface IAdminAiGenerationJob extends Document {
  threadId: mongoose.Types.ObjectId;
  threadGeneration: number;
  messageId: mongoose.Types.ObjectId;
  idempotencyKey: string;
  claimToken?: string;
  /** When this job is eligible to be picked up by the worker (10-second admin window). */
  scheduledStartAt: Date;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "CANCELLED" | "FAILED";
  attempts: number;
  maxAttempts: number;
  lockedAt: Date | null;
  lockedBy: string | null;
  lastError?: string;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AdminAiGenerationJobSchema = new Schema(
  {
    threadId: { type: Schema.Types.ObjectId, ref: "AdminClientThread", required: true },
    threadGeneration: { type: Number, required: true },
    messageId: { type: Schema.Types.ObjectId, ref: "AdminClientMessage", required: true },
    idempotencyKey: { type: String, required: true },
    claimToken: { type: String },
    scheduledStartAt: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: ["PENDING", "PROCESSING", "COMPLETED", "CANCELLED", "FAILED"],
      default: "PENDING",
    },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: MAX_AI_GENERATION_ATTEMPTS },
    lockedAt: { type: Date, default: null },
    lockedBy: { type: String, default: null },
    lastError: { type: String },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

AdminAiGenerationJobSchema.index({ status: 1, scheduledStartAt: 1 }, { background: true });
AdminAiGenerationJobSchema.index({ status: 1, createdAt: 1 }, { background: true });
AdminAiGenerationJobSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true, background: true });
AdminAiGenerationJobSchema.index({ threadId: 1, status: 1 }, { background: true });
AdminAiGenerationJobSchema.index({ status: 1, lockedAt: 1 }, { background: true });

export default mongoose.models.AdminAiGenerationJob ||
  mongoose.model<IAdminAiGenerationJob>("AdminAiGenerationJob", AdminAiGenerationJobSchema);
