import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';
import googleIntegrationRouter from '../../src/routes/googleIntegration.js';
import UserGoogleIntegrationService from '../../src/services/userGoogleIntegrationService.js';
import GoogleCalendarService from '../../src/services/googleCalendarService.js';
import User from '../../src/models/User.js';

// Mock dependencies
jest.mock('../../src/services/userGoogleIntegrationService.js', () => ({
  default: {
    getUserIntegration: jest.fn(),
    updateUserIntegration: jest.fn(),
    connectGoogle: jest.fn(),
    disconnectGoogle: jest.fn()
  }
}));

jest.mock('../../src/services/googleCalendarService.js', () => ({
  default: {
    revokeTokens: jest.fn()
  }
}));

jest.mock('../../src/models/User.js', () => ({
  default: {
    findOne: jest.fn()
  }
}));
jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        generateAuthUrl: jest.fn().mockReturnValue('https://accounts.google.com/oauth/authorize?test=true'),
        getToken: jest.fn().mockResolvedValue({
          tokens: {
            access_token: 'test_access_token',
            refresh_token: 'test_refresh_token',
            expiry_date: Date.now() + 3600000
          }
        }),
        setCredentials: jest.fn()
      }))
    },
    calendar: jest.fn().mockReturnValue({
      calendarList: {
        list: jest.fn().mockResolvedValue({
          data: {
            items: [
              {
                id: 'primary',
                summary: 'Primary Calendar',
                primary: true,
                accessRole: 'owner',
                backgroundColor: '#9fc6e7',
                foregroundColor: '#000000'
              },
              {
                id: 'test@example.com',
                summary: 'Test Calendar',
                primary: false,
                accessRole: 'writer',
                backgroundColor: '#f83a22',
                foregroundColor: '#ffffff'
              }
            ]
          }
        })
      }
    })
  }
}));

// Create test app
const app = express();
app.use(express.json());
app.use('/api/google', googleIntegrationRouter);

// Test data
const mockUser = {
  _id: '507f1f77bcf86cd799439011',
  name: 'Test User',
  phoneNumber: '+5511999999999',
  email: 'test@example.com'
};

const mockIntegration = {
  userId: mockUser._id,
  connected: true,
  calendarSyncEnabled: true,
  timezone: 'America/Sao_Paulo',
  calendarId: 'primary',
  defaultReminders: [15, 30],
  accessToken: 'test_access_token',
  refreshToken: 'encrypted_refresh_token',
  tokenExpiresAt: new Date(Date.now() + 3600000),
  hasValidIntegration: jest.fn().mockReturnValue(true),
  getDecryptedRefreshToken: jest.fn().mockReturnValue('decrypted_refresh_token')
};

describe('Google Integration Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Default mock implementations
    User.findOne.mockResolvedValue(mockUser);
    UserGoogleIntegrationService.getUserIntegration.mockResolvedValue(mockIntegration);
  });

  describe('POST /api/google/auth-url', () => {
    it('should generate OAuth URL for authenticated user', async () => {
      const response = await request(app)
        .post('/api/google/auth-url')
        .send({ phoneNumber: mockUser.phoneNumber });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.authUrl).toContain('https://accounts.google.com/oauth/authorize');
      expect(response.body.data.state).toBeDefined();
    });

    it('should return 400 if phone number is missing', async () => {
      const response = await request(app)
        .post('/api/google/auth-url')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Phone number is required for authentication');
    });

    it('should return 404 if user not found', async () => {
      User.findOne.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/google/auth-url')
        .send({ phoneNumber: '+5511888888888' });

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('User not found');
    });
  });

  describe('POST /api/google/connect', () => {
    it('should connect Google account with valid authorization code', async () => {
      UserGoogleIntegrationService.connectGoogle.mockResolvedValue(mockIntegration);

      const response = await request(app)
        .post('/api/google/connect')
        .send({ 
          phoneNumber: mockUser.phoneNumber,
          code: 'test_auth_code'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.connected).toBe(true);
      expect(response.body.message).toBe('Google account connected successfully');
      expect(UserGoogleIntegrationService.connectGoogle).toHaveBeenCalledWith(
        mockUser._id,
        expect.objectContaining({
          access_token: 'test_access_token',
          refresh_token: 'test_refresh_token'
        })
      );
    });

    it('should return 400 if authorization code is missing', async () => {
      const response = await request(app)
        .post('/api/google/connect')
        .send({ phoneNumber: mockUser.phoneNumber });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Authorization code is required');
    });

    it('should validate state parameter if provided', async () => {
      const validState = Buffer.from(JSON.stringify({
        userId: mockUser._id.toString(),
        timestamp: Date.now()
      })).toString('base64');

      UserGoogleIntegrationService.connectGoogle.mockResolvedValue(mockIntegration);

      const response = await request(app)
        .post('/api/google/connect')
        .send({ 
          phoneNumber: mockUser.phoneNumber,
          code: 'test_auth_code',
          state: validState
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject invalid state parameter', async () => {
      const invalidState = Buffer.from(JSON.stringify({
        userId: 'different_user_id',
        timestamp: Date.now()
      })).toString('base64');

      const response = await request(app)
        .post('/api/google/connect')
        .send({ 
          phoneNumber: mockUser.phoneNumber,
          code: 'test_auth_code',
          state: invalidState
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Invalid state parameter');
    });
  });

  describe('POST /api/google/disconnect', () => {
    it('should disconnect Google account and revoke tokens', async () => {
      const disconnectedIntegration = { ...mockIntegration, connected: false, calendarSyncEnabled: false };
      UserGoogleIntegrationService.disconnectGoogle.mockResolvedValue(disconnectedIntegration);
      GoogleCalendarService.revokeTokens.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/google/disconnect')
        .send({ phoneNumber: mockUser.phoneNumber });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.connected).toBe(false);
      expect(response.body.data.calendarSyncEnabled).toBe(false);
      expect(response.body.message).toBe('Google account disconnected successfully');
      
      expect(GoogleCalendarService.revokeTokens).toHaveBeenCalledWith(
        mockIntegration.accessToken,
        mockIntegration.refreshToken
      );
      expect(UserGoogleIntegrationService.disconnectGoogle).toHaveBeenCalledWith(mockUser._id);
    });

    it('should still disconnect even if token revocation fails', async () => {
      const disconnectedIntegration = { ...mockIntegration, connected: false, calendarSyncEnabled: false };
      UserGoogleIntegrationService.disconnectGoogle.mockResolvedValue(disconnectedIntegration);
      GoogleCalendarService.revokeTokens.mockRejectedValue(new Error('Token revocation failed'));

      const response = await request(app)
        .post('/api/google/disconnect')
        .send({ phoneNumber: mockUser.phoneNumber });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.connected).toBe(false);
    });

    it('should handle case where user has no integration', async () => {
      UserGoogleIntegrationService.getUserIntegration.mockResolvedValue(null);
      UserGoogleIntegrationService.disconnectGoogle.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/google/disconnect')
        .send({ phoneNumber: mockUser.phoneNumber });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(GoogleCalendarService.revokeTokens).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/google/status', () => {
    it('should return integration status for connected user', async () => {
      const response = await request(app)
        .post('/api/google/status')
        .send({ phoneNumber: mockUser.phoneNumber });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({
        connected: true,
        calendarSyncEnabled: true,
        timezone: 'America/Sao_Paulo',
        calendarId: 'primary',
        defaultReminders: [15, 30],
        tokenExpiresAt: mockIntegration.tokenExpiresAt.toISOString(),
        hasValidIntegration: true
      });
    });

    it('should return default status for user without integration', async () => {
      UserGoogleIntegrationService.getUserIntegration.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/google/status')
        .send({ phoneNumber: mockUser.phoneNumber });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({
        connected: false,
        calendarSyncEnabled: false,
        timezone: 'America/Sao_Paulo',
        calendarId: null,
        defaultReminders: []
      });
    });
  });

  describe('POST /api/google/preferences', () => {
    it('should update calendar sync preferences', async () => {
      const updatedIntegration = { 
        ...mockIntegration, 
        calendarSyncEnabled: false,
        timezone: 'America/New_York',
        defaultReminders: [10, 60]
      };
      UserGoogleIntegrationService.updateUserIntegration.mockResolvedValue(updatedIntegration);

      const response = await request(app)
        .post('/api/google/preferences')
        .send({ 
          phoneNumber: mockUser.phoneNumber,
          calendarSyncEnabled: false,
          timezone: 'America/New_York',
          defaultReminders: [10, 60]
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.calendarSyncEnabled).toBe(false);
      expect(response.body.data.timezone).toBe('America/New_York');
      expect(response.body.data.defaultReminders).toEqual([10, 60]);
      expect(response.body.message).toBe('Preferences updated successfully');
    });

    it('should validate reminder values', async () => {
      const response = await request(app)
        .post('/api/google/preferences')
        .send({ 
          phoneNumber: mockUser.phoneNumber,
          defaultReminders: ['invalid', -5, 10.5]
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('defaultReminders must be an array of non-negative integers');
    });

    it('should require Google account to be connected', async () => {
      const disconnectedIntegration = { ...mockIntegration, connected: false };
      UserGoogleIntegrationService.getUserIntegration.mockResolvedValue(disconnectedIntegration);

      const response = await request(app)
        .post('/api/google/preferences')
        .send({ 
          phoneNumber: mockUser.phoneNumber,
          calendarSyncEnabled: true
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Google account must be connected before setting preferences');
    });

    it('should return 400 if no valid preferences provided', async () => {
      const response = await request(app)
        .post('/api/google/preferences')
        .send({ 
          phoneNumber: mockUser.phoneNumber,
          invalidField: 'value'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('No valid preferences provided to update');
    });
  });

  describe('POST /api/google/calendars', () => {
    it('should return list of user calendars', async () => {
      const response = await request(app)
        .post('/api/google/calendars')
        .send({ phoneNumber: mockUser.phoneNumber });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.calendars).toHaveLength(2);
      expect(response.body.data.calendars[0]).toEqual({
        id: 'primary',
        summary: 'Primary Calendar',
        description: undefined,
        primary: true,
        accessRole: 'owner',
        backgroundColor: '#9fc6e7',
        foregroundColor: '#000000'
      });
      expect(response.body.data.currentCalendarId).toBe('primary');
    });

    it('should require Google account to be connected', async () => {
      const disconnectedIntegration = { ...mockIntegration, connected: false };
      UserGoogleIntegrationService.getUserIntegration.mockResolvedValue(disconnectedIntegration);

      const response = await request(app)
        .post('/api/google/calendars')
        .send({ phoneNumber: mockUser.phoneNumber });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Google account must be connected to list calendars');
    });

    it('should handle authentication errors', async () => {
      const { google } = await import('googleapis');
      const mockCalendar = google.calendar();
      mockCalendar.calendarList.list.mockRejectedValue({
        response: { status: 401 },
        message: 'Invalid credentials'
      });

      const response = await request(app)
        .post('/api/google/calendars')
        .send({ phoneNumber: mockUser.phoneNumber });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Google authentication expired. Please reconnect your account.');
      expect(response.body.requiresReconnection).toBe(true);
    });
  });

  describe('Authentication middleware', () => {
    it('should handle database errors during authentication', async () => {
      User.findOne.mockRejectedValue(new Error('Database connection failed'));

      const response = await request(app)
        .post('/api/google/status')
        .send({ phoneNumber: mockUser.phoneNumber });

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Authentication failed');
    });
  });
});