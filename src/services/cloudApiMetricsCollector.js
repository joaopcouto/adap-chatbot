import { structuredLogger, generateCorrelationId } from '../helpers/logger.js';

/**
 * Cloud API Metrics Collector
 * Collects and tracks performance metrics, error rates, and operational data for Cloud API operations
 */
class CloudApiMetricsCollector {
  constructor() {
    this.metrics = {
      requests: {
        total: 0,
        successful: 0,
        failed: 0,
        byEndpoint: {},
        byStatus: {},
        byOperation: {}
      },
      performance: {
        totalDuration: 0,
        averageDuration: 0,
        minDuration: Infinity,
        maxDuration: 0,
        p95Duration: 0,
        durations: []
      },
      errors: {
        total: 0,
        byType: {},
        byCode: {},
        rateLimits: 0,
        authFailures: 0,
        networkErrors: 0
      },
      messages: {
        sent: 0,
        delivered: 0,
        failed: 0,
        byType: {
          text: 0,
          template: 0,
          media: 0
        }
      },
      webhooks: {
        received: 0,
        processed: 0,
        failed: 0,
        byType: {}
      },
      rateLimiting: {
        hits: 0,
        totalWaitTime: 0,
        averageWaitTime: 0,
        byEndpoint: {}
      }
    };

    this.startTime = Date.now();
    this.lastReset = new Date().toISOString();
    this.correlationId = generateCorrelationId();

    // Keep track of recent durations for percentile calculations
    this.maxDurationsToKeep = 1000;

    structuredLogger.info('Cloud API Metrics Collector initialized', {
      correlationId: this.correlationId,
      startTime: this.startTime,
      service: 'CloudApiMetricsCollector'
    });
  }

  /**
   * Record API request metrics
   * @param {Object} requestData - Request data
   */
  recordRequest(requestData) {
    const {
      endpoint,
      method,
      status,
      duration,
      operation,
      success = status < 400,
      requestId,
      correlationId
    } = requestData;

    // Update request counters
    this.metrics.requests.total++;
    if (success) {
      this.metrics.requests.successful++;
    } else {
      this.metrics.requests.failed++;
    }

    // Track by endpoint
    const endpointKey = `${method} ${endpoint}`;
    if (!this.metrics.requests.byEndpoint[endpointKey]) {
      this.metrics.requests.byEndpoint[endpointKey] = { total: 0, successful: 0, failed: 0 };
    }
    this.metrics.requests.byEndpoint[endpointKey].total++;
    if (success) {
      this.metrics.requests.byEndpoint[endpointKey].successful++;
    } else {
      this.metrics.requests.byEndpoint[endpointKey].failed++;
    }

    // Track by status code
    if (!this.metrics.requests.byStatus[status]) {
      this.metrics.requests.byStatus[status] = 0;
    }
    this.metrics.requests.byStatus[status]++;

    // Track by operation
    if (operation) {
      if (!this.metrics.requests.byOperation[operation]) {
        this.metrics.requests.byOperation[operation] = { total: 0, successful: 0, failed: 0 };
      }
      this.metrics.requests.byOperation[operation].total++;
      if (success) {
        this.metrics.requests.byOperation[operation].successful++;
      } else {
        this.metrics.requests.byOperation[operation].failed++;
      }
    }

    // Record performance metrics
    if (duration !== undefined) {
      this.recordPerformanceMetrics(duration);
    }

    structuredLogger.cloudApiRequestMetrics(endpoint, method, duration, status, {
      requestId,
      correlationId: correlationId || this.correlationId,
      operation,
      success,
      totalRequests: this.metrics.requests.total,
      successRate: this.getSuccessRate()
    });
  }

  /**
   * Record performance metrics
   * @param {number} duration - Request duration in milliseconds
   */
  recordPerformanceMetrics(duration) {
    this.metrics.performance.totalDuration += duration;
    this.metrics.performance.minDuration = Math.min(this.metrics.performance.minDuration, duration);
    this.metrics.performance.maxDuration = Math.max(this.metrics.performance.maxDuration, duration);

    // Add to durations array for percentile calculation
    this.metrics.performance.durations.push(duration);

    // Keep only recent durations to prevent memory issues
    if (this.metrics.performance.durations.length > this.maxDurationsToKeep) {
      this.metrics.performance.durations = this.metrics.performance.durations.slice(-this.maxDurationsToKeep);
    }

    // Calculate average
    this.metrics.performance.averageDuration = this.metrics.performance.totalDuration / this.metrics.requests.total;

    // Calculate 95th percentile
    this.metrics.performance.p95Duration = this.calculatePercentile(this.metrics.performance.durations, 95);
  }

  /**
   * Record error metrics
   * @param {Object} errorData - Error data
   */
  recordError(errorData) {
    const {
      errorType,
      errorCode,
      status,
      operation,
      endpoint,
      requestId,
      correlationId,
      isRateLimit = false,
      isAuthFailure = false,
      isNetworkError = false
    } = errorData;

    this.metrics.errors.total++;

    // Track by error type
    if (errorType) {
      if (!this.metrics.errors.byType[errorType]) {
        this.metrics.errors.byType[errorType] = 0;
      }
      this.metrics.errors.byType[errorType]++;
    }

    // Track by error code
    if (errorCode) {
      if (!this.metrics.errors.byCode[errorCode]) {
        this.metrics.errors.byCode[errorCode] = 0;
      }
      this.metrics.errors.byCode[errorCode]++;
    }

    // Track specific error types
    if (isRateLimit) {
      this.metrics.errors.rateLimits++;
    }
    if (isAuthFailure) {
      this.metrics.errors.authFailures++;
    }
    if (isNetworkError) {
      this.metrics.errors.networkErrors++;
    }

    structuredLogger.cloudApiOperationFailure(operation || 'unknown', errorData, {
      requestId,
      correlationId: correlationId || this.correlationId,
      endpoint,
      errorType,
      errorCode,
      status,
      totalErrors: this.metrics.errors.total,
      errorRate: this.getErrorRate()
    });
  }

  /**
   * Record message metrics
   * @param {Object} messageData - Message data
   */
  recordMessage(messageData) {
    const {
      type,
      status,
      messageId,
      operation,
      requestId,
      correlationId
    } = messageData;

    // Track message counts
    if (operation === 'send' || status === 'sent') {
      this.metrics.messages.sent++;
    }
    if (status === 'delivered') {
      this.metrics.messages.delivered++;
    }
    if (status === 'failed' || status === 'undelivered') {
      this.metrics.messages.failed++;
    }

    // Track by message type
    if (type && this.metrics.messages.byType[type] !== undefined) {
      this.metrics.messages.byType[type]++;
    }

    structuredLogger.cloudApiMessageStatus(messageId, status, {
      requestId,
      correlationId: correlationId || this.correlationId,
      type,
      operation,
      totalSent: this.metrics.messages.sent,
      deliveryRate: this.getDeliveryRate()
    });
  }

  /**
   * Record webhook metrics
   * @param {Object} webhookData - Webhook data
   */
  recordWebhook(webhookData) {
    const {
      type,
      processed = true,
      failed = false,
      correlationId
    } = webhookData;

    this.metrics.webhooks.received++;

    if (processed) {
      this.metrics.webhooks.processed++;
    }
    if (failed) {
      this.metrics.webhooks.failed++;
    }

    // Track by webhook type
    if (type) {
      if (!this.metrics.webhooks.byType[type]) {
        this.metrics.webhooks.byType[type] = 0;
      }
      this.metrics.webhooks.byType[type]++;
    }

    structuredLogger.cloudApiWebhook(type, {
      correlationId: correlationId || this.correlationId,
      processed,
      failed,
      totalReceived: this.metrics.webhooks.received,
      processingRate: this.getWebhookProcessingRate()
    });
  }

  /**
   * Record rate limiting metrics
   * @param {Object} rateLimitData - Rate limit data
   */
  recordRateLimit(rateLimitData) {
    const {
      endpoint,
      retryAfter,
      correlationId
    } = rateLimitData;

    this.metrics.rateLimiting.hits++;
    this.metrics.rateLimiting.totalWaitTime += retryAfter;
    this.metrics.rateLimiting.averageWaitTime = this.metrics.rateLimiting.totalWaitTime / this.metrics.rateLimiting.hits;

    // Track by endpoint
    if (!this.metrics.rateLimiting.byEndpoint[endpoint]) {
      this.metrics.rateLimiting.byEndpoint[endpoint] = { hits: 0, totalWaitTime: 0 };
    }
    this.metrics.rateLimiting.byEndpoint[endpoint].hits++;
    this.metrics.rateLimiting.byEndpoint[endpoint].totalWaitTime += retryAfter;

    structuredLogger.cloudApiRateLimit(endpoint, retryAfter, {
      correlationId: correlationId || this.correlationId,
      totalHits: this.metrics.rateLimiting.hits,
      averageWaitTime: this.metrics.rateLimiting.averageWaitTime
    });
  }

  /**
   * Calculate percentile from array of values
   * @param {Array<number>} values - Array of values
   * @param {number} percentile - Percentile to calculate (0-100)
   * @returns {number} Percentile value
   */
  calculatePercentile(values, percentile) {
    if (values.length === 0) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Get success rate percentage
   * @returns {number} Success rate (0-100)
   */
  getSuccessRate() {
    if (this.metrics.requests.total === 0) return 0;
    return (this.metrics.requests.successful / this.metrics.requests.total) * 100;
  }

  /**
   * Get error rate percentage
   * @returns {number} Error rate (0-100)
   */
  getErrorRate() {
    if (this.metrics.requests.total === 0) return 0;
    return (this.metrics.requests.failed / this.metrics.requests.total) * 100;
  }

  /**
   * Get message delivery rate percentage
   * @returns {number} Delivery rate (0-100)
   */
  getDeliveryRate() {
    if (this.metrics.messages.sent === 0) return 0;
    return (this.metrics.messages.delivered / this.metrics.messages.sent) * 100;
  }

  /**
   * Get webhook processing rate percentage
   * @returns {number} Processing rate (0-100)
   */
  getWebhookProcessingRate() {
    if (this.metrics.webhooks.received === 0) return 0;
    return (this.metrics.webhooks.processed / this.metrics.webhooks.received) * 100;
  }

  /**
   * Get comprehensive metrics summary
   * @returns {Object} Metrics summary
   */
  getMetricsSummary() {
    const uptime = Date.now() - this.startTime;
    
    return {
      summary: {
        uptime,
        lastReset: this.lastReset,
        correlationId: this.correlationId,
        timestamp: new Date().toISOString()
      },
      requests: {
        ...this.metrics.requests,
        successRate: this.getSuccessRate(),
        errorRate: this.getErrorRate(),
        requestsPerMinute: this.metrics.requests.total / (uptime / 60000)
      },
      performance: {
        ...this.metrics.performance,
        p95Duration: this.metrics.performance.p95Duration
      },
      errors: {
        ...this.metrics.errors,
        errorRate: this.getErrorRate()
      },
      messages: {
        ...this.metrics.messages,
        deliveryRate: this.getDeliveryRate()
      },
      webhooks: {
        ...this.metrics.webhooks,
        processingRate: this.getWebhookProcessingRate()
      },
      rateLimiting: this.metrics.rateLimiting
    };
  }

  /**
   * Get health status based on metrics
   * @returns {Object} Health status
   */
  getHealthStatus() {
    const summary = this.getMetricsSummary();
    const isHealthy = summary.requests.errorRate < 10 && summary.performance.averageDuration < 5000;

    return {
      healthy: isHealthy,
      status: isHealthy ? 'healthy' : 'degraded',
      checks: {
        errorRate: {
          value: summary.requests.errorRate,
          threshold: 10,
          healthy: summary.requests.errorRate < 10
        },
        averageResponseTime: {
          value: summary.performance.averageDuration,
          threshold: 5000,
          healthy: summary.performance.averageDuration < 5000
        },
        rateLimitHits: {
          value: summary.rateLimiting.hits,
          healthy: summary.rateLimiting.hits === 0
        }
      },
      lastCheck: new Date().toISOString()
    };
  }

  /**
   * Reset all metrics
   */
  resetMetrics() {
    const oldCorrelationId = this.correlationId;
    
    this.metrics = {
      requests: {
        total: 0,
        successful: 0,
        failed: 0,
        byEndpoint: {},
        byStatus: {},
        byOperation: {}
      },
      performance: {
        totalDuration: 0,
        averageDuration: 0,
        minDuration: Infinity,
        maxDuration: 0,
        p95Duration: 0,
        durations: []
      },
      errors: {
        total: 0,
        byType: {},
        byCode: {},
        rateLimits: 0,
        authFailures: 0,
        networkErrors: 0
      },
      messages: {
        sent: 0,
        delivered: 0,
        failed: 0,
        byType: {
          text: 0,
          template: 0,
          media: 0
        }
      },
      webhooks: {
        received: 0,
        processed: 0,
        failed: 0,
        byType: {}
      },
      rateLimiting: {
        hits: 0,
        totalWaitTime: 0,
        averageWaitTime: 0,
        byEndpoint: {}
      }
    };

    this.startTime = Date.now();
    this.lastReset = new Date().toISOString();
    this.correlationId = generateCorrelationId();

    structuredLogger.info('Cloud API metrics reset', {
      oldCorrelationId,
      newCorrelationId: this.correlationId,
      resetTime: this.lastReset
    });
  }

  /**
   * Export metrics for external monitoring systems
   * @param {string} format - Export format ('json', 'prometheus')
   * @returns {string|Object} Formatted metrics
   */
  exportMetrics(format = 'json') {
    const summary = this.getMetricsSummary();

    if (format === 'prometheus') {
      return this.formatPrometheusMetrics(summary);
    }

    return summary;
  }

  /**
   * Format metrics for Prometheus
   * @param {Object} summary - Metrics summary
   * @returns {string} Prometheus formatted metrics
   */
  formatPrometheusMetrics(summary) {
    const lines = [];
    
    // Request metrics
    lines.push(`# HELP whatsapp_cloud_api_requests_total Total number of requests`);
    lines.push(`# TYPE whatsapp_cloud_api_requests_total counter`);
    lines.push(`whatsapp_cloud_api_requests_total ${summary.requests.total}`);
    
    lines.push(`# HELP whatsapp_cloud_api_requests_successful_total Total number of successful requests`);
    lines.push(`# TYPE whatsapp_cloud_api_requests_successful_total counter`);
    lines.push(`whatsapp_cloud_api_requests_successful_total ${summary.requests.successful}`);
    
    lines.push(`# HELP whatsapp_cloud_api_requests_failed_total Total number of failed requests`);
    lines.push(`# TYPE whatsapp_cloud_api_requests_failed_total counter`);
    lines.push(`whatsapp_cloud_api_requests_failed_total ${summary.requests.failed}`);
    
    // Performance metrics
    lines.push(`# HELP whatsapp_cloud_api_request_duration_ms Request duration in milliseconds`);
    lines.push(`# TYPE whatsapp_cloud_api_request_duration_ms histogram`);
    lines.push(`whatsapp_cloud_api_request_duration_ms_sum ${summary.performance.totalDuration}`);
    lines.push(`whatsapp_cloud_api_request_duration_ms_count ${summary.requests.total}`);
    
    // Error metrics
    lines.push(`# HELP whatsapp_cloud_api_errors_total Total number of errors`);
    lines.push(`# TYPE whatsapp_cloud_api_errors_total counter`);
    lines.push(`whatsapp_cloud_api_errors_total ${summary.errors.total}`);
    
    // Message metrics
    lines.push(`# HELP whatsapp_cloud_api_messages_sent_total Total number of messages sent`);
    lines.push(`# TYPE whatsapp_cloud_api_messages_sent_total counter`);
    lines.push(`whatsapp_cloud_api_messages_sent_total ${summary.messages.sent}`);
    
    return lines.join('\n');
  }
}

// Create singleton instance
const cloudApiMetricsCollector = new CloudApiMetricsCollector();

export default cloudApiMetricsCollector;
export { CloudApiMetricsCollector, cloudApiMetricsCollector };