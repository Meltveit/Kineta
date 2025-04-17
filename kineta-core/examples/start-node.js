/**
 * Example: Start a Kineta node
 * 
 * This example shows how to start a Kineta node with API server.
 */

// Import Kineta
const Kineta = require('../index');

// Load configuration
const config = require('../config/default.json');

// Set miner address
config.mining.enabled = true;
config.mining.minerAddress = '1KgUMGwQbv7qjRgHvaNxY2mTs4XqSxftCF';

// Start a node with all components
async function startNode() {
  try {
    console.log('Starting Kineta node...');
    
    // Create and start node
    const { node, apiServer } = await Kineta.startNode(config);
    
    console.log(`Kineta node started successfully!`);
    console.log(`Blockchain height: ${node.blockchain.getLatestBlock().height}`);
    
    if (apiServer) {
      console.log(`API server running at http://localhost:${config.api.port}`);
      console.log(`API documentation available at http://localhost:${config.api.port}/docs`);
    }
    
    // Handle shutdown
    process.on('SIGINT', async () => {
      console.log('Shutting down...');
      
      // Stop API server if running
      if (apiServer) {
        await apiServer.stop();
      }
      
      // Stop node
      await node.stop();
      
      console.log('Node stopped successfully');
      process.exit(0);
    });
    
  } catch (error) {
    console.error('Failed to start node:', error.message);
    process.exit(1);
  }
}

// Run the node
startNode();