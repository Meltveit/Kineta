/**
 * Economic index.js - Export all economic modules for Kineta blockchain
 */

const EconomicModel = require('./economic-model');
const InflationModel = require('./inflation');
const GDPOracle = require('./gdp-oracle');
const RewardCalculator = require('./reward');
const FeeManager = require('./fee');

module.exports = {
  EconomicModel,
  InflationModel,
  GDPOracle,
  RewardCalculator,
  FeeManager
};