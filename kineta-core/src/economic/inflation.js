/**
 * Inflation.js - BNP-linked inflation mechanism for Kineta blockchain
 * 
 * Implements:
 * - GDP-linked inflation calculation
 * - Minimum inflation floor (0.25%)
 * - Inflation adjustment periods
 * - Monetary policy controls
 */

const EventEmitter = require('events');

/**
 * Inflation model for Kineta blockchain
 * Core inflation formula: max(0.25%, GDP-growth + 0.25%)
 */
class InflationModel extends EventEmitter {
  /**
   * Initialize inflation model
   * @param {object} options - Configuration options
   * @param {number} options.baseRate - Minimum inflation rate (default: 0.25%)
   * @param {number} options.adjustmentBlocks - Blocks between adjustments (default: 123000 ≈ 6 months)
   * @param {number} options.initialInflation - Initial inflation rate (default: 2%)
   * @param {number} options.maxInflation - Maximum inflation rate (default: 10%)
   * @param {number} options.targetBlockTime - Target time between blocks in seconds (default: 123)
   */
  constructor(options = {}) {
    super();
    
    this.baseRate = options.baseRate !== undefined ? options.baseRate : 0.0025; // 0.25%
    this.adjustmentBlocks = options.adjustmentBlocks || 123000; // ~6 months with 123s blocks
    this.initialInflation = options.initialInflation !== undefined ? options.initialInflation : 0.02; // 2%
    this.maxInflation = options.maxInflation || 0.10; // 10% cap
    this.targetBlockTime = options.targetBlockTime || 123; // 123 seconds
    
    // Current state
    this.currentInflationRate = this.initialInflation;
    this.lastAdjustmentHeight = 0;
    this.gdpGrowthRate = 0;
    this.inflationHistory = [];
    
    // Save initial inflation point
    this.recordInflationPoint(0, this.initialInflation);
  }

  /**
   * Calculate inflation rate based on GDP growth
   * @param {number} gdpGrowth - Annual GDP growth rate (decimal, e.g., 0.03 for 3%)
   * @returns {number} - Calculated inflation rate
   */
  calculateInflationRate(gdpGrowth) {
    // Core formula: max(baseRate, gdpGrowth + baseRate)
    // This ensures minimum inflation even with negative GDP growth
    let inflationRate = Math.max(this.baseRate, gdpGrowth + this.baseRate);
    
    // Cap at maximum allowed inflation
    inflationRate = Math.min(inflationRate, this.maxInflation);
    
    return inflationRate;
  }

  /**
   * Update the inflation model with new GDP data
   * @param {number} gdpGrowth - Annual GDP growth rate (decimal)
   * @param {number} blockHeight - Current block height
   * @returns {boolean} - Whether inflation rate was updated
   */
  updateWithGDPData(gdpGrowth, blockHeight) {
    // Store GDP growth rate
    this.gdpGrowthRate = gdpGrowth;
    
    // Check if it's time for an adjustment
    if (blockHeight < this.lastAdjustmentHeight + this.adjustmentBlocks) {
      return false;
    }
    
    // Calculate new inflation rate
    const newInflationRate = this.calculateInflationRate(gdpGrowth);
    
    // If inflation rate changes significantly (>0.1%), log and emit event
    const change = Math.abs(newInflationRate - this.currentInflationRate);
    if (change > 0.001) { // 0.1%
      console.log(`Inflation adjusted from ${(this.currentInflationRate * 100).toFixed(2)}% to ${(newInflationRate * 100).toFixed(2)}% based on GDP growth of ${(gdpGrowth * 100).toFixed(2)}%`);
      
      this.emit('inflationAdjusted', {
        oldRate: this.currentInflationRate,
        newRate: newInflationRate,
        gdpGrowth: gdpGrowth,
        blockHeight: blockHeight
      });
    }
    
    // Update current inflation rate
    this.currentInflationRate = newInflationRate;
    this.lastAdjustmentHeight = blockHeight;
    
    // Record this inflation point
    this.recordInflationPoint(blockHeight, newInflationRate);
    
    return true;
  }

  /**
   * Record inflation data point for historical tracking
   * @param {number} blockHeight - Block height
   * @param {number} inflationRate - Inflation rate
   */
  recordInflationPoint(blockHeight, inflationRate) {
    this.inflationHistory.push({
      blockHeight,
      inflationRate,
      timestamp: Date.now(),
      gdpGrowth: this.gdpGrowthRate
    });
    
    // Limit history size to prevent memory issues
    if (this.inflationHistory.length > 100) {
      this.inflationHistory.shift();
    }
  }

  /**
   * Calculate the annual issuance based on current supply and inflation rate
   * @param {number} currentSupply - Current circulating supply
   * @returns {number} - Annual issuance amount
   */
  calculateAnnualIssuance(currentSupply) {
    return currentSupply * this.currentInflationRate;
  }

  /**
   * Calculate the per-block reward based on annual issuance
   * @param {number} currentSupply - Current circulating supply
   * @returns {number} - Block reward
   */
  calculateBlockReward(currentSupply) {
    const annualIssuance = this.calculateAnnualIssuance(currentSupply);
    const blocksPerYear = (365 * 24 * 60 * 60) / this.targetBlockTime;
    return annualIssuance / blocksPerYear;
  }

  /**
   * Calculate expected supply after a given number of years
   * @param {number} initialSupply - Initial supply
   * @param {number} years - Number of years
   * @param {number} inflationRate - Inflation rate (default: current rate)
   * @returns {number} - Expected supply after specified years
   */
  calculateExpectedSupply(initialSupply, years, inflationRate = this.currentInflationRate) {
    // Using compound interest formula: A = P(1 + r)^t
    return initialSupply * Math.pow(1 + inflationRate, years);
  }

  /**
   * Get inflation rate at a specific block height
   * @param {number} blockHeight - Block height
   * @returns {number} - Inflation rate at that height
   */
  getInflationRateAtHeight(blockHeight) {
    // If requested height is in the future, return current rate
    if (blockHeight >= this.lastAdjustmentHeight) {
      return this.currentInflationRate;
    }
    
    // Search inflation history
    for (let i = this.inflationHistory.length - 1; i >= 0; i--) {
      const point = this.inflationHistory[i];
      if (point.blockHeight <= blockHeight) {
        return point.inflationRate;
      }
    }
    
    // Default to initial inflation if no history found
    return this.initialInflation;
  }

  /**
   * Check if it's time for inflation adjustment
   * @param {number} blockHeight - Current block height
   * @returns {boolean} - Whether it's time for adjustment
   */
  isAdjustmentTime(blockHeight) {
    return blockHeight >= this.lastAdjustmentHeight + this.adjustmentBlocks;
  }

  /**
   * Get next adjustment block height
   * @returns {number} - Block height of next adjustment
   */
  getNextAdjustmentHeight() {
    return this.lastAdjustmentHeight + this.adjustmentBlocks;
  }

  /**
   * Calculate time remaining until next adjustment
   * @param {number} currentHeight - Current block height
   * @returns {object} - Time remaining in blocks and estimated time
   */
  getTimeUntilNextAdjustment(currentHeight) {
    const blocksRemaining = this.getNextAdjustmentHeight() - currentHeight;
    const secondsRemaining = blocksRemaining * this.targetBlockTime;
    
    return {
      blocksRemaining,
      secondsRemaining,
      daysRemaining: secondsRemaining / (24 * 60 * 60),
      estimatedDate: new Date(Date.now() + secondsRemaining * 1000)
    };
  }

  /**
   * Calculate the effective inflation rate given network hashrate changes
   * @param {number} targetBlockTime - Target time between blocks in seconds
   * @param {number} actualBlockTime - Actual average time between blocks
   * @returns {number} - Effective annual inflation rate
   */
  calculateEffectiveInflation(targetBlockTime, actualBlockTime) {
    // If blocks are being mined faster than target, effective inflation is higher
    const ratio = targetBlockTime / actualBlockTime;
    return this.currentInflationRate * ratio;
  }

  /**
   * Generate inflation forecast based on GDP growth scenarios
   * @param {number} currentSupply - Current circulating supply
   * @param {number} years - Number of years to forecast
   * @param {object} scenarios - GDP growth scenarios
   * @returns {object} - Inflation and supply forecasts for each scenario
   */
  generateInflationForecast(currentSupply, years = 5, scenarios = {
    low: -0.01,
    baseline: 0.02,
    high: 0.04
  }) {
    const forecast = {};
    
    for (const [name, gdpGrowth] of Object.entries(scenarios)) {
      const inflationRate = this.calculateInflationRate(gdpGrowth);
      const yearlySupply = [currentSupply];
      const yearlyInflation = [inflationRate];
      
      let supply = currentSupply;
      for (let i = 1; i <= years; i++) {
        supply = supply * (1 + inflationRate);
        yearlySupply.push(supply);
        yearlyInflation.push(inflationRate);
      }
      
      forecast[name] = {
        gdpGrowth,
        inflationRate,
        yearlySupply,
        yearlyInflation,
        totalIssuance: yearlySupply[years] - currentSupply,
        percentageIncrease: ((yearlySupply[years] / currentSupply) - 1) * 100
      };
    }
    
    return forecast;
  }

  /**
   * Get inflation statistics and history
   * @returns {object} - Inflation statistics
   */
  getInflationStats() {
    return {
      currentRate: this.currentInflationRate,
      baseRate: this.baseRate,
      gdpGrowthRate: this.gdpGrowthRate,
      lastAdjustmentHeight: this.lastAdjustmentHeight,
      nextAdjustmentHeight: this.getNextAdjustmentHeight(),
      adjustmentInterval: this.adjustmentBlocks,
      inflationHistory: this.inflationHistory,
      maxInflation: this.maxInflation
    };
  }

  /**
   * Serialize inflation model state
   * @returns {object} - Serialized state
   */
  serialize() {
    return {
      baseRate: this.baseRate,
      adjustmentBlocks: this.adjustmentBlocks,
      initialInflation: this.initialInflation,
      maxInflation: this.maxInflation,
      targetBlockTime: this.targetBlockTime,
      currentInflationRate: this.currentInflationRate,
      lastAdjustmentHeight: this.lastAdjustmentHeight,
      gdpGrowthRate: this.gdpGrowthRate,
      inflationHistory: this.inflationHistory
    };
  }

  /**
   * Create inflation model from serialized state
   * @param {object} data - Serialized inflation model
   * @returns {InflationModel} - Reconstructed inflation model
   */
  static deserialize(data) {
    const model = new InflationModel({
      baseRate: data.baseRate,
      adjustmentBlocks: data.adjustmentBlocks,
      initialInflation: data.initialInflation,
      maxInflation: data.maxInflation,
      targetBlockTime: data.targetBlockTime
    });
    
    model.currentInflationRate = data.currentInflationRate;
    model.lastAdjustmentHeight = data.lastAdjustmentHeight;
    model.gdpGrowthRate = data.gdpGrowthRate;
    model.inflationHistory = data.inflationHistory;
    
    return model;
  }
}

module.exports = InflationModel;