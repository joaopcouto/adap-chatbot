import mongoose from "mongoose";

const categorySchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    name: { type: String, required: true },
    color: { type: String, required: true },
    monthlyLimit: { type: Number, default: 0 }
  },
  { timestamps: true }
);

export default mongoose.model("Category", categorySchema);