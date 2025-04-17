/**
 * Sync.js - Blockchain synchronization for Kineta blockchain
 * 
 * Implements:
 * - Block synchronization from peers
 * - Fast initial sync
 * - Incremental sync
 * - Chain validation during sync
 */

const EventEmitter = require('events');

/**
 * Blockchain synchronization manager
 */
class Sync extends EventEmitter {
  /**
   * Initialize sync manager
   * @param {object} options - Configuration options
   * @param {object} options.blockchain - Blockchain reference
   * @param {object} options.p2pManager - P2P manager reference
   * @param {object} options.validator - Validator reference
   * @param {number} options.maxBlocksPerRequest - Maximum blocks per request (default: 100)
   * @param {number} options.syncInterval - Sync check interval in ms (default: 30000)
   * @param {number} options.syncTimeout - Sync timeout in ms (default: 60000)
   * @param {number} options.initialSyncDelay - Initial sync delay in ms (default: 5000)
   */
  constructor(options = {}) {
    super();
    
    this.blockchain = options.blockchain;
    this.p2pManager = options.p2pManager;
    this.validator = options.validator;
    this.maxBlocksPerRequest = options.maxBlocksPerRequest || 100;
    this.syncInterval = options.syncInterval || 30000;
    this.syncTimeout = options.syncTimeout || 60000;
    this.initialSyncDelay = options.initialSyncDelay || 5000;
    
    // Sync state
    this.syncing = false;
    this.initialSync = true;
    this.currentHeight = 0;
    this.targetHeight = 0;
    this.syncStartTime = 0;
    this.lastSyncTime = 0;
    this.syncedBlocks = 0;
    
    // Sync strategies
    this.syncStrategies = {
      FULL: 'full',            // Full blockchain sync from genesis
      HEADER_FIRST: 'header',  // Download headers first, then blocks
      CHECKPOINT: 'checkpoint', // Sync from trusted checkpoints
      INCREMENTAL: 'incremental' // Incremental sync of new blocks
    };
    
    this.currentStrategy = this.syncStrategies.FULL;
    
    // Trusted checkpoints (height -> hash) for faster sync
    this.checkpoints = {
      0: this.blockchain ? this.blockchain.chain[0].hash : null // Genesis block
    };
    
    // Sync interval reference
    this.syncIntervalId = null;
  }

  /**
   * Start the sync process
   * @returns {Promise} - Resolves when sync is started
   */
  async start() {
    if (this.syncing) {
      return;
    }
    
    console.log('Starting blockchain synchronization...');
    
    // Wait for initial delay to let P2P connections establish
    await new Promise(resolve => setTimeout(resolve, this.initialSyncDelay));
    
    // Start sync check interval
    this.syncIntervalId = setInterval(() => this.checkSync(), this.syncInterval);
    
    // Do initial sync
    this.checkSync();
    
    return true;
  }

  /**
   * Stop the sync process
   */
  stop() {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
    
    this.syncing = false;
  }

  /**
   * Check if sync is needed and start sync process
   * @private
   */
  checkSync() {
    // Don't start another sync if already syncing
    if (this.syncing) {
      return;
    }
    
    // Get highest block from peers
    const peers = this.p2pManager.getAllPeers();
    
    if (peers.length === 0) {
      console.log('No peers available for sync');
      return;
    }
    
    // Find highest block among peers
    let highestBlock = { height: 0 };
    
    for (const peer of peers) {
      if (peer.info.head && peer.info.head.height > highestBlock.height) {
        highestBlock = peer.info.head;
      }
    }
    
    // Get current blockchain height
    const currentHeight = this.blockchain.getLatestBlock().height;
    
    // Check if we need to sync
    if (highestBlock.height <= currentHeight) {
      // Already in sync
      if (this.initialSync) {
        this.initialSync = false;
        this.emit('syncComplete');
      }
      return;
    }
    
    // Need to sync
    console.log(`Need to sync: Current height ${currentHeight}, Target height ${highestBlock.height}`);
    
    // Determine sync strategy
    if (this.initialSync && currentHeight === 0) {
      this.currentStrategy = this.syncStrategies.FULL;
    } else if (highestBlock.height - currentHeight > 1000) {
      this.currentStrategy = this.syncStrategies.CHECKPOINT;
    } else {
      this.currentStrategy = this.syncStrategies.INCREMENTAL;
    }
    
    // Start sync
    this.startSync(currentHeight, highestBlock.height);
  }

  /**
   * Start blockchain synchronization
   * @param {number} currentHeight - Current blockchain height
   * @param {number} targetHeight - Target height to sync to
   * @private
   */
  startSync(currentHeight, targetHeight) {
    this.syncing = true;
    this.currentHeight = currentHeight;
    this.targetHeight = targetHeight;
    this.syncStartTime = Date.now();
    this.lastSyncTime = Date.now();
    this.syncedBlocks = 0;
    
    this.emit('syncStarted', {
      currentHeight,
      targetHeight,
      strategy: this.currentStrategy
    });
    
    console.log(`Starting sync from height ${currentHeight} to ${targetHeight} using ${this.currentStrategy} strategy`);
    
    // Execute sync based on strategy
    switch (this.currentStrategy) {
      case this.syncStrategies.FULL:
        this.fullSync();
        break;
      case this.syncStrategies.CHECKPOINT:
        this.checkpointSync();
        break;
      case this.syncStrategies.HEADER_FIRST:
        this.headerFirstSync();
        break;
      case this.syncStrategies.INCREMENTAL:
        this.incrementalSync();
        break;
    }
  }

  /**
   * Full blockchain sync from genesis
   * @private
   */
  async fullSync() {
    try {
      // Get best peer to sync from
      const peer = this.getBestPeerForSync();
      
      if (!peer) {
        console.error('No suitable peers for full sync');
        this.finishSync(false);
        return;
      }
      
      let syncHeight = this.currentHeight;
      let consecutiveFailures = 0;
      
      while (syncHeight < this.targetHeight && this.syncing) {
        // Calculate end height for this batch
        const endHeight = Math.min(syncHeight + this.maxBlocksPerRequest - 1, this.targetHeight);
        
        try {
          // Request and process blocks
          const blocks = await this.requestBlocks(peer.address, syncHeight + 1, endHeight);
          
          if (!blocks || blocks.length === 0) {
            console.warn(`No blocks received from peer ${peer.address} for height range ${syncHeight + 1}-${endHeight}`);
            consecutiveFailures++;
            
            if (consecutiveFailures >= 3) {
              // Try a different peer
              const newPeer = this.getBestPeerForSync(peer.address);
              if (newPeer) {
                peer = newPeer;
                console.log(`Switched to peer ${peer.address} for sync`);
              } else {
                console.error('No alternative peers available for sync');
                this.finishSync(false);
                return;
              }
            }
            
            // Delay before retry
            await new Promise(resolve => setTimeout(resolve, 5000));
            continue;
          }
          
          // Reset failure counter
          consecutiveFailures = 0;
          
          // Process the blocks
          const processedHeight = await this.processBlocks(blocks);
          
          if (processedHeight > syncHeight) {
            syncHeight = processedHeight;
            this.syncedBlocks += processedHeight - this.currentHeight;
            this.currentHeight = processedHeight;
            
            // Update progress
            this.updateSyncProgress();
          } else {
            console.warn(`Failed to advance sync height, stuck at ${syncHeight}`);
            consecutiveFailures++;
          }
        } catch (error) {
          console.error(`Error during full sync at height ${syncHeight}:`, error.message);
          consecutiveFailures++;
          
          if (consecutiveFailures >= 5) {
            console.error('Too many consecutive failures, aborting sync');
            this.finishSync(false);
            return;
          }
          
          // Delay before retry
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
      
      // Sync completed
      this.finishSync(true);
    } catch (error) {
      console.error('Error during full sync:', error.message);
      this.finishSync(false);
    }
  }

  /**
   * Sync from checkpoints
   * @private
   */
  async checkpointSync() {
    try {
      // Find best checkpoint below target height
      let checkpointHeight = 0;
      let checkpointHash = null;
      
      // Find the highest checkpoint below target height
      for (const [height, hash] of Object.entries(this.checkpoints)) {
        if (parseInt(height) > checkpointHeight && parseInt(height) < this.targetHeight) {
          checkpointHeight = parseInt(height);
          checkpointHash = hash;
        }
      }
      
      // If no suitable checkpoint found, fall back to full sync
      if (checkpointHeight <= this.currentHeight) {
        console.log('No suitable checkpoint found, falling back to incremental sync');
        this.currentStrategy = this.syncStrategies.INCREMENTAL;
        this.incrementalSync();
        return;
      }
      
      console.log(`Starting checkpoint sync from height ${checkpointHeight} with hash ${checkpointHash}`);
      
      // Get best peer for sync
      const peer = this.getBestPeerForSync();
      
      if (!peer) {
        console.error('No suitable peers for checkpoint sync');
        this.finishSync(false);
        return;
      }
      
      // Fetch checkpoint block first
      const checkpointBlock = await this.requestBlockByHash(peer.address, checkpointHash);
      
      if (!checkpointBlock) {
        console.error(`Failed to fetch checkpoint block at height ${checkpointHeight}`);
        this.finishSync(false);
        return;
      }
      
      // Validate checkpoint block
      if (!this.validator.validateBlock(checkpointBlock).valid) {
        console.error(`Checkpoint block validation failed at height ${checkpointHeight}`);
        this.finishSync(false);
        return;
      }
      
      // Start syncing from checkpoint
      this.currentHeight = checkpointHeight;
      
      // Continue with incremental sync from checkpoint
      this.incrementalSync();
    } catch (error) {
      console.error('Error during checkpoint sync:', error.message);
      this.finishSync(false);
    }
  }

  /**
   * Header-first sync strategy
   * @private
   */
  async headerFirstSync() {
    // This strategy first downloads all headers, verifies the chain,
    // then downloads the full blocks. Not implemented in this version.
    
    console.log('Header-first sync not implemented, falling back to incremental sync');
    this.currentStrategy = this.syncStrategies.INCREMENTAL;
    this.incrementalSync();
  }

  /**
   * Incremental sync for new blocks
   * @private
   */
  async incrementalSync() {
    try {
      // Get best peer for sync
      const peer = this.getBestPeerForSync();
      
      if (!peer) {
        console.error('No suitable peers for incremental sync');
        this.finishSync(false);
        return;
      }
      
      let syncHeight = this.currentHeight;
      let consecutiveFailures = 0;
      
      while (syncHeight < this.targetHeight && this.syncing) {
        // Calculate end height for this batch
        const endHeight = Math.min(syncHeight + this.maxBlocksPerRequest - 1, this.targetHeight);
        
        try {
          // Request blocks
          const blocks = await this.requestBlocks(peer.address, syncHeight + 1, endHeight);
          
          if (!blocks || blocks.length === 0) {
            console.warn(`No blocks received from peer ${peer.address} for height range ${syncHeight + 1}-${endHeight}`);
            consecutiveFailures++;
            
            if (consecutiveFailures >= 3) {
              // Try a different peer
              const newPeer = this.getBestPeerForSync(peer.address);
              if (newPeer) {
                peer = newPeer;
                console.log(`Switched to peer ${peer.address} for sync`);
              } else {
                console.error('No alternative peers available for sync');
                break;
              }
            }
            
            // Delay before retry
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue;
          }
          
          // Reset failure counter
          consecutiveFailures = 0;
          
          // Process blocks one by one with validation
          for (const block of blocks) {
            // Validate block
            if (!this.validator.validateBlock(block).valid) {
              console.warn(`Invalid block received at height ${block.height}`);
              continue;
            }
            
            // Add block to chain
            const added = this.blockchain.addBlock(block);
            
            if (added) {
              syncHeight = block.height;
              this.syncedBlocks++;
              this.currentHeight = syncHeight;
            } else {
              console.warn(`Failed to add block at height ${block.height}`);
            }
          }
          
          // Update progress
          this.updateSyncProgress();
          
        } catch (error) {
          console.error(`Error during incremental sync at height ${syncHeight}:`, error.message);
          consecutiveFailures++;
          
          if (consecutiveFailures >= 5) {
            console.error('Too many consecutive failures, aborting sync');
            break;
          }
          
          // Delay before retry
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      // Check if sync was successful
      const finalHeight = this.blockchain.getLatestBlock().height;
      const success = finalHeight >= this.targetHeight - 5; // Allow small discrepancy
      
      this.finishSync(success);
    } catch (error) {
      console.error('Error during incremental sync:', error.message);
      this.finishSync(false);
    }
  }

  /**
   * Process a batch of blocks
   * @param {Array} blocks - Blocks to process
   * @returns {number} - Height of last processed block
   * @private
   */
  async processBlocks(blocks) {
    if (!blocks || blocks.length === 0) {
      return this.currentHeight;
    }
    
    let lastProcessedHeight = this.currentHeight;
    
    for (const block of blocks) {
      // Basic validation
      if (!block || typeof block !== 'object') {
        continue;
      }
      
      // Skip blocks we already have
      if (block.height <= this.currentHeight) {
        continue;
      }
      
      // Validate block
      if (!this.validator.validateBlock(block).valid) {
        console.warn(`Invalid block received at height ${block.height}`);
        continue;
      }
      
      // Add block to chain
      const added = this.blockchain.addBlock(block);
      
      if (added) {
        lastProcessedHeight = block.height;
      } else {
        console.warn(`Failed to add block at height ${block.height}`);
      }
    }
    
    return lastProcessedHeight;
  }

  /**
   * Request blocks from a peer
   * @param {string} peerAddress - Peer address
   * @param {number} startHeight - Start block height
   * @param {number} endHeight - End block height
   * @returns {Promise<Array>} - Resolves with array of blocks
   * @private
   */
  requestBlocks(peerAddress, startHeight, endHeight) {
    return new Promise((resolve, reject) => {
      const peer = this.p2pManager.getPeer(peerAddress);
      
      if (!peer || peer.socket.readyState !== 1) { // 1 = WebSocket.OPEN
        reject(new Error(`Peer ${peerAddress} not available`));
        return;
      }
      
      // Set up timeout
      const timeout = setTimeout(() => {
        // Remove event listener
        this.p2pManager.removeAllListeners(`blocks-${startHeight}-${endHeight}`);
        reject(new Error(`Request timeout for blocks ${startHeight}-${endHeight}`));
      }, this.syncTimeout);
      
      // Listen for response
      this.p2pManager.once(`blocks-${startHeight}-${endHeight}`, (data) => {
        clearTimeout(timeout);
        resolve(data.blocks);
      });
      
      // Send request
      this.p2pManager.sendMessage(peer.socket, 'GET_BLOCKS', {
        startHeight,
        endHeight,
        limit: this.maxBlocksPerRequest
      });
    });
  }

  /**
   * Request specific block by hash
   * @param {string} peerAddress - Peer address
   * @param {string} hash - Block hash
   * @returns {Promise<object>} - Resolves with block
   * @private
   */
  requestBlockByHash(peerAddress, hash) {
    return new Promise((resolve, reject) => {
      const peer = this.p2pManager.getPeer(peerAddress);
      
      if (!peer || peer.socket.readyState !== 1) {
        reject(new Error(`Peer ${peerAddress} not available`));
        return;
      }
      
      // Set up timeout
      const timeout = setTimeout(() => {
        // Remove event listener
        this.p2pManager.removeAllListeners(`block-${hash}`);
        reject(new Error(`Request timeout for block ${hash}`));
      }, this.syncTimeout);
      
      // Listen for response
      this.p2pManager.once(`block-${hash}`, (data) => {
        clearTimeout(timeout);
        resolve(data.block);
      });
      
      // Send request
      this.p2pManager.sendMessage(peer.socket, 'GET_BLOCK', {
        hash
      });
    });
  }

  /**
   * Get best peer for sync
   * @param {string} excludeAddress - Address to exclude
   * @returns {object|null} - Best peer or null if none available
   * @private
   */
  getBestPeerForSync(excludeAddress = null) {
    const peers = this.p2pManager.getAllPeers();
    
    if (peers.length === 0) {
      return null;
    }
    
    // Filter out excluded peer and peers with low scores
    const eligiblePeers = peers.filter(peer => 
      peer.address !== excludeAddress &&
      peer.score >= -5 &&
      peer.info.head &&
      peer.info.head.height >= this.targetHeight
    );
    
    if (eligiblePeers.length === 0) {
      return null;
    }
    
    // Sort by score (highest first)
    eligiblePeers.sort((a, b) => b.score - a.score);
    
    return eligiblePeers[0];
  }

  /**
   * Update sync progress
   * @private
   */
  updateSyncProgress() {
    const now = Date.now();
    const elapsed = (now - this.syncStartTime) / 1000;
    const blockSpeed = elapsed > 0 ? this.syncedBlocks / elapsed : 0;
    const progress = this.targetHeight > 0 
      ? (this.currentHeight / this.targetHeight) * 100 
      : 0;
    
    let remainingTime = null;
    
    if (blockSpeed > 0) {
      const remainingBlocks = this.targetHeight - this.currentHeight;
      remainingTime = remainingBlocks / blockSpeed;
    }
    
    const progressInfo = {
      currentHeight: this.currentHeight,
      targetHeight: this.targetHeight,
      syncedBlocks: this.syncedBlocks,
      progress: progress,
      blockSpeed: blockSpeed,
      elapsedTime: elapsed,
      remainingTime: remainingTime,
      strategy: this.currentStrategy
    };
    
    this.emit('syncProgress', progressInfo);
    
    // Log progress every 1000 blocks or 30 seconds
    if (this.syncedBlocks % 1000 === 0 || now - this.lastSyncTime > 30000) {
      console.log(`Sync progress: ${progress.toFixed(2)}% - Height ${this.currentHeight}/${this.targetHeight} - ${blockSpeed.toFixed(2)} blocks/sec`);
      this.lastSyncTime = now;
    }
  }

  /**
   * Finish sync process
   * @param {boolean} success - Whether sync was successful
   * @private
   */
  finishSync(success) {
    this.syncing = false;
    
    if (success) {
      console.log(`Blockchain sync completed successfully at height ${this.currentHeight}`);
      this.initialSync = false;
      
      // Record checkpoint for this height
      const latestBlock = this.blockchain.getLatestBlock();
      this.checkpoints[latestBlock.height] = latestBlock.hash;
      
      this.emit('syncComplete', {
        height: this.currentHeight,
        blocksProcessed: this.syncedBlocks,
        elapsedTime: (Date.now() - this.syncStartTime) / 1000
      });
    } else {
      console.error('Blockchain sync failed');
      this.emit('syncFailed', {
        lastHeight: this.currentHeight,
        targetHeight: this.targetHeight,
        blocksProcessed: this.syncedBlocks,
        elapsedTime: (Date.now() - this.syncStartTime) / 1000
      });
      
      // Schedule another sync attempt
      setTimeout(() => this.checkSync(), 30000);
    }
  }

  /**
   * Get sync status
   * @returns {object} - Sync status
   */
  getStatus() {
    return {
      syncing: this.syncing,
      initialSync: this.initialSync,
      currentHeight: this.currentHeight,
      targetHeight: this.targetHeight,
      progress: this.targetHeight > 0 
        ? (this.currentHeight / this.targetHeight) * 100 
        : 0,
      strategy: this.currentStrategy,
      syncedBlocks: this.syncedBlocks,
      elapsedTime: this.syncStartTime ? (Date.now() - this.syncStartTime) / 1000 : 0
    };
  }
}

module.exports = Sync;