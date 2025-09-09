import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock dependencies before importing
jest.mock('../../src/services/syncManager.js', () => ({
  default: {
    syncReminder: jest.fn()
  }
}));

jest.mock('../../src/helpers/logger.js', () => ({
  devLog: jest.fn()
}));

// Now import the modules
import reminderService from '../../src/services/reminderService.js';
import Reminder from '../../src/models/Reminder.js';
import ReminderSync from '../../src/models/ReminderSync.js';
import syncManager from '../../src/services/syncManager.js';

describe('ReminderService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('createReminder', () => {
    it('should create a reminder and initiate sync', async () => {
      // Arrange
      const reminderData = {
        description: 'Test reminder',
        date: new Date('2025-12-25T10:00:00Z')
      };
      const userId = '507f1f77bcf86cd799439011';
      const userPhoneNumber = '+1234567890';

      const mockReminderObject = {
        _id: 'reminder123',
        userId,
        userPhoneNumber,
        description: reminderData.description,
        date: reminderData.date,
        messageId: expect.any(String)
      };

      // Mock Reminder save and toObject
      jest.spyOn(Reminder.prototype, 'save').mockResolvedValue();
      jest.spyOn(Reminder.prototype, 'toObject').mockReturnValue(mockReminderObject);

      syncManager.syncReminder = jest.fn().mockResolvedValue({
        status: 'OK',
        googleEventId: 'event123',
        calendarId: 'calendar123'
      });

      // Act
      const result = await reminderService.createReminder(reminderData, userId, userPhoneNumber);

      // Assert
      expect(Reminder.prototype.save).toHaveBeenCalled();
      expect(result.reminder).toEqual(mockReminderObject);
      expect(result.syncInitiated).toBe(true);
      expect(result.correlationId).toBeDefined();

      // Sync should be called asynchronously
      await new Promise(resolve => setTimeout(resolve, 0)); // Let async operations complete
      expect(syncManager.syncReminder).toHaveBeenCalledWith(
        mockReminderObject,
        { _id: userId }
      );
    });

    it('should create reminder even if sync fails', async () => {
      // Arrange
      const reminderData = {
        description: 'Test reminder',
        date: new Date('2025-12-25T10:00:00Z')
      };
      const userId = '507f1f77bcf86cd799439011';
      const userPhoneNumber = '+1234567890';

      const mockReminderObject = {
        _id: 'reminder123',
        userId,
        userPhoneNumber,
        description: reminderData.description,
        date: reminderData.date,
        messageId: expect.any(String)
      };

      jest.spyOn(Reminder.prototype, 'save').mockResolvedValue();
      jest.spyOn(Reminder.prototype, 'toObject').mockReturnValue(mockReminderObject);

      syncManager.syncReminder = jest.fn().mockRejectedValue(new Error('Sync failed'));

      // Act
      const result = await reminderService.createReminder(reminderData, userId, userPhoneNumber);

      // Assert
      expect(Reminder.prototype.save).toHaveBeenCalled();
      expect(result.reminder).toEqual(mockReminderObject);
      expect(result.syncInitiated).toBe(true);
    });
  });

  describe('deleteReminder', () => {
    it('should delete reminder and cleanup sync record', async () => {
      // Arrange
      const messageId = 'abc12345';
      const userId = '507f1f77bcf86cd799439011';

      const mockReminder = {
        _id: 'reminder123',
        userId,
        messageId,
        description: 'Test reminder',
        toObject: () => ({
          _id: 'reminder123',
          userId,
          messageId,
          description: 'Test reminder'
        })
      };

      const mockSyncRecord = {
        _id: 'sync123',
        messageId,
        userId
      };

      jest.spyOn(Reminder, 'findOneAndDelete').mockResolvedValue(mockReminder);
      jest.spyOn(ReminderSync, 'findOneAndDelete').mockResolvedValue(mockSyncRecord);

      // Act
      const result = await reminderService.deleteReminder(messageId, userId);

      // Assert
      expect(Reminder.findOneAndDelete).toHaveBeenCalledWith({
        userId,
        messageId
      });
      expect(ReminderSync.findOneAndDelete).toHaveBeenCalledWith({
        messageId,
        userId
      });
      expect(result.found).toBe(true);
      expect(result.reminder).toEqual(mockReminder.toObject());
    });

    it('should return not found when reminder does not exist', async () => {
      // Arrange
      const messageId = 'nonexistent';
      const userId = '507f1f77bcf86cd799439011';

      jest.spyOn(Reminder, 'findOneAndDelete').mockResolvedValue(null);

      // Act
      const result = await reminderService.deleteReminder(messageId, userId);

      // Assert
      expect(result.found).toBe(false);
      expect(result.reminder).toBe(null);
      // ReminderSync.findOneAndDelete should not be called when reminder is not found
    });
  });

  describe('getReminderWithSyncStatus', () => {
    it('should return reminder with sync status', async () => {
      // Arrange
      const messageId = 'abc12345';

      const mockReminder = {
        _id: 'reminder123',
        messageId,
        description: 'Test reminder',
        toObject: () => ({
          _id: 'reminder123',
          messageId,
          description: 'Test reminder'
        })
      };

      const mockSyncRecord = {
        messageId,
        syncStatus: 'OK',
        googleEventId: 'event123',
        calendarId: 'calendar123',
        lastError: null,
        lastTriedAt: new Date(),
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      jest.spyOn(Reminder, 'findOne').mockResolvedValue(mockReminder);
      jest.spyOn(ReminderSync, 'findOne').mockResolvedValue(mockSyncRecord);

      // Act
      const result = await reminderService.getReminderWithSyncStatus(messageId);

      // Assert
      expect(Reminder.findOne).toHaveBeenCalledWith({ messageId });
      expect(ReminderSync.findOne).toHaveBeenCalledWith({ messageId });
      expect(result.reminder).toEqual(mockReminder.toObject());
      expect(result.syncStatus.status).toBe('OK');
      expect(result.syncStatus.googleEventId).toBe('event123');
    });

    it('should return reminder with no sync record status', async () => {
      // Arrange
      const messageId = 'abc12345';

      const mockReminder = {
        _id: 'reminder123',
        messageId,
        description: 'Test reminder',
        toObject: () => ({
          _id: 'reminder123',
          messageId,
          description: 'Test reminder'
        })
      };

      jest.spyOn(Reminder, 'findOne').mockResolvedValue(mockReminder);
      jest.spyOn(ReminderSync, 'findOne').mockResolvedValue(null);

      // Act
      const result = await reminderService.getReminderWithSyncStatus(messageId);

      // Assert
      expect(result.reminder).toEqual(mockReminder.toObject());
      expect(result.syncStatus.status).toBe('NO_SYNC_RECORD');
      expect(result.syncStatus.googleEventId).toBe(null);
    });

    it('should return null when reminder does not exist', async () => {
      // Arrange
      const messageId = 'nonexistent';

      jest.spyOn(Reminder, 'findOne').mockResolvedValue(null);

      // Act
      const result = await reminderService.getReminderWithSyncStatus(messageId);

      // Assert
      expect(result).toBe(null);
      // ReminderSync.findOne should not be called when reminder is not found
    });
  });

  describe('getRemindersWithSyncStatus', () => {
    it('should return reminders with sync statuses', async () => {
      // Arrange
      const userId = '507f1f77bcf86cd799439011';

      const mockReminders = [
        {
          _id: 'reminder1',
          messageId: 'msg1',
          description: 'Reminder 1',
          toObject: () => ({ _id: 'reminder1', messageId: 'msg1', description: 'Reminder 1' })
        },
        {
          _id: 'reminder2',
          messageId: 'msg2',
          description: 'Reminder 2',
          toObject: () => ({ _id: 'reminder2', messageId: 'msg2', description: 'Reminder 2' })
        }
      ];

      const mockSyncRecords = [
        {
          messageId: 'msg1',
          syncStatus: 'OK',
          googleEventId: 'event1',
          calendarId: 'calendar1',
          lastError: null,
          lastTriedAt: new Date(),
          retryCount: 0,
          maxRetries: 3,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      // Mock Reminder.find with chaining
      const mockFind = {
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        skip: jest.fn().mockResolvedValue(mockReminders)
      };
      jest.spyOn(Reminder, 'find').mockReturnValue(mockFind);
      jest.spyOn(ReminderSync, 'find').mockResolvedValue(mockSyncRecords);

      // Act
      const result = await reminderService.getRemindersWithSyncStatus(userId);

      // Assert
      expect(Reminder.find).toHaveBeenCalledWith({ userId });
      expect(ReminderSync.find).toHaveBeenCalledWith({
        messageId: { $in: ['msg1', 'msg2'] },
        userId
      });
      expect(result).toHaveLength(2);
      expect(result[0].syncStatus.status).toBe('OK');
      expect(result[1].syncStatus.status).toBe('NO_SYNC_RECORD');
    });

    it('should return empty array when no reminders found', async () => {
      // Arrange
      const userId = '507f1f77bcf86cd799439011';

      const mockFind = {
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        skip: jest.fn().mockResolvedValue([])
      };
      jest.spyOn(Reminder, 'find').mockReturnValue(mockFind);

      // Act
      const result = await reminderService.getRemindersWithSyncStatus(userId);

      // Assert
      expect(result).toEqual([]);
      // ReminderSync.find should not be called when no reminders found
    });
  });
});