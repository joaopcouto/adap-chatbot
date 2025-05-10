import mongoose from "mongoose";

const reminderSchema = new mongoose.Schema({
    userId: String,
    description: String,
    date: Date,
});

export default mongoose.model("Reminder", reminderSchema);