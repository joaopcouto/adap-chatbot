import crypto from 'crypto';
import configManager from '../config/config.js';
import { structuredLogger } from '../helpers/logger.js';

/**
 * Security utilities for token encryption, validation, and audit logging
 */
class SecurityUtils {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.keyLength = 32; // 256 bits
    this.ivLength = 16; // 128 bits
    this.tagLength = 16; // 128 bits
    this.saltLength = 32; // 256 bits
  }

  /**
   * Derive encryption key from master key using PBKDF2
   * @param {string} masterKey - Master encryption key
   * @param {Buffer} salt - Salt for key derivation
   * @returns {Buffer} Derived key
   */
  _deriveKey(masterKey, salt) {
    return crypto.pbkdf2Sync(masterKey, salt, 100000, this.keyLength, 'sha256');
  }

  /**
   * Encrypt sensitive data using AES-256-GCM
   * @param {string} plaintext - Data to encrypt
   * @param {string} correlationId - Optional correlation ID for audit logging
   * @returns {string} Encrypted data (base64 encoded)
   */
  encrypt(plaintext, correlationId = null) {
    if (!plaintext) {
      return null;
    }

    try {
      const masterKey = configManager.get('encryption.key');
      if (!masterKey || masterKey === 'default-key-for-development-only') {
        throw new Error('Invalid or missing encryption key');
      }

      // Generate random salt and IV
      const salt = crypto.randomBytes(this.saltLength);
      const iv = crypto.randomBytes(this.ivLength);
      
      // Derive key from master key and salt
      const key = this._deriveKey(masterKey, salt);
      
      // Create cipher with proper IV
      const cipher = crypto.createCipheriv(this.algorithm, key, iv);
      cipher.setAAD(salt); // Use salt as additional authenticated data
      
      // Encrypt the data
      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      // Get authentication tag
      const tag = cipher.getAuthTag();
      
      // Combine salt + iv + tag + encrypted data
      const combined = Buffer.concat([
        salt,
        iv,
        tag,
        Buffer.from(encrypted, 'hex')
      ]);
      
      // Audit log the encryption operation (without sensitive data)
      this._auditLog('ENCRYPT', {
        correlationId,
        dataLength: plaintext.length,
        success: true
      });
      
      return combined.toString('base64');
    } catch (error) {
      // Audit log the failed encryption
      this._auditLog('ENCRYPT', {
        correlationId,
        success: false,
        error: error.message
      });
      
      structuredLogger.error('Encryption failed', {
        correlationId,
        error: error.message
      });
      
      throw new Error('Failed to encrypt data');
    }
  }

  /**
   * Decrypt sensitive data using AES-256-GCM
   * @param {string} encryptedData - Encrypted data (base64 encoded)
   * @param {string} correlationId - Optional correlation ID for audit logging
   * @returns {string} Decrypted plaintext
   */
  decrypt(encryptedData, correlationId = null) {
    if (!encryptedData) {
      return null;
    }

    try {
      const masterKey = configManager.get('encryption.key');
      if (!masterKey) {
        throw new Error('Missing encryption key');
      }

      // Decode from base64
      const combined = Buffer.from(encryptedData, 'base64');
      
      // Extract components
      const salt = combined.subarray(0, this.saltLength);
      const iv = combined.subarray(this.saltLength, this.saltLength + this.ivLength);
      const tag = combined.subarray(this.saltLength + this.ivLength, this.saltLength + this.ivLength + this.tagLength);
      const encrypted = combined.subarray(this.saltLength + this.ivLength + this.tagLength);
      
      // Derive key from master key and salt
      const key = this._deriveKey(masterKey, salt);
      
      // Create decipher with proper IV
      const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
      decipher.setAAD(salt);
      decipher.setAuthTag(tag);
      
      // Decrypt the data
      let decrypted = decipher.update(encrypted, null, 'utf8');
      decrypted += decipher.final('utf8');
      
      // Audit log the decryption operation (without sensitive data)
      this._auditLog('DECRYPT', {
        correlationId,
        success: true
      });
      
      return decrypted;
    } catch (error) {
      // Audit log the failed decryption
      this._auditLog('DECRYPT', {
        correlationId,
        success: false,
        error: error.message
      });
      
      structuredLogger.error('Decryption failed', {
        correlationId,
        error: error.message
      });
      
      return null;
    }
  }

  /**
   * Securely wipe sensitive data from memory
   * @param {string|Buffer} data - Data to wipe
   */
  secureWipe(data) {
    if (typeof data === 'string') {
      // For strings, we can't directly overwrite memory, but we can help GC
      data = null;
    } else if (Buffer.isBuffer(data)) {
      // For buffers, we can overwrite with random data
      crypto.randomFillSync(data);
    }
  }

  /**
   * Validate and sanitize input data
   * @param {any} input - Input to validate
   * @param {Object} options - Validation options
   * @returns {any} Sanitized input
   */
  validateAndSanitize(input, options = {}) {
    const {
      type = 'string',
      maxLength = 1000,
      allowedChars = null,
      required = false
    } = options;

    // Check if required
    if (required && (input === null || input === undefined || input === '')) {
      throw new Error('Required field is missing');
    }

    // Return null for empty optional fields
    if (!required && (input === null || input === undefined || input === '')) {
      return null;
    }

    // Type validation
    if (type === 'string' && typeof input !== 'string') {
      throw new Error(`Expected string, got ${typeof input}`);
    }

    if (type === 'number' && typeof input !== 'number') {
      throw new Error(`Expected number, got ${typeof input}`);
    }

    if (type === 'boolean' && typeof input !== 'boolean') {
      throw new Error(`Expected boolean, got ${typeof input}`);
    }

    // String-specific validations
    if (type === 'string') {
      // Length validation
      if (input.length > maxLength) {
        throw new Error(`Input too long: ${input.length} > ${maxLength}`);
      }

      // Character validation
      if (allowedChars && !new RegExp(`^[${allowedChars}]*$`).test(input)) {
        throw new Error('Input contains invalid characters');
      }

      // Basic XSS prevention - remove potentially dangerous characters
      const sanitized = input
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '');

      return sanitized.trim();
    }

    return input;
  }

  /**
   * Generate secure random token
   * @param {number} length - Token length in bytes
   * @returns {string} Random token (hex encoded)
   */
  generateSecureToken(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Hash sensitive data for comparison (one-way)
   * @param {string} data - Data to hash
   * @param {string} salt - Optional salt
   * @returns {string} Hash (hex encoded)
   */
  hash(data, salt = null) {
    const actualSalt = salt || crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(data, actualSalt, 100000, 64, 'sha256');
    return `${actualSalt}:${hash.toString('hex')}`;
  }

  /**
   * Verify hashed data
   * @param {string} data - Original data
   * @param {string} hashedData - Hashed data to verify against
   * @returns {boolean} True if data matches hash
   */
  verifyHash(data, hashedData) {
    try {
      const [salt, hash] = hashedData.split(':');
      const verifyHash = crypto.pbkdf2Sync(data, salt, 100000, 64, 'sha256');
      return hash === verifyHash.toString('hex');
    } catch (error) {
      return false;
    }
  }

  /**
   * Audit log security-relevant operations
   * @param {string} operation - Operation type
   * @param {Object} context - Operation context
   * @private
   */
  _auditLog(operation, context = {}) {
    const auditEntry = {
      timestamp: new Date().toISOString(),
      operation,
      service: 'security-utils',
      ...context
    };

    // Use structured logger for audit entries
    structuredLogger.info(`AUDIT: ${operation}`, auditEntry);
  }

  /**
   * Log security event for monitoring
   * @param {string} eventType - Type of security event
   * @param {Object} context - Event context
   */
  logSecurityEvent(eventType, context = {}) {
    this._auditLog(`SECURITY_EVENT_${eventType}`, {
      eventType,
      severity: context.severity || 'INFO',
      userId: context.userId,
      correlationId: context.correlationId,
      details: context.details
    });
  }
}

// Export singleton instance
const securityUtils = new SecurityUtils();
export default securityUtils;