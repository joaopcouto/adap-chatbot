import { jest } from '@jest/globals';
import securityUtils from '../../src/utils/securityUtils.js';
import configManager from '../../src/config/config.js';

// Mock the config manager
jest.mock('../../src/config/config.js', () => ({
  get: jest.fn()
}));

// Mock the logger
jest.mock('../../src/helpers/logger.js', () => ({
  structuredLogger: {
    info: jest.fn(),
    error: jest.fn()
  }
}));

describe('SecurityUtils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Set up a test encryption key
    configManager.get.mockImplementation((key) => {
      if (key === 'encryption.key') {
        return 'test-encryption-key-32-characters-long';
      }
      return null;
    });
  });

  describe('encrypt/decrypt', () => {
    test('should encrypt and decrypt data successfully', () => {
      const plaintext = 'sensitive-token-data';
      
      const encrypted = securityUtils.encrypt(plaintext);
      expect(encrypted).toBeTruthy();
      expect(encrypted).not.toBe(plaintext);
      expect(typeof encrypted).toBe('string');
      
      const decrypted = securityUtils.decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    test('should return null for empty input', () => {
      expect(securityUtils.encrypt(null)).toBeNull();
      expect(securityUtils.encrypt('')).toBeNull();
      expect(securityUtils.decrypt(null)).toBeNull();
      expect(securityUtils.decrypt('')).toBeNull();
    });

    test('should handle decryption failure gracefully', () => {
      const result = securityUtils.decrypt('invalid-encrypted-data');
      expect(result).toBeNull();
    });

    test('should throw error for missing encryption key', () => {
      configManager.get.mockReturnValue(null);
      
      expect(() => {
        securityUtils.encrypt('test-data');
      }).toThrow('Invalid or missing encryption key');
    });

    test('should throw error for default encryption key', () => {
      configManager.get.mockReturnValue('default-key-for-development-only');
      
      expect(() => {
        securityUtils.encrypt('test-data');
      }).toThrow('Invalid or missing encryption key');
    });
  });

  describe('validateAndSanitize', () => {
    test('should validate string input successfully', () => {
      const input = 'valid-string';
      const result = securityUtils.validateAndSanitize(input, {
        type: 'string',
        maxLength: 20,
        required: true
      });
      expect(result).toBe(input);
    });

    test('should sanitize XSS attempts', () => {
      const input = '<script>alert("xss")</script>Hello World';
      const result = securityUtils.validateAndSanitize(input, {
        type: 'string',
        maxLength: 100
      });
      expect(result).toBe('Hello World');
      expect(result).not.toContain('<script>');
    });

    test('should validate character restrictions', () => {
      expect(() => {
        securityUtils.validateAndSanitize('invalid@chars!', {
          type: 'string',
          allowedChars: 'a-zA-Z0-9',
          required: true
        });
      }).toThrow('Input contains invalid characters');
    });

    test('should validate length restrictions', () => {
      expect(() => {
        securityUtils.validateAndSanitize('this-string-is-too-long', {
          type: 'string',
          maxLength: 10,
          required: true
        });
      }).toThrow('Input too long');
    });

    test('should handle required field validation', () => {
      expect(() => {
        securityUtils.validateAndSanitize('', {
          type: 'string',
          required: true
        });
      }).toThrow('Required field is missing');
    });

    test('should return null for optional empty fields', () => {
      const result = securityUtils.validateAndSanitize('', {
        type: 'string',
        required: false
      });
      expect(result).toBeNull();
    });

    test('should validate number type', () => {
      const result = securityUtils.validateAndSanitize(42, {
        type: 'number',
        required: true
      });
      expect(result).toBe(42);

      expect(() => {
        securityUtils.validateAndSanitize('not-a-number', {
          type: 'number',
          required: true
        });
      }).toThrow('Expected number');
    });

    test('should validate boolean type', () => {
      const result = securityUtils.validateAndSanitize(true, {
        type: 'boolean',
        required: true
      });
      expect(result).toBe(true);

      expect(() => {
        securityUtils.validateAndSanitize('not-a-boolean', {
          type: 'boolean',
          required: true
        });
      }).toThrow('Expected boolean');
    });
  });

  describe('generateSecureToken', () => {
    test('should generate secure random token', () => {
      const token1 = securityUtils.generateSecureToken();
      const token2 = securityUtils.generateSecureToken();
      
      expect(token1).toBeTruthy();
      expect(token2).toBeTruthy();
      expect(token1).not.toBe(token2);
      expect(token1.length).toBe(64); // 32 bytes * 2 (hex)
      expect(/^[a-f0-9]+$/.test(token1)).toBe(true);
    });

    test('should generate token with custom length', () => {
      const token = securityUtils.generateSecureToken(16);
      expect(token.length).toBe(32); // 16 bytes * 2 (hex)
    });
  });

  describe('hash/verifyHash', () => {
    test('should hash and verify data successfully', () => {
      const data = 'sensitive-data';
      const hashed = securityUtils.hash(data);
      
      expect(hashed).toBeTruthy();
      expect(hashed).not.toBe(data);
      expect(hashed.includes(':')).toBe(true);
      
      const isValid = securityUtils.verifyHash(data, hashed);
      expect(isValid).toBe(true);
      
      const isInvalid = securityUtils.verifyHash('wrong-data', hashed);
      expect(isInvalid).toBe(false);
    });

    test('should handle invalid hash format', () => {
      const result = securityUtils.verifyHash('data', 'invalid-hash');
      expect(result).toBe(false);
    });
  });

  describe('secureWipe', () => {
    test('should handle string wipe', () => {
      let data = 'sensitive-string';
      securityUtils.secureWipe(data);
      // String wipe sets to null (can't directly overwrite string memory in JS)
      expect(data).toBe('sensitive-string'); // Original variable unchanged
    });

    test('should handle buffer wipe', () => {
      const buffer = Buffer.from('sensitive-data');
      const originalContent = buffer.toString();
      
      securityUtils.secureWipe(buffer);
      
      // Buffer should be overwritten with random data
      expect(buffer.toString()).not.toBe(originalContent);
    });
  });

  describe('logSecurityEvent', () => {
    test('should log security events with proper structure', () => {
      const { structuredLogger } = require('../../src/helpers/logger.js');
      
      securityUtils.logSecurityEvent('TEST_EVENT', {
        severity: 'INFO',
        userId: 'test-user',
        correlationId: 'test-correlation',
        details: 'Test security event'
      });
      
      expect(structuredLogger.info).toHaveBeenCalledWith(
        'AUDIT: SECURITY_EVENT_TEST_EVENT',
        expect.objectContaining({
          operation: 'SECURITY_EVENT_TEST_EVENT',
          eventType: 'TEST_EVENT',
          severity: 'INFO',
          userId: 'test-user',
          correlationId: 'test-correlation',
          details: 'Test security event'
        })
      );
    });
  });
});