/**
 * Server.js - API server for Kineta blockchain
 * 
 * Implements:
 * - HTTP/HTTPS API server
 * - Middleware configuration
 * - Route configuration
 * - API documentation
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const bodyParser = require('body-parser');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const EventEmitter = require('events');

// Import middleware
const authMiddleware = require('./middleware/auth');
const loggerMiddleware = require('./middleware/logger');
const errorMiddleware = require('./middleware/error');

// Import routes
const blockchainRoutes = require('./routes/blockchain');
const transactionRoutes = require('./routes/transaction');
const addressRoutes = require('./routes/address');
const nodeRoutes = require('./routes/node');
const statsRoutes = require('./routes/stats');
const swaggerRoutes = require('./routes/swagger');

/**
 * API server for Kineta blockchain
 */
class APIServer extends EventEmitter {
  /**
   * Initialize API server
   * @param {object} options - Configuration options
   * @param {object} options.node - Node reference
   * @param {number} options.port - HTTP port (default: 3000)
   * @param {number} options.httpsPort - HTTPS port (default: 3001)
   * @param {boolean} options.enableHttps - Enable HTTPS (default: false)
   * @param {string} options.sslCert - Path to SSL certificate
   * @param {string} options.sslKey - Path to SSL key
   * @param {boolean} options.enableRateLimit - Enable rate limiting (default: true)
   * @param {number} options.maxRequestsPerMinute - Rate limit (default: 100)
   * @param {boolean} options.enableCors - Enable CORS (default: true)
   * @param {string} options.apiKey - API key for authentication (optional)
   * @param {boolean} options.requireAuth - Require authentication (default: false)
   * @param {string} options.logFormat - Morgan log format (default: 'combined')
   */
  constructor(options = {}) {
    super();
    
    this.node = options.node;
    this.port = options.port || 3000;
    this.httpsPort = options.httpsPort || 3001;
    this.enableHttps = options.enableHttps || false;
    this.sslCert = options.sslCert;
    this.sslKey = options.sslKey;
    this.enableRateLimit = options.enableRateLimit !== undefined ? options.enableRateLimit : true;
    this.maxRequestsPerMinute = options.maxRequestsPerMinute || 100;
    this.enableCors = options.enableCors !== undefined ? options.enableCors : true;
    this.apiKey = options.apiKey;
    this.requireAuth = options.requireAuth || false;
    this.logFormat = options.logFormat || 'combined';
    
    // Express app
    this.app = null;
    
    // HTTP and HTTPS servers
    this.httpServer = null;
    this.httpsServer = null;
    
    // Server state
    this.running = false;
    
    // Server statistics
    this.stats = {
      startTime: 0,
      requestCount: 0,
      errorCount: 0,
      lastRequest: null
    };
  }

  /**
   * Setup Express application
   * @private
   */
  setupApp() {
    this.app = express();
    
    // Basic middleware
    this.app.use(helmet()); // Security headers
    this.app.use(compression()); // Response compression
    this.app.use(bodyParser.json({ limit: '1mb' })); // Parse JSON bodies
    this.app.use(bodyParser.urlencoded({ extended: true, limit: '1mb' }));
    
    // Setup CORS if enabled
    if (this.enableCors) {
      this.app.use(cors());
    }
    
    // Setup rate limiting if enabled
    if (this.enableRateLimit) {
      const limiter = rateLimit({
        windowMs: 60 * 1000, // 1 minute
        max: this.maxRequestsPerMinute,
        standardHeaders: true,
        legacyHeaders: false,
        handler: (req, res) => {
          res.status(429).json({
            error: 'Too many requests, please try again later',
            code: 429
          });
        }
      });
      
      // Apply rate limiter to all requests
      this.app.use(limiter);
    }
    
    // Setup logging
    this.app.use(morgan(this.logFormat));
    this.app.use(loggerMiddleware());
    
    // Setup authentication if required
    if (this.requireAuth) {
      this.app.use(authMiddleware({ apiKey: this.apiKey }));
    }
    
    // Track request statistics
    this.app.use((req, res, next) => {
      this.stats.requestCount++;
      this.stats.lastRequest = new Date();
      next();
    });
    
    // Setup routes
    this.setupRoutes();
    
    // Setup error handling (must be last)
    this.app.use(errorMiddleware());
  }

  /**
   * Setup API routes
   * @private
   */
  setupRoutes() {
    // API version and base path
    const API_VERSION = 'v1';
    const BASE_PATH = `/api/${API_VERSION}`;
    
    // Root route - API info
    this.app.get('/', (req, res) => {
      res.json({
        name: 'Kineta Blockchain API',
        version: API_VERSION,
        documentation: `${req.protocol}://${req.get('host')}/docs`,
        endpoints: `${req.protocol}://${req.get('host')}${BASE_PATH}`
      });
    });
    
    // Mount routes
    this.app.use(`${BASE_PATH}/blockchain`, blockchainRoutes(this.node));
    this.app.use(`${BASE_PATH}/transactions`, transactionRoutes(this.node));
    this.app.use(`${BASE_PATH}/addresses`, addressRoutes(this.node));
    this.app.use(`${BASE_PATH}/node`, nodeRoutes(this.node));
    this.app.use(`${BASE_PATH}/stats`, statsRoutes(this.node, this));
    
    // API Documentation
    this.app.use('/docs', swaggerRoutes());
    
    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        error: 'Endpoint not found',
        code: 404
      });
    });
  }

  /**
   * Start the API server
   * @returns {Promise} - Resolves when server is started
   */
  async start() {
    if (this.running) {
      return true;
    }
    
    try {
      // Setup Express app
      this.setupApp();
      
      // Create HTTP server
      this.httpServer = http.createServer(this.app);
      
      // Create HTTPS server if enabled
      if (this.enableHttps) {
        if (!this.sslCert || !this.sslKey) {
          throw new Error('SSL certificate and key are required for HTTPS');
        }
        
        const httpsOptions = {
          cert: fs.readFileSync(this.sslCert),
          key: fs.readFileSync(this.sslKey)
        };
        
        this.httpsServer = https.createServer(httpsOptions, this.app);
      }
      
      // Start HTTP server
      await new Promise((resolve, reject) => {
        this.httpServer.listen(this.port, (err) => {
          if (err) {
            reject(err);
          } else {
            console.log(`HTTP API server listening on port ${this.port}`);
            resolve();
          }
        });
      });
      
      // Start HTTPS server if enabled
      if (this.enableHttps && this.httpsServer) {
        await new Promise((resolve, reject) => {
          this.httpsServer.listen(this.httpsPort, (err) => {
            if (err) {
              reject(err);
            } else {
              console.log(`HTTPS API server listening on port ${this.httpsPort}`);
              resolve();
            }
          });
        });
      }
      
      this.running = true;
      this.stats.startTime = Date.now();
      
      this.emit('started', {
        httpPort: this.port,
        httpsPort: this.enableHttps ? this.httpsPort : null
      });
      
      return true;
    } catch (error) {
      console.error('Failed to start API server:', error.message);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Stop the API server
   * @returns {Promise} - Resolves when server is stopped
   */
  async stop() {
    if (!this.running) {
      return true;
    }
    
    try {
      // Stop HTTP server
      if (this.httpServer) {
        await new Promise((resolve) => {
          this.httpServer.close(() => {
            console.log('HTTP API server stopped');
            resolve();
          });
        });
      }
      
      // Stop HTTPS server
      if (this.httpsServer) {
        await new Promise((resolve) => {
          this.httpsServer.close(() => {
            console.log('HTTPS API server stopped');
            resolve();
          });
        });
      }
      
      this.running = false;
      
      this.emit('stopped');
      
      return true;
    } catch (error) {
      console.error('Error stopping API server:', error.message);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Restart the API server
   * @returns {Promise} - Resolves when server is restarted
   */
  async restart() {
    try {
      await this.stop();
      await this.start();
      
      this.emit('restarted');
      
      return true;
    } catch (error) {
      console.error('Error restarting API server:', error.message);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Get server statistics
   * @returns {object} - Server statistics
   */
  getStats() {
    return {
      running: this.running,
      uptime: this.stats.startTime ? (Date.now() - this.stats.startTime) / 1000 : 0,
      requestCount: this.stats.requestCount,
      errorCount: this.stats.errorCount,
      lastRequest: this.stats.lastRequest,
      httpPort: this.port,
      httpsPort: this.enableHttps ? this.httpsPort : null,
      requireAuth: this.requireAuth,
      enableRateLimit: this.enableRateLimit,
      maxRequestsPerMinute: this.maxRequestsPerMinute
    };
  }

  /**
   * Get Express app instance
   * @returns {object} - Express app
   */
  getApp() {
    return this.app;
  }
}

module.exports = APIServer;