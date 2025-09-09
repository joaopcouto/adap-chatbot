import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import mongoose from 'mongoose';

// Mock the dependencies before importing
const mockGoogleCalendarService = {
  createEvent: jest.fn(),
  updateEvent: jest.fn(),
  searchEventByAppId: jest.fn()
};

jest.mock('../../src/services/googleCalendarService.js', () => ({
  default: mockGoogleCalendarService
}));

jest.mock('../../src/helpers/logger.js', () => ({
  devLog: jest.fn()
}));

// Now import the modules
import SyncManager from '../../src/services/syncManager.js';
import ReminderSync from '../../src/models/ReminderSync.js';
import UserGoogleIntegration from '../../src/models/UserGoogleIntegration.js';

describe('SyncManager', () => {
  let mockUser;
  let mockReminder;
  let mockUserIntegration;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockUser = {
      _id: new mongoose.Types.ObjectId()
    };
    
    mockReminder = {
      messageId: 'test-message-123',
      description: 'Test reminder',
      date: new Date('2024-01-15T10:00:00Z')
    };
    
    mockUserIntegration = {
      userId: mockUser._id,
      connected: true,
      calendarSyncEnabled: true,
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      calendarId: 'primary',
      timezone: 'America/Sao_Paulo'
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('syncReminder', () => {
    it('should skip sync when user integration is not enabled', async () => {
      // Mock UserGoogleIntegration.findOne to return null
      jest.spyOn(UserGoogleIntegration, 'findOne').mockResolvedValue(null);
      
      // Mock ReminderSync creation
      const mockReminderSync = { _id: 'sync-id-123' };
      jest.spyOn(ReminderSync.prototype, 'save').mockResolvedValue(mockReminderSync);
      jest.spyOn(ReminderSync, 'findOne').mockResolvedValue(null);

      const result = await SyncManager.syncReminder(mockReminder, mockUser);

      expect(result.status).toBe('SKIPPED');
      expect(result.reason).toBe('Google Calendar integration not enabled');
      expect(UserGoogleIntegration.findOne).toHaveBeenCalledWith({ userId: mockUser._id });
    });

    it('should create ReminderSync record with QUEUED status', async () => {
      // Mock UserGoogleIntegration
      jest.spyOn(UserGoogleIntegration, 'findOne').mockResolvedValue(mockUserIntegration);
      
      // Mock ReminderSync creation
      const mockReminderSync = { _id: 'sync-id-123' };
      jest.spyOn(ReminderSync, 'findOne').mockResolvedValue(null);
      jest.spyOn(ReminderSync.prototype, 'save').mockResolvedValue(mockReminderSync);
      
      // Mock Google Calendar service
      mockGoogleCalendarService.searchEventByAppId.mockResolvedValue(null);
      mockGoogleCalendarService.createEvent.mockResolvedValue({
        eventId: 'google-event-123',
        calendarId: 'primary'
      });
      
      // Mock ReminderSync update
      jest.spyOn(ReminderSync, 'findByIdAndUpdate').mockResolvedValue({});

      const result = await SyncManager.syncReminder(mockReminder, mockUser);

      expect(result.status).toBe('OK');
      expect(result.googleEventId).toBe('google-event-123');
      expect(ReminderSync.prototype.save).toHaveBeenCalled();
    });

    it('should update existing event instead of creating duplicate', async () => {
      // Mock UserGoogleIntegration
      jest.spyOn(UserGoogleIntegration, 'findOne').mockResolvedValue(mockUserIntegration);
      
      // Mock ReminderSync creation
      const mockReminderSync = { _id: 'sync-id-123' };
      jest.spyOn(ReminderSync, 'findOne').mockResolvedValue(null);
      jest.spyOn(ReminderSync.prototype, 'save').mockResolvedValue(mockReminderSync);
      
      // Mock existing event found
      const existingEvent = {
        eventId: 'existing-event-123',
        calendarId: 'primary'
      };
      mockGoogleCalendarService.searchEventByAppId.mockResolvedValue(existingEvent);
      mockGoogleCalendarService.updateEvent.mockResolvedValue({
        eventId: 'existing-event-123',
        calendarId: 'primary'
      });
      
      // Mock ReminderSync update
      jest.spyOn(ReminderSync, 'findByIdAndUpdate').mockResolvedValue({});

      const result = await SyncManager.syncReminder(mockReminder, mockUser);

      expect(result.status).toBe('OK');
      expect(mockGoogleCalendarService.updateEvent).toHaveBeenCalledWith(
        'existing-event-123',
        mockUserIntegration,
        mockReminder
      );
      expect(mockGoogleCalendarService.createEvent).not.toHaveBeenCalled();
    });

    it('should handle Google Calendar API errors gracefully', async () => {
      // Mock UserGoogleIntegration
      jest.spyOn(UserGoogleIntegration, 'findOne').mockResolvedValue(mockUserIntegration);
      
      // Mock ReminderSync creation
      const mockReminderSync = { _id: 'sync-id-123' };
      jest.spyOn(ReminderSync, 'findOne').mockResolvedValue(null);
      jest.spyOn(ReminderSync.prototype, 'save').mockResolvedValue(mockReminderSync);
      
      // Mock Google Calendar service error
      const apiError = new Error('API Error');
      apiError.type = 'SERVER_ERROR';
      apiError.retryable = true;
      mockGoogleCalendarService.searchEventByAppId.mockRejectedValue(apiError);
      
      // Mock ReminderSync update
      jest.spyOn(ReminderSync, 'findByIdAndUpdate').mockResolvedValue({});

      const result = await SyncManager.syncReminder(mockReminder, mockUser);

      expect(result.status).toBe('FAILED');
      expect(result.error).toBe('API Error');
      expect(ReminderSync.findByIdAndUpdate).toHaveBeenCalledWith(
        mockReminderSync._id,
        expect.objectContaining({
          lastError: 'API Error',
          lastTriedAt: expect.any(Date)
        })
      );
    });
  });

  describe('_shouldSync', () => {
    it('should return true when all conditions are met', () => {
      const result = SyncManager._shouldSync(mockUserIntegration);
      expect(result).toBe(true);
    });

    it('should return false when user integration is null', () => {
      const result = SyncManager._shouldSync(null);
      expect(result).toBe(false);
    });

    it('should return false when not connected', () => {
      mockUserIntegration.connected = false;
      const result = SyncManager._shouldSync(mockUserIntegration);
      expect(result).toBe(false);
    });

    it('should return false when calendar sync is disabled', () => {
      mockUserIntegration.calendarSyncEnabled = false;
      const result = SyncManager._shouldSync(mockUserIntegration);
      expect(result).toBe(false);
    });

    it('should return false when missing tokens', () => {
      mockUserIntegration.accessToken = null;
      const result = SyncManager._shouldSync(mockUserIntegration);
      expect(result).toBe(false);
    });
  });

  describe('_classifyError', () => {
    it('should classify auth errors correctly', () => {
      const authError = new Error('Unauthorized');
      authError.status = 401;
      
      const classification = SyncManager._classifyError(authError);
      
      expect(classification.type).toBe('AUTH_ERROR');
      expect(classification.retryable).toBe(false);
    });

    it('should classify rate limit errors correctly', () => {
      const rateLimitError = new Error('Too Many Requests');
      rateLimitError.status = 429;
      
      const classification = SyncManager._classifyError(rateLimitError);
      
      expect(classification.type).toBe('RATE_LIMIT');
      expect(classification.retryable).toBe(true);
    });

    it('should classify server errors correctly', () => {
      const serverError = new Error('Internal Server Error');
      serverError.status = 500;
      
      const classification = SyncManager._classifyError(serverError);
      
      expect(classification.type).toBe('SERVER_ERROR');
      expect(classification.retryable).toBe(true);
    });

    it('should use error type when available', () => {
      const typedError = new Error('Custom error');
      typedError.type = 'CUSTOM_ERROR';
      typedError.retryable = true;
      typedError.requiresReconnection = false;
      
      const classification = SyncManager._classifyError(typedError);
      
      expect(classification.type).toBe('CUSTOM_ERROR');
      expect(classification.retryable).toBe(true);
      expect(classification.requiresReconnection).toBe(false);
    });
  });

  describe('_calculateRetryDelay', () => {
    it('should calculate exponential backoff correctly', () => {
      const delay0 = SyncManager._calculateRetryDelay(0);
      const delay1 = SyncManager._calculateRetryDelay(1);
      const delay2 = SyncManager._calculateRetryDelay(2);
      
      // Should increase exponentially (with some jitter)
      expect(delay1).toBeGreaterThan(delay0);
      expect(delay2).toBeGreaterThan(delay1);
      
      // Should not exceed max delay
      const delayMax = SyncManager._calculateRetryDelay(10);
      expect(delayMax).toBeLessThanOrEqual(30000 * 1.1); // Max delay + max jitter
    });
  });

  describe('retryFailedSync', () => {
    let mockReminderSync;

    beforeEach(() => {
      mockReminderSync = {
        _id: new mongoose.Types.ObjectId(),
        messageId: 'test-message-123',
        userId: mockUser._id,
        retryCount: 0,
        maxRetries: 3,
        lastTriedAt: new Date(Date.now() - 5000) // 5 seconds ago
      };
    });

    it('should successfully retry a failed sync', async () => {
      // Mock UserGoogleIntegration
      jest.spyOn(UserGoogleIntegration, 'findOne').mockResolvedValue(mockUserIntegration);
      
      // Mock ReminderSync updates
      jest.spyOn(ReminderSync, 'findByIdAndUpdate').mockResolvedValue({});
      
      // Mock Google Calendar service success
      mockGoogleCalendarService.searchEventByAppId.mockResolvedValue(null);
      mockGoogleCalendarService.createEvent.mockResolvedValue({
        eventId: 'google-event-123',
        calendarId: 'primary'
      });

      const result = await SyncManager.retryFailedSync(mockReminderSync);

      expect(result.status).toBe('OK');
      expect(result.googleEventId).toBe('google-event-123');
      expect(ReminderSync.findByIdAndUpdate).toHaveBeenCalledWith(
        mockReminderSync._id,
        expect.objectContaining({
          $inc: { retryCount: 1 },
          lastTriedAt: expect.any(Date)
        })
      );
    });

    it('should fail when max retries exceeded', async () => {
      mockReminderSync.retryCount = 3; // At max retries
      
      jest.spyOn(ReminderSync, 'findByIdAndUpdate').mockResolvedValue({});

      const result = await SyncManager.retryFailedSync(mockReminderSync);

      expect(result.status).toBe('FAILED');
      expect(result.reason).toBe('Max retries exceeded');
      expect(ReminderSync.findByIdAndUpdate).toHaveBeenCalledWith(
        mockReminderSync._id,
        expect.objectContaining({
          syncStatus: 'FAILED',
          lastError: 'Max retries exceeded'
        })
      );
    });

    it('should delay retry if not enough time has passed', async () => {
      mockReminderSync.lastTriedAt = new Date(); // Just tried
      
      const result = await SyncManager.retryFailedSync(mockReminderSync);

      expect(result.status).toBe('DELAYED');
      expect(result.retryAfter).toBeGreaterThan(0);
    }, 10000);

    it('should fail when integration is disabled', async () => {
      // Mock disabled integration
      const disabledIntegration = { ...mockUserIntegration, connected: false };
      jest.spyOn(UserGoogleIntegration, 'findOne').mockResolvedValue(disabledIntegration);
      jest.spyOn(ReminderSync, 'findByIdAndUpdate').mockResolvedValue({});

      const result = await SyncManager.retryFailedSync(mockReminderSync);

      expect(result.status).toBe('FAILED');
      expect(result.reason).toBe('Integration disabled');
      expect(ReminderSync.findByIdAndUpdate).toHaveBeenCalledWith(
        mockReminderSync._id,
        expect.objectContaining({
          syncStatus: 'FAILED',
          lastError: 'Google Calendar integration disabled'
        })
      );
    });

    it('should handle errors during retry', async () => {
      // Mock UserGoogleIntegration
      jest.spyOn(UserGoogleIntegration, 'findOne').mockResolvedValue(mockUserIntegration);
      
      // Mock ReminderSync update for retry count
      jest.spyOn(ReminderSync, 'findByIdAndUpdate').mockResolvedValue({});
      
      // Mock Google Calendar service error
      const apiError = new Error('API Error during retry');
      apiError.type = 'SERVER_ERROR';
      apiError.retryable = true;
      mockGoogleCalendarService.searchEventByAppId.mockRejectedValue(apiError);

      const result = await SyncManager.retryFailedSync(mockReminderSync);

      expect(result.status).toBe('FAILED');
      expect(result.error).toBe('API Error during retry');
    });
  });

  describe('processRetryQueue', () => {
    it('should process failed syncs ready for retry', async () => {
      const mockFailedSyncs = [
        {
          _id: new mongoose.Types.ObjectId(),
          messageId: 'msg-1',
          userId: mockUser._id,
          retryCount: 1,
          maxRetries: 3,
          lastTriedAt: new Date(Date.now() - 10000) // 10 seconds ago
        },
        {
          _id: new mongoose.Types.ObjectId(),
          messageId: 'msg-2',
          userId: mockUser._id,
          retryCount: 0,
          maxRetries: 3,
          lastTriedAt: new Date(Date.now() - 5000) // 5 seconds ago
        }
      ];

      // Mock ReminderSync.find to return failed syncs
      jest.spyOn(ReminderSync, 'find').mockReturnValue({
        limit: jest.fn().mockResolvedValue(mockFailedSyncs)
      });

      // Mock UserGoogleIntegration
      jest.spyOn(UserGoogleIntegration, 'findOne').mockResolvedValue(mockUserIntegration);
      
      // Mock ReminderSync updates
      jest.spyOn(ReminderSync, 'findByIdAndUpdate').mockResolvedValue({});
      
      // Mock Google Calendar service success
      mockGoogleCalendarService.searchEventByAppId.mockResolvedValue(null);
      mockGoogleCalendarService.createEvent.mockResolvedValue({
        eventId: 'google-event-123',
        calendarId: 'primary'
      });

      const result = await SyncManager.processRetryQueue();

      expect(result.processed).toBe(2);
      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.delayed).toBe(0);
      expect(ReminderSync.find).toHaveBeenCalledWith({
        syncStatus: 'FAILED',
        retryCount: { $lt: 3 },
        $or: [
          { lastTriedAt: null },
          { lastTriedAt: { $lt: expect.any(Date) } }
        ]
      });
    });

    it('should handle mixed results when processing queue', async () => {
      const mockFailedSyncs = [
        {
          _id: new mongoose.Types.ObjectId(),
          messageId: 'msg-1',
          userId: mockUser._id,
          retryCount: 1,
          maxRetries: 3,
          lastTriedAt: new Date(Date.now() - 10000)
        },
        {
          _id: new mongoose.Types.ObjectId(),
          messageId: 'msg-2',
          userId: mockUser._id,
          retryCount: 0,
          maxRetries: 3,
          lastTriedAt: new Date() // Just tried - should be delayed
        }
      ];

      jest.spyOn(ReminderSync, 'find').mockReturnValue({
        limit: jest.fn().mockResolvedValue(mockFailedSyncs)
      });

      // Mock first retry succeeds, second is delayed
      jest.spyOn(UserGoogleIntegration, 'findOne').mockResolvedValue(mockUserIntegration);
      jest.spyOn(ReminderSync, 'findByIdAndUpdate').mockResolvedValue({});
      mockGoogleCalendarService.searchEventByAppId.mockResolvedValue(null);
      mockGoogleCalendarService.createEvent.mockResolvedValue({
        eventId: 'google-event-123',
        calendarId: 'primary'
      });

      const result = await SyncManager.processRetryQueue();

      expect(result.processed).toBe(2);
      expect(result.succeeded).toBe(1);
      expect(result.delayed).toBe(1);
      expect(result.failed).toBe(0);
    });

    it('should handle errors during queue processing', async () => {
      const mockFailedSyncs = [
        {
          _id: new mongoose.Types.ObjectId(),
          messageId: 'msg-1',
          userId: mockUser._id,
          retryCount: 1,
          maxRetries: 3,
          lastTriedAt: new Date(Date.now() - 10000)
        }
      ];

      jest.spyOn(ReminderSync, 'find').mockReturnValue({
        limit: jest.fn().mockResolvedValue(mockFailedSyncs)
      });

      // Mock error during retry
      jest.spyOn(UserGoogleIntegration, 'findOne').mockRejectedValue(new Error('Database error'));

      const result = await SyncManager.processRetryQueue();

      expect(result.processed).toBe(1);
      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.delayed).toBe(0);
    });

    it('should handle empty retry queue', async () => {
      jest.spyOn(ReminderSync, 'find').mockReturnValue({
        limit: jest.fn().mockResolvedValue([])
      });

      const result = await SyncManager.processRetryQueue();

      expect(result.processed).toBe(0);
      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.delayed).toBe(0);
    });
  });

  describe('_handleSyncFailure', () => {
    let mockReminderSync;

    beforeEach(() => {
      mockReminderSync = {
        _id: new mongoose.Types.ObjectId(),
        messageId: 'test-message-123',
        userId: mockUser._id
      };
    });

    it('should handle retryable errors correctly', async () => {
      const retryableError = new Error('Server Error');
      retryableError.type = 'SERVER_ERROR';
      retryableError.retryable = true;
      
      jest.spyOn(ReminderSync, 'findByIdAndUpdate').mockResolvedValue({});

      await SyncManager._handleSyncFailure(mockReminderSync, retryableError, 'test-correlation-id');

      expect(ReminderSync.findByIdAndUpdate).toHaveBeenCalledWith(
        mockReminderSync._id,
        expect.objectContaining({
          lastError: 'Server Error',
          lastTriedAt: expect.any(Date)
        })
      );
      // Should not set syncStatus to FAILED for retryable errors
      expect(ReminderSync.findByIdAndUpdate).not.toHaveBeenCalledWith(
        mockReminderSync._id,
        expect.objectContaining({
          syncStatus: 'FAILED'
        })
      );
    });

    it('should handle non-retryable errors correctly', async () => {
      const nonRetryableError = new Error('Bad Request');
      nonRetryableError.type = 'CLIENT_ERROR';
      nonRetryableError.retryable = false;
      
      jest.spyOn(ReminderSync, 'findByIdAndUpdate').mockResolvedValue({});

      await SyncManager._handleSyncFailure(mockReminderSync, nonRetryableError, 'test-correlation-id');

      expect(ReminderSync.findByIdAndUpdate).toHaveBeenCalledWith(
        mockReminderSync._id,
        expect.objectContaining({
          syncStatus: 'FAILED',
          lastError: 'Bad Request',
          lastTriedAt: expect.any(Date)
        })
      );
    });

    it('should disable user integration for reconnection-required errors', async () => {
      const authError = new Error('Token revoked');
      authError.type = 'AUTH_ERROR';
      authError.retryable = false;
      authError.requiresReconnection = true;
      
      jest.spyOn(ReminderSync, 'findByIdAndUpdate').mockResolvedValue({});
      jest.spyOn(UserGoogleIntegration, 'findOneAndUpdate').mockResolvedValue({});

      await SyncManager._handleSyncFailure(mockReminderSync, authError, 'test-correlation-id');

      expect(UserGoogleIntegration.findOneAndUpdate).toHaveBeenCalledWith(
        { userId: mockReminderSync.userId },
        {
          connected: false,
          calendarSyncEnabled: false
        }
      );
      expect(ReminderSync.findByIdAndUpdate).toHaveBeenCalledWith(
        mockReminderSync._id,
        expect.objectContaining({
          syncStatus: 'FAILED'
        })
      );
    });

    it('should handle database update errors gracefully', async () => {
      const syncError = new Error('Sync failed');
      jest.spyOn(ReminderSync, 'findByIdAndUpdate').mockRejectedValue(new Error('DB Error'));

      // Should not throw error
      await expect(SyncManager._handleSyncFailure(mockReminderSync, syncError, 'test-correlation-id'))
        .resolves.not.toThrow();
    });
  });
});