import UserGoogleIntegration from '../models/UserGoogleIntegration.js';
import securityUtils from '../utils/securityUtils.js';
import { structuredLogger } from '../helpers/logger.js';

class UserGoogleIntegrationService {
  /**
   * Get Google integration preferences for a user
   * @param {string} userId - The user ID
   * @returns {Promise<Object|null>} User's Google integration preferences
   */
  async getUserIntegration(userId) {
    try {
      return await UserGoogleIntegration.findOne({ userId });
    } catch (error) {
      console.error('Error fetching user Google integration:', error);
      throw error;
    }
  }

  /**
   * Create or update Google integration preferences for a user
   * @param {string} userId - The user ID
   * @param {Object} integrationData - Integration data to update
   * @returns {Promise<Object>} Updated integration preferences
   */
  async updateUserIntegration(userId, integrationData) {
    try {
      // Validate user ID
      securityUtils.validateAndSanitize(userId, {
        type: 'string',
        maxLength: 50,
        required: true
      });

      // Validate integration data
      if (!integrationData || typeof integrationData !== 'object') {
        throw new Error('Integration data must be an object');
      }

      // Sanitize string fields if present
      const sanitizedData = { ...integrationData };
      
      if (sanitizedData.calendarId) {
        sanitizedData.calendarId = securityUtils.validateAndSanitize(sanitizedData.calendarId, {
          type: 'string',
          maxLength: 255,
          allowedChars: 'a-zA-Z0-9@\\._\\-'
        });
      }

      if (sanitizedData.timezone) {
        sanitizedData.timezone = securityUtils.validateAndSanitize(sanitizedData.timezone, {
          type: 'string',
          maxLength: 50,
          allowedChars: 'a-zA-Z0-9/_\\-'
        });
      }

      const integration = await UserGoogleIntegration.findOneAndUpdate(
        { userId },
        { ...sanitizedData, userId },
        { 
          new: true, 
          upsert: true,
          runValidators: true
        }
      );
      return integration;
    } catch (error) {
      structuredLogger.error('Error updating user Google integration', {
        userId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Check if user has Google Calendar sync enabled and valid tokens
   * @param {string} userId - The user ID
   * @returns {Promise<boolean>} Whether sync is enabled and valid
   */
  async isSyncEnabled(userId) {
    try {
      const integration = await this.getUserIntegration(userId);
      return integration ? integration.hasValidIntegration() : false;
    } catch (error) {
      console.error('Error checking sync status:', error);
      return false;
    }
  }

  /**
   * Connect Google account for a user
   * @param {string} userId - The user ID
   * @param {Object} tokenData - Google OAuth token data
   * @param {string} correlationId - Optional correlation ID for audit logging
   * @returns {Promise<Object>} Updated integration preferences
   */
  async connectGoogle(userId, tokenData, correlationId = null) {
    try {
      // Validate inputs
      securityUtils.validateAndSanitize(userId, {
        type: 'string',
        maxLength: 50,
        required: true
      });

      if (!tokenData || typeof tokenData !== 'object') {
        throw new Error('Token data is required');
      }

      if (!tokenData.access_token || !tokenData.refresh_token) {
        throw new Error('Access token and refresh token are required');
      }

      // Audit log connection attempt
      securityUtils.logSecurityEvent('USER_CONNECT_INITIATED', {
        severity: 'INFO',
        userId,
        correlationId,
        details: 'User initiated Google integration connection'
      });

      const integrationData = {
        connected: true,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        tokenExpiresAt: new Date(Date.now() + (tokenData.expires_in * 1000))
      };

      const result = await this.updateUserIntegration(userId, integrationData);
      
      // Audit log successful connection
      securityUtils.logSecurityEvent('USER_CONNECT_COMPLETED', {
        severity: 'INFO',
        userId,
        correlationId,
        details: 'Google integration successfully connected'
      });

      return result;
    } catch (error) {
      // Audit log failed connection
      securityUtils.logSecurityEvent('USER_CONNECT_FAILED', {
        severity: 'ERROR',
        userId,
        correlationId,
        details: `Failed to connect Google integration: ${error.message}`
      });
      
      structuredLogger.error('Error connecting Google integration', {
        userId,
        correlationId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Disconnect Google account for a user
   * @param {string} userId - The user ID
   * @param {string} correlationId - Optional correlation ID for audit logging
   * @returns {Promise<Object>} Updated integration preferences
   */
  async disconnectGoogle(userId, correlationId = null) {
    try {
      // Validate user ID
      securityUtils.validateAndSanitize(userId, {
        type: 'string',
        maxLength: 50,
        required: true
      });

      const integration = await this.getUserIntegration(userId);
      if (integration) {
        // Audit log before disconnection
        securityUtils.logSecurityEvent('USER_DISCONNECT_INITIATED', {
          severity: 'INFO',
          userId,
          correlationId,
          details: 'User initiated Google integration disconnect'
        });

        integration.disconnect(correlationId);
        await integration.save();
        
        // Audit log successful disconnection
        securityUtils.logSecurityEvent('USER_DISCONNECT_COMPLETED', {
          severity: 'INFO',
          userId,
          correlationId,
          details: 'Google integration successfully disconnected'
        });
        
        return integration;
      }
      return null;
    } catch (error) {
      // Audit log failed disconnection
      securityUtils.logSecurityEvent('USER_DISCONNECT_FAILED', {
        severity: 'ERROR',
        userId,
        correlationId,
        details: `Failed to disconnect Google integration: ${error.message}`
      });
      
      structuredLogger.error('Error disconnecting Google integration', {
        userId,
        correlationId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Enable or disable calendar sync for a user
   * @param {string} userId - The user ID
   * @param {boolean} enabled - Whether to enable sync
   * @returns {Promise<Object>} Updated integration preferences
   */
  async setCalendarSyncEnabled(userId, enabled) {
    return await this.updateUserIntegration(userId, { calendarSyncEnabled: enabled });
  }

  /**
   * Set preferred calendar ID for a user
   * @param {string} userId - The user ID
   * @param {string} calendarId - Google Calendar ID
   * @returns {Promise<Object>} Updated integration preferences
   */
  async setPreferredCalendar(userId, calendarId) {
    return await this.updateUserIntegration(userId, { calendarId });
  }

  /**
   * Update user's timezone preference
   * @param {string} userId - The user ID
   * @param {string} timezone - Timezone string (e.g., 'America/Sao_Paulo')
   * @returns {Promise<Object>} Updated integration preferences
   */
  async setTimezone(userId, timezone) {
    return await this.updateUserIntegration(userId, { timezone });
  }

  /**
   * Set default reminder times for calendar events
   * @param {string} userId - The user ID
   * @param {number[]} reminders - Array of minutes before event
   * @returns {Promise<Object>} Updated integration preferences
   */
  async setDefaultReminders(userId, reminders) {
    return await this.updateUserIntegration(userId, { defaultReminders: reminders });
  }

  /**
   * Update access token for a user (typically after refresh)
   * @param {string} userId - The user ID
   * @param {string} accessToken - New access token
   * @param {Date} expiresAt - Token expiration date
   * @returns {Promise<Object>} Updated integration preferences
   */
  async updateAccessToken(userId, accessToken, expiresAt) {
    return await this.updateUserIntegration(userId, { 
      accessToken, 
      tokenExpiresAt: expiresAt 
    });
  }

  /**
   * Get decrypted refresh token for a user
   * @param {string} userId - The user ID
   * @returns {Promise<string|null>} Decrypted refresh token
   */
  async getRefreshToken(userId) {
    try {
      const integration = await this.getUserIntegration(userId);
      return integration ? integration.getDecryptedRefreshToken() : null;
    } catch (error) {
      console.error('Error getting refresh token:', error);
      return null;
    }
  }
}

export default new UserGoogleIntegrationService();