import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { cloudApiMonitoringService } from '../services/cloudApiMonitoringService.js';
import { cloudApiMetricsCollector } from '../services/cloudApiMetricsCollector.js';
import { cloudApiAlertingService } from '../services/cloudApiAlertingService.js';
import { structuredLogger } from '../helpers/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

/**
 * Serve monitoring dashboard HTML
 * GET /monitoring
 */
router.get('/', (req, res) => {
  try {
    const dashboardPath = path.join(__dirname, '../views/monitoring-dashboard.html');
    res.sendFile(dashboardPath);
    
    structuredLogger.info('Monitoring dashboard served', {
      requestId: req.headers['x-request-id'],
      userAgent: req.headers['user-agent'],
      service: 'MonitoringRoutes'
    });
  } catch (error) {
    structuredLogger.error('Failed to serve monitoring dashboard', {
      error: error.message,
      requestId: req.headers['x-request-id'],
      service: 'MonitoringRoutes'
    });

    res.status(500).json({
      success: false,
      error: 'Failed to serve monitoring dashboard',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Get Cloud API monitoring dashboard data
 * GET /monitoring/dashboard
 */
router.get('/dashboard', async (req, res) => {
  try {
    const dashboardData = cloudApiMonitoringService.getDashboardData();
    
    structuredLogger.info('Dashboard data requested', {
      requestId: req.headers['x-request-id'],
      userAgent: req.headers['user-agent'],
      service: 'MonitoringRoutes'
    });

    res.json({
      success: true,
      data: dashboardData,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    structuredLogger.error('Failed to get dashboard data', {
      error: error.message,
      requestId: req.headers['x-request-id'],
      service: 'MonitoringRoutes'
    });

    res.status(500).json({
      success: false,
      error: 'Failed to retrieve dashboard data',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Get Cloud API health status
 * GET /monitoring/health
 */
router.get('/health', async (req, res) => {
  try {
    const healthStatus = cloudApiMonitoringService.getServiceHealth();
    
    // Set appropriate HTTP status based on health
    const httpStatus = healthStatus.status === 'healthy' ? 200 : 503;
    
    structuredLogger.info('Health status requested', {
      requestId: req.headers['x-request-id'],
      status: healthStatus.status,
      activeAlerts: healthStatus.activeAlerts,
      service: 'MonitoringRoutes'
    });

    res.status(httpStatus).json({
      success: true,
      data: healthStatus,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    structuredLogger.error('Failed to get health status', {
      error: error.message,
      requestId: req.headers['x-request-id'],
      service: 'MonitoringRoutes'
    });

    res.status(500).json({
      success: false,
      error: 'Failed to retrieve health status',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Get detailed metrics
 * GET /monitoring/metrics
 */
router.get('/metrics', async (req, res) => {
  try {
    const format = req.query.format || 'json';
    const metrics = cloudApiMetricsCollector.exportMetrics(format);
    
    structuredLogger.info('Metrics requested', {
      requestId: req.headers['x-request-id'],
      format,
      service: 'MonitoringRoutes'
    });

    if (format === 'prometheus') {
      res.set('Content-Type', 'text/plain');
      res.send(metrics);
    } else {
      res.json({
        success: true,
        data: metrics,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    structuredLogger.error('Failed to get metrics', {
      error: error.message,
      requestId: req.headers['x-request-id'],
      service: 'MonitoringRoutes'
    });

    res.status(500).json({
      success: false,
      error: 'Failed to retrieve metrics',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Get active alerts
 * GET /monitoring/alerts
 */
router.get('/alerts', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const severity = req.query.severity; // 'critical', 'warning', or undefined for all
    
    let alerts = cloudApiMonitoringService.getRecentAlerts(limit);
    
    if (severity) {
      alerts = alerts.filter(alert => alert.severity === severity);
    }
    
    structuredLogger.info('Alerts requested', {
      requestId: req.headers['x-request-id'],
      limit,
      severity,
      alertCount: alerts.length,
      service: 'MonitoringRoutes'
    });

    res.json({
      success: true,
      data: {
        alerts,
        total: alerts.length,
        active: cloudApiMonitoringService.getActiveAlerts().length
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    structuredLogger.error('Failed to get alerts', {
      error: error.message,
      requestId: req.headers['x-request-id'],
      service: 'MonitoringRoutes'
    });

    res.status(500).json({
      success: false,
      error: 'Failed to retrieve alerts',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Generate monitoring report
 * GET /monitoring/report
 */
router.get('/report', async (req, res) => {
  try {
    const period = req.query.period || 'day';
    const report = cloudApiMonitoringService.generateReport(period);
    
    structuredLogger.info('Monitoring report generated', {
      requestId: req.headers['x-request-id'],
      reportId: report.reportId,
      period,
      service: 'MonitoringRoutes'
    });

    res.json({
      success: true,
      data: report,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    structuredLogger.error('Failed to generate report', {
      error: error.message,
      requestId: req.headers['x-request-id'],
      service: 'MonitoringRoutes'
    });

    res.status(500).json({
      success: false,
      error: 'Failed to generate monitoring report',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Trigger manual health check
 * POST /monitoring/health-check
 */
router.post('/health-check', async (req, res) => {
  try {
    const healthCheck = await cloudApiMonitoringService.performHealthCheck();
    
    structuredLogger.info('Manual health check triggered', {
      requestId: req.headers['x-request-id'],
      checkId: healthCheck.id,
      status: healthCheck.overall.status,
      alertCount: healthCheck.alerts?.length || 0,
      service: 'MonitoringRoutes'
    });

    res.json({
      success: true,
      data: healthCheck,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    structuredLogger.error('Failed to perform health check', {
      error: error.message,
      requestId: req.headers['x-request-id'],
      service: 'MonitoringRoutes'
    });

    res.status(500).json({
      success: false,
      error: 'Failed to perform health check',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Update alert thresholds
 * PUT /monitoring/thresholds
 */
router.put('/thresholds', async (req, res) => {
  try {
    const { thresholds } = req.body;
    
    if (!thresholds || typeof thresholds !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Invalid thresholds data',
        timestamp: new Date().toISOString()
      });
    }
    
    cloudApiMonitoringService.updateAlertThresholds(thresholds);
    
    structuredLogger.info('Alert thresholds updated', {
      requestId: req.headers['x-request-id'],
      thresholds,
      service: 'MonitoringRoutes'
    });

    res.json({
      success: true,
      message: 'Alert thresholds updated successfully',
      data: cloudApiMonitoringService.alertThresholds,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    structuredLogger.error('Failed to update thresholds', {
      error: error.message,
      requestId: req.headers['x-request-id'],
      service: 'MonitoringRoutes'
    });

    res.status(500).json({
      success: false,
      error: 'Failed to update alert thresholds',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Reset monitoring data
 * POST /monitoring/reset
 */
router.post('/reset', async (req, res) => {
  try {
    cloudApiMonitoringService.resetMonitoringData();
    
    structuredLogger.info('Monitoring data reset', {
      requestId: req.headers['x-request-id'],
      service: 'MonitoringRoutes'
    });

    res.json({
      success: true,
      message: 'Monitoring data reset successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    structuredLogger.error('Failed to reset monitoring data', {
      error: error.message,
      requestId: req.headers['x-request-id'],
      service: 'MonitoringRoutes'
    });

    res.status(500).json({
      success: false,
      error: 'Failed to reset monitoring data',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Get monitoring configuration
 * GET /monitoring/config
 */
router.get('/config', async (req, res) => {
  try {
    const config = {
      alertThresholds: cloudApiMonitoringService.alertThresholds,
      healthCheckInterval: cloudApiMonitoringService.healthCheckInterval,
      maxAlertHistory: cloudApiMonitoringService.maxAlertHistory,
      correlationId: cloudApiMonitoringService.correlationId,
      alerting: cloudApiAlertingService.getAlertStats()
    };
    
    structuredLogger.info('Monitoring configuration requested', {
      requestId: req.headers['x-request-id'],
      service: 'MonitoringRoutes'
    });

    res.json({
      success: true,
      data: config,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    structuredLogger.error('Failed to get monitoring configuration', {
      error: error.message,
      requestId: req.headers['x-request-id'],
      service: 'MonitoringRoutes'
    });

    res.status(500).json({
      success: false,
      error: 'Failed to retrieve monitoring configuration',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Test alert system
 * POST /monitoring/test-alert
 */
router.post('/test-alert', async (req, res) => {
  try {
    const { severity = 'warning' } = req.body;
    
    if (!['warning', 'critical'].includes(severity)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid severity. Must be "warning" or "critical"',
        timestamp: new Date().toISOString()
      });
    }
    
    await cloudApiAlertingService.testAlert(severity);
    
    structuredLogger.info('Test alert triggered', {
      requestId: req.headers['x-request-id'],
      severity,
      service: 'MonitoringRoutes'
    });

    res.json({
      success: true,
      message: `Test alert sent with severity: ${severity}`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    structuredLogger.error('Failed to send test alert', {
      error: error.message,
      requestId: req.headers['x-request-id'],
      service: 'MonitoringRoutes'
    });

    res.status(500).json({
      success: false,
      error: 'Failed to send test alert',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Update alert channels
 * PUT /monitoring/alert-channels
 */
router.put('/alert-channels', async (req, res) => {
  try {
    const { channels } = req.body;
    
    if (!channels || typeof channels !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Invalid channels data',
        timestamp: new Date().toISOString()
      });
    }
    
    cloudApiAlertingService.updateChannels(channels);
    
    structuredLogger.info('Alert channels updated', {
      requestId: req.headers['x-request-id'],
      channels,
      service: 'MonitoringRoutes'
    });

    res.json({
      success: true,
      message: 'Alert channels updated successfully',
      data: cloudApiAlertingService.getAlertStats(),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    structuredLogger.error('Failed to update alert channels', {
      error: error.message,
      requestId: req.headers['x-request-id'],
      service: 'MonitoringRoutes'
    });

    res.status(500).json({
      success: false,
      error: 'Failed to update alert channels',
      timestamp: new Date().toISOString()
    });
  }
});

export default router;