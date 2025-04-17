/**
 * Authentication middleware for Kineta API
 * 
 * Implements:
 * - API key authentication
 * - Request authorization
 * - Protected route handling
 */

/**
 * Create authentication middleware
 * @param {object} options - Middleware options
 * @param {string} options.apiKey - API key for authentication
 * @param {boolean} options.requireAuth - Whether to require authentication for all routes
 * @param {Array} options.publicPaths - Array of paths that don't require authentication
 * @returns {Function} - Express middleware function
 */
module.exports = function(options = {}) {
    const apiKey = options.apiKey;
    const requireAuth = options.requireAuth || false;
    const publicPaths = options.publicPaths || [
      '/',
      '/docs',
      '/docs/',
      '/docs/swagger.json',
      '/api/v1/stats/all',
      '/api/v1/blockchain/info',
      '/api/v1/blockchain/height',
      '/api/v1/blockchain/blocks/latest'
    ];
    
    /**
     * Authentication middleware function
     * @param {object} req - Express request object
     * @param {object} res - Express response object
     * @param {Function} next - Express next function
     */
    return function authMiddleware(req, res, next) {
      // Skip auth for public paths
      if (publicPaths.includes(req.path)) {
        return next();
      }
      
      // Skip auth for some path prefixes
      if (req.path.startsWith('/docs/') || 
          req.path.startsWith('/api/v1/blockchain/blocks/') && req.method === 'GET') {
        return next();
      }
      
      // Skip auth if not required
      if (!requireAuth || !apiKey) {
        return next();
      }
      
      // Check for API key in header
      const providedKey = req.header('X-API-Key');
      
      if (!providedKey) {
        return res.status(401).json({
          error: 'API key required',
          code: 401
        });
      }
      
      // Validate API key
      if (providedKey !== apiKey) {
        return res.status(403).json({
          error: 'Invalid API key',
          code: 403
        });
      }
      
      // Authentication successful
      next();
    };
  };