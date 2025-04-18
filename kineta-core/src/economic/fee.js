/**
 * Fee.js - Transaction fee management for Kineta blockchain
 * 
 * Implements:
 * - Transaction fee calculation
 * - Developer fee extraction (0.02%)
 * - Dynamic fee adjustment
 * - Fee distribution
 * - Fee statistics and monitoring
 */

const EventEmitter = require('events');
const { ECONOMIC_CONSTANTS } = require('./economic-parameters');

// Developer address for fee collection
const DEFAULT_DEVELOPER_ADDRESS = '04d46b3d51c20deb1d5dd3b6ea5cb4c474cede8600e423437b023f8ea7846547eca4a92a0c660caaac7c9b74c863c5c38686e83cf9e0152e36dd032b795df92f4a';

/**
 * Fee manager for Kineta blockchain
 */
class FeeManager extends EventEmitter {
  /**
   * Initialize fee manager
   * @param {object} options - Configuration options
   * @param {string} options.developerAddress - Developer address for fees
   * @param {number} options.developerFeeRate - Developer fee rate (default: 0.0002)
   * @param {number} options.minimumFee - Minimum transaction fee (default: 0.0001)
   * @param {number} options.baseFeeRate - Base fee rate per byte (default: 0.002)
   * @param {number} options.adjustmentInterval - Fee adjustment interval in blocks
   * @param {object} options.blockchain - Blockchain reference (optional)
   */
  constructor(options = {}) {
    super();
    
    this.developerAddress = options.developerAddress || DEFAULT_DEVELOPER_ADDRESS;
    this.developerFeeRate = options.developerFeeRate !== undefined ? options.developerFeeRate : ECONOMIC_CONSTANTS.FEES.DEVELOPER_FEE_RATE;
    this.minimumFee = options.minimumFee !== undefined ? options.minimumFee : ECONOMIC_CONSTANTS.FEES.MIN_TX_FEE;
    this.baseFeeRate = options.baseFeeRate !== undefined ? options.baseFeeRate : ECONOMIC_CONSTANTS.FEES.BASE_TX_FEE_RATE;
    this.adjustmentInterval = options.adjustmentInterval || 10000; // Fee adjustment interval
    this.blockchain = options.blockchain || null;
    
    // Working state
    this.lastAdjustmentHeight = 0;
    this.feeMultiplier = 1.0; // Dynamic fee multiplier
    this.feeHistory = [];
    this.collectedDeveloperFees = 0;
    
    // Setup initial fee rates
    this.regularTxFeeRate = 0.002; // 0.2% for regular transactions
    this.dataTxFeeRate = 0.003; // 0.3% for data-heavy transactions
    this.priorityFeeRate = 0.004; // 0.4% for priority transactions
  }

  /**
   * Calculate transaction fee
   * @param {object} transaction - Transaction object
   * @param {number} [priority=0] - Priority level (0-2)
   * @returns {number} - Calculated fee
   */
  calculateFee(transaction, priority = 0) {
    // Estimate transaction size in bytes
    const txSize = this.estimateTransactionSize(transaction);
    
    // Base fee based on size
    let baseFee = txSize * this.baseFeeRate * this.feeMultiplier;
    
    // Add percentage-based fee based on transaction amount
    let percentFee;
    switch(priority) {
      case 2: // High priority
        percentFee = transaction.amount * 0.004; // 0.4%
        break;
      case 1: // Medium priority
        percentFee = transaction.amount * 0.003; // 0.3%
        break;
      default: // Regular priority
        percentFee = transaction.amount * 0.002; // 0.2%
    }
    
    // Combine fees
    let totalFee = baseFee + percentFee;
    
    // Ensure minimum fee
    totalFee = Math.max(totalFee, this.minimumFee);
    
    return totalFee;
  }

  /**
   * Calculate developer fee
   * @param {object} transaction - Transaction object
   * @returns {number} - Developer fee amount
   */
  calculateDeveloperFee(transaction) {
    // No developer fee on coinbase transactions
    if (!transaction.fromAddress) {
      return 0;
    }
    
    return transaction.amount * this.developerFeeRate;
  }

  /**
   * Extract developer fee from a transaction
   * @param {object} transaction - Transaction object
   * @returns {object|null} - Developer fee transaction or null
   */
  extractDeveloperFee(transaction) {
    // Calculate developer fee
    const feeAmount = this.calculateDeveloperFee(transaction);
    
    // If fee is too small, don't create a transaction
    if (feeAmount < this.minimumFee / 10) {
      return null;
    }
    
    // Create developer fee transaction (actual implementation would create a real transaction)
    const devFeeTransaction = {
      fromAddress: transaction.fromAddress,
      toAddress: this.developerAddress,
      amount: feeAmount,
      timestamp: transaction.timestamp,
      fee: 0, // No fee on developer fee transaction
      type: 'developer_fee'
    };
    
    // Update collected fees
    this.collectedDeveloperFees += feeAmount;
    
    this.emit('developerFeeExtracted', {
      originalTx: transaction.hash,
      feeAmount,
      devFeeTx: devFeeTransaction
    });
    
    return devFeeTransaction;
  }

  /**
   * Estimate transaction size in bytes
   * @param {object} transaction - Transaction object
   * @returns {number} - Estimated size in bytes
   * @private
   */
  estimateTransactionSize(transaction) {
    // Basic transaction structure
    let size = 150; // Base size with simple fields
    
    // Add size for addresses
    if (transaction.fromAddress) {
      size += transaction.fromAddress.length * 0.5; // Addresses are hex strings
    }
    size += transaction.toAddress.length * 0.5;
    
    // Add size for signature
    if (transaction.signature) {
      size += 72; // ECDSA signature size
    }
    
    // Add size for extra data if present
    if (transaction.data) {
      size += transaction.data.length;
    }
    
    return Math.ceil(size);
  }

  /**
   * Adjust fee rates based on network conditions
   * @param {number} blockHeight - Current block height
   * @param {object} mempool - Mempool reference
   */
  adjustFeeRates(blockHeight, mempool) {
    // Only adjust fees at predetermined intervals
    if (blockHeight < this.lastAdjustmentHeight + this.adjustmentInterval) {
      return;
    }
    
    // Get mempool stats
    const mempoolSize = mempool ? mempool.getAllTransactions().length : 0;
    const mempoolSizeBytes = mempool ? mempool.currentSizeBytes : 0;
    
    // Target mempool size
    const targetSize = 5000; // transactions
    const targetSizeBytes = 5 * 1024 * 1024; // 5 MB
    
    // Calculate new multiplier based on mempool pressure
    let newMultiplier = this.feeMultiplier;
    
    if (mempoolSize > targetSize * 2 || mempoolSizeBytes > targetSizeBytes * 2) {
      // Mempool is very full, increase fees significantly
      newMultiplier *= 1.5;
    } else if (mempoolSize > targetSize || mempoolSizeBytes > targetSizeBytes) {
      // Mempool is full, increase fees moderately
      newMultiplier *= 1.2;
    } else if (mempoolSize < targetSize / 2 && mempoolSizeBytes < targetSizeBytes / 2) {
      // Mempool is very empty, decrease fees
      newMultiplier *= 0.8;
    } else if (mempoolSize < targetSize && mempoolSizeBytes < targetSizeBytes) {
      // Mempool is below target, decrease fees slightly
      newMultiplier *= 0.95;
    }
    
    // Limit multiplier range
    newMultiplier = Math.max(0.5, Math.min(10.0, newMultiplier));
    
    // Update if changed significantly
    if (Math.abs(newMultiplier - this.feeMultiplier) > 0.05) {
      const oldMultiplier = this.feeMultiplier;
      this.feeMultiplier = newMultiplier;
      
      this.lastAdjustmentHeight = blockHeight;
      
      // Record fee adjustment
      this.recordFeeAdjustment(blockHeight, oldMultiplier, newMultiplier, mempoolSize);
      
      this.emit('feeRatesAdjusted', {
        blockHeight,
        oldMultiplier,
        newMultiplier,
        mempoolSize,
        mempoolSizeBytes
      });
    }
  }

  /**
   * Record fee adjustment in history
   * @param {number} blockHeight - Block height
   * @param {number} oldMultiplier - Previous fee multiplier
   * @param {number} newMultiplier - New fee multiplier
   * @param {number} mempoolSize - Current mempool size
   * @private
   */
  recordFeeAdjustment(blockHeight, oldMultiplier, newMultiplier, mempoolSize) {
    this.feeHistory.push({
      blockHeight,
      timestamp: Date.now(),
      oldMultiplier,
      newMultiplier,
      percentChange: ((newMultiplier / oldMultiplier) - 1) * 100,
      mempoolSize
    });
    
    // Keep history manageable
    if (this.feeHistory.length > 50) {
      this.feeHistory.shift();
    }
  }

  /**
   * Process transaction fees for a block
   * @param {object} block - Block containing transactions
   * @param {string} minerAddress - Miner's address
   * @returns {object} - Fee distribution summary
   */
  processBlockFees(block, minerAddress) {
    let totalFees = 0;
    let developerFees = 0;
    
    // Sum up all fees in the block
    for (const tx of block.transactions) {
      // Skip coinbase transactions
      if (!tx.fromAddress) continue;
      
      totalFees += tx.fee || 0;
      
      // Check for developer fee transactions
      if (tx.toAddress === this.developerAddress && tx.type === 'developer_fee') {
        developerFees += tx.amount;
      }
    }
    
    // Miner gets all regular fees
    const minerFees = totalFees;
    
    // Create summary
    const feeSummary = {
      blockHeight: block.height,
      timestamp: Date.now(),
      totalFees,
      minerFees,
      developerFees,
      distribution: [
        {
          recipient: minerAddress,
          amount: minerFees,
          type: 'mining_fee'
        }
      ]
    };
    
    this.emit('blockFeesProcessed', feeSummary);
    
    return feeSummary;
  }

  /**
   * Estimate fee for priority levels
   * @param {number} txAmount - Transaction amount
   * @param {number} dataSize - Additional data size in bytes (default: 0)
   * @returns {object} - Fee estimates for different priority levels
   */
  estimateFees(txAmount, dataSize = 0) {
    // Create a mock transaction for estimation
    const mockTx = {
      amount: txAmount,
      fromAddress: 'mockAddress',
      toAddress: 'mockRecipient',
      data: dataSize > 0 ? Buffer.alloc(dataSize).fill('x') : undefined
    };
    
    return {
      low: this.calculateFee(mockTx, 0),
      medium: this.calculateFee(mockTx, 1),
      high: this.calculateFee(mockTx, 2)
    };
  }

  /**
   * Check if a transaction fee is sufficient
   * @param {object} transaction - Transaction to check
   * @returns {boolean} - Whether fee is sufficient
   */
  isFeeAcceptable(transaction) {
    // Calculate minimum acceptable fee
    const minAcceptableFee = this.calculateFee(transaction, 0);
    
    return transaction.fee >= minAcceptableFee;
  }

  /**
   * Suggest fee adjustment for rejected transaction
   * @param {object} transaction - Rejected transaction
   * @returns {object} - Fee suggestion
   */
  suggestFeeAdjustment(transaction) {
    const minFee = this.calculateFee(transaction, 0);
    const recommendedFee = this.calculateFee(transaction, 1);
    const priorityFee = this.calculateFee(transaction, 2);
    
    return {
      currentFee: transaction.fee || 0,
      minimumRequired: minFee,
      recommended: recommendedFee,
      priority: priorityFee,
      insufficientBy: transaction.fee < minFee ? minFee - transaction.fee : 0
    };
  }

  /**
   * Get total developer fees collected
   * @returns {number} - Total developer fees
   */
  getTotalDeveloperFees() {
    return this.collectedDeveloperFees;
  }

  /**
   * Get fee statistics
   * @returns {object} - Fee statistics
   */
  getFeeStats() {
    return {
      currentMultiplier: this.feeMultiplier,
      lastAdjustmentHeight: this.lastAdjustmentHeight,
      developerFeeRate: this.developerFeeRate,
      minimumFee: this.minimumFee,
      baseFeeRate: this.baseFeeRate,
      regularTxFeeRate: this.regularTxFeeRate,
      priorityFeeRate: this.priorityFeeRate,
      collectedDeveloperFees: this.collectedDeveloperFees,
      feeHistory: this.feeHistory
    };
  }

  /**
   * Serialize fee manager state
   * @returns {object} - Serialized state
   */
  serialize() {
    return {
      developerAddress: this.developerAddress,
      developerFeeRate: this.developerFeeRate,
      minimumFee: this.minimumFee,
      baseFeeRate: this.baseFeeRate,
      adjustmentInterval: this.adjustmentInterval,
      lastAdjustmentHeight: this.lastAdjustmentHeight,
      feeMultiplier: this.feeMultiplier,
      regularTxFeeRate: this.regularTxFeeRate,
      dataTxFeeRate: this.dataTxFeeRate,
      priorityFeeRate: this.priorityFeeRate,
      feeHistory: this.feeHistory,
      collectedDeveloperFees: this.collectedDeveloperFees
    };
  }

  /**
   * Create fee manager from serialized state
   * @param {object} data - Serialized fee manager
   * @param {object} blockchain - Blockchain reference
   * @returns {FeeManager} - Reconstructed fee manager
   */
  static deserialize(data, blockchain = null) {
    const manager = new FeeManager({
      developerAddress: data.developerAddress,
      developerFeeRate: data.developerFeeRate,
      minimumFee: data.minimumFee,
      baseFeeRate: data.baseFeeRate,
      adjustmentInterval: data.adjustmentInterval,
      blockchain
    });
    
    manager.lastAdjustmentHeight = data.lastAdjustmentHeight;
    manager.feeMultiplier = data.feeMultiplier;
    manager.regularTxFeeRate = data.regularTxFeeRate;
    manager.dataTxFeeRate = data.dataTxFeeRate;
    manager.priorityFeeRate = data.priorityFeeRate;
    manager.feeHistory = data.feeHistory;
    manager.collectedDeveloperFees = data.collectedDeveloperFees;
    
    return manager;
  }
}

module.exports = FeeManager;