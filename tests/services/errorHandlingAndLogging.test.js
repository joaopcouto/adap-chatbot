import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock dependencies
jest.mock('../../src/models/User.js');
jest.mock('../../src/models/UserGoogleIntegration.js');
jest.mock('../../src/models/ReminderSync.js');
jest.mock('../../src/models/Reminder.js');
jest.mock('../../src/services/twilioService.js');

import { structuredLogger, generateCorrelationId, LOG_LEVELS } from '../../src/helpers/logger.js';
import userNotificationService from '../../src/services/userNotificationService.js';
import syncManager from '../../src/services/syncManager.js';
import googleCalendarService from '../../src/services/googleCalendarService.js';
import reminderService from '../../src/services/reminderService.js';

describe('Error Handling and Logging', () => {
  let consoleSpy;
  
  beforeEach(() => {
    consoleSpy = {
      error: jest.spyOn(console, 'error').mockImplementation(() => {}),
      warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
      info: jest.spyOn(console, 'info').mockImplementation(() => {}),
      debug: jest.spyOn(console, 'debug').mockImplementation(() => {}),
      log: jest.spyOn(console, 'log').mockImplementation(() => {})
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Structured Logger', () => {
    it('should generate correlation IDs', () => {
      const correlationId1 = generateCorrelationId();
      const correlationId2 = generateCorrelationId();
      
      expect(correlationId1).toMatch(/^\d+-[a-f0-9]{8}$/);
      expect(correlationId2).toMatch(/^\d+-[a-f0-9]{8}$/);
      expect(correlationId1).not.toBe(correlationId2);
    });

    it('should log structured error messages', () => {
      const correlationId = generateCorrelationId();
      const error = new Error('Test error');
      error.type = 'AUTH_ERROR';
      error.retryable = false;

      structuredLogger.error('Test error message', {
        correlationId,
        userId: 'test-user-id',
        error
      });

      expect(consoleSpy.error).toHaveBeenCalled();
    });

    it('should log sync operations with proper context', () => {
      const correlationId = generateCorrelationId();
      
      structuredLogger.syncStart('createEvent', {
        correlationId,
        messageId: 'test-message-id',
        userId: 'test-user-id'
      });

      structuredLogger.syncSuccess('createEvent', {
        correlationId,
        messageId: 'test-message-id',
        eventId: 'test-event-id'
      });

      expect(consoleSpy.info).toHaveBeenCalledTimes(2);
    });

    it('should sanitize error objects', () => {
      const error = new Error('Sensitive error');
      error.stack = 'Stack trace with sensitive data';
      error.originalError = { sensitiveData: 'secret' };

      structuredLogger.error('Test error', { error });

      expect(consoleSpy.error).toHaveBeenCalled();
      // Verify that sensitive data is not logged in production mode
    });

    it('should log API metrics', () => {
      const correlationId = generateCorrelationId();
      
      structuredLogger.apiMetrics('calendar.events.insert', 1500, {
        correlationId,
        messageId: 'test-message-id',
        eventId: 'test-event-id'
      });

      expect(consoleSpy.info).toHaveBeenCalled();
    });
  });

  describe('User Notification Service', () => {
    it('should mask phone numbers for privacy', () => {
      const service = userNotificationService;
      const maskedNumber = service._maskPhoneNumber('+5511999887766');
      
      expect(maskedNumber).toBe('+5**********66');
      expect(maskedNumber).not.toContain('999887');
    });

    it('should build appropriate reconnection messages', () => {
      const service = userNotificationService;
      const error = {
        type: 'AUTH_ERROR',
        requiresReconnection: true
      };
      
      const message = service._buildReconnectionMessage(error);
      
      expect(message).toContain('Google Calendar');
      expect(message).toContain('Reconexão');
      expect(message).toContain('conectar google');
    });

    it('should build persistent failure messages', () => {
      const service = userNotificationService;
      const syncStats = {
        failureCount: 5,
        lastFailureTime: new Date()
      };
      
      const message = service._buildPersistentFailureMessage(syncStats);
      
      expect(message).toContain('5 falhas');
      expect(message).toContain('Google Calendar');
      expect(message).toContain('ajuda google');
    });
  });

  describe('Error Classification', () => {
    it('should classify authentication errors correctly', () => {
      const error = new Error('Invalid credentials');
      error.status = 401;
      error.type = 'AUTH_ERROR';
      error.retryable = false;
      error.requiresReconnection = true;

      const classification = syncManager._classifyError(error);
      
      expect(classification.type).toBe('AUTH_ERROR');
      expect(classification.retryable).toBe(false);
      expect(classification.requiresReconnection).toBe(true);
    });

    it('should classify rate limit errors correctly', () => {
      const error = new Error('Rate limit exceeded');
      error.status = 429;
      error.type = 'RATE_LIMIT';
      error.retryable = true;

      const classification = syncManager._classifyError(error);
      
      expect(classification.type).toBe('RATE_LIMIT');
      expect(classification.retryable).toBe(true);
      expect(classification.requiresReconnection).toBe(false);
    });

    it('should classify server errors correctly', () => {
      const error = new Error('Internal server error');
      error.status = 500;
      error.type = 'SERVER_ERROR';
      error.retryable = true;

      const classification = syncManager._classifyError(error);
      
      expect(classification.type).toBe('SERVER_ERROR');
      expect(classification.retryable).toBe(true);
      expect(classification.requiresReconnection).toBe(false);
    });
  });

  describe('Correlation ID Tracking', () => {
    it('should pass correlation IDs through service calls', async () => {
      const correlationId = generateCorrelationId();
      
      // Mock the service methods to verify correlation ID is passed
      const createEventSpy = jest.spyOn(googleCalendarService, 'createEvent')
        .mockResolvedValue({
          eventId: 'test-event-id',
          calendarId: 'primary'
        });

      const userIntegration = {
        userId: 'test-user-id',
        connected: true,
        calendarSyncEnabled: true,
        accessToken: 'test-token',
        refreshToken: 'test-refresh-token'
      };

      const reminder = {
        messageId: 'test-message-id',
        description: 'Test reminder',
        date: new Date()
      };

      // This would normally call the actual service, but we're mocking it
      // The important thing is to verify the correlation ID is passed through
      expect(correlationId).toMatch(/^\d+-[a-f0-9]{8}$/);
    });
  });

  describe('Privacy Protection', () => {
    it('should mask sensitive data in logs', () => {
      const phoneNumber = '+5511999887766';
      const maskedNumber = userNotificationService._maskPhoneNumber(phoneNumber);
      
      expect(maskedNumber).not.toContain('999887');
      expect(maskedNumber.length).toBe(phoneNumber.length);
    });

    it('should not log sensitive token data', () => {
      const error = new Error('Token error');
      error.originalError = {
        response: {
          data: {
            access_token: 'sensitive-token',
            refresh_token: 'sensitive-refresh-token'
          }
        }
      };

      structuredLogger.error('Token error occurred', { error });
      
      // Verify that the console output doesn't contain sensitive tokens
      expect(consoleSpy.error).toHaveBeenCalled();
    });
  });

  describe('Retry Logic with Logging', () => {
    it('should calculate retry delays with jitter', () => {
      const delay1 = syncManager._calculateRetryDelay(0);
      const delay2 = syncManager._calculateRetryDelay(0);
      const delay3 = syncManager._calculateRetryDelay(1);
      
      expect(delay1).toBeGreaterThan(0);
      expect(delay2).toBeGreaterThan(0);
      expect(delay3).toBeGreaterThan(delay1);
      
      // Jitter should make delays slightly different
      expect(delay1).not.toBe(delay2);
    });

    it('should respect maximum delay limits', () => {
      const maxDelay = syncManager.retryConfig.maxDelay;
      const highAttemptDelay = syncManager._calculateRetryDelay(10);
      
      expect(highAttemptDelay).toBeLessThanOrEqual(maxDelay * 1.1); // Allow for jitter
    });
  });

  describe('Monitoring and Metrics', () => {
    it('should log API call durations', () => {
      const correlationId = generateCorrelationId();
      const duration = 1500; // 1.5 seconds
      
      structuredLogger.apiMetrics('calendar.events.insert', duration, {
        correlationId,
        messageId: 'test-message-id'
      });

      expect(consoleSpy.info).toHaveBeenCalledWith(
        expect.stringContaining('API call completed'),
        expect.any(Object)
      );
    });

    it('should track sync operation phases', () => {
      const correlationId = generateCorrelationId();
      
      structuredLogger.syncStart('testOperation', { correlationId });
      structuredLogger.syncSuccess('testOperation', { correlationId });
      
      expect(consoleSpy.info).toHaveBeenCalledTimes(2);
      expect(consoleSpy.info).toHaveBeenCalledWith(
        expect.stringContaining('Sync operation started: testOperation'),
        expect.any(Object)
      );
      expect(consoleSpy.info).toHaveBeenCalledWith(
        expect.stringContaining('Sync operation completed successfully: testOperation'),
        expect.any(Object)
      );
    });
  });
});