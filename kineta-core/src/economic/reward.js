/**
 * Reward.js - Block reward calculation for Kineta blockchain
 * 
 * Implements:
 * - Dynamic block reward calculation based on inflation model
 * - Reward halving and decay models
 * - Special reward distribution rules
 * - Reward history and projection
 */

const EventEmitter = require('events');

/**
 * Block reward calculator for Kineta blockchain
 */
class RewardCalculator extends EventEmitter {
  /**
   * Initialize reward calculator
   * @param {object} options - Configuration options
   * @param {object} options.inflationModel - Reference to inflation model
   * @param {number} options.targetBlockTime - Target time between blocks in seconds (default: 123)
   * @param {number} options.initialSupply - Initial supply (default: 123,456,789)
   * @param {number} options.minReward - Minimum block reward (default: 0.001)
   * @param {number} options.developmentFund - Development fund percentage (default: 5%)
   */
  constructor(options = {}) {
    super();
    
    this.inflationModel = options.inflationModel;
    this.targetBlockTime = options.targetBlockTime || 123; // 123 seconds
    this.initialSupply = options.initialSupply || 123456789; // Initial Kineta supply
    this.minReward = options.minReward || 0.001; // Minimum reward 0.001 KIN
    this.developmentFund = options.developmentFund || 0.05; // 5% to development fund
    
    // Working state
    this.lastCalculatedHeight = 0;
    this.lastCalculatedReward = 0;
    this.currentSupply = this.initialSupply;
    this.rewardHistory = [];
    
    // Record initial reward
    if (this.inflationModel) {
      const initialReward = this.calculateRewardInternal(0, this.initialSupply);
      this.recordRewardPoint(0, initialReward);
    }
  }

  /**
   * Calculate block reward for a given height and supply
   * @param {number} blockHeight - Block height
   * @param {number} currentSupply - Current circulating supply
   * @returns {object} - Reward breakdown
   */
  calculateReward(blockHeight, currentSupply) {
    const totalReward = this.calculateRewardInternal(blockHeight, currentSupply);
    
    // Calculate development fund portion
    const devFundAmount = totalReward * this.developmentFund;
    const minerReward = totalReward - devFundAmount;
    
    // Record reward in history if it's a new height
    if (blockHeight > this.lastCalculatedHeight) {
      this.recordRewardPoint(blockHeight, totalReward);
    }
    
    // Update state
    this.lastCalculatedHeight = blockHeight;
    this.lastCalculatedReward = totalReward;
    this.currentSupply = currentSupply + totalReward;
    
    return {
      total: totalReward,
      miner: minerReward,
      developmentFund: devFundAmount
    };
  }

  /**
   * Internal reward calculation
   * @param {number} blockHeight - Block height
   * @param {number} currentSupply - Current circulating supply
   * @returns {number} - Block reward
   * @private
   */
  calculateRewardInternal(blockHeight, currentSupply) {
    // If no inflation model provided, use a basic decay model
    if (!this.inflationModel) {
      return this.calculateLegacyReward(blockHeight);
    }
    
    // Calculate based on inflation model
    const inflationRate = this.inflationModel.getInflationRateAtHeight(blockHeight);
    const annualIssuance = currentSupply * inflationRate;
    const blocksPerYear = (365 * 24 * 60 * 60) / this.targetBlockTime;
    let reward = annualIssuance / blocksPerYear;
    
    // Ensure minimum reward
    reward = Math.max(reward, this.minReward);
    
    return reward;
  }

  /**
   * Legacy reward calculation (fallback if no inflation model)
   * @param {number} blockHeight - Block height
   * @returns {number} - Block reward
   * @private
   */
  calculateLegacyReward(blockHeight) {
    // Initial reward
    const initialReward = 50;
    
    // Adjust every 1,050,000 blocks (approximately 4 years with 123s blocks)
    const adjustmentInterval = 1050000;
    
    // Calculate decay factor (15% reduction each period)
    const period = Math.floor(blockHeight / adjustmentInterval);
    const decayFactor = Math.pow(0.85, period);
    
    // Calculate reward with decay
    let reward = initialReward * decayFactor;
    
    // Ensure minimum reward
    reward = Math.max(reward, this.minReward);
    
    return reward;
  }

  /**
   * Record block reward in history
   * @param {number} blockHeight - Block height
   * @param {number} reward - Block reward
   * @private
   */
  recordRewardPoint(blockHeight, reward) {
    this.rewardHistory.push({
      blockHeight,
      reward,
      timestamp: Date.now(),
      supply: this.currentSupply
    });
    
    // Keep history size manageable
    if (this.rewardHistory.length > 100) {
      this.rewardHistory.shift();
    }
    
    this.emit('rewardCalculated', {
      blockHeight,
      reward,
      supply: this.currentSupply
    });
  }

  /**
   * Calculate the expected block reward at a future height
   * @param {number} targetHeight - Target block height
   * @param {number} startingSupply - Supply to start calculation from (default: current)
   * @returns {number} - Projected block reward
   */
  projectRewardAtHeight(targetHeight, startingSupply = this.currentSupply) {
    if (targetHeight < this.lastCalculatedHeight) {
      // Find in history
      for (let i = this.rewardHistory.length - 1; i >= 0; i--) {
        if (this.rewardHistory[i].blockHeight === targetHeight) {
          return this.rewardHistory[i].reward;
        }
      }
    }
    
    // Project future reward
    if (!this.inflationModel) {
      return this.calculateLegacyReward(targetHeight);
    }
    
    // For future projection, we need to estimate future supply
    let projectedSupply = startingSupply;
    let currentHeight = this.lastCalculatedHeight;
    
    // If projection is far in the future, use broader steps
    const stepSize = Math.max(1, Math.floor((targetHeight - currentHeight) / 1000));
    
    while (currentHeight < targetHeight) {
      const nextHeight = Math.min(targetHeight, currentHeight + stepSize);
      const blockCount = nextHeight - currentHeight;
      
      const inflationRate = this.inflationModel.getInflationRateAtHeight(currentHeight);
      const annualIssuance = projectedSupply * inflationRate;
      const blocksPerYear = (365 * 24 * 60 * 60) / this.targetBlockTime;
      const rewardPerBlock = annualIssuance / blocksPerYear;
      
      // Add new supply from these blocks
      projectedSupply += rewardPerBlock * blockCount;
      currentHeight = nextHeight;
    }
    
    // Calculate final reward based on projected supply
    return this.calculateRewardInternal(targetHeight, projectedSupply);
  }

  /**
   * Project future supply based on inflation model
   * @param {number} blocks - Number of blocks to project forward
   * @returns {object} - Projection results
   */
  projectFutureSupply(blocks = 1050000) { // Default ~4 years
    const startHeight = this.lastCalculatedHeight;
    const startSupply = this.currentSupply;
    let projectedSupply = startSupply;
    
    const projectionPoints = [];
    const yearInBlocks = (365 * 24 * 60 * 60) / this.targetBlockTime;
    const interval = Math.max(1, Math.floor(blocks / 100)); // 100 data points
    
    for (let height = startHeight; height <= startHeight + blocks; height += interval) {
      const reward = this.calculateRewardInternal(height, projectedSupply);
      projectedSupply += reward * interval;
      
      projectionPoints.push({
        blockHeight: height,
        supply: projectedSupply,
        reward,
        yearsFromGenesis: height * this.targetBlockTime / (365 * 24 * 60 * 60),
        inflationRate: this.inflationModel
          ? this.inflationModel.getInflationRateAtHeight(height)
          : null
      });
    }
    
    const finalInflationRate = this.inflationModel
      ? this.inflationModel.getInflationRateAtHeight(startHeight + blocks)
      : null;
    
    return {
      initialSupply: startSupply,
      finalSupply: projectedSupply,
      issuance: projectedSupply - startSupply,
      percentageIncrease: ((projectedSupply / startSupply) - 1) * 100,
      projectedYears: blocks * this.targetBlockTime / (365 * 24 * 60 * 60),
      finalInflationRate,
      projectionPoints
    };
  }

  /**
   * Distribute a block reward according to Kineta distribution rules
   * @param {number} blockHeight - Block height
   * @param {string} minerAddress - Miner's address
   * @param {string} devFundAddress - Development fund address
   * @param {number} currentSupply - Current circulating supply
   * @returns {object} - Distribution details and transactions
   */
  distributeBlockReward(blockHeight, minerAddress, devFundAddress, currentSupply) {
    const rewardInfo = this.calculateReward(blockHeight, currentSupply);
    
    // Create reward objects (these would be converted to transactions later)
    const distribution = {
      blockHeight,
      timestamp: Date.now(),
      totalReward: rewardInfo.total,
      recipients: [
        {
          address: minerAddress,
          amount: rewardInfo.miner,
          type: 'miner'
        }
      ]
    };
    
    // Add development fund if applicable
    if (rewardInfo.developmentFund > 0) {
      distribution.recipients.push({
        address: devFundAddress,
        amount: rewardInfo.developmentFund,
        type: 'development_fund'
      });
    }
    
    this.emit('rewardDistributed', distribution);
    
    return distribution;
  }

  /**
   * Get reward statistics and history
   * @returns {object} - Reward statistics
   */
  getRewardStats() {
    return {
      lastCalculatedHeight: this.lastCalculatedHeight,
      lastCalculatedReward: this.lastCalculatedReward,
      currentSupply: this.currentSupply,
      rewardHistory: this.rewardHistory,
      developmentFundPercentage: this.developmentFund * 100,
      targetBlockTime: this.targetBlockTime,
      blocksPerYear: (365 * 24 * 60 * 60) / this.targetBlockTime,
      inflationRate: this.inflationModel 
        ? this.inflationModel.getCurrentInflationRate()
        : null
    };
  }

  /**
   * Calculate total rewards distributed so far
   * @returns {object} - Issuance statistics
   */
  getTotalIssuance() {
    const issuance = this.currentSupply - this.initialSupply;
    const devFundIssuance = issuance * this.developmentFund;
    const minerIssuance = issuance - devFundIssuance;
    
    return {
      totalIssuance: issuance,
      minerIssuance,
      developmentFundIssuance: devFundIssuance,
      percentageIncrease: (issuance / this.initialSupply) * 100
    };
  }

  /**
   * Serialize reward calculator state
   * @returns {object} - Serialized state
   */
  serialize() {
    return {
      targetBlockTime: this.targetBlockTime,
      initialSupply: this.initialSupply,
      minReward: this.minReward,
      developmentFund: this.developmentFund,
      lastCalculatedHeight: this.lastCalculatedHeight,
      lastCalculatedReward: this.lastCalculatedReward,
      currentSupply: this.currentSupply,
      rewardHistory: this.rewardHistory
    };
  }

  /**
   * Create reward calculator from serialized state
   * @param {object} data - Serialized reward calculator
   * @param {object} inflationModel - Inflation model reference
   * @returns {RewardCalculator} - Reconstructed reward calculator
   */
  static deserialize(data, inflationModel = null) {
    const calculator = new RewardCalculator({
      inflationModel,
      targetBlockTime: data.targetBlockTime,
      initialSupply: data.initialSupply,
      minReward: data.minReward,
      developmentFund: data.developmentFund
    });
    
    calculator.lastCalculatedHeight = data.lastCalculatedHeight;
    calculator.lastCalculatedReward = data.lastCalculatedReward;
    calculator.currentSupply = data.currentSupply;
    calculator.rewardHistory = data.rewardHistory;
    
    return calculator;
  }
}

module.exports = RewardCalculator;