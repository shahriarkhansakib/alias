import mongoose, { Schema, Document } from "mongoose";

export const SCRIPT_CATEGORIES = [
  "Greeting",
  "Agency Introduction",
  "Services",
  "Pricing",
  "Packages",
  "Campaign Strategy",
  "FAQs",
  "Client Objections",
  "Follow-up Messages",
  "Payment Policies",
  "Delivery Timeline",
  "Custom Scripts",
  "Forbidden Claims / Restrictions",
] as const;

export type ScriptCategory = (typeof SCRIPT_CATEGORIES)[number];

export interface IAdminScript extends Document {
  title: string;
  category: ScriptCategory;
  content: string;
  keywords: string[];
  relevantSituations: string[];
  isActive: boolean;
  version: number;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const AdminScriptSchema = new Schema<IAdminScript>(
  {
    title: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: SCRIPT_CATEGORIES,
      required: true,
      index: true,
    },
    content: { type: String, required: true, trim: true },
    keywords: [{ type: String, trim: true, lowercase: true }],
    relevantSituations: [{ type: String, trim: true }],
    isActive: { type: Boolean, default: true, index: true },
    version: { type: Number, default: 1 },
    createdBy: { type: String, default: "system" },
    updatedBy: { type: String, default: "system" },
  },
  { timestamps: true }
);

AdminScriptSchema.index({ category: 1, isActive: 1 });
AdminScriptSchema.index({ keywords: 1 });
AdminScriptSchema.index({ title: "text", content: "text" });

export default mongoose.models.AdminScript ||
  mongoose.model<IAdminScript>("AdminScript", AdminScriptSchema);
