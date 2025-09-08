import mongoose from "mongoose";

const reminderSyncSchema = new mongoose.Schema({
    messageId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    googleEventId: {
        type: String,
        default: null
    },
    calendarId: {
        type: String,
        default: null
    },
    syncStatus: {
        type: String,
        enum: ['QUEUED', 'OK', 'FAILED'],
        default: 'QUEUED',
        required: true,
        index: true
    },
    lastError: {
        type: String,
        default: null
    },
    lastTriedAt: {
        type: Date,
        default: null
    },
    retryCount: {
        type: Number,
        default: 0,
        min: 0
    },
    maxRetries: {
        type: Number,
        default: 3,
        min: 0
    }
}, {
    timestamps: true // Creates createdAt and updatedAt automatically
});

// Compound index for efficient queries on user's sync records
reminderSyncSchema.index({ userId: 1, syncStatus: 1 });

// Index for retry queue processing
reminderSyncSchema.index({ syncStatus: 1, lastTriedAt: 1 });

export default mongoose.model("ReminderSync", reminderSyncSchema);