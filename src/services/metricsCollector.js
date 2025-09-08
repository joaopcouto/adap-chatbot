import { structuredLogger, generateCorrelationId } from '../helpers/logger.js';
import ReminderSync from '../models/ReminderSync.js';
import UserGoogleIntegration from '../models/UserGoogleIntegration.js';

/**
 * Metrics collector for Google Calendar integration monitoring
 * Tracks sync success rates, API response times, queue sizes, and error distributions
 */
class MetricsCollector {
  constructor() {
    this.metrics = {
      // Sync success rate tracking
      syncOperations: {
        total: 0,
        successful: 0,
        failed: 0,
        lastResetTime: new Date()
      },
      
      // API response time tracking
      apiResponseTimes: {
        createEvent: [],
        updateEvent: [],
        searchEvent: [],
        tokenRefresh: []
      },
      
      // Error distribution tracking
      errorDistribution: {
        AUTH_ERROR: 0,
        RATE_LIMIT: 0,
        SERVER_ERROR: 0,
        CLIENT_ERROR: 0,
        NETWORK_ERROR: 0,
        UNKNOWN_ERROR: 0
      },
      
      // Authentication issues tracking
      authIssues: {
        tokenRefreshFailures: 0,
        reconnectionRequired: 0,
        tokenCorruption: 0,
        lastAuthFailure: null
      },
      
      // Queue size tracking
      queueMetrics: {
        currentSize: 0,
        maxSize: 0,
        lastUpdated: new Date()
      },
      
      // Performance metrics
      performance: {
        averageResponseTime: 0,
        slowestOperation: null,
        fastestOperation: null
      }
    };
    
    // Configuration for metrics collection
    this.config = {
      // Maximum number of response times to keep in memory
      maxResponseTimeEntries: 100,
      // Time window for calculating averages (in milliseconds)
      metricsWindow: 60 * 60 * 1000, // 1 hour
      // Threshold for slow operations (in milliseconds)
      slowOperationThreshold: 5000, // 5 seconds
      // Alert thresholds
      alertThresholds: {
        errorRate: 0.1, // 10% error rate
        slowResponseRate: 0.2, // 20% slow responses
        queueSize: 100, // Queue size threshold
        authFailureRate: 0.05 // 5% auth failure rate
      }
    };
  }

  /**
   * Record a sync operation result
   * @param {string} operation - Operation type (create, update, search)
   * @param {boolean} success - Whether the operation succeeded
   * @param {number} duration - Operation duration in milliseconds
   * @param {string} errorType - Error type if operation failed
   * @param {string} correlationId - Correlation ID for tracking
   */
  recordSyncOperation(operation, success, duration, errorType = null, correlationId = null) {
    const cId = correlationId || generateCorrelationId();
    
    try {
      // Update sync operation counters
      this.metrics.syncOperations.total++;
      if (success) {
        this.metrics.syncOperations.successful++;
      } else {
        this.metrics.syncOperations.failed++;
        
        // Track error distribution
        if (errorType && this.metrics.errorDistribution.hasOwnProperty(errorType)) {
          this.metrics.errorDistribution[errorType]++;
        } else {
          this.metrics.errorDistribution.UNKNOWN_ERROR++;
        }
      }
      
      // Record API response time
      if (operation && this.metrics.apiResponseTimes.hasOwnProperty(operation)) {
        this._recordResponseTime(operation, duration);
      }
      
      // Update performance metrics
      this._updatePerformanceMetrics(operation, duration, success);
      
      // Log metrics for structured logging
      structuredLogger.info('Sync operation metrics recorded', {
        correlationId: cId,
        operation,
        success,
        duration,
        errorType,
        totalOperations: this.metrics.syncOperations.total,
        successRate: this.getSyncSuccessRate()
      });
      
    } catch (error) {
      structuredLogger.error('Error recording sync operation metrics', {
        correlationId: cId,
        operation,
        error
      });
    }
  }

  /**
   * Record authentication issue
   * @param {string} issueType - Type of auth issue (tokenRefresh, reconnectionRequired)
   * @param {Object} context - Additional context about the issue
   * @param {string} correlationId - Correlation ID for tracking
   */
  recordAuthIssue(issueType, context = {}, correlationId = null) {
    const cId = correlationId || generateCorrelationId();
    
    try {
      if (issueType === 'tokenRefresh') {
        this.metrics.authIssues.tokenRefreshFailures++;
      } else if (issueType === 'reconnectionRequired') {
        this.metrics.authIssues.reconnectionRequired++;
      } else if (issueType === 'tokenCorruption') {
        this.metrics.authIssues.tokenCorruption++;
      }
      
      this.metrics.authIssues.lastAuthFailure = new Date();
      
      structuredLogger.warn('Authentication issue recorded', {
        correlationId: cId,
        issueType,
        context,
        totalTokenRefreshFailures: this.metrics.authIssues.tokenRefreshFailures,
        totalReconnectionRequired: this.metrics.authIssues.reconnectionRequired,
        totalTokenCorruption: this.metrics.authIssues.tokenCorruption
      });
      
      // Check if we need to trigger alerts
      this._checkAuthAlerts(cId);
      
    } catch (error) {
      structuredLogger.error('Error recording auth issue metrics', {
        correlationId: cId,
        issueType,
        error
      });
    }
  }

  /**
   * Update queue size metrics
   * @param {number} currentSize - Current queue size
   * @param {string} correlationId - Correlation ID for tracking
   */
  async updateQueueMetrics(currentSize = null, correlationId = null) {
    const cId = correlationId || generateCorrelationId();
    
    try {
      // Get current queue size if not provided
      if (currentSize === null) {
        currentSize = await this._getCurrentQueueSize();
      }
      
      this.metrics.queueMetrics.currentSize = currentSize;
      this.metrics.queueMetrics.lastUpdated = new Date();
      
      // Update max size if current size is larger
      if (currentSize > this.metrics.queueMetrics.maxSize) {
        this.metrics.queueMetrics.maxSize = currentSize;
        
        structuredLogger.info('New maximum queue size recorded', {
          correlationId: cId,
          newMaxSize: currentSize,
          previousMax: this.metrics.queueMetrics.maxSize
        });
      }
      
      // Check if we need to trigger queue size alerts
      this._checkQueueAlerts(currentSize, cId);
      
    } catch (error) {
      structuredLogger.error('Error updating queue metrics', {
        correlationId: cId,
        error
      });
    }
  }

  /**
   * Get comprehensive metrics summary
   * @returns {Object} Complete metrics summary
   */
  getMetricsSummary() {
    const now = new Date();
    const uptime = now.getTime() - this.metrics.syncOperations.lastResetTime.getTime();
    
    return {
      timestamp: now,
      uptime: uptime,
      
      // Sync success rate metrics
      syncMetrics: {
        totalOperations: this.metrics.syncOperations.total,
        successfulOperations: this.metrics.syncOperations.successful,
        failedOperations: this.metrics.syncOperations.failed,
        successRate: this.getSyncSuccessRate(),
        failureRate: this.getSyncFailureRate()
      },
      
      // API response time metrics
      responseTimeMetrics: {
        createEvent: this._getResponseTimeStats('createEvent'),
        updateEvent: this._getResponseTimeStats('updateEvent'),
        searchEvent: this._getResponseTimeStats('searchEvent'),
        tokenRefresh: this._getResponseTimeStats('tokenRefresh'),
        overall: {
          average: this.metrics.performance.averageResponseTime,
          slowest: this.metrics.performance.slowestOperation,
          fastest: this.metrics.performance.fastestOperation
        }
      },
      
      // Error distribution
      errorDistribution: { ...this.metrics.errorDistribution },
      
      // Authentication issues
      authenticationMetrics: {
        tokenRefreshFailures: this.metrics.authIssues.tokenRefreshFailures,
        reconnectionRequired: this.metrics.authIssues.reconnectionRequired,
        tokenCorruption: this.metrics.authIssues.tokenCorruption,
        lastAuthFailure: this.metrics.authIssues.lastAuthFailure,
        authFailureRate: this.getAuthFailureRate()
      },
      
      // Queue metrics
      queueMetrics: {
        currentSize: this.metrics.queueMetrics.currentSize,
        maxSize: this.metrics.queueMetrics.maxSize,
        lastUpdated: this.metrics.queueMetrics.lastUpdated
      },
      
      // Health indicators
      healthIndicators: this._calculateHealthIndicators()
    };
  }

  /**
   * Get sync success rate as percentage
   * @returns {number} Success rate percentage (0-100)
   */
  getSyncSuccessRate() {
    if (this.metrics.syncOperations.total === 0) return 100;
    return (this.metrics.syncOperations.successful / this.metrics.syncOperations.total) * 100;
  }

  /**
   * Get sync failure rate as percentage
   * @returns {number} Failure rate percentage (0-100)
   */
  getSyncFailureRate() {
    if (this.metrics.syncOperations.total === 0) return 0;
    return (this.metrics.syncOperations.failed / this.metrics.syncOperations.total) * 100;
  }

  /**
   * Get authentication failure rate as percentage
   * @returns {number} Auth failure rate percentage (0-100)
   */
  getAuthFailureRate() {
    const totalAuthOperations = this.metrics.authIssues.tokenRefreshFailures + 
                               this.metrics.authIssues.reconnectionRequired +
                               this.metrics.authIssues.tokenCorruption;
    if (totalAuthOperations === 0) return 0;
    
    // Calculate based on total sync operations as denominator
    if (this.metrics.syncOperations.total === 0) return 0;
    return (totalAuthOperations / this.metrics.syncOperations.total) * 100;
  }

  /**
   * Reset metrics (useful for testing or periodic resets)
   * @param {string} correlationId - Correlation ID for tracking
   */
  resetMetrics(correlationId = null) {
    const cId = correlationId || generateCorrelationId();
    
    structuredLogger.info('Resetting metrics collector', {
      correlationId: cId,
      previousMetrics: this.getMetricsSummary()
    });
    
    this.metrics = {
      syncOperations: {
        total: 0,
        successful: 0,
        failed: 0,
        lastResetTime: new Date()
      },
      apiResponseTimes: {
        createEvent: [],
        updateEvent: [],
        searchEvent: [],
        tokenRefresh: []
      },
      errorDistribution: {
        AUTH_ERROR: 0,
        RATE_LIMIT: 0,
        SERVER_ERROR: 0,
        CLIENT_ERROR: 0,
        NETWORK_ERROR: 0,
        UNKNOWN_ERROR: 0
      },
      authIssues: {
        tokenRefreshFailures: 0,
        reconnectionRequired: 0,
        tokenCorruption: 0,
        lastAuthFailure: null
      },
      queueMetrics: {
        currentSize: 0,
        maxSize: 0,
        lastUpdated: new Date()
      },
      performance: {
        averageResponseTime: 0,
        slowestOperation: null,
        fastestOperation: null
      }
    };
  }

  /**
   * Record API response time for a specific operation
   * @private
   * @param {string} operation - Operation type
   * @param {number} duration - Duration in milliseconds
   */
  _recordResponseTime(operation, duration) {
    const responseTimeArray = this.metrics.apiResponseTimes[operation];
    
    // Add new response time
    responseTimeArray.push({
      duration,
      timestamp: new Date()
    });
    
    // Keep only the most recent entries
    if (responseTimeArray.length > this.config.maxResponseTimeEntries) {
      responseTimeArray.shift();
    }
    
    // Clean up old entries (older than metrics window)
    const cutoffTime = new Date(Date.now() - this.config.metricsWindow);
    this.metrics.apiResponseTimes[operation] = responseTimeArray.filter(
      entry => entry.timestamp > cutoffTime
    );
  }

  /**
   * Update performance metrics
   * @private
   * @param {string} operation - Operation type
   * @param {number} duration - Duration in milliseconds
   * @param {boolean} success - Whether operation succeeded
   */
  _updatePerformanceMetrics(operation, duration, success) {
    // Update average response time
    const totalOperations = this.metrics.syncOperations.total;
    if (totalOperations === 1) {
      this.metrics.performance.averageResponseTime = duration;
    } else {
      this.metrics.performance.averageResponseTime = 
        ((this.metrics.performance.averageResponseTime * (totalOperations - 1)) + duration) / totalOperations;
    }
    
    // Update slowest operation
    if (!this.metrics.performance.slowestOperation || 
        duration > this.metrics.performance.slowestOperation.duration) {
      this.metrics.performance.slowestOperation = {
        operation,
        duration,
        success,
        timestamp: new Date()
      };
    }
    
    // Update fastest operation
    if (!this.metrics.performance.fastestOperation || 
        duration < this.metrics.performance.fastestOperation.duration) {
      this.metrics.performance.fastestOperation = {
        operation,
        duration,
        success,
        timestamp: new Date()
      };
    }
  }

  /**
   * Get response time statistics for a specific operation
   * @private
   * @param {string} operation - Operation type
   * @returns {Object} Response time statistics
   */
  _getResponseTimeStats(operation) {
    const responseTimeArray = this.metrics.apiResponseTimes[operation];
    
    if (responseTimeArray.length === 0) {
      return {
        count: 0,
        average: 0,
        min: 0,
        max: 0,
        p95: 0
      };
    }
    
    const durations = responseTimeArray.map(entry => entry.duration).sort((a, b) => a - b);
    const count = durations.length;
    const sum = durations.reduce((acc, duration) => acc + duration, 0);
    const average = sum / count;
    const min = durations[0];
    const max = durations[count - 1];
    const p95Index = Math.floor(count * 0.95);
    const p95 = durations[p95Index] || max;
    
    return {
      count,
      average: Math.round(average),
      min,
      max,
      p95
    };
  }

  /**
   * Get current retry queue size
   * @private
   * @returns {Promise<number>} Current queue size
   */
  async _getCurrentQueueSize() {
    try {
      return await ReminderSync.countDocuments({
        syncStatus: 'FAILED',
        retryCount: { $lt: 3 }
      });
    } catch (error) {
      structuredLogger.error('Error getting current queue size', { error });
      return 0;
    }
  }

  /**
   * Calculate health indicators based on current metrics
   * @private
   * @returns {Object} Health indicators
   */
  _calculateHealthIndicators() {
    const successRate = this.getSyncSuccessRate();
    const authFailureRate = this.getAuthFailureRate();
    const queueSize = this.metrics.queueMetrics.currentSize;
    const avgResponseTime = this.metrics.performance.averageResponseTime;
    
    const indicators = {
      syncHealth: successRate >= 90 ? 'healthy' : successRate >= 70 ? 'warning' : 'critical',
      authHealth: authFailureRate <= 5 ? 'healthy' : authFailureRate <= 10 ? 'warning' : 'critical',
      queueHealth: queueSize <= 50 ? 'healthy' : queueSize <= 100 ? 'warning' : 'critical',
      performanceHealth: avgResponseTime <= 2000 ? 'healthy' : avgResponseTime <= 5000 ? 'warning' : 'critical'
    };
    
    // Overall health is the worst of all indicators
    const healthLevels = ['healthy', 'warning', 'critical'];
    const worstHealth = Object.values(indicators).reduce((worst, current) => {
      const worstIndex = healthLevels.indexOf(worst);
      const currentIndex = healthLevels.indexOf(current);
      return currentIndex > worstIndex ? current : worst;
    }, 'healthy');
    
    indicators.overall = worstHealth;
    
    return indicators;
  }

  /**
   * Check if authentication alerts should be triggered
   * @private
   * @param {string} correlationId - Correlation ID for tracking
   */
  _checkAuthAlerts(correlationId) {
    const authFailureRate = this.getAuthFailureRate();
    
    if (authFailureRate > this.config.alertThresholds.authFailureRate * 100) {
      structuredLogger.warn('High authentication failure rate detected', {
        correlationId,
        authFailureRate,
        threshold: this.config.alertThresholds.authFailureRate * 100,
        tokenRefreshFailures: this.metrics.authIssues.tokenRefreshFailures,
        reconnectionRequired: this.metrics.authIssues.reconnectionRequired,
        alertType: 'AUTH_FAILURE_RATE_HIGH'
      });
    }
  }

  /**
   * Check if queue size alerts should be triggered
   * @private
   * @param {number} queueSize - Current queue size
   * @param {string} correlationId - Correlation ID for tracking
   */
  _checkQueueAlerts(queueSize, correlationId) {
    if (queueSize > this.config.alertThresholds.queueSize) {
      structuredLogger.warn('High retry queue size detected', {
        correlationId,
        queueSize,
        threshold: this.config.alertThresholds.queueSize,
        alertType: 'QUEUE_SIZE_HIGH'
      });
    }
  }
}

// Create singleton instance
const metricsCollector = new MetricsCollector();

export default metricsCollector;