/**
 * Error handling middleware for Kineta API
 * 
 * Implements:
 * - Global error handling
 * - Error formatting
 * - Error logging
 */

/**
 * Create error handling middleware
 * @param {object} options - Middleware options
 * @param {boolean} options.logErrors - Whether to log errors (default: true)
 * @param {boolean} options.includeStackTrace - Whether to include stack trace in development (default: false)
 * @returns {Function} - Express error handling middleware
 */
module.exports = function(options = {}) {
    const logErrors = options.logErrors !== undefined ? options.logErrors : true;
    const includeStackTrace = options.includeStackTrace !== undefined ? options.includeStackTrace : false;
    
    /**
     * Error handling middleware function
     * @param {Error} err - Error object
     * @param {object} req - Express request object
     * @param {object} res - Express response object
     * @param {Function} next - Express next function
     */
    return function errorMiddleware(err, req, res, next) {
      // Default status code
      const statusCode = err.statusCode || 500;
      
      // Error response
      const errorResponse = {
        error: err.message || 'Internal Server Error',
        code: statusCode
      };
      
      // Include stack trace in development
      if (includeStackTrace && process.env.NODE_ENV !== 'production') {
        errorResponse.stack = err.stack;
      }
      
      // Include additional error details if available
      if (err.details) {
        errorResponse.details = err.details;
      }
      
      // Log error
      if (logErrors) {
        console.error('API Error:', {
          path: req.path,
          method: req.method,
          statusCode,
          error: err.message,
          stack: err.stack,
          timestamp: new Date().toISOString()
        });
      }
      
      // Send error response
      res.status(statusCode).json(errorResponse);
    };
  };