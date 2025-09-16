import { google } from 'googleapis';
import crypto from 'crypto';
import { structuredLogger, generateCorrelationId } from '../helpers/logger.js';
import metricsCollector from './metricsCollector.js';
import configManager from '../config/config.js';
import featureFlagService from './featureFlagService.js';
import securityUtils from '../utils/securityUtils.js';

class GoogleCalendarService {
  constructor() {
    this.clientId = configManager.get('google.clientId');
    this.clientSecret = configManager.get('google.clientSecret');
    this.redirectUri = configManager.get('google.redirectUri');
    this.defaultTimezone = configManager.get('googleCalendar.defaultTimezone');
    this.defaultDuration = configManager.get('googleCalendar.defaultEventDurationMinutes');
    
    if (!this.clientId || !this.clientSecret) {
      throw new Error('Google OAuth credentials not configured');
    }
  }

  /**
   * Create OAuth2 client with user credentials
   * @param {Object} userIntegration - User's Google integration data
   * @returns {google.auth.OAuth2} Configured OAuth2 client
   */
  _createOAuthClient(userIntegration) {
    const oauth2Client = new google.auth.OAuth2(
      this.clientId,
      this.clientSecret,
      this.redirectUri
    );

    try {
      // Os tokens já vêm descriptografados do SyncManager
      const decryptedRefreshToken = userIntegration.refreshToken;
      
      oauth2Client.setCredentials({
        access_token: userIntegration.accessToken,
        refresh_token: decryptedRefreshToken,
        expiry_date: userIntegration.tokenExpiresAt?.getTime()
      });

      return oauth2Client;
    } catch (error) {
      console.error('Error creating OAuth client:', error);
      const authError = new Error('Failed to create OAuth client: ' + error.message);
      authError.type = 'AUTH_ERROR';
      authError.retryable = false;
      authError.requiresReconnection = true;
      throw authError;
    }
  }

  /**
   * Get Google Calendar API client
   * @param {Object} userIntegration - User's Google integration data
   * @returns {google.calendar} Calendar API client
   */
  _getCalendarClient(userIntegration) {
    try {
      const auth = this._createOAuthClient(userIntegration);
      return google.calendar({ version: 'v3', auth });
    } catch (error) {
      console.error('Error getting calendar client:', error);
      // Re-throw the error with proper classification
      throw error;
    }
  }

  /**
   * Determine if event should be all-day based on reminder date
   * @param {Date} reminderDate - The reminder date
   * @param {Object} reminderData - Full reminder data for additional context
   * @returns {boolean} True if should be all-day event
   */
  _isAllDayEvent(reminderDate, reminderData = {}) {
    // Check if time is exactly midnight (00:00:00) and milliseconds are 0
    const isExactMidnight = reminderDate.getHours() === 0 && 
                           reminderDate.getMinutes() === 0 && 
                           reminderDate.getSeconds() === 0 &&
                           reminderDate.getMilliseconds() === 0;
    
    // Additional check: if the original date string doesn't contain time information
    // This handles cases where the date was parsed from a date-only string
    if (reminderData.originalDateString) {
      const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
      if (dateOnlyPattern.test(reminderData.originalDateString)) {
        return true;
      }
    }
    
    // Check if the date was explicitly marked as all-day
    if (reminderData.isAllDay === true) {
      return true;
    }
    
    return isExactMidnight;
  }

  /**
   * Format date for all-day events (YYYY-MM-DD)
   * @param {Date} date - Date to format
   * @param {string} timezone - Timezone to consider for date calculation
   * @returns {string} Formatted date string
   */
  _formatDateOnly(date, timezone = null) {
    if (timezone) {
      // Convert to the specified timezone before extracting date
      const options = { 
        timeZone: timezone, 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit' 
      };
      const formatter = new Intl.DateTimeFormat('en-CA', options);
      return formatter.format(date);
    }
    
    // For all-day events, we want to use the local date representation
    // to avoid timezone conversion issues
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Parse and normalize reminder date with timezone awareness
   * @param {string|Date} dateInput - Date input from reminder data
   * @param {string} timezone - Target timezone
   * @returns {Object} Parsed date information
   */
  _parseReminderDate(dateInput, timezone) {
    let reminderDate;
    let originalDateString = null;
    
    if (typeof dateInput === 'string') {
      originalDateString = dateInput.trim();
      
      // Check if it's a date-only string (YYYY-MM-DD format)
      const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
      if (dateOnlyPattern.test(originalDateString)) {
        // For date-only strings, create a local date to avoid timezone conversion
        const [year, month, day] = originalDateString.split('-').map(Number);
        reminderDate = new Date(year, month - 1, day); // month is 0-indexed
      } else {
        reminderDate = new Date(dateInput);
      }
    } else if (dateInput instanceof Date) {
      reminderDate = new Date(dateInput);
    } else {
      throw new Error('Invalid date input: must be string or Date object');
    }
    
    // Validate the parsed date
    if (isNaN(reminderDate.getTime())) {
      throw new Error(`Invalid date format: ${dateInput}`);
    }
    
    return {
      date: reminderDate,
      originalDateString,
      timezone
    };
  }

  /**
   * Calculate event duration based on reminder data and user preferences
   * @param {Object} reminderData - Reminder data from the system
   * @param {Object} userIntegration - User's Google integration preferences
   * @returns {number} Duration in minutes
   */
  _calculateEventDuration(reminderData, userIntegration) {
    // Check if explicit duration is provided in reminder data
    if (reminderData.duration && typeof reminderData.duration === 'number' && reminderData.duration > 0) {
      return reminderData.duration;
    }
    
    // Check if end time is explicitly provided
    if (reminderData.endDate) {
      const startDate = new Date(reminderData.date);
      const endDate = new Date(reminderData.endDate);
      const durationMs = endDate.getTime() - startDate.getTime();
      const durationMinutes = Math.max(1, Math.floor(durationMs / (1000 * 60)));
      return durationMinutes;
    }
    
    // Check user's default event duration preference
    if (userIntegration.defaultEventDuration && userIntegration.defaultEventDuration > 0) {
      return userIntegration.defaultEventDuration;
    }
    
    // Use system default
    return this.defaultDuration;
  }

  /**
   * Create event object for Google Calendar API
   * @param {Object} reminderData - Reminder data from the system
   * @param {Object} userIntegration - User's Google integration preferences
   * @param {string} messageId - Unique message ID for idempotency
   * @returns {Object} Google Calendar event object
   */
  _createEventObject(reminderData, userIntegration, messageId) {
    // Validate and sanitize input data
    this._validateReminderData(reminderData);
    this._validateUserIntegration(userIntegration);
    
    if (messageId) {
      securityUtils.validateAndSanitize(messageId, {
        type: 'string',
        maxLength: 100,
        allowedChars: 'a-zA-Z0-9\\-_',
        required: true
      });
    }

    const timezone = userIntegration.timezone || this.defaultTimezone;
    
    try {
      const parsedDate = this._parseReminderDate(reminderData.date, timezone);
      const reminderDate = parsedDate.date;
      
      // Enhanced reminder data with parsing context
      const enhancedReminderData = {
        ...reminderData,
        originalDateString: parsedDate.originalDateString
      };
      
      const isAllDay = this._isAllDayEvent(reminderDate, enhancedReminderData);

      const event = {
        summary: reminderData.description,
        description: reminderData.description,
        visibility: 'private',
        extendedProperties: {
          private: {
            app_event_id: messageId
          }
        }
      };

      if (isAllDay) {
        // All-day event - for all-day events, we don't use timezone conversion
        // as Google Calendar expects the date in the local calendar's date
        const startDate = this._formatDateOnly(reminderDate);
        const endDate = new Date(reminderDate);
        endDate.setDate(endDate.getDate() + 1);
        
        event.start = { date: startDate };
        event.end = { date: this._formatDateOnly(endDate) };
        
      } else {
        // Timed event with enhanced duration calculation
        const duration = this._calculateEventDuration(enhancedReminderData, userIntegration);
        const endDate = new Date(reminderDate);
        endDate.setMinutes(endDate.getMinutes() + duration);

        event.start = {
          dateTime: reminderDate.toISOString(),
          timeZone: timezone
        };
        event.end = {
          dateTime: endDate.toISOString(),
          timeZone: timezone
        };
      }

      // Set reminders with enhanced logic
      if (userIntegration.defaultReminders && userIntegration.defaultReminders.length > 0) {
        event.reminders = {
          useDefault: false,
          overrides: userIntegration.defaultReminders.map(minutes => ({
            method: 'popup',
            minutes: minutes
          }))
        };
      } else {
        event.reminders = {
          useDefault: true
        };
      }

      return event;
    } catch (error) {
      console.error('Error creating event object:', error);
      throw new Error(`Failed to create calendar event: ${error.message}`);
    }
  }

  /**
   * Create a new event in Google Calendar
   * @param {Object} userIntegration - User's Google integration data
   * @param {Object} reminderData - Reminder data to create event from
   * @param {string} messageId - Unique message ID for idempotency
   * @param {string} correlationId - Optional correlation ID for tracking
   * @returns {Promise<Object>} Created event data
   */
  async createEvent(userIntegration, reminderData, messageId, correlationId = null) {
    const cId = correlationId || generateCorrelationId();
    const startTime = Date.now();
    
    structuredLogger.syncStart('createEvent', {
      correlationId: cId,
      messageId,
      userId: userIntegration.userId,
      calendarId: userIntegration.calendarId || 'primary'
    });

    return await this.executeWithTokenRefresh(userIntegration, async (validUserIntegration) => {
      try {
        const calendar = this._getCalendarClient(validUserIntegration);
        const calendarId = validUserIntegration.calendarId || 'primary';
        
        const eventObject = this._createEventObject(reminderData, validUserIntegration, messageId);

        structuredLogger.debug('Creating Google Calendar event', {
          correlationId: cId,
          messageId,
          calendarId,
          eventSummary: eventObject.summary,
          isAllDay: !!eventObject.start.date
        });

        const response = await calendar.events.insert({
          calendarId: calendarId,
          resource: eventObject
        });

        const duration = Date.now() - startTime;
        structuredLogger.apiMetrics('calendar.events.insert', duration, {
          correlationId: cId,
          messageId,
          calendarId,
          eventId: response.data.id
        });

        // Record metrics for monitoring
        metricsCollector.recordSyncOperation('createEvent', true, duration, null, cId);

        const result = {
          eventId: response.data.id,
          calendarId: calendarId,
          htmlLink: response.data.htmlLink,
          created: response.data.created
        };

        structuredLogger.syncSuccess('createEvent', {
          correlationId: cId,
          messageId,
          eventId: result.eventId,
          duration
        });

        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        const classifiedError = this._handleApiError(error, cId);
        
        // Record metrics for monitoring
        metricsCollector.recordSyncOperation('createEvent', false, duration, classifiedError.type, cId);
        
        // Record auth issues if applicable
        if (classifiedError.type === 'AUTH_ERROR') {
          const issueType = classifiedError.requiresReconnection ? 'reconnectionRequired' : 'tokenRefresh';
          metricsCollector.recordAuthIssue(issueType, {
            operation: 'createEvent',
            messageId,
            errorMessage: classifiedError.message
          }, cId);
        }
        
        structuredLogger.syncFailure('createEvent', error, {
          correlationId: cId,
          messageId,
          duration,
          calendarId: userIntegration.calendarId || 'primary'
        });
        throw classifiedError;
      }
    }, cId);
  }

  /**
   * Update an existing event in Google Calendar
   * @param {string} eventId - Google Calendar event ID
   * @param {Object} userIntegration - User's Google integration data
   * @param {Object} reminderData - Updated reminder data
   * @param {string} correlationId - Optional correlation ID for tracking
   * @returns {Promise<Object>} Updated event data
   */
  async updateEvent(eventId, userIntegration, reminderData, correlationId = null) {
    const cId = correlationId || generateCorrelationId();
    const startTime = Date.now();
    
    structuredLogger.syncStart('updateEvent', {
      correlationId: cId,
      eventId,
      userId: userIntegration.userId,
      calendarId: userIntegration.calendarId || 'primary'
    });

    return await this.executeWithTokenRefresh(userIntegration, async (validUserIntegration) => {
      try {
        const calendar = this._getCalendarClient(validUserIntegration);
        const calendarId = validUserIntegration.calendarId || 'primary';
        
        const eventObject = this._createEventObject(reminderData, validUserIntegration, null);
        // Don't update the app_event_id when updating
        delete eventObject.extendedProperties;

        structuredLogger.debug('Updating Google Calendar event', {
          correlationId: cId,
          eventId,
          calendarId,
          eventSummary: eventObject.summary,
          isAllDay: !!eventObject.start.date
        });

        const response = await calendar.events.update({
          calendarId: calendarId,
          eventId: eventId,
          resource: eventObject
        });

        const duration = Date.now() - startTime;
        structuredLogger.apiMetrics('calendar.events.update', duration, {
          correlationId: cId,
          eventId,
          calendarId
        });

        // Record metrics for monitoring
        metricsCollector.recordSyncOperation('updateEvent', true, duration, null, cId);

        const result = {
          eventId: response.data.id,
          calendarId: calendarId,
          htmlLink: response.data.htmlLink,
          updated: response.data.updated
        };

        structuredLogger.syncSuccess('updateEvent', {
          correlationId: cId,
          eventId: result.eventId,
          duration
        });

        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        const classifiedError = this._handleApiError(error, cId);
        
        // Record metrics for monitoring
        metricsCollector.recordSyncOperation('updateEvent', false, duration, classifiedError.type, cId);
        
        // Record auth issues if applicable
        if (classifiedError.type === 'AUTH_ERROR') {
          const issueType = classifiedError.requiresReconnection ? 'reconnectionRequired' : 'tokenRefresh';
          metricsCollector.recordAuthIssue(issueType, {
            operation: 'updateEvent',
            eventId,
            errorMessage: classifiedError.message
          }, cId);
        }
        
        structuredLogger.syncFailure('updateEvent', error, {
          correlationId: cId,
          eventId,
          duration,
          calendarId: userIntegration.calendarId || 'primary'
        });
        throw classifiedError;
      }
    }, cId);
  }

  /**
   * Search for an existing event by app event ID
   * @param {Object} userIntegration - User's Google integration data
   * @param {string} messageId - Message ID to search for
   * @param {string} correlationId - Optional correlation ID for tracking
   * @returns {Promise<Object|null>} Found event or null
   */
  async searchEventByAppId(userIntegration, messageId, correlationId = null) {
    const cId = correlationId || generateCorrelationId();
    const startTime = Date.now();
    
    structuredLogger.syncStart('searchEventByAppId', {
      correlationId: cId,
      messageId,
      userId: userIntegration.userId,
      calendarId: userIntegration.calendarId || 'primary'
    });

    // Debug logging
    structuredLogger.debug('searchEventByAppId input validation', {
      correlationId: cId,
      hasUserIntegration: !!userIntegration,
      hasAccessToken: !!userIntegration?.accessToken,
      hasRefreshToken: !!userIntegration?.refreshToken,
      connected: userIntegration?.connected,
      calendarSyncEnabled: userIntegration?.calendarSyncEnabled
    });

    return await this.executeWithTokenRefresh(userIntegration, async (validUserIntegration) => {
      try {
        const calendar = this._getCalendarClient(validUserIntegration);
        const calendarId = validUserIntegration.calendarId || 'primary';

        structuredLogger.debug('Searching for existing event', {
          correlationId: cId,
          messageId,
          calendarId
        });

        const response = await calendar.events.list({
          calendarId: calendarId,
          privateExtendedProperty: `app_event_id=${messageId}`,
          maxResults: 1,
          singleEvents: true
        });

        const duration = Date.now() - startTime;
        structuredLogger.apiMetrics('calendar.events.list', duration, {
          correlationId: cId,
          messageId,
          calendarId,
          resultsFound: response.data.items?.length || 0
        });

        // Record metrics for monitoring
        metricsCollector.recordSyncOperation('searchEvent', true, duration, null, cId);

        if (response.data.items && response.data.items.length > 0) {
          const event = response.data.items[0];
          const result = {
            eventId: event.id,
            calendarId: calendarId,
            htmlLink: event.htmlLink,
            summary: event.summary,
            start: event.start,
            end: event.end
          };

          structuredLogger.syncSuccess('searchEventByAppId', {
            correlationId: cId,
            messageId,
            eventId: result.eventId,
            duration
          });

          return result;
        }

        structuredLogger.info('No existing event found', {
          correlationId: cId,
          messageId,
          duration
        });

        return null;
      } catch (error) {
        const duration = Date.now() - startTime;
        const classifiedError = this._handleApiError(error, cId);
        
        // Record metrics for monitoring
        metricsCollector.recordSyncOperation('searchEvent', false, duration, classifiedError.type, cId);
        
        // Record auth issues if applicable
        if (classifiedError.type === 'AUTH_ERROR') {
          const issueType = classifiedError.requiresReconnection ? 'reconnectionRequired' : 'tokenRefresh';
          metricsCollector.recordAuthIssue(issueType, {
            operation: 'searchEvent',
            messageId,
            errorMessage: classifiedError.message
          }, cId);
        }
        
        structuredLogger.syncFailure('searchEventByAppId', error, {
          correlationId: cId,
          messageId,
          duration,
          calendarId: userIntegration.calendarId || 'primary'
        });
        throw classifiedError;
      }
    }, cId);
  }

  /**
   * Refresh access token using refresh token
   * @param {string} refreshToken - Encrypted refresh token
   * @returns {Promise<Object>} New token data
   */
  async refreshAccessToken(refreshToken) {
    const startTime = Date.now();
    const correlationId = generateCorrelationId();
    
    if (!refreshToken) {
      const error = new Error('Refresh token is required');
      error.type = 'AUTH_ERROR';
      error.retryable = false;
      
      // Record auth issue
      metricsCollector.recordAuthIssue('tokenRefresh', {
        reason: 'missing_refresh_token'
      }, correlationId);
      
      throw error;
    }

    try {
      const oauth2Client = new google.auth.OAuth2(
        this.clientId,
        this.clientSecret,
        this.redirectUri
      );

      // Os tokens já vêm descriptografados do SyncManager
      const decryptedRefreshToken = refreshToken;
      
      if (!decryptedRefreshToken) {
        const error = new Error('Missing refresh token');
        error.type = 'AUTH_ERROR';
        error.retryable = false;
        throw error;
      }
      
      oauth2Client.setCredentials({
        refresh_token: decryptedRefreshToken
      });

      const { credentials } = await oauth2Client.refreshAccessToken();

      if (!credentials.access_token) {
        const error = new Error('No access token received from refresh');
        error.type = 'AUTH_ERROR';
        error.retryable = false;
        throw error;
      }

      const duration = Date.now() - startTime;
      
      // Record successful token refresh
      metricsCollector.recordSyncOperation('tokenRefresh', true, duration, null, correlationId);

      return {
        access_token: credentials.access_token,
        expires_in: Math.floor((credentials.expiry_date - Date.now()) / 1000),
        expires_at: new Date(credentials.expiry_date),
        token_type: credentials.token_type || 'Bearer'
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error('Error refreshing access token:', error);
      
      // Handle specific refresh token errors
      if (error.message?.includes('invalid_grant') || 
          error.message?.includes('Token has been expired or revoked')) {
        const authError = new Error('Refresh token is invalid or expired. User needs to reconnect.');
        authError.type = 'AUTH_ERROR';
        authError.retryable = false;
        authError.requiresReconnection = true;
        
        // Record failed token refresh requiring reconnection
        metricsCollector.recordSyncOperation('tokenRefresh', false, duration, 'AUTH_ERROR', correlationId);
        metricsCollector.recordAuthIssue('reconnectionRequired', {
          reason: 'invalid_grant',
          errorMessage: error.message
        }, correlationId);
        
        throw authError;
      }
      
      // Record failed token refresh
      const classifiedError = this._handleApiError(error);
      metricsCollector.recordSyncOperation('tokenRefresh', false, duration, classifiedError.type, correlationId);
      metricsCollector.recordAuthIssue('tokenRefresh', {
        reason: 'refresh_failed',
        errorMessage: error.message
      }, correlationId);
      
      throw classifiedError;
    }
  }

  /**
   * Revoke Google tokens
   * @param {string} accessToken - Access token to revoke
   * @param {string} refreshToken - Refresh token to revoke
   * @returns {Promise<boolean>} Success status
   */
  async revokeTokens(accessToken, refreshToken) {
    let revokedCount = 0;
    const errors = [];

    try {
      const oauth2Client = new google.auth.OAuth2(
        this.clientId,
        this.clientSecret,
        this.redirectUri
      );

      // Try to revoke the access token first
      if (accessToken) {
        try {
          await oauth2Client.revokeToken(accessToken);
          revokedCount++;
          console.log('Successfully revoked access token');
        } catch (error) {
          console.warn('Failed to revoke access token:', error.message);
          errors.push({ type: 'access_token', error: error.message });
        }
      }

      // Try to revoke the refresh token
      if (refreshToken) {
        try {
          const decryptedRefreshToken = this._decryptToken(refreshToken);
          if (decryptedRefreshToken) {
            await oauth2Client.revokeToken(decryptedRefreshToken);
            revokedCount++;
            console.log('Successfully revoked refresh token');
            
            // Audit log successful token revocation
            securityUtils.logSecurityEvent('TOKEN_REVOKED', {
              severity: 'INFO',
              details: 'Refresh token successfully revoked'
            });
          } else {
            console.warn('Could not decrypt refresh token for revocation');
            errors.push({ type: 'refresh_token', error: 'Failed to decrypt token' });
          }
        } catch (error) {
          console.warn('Failed to revoke refresh token:', error.message);
          errors.push({ type: 'refresh_token', error: error.message });
        }
      }

      // Log summary
      if (errors.length > 0) {
        console.warn(`Token revocation completed with ${revokedCount} successes and ${errors.length} failures:`, errors);
      }

      // Return true if at least one token was revoked or if no tokens were provided
      return revokedCount > 0 || (!accessToken && !refreshToken);
    } catch (error) {
      console.error('Unexpected error during token revocation:', error);
      // Don't throw error for token revocation failures
      // as the tokens might already be invalid
      return false;
    }
  }

  /**
   * Validate if access token is still valid and not expired
   * @param {Object} userIntegration - User's Google integration data
   * @returns {Promise<boolean>} True if token is valid
   */
  async validateToken(userIntegration) {
    if (!userIntegration.accessToken) {
      return false;
    }

    // Check if token is expired (with 5 minute buffer)
    const now = new Date();
    const expiresAt = userIntegration.tokenExpiresAt;
    const bufferTime = 5 * 60 * 1000; // 5 minutes in milliseconds

    if (!expiresAt || (expiresAt.getTime() - bufferTime) <= now.getTime()) {
      return false;
    }

    // Optionally test the token with a lightweight API call
    try {
      const calendar = this._getCalendarClient(userIntegration);
      await calendar.calendarList.get({ calendarId: 'primary' });
      return true;
    } catch (error) {
      console.warn('Token validation failed with API test:', error.message);
      return false;
    }
  }

  /**
   * Ensure user has valid access token, refreshing if necessary
   * @param {Object} userIntegration - User's Google integration data
   * @returns {Promise<Object>} Updated user integration with valid token
   */
  async ensureValidToken(userIntegration) {
    // Check if current token is valid
    const isValid = await this.validateToken(userIntegration);
    
    if (isValid) {
      return userIntegration;
    }

    // Token is invalid or expired, try to refresh
    if (!userIntegration.refreshToken) {
      const error = new Error('No refresh token available. User needs to reconnect.');
      error.type = 'AUTH_ERROR';
      error.retryable = false;
      error.requiresReconnection = true;
      throw error;
    }

    try {
      console.log('Access token expired or invalid, attempting refresh...');
      const tokenData = await this.refreshAccessToken(userIntegration.refreshToken);
      
      // Update the user integration with new token data
      userIntegration.accessToken = tokenData.access_token;
      userIntegration.tokenExpiresAt = tokenData.expires_at;
      
      console.log('Successfully refreshed access token');
      return userIntegration;
    } catch (error) {
      console.error('Failed to refresh access token:', error);
      
      if (error.requiresReconnection) {
        // Mark user as disconnected since refresh failed
        userIntegration.connected = false;
        userIntegration.calendarSyncEnabled = false;
      }
      
      throw error;
    }
  }

  /**
   * Execute API call with automatic token refresh on authentication failure
   * @param {Object} userIntegration - User's Google integration data
   * @param {Function} apiCall - Function that makes the API call
   * @param {number} maxRetries - Maximum number of retry attempts
   * @returns {Promise<any>} API call result
   */
  async executeWithTokenRefresh(userIntegration, apiCall, correlationId = null, maxRetries = 1) {
    let lastError;
    
    structuredLogger.debug('executeWithTokenRefresh starting', {
      correlationId,
      attempt: 0,
      maxRetries,
      hasUserIntegration: !!userIntegration
    });
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Ensure we have a valid token before making the call
        const validUserIntegration = await this.ensureValidToken(userIntegration);
        
        structuredLogger.debug('Token validation completed', {
          correlationId,
          attempt,
          hasValidToken: !!validUserIntegration?.accessToken
        });
        
        // Execute the API call
        return await apiCall(validUserIntegration);
      } catch (error) {
        lastError = error;
        
        structuredLogger.debug('executeWithTokenRefresh error caught', {
          correlationId,
          attempt,
          errorMessage: error?.message,
          errorType: error?.type,
          hasError: !!error
        });
        
        // If it's an auth error and we haven't exhausted retries, try once more
        if (error.type === 'AUTH_ERROR' && attempt < maxRetries) {
          console.log(`Authentication failed on attempt ${attempt + 1}, retrying...`);
          
          // Force token refresh by marking current token as expired
          userIntegration.tokenExpiresAt = new Date(Date.now() - 1000);
          continue;
        }
        
        // For non-auth errors or exhausted retries, throw immediately
        break;
      }
    }
    
    throw lastError;
  }

  /**
   * Decrypt token using the security utils
   * @param {string} encryptedToken - Encrypted token
   * @param {string} correlationId - Optional correlation ID for audit logging
   * @returns {string} Decrypted token
   */
  _decryptToken(encryptedToken, correlationId = null) {
    if (!encryptedToken) return null;
    
    try {
      const decryptedToken = securityUtils.decrypt(encryptedToken, correlationId);
      
      // If decryption returns null, it means the token is corrupted or encrypted with wrong key
      if (!decryptedToken) {
        securityUtils.logSecurityEvent('TOKEN_CORRUPTION_DETECTED', {
          severity: 'ERROR',
          correlationId,
          details: 'Token decryption returned null - likely corrupted or wrong encryption key'
        });
        
        const error = new Error('Failed to decrypt refresh token - token may be corrupted');
        error.type = 'AUTH_ERROR';
        error.retryable = false;
        error.requiresReconnection = true;
        throw error;
      }
      
      return decryptedToken;
    } catch (error) {
      securityUtils.logSecurityEvent('TOKEN_DECRYPTION_FAILED', {
        severity: 'ERROR',
        correlationId,
        details: `Failed to decrypt Google API token: ${error.message}`
      });
      
      // Create a more specific error for token decryption failures
      const decryptionError = new Error('Failed to decrypt refresh token');
      decryptionError.type = 'AUTH_ERROR';
      decryptionError.retryable = false;
      decryptionError.requiresReconnection = true;
      throw decryptionError;
    }
  }

  /**
   * Validate reminder data input
   * @param {Object} reminderData - Reminder data to validate
   * @private
   */
  _validateReminderData(reminderData) {
    if (!reminderData || typeof reminderData !== 'object') {
      throw new Error('Reminder data is required and must be an object');
    }

    // Validate required fields
    if (!reminderData.date) {
      throw new Error('Reminder date is required');
    }

    if (!reminderData.description) {
      throw new Error('Reminder description is required');
    }

    // Sanitize and validate description
    try {
      reminderData.description = securityUtils.validateAndSanitize(reminderData.description, {
        type: 'string',
        maxLength: 1000,
        required: true
      });
    } catch (error) {
      throw new Error(`Invalid reminder description: ${error.message}`);
    }

    // Validate date
    if (!(reminderData.date instanceof Date) && typeof reminderData.date !== 'string') {
      throw new Error('Reminder date must be a Date object or string');
    }

    // Validate optional fields
    if (reminderData.duration !== undefined) {
      if (typeof reminderData.duration !== 'number' || reminderData.duration < 1 || reminderData.duration > 1440) {
        throw new Error('Duration must be a number between 1 and 1440 minutes');
      }
    }

    if (reminderData.endDate !== undefined) {
      if (!(reminderData.endDate instanceof Date) && typeof reminderData.endDate !== 'string') {
        throw new Error('End date must be a Date object or string');
      }
    }
  }

  /**
   * Validate user integration data
   * @param {Object} userIntegration - User integration data to validate
   * @private
   */
  _validateUserIntegration(userIntegration) {
    if (!userIntegration || typeof userIntegration !== 'object') {
      throw new Error('User integration data is required');
    }

    // Validate required fields
    if (!userIntegration.userId) {
      throw new Error('User ID is required');
    }

    if (!userIntegration.connected) {
      throw new Error('User must be connected to Google');
    }

    if (!userIntegration.accessToken) {
      throw new Error('Access token is required');
    }

    // Validate optional fields
    if (userIntegration.calendarId) {
      try {
        securityUtils.validateAndSanitize(userIntegration.calendarId, {
          type: 'string',
          maxLength: 255,
          allowedChars: 'a-zA-Z0-9@\\._\\-'
        });
      } catch (error) {
        throw new Error(`Invalid calendar ID: ${error.message}`);
      }
    }

    if (userIntegration.timezone) {
      try {
        securityUtils.validateAndSanitize(userIntegration.timezone, {
          type: 'string',
          maxLength: 50,
          allowedChars: 'a-zA-Z0-9/_\\-'
        });
      } catch (error) {
        throw new Error(`Invalid timezone: ${error.message}`);
      }
    }

    if (userIntegration.defaultReminders && Array.isArray(userIntegration.defaultReminders)) {
      for (const reminder of userIntegration.defaultReminders) {
        if (typeof reminder !== 'number' || reminder < 0 || reminder > 10080) { // Max 1 week
          throw new Error('Default reminders must be numbers between 0 and 10080 minutes');
        }
      }
    }
  }

  /**
   * Handle and classify API errors
   * @param {Error} error - Original error from Google API
   * @param {string} correlationId - Optional correlation ID for tracking
   * @returns {Error} Classified error
   */
  _handleApiError(error, correlationId = null) {
    const status = error.response?.status || error.code;
    const message = error.response?.data?.error?.message || error.message;
    const errorCode = error.response?.data?.error?.code;

    // Create a new error with additional classification
    const classifiedError = new Error(message);
    classifiedError.originalError = error;
    classifiedError.status = status;
    classifiedError.errorCode = errorCode;
    classifiedError.correlationId = correlationId;

    // Preserve existing error classification if it exists (e.g., from token decryption)
    if (error.type) {
      classifiedError.type = error.type;
      classifiedError.retryable = error.retryable;
      classifiedError.requiresReconnection = error.requiresReconnection;
      return classifiedError;
    }

    // Classify error types for retry logic
    if (status === 401) {
      classifiedError.type = 'AUTH_ERROR';
      classifiedError.retryable = false; // Will trigger token refresh
      
      // Check for specific authentication failure reasons
      if (message?.includes('Invalid Credentials') || 
          message?.includes('Request had invalid authentication credentials')) {
        classifiedError.requiresReconnection = false; // Try token refresh first
      } else if (message?.includes('invalid_grant') || 
                 message?.includes('Token has been expired or revoked')) {
        classifiedError.requiresReconnection = true; // User needs to reconnect
      }
    } else if (status === 403) {
      classifiedError.type = 'AUTH_ERROR';
      classifiedError.retryable = false;
      
      // Check if it's a permission issue vs token issue
      if (message?.includes('Forbidden') || message?.includes('insufficient permissions')) {
        classifiedError.requiresReconnection = true; // User needs to grant permissions again
      } else {
        classifiedError.requiresReconnection = false; // Try token refresh first
      }
    } else if (status === 429) {
      classifiedError.type = 'RATE_LIMIT';
      classifiedError.retryable = true;
      
      // Extract retry-after header if available
      const retryAfter = error.response?.headers['retry-after'];
      if (retryAfter) {
        classifiedError.retryAfter = parseInt(retryAfter) * 1000; // Convert to milliseconds
      }
    } else if (status >= 500) {
      classifiedError.type = 'SERVER_ERROR';
      classifiedError.retryable = true;
    } else if (status === 400) {
      classifiedError.type = 'CLIENT_ERROR';
      classifiedError.retryable = false;
      
      // Some 400 errors might indicate token issues
      if (message?.includes('invalid_request') && message?.includes('token')) {
        classifiedError.type = 'AUTH_ERROR';
        classifiedError.requiresReconnection = false;
      }
    } else if (status >= 400) {
      classifiedError.type = 'CLIENT_ERROR';
      classifiedError.retryable = false;
    } else {
      classifiedError.type = 'UNKNOWN_ERROR';
      classifiedError.retryable = false;
    }

    // Log the classified error
    structuredLogger.error('Google Calendar API error classified', {
      correlationId,
      errorType: classifiedError.type,
      status: classifiedError.status,
      retryable: classifiedError.retryable,
      requiresReconnection: classifiedError.requiresReconnection,
      message: classifiedError.message
    });

    return classifiedError;
  }
}

export default new GoogleCalendarService();