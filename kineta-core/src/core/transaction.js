/**
 * Transaction.js - Transaction handling for Kineta blockchain
 * 
 * Implements:
 * - Transaction structure and validation
 * - Signature creation and verification
 * - Fee calculation including developer fee
 */

const crypto = require('crypto');
const { ec: EC } = require('elliptic');
const ec = new EC('secp256k1');

class Transaction {
  /**
   * Create a new transaction
   * @param {string} fromAddress - Sender's public key
   * @param {string} toAddress - Recipient's public key
   * @param {number} amount - Amount to transfer
   * @param {number} timestamp - Transaction timestamp
   * @param {number} fee - Transaction fee (calculated if not provided)
   */
  constructor(fromAddress, toAddress, amount, timestamp = Date.now(), fee = null) {
    this.fromAddress = fromAddress;
    this.toAddress = toAddress;
    this.amount = amount;
    this.timestamp = timestamp;
    this.fee = fee || this.calculateFee();
    this.hash = this.calculateHash();
    this.signature = null;
  }

  /**
   * Calculate SHA-256 hash of the transaction
   * @returns {string} - The calculated hash
   */
  calculateHash() {
    return crypto.createHash('sha256')
      .update(
        (this.fromAddress || 'coinbase') +
        this.toAddress +
        this.amount.toString() +
        this.timestamp.toString() +
        (this.fee || '0').toString()
      )
      .digest('hex');
  }

  /**
   * Calculate transaction fee (0.1% of transaction amount)
   * Minimum fee of 0.0001 KIN
   * @returns {number} - Calculated fee
   */
  calculateFee() {
    // For coinbase transactions
    if (!this.fromAddress) {
      return 0;
    }
    
    // Regular transaction fee (0.1% with minimum 0.0001 KIN)
    const calculatedFee = this.amount * 0.001;
    return Math.max(calculatedFee, 0.0001);
  }

  /**
   * Calculate developer fee (0.02% of transaction amount)
   * @returns {number} - Developer fee amount
   */
  calculateDeveloperFee() {
    // No developer fee on coinbase transactions
    if (!this.fromAddress) {
      return 0;
    }
    
    return this.amount * 0.0002; // 0.02% developer fee
  }

  /**
   * Sign transaction with private key
   * @param {string} signingKey - Private key in hex format
   */
  signTransaction(signingKey) {
    // You can't sign a transaction from a null address (coinbase)
    if (!this.fromAddress) {
      return;
    }

    // Convert signing key to key pair if it's a string
    const keyPair = typeof signingKey === 'string' 
      ? ec.keyFromPrivate(signingKey) 
      : signingKey;

    // Check if the public key matches the from address
    const publicKey = keyPair.getPublic('hex');
    if (publicKey !== this.fromAddress) {
      throw new Error('You cannot sign transactions for other wallets!');
    }

    // Create signature
    const signHash = this.hash;
    const signature = keyPair.sign(signHash, 'base64');
    this.signature = {
      r: signature.r.toString(16),
      s: signature.s.toString(16)
    };

    return this;
  }

  /**
   * Verify transaction signature
   * @returns {boolean} - Whether the signature is valid
   */
  isSignatureValid() {
    // Coinbase transactions don't have signatures
    if (!this.fromAddress) {
      return true;
    }

    // All non-coinbase transactions must have a signature
    if (!this.signature) {
      console.error('No signature in this transaction');
      return false;
    }

    // Verify signature
    try {
      const publicKey = ec.keyFromPublic(this.fromAddress, 'hex');
      return publicKey.verify(this.hash, this.signature);
    } catch (error) {
      console.error('Error verifying signature:', error.message);
      return false;
    }
  }

  /**
   * Validate transaction structure and data
   * @returns {boolean} - Whether the transaction is valid
   */
  isValid() {
    // Coinbase transactions are special
    if (!this.fromAddress) {
      // Additional coinbase validation could go here
      return true;
    }

    // Verify signature
    if (!this.isSignatureValid()) {
      return false;
    }

    // Check if sender has a valid address
    if (!this.fromAddress) {
      console.error('Transaction must have a from address');
      return false;
    }

    // Check if recipient has a valid address
    if (!this.toAddress) {
      console.error('Transaction must have a to address');
      return false;
    }

    // Check for valid amount
    if (this.amount <= 0) {
      console.error('Transaction amount must be positive');
      return false;
    }

    // Check for valid fee
    const expectedFee = this.calculateFee();
    if (this.fee < expectedFee) {
      console.error(`Transaction fee too low: ${this.fee} < ${expectedFee}`);
      return false;
    }

    return true;
  }

  /**
   * Create a coinbase transaction (mining reward)
   * @param {string} minerAddress - Miner's public key
   * @param {number} blockHeight - Height of the block containing this transaction
   * @param {number} reward - Mining reward amount
   * @returns {Transaction} - A new coinbase transaction
   */
  static createCoinbaseTransaction(minerAddress, blockHeight, reward) {
    const coinbaseTx = new Transaction(
      null, // From address is null for coinbase
      minerAddress,
      reward,
      Date.now(),
      0 // No fee for coinbase
    );
    
    // Add block height to coinbase data (important for uniqueness)
    coinbaseTx.blockHeight = blockHeight;
    
    // Recalculate hash to include the block height
    coinbaseTx.hash = crypto.createHash('sha256')
      .update(
        'coinbase' +
        minerAddress +
        reward.toString() +
        coinbaseTx.timestamp.toString() +
        blockHeight.toString()
      )
      .digest('hex');
    
    return coinbaseTx;
  }

  /**
   * Serialize transaction for storage or transmission
   * @returns {object} - Serialized transaction
   */
  serialize() {
    return {
      fromAddress: this.fromAddress,
      toAddress: this.toAddress,
      amount: this.amount,
      fee: this.fee,
      timestamp: this.timestamp,
      hash: this.hash,
      signature: this.signature,
      blockHeight: this.blockHeight // Only for coinbase
    };
  }

  /**
   * Create transaction from serialized data
   * @param {object} data - Serialized transaction data
   * @returns {Transaction} - Reconstructed transaction
   */
  static deserialize(data) {
    const tx = new Transaction(
      data.fromAddress,
      data.toAddress,
      data.amount,
      data.timestamp,
      data.fee
    );
    
    tx.hash = data.hash;
    tx.signature = data.signature;
    
    if (data.blockHeight !== undefined) {
      tx.blockHeight = data.blockHeight;
    }
    
    return tx;
  }
}

module.exports = Transaction;