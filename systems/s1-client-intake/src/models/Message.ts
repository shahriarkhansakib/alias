import mongoose, { Schema, Document } from "mongoose";

export interface IMessage extends Document {
  conversationId: mongoose.Types.ObjectId;
  campaignId: mongoose.Types.ObjectId;
  sender: "user" | "ai" | "system";
  content: string;
  extractedFields?: any;
  createdAt: Date;
}

const MessageSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
    campaignId: { type: Schema.Types.ObjectId, ref: "Campaign", required: true },
    sender: { type: String, enum: ["user", "ai", "system"], required: true },
    content: { type: String, required: true },
    extractedFields: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

export default mongoose.models.Message || mongoose.model<IMessage>("Message", MessageSchema);
