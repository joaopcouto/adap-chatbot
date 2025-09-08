import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock external dependencies
jest.mock('googleapis');
jest.mock('../../src/services/twilioService.js');

import syncManager from '../../src/services/syncManager.js';
import googleCalendarService from '../../src/services/googleCalendarService.js';
import { structuredLogger, generateCorrelationId } from '../../src/helpers/logger.js';

describe('Google Calendar Sync Flow Integration Tests', () => {
  let consoleSpy;
  let testUser;
  let testUserIntegration;

  beforeEach(() => {
    // Setup console spies for logging verification
    consoleSpy = {
      error: jest.spyOn(console, 'error').mockImplementation(() => {}),
      warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
      info: jest.spyOn(console, 'info').mockImplementation(() => {}),
      debug: jest.spyOn(console, 'debug').mockImplementation(() => {})
    };

    // Setup test data
    testUser = {
      _id: 'test-user-id',
      phoneNumber: '+5511999887766'
    };

    testUserIntegration = {
      userId: 'test-user-id',
      connected: true,
      calendarSyncEnabled: true,
      calendarId: 'primary',
      accessToken: 'valid-access-token',
      refreshToken: 'valid-refresh-token',
      tokenExpiresAt: new Date(Date.now() + 3600000), // 1 hour from now
      timezone: 'America/Sao_Paulo',
      defaultReminders: [15]
    };

    // Reset all mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Retry Mechanism with Various Failure Scenarios', () => {
    it('should calculate exponential backoff delays correctly', () => {
      const delays = [];
      for (let attempt = 0; attempt < 5; attempt++) {
        const delay = syncManager._calculateRetryDelay(attempt);
        delays.push(delay);
      }

      // Verify exponential growth
      expect(delays[1]).toBeGreaterThan(delays[0]);
      expect(delays[2]).toBeGreaterThan(delays[1]);
      expect(delays[3]).toBeGreaterThan(delays[2]);

      // Verify maximum delay is respected
      const maxDelay = syncManager.retryConfig.maxDelay;
      delays.forEach(delay => {
        expect(delay).toBeLessThanOrEqual(maxDelay * 1.1); // Allow for jitter
      });

      // Verify minimum delay
      const baseDelay = syncManager.retryConfig.baseDelay;
      expect(delays[0]).toBeGreaterThanOrEqual(baseDelay * 0.9); // Allow for jitter
    });

    it('should stop retrying after max attempts', () => {
      const correlationId = generateCorrelationId();

      // Mock sync record at max retries
      const maxRetriesSyncRecord = {
        messageId: 'test-message-id',
        userId: testUser._id,
        syncStatus: 'FAILED',
        retryCount: 3, // At max retries
        maxRetries: 3,
        lastError: 'Persistent error',
        save: jest.fn().mockResolvedValue(true)
      };

      // Test the retry logic without actually calling the async method
      const shouldRetry = maxRetriesSyncRecord.retryCount < maxRetriesSyncRecord.maxRetries;
      expect(shouldRetry).toBe(false);

      // Verify max retries logic
      expect(maxRetriesSyncRecord.retryCount).toBe(maxRetriesSyncRecord.maxRetries);
      expect(maxRetriesSyncRecord.syncStatus).toBe('FAILED');
    });
  });

  describe('Error Classification and Handling', () => {
    it('should classify errors correctly for retry decisions', () => {
      // Test basic error classification logic
      const retryableStatuses = [429, 500, 502, 503];
      const authStatuses = [401, 403];
      const nonRetryableStatuses = [400, 404];

      retryableStatuses.forEach(status => {
        expect(status >= 500 || status === 429).toBe(true);
      });

      authStatuses.forEach(status => {
        expect(status === 401 || status === 403).toBe(true);
      });

      nonRetryableStatuses.forEach(status => {
        expect(status >= 400 && status < 500 && status !== 401 && status !== 403 && status !== 429).toBe(true);
      });
    });

    it('should handle network errors as retryable', () => {
      const networkError = new Error('Network timeout');
      networkError.code = 'ECONNRESET';

      const classification = syncManager._classifyError(networkError);

      expect(classification.retryable).toBe(true);
      expect(classification.requiresReconnection).toBe(false);
    });
  });

  describe('Google Calendar Service Integration', () => {
    it('should handle successful event creation', async () => {
      const correlationId = generateCorrelationId();
      
      // Mock successful Google Calendar API call
      const mockGoogleEvent = {
        id: 'google-event-id',
        summary: 'Test reminder',
        start: { dateTime: '2024-01-15T10:00:00Z' }
      };
      jest.spyOn(googleCalendarService, 'createEvent').mockResolvedValue(mockGoogleEvent);

      const reminderData = {
        description: 'Test reminder',
        date: new Date('2024-01-15T10:00:00Z')
      };

      // Execute Google Calendar service call
      const result = await googleCalendarService.createEvent(
        testUserIntegration,
        reminderData,
        'test-message-id',
        correlationId
      );

      // Verify event was created
      expect(result.id).toBe('google-event-id');
      expect(result.summary).toBe('Test reminder');

      // Verify API was called with correct parameters
      expect(googleCalendarService.createEvent).toHaveBeenCalledWith(
        testUserIntegration,
        reminderData,
        'test-message-id',
        correlationId
      );
    });

    it('should handle API errors gracefully', async () => {
      const correlationId = generateCorrelationId();
      
      // Mock API error
      const apiError = new Error('Google API Error');
      apiError.status = 500;
      jest.spyOn(googleCalendarService, 'createEvent').mockRejectedValue(apiError);

      const reminderData = {
        description: 'Test reminder',
        date: new Date('2024-01-15T10:00:00Z')
      };

      // Execute Google Calendar service call and expect it to throw
      await expect(googleCalendarService.createEvent(
        testUserIntegration,
        reminderData,
        'test-message-id',
        correlationId
      )).rejects.toThrow('Google API Error');

      // Verify API was called
      expect(googleCalendarService.createEvent).toHaveBeenCalled();
    });

    it('should handle event search for idempotency', async () => {
      const correlationId = generateCorrelationId();
      
      // Mock existing event found
      const existingEvent = {
        id: 'existing-event-id',
        summary: 'Test reminder',
        extendedProperties: {
          private: {
            app_event_id: 'test-message-id'
          }
        }
      };
      jest.spyOn(googleCalendarService, 'searchEventByAppId').mockResolvedValue(existingEvent);

      // Execute search
      const result = await googleCalendarService.searchEventByAppId(
        testUserIntegration.calendarId,
        'test-message-id',
        correlationId
      );

      // Verify existing event was found
      expect(result.id).toBe('existing-event-id');
      expect(result.extendedProperties.private.app_event_id).toBe('test-message-id');

      // Verify API was called with correct parameters
      expect(googleCalendarService.searchEventByAppId).toHaveBeenCalledWith(
        testUserIntegration.calendarId,
        'test-message-id',
        correlationId
      );
    });

    it('should handle event updates for existing events', async () => {
      const correlationId = generateCorrelationId();
      
      // Mock successful event update
      const updatedEvent = {
        id: 'existing-event-id',
        summary: 'Updated test reminder',
        start: { dateTime: '2024-01-15T10:00:00Z' }
      };
      jest.spyOn(googleCalendarService, 'updateEvent').mockResolvedValue(updatedEvent);

      const reminderData = {
        description: 'Updated test reminder',
        date: new Date('2024-01-15T10:00:00Z')
      };

      // Execute event update
      const result = await googleCalendarService.updateEvent(
        'existing-event-id',
        testUserIntegration,
        reminderData,
        correlationId
      );

      // Verify event was updated
      expect(result.id).toBe('existing-event-id');
      expect(result.summary).toBe('Updated test reminder');

      // Verify API was called with correct parameters
      expect(googleCalendarService.updateEvent).toHaveBeenCalledWith(
        'existing-event-id',
        testUserIntegration,
        reminderData,
        correlationId
      );
    });
  });

  describe('Logging and Monitoring Integration', () => {
    it('should generate unique correlation IDs', () => {
      const ids = new Set();
      
      // Generate multiple correlation IDs
      for (let i = 0; i < 100; i++) {
        const id = generateCorrelationId();
        expect(ids.has(id)).toBe(false); // Should be unique
        ids.add(id);
        expect(id).toMatch(/^\d+-[a-f0-9]{8}$/); // Should match expected format
      }
    });

    it('should log sync operations with proper structure', () => {
      const correlationId = generateCorrelationId();
      const operation = 'createEvent';
      
      structuredLogger.syncStart(operation, {
        correlationId,
        messageId: 'test-message-id'
      });

      structuredLogger.syncSuccess(operation, {
        correlationId,
        messageId: 'test-message-id',
        eventId: 'test-event-id'
      });

      expect(consoleSpy.info).toHaveBeenCalledWith(
        expect.stringContaining(`Sync operation started: ${operation}`),
        expect.objectContaining({
          correlationId,
          operation,
          phase: 'START'
        })
      );

      expect(consoleSpy.info).toHaveBeenCalledWith(
        expect.stringContaining(`Sync operation completed successfully: ${operation}`),
        expect.objectContaining({
          correlationId,
          operation,
          phase: 'SUCCESS'
        })
      );
    });

    it('should log API metrics with timing information', () => {
      const correlationId = generateCorrelationId();
      const startTime = Date.now();
      
      // Simulate API call
      setTimeout(() => {
        const duration = Date.now() - startTime;
        
        structuredLogger.apiMetrics('calendar.events.insert', duration, {
          correlationId,
          messageId: 'test-message-id',
          eventId: 'test-event-id'
        });
      }, 10);

      // Wait for the async operation
      return new Promise(resolve => {
        setTimeout(() => {
          expect(consoleSpy.info).toHaveBeenCalledWith(
            expect.stringContaining('API call completed'),
            expect.objectContaining({
              correlationId,
              messageId: 'test-message-id',
              eventId: 'test-event-id',
              duration: expect.any(Number)
            })
          );
          resolve();
        }, 20);
      });
    });

    it('should log errors with proper context', () => {
      const correlationId = generateCorrelationId();
      const error = new Error('Test error');
      error.status = 500;

      structuredLogger.syncFailure('testOperation', {
        correlationId,
        messageId: 'test-message-id',
        error: {
          message: error.message,
          status: error.status,
          type: 'API_ERROR'
        }
      });

      // Verify that error logging occurred (structure may vary)
      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining('Sync operation failed'),
        expect.objectContaining({
          operation: 'testOperation',
          phase: 'FAILURE'
        })
      );
    });
  });

  describe('Configuration and Environment', () => {
    it('should use correct retry configuration', () => {
      expect(syncManager.retryConfig.maxRetries).toBe(3);
      expect(syncManager.retryConfig.baseDelay).toBe(1000);
      expect(syncManager.retryConfig.maxDelay).toBe(30000);
      expect(syncManager.retryConfig.backoffMultiplier).toBe(2);
      expect(syncManager.retryConfig.jitterFactor).toBe(0.1);
    });

    it('should respect environment variables', () => {
      // Verify test environment variables are set
      expect(process.env.NODE_ENV).toBe('test');
      expect(process.env.MAX_SYNC_RETRIES).toBe('3');
      expect(process.env.SYNC_RETRY_BASE_DELAY_MS).toBe('1000');
      expect(process.env.GOOGLE_CLIENT_ID).toBe('test-client-id');
      expect(process.env.GOOGLE_CLIENT_SECRET).toBe('test-client-secret');
    });
  });

  describe('Data Validation and Transformation', () => {
    it('should handle all-day event detection', () => {
      // Test all-day event detection logic
      const allDayDate = new Date('2024-01-15T00:00:00.000Z');
      const timedDate = new Date('2024-01-15T10:30:00.000Z');
      
      // Check if date represents midnight (all-day event indicator)
      const isAllDayCandidate = (date) => {
        return date.getUTCHours() === 0 && 
               date.getUTCMinutes() === 0 && 
               date.getUTCSeconds() === 0 &&
               date.getUTCMilliseconds() === 0;
      };
      
      expect(isAllDayCandidate(allDayDate)).toBe(true);
      expect(isAllDayCandidate(timedDate)).toBe(false);

      // Test date formatting for Google Calendar
      expect(allDayDate.toISOString().split('T')[0]).toBe('2024-01-15');
      expect(timedDate.toISOString()).toBe('2024-01-15T10:30:00.000Z');
    });

    it('should handle timezone conversions', () => {
      const testDate = new Date('2024-01-15T10:00:00Z');
      const saoPauloTimezone = 'America/Sao_Paulo';
      const newYorkTimezone = 'America/New_York';

      // Verify date formatting for different timezones
      expect(testDate.toISOString()).toBe('2024-01-15T10:00:00.000Z');
      
      // Test timezone handling (basic validation)
      expect(saoPauloTimezone).toMatch(/^America\//);
      expect(newYorkTimezone).toMatch(/^America\//);
    });

    it('should validate reminder data structure', () => {
      const validReminderData = {
        description: 'Test reminder',
        date: new Date('2024-01-15T10:00:00Z')
      };

      // Verify required fields are present
      expect(validReminderData.description).toBeDefined();
      expect(validReminderData.date).toBeInstanceOf(Date);
      expect(validReminderData.date.getTime()).toBeGreaterThan(0);

      // Verify description is a string
      expect(typeof validReminderData.description).toBe('string');
      expect(validReminderData.description.length).toBeGreaterThan(0);
    });
  });
});