/**
 * Middleware index.js - Export all middleware for Kineta API
 */

const authMiddleware = require('./auth');
const loggerMiddleware = require('./logger');
const errorMiddleware = require('./error');

module.exports = {
  authMiddleware,
  loggerMiddleware,
  errorMiddleware
};