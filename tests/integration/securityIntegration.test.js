import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import UserGoogleIntegration from '../../src/models/UserGoogleIntegration.js';
import userGoogleIntegrationService from '../../src/services/userGoogleIntegrationService.js';
import securityUtils from '../../src/utils/securityUtils.js';

describe('Security Integration Tests', () => {
  let testUserId;

  beforeAll(async () => {
    // Connect to test database
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/test');
    }
  });

  beforeEach(async () => {
    testUserId = new mongoose.Types.ObjectId();
    // Clean up any existing test data
    await UserGoogleIntegration.deleteMany({ userId: testUserId });
  });

  afterAll(async () => {
    // Clean up test data
    await UserGoogleIntegration.deleteMany({ userId: testUserId });
    await mongoose.connection.close();
  });

  describe('End-to-End Token Security', () => {
    test('should encrypt tokens on save and decrypt on retrieval', async () => {
      const tokenData = {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token-very-sensitive',
        expires_in: 3600
      };

      // Connect user with Google
      const integration = await userGoogleIntegrationService.connectGoogle(
        testUserId.toString(),
        tokenData,
        'test-correlation-id'
      );

      expect(integration).toBeTruthy();
      expect(integration.connected).toBe(true);
      expect(integration.accessToken).toBe(tokenData.access_token);

      // Verify refresh token is encrypted in database
      const savedIntegration = await UserGoogleIntegration.findOne({ userId: testUserId });
      expect(savedIntegration.refreshToken).not.toBe(tokenData.refresh_token);
      expect(savedIntegration.refreshToken).toBeTruthy();

      // Verify we can decrypt the refresh token
      const decryptedToken = savedIntegration.getDecryptedRefreshToken();
      expect(decryptedToken).toBe(tokenData.refresh_token);
    });

    test('should securely disconnect and wipe tokens', async () => {
      const tokenData = {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expires_in: 3600
      };

      // Connect user
      await userGoogleIntegrationService.connectGoogle(
        testUserId.toString(),
        tokenData
      );

      // Disconnect user
      const disconnectedIntegration = await userGoogleIntegrationService.disconnectGoogle(
        testUserId.toString(),
        'disconnect-correlation-id'
      );

      expect(disconnectedIntegration.connected).toBe(false);
      expect(disconnectedIntegration.calendarSyncEnabled).toBe(false);
      expect(disconnectedIntegration.accessToken).toBeNull();
      expect(disconnectedIntegration.refreshToken).toBeNull();
      expect(disconnectedIntegration.tokenExpiresAt).toBeNull();
    });
  });

  describe('Input Validation Security', () => {
    test('should validate and sanitize user inputs', async () => {
      const maliciousData = {
        access_token: 'valid-token',
        refresh_token: 'valid-refresh-token',
        expires_in: 3600
      };

      // Test with malicious user ID
      await expect(
        userGoogleIntegrationService.connectGoogle(
          '<script>alert("xss")</script>',
          maliciousData
        )
      ).rejects.toThrow();

      // Test with invalid token data
      await expect(
        userGoogleIntegrationService.connectGoogle(
          testUserId.toString(),
          null
        )
      ).rejects.toThrow('Token data is required');

      // Test with missing required fields
      await expect(
        userGoogleIntegrationService.connectGoogle(
          testUserId.toString(),
          { access_token: 'token' } // missing refresh_token
        )
      ).rejects.toThrow('Access token and refresh token are required');
    });

    test('should validate calendar ID format', async () => {
      const validTokenData = {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expires_in: 3600
      };

      // Connect user first
      await userGoogleIntegrationService.connectGoogle(
        testUserId.toString(),
        validTokenData
      );

      // Test valid calendar ID
      await expect(
        userGoogleIntegrationService.updateUserIntegration(
          testUserId.toString(),
          { calendarId: 'user@example.com' }
        )
      ).resolves.toBeTruthy();

      // Test invalid calendar ID with malicious characters
      await expect(
        userGoogleIntegrationService.updateUserIntegration(
          testUserId.toString(),
          { calendarId: 'user<script>alert(1)</script>@example.com' }
        )
      ).rejects.toThrow();
    });

    test('should validate timezone format', async () => {
      const validTokenData = {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expires_in: 3600
      };

      // Connect user first
      await userGoogleIntegrationService.connectGoogle(
        testUserId.toString(),
        validTokenData
      );

      // Test valid timezone
      await expect(
        userGoogleIntegrationService.updateUserIntegration(
          testUserId.toString(),
          { timezone: 'America/Sao_Paulo' }
        )
      ).resolves.toBeTruthy();

      // Test invalid timezone with malicious characters
      await expect(
        userGoogleIntegrationService.updateUserIntegration(
          testUserId.toString(),
          { timezone: 'America/Sao_Paulo<script>alert(1)</script>' }
        )
      ).rejects.toThrow();
    });
  });

  describe('Audit Logging Security', () => {
    test('should log security events for connection operations', async () => {
      const logSpy = jest.spyOn(securityUtils, 'logSecurityEvent');

      const tokenData = {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expires_in: 3600
      };

      await userGoogleIntegrationService.connectGoogle(
        testUserId.toString(),
        tokenData,
        'test-correlation-id'
      );

      // Verify connection events were logged
      expect(logSpy).toHaveBeenCalledWith(
        'USER_CONNECT_INITIATED',
        expect.objectContaining({
          severity: 'INFO',
          userId: testUserId.toString(),
          correlationId: 'test-correlation-id'
        })
      );

      expect(logSpy).toHaveBeenCalledWith(
        'USER_CONNECT_COMPLETED',
        expect.objectContaining({
          severity: 'INFO',
          userId: testUserId.toString(),
          correlationId: 'test-correlation-id'
        })
      );

      logSpy.mockRestore();
    });

    test('should log security events for disconnection operations', async () => {
      const logSpy = jest.spyOn(securityUtils, 'logSecurityEvent');

      const tokenData = {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expires_in: 3600
      };

      // Connect first
      await userGoogleIntegrationService.connectGoogle(
        testUserId.toString(),
        tokenData
      );

      // Clear previous calls
      logSpy.mockClear();

      // Disconnect
      await userGoogleIntegrationService.disconnectGoogle(
        testUserId.toString(),
        'disconnect-correlation-id'
      );

      // Verify disconnection events were logged
      expect(logSpy).toHaveBeenCalledWith(
        'USER_DISCONNECT_INITIATED',
        expect.objectContaining({
          severity: 'INFO',
          userId: testUserId.toString(),
          correlationId: 'disconnect-correlation-id'
        })
      );

      expect(logSpy).toHaveBeenCalledWith(
        'USER_DISCONNECT',
        expect.objectContaining({
          severity: 'INFO',
          userId: testUserId.toString(),
          correlationId: 'disconnect-correlation-id'
        })
      );

      expect(logSpy).toHaveBeenCalledWith(
        'USER_DISCONNECT_COMPLETED',
        expect.objectContaining({
          severity: 'INFO',
          userId: testUserId.toString(),
          correlationId: 'disconnect-correlation-id'
        })
      );

      logSpy.mockRestore();
    });

    test('should log security events for failed operations', async () => {
      const logSpy = jest.spyOn(securityUtils, 'logSecurityEvent');

      // Attempt to connect with invalid data
      try {
        await userGoogleIntegrationService.connectGoogle(
          testUserId.toString(),
          null, // Invalid token data
          'error-correlation-id'
        );
      } catch (error) {
        // Expected to fail
      }

      // Verify failure event was logged
      expect(logSpy).toHaveBeenCalledWith(
        'USER_CONNECT_FAILED',
        expect.objectContaining({
          severity: 'ERROR',
          userId: testUserId.toString(),
          correlationId: 'error-correlation-id'
        })
      );

      logSpy.mockRestore();
    });
  });

  describe('Encryption Security', () => {
    test('should use different encrypted values for same plaintext', async () => {
      const plaintext = 'same-refresh-token';
      
      const encrypted1 = securityUtils.encrypt(plaintext);
      const encrypted2 = securityUtils.encrypt(plaintext);
      
      // Should be different due to random salt and IV
      expect(encrypted1).not.toBe(encrypted2);
      
      // But both should decrypt to the same plaintext
      expect(securityUtils.decrypt(encrypted1)).toBe(plaintext);
      expect(securityUtils.decrypt(encrypted2)).toBe(plaintext);
    });

    test('should fail gracefully with corrupted encrypted data', () => {
      const corruptedData = 'corrupted-base64-data-that-cannot-be-decrypted';
      
      const result = securityUtils.decrypt(corruptedData);
      expect(result).toBeNull();
    });

    test('should generate secure random tokens', () => {
      const token1 = securityUtils.generateSecureToken();
      const token2 = securityUtils.generateSecureToken();
      
      expect(token1).not.toBe(token2);
      expect(token1.length).toBe(64); // 32 bytes * 2 (hex)
      expect(/^[a-f0-9]+$/.test(token1)).toBe(true);
    });
  });
});