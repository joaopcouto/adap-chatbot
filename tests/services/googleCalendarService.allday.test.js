import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock the googleapis module
jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        setCredentials: jest.fn(),
        refreshAccessToken: jest.fn(),
        revokeToken: jest.fn()
      }))
    },
    calendar: jest.fn().mockReturnValue({
      events: {
        insert: jest.fn(),
        update: jest.fn(),
        list: jest.fn()
      },
      calendarList: {
        get: jest.fn()
      }
    })
  }
}));

// Mock crypto module
jest.mock('crypto', () => ({
  createDecipher: jest.fn().mockReturnValue({
    update: jest.fn().mockReturnValue('decrypted'),
    final: jest.fn().mockReturnValue('token')
  })
}));

import googleCalendarService from '../../src/services/googleCalendarService.js';

describe('GoogleCalendarService - All-Day Event Detection and Handling', () => {
  let service;
  
  beforeEach(() => {
    // Mock environment variables
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/auth/callback';
    process.env.DEFAULT_TIMEZONE = 'America/Sao_Paulo';
    process.env.DEFAULT_EVENT_DURATION_MINUTES = '30';
    process.env.TOKEN_ENCRYPTION_KEY = 'test-encryption-key';
    
    // Clear all mocks
    jest.clearAllMocks();
    
    service = googleCalendarService;
  });

  afterEach(() => {
    // Clean up environment variables
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REDIRECT_URI;
    delete process.env.DEFAULT_TIMEZONE;
    delete process.env.DEFAULT_EVENT_DURATION_MINUTES;
    delete process.env.TOKEN_ENCRYPTION_KEY;
  });

  describe('_isAllDayEvent', () => {
    it('should detect all-day event when time is exactly midnight', () => {
      // Create a date that represents midnight in local time
      const date = new Date('2024-01-15T00:00:00');
      const result = service._isAllDayEvent(date);
      expect(result).toBe(true);
    });

    it('should not detect all-day event when time is not midnight', () => {
      const date = new Date('2024-01-15T10:30:00.000Z');
      const result = service._isAllDayEvent(date);
      expect(result).toBe(false);
    });

    it('should detect all-day event from date-only string format', () => {
      const date = new Date('2024-01-15T00:00:00.000Z');
      const reminderData = { originalDateString: '2024-01-15' };
      const result = service._isAllDayEvent(date, reminderData);
      expect(result).toBe(true);
    });

    it('should detect all-day event when explicitly marked', () => {
      const date = new Date('2024-01-15T10:30:00.000Z');
      const reminderData = { isAllDay: true };
      const result = service._isAllDayEvent(date, reminderData);
      expect(result).toBe(true);
    });

    it('should not detect all-day event for datetime string format', () => {
      const date = new Date('2024-01-15T10:30:00.000Z');
      const reminderData = { originalDateString: '2024-01-15T10:30:00.000Z' };
      const result = service._isAllDayEvent(date, reminderData);
      expect(result).toBe(false);
    });
  });

  describe('_formatDateOnly', () => {
    it('should format date without timezone', () => {
      const date = new Date('2024-01-15T10:30:00.000Z');
      const result = service._formatDateOnly(date);
      expect(result).toBe('2024-01-15');
    });

    it('should format date with timezone consideration', () => {
      const date = new Date('2024-01-15T02:00:00.000Z'); // 2 AM UTC
      const result = service._formatDateOnly(date, 'America/Sao_Paulo'); // UTC-3
      // Should be previous day in Sao Paulo timezone
      expect(result).toBe('2024-01-14');
    });

    it('should handle timezone edge cases', () => {
      const date = new Date('2024-01-15T23:00:00.000Z'); // 11 PM UTC
      const result = service._formatDateOnly(date, 'Asia/Tokyo'); // UTC+9
      // Should be next day in Tokyo timezone
      expect(result).toBe('2024-01-16');
    });
  });

  describe('_parseReminderDate', () => {
    it('should parse date string correctly', () => {
      const dateString = '2024-01-15T10:30:00.000Z';
      const result = service._parseReminderDate(dateString, 'America/Sao_Paulo');
      
      expect(result.date).toBeInstanceOf(Date);
      expect(result.originalDateString).toBe(dateString);
      expect(result.timezone).toBe('America/Sao_Paulo');
    });

    it('should parse Date object correctly', () => {
      const date = new Date('2024-01-15T10:30:00.000Z');
      const result = service._parseReminderDate(date, 'America/Sao_Paulo');
      
      expect(result.date).toBeInstanceOf(Date);
      expect(result.originalDateString).toBeNull();
      expect(result.timezone).toBe('America/Sao_Paulo');
    });

    it('should throw error for invalid date', () => {
      expect(() => {
        service._parseReminderDate('invalid-date', 'America/Sao_Paulo');
      }).toThrow('Invalid date format');
    });

    it('should throw error for null input', () => {
      expect(() => {
        service._parseReminderDate(null, 'America/Sao_Paulo');
      }).toThrow('Invalid date input');
    });
  });

  describe('_calculateEventDuration', () => {
    it('should use explicit duration from reminder data', () => {
      const reminderData = { duration: 60 };
      const userIntegration = {};
      const result = service._calculateEventDuration(reminderData, userIntegration);
      expect(result).toBe(60);
    });

    it('should calculate duration from end date', () => {
      const reminderData = {
        date: '2024-01-15T10:00:00.000Z',
        endDate: '2024-01-15T11:30:00.000Z'
      };
      const userIntegration = {};
      const result = service._calculateEventDuration(reminderData, userIntegration);
      expect(result).toBe(90); // 1.5 hours
    });

    it('should use user default duration', () => {
      const reminderData = {};
      const userIntegration = { defaultEventDuration: 45 };
      const result = service._calculateEventDuration(reminderData, userIntegration);
      expect(result).toBe(45);
    });

    it('should use system default duration', () => {
      const reminderData = {};
      const userIntegration = {};
      const result = service._calculateEventDuration(reminderData, userIntegration);
      expect(result).toBe(30); // System default
    });

    it('should handle invalid duration gracefully', () => {
      const reminderData = { duration: -10 };
      const userIntegration = {};
      const result = service._calculateEventDuration(reminderData, userIntegration);
      expect(result).toBe(30); // Falls back to system default
    });
  });

  describe('_createEventObject', () => {
    const mockUserIntegration = {
      timezone: 'America/Sao_Paulo',
      defaultReminders: [15, 60]
    };

    it('should create all-day event object correctly', () => {
      const reminderData = {
        date: '2024-01-15',
        description: 'All day meeting'
      };
      
      const result = service._createEventObject(reminderData, mockUserIntegration, 'test-message-id');
      
      expect(result.summary).toBe('All day meeting');
      expect(result.description).toBe('All day meeting');
      expect(result.visibility).toBe('private');
      expect(result.start.date).toBe('2024-01-15');
      expect(result.end.date).toBe('2024-01-16');
      expect(result.start.dateTime).toBeUndefined();
      expect(result.start.timeZone).toBeUndefined();
      expect(result.extendedProperties.private.app_event_id).toBe('test-message-id');
    });

    it('should create timed event object correctly', () => {
      const reminderData = {
        date: '2024-01-15T10:30:00.000Z',
        description: 'Timed meeting'
      };
      
      const result = service._createEventObject(reminderData, mockUserIntegration, 'test-message-id');
      
      expect(result.summary).toBe('Timed meeting');
      expect(result.description).toBe('Timed meeting');
      expect(result.visibility).toBe('private');
      expect(result.start.dateTime).toBe('2024-01-15T10:30:00.000Z');
      expect(result.end.dateTime).toBe('2024-01-15T11:00:00.000Z'); // +30 min default
      expect(result.start.timeZone).toBe('America/Sao_Paulo');
      expect(result.end.timeZone).toBe('America/Sao_Paulo');
      expect(result.start.date).toBeUndefined();
    });

    it('should handle custom duration for timed events', () => {
      const reminderData = {
        date: '2024-01-15T10:30:00.000Z',
        description: 'Long meeting',
        duration: 120
      };
      
      const result = service._createEventObject(reminderData, mockUserIntegration, 'test-message-id');
      
      expect(result.start.dateTime).toBe('2024-01-15T10:30:00.000Z');
      expect(result.end.dateTime).toBe('2024-01-15T12:30:00.000Z'); // +120 min
    });

    it('should set custom reminders correctly', () => {
      const reminderData = {
        date: '2024-01-15T10:30:00.000Z',
        description: 'Meeting with reminders'
      };
      
      const result = service._createEventObject(reminderData, mockUserIntegration, 'test-message-id');
      
      expect(result.reminders.useDefault).toBe(false);
      expect(result.reminders.overrides).toHaveLength(2);
      expect(result.reminders.overrides[0]).toEqual({ method: 'popup', minutes: 15 });
      expect(result.reminders.overrides[1]).toEqual({ method: 'popup', minutes: 60 });
    });

    it('should use default reminders when none specified', () => {
      const reminderData = {
        date: '2024-01-15T10:30:00.000Z',
        description: 'Meeting with default reminders'
      };
      const userIntegrationNoReminders = { timezone: 'America/Sao_Paulo' };
      
      const result = service._createEventObject(reminderData, userIntegrationNoReminders, 'test-message-id');
      
      expect(result.reminders.useDefault).toBe(true);
      expect(result.reminders.overrides).toBeUndefined();
    });

    it('should throw error for missing required fields', () => {
      expect(() => {
        service._createEventObject({}, mockUserIntegration, 'test-message-id');
      }).toThrow('Reminder date is required');

      expect(() => {
        service._createEventObject({ date: '2024-01-15' }, mockUserIntegration, 'test-message-id');
      }).toThrow('Reminder description is required');
    });

    it('should use default timezone when not specified', () => {
      const reminderData = {
        date: '2024-01-15T10:30:00.000Z',
        description: 'Meeting'
      };
      const userIntegrationNoTimezone = {};
      
      const result = service._createEventObject(reminderData, userIntegrationNoTimezone, 'test-message-id');
      
      expect(result.start.timeZone).toBe('America/Sao_Paulo'); // System default
      expect(result.end.timeZone).toBe('America/Sao_Paulo');
    });
  });
});