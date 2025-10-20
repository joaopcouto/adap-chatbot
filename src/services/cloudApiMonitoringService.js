import { structuredLogger, generateCorrelationId } from '../helpers/logger.js';
import { cloudApiMetricsCollector } from './cloudApiMetricsCollector.js';
import { cloudApiAlertingService } from './cloudApiAlertingService.js';

/**
 * Cloud API Monitoring Service
 * Provides monitoring dashboards, health checks, and alerting for Cloud API operations
 */
class CloudApiMonitoringService {
  constructor() {
    this.correlationId = generateCorrelationId();
    this.alertThresholds = {
      errorRate: {
        warning: 5, // 5%
        critical: 10 // 10%
      },
      responseTime: {
        warning: 3000, // 3 seconds
        critical: 5000 // 5 seconds
      },
      rateLimitHits: {
        warning: 5, // 5 hits per hour
        critical: 10 // 10 hits per hour
      },
      messageFailureRate: {
        warning: 2, // 2%
        critical: 5 // 5%
      }
    };

    this.alertHistory = [];
    this.maxAlertHistory = 100;
    this.lastHealthCheck = null;
    this.healthCheckInterval = 60000; // 1 minute

    // Start periodic health checks
    this.startHealthChecks();

    structuredLogger.info('Cloud API Monitoring Service initialized', {
      correlationId: this.correlationId,
      alertThresholds: this.alertThresholds,
      healthCheckInterval: this.healthCheckInterval,
      service: 'CloudApiMonitoringService'
    });
  }

  /**
   * Start periodic health checks
   */
  startHealthChecks() {
    setInterval(() => {
      this.performHealthCheck();
    }, this.healthCheckInterval);

    // Perform initial health check
    setTimeout(() => {
      this.performHealthCheck();
    }, 5000); // Wait 5 seconds after startup
  }

  /**
   * Perform comprehensive health check
   * @returns {Object} Health check results
   */
  async performHealthCheck() {
    const checkId = generateCorrelationId();
    const startTime = Date.now();

    try {
      structuredLogger.info('Starting Cloud API health check', {
        checkId,
        correlationId: this.correlationId,
        service: 'CloudApiMonitoringService'
      });

      const metrics = cloudApiMetricsCollector.getMetricsSummary();
      const healthStatus = cloudApiMetricsCollector.getHealthStatus();
      
      const healthCheck = {
        id: checkId,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
        overall: {
          status: healthStatus.healthy ? 'healthy' : 'unhealthy',
          healthy: healthStatus.healthy
        },
        metrics: {
          requests: {
            total: metrics.requests.total,
            successRate: metrics.requests.successRate,
            errorRate: metrics.requests.errorRate,
            requestsPerMinute: metrics.requests.requestsPerMinute
          },
          performance: {
            averageResponseTime: metrics.performance.averageDuration,
            p95ResponseTime: metrics.performance.p95Duration,
            minResponseTime: metrics.performance.minDuration,
            maxResponseTime: metrics.performance.maxDuration
          },
          errors: {
            total: metrics.errors.total,
            rateLimits: metrics.errors.rateLimits,
            authFailures: metrics.errors.authFailures,
            networkErrors: metrics.errors.networkErrors
          },
          messages: {
            sent: metrics.messages.sent,
            delivered: metrics.messages.delivered,
            failed: metrics.messages.failed,
            deliveryRate: metrics.messages.deliveryRate
          },
          rateLimiting: {
            hits: metrics.rateLimiting.hits,
            averageWaitTime: metrics.rateLimiting.averageWaitTime
          }
        },
        alerts: this.checkAlertConditions(metrics)
      };

      this.lastHealthCheck = healthCheck;

      // Process any alerts
      if (healthCheck.alerts.length > 0) {
        this.processAlerts(healthCheck.alerts, checkId);
        
        // Send alerts through alerting service
        await cloudApiAlertingService.sendAlerts(healthCheck.alerts, checkId);
      }

      structuredLogger.info('Cloud API health check completed', {
        checkId,
        correlationId: this.correlationId,
        status: healthCheck.overall.status,
        alertCount: healthCheck.alerts.length,
        duration: healthCheck.duration,
        service: 'CloudApiMonitoringService'
      });

      return healthCheck;

    } catch (error) {
      const duration = Date.now() - startTime;
      
      structuredLogger.error('Cloud API health check failed', {
        checkId,
        correlationId: this.correlationId,
        error: error.message,
        duration,
        service: 'CloudApiMonitoringService'
      });

      const failedHealthCheck = {
        id: checkId,
        timestamp: new Date().toISOString(),
        duration,
        overall: {
          status: 'unhealthy',
          healthy: false
        },
        error: error.message,
        alerts: [{
          type: 'HEALTH_CHECK_FAILURE',
          severity: 'critical',
          message: `Health check failed: ${error.message}`,
          timestamp: new Date().toISOString()
        }]
      };

      this.lastHealthCheck = failedHealthCheck;
      this.processAlerts(failedHealthCheck.alerts, checkId);
      
      // Send critical alert for health check failure
      await cloudApiAlertingService.sendAlerts(failedHealthCheck.alerts, checkId);

      return failedHealthCheck;
    }
  }

  /**
   * Check for alert conditions based on metrics
   * @param {Object} metrics - Current metrics
   * @returns {Array} Array of alerts
   */
  checkAlertConditions(metrics) {
    const alerts = [];
    const timestamp = new Date().toISOString();

    // Check error rate
    if (metrics.requests.errorRate >= this.alertThresholds.errorRate.critical) {
      alerts.push({
        type: 'HIGH_ERROR_RATE',
        severity: 'critical',
        message: `Critical error rate: ${metrics.requests.errorRate.toFixed(2)}% (threshold: ${this.alertThresholds.errorRate.critical}%)`,
        value: metrics.requests.errorRate,
        threshold: this.alertThresholds.errorRate.critical,
        timestamp
      });
    } else if (metrics.requests.errorRate >= this.alertThresholds.errorRate.warning) {
      alerts.push({
        type: 'HIGH_ERROR_RATE',
        severity: 'warning',
        message: `Warning error rate: ${metrics.requests.errorRate.toFixed(2)}% (threshold: ${this.alertThresholds.errorRate.warning}%)`,
        value: metrics.requests.errorRate,
        threshold: this.alertThresholds.errorRate.warning,
        timestamp
      });
    }

    // Check response time
    if (metrics.performance.averageDuration >= this.alertThresholds.responseTime.critical) {
      alerts.push({
        type: 'HIGH_RESPONSE_TIME',
        severity: 'critical',
        message: `Critical response time: ${metrics.performance.averageDuration.toFixed(0)}ms (threshold: ${this.alertThresholds.responseTime.critical}ms)`,
        value: metrics.performance.averageDuration,
        threshold: this.alertThresholds.responseTime.critical,
        timestamp
      });
    } else if (metrics.performance.averageDuration >= this.alertThresholds.responseTime.warning) {
      alerts.push({
        type: 'HIGH_RESPONSE_TIME',
        severity: 'warning',
        message: `Warning response time: ${metrics.performance.averageDuration.toFixed(0)}ms (threshold: ${this.alertThresholds.responseTime.warning}ms)`,
        value: metrics.performance.averageDuration,
        threshold: this.alertThresholds.responseTime.warning,
        timestamp
      });
    }

    // Check rate limit hits
    if (metrics.rateLimiting.hits >= this.alertThresholds.rateLimitHits.critical) {
      alerts.push({
        type: 'RATE_LIMIT_HITS',
        severity: 'critical',
        message: `Critical rate limit hits: ${metrics.rateLimiting.hits} (threshold: ${this.alertThresholds.rateLimitHits.critical})`,
        value: metrics.rateLimiting.hits,
        threshold: this.alertThresholds.rateLimitHits.critical,
        timestamp
      });
    } else if (metrics.rateLimiting.hits >= this.alertThresholds.rateLimitHits.warning) {
      alerts.push({
        type: 'RATE_LIMIT_HITS',
        severity: 'warning',
        message: `Warning rate limit hits: ${metrics.rateLimiting.hits} (threshold: ${this.alertThresholds.rateLimitHits.warning})`,
        value: metrics.rateLimiting.hits,
        threshold: this.alertThresholds.rateLimitHits.warning,
        timestamp
      });
    }

    // Check message failure rate
    const messageFailureRate = metrics.messages.sent > 0 ? 
      (metrics.messages.failed / metrics.messages.sent) * 100 : 0;

    if (messageFailureRate >= this.alertThresholds.messageFailureRate.critical) {
      alerts.push({
        type: 'HIGH_MESSAGE_FAILURE_RATE',
        severity: 'critical',
        message: `Critical message failure rate: ${messageFailureRate.toFixed(2)}% (threshold: ${this.alertThresholds.messageFailureRate.critical}%)`,
        value: messageFailureRate,
        threshold: this.alertThresholds.messageFailureRate.critical,
        timestamp
      });
    } else if (messageFailureRate >= this.alertThresholds.messageFailureRate.warning) {
      alerts.push({
        type: 'HIGH_MESSAGE_FAILURE_RATE',
        severity: 'warning',
        message: `Warning message failure rate: ${messageFailureRate.toFixed(2)}% (threshold: ${this.alertThresholds.messageFailureRate.warning}%)`,
        value: messageFailureRate,
        threshold: this.alertThresholds.messageFailureRate.warning,
        timestamp
      });
    }

    // Check for authentication failures
    if (metrics.errors.authFailures > 0) {
      alerts.push({
        type: 'AUTH_FAILURES',
        severity: 'critical',
        message: `Authentication failures detected: ${metrics.errors.authFailures}`,
        value: metrics.errors.authFailures,
        timestamp
      });
    }

    // Check for network errors
    if (metrics.errors.networkErrors > 5) {
      alerts.push({
        type: 'NETWORK_ERRORS',
        severity: 'warning',
        message: `High number of network errors: ${metrics.errors.networkErrors}`,
        value: metrics.errors.networkErrors,
        timestamp
      });
    }

    return alerts;
  }

  /**
   * Process and log alerts
   * @param {Array} alerts - Array of alerts to process
   * @param {string} checkId - Health check ID
   */
  processAlerts(alerts, checkId) {
    alerts.forEach(alert => {
      // Add to alert history
      this.alertHistory.unshift({
        ...alert,
        checkId,
        correlationId: this.correlationId
      });

      // Keep only recent alerts
      if (this.alertHistory.length > this.maxAlertHistory) {
        this.alertHistory = this.alertHistory.slice(0, this.maxAlertHistory);
      }

      // Log alert based on severity
      if (alert.severity === 'critical') {
        structuredLogger.error(`Cloud API Alert: ${alert.message}`, {
          alertType: alert.type,
          severity: alert.severity,
          value: alert.value,
          threshold: alert.threshold,
          checkId,
          correlationId: this.correlationId,
          service: 'CloudApiMonitoringService'
        });
      } else {
        structuredLogger.warn(`Cloud API Alert: ${alert.message}`, {
          alertType: alert.type,
          severity: alert.severity,
          value: alert.value,
          threshold: alert.threshold,
          checkId,
          correlationId: this.correlationId,
          service: 'CloudApiMonitoringService'
        });
      }
    });
  }

  /**
   * Get monitoring dashboard data
   * @returns {Object} Dashboard data
   */
  getDashboardData() {
    const metrics = cloudApiMetricsCollector.getMetricsSummary();
    const healthStatus = cloudApiMetricsCollector.getHealthStatus();

    return {
      timestamp: new Date().toISOString(),
      correlationId: this.correlationId,
      overview: {
        status: healthStatus.healthy ? 'healthy' : 'unhealthy',
        uptime: metrics.summary.uptime,
        lastHealthCheck: this.lastHealthCheck?.timestamp,
        totalRequests: metrics.requests.total,
        successRate: metrics.requests.successRate,
        errorRate: metrics.requests.errorRate
      },
      performance: {
        averageResponseTime: metrics.performance.averageDuration,
        p95ResponseTime: metrics.performance.p95Duration,
        minResponseTime: metrics.performance.minDuration === Infinity ? 0 : metrics.performance.minDuration,
        maxResponseTime: metrics.performance.maxDuration,
        requestsPerMinute: metrics.requests.requestsPerMinute
      },
      requests: {
        total: metrics.requests.total,
        successful: metrics.requests.successful,
        failed: metrics.requests.failed,
        byEndpoint: metrics.requests.byEndpoint,
        byStatus: metrics.requests.byStatus,
        byOperation: metrics.requests.byOperation
      },
      errors: {
        total: metrics.errors.total,
        byType: metrics.errors.byType,
        byCode: metrics.errors.byCode,
        rateLimits: metrics.errors.rateLimits,
        authFailures: metrics.errors.authFailures,
        networkErrors: metrics.errors.networkErrors
      },
      messages: {
        sent: metrics.messages.sent,
        delivered: metrics.messages.delivered,
        failed: metrics.messages.failed,
        deliveryRate: metrics.messages.deliveryRate,
        byType: metrics.messages.byType
      },
      webhooks: {
        received: metrics.webhooks.received,
        processed: metrics.webhooks.processed,
        failed: metrics.webhooks.failed,
        processingRate: metrics.webhooks.processingRate,
        byType: metrics.webhooks.byType
      },
      rateLimiting: {
        hits: metrics.rateLimiting.hits,
        totalWaitTime: metrics.rateLimiting.totalWaitTime,
        averageWaitTime: metrics.rateLimiting.averageWaitTime,
        byEndpoint: metrics.rateLimiting.byEndpoint
      },
      alerts: {
        active: this.getActiveAlerts(),
        recent: this.getRecentAlerts(10),
        thresholds: this.alertThresholds
      }
    };
  }

  /**
   * Get active alerts (alerts from the last health check)
   * @returns {Array} Active alerts
   */
  getActiveAlerts() {
    if (!this.lastHealthCheck || !this.lastHealthCheck.alerts) {
      return [];
    }
    return this.lastHealthCheck.alerts;
  }

  /**
   * Get recent alerts
   * @param {number} limit - Number of recent alerts to return
   * @returns {Array} Recent alerts
   */
  getRecentAlerts(limit = 10) {
    return this.alertHistory.slice(0, limit);
  }

  /**
   * Update alert thresholds
   * @param {Object} newThresholds - New threshold values
   */
  updateAlertThresholds(newThresholds) {
    this.alertThresholds = {
      ...this.alertThresholds,
      ...newThresholds
    };

    structuredLogger.info('Alert thresholds updated', {
      correlationId: this.correlationId,
      newThresholds: this.alertThresholds,
      service: 'CloudApiMonitoringService'
    });
  }

  /**
   * Get service health status
   * @returns {Object} Service health status
   */
  getServiceHealth() {
    const metrics = cloudApiMetricsCollector.getMetricsSummary();
    const healthStatus = cloudApiMetricsCollector.getHealthStatus();
    const activeAlerts = this.getActiveAlerts();

    return {
      service: 'CloudApiMonitoringService',
      status: healthStatus.healthy && activeAlerts.length === 0 ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      correlationId: this.correlationId,
      uptime: metrics.summary.uptime,
      lastHealthCheck: this.lastHealthCheck?.timestamp,
      activeAlerts: activeAlerts.length,
      criticalAlerts: activeAlerts.filter(alert => alert.severity === 'critical').length,
      warningAlerts: activeAlerts.filter(alert => alert.severity === 'warning').length,
      metrics: {
        requests: {
          total: metrics.requests.total,
          successRate: metrics.requests.successRate,
          errorRate: metrics.requests.errorRate
        },
        performance: {
          averageResponseTime: metrics.performance.averageDuration,
          p95ResponseTime: metrics.performance.p95Duration
        },
        messages: {
          sent: metrics.messages.sent,
          deliveryRate: metrics.messages.deliveryRate
        }
      }
    };
  }

  /**
   * Generate monitoring report
   * @param {string} period - Report period ('hour', 'day', 'week')
   * @returns {Object} Monitoring report
   */
  generateReport(period = 'day') {
    const metrics = cloudApiMetricsCollector.getMetricsSummary();
    const dashboardData = this.getDashboardData();

    return {
      reportId: generateCorrelationId(),
      period,
      generatedAt: new Date().toISOString(),
      correlationId: this.correlationId,
      summary: {
        totalRequests: metrics.requests.total,
        successRate: metrics.requests.successRate,
        errorRate: metrics.requests.errorRate,
        averageResponseTime: metrics.performance.averageDuration,
        messagesSent: metrics.messages.sent,
        deliveryRate: metrics.messages.deliveryRate,
        rateLimitHits: metrics.rateLimiting.hits,
        alertsTriggered: this.alertHistory.length
      },
      performance: dashboardData.performance,
      errors: dashboardData.errors,
      messages: dashboardData.messages,
      alerts: {
        total: this.alertHistory.length,
        critical: this.alertHistory.filter(alert => alert.severity === 'critical').length,
        warning: this.alertHistory.filter(alert => alert.severity === 'warning').length,
        recent: this.getRecentAlerts(20)
      },
      recommendations: this.generateRecommendations(metrics)
    };
  }

  /**
   * Generate recommendations based on metrics
   * @param {Object} metrics - Current metrics
   * @returns {Array} Array of recommendations
   */
  generateRecommendations(metrics) {
    const recommendations = [];

    if (metrics.requests.errorRate > 5) {
      recommendations.push({
        type: 'ERROR_RATE',
        priority: 'high',
        message: 'High error rate detected. Review error logs and consider implementing additional retry logic.',
        action: 'Review error patterns and implement fixes'
      });
    }

    if (metrics.performance.averageDuration > 3000) {
      recommendations.push({
        type: 'PERFORMANCE',
        priority: 'medium',
        message: 'Average response time is high. Consider optimizing API calls or implementing caching.',
        action: 'Optimize API performance'
      });
    }

    if (metrics.rateLimiting.hits > 0) {
      recommendations.push({
        type: 'RATE_LIMITING',
        priority: 'medium',
        message: 'Rate limiting detected. Consider implementing request queuing or reducing request frequency.',
        action: 'Implement rate limiting mitigation'
      });
    }

    if (metrics.messages.deliveryRate < 95) {
      recommendations.push({
        type: 'MESSAGE_DELIVERY',
        priority: 'high',
        message: 'Message delivery rate is below optimal. Review message formats and recipient validation.',
        action: 'Improve message delivery reliability'
      });
    }

    return recommendations;
  }

  /**
   * Reset monitoring data
   */
  resetMonitoringData() {
    this.alertHistory = [];
    this.lastHealthCheck = null;
    cloudApiMetricsCollector.resetMetrics();

    structuredLogger.info('Monitoring data reset', {
      correlationId: this.correlationId,
      resetTime: new Date().toISOString(),
      service: 'CloudApiMonitoringService'
    });
  }
}

// Create singleton instance
const cloudApiMonitoringService = new CloudApiMonitoringService();

export default cloudApiMonitoringService;
export { CloudApiMonitoringService, cloudApiMonitoringService };