import mongoose, { Schema } from "mongoose";

export interface IAdminWorkerLock {
  _id: string;
  lockedUntil: Date;
  lockedBy: string;
  updatedAt: Date;
}

const AdminWorkerLockSchema = new Schema(
  {
    _id: { type: String, default: "GLOBAL_WORKER_LOCK" },
    lockedUntil: { type: Date, default: () => new Date(0) },
    lockedBy: { type: String, default: "none" },
  },
  { timestamps: true }
);

export default mongoose.models.AdminWorkerLock ||
  mongoose.model<IAdminWorkerLock>("AdminWorkerLock", AdminWorkerLockSchema);
