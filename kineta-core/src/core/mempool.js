/**
 * Mempool.js - Transaction memory pool for Kineta blockchain
 * 
 * Manages:
 * - Pending transaction storage and retrieval
 * - Transaction validation before adding to mempool
 * - Transaction prioritization for block inclusion
 * - Mempool size limits and transaction eviction policies
 */

const EventEmitter = require('events');

class Mempool extends EventEmitter {
  /**
   * Initialize a new mempool
   * @param {object} options - Configuration options
   * @param {number} options.maxSize - Maximum number of transactions in mempool
   * @param {number} options.maxSizeMB - Maximum size of mempool in MB
   * @param {number} options.minFeeRate - Minimum fee rate for acceptance
   */
  constructor(options = {}) {
    super();
    this.transactions = new Map(); // Hash -> Transaction
    this.maxSize = options.maxSize || 5000; // Default max 5000 transactions
    this.maxSizeMB = options.maxSizeMB || 300; // Default max 300MB
    this.minFeeRate = options.minFeeRate || 0.00001; // KIN per byte
    this.currentSizeBytes = 0;
  }

  /**
   * Add a transaction to the mempool
   * @param {Transaction} transaction - Transaction to add
   * @param {boolean} rejectIfFull - Whether to reject if mempool is full
   * @returns {boolean} - Whether the transaction was added
   * @throws {Error} - If transaction is invalid or mempool is full
   */
  addTransaction(transaction, rejectIfFull = true) {
    // Validate transaction
    if (!transaction.isValid()) {
      throw new Error('Cannot add invalid transaction to mempool');
    }
    
    // Check if transaction already exists
    if (this.transactions.has(transaction.hash)) {
      throw new Error('Transaction already in mempool');
    }
    
    // Estimate transaction size in bytes (rough approximation)
    const txSize = this.estimateTransactionSize(transaction);
    
    // Check fee rate
    const feeRate = transaction.fee / txSize;
    if (feeRate < this.minFeeRate) {
      throw new Error(`Transaction fee rate too low: ${feeRate} < ${this.minFeeRate}`);
    }
    
    // Check if mempool is full
    if (this.transactions.size >= this.maxSize || 
        this.currentSizeBytes + txSize > this.maxSizeMB * 1024 * 1024) {
      
      if (rejectIfFull) {
        throw new Error('Mempool is full');
      }
      
      // Try to evict lower fee transactions
      const evicted = this.evictLowFeeTransactions(txSize, feeRate);
      if (!evicted) {
        throw new Error('Cannot add transaction: mempool full and fee too low to evict others');
      }
    }
    
    // Add to mempool
    this.transactions.set(transaction.hash, {
      transaction,
      receivedAt: Date.now(),
      sizeBytes: txSize,
      feeRate
    });
    
    this.currentSizeBytes += txSize;
    
    this.emit('transactionAdded', transaction);
    
    return true;
  }

  /**
   * Estimate transaction size in bytes
   * @param {Transaction} transaction - Transaction to estimate
   * @returns {number} - Estimated size in bytes
   */
  estimateTransactionSize(transaction) {
    // Simple approximation: 
    // Base size + from address + to address + signature
    let size = 100; // Base transaction structure
    
    if (transaction.fromAddress) {
      size += transaction.fromAddress.length * 0.5; // Addresses are hex
    }
    
    size += transaction.toAddress.length * 0.5;
    
    if (transaction.signature) {
      size += 72; // Typical ECDSA signature size
    }
    
    return Math.ceil(size);
  }

  /**
   * Evict low fee transactions to make room for new one
   * @param {number} requiredBytes - Size of new transaction
   * @param {number} newFeeRate - Fee rate of new transaction
   * @returns {boolean} - Whether eviction was successful
   */
  evictLowFeeTransactions(requiredBytes, newFeeRate) {
    // Get all transactions sorted by fee rate (lowest first)
    const txEntries = Array.from(this.transactions.entries())
      .map(([hash, data]) => ({ hash, ...data }))
      .sort((a, b) => a.feeRate - b.feeRate);
    
    // Calculate total bytes we need to free up
    let bytesToFree = requiredBytes - (this.maxSizeMB * 1024 * 1024 - this.currentSizeBytes);
    bytesToFree = Math.max(0, bytesToFree);
    
    // Track evicted bytes
    let evictedBytes = 0;
    
    // Try to evict transactions with lower fee rates
    for (const tx of txEntries) {
      // Stop if we evicted enough AND the remaining transactions have higher fee rates
      if (evictedBytes >= bytesToFree && tx.feeRate >= newFeeRate) {
        break;
      }
      
      // Skip if this tx has higher fee rate than the new one
      if (tx.feeRate >= newFeeRate) {
        continue;
      }
      
      // Evict this transaction
      this.transactions.delete(tx.hash);
      evictedBytes += tx.sizeBytes;
      this.currentSizeBytes -= tx.sizeBytes;
      
      this.emit('transactionEvicted', tx.transaction);
    }
    
    return evictedBytes >= bytesToFree;
  }

  /**
   * Remove a transaction from the mempool
   * @param {string} txHash - Transaction hash
   * @returns {boolean} - Whether the transaction was removed
   */
  removeTransaction(txHash) {
    const txData = this.transactions.get(txHash);
    
    if (!txData) {
      return false;
    }
    
    this.transactions.delete(txHash);
    this.currentSizeBytes -= txData.sizeBytes;
    
    this.emit('transactionRemoved', txData.transaction);
    
    return true;
  }

  /**
   * Get a transaction from the mempool by hash
   * @param {string} txHash - Transaction hash
   * @returns {Transaction|null} - The transaction or null if not found
   */
  getTransaction(txHash) {
    const txData = this.transactions.get(txHash);
    return txData ? txData.transaction : null;
  }

  /**
   * Check if a transaction exists in the mempool
   * @param {string} txHash - Transaction hash
   * @returns {boolean} - Whether the transaction exists
   */
  hasTransaction(txHash) {
    return this.transactions.has(txHash);
  }

  /**
   * Get all transactions in the mempool
   * @returns {Transaction[]} - Array of transactions
   */
  getAllTransactions() {
    return Array.from(this.transactions.values()).map(data => data.transaction);
  }

  /**
   * Get the best transactions for including in a block
   * @param {number} maxBytes - Maximum block size in bytes
   * @param {number} maxCount - Maximum number of transactions
   * @returns {Transaction[]} - Prioritized transactions
   */
  getTransactionsForBlock(maxBytes = 1000000, maxCount = 1000) {
    // Sort transactions by fee rate (highest first)
    const sortedTxs = Array.from(this.transactions.values())
      .sort((a, b) => b.feeRate - a.feeRate);
    
    const selectedTxs = [];
    let totalBytes = 0;
    
    for (const txData of sortedTxs) {
      if (selectedTxs.length >= maxCount) {
        break;
      }
      
      if (totalBytes + txData.sizeBytes > maxBytes) {
        continue; // Skip this transaction, try next one
      }
      
      selectedTxs.push(txData.transaction);
      totalBytes += txData.sizeBytes;
    }
    
    return selectedTxs;
  }

  /**
   * Remove transactions that are already in the blockchain
   * @param {Blockchain} blockchain - The blockchain to check against
   * @returns {number} - Number of transactions removed
   */
  removeConfirmedTransactions(blockchain) {
    let removedCount = 0;
    
    for (const [hash, txData] of this.transactions.entries()) {
      const tx = txData.transaction;
      
      // Check if transaction is in blockchain
      const confirmedTx = blockchain.getTransactionByHash(tx.hash);
      
      if (confirmedTx) {
        this.transactions.delete(hash);
        this.currentSizeBytes -= txData.sizeBytes;
        removedCount++;
      }
    }
    
    if (removedCount > 0) {
      this.emit('transactionsBatchRemoved', removedCount);
    }
    
    return removedCount;
  }

  /**
   * Remove expired transactions from the mempool
   * @param {number} maxAgeSecs - Maximum age in seconds
   * @returns {number} - Number of transactions removed
   */
  removeExpiredTransactions(maxAgeSecs = 86400) { // Default 24 hours
    const now = Date.now();
    let removedCount = 0;
    
    for (const [hash, txData] of this.transactions.entries()) {
      const age = (now - txData.receivedAt) / 1000;
      
      if (age > maxAgeSecs) {
        this.transactions.delete(hash);
        this.currentSizeBytes -= txData.sizeBytes;
        removedCount++;
        
        this.emit('transactionExpired', txData.transaction);
      }
    }
    
    return removedCount;
  }

  /**
   * Get current mempool statistics
   * @returns {object} - Mempool statistics
   */
  getStats() {
    // Calculate fee rate percentiles
    const feeRates = Array.from(this.transactions.values())
      .map(txData => txData.feeRate)
      .sort((a, b) => a - b);
    
    const count = feeRates.length;
    
    // No transactions
    if (count === 0) {
      return {
        count: 0,
        sizeBytes: 0,
        sizeMB: 0,
        minFeeRate: 0,
        maxFeeRate: 0,
        medianFeeRate: 0,
        p25FeeRate: 0,
        p75FeeRate: 0,
      };
    }
    
    return {
      count,
      sizeBytes: this.currentSizeBytes,
      sizeMB: this.currentSizeBytes / (1024 * 1024),
      minFeeRate: feeRates[0],
      maxFeeRate: feeRates[count - 1],
      medianFeeRate: count % 2 === 0 
        ? (feeRates[count / 2 - 1] + feeRates[count / 2]) / 2 
        : feeRates[Math.floor(count / 2)],
      p25FeeRate: feeRates[Math.floor(count * 0.25)],
      p75FeeRate: feeRates[Math.floor(count * 0.75)],
    };
  }

  /**
   * Clear all transactions from the mempool
   */
  clear() {
    this.transactions.clear();
    this.currentSizeBytes = 0;
    this.emit('mempoolCleared');
  }
}

module.exports = Mempool;