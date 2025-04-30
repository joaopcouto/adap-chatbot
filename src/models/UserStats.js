import mongoose from "mongoose";

const monthlySpendingSchema = new mongoose.Schema({
    month: String, 
    amount: Number
}, { _id: false});

const monthlyIncomeSchema = new mongoose.Schema({
    month: String,
    amount: Number
}, { _id: false});

const userStatsSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    blocked: { type: Boolean, default: false },
    totalSpent: { type: Number, default: 0 },
    totalIncome: { type: Number, default: 0 },
    spendingHistory: { type: [monthlySpendingSchema], default: [] },
    incomeHistory: { type: [monthlyIncomeSchema], default: [] },
    featuresUnlocked: {
        type: [String],
        default: [],
    },
    createdCategories: {
        type: [String],
        default: [],
    }
});

export default mongoose.model("UserStats", userStatsSchema);