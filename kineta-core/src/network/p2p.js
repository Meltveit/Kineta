/**
 * P2P.js - Peer-to-peer communication for Kineta blockchain
 * 
 * Implements:
 * - Peer discovery and management
 * - P2P message protocol
 * - Data propagation (blocks, transactions)
 * - Network health monitoring
 */

const EventEmitter = require('events');
const WebSocket = require('ws');
const crypto = require('crypto');
const os = require('os');

// Message types
const MESSAGE_TYPES = {
  HANDSHAKE: 'HANDSHAKE',
  PING: 'PING',
  PONG: 'PONG',
  GET_PEERS: 'GET_PEERS',
  PEERS: 'PEERS',
  GET_BLOCKS: 'GET_BLOCKS',
  BLOCKS: 'BLOCKS',
  GET_BLOCK: 'GET_BLOCK',
  BLOCK: 'BLOCK',
  NEW_BLOCK: 'NEW_BLOCK',
  GET_TRANSACTION: 'GET_TRANSACTION',
  TRANSACTION: 'TRANSACTION',
  NEW_TRANSACTION: 'NEW_TRANSACTION',
  GET_MEMPOOL: 'GET_MEMPOOL',
  MEMPOOL: 'MEMPOOL',
  ERROR: 'ERROR'
};

/**
 * P2P network manager for Kineta blockchain
 */
class P2PManager extends EventEmitter {
  /**
   * Initialize P2P network manager
   * @param {object} options - Configuration options
   * @param {number} options.port - Port to listen on (default: 6001)
   * @param {Array} options.seedNodes - List of seed nodes to connect to
   * @param {object} options.blockchain - Blockchain reference
   * @param {object} options.mempool - Mempool reference
   * @param {string} options.networkID - Network identifier (mainnet/testnet)
   * @param {number} options.maxPeers - Maximum number of peers to connect to (default: 20)
   * @param {number} options.minPeers - Minimum number of peers to maintain (default: 8)
   * @param {string} options.version - Protocol version (default: 1.0.0)
   */
  constructor(options = {}) {
    super();
    
    this.port = options.port || 6001;
    this.seedNodes = options.seedNodes || [];
    this.blockchain = options.blockchain;
    this.mempool = options.mempool;
    this.networkID = options.networkID || 'mainnet';
    this.maxPeers = options.maxPeers || 20;
    this.minPeers = options.minPeers || 8;
    this.version = options.version || '1.0.0';
    
    // Generate a unique node ID
    this.nodeId = this.generateNodeId();
    
    // Map of connected peers
    this.peers = new Map(); // Address -> {socket, info}
    
    // Map of banned peers
    this.bannedPeers = new Map(); // Address -> {reason, timestamp}
    
    // Map of peer scores for reputation management
    this.peerScores = new Map(); // Address -> score
    
    // WebSocket server
    this.server = null;
    
    // Intervals
    this.pingInterval = null;
    this.discoveryInterval = null;
    this.cleanupInterval = null;
    
    // Network statistics
    this.stats = {
      connectedPeers: 0,
      inboundConnections: 0,
      outboundConnections: 0,
      messagesReceived: 0,
      messagesSent: 0,
      bytesReceived: 0,
      bytesSent: 0,
      startTime: Date.now()
    };
  }

  /**
   * Generate unique node ID
   * @returns {string} - Unique node ID
   * @private
   */
  generateNodeId() {
    // Get machine information
    const networkInterfaces = os.networkInterfaces();
    let macAddress = '';
    
    // Extract the MAC address of the first Ethernet or WiFi interface
    for (const interfaceName in networkInterfaces) {
      const interfaces = networkInterfaces[interfaceName];
      for (const iface of interfaces) {
        if (!iface.internal) {
          macAddress = iface.mac;
          break;
        }
      }
      if (macAddress) break;
    }
    
    // Generate an ID using MAC address and a random component
    const randomBytes = crypto.randomBytes(16).toString('hex');
    const nodeId = crypto.createHash('sha256')
      .update(`${macAddress}-${randomBytes}-${Date.now()}`)
      .digest('hex');
    
    return nodeId;
  }

  /**
   * Start the P2P network
   * @returns {Promise} - Resolves when network is started
   */
  async start() {
    try {
      // Start WebSocket server
      await this.startServer();
      
      // Connect to seed nodes
      await this.connectToSeedNodes();
      
      // Start intervals
      this.startIntervals();
      
      this.emit('started', {
        nodeId: this.nodeId,
        port: this.port,
        networkID: this.networkID
      });
      
      return true;
    } catch (error) {
      console.error('Failed to start P2P network:', error.message);
      this.emit('error', error);
      return false;
    }
  }

  /**
   * Stop the P2P network
   */
  stop() {
    // Clear intervals
    clearInterval(this.pingInterval);
    clearInterval(this.discoveryInterval);
    clearInterval(this.cleanupInterval);
    
    // Close all peer connections
    for (const peer of this.peers.values()) {
      if (peer.socket && peer.socket.readyState === WebSocket.OPEN) {
        peer.socket.close();
      }
    }
    
    // Close server
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    
    // Reset state
    this.peers.clear();
    this.peerScores.clear();
    
    this.emit('stopped');
  }

  /**
   * Start WebSocket server
   * @returns {Promise} - Resolves when server is started
   * @private
   */
  startServer() {
    return new Promise((resolve, reject) => {
      this.server = new WebSocket.Server({ port: this.port });
      
      this.server.on('connection', (socket, request) => {
        this.handleConnection(socket, request, 'inbound');
      });
      
      this.server.on('error', (error) => {
        console.error('WebSocket server error:', error.message);
        this.emit('error', error);
        reject(error);
      });
      
      this.server.on('listening', () => {
        console.log(`P2P server listening on port ${this.port}`);
        resolve();
      });
    });
  }

  /**
   * Connect to seed nodes
   * @returns {Promise} - Resolves when connected to seed nodes
   * @private
   */
  async connectToSeedNodes() {
    const connectPromises = this.seedNodes.map(node => this.connectToPeer(node));
    return Promise.all(connectPromises);
  }

  /**
   * Start maintenance intervals
   * @private
   */
  startIntervals() {
    // Ping peers every 30 seconds
    this.pingInterval = setInterval(() => this.pingAllPeers(), 30000);
    
    // Discover new peers every 5 minutes
    this.discoveryInterval = setInterval(() => this.discoverPeers(), 300000);
    
    // Clean up disconnected peers every minute
    this.cleanupInterval = setInterval(() => this.cleanupPeers(), 60000);
  }

  /**
   * Handle new WebSocket connection
   * @param {WebSocket} socket - WebSocket connection
   * @param {object} request - HTTP request
   * @param {string} direction - 'inbound' or 'outbound'
   * @private
   */
  handleConnection(socket, request, direction) {
    // Extract peer address
    const address = direction === 'inbound'
      ? request.socket.remoteAddress
      : socket.url;
    
    // Generate a unique peer ID for this connection
    const peerId = crypto.createHash('sha256')
      .update(`${address}-${Date.now()}`)
      .digest('hex');
    
    console.log(`New ${direction} connection from ${address}`);
    
    // Check if we already have this peer
    if (this.peers.has(address)) {
      console.log(`Already connected to ${address}, closing duplicate connection`);
      socket.close();
      return;
    }
    
    // Check if peer is banned
    if (this.isAddressBanned(address)) {
      console.log(`Closing connection from banned peer ${address}`);
      socket.close();
      return;
    }
    
    // Check if we have reached max peers
    if (this.peers.size >= this.maxPeers && direction === 'inbound') {
      console.log('Max peers reached, rejecting new connection');
      socket.close();
      this.sendErrorMessage(socket, 'Max peers reached');
      return;
    }
    
    // Initialize peer
    const peer = {
      socket,
      info: {
        address,
        peerId,
        direction,
        connected: Date.now(),
        version: null,
        nodeId: null,
        head: null,
        lastSeen: Date.now()
      }
    };
    
    // Add to peers map
    this.peers.set(address, peer);
    
    // Initialize peer score
    this.peerScores.set(address, 0);
    
    // Update stats
    this.stats.connectedPeers = this.peers.size;
    if (direction === 'inbound') {
      this.stats.inboundConnections++;
    } else {
      this.stats.outboundConnections++;
    }
    
    // Set up event handlers
    socket.on('message', (data) => this.handleMessage(socket, data, address));
    
    socket.on('close', () => {
      console.log(`Connection closed from ${address}`);
      this.peers.delete(address);
      this.stats.connectedPeers = this.peers.size;
      this.emit('peerDisconnected', address);
      
      // Try to maintain minimum peers
      if (this.peers.size < this.minPeers) {
        this.discoverPeers();
      }
    });
    
    socket.on('error', (error) => {
      console.error(`WebSocket error from ${address}:`, error.message);
      this.decreasePeerScore(address, 1);
    });
    
    // Send handshake
    this.sendHandshake(socket);
    
    this.emit('peerConnected', { address, direction });
  }

  /**
   * Connect to a peer
   * @param {string} address - Peer address
   * @returns {Promise} - Resolves when connected to peer
   */
  connectToPeer(address) {
    return new Promise((resolve, reject) => {
      // Don't connect if already connected
      if (this.peers.has(address)) {
        resolve(false);
        return;
      }
      
      // Don't connect if banned
      if (this.isAddressBanned(address)) {
        resolve(false);
        return;
      }
      
      // Don't connect if max peers reached
      if (this.peers.size >= this.maxPeers) {
        resolve(false);
        return;
      }
      
      try {
        const socket = new WebSocket(address);
        
        socket.on('open', () => {
          this.handleConnection(socket, { socket: { remoteAddress: address } }, 'outbound');
          resolve(true);
        });
        
        socket.on('error', (error) => {
          console.error(`Failed to connect to peer ${address}:`, error.message);
          reject(error);
        });
      } catch (error) {
        console.error(`Error connecting to peer ${address}:`, error.message);
        reject(error);
      }
    });
  }

  /**
   * Handle incoming message
   * @param {WebSocket} socket - WebSocket connection
   * @param {string|Buffer} data - Message data
   * @param {string} address - Peer address
   * @private
   */
  handleMessage(socket, data, address) {
    try {
      // Parse message
      const message = JSON.parse(data);
      
      // Update stats
      this.stats.messagesReceived++;
      this.stats.bytesReceived += data.length;
      
      // Update peer last seen
      const peer = this.peers.get(address);
      if (peer) {
        peer.info.lastSeen = Date.now();
      }
      
      // Handle message based on type
      switch (message.type) {
        case MESSAGE_TYPES.HANDSHAKE:
          this.handleHandshakeMessage(socket, message, address);
          break;
          
        case MESSAGE_TYPES.PING:
          this.handlePingMessage(socket, message, address);
          break;
          
        case MESSAGE_TYPES.PONG:
          this.handlePongMessage(socket, message, address);
          break;
          
        case MESSAGE_TYPES.GET_PEERS:
          this.handleGetPeersMessage(socket, message, address);
          break;
          
        case MESSAGE_TYPES.PEERS:
          this.handlePeersMessage(socket, message, address);
          break;
          
        case MESSAGE_TYPES.GET_BLOCKS:
          this.handleGetBlocksMessage(socket, message, address);
          break;
          
        case MESSAGE_TYPES.BLOCKS:
          this.handleBlocksMessage(socket, message, address);
          break;
          
        case MESSAGE_TYPES.GET_BLOCK:
          this.handleGetBlockMessage(socket, message, address);
          break;
          
        case MESSAGE_TYPES.BLOCK:
          this.handleBlockMessage(socket, message, address);
          break;
          
        case MESSAGE_TYPES.NEW_BLOCK:
          this.handleNewBlockMessage(socket, message, address);
          break;
          
        case MESSAGE_TYPES.GET_TRANSACTION:
          this.handleGetTransactionMessage(socket, message, address);
          break;
          
        case MESSAGE_TYPES.TRANSACTION:
          this.handleTransactionMessage(socket, message, address);
          break;
          
        case MESSAGE_TYPES.NEW_TRANSACTION:
          this.handleNewTransactionMessage(socket, message, address);
          break;
          
        case MESSAGE_TYPES.GET_MEMPOOL:
          this.handleGetMempoolMessage(socket, message, address);
          break;
          
        case MESSAGE_TYPES.MEMPOOL:
          this.handleMempoolMessage(socket, message, address);
          break;
          
        case MESSAGE_TYPES.ERROR:
          this.handleErrorMessage(socket, message, address);
          break;
          
        default:
          console.warn(`Unknown message type from ${address}: ${message.type}`);
          this.decreasePeerScore(address, 1);
      }
      
      this.emit('message', { 
        type: message.type, 
        from: address, 
        data: message.data 
      });
      
    } catch (error) {
      console.error(`Error handling message from ${address}:`, error.message);
      this.decreasePeerScore(address, 1);
      this.sendErrorMessage(socket, 'Invalid message format');
    }
  }

  /**
   * Send message to peer
   * @param {WebSocket} socket - WebSocket connection
   * @param {string} type - Message type
   * @param {object} data - Message data
   * @private
   */
  sendMessage(socket, type, data = {}) {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }
    
    const message = JSON.stringify({
      type,
      data,
      timestamp: Date.now(),
      nodeId: this.nodeId
    });
    
    socket.send(message);
    
    // Update stats
    this.stats.messagesSent++;
    this.stats.bytesSent += message.length;
  }

  /**
   * Send handshake message
   * @param {WebSocket} socket - WebSocket connection
   * @private
   */
  sendHandshake(socket) {
    const latestBlock = this.blockchain 
      ? this.blockchain.getLatestBlock() 
      : { height: 0, hash: '0' };
    
    this.sendMessage(socket, MESSAGE_TYPES.HANDSHAKE, {
      version: this.version,
      nodeId: this.nodeId,
      networkID: this.networkID,
      head: {
        height: latestBlock.height,
        hash: latestBlock.hash
      },
      port: this.port
    });
  }

  /**
   * Handle handshake message
   * @param {WebSocket} socket - WebSocket connection
   * @param {object} message - Message object
   * @param {string} address - Peer address
   * @private
   */
  handleHandshakeMessage(socket, message, address) {
    const peer = this.peers.get(address);
    if (!peer) return;
    
    // Verify network ID
    if (message.data.networkID !== this.networkID) {
      console.log(`Peer ${address} is on different network: ${message.data.networkID}`);
      socket.close();
      this.banAddress(address, 'Wrong network');
      return;
    }
    
    // Update peer info
    peer.info.version = message.data.version;
    peer.info.nodeId = message.data.nodeId;
    peer.info.head = message.data.head;
    peer.info.port = message.data.port;
    
    // Increase peer score
    this.increasePeerScore(address, 1);
    
    // Request peers if we need more
    if (this.peers.size < this.maxPeers) {
      this.sendMessage(socket, MESSAGE_TYPES.GET_PEERS);
    }
    
    // Sync blocks if needed
    if (this.blockchain && peer.info.head && this.blockchain.getLatestBlock().height < peer.info.head.height) {
      this.requestBlocksFromPeer(address);
    }
  }

  /**
   * Send ping message to all peers
   * @private
   */
  pingAllPeers() {
    for (const peer of this.peers.values()) {
      if (peer.socket.readyState === WebSocket.OPEN) {
        this.sendMessage(peer.socket, MESSAGE_TYPES.PING, {
          timestamp: Date.now()
        });
      }
    }
  }

  /**
   * Handle ping message
   * @param {WebSocket} socket - WebSocket connection
   * @param {object} message - Message object
   * @param {string} address - Peer address
   * @private
   */
  handlePingMessage(socket, message, address) {
    // Respond with pong
    this.sendMessage(socket, MESSAGE_TYPES.PONG, {
      timestamp: message.data.timestamp,
      replyTimestamp: Date.now()
    });
  }

  /**
   * Handle pong message
   * @param {WebSocket} socket - WebSocket connection
   * @param {object} message - Message object
   * @param {string} address - Peer address
   * @private
   */
  handlePongMessage(socket, message, address) {
    const peer = this.peers.get(address);
    if (!peer) return;
    
    // Calculate latency
    const latency = Date.now() - message.data.timestamp;
    peer.info.latency = latency;
    
    // Increase peer score for good latency
    if (latency < 500) {
      this.increasePeerScore(address, 0.1);
    }
  }

  /**
   * Handle get peers message
   * @param {WebSocket} socket - WebSocket connection
   * @param {object} message - Message object
   * @param {string} address - Peer address
   * @private
   */
  handleGetPeersMessage(socket, message, address) {
    // Get list of peers
    const peerAddresses = [];
    
    for (const [peerAddress, peer] of this.peers.entries()) {
      // Don't include the requesting peer
      if (peerAddress !== address) {
        peerAddresses.push({
          address: peerAddress,
          nodeId: peer.info.nodeId,
          direction: peer.info.direction
        });
      }
    }
    
    // Send peers
    this.sendMessage(socket, MESSAGE_TYPES.PEERS, {
      peers: peerAddresses
    });
  }

  /**
   * Handle peers message
   * @param {WebSocket} socket - WebSocket connection
   * @param {object} message - Message object
   * @param {string} address - Peer address
   * @private
   */
  handlePeersMessage(socket, message, address) {
    const newPeers = message.data.peers;
    
    // Try to connect to new peers if needed
    if (this.peers.size < this.maxPeers && newPeers && newPeers.length > 0) {
      for (const peer of newPeers) {
        if (!this.peers.has(peer.address) && this.peers.size < this.maxPeers) {
          this.connectToPeer(peer.address).catch(() => {
            // Ignore connection errors
          });
        }
      }
    }
    
    // Increase peer score
    this.increasePeerScore(address, 0.5);
  }

  /**
   * Discover new peers
   * @private
   */
  discoverPeers() {
    // If we have enough peers, no need to discover more
    if (this.peers.size >= this.maxPeers) {
      return;
    }
    
    // Request peers from existing peers
    for (const peer of this.peers.values()) {
      if (peer.socket.readyState === WebSocket.OPEN) {
        this.sendMessage(peer.socket, MESSAGE_TYPES.GET_PEERS);
      }
    }
    
    // Try to connect to seed nodes if we have very few peers
    if (this.peers.size < this.minPeers / 2) {
      this.connectToSeedNodes();
    }
  }

  /**
   * Clean up disconnected peers
   * @private
   */
  cleanupPeers() {
    const now = Date.now();
    const timeout = 5 * 60 * 1000; // 5 minutes
    
    for (const [address, peer] of this.peers.entries()) {
      // Check if peer is still connected
      if (peer.socket.readyState !== WebSocket.OPEN) {
        this.peers.delete(address);
        continue;
      }
      
      // Check if peer has been inactive
      if (now - peer.info.lastSeen > timeout) {
        console.log(`Peer ${address} timed out, closing connection`);
        peer.socket.close();
        this.peers.delete(address);
      }
    }
    
    this.stats.connectedPeers = this.peers.size;
    
    // Try to maintain minimum peers
    if (this.peers.size < this.minPeers) {
      this.discoverPeers();
    }
  }

  /**
   * Handle get blocks message
   * @param {WebSocket} socket - WebSocket connection
   * @param {object} message - Message object
   * @param {string} address - Peer address
   * @private
   */
  handleGetBlocksMessage(socket, message, address) {
    if (!this.blockchain) {
      this.sendErrorMessage(socket, 'Blockchain not available');
      return;
    }
    
    const { startHeight, endHeight, limit } = message.data;
    const maxBlocks = limit || 50; // Limit number of blocks to send
    
    try {
      // Get blocks from blockchain
      const blocks = [];
      let currentHeight = startHeight;
      
      while (blocks.length < maxBlocks && currentHeight <= endHeight) {
        const block = this.blockchain.getBlockByHeight(currentHeight);
        if (!block) break;
        
        blocks.push(block);
        currentHeight++;
      }
      
      // Send blocks
      this.sendMessage(socket, MESSAGE_TYPES.BLOCKS, {
        blocks,
        startHeight,
        endHeight: blocks.length > 0 ? blocks[blocks.length - 1].height : startHeight - 1
      });
      
      // Increase peer score
      this.increasePeerScore(address, 0.2);
      
    } catch (error) {
      console.error('Error handling get blocks message:', error.message);
      this.sendErrorMessage(socket, 'Failed to retrieve blocks');
    }
  }

  /**
   * Handle blocks message
   * @param {WebSocket} socket - WebSocket connection
   * @param {object} message - Message object
   * @param {string} address - Peer address
   * @private
   */
  handleBlocksMessage(socket, message, address) {
    if (!this.blockchain) {
      return;
    }
    
    const { blocks, startHeight, endHeight } = message.data;
    
    try {
      // Process received blocks
      let addedBlocks = 0;
      
      for (const block of blocks) {
        // Validate block
        const isValid = this.blockchain.addBlock(block);
        
        if (isValid) {
          addedBlocks++;
        }
      }
      
      // Increase peer score based on useful blocks
      this.increasePeerScore(address, 0.5 * addedBlocks);
      
      // Request more blocks if needed
      const latestBlock = this.blockchain.getLatestBlock();
      const peer = this.peers.get(address);
      
      if (peer && peer.info.head && latestBlock.height < peer.info.head.height) {
        this.requestBlocksFromPeer(address, latestBlock.height + 1);
      }
      
    } catch (error) {
      console.error('Error handling blocks message:', error.message);
      this.decreasePeerScore(address, 1);
    }
  }

  /**
   * Handle get block message
   * @param {WebSocket} socket - WebSocket connection
   * @param {object} message - Message object
   * @param {string} address - Peer address
   * @private
   */
  handleGetBlockMessage(socket, message, address) {
    if (!this.blockchain) {
      this.sendErrorMessage(socket, 'Blockchain not available');
      return;
    }
    
    const { hash, height } = message.data;
    
    try {
      let block;
      
      if (hash) {
        block = this.blockchain.getBlockByHash(hash);
      } else if (height !== undefined) {
        block = this.blockchain.getBlockByHeight(height);
      }
      
      if (block) {
        // Send block
        this.sendMessage(socket, MESSAGE_TYPES.BLOCK, {
          block
        });
        
        // Increase peer score
        this.increasePeerScore(address, 0.1);
      } else {
        this.sendErrorMessage(socket, 'Block not found');
      }
    } catch (error) {
      console.error('Error handling get block message:', error.message);
      this.sendErrorMessage(socket, 'Failed to retrieve block');
    }
  }

  /**
   * Handle block message
   * @param {WebSocket} socket - WebSocket connection
   * @param {object} message - Message object
   * @param {string} address - Peer address
   * @private
   */
  handleBlockMessage(socket, message, address) {
    if (!this.blockchain) {
      return;
    }
    
    const { block } = message.data;
    
    try {
      // Validate and add block
      const isValid = this.blockchain.addBlock(block);
      
      if (isValid) {
        // Increase peer score
        this.increasePeerScore(address, 0.5);
      } else {
        // Decrease peer score for invalid block
        this.decreasePeerScore(address, 0.5);
      }
    } catch (error) {
      console.error('Error handling block message:', error.message);
      this.decreasePeerScore(address, 0.5);
    }
  }

  /**
   * Handle new block message
   * @param {WebSocket} socket - WebSocket connection
   * @param {object} message - Message object
   * @param {string} address - Peer address
   * @private
   */
  handleNewBlockMessage(socket, message, address) {
    if (!this.blockchain) {
      return;
    }
    
    const { block } = message.data;
    
    try {
      // Validate and add block
      const isValid = this.blockchain.addBlock(block);
      
      if (isValid) {
        // Propagate to other peers
        this.broadcastMessage(MESSAGE_TYPES.NEW_BLOCK, {
          block
        }, address);
        
        // Increase peer score
        this.increasePeerScore(address, 1);
      } else {
        // Decrease peer score for invalid block
        this.decreasePeerScore(address, 1);
      }
    } catch (error) {
      console.error('Error handling new block message:', error.message);
      this.decreasePeerScore(address, 0.5);
    }
  }

  /**
   * Handle get transaction message
   * @param {WebSocket} socket - WebSocket connection
   * @param {object} message - Message object
   * @param {string} address - Peer address
   * @private
   */
  handleGetTransactionMessage(socket, message, address) {
    if (!this.blockchain) {
      this.sendErrorMessage(socket, 'Blockchain not available');
      return;
    }
    
    const { hash } = message.data;
    
    try {
      // Try to find transaction in blockchain or mempool
      let transaction = this.blockchain.getTransactionByHash(hash);
      
      if (!transaction && this.mempool) {
        transaction = this.mempool.getTransaction(hash);
      }
      
      if (transaction) {
        // Send transaction
        this.sendMessage(socket, MESSAGE_TYPES.TRANSACTION, {
          transaction
        });
        
        // Increase peer score
        this.increasePeerScore(address, 0.1);
      } else {
        this.sendErrorMessage(socket, 'Transaction not found');
      }
    } catch (error) {
      console.error('Error handling get transaction message:', error.message);
      this.sendErrorMessage(socket, 'Failed to retrieve transaction');
    }
  }

  /**
   * Handle transaction message
   * @param {WebSocket} socket - WebSocket connection
   * @param {object} message - Message object
   * @param {string} address - Peer address
   * @private
   */
  handleTransactionMessage(socket, message, address) {
    if (!this.mempool) {
      return;
    }
    
    const { transaction } = message.data;
    
    try {
      // Add transaction to mempool
      const added = this.mempool.addTransaction(transaction);
      
      if (added) {
        // Increase peer score
        this.increasePeerScore(address, 0.2);
      }
    } catch (error) {
      console.error('Error handling transaction message:', error.message);
    }
  }

  /**
   * Handle new transaction message
   * @param {WebSocket} socket - WebSocket connection
   * @param {object} message - Message object
   * @param {string} address - Peer address
   * @private
   */
  handleNewTransactionMessage(socket, message, address) {
    if (!this.mempool) {
      return;
    }
    
    const { transaction } = message.data;
    
    try {
      // Add transaction to mempool
      const added = this.mempool.addTransaction(transaction);
      
      if (added) {
        // Propagate to other peers
        this.broadcastMessage(MESSAGE_TYPES.NEW_TRANSACTION, {
          transaction
        }, address);
        
        // Increase peer score
        this.increasePeerScore(address, 0.3);
      }
    } catch (error) {
      console.error('Error handling new transaction message:', error.message);
    }
  }

  /**
   * Handle get mempool message
   * @param {WebSocket} socket - WebSocket connection
   * @param {object} message - Message object
   * @param {string} address - Peer address
   * @private
   */
  handleGetMempoolMessage(socket, message, address) {
    if (!this.mempool) {
      this.sendErrorMessage(socket, 'Mempool not available');
      return;
    }
    
    try {
      // Get transactions from mempool
      const transactions = this.mempool.getAllTransactions();
      
      // Send mempool
      this.sendMessage(socket, MESSAGE_TYPES.MEMPOOL, {
        transactions
      });
      
      // Increase peer score
      this.increasePeerScore(address, 0.1);
    } catch (error) {
      console.error('Error handling get mempool message:', error.message);
      this.sendErrorMessage(socket, 'Failed to retrieve mempool');
    }
  }

  /**
   * Handle mempool message
   * @param {WebSocket} socket - WebSocket connection
   * @param {object} message - Message object
   * @param {string} address - Peer address
   * @private
   */
  handleMempoolMessage(socket, message, address) {
    if (!this.mempool) {
      return;
    }
    
    const { transactions } = message.data;
    
    try {
      // Add transactions to mempool
      let addedCount = 0;
      
      for (const tx of transactions) {
        try {
          const added = this.mempool.addTransaction(tx, false);
          if (added) {
            addedCount++;
          }
        } catch (e) {
          // Ignore individual transaction errors
        }
      }
      
      // Increase peer score based on useful transactions
      this.increasePeerScore(address, 0.1 * Math.min(addedCount, 10));
    } catch (error) {
      console.error('Error handling mempool message:', error.message);
    }
  }

  /**
   * Handle error message
   * @param {WebSocket} socket - WebSocket connection
   * @param {object} message - Message object
   * @param {string} address - Peer address
   * @private
   */
  handleErrorMessage(socket, message, address) {
    console.warn(`Error from peer ${address}:`, message.data.error);
    
    // Decrease peer score
    this.decreasePeerScore(address, 0.1);
  }

  /**
   * Send error message
   * @param {WebSocket} socket - WebSocket connection
   * @param {string} error - Error message
   * @private
   */
  sendErrorMessage(socket, error) {
    this.sendMessage(socket, MESSAGE_TYPES.ERROR, {
      error
    });
  }

  /**
   * Request blocks from peer
   * @param {string} address - Peer address
   * @param {number} startHeight - Start block height
   * @private
   */
  requestBlocksFromPeer(address, startHeight = null) {
    const peer = this.peers.get(address);
    if (!peer || peer.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    
    if (!this.blockchain) {
      return;
    }
    
    // Determine start height
    if (startHeight === null) {
      startHeight = this.blockchain.getLatestBlock().height + 1;
    }
    
    // Determine end height (limit to 100 blocks at a time)
    let endHeight = startHeight + 99;
    if (peer.info.head && peer.info.head.height < endHeight) {
      endHeight = peer.info.head.height;
    }
    
    this.sendMessage(peer.socket, MESSAGE_TYPES.GET_BLOCKS, {
      startHeight,
      endHeight,
      limit: 100
    });
  }

  /**
   * Broadcast message to all peers
   * @param {string} type - Message type
   * @param {object} data - Message data
   * @param {string} except - Address to exclude
   */
  broadcastMessage(type, data, except = null) {
    for (const [address, peer] of this.peers.entries()) {
      if (except && address === except) {
        continue;
      }
      
      if (peer.socket.readyState === WebSocket.OPEN) {
        this.sendMessage(peer.socket, type, data);
      }
    }
  }

  /**
   * Broadcast block to network
   * @param {object} block - Block to broadcast
   */
  broadcastBlock(block) {
    this.broadcastMessage(MESSAGE_TYPES.NEW_BLOCK, {
      block
    });
  }

  /**
   * Broadcast transaction to network
   * @param {object} transaction - Transaction to broadcast
   */
  broadcastTransaction(transaction) {
    this.broadcastMessage(MESSAGE_TYPES.NEW_TRANSACTION, {
      transaction
    });
  }

  /**
   * Ban a peer
   * @param {string} address - Peer address
   * @param {string} reason - Ban reason
   */
  banAddress(address, reason) {
    // Close connection if active
    const peer = this.peers.get(address);
    if (peer && peer.socket.readyState === WebSocket.OPEN) {
      peer.socket.close();
    }
    
    // Remove from peers
    this.peers.delete(address);
    
    // Add to banned list with timestamp
    this.bannedPeers.set(address, {
      reason,
      timestamp: Date.now()
    });
    
    console.log(`Banned peer ${address}: ${reason}`);
    this.emit('peerBanned', { address, reason });
  }

  /**
   * Check if address is banned
   * @param {string} address - Peer address
   * @returns {boolean} - Whether address is banned
   */
  isAddressBanned(address) {
    if (!this.bannedPeers.has(address)) {
      return false;
    }
    
    // Check if ban has expired (default ban time: 24 hours)
    const banInfo = this.bannedPeers.get(address);
    const banTime = 24 * 60 * 60 * 1000; // 24 hours
    
    if (Date.now() - banInfo.timestamp > banTime) {
      this.bannedPeers.delete(address);
      return false;
    }
    
    return true;
  }

  /**
   * Increase peer score
   * @param {string} address - Peer address
   * @param {number} amount - Score amount to increase
   * @private
   */
  increasePeerScore(address, amount) {
    if (!this.peerScores.has(address)) {
      this.peerScores.set(address, 0);
    }
    
    let score = this.peerScores.get(address);
    score += amount;
    
    // Cap score at 100
    score = Math.min(score, 100);
    
    this.peerScores.set(address, score);
  }

  /**
   * Decrease peer score
   * @param {string} address - Peer address
   * @param {number} amount - Score amount to decrease
   * @private
   */
  decreasePeerScore(address, amount) {
    if (!this.peerScores.has(address)) {
      this.peerScores.set(address, 0);
    }
    
    let score = this.peerScores.get(address);
    score -= amount;
    
    // Ban peer if score goes below -10
    if (score < -10) {
      this.banAddress(address, 'Negative reputation score');
      return;
    }
    
    this.peerScores.set(address, score);
  }

  /**
   * Get peer by address
   * @param {string} address - Peer address
   * @returns {object|null} - Peer or null if not found
   */
  getPeer(address) {
    return this.peers.get(address) || null;
  }

  /**
   * Get all peers
   * @returns {Array} - Array of peers
   */
  getAllPeers() {
    const peerList = [];
    
    for (const [address, peer] of this.peers.entries()) {
      peerList.push({
        address,
        info: peer.info,
        score: this.peerScores.get(address) || 0
      });
    }
    
    return peerList;
  }

  /**
   * Get banned peers
   * @returns {Array} - Array of banned peers
   */
  getBannedPeers() {
    const bannedList = [];
    
    for (const [address, banInfo] of this.bannedPeers.entries()) {
      bannedList.push({
        address,
        reason: banInfo.reason,
        timestamp: banInfo.timestamp,
        expiresAt: banInfo.timestamp + 24 * 60 * 60 * 1000
      });
    }
    
    return bannedList;
  }

  /**
   * Get network statistics
   * @returns {object} - Network statistics
   */
  getNetworkStats() {
    const now = Date.now();
    const uptime = now - this.stats.startTime;
    
    return {
      ...this.stats,
      uptime,
      nodeId: this.nodeId,
      peers: this.peers.size,
      bannedPeers: this.bannedPeers.size,
      networkID: this.networkID,
      version: this.version
    };
  }
}

module.exports = P2PManager;