import mongoose from "mongoose";

const userActivitySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String, required: true },
  phoneNumber: { type: String, required: true },
  messageCount: { type: Number, default: 0 },
  lastInteractionAt: { type: Date, required: true },
}, { timestamps: true });

export default mongoose.model("UserActivity", userActivitySchema);