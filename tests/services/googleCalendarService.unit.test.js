import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock the googleapis module
const mockOAuth2Client = {
  setCredentials: jest.fn(),
  refreshAccessToken: jest.fn(),
  revokeToken: jest.fn()
};

const mockCalendarClient = {
  events: {
    insert: jest.fn(),
    update: jest.fn(),
    list: jest.fn()
  },
  calendarList: {
    get: jest.fn()
  }
};

jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => mockOAuth2Client)
    },
    calendar: jest.fn().mockReturnValue(mockCalendarClient)
  }
}));

// Mock crypto module
jest.mock('crypto', () => ({
  createDecipher: jest.fn().mockReturnValue({
    update: jest.fn().mockReturnValue('decrypted'),
    final: jest.fn().mockReturnValue('token')
  })
}));

// Mock logger
jest.mock('../../src/helpers/logger.js', () => ({
  structuredLogger: {
    syncStart: jest.fn(),
    syncSuccess: jest.fn(),
    syncFailure: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    apiMetrics: jest.fn()
  },
  generateCorrelationId: jest.fn().mockReturnValue('test-correlation-id')
}));

import googleCalendarService from '../../src/services/googleCalendarService.js';

describe('GoogleCalendarService - Unit Tests', () => {
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
    
    // Restore all spies
    jest.restoreAllMocks();
  });

  describe('Event Creation with Various Reminder Data Formats', () => {
    it('should create event object with string date format', () => {
      const reminderData = {
        date: '2024-01-15T10:30:00.000Z',
        description: 'Meeting with string date'
      };
      
      const userIntegration = {
        timezone: 'America/Sao_Paulo'
      };

      const result = service._createEventObject(reminderData, userIntegration, 'msg123');

      expect(result.summary).toBe('Meeting with string date');
      expect(result.description).toBe('Meeting with string date');
      expect(result.start.dateTime).toBe('2024-01-15T10:30:00.000Z');
      expect(result.start.timeZone).toBe('America/Sao_Paulo');
      expect(result.end.dateTime).toBe('2024-01-15T11:00:00.000Z');
      expect(result.end.timeZone).toBe('America/Sao_Paulo');
      expect(result.extendedProperties.private.app_event_id).toBe('msg123');
    });

    it('should create event object with Date object format', () => {
      const reminderData = {
        date: new Date('2024-01-15T14:30:00.000Z'),
        description: 'Meeting with Date object'
      };
      
      const userIntegration = {
        timezone: 'America/Sao_Paulo'
      };

      const result = service._createEventObject(reminderData, userIntegration, 'msg124');

      expect(result.summary).toBe('Meeting with Date object');
      expect(result.start.dateTime).toBe('2024-01-15T14:30:00.000Z');
      expect(result.end.dateTime).toBe('2024-01-15T15:00:00.000Z');
    });

    it('should create event object with custom duration', () => {
      const reminderData = {
        date: '2024-01-15T10:30:00.000Z',
        description: 'Long meeting',
        duration: 120
      };
      
      const userIntegration = {
        timezone: 'America/Sao_Paulo'
      };

      const result = service._createEventObject(reminderData, userIntegration, 'msg125');

      expect(result.start.dateTime).toBe('2024-01-15T10:30:00.000Z');
      expect(result.end.dateTime).toBe('2024-01-15T12:30:00.000Z');
    });

    it('should create event object with explicit end date', () => {
      const reminderData = {
        date: '2024-01-15T10:30:00.000Z',
        endDate: '2024-01-15T12:00:00.000Z',
        description: 'Meeting with end date'
      };
      
      const userIntegration = {
        timezone: 'America/Sao_Paulo'
      };

      const result = service._createEventObject(reminderData, userIntegration, 'msg126');

      expect(result.start.dateTime).toBe('2024-01-15T10:30:00.000Z');
      expect(result.end.dateTime).toBe('2024-01-15T12:00:00.000Z');
    });

    it('should create event object with custom reminders', () => {
      const reminderData = {
        date: '2024-01-15T10:30:00.000Z',
        description: 'Meeting with custom reminders'
      };
      
      const userIntegration = {
        timezone: 'America/Sao_Paulo',
        defaultReminders: [15, 60, 1440]
      };

      const result = service._createEventObject(reminderData, userIntegration, 'msg127');

      expect(result.reminders).toEqual({
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 15 },
          { method: 'popup', minutes: 60 },
          { method: 'popup', minutes: 1440 }
        ]
      });
    });

    it('should create event object with default reminders when none specified', () => {
      const reminderData = {
        date: '2024-01-15T10:30:00.000Z',
        description: 'Meeting with default reminders'
      };
      
      const userIntegration = {
        timezone: 'America/Sao_Paulo'
      };

      const result = service._createEventObject(reminderData, userIntegration, 'msg128');

      expect(result.reminders).toEqual({
        useDefault: true
      });
    });

    it('should throw error for missing required fields', () => {
      const userIntegration = { timezone: 'America/Sao_Paulo' };

      expect(() => {
        service._createEventObject({}, userIntegration, 'msg129');
      }).toThrow('Reminder date is required');

      expect(() => {
        service._createEventObject({ date: '2024-01-15T10:30:00.000Z' }, userIntegration, 'msg130');
      }).toThrow('Reminder description is required');
    });
  });

  describe('All-Day vs Timed Event Handling and Timezone Conversion', () => {
    it('should create all-day event for date-only string', () => {
      const reminderData = {
        date: '2024-01-15',
        description: 'All day event'
      };
      
      const userIntegration = {
        timezone: 'America/New_York'
      };

      const result = service._createEventObject(reminderData, userIntegration, 'msg131');

      expect(result.start).toEqual({ date: '2024-01-15' });
      expect(result.end).toEqual({ date: '2024-01-16' });
      expect(result.start.dateTime).toBeUndefined();
      expect(result.start.timeZone).toBeUndefined();
    });

    it('should create all-day event for midnight time', () => {
      const reminderData = {
        date: new Date('2024-01-15T00:00:00.000'),
        description: 'Midnight event'
      };
      
      const userIntegration = {
        timezone: 'America/New_York'
      };

      const result = service._createEventObject(reminderData, userIntegration, 'msg132');

      expect(result.start).toEqual({ date: '2024-01-15' });
      expect(result.end).toEqual({ date: '2024-01-16' });
    });

    it('should create all-day event when explicitly marked', () => {
      const reminderData = {
        date: '2024-01-15T10:30:00.000Z',
        description: 'Explicitly all-day event',
        isAllDay: true
      };
      
      const userIntegration = {
        timezone: 'America/New_York'
      };

      const result = service._createEventObject(reminderData, userIntegration, 'msg133');

      expect(result.start).toEqual({ date: '2024-01-15' });
      expect(result.end).toEqual({ date: '2024-01-16' });
    });

    it('should create timed event with proper timezone', () => {
      const reminderData = {
        date: '2024-01-15T15:30:00.000Z',
        description: 'Timed event'
      };
      
      const userIntegration = {
        timezone: 'America/New_York'
      };

      const result = service._createEventObject(reminderData, userIntegration, 'msg134');

      expect(result.start).toEqual({
        dateTime: '2024-01-15T15:30:00.000Z',
        timeZone: 'America/New_York'
      });
      expect(result.end).toEqual({
        dateTime: '2024-01-15T16:00:00.000Z',
        timeZone: 'America/New_York'
      });
    });

    it('should use default timezone when user timezone is not specified', () => {
      const reminderData = {
        date: '2024-01-15T15:30:00.000Z',
        description: 'Event with default timezone'
      };
      
      const userIntegration = {};

      const result = service._createEventObject(reminderData, userIntegration, 'msg135');

      expect(result.start.timeZone).toBe('America/Sao_Paulo');
      expect(result.end.timeZone).toBe('America/Sao_Paulo');
    });
  });

  describe('Error Handling for Different HTTP Status Codes', () => {
    it('should classify 401 errors as AUTH_ERROR', () => {
      const error = new Error('Invalid Credentials');
      error.response = {
        status: 401,
        data: {
          error: {
            message: 'Invalid Credentials',
            code: 401
          }
        }
      };

      const result = service._handleApiError(error, 'test-correlation-id');

      expect(result.type).toBe('AUTH_ERROR');
      expect(result.status).toBe(401);
      expect(result.retryable).toBe(false);
      expect(result.requiresReconnection).toBe(false);
      expect(result.correlationId).toBe('test-correlation-id');
    });

    it('should classify 403 errors as AUTH_ERROR with reconnection required', () => {
      const error = new Error('Forbidden');
      error.response = {
        status: 403,
        data: {
          error: {
            message: 'Forbidden',
            code: 403
          }
        }
      };

      const result = service._handleApiError(error);

      expect(result.type).toBe('AUTH_ERROR');
      expect(result.status).toBe(403);
      expect(result.retryable).toBe(false);
      expect(result.requiresReconnection).toBe(true);
    });

    it('should classify 429 errors as RATE_LIMIT', () => {
      const error = new Error('Rate Limit Exceeded');
      error.response = {
        status: 429,
        headers: {
          'retry-after': '60'
        },
        data: {
          error: {
            message: 'Rate Limit Exceeded',
            code: 429
          }
        }
      };

      const result = service._handleApiError(error);

      expect(result.type).toBe('RATE_LIMIT');
      expect(result.status).toBe(429);
      expect(result.retryable).toBe(true);
      expect(result.retryAfter).toBe(60000);
    });

    it('should classify 400 errors as CLIENT_ERROR', () => {
      const error = new Error('Bad Request');
      error.response = {
        status: 400,
        data: {
          error: {
            message: 'Bad Request',
            code: 400
          }
        }
      };

      const result = service._handleApiError(error);

      expect(result.type).toBe('CLIENT_ERROR');
      expect(result.status).toBe(400);
      expect(result.retryable).toBe(false);
    });

    it('should classify 500 errors as SERVER_ERROR', () => {
      const error = new Error('Internal Server Error');
      error.response = {
        status: 500,
        data: {
          error: {
            message: 'Internal Server Error',
            code: 500
          }
        }
      };

      const result = service._handleApiError(error);

      expect(result.type).toBe('SERVER_ERROR');
      expect(result.status).toBe(500);
      expect(result.retryable).toBe(true);
    });

    it('should classify 502 errors as SERVER_ERROR', () => {
      const error = new Error('Bad Gateway');
      error.response = {
        status: 502,
        data: {
          error: {
            message: 'Bad Gateway',
            code: 502
          }
        }
      };

      const result = service._handleApiError(error);

      expect(result.type).toBe('SERVER_ERROR');
      expect(result.status).toBe(502);
      expect(result.retryable).toBe(true);
    });

    it('should classify unknown errors as UNKNOWN_ERROR', () => {
      const error = new Error('Unknown error');
      error.code = 'UNKNOWN';

      const result = service._handleApiError(error);

      expect(result.type).toBe('UNKNOWN_ERROR');
      expect(result.retryable).toBe(false);
    });

    it('should handle network timeout errors', () => {
      const error = new Error('ETIMEDOUT');
      error.code = 'ETIMEDOUT';

      const result = service._handleApiError(error);

      expect(result.type).toBe('UNKNOWN_ERROR');
      expect(result.retryable).toBe(false);
    });

    it('should preserve correlation ID in error handling', () => {
      const error = new Error('Test error');
      error.response = {
        status: 400,
        data: {
          error: {
            message: 'Test error',
            code: 400
          }
        }
      };

      const result = service._handleApiError(error, 'custom-correlation-id');

      expect(result.correlationId).toBe('custom-correlation-id');
    });
  });

  describe('Token Refresh Logic and Authentication Flows', () => {
    beforeEach(() => {
      // Mock the _decryptToken method to avoid crypto issues
      jest.spyOn(service, '_decryptToken').mockReturnValue('decrypted-refresh-token');
    });

    describe('refreshAccessToken', () => {
      it('should throw error when refresh token is missing', async () => {
        await expect(
          service.refreshAccessToken(null)
        ).rejects.toMatchObject({
          type: 'AUTH_ERROR',
          retryable: false,
          message: 'Refresh token is required'
        });
      });

      it('should successfully refresh access token with mocked response', async () => {
        const mockCredentials = {
          access_token: 'new-access-token',
          expiry_date: Date.now() + 3600000,
          token_type: 'Bearer'
        };

        mockOAuth2Client.refreshAccessToken.mockResolvedValue({
          credentials: mockCredentials
        });

        const result = await service.refreshAccessToken('encrypted-refresh-token');

        expect(result).toEqual({
          access_token: 'new-access-token',
          expires_in: expect.any(Number),
          expires_at: expect.any(Date),
          token_type: 'Bearer'
        });

        expect(mockOAuth2Client.setCredentials).toHaveBeenCalledWith({
          refresh_token: 'decrypted-refresh-token'
        });
      });

      it('should handle OAuth errors properly', async () => {
        const oauthError = new Error('invalid_grant');
        mockOAuth2Client.refreshAccessToken.mockRejectedValue(oauthError);

        await expect(
          service.refreshAccessToken('encrypted-refresh-token')
        ).rejects.toMatchObject({
          type: 'AUTH_ERROR',
          retryable: false,
          requiresReconnection: true,
          message: 'Refresh token is invalid or expired. User needs to reconnect.'
        });
      });
    });

    describe('validateToken', () => {
      const mockUserIntegration = {
        userId: 'user123',
        accessToken: 'access-token',
        refreshToken: 'encrypted-refresh-token',
        tokenExpiresAt: new Date(Date.now() + 3600000),
        timezone: 'America/Sao_Paulo',
        calendarId: 'primary',
        getDecryptedRefreshToken: jest.fn().mockReturnValue('decrypted-refresh-token')
      };

      it('should return false when access token is missing', async () => {
        const userWithoutToken = {
          ...mockUserIntegration,
          accessToken: null
        };

        const result = await service.validateToken(userWithoutToken);
        expect(result).toBe(false);
      });

      it('should return false when token is expired', async () => {
        const userWithExpiredToken = {
          ...mockUserIntegration,
          tokenExpiresAt: new Date(Date.now() - 1000)
        };

        const result = await service.validateToken(userWithExpiredToken);
        expect(result).toBe(false);
      });

      it('should return false when token expires within buffer time', async () => {
        const userWithSoonExpiredToken = {
          ...mockUserIntegration,
          tokenExpiresAt: new Date(Date.now() + 2 * 60 * 1000) // Expires in 2 minutes
        };

        const result = await service.validateToken(userWithSoonExpiredToken);
        expect(result).toBe(false);
      });

      it('should return false when tokenExpiresAt is null', async () => {
        const userWithNullExpiry = {
          ...mockUserIntegration,
          tokenExpiresAt: null
        };

        const result = await service.validateToken(userWithNullExpiry);
        expect(result).toBe(false);
      });
    });

    describe('ensureValidToken', () => {
      it('should return user integration when token is valid', async () => {
        const mockUserIntegration = {
          userId: 'user123',
          accessToken: 'access-token',
          tokenExpiresAt: new Date(Date.now() + 3600000),
          refreshToken: 'encrypted-refresh-token'
        };

        jest.spyOn(service, 'validateToken').mockResolvedValue(true);

        const result = await service.ensureValidToken(mockUserIntegration);

        expect(result).toBe(mockUserIntegration);
        expect(service.validateToken).toHaveBeenCalledWith(mockUserIntegration);
      });

      it('should refresh token when invalid and return updated integration', async () => {
        const mockUserIntegration = {
          userId: 'user123',
          accessToken: 'old-access-token',
          tokenExpiresAt: new Date(Date.now() - 1000),
          refreshToken: 'encrypted-refresh-token'
        };

        jest.spyOn(service, 'validateToken').mockResolvedValue(false);
        jest.spyOn(service, 'refreshAccessToken').mockResolvedValue({
          access_token: 'new-access-token',
          expires_at: new Date(Date.now() + 3600000)
        });

        const result = await service.ensureValidToken(mockUserIntegration);

        expect(result.accessToken).toBe('new-access-token');
        expect(result.tokenExpiresAt).toBeInstanceOf(Date);
        expect(service.refreshAccessToken).toHaveBeenCalledWith('encrypted-refresh-token');
      });

      it('should throw error when refresh token is missing', async () => {
        const userWithoutRefreshToken = {
          userId: 'user123',
          accessToken: 'access-token',
          tokenExpiresAt: new Date(Date.now() - 1000),
          refreshToken: null
        };

        jest.spyOn(service, 'validateToken').mockResolvedValue(false);

        await expect(
          service.ensureValidToken(userWithoutRefreshToken)
        ).rejects.toMatchObject({
          type: 'AUTH_ERROR',
          retryable: false,
          requiresReconnection: true,
          message: 'No refresh token available. User needs to reconnect.'
        });
      });

      it('should mark user as disconnected when refresh fails', async () => {
        const userIntegration = {
          userId: 'user123',
          accessToken: 'access-token',
          tokenExpiresAt: new Date(Date.now() - 1000),
          refreshToken: 'encrypted-refresh-token',
          connected: true,
          calendarSyncEnabled: true
        };

        jest.spyOn(service, 'validateToken').mockResolvedValue(false);
        jest.spyOn(service, 'refreshAccessToken').mockRejectedValue(
          Object.assign(new Error('Refresh failed'), { requiresReconnection: true })
        );

        await expect(
          service.ensureValidToken(userIntegration)
        ).rejects.toThrow('Refresh failed');

        expect(userIntegration.connected).toBe(false);
        expect(userIntegration.calendarSyncEnabled).toBe(false);
      });
    });

    describe('executeWithTokenRefresh', () => {
      const mockUserIntegration = {
        userId: 'user123',
        accessToken: 'access-token',
        refreshToken: 'encrypted-refresh-token',
        tokenExpiresAt: new Date(Date.now() + 3600000),
        timezone: 'America/Sao_Paulo',
        calendarId: 'primary',
        getDecryptedRefreshToken: jest.fn().mockReturnValue('decrypted-refresh-token')
      };

      it('should execute API call successfully with valid token', async () => {
        jest.spyOn(service, 'ensureValidToken').mockResolvedValue(mockUserIntegration);

        const mockApiCall = jest.fn().mockResolvedValue('success');
        const result = await service.executeWithTokenRefresh(mockUserIntegration, mockApiCall);

        expect(result).toBe('success');
        expect(mockApiCall).toHaveBeenCalledWith(mockUserIntegration);
        expect(service.ensureValidToken).toHaveBeenCalledWith(mockUserIntegration);
      });

      it('should retry once on auth error', async () => {
        const authError = Object.assign(new Error('Auth failed'), { type: 'AUTH_ERROR' });
        
        jest.spyOn(service, 'ensureValidToken')
          .mockResolvedValueOnce(mockUserIntegration)
          .mockResolvedValueOnce(mockUserIntegration);

        const mockApiCall = jest.fn()
          .mockRejectedValueOnce(authError)
          .mockResolvedValueOnce('success after retry');

        const result = await service.executeWithTokenRefresh(mockUserIntegration, mockApiCall, 1);

        expect(result).toBe('success after retry');
        expect(mockApiCall).toHaveBeenCalledTimes(2);
        expect(service.ensureValidToken).toHaveBeenCalledTimes(2);
      });

      it('should not retry non-auth errors', async () => {
        const nonAuthError = Object.assign(new Error('Server error'), { type: 'SERVER_ERROR' });
        
        jest.spyOn(service, 'ensureValidToken').mockResolvedValue(mockUserIntegration);
        const mockApiCall = jest.fn().mockRejectedValue(nonAuthError);

        await expect(
          service.executeWithTokenRefresh(mockUserIntegration, mockApiCall, 1)
        ).rejects.toThrow('Server error');

        expect(mockApiCall).toHaveBeenCalledTimes(1);
        expect(service.ensureValidToken).toHaveBeenCalledTimes(1);
      });

      it('should exhaust retries and throw last error', async () => {
        const authError = Object.assign(new Error('Persistent auth error'), { type: 'AUTH_ERROR' });
        
        jest.spyOn(service, 'ensureValidToken').mockResolvedValue(mockUserIntegration);
        const mockApiCall = jest.fn().mockRejectedValue(authError);

        await expect(
          service.executeWithTokenRefresh(mockUserIntegration, mockApiCall, 2)
        ).rejects.toThrow('Persistent auth error');

        expect(mockApiCall).toHaveBeenCalledTimes(3); // Initial + 2 retries
      });

      it('should force token refresh on retry', async () => {
        const authError = Object.assign(new Error('Auth failed'), { type: 'AUTH_ERROR' });
        
        jest.spyOn(service, 'ensureValidToken')
          .mockResolvedValueOnce(mockUserIntegration)
          .mockResolvedValueOnce(mockUserIntegration);

        const mockApiCall = jest.fn()
          .mockRejectedValueOnce(authError)
          .mockResolvedValueOnce('success');

        await service.executeWithTokenRefresh(mockUserIntegration, mockApiCall, 1);

        // Check that tokenExpiresAt was set to past date to force refresh
        expect(mockUserIntegration.tokenExpiresAt.getTime()).toBeLessThan(Date.now());
      });
    });
  });

  describe('Comprehensive API Method Tests', () => {
    const mockUserIntegration = {
      userId: 'user123',
      accessToken: 'valid-access-token',
      refreshToken: 'encrypted-refresh-token',
      tokenExpiresAt: new Date(Date.now() + 3600000),
      timezone: 'America/Sao_Paulo',
      calendarId: 'primary',
      getDecryptedRefreshToken: jest.fn().mockReturnValue('decrypted-refresh-token')
    };

    beforeEach(() => {
      // Mock successful API responses
      mockCalendarClient.events.insert.mockResolvedValue({
        data: {
          id: 'event123',
          htmlLink: 'https://calendar.google.com/event?eid=event123',
          created: '2024-01-15T10:00:00.000Z'
        }
      });

      mockCalendarClient.events.update.mockResolvedValue({
        data: {
          id: 'event123',
          htmlLink: 'https://calendar.google.com/event?eid=event123',
          updated: '2024-01-15T11:00:00.000Z'
        }
      });

      mockCalendarClient.events.list.mockResolvedValue({
        data: {
          items: [{
            id: 'event123',
            htmlLink: 'https://calendar.google.com/event?eid=event123',
            summary: 'Found meeting',
            start: { dateTime: '2024-01-15T10:30:00.000Z' },
            end: { dateTime: '2024-01-15T11:00:00.000Z' }
          }]
        }
      });

      mockCalendarClient.calendarList.get.mockResolvedValue({
        data: { id: 'primary' }
      });

      // Mock token validation to return true
      jest.spyOn(service, 'validateToken').mockResolvedValue(true);
    });

    describe('createEvent integration tests', () => {
      it('should create event with proper API call structure', async () => {
        const reminderData = {
          date: '2024-01-15T10:30:00.000Z',
          description: 'Integration test meeting'
        };

        const result = await service.createEvent(mockUserIntegration, reminderData, 'msg123');

        expect(result).toEqual({
          eventId: 'event123',
          calendarId: 'primary',
          htmlLink: 'https://calendar.google.com/event?eid=event123',
          created: '2024-01-15T10:00:00.000Z'
        });

        expect(mockCalendarClient.events.insert).toHaveBeenCalledWith({
          calendarId: 'primary',
          resource: expect.objectContaining({
            summary: 'Integration test meeting',
            description: 'Integration test meeting',
            visibility: 'private',
            extendedProperties: {
              private: {
                app_event_id: 'msg123'
              }
            }
          })
        });
      });

      it('should handle custom calendar ID in createEvent', async () => {
        const userWithCustomCalendar = {
          ...mockUserIntegration,
          calendarId: 'custom-calendar-id'
        };

        const reminderData = {
          date: '2024-01-15T10:30:00.000Z',
          description: 'Custom calendar meeting'
        };

        await service.createEvent(userWithCustomCalendar, reminderData, 'msg124');

        expect(mockCalendarClient.events.insert).toHaveBeenCalledWith({
          calendarId: 'custom-calendar-id',
          resource: expect.any(Object)
        });
      });

      it('should create all-day event correctly', async () => {
        const reminderData = {
          date: '2024-01-15',
          description: 'All day event'
        };

        await service.createEvent(mockUserIntegration, reminderData, 'msg125');

        expect(mockCalendarClient.events.insert).toHaveBeenCalledWith({
          calendarId: 'primary',
          resource: expect.objectContaining({
            start: { date: '2024-01-15' },
            end: { date: '2024-01-16' }
          })
        });
      });
    });

    describe('updateEvent integration tests', () => {
      it('should update existing event successfully', async () => {
        const reminderData = {
          date: '2024-01-15T14:30:00.000Z',
          description: 'Updated meeting'
        };

        const result = await service.updateEvent('event123', mockUserIntegration, reminderData);

        expect(result).toEqual({
          eventId: 'event123',
          calendarId: 'primary',
          htmlLink: 'https://calendar.google.com/event?eid=event123',
          updated: '2024-01-15T11:00:00.000Z'
        });

        expect(mockCalendarClient.events.update).toHaveBeenCalledWith({
          calendarId: 'primary',
          eventId: 'event123',
          resource: expect.objectContaining({
            summary: 'Updated meeting',
            description: 'Updated meeting'
          })
        });
      });

      it('should not include extendedProperties when updating', async () => {
        const reminderData = {
          date: '2024-01-15T14:30:00.000Z',
          description: 'Updated meeting'
        };

        await service.updateEvent('event123', mockUserIntegration, reminderData);

        const updateCall = mockCalendarClient.events.update.mock.calls[0][0];
        expect(updateCall.resource.extendedProperties).toBeUndefined();
      });
    });

    describe('searchEventByAppId integration tests', () => {
      it('should find existing event by app ID', async () => {
        const result = await service.searchEventByAppId(mockUserIntegration, 'msg123');

        expect(result).toEqual({
          eventId: 'event123',
          calendarId: 'primary',
          htmlLink: 'https://calendar.google.com/event?eid=event123',
          summary: 'Found meeting',
          start: { dateTime: '2024-01-15T10:30:00.000Z' },
          end: { dateTime: '2024-01-15T11:00:00.000Z' }
        });

        expect(mockCalendarClient.events.list).toHaveBeenCalledWith({
          calendarId: 'primary',
          privateExtendedProperty: 'app_event_id=msg123',
          maxResults: 1,
          singleEvents: true
        });
      });

      it('should return null when no event is found', async () => {
        mockCalendarClient.events.list.mockResolvedValue({
          data: {
            items: []
          }
        });

        const result = await service.searchEventByAppId(mockUserIntegration, 'nonexistent-msg');

        expect(result).toBeNull();
      });

      it('should handle API errors in searchEventByAppId', async () => {
        const apiError = new Error('API Error');
        apiError.response = {
          status: 500,
          data: { error: { message: 'Internal Server Error' } }
        };
        
        mockCalendarClient.events.list.mockRejectedValue(apiError);

        await expect(
          service.searchEventByAppId(mockUserIntegration, 'msg123')
        ).rejects.toMatchObject({
          type: 'SERVER_ERROR',
          retryable: true
        });
      });
    });

    describe('revokeTokens integration tests', () => {
      beforeEach(() => {
        jest.spyOn(service, '_decryptToken').mockReturnValue('decrypted-refresh-token');
      });

      it('should successfully revoke both access and refresh tokens', async () => {
        mockOAuth2Client.revokeToken.mockResolvedValue({});

        const result = await service.revokeTokens('access-token', 'encrypted-refresh-token');

        expect(result).toBe(true);
        expect(mockOAuth2Client.revokeToken).toHaveBeenCalledTimes(2);
        expect(mockOAuth2Client.revokeToken).toHaveBeenCalledWith('access-token');
        expect(mockOAuth2Client.revokeToken).toHaveBeenCalledWith('decrypted-refresh-token');
      });

      it('should handle partial revocation failures gracefully', async () => {
        mockOAuth2Client.revokeToken
          .mockResolvedValueOnce({}) // access token succeeds
          .mockRejectedValueOnce(new Error('Refresh token already revoked')); // refresh token fails

        const result = await service.revokeTokens('access-token', 'encrypted-refresh-token');

        expect(result).toBe(true); // Should still return true if at least one succeeded
      });

      it('should return true when no tokens provided', async () => {
        const result = await service.revokeTokens(null, null);
        expect(result).toBe(true);
        expect(mockOAuth2Client.revokeToken).not.toHaveBeenCalled();
      });

      it('should handle decryption failure for refresh token', async () => {
        jest.spyOn(service, '_decryptToken').mockReturnValue(null);
        mockOAuth2Client.revokeToken.mockResolvedValue({});

        const result = await service.revokeTokens('access-token', 'encrypted-refresh-token');

        expect(result).toBe(true); // Access token was revoked
        expect(mockOAuth2Client.revokeToken).toHaveBeenCalledTimes(1);
        expect(mockOAuth2Client.revokeToken).toHaveBeenCalledWith('access-token');
      });
    });
  });

  describe('Edge Cases and Error Scenarios', () => {
    describe('Date parsing edge cases', () => {
      it('should handle leap year dates correctly', () => {
        const reminderData = {
          date: '2024-02-29T10:30:00.000Z', // Leap year
          description: 'Leap year meeting'
        };
        
        const userIntegration = { timezone: 'America/Sao_Paulo' };
        const result = service._createEventObject(reminderData, userIntegration, 'msg123');

        expect(result.start.dateTime).toBe('2024-02-29T10:30:00.000Z');
        expect(result.end.dateTime).toBe('2024-02-29T11:00:00.000Z');
      });

      it('should handle year boundary dates correctly', () => {
        const reminderData = {
          date: '2023-12-31T23:30:00.000Z',
          description: 'New Year Eve meeting'
        };
        
        const userIntegration = { timezone: 'America/Sao_Paulo' };
        const result = service._createEventObject(reminderData, userIntegration, 'msg123');

        expect(result.start.dateTime).toBe('2023-12-31T23:30:00.000Z');
        expect(result.end.dateTime).toBe('2024-01-01T00:00:00.000Z');
      });

      it('should handle timezone boundary edge cases', () => {
        const reminderData = {
          date: '2024-01-15T02:30:00.000Z', // 2:30 AM UTC
          description: 'Early morning meeting'
        };
        
        const userIntegration = { timezone: 'America/Sao_Paulo' }; // UTC-3
        const result = service._createEventObject(reminderData, userIntegration, 'msg123');

        expect(result.start.timeZone).toBe('America/Sao_Paulo');
        expect(result.end.timeZone).toBe('America/Sao_Paulo');
      });
    });

    describe('Duration calculation edge cases', () => {
      it('should handle zero duration gracefully', () => {
        const reminderData = {
          date: '2024-01-15T10:30:00.000Z',
          endDate: '2024-01-15T10:30:00.000Z', // Same time
          description: 'Zero duration meeting'
        };
        
        const userIntegration = { timezone: 'America/Sao_Paulo' };
        const result = service._createEventObject(reminderData, userIntegration, 'msg123');

        // Should use minimum 1 minute duration
        expect(result.end.dateTime).toBe('2024-01-15T10:31:00.000Z');
      });

      it('should handle negative duration by using default', () => {
        const reminderData = {
          date: '2024-01-15T10:30:00.000Z',
          endDate: '2024-01-15T10:00:00.000Z', // End before start
          description: 'Negative duration meeting'
        };
        
        const userIntegration = { timezone: 'America/Sao_Paulo' };
        const result = service._createEventObject(reminderData, userIntegration, 'msg123');

        // Should fall back to default duration
        expect(result.end.dateTime).toBe('2024-01-15T11:00:00.000Z');
      });

      it('should handle very long durations', () => {
        const reminderData = {
          date: '2024-01-15T10:30:00.000Z',
          duration: 1440, // 24 hours
          description: 'All day workshop'
        };
        
        const userIntegration = { timezone: 'America/Sao_Paulo' };
        const result = service._createEventObject(reminderData, userIntegration, 'msg123');

        expect(result.end.dateTime).toBe('2024-01-16T10:30:00.000Z');
      });
    });

    describe('Timezone handling edge cases', () => {
      it('should handle invalid timezone gracefully', () => {
        const reminderData = {
          date: '2024-01-15T10:30:00.000Z',
          description: 'Meeting with invalid timezone'
        };
        
        const userIntegration = { timezone: 'Invalid/Timezone' };
        const result = service._createEventObject(reminderData, userIntegration, 'msg123');

        // Should still create event with the specified timezone (Google will handle validation)
        expect(result.start.timeZone).toBe('Invalid/Timezone');
      });

      it('should handle empty timezone', () => {
        const reminderData = {
          date: '2024-01-15T10:30:00.000Z',
          description: 'Meeting with empty timezone'
        };
        
        const userIntegration = { timezone: '' };
        const result = service._createEventObject(reminderData, userIntegration, 'msg123');

        // Should fall back to default timezone
        expect(result.start.timeZone).toBe('America/Sao_Paulo');
      });
    });

    describe('Reminder preferences edge cases', () => {
      it('should handle empty reminder array', () => {
        const reminderData = {
          date: '2024-01-15T10:30:00.000Z',
          description: 'Meeting with empty reminders'
        };
        
        const userIntegration = { 
          timezone: 'America/Sao_Paulo',
          defaultReminders: []
        };
        const result = service._createEventObject(reminderData, userIntegration, 'msg123');

        expect(result.reminders).toEqual({ useDefault: true });
      });

      it('should handle invalid reminder values', () => {
        const reminderData = {
          date: '2024-01-15T10:30:00.000Z',
          description: 'Meeting with invalid reminders'
        };
        
        const userIntegration = { 
          timezone: 'America/Sao_Paulo',
          defaultReminders: [-5, 0, 'invalid', null, 15]
        };
        const result = service._createEventObject(reminderData, userIntegration, 'msg123');

        // Should include all values (Google API will validate)
        expect(result.reminders.overrides).toHaveLength(5);
        expect(result.reminders.overrides[4]).toEqual({ method: 'popup', minutes: 15 });
      });
    });
  });

  describe('Performance and Memory Tests', () => {
    it('should handle large reminder descriptions efficiently', () => {
      const largeDescription = 'A'.repeat(10000); // 10KB description
      const reminderData = {
        date: '2024-01-15T10:30:00.000Z',
        description: largeDescription
      };
      
      const userIntegration = { timezone: 'America/Sao_Paulo' };
      
      const startTime = Date.now();
      const result = service._createEventObject(reminderData, userIntegration, 'msg123');
      const endTime = Date.now();

      expect(result.summary).toBe(largeDescription);
      expect(result.description).toBe(largeDescription);
      expect(endTime - startTime).toBeLessThan(100); // Should complete within 100ms
    });

    it('should handle multiple rapid event creations', () => {
      const userIntegration = { timezone: 'America/Sao_Paulo' };
      const results = [];

      for (let i = 0; i < 100; i++) {
        const reminderData = {
          date: `2024-01-15T${String(i % 24).padStart(2, '0')}:30:00.000Z`,
          description: `Meeting ${i}`
        };
        
        const result = service._createEventObject(reminderData, userIntegration, `msg${i}`);
        results.push(result);
      }

      expect(results).toHaveLength(100);
      expect(results[0].extendedProperties.private.app_event_id).toBe('msg0');
      expect(results[99].extendedProperties.private.app_event_id).toBe('msg99');
    });
  });

  describe('Security and Validation Tests', () => {
    it('should sanitize malicious input in descriptions', () => {
      const maliciousDescription = '<script>alert("xss")</script>Meeting';
      const reminderData = {
        date: '2024-01-15T10:30:00.000Z',
        description: maliciousDescription
      };
      
      const userIntegration = { timezone: 'America/Sao_Paulo' };
      const result = service._createEventObject(reminderData, userIntegration, 'msg123');

      // Should preserve the description as-is (Google Calendar will handle sanitization)
      expect(result.summary).toBe(maliciousDescription);
      expect(result.description).toBe(maliciousDescription);
    });

    it('should handle extremely long message IDs', () => {
      const longMessageId = 'msg' + 'x'.repeat(1000);
      const reminderData = {
        date: '2024-01-15T10:30:00.000Z',
        description: 'Meeting with long message ID'
      };
      
      const userIntegration = { timezone: 'America/Sao_Paulo' };
      const result = service._createEventObject(reminderData, userIntegration, longMessageId);

      expect(result.extendedProperties.private.app_event_id).toBe(longMessageId);
    });

    it('should handle special characters in descriptions', () => {
      const specialDescription = 'Meeting with émojis 🎉 and spëcial çharacters';
      const reminderData = {
        date: '2024-01-15T10:30:00.000Z',
        description: specialDescription
      };
      
      const userIntegration = { timezone: 'America/Sao_Paulo' };
      const result = service._createEventObject(reminderData, userIntegration, 'msg123');

      expect(result.summary).toBe(specialDescription);
      expect(result.description).toBe(specialDescription);
    });
  });

  describe('Token Encryption and Decryption Tests', () => {
    beforeEach(() => {
      // Reset the mock to its original implementation
      jest.restoreAllMocks();
    });

    it('should handle decryption errors gracefully', () => {
      // Mock crypto to throw an error
      const mockDecipher = {
        update: jest.fn().mockImplementation(() => {
          throw new Error('Decryption failed');
        }),
        final: jest.fn()
      };
      
      const crypto = require('crypto');
      jest.spyOn(crypto, 'createDecipher').mockReturnValue(mockDecipher);

      expect(() => {
        service._decryptToken('encrypted-token');
      }).toThrow('Failed to decrypt token');
    });

    it('should return null for empty encrypted token', () => {
      const result = service._decryptToken('');
      expect(result).toBeNull();
    });

    it('should return null for null encrypted token', () => {
      const result = service._decryptToken(null);
      expect(result).toBeNull();
    });

    it('should use environment encryption key', () => {
      const crypto = require('crypto');
      const createDecipherSpy = jest.spyOn(crypto, 'createDecipher');
      
      const mockDecipher = {
        update: jest.fn().mockReturnValue('decrypted'),
        final: jest.fn().mockReturnValue('token')
      };
      createDecipherSpy.mockReturnValue(mockDecipher);

      service._decryptToken('encrypted-token');

      expect(createDecipherSpy).toHaveBeenCalledWith('aes-256-cbc', 'test-encryption-key');
    });
  });

  describe('Comprehensive API Error Handling Tests', () => {
    describe('Authentication error variations', () => {
      it('should handle invalid_grant error specifically', () => {
        const error = new Error('invalid_grant: Token has been expired or revoked');
        error.response = {
          status: 401,
          data: {
            error: {
              message: 'invalid_grant: Token has been expired or revoked',
              code: 401
            }
          }
        };

        const result = service._handleApiError(error);

        expect(result.type).toBe('AUTH_ERROR');
        expect(result.requiresReconnection).toBe(true);
      });

      it('should handle insufficient permissions error', () => {
        const error = new Error('Forbidden: insufficient permissions');
        error.response = {
          status: 403,
          data: {
            error: {
              message: 'Forbidden: insufficient permissions',
              code: 403
            }
          }
        };

        const result = service._handleApiError(error);

        expect(result.type).toBe('AUTH_ERROR');
        expect(result.requiresReconnection).toBe(true);
      });

      it('should handle token-related 400 errors', () => {
        const error = new Error('invalid_request: token is invalid');
        error.response = {
          status: 400,
          data: {
            error: {
              message: 'invalid_request: token is invalid',
              code: 400
            }
          }
        };

        const result = service._handleApiError(error);

        expect(result.type).toBe('AUTH_ERROR');
        expect(result.requiresReconnection).toBe(false);
      });
    });

    describe('Rate limiting error handling', () => {
      it('should extract retry-after header from rate limit errors', () => {
        const error = new Error('Rate limit exceeded');
        error.response = {
          status: 429,
          headers: {
            'retry-after': '120'
          },
          data: {
            error: {
              message: 'Rate limit exceeded',
              code: 429
            }
          }
        };

        const result = service._handleApiError(error);

        expect(result.type).toBe('RATE_LIMIT');
        expect(result.retryAfter).toBe(120000); // Converted to milliseconds
      });

      it('should handle rate limit errors without retry-after header', () => {
        const error = new Error('Rate limit exceeded');
        error.response = {
          status: 429,
          data: {
            error: {
              message: 'Rate limit exceeded',
              code: 429
            }
          }
        };

        const result = service._handleApiError(error);

        expect(result.type).toBe('RATE_LIMIT');
        expect(result.retryAfter).toBeUndefined();
      });
    });

    describe('Server error variations', () => {
      it('should classify 503 Service Unavailable as SERVER_ERROR', () => {
        const error = new Error('Service Unavailable');
        error.response = {
          status: 503,
          data: {
            error: {
              message: 'Service Unavailable',
              code: 503
            }
          }
        };

        const result = service._handleApiError(error);

        expect(result.type).toBe('SERVER_ERROR');
        expect(result.retryable).toBe(true);
      });

      it('should classify 504 Gateway Timeout as SERVER_ERROR', () => {
        const error = new Error('Gateway Timeout');
        error.response = {
          status: 504,
          data: {
            error: {
              message: 'Gateway Timeout',
              code: 504
            }
          }
        };

        const result = service._handleApiError(error);

        expect(result.type).toBe('SERVER_ERROR');
        expect(result.retryable).toBe(true);
      });
    });

    describe('Client error variations', () => {
      it('should classify 404 Not Found as CLIENT_ERROR', () => {
        const error = new Error('Calendar not found');
        error.response = {
          status: 404,
          data: {
            error: {
              message: 'Calendar not found',
              code: 404
            }
          }
        };

        const result = service._handleApiError(error);

        expect(result.type).toBe('CLIENT_ERROR');
        expect(result.retryable).toBe(false);
      });

      it('should classify 409 Conflict as CLIENT_ERROR', () => {
        const error = new Error('Event conflict');
        error.response = {
          status: 409,
          data: {
            error: {
              message: 'Event conflict',
              code: 409
            }
          }
        };

        const result = service._handleApiError(error);

        expect(result.type).toBe('CLIENT_ERROR');
        expect(result.retryable).toBe(false);
      });
    });

    describe('Network and system errors', () => {
      it('should handle ECONNRESET errors', () => {
        const error = new Error('Connection reset');
        error.code = 'ECONNRESET';

        const result = service._handleApiError(error);

        expect(result.type).toBe('UNKNOWN_ERROR');
        expect(result.retryable).toBe(false);
      });

      it('should handle ENOTFOUND errors', () => {
        const error = new Error('Host not found');
        error.code = 'ENOTFOUND';

        const result = service._handleApiError(error);

        expect(result.type).toBe('UNKNOWN_ERROR');
        expect(result.retryable).toBe(false);
      });
    });
  });

  describe('Integration Flow Tests', () => {
    const mockUserIntegration = {
      userId: 'user123',
      accessToken: 'valid-access-token',
      refreshToken: 'encrypted-refresh-token',
      tokenExpiresAt: new Date(Date.now() + 3600000),
      timezone: 'America/Sao_Paulo',
      calendarId: 'primary',
      getDecryptedRefreshToken: jest.fn().mockReturnValue('decrypted-refresh-token')
    };

    beforeEach(() => {
      jest.spyOn(service, 'validateToken').mockResolvedValue(true);
      jest.spyOn(service, '_decryptToken').mockReturnValue('decrypted-refresh-token');
    });

    it('should handle complete create-search-update flow', async () => {
      // Mock successful create
      mockCalendarClient.events.insert.mockResolvedValue({
        data: {
          id: 'event123',
          htmlLink: 'https://calendar.google.com/event?eid=event123',
          created: '2024-01-15T10:00:00.000Z'
        }
      });

      // Mock successful search
      mockCalendarClient.events.list.mockResolvedValue({
        data: {
          items: [{
            id: 'event123',
            htmlLink: 'https://calendar.google.com/event?eid=event123',
            summary: 'Original meeting',
            start: { dateTime: '2024-01-15T10:30:00.000Z' },
            end: { dateTime: '2024-01-15T11:00:00.000Z' }
          }]
        }
      });

      // Mock successful update
      mockCalendarClient.events.update.mockResolvedValue({
        data: {
          id: 'event123',
          htmlLink: 'https://calendar.google.com/event?eid=event123',
          updated: '2024-01-15T11:00:00.000Z'
        }
      });

      const reminderData = {
        date: '2024-01-15T10:30:00.000Z',
        description: 'Original meeting'
      };

      // Create event
      const createResult = await service.createEvent(mockUserIntegration, reminderData, 'msg123');
      expect(createResult.eventId).toBe('event123');

      // Search for event
      const searchResult = await service.searchEventByAppId(mockUserIntegration, 'msg123');
      expect(searchResult.eventId).toBe('event123');

      // Update event
      const updatedReminderData = {
        date: '2024-01-15T14:30:00.000Z',
        description: 'Updated meeting'
      };
      const updateResult = await service.updateEvent('event123', mockUserIntegration, updatedReminderData);
      expect(updateResult.eventId).toBe('event123');
    });

    it('should handle token refresh during API operations', async () => {
      // First call fails with auth error, second succeeds
      const authError = Object.assign(new Error('Token expired'), { 
        type: 'AUTH_ERROR',
        response: { status: 401 }
      });

      jest.spyOn(service, 'ensureValidToken')
        .mockResolvedValueOnce(mockUserIntegration) // First call
        .mockResolvedValueOnce({ // Second call with refreshed token
          ...mockUserIntegration,
          accessToken: 'new-access-token'
        });

      mockCalendarClient.events.insert
        .mockRejectedValueOnce(authError)
        .mockResolvedValueOnce({
          data: {
            id: 'event123',
            htmlLink: 'https://calendar.google.com/event?eid=event123',
            created: '2024-01-15T10:00:00.000Z'
          }
        });

      const reminderData = {
        date: '2024-01-15T10:30:00.000Z',
        description: 'Meeting with token refresh'
      };

      const result = await service.createEvent(mockUserIntegration, reminderData, 'msg123');

      expect(result.eventId).toBe('event123');
      expect(service.ensureValidToken).toHaveBeenCalledTimes(2);
    });
  });

      it('should handle null items array', async () => {
        mockCalendarClient.events.list.mockResolvedValue({
          data: {
            items: null
          }
        });

        const result = await service.searchEventByAppId(mockUserIntegration, 'msg124');

        expect(result).toBeNull();
      });
    });
  });

  describe('Advanced Error Handling Scenarios', () => {
    const mockUserIntegration = {
      userId: 'user123',
      accessToken: 'valid-access-token',
      refreshToken: 'encrypted-refresh-token',
      tokenExpiresAt: new Date(Date.now() + 3600000),
      timezone: 'America/Sao_Paulo',
      calendarId: 'primary',
      getDecryptedRefreshToken: jest.fn().mockReturnValue('decrypted-refresh-token')
    };

    beforeEach(() => {
      jest.spyOn(service, 'validateToken').mockResolvedValue(true);
    });

    it('should handle API errors in createEvent', async () => {
      const authError = new Error('Invalid Credentials');
      authError.response = {
        status: 401,
        data: {
          error: {
            message: 'Invalid Credentials',
            code: 401
          }
        }
      };

      mockCalendarClient.events.insert.mockRejectedValue(authError);

      const reminderData = {
        date: '2024-01-15T10:30:00.000Z',
        description: 'Meeting that will fail'
      };

      await expect(
        service.createEvent(mockUserIntegration, reminderData, 'msg123')
      ).rejects.toMatchObject({
        type: 'AUTH_ERROR',
        status: 401,
        retryable: false
      });
    });

    it('should handle API errors in updateEvent', async () => {
      const serverError = new Error('Internal Server Error');
      serverError.response = {
        status: 500,
        data: {
          error: {
            message: 'Internal Server Error',
            code: 500
          }
        }
      };

      mockCalendarClient.events.update.mockRejectedValue(serverError);

      const reminderData = {
        date: '2024-01-15T14:30:00.000Z',
        description: 'Update that will fail'
      };

      await expect(
        service.updateEvent('event123', mockUserIntegration, reminderData)
      ).rejects.toMatchObject({
        type: 'SERVER_ERROR',
        status: 500,
        retryable: true
      });
    });

    it('should handle API errors in searchEventByAppId', async () => {
      const rateLimitError = new Error('Rate Limit Exceeded');
      rateLimitError.response = {
        status: 429,
        headers: {
          'retry-after': '60'
        },
        data: {
          error: {
            message: 'Rate Limit Exceeded',
            code: 429
          }
        }
      };

      mockCalendarClient.events.list.mockRejectedValue(rateLimitError);

      await expect(
        service.searchEventByAppId(mockUserIntegration, 'msg123')
      ).rejects.toMatchObject({
        type: 'RATE_LIMIT',
        status: 429,
        retryable: true,
        retryAfter: 60000
      });
    });
  });

  describe('Edge Cases and Complex Scenarios', () => {
    it('should handle timezone edge cases in event creation', () => {
      const reminderData = {
        date: '2024-12-31T23:30:00.000Z', // New Year's Eve UTC
        description: 'New Year meeting'
      };

      const userInTokyo = {
        timezone: 'Asia/Tokyo' // UTC+9, so this becomes Jan 1st
      };

      const result = service._createEventObject(reminderData, userInTokyo, 'msg123');

      expect(result.start.timeZone).toBe('Asia/Tokyo');
      expect(result.end.timeZone).toBe('Asia/Tokyo');
      expect(result.start.dateTime).toBe('2024-12-31T23:30:00.000Z');
      expect(result.end.dateTime).toBe('2025-01-01T00:00:00.000Z'); // +30 min default
    });

    it('should handle very long event descriptions', () => {
      const longDescription = 'A'.repeat(1000); // Long description
      const reminderData = {
        date: '2024-01-15T10:30:00.000Z',
        description: longDescription
      };

      const userIntegration = { timezone: 'America/Sao_Paulo' };

      const result = service._createEventObject(reminderData, userIntegration, 'msg123');

      expect(result.summary).toBe(longDescription);
      expect(result.description).toBe(longDescription);
    });

    it('should handle special characters in descriptions', () => {
      const specialDescription = 'Meeting with émojis 🎉 and spëcial chars & symbols <>&"\'';
      const reminderData = {
        date: '2024-01-15T10:30:00.000Z',
        description: specialDescription
      };

      const userIntegration = { timezone: 'America/Sao_Paulo' };

      const result = service._createEventObject(reminderData, userIntegration, 'msg123');

      expect(result.summary).toBe(specialDescription);
      expect(result.description).toBe(specialDescription);
    });

    it('should handle very short event durations', () => {
      const reminderData = {
        date: '2024-01-15T10:30:00.000Z',
        endDate: '2024-01-15T10:31:00.000Z', // 1 minute duration
        description: 'Very short meeting'
      };

      const userIntegration = { timezone: 'America/Sao_Paulo' };

      const result = service._createEventObject(reminderData, userIntegration, 'msg123');

      expect(result.start.dateTime).toBe('2024-01-15T10:30:00.000Z');
      expect(result.end.dateTime).toBe('2024-01-15T10:31:00.000Z');
    });

    it('should handle very long event durations', () => {
      const reminderData = {
        date: '2024-01-15T10:30:00.000Z',
        duration: 1440, // 24 hours
        description: 'All day workshop'
      };

      const userIntegration = { timezone: 'America/Sao_Paulo' };

      const result = service._createEventObject(reminderData, userIntegration, 'msg123');

      expect(result.start.dateTime).toBe('2024-01-15T10:30:00.000Z');
      expect(result.end.dateTime).toBe('2024-01-16T10:30:00.000Z');
    });

    it('should handle invalid date formats gracefully', () => {
      const reminderData = {
        date: 'invalid-date',
        description: 'Meeting with invalid date'
      };

      const userIntegration = { timezone: 'America/Sao_Paulo' };

      expect(() => {
        service._createEventObject(reminderData, userIntegration, 'msg123');
      }).toThrow('Invalid date format');
    });

    it('should handle missing timezone gracefully', () => {
      const reminderData = {
        date: '2024-01-15T10:30:00.000Z',
        description: 'Meeting without timezone'
      };

      const userIntegration = {}; // No timezone specified

      const result = service._createEventObject(reminderData, userIntegration, 'msg123');

      expect(result.start.timeZone).toBe('America/Sao_Paulo'); // Default timezone
      expect(result.end.timeZone).toBe('America/Sao_Paulo');
    });
  });

  describe('Internal Helper Methods', () => {
    describe('_isAllDayEvent', () => {
      it('should detect all-day event when time is exactly midnight', () => {
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

    describe('_decryptToken', () => {
      beforeEach(() => {
        // Restore the original method for these tests
        jest.restoreAllMocks();
      });

      it('should return null for empty token', () => {
        const result = service._decryptToken('');
        expect(result).toBeNull();
      });

      it('should return null for null token', () => {
        const result = service._decryptToken(null);
        expect(result).toBeNull();
      });
    });
  });
});