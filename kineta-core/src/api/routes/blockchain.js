/**
 * Blockchain routes for Kineta API
 * 
 * Implements:
 * - Block retrieval endpoints
 * - Chain information endpoints
 * - Chain status endpoints
 * - Chain validation endpoints
 */

const express = require('express');
const { param, query, validationResult } = require('express-validator');

/**
 * Create blockchain routes
 * @param {object} node - Node reference
 * @returns {Router} - Express router
 */
module.exports = function(node) {
  const router = express.Router();
  
  /**
   * GET /blockchain/info
   * Get blockchain information
   */
  router.get('/info', (req, res) => {
    try {
      if (!node || !node.blockchain) {
        return res.status(503).json({
          error: 'Blockchain not available',
          code: 503
        });
      }
      
      const info = node.getBlockchainInfo();
      
      res.json({
        success: true,
        data: info
      });
    } catch (error) {
      console.error('Error getting blockchain info:', error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * GET /blockchain/height
   * Get current blockchain height
   */
  router.get('/height', (req, res) => {
    try {
      if (!node || !node.blockchain) {
        return res.status(503).json({
          error: 'Blockchain not available',
          code: 503
        });
      }
      
      const height = node.blockchain.getLatestBlock().height;
      
      res.json({
        success: true,
        data: {
          height
        }
      });
    } catch (error) {
      console.error('Error getting blockchain height:', error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * GET /blockchain/blocks/:height
   * Get block by height
   */
  router.get('/blocks/:height', [
    param('height').isInt({ min: 0 }).withMessage('Height must be a non-negative integer')
  ], async (req, res) => {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation error',
        details: errors.array(),
        code: 400
      });
    }
    
    try {
      if (!node || !node.blockchain) {
        return res.status(503).json({
          error: 'Blockchain not available',
          code: 503
        });
      }
      
      const height = parseInt(req.params.height);
      const block = await node.blockchain.getBlockByHeight(height);
      
      if (!block) {
        return res.status(404).json({
          error: 'Block not found',
          code: 404
        });
      }
      
      res.json({
        success: true,
        data: block
      });
    } catch (error) {
      console.error(`Error getting block at height ${req.params.height}:`, error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * GET /blockchain/blocks/hash/:hash
   * Get block by hash
   */
  router.get('/blocks/hash/:hash', [
    param('hash').isString().isLength({ min: 64, max: 64 }).withMessage('Hash must be a 64-character string')
  ], async (req, res) => {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation error',
        details: errors.array(),
        code: 400
      });
    }
    
    try {
      if (!node || !node.blockchain) {
        return res.status(503).json({
          error: 'Blockchain not available',
          code: 503
        });
      }
      
      const hash = req.params.hash;
      const block = await node.blockchain.getBlockByHash(hash);
      
      if (!block) {
        return res.status(404).json({
          error: 'Block not found',
          code: 404
        });
      }
      
      res.json({
        success: true,
        data: block
      });
    } catch (error) {
      console.error(`Error getting block with hash ${req.params.hash}:`, error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * GET /blockchain/blocks/latest
   * Get latest block
   */
  router.get('/blocks/latest', async (req, res) => {
    try {
      if (!node || !node.blockchain) {
        return res.status(503).json({
          error: 'Blockchain not available',
          code: 503
        });
      }
      
      const block = node.blockchain.getLatestBlock();
      
      res.json({
        success: true,
        data: block
      });
    } catch (error) {
      console.error('Error getting latest block:', error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * GET /blockchain/blocks
   * Get multiple blocks (pagination)
   */
  router.get('/blocks', [
    query('start').optional().isInt({ min: 0 }).withMessage('Start must be a non-negative integer'),
    query('end').optional().isInt({ min: 0 }).withMessage('End must be a non-negative integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
  ], async (req, res) => {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation error',
        details: errors.array(),
        code: 400
      });
    }
    
    try {
      if (!node || !node.blockchain) {
        return res.status(503).json({
          error: 'Blockchain not available',
          code: 503
        });
      }
      
      const limit = parseInt(req.query.limit || '10');
      let start, end;
      
      const latestHeight = node.blockchain.getLatestBlock().height;
      
      if (req.query.start !== undefined && req.query.end !== undefined) {
        // Both start and end provided
        start = parseInt(req.query.start);
        end = parseInt(req.query.end);
        
        // Validate range
        if (start > end) {
          return res.status(400).json({
            error: 'Start height must be less than or equal to end height',
            code: 400
          });
        }
        
        // Limit range to prevent excessive requests
        if (end - start + 1 > limit) {
          end = start + limit - 1;
        }
      } else {
        // Default to latest blocks
        end = latestHeight;
        start = Math.max(0, end - limit + 1);
      }
      
      // Get blocks in range
      const blocks = [];
      for (let height = start; height <= end; height++) {
        const block = await node.blockchain.getBlockByHeight(height);
        if (block) {
          blocks.push(block);
        }
      }
      
      res.json({
        success: true,
        data: {
          blocks,
          count: blocks.length,
          start,
          end
        }
      });
    } catch (error) {
      console.error('Error getting blocks:', error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * GET /blockchain/validate
   * Validate blockchain
   */
  router.get('/validate', async (req, res) => {
    try {
      if (!node || !node.blockchain) {
        return res.status(503).json({
          error: 'Blockchain not available',
          code: 503
        });
      }
      
      const isValid = node.blockchain.isChainValid();
      
      res.json({
        success: true,
        data: {
          valid: isValid
        }
      });
    } catch (error) {
      console.error('Error validating blockchain:', error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * GET /blockchain/difficulty
   * Get current difficulty
   */
  router.get('/difficulty', (req, res) => {
    try {
      if (!node || !node.blockchain || !node.difficultyAdjuster) {
        return res.status(503).json({
          error: 'Blockchain not available',
          code: 503
        });
      }
      
      const difficulty = node.difficultyAdjuster.currentDifficulty;
      
      res.json({
        success: true,
        data: {
          difficulty,
          targetBlockTime: node.difficultyAdjuster.targetBlockTime,
          nextAdjustment: node.difficultyAdjuster.getNextAdjustmentHeight()
        }
      });
    } catch (error) {
      console.error('Error getting difficulty:', error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * GET /blockchain/economic
   * Get economic model information
   */
  router.get('/economic', (req, res) => {
    try {
      if (!node || !node.blockchain || !node.economicModel) {
        return res.status(503).json({
          error: 'Economic model not available',
          code: 503
        });
      }
      
      const economicInfo = node.getEconomicInfo();
      
      res.json({
        success: true,
        data: economicInfo
      });
    } catch (error) {
      console.error('Error getting economic info:', error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * GET /blockchain/supply
   * Get circulating supply information
   */
  router.get('/supply', (req, res) => {
    try {
      if (!node || !node.blockchain) {
        return res.status(503).json({
          error: 'Blockchain not available',
          code: 503
        });
      }
      
      const circulatingSupply = node.blockchain.calculateCirculatingSupply();
      
      // Get economic model data if available
      let inflationRate = null;
      let gdpGrowth = null;
      
      if (node.economicModel) {
        inflationRate = node.economicModel.getCurrentInflationRate();
        gdpGrowth = node.economicModel.getCurrentGDPGrowth();
      }
      
      res.json({
        success: true,
        data: {
          circulatingSupply,
          inflationRate,
          gdpGrowth,
          initialSupply: 123456789, // From project specs
          timestamp: Date.now()
        }
      });
    } catch (error) {
      console.error('Error getting supply info:', error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  return router;
};