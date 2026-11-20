import mongoose, { Schema, Document } from "mongoose";

export interface ICampaign extends Document {
  clientId: mongoose.Types.ObjectId;
  name: string;
  status: "collecting" | "ready_for_confirmation" | "confirmed" | "researching" | "research_completed" | "brief_generated" | "completed";
  conversationId?: mongoose.Types.ObjectId;
  artifact1Id?: mongoose.Types.ObjectId;
  artifact2Id?: mongoose.Types.ObjectId;
  masterBriefId?: mongoose.Types.ObjectId;
  masterBriefMarkdown?: string;
  executionScriptMarkdown?: string;
  createdAt: Date;
  updatedAt: Date;
}

const CampaignSchema = new Schema(
  {
    clientId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    status: { 
      type: String, 
      enum: ["collecting", "ready_for_confirmation", "confirmed", "researching", "research_completed", "brief_generated", "completed"],
      default: "collecting"
    },
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation" },
    artifact1Id: { type: Schema.Types.ObjectId, ref: "Artifact1" },
    artifact2Id: { type: Schema.Types.ObjectId, ref: "Artifact2" },
    masterBriefId: { type: Schema.Types.ObjectId, ref: "MasterCampaignBrief" },
    masterBriefMarkdown: { type: String, default: "" },
    executionScriptMarkdown: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.models.Campaign || mongoose.model<ICampaign>("Campaign", CampaignSchema);
