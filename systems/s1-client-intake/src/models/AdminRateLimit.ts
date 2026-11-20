import mongoose, { Schema, Document } from "mongoose";

export interface IAdminRateLimit extends Document {
  key: string;
  count: number;
  resetAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AdminRateLimitSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    count: { type: Number, default: 1 },
    resetAt: { type: Date, required: true },
  },
  { timestamps: true }
);

AdminRateLimitSchema.index({ key: 1 }, { unique: true, background: true });
AdminRateLimitSchema.index({ resetAt: 1 }, { expireAfterSeconds: 60, background: true });

export default mongoose.models.AdminRateLimit ||
  mongoose.model<IAdminRateLimit>("AdminRateLimit", AdminRateLimitSchema);
