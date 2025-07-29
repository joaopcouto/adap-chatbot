import mongoose from "mongoose";

const reminderSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User', 
        required: true,
        index: true 
    },
    userPhoneNumber: {
        type: String,
        required: true,
    },
    description: {
        type: String,
        required: true
    },
    date: {
        type: Date,
        required: true
    },
    messageId: {
        type: String,
        required: true,
        unique: true
    },
});

export default mongoose.model("Reminder", reminderSchema);