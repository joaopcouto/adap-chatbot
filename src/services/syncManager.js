import ReminderSync from '../models/ReminderSync.js';
import UserGoogleIntegration from '../models/UserGoogleIntegration.js';
import googleCalendarService from './googleCalendarService.js';
import metricsCollector from './metricsCollector.js';
import { devLog } from '../helpers/logger.js';
import { structuredLogger, generateCorrelationId } from '../helpers/logger.js';
import userNotificationService from './userNotificationService.js';
import configManager from '../config/config.js';
import featureFlagService from './featureFlagService.js';

class SyncManager {
  constructor() {
    this.retryConfig = {
      maxRetries: configManager.get('googleCalendar.maxSyncRetries'),
      baseDelay: configManager.get('googleCalendar.syncRetryBaseDelayMs'),
      maxDelay: configManager.get('googleCalendar.syncRetryMaxDelayMs'),
      backoffMultiplier: configManager.get('googleCalendar.syncRetryBackoffMultiplier'),
      jitterFactor: configManager.get('googleCalendar.syncRetryJitterFactor')
    };
  }

  /**
   * Sync a reminder to Google Calendar
   * @param {Object} reminder - Reminder object with messageId, description, date
   * @param {Object} user - User object with _id
   * @param {string} correlationId - Optional correlation ID for tracking
   * @returns {Promise<Object>} Sync result with status and details
   */
  async syncReminder(reminder, user, correlationId = null) {
    const cId = correlationId || generateCorrelationId();
    
    // Check if Google Calendar integration is enabled globally
    if (!featureFlagService.isEnabled('googleCalendarIntegrationEnabled')) {
      structuredLogger.info('Sync skipped - Google Calendar integration disabled globally', {
        correlationId: cId,
        messageId: reminder.messageId,
        userId: user._id
      });
      return { success: false, reason: 'FEATURE_DISABLED', correlationId: cId };
    }
    
    structuredLogger.syncStart('syncReminder', {
      correlationId: cId,
      messageId: reminder.messageId,
      userId: user._id,
      reminderDescription: reminder.description?.substring(0, 50) + '...'
    });

    try {
      // Create initial ReminderSync record with QUEUED status
      const reminderSync = await this._createReminderSyncRecord(reminder.messageId, user._id, cId);
      
      // Check if user has Google integration enabled
      const userIntegration = await this._getUserGoogleIntegration(user._id, cId);
      
      if (!this._shouldSync(userIntegration)) {
        structuredLogger.info('Sync skipped - integration not enabled', {
          correlationId: cId,
          messageId: reminder.messageId,
          userId: user._id,
          connected: userIntegration?.connected,
          calendarSyncEnabled: userIntegration?.calendarSyncEnabled
        });
        
        return {
          status: 'SKIPPED',
          reason: 'Google Calendar integration not enabled',
          reminderSyncId: reminderSync._id
        };
      }

      // Attempt to sync with Google Calendar
      const syncResult = await this._performGoogleCalendarSync(reminder, userIntegration, reminderSync, cId);
      
      structuredLogger.syncSuccess('syncReminder', {
        correlationId: cId,
        messageId: reminder.messageId,
        status: syncResult.status,
        googleEventId: syncResult.googleEventId
      });

      // Update queue metrics after successful sync
      await metricsCollector.updateQueueMetrics(null, cId);

      return {
        status: syncResult.status,
        reminderSyncId: reminderSync._id,
        googleEventId: syncResult.googleEventId,
        calendarId: syncResult.calendarId,
        error: syncResult.error
      };

    } catch (error) {
      structuredLogger.syncFailure('syncReminder', error, {
        correlationId: cId,
        messageId: reminder.messageId,
        userId: user._id
      });
      
      // Try to update sync record if we have the messageId
      try {
        await ReminderSync.findOneAndUpdate(
          { messageId: reminder.messageId },
          {
            syncStatus: 'FAILED',
            lastError: `Unexpected sync error: ${error.message}`,
            lastTriedAt: new Date()
          }
        );
      } catch (updateError) {
        structuredLogger.error('Failed to update sync record after error', {
          correlationId: cId,
          messageId: reminder.messageId,
          error: updateError
        });
      }

      // Update queue metrics after failure
      await metricsCollector.updateQueueMetrics(null, cId);

      return {
        status: 'FAILED',
        error: error.message
      };
    }
  }

  /**
   * Retry a failed sync attempt
   * @param {Object} reminderSync - ReminderSync document
   * @returns {Promise<Object>} Retry result
   */
  async retryFailedSync(reminderSync) {
    const correlationId = this._generateCorrelationId();
    
    devLog(`[SyncManager] Retrying failed sync for reminder ${reminderSync.messageId} (attempt ${reminderSync.retryCount + 1}) - ${correlationId}`);

    try {
      // Check if we've exceeded max retries
      if (reminderSync.retryCount >= reminderSync.maxRetries) {
        devLog(`[SyncManager] Max retries exceeded for reminder ${reminderSync.messageId} - ${correlationId}`);
        
        await ReminderSync.findByIdAndUpdate(reminderSync._id, {
          syncStatus: 'FAILED',
          lastError: 'Max retries exceeded',
          lastTriedAt: new Date()
        });

        return {
          status: 'FAILED',
          reason: 'Max retries exceeded'
        };
      }

      // Get user integration
      const userIntegration = await this._getUserGoogleIntegration(reminderSync.userId);
      
      if (!this._shouldSync(userIntegration)) {
        devLog(`[SyncManager] Retry skipped - integration no longer enabled for user ${reminderSync.userId} - ${correlationId}`);
        
        await ReminderSync.findByIdAndUpdate(reminderSync._id, {
          syncStatus: 'FAILED',
          lastError: 'Google Calendar integration disabled',
          lastTriedAt: new Date()
        });

        return {
          status: 'FAILED',
          reason: 'Integration disabled'
        };
      }

      // Calculate delay for this retry attempt
      const delay = this._calculateRetryDelay(reminderSync.retryCount);
      const timeSinceLastTry = Date.now() - (reminderSync.lastTriedAt?.getTime() || 0);
      
      if (timeSinceLastTry < delay) {
        devLog(`[SyncManager] Retry too soon for reminder ${reminderSync.messageId}, waiting ${delay - timeSinceLastTry}ms - ${correlationId}`);
        return {
          status: 'DELAYED',
          retryAfter: delay - timeSinceLastTry
        };
      }

      // Increment retry count
      await ReminderSync.findByIdAndUpdate(reminderSync._id, {
        $inc: { retryCount: 1 },
        lastTriedAt: new Date()
      });

      // Create reminder object for sync (we need to reconstruct it)
      const reminder = {
        messageId: reminderSync.messageId,
        // Note: We don't have the original reminder data here
        // In a real implementation, we might need to store this in ReminderSync
        // or fetch it from the Reminder collection
        description: 'Retry sync', // Placeholder
        date: new Date() // Placeholder
      };

      // Perform the sync
      const syncResult = await this._performGoogleCalendarSync(reminder, userIntegration, reminderSync, correlationId);
      
      return {
        status: syncResult.status,
        googleEventId: syncResult.googleEventId,
        calendarId: syncResult.calendarId,
        error: syncResult.error
      };

    } catch (error) {
      devLog(`[SyncManager] Error during retry for reminder ${reminderSync.messageId} - ${correlationId}:`, error);
      
      await this._handleSyncFailure(reminderSync, error, correlationId);
      
      return {
        status: 'FAILED',
        error: error.message
      };
    }
  }

  /**
   * Process the retry queue for failed syncs
   * @returns {Promise<Object>} Processing results
   */
  async processRetryQueue() {
    const correlationId = this._generateCorrelationId();
    
    devLog(`[SyncManager] Processing retry queue - ${correlationId}`);

    try {
      // Find failed syncs that are ready for retry
      const failedSyncs = await ReminderSync.find({
        syncStatus: 'FAILED',
        retryCount: { $lt: this.retryConfig.maxRetries },
        $or: [
          { lastTriedAt: null },
          { lastTriedAt: { $lt: new Date(Date.now() - this.retryConfig.baseDelay) } }
        ]
      }).limit(10); // Process in batches

      devLog(`[SyncManager] Found ${failedSyncs.length} syncs ready for retry - ${correlationId}`);

      const results = {
        processed: 0,
        succeeded: 0,
        failed: 0,
        delayed: 0
      };

      for (const reminderSync of failedSyncs) {
        try {
          const result = await this.retryFailedSync(reminderSync);
          results.processed++;
          
          if (result.status === 'OK') {
            results.succeeded++;
          } else if (result.status === 'DELAYED') {
            results.delayed++;
          } else {
            results.failed++;
          }
        } catch (error) {
          devLog(`[SyncManager] Error processing retry for ${reminderSync.messageId} - ${correlationId}:`, error);
          results.processed++;
          results.failed++;
        }
      }

      devLog(`[SyncManager] Retry queue processing complete - ${correlationId}:`, results);
      return results;

    } catch (error) {
      devLog(`[SyncManager] Error processing retry queue - ${correlationId}:`, error);
      throw error;
    }
  }

  /**
   * Check if sync should be performed for a user
   * @param {Object} userIntegration - UserGoogleIntegration document
   * @returns {boolean} True if sync should be performed
   */
  _shouldSync(userIntegration) {
    if (!userIntegration) {
      return false;
    }

    return !!(userIntegration.connected && 
              userIntegration.calendarSyncEnabled && 
              userIntegration.accessToken && 
              userIntegration.refreshToken);
  }

  /**
   * Get user's Google integration settings
   * @param {string} userId - User ID
   * @param {string} correlationId - Correlation ID for tracking
   * @returns {Promise<Object|null>} UserGoogleIntegration document or null
   */
  async _getUserGoogleIntegration(userId, correlationId) {
    try {
      const integration = await UserGoogleIntegration.findOne({ userId });
      
      structuredLogger.debug('Retrieved user Google integration', {
        correlationId,
        userId,
        hasIntegration: !!integration,
        connected: integration?.connected,
        calendarSyncEnabled: integration?.calendarSyncEnabled,
        hasGetDecryptedRefreshTokenMethod: typeof integration?.getDecryptedRefreshToken === 'function',
        hasAccessToken: !!integration?.accessToken,
        hasRefreshToken: !!integration?.refreshToken
      });
      
      return integration;
    } catch (error) {
      structuredLogger.error('Error fetching user integration', {
        correlationId,
        userId,
        error
      });
      return null;
    }
  }

  /**
   * Create initial ReminderSync record
   * @param {string} messageId - Reminder message ID
   * @param {string} userId - User ID
   * @param {string} correlationId - Correlation ID for tracking
   * @returns {Promise<Object>} Created ReminderSync document
   */
  async _createReminderSyncRecord(messageId, userId, correlationId) {
    try {
      // Check if record already exists
      const existing = await ReminderSync.findOne({ messageId });
      if (existing) {
        structuredLogger.info('ReminderSync record already exists', {
          correlationId,
          messageId,
          existingStatus: existing.syncStatus
        });
        return existing;
      }

      const reminderSync = new ReminderSync({
        messageId,
        userId,
        syncStatus: 'QUEUED',
        maxRetries: this.retryConfig.maxRetries
      });

      await reminderSync.save();
      
      structuredLogger.info('Created ReminderSync record', {
        correlationId,
        messageId,
        userId,
        reminderSyncId: reminderSync._id
      });
      
      return reminderSync;
    } catch (error) {
      structuredLogger.error('Error creating ReminderSync record', {
        correlationId,
        messageId,
        userId,
        error
      });
      throw error;
    }
  }

  /**
   * Perform the actual Google Calendar sync
   * @param {Object} reminder - Reminder data
   * @param {Object} userIntegration - User's Google integration
   * @param {Object} reminderSync - ReminderSync document
   * @param {string} correlationId - Correlation ID for logging
   * @returns {Promise<Object>} Sync result
   */
  async _performGoogleCalendarSync(reminder, userIntegration, reminderSync, correlationId) {
    try {
      structuredLogger.info('Starting Google Calendar sync operation', {
        correlationId,
        messageId: reminder.messageId,
        userId: userIntegration.userId
      });

      // Check for existing event to avoid duplicates
      // Detectar se é um documento Mongoose ou objeto simples
      const decryptedTokens = await this._getDecryptedTokens(userIntegration);
      
      const existingEvent = await googleCalendarService.searchEventByAppId(
        decryptedTokens, 
        reminder.messageId, 
        correlationId
      );
      
      let syncResult;
      
      if (existingEvent) {
        structuredLogger.info('Found existing event, updating', {
          correlationId,
          messageId: reminder.messageId,
          existingEventId: existingEvent.eventId
        });
        
        // Update existing event
        const decryptedTokensUpdate = await this._getDecryptedTokens(userIntegration);
        
        const updateResult = await googleCalendarService.updateEvent(
          existingEvent.eventId,
          decryptedTokensUpdate,
          reminder,
          correlationId
        );
        
        syncResult = {
          status: 'OK',
          googleEventId: updateResult.eventId,
          calendarId: updateResult.calendarId,
          action: 'updated'
        };
      } else {
        structuredLogger.info('Creating new Google Calendar event', {
          correlationId,
          messageId: reminder.messageId
        });
        
        // Create new event
        const decryptedTokensCreate = await this._getDecryptedTokens(userIntegration);
        
        const createResult = await googleCalendarService.createEvent(
          decryptedTokensCreate,
          reminder,
          reminder.messageId,
          correlationId
        );
        
        syncResult = {
          status: 'OK',
          googleEventId: createResult.eventId,
          calendarId: createResult.calendarId,
          action: 'created'
        };
      }

      // Update ReminderSync record with success
      await ReminderSync.findByIdAndUpdate(reminderSync._id, {
        syncStatus: 'OK',
        googleEventId: syncResult.googleEventId,
        calendarId: syncResult.calendarId,
        lastError: null,
        lastTriedAt: new Date()
      });

      structuredLogger.info('Google Calendar sync completed successfully', {
        correlationId,
        messageId: reminder.messageId,
        action: syncResult.action,
        googleEventId: syncResult.googleEventId
      });

      return syncResult;

    } catch (error) {
      // Ensure we have a valid error object
      if (!error) {
        error = new Error('Unknown Google Calendar sync error - error object was undefined');
        error.type = 'UNKNOWN_ERROR';
        error.retryable = false;
        error.requiresReconnection = false;
      }

      structuredLogger.error('Google Calendar sync operation failed', {
        correlationId,
        messageId: reminder.messageId,
        error: error.message || 'Unknown error',
        errorType: error.type || 'UNKNOWN_ERROR'
      });
      
      await this._handleSyncFailure(reminderSync, error, correlationId);
      
      return {
        status: 'FAILED',
        error: error.message || 'Unknown sync error'
      };
    }
  }

  /**
   * Get decrypted tokens from userIntegration (handles both Mongoose documents and plain objects)
   * @param {Object} userIntegration - User integration object
   * @returns {Promise<Object>} Decrypted tokens object
   */
  async _getDecryptedTokens(userIntegration) {
    // Check if it's a Mongoose document with decrypt methods
    if (typeof userIntegration.getDecryptedAccessToken === 'function') {
      return {
        ...userIntegration.toObject(), // Preserve all properties
        accessToken: await userIntegration.getDecryptedAccessToken(),
        refreshToken: await userIntegration.getDecryptedRefreshToken(),
        tokenExpiresAt: userIntegration.tokenExpiresAt
      };
    }
    
    // It's already a plain object with decrypted tokens - return as is
    return userIntegration;
  }

  /**
   * Handle sync failure with proper error classification
   * @param {Object} reminderSync - ReminderSync document
   * @param {Error} error - The error that occurred
   * @param {string} correlationId - Correlation ID for logging
   */
  async _handleSyncFailure(reminderSync, error, correlationId) {
    // Handle case where error is undefined or null
    if (!error) {
      structuredLogger.error('_handleSyncFailure called with undefined/null error', {
        correlationId,
        messageId: reminderSync?.messageId,
        userId: reminderSync?.userId
      });
      
      // Create a fallback error
      error = new Error('Unknown sync failure - error object was undefined');
      error.type = 'UNKNOWN_ERROR';
      error.retryable = false;
      error.requiresReconnection = false;
    }

    const errorClassification = this._classifyError(error);
    
    structuredLogger.error('Handling sync failure', {
      correlationId,
      messageId: reminderSync.messageId,
      userId: reminderSync.userId,
      errorType: errorClassification.type,
      retryable: errorClassification.retryable,
      requiresReconnection: errorClassification.requiresReconnection,
      retryCount: reminderSync.retryCount
    });

    const updateData = {
      lastError: error.message,
      lastTriedAt: new Date()
    };

    // If error is not retryable or requires reconnection, mark as permanently failed
    if (!errorClassification.retryable || errorClassification.requiresReconnection) {
      updateData.syncStatus = 'FAILED';
      
      // If user needs to reconnect, disable their integration and notify them
      if (errorClassification.requiresReconnection) {
        try {
          // For token corruption, completely clear the corrupted tokens
          const updateData = { 
            connected: false,
            calendarSyncEnabled: false 
          };
          
          if (errorClassification.type === 'TOKEN_CORRUPTION') {
            updateData.accessToken = null;
            updateData.refreshToken = null;
            updateData.tokenExpiresAt = null;
            
            structuredLogger.warn('Clearing corrupted tokens from database', {
              correlationId,
              userId: reminderSync.userId,
              errorType: errorClassification.type
            });
          }
          
          await UserGoogleIntegration.findOneAndUpdate(
            { userId: reminderSync.userId },
            updateData
          );
          
          structuredLogger.warn('Disabled Google integration due to auth failure', {
            correlationId,
            userId: reminderSync.userId,
            errorType: errorClassification.type
          });

          // Notify user about reconnection requirement
          await userNotificationService.notifyReconnectionRequired(
            reminderSync.userId,
            correlationId,
            { type: errorClassification.type, requiresReconnection: true }
          );

        } catch (updateError) {
          structuredLogger.error('Failed to disable user integration', {
            correlationId,
            userId: reminderSync.userId,
            error: updateError
          });
        }
      }
    } else if (errorClassification.retryable) {
      // For retryable errors, check if we should notify about persistent failures
      const failureCount = reminderSync.retryCount + 1;
      
      if (failureCount >= this.retryConfig.maxRetries) {
        // Max retries reached, notify about persistent failures
        await userNotificationService.notifyPersistentFailures(
          reminderSync.userId,
          correlationId,
          {
            failureCount,
            lastFailureTime: new Date(),
            errorType: errorClassification.type
          }
        );
      }
    }

    try {
      await ReminderSync.findByIdAndUpdate(reminderSync._id, updateData);
      
      structuredLogger.info('Updated ReminderSync record after failure', {
        correlationId,
        messageId: reminderSync.messageId,
        syncStatus: updateData.syncStatus || 'FAILED'
      });
      
    } catch (updateError) {
      structuredLogger.error('Failed to update ReminderSync record', {
        correlationId,
        messageId: reminderSync.messageId,
        error: updateError
      });
    }
  }

  /**
   * Classify error for retry logic
   * @param {Error} error - Error to classify
   * @returns {Object} Error classification
   */
  _classifyError(error) {
    // Default classification
    const classification = {
      type: 'UNKNOWN_ERROR',
      retryable: false,
      requiresReconnection: false
    };

    // Handle null/undefined errors
    if (!error) {
      structuredLogger.warn('Attempted to classify null/undefined error', {
        error: error
      });
      return classification;
    }

    // Use error type if available (from GoogleCalendarService)
    if (error.type) {
      classification.type = error.type;
      classification.retryable = error.retryable || false;
      classification.requiresReconnection = error.requiresReconnection || false;
      return classification;
    }

    // Fallback classification based on error properties
    const status = error.status || error.code;
    const message = error.message || '';

    if (status === 401 || status === 403) {
      classification.type = 'AUTH_ERROR';
      classification.retryable = false;
      classification.requiresReconnection = message.includes('invalid_grant') || 
                                           message.includes('revoked') ||
                                           message.includes('expired');
    } else if (message.includes('Failed to decrypt refresh token') || 
               message.includes('Failed to decrypt token')) {
      // Handle token decryption failures - these require user reconnection
      classification.type = 'TOKEN_CORRUPTION';
      classification.retryable = false;
      classification.requiresReconnection = true;
      
      // Log specific token corruption event
      structuredLogger.warn('Token corruption detected', {
        correlationId,
        errorMessage: message,
        alertType: 'TOKEN_CORRUPTION_DETECTED'
      });
      
      // Record token corruption metrics
      metricsCollector.recordAuthIssue('tokenCorruption', {
        reason: 'token_decryption_failed',
        errorMessage: message
      }, correlationId);
    } else if (status === 429) {
      classification.type = 'RATE_LIMIT';
      classification.retryable = true;
    } else if (status >= 500) {
      classification.type = 'SERVER_ERROR';
      classification.retryable = true;
    } else if (status >= 400) {
      classification.type = 'CLIENT_ERROR';
      classification.retryable = false;
    } else if (message.includes('network') || message.includes('timeout')) {
      classification.type = 'NETWORK_ERROR';
      classification.retryable = true;
    }

    return classification;
  }

  /**
   * Calculate retry delay with exponential backoff and jitter
   * @param {number} attempt - Retry attempt number (0-based)
   * @returns {number} Delay in milliseconds
   */
  _calculateRetryDelay(attempt) {
    const delay = Math.min(
      this.retryConfig.baseDelay * Math.pow(this.retryConfig.backoffMultiplier, attempt),
      this.retryConfig.maxDelay
    );
    
    // Add jitter to prevent thundering herd
    const jitter = delay * this.retryConfig.jitterFactor * Math.random();
    
    return Math.floor(delay + jitter);
  }

  /**
   * Generate correlation ID for request tracking
   * @returns {string} Correlation ID
   */
  _generateCorrelationId() {
    return generateCorrelationId();
  }
}

export default new SyncManager();