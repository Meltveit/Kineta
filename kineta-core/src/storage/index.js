/**
 * Storage index.js - Export all storage modules for Kineta blockchain
 */

const Database = require('./database');
const ChainStore = require('./chain-store');

module.exports = {
  Database,
  ChainStore
};