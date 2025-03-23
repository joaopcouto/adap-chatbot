import mongoose from "mongoose";
import { VALID_CATEGORIES } from "../utils/constants.js";

const expenseSchema = new mongoose.Schema({
  userId: String,
  amount: Number,
  description: String,
  category: { type: String, enum: VALID_CATEGORIES },
  date: { type: Date, default: Date.now },
  messageId: String,
});

export default mongoose.model("Expense", expenseSchema);