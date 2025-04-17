/**
 * Node.js - Node functionality for Kineta blockchain
 * 
 * Implements:
 * - Core node functionality
 * - Component initialization and coordination
 * - Node state management
 * - System monitoring
 */

const EventEmitter = require('events');
const Blockchain = require('../core/blockchain');
const Mempool = require('../core/mempool');
const EconomicModel = require('../economic/economic-model');
const InflationModel = require('../economic/inflation');
const GDPOracle = require('../economic/gdp-oracle');
const RewardCalculator = require('../economic/reward');
const FeeManager = require('../economic/fee');
const ProofOfWork = require('../consensus/proof-of-work');
const DifficultyAdjuster = require('../consensus/difficulty');
const Validator = require('../consensus/validation');
const P2PManager = require('./p2p');
const Sync = require('./sync');
const os = require('os');

/**
 * Kineta blockchain node
 */
class Node extends EventEmitter {
  /**
   * Initialize blockchain node
   * @param {object} options - Configuration options
   * @param {string} options.networkID - Network identifier (mainnet/testnet)
   * @param {string} options.dataDir - Data directory
   * @param {object} options.p2p - P2P network options
   * @param {object} options.blockchain - Blockchain options
   * @param {object} options.mempool - Mempool options
   * @param {object} options.economic - Economic model options
   * @param {object} options.consensus - Consensus options
   * @param {object} options.storage - Storage options
   * @param {boolean} options.enableMining - Whether to enable mining
   * @param {string} options.minerAddress - Miner's address
   */
  constructor(options = {}) {
    super();
    
    this.networkID = options.networkID || 'mainnet';
    this.dataDir = options.dataDir || './data';
    this.p2pOptions = options.p2p || {};
    this.blockchainOptions = options.blockchain || {};
    this.mempoolOptions = options.mempool || {};
    this.economicOptions = options.economic || {};
    this.consensusOptions = options.consensus || {};
    this.storageOptions = options.storage || {};
    this.enableMining = options.enableMining || false;
    this.minerAddress = options.minerAddress;
    
    // System state
    this.state = {
      running: false,
      syncing: false,
      mining: false,
      initialized: false,
      error: null
    };
    
    // Core components
    this.blockchain = null;
    this.mempool = null;
    this.economicModel = null;
    this.difficultyAdjuster = null;
    this.proofOfWork = null;
    this.validator = null;
    this.p2pManager = null;
    this.sync = null;
    
    // Performance monitoring
    this.performanceStats = {
      startTime: 0,
      blockProcessingTimes: [], // Last 100 blocks processing times
      cpuUsage: [],
      memoryUsage: [],
      lastUpdate: 0
    };
    
    // Create interval for stats collection
    this.statsInterval = null;
  }

  /**
   * Initialize the node
   * @returns {Promise} - Resolves when node is initialized
   */
  async initialize() {
    try {
      console.log('Initializing Kineta node...');
      
      // Create components
      await this.createComponents();
      
      // Set up event listeners
      this.setupEventListeners();
      
      // Start performance monitoring
      this.startPerformanceMonitoring();
      
      this.state.initialized = true;
      this.emit('initialized');
      
      console.log('Node initialization complete');
      return true;
    } catch (error) {
      console.error('Node initialization failed:', error.message);
      this.state.error = error.message;
      this.emit('error', error);
      return false;
    }
  }

  /**
   * Create node components
   * @private
   */
  async createComponents() {
    // Create the consensus components first
    this.difficultyAdjuster = new DifficultyAdjuster({
      ...this.consensusOptions.difficulty,
      targetBlockTime: 123 // Kineta's target block time
    });
    
    this.proofOfWork = new ProofOfWork({
      ...this.consensusOptions.proofOfWork,
      targetBlockTime: 123
    });
    
    // Create the mempool
    this.mempool = new Mempool(this.mempoolOptions);
    
    // Create the economic model components
    const inflationModel = new InflationModel(this.economicOptions.inflation);
    const gdpOracle = new GDPOracle(this.economicOptions.gdpOracle);
    const rewardCalculator = new RewardCalculator({
      ...this.economicOptions.reward,
      inflationModel
    });
    const feeManager = new FeeManager(this.economicOptions.fee);
    
    // Create the main economic model
    this.economicModel = new EconomicModel({
      ...this.economicOptions,
      inflation: inflationModel,
      gdpOracle,
      reward: rewardCalculator,
      fee: feeManager
    });
    
    // Create the blockchain
    this.blockchain = new Blockchain({
      ...this.blockchainOptions,
      economicModel: this.economicModel
    });
    
    // Create the validator
    this.validator = new Validator({
      blockchain: this.blockchain,
      difficultyAdjuster: this.difficultyAdjuster,
      proofOfWork: this.proofOfWork
    });
    
    // Create the P2P manager
    this.p2pManager = new P2PManager({
      ...this.p2pOptions,
      blockchain: this.blockchain,
      mempool: this.mempool,
      networkID: this.networkID
    });
    
    // Create the sync manager
    this.sync = new Sync({
      blockchain: this.blockchain,
      p2pManager: this.p2pManager,
      validator: this.validator
    });
  }

  /**
   * Set up event listeners for components
   * @private
   */
  setupEventListeners() {
    // Blockchain events
    this.blockchain.on('blockAdded', (block) => {
      this.emit('blockAdded', block);
      
      // Broadcast new block to network
      if (this.p2pManager && this.state.running && !this.state.syncing) {
        this.p2pManager.broadcastBlock(block);
      }
      
      // Update economic model with new block
      if (this.economicModel) {
        this.economicModel.update(
          block.height,
          this.blockchain.calculateCirculatingSupply(),
          this.mempool
        );
      }
      
      // Clear confirmed transactions from mempool
      if (this.mempool) {
        this.mempool.removeConfirmedTransactions(this.blockchain);
      }
    });
    
    this.blockchain.on('chainReplaced', () => {
      this.emit('chainReplaced');
      
      // Clear and rebuild mempool
      if (this.mempool) {
        this.mempool.clear();
      }
    });
    
    // Mempool events
    this.mempool.on('transactionAdded', (transaction) => {
      this.emit('transactionAdded', transaction);
      
      // Broadcast new transaction to network
      if (this.p2pManager && this.state.running && !this.state.syncing) {
        this.p2pManager.broadcastTransaction(transaction);
      }
    });
    
    // Economic model events
    this.economicModel.on('inflationAdjusted', (data) => {
      this.emit('inflationAdjusted', data);
    });
    
    // P2P events
    this.p2pManager.on('peerConnected', (peer) => {
      this.emit('peerConnected', peer);
    });
    
    this.p2pManager.on('peerDisconnected', (peer) => {
      this.emit('peerDisconnected', peer);
    });
    
    // Sync events
    this.sync.on('syncStarted', () => {
      this.state.syncing = true;
      this.emit('syncStarted');
    });
    
    this.sync.on('syncProgress', (progress) => {
      this.emit('syncProgress', progress);
    });
    
    this.sync.on('syncComplete', () => {
      this.state.syncing = false;
      this.emit('syncComplete');
      
      // Start mining if enabled
      if (this.enableMining && !this.state.mining) {
        this.startMining();
      }
    });
  }

  /**
   * Start the node
   * @returns {Promise} - Resolves when node is started
   */
  async start() {
    if (this.state.running) {
      return true;
    }
    
    try {
      console.log('Starting Kineta node...');
      
      // Make sure node is initialized
      if (!this.state.initialized) {
        await this.initialize();
      }
      
      // Start P2P network
      await this.p2pManager.start();
      
      // Start sync process
      await this.sync.start();
      
      // Start mining if enabled and not syncing
      if (this.enableMining && !this.state.syncing) {
        this.startMining();
      }
      
      this.state.running = true;
      this.performanceStats.startTime = Date.now();
      
      this.emit('started');
      
      console.log('Node started successfully');
      return true;
    } catch (error) {
      console.error('Failed to start node:', error.message);
      this.state.error = error.message;
      this.emit('error', error);
      return false;
    }
  }

  /**
   * Stop the node
   * @returns {Promise} - Resolves when node is stopped
   */
  async stop() {
    if (!this.state.running) {
      return true;
    }
    
    try {
      console.log('Stopping Kineta node...');
      
      // Stop mining
      this.stopMining();
      
      // Stop P2P network
      this.p2pManager.stop();
      
      // Stop performance monitoring
      clearInterval(this.statsInterval);
      
      this.state.running = false;
      this.state.syncing = false;
      
      this.emit('stopped');
      
      console.log('Node stopped successfully');
      return true;
    } catch (error) {
      console.error('Error stopping node:', error.message);
      this.emit('error', error);
      return false;
    }
  }

  /**
   * Start mining
   */
  startMining() {
    if (this.state.mining || !this.enableMining || !this.minerAddress) {
      return;
    }
    
    console.log('Starting mining process...');
    
    this.state.mining = true;
    this.miningInterval = setInterval(() => this.mineBlock(), 1000);
    
    this.emit('miningStarted');
  }

  /**
   * Stop mining
   */
  stopMining() {
    if (!this.state.mining) {
      return;
    }
    
    console.log('Stopping mining process...');
    
    clearInterval(this.miningInterval);
    this.state.mining = false;
    
    this.emit('miningStopped');
  }

  /**
   * Mine a new block
   * @private
   */
  async mineBlock() {
    if (!this.state.mining || this.state.syncing) {
      return;
    }
    
    try {
      // Get pending transactions
      const pendingTransactions = this.mempool.getTransactionsForBlock();
      
      // Mine the block
      const startTime = Date.now();
      const newBlock = await this.blockchain.minePendingTransactions(this.minerAddress);
      const endTime = Date.now();
      
      const miningTime = (endTime - startTime) / 1000;
      console.log(`Mined new block at height ${newBlock.height} in ${miningTime} seconds`);
      
      // Record block processing time
      this.recordBlockProcessingTime(miningTime);
      
      this.emit('blockMined', {
        block: newBlock,
        transactions: pendingTransactions.length,
        time: miningTime
      });
    } catch (error) {
      console.error('Error mining block:', error.message);
    }
  }

  /**
   * Submit a transaction to the node
   * @param {object} transaction - Transaction to submit
   * @returns {boolean} - Whether the transaction was accepted
   */
  submitTransaction(transaction) {
    try {
      // Validate the transaction
      const validationResult = this.validator.validateTransaction(transaction);
      
      if (!validationResult.valid) {
        console.warn('Transaction validation failed:', validationResult.reason);
        return false;
      }
      
      // Add to mempool
      this.mempool.addTransaction(transaction);
      
      return true;
    } catch (error) {
      console.error('Error submitting transaction:', error.message);
      return false;
    }
  }

  /**
   * Start performance monitoring
   * @private
   */
  startPerformanceMonitoring() {
    this.statsInterval = setInterval(() => this.collectPerformanceStats(), 10000);
  }

  /**
   * Collect performance statistics
   * @private
   */
  collectPerformanceStats() {
    const memUsage = process.memoryUsage();
    
    this.performanceStats.cpuUsage.push({
      timestamp: Date.now(),
      usage: process.cpuUsage()
    });
    
    this.performanceStats.memoryUsage.push({
      timestamp: Date.now(),
      rss: memUsage.rss,
      heapTotal: memUsage.heapTotal,
      heapUsed: memUsage.heapUsed
    });
    
    // Keep only the last 100 data points
    if (this.performanceStats.cpuUsage.length > 100) {
      this.performanceStats.cpuUsage.shift();
    }
    
    if (this.performanceStats.memoryUsage.length > 100) {
      this.performanceStats.memoryUsage.shift();
    }
    
    this.performanceStats.lastUpdate = Date.now();
  }

  /**
   * Record block processing time
   * @param {number} time - Processing time in seconds
   * @private
   */
  recordBlockProcessingTime(time) {
    this.performanceStats.blockProcessingTimes.push({
      timestamp: Date.now(),
      time
    });
    
    // Keep only the last 100 blocks
    if (this.performanceStats.blockProcessingTimes.length > 100) {
      this.performanceStats.blockProcessingTimes.shift();
    }
  }

  /**
   * Get node state and statistics
   * @returns {object} - Node state and statistics
   */
  getNodeInfo() {
    const latestBlock = this.blockchain ? this.blockchain.getLatestBlock() : null;
    const peers = this.p2pManager ? this.p2pManager.getAllPeers() : [];
    const mempool = this.mempool ? this.mempool.getStats() : null;
    
    return {
      state: this.state,
      version: '1.0.0',
      networkID: this.networkID,
      uptime: this.performanceStats.startTime ? (Date.now() - this.performanceStats.startTime) / 1000 : 0,
      blockchain: {
        height: latestBlock ? latestBlock.height : 0,
        lastBlockHash: latestBlock ? latestBlock.hash : null,
        lastBlockTime: latestBlock ? latestBlock.timestamp : null,
        difficulty: this.difficultyAdjuster ? this.difficultyAdjuster.currentDifficulty : null
      },
      mempool: mempool,
      peers: {
        connected: peers.length,
        inbound: peers.filter(p => p.info.direction === 'inbound').length,
        outbound: peers.filter(p => p.info.direction === 'outbound').length
      },
      economic: this.economicModel ? {
        inflationRate: this.economicModel.getCurrentInflationRate(),
        gdpGrowth: this.economicModel.getCurrentGDPGrowth(),
        circulatingSupply: this.blockchain ? this.blockchain.calculateCirculatingSupply() : 0
      } : null,
      performance: {
        averageBlockTime: this.calculateAverageBlockTime(),
        memoryUsage: this.getLatestMemoryUsage(),
        system: {
          platform: process.platform,
          arch: process.arch,
          cpus: os.cpus().length,
          totalMemory: os.totalmem(),
          freeMemory: os.freemem()
        }
      }
    };
  }

  /**
   * Calculate average block processing time
   * @returns {number} - Average time in seconds
   * @private
   */
  calculateAverageBlockTime() {
    if (this.performanceStats.blockProcessingTimes.length === 0) {
      return 0;
    }
    
    const sum = this.performanceStats.blockProcessingTimes.reduce(
      (total, stats) => total + stats.time, 0
    );
    
    return sum / this.performanceStats.blockProcessingTimes.length;
  }

  /**
   * Get latest memory usage
   * @returns {object} - Memory usage statistics
   * @private
   */
  getLatestMemoryUsage() {
    if (this.performanceStats.memoryUsage.length === 0) {
      return process.memoryUsage();
    }
    
    return this.performanceStats.memoryUsage[this.performanceStats.memoryUsage.length - 1];
  }

  /**
   * Get detailed blockchain information
   * @returns {object} - Blockchain information
   */
  getBlockchainInfo() {
    if (!this.blockchain) {
      return null;
    }
    
    const latestBlock = this.blockchain.getLatestBlock();
    
    return {
      height: latestBlock.height,
      hash: latestBlock.hash,
      previousHash: latestBlock.previousHash,
      timestamp: latestBlock.timestamp,
      difficulty: latestBlock.difficulty,
      nonce: latestBlock.nonce,
      transactionCount: latestBlock.transactions.length,
      size: JSON.stringify(latestBlock).length,
      validationResult: this.validator ? this.validator.validateBlock(latestBlock).valid : null,
      circulating: this.blockchain.calculateCirculatingSupply(),
      isValid: this.blockchain.isChainValid()
    };
  }

  /**
   * Get detailed economic model information
   * @returns {object} - Economic model information
   */
  getEconomicInfo() {
    if (!this.economicModel) {
      return null;
    }
    
    return this.economicModel.getEconomicStats();
  }
}

module.exports = Node;