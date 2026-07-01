/**
 * Health Engine
 * Checks live infrastructure: DB, uptime, storage, email config, rate limits.
 * This is operational health (is the system up?) not compliance (is it correct?).
 */
'use strict';

const mongoose = require('mongoose');
const { _model } = require('../../../utils/model');

async function run() {
  const checks = await Promise.allSettled([
    _checkDatabase(),
    _checkCollections(),
    _checkUptime(),
    _checkStorageConfig(),
    _checkEmailConfig(),
  ]);

  const results = checks.map(c => c.status === 'fulfilled' ? c.value : {
    id: 'unknown', label: 'Check failed', status: 'error', detail: c.reason?.message,
  });

  const summary = {
    healthy:  results.filter(r => r.status === 'ok').length,
    degraded: results.filter(r => r.status === 'warn').length,
    down:     results.filter(r => r.status === 'error').length,
    total:    results.length,
  };

  const overall = summary.down > 0 ? 'degraded' : summary.degraded > 0 ? 'warn' : 'healthy';

  return { checks: results, summary, overall };
}

async function _checkDatabase() {
  const state = mongoose.connection.readyState;
  const labels = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
  return {
    id:     'db.connection',
    label:  'Database Connection',
    status: state === 1 ? 'ok' : state === 2 ? 'warn' : 'error',
    detail: labels[state] || 'unknown',
  };
}

async function _checkCollections() {
  try {
    // A lightweight ping — count documents on a small, always-present collection
    await _model('schools').countDocuments({}).then(() => {});
    return { id: 'db.collections', label: 'Collections Accessible', status: 'ok', detail: 'read OK' };
  } catch (err) {
    return { id: 'db.collections', label: 'Collections Accessible', status: 'error', detail: err.message };
  }
}

function _checkUptime() {
  const seconds = Math.floor(process.uptime());
  const hours   = Math.floor(seconds / 3600);
  return {
    id:     'runtime.uptime',
    label:  'Server Uptime',
    status: 'ok',
    detail: `${hours}h ${Math.floor((seconds % 3600) / 60)}m`,
    value:  seconds,
  };
}

function _checkStorageConfig() {
  const configured = !!(process.env.AWS_BUCKET_NAME && process.env.AWS_ACCESS_KEY_ID);
  return {
    id:     'storage.s3',
    label:  'S3/Object Storage',
    status: configured ? 'ok' : 'warn',
    detail: configured ? 'configured' : 'AWS_BUCKET_NAME or AWS_ACCESS_KEY_ID not set',
  };
}

function _checkEmailConfig() {
  const configured = !!(process.env.SMTP_HOST || process.env.EMAIL_HOST || process.env.SENDGRID_API_KEY);
  return {
    id:     'email.smtp',
    label:  'Email / SMTP',
    status: configured ? 'ok' : 'warn',
    detail: configured ? 'env configured' : 'No SMTP_HOST or SENDGRID_API_KEY set',
  };
}

module.exports = { run };
