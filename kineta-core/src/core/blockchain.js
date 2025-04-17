/**
 * Blockchain.js - Core blockchain implementation for Kineta
 * 
 * Implements:
 * - Blockchain structure and management
 * - Block addition and validation
 * - Chain validation
 * - Blockchain state (UTXOs, balances)
 * - Integration with economic model for BNP-linked inflation
 */

const Block = require('./block');
const Transaction = require('./transaction');
const EventEmitter = require('events');
const crypto = require('crypto');

// These will be imported from the economic module when available
// For now, we'll define placeholder implementations
const calculateInflationRate = (gdpGrowth, baseRate = 0.0025) => {
  return Math.max(baseRate, gdpGrowth + baseRate);
};

const calculateBlockReward = (currentSupply, inflationRate) => {
  const annualIssuance = currentSupply * inflationRate;
  const blocksPerYear = (365 * 24 * 60 * 60) / 123; // 123 sec block time
  return annualIssuance / blocksPerYear;
};

// Addresses for special purposes
const DEVELOPER_ADDRESS = '04d46b3d51c20deb1d5dd3b6ea5cb4c474cede8600e423437b023f8ea7846547eca4a92a0c660caaac7c9b74c863c5c38686e83cf9e0152e36dd032b795df92f4a';

class Blockchain extends EventEmitter {
  /**
   * Initialize a new blockchain
   */
  constructor() {
    super();
    this.chain = [];
    this.difficulty = 4;
    this.pendingTransactions = [];
    this.miningReward = 10; // Initial reward, will be adjusted by economic model
    this.totalSupply = 123456789; // Initial supply as per specs
    this.lastDifficultyAdjustment = 0;
    this.targetBlockTime = 123; // 123 seconds per block
    this.genesisTimestamp = Date.now();
    
    // Create the genesis block if no chain exists
    if (this.chain.length === 0) {
      this.createGenesisBlock();
    }
    
    // Economic model references (will be properly initialized later)
    this.gdpOracle = null;
    this.economicModel = null;
  }

  /**
   * Create the genesis block
   */
  createGenesisBlock() {
    const timestamp = this.genesisTimestamp;
    
    // Create coinbase transaction for initial distribution
    const genesisTransaction = Transaction.createCoinbaseTransaction(
      DEVELOPER_ADDRESS,
      0, // Block height
      this.totalSupply // Initial supply goes to developer address
    );
    
    const genesisBlock = new Block(
      timestamp,
      [genesisTransaction],
      "0", // Previous hash for genesis block is 0
      0,   // Height
      1    // Initial difficulty
    );
    
    // Set hash manually for genesis block
    genesisBlock.hash = genesisBlock.calculateHash();
    
    // Add to chain
    this.chain.push(genesisBlock);
    
    this.emit('blockAdded', genesisBlock);
    
    console.log('Genesis block created:', genesisBlock.hash);
  }

  /**
   * Get the latest block in the chain
   * @returns {Block} - The latest block
   */
  getLatestBlock() {
    return this.chain[this.chain.length - 1];
  }

  /**
   * Calculate block reward based on economic model
   * @param {number} height - Block height
   * @returns {number} - The block reward
   */
  calculateBlockReward(height) {
    // If economic model is initialized, use it
    if (this.economicModel && this.gdpOracle) {
      const currentSupply = this.calculateCirculatingSupply();
      const gdpGrowth = this.gdpOracle.getCurrentGDPGrowth();
      const inflationRate = calculateInflationRate(gdpGrowth);
      return calculateBlockReward(currentSupply, inflationRate);
    }
    
    // Fallback to fixed reward if economic model not initialized
    return this.miningReward;
  }

  /**
   * Calculate the total circulating supply
   * @returns {number} - Total circulating KIN
   */
  calculateCirculatingSupply() {
    let supply = 0;
    
    for (const block of this.chain) {
      for (const tx of block.transactions) {
        if (!tx.fromAddress) {
          // This is a coinbase transaction, adds to supply
          supply += tx.amount;
        }
      }
    }
    
    return supply;
  }

  /**
   * Process and apply the developer fee
   * @param {Transaction} transaction - Original transaction
   * @returns {Transaction|null} - Developer fee transaction or null
   */
  processDeveloperFee(transaction) {
    if (!transaction.fromAddress) {
      // No developer fee on coinbase transactions
      return null;
    }
    
    const feeAmount = transaction.calculateDeveloperFee();
    
    if (feeAmount > 0) {
      // Create a new transaction for the developer fee
      const devFeeTransaction = new Transaction(
        transaction.fromAddress,
        DEVELOPER_ADDRESS,
        feeAmount,
        transaction.timestamp
      );
      
      // Note: in practice, this would be signed by the sender
      // For now, we'll skip signature verification for dev fee tx
      
      return devFeeTransaction;
    }
    
    return null;
  }

  /**
   * Add a new transaction to pending transactions
   * @param {Transaction} transaction - Transaction to add
   * @returns {number} - Index of transaction in pending pool
   */
  addTransaction(transaction) {
    // Verify transaction
    if (!transaction.isValid()) {
      throw new Error('Cannot add invalid transaction to chain');
    }
    
    // Check if sender has enough balance
    if (transaction.fromAddress) {
      const balance = this.getBalanceOfAddress(transaction.fromAddress);
      
      if (balance < transaction.amount + transaction.fee) {
        throw new Error('Not enough balance');
      }
    }
    
    // Add to pending transactions
    this.pendingTransactions.push(transaction);
    
    // Process developer fee
    const devFeeTransaction = this.processDeveloperFee(transaction);
    if (devFeeTransaction) {
      this.pendingTransactions.push(devFeeTransaction);
    }
    
    this.emit('transactionAdded', transaction);
    
    return this.pendingTransactions.length - 1;
  }

  /**
   * Mine pending transactions and add a new block
   * @param {string} miningRewardAddress - Address to send mining reward to
   */
  minePendingTransactions(miningRewardAddress) {
    // Get block height
    const blockHeight = this.chain.length;
    
    // Calculate mining reward
    const rewardAmount = this.calculateBlockReward(blockHeight);
    
    // Create coinbase transaction (mining reward)
    const coinbaseTx = Transaction.createCoinbaseTransaction(
      miningRewardAddress,
      blockHeight,
      rewardAmount
    );
    
    // Prepare list of transactions for the new block
    const blockTransactions = [coinbaseTx, ...this.pendingTransactions];
    
    // Create new block
    const block = new Block(
      Date.now(),
      blockTransactions,
      this.getLatestBlock().hash,
      blockHeight,
      this.difficulty
    );
    
    // Mine the block
    console.log('Mining block...');
    block.mineBlock(this.difficulty);
    
    // Add block to chain
    console.log('Block successfully mined!');
    this.chain.push(block);
    
    // Reset pending transactions
    this.pendingTransactions = [];
    
    // Update difficulty if needed
    this.adjustDifficulty();
    
    this.emit('blockMined', block);
    
    return block;
  }

  /**
   * Adjust mining difficulty based on block creation time
   */
  adjustDifficulty() {
    const blockHeight = this.chain.length - 1;
    const adjustmentInterval = 10; // Adjust difficulty every 10 blocks
    
    if (blockHeight % adjustmentInterval !== 0) {
      return;
    }
    
    const latestBlock = this.getLatestBlock();
    const prevAdjustmentBlock = this.chain[Math.max(0, blockHeight - adjustmentInterval)];
    
    const timeExpected = this.targetBlockTime * adjustmentInterval;
    const timeTaken = (latestBlock.timestamp - prevAdjustmentBlock.timestamp) / 1000;
    
    // If blocks are being mined too quickly, increase difficulty
    if (timeTaken < timeExpected / 2) {
      this.difficulty += 1;
      console.log(`Increased difficulty to ${this.difficulty}`);
    } 
    // If blocks are being mined too slowly, decrease difficulty
    else if (timeTaken > timeExpected * 2) {
      this.difficulty = Math.max(1, this.difficulty - 1);
      console.log(`Decreased difficulty to ${this.difficulty}`);
    }
    
    this.lastDifficultyAdjustment = blockHeight;
  }

  /**
   * Get block by hash
   * @param {string} hash - Block hash
   * @returns {Block|null} - The block or null if not found
   */
  getBlockByHash(hash) {
    return this.chain.find(block => block.hash === hash) || null;
  }

  /**
   * Get block by height
   * @param {number} height - Block height
   * @returns {Block|null} - The block or null if not found
   */
  getBlockByHeight(height) {
    return height >= 0 && height < this.chain.length ? this.chain[height] : null;
  }

  /**
   * Get transaction by hash
   * @param {string} hash - Transaction hash
   * @returns {Transaction|null} - The transaction or null if not found
   */
  getTransactionByHash(hash) {
    // Search in blocks
    for (const block of this.chain) {
      for (const tx of block.transactions) {
        if (tx.hash === hash) {
          return tx;
        }
      }
    }
    
    // Search in pending transactions
    for (const tx of this.pendingTransactions) {
      if (tx.hash === hash) {
        return tx;
      }
    }
    
    return null;
  }

  /**
   * Get balance of an address
   * @param {string} address - Wallet address
   * @returns {number} - Current balance
   */
  getBalanceOfAddress(address) {
    let balance = 0;
    
    // Loop through all blocks and transactions
    for (const block of this.chain) {
      for (const trans of block.transactions) {
        // If this address is the sender, subtract the amount from the balance
        if (trans.fromAddress === address) {
          balance -= trans.amount;
          balance -= trans.fee;
        }
        
        // If this address is the recipient, add the amount to the balance
        if (trans.toAddress === address) {
          balance += trans.amount;
        }
      }
    }
    
    return balance;
  }

  /**
   * Verify if the blockchain is valid
   * @returns {boolean} - Whether the chain is valid
   */
  isChainValid() {
    // Check if the Genesis block hasn't been tampered with
    const realGenesis = JSON.stringify(this.chain[0]);
    const genesisBlock = this.createGenesisBlock();
    const fakeGenesis = JSON.stringify(genesisBlock);

    if (realGenesis !== fakeGenesis) {
      console.error('Genesis block has been tampered with');
      return false;
    }
    
    // Check the remaining blocks
    for (let i = 1; i < this.chain.length; i++) {
      const currentBlock = this.chain[i];
      const previousBlock = this.chain[i - 1];
      
      // Verify block hash
      if (currentBlock.hash !== currentBlock.calculateHash()) {
        console.error(`Block ${i} has invalid hash`);
        return false;
      }
      
      // Verify block points to correct previous block
      if (currentBlock.previousHash !== previousBlock.hash) {
        console.error(`Block ${i} has invalid previous hash`);
        return false;
      }
      
      // Verify block meets difficulty requirements
      const targetPrefix = '0'.repeat(currentBlock.difficulty);
      if (currentBlock.hash.substring(0, currentBlock.difficulty) !== targetPrefix) {
        console.error(`Block ${i} does not meet difficulty requirement`);
        return false;
      }
      
      // Verify all transactions in the block
      for (const tx of currentBlock.transactions) {
        if (!tx.isValid()) {
          console.error(`Block ${i} contains invalid transaction`);
          return false;
        }
      }
    }
    
    return true;
  }

  /**
   * Replace the chain with the given one if it's valid and longer
   * @param {Array} newChain - The new blockchain
   * @returns {boolean} - Whether the chain was replaced
   */
  replaceChain(newChain) {
    // Create a temporary blockchain to validate the new chain
    const tempBlockchain = new Blockchain();
    tempBlockchain.chain = newChain;
    
    // Check if the new chain is longer and valid
    if (newChain.length <= this.chain.length) {
      console.log('Received chain is not longer than the current chain');
      return false;
    }
    
    if (!tempBlockchain.isChainValid()) {
      console.log('Received chain is invalid');
      return false;
    }
    
    console.log('Replacing chain');
    this.chain = newChain;
    
    // Reset pending transactions
    this.pendingTransactions = [];
    
    this.emit('chainReplaced', this.chain);
    
    return true;
  }

  /**
   * Serialize blockchain for storage or transmission
   * @returns {object} - Serialized blockchain
   */
  serialize() {
    return {
      chain: this.chain.map(block => block.serialize()),
      difficulty: this.difficulty,
      pendingTransactions: this.pendingTransactions.map(tx => tx.serialize()),
      miningReward: this.miningReward,
      totalSupply: this.totalSupply,
      lastDifficultyAdjustment: this.lastDifficultyAdjustment,
      targetBlockTime: this.targetBlockTime,
      genesisTimestamp: this.genesisTimestamp
    };
  }

  /**
   * Create blockchain from serialized data
   * @param {object} data - Serialized blockchain data
   * @returns {Blockchain} - Reconstructed blockchain
   */
  static deserialize(data) {
    const blockchain = new Blockchain();
    
    blockchain.difficulty = data.difficulty;
    blockchain.pendingTransactions = data.pendingTransactions.map(tx => Transaction.deserialize(tx));
    blockchain.miningReward = data.miningReward;
    blockchain.totalSupply = data.totalSupply;
    blockchain.lastDifficultyAdjustment = data.lastDifficultyAdjustment;
    blockchain.targetBlockTime = data.targetBlockTime;
    blockchain.genesisTimestamp = data.genesisTimestamp;
    
    // Deserialize blocks
    blockchain.chain = data.chain.map(blockData => Block.deserialize(blockData));
    
    return blockchain;
  }
}

module.exports = Blockchain;