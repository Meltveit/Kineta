/**
 * Address routes for Kineta API
 * 
 * Implements:
 * - Address balance endpoints
 * - Address transaction endpoints
 * - Address validation
 * - UTXO retrieval
 */

const express = require('express');
const { param, query, validationResult } = require('express-validator');

/**
 * Create address routes
 * @param {object} node - Node reference
 * @returns {Router} - Express router
 */
module.exports = function(node) {
  const router = express.Router();
  
  /**
   * GET /addresses/:address/balance
   * Get address balance
   */
  router.get('/:address/balance', [
    param('address').isString().notEmpty().withMessage('Address is required')
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
      
      const address = req.params.address;
      
      // Validate address format
      if (!isValidAddress(address)) {
        return res.status(400).json({
          error: 'Invalid address format',
          code: 400
        });
      }
      
      const balance = node.blockchain.getBalanceOfAddress(address);
      
      res.json({
        success: true,
        data: {
          address,
          balance
        }
      });
    } catch (error) {
      console.error(`Error getting balance for address ${req.params.address}:`, error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * GET /addresses/:address/transactions
   * Get address transactions
   */
  router.get('/:address/transactions', [
    param('address').isString().notEmpty().withMessage('Address is required'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be a non-negative integer'),
    query('sort').optional().isIn(['asc', 'desc']).withMessage('Sort must be asc or desc')
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
      if (!node || !node.blockchain || !node.blockchain.chainStore) {
        return res.status(503).json({
          error: 'Blockchain storage not available',
          code: 503
        });
      }
      
      const address = req.params.address;
      
      // Validate address format
      if (!isValidAddress(address)) {
        return res.status(400).json({
          error: 'Invalid address format',
          code: 400
        });
      }
      
      // Pagination parameters
      const limit = parseInt(req.query.limit || '20');
      const offset = parseInt(req.query.offset || '0');
      const sort = req.query.sort || 'desc';
      
      // Get transactions for address
      const transactions = await node.blockchain.chainStore.getAddressTransactions(
        address,
        {
          limit,
          offset,
          reverse: sort === 'desc'
        }
      );
      
      res.json({
        success: true,
        data: {
          address,
          transactions,
          count: transactions.length,
          limit,
          offset
        }
      });
    } catch (error) {
      console.error(`Error getting transactions for address ${req.params.address}:`, error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * GET /addresses/:address/utxos
   * Get UTXOs for address
   */
  router.get('/:address/utxos', [
    param('address').isString().notEmpty().withMessage('Address is required')
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
      if (!node || !node.blockchain || !node.blockchain.chainStore) {
        return res.status(503).json({
          error: 'Blockchain storage not available',
          code: 503
        });
      }
      
      const address = req.params.address;
      
      // Validate address format
      if (!isValidAddress(address)) {
        return res.status(400).json({
          error: 'Invalid address format',
          code: 400
        });
      }
      
      // Get UTXOs for address
      const utxos = await node.blockchain.chainStore.getUTXOs(address);
      
      // Calculate total amount
      const totalAmount = utxos.reduce((sum, utxo) => sum + utxo.amount, 0);
      
      res.json({
        success: true,
        data: {
          address,
          utxos,
          count: utxos.length,
          totalAmount
        }
      });
    } catch (error) {
      console.error(`Error getting UTXOs for address ${req.params.address}:`, error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * GET /addresses/:address/validate
   * Validate address format
   */
  router.get('/:address/validate', [
    param('address').isString().notEmpty().withMessage('Address is required')
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
      const address = req.params.address;
      const isValid = isValidAddress(address);
      
      res.json({
        success: true,
        data: {
          address,
          isValid
        }
      });
    } catch (error) {
      console.error(`Error validating address ${req.params.address}:`, error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * GET /addresses/:address/stats
   * Get comprehensive address statistics
   */
  router.get('/:address/stats', [
    param('address').isString().notEmpty().withMessage('Address is required')
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
      if (!node || !node.blockchain || !node.blockchain.chainStore) {
        return res.status(503).json({
          error: 'Blockchain storage not available',
          code: 503
        });
      }
      
      const address = req.params.address;
      
      // Validate address format
      if (!isValidAddress(address)) {
        return res.status(400).json({
          error: 'Invalid address format',
          code: 400
        });
      }
      
      // Get balance
      const balance = node.blockchain.getBalanceOfAddress(address);
      
      // Get transaction count (limit to 0 to just get count)
      const transactions = await node.blockchain.chainStore.getAddressTransactions(
        address,
        {
          limit: 0
        }
      );
      
      // Get UTXOs
      const utxos = await node.blockchain.chainStore.getUTXOs(address);
      
      // Get pending transactions
      const pendingTxs = node.mempool 
        ? node.mempool.getAllTransactions().filter(tx => 
            tx.fromAddress === address || tx.toAddress === address
          )
        : [];
      
      // Calculate pending balance changes
      let pendingInflow = 0;
      let pendingOutflow = 0;
      
      for (const tx of pendingTxs) {
        if (tx.toAddress === address) {
          pendingInflow += tx.amount;
        }
        if (tx.fromAddress === address) {
          pendingOutflow += tx.amount + tx.fee;
        }
      }
      
      res.json({
        success: true,
        data: {
          address,
          balance,
          transactionCount: transactions.length,
          utxoCount: utxos.length,
          pendingTransactions: pendingTxs.length,
          pendingInflow,
          pendingOutflow,
          projectedBalance: balance + pendingInflow - pendingOutflow
        }
      });
    } catch (error) {
      console.error(`Error getting stats for address ${req.params.address}:`, error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * Get multiple address balances
   * GET /addresses/balances
   */
  router.get('/balances', [
    query('addresses').isString().notEmpty().withMessage('Addresses parameter is required')
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
      
      // Parse comma-separated addresses
      const addressList = req.query.addresses.split(',').map(addr => addr.trim());
      
      // Limit to 20 addresses per request
      if (addressList.length > 20) {
        return res.status(400).json({
          error: 'Too many addresses (maximum 20)',
          code: 400
        });
      }
      
      // Get balances for all addresses
      const balances = {};
      let totalBalance = 0;
      
      for (const address of addressList) {
        if (isValidAddress(address)) {
          const balance = node.blockchain.getBalanceOfAddress(address);
          balances[address] = balance;
          totalBalance += balance;
        } else {
          balances[address] = null; // Invalid address
        }
      }
      
      res.json({
        success: true,
        data: {
          balances,
          totalBalance,
          count: addressList.length
        }
      });
    } catch (error) {
      console.error('Error getting multiple address balances:', error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  return router;
};

/**
 * Validate Kineta address format
 * @param {string} address - Address to validate
 * @returns {boolean} - Whether address is valid
 */
function isValidAddress(address) {
  // This is a simplified validation
  // In a real implementation, we would use the Wallet.validateAddress method
  
  // Basic format check: 26-35 characters, alphanumeric
  return /^[a-zA-Z0-9]{26,35}$/.test(address);
}