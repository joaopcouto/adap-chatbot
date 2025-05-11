import mongoose from "mongoose";

const reminderSchema = new mongoose.Schema({
    userId: String,
    description: String,
    date: Date,
    messageId: String,
});

export default mongoose.model("Reminder", reminderSchema);