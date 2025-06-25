import mongoose from "mongoose";
 
const paymentMethodsSchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
  },
  { timestamps: true }
);
 
export default mongoose.model("PaymentMethods", paymentMethodsSchema);
 