import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  amount: { type: Number, required: true },
  description: { type: String, required: true },
  categoryId: { type: String, required: true },
  date: { type: Date, default: Date.now },
  messageId: { type: String, required: true },
  type: { type: String, required: true },
  paymentMethod: { type: String, required: true },
  status: { type: String, required: true },
  installmentsCount: { type: Number, required: false },
  installmentsCurrent: { type: Number, required: false },
  installmentsGroupId: { type: String, required: false },
});

export default mongoose.model("Transactions", transactionSchema);