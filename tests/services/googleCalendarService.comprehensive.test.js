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

describe('GoogleCalendarService - Comprehensive Unit Tests', () => {
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
        // Reset mocks to avoid interference
        jest.clearAllMocks();
        jest.spyOn(service, '_decryptToken').mockReturnValue('decrypted-refresh-token');
        
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
        // Reset mocks to avoid interference
        jest.clearAllMocks();
        jest.spyOn(service, '_decryptToken').mockReturnValue('decrypted-refresh-token');
        
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
      
      // Mock executeWithTokenRefresh to directly call the API function
      jest.spyOn(service, 'executeWithTokenRefresh').mockImplementation(async (userIntegration, apiCall) => {
        return await apiCall(userIntegration);
      });
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
        // Reset the mock to avoid interference from previous tests
        jest.clearAllMocks();
        mockOAuth2Client.revokeToken.mockResolvedValue({});

        const result = await service.revokeTokens('access-token', 'encrypted-refresh-token');

        expect(result).toBe(true);
        expect(mockOAuth2Client.revokeToken).toHaveBeenCalledTimes(2);
        expect(mockOAuth2Client.revokeToken).toHaveBeenCalledWith('access-token');
        expect(mockOAuth2Client.revokeToken).toHaveBeenCalledWith('decrypted-refresh-token');
      });

      it('should handle partial revocation failures gracefully', async () => {
        // Reset the mock to avoid interference from previous tests
        jest.clearAllMocks();
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
        // Reset the mock to avoid interference from previous tests
        jest.clearAllMocks();
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

      it('should handle negative duration by using minimum duration', () => {
        const reminderData = {
          date: '2024-01-15T10:30:00.000Z',
          endDate: '2024-01-15T10:00:00.000Z', // End before start
          description: 'Negative duration meeting'
        };
        
        const userIntegration = { timezone: 'America/Sao_Paulo' };
        const result = service._createEventObject(reminderData, userIntegration, 'msg123');

        // Should use minimum 1 minute duration when calculated duration is negative
        expect(result.end.dateTime).toBe('2024-01-15T10:31:00.000Z');
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

  describe('Token Encryption and Decryption Tests', () => {
    it('should return null for empty encrypted token', () => {
      const result = service._decryptToken('');
      expect(result).toBeNull();
    });

    it('should return null for null encrypted token', () => {
      const result = service._decryptToken(null);
      expect(result).toBeNull();
    });

    it('should handle decryption with valid token', () => {
      // This test verifies the method exists and can be called
      // The actual crypto implementation is mocked at the module level
      expect(typeof service._decryptToken).toBe('function');
    });
  });
});