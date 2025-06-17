import mongoose from "mongoose";

const installmentPurchaseSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  originalMessageId: { type: String, required: true, unique: true },
  description: { type: String, required: true },
  totalAmount: { type: Number, required: true },
  installmentAmount: { type: Number, required: true },
  numberOfInstallments: { type: Number, required: true },
  currentInstallment: { type: Number, default: 0 }, 
  category: { type: String, required: true },
  dueDay: { type: Number, required: true },
  startDate: { type: Date, default: Date.now },
  status: {
    type: String,
    enum: ["active", "completed", "cancelled"],
    default: "active",
  },
});

export default mongoose.model("InstallmentPurchase", installmentPurchaseSchema);