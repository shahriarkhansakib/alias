import mongoose, { Schema, Document } from "mongoose";

export interface IConversation extends Document {
  campaignId: mongoose.Types.ObjectId;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const ConversationSchema = new Schema(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: "Campaign", required: true },
    status: { type: String, default: "active" },
  },
  { timestamps: true }
);

export default mongoose.models.Conversation || mongoose.model<IConversation>("Conversation", ConversationSchema);
