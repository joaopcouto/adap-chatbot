import { structuredLogger } from '../helpers/logger.js';
import { sendTextMessage } from './whatsappService.js';
import UserGoogleIntegration from '../models/UserGoogleIntegration.js';
import User from '../models/User.js';

/**
 * Service for handling user notifications related to Google Calendar sync failures
 */
class UserNotificationService {
  constructor() {
    this.notificationCooldown = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
    this.maxNotificationsPerDay = 3;
  }

  /**
   * Notify user about sync failure requiring reconnection
   * @param {string} userId - User ID
   * @param {string} correlationId - Correlation ID for tracking
   * @param {Object} error - Error details
   * @returns {Promise<boolean>} True if notification was sent
   */
  async notifyReconnectionRequired(userId, correlationId, error = {}) {
    try {
      structuredLogger.info('Processing reconnection notification', {
        userId,
        correlationId,
        errorType: error.type
      });

      // Check if we should send notification (rate limiting)
      const shouldNotify = await this._shouldSendNotification(userId, 'RECONNECTION_REQUIRED');
      
      if (!shouldNotify) {
        structuredLogger.info('Notification skipped due to rate limiting', {
          userId,
          correlationId,
          notificationType: 'RECONNECTION_REQUIRED'
        });
        return false;
      }

      // Get user details
      const user = await User.findById(userId);
      if (!user || !user.phoneNumber) {
        structuredLogger.warn('User not found or missing phone number for notification', {
          userId,
          correlationId
        });
        return false;
      }

      // Prepare notification message
      const message = this._buildReconnectionMessage(error);

      // Send notification via SMS
      await sendTextMessage(user.phoneNumber, message);

      // Record notification sent
      await this._recordNotificationSent(userId, 'RECONNECTION_REQUIRED');

      structuredLogger.userNotification(userId, 'RECONNECTION_REQUIRED', {
        correlationId,
        phoneNumber: this._maskPhoneNumber(user.phoneNumber)
      });

      return true;

    } catch (notificationError) {
      structuredLogger.error('Failed to send reconnection notification', {
        userId,
        correlationId,
        error: notificationError
      });
      return false;
    }
  }

  /**
   * Notify user about persistent sync failures
   * @param {string} userId - User ID
   * @param {string} correlationId - Correlation ID for tracking
   * @param {Object} syncStats - Sync failure statistics
   * @returns {Promise<boolean>} True if notification was sent
   */
  async notifyPersistentFailures(userId, correlationId, syncStats = {}) {
    try {
      structuredLogger.info('Processing persistent failure notification', {
        userId,
        correlationId,
        failureCount: syncStats.failureCount,
        lastFailureTime: syncStats.lastFailureTime
      });

      // Check if we should send notification
      const shouldNotify = await this._shouldSendNotification(userId, 'PERSISTENT_FAILURES');
      
      if (!shouldNotify) {
        structuredLogger.info('Notification skipped due to rate limiting', {
          userId,
          correlationId,
          notificationType: 'PERSISTENT_FAILURES'
        });
        return false;
      }

      // Get user details
      const user = await User.findById(userId);
      if (!user || !user.phoneNumber) {
        structuredLogger.warn('User not found or missing phone number for notification', {
          userId,
          correlationId
        });
        return false;
      }

      // Prepare notification message
      const message = this._buildPersistentFailureMessage(syncStats);

      // Send notification via SMS
      await sendTextMessage(user.phoneNumber, message);

      // Record notification sent
      await this._recordNotificationSent(userId, 'PERSISTENT_FAILURES');

      structuredLogger.userNotification(userId, 'PERSISTENT_FAILURES', {
        correlationId,
        phoneNumber: this._maskPhoneNumber(user.phoneNumber),
        failureCount: syncStats.failureCount
      });

      return true;

    } catch (notificationError) {
      structuredLogger.error('Failed to send persistent failure notification', {
        userId,
        correlationId,
        error: notificationError
      });
      return false;
    }
  }

  /**
   * Notify user about successful reconnection
   * @param {string} userId - User ID
   * @param {string} correlationId - Correlation ID for tracking
   * @returns {Promise<boolean>} True if notification was sent
   */
  async notifyReconnectionSuccess(userId, correlationId) {
    try {
      structuredLogger.info('Processing reconnection success notification', {
        userId,
        correlationId
      });

      // Get user details
      const user = await User.findById(userId);
      if (!user || !user.phoneNumber) {
        structuredLogger.warn('User not found or missing phone number for notification', {
          userId,
          correlationId
        });
        return false;
      }

      // Prepare success message
      const message = `✅ *Google Calendar Conectado!*

Sua integração com o Google Calendar foi restaurada com sucesso. Seus lembretes voltarão a ser sincronizados automaticamente.

Se você tiver dúvidas, digite "ajuda".`;

      // Send notification via SMS
      await sendTextMessage(user.phoneNumber, message);

      structuredLogger.userNotification(userId, 'RECONNECTION_SUCCESS', {
        correlationId,
        phoneNumber: this._maskPhoneNumber(user.phoneNumber)
      });

      return true;

    } catch (notificationError) {
      structuredLogger.error('Failed to send reconnection success notification', {
        userId,
        correlationId,
        error: notificationError
      });
      return false;
    }
  }

  /**
   * Check if notification should be sent based on rate limiting
   * @param {string} userId - User ID
   * @param {string} notificationType - Type of notification
   * @returns {Promise<boolean>} True if should send notification
   */
  async _shouldSendNotification(userId, notificationType) {
    try {
      const userIntegration = await UserGoogleIntegration.findOne({ userId });
      
      if (!userIntegration) {
        return false;
      }

      const now = new Date();
      const notifications = userIntegration.notifications || {};
      const typeNotifications = notifications[notificationType] || [];

      // Remove old notifications (older than 24 hours)
      const recentNotifications = typeNotifications.filter(
        timestamp => (now.getTime() - new Date(timestamp).getTime()) < this.notificationCooldown
      );

      // Check if we've exceeded the daily limit
      if (recentNotifications.length >= this.maxNotificationsPerDay) {
        return false;
      }

      // Check if last notification was sent too recently (minimum 1 hour gap)
      if (recentNotifications.length > 0) {
        const lastNotification = new Date(Math.max(...recentNotifications.map(t => new Date(t).getTime())));
        const timeSinceLastNotification = now.getTime() - lastNotification.getTime();
        const minimumGap = 60 * 60 * 1000; // 1 hour

        if (timeSinceLastNotification < minimumGap) {
          return false;
        }
      }

      return true;

    } catch (error) {
      structuredLogger.error('Error checking notification rate limit', {
        userId,
        notificationType,
        error
      });
      // Default to allowing notification if we can't check rate limit
      return true;
    }
  }

  /**
   * Record that a notification was sent
   * @param {string} userId - User ID
   * @param {string} notificationType - Type of notification
   */
  async _recordNotificationSent(userId, notificationType) {
    try {
      const now = new Date();
      
      await UserGoogleIntegration.findOneAndUpdate(
        { userId },
        {
          $push: {
            [`notifications.${notificationType}`]: {
              $each: [now],
              $slice: -this.maxNotificationsPerDay // Keep only the most recent notifications
            }
          }
        },
        { upsert: true }
      );

    } catch (error) {
      structuredLogger.error('Error recording notification sent', {
        userId,
        notificationType,
        error
      });
    }
  }

  /**
   * Build reconnection required message
   * @param {Object} error - Error details
   * @returns {string} Formatted message
   */
  _buildReconnectionMessage(error) {
    let message = `🔄 *Google Calendar - Reconexão Necessária*

Detectamos um problema com sua integração do Google Calendar. `;

    if (error.type === 'TOKEN_CORRUPTION') {
      message += `Suas credenciais de acesso foram corrompidas e precisam ser renovadas.`;
    } else if (error.type === 'AUTH_ERROR' && error.requiresReconnection) {
      message += `Suas credenciais expiraram ou foram revogadas.`;
    } else {
      message += `Houve um problema de autenticação.`;
    }

    message += `

Para continuar sincronizando seus lembretes:
1. Digite "conectar google" para reconectar
2. Ou acesse suas configurações no app

Seus lembretes locais não foram afetados.`;

    return message;
  }

  /**
   * Build persistent failure message
   * @param {Object} syncStats - Sync statistics
   * @returns {string} Formatted message
   */
  _buildPersistentFailureMessage(syncStats) {
    const failureCount = syncStats.failureCount || 'múltiplas';
    
    return `⚠️ *Google Calendar - Falhas Persistentes*

Detectamos ${failureCount} falhas consecutivas na sincronização com o Google Calendar.

Possíveis causas:
• Problemas temporários na API do Google
• Limites de uso atingidos
• Configuração da conta

Seus lembretes locais estão seguros. A sincronização será tentada automaticamente.

Se o problema persistir, digite "ajuda google" para suporte.`;
  }

  /**
   * Mask phone number for logging (privacy protection)
   * @param {string} phoneNumber - Phone number to mask
   * @returns {string} Masked phone number
   */
  _maskPhoneNumber(phoneNumber) {
    if (!phoneNumber || phoneNumber.length < 4) {
      return '***';
    }
    
    const start = phoneNumber.substring(0, 2);
    const end = phoneNumber.substring(phoneNumber.length - 2);
    const middle = '*'.repeat(phoneNumber.length - 4);
    
    return `${start}${middle}${end}`;
  }
}

export default new UserNotificationService();