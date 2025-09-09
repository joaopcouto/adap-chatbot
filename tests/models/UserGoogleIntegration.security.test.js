import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import UserGoogleIntegration from '../../src/models/UserGoogleIntegration.js';

// Mock the security utils
jest.mock('../../src/utils/securityUtils.js', () => ({
  encrypt: jest.fn(),
  decrypt: jest.fn(),
  secureWipe: jest.fn(),
  logSecurityEvent: jest.fn()
}));

import securityUtils from '../../src/utils/securityUtils.js';

describe('UserGoogleIntegration Security Features', () => {
  let testUserId;

  beforeEach(() => {
    jest.clearAllMocks();
    testUserId = new mongoose.Types.ObjectId();
    
    // Mock successful encryption/decryption
    securityUtils.encrypt.mockImplementation((data) => `encrypted_${data}`);
    securityUtils.decrypt.mockImplementation((data) => data.replace('encrypted_', ''));
  });

  describe('Token Encryption', () => {
    test('should encrypt refresh token on save', async () => {
      const integration = new UserGoogleIntegration({
        userId: testUserId,
        connected: true,
        refreshToken: 'test-refresh-token'
      });

      // Trigger the pre-save hook
      await integration.validate();
      integration.save = jest.fn(); // Mock save to avoid DB operations
      
      // Call the pre-save hook manually
      const preSaveHook = integration.constructor.schema._pres.get('save')[0].fn;
      await new Promise((resolve) => {
        preSaveHook.call(integration, resolve);
      });

      expect(securityUtils.encrypt).toHaveBeenCalledWith('test-refresh-token', undefined);
      expect(integration.refreshToken).toBe('encrypted_test-refresh-token');
    });

    test('should not encrypt if refresh token is not modified', async () => {
      const integration = new UserGoogleIntegration({
        userId: testUserId,
        connected: true,
        refreshToken: 'already-encrypted-token'
      });

      // Mark as not modified
      integration.isModified = jest.fn().mockReturnValue(false);
      
      // Call the pre-save hook manually
      const preSaveHook = integration.constructor.schema._pres.get('save')[0].fn;
      await new Promise((resolve) => {
        preSaveHook.call(integration, resolve);
      });

      expect(securityUtils.encrypt).not.toHaveBeenCalled();
    });

    test('should handle encryption failure', async () => {
      securityUtils.encrypt.mockImplementation(() => {
        throw new Error('Encryption failed');
      });

      const integration = new UserGoogleIntegration({
        userId: testUserId,
        connected: true,
        refreshToken: 'test-refresh-token'
      });

      expect(() => {
        integration.encryptRefreshToken('test-token');
      }).toThrow('Encryption failed');

      expect(securityUtils.logSecurityEvent).toHaveBeenCalledWith(
        'TOKEN_ENCRYPTION_FAILED',
        expect.objectContaining({
          severity: 'ERROR',
          userId: testUserId,
          details: 'Failed to encrypt refresh token'
        })
      );
    });
  });

  describe('Token Decryption', () => {
    test('should decrypt refresh token successfully', () => {
      const integration = new UserGoogleIntegration({
        userId: testUserId,
        refreshToken: 'encrypted_test-token'
      });

      const decrypted = integration.getDecryptedRefreshToken();
      
      expect(securityUtils.decrypt).toHaveBeenCalledWith('encrypted_test-token', undefined);
      expect(decrypted).toBe('test-token');
    });

    test('should handle decryption failure', () => {
      securityUtils.decrypt.mockReturnValue(null);

      const integration = new UserGoogleIntegration({
        userId: testUserId,
        refreshToken: 'invalid-encrypted-token'
      });

      const result = integration.decryptRefreshToken('invalid-token');
      
      expect(result).toBeNull();
      expect(securityUtils.logSecurityEvent).toHaveBeenCalledWith(
        'TOKEN_DECRYPTION_FAILED',
        expect.objectContaining({
          severity: 'ERROR',
          userId: testUserId,
          details: 'Failed to decrypt refresh token'
        })
      );
    });

    test('should return null for empty encrypted token', () => {
      const integration = new UserGoogleIntegration({
        userId: testUserId
      });

      const result = integration.getDecryptedRefreshToken();
      expect(result).toBeNull();
      expect(securityUtils.decrypt).not.toHaveBeenCalled();
    });
  });

  describe('Secure Disconnect', () => {
    test('should securely disconnect and wipe tokens', () => {
      const integration = new UserGoogleIntegration({
        userId: testUserId,
        connected: true,
        calendarSyncEnabled: true,
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        tokenExpiresAt: new Date(),
        calendarId: 'test-calendar'
      });

      const correlationId = 'test-correlation-id';
      integration.disconnect(correlationId);

      // Verify security event logging
      expect(securityUtils.logSecurityEvent).toHaveBeenCalledWith(
        'USER_DISCONNECT',
        expect.objectContaining({
          severity: 'INFO',
          userId: testUserId,
          correlationId,
          details: 'User disconnected Google integration'
        })
      );

      // Verify secure wipe was called for tokens
      expect(securityUtils.secureWipe).toHaveBeenCalledWith('test-access-token');
      expect(securityUtils.secureWipe).toHaveBeenCalledWith('test-refresh-token');

      // Verify fields are cleared
      expect(integration.connected).toBe(false);
      expect(integration.calendarSyncEnabled).toBe(false);
      expect(integration.accessToken).toBeNull();
      expect(integration.refreshToken).toBeNull();
      expect(integration.tokenExpiresAt).toBeNull();
      expect(integration.calendarId).toBeNull();
    });

    test('should handle disconnect without tokens', () => {
      const integration = new UserGoogleIntegration({
        userId: testUserId,
        connected: true
      });

      integration.disconnect();

      expect(securityUtils.logSecurityEvent).toHaveBeenCalledWith(
        'USER_DISCONNECT',
        expect.objectContaining({
          severity: 'INFO',
          userId: testUserId,
          details: 'User disconnected Google integration'
        })
      );

      // Should not call secureWipe for null tokens
      expect(securityUtils.secureWipe).not.toHaveBeenCalled();
    });
  });

  describe('Integration Validation', () => {
    test('should validate integration correctly', () => {
      const validIntegration = new UserGoogleIntegration({
        userId: testUserId,
        connected: true,
        calendarSyncEnabled: true,
        accessToken: 'valid-token',
        refreshToken: 'valid-refresh-token',
        tokenExpiresAt: new Date(Date.now() + 3600000) // 1 hour from now
      });

      expect(validIntegration.hasValidIntegration()).toBe(true);
    });

    test('should invalidate expired integration', () => {
      const expiredIntegration = new UserGoogleIntegration({
        userId: testUserId,
        connected: true,
        calendarSyncEnabled: true,
        accessToken: 'valid-token',
        refreshToken: 'valid-refresh-token',
        tokenExpiresAt: new Date(Date.now() - 3600000) // 1 hour ago
      });

      expect(expiredIntegration.hasValidIntegration()).toBe(false);
    });

    test('should invalidate disconnected integration', () => {
      const disconnectedIntegration = new UserGoogleIntegration({
        userId: testUserId,
        connected: false,
        calendarSyncEnabled: true,
        accessToken: 'valid-token',
        refreshToken: 'valid-refresh-token',
        tokenExpiresAt: new Date(Date.now() + 3600000)
      });

      expect(disconnectedIntegration.hasValidIntegration()).toBe(false);
    });

    test('should invalidate integration without tokens', () => {
      const noTokenIntegration = new UserGoogleIntegration({
        userId: testUserId,
        connected: true,
        calendarSyncEnabled: true,
        tokenExpiresAt: new Date(Date.now() + 3600000)
      });

      expect(noTokenIntegration.hasValidIntegration()).toBe(false);
    });
  });
});