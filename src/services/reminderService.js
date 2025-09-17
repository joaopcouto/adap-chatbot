import Reminder from '../models/Reminder.js';
import ReminderSync from '../models/ReminderSync.js';
import syncManager from './syncManager.js';
import { devLog } from '../helpers/logger.js';
import { structuredLogger, generateCorrelationId } from '../helpers/logger.js';
import { customAlphabet } from 'nanoid';

class ReminderService {
  constructor() {
    this.generateId = customAlphabet("1234567890abcdef", 8);
  }

  /**
   * Create a new reminder with optional Google Calendar sync
   * @param {Object} reminderData - Reminder data (description, date)
   * @param {string} userId - User ID (ObjectId)
   * @param {string} userPhoneNumber - User's phone number
   * @param {string} correlationId - Optional correlation ID for tracking
   * @returns {Promise<Object>} Created reminder with sync status
   */
  async createReminder(reminderData, userId, userPhoneNumber, correlationId = null) {
    const cId = correlationId || generateCorrelationId();
    
    structuredLogger.info('Creating reminder', {
      correlationId: cId,
      userId,
      description: reminderData.description?.substring(0, 50) + '...',
      date: reminderData.date,
      phoneNumber: this._maskPhoneNumber(userPhoneNumber)
    });

    try {
      // Generate unique message ID
      const messageId = this.generateId();

      // Create reminder object
      const newReminder = new Reminder({
        userId: userId,
        description: reminderData.description,
        date: reminderData.date,
        messageId: messageId,
      });

      // Save reminder to MongoDB first (local-first approach)
      await newReminder.save();
      
      structuredLogger.info('Reminder saved to MongoDB', {
        correlationId: cId,
        messageId,
        userId,
        reminderId: newReminder._id
      });

      // Prepare user object for sync manager (it expects an object with _id)
      const user = { _id: userId };

      // Attempt Google Calendar sync asynchronously (non-blocking)
      // This will create a ReminderSync record and attempt sync
      const syncPromise = syncManager.syncReminder(newReminder.toObject(), user, cId)
        .then(syncResult => {
          structuredLogger.info('Sync operation completed', {
            correlationId: cId,
            messageId,
            status: syncResult.status,
            googleEventId: syncResult.googleEventId,
            error: syncResult.error
          });
          return syncResult;
        })
        .catch(syncError => {
          structuredLogger.error('Sync operation failed', {
            correlationId: cId,
            messageId,
            error: syncError
          });
          return {
            status: 'FAILED',
            error: syncError.message
          };
        });

      // Don't await the sync - let it happen in the background
      // This ensures reminder creation is not blocked by Google Calendar issues
      syncPromise.catch(() => {
        // Errors are already logged above, this just prevents unhandled promise rejection
      });

      structuredLogger.info('Reminder creation completed', {
        correlationId: cId,
        messageId,
        userId,
        syncInitiated: true
      });

      // Return the created reminder immediately
      return {
        reminder: newReminder.toObject(),
        syncInitiated: true,
        correlationId: cId
      };

    } catch (error) {
      structuredLogger.error('Error creating reminder', {
        correlationId: cId,
        userId,
        error
      });
      throw error;
    }
  }

  /**
   * Delete a reminder and clean up sync records
   * @param {string} messageId - Reminder message ID
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Deletion result
   */
  async deleteReminder(messageId, userId) {
    const correlationId = this._generateCorrelationId();
    
    devLog(`[ReminderService] Deleting reminder ${messageId} for user ${userId} - ${correlationId}`);

    try {
      // Find and delete the reminder
      const reminder = await Reminder.findOneAndDelete({
        userId: userId,
        messageId: messageId
      });

      if (!reminder) {
        devLog(`[ReminderService] Reminder ${messageId} not found for user ${userId} - ${correlationId}`);
        return {
          found: false,
          reminder: null
        };
      }

      // Clean up sync record if it exists
      try {
        const syncRecord = await ReminderSync.findOneAndDelete({
          messageId: messageId,
          userId: userId
        });

        if (syncRecord) {
          devLog(`[ReminderService] Cleaned up sync record for reminder ${messageId} - ${correlationId}`);
        }
      } catch (syncError) {
        devLog(`[ReminderService] Error cleaning up sync record for ${messageId} - ${correlationId}:`, syncError);
        // Don't fail the deletion if sync cleanup fails
      }

      devLog(`[ReminderService] Successfully deleted reminder ${messageId} - ${correlationId}`);

      return {
        found: true,
        reminder: reminder.toObject()
      };

    } catch (error) {
      devLog(`[ReminderService] Error deleting reminder ${messageId} - ${correlationId}:`, error);
      throw error;
    }
  }

  /**
   * Get reminder with its sync status
   * @param {string} messageId - Reminder message ID
   * @returns {Promise<Object|null>} Reminder with sync status or null if not found
   */
  async getReminderWithSyncStatus(messageId) {
    const correlationId = this._generateCorrelationId();
    
    devLog(`[ReminderService] Getting reminder with sync status for ${messageId} - ${correlationId}`);

    try {
      // Get the reminder
      const reminder = await Reminder.findOne({ messageId });
      
      if (!reminder) {
        devLog(`[ReminderService] Reminder ${messageId} not found - ${correlationId}`);
        return null;
      }

      // Get sync status
      const syncRecord = await ReminderSync.findOne({ messageId });

      const result = {
        reminder: reminder.toObject(),
        syncStatus: syncRecord ? {
          status: syncRecord.syncStatus,
          googleEventId: syncRecord.googleEventId,
          calendarId: syncRecord.calendarId,
          lastError: syncRecord.lastError,
          lastTriedAt: syncRecord.lastTriedAt,
          retryCount: syncRecord.retryCount,
          maxRetries: syncRecord.maxRetries,
          createdAt: syncRecord.createdAt,
          updatedAt: syncRecord.updatedAt
        } : {
          status: 'NO_SYNC_RECORD',
          googleEventId: null,
          calendarId: null,
          lastError: null,
          lastTriedAt: null,
          retryCount: 0,
          maxRetries: 0,
          createdAt: null,
          updatedAt: null
        }
      };

      devLog(`[ReminderService] Retrieved reminder ${messageId} with sync status ${result.syncStatus.status} - ${correlationId}`);

      return result;

    } catch (error) {
      devLog(`[ReminderService] Error getting reminder with sync status for ${messageId} - ${correlationId}:`, error);
      throw error;
    }
  }

  /**
   * Get all reminders for a user with their sync statuses
   * @param {string} userId - User ID
   * @param {Object} options - Query options (limit, skip, etc.)
   * @returns {Promise<Array>} Array of reminders with sync statuses
   */
  async getRemindersWithSyncStatus(userId, options = {}) {
    const correlationId = this._generateCorrelationId();
    
    devLog(`[ReminderService] Getting reminders with sync status for user ${userId} - ${correlationId}`);

    try {
      const { limit = 50, skip = 0, sortBy = 'date', sortOrder = 'asc' } = options;

      // Get reminders for the user
      const reminders = await Reminder.find({ userId })
        .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
        .limit(limit)
        .skip(skip);

      if (reminders.length === 0) {
        devLog(`[ReminderService] No reminders found for user ${userId} - ${correlationId}`);
        return [];
      }

      // Get sync records for all reminders
      const messageIds = reminders.map(r => r.messageId);
      const syncRecords = await ReminderSync.find({ 
        messageId: { $in: messageIds },
        userId: userId 
      });

      // Create a map for quick lookup
      const syncMap = new Map();
      syncRecords.forEach(sync => {
        syncMap.set(sync.messageId, sync);
      });

      // Combine reminders with sync status
      const results = reminders.map(reminder => {
        const syncRecord = syncMap.get(reminder.messageId);
        
        return {
          reminder: reminder.toObject(),
          syncStatus: syncRecord ? {
            status: syncRecord.syncStatus,
            googleEventId: syncRecord.googleEventId,
            calendarId: syncRecord.calendarId,
            lastError: syncRecord.lastError,
            lastTriedAt: syncRecord.lastTriedAt,
            retryCount: syncRecord.retryCount,
            maxRetries: syncRecord.maxRetries,
            createdAt: syncRecord.createdAt,
            updatedAt: syncRecord.updatedAt
          } : {
            status: 'NO_SYNC_RECORD',
            googleEventId: null,
            calendarId: null,
            lastError: null,
            lastTriedAt: null,
            retryCount: 0,
            maxRetries: 0,
            createdAt: null,
            updatedAt: null
          }
        };
      });

      devLog(`[ReminderService] Retrieved ${results.length} reminders with sync status for user ${userId} - ${correlationId}`);

      return results;

    } catch (error) {
      devLog(`[ReminderService] Error getting reminders with sync status for user ${userId} - ${correlationId}:`, error);
      throw error;
    }
  }

  /**
   * Generate correlation ID for request tracking
   * @returns {string} Correlation ID
   */
  _generateCorrelationId() {
    return generateCorrelationId();
  }

  /**
   * Mask phone number for logging (privacy protection)
   * @param {string} phoneNumber - Phone number to mask
   * @returns {string} Masked phone number
   */
  _maskPhoneNumber(phoneNumber) {
    if (!phoneNumber || phoneNumber.length < 4) {
      return '***';
    }
    
    const start = phoneNumber.substring(0, 2);
    const end = phoneNumber.substring(phoneNumber.length - 2);
    const middle = '*'.repeat(phoneNumber.length - 4);
    
    return `${start}${middle}${end}`;
  }
}

export default new ReminderService();