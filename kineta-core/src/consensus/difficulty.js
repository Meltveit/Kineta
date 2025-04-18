/**
 * Difficulty.js - Difficulty adjustment for Kineta blockchain
 * 
 * Implements:
 * - Difficulty adjustment algorithm
 * - Block time target maintenance
 * - Protection against difficulty manipulation
 * - Difficulty history and prediction
 */

const EventEmitter = require('events');
const { ECONOMIC_CONSTANTS } = require('../economic/economic-parameters');

/**
 * Difficulty adjustment mechanism for Kineta blockchain
 */
class DifficultyAdjuster extends EventEmitter {
  /**
   * Initialize difficulty adjuster
   * @param {object} options - Configuration options
   * @param {number} options.targetBlockTime - Target time between blocks in seconds (default: 123)
   * @param {number} options.adjustmentInterval - Blocks between adjustments (default: 1008, ~3.5 days with 123s blocks)
   * @param {number} options.maxAdjustmentFactor - Maximum adjustment factor (default: 4)
   * @param {number} options.emergencyAdjustmentThreshold - Threshold for emergency adjustment (default: 8)
   * @param {number} options.initialDifficulty - Initial difficulty (default: 4)
   * @param {number} options.minimumDifficulty - Minimum difficulty (default: 1)
   */
  constructor(options = {}) {
    super();
    
    this.targetBlockTime = options.targetBlockTime || ECONOMIC_CONSTANTS.DIFFICULTY.TARGET_BLOCK_TIME;
    this.adjustmentInterval = options.adjustmentInterval || ECONOMIC_CONSTANTS.DIFFICULTY.ADJUSTMENT_INTERVAL;
    this.maxAdjustmentFactor = options.maxAdjustmentFactor || ECONOMIC_CONSTANTS.DIFFICULTY.MAX_ADJUSTMENT_FACTOR;
    this.emergencyAdjustmentThreshold = options.emergencyAdjustmentThreshold || 8;
    this.initialDifficulty = options.initialDifficulty || ECONOMIC_CONSTANTS.DIFFICULTY.INITIAL_DIFFICULTY;
    this.minimumDifficulty = options.minimumDifficulty || 1;
    
    // Working state
    this.lastAdjustmentHeight = 0;
    this.currentDifficulty = this.initialDifficulty;
    this.difficultyHistory = [];
    
    // Record initial difficulty
    this.recordDifficultyPoint(0, this.initialDifficulty);
  }

  /**
   * Calculate next difficulty based on recent block times
   * @param {Array} blocks - Recent blocks with timestamps
   * @returns {number} - New difficulty
   */
  calculateNextDifficulty(blocks) {
    // Get the block at the last adjustment point
    const currentHeight = blocks[blocks.length - 1].height;
    
    // If not enough blocks, or not at adjustment point, maintain current difficulty
    if (blocks.length < 2 || 
        (currentHeight % this.adjustmentInterval !== 0 && 
         !this.needsEmergencyAdjustment(blocks))) {
      return this.currentDifficulty;
    }
    
    // Get relevant blocks for the calculation
    let adjustmentBlocks;
    let isEmergencyAdjustment = false;
    
    // Check if we need an emergency adjustment
    if (this.needsEmergencyAdjustment(blocks)) {
      // Use recent blocks for emergency adjustment
      const recentBlockCount = Math.min(blocks.length, 10);
      adjustmentBlocks = blocks.slice(blocks.length - recentBlockCount);
      isEmergencyAdjustment = true;
    } else {
      // Regular adjustment: use blocks since last adjustment
      const lastAdjustmentIndex = blocks.findIndex(block => 
        block.height <= this.lastAdjustmentHeight
      );
      
      if (lastAdjustmentIndex === -1) {
        // If can't find last adjustment block, use all available blocks
        adjustmentBlocks = blocks;
      } else {
        adjustmentBlocks = blocks.slice(0, lastAdjustmentIndex + 1);
      }
    }
    
    // Calculate actual time taken
    const newest = adjustmentBlocks[0];
    const oldest = adjustmentBlocks[adjustmentBlocks.length - 1];
    const timeDifferenceSeconds = (newest.timestamp - oldest.timestamp) / 1000;
    const blockCount = newest.height - oldest.height;
    
    if (blockCount <= 0 || timeDifferenceSeconds <= 0) {
      return this.currentDifficulty; // Invalid data, maintain current difficulty
    }
    
    // Calculate average block time
    const averageBlockTime = timeDifferenceSeconds / blockCount;
    
    // Calculate adjustment factor
    let adjustmentFactor = this.targetBlockTime / averageBlockTime;
    
    // Limit adjustment factor
    const maxFactor = isEmergencyAdjustment 
      ? this.emergencyAdjustmentThreshold 
      : this.maxAdjustmentFactor;
    
    adjustmentFactor = Math.max(1 / maxFactor, Math.min(maxFactor, adjustmentFactor));
    
    // Calculate new difficulty
    let newDifficulty = this.currentDifficulty * adjustmentFactor;
    
    // Ensure minimum difficulty
    newDifficulty = Math.max(this.minimumDifficulty, newDifficulty);
    
    // Round to 3 decimal places for stability
    newDifficulty = Math.round(newDifficulty * 1000) / 1000;
    
    return newDifficulty;
  }

  /**
   * Check if emergency difficulty adjustment is needed
   * @param {Array} blocks - Recent blocks with timestamps
   * @returns {boolean} - Whether emergency adjustment is needed
   * @private
   */
  needsEmergencyAdjustment(blocks) {
    // Need at least 5 blocks to detect emergency
    if (blocks.length < 5) return false;
    
    // Calculate average time for last 5 blocks
    const recentBlocks = blocks.slice(0, 5);
    const newest = recentBlocks[0];
    const oldest = recentBlocks[recentBlocks.length - 1];
    const timeDifferenceSeconds = (newest.timestamp - oldest.timestamp) / 1000;
    const blockCount = newest.height - oldest.height;
    
    if (blockCount <= 0) return false;
    
    const averageBlockTime = timeDifferenceSeconds / blockCount;
    const ratio = averageBlockTime / this.targetBlockTime;
    
    // Emergency if blocks are being mined way too fast or way too slow
    return ratio > this.emergencyAdjustmentThreshold || ratio < 1 / this.emergencyAdjustmentThreshold;
  }

  /**
   * Apply difficulty adjustment if needed
   * @param {Array} blocks - Recent blocks with timestamps
   * @param {number} currentHeight - Current block height
   * @returns {number} - New difficulty or current if no adjustment needed
   */
  adjustDifficulty(blocks, currentHeight) {
    // Only adjust at adjustment interval or emergency
    if (currentHeight % this.adjustmentInterval !== 0 && !this.needsEmergencyAdjustment(blocks)) {
      return this.currentDifficulty;
    }
    
    const oldDifficulty = this.currentDifficulty;
    const newDifficulty = this.calculateNextDifficulty(blocks);
    
    // Update state if difficulty changed
    if (newDifficulty !== oldDifficulty) {
      this.lastAdjustmentHeight = currentHeight;
      this.currentDifficulty = newDifficulty;
      
      // Record this difficulty adjustment
      this.recordDifficultyPoint(currentHeight, newDifficulty);
      
      const adjustmentType = currentHeight % this.adjustmentInterval === 0 
        ? 'regular' : 'emergency';
      
      this.emit('difficultyAdjusted', {
        oldDifficulty,
        newDifficulty,
        blockHeight: currentHeight,
        adjustmentType,
        percentChange: ((newDifficulty / oldDifficulty) - 1) * 100
      });
    }
    
    return newDifficulty;
  }

  /**
   * Record difficulty adjustment in history
   * @param {number} blockHeight - Block height
   * @param {number} difficulty - New difficulty
   * @private
   */
  recordDifficultyPoint(blockHeight, difficulty) {
    this.difficultyHistory.push({
      blockHeight,
      difficulty,
      timestamp: Date.now()
    });
    
    // Keep history manageable
    if (this.difficultyHistory.length > 50) {
      this.difficultyHistory.shift();
    }
  }

  /**
   * Get difficulty at a specific block height
   * @param {number} blockHeight - Block height
   * @returns {number} - Difficulty at that height
   */
  getDifficultyAtHeight(blockHeight) {
    // If requested height is in the future, return current difficulty
    if (blockHeight >= this.lastAdjustmentHeight) {
      return this.currentDifficulty;
    }
    
    // Search difficulty history
    for (let i = this.difficultyHistory.length - 1; i >= 0; i--) {
      const point = this.difficultyHistory[i];
      if (point.blockHeight <= blockHeight) {
        return point.difficulty;
      }
    }
    
    // Default to initial difficulty if no history found
    return this.initialDifficulty;
  }

  /**
   * Calculate block target (hash threshold) from difficulty
   * @param {number} difficulty - Mining difficulty
   * @returns {string} - Target hash as hex string
   */
  calculateTarget(difficulty) {
    // Maximum target (lowest difficulty)
    const maxTarget = '0x00000000ffff0000000000000000000000000000000000000000000000000000';
    
    // Convert max target to bigint
    const maxTargetBigInt = BigInt(maxTarget);
    
    // Calculate current target based on difficulty
    const currentTargetBigInt = maxTargetBigInt / BigInt(Math.floor(difficulty * 1000000));
    
    // Convert back to hex string
    let targetHex = currentTargetBigInt.toString(16);
    
    // Ensure proper length (64 characters)
    while (targetHex.length < 64) {
      targetHex = '0' + targetHex;
    }
    
    return '0x' + targetHex;
  }

  /**
   * Calculate difficulty from a hash target
   * @param {string} target - Target hash as hex string
   * @returns {number} - Corresponding difficulty
   */
  calculateDifficultyFromTarget(target) {
    // Maximum target (lowest difficulty)
    const maxTarget = '0x00000000ffff0000000000000000000000000000000000000000000000000000';
    
    // Convert to bigints
    const maxTargetBigInt = BigInt(maxTarget);
    const targetBigInt = BigInt(target);
    
    if (targetBigInt === 0n) {
      return Infinity; // Impossible target
    }
    
    // Calculate difficulty
    const difficultyBigInt = maxTargetBigInt / targetBigInt;
    const difficulty = Number(difficultyBigInt) / 1000000;
    
    return Math.max(this.minimumDifficulty, difficulty);
  }

  /**
   * Calculate expected time to next adjustment
   * @param {number} currentHeight - Current block height
   * @param {number} averageBlockTime - Average time between blocks
   * @returns {object} - Time remaining info
   */
  calculateTimeToNextAdjustment(currentHeight, averageBlockTime) {
    // Calculate blocks until next adjustment
    const nextAdjustmentHeight = Math.ceil(currentHeight / this.adjustmentInterval) * this.adjustmentInterval;
    const blocksRemaining = nextAdjustmentHeight - currentHeight;
    
    // Calculate time
    const secondsRemaining = blocksRemaining * (averageBlockTime || this.targetBlockTime);
    
    return {
      blocksRemaining,
      secondsRemaining,
      hoursRemaining: secondsRemaining / 3600,
      daysRemaining: secondsRemaining / (3600 * 24),
      estimatedAdjustmentTime: new Date(Date.now() + secondsRemaining * 1000)
    };
  }

  /**
   * Predict future difficulty based on recent hashrate trend
   * @param {number} averageBlockTime - Recent average block time
   * @param {number} periods - Number of adjustment periods to predict
   * @returns {Array} - Predicted difficulties
   */
  predictFutureDifficulty(averageBlockTime, periods = 3) {
    const predictions = [];
    let predictedDifficulty = this.currentDifficulty;
    let predictedBlockTime = averageBlockTime;
    
    for (let i = 0; i < periods; i++) {
      // Calculate adjustment factor
      const adjustmentFactor = this.targetBlockTime / predictedBlockTime;
      
      // Apply limits
      const limitedFactor = Math.max(
        1 / this.maxAdjustmentFactor,
        Math.min(this.maxAdjustmentFactor, adjustmentFactor)
      );
      
      // Calculate new difficulty
      predictedDifficulty = predictedDifficulty * limitedFactor;
      predictedDifficulty = Math.max(this.minimumDifficulty, predictedDifficulty);
      predictedDifficulty = Math.round(predictedDifficulty * 1000) / 1000;
      
      // Assume block time will adjust towards target
      predictedBlockTime = predictedBlockTime / limitedFactor;
      
      // Add to predictions
      predictions.push({
        period: i + 1,
        difficulty: predictedDifficulty,
        expectedBlockTime: predictedBlockTime
      });
    }
    
    return predictions;
  }

  /**
   * Get difficulty statistics and history
   * @returns {object} - Difficulty statistics
   */
  getDifficultyStats() {
    return {
      currentDifficulty: this.currentDifficulty,
      lastAdjustmentHeight: this.lastAdjustmentHeight,
      targetBlockTime: this.targetBlockTime,
      adjustmentInterval: this.adjustmentInterval,
      difficultyHistory: this.difficultyHistory,
      minimumDifficulty: this.minimumDifficulty
    };
  }

  /**
   * Calculate a simple weighted average of recent block times
   * @param {Array} blocks - Recent blocks with timestamps
   * @param {number} count - Number of blocks to include
   * @returns {number} - Average block time in seconds
   */
  calculateAverageBlockTime(blocks, count = 10) {
    // Ensure we have enough blocks
    if (blocks.length < 2) {
      return this.targetBlockTime;
    }
    
    // Limit to requested count
    const recentBlocks = blocks.slice(0, Math.min(blocks.length, count));
    
    // Calculate times between blocks
    const timeDiffs = [];
    for (let i = 0; i < recentBlocks.length - 1; i++) {
      const timeDiff = (recentBlocks[i].timestamp - recentBlocks[i + 1].timestamp) / 1000;
      if (timeDiff > 0) {
        timeDiffs.push(timeDiff);
      }
    }
    
    if (timeDiffs.length === 0) {
      return this.targetBlockTime;
    }
    
    // Calculate weighted average (more recent blocks have higher weight)
    let totalWeight = 0;
    let weightedSum = 0;
    
    for (let i = 0; i < timeDiffs.length; i++) {
      const weight = timeDiffs.length - i;
      weightedSum += timeDiffs[i] * weight;
      totalWeight += weight;
    }
    
    return weightedSum / totalWeight;
  }

  /**
   * Check if a difficulty value is valid for consensus rules
   * @param {number} difficulty - Difficulty to check
   * @param {number} previousDifficulty - Previous difficulty
   * @param {number} blockHeight - Block height
   * @returns {boolean} - Whether the difficulty is valid
   */
  isValidDifficulty(difficulty, previousDifficulty, blockHeight) {
    // Ensure minimum difficulty
    if (difficulty < this.minimumDifficulty) {
      return false;
    }
    
    // At adjustment points, validate change is within limits
    if (blockHeight % this.adjustmentInterval === 0) {
      const ratio = difficulty / previousDifficulty;
      return ratio >= 1 / this.maxAdjustmentFactor && ratio <= this.maxAdjustmentFactor;
    }
    
    // Outside of adjustment points, difficulty should remain the same
    // (except for emergency adjustments, which are hardest to validate without full history)
    return Math.abs(difficulty - previousDifficulty) < 0.001;
  }

  /**
   * Get the next adjustment height
   * @param {number} currentHeight - Current block height
   * @returns {number} - Next adjustment height
   */
  getNextAdjustmentHeight(currentHeight = this.lastAdjustmentHeight) {
    return Math.ceil(currentHeight / this.adjustmentInterval) * this.adjustmentInterval;
  }

  /**
   * Serialize difficulty adjuster state
   * @returns {object} - Serialized state
   */
  serialize() {
    return {
      targetBlockTime: this.targetBlockTime,
      adjustmentInterval: this.adjustmentInterval,
      maxAdjustmentFactor: this.maxAdjustmentFactor,
      emergencyAdjustmentThreshold: this.emergencyAdjustmentThreshold,
      initialDifficulty: this.initialDifficulty,
      minimumDifficulty: this.minimumDifficulty,
      lastAdjustmentHeight: this.lastAdjustmentHeight,
      currentDifficulty: this.currentDifficulty,
      difficultyHistory: this.difficultyHistory
    };
  }

  /**
   * Create difficulty adjuster from serialized state
   * @param {object} data - Serialized state
   * @returns {DifficultyAdjuster} - Reconstructed difficulty adjuster
   */
  static deserialize(data) {
    const adjuster = new DifficultyAdjuster({
      targetBlockTime: data.targetBlockTime,
      adjustmentInterval: data.adjustmentInterval,
      maxAdjustmentFactor: data.maxAdjustmentFactor,
      emergencyAdjustmentThreshold: data.emergencyAdjustmentThreshold,
      initialDifficulty: data.initialDifficulty,
      minimumDifficulty: data.minimumDifficulty
    });
    
    adjuster.lastAdjustmentHeight = data.lastAdjustmentHeight;
    adjuster.currentDifficulty = data.currentDifficulty;
    adjuster.difficultyHistory = data.difficultyHistory;
    
    return adjuster;
  }
}

module.exports = DifficultyAdjuster;