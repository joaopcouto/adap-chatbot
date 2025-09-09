import cron from "node-cron";
import alertingService from "../services/alertingService.js";
import { devLog } from "../helpers/logger.js";
import { structuredLogger, generateCorrelationId } from "../helpers/logger.js";
import configManager from "../config/config.js";
import featureFlagService from "../services/featureFlagService.js";

class AlertingJobManager {
  constructor() {
    this.isRunning = false;
    this.metrics = {
      lastRunTime: null,
      totalChecks: 0,
      totalAlertsTriggered: 0,
      errors: []
    };
    
    // Configuration
    this.config = {
      // How often to check for alerts (every 5 minutes)
      cronSchedule: configManager.get('jobs.alertingCronSchedule'),
      // Enable/disable alerting
      enabled: featureFlagService.isEnabled('alertingEnabled')
    };
  }

  /**
   * Start the scheduled alerting job
   */
  start() {
    if (!this.config.enabled) {
      devLog("[AlertingJob] Alerting is disabled, not starting scheduler");
      return;
    }
    
    devLog("[AlertingJob] Starting alerting job scheduler");
    
    cron.schedule(this.config.cronSchedule, async () => {
      if (this.isRunning) {
        devLog("[AlertingJob] Previous job still running, skipping this execution");
        return;
      }
      
      await this.checkAlerts();
    });
    
    devLog(`[AlertingJob] Scheduled to run every: ${this.config.cronSchedule}`);
  }

  /**
   * Check alerts and trigger notifications
   */
  async checkAlerts() {
    if (this.isRunning) {
      devLog("[AlertingJob] Job already running, skipping");
      return;
    }

    this.isRunning = true;
    const correlationId = generateCorrelationId();
    const startTime = Date.now();
    
    structuredLogger.info('Starting scheduled alert check', {
      correlationId
    });

    try {
      // Check and trigger alerts
      const alertResults = await alertingService.checkAndTriggerAlerts(correlationId);
      
      // Update metrics
      this.metrics.lastRunTime = new Date();
      this.metrics.totalChecks++;
      this.metrics.totalAlertsTriggered += alertResults.alertsTriggered;
      
      const duration = Date.now() - startTime;
      
      structuredLogger.info('Scheduled alert check completed', {
        correlationId,
        duration,
        alertsTriggered: alertResults.alertsTriggered,
        totalChecks: this.metrics.totalChecks,
        totalAlertsTriggered: this.metrics.totalAlertsTriggered
      });

      devLog(`[AlertingJob] Alert check completed in ${duration}ms, triggered ${alertResults.alertsTriggered} alerts`);

      return alertResults;

    } catch (error) {
      const duration = Date.now() - startTime;
      
      structuredLogger.error('Scheduled alert check failed', {
        correlationId,
        duration,
        error
      });
      
      devLog("[AlertingJob] Error during alert check:", error);
      
      // Track error in metrics
      this.metrics.errors.push({
        timestamp: new Date(),
        error: error.message,
        correlationId
      });
      
      // Keep only last 10 errors
      if (this.metrics.errors.length > 10) {
        this.metrics.errors = this.metrics.errors.slice(-10);
      }
      
      throw error;
      
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get current job metrics for monitoring
   */
  getMetrics() {
    return {
      ...this.metrics,
      isRunning: this.isRunning,
      config: this.config
    };
  }

  /**
   * Get health status of the alerting job
   */
  async getHealthStatus() {
    try {
      const now = new Date();
      const lastRunTime = this.metrics.lastRunTime;
      
      // Calculate time since last run
      const timeSinceLastRun = lastRunTime ? now.getTime() - lastRunTime.getTime() : null;
      const expectedInterval = 5 * 60 * 1000; // 5 minutes in milliseconds
      
      // Check if job is running as expected
      let healthScore = 100;
      let status = 'healthy';
      const issues = [];
      
      if (!this.config.enabled) {
        status = 'disabled';
        healthScore = 0;
        issues.push('Alerting is disabled');
      } else if (!lastRunTime) {
        status = 'warning';
        healthScore = 50;
        issues.push('Job has never run');
      } else if (timeSinceLastRun > expectedInterval * 2) {
        status = 'critical';
        healthScore = 20;
        issues.push(`Job hasn't run for ${Math.round(timeSinceLastRun / 60000)} minutes`);
      } else if (timeSinceLastRun > expectedInterval * 1.5) {
        status = 'warning';
        healthScore = 70;
        issues.push('Job is running behind schedule');
      }
      
      // Check for recent errors
      const recentErrors = this.metrics.errors.filter(
        e => now.getTime() - e.timestamp.getTime() < 60 * 60 * 1000 // Last hour
      );
      
      if (recentErrors.length > 3) {
        status = 'critical';
        healthScore = Math.min(healthScore, 30);
        issues.push(`${recentErrors.length} errors in the last hour`);
      } else if (recentErrors.length > 1) {
        status = status === 'healthy' ? 'warning' : status;
        healthScore = Math.min(healthScore, 80);
        issues.push(`${recentErrors.length} errors in the last hour`);
      }
      
      return {
        status,
        healthScore,
        issues,
        lastRunTime,
        timeSinceLastRun,
        isRunning: this.isRunning,
        enabled: this.config.enabled,
        totalChecks: this.metrics.totalChecks,
        totalAlertsTriggered: this.metrics.totalAlertsTriggered,
        recentErrorCount: recentErrors.length
      };
      
    } catch (error) {
      devLog("[AlertingJob] Error getting health status:", error);
      return {
        status: 'error',
        healthScore: 0,
        error: error.message
      };
    }
  }

  /**
   * Force run the alerting check (for manual triggers)
   */
  async forceRun() {
    devLog("[AlertingJob] Force running alert check");
    return await this.checkAlerts();
  }

  /**
   * Stop the alerting job
   */
  stop() {
    devLog("[AlertingJob] Stopping alerting job");
    // Note: node-cron doesn't provide a direct way to stop individual jobs
    // In a production environment, you might want to track the cron task
    // and call task.stop() or use a different scheduling library
  }
}

// Create singleton instance
const alertingJobManager = new AlertingJobManager();

/**
 * Start the alerting job
 */
export function startAlertingJob() {
  devLog("[AlertingJob] Starting alerting job scheduler");
  alertingJobManager.start();
}

/**
 * Get job metrics for monitoring
 */
export function getAlertingJobMetrics() {
  return alertingJobManager.getMetrics();
}

/**
 * Get health status for monitoring
 */
export function getAlertingJobHealth() {
  return alertingJobManager.getHealthStatus();
}

/**
 * Force run the alerting check
 */
export function forceAlertingRun() {
  return alertingJobManager.forceRun();
}

/**
 * Stop the alerting job
 */
export function stopAlertingJob() {
  alertingJobManager.stop();
}

export default alertingJobManager;