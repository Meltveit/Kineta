/**
 * Stats routes for Kineta API
 * 
 * Implements:
 * - Network statistics endpoints
 * - Performance metrics
 * - Historical data
 */

const express = require('express');
const os = require('os');

/**
 * Create stats routes
 * @param {object} node - Node reference
 * @param {object} apiServer - API server reference
 * @returns {Router} - Express router
 */
module.exports = function(node, apiServer) {
  const router = express.Router();
  
  /**
   * GET /stats/network
   * Get network statistics
   */
  router.get('/network', (req, res) => {
    try {
      if (!node || !node.p2pManager) {
        return res.status(503).json({
          error: 'P2P network not available',
          code: 503
        });
      }
      
      const stats = node.p2pManager.getNetworkStats();
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('Error getting network stats:', error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * GET /stats/blockchain
   * Get blockchain statistics
   */
  router.get('/blockchain', async (req, res) => {
    try {
      if (!node || !node.blockchain) {
        return res.status(503).json({
          error: 'Blockchain not available',
          code: 503
        });
      }
      
      const latestBlock = node.blockchain.getLatestBlock();
      let averageBlockTime = 0;
      let blockTimesCount = 0;
      let transactionsCount = 0;
      
      // Calculate average block time from last 10 blocks
      if (latestBlock.height > 0) {
        const blocks = [];
        for (let i = 0; i < 10 && latestBlock.height - i >= 0; i++) {
          const block = await node.blockchain.getBlockByHeight(latestBlock.height - i);
          if (block) {
            blocks.push(block);
          }
        }
        
        // Calculate times between blocks
        let totalTime = 0;
        for (let i = 0; i < blocks.length - 1; i++) {
          const timeDiff = (blocks[i].timestamp - blocks[i + 1].timestamp) / 1000;
          if (timeDiff > 0) {
            totalTime += timeDiff;
            blockTimesCount++;
          }
        }
        
        if (blockTimesCount > 0) {
          averageBlockTime = totalTime / blockTimesCount;
        }
        
        // Count transactions
        for (const block of blocks) {
          if (block.transactions) {
            transactionsCount += block.transactions.length;
          }
        }
      }
      
      // Get difficulty
      let difficulty = null;
      if (node.difficultyAdjuster) {
        difficulty = node.difficultyAdjuster.currentDifficulty;
      }
      
      // Calculate transactions per second
      const tps = averageBlockTime > 0 
        ? transactionsCount / (blockTimesCount * averageBlockTime) 
        : 0;
      
      // Get chain size if available
      let chainSize = null;
      if (node.blockchain.chainStore) {
        const stats = await node.blockchain.chainStore.getStats();
        chainSize = stats.storageSize;
      }
      
      const stats = {
        height: latestBlock.height,
        lastBlockHash: latestBlock.hash,
        lastBlockTime: latestBlock.timestamp,
        averageBlockTime,
        difficulty,
        hashrate: node.proofOfWork ? node.proofOfWork.getStats().hashRate : null,
        transactionsCount,
        tps,
        chainSize,
        circulatingSupply: node.blockchain.calculateCirculatingSupply(),
        inflation: node.economicModel ? node.economicModel.getCurrentInflationRate() : null,
        gdpGrowth: node.economicModel ? node.economicModel.getCurrentGDPGrowth() : null
      };
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('Error getting blockchain stats:', error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * GET /stats/mempool
   * Get mempool statistics
   */
  router.get('/mempool', (req, res) => {
    try {
      if (!node || !node.mempool) {
        return res.status(503).json({
          error: 'Mempool not available',
          code: 503
        });
      }
      
      const stats = node.mempool.getStats();
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('Error getting mempool stats:', error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * GET /stats/system
   * Get system statistics
   */
  router.get('/system', (req, res) => {
    try {
      const stats = {
        hostname: os.hostname(),
        platform: process.platform,
        arch: process.arch,
        cpus: os.cpus().length,
        cpuModel: os.cpus()[0].model,
        loadAvg: os.loadavg(),
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
        usedMemory: process.memoryUsage(),
        uptime: os.uptime(),
        nodeUptime: process.uptime(),
        nodeVersion: process.version
      };
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('Error getting system stats:', error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * GET /stats/api
   * Get API server statistics
   */
  router.get('/api', (req, res) => {
    try {
      if (!apiServer) {
        return res.status(503).json({
          error: 'API server stats not available',
          code: 503
        });
      }
      
      const stats = apiServer.getStats();
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('Error getting API stats:', error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * GET /stats/economic
   * Get economic statistics
   */
  router.get('/economic', (req, res) => {
    try {
      if (!node || !node.economicModel) {
        return res.status(503).json({
          error: 'Economic model not available',
          code: 503
        });
      }
      
      // Get current inflation and GDP growth
      const inflationRate = node.economicModel.getCurrentInflationRate();
      const gdpGrowth = node.economicModel.getCurrentGDPGrowth();
      
      // Get current supply
      const currentSupply = node.blockchain.calculateCirculatingSupply();
      
      // Get inflation forecast
      const forecast = node.economicModel.generateInflationForecast(currentSupply, 5);
      
      // Get current block reward
      const blockReward = node.economicModel.calculateBlockReward(
        node.blockchain.getLatestBlock().height,
        currentSupply
      );
      
      const stats = {
        inflationRate,
        gdpGrowth,
        currentSupply,
        forecast,
        blockReward,
        feeStats: node.economicModel.feeManager.getFeeStats(),
        developerFees: node.economicModel.feeManager.getTotalDeveloperFees()
      };
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('Error getting economic stats:', error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * GET /stats/mining
   * Get mining statistics
   */
  router.get('/mining', (req, res) => {
    try {
      if (!node || !node.proofOfWork) {
        return res.status(503).json({
          error: 'Mining stats not available',
          code: 503
        });
      }
      
      const stats = node.proofOfWork.getStats();
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('Error getting mining stats:', error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * GET /stats/all
   * Get comprehensive statistics
   */
  router.get('/all', async (req, res) => {
    try {
      if (!node) {
        return res.status(503).json({
          error: 'Node not available',
          code: 503
        });
      }
      
      // Collect all stats
      const stats = {
        node: node.getNodeInfo(),
        api: apiServer ? apiServer.getStats() : null,
        system: {
          hostname: os.hostname(),
          platform: process.platform,
          arch: process.arch,
          cpus: os.cpus().length,
          totalMemory: os.totalmem(),
          freeMemory: os.freemem(),
          uptime: os.uptime()
        }
      };
      
      // Add network stats if available
      if (node.p2pManager) {
        stats.network = node.p2pManager.getNetworkStats();
      }
      
      // Add blockchain stats if available
      if (node.blockchain) {
        const latestBlock = node.blockchain.getLatestBlock();
        stats.blockchain = {
          height: latestBlock.height,
          lastBlockHash: latestBlock.hash,
          lastBlockTime: latestBlock.timestamp,
          circulatingSupply: node.blockchain.calculateCirculatingSupply()
        };
      }
      
      // Add mempool stats if available
      if (node.mempool) {
        stats.mempool = node.mempool.getStats();
      }
      
      // Add economic stats if available
      if (node.economicModel) {
        stats.economic = {
          inflationRate: node.economicModel.getCurrentInflationRate(),
          gdpGrowth: node.economicModel.getCurrentGDPGrowth()
        };
      }
      
      // Add mining stats if available
      if (node.proofOfWork) {
        stats.mining = {
          active: node.state.mining,
          hashrate: node.proofOfWork.getStats().hashRate
        };
      }
      
      // Add sync stats if available
      if (node.sync) {
        stats.sync = node.sync.getStatus();
      }
      
      res.json({
        success: true,
        data: stats,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('Error getting all stats:', error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  return router;
};