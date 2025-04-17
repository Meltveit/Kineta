/**
 * Consensus index.js - Export all consensus modules for Kineta blockchain
 */

const ProofOfWork = require('./proof-of-work');
const DifficultyAdjuster = require('./difficulty');
const Validator = require('./validation');

module.exports = {
  ProofOfWork,
  DifficultyAdjuster,
  Validator
};