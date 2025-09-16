import { structuredLogger, generateCorrelationId } from '../helpers/logger.js';
import metricsCollector from './metricsCollector.js';
import userNotificationService from './userNotificationService.js';

/**
 * Alerting service for Google Calendar integration monitoring
 * Monitors metrics and triggers alerts for high error rates and authentication issues
 */
class AlertingService {
  constructor() {
    this.alertState = {
      // Track alert states to prevent spam
      highErrorRate: { active: false, lastTriggered: null, count: 0 },
      highAuthFailureRate: { active: false, lastTriggered: null, count: 0 },
      highQueueSize: { active: false, lastTriggered: null, count: 0 },
      slowPerformance: { active: false, lastTriggered: null, count: 0 }
    };
    
    this.config = {
      // Alert thresholds
      thresholds: {
        errorRate: 15, // 15% error rate
        authFailureRate: 10, // 10% auth failure rate
        queueSize: 100, // 100 items in queue
        averageResponseTime: 5000, // 5 seconds average response time
        slowOperationCount: 10 // Number of slow operations
      },
      
      // Alert cooldown periods (in milliseconds)
      cooldownPeriods: {
        highErrorRate: 30 * 60 * 1000, // 30 minutes
        highAuthFailureRate: 15 * 60 * 1000, // 15 minutes
        highQueueSize: 10 * 60 * 1000, // 10 minutes
        slowPerformance: 20 * 60 * 1000 // 20 minutes
      },
      
      // Minimum operations before triggering error rate alerts
      minOperationsForErrorRate: 10,
      
      // Maximum alert count before escalation
      maxAlertCount: 5
    };
  }

  /**
   * Check all metrics and trigger alerts if necessary
   * @param {string} correlationId - Correlation ID for tracking
   * @returns {Promise<Object>} Alert check results
   */
  async checkAndTriggerAlerts(correlationId = null) {
    const cId = correlationId || generateCorrelationId();
    
    try {
      structuredLogger.info('Starting alert check', {
        correlationId: cId
      });
      
      const metrics = metricsCollector.getMetricsSummary();
      const alertsTriggered = [];
      
      // Check sync error rate
      const errorRateAlert = await this._checkSyncErrorRate(metrics, cId);
      if (errorRateAlert) alertsTriggered.push(errorRateAlert);
      
      // Check authentication failure rate
      const authFailureAlert = await this._checkAuthFailureRate(metrics, cId);
      if (authFailureAlert) alertsTriggered.push(authFailureAlert);
      
      // Check queue size
      const queueSizeAlert = await this._checkQueueSize(metrics, cId);
      if (queueSizeAlert) alertsTriggered.push(queueSizeAlert);
      
      // Check performance issues
      const performanceAlert = await this._checkPerformance(metrics, cId);
      if (performanceAlert) alertsTriggered.push(performanceAlert);
      
      const result = {
        alertsTriggered: alertsTriggered.length,
        alerts: alertsTriggered,
        metricsSnapshot: {
          errorRate: metrics.syncMetrics.failureRate,
          authFailureRate: metrics.authenticationMetrics.authFailureRate,
          queueSize: metrics.queueMetrics.currentSize,
          averageResponseTime: metrics.responseTimeMetrics.overall.average
        }
      };
      
      if (alertsTriggered.length > 0) {
        structuredLogger.warn('Alerts triggered during monitoring check', {
          correlationId: cId,
          alertCount: alertsTriggered.length,
          alertTypes: alertsTriggered.map(a => a.type)
        });
      } else {
        structuredLogger.debug('No alerts triggered during monitoring check', {
          correlationId: cId
        });
      }
      
      return result;
      
    } catch (error) {
      structuredLogger.error('Error during alert check', {
        correlationId: cId,
        error
      });
      
      return {
        alertsTriggered: 0,
        alerts: [],
        error: error.message
      };
    }
  }

  /**
   * Get current alert status
   * @returns {Object} Current alert states and configuration
   */
  getAlertStatus() {
    return {
      alertState: { ...this.alertState },
      config: { ...this.config },
      lastCheck: new Date()
    };
  }

  /**
   * Reset alert states (useful for testing or after maintenance)
   * @param {string} correlationId - Correlation ID for tracking
   */
  resetAlertStates(correlationId = null) {
    const cId = correlationId || generateCorrelationId();
    
    structuredLogger.info('Resetting alert states', {
      correlationId: cId,
      previousState: { ...this.alertState }
    });
    
    Object.keys(this.alertState).forEach(alertType => {
      this.alertState[alertType] = {
        active: false,
        lastTriggered: null,
        count: 0
      };
    });
  }

  /**
   * Check sync error rate and trigger alert if necessary
   * @private
   * @param {Object} metrics - Current metrics
   * @param {string} correlationId - Correlation ID
   * @returns {Promise<Object|null>} Alert object or null
   */
  async _checkSyncErrorRate(metrics, correlationId) {
    const errorRate = metrics.syncMetrics.failureRate;
    const totalOperations = metrics.syncMetrics.totalOperations;
    
    // Don't trigger error rate alerts if we don't have enough operations
    if (totalOperations < this.config.minOperationsForErrorRate) {
      return null;
    }
    
    if (errorRate > this.config.thresholds.errorRate) {
      const alertType = 'highErrorRate';
      
      if (this._shouldTriggerAlert(alertType)) {
        const alert = {
          type: 'HIGH_ERROR_RATE',
          severity: errorRate > 30 ? 'critical' : 'warning',
          message: `High sync error rate detected: ${errorRate.toFixed(1)}%`,
          details: {
            errorRate,
            threshold: this.config.thresholds.errorRate,
            totalOperations,
            failedOperations: metrics.syncMetrics.failedOperations,
            errorDistribution: metrics.errorDistribution
          },
          timestamp: new Date(),
          correlationId
        };
        
        this._updateAlertState(alertType);
        await this._sendAlert(alert, correlationId);
        
        return alert;
      }
    } else {
      // Clear alert if error rate is back to normal
      this._clearAlert('highErrorRate');
    }
    
    return null;
  }

  /**
   * Check authentication failure rate and trigger alert if necessary
   * @private
   * @param {Object} metrics - Current metrics
   * @param {string} correlationId - Correlation ID
   * @returns {Promise<Object|null>} Alert object or null
   */
  async _checkAuthFailureRate(metrics, correlationId) {
    const authFailureRate = metrics.authenticationMetrics.authFailureRate;
    const totalOperations = metrics.syncMetrics.totalOperations;
    
    if (totalOperations < this.config.minOperationsForErrorRate) {
      return null;
    }
    
    if (authFailureRate > this.config.thresholds.authFailureRate) {
      const alertType = 'highAuthFailureRate';
      
      if (this._shouldTriggerAlert(alertType)) {
        const alert = {
          type: 'HIGH_AUTH_FAILURE_RATE',
          severity: authFailureRate > 20 ? 'critical' : 'warning',
          message: `High authentication failure rate detected: ${authFailureRate.toFixed(1)}%`,
          details: {
            authFailureRate,
            threshold: this.config.thresholds.authFailureRate,
            tokenRefreshFailures: metrics.authenticationMetrics.tokenRefreshFailures,
            reconnectionRequired: metrics.authenticationMetrics.reconnectionRequired,
            lastAuthFailure: metrics.authenticationMetrics.lastAuthFailure
          },
          timestamp: new Date(),
          correlationId
        };
        
        this._updateAlertState(alertType);
        await this._sendAlert(alert, correlationId);
        
        return alert;
      }
    } else {
      this._clearAlert('highAuthFailureRate');
    }
    
    return null;
  }

  /**
   * Check queue size and trigger alert if necessary
   * @private
   * @param {Object} metrics - Current metrics
   * @param {string} correlationId - Correlation ID
   * @returns {Promise<Object|null>} Alert object or null
   */
  async _checkQueueSize(metrics, correlationId) {
    const queueSize = metrics.queueMetrics.currentSize;
    
    if (queueSize > this.config.thresholds.queueSize) {
      const alertType = 'highQueueSize';
      
      if (this._shouldTriggerAlert(alertType)) {
        const alert = {
          type: 'HIGH_QUEUE_SIZE',
          severity: queueSize > 200 ? 'critical' : 'warning',
          message: `High retry queue size detected: ${queueSize} items`,
          details: {
            queueSize,
            threshold: this.config.thresholds.queueSize,
            maxSize: metrics.queueMetrics.maxSize,
            lastUpdated: metrics.queueMetrics.lastUpdated
          },
          timestamp: new Date(),
          correlationId
        };
        
        this._updateAlertState(alertType);
        await this._sendAlert(alert, correlationId);
        
        return alert;
      }
    } else {
      this._clearAlert('highQueueSize');
    }
    
    return null;
  }

  /**
   * Check performance issues and trigger alert if necessary
   * @private
   * @param {Object} metrics - Current metrics
   * @param {string} correlationId - Correlation ID
   * @returns {Promise<Object|null>} Alert object or null
   */
  async _checkPerformance(metrics, correlationId) {
    const averageResponseTime = metrics.responseTimeMetrics.overall.average;
    const slowestOperation = metrics.responseTimeMetrics.overall.slowest;
    
    if (averageResponseTime > this.config.thresholds.averageResponseTime) {
      const alertType = 'slowPerformance';
      
      if (this._shouldTriggerAlert(alertType)) {
        const alert = {
          type: 'SLOW_PERFORMANCE',
          severity: averageResponseTime > 10000 ? 'critical' : 'warning',
          message: `Slow API performance detected: ${averageResponseTime}ms average response time`,
          details: {
            averageResponseTime,
            threshold: this.config.thresholds.averageResponseTime,
            slowestOperation,
            responseTimeBreakdown: {
              createEvent: metrics.responseTimeMetrics.createEvent,
              updateEvent: metrics.responseTimeMetrics.updateEvent,
              searchEvent: metrics.responseTimeMetrics.searchEvent,
              tokenRefresh: metrics.responseTimeMetrics.tokenRefresh
            }
          },
          timestamp: new Date(),
          correlationId
        };
        
        this._updateAlertState(alertType);
        await this._sendAlert(alert, correlationId);
        
        return alert;
      }
    } else {
      this._clearAlert('slowPerformance');
    }
    
    return null;
  }

  /**
   * Check if an alert should be triggered based on cooldown and state
   * @private
   * @param {string} alertType - Type of alert
   * @returns {boolean} True if alert should be triggered
   */
  _shouldTriggerAlert(alertType) {
    const alertState = this.alertState[alertType];
    const cooldownPeriod = this.config.cooldownPeriods[alertType];
    const now = Date.now();
    
    // If alert is not active, trigger it
    if (!alertState.active) {
      return true;
    }
    
    // If cooldown period has passed, trigger it again
    if (alertState.lastTriggered && (now - alertState.lastTriggered.getTime()) > cooldownPeriod) {
      return true;
    }
    
    // Don't trigger if we've exceeded max alert count
    if (alertState.count >= this.config.maxAlertCount) {
      return false;
    }
    
    return false;
  }

  /**
   * Update alert state after triggering
   * @private
   * @param {string} alertType - Type of alert
   */
  _updateAlertState(alertType) {
    this.alertState[alertType].active = true;
    this.alertState[alertType].lastTriggered = new Date();
    this.alertState[alertType].count++;
  }

  /**
   * Clear alert state when condition is resolved
   * @private
   * @param {string} alertType - Type of alert
   */
  _clearAlert(alertType) {
    if (this.alertState[alertType].active) {
      structuredLogger.info('Alert condition resolved', {
        alertType,
        previousCount: this.alertState[alertType].count
      });
      
      this.alertState[alertType].active = false;
      this.alertState[alertType].count = 0;
    }
  }

  /**
   * Send alert through appropriate channels
   * @private
   * @param {Object} alert - Alert object
   * @param {string} correlationId - Correlation ID
   */
  async _sendAlert(alert, correlationId) {
    try {
      // Log the alert
      structuredLogger.warn('Alert triggered', {
        correlationId,
        alertType: alert.type,
        severity: alert.severity,
        message: alert.message,
        details: alert.details,
        alertCount: this.alertState[alert.type.toLowerCase().replace(/_/g, '')]?.count || 1
      });
      
      // In a production environment, you might want to:
      // 1. Send email notifications to administrators
      // 2. Send Slack/Teams notifications
      // 3. Create tickets in monitoring systems
      // 4. Send SMS for critical alerts
      // 5. Integrate with PagerDuty or similar services
      
      // For now, we'll just use structured logging
      // Future enhancement: Add notification channels based on severity
      
    } catch (error) {
      structuredLogger.error('Error sending alert', {
        correlationId,
        alertType: alert.type,
        error
      });
    }
  }
}

// Create singleton instance
const alertingService = new AlertingService();

export default alertingService;