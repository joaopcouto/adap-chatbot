import mongoose from "mongoose";

const monthlySpendingSchema = new mongoose.Schema({
    month: String, 
    amount: Number
}, { _id: false});

const userStatsSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    totalSpent: { type: Number, default: 0 },
    spendingHistory: { type: [monthlySpendingSchema], default: [] }
});

export default mongoose.model("UserStats", userStatsSchema);