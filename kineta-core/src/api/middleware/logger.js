/**
 * Logging middleware for Kineta API
 * 
 * Implements:
 * - Request logging
 * - Response logging
 * - Error logging
 * - Request timing
 */

/**
 * Create logging middleware
 * @param {object} options - Middleware options
 * @param {boolean} options.logBody - Whether to log request body
 * @param {boolean} options.logHeaders - Whether to log request headers
 * @param {boolean} options.logResponse - Whether to log response body
 * @param {boolean} options.logTiming - Whether to log request timing
 * @returns {Function} - Express middleware function
 */
module.exports = function(options = {}) {
    const logBody = options.logBody !== undefined ? options.logBody : false;
    const logHeaders = options.logHeaders !== undefined ? options.logHeaders : false;
    const logResponse = options.logResponse !== undefined ? options.logResponse : false;
    const logTiming = options.logTiming !== undefined ? options.logTiming : true;
    
    /**
     * Logging middleware function
     * @param {object} req - Express request object
     * @param {object} res - Express response object
     * @param {Function} next - Express next function
     */
    return function loggerMiddleware(req, res, next) {
      // Skip logging for static assets
      if (req.path.startsWith('/docs/') && req.path.includes('.')) {
        return next();
      }
      
      // Log request start time
      const startTime = Date.now();
      
      // Log basic request info
      const logInfo = {
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.path,
        query: req.query,
        ip: req.ip || req.connection.remoteAddress
      };
      
      // Log request headers if enabled
      if (logHeaders) {
        logInfo.headers = req.headers;
      }
      
      // Log request body if enabled
      if (logBody && req.body && Object.keys(req.body).length > 0) {
        // Sanitize sensitive data
        const sanitizedBody = { ...req.body };
        
        // Remove potentially sensitive information
        if (sanitizedBody.signature) {
          sanitizedBody.signature = '[REDACTED]';
        }
        if (sanitizedBody.privateKey) {
          sanitizedBody.privateKey = '[REDACTED]';
        }
        if (sanitizedBody.password) {
          sanitizedBody.password = '[REDACTED]';
        }
        
        logInfo.body = sanitizedBody;
      }
      
      // Store original response methods
      const originalSend = res.send;
      const originalJson = res.json;
      let responseBody;
      
      // Override response methods to capture body
      if (logResponse) {
        res.send = function(body) {
          responseBody = body;
          return originalSend.apply(res, arguments);
        };
        
        res.json = function(body) {
          responseBody = body;
          return originalJson.apply(res, arguments);
        };
      }
      
      // Log after request is completed
      res.on('finish', () => {
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        // Add response info to log
        logInfo.statusCode = res.statusCode;
        
        if (logTiming) {
          logInfo.duration = duration;
        }
        
        // Log response body if enabled
        if (logResponse && responseBody) {
          // Avoid logging large responses
          if (typeof responseBody === 'string' && responseBody.length > 1000) {
            logInfo.response = `${responseBody.substring(0, 1000)}... [truncated]`;
          } else {
            try {
              // If JSON string, parse it
              if (typeof responseBody === 'string' && responseBody.startsWith('{')) {
                logInfo.response = JSON.parse(responseBody);
              } else {
                logInfo.response = responseBody;
              }
            } catch (e) {
              logInfo.response = responseBody;
            }
          }
        }
        
        // Log differently based on status code
        if (res.statusCode >= 500) {
          console.error('API Error:', logInfo);
        } else if (res.statusCode >= 400) {
          console.warn('API Warning:', logInfo);
        } else {
          console.log('API Request:', logInfo);
        }
      });
      
      next();
    };
  };