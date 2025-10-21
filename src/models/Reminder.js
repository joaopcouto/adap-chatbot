import mongoose from "mongoose";

const reminderSchema = new mongoose.Schema({
    userId: {
        type: String, 
        required: true,
        index: true 
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
    status: {          
        type: String,
        default: 'pending'
    },
    earlyReminderDate: { 
        type: Date,
        required: false 
    }
}, { timestamps: true }); 

export default mongoose.model("Reminder", reminderSchema);