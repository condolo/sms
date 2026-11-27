'use strict';

/** Public build identity for deployment verification. */
const pkg = require('../../package.json');

const commit = process.env.RENDER_GIT_COMMIT
  || process.env.GIT_COMMIT
  || process.env.COMMIT_SHA
  || 'development';
const deployedAt = process.env.DEPLOYED_AT || null;

module.exports = {
  version: pkg.version,
  commit,
  deployedAt,
  node: process.version,
};
