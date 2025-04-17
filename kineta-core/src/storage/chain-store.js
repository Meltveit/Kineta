/**
 * Chain-Store.js - Blockchain storage for Kineta
 * 
 * Implements:
 * - Block storage and retrieval
 * - Transaction indexing
 * - UTXO set management
 * - Chain state persistence
 * - Database interaction
 */

const EventEmitter = require('events');
const crypto = require('crypto');
const Database = require('./database');

// Key prefixes for database organization
const KEY_PREFIXES = {
  BLOCK_HEIGHT: 'block_height_', // block_height_123 -> block hash
  BLOCK_HASH: 'block_', // block_[hash] -> serialized block
  TX_HASH: 'tx_', // tx_[hash] -> transaction data with block reference
  ADDRESS_TX: 'addr_tx_', // addr_tx_[address]_[timestamp] -> tx hash
  UTXO: 'utxo_', // utxo_[address]_[txhash]_[output] -> amount
  CHAIN_INFO: 'chain_info', // Blockchain metadata
  STATE: 'state_', // Various state information
  INDEX: 'index_' // Secondary indices
};

/**
 * Blockchain storage manager
 */
class ChainStore extends EventEmitter {
  /**
   * Initialize blockchain storage
   * @param {object} options - Configuration options
   * @param {string} options.dataDir - Data directory path
   * @param {string} options.dbName - Database name
   * @param {boolean} options.createIfMissing - Create database if missing
   * @param {boolean} options.pruneOldBlocks - Whether to prune old blocks
   * @param {number} options.pruneDepth - How many blocks to keep (default: 1000)
   * @param {boolean} options.indexTransactions - Whether to index transactions
   * @param {boolean} options.indexAddresses - Whether to index addresses
   */
  constructor(options = {}) {
    super();
    
    this.dataDir = options.dataDir || './data';
    this.dbName = options.dbName || 'kineta-chain';
    this.createIfMissing = options.createIfMissing !== undefined ? options.createIfMissing : true;
    this.pruneOldBlocks = options.pruneOldBlocks || false;
    this.pruneDepth = options.pruneDepth || 1000;
    this.indexTransactions = options.indexTransactions !== undefined ? options.indexTransactions : true;
    this.indexAddresses = options.indexAddresses !== undefined ? options.indexAddresses : true;
    
    // Database instance
    this.db = new Database({
      dataDir: this.dataDir,
      name: this.dbName,
      createIfMissing: this.createIfMissing
    });
    
    // Cache for frequently accessed data
    this.cache = {
      latestBlockHeight: -1,
      latestBlockHash: null,
      blockCache: new Map(), // Height -> Block (LRU, max 100 blocks)
      txCache: new Map(), // Hash -> Transaction (LRU, max 1000 txs)
    };
    
    // Block cache max size
    this.blockCacheSize = 100;
    this.txCacheSize = 1000;
    
    // Storage statistics
    this.stats = {
      blocksStored: 0,
      transactionsStored: 0,
      addressesIndexed: 0,
      utxosTracked: 0,
      lastBlockTime: 0,
      storageSize: 0,
      startTime: Date.now()
    };
  }

  /**
   * Open the blockchain storage
   * @returns {Promise} - Resolves when storage is opened
   */
  async open() {
    try {
      await this.db.open();
      
      // Load chain info
      await this.loadChainInfo();
      
      this.emit('open');
      
      return true;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Close the blockchain storage
   * @returns {Promise} - Resolves when storage is closed
   */
  async close() {
    try {
      // Save latest state
      await this.saveChainInfo();
      
      // Close database
      await this.db.close();
      
      // Clear caches
      this.clearCaches();
      
      this.emit('close');
      
      return true;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Clear in-memory caches
   */
  clearCaches() {
    this.cache.blockCache.clear();
    this.cache.txCache.clear();
    this.cache.latestBlockHeight = -1;
    this.cache.latestBlockHash = null;
  }

  /**
   * Load chain information from database
   * @private
   */
  async loadChainInfo() {
    try {
      const chainInfo = await this.db.get(KEY_PREFIXES.CHAIN_INFO);
      
      if (chainInfo) {
        this.cache.latestBlockHeight = chainInfo.latestBlockHeight;
        this.cache.latestBlockHash = chainInfo.latestBlockHash;
        this.stats = { ...this.stats, ...chainInfo.stats };
      }
    } catch (error) {
      // Initialize with default values if no chain info found
      this.cache.latestBlockHeight = -1;
      this.cache.latestBlockHash = null;
    }
  }

  /**
   * Save chain information to database
   * @private
   */
  async saveChainInfo() {
    const chainInfo = {
      latestBlockHeight: this.cache.latestBlockHeight,
      latestBlockHash: this.cache.latestBlockHash,
      stats: this.stats
    };
    
    await this.db.put(KEY_PREFIXES.CHAIN_INFO, chainInfo);
  }

  /**
   * Store a block
   * @param {object} block - Block to store
   * @returns {Promise<boolean>} - Resolves with success status
   */
  async storeBlock(block) {
    try {
      // Validate block has required fields
      if (!block || !block.hash || !block.height) {
        throw new Error('Invalid block format');
      }
      
      // Convert block timestamp to number if needed
      if (block.timestamp && typeof block.timestamp === 'string') {
        block.timestamp = parseInt(block.timestamp);
      }
      
      // Prepare a batch of operations
      const batch = [];
      
      // Add block by height reference
      batch.push({
        type: 'put',
        key: KEY_PREFIXES.BLOCK_HEIGHT + block.height,
        value: block.hash
      });
      
      // Add block by hash
      batch.push({
        type: 'put',
        key: KEY_PREFIXES.BLOCK_HASH + block.hash,
        value: block
      });
      
      // Index transactions if enabled
      if (this.indexTransactions && block.transactions && block.transactions.length > 0) {
        for (const tx of block.transactions) {
          if (!tx.hash) {
            // Generate hash if missing
            tx.hash = this.generateTxHash(tx);
          }
          
          // Store transaction with block reference
          const txData = {
            ...tx,
            blockHeight: block.height,
            blockHash: block.hash,
            blockTime: block.timestamp
          };
          
          batch.push({
            type: 'put',
            key: KEY_PREFIXES.TX_HASH + tx.hash,
            value: txData
          });
          
          // Add to transaction count
          this.stats.transactionsStored++;
          
          // Index addresses if enabled
          if (this.indexAddresses) {
            // Index sender address
            if (tx.fromAddress) {
              const senderKey = KEY_PREFIXES.ADDRESS_TX + tx.fromAddress + '_' + 
                block.timestamp + '_' + tx.hash;
              
              batch.push({
                type: 'put',
                key: senderKey,
                value: { 
                  txHash: tx.hash, 
                  type: 'send', 
                  amount: -tx.amount,
                  fee: -tx.fee,
                  timestamp: block.timestamp,
                  blockHeight: block.height
                }
              });
              
              // Track address
              this.stats.addressesIndexed++;
            }
            
            // Index recipient address
            if (tx.toAddress) {
              const recipientKey = KEY_PREFIXES.ADDRESS_TX + tx.toAddress + '_' + 
                block.timestamp + '_' + tx.hash;
              
              batch.push({
                type: 'put',
                key: recipientKey,
                value: { 
                  txHash: tx.hash, 
                  type: 'receive', 
                  amount: tx.amount,
                  fee: 0,
                  timestamp: block.timestamp,
                  blockHeight: block.height
                }
              });
              
              // Track address
              this.stats.addressesIndexed++;
            }
            
            // Update UTXO set
            if (tx.fromAddress && tx.toAddress) {
              // Remove spent UTXO (simplified model - not actual UTXO)
              batch.push({
                type: 'del',
                key: KEY_PREFIXES.UTXO + tx.fromAddress + '_' + tx.hash + '_input'
              });
              
              // Add new UTXO
              batch.push({
                type: 'put',
                key: KEY_PREFIXES.UTXO + tx.toAddress + '_' + tx.hash + '_output',
                value: { 
                  amount: tx.amount, 
                  timestamp: block.timestamp,
                  blockHeight: block.height
                }
              });
              
              this.stats.utxosTracked++;
            }
          }
        }
      }
      
      // Execute batch operation
      await this.db.batch(batch);
      
      // Update cache
      this.addBlockToCache(block);
      
      // Update chain info
      if (block.height > this.cache.latestBlockHeight) {
        this.cache.latestBlockHeight = block.height;
        this.cache.latestBlockHash = block.hash;
        this.stats.lastBlockTime = block.timestamp;
      }
      
      // Increment block count
      this.stats.blocksStored++;
      
      // Update chain info in database occasionally (every 10 blocks)
      if (block.height % 10 === 0) {
        await this.saveChainInfo();
      }
      
      // Prune old blocks if enabled
      if (this.pruneOldBlocks && block.height > this.pruneDepth) {
        await this.pruneBlock(block.height - this.pruneDepth);
      }
      
      this.emit('blockStored', {
        height: block.height,
        hash: block.hash,
        transactions: block.transactions ? block.transactions.length : 0
      });
      
      return true;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Generate transaction hash
   * @param {object} tx - Transaction
   * @returns {string} - Transaction hash
   * @private
   */
  generateTxHash(tx) {
    const txData = {
      fromAddress: tx.fromAddress || '',
      toAddress: tx.toAddress,
      amount: tx.amount,
      fee: tx.fee,
      timestamp: tx.timestamp
    };
    
    return crypto.createHash('sha256')
      .update(JSON.stringify(txData))
      .digest('hex');
  }

  /**
   * Retrieve a block by height
   * @param {number} height - Block height
   * @returns {Promise<object|null>} - Resolves with block or null
   */
  async getBlockByHeight(height) {
    try {
      // Check cache first
      if (this.cache.blockCache.has(height)) {
        return this.cache.blockCache.get(height);
      }
      
      // Get block hash from height
      const hash = await this.db.get(KEY_PREFIXES.BLOCK_HEIGHT + height);
      
      if (!hash) {
        return null;
      }
      
      // Get block by hash
      const block = await this.db.get(KEY_PREFIXES.BLOCK_HASH + hash);
      
      if (block) {
        // Add to cache
        this.addBlockToCache(block);
      }
      
      return block;
    } catch (error) {
      // Block not found
      return null;
    }
  }

  /**
   * Retrieve a block by hash
   * @param {string} hash - Block hash
   * @returns {Promise<object|null>} - Resolves with block or null
   */
  async getBlockByHash(hash) {
    try {
      // Check if hash exists in cache
      for (const [height, block] of this.cache.blockCache.entries()) {
        if (block.hash === hash) {
          return block;
        }
      }
      
      // Get from database
      const block = await this.db.get(KEY_PREFIXES.BLOCK_HASH + hash);
      
      if (block) {
        // Add to cache
        this.addBlockToCache(block);
      }
      
      return block;
    } catch (error) {
      // Block not found
      return null;
    }
  }

  /**
   * Add block to cache
   * @param {object} block - Block to add to cache
   * @private
   */
  addBlockToCache(block) {
    // Add to cache
    this.cache.blockCache.set(block.height, block);
    
    // Limit cache size
    if (this.cache.blockCache.size > this.blockCacheSize) {
      // Remove oldest (lowest height) block
      const oldestHeight = Math.min(...this.cache.blockCache.keys());
      this.cache.blockCache.delete(oldestHeight);
    }
  }

  /**
   * Retrieve a transaction by hash
   * @param {string} hash - Transaction hash
   * @returns {Promise<object|null>} - Resolves with transaction or null
   */
  async getTransactionByHash(hash) {
    try {
      // Check cache first
      if (this.cache.txCache.has(hash)) {
        return this.cache.txCache.get(hash);
      }
      
      // Get from database
      const tx = await this.db.get(KEY_PREFIXES.TX_HASH + hash);
      
      if (tx) {
        // Add to cache
        this.addTxToCache(tx);
      }
      
      return tx;
    } catch (error) {
      // Transaction not found
      return null;
    }
  }

  /**
   * Add transaction to cache
   * @param {object} tx - Transaction to add to cache
   * @private
   */
  addTxToCache(tx) {
    // Add to cache
    this.cache.txCache.set(tx.hash, tx);
    
    // Limit cache size
    if (this.cache.txCache.size > this.txCacheSize) {
      // Remove oldest entry (simple LRU by deleting first entry)
      const firstKey = this.cache.txCache.keys().next().value;
      this.cache.txCache.delete(firstKey);
    }
  }

  /**
   * Get transactions for address
   * @param {string} address - Address to lookup
   * @param {object} options - Query options
   * @param {number} options.limit - Maximum number of transactions
   * @param {number} options.offset - Starting from position
   * @param {boolean} options.reverse - Reverse chronological order
   * @returns {Promise<Array>} - Resolves with array of transactions
   */
  async getAddressTransactions(address, options = {}) {
    try {
      if (!this.indexAddresses) {
        throw new Error('Address indexing is disabled');
      }
      
      const limit = options.limit || 100;
      const offset = options.offset || 0;
      const reverse = options.reverse !== false; // Default to true
      
      // Get keys with address prefix
      const prefix = KEY_PREFIXES.ADDRESS_TX + address + '_';
      
      const txKeys = await this.db.getByPrefix(prefix, {
        values: true,
        limit: limit + offset,
        reverse
      });
      
      // Apply offset
      const paginatedKeys = txKeys.slice(offset, offset + limit);
      
      // Get transactions
      const txs = [];
      
      for (const item of paginatedKeys) {
        const txInfo = item.value;
        
        if (txInfo && txInfo.txHash) {
          // Get full transaction
          const tx = await this.getTransactionByHash(txInfo.txHash);
          
          if (tx) {
            txs.push({
              ...tx,
              direction: txInfo.type,
              impact: txInfo.amount
            });
          }
        }
      }
      
      return txs;
    } catch (error) {
      this.emit('error', error);
      return [];
    }
  }

  /**
   * Get address balance
   * @param {string} address - Address to get balance for
   * @returns {Promise<object>} - Resolves with balance info
   */
  async getAddressBalance(address) {
    try {
      if (!this.indexAddresses) {
        throw new Error('Address indexing is disabled');
      }
      
      // Get all UTXOs for address
      const prefix = KEY_PREFIXES.UTXO + address + '_';
      
      const utxos = await this.db.getByPrefix(prefix, {
        values: true
      });
      
      let total = 0;
      let unconfirmedTotal = 0;
      
      // Current height for confirmation calculation
      const currentHeight = this.cache.latestBlockHeight;
      
      for (const utxo of utxos) {
        const utxoData = utxo.value;
        
        if (utxoData && utxoData.amount) {
          total += utxoData.amount;
          
          // Check if confirmed (6 blocks)
          if (currentHeight - utxoData.blockHeight < 6) {
            unconfirmedTotal += utxoData.amount;
          }
        }
      }
      
      return {
        address,
        balance: total,
        unconfirmed: unconfirmedTotal,
        confirmed: total - unconfirmedTotal,
        utxoCount: utxos.length
      };
    } catch (error) {
      this.emit('error', error);
      
      return {
        address,
        balance: 0,
        unconfirmed: 0,
        confirmed: 0,
        utxoCount: 0,
        error: error.message
      };
    }
  }

  /**
   * Get blocks in height range
   * @param {number} startHeight - Start height (inclusive)
   * @param {number} endHeight - End height (inclusive)
   * @returns {Promise<Array>} - Resolves with array of blocks
   */
  async getBlockRange(startHeight, endHeight) {
    try {
      const blocks = [];
      
      for (let height = startHeight; height <= endHeight; height++) {
        const block = await this.getBlockByHeight(height);
        
        if (block) {
          blocks.push(block);
        }
      }
      
      return blocks;
    } catch (error) {
      this.emit('error', error);
      return [];
    }
  }

  /**
   * Get latest blocks
   * @param {number} limit - Number of blocks to get
   * @returns {Promise<Array>} - Resolves with array of blocks
   */
  async getLatestBlocks(limit = 10) {
    try {
      const latestHeight = this.cache.latestBlockHeight;
      
      if (latestHeight < 0) {
        return [];
      }
      
      const startHeight = Math.max(0, latestHeight - limit + 1);
      
      return this.getBlockRange(startHeight, latestHeight);
    } catch (error) {
      this.emit('error', error);
      return [];
    }
  }

  /**
   * Prune a block and its transactions
   * @param {number} height - Block height to prune
   * @returns {Promise<boolean>} - Resolves with success status
   * @private
   */
  async pruneBlock(height) {
    try {
      // Only prune if pruning is enabled
      if (!this.pruneOldBlocks) {
        return false;
      }
      
      // Get block to prune
      const block = await this.getBlockByHeight(height);
      
      if (!block) {
        return false;
      }
      
      // Prepare batch operations
      const batch = [];
      
      // Don't delete block height reference
      // But do delete the full block data
      batch.push({
        type: 'del',
        key: KEY_PREFIXES.BLOCK_HASH + block.hash
      });
      
      // Delete transactions if indexed
      if (this.indexTransactions && block.transactions) {
        for (const tx of block.transactions) {
          // Keep transaction hash but remove full data
          batch.push({
            type: 'del',
            key: KEY_PREFIXES.TX_HASH + tx.hash
          });
          
          // Remove from cache
          this.cache.txCache.delete(tx.hash);
        }
      }
      
      // Execute batch
      await this.db.batch(batch);
      
      // Remove from cache
      this.cache.blockCache.delete(height);
      
      this.emit('blockPruned', {
        height,
        hash: block.hash
      });
      
      return true;
    } catch (error) {
      this.emit('error', error);
      return false;
    }
  }

  /**
   * Get chain height
   * @returns {number} - Chain height
   */
  getHeight() {
    return this.cache.latestBlockHeight;
  }

  /**
   * Get latest block hash
   * @returns {string|null} - Latest block hash
   */
  getLatestBlockHash() {
    return this.cache.latestBlockHash;
  }

  /**
   * Get storage statistics
   * @returns {Promise<object>} - Resolves with statistics
   */
  async getStats() {
    try {
      // Get database size
      const storageSize = await this.db.getSize();
      this.stats.storageSize = storageSize;
      
      return {
        ...this.stats,
        latestBlockHeight: this.cache.latestBlockHeight,
        latestBlockHash: this.cache.latestBlockHash,
        uptime: (Date.now() - this.stats.startTime) / 1000
      };
    } catch (error) {
      this.emit('error', error);
      return this.stats;
    }
  }

  /**
   * Reset the database (USE WITH CAUTION)
   * @returns {Promise<boolean>} - Resolves with success status
   */
  async reset() {
    try {
      // Close database
      await this.close();
      
      // Create new database
      this.db = new Database({
        dataDir: this.dataDir,
        name: this.dbName,
        createIfMissing: true,
        errorIfExists: true
      });
      
      // Open new database
      await this.open();
      
      // Reset stats
      this.stats = {
        blocksStored: 0,
        transactionsStored: 0,
        addressesIndexed: 0,
        utxosTracked: 0,
        lastBlockTime: 0,
        storageSize: 0,
        startTime: Date.now()
      };
      
      // Reset cache
      this.clearCaches();
      
      this.emit('reset');
      
      return true;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Create a backup of the blockchain
   * @param {string} path - Backup path
   * @returns {Promise<string>} - Resolves with backup path
   */
  async backup(path) {
    try {
      // Save latest chain info first
      await this.saveChainInfo();
      
      // Create backup
      const backupPath = await this.db.backup(path);
      
      this.emit('backup', { path: backupPath });
      
      return backupPath;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Restore from backup
   * @param {string} path - Backup path
   * @returns {Promise<boolean>} - Resolves with success status
   */
  async restore(path) {
    try {
      // Restore database
      await this.db.restore(path);
      
      // Reload chain info
      await this.loadChainInfo();
      
      // Clear caches
      this.clearCaches();
      
      this.emit('restore', { path });
      
      return true;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Get UTXO set for an address
   * @param {string} address - Address to get UTXOs for
   * @returns {Promise<Array>} - Resolves with UTXOs
   */
  async getUTXOs(address) {
    try {
      if (!this.indexAddresses) {
        throw new Error('Address indexing is disabled');
      }
      
      // Get all UTXOs for address
      const prefix = KEY_PREFIXES.UTXO + address + '_';
      
      const utxos = await this.db.getByPrefix(prefix, {
        values: true
      });
      
      return utxos.map(utxo => {
        const [prefix, addr, txHash, output] = utxo.key.split('_');
        return {
          address: addr,
          txHash,
          output,
          amount: utxo.value.amount,
          blockHeight: utxo.value.blockHeight,
          timestamp: utxo.value.timestamp
        };
      });
    } catch (error) {
      this.emit('error', error);
      return [];
    }
  }

  /**
   * Check if a transaction exists
   * @param {string} hash - Transaction hash
   * @returns {Promise<boolean>} - Resolves with whether transaction exists
   */
  async hasTransaction(hash) {
    try {
      // Check cache first
      if (this.cache.txCache.has(hash)) {
        return true;
      }
      
      // Check database
      return await this.db.has(KEY_PREFIXES.TX_HASH + hash);
    } catch (error) {
      return false;
    }
  }

  /**
   * Find blocks with timestamp in range
   * @param {number} startTime - Start timestamp
   * @param {number} endTime - End timestamp
   * @param {number} limit - Maximum number of blocks
   * @returns {Promise<Array>} - Resolves with array of blocks
   */
  async findBlocksByTimeRange(startTime, endTime, limit = 100) {
    try {
      // This is not efficient without a timestamp index
      // In a real implementation, we would have a secondary index
      
      // Get all blocks and filter
      const blocks = [];
      let height = this.cache.latestBlockHeight;
      
      while (height >= 0 && blocks.length < limit) {
        const block = await this.getBlockByHeight(height);
        
        if (block && block.timestamp >= startTime && block.timestamp <= endTime) {
          blocks.push(block);
        }
        
        // If we've gone past the start time, we can stop
        if (block && block.timestamp < startTime) {
          break;
        }
        
        height--;
      }
      
      return blocks;
    } catch (error) {
      this.emit('error', error);
      return [];
    }
  }

  /**
   * Compact the database
   * @returns {Promise<boolean>} - Resolves with success status
   */
  async compact() {
    try {
      await this.db.compact();
      
      this.emit('compacted');
      
      return true;
    } catch (error) {
      this.emit('error', error);
      return false;
    }
  }
}

module.exports = ChainStore;