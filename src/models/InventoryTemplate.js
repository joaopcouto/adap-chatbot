import mongoose from "mongoose";

const inventoryTemplateSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  templateName: { type: String, required: true },
  fields: { type: [String], required: true },
}, { timestamps: true });

inventoryTemplateSchema.index({ userId: 1, templateName: 1 }, { unique: true });

export default mongoose.model("InventoryTemplate", inventoryTemplateSchema);