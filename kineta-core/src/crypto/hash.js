/**
 * Hash.js - Cryptographic hash functions for Kineta blockchain
 * 
 * Provides:
 * - SHA-256 hash function (primary hash algorithm)
 * - RIPEMD-160 hash function (for address generation)
 * - Double SHA-256 hash function
 * - Merkle tree utilities
 * - Hash verification and utility functions
 */

const crypto = require('crypto');

/**
 * Core hash functions for Kineta blockchain
 */
class Hash {
  /**
   * Create SHA-256 hash of input data
   * @param {string|Buffer} data - Data to hash
   * @param {string} encoding - Output encoding (hex, base64, etc)
   * @returns {string} - Hash in specified encoding
   */
  static sha256(data, encoding = 'hex') {
    return crypto.createHash('sha256')
      .update(typeof data === 'string' ? data : Buffer.from(data))
      .digest(encoding);
  }

  /**
   * Create RIPEMD-160 hash of input data
   * @param {string|Buffer} data - Data to hash
   * @param {string} encoding - Output encoding (hex, base64, etc)
   * @returns {string} - Hash in specified encoding
   */
  static ripemd160(data, encoding = 'hex') {
    return crypto.createHash('ripemd160')
      .update(typeof data === 'string' ? data : Buffer.from(data))
      .digest(encoding);
  }

  /**
   * Create SHA-512 hash of input data
   * @param {string|Buffer} data - Data to hash
   * @param {string} encoding - Output encoding (hex, base64, etc)
   * @returns {string} - Hash in specified encoding
   */
  static sha512(data, encoding = 'hex') {
    return crypto.createHash('sha512')
      .update(typeof data === 'string' ? data : Buffer.from(data))
      .digest(encoding);
  }

  /**
   * Create double SHA-256 hash (SHA-256 of SHA-256)
   * @param {string|Buffer} data - Data to hash
   * @param {string} encoding - Output encoding (hex, base64, etc)
   * @returns {string} - Double-hashed output in specified encoding
   */
  static sha256d(data, encoding = 'hex') {
    return this.sha256(this.sha256(data, 'binary'), encoding);
  }

  /**
   * Generate hash160 (RIPEMD-160 of SHA-256) - used for address generation
   * @param {string|Buffer} data - Data to hash
   * @param {string} encoding - Output encoding (hex, base64, etc)
   * @returns {string} - Hash160 output in specified encoding
   */
  static hash160(data, encoding = 'hex') {
    return this.ripemd160(this.sha256(data, 'binary'), encoding);
  }

  /**
   * Create a deterministic hash from multiple inputs
   * @param {...(string|Buffer)} inputs - Any number of inputs to hash
   * @param {string} encoding - Output encoding (hex, base64, etc)
   * @returns {string} - Combined hash in specified encoding
   */
  static combineHashes(inputs, encoding = 'hex') {
    const hash = crypto.createHash('sha256');
    
    for (const input of inputs) {
      hash.update(typeof input === 'string' ? input : Buffer.from(input));
    }
    
    return hash.digest(encoding);
  }

  /**
   * Calculate the Merkle root of an array of hashes
   * @param {string[]} hashes - Array of hash strings
   * @param {Function} hashFunction - Hash function to use (defaults to sha256)
   * @returns {string} - Merkle root hash
   */
  static calculateMerkleRoot(hashes, hashFunction = this.sha256) {
    if (hashes.length === 0) {
      return hashFunction('empty_merkle_tree');
    }
    
    if (hashes.length === 1) {
      return hashes[0];
    }

    // Ensure even number of hashes by duplicating the last one if needed
    const workingHashes = [...hashes];
    if (workingHashes.length % 2 === 1) {
      workingHashes.push(workingHashes[workingHashes.length - 1]);
    }

    // Calculate Merkle root
    let currentLevel = workingHashes;
    
    while (currentLevel.length > 1) {
      const nextLevel = [];
      
      // Process pairs of hashes
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = currentLevel[i + 1];
        const combined = left + right;
        const newHash = hashFunction(combined);
        nextLevel.push(newHash);
      }
      
      currentLevel = nextLevel;
      
      // If we have odd number of hashes after reduction, duplicate the last one
      if (currentLevel.length % 2 === 1 && currentLevel.length !== 1) {
        currentLevel.push(currentLevel[currentLevel.length - 1]);
      }
    }

    return currentLevel[0];
  }

  /**
   * Generate a Merkle proof for a specific transaction in a block
   * @param {string[]} txHashes - Array of transaction hashes
   * @param {string} targetTxHash - Hash of the transaction to generate proof for
   * @param {Function} hashFunction - Hash function to use (defaults to sha256)
   * @returns {object|null} - Merkle proof or null if tx not found
   */
  static generateMerkleProof(txHashes, targetTxHash, hashFunction = this.sha256) {
    // Find index of target transaction
    const txIndex = txHashes.findIndex(hash => hash === targetTxHash);
    if (txIndex === -1) {
      return null;
    }
    
    // Ensure even number of hashes by duplicating the last one if needed
    const workingHashes = [...txHashes];
    if (workingHashes.length % 2 === 1) {
      workingHashes.push(workingHashes[workingHashes.length - 1]);
    }
    
    // Generate proof
    let currentLevel = workingHashes;
    let currentIndex = txIndex;
    const proof = [];
    
    while (currentLevel.length > 1) {
      const isOdd = currentIndex % 2 === 1;
      const siblingIndex = isOdd ? currentIndex - 1 : currentIndex + 1;
      
      // If sibling exists, add to proof
      if (siblingIndex < currentLevel.length) {
        proof.push({
          hash: currentLevel[siblingIndex],
          position: isOdd ? 'left' : 'right'
        });
      }
      
      // Move to next level
      const nextLevel = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
        const combined = left + right;
        const newHash = hashFunction(combined);
        nextLevel.push(newHash);
      }
      
      currentIndex = Math.floor(currentIndex / 2);
      currentLevel = nextLevel;
    }
    
    return {
      index: txIndex,
      proof: proof,
      root: currentLevel[0]
    };
  }

  /**
   * Verify a Merkle proof
   * @param {string} txHash - Transaction hash
   * @param {object} proof - Merkle proof
   * @param {string} merkleRoot - Merkle root to verify against
   * @param {Function} hashFunction - Hash function to use (defaults to sha256)
   * @returns {boolean} - Whether the proof is valid
   */
  static verifyMerkleProof(txHash, proof, merkleRoot, hashFunction = this.sha256) {
    let currentHash = txHash;
    
    for (const node of proof.proof) {
      if (node.position === 'left') {
        currentHash = hashFunction(node.hash + currentHash);
      } else {
        currentHash = hashFunction(currentHash + node.hash);
      }
    }
    
    return currentHash === merkleRoot;
  }

  /**
   * Create a simplified hash for testing (first 8 characters of SHA-256)
   * @param {string|Buffer} data - Data to hash
   * @returns {string} - Simplified hash for testing
   */
  static simpleHash(data) {
    return this.sha256(data).substring(0, 8);
  }

  /**
   * Verify that a hash meets a certain difficulty target
   * @param {string} hash - Hash to check
   * @param {number} difficulty - Number of leading zeros required
   * @returns {boolean} - Whether the hash meets the difficulty
   */
  static meetsTarget(hash, difficulty) {
    const prefix = '0'.repeat(difficulty);
    return hash.startsWith(prefix);
  }

  /**
   * Generate a random nonce for mining
   * @param {number} byteLength - Length of nonce in bytes
   * @returns {Buffer} - Random nonce
   */
  static randomNonce(byteLength = 4) {
    return crypto.randomBytes(byteLength);
  }

  /**
   * HMAC-SHA256 for authenticated hashing
   * @param {string|Buffer} data - Data to hash
   * @param {string|Buffer} key - Secret key for HMAC
   * @param {string} encoding - Output encoding
   * @returns {string} - HMAC output
   */
  static hmacSha256(data, key, encoding = 'hex') {
    return crypto.createHmac('sha256', key)
      .update(typeof data === 'string' ? data : Buffer.from(data))
      .digest(encoding);
  }

  /**
   * Convert hex string to Buffer
   * @param {string} hex - Hex string
   * @returns {Buffer} - Buffer from hex
   */
  static hexToBuffer(hex) {
    return Buffer.from(hex.startsWith('0x') ? hex.slice(2) : hex, 'hex');
  }

  /**
   * Convert Buffer to hex string
   * @param {Buffer} buffer - Buffer to convert
   * @param {boolean} with0x - Whether to prefix with '0x'
   * @returns {string} - Hex string
   */
  static bufferToHex(buffer, with0x = false) {
    const hex = buffer.toString('hex');
    return with0x ? `0x${hex}` : hex;
  }
}

module.exports = Hash;