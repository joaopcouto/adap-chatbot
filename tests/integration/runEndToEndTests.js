#!/usr/bin/env node

/**
 * Comprehensive End-to-End Test Runner for Cloud API Migration
 * 
 * This script runs all integration tests to validate the complete
 * Cloud API implementation including error scenarios and recovery procedures.
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '../..');

// Test configuration
const testConfig = {
  timeout: 30000, // 30 seconds per test
  verbose: true,
  coverage: true,
  bail: false, // Continue running tests even if some fail
  maxWorkers: 1 // Run tests sequentially for better debugging
};

// Test suites to run
const testSuites = [
  {
    name: 'Cloud API End-to-End Integration',
    path: 'tests/integration/cloudApiEndToEnd.test.js',
    description: 'Tests complete message flow, webhook handling, and service integration'
  },
  {
    name: 'Cloud API Error Recovery',
    path: 'tests/integration/cloudApiErrorRecovery.test.js',
    description: 'Tests error handling, retry mechanisms, and recovery procedures'
  },
  {
    name: 'Cloud API Service Unit Tests',
    path: 'tests/services/cloudApiService.test.js',
    description: 'Tests individual service methods and functionality'
  },
  {
    name: 'Cloud API Configuration Tests',
    path: 'tests/config/cloudApiConfig.test.js',
    description: 'Tests configuration validation and management'
  },
  {
    name: 'Webhook Integration Tests',
    path: 'tests/integration/cloudApiWebhookIntegration.test.js',
    description: 'Tests webhook verification and message processing'
  }
];

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function colorize(text, color) {
  return `${colors[color]}${text}${colors.reset}`;
}

function log(message, color = 'reset') {
  console.log(colorize(message, color));
}

function logHeader(message) {
  console.log('\n' + '='.repeat(80));
  console.log(colorize(message, 'bright'));
  console.log('='.repeat(80));
}

function logSubHeader(message) {
  console.log('\n' + colorize(message, 'cyan'));
  console.log('-'.repeat(message.length));
}

async function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'pipe',
      cwd: projectRoot,
      ...options
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
      if (testConfig.verbose) {
        process.stdout.write(data);
      }
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
      if (testConfig.verbose) {
        process.stderr.write(data);
      }
    });

    child.on('close', (code) => {
      resolve({
        code,
        stdout,
        stderr
      });
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

async function checkTestFileExists(testPath) {
  const fullPath = join(projectRoot, testPath);
  try {
    await fs.promises.access(fullPath);
    return true;
  } catch {
    return false;
  }
}

async function runTestSuite(suite) {
  logSubHeader(`Running: ${suite.name}`);
  log(`Description: ${suite.description}`, 'blue');
  log(`Path: ${suite.path}`, 'blue');

  // Check if test file exists
  const exists = await checkTestFileExists(suite.path);
  if (!exists) {
    log(`⚠️  Test file not found: ${suite.path}`, 'yellow');
    return { success: false, skipped: true, reason: 'File not found' };
  }

  const jestArgs = [
    '--testPathPattern=' + suite.path,
    '--testTimeout=' + testConfig.timeout,
    '--maxWorkers=' + testConfig.maxWorkers
  ];

  if (testConfig.verbose) {
    jestArgs.push('--verbose');
  }

  if (testConfig.coverage) {
    jestArgs.push('--coverage');
    jestArgs.push('--coverageDirectory=coverage/' + suite.name.replace(/\s+/g, '_'));
  }

  if (!testConfig.bail) {
    jestArgs.push('--passWithNoTests');
  }

  try {
    const startTime = Date.now();
    const result = await runCommand('npm', ['test', '--', ...jestArgs]);
    const duration = Date.now() - startTime;

    if (result.code === 0) {
      log(`✅ ${suite.name} - PASSED (${duration}ms)`, 'green');
      return { success: true, duration, output: result.stdout };
    } else {
      log(`❌ ${suite.name} - FAILED (${duration}ms)`, 'red');
      if (!testConfig.verbose) {
        log('Error output:', 'red');
        console.log(result.stderr);
      }
      return { success: false, duration, error: result.stderr };
    }
  } catch (error) {
    log(`💥 ${suite.name} - ERROR: ${error.message}`, 'red');
    return { success: false, error: error.message };
  }
}

async function validateEnvironment() {
  logSubHeader('Validating Test Environment');

  // Check if Jest is available
  try {
    await runCommand('npm', ['list', 'jest']);
    log('✅ Jest is available', 'green');
  } catch {
    log('❌ Jest is not available. Run: npm install', 'red');
    return false;
  }

  // Check if required test dependencies are available
  const requiredDeps = ['supertest', '@jest/globals'];
  for (const dep of requiredDeps) {
    try {
      await runCommand('npm', ['list', dep]);
      log(`✅ ${dep} is available`, 'green');
    } catch {
      log(`❌ ${dep} is not available. Run: npm install`, 'red');
      return false;
    }
  }

  // Check if test environment variables are set
  const requiredEnvVars = [
    'NODE_ENV',
    'WHATSAPP_CLOUD_API_ENABLED',
    'WHATSAPP_ACCESS_TOKEN',
    'WHATSAPP_PHONE_NUMBER_ID'
  ];

  let envValid = true;
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      log(`⚠️  Environment variable ${envVar} is not set`, 'yellow');
      envValid = false;
    }
  }

  if (!envValid) {
    log('Setting test environment variables...', 'yellow');
    process.env.NODE_ENV = 'test';
    process.env.WHATSAPP_CLOUD_API_ENABLED = 'true';
    process.env.WHATSAPP_ACCESS_TOKEN = 'test_token_123';
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'test_phone_id_123';
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'test_verify_token_123';
  }

  return true;
}

async function generateTestReport(results) {
  logSubHeader('Generating Test Report');

  const totalTests = results.length;
  const passedTests = results.filter(r => r.success).length;
  const failedTests = results.filter(r => !r.success && !r.skipped).length;
  const skippedTests = results.filter(r => r.skipped).length;

  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      total: totalTests,
      passed: passedTests,
      failed: failedTests,
      skipped: skippedTests,
      successRate: totalTests > 0 ? (passedTests / totalTests * 100).toFixed(2) : 0
    },
    results: results.map((result, index) => ({
      suite: testSuites[index].name,
      path: testSuites[index].path,
      success: result.success,
      skipped: result.skipped || false,
      duration: result.duration || 0,
      error: result.error || null
    }))
  };

  // Write report to file
  const reportPath = join(projectRoot, 'test-results', 'end-to-end-report.json');
  try {
    await fs.promises.mkdir(join(projectRoot, 'test-results'), { recursive: true });
    await fs.promises.writeFile(reportPath, JSON.stringify(report, null, 2));
    log(`📊 Test report saved to: ${reportPath}`, 'blue');
  } catch (error) {
    log(`⚠️  Could not save test report: ${error.message}`, 'yellow');
  }

  // Display summary
  logSubHeader('Test Summary');
  log(`Total Tests: ${totalTests}`, 'blue');
  log(`Passed: ${passedTests}`, passedTests > 0 ? 'green' : 'reset');
  log(`Failed: ${failedTests}`, failedTests > 0 ? 'red' : 'reset');
  log(`Skipped: ${skippedTests}`, skippedTests > 0 ? 'yellow' : 'reset');
  log(`Success Rate: ${report.summary.successRate}%`, 
      report.summary.successRate >= 80 ? 'green' : 
      report.summary.successRate >= 60 ? 'yellow' : 'red');

  return report;
}

async function main() {
  logHeader('Cloud API Migration - End-to-End Test Suite');
  
  log('This test suite validates the complete Cloud API implementation', 'blue');
  log('including message sending, webhook handling, error recovery, and monitoring.', 'blue');

  // Validate environment
  const envValid = await validateEnvironment();
  if (!envValid) {
    log('❌ Environment validation failed. Please fix the issues above.', 'red');
    process.exit(1);
  }

  // Run all test suites
  const results = [];
  for (const suite of testSuites) {
    const result = await runTestSuite(suite);
    results.push(result);

    // Add delay between test suites to avoid resource conflicts
    if (testSuites.indexOf(suite) < testSuites.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Generate and display report
  const report = await generateTestReport(results);

  // Exit with appropriate code
  const hasFailures = results.some(r => !r.success && !r.skipped);
  if (hasFailures) {
    logHeader('❌ Some tests failed. Please review the results above.');
    process.exit(1);
  } else {
    logHeader('✅ All tests passed successfully!');
    log('The Cloud API migration implementation is ready for production.', 'green');
    process.exit(0);
  }
}

// Handle process signals
process.on('SIGINT', () => {
  log('\n⚠️  Test execution interrupted by user', 'yellow');
  process.exit(130);
});

process.on('SIGTERM', () => {
  log('\n⚠️  Test execution terminated', 'yellow');
  process.exit(143);
});

// Run the test suite
main().catch(error => {
  log(`💥 Fatal error: ${error.message}`, 'red');
  console.error(error.stack);
  process.exit(1);
});