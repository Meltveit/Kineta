/**
 * API index.js - Export all API modules for Kineta blockchain
 */

const APIServer = require('./server');
const routes = {
  blockchain: require('./routes/blockchain'),
  transaction: require('./routes/transaction'),
  address: require('./routes/address'),
  node: require('./routes/node'),
  stats: require('./routes/stats'),
  swagger: require('./routes/swagger')
};
const middleware = {
  auth: require('./middleware/auth'),
  logger: require('./middleware/logger'),
  error: require('./middleware/error')
};

module.exports = {
  APIServer,
  routes,
  middleware
};