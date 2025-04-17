/**
 * Transaction routes for Kineta API
 * 
 * Implements:
 * - Transaction retrieval endpoints
 * - Transaction submission
 * - Mempool endpoints
 * - Transaction fee calculation
 */

const express = require('express');
const { body, param, query, validationResult } = require('express-validator');

/**
 * Create transaction routes
 * @param {object} node - Node reference
 * @returns {Router} - Express router
 */
module.exports = function(node) {
  const router = express.Router();
  
  /**
   * GET /transactions/:hash
   * Get transaction by hash
   */
  router.get('/:hash', [
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
      const transaction = await node.blockchain.getTransactionByHash(hash);
      
      if (!transaction) {
        return res.status(404).json({
          error: 'Transaction not found',
          code: 404
        });
      }
      
      res.json({
        success: true,
        data: transaction
      });
    } catch (error) {
      console.error(`Error getting transaction with hash ${req.params.hash}:`, error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * POST /transactions
   * Submit a new transaction
   */
  router.post('/', [
    body('fromAddress').isString().notEmpty().withMessage('From address is required'),
    body('toAddress').isString().notEmpty().withMessage('To address is required'),
    body('amount').isFloat({ min: 0.00000001 }).withMessage('Amount must be a positive number'),
    body('fee').optional().isFloat({ min: 0 }).withMessage('Fee must be a non-negative number'),
    body('signature').optional().isString().withMessage('Signature must be a string'),
    body('timestamp').optional().isInt().withMessage('Timestamp must be an integer')
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
      if (!node || !node.blockchain || !node.mempool) {
        return res.status(503).json({
          error: 'Blockchain not available',
          code: 503
        });
      }
      
      const { fromAddress, toAddress, amount, signature } = req.body;
      const fee = req.body.fee || null; // Allow fee to be calculated automatically
      const timestamp = req.body.timestamp || Date.now();
      
      // Create transaction
      const Transaction = require('../../core/transaction'); // Import transaction class
      const tx = new Transaction(fromAddress, toAddress, amount, timestamp, fee);
      
      // Apply signature if provided
      if (signature) {
        tx.signature = signature;
      }
      
      // Validate transaction
      if (!tx.isValid()) {
        return res.status(400).json({
          error: 'Invalid transaction',
          code: 400
        });
      }
      
      // Check if sender has enough balance
      const balance = node.blockchain.getBalanceOfAddress(fromAddress);
      if (balance < tx.amount + tx.fee) {
        return res.status(400).json({
          error: 'Insufficient balance',
          code: 400,
          data: {
            address: fromAddress,
            balance,
            required: tx.amount + tx.fee
          }
        });
      }
      
      // Submit to node
      const success = node.submitTransaction(tx);
      
      if (!success) {
        return res.status(400).json({
          error: 'Transaction rejected',
          code: 400
        });
      }
      
      res.status(201).json({
        success: true,
        data: {
          transaction: tx,
          hash: tx.hash
        }
      });
    } catch (error) {
      console.error('Error submitting transaction:', error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * GET /transactions/mempool
   * Get transactions in mempool
   */
  router.get('/mempool', [
    query('limit').optional().isInt({ min: 1, max: 1000 }).withMessage('Limit must be between 1 and 1000')
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
      if (!node || !node.mempool) {
        return res.status(503).json({
          error: 'Mempool not available',
          code: 503
        });
      }
      
      const limit = parseInt(req.query.limit || '100');
      const transactions = node.mempool.getAllTransactions().slice(0, limit);
      
      res.json({
        success: true,
        data: {
          transactions,
          count: transactions.length,
          total: node.mempool.getAllTransactions().length
        }
      });
    } catch (error) {
      console.error('Error getting mempool transactions:', error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * GET /transactions/mempool/stats
   * Get mempool statistics
   */
  router.get('/mempool/stats', async (req, res) => {
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
   * GET /transactions/fee
   * Calculate transaction fee
   */
  router.get('/fee', [
    query('amount').isFloat({ min: 0 }).withMessage('Amount must be a non-negative number'),
    query('priority').optional().isInt({ min: 0, max: 2 }).withMessage('Priority must be between 0 and 2')
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
      if (!node || !node.economicModel || !node.economicModel.feeManager) {
        return res.status(503).json({
          error: 'Fee calculation not available',
          code: 503
        });
      }
      
      const amount = parseFloat(req.query.amount);
      const priority = parseInt(req.query.priority || '0');
      
      // Create a mock transaction to calculate fee
      const mockTx = {
        fromAddress: 'mock',
        toAddress: 'mock',
        amount,
        timestamp: Date.now()
      };
      
      // Calculate fee estimates for different priorities
      const fees = node.economicModel.estimateFees(amount);
      
      res.json({
        success: true,
        data: {
          amount,
          fees,
          recommendedFee: fees[priority === 0 ? 'low' : (priority === 1 ? 'medium' : 'high')]
        }
      });
    } catch (error) {
      console.error('Error calculating transaction fee:', error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * GET /transactions/pending/:address
   * Get pending transactions for address
   */
  router.get('/pending/:address', [
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
      if (!node || !node.mempool) {
        return res.status(503).json({
          error: 'Mempool not available',
          code: 503
        });
      }
      
      const address = req.params.address;
      const transactions = node.mempool.getAllTransactions().filter(tx => 
        tx.fromAddress === address || tx.toAddress === address
      );
      
      res.json({
        success: true,
        data: {
          transactions,
          count: transactions.length
        }
      });
    } catch (error) {
      console.error(`Error getting pending transactions for address ${req.params.address}:`, error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  /**
   * POST /transactions/create
   * Create a transaction (but don't submit it)
   */
  router.post('/create', [
    body('fromAddress').isString().notEmpty().withMessage('From address is required'),
    body('toAddress').isString().notEmpty().withMessage('To address is required'),
    body('amount').isFloat({ min: 0.00000001 }).withMessage('Amount must be a positive number'),
    body('priority').optional().isInt({ min: 0, max: 2 }).withMessage('Priority must be between 0 and 2')
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
      if (!node || !node.blockchain || !node.economicModel) {
        return res.status(503).json({
          error: 'Blockchain not available',
          code: 503
        });
      }
      
      const { fromAddress, toAddress, amount } = req.body;
      const priority = parseInt(req.body.priority || '0');
      const timestamp = Date.now();
      
      // Calculate appropriate fee
      const fees = node.economicModel.estimateFees(amount);
      const fee = fees[priority === 0 ? 'low' : (priority === 1 ? 'medium' : 'high')];
      
      // Create transaction
      const Transaction = require('../../core/transaction'); // Import transaction class
      const tx = new Transaction(fromAddress, toAddress, amount, timestamp, fee);
      
      // Check balance
      const balance = node.blockchain.getBalanceOfAddress(fromAddress);
      const hasSufficientBalance = balance >= tx.amount + tx.fee;
      
      res.json({
        success: true,
        data: {
          transaction: tx,
          hash: tx.hash,
          fee,
          timestamp,
          hasSufficientBalance,
          balance,
          required: tx.amount + tx.fee,
          // Return unsigned transaction ready for client to sign
          unsignedTransaction: {
            fromAddress,
            toAddress,
            amount,
            fee,
            timestamp,
            hash: tx.hash
          }
        }
      });
    } catch (error) {
      console.error('Error creating transaction:', error.message);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message,
        code: 500
      });
    }
  });

  return router;
};