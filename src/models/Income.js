import mongoose from "mongoose";

const incomeSchema = new mongoose.Schema({
  userId: String,
  amount: Number,
  description: String,
  category: { type: String },
  date: { type: Date, default: Date.now },
  messageId: String,
});

export default mongoose.model("Income", incomeSchema);
