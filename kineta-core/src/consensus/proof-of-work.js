/**
 * Proof-of-Work.js - PoW implementation for Kineta blockchain
 * 
 * Implements:
 * - Mining algorithm for proof-of-work
 * - Verification of mined blocks
 * - Worker thread pool for parallel mining
 * - Hash rate calculation and monitoring
 */

const crypto = require('crypto');
const EventEmitter = require('events');
const { Worker } = require('worker_threads');
const os = require('os');
const Hash = require('./crypto/hash');

/**
 * Proof of Work implementation for Kineta blockchain
 */
class ProofOfWork extends EventEmitter {
  /**
   * Initialize Proof of Work module
   * @param {object} options - Configuration options
   * @param {number} options.targetBlockTime - Target time between blocks in seconds (default: 123)
   * @param {number} options.initialDifficulty - Initial mining difficulty (default: 4)
   * @param {number} options.maxThreads - Maximum number of worker threads (default: CPU cores - 1)
   * @param {boolean} options.autoAdjust - Auto adjust difficulty (default: true)
   */
  constructor(options = {}) {
    super();
    
    this.targetBlockTime = options.targetBlockTime || 123; // 123 seconds target
    this.initialDifficulty = options.initialDifficulty || 4;
    this.maxThreads = options.maxThreads || Math.max(1, os.cpus().length - 1);
    this.autoAdjust = options.autoAdjust !== undefined ? options.autoAdjust : true;
    
    // Mining state
    this.isRunning = false;
    this.workers = [];
    this.currentBlock = null;
    this.currentDifficulty = this.initialDifficulty;
    this.hashCount = 0;
    this.startTime = 0;
    this.headerOnly = false; // Whether to mine header only or entire block
    
    // Performance tracking
    this.hashRateHistory = [];
    this.lastStatsUpdate = 0;
    this.statsUpdateInterval = 5000; // 5 seconds
  }

  /**
   * Start mining a block
   * @param {object} block - Block to mine
   * @param {number} difficulty - Mining difficulty
   * @param {boolean} headerOnly - Whether to mine header only
   * @returns {Promise<object>} - Mined block
   */
  async mineBlock(block, difficulty = this.currentDifficulty, headerOnly = false) {
    if (this.isRunning) {
      throw new Error('Mining already in progress');
    }
    
    this.isRunning = true;
    this.currentBlock = block;
    this.currentDifficulty = difficulty;
    this.headerOnly = headerOnly;
    this.hashCount = 0;
    this.startTime = Date.now();
    this.lastStatsUpdate = this.startTime;
    
    // Initialize worker threads
    await this.initWorkers();
    
    return new Promise((resolve, reject) => {
      // Set up event handlers
      const successHandler = (result) => {
        this.cleanup();
        resolve(result);
      };
      
      const errorHandler = (error) => {
        this.cleanup();
        reject(error);
      };
      
      this.once('blockMined', successHandler);
      this.once('error', errorHandler);
      
      // Start hash rate tracking
      this.startHashRateTracking();
      
      // Send initial work to workers
      this.distributeWork();
    });
  }

  /**
   * Stop mining operations
   */
  stop() {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    this.cleanup();
    
    this.emit('miningStopped');
  }

  /**
   * Clean up resources after mining
   * @private
   */
  cleanup() {
    this.isRunning = false;
    
    // Terminate all workers
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    
    clearInterval(this.hashRateInterval);
  }

  /**
   * Initialize worker threads for mining
   * @private
   */
  async initWorkers() {
    // Calculate number of threads to use
    const threadCount = Math.min(this.maxThreads, os.cpus().length);
    
    for (let i = 0; i < threadCount; i++) {
      const worker = new Worker(`
        const { parentPort } = require('worker_threads');
        const crypto = require('crypto');
        
        // Receive mining task
        parentPort.on('message', (task) => {
          const { blockHeader, difficulty, nonceStart, nonceRange, workerId } = task;
          
          // Target hash pattern
          const targetPrefix = '0'.repeat(difficulty);
          
          let hash;
          let nonce = nonceStart;
          const maxNonce = nonceStart + nonceRange;
          
          // Mining loop
          while (nonce < maxNonce) {
            // Calculate hash with current nonce
            const dataToHash = blockHeader + nonce.toString();
            hash = crypto.createHash('sha256').update(dataToHash).digest('hex');
            
            // Check if hash meets difficulty
            if (hash.startsWith(targetPrefix)) {
              // Found a valid hash
              parentPort.postMessage({
                type: 'success',
                nonce,
                hash,
                workerId
              });
              break;
            }
            
            // Report progress every 100,000 hashes
            if (nonce % 100000 === 0) {
              parentPort.postMessage({
                type: 'progress',
                hashCount: 100000,
                workerId
              });
            }
            
            nonce++;
          }
          
          // If reached max nonce without finding valid hash
          if (nonce >= maxNonce) {
            parentPort.postMessage({
              type: 'rangeComplete',
              hashCount: nonce - nonceStart,
              workerId
            });
          }
        });
      `, { eval: true });
      
      // Handle messages from worker
      worker.on('message', (message) => {
        if (message.type === 'success') {
          this.handleSuccess(message);
        } else if (message.type === 'progress' || message.type === 'rangeComplete') {
          this.hashCount += message.hashCount;
          
          // Assign new work if range is complete
          if (message.type === 'rangeComplete') {
            this.assignWorkToWorker(message.workerId);
          }
        }
      });
      
      // Handle worker errors
      worker.on('error', (error) => {
        console.error(`Worker ${i} error:`, error);
        this.emit('error', error);
      });
      
      this.workers.push({
        thread: worker,
        id: i,
        busy: false
      });
    }
    
    this.emit('workersInitialized', threadCount);
  }

  /**
   * Distribute mining work among workers
   * @private
   */
  distributeWork() {
    for (let i = 0; i < this.workers.length; i++) {
      this.assignWorkToWorker(i);
    }
  }

  /**
   * Assign work to a specific worker
   * @param {number} workerId - Worker ID
   * @private
   */
  assignWorkToWorker(workerId) {
    if (!this.isRunning) return;
    
    const worker = this.workers.find(w => w.id === workerId);
    if (!worker || worker.busy) return;
    
    worker.busy = true;
    
    // Prepare block header for hashing
    let blockHeader;
    if (this.headerOnly) {
      blockHeader = this.getBlockHeaderString(this.currentBlock);
    } else {
      blockHeader = this.getBlockString(this.currentBlock);
    }
    
    // Assign nonce range to worker
    const nonceRange = 10000000; // 10 million nonces per task
    const nonceStart = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
    
    worker.thread.postMessage({
      blockHeader,
      difficulty: this.currentDifficulty,
      nonceStart,
      nonceRange,
      workerId
    });
  }

  /**
   * Handle successful mining result
   * @param {object} result - Mining result
   * @private
   */
  handleSuccess(result) {
    if (!this.isRunning) return;
    
    // Update block with successful nonce and hash
    this.currentBlock.nonce = result.nonce;
    this.currentBlock.hash = result.hash;
    
    // Calculate final hash rate
    const endTime = Date.now();
    const durationSeconds = (endTime - this.startTime) / 1000;
    const hashRate = this.hashCount / durationSeconds;
    
    const miningResult = {
      block: this.currentBlock,
      nonce: result.nonce,
      hash: result.hash,
      difficulty: this.currentDifficulty,
      duration: durationSeconds,
      hashRate
    };
    
    // Record hash rate
    this.recordHashRate(hashRate);
    
    this.emit('blockMined', miningResult);
  }

  /**
   * Start tracking hash rate periodically
   * @private
   */
  startHashRateTracking() {
    this.hashRateInterval = setInterval(() => {
      const now = Date.now();
      const intervalSeconds = (now - this.lastStatsUpdate) / 1000;
      
      if (intervalSeconds > 0) {
        const currentHashRate = this.hashCount / intervalSeconds;
        
        this.emit('hashRateUpdate', {
          hashRate: currentHashRate,
          totalHashes: this.hashCount,
          duration: (now - this.startTime) / 1000
        });
        
        // Reset for next interval
        this.hashCount = 0;
        this.lastStatsUpdate = now;
      }
    }, this.statsUpdateInterval);
  }

  /**
   * Record hash rate for history
   * @param {number} hashRate - Hash rate in hashes per second
   * @private
   */
  recordHashRate(hashRate) {
    this.hashRateHistory.push({
      timestamp: Date.now(),
      hashRate,
      difficulty: this.currentDifficulty
    });
    
    // Keep history size manageable
    if (this.hashRateHistory.length > 100) {
      this.hashRateHistory.shift();
    }
  }

  /**
   * Calculate expected time to mine a block
   * @param {number} hashRate - Hash rate in hashes per second
   * @param {number} difficulty - Mining difficulty
   * @returns {number} - Expected time in seconds
   */
  calculateExpectedMiningTime(hashRate, difficulty) {
    // 16^difficulty is approximately the number of attempts needed
    const expectedAttempts = Math.pow(16, difficulty);
    return expectedAttempts / hashRate;
  }

  /**
   * Generate block header string for hashing
   * @param {object} block - Block object
   * @returns {string} - Block header string
   * @private
   */
  getBlockHeaderString(block) {
    return block.previousHash +
           block.timestamp.toString() +
           block.merkleRoot +
           block.height.toString() +
           block.difficulty.toString();
  }

  /**
   * Generate full block string for hashing
   * @param {object} block - Block object
   * @returns {string} - Full block string
   * @private
   */
  getBlockString(block) {
    return block.previousHash +
           block.timestamp.toString() +
           JSON.stringify(block.transactions) +
           block.height.toString() +
           block.difficulty.toString();
  }

  /**
   * Verify that a block meets proof-of-work requirements
   * @param {object} block - Block to verify
   * @returns {boolean} - Whether the block is valid
   */
  verifyBlock(block) {
    // Generate target hash pattern
    const targetPrefix = '0'.repeat(block.difficulty);
    
    // Check if hash meets difficulty requirement
    if (!block.hash.startsWith(targetPrefix)) {
      return false;
    }
    
    // Verify the hash matches block content
    let dataToHash;
    if (this.headerOnly) {
      dataToHash = this.getBlockHeaderString(block) + block.nonce.toString();
    } else {
      dataToHash = this.getBlockString(block) + block.nonce.toString();
    }
    
    const calculatedHash = Hash.sha256(dataToHash);
    
    return calculatedHash === block.hash;
  }

  /**
   * Calculate the current network hash rate
   * @param {number} difficulty - Current difficulty
   * @param {number} blockTime - Average block time in seconds
   * @returns {number} - Estimated network hash rate (hashes/second)
   */
  static calculateNetworkHashRate(difficulty, blockTime) {
    // Estimated hashes to find a block at current difficulty
    const expectedHashes = Math.pow(16, difficulty);
    
    // Network hash rate = expected hashes / average block time
    return expectedHashes / blockTime;
  }

  /**
   * Calculate optimal difficulty for target block time
   * @param {number} hashRate - Current hash rate (hashes/second)
   * @param {number} targetTime - Target block time in seconds
   * @returns {number} - Optimal difficulty
   */
  static calculateOptimalDifficulty(hashRate, targetTime) {
    // Solve for difficulty: hashRate * targetTime = 16^difficulty
    // log16(hashRate * targetTime) = difficulty
    return Math.log(hashRate * targetTime) / Math.log(16);
  }

  /**
   * Get current mining statistics
   * @returns {object} - Mining statistics
   */
  getStats() {
    const now = Date.now();
    const durationSeconds = (now - this.startTime) / 1000;
    const currentHashRate = durationSeconds > 0 ? this.hashCount / durationSeconds : 0;
    
    return {
      isRunning: this.isRunning,
      currentDifficulty: this.currentDifficulty,
      hashRate: currentHashRate,
      totalHashes: this.hashCount,
      duration: durationSeconds,
      workerCount: this.workers.length,
      targetBlockTime: this.targetBlockTime,
      expectedTimeToFind: this.calculateExpectedMiningTime(currentHashRate, this.currentDifficulty),
      hashRateHistory: this.hashRateHistory
    };
  }

  /**
   * Perform a quick single-threaded mining attempt (test or simple blocks)
   * @param {object} block - Block to mine
   * @param {number} difficulty - Mining difficulty
   * @param {number} maxAttempts - Maximum attempts (default: 1 million)
   * @returns {object|null} - Mined block or null if max attempts reached
   */
  static quickMine(block, difficulty, maxAttempts = 1000000) {
    const startTime = Date.now();
    const targetPrefix = '0'.repeat(difficulty);
    
    // Prepare block data for hashing
    const blockData = block.previousHash +
                      block.timestamp.toString() +
                      block.merkleRoot +
                      block.height.toString() +
                      block.difficulty.toString();
    
    let nonce = 0;
    let hash;
    
    while (nonce < maxAttempts) {
      const dataToHash = blockData + nonce.toString();
      hash = Hash.sha256(dataToHash);
      
      if (hash.startsWith(targetPrefix)) {
        // Found a valid hash
        block.nonce = nonce;
        block.hash = hash;
        
        const endTime = Date.now();
        const durationSeconds = (endTime - startTime) / 1000;
        const hashRate = nonce / durationSeconds;
        
        return {
          block,
          nonce,
          hash,
          difficulty,
          duration: durationSeconds,
          hashRate,
          attempts: nonce + 1
        };
      }
      
      nonce++;
    }
    
    // Max attempts reached without finding valid hash
    return null;
  }
}

module.exports = ProofOfWork;