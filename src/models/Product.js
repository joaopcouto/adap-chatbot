import mongoose from "mongoose";

const productSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryTemplate', required: true },
  customId: { type: String, required: true }, // ID curto gerenciado manualmente
  attributes: { type: Map, of: String, required: true },
  quantity: { type: Number, default: 0 },
  minStockLevel: { type: Number, default: 1 },
}, { timestamps: true });

// Garante que um usuário não pode ter produtos com o mesmo ID customizado
productSchema.index({ userId: 1, customId: 1 }, { unique: true });

export default mongoose.model("Product", productSchema);