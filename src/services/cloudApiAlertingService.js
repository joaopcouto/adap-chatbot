import { structuredLogger, generateCorrelationId } from '../helpers/logger.js';

/**
 * Cloud API Alerting Service
 * Handles alert notifications for critical Cloud API issues
 */
class CloudApiAlertingService {
  constructor() {
    this.correlationId = generateCorrelationId();
    this.alertChannels = {
      console: true,
      webhook: process.env.ALERT_WEBHOOK_URL || null,
      email: process.env.ALERT_EMAIL_ENABLED === 'true'
    };
    
    this.alertCooldowns = new Map(); // Prevent alert spam
    this.defaultCooldownMs = 5 * 60 * 1000; // 5 minutes
    
    structuredLogger.info('Cloud API Alerting Service initialized', {
      correlationId: this.correlationId,
      channels: this.alertChannels,
      service: 'CloudApiAlertingService'
    });
  }

  /**
   * Send alert notification
   * @param {Object} alert - Alert object
   * @param {string} checkId - Health check ID that triggered the alert
   */
  async sendAlert(alert, checkId) {
    const alertKey = `${alert.type}_${alert.severity}`;
    
    // Check cooldown to prevent spam
    if (this.isInCooldown(alertKey)) {
      structuredLogger.debug('Alert suppressed due to cooldown', {
        alertType: alert.type,
        severity: alert.severity,
        correlationId: this.correlationId,
        service: 'CloudApiAlertingService'
      });
      return;
    }

    try {
      const alertData = {
        ...alert,
        checkId,
        correlationId: this.correlationId,
        timestamp: new Date().toISOString(),
        service: 'WhatsApp Cloud API'
      };

      // Send to enabled channels
      const promises = [];
      
      if (this.alertChannels.console) {
        promises.push(this.sendConsoleAlert(alertData));
      }
      
      if (this.alertChannels.webhook) {
        promises.push(this.sendWebhookAlert(alertData));
      }
      
      if (this.alertChannels.email) {
        promises.push(this.sendEmailAlert(alertData));
      }

      await Promise.allSettled(promises);
      
      // Set cooldown
      this.setCooldown(alertKey);
      
      structuredLogger.info('Alert sent successfully', {
        alertType: alert.type,
        severity: alert.severity,
        checkId,
        correlationId: this.correlationId,
        channels: Object.keys(this.alertChannels).filter(ch => this.alertChannels[ch]),
        service: 'CloudApiAlertingService'
      });

    } catch (error) {
      structuredLogger.error('Failed to send alert', {
        alertType: alert.type,
        severity: alert.severity,
        error: error.message,
        checkId,
        correlationId: this.correlationId,
        service: 'CloudApiAlertingService'
      });
    }
  }

  /**
   * Send console alert (logging)
   * @param {Object} alertData - Alert data
   */
  async sendConsoleAlert(alertData) {
    const logLevel = alertData.severity === 'critical' ? 'error' : 'warn';
    
    structuredLogger[logLevel](`🚨 CLOUD API ALERT: ${alertData.message}`, {
      alertType: alertData.type,
      severity: alertData.severity,
      value: alertData.value,
      threshold: alertData.threshold,
      checkId: alertData.checkId,
      correlationId: alertData.correlationId,
      service: 'CloudApiAlertingService'
    });
  }

  /**
   * Send webhook alert
   * @param {Object} alertData - Alert data
   */
  async sendWebhookAlert(alertData) {
    if (!this.alertChannels.webhook) {
      return;
    }

    try {
      const payload = {
        text: `🚨 WhatsApp Cloud API Alert`,
        attachments: [{
          color: alertData.severity === 'critical' ? 'danger' : 'warning',
          fields: [
            {
              title: 'Alert Type',
              value: alertData.type,
              short: true
            },
            {
              title: 'Severity',
              value: alertData.severity.toUpperCase(),
              short: true
            },
            {
              title: 'Message',
              value: alertData.message,
              short: false
            },
            {
              title: 'Timestamp',
              value: alertData.timestamp,
              short: true
            },
            {
              title: 'Check ID',
              value: alertData.checkId,
              short: true
            }
          ]
        }]
      };

      if (alertData.value !== undefined && alertData.threshold !== undefined) {
        payload.attachments[0].fields.push({
          title: 'Value / Threshold',
          value: `${alertData.value} / ${alertData.threshold}`,
          short: true
        });
      }

      const response = await fetch(this.alertChannels.webhook, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Webhook request failed: ${response.status} ${response.statusText}`);
      }

      structuredLogger.info('Webhook alert sent successfully', {
        alertType: alertData.type,
        webhookUrl: this.alertChannels.webhook,
        correlationId: this.correlationId,
        service: 'CloudApiAlertingService'
      });

    } catch (error) {
      structuredLogger.error('Failed to send webhook alert', {
        error: error.message,
        webhookUrl: this.alertChannels.webhook,
        alertType: alertData.type,
        correlationId: this.correlationId,
        service: 'CloudApiAlertingService'
      });
    }
  }

  /**
   * Send email alert (placeholder - would integrate with email service)
   * @param {Object} alertData - Alert data
   */
  async sendEmailAlert(alertData) {
    // This is a placeholder for email integration
    // In a real implementation, you would integrate with services like:
    // - SendGrid
    // - AWS SES
    // - Nodemailer with SMTP
    
    structuredLogger.info('Email alert would be sent', {
      alertType: alertData.type,
      severity: alertData.severity,
      message: alertData.message,
      correlationId: this.correlationId,
      service: 'CloudApiAlertingService',
      note: 'Email integration not implemented - placeholder only'
    });
  }

  /**
   * Check if alert type is in cooldown period
   * @param {string} alertKey - Alert key
   * @returns {boolean} True if in cooldown
   */
  isInCooldown(alertKey) {
    const cooldownEnd = this.alertCooldowns.get(alertKey);
    if (!cooldownEnd) {
      return false;
    }
    
    const now = Date.now();
    if (now >= cooldownEnd) {
      this.alertCooldowns.delete(alertKey);
      return false;
    }
    
    return true;
  }

  /**
   * Set cooldown for alert type
   * @param {string} alertKey - Alert key
   * @param {number} cooldownMs - Cooldown duration in milliseconds
   */
  setCooldown(alertKey, cooldownMs = this.defaultCooldownMs) {
    const cooldownEnd = Date.now() + cooldownMs;
    this.alertCooldowns.set(alertKey, cooldownEnd);
  }

  /**
   * Send multiple alerts
   * @param {Array} alerts - Array of alerts
   * @param {string} checkId - Health check ID
   */
  async sendAlerts(alerts, checkId) {
    if (!alerts || alerts.length === 0) {
      return;
    }

    structuredLogger.info('Sending multiple alerts', {
      alertCount: alerts.length,
      checkId,
      correlationId: this.correlationId,
      service: 'CloudApiAlertingService'
    });

    // Send alerts in parallel but with some delay to avoid overwhelming
    for (let i = 0; i < alerts.length; i++) {
      const alert = alerts[i];
      
      // Add small delay between alerts to prevent overwhelming
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      await this.sendAlert(alert, checkId);
    }
  }

  /**
   * Test alert system
   * @param {string} severity - Alert severity ('warning' or 'critical')
   */
  async testAlert(severity = 'warning') {
    const testAlert = {
      type: 'TEST_ALERT',
      severity,
      message: `Test alert - ${severity} level`,
      value: 100,
      threshold: 50,
      timestamp: new Date().toISOString()
    };

    await this.sendAlert(testAlert, 'test-check-' + Date.now());
    
    structuredLogger.info('Test alert sent', {
      severity,
      correlationId: this.correlationId,
      service: 'CloudApiAlertingService'
    });
  }

  /**
   * Update alert channels configuration
   * @param {Object} channels - New channel configuration
   */
  updateChannels(channels) {
    this.alertChannels = {
      ...this.alertChannels,
      ...channels
    };

    structuredLogger.info('Alert channels updated', {
      channels: this.alertChannels,
      correlationId: this.correlationId,
      service: 'CloudApiAlertingService'
    });
  }

  /**
   * Get alert statistics
   * @returns {Object} Alert statistics
   */
  getAlertStats() {
    return {
      service: 'CloudApiAlertingService',
      correlationId: this.correlationId,
      channels: this.alertChannels,
      activeCooldowns: this.alertCooldowns.size,
      cooldownDuration: this.defaultCooldownMs,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Clear all cooldowns
   */
  clearCooldowns() {
    this.alertCooldowns.clear();
    
    structuredLogger.info('Alert cooldowns cleared', {
      correlationId: this.correlationId,
      service: 'CloudApiAlertingService'
    });
  }
}

// Create singleton instance
const cloudApiAlertingService = new CloudApiAlertingService();

export default cloudApiAlertingService;
export { CloudApiAlertingService, cloudApiAlertingService };