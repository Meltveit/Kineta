/**
 * Block.js - Core block structure for Kineta blockchain
 * 
 * Defines the fundamental block structure with:
 * - Block header information
 * - Transaction list
 * - Block validation
 * - Block hashing
 */

const crypto = require('crypto');

class Block {
  /**
   * Create a new block in the Kineta blockchain
   * @param {number} timestamp - The timestamp when the block was created
   * @param {Array} transactions - List of transactions included in the block
   * @param {string} previousHash - Hash of the previous block
   * @param {number} height - Block height in the blockchain
   * @param {number} difficulty - Current mining difficulty
   * @param {number} nonce - Nonce value used for mining
   */
  constructor(timestamp, transactions, previousHash = '', height = 0, difficulty = 1, nonce = 0) {
    this.timestamp = timestamp;
    this.transactions = transactions;
    this.previousHash = previousHash;
    this.height = height;
    this.difficulty = difficulty;
    this.nonce = nonce;
    this.hash = this.calculateHash();
    this.merkleRoot = this.calculateMerkleRoot();
  }

  /**
   * Calculate SHA-256 hash of the block
   * @returns {string} - The calculated hash
   */
  calculateHash() {
    return crypto.createHash('sha256')
      .update(
        this.previousHash +
        this.timestamp.toString() +
        JSON.stringify(this.transactions) +
        this.height.toString() +
        this.difficulty.toString() +
        this.nonce.toString() +
        this.calculateMerkleRoot()
      )
      .digest('hex');
  }

  /**
   * Calculate the Merkle Root of transactions
   * @returns {string} - Merkle Root hash
   */
  calculateMerkleRoot() {
    if (this.transactions.length === 0) {
      return crypto.createHash('sha256').update('empty_block').digest('hex');
    }

    // Get transaction hashes
    let hashes = this.transactions.map(transaction => 
      typeof transaction === 'string' ? transaction : transaction.hash
    );

    // Ensure even number of hashes by duplicating the last one if needed
    if (hashes.length % 2 === 1) {
      hashes.push(hashes[hashes.length - 1]);
    }

    // Calculate Merkle root
    while (hashes.length > 1) {
      const newHashes = [];
      
      // Process pairs of hashes
      for (let i = 0; i < hashes.length; i += 2) {
        const combinedHash = crypto.createHash('sha256')
          .update(hashes[i] + hashes[i + 1])
          .digest('hex');
        newHashes.push(combinedHash);
      }
      
      hashes = newHashes;
      
      // If we have odd number of hashes after reduction, duplicate the last one
      if (hashes.length % 2 === 1 && hashes.length !== 1) {
        hashes.push(hashes[hashes.length - 1]);
      }
    }

    return hashes[0];
  }

  /**
   * Mine block with proof of work
   * @param {number} difficulty - Mining difficulty
   */
  mineBlock(difficulty) {
    // Create difficulty string (e.g., '000' for difficulty 3)
    const targetPrefix = '0'.repeat(difficulty);
    
    // Mine until hash starts with required number of zeros
    while (this.hash.substring(0, difficulty) !== targetPrefix) {
      this.nonce++;
      this.hash = this.calculateHash();
    }
    
    console.log(`Block mined: ${this.hash}`);
  }

  /**
   * Validate block structure and hash
   * @returns {boolean} - Whether the block is valid
   */
  isValid() {
    // Verify hash is correct
    const calculatedHash = this.calculateHash();
    if (this.hash !== calculatedHash) {
      console.error('Block hash is invalid');
      return false;
    }

    // Verify block meets difficulty requirement
    const targetPrefix = '0'.repeat(this.difficulty);
    if (this.hash.substring(0, this.difficulty) !== targetPrefix) {
      console.error('Block does not meet difficulty requirement');
      return false;
    }

    // Verify merkle root is correct
    const calculatedMerkleRoot = this.calculateMerkleRoot();
    if (this.merkleRoot !== calculatedMerkleRoot) {
      console.error('Merkle root is invalid');
      return false;
    }

    // Verify all transactions are valid
    for (const transaction of this.transactions) {
      if (typeof transaction !== 'string' && !transaction.isValid()) {
        console.error('Block contains invalid transaction');
        return false;
      }
    }

    return true;
  }

  /**
   * Serialize block for storage or transmission
   * @returns {object} - Serialized block
   */
  serialize() {
    return {
      hash: this.hash,
      previousHash: this.previousHash,
      timestamp: this.timestamp,
      height: this.height,
      difficulty: this.difficulty,
      nonce: this.nonce,
      merkleRoot: this.merkleRoot,
      transactions: this.transactions.map(tx => 
        typeof tx === 'string' ? tx : tx.serialize()
      )
    };
  }

  /**
   * Create block from serialized data
   * @param {object} data - Serialized block data
   * @returns {Block} - Reconstructed block
   */
  static deserialize(data) {
    const block = new Block(
      data.timestamp,
      data.transactions, // Note: transactions may need further deserialization
      data.previousHash,
      data.height,
      data.difficulty,
      data.nonce
    );
    
    block.hash = data.hash;
    block.merkleRoot = data.merkleRoot;
    
    return block;
  }
}

module.exports = Block;