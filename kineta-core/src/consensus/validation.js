/**
 * Validation.js - Block and transaction validation for Kineta blockchain
 * 
 * Implements:
 * - Block validation rules
 * - Transaction validation 
 * - Chain validation
 * - Consensus rule enforcement
 * - Double-spend detection
 */

const crypto = require('crypto');
const EventEmitter = require('events');
const Hash = require('./crypto/hash');

/**
 * Block and transaction validator for Kineta blockchain
 */
class Validator extends EventEmitter {
  /**
   * Initialize validator
   * @param {object} options - Configuration options
   * @param {object} options.blockchain - Reference to blockchain
   * @param {object} options.difficultyAdjuster - Reference to difficulty adjuster
   * @param {object} options.proofOfWork - Reference to proof of work
   * @param {number} options.maxBlockSize - Maximum block size in bytes
   * @param {number} options.maxTransactionsPerBlock - Maximum transactions per block
   */
  constructor(options = {}) {
    super();
    
    this.blockchain = options.blockchain;
    this.difficultyAdjuster = options.difficultyAdjuster;
    this.proofOfWork = options.proofOfWork;
    this.maxBlockSize = options.maxBlockSize || 1000000; // 1MB
    this.maxTransactionsPerBlock = options.maxTransactionsPerBlock || 5000;
    
    // Validation cache to avoid redundant validations
    this.validationCache = {
      blocks: new Map(), // Hash -> {valid, timestamp}
      transactions: new Map() // Hash -> {valid, timestamp}
    };
    
    // Cache cleanup interval
    this.cacheCleanupInterval = setInterval(() => this.cleanupCache(), 3600000); // Every hour
  }

  /**
   * Clean up validation cache
   * @private
   */
  cleanupCache() {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    
    // Clean block cache
    for (const [hash, data] of this.validationCache.blocks.entries()) {
      if (now - data.timestamp > maxAge) {
        this.validationCache.blocks.delete(hash);
      }
    }
    
    // Clean transaction cache
    for (const [hash, data] of this.validationCache.transactions.entries()) {
      if (now - data.timestamp > maxAge) {
        this.validationCache.transactions.delete(hash);
      }
    }
  }

  /**
   * Validate a block
   * @param {object} block - Block to validate
   * @param {boolean} fullValidation - Whether to perform full validation including transactions
   * @returns {object} - Validation result with {valid, reason}
   */
  validateBlock(block, fullValidation = true) {
    // Check cache first
    const cacheKey = block.hash + (fullValidation ? '_full' : '_header');
    if (this.validationCache.blocks.has(cacheKey)) {
      return this.validationCache.blocks.get(cacheKey).result;
    }
    
    const result = { valid: true, reason: '' };
    
    // Basic structure validation
    if (!this.validateBlockStructure(block)) {
      result.valid = false;
      result.reason = 'Invalid block structure';
      this.cacheResult('blocks', cacheKey, result);
      return result;
    }
    
    // Validate block header
    if (!this.validateBlockHeader(block)) {
      result.valid = false;
      result.reason = 'Invalid block header';
      this.cacheResult('blocks', cacheKey, result);
      return result;
    }
    
    // Validate proof of work
    if (!this.validateProofOfWork(block)) {
      result.valid = false;
      result.reason = 'Invalid proof of work';
      this.cacheResult('blocks', cacheKey, result);
      return result;
    }
    
    // Skip transaction validation if not doing full validation
    if (!fullValidation) {
      this.cacheResult('blocks', cacheKey, result);
      return result;
    }
    
    // Validate coinbase transaction
    if (!this.validateCoinbaseTransaction(block)) {
      result.valid = false;
      result.reason = 'Invalid coinbase transaction';
      this.cacheResult('blocks', cacheKey, result);
      return result;
    }
    
    // Validate all transactions
    const txResult = this.validateBlockTransactions(block);
    if (!txResult.valid) {
      result.valid = false;
      result.reason = txResult.reason;
      this.cacheResult('blocks', cacheKey, result);
      return result;
    }
    
    // If blockchain reference is available, validate block against chain
    if (this.blockchain) {
      const chainResult = this.validateBlockAgainstChain(block);
      if (!chainResult.valid) {
        result.valid = false;
        result.reason = chainResult.reason;
        this.cacheResult('blocks', cacheKey, result);
        return result;
      }
    }
    
    // Cache and return result
    this.cacheResult('blocks', cacheKey, result);
    return result;
  }

  /**
   * Cache validation result
   * @param {string} type - 'blocks' or 'transactions'
   * @param {string} key - Cache key
   * @param {object} result - Validation result
   * @private
   */
  cacheResult(type, key, result) {
    this.validationCache[type].set(key, {
      result,
      timestamp: Date.now()
    });
  }

  /**
   * Validate block structure
   * @param {object} block - Block to validate
   * @returns {boolean} - Whether the structure is valid
   * @private
   */
  validateBlockStructure(block) {
    // Check required fields
    if (!block || 
        typeof block.hash !== 'string' ||
        typeof block.previousHash !== 'string' ||
        typeof block.timestamp !== 'number' ||
        typeof block.height !== 'number' ||
        typeof block.difficulty !== 'number' ||
        typeof block.nonce !== 'number' ||
        !Array.isArray(block.transactions)) {
      return false;
    }
    
    // Check field formats
    if (block.hash.length !== 64 ||
        (block.previousHash.length !== 64 && block.previousHash !== '0') ||
        block.timestamp <= 0 ||
        block.height < 0 ||
        block.difficulty <= 0 ||
        block.nonce < 0) {
      return false;
    }
    
    // Block must have at least one transaction (coinbase)
    if (block.transactions.length === 0) {
      return false;
    }
    
    // Check block size constraints
    const blockSize = this.estimateBlockSize(block);
    if (blockSize > this.maxBlockSize) {
      return false;
    }
    
    // Check transaction count limit
    if (block.transactions.length > this.maxTransactionsPerBlock) {
      return false;
    }
    
    return true;
  }

  /**
   * Validate block header
   * @param {object} block - Block to validate
   * @returns {boolean} - Whether the header is valid
   * @private
   */
  validateBlockHeader(block) {
    // Check that hash is correct for block contents
    const calculatedHash = this.calculateBlockHash(block);
    if (calculatedHash !== block.hash) {
      return false;
    }
    
    // Check timestamp is reasonable
    const now = Date.now();
    const twoHoursAgo = now - (2 * 60 * 60 * 1000);
    const twoHoursFromNow = now + (2 * 60 * 60 * 1000);
    
    if (block.timestamp < twoHoursAgo || block.timestamp > twoHoursFromNow) {
      return false;
    }
    
    // Verify merkle root if present
    if (block.merkleRoot) {
      const calculatedMerkleRoot = this.calculateMerkleRoot(block.transactions);
      if (calculatedMerkleRoot !== block.merkleRoot) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Validate proof of work
   * @param {object} block - Block to validate
   * @returns {boolean} - Whether proof of work is valid
   * @private
   */
  validateProofOfWork(block) {
    // If proofOfWork module is available, use it
    if (this.proofOfWork) {
      return this.proofOfWork.verifyBlock(block);
    }
    
    // Otherwise, do basic validation
    const targetPrefix = '0'.repeat(block.difficulty);
    return block.hash.startsWith(targetPrefix);
  }

  /**
   * Validate coinbase transaction
   * @param {object} block - Block to validate
   * @returns {boolean} - Whether coinbase is valid
   * @private
   */
  validateCoinbaseTransaction(block) {
    // First transaction must be coinbase
    const coinbase = block.transactions[0];
    
    // Coinbase must not have a fromAddress
    if (coinbase.fromAddress) {
      return false;
    }
    
    // Coinbase must have a toAddress
    if (!coinbase.toAddress) {
      return false;
    }
    
    // Coinbase must have a non-negative amount
    if (typeof coinbase.amount !== 'number' || coinbase.amount < 0) {
      return false;
    }
    
    // If blockchain reference is available, validate reward amount
    if (this.blockchain && this.blockchain.economicModel) {
      const expectedReward = this.blockchain.economicModel.calculateBlockReward(
        block.height,
        this.blockchain.calculateCirculatingSupply()
      ).total;
      
      // Allow a small margin for error due to floating point precision
      const margin = 0.00001;
      if (Math.abs(coinbase.amount - expectedReward) > margin) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Validate all transactions in a block
   * @param {object} block - Block to validate
   * @returns {object} - Validation result with {valid, reason}
   * @private
   */
  validateBlockTransactions(block) {
    const result = { valid: true, reason: '' };
    
    // Skip first transaction as it's coinbase
    for (let i = 1; i < block.transactions.length; i++) {
      const tx = block.transactions[i];
      
      // Validate each transaction
      const txResult = this.validateTransaction(tx);
      if (!txResult.valid) {
        result.valid = false;
        result.reason = `Transaction ${i} is invalid: ${txResult.reason}`;
        return result;
      }
      
      // Check for duplicate transactions in the block
      for (let j = i + 1; j < block.transactions.length; j++) {
        if (tx.hash === block.transactions[j].hash) {
          result.valid = false;
          result.reason = `Duplicate transaction found: ${tx.hash}`;
          return result;
        }
      }
    }
    
    // Check for double spends within the block
    if (!this.checkForDoubleSpends(block.transactions.slice(1))) {
      result.valid = false;
      result.reason = 'Double spend detected in block';
      return result;
    }
    
    return result;
  }

  /**
   * Validate a transaction
   * @param {object} transaction - Transaction to validate
   * @returns {object} - Validation result with {valid, reason}
   */
  validateTransaction(transaction) {
    // Check cache first
    if (this.validationCache.transactions.has(transaction.hash)) {
      return this.validationCache.transactions.get(transaction.hash).result;
    }
    
    const result = { valid: true, reason: '' };
    
    // Validate transaction structure
    if (!this.validateTransactionStructure(transaction)) {
      result.valid = false;
      result.reason = 'Invalid transaction structure';
      this.cacheResult('transactions', transaction.hash, result);
      return result;
    }
    
    // Skip signature check for coinbase transactions
    if (!transaction.fromAddress) {
      this.cacheResult('transactions', transaction.hash, result);
      return result;
    }
    
    // Validate transaction hash
    const calculatedHash = this.calculateTransactionHash(transaction);
    if (calculatedHash !== transaction.hash) {
      result.valid = false;
      result.reason = 'Invalid transaction hash';
      this.cacheResult('transactions', transaction.hash, result);
      return result;
    }
    
    // Validate transaction signature
    if (!this.validateTransactionSignature(transaction)) {
      result.valid = false;
      result.reason = 'Invalid transaction signature';
      this.cacheResult('transactions', transaction.hash, result);
      return result;
    }
    
    // Validate transaction amount
    if (transaction.amount <= 0) {
      result.valid = false;
      result.reason = 'Transaction amount must be positive';
      this.cacheResult('transactions', transaction.hash, result);
      return result;
    }
    
    // Validate transaction fee
    if (transaction.fee < 0) {
      result.valid = false;
      result.reason = 'Transaction fee cannot be negative';
      this.cacheResult('transactions', transaction.hash, result);
      return result;
    }
    
    // If blockchain reference is available, check sender balance
    if (this.blockchain) {
      const senderBalance = this.blockchain.getBalanceOfAddress(transaction.fromAddress);
      if (senderBalance < transaction.amount + transaction.fee) {
        result.valid = false;
        result.reason = 'Insufficient balance';
        this.cacheResult('transactions', transaction.hash, result);
        return result;
      }
    }
    
    // Cache and return result
    this.cacheResult('transactions', transaction.hash, result);
    return result;
  }

  /**
   * Validate transaction structure
   * @param {object} transaction - Transaction to validate
   * @returns {boolean} - Whether the structure is valid
   * @private
   */
  validateTransactionStructure(transaction) {
    // Check required fields
    if (!transaction || 
        typeof transaction.hash !== 'string' ||
        typeof transaction.toAddress !== 'string' ||
        typeof transaction.amount !== 'number' ||
        typeof transaction.timestamp !== 'number') {
      return false;
    }
    
    // For non-coinbase transactions, check additional fields
    if (transaction.fromAddress) {
      if (typeof transaction.fromAddress !== 'string' ||
          typeof transaction.fee !== 'number') {
        return false;
      }
      
      // Regular transactions must have signatures
      if (!transaction.signature) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Validate transaction signature
   * @param {object} transaction - Transaction to validate
   * @returns {boolean} - Whether the signature is valid
   * @private
   */
  validateTransactionSignature(transaction) {
    // Coinbase transactions don't need signatures
    if (!transaction.fromAddress) {
      return true;
    }
    
    // All other transactions must have signatures
    if (!transaction.signature) {
      return false;
    }
    
    try {
      // If transaction has its own validation method, use it
      if (typeof transaction.isSignatureValid === 'function') {
        return transaction.isSignatureValid();
      }
      
      // Otherwise, perform basic signature validation
      // Note: This is a simplified version. In a real implementation,
      // you would use proper cryptographic signature verification.
      return true;
    } catch (error) {
      console.error('Error validating signature:', error.message);
      return false;
    }
  }

  /**
   * Validate block against the blockchain
   * @param {object} block - Block to validate
   * @returns {object} - Validation result with {valid, reason}
   * @private
   */
  validateBlockAgainstChain(block) {
    const result = { valid: true, reason: '' };
    
    // Check that the block height is correct
    const expectedHeight = this.blockchain.getLatestBlock().height + 1;
    if (block.height !== expectedHeight) {
      result.valid = false;
      result.reason = `Invalid block height: expected ${expectedHeight}, got ${block.height}`;
      return result;
    }
    
    // Check that previous hash refers to the current latest block
    const latestBlockHash = this.blockchain.getLatestBlock().hash;
    if (block.previousHash !== latestBlockHash) {
      result.valid = false;
      result.reason = `Invalid previous hash: expected ${latestBlockHash}, got ${block.previousHash}`;
      return result;
    }
    
    // Check difficulty is correct
    if (this.difficultyAdjuster) {
      const expectedDifficulty = this.difficultyAdjuster.currentDifficulty;
      if (block.difficulty !== expectedDifficulty) {
        result.valid = false;
        result.reason = `Invalid difficulty: expected ${expectedDifficulty}, got ${block.difficulty}`;
        return result;
      }
    }
    
    // Check for double spends against pending transactions
    const pendingTxs = this.blockchain.pendingTransactions || [];
    const blockTxs = block.transactions.slice(1); // Exclude coinbase
    
    for (const blockTx of blockTxs) {
      // Exclude developer fee transactions which might be duplicated
      if (blockTx.type === 'developer_fee') continue;
      
      for (const pendingTx of pendingTxs) {
        // If same hash, it's the same transaction (not a double spend)
        if (blockTx.hash === pendingTx.hash) continue;
        
        // Check for same inputs being spent
        if (blockTx.fromAddress && 
            blockTx.fromAddress === pendingTx.fromAddress &&
            pendingTx.type !== 'developer_fee') {
          
          // This is a potential double spend, further check required
          // For a simple UTXO or account model, this would need more specific checks
          
          // For now, we'll assume our model flags two transactions from the same
          // address in the pending pool and a block as suspicious
          result.valid = false;
          result.reason = `Potential double spend detected for address ${blockTx.fromAddress}`;
          return result;
        }
      }
    }
    
    return result;
  }

  /**
   * Check for double spends within a set of transactions
   * @param {Array} transactions - Transactions to check
   * @returns {boolean} - Whether there are no double spends
   * @private
   */
  checkForDoubleSpends(transactions) {
    const spentFromAddresses = new Set();
    
    for (const tx of transactions) {
      // Skip coinbase and developer fee transactions
      if (!tx.fromAddress || tx.type === 'developer_fee') {
        continue;
      }
      
      // In a simple account model, an address can only have one outgoing tx per block
      // This is an oversimplification - a real implementation would check individual UTXOs
      if (spentFromAddresses.has(tx.fromAddress)) {
        return false; // Double spend detected
      }
      
      spentFromAddresses.add(tx.fromAddress);
    }
    
    return true;
  }

  /**
   * Validate the entire blockchain
   * @returns {object} - Validation result with {valid, reason, invalidBlock}
   */
  validateChain() {
    const result = { valid: true, reason: '', invalidBlock: null };
    
    // Get the blockchain
    if (!this.blockchain || !this.blockchain.chain) {
      result.valid = false;
      result.reason = 'Blockchain not available';
      return result;
    }
    
    const chain = this.blockchain.chain;
    
    // Check each block
    for (let i = 0; i < chain.length; i++) {
      const block = chain[i];
      
      // Validate block structure and transactions
      const blockResult = this.validateBlock(block, true);
      if (!blockResult.valid) {
        result.valid = false;
        result.reason = `Block ${i} (height ${block.height}) is invalid: ${blockResult.reason}`;
        result.invalidBlock = block;
        return result;
      }
      
      // For all except genesis block, check link to previous block
      if (i > 0) {
        const prevBlock = chain[i - 1];
        
        // Check height continuity
        if (block.height !== prevBlock.height + 1) {
          result.valid = false;
          result.reason = `Block height discontinuity at index ${i}: ${prevBlock.height} -> ${block.height}`;
          result.invalidBlock = block;
          return result;
        }
        
        // Check hash linkage
        if (block.previousHash !== prevBlock.hash) {
          result.valid = false;
          result.reason = `Block hash linkage broken at index ${i}`;
          result.invalidBlock = block;
          return result;
        }
      }
    }
    
    // Check for double spends across the entire chain
    if (!this.checkChainForDoubleSpends(chain)) {
      result.valid = false;
      result.reason = 'Double spend detected in blockchain';
      return result;
    }
    
    return result;
  }

  /**
   * Check for double spends across the entire blockchain
   * @param {Array} chain - Blockchain
   * @returns {boolean} - Whether there are no double spends
   * @private
   */
  checkChainForDoubleSpends(chain) {
    // This is a simplified check that would need to be enhanced
    // based on the specific transaction model (UTXO vs account)
    
    // In a real implementation, this would check that no UTXO is spent twice
    // or that account balances are never negative throughout the chain
    
    // For now, just return true as a placeholder
    return true;
  }

  /**
   * Calculate block hash
   * @param {object} block - Block to hash
   * @returns {string} - Calculated hash
   * @private
   */
  calculateBlockHash(block) {
    // Create a clone without the hash field
    const blockData = { ...block, hash: undefined };
    const dataString = JSON.stringify(blockData);
    
    return Hash.sha256(dataString);
  }

  /**
   * Calculate transaction hash
   * @param {object} transaction - Transaction to hash
   * @returns {string} - Calculated hash
   * @private
   */
  calculateTransactionHash(transaction) {
    // Create a clone without the hash and signature fields
    const txData = { 
      ...transaction, 
      hash: undefined, 
      signature: undefined 
    };
    const dataString = JSON.stringify(txData);
    
    return Hash.sha256(dataString);
  }

  /**
   * Calculate merkle root from transactions
   * @param {Array} transactions - List of transactions
   * @returns {string} - Merkle root hash
   * @private
   */
  calculateMerkleRoot(transactions) {
    // Extract transaction hashes
    const txHashes = transactions.map(tx => tx.hash || this.calculateTransactionHash(tx));
    
    // Use the Hash utility to calculate merkle root
    return Hash.calculateMerkleRoot(txHashes);
  }

  /**
   * Estimate block size in bytes
   * @param {object} block - Block to measure
   * @returns {number} - Estimated size in bytes
   * @private
   */
  estimateBlockSize(block) {
    // Convert to JSON string and measure length
    const blockJson = JSON.stringify(block);
    
    // Each character in JSON is approximately 1 byte
    // This is an estimation and not exact byte count
    return blockJson.length;
  }

  /**
   * Clean up resources
   */
  cleanup() {
    clearInterval(this.cacheCleanupInterval);
    
    // Clear caches
    this.validationCache.blocks.clear();
    this.validationCache.transactions.clear();
  }
}

module.exports = Validator;