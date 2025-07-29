import mongoose from "mongoose";

const paymentMethodSchema = new mongoose.Schema({
  type: { type: String, required: true, unique: true },
});

export default mongoose.model("PaymentMethod", paymentMethodSchema);