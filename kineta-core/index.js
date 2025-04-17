/**
 * Main entry point for Kineta blockchain
 * 
 * This file exports all components of the Kineta blockchain system
 * and provides a convenient way to import and use them.
 */

// Export core modules
const core = require('./src/core');
const crypto = require('./src/crypto');
const consensus = require('./src/consensus');
const economic = require('./src/economic');
const network = require('./src/network');
const storage = require('./src/storage');
const api = require('./src/api');

// Create and export main Kineta object
const Kineta = {
  // Core components
  core,
  crypto,
  consensus,
  economic,
  network,
  storage,
  api,
  
  // Main classes (shortcuts for convenience)
  Blockchain: core.Blockchain,
  Transaction: core.Transaction,
  Block: core.Block,
  Mempool: core.Mempool,
  
  Wallet: crypto.Wallet,
  Hash: crypto.Hash,
  Signature: crypto.Signature,
  
  ProofOfWork: consensus.ProofOfWork,
  DifficultyAdjuster: consensus.DifficultyAdjuster,
  Validator: consensus.Validator,
  
  EconomicModel: economic.EconomicModel,
  InflationModel: economic.InflationModel,
  GDPOracle: economic.GDPOracle,
  RewardCalculator: economic.RewardCalculator,
  FeeManager: economic.FeeManager,
  
  Node: network.Node,
  P2PManager: network.P2PManager,
  Sync: network.Sync,
  
  Database: storage.Database,
  ChainStore: storage.ChainStore,
  
  APIServer: api.APIServer,
  
  /**
   * Create a complete Kineta node with all components
   * @param {object} config - Node configuration
   * @returns {network.Node} - Fully configured Kineta node
   */
  createNode: function(config = {}) {
    // Create node with provided configuration
    const node = new network.Node(config);
    
    // Initialize node
    node.initialize().catch(err => {
      console.error('Failed to initialize node:', err.message);
    });
    
    return node;
  },
  
  /**
   * Start a Kineta node with API server
   * @param {object} config - Node configuration
   * @returns {object} - Node and API server
   */
  startNode: async function(config = {}) {
    // Create node
    const node = this.createNode(config);
    
    // Start node
    await node.start();
    
    // Create API server if enabled
    let apiServer = null;
    if (config.api && config.api.enabled) {
      apiServer = new api.APIServer({
        ...config.api,
        node
      });
      
      // Start API server
      await apiServer.start();
    }
    
    return {
      node,
      apiServer
    };
  },
  
  /**
   * Create a Kineta wallet
   * @param {object} options - Wallet options
   * @returns {crypto.Wallet} - Kineta wallet
   */
  createWallet: function(options = {}) {
    return new crypto.Wallet(options);
  },
  
  /**
   * Version information
   */
  version: '1.0.0',
  
  /**
   * Library information
   */
  info: {
    name: 'Kineta Blockchain',
    description: 'A GDP-linked cryptocurrency with stable, economically relevant inflation',
    homepage: 'https://kineta.io',
    repository: 'https://github.com/kineta/kineta-core',
    license: 'MIT'
  }
};

module.exports = Kineta;