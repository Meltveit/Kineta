/**
 * Node routes for Kineta API
 * 
 * Implements:
 * - Node status endpoints
 * - Node peers endpoints
 * - Node mining endpoints
 * - Node sync endpoints
 */

const express = require('express');
const { param, query, validationResult } = require('express-validator');

/**
 * Create node routes
 * @param {object} node - Node reference
 * @returns {Router} - Express router
 */
module.exports = function(node) {
  const router = express.Router();
  
  /**
   * GET /node/info
   * Get node information
   */
  router.get('/info', (req, res) => {
    try {
      if (!node) {
        return res.status(503).json({
          error: 'Node not available',
          code: 503
        });
      }
      
      const info = node.getNodeInfo();
      
      res.json({
        success: true,
        data: info
      });
    } catch (error) {
      console.error('Error getting node info:', error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * GET /node/peers
   * Get node peers
   */
  router.get('/peers', (req, res) => {
    try {
      if (!node || !node.p2pManager) {
        return res.status(503).json({
          error: 'P2P network not available',
          code: 503
        });
      }
      
      const peers = node.p2pManager.getAllPeers();
      
      res.json({
        success: true,
        data: {
          peers,
          count: peers.length
        }
      });
    } catch (error) {
      console.error('Error getting node peers:', error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * GET /node/mining
   * Get mining status
   */
  router.get('/mining', (req, res) => {
    try {
      if (!node) {
        return res.status(503).json({
          error: 'Node not available',
          code: 503
        });
      }
      
      const miningStatus = {
        enabled: node.enableMining,
        active: node.state.mining,
        address: node.minerAddress,
        hashrate: node.proofOfWork ? node.proofOfWork.getStats().hashRate : 0,
        lastBlockMined: null
      };
      
      // Get last mined block if available
      if (node.blockchain && node.minerAddress) {
        const latestBlock = node.blockchain.getLatestBlock();
        if (latestBlock && latestBlock.transactions && latestBlock.transactions.length > 0) {
          const coinbase = latestBlock.transactions[0];
          if (coinbase.toAddress === node.minerAddress) {
            miningStatus.lastBlockMined = {
              height: latestBlock.height,
              hash: latestBlock.hash,
              timestamp: latestBlock.timestamp,
              reward: coinbase.amount
            };
          }
        }
      }
      
      res.json({
        success: true,
        data: miningStatus
      });
    } catch (error) {
      console.error('Error getting mining status:', error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * POST /node/mining/start
   * Start mining
   */
  router.post('/mining/start', (req, res) => {
    try {
      if (!node) {
        return res.status(503).json({
          error: 'Node not available',
          code: 503
        });
      }
      
      if (!node.minerAddress) {
        return res.status(400).json({
          error: 'No miner address configured',
          code: 400
        });
      }
      
      // Already mining
      if (node.state.mining) {
        return res.status(400).json({
          error: 'Mining already active',
          code: 400
        });
      }
      
      // Start mining
      node.startMining();
      
      res.json({
        success: true,
        data: {
          mining: true,
          address: node.minerAddress
        }
      });
    } catch (error) {
      console.error('Error starting mining:', error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * POST /node/mining/stop
   * Stop mining
   */
  router.post('/mining/stop', (req, res) => {
    try {
      if (!node) {
        return res.status(503).json({
          error: 'Node not available',
          code: 503
        });
      }
      
      // Not mining
      if (!node.state.mining) {
        return res.status(400).json({
          error: 'Mining not active',
          code: 400
        });
      }
      
      // Stop mining
      node.stopMining();
      
      res.json({
        success: true,
        data: {
          mining: false
        }
      });
    } catch (error) {
      console.error('Error stopping mining:', error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * GET /node/sync
   * Get sync status
   */
  router.get('/sync', (req, res) => {
    try {
      if (!node || !node.sync) {
        return res.status(503).json({
          error: 'Sync manager not available',
          code: 503
        });
      }
      
      const syncStatus = node.sync.getStatus();
      
      res.json({
        success: true,
        data: syncStatus
      });
    } catch (error) {
      console.error('Error getting sync status:', error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * POST /node/sync/start
   * Start sync process
   */
  router.post('/sync/start', (req, res) => {
    try {
      if (!node || !node.sync) {
        return res.status(503).json({
          error: 'Sync manager not available',
          code: 503
        });
      }
      
      // Already syncing
      if (node.state.syncing) {
        return res.status(400).json({
          error: 'Sync already in progress',
          code: 400
        });
      }
      
      // Start sync
      node.sync.start();
      
      res.json({
        success: true,
        data: {
          syncing: true
        }
      });
    } catch (error) {
      console.error('Error starting sync:', error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * POST /node/sync/stop
   * Stop sync process
   */
  router.post('/sync/stop', (req, res) => {
    try {
      if (!node || !node.sync) {
        return res.status(503).json({
          error: 'Sync manager not available',
          code: 503
        });
      }
      
      // Not syncing
      if (!node.state.syncing) {
        return res.status(400).json({
          error: 'Sync not in progress',
          code: 400
        });
      }
      
      // Stop sync
      node.sync.stop();
      
      res.json({
        success: true,
        data: {
          syncing: false
        }
      });
    } catch (error) {
      console.error('Error stopping sync:', error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * POST /node/peer/connect
   * Connect to a peer
   */
  router.post('/peer/connect', [
    query('address').isString().notEmpty().withMessage('Peer address is required')
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
      if (!node || !node.p2pManager) {
        return res.status(503).json({
          error: 'P2P network not available',
          code: 503
        });
      }
      
      const address = req.query.address;
      
      // Check if already connected
      if (node.p2pManager.getPeer(address)) {
        return res.status(400).json({
          error: 'Already connected to this peer',
          code: 400
        });
      }
      
      // Connect to peer
      const connected = await node.p2pManager.connectToPeer(address);
      
      if (!connected) {
        return res.status(400).json({
          error: 'Failed to connect to peer',
          code: 400
        });
      }
      
      res.json({
        success: true,
        data: {
          address,
          connected: true
        }
      });
    } catch (error) {
      console.error(`Error connecting to peer ${req.query.address}:`, error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * POST /node/peer/disconnect
   * Disconnect from a peer
   */
  router.post('/peer/disconnect', [
    query('address').isString().notEmpty().withMessage('Peer address is required')
  ], (req, res) => {
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
      if (!node || !node.p2pManager) {
        return res.status(503).json({
          error: 'P2P network not available',
          code: 503
        });
      }
      
      const address = req.query.address;
      const peer = node.p2pManager.getPeer(address);
      
      // Check if connected
      if (!peer) {
        return res.status(400).json({
          error: 'Not connected to this peer',
          code: 400
        });
      }
      
      // Disconnect from peer
      peer.socket.close();
      
      res.json({
        success: true,
        data: {
          address,
          disconnected: true
        }
      });
    } catch (error) {
      console.error(`Error disconnecting from peer ${req.query.address}:`, error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * GET /node/banned
   * Get banned peers
   */
  router.get('/banned', (req, res) => {
    try {
      if (!node || !node.p2pManager) {
        return res.status(503).json({
          error: 'P2P network not available',
          code: 503
        });
      }
      
      const bannedPeers = node.p2pManager.getBannedPeers();
      
      res.json({
        success: true,
        data: {
          peers: bannedPeers,
          count: bannedPeers.length
        }
      });
    } catch (error) {
      console.error('Error getting banned peers:', error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * POST /node/ban
   * Ban a peer
   */
  router.post('/ban', [
    query('address').isString().notEmpty().withMessage('Peer address is required'),
    query('reason').isString().optional().withMessage('Reason must be a string')
  ], (req, res) => {
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
      if (!node || !node.p2pManager) {
        return res.status(503).json({
          error: 'P2P network not available',
          code: 503
        });
      }
      
      const address = req.query.address;
      const reason = req.query.reason || 'Manually banned via API';
      
      // Ban peer
      node.p2pManager.banAddress(address, reason);
      
      res.json({
        success: true,
        data: {
          address,
          reason,
          banned: true
        }
      });
    } catch (error) {
      console.error(`Error banning peer ${req.query.address}:`, error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * POST /node/unban
   * Unban a peer
   */
  router.post('/unban', [
    query('address').isString().notEmpty().withMessage('Peer address is required')
  ], (req, res) => {
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
      if (!node || !node.p2pManager) {
        return res.status(503).json({
          error: 'P2P network not available',
          code: 503
        });
      }
      
      const address = req.query.address;
      
      // Check if banned
      if (!node.p2pManager.isAddressBanned(address)) {
        return res.status(400).json({
          error: 'Peer is not banned',
          code: 400
        });
      }
      
      // Remove from banned peers
      node.p2pManager.bannedPeers.delete(address);
      
      res.json({
        success: true,
        data: {
          address,
          unbanned: true
        }
      });
    } catch (error) {
      console.error(`Error unbanning peer ${req.query.address}:`, error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  return router;
};