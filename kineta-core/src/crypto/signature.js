/**
 * Signature.js - Digital signature functionality for Kineta blockchain
 * 
 * Implements:
 * - ECDSA signature generation and verification
 * - Signature formats and encoding
 * - Batch verification for performance
 * - Multi-signature support
 */

const crypto = require('crypto');
const { ec: EC } = require('elliptic');
const ec = new EC('secp256k1');
const Hash = require('/hash');

/**
 * Signature class for handling digital signatures in Kineta
 */
class Signature {
  /**
   * Create a new signature instance
   * @param {Object} signature - Elliptic.js signature object or {r, s} values
   * @param {number} recoveryParam - Recovery parameter (optional)
   */
  constructor(signature, recoveryParam = null) {
    if (typeof signature === 'object' && signature !== null) {
      // If it's an elliptic.js signature object
      if (signature.r && signature.s) {
        this.r = signature.r.toString(16);
        this.s = signature.s.toString(16);
        this.recoveryParam = recoveryParam !== null ? recoveryParam : signature.recoveryParam;
      } else {
        throw new Error('Invalid signature format');
      }
    } else {
      throw new Error('Signature must be an object with r and s values');
    }
  }

  /**
   * Create a signature from r and s hex strings
   * @param {string} r - R value in hex
   * @param {string} s - S value in hex
   * @param {number} recoveryParam - Recovery parameter (optional)
   * @returns {Signature} - New signature instance
   */
  static fromRsHex(r, s, recoveryParam = null) {
    return new Signature({ r, s }, recoveryParam);
  }

  /**
   * Create a signature from DER format
   * @param {string|Buffer} der - DER encoded signature
   * @returns {Signature} - New signature instance
   */
  static fromDER(der) {
    const buf = Buffer.isBuffer(der) ? der : Buffer.from(der, 'hex');
    const parsed = ec.signatureImport(buf);
    return new Signature(parsed);
  }

  /**
   * Create a signature from compact format
   * @param {string|Buffer} compact - Compact signature format
   * @returns {Signature} - New signature instance
   */
  static fromCompact(compact) {
    const buf = Buffer.isBuffer(compact) ? compact : Buffer.from(compact, 'hex');
    if (buf.length !== 65) {
      throw new Error('Compact signature must be 65 bytes');
    }
    
    const recoveryParam = buf[0] - 27;
    const r = buf.slice(1, 33).toString('hex');
    const s = buf.slice(33, 65).toString('hex');
    
    return Signature.fromRsHex(r, s, recoveryParam);
  }

  /**
   * Convert signature to DER format
   * @returns {string} - DER encoded signature in hex
   */
  toDER() {
    const signatureObj = {
      r: this.r,
      s: this.s
    };
    const derBuf = ec.signatureExport(signatureObj);
    return derBuf.toString('hex');
  }

  /**
   * Convert signature to compact format
   * @returns {string} - Compact signature in hex
   */
  toCompact() {
    if (this.recoveryParam === null || this.recoveryParam === undefined) {
      throw new Error('Recovery parameter is required for compact format');
    }
    
    const r = Buffer.from(this.r.padStart(64, '0'), 'hex');
    const s = Buffer.from(this.s.padStart(64, '0'), 'hex');
    
    const result = Buffer.alloc(65);
    result[0] = 27 + this.recoveryParam;
    r.copy(result, 1);
    s.copy(result, 33);
    
    return result.toString('hex');
  }

  /**
   * Create a signature object for a given message and private key
   * @param {string|Buffer} message - Message to sign
   * @param {string} privateKey - Private key in hex
   * @param {boolean} needsHashing - Whether to hash the message first
   * @returns {Signature} - New signature instance
   */
  static signMessage(message, privateKey, needsHashing = true) {
    const keyPair = ec.keyFromPrivate(privateKey);
    
    // Hash the message if needed
    const messageToSign = needsHashing 
      ? Hash.sha256(message) 
      : (typeof message === 'string' ? message : message.toString('hex'));
    
    // Sign the message
    const signature = keyPair.sign(messageToSign);
    return new Signature(signature, signature.recoveryParam);
  }

  /**
   * Verify a signature against a message and public key
   * @param {string|Buffer} message - Original message
   * @param {string} signature - Signature in hex (DER or compact)
   * @param {string} publicKey - Public key in hex
   * @param {boolean} needsHashing - Whether to hash the message first
   * @returns {boolean} - Whether the signature is valid
   */
  static verifySignature(message, signature, publicKey, needsHashing = true) {
    try {
      // Parse the public key
      const key = ec.keyFromPublic(publicKey, 'hex');
      
      // Determine signature format and parse
      let sig;
      if (signature.length === 130) {
        // Compact format
        sig = Signature.fromCompact(signature);
      } else {
        // Assume DER format
        sig = Signature.fromDER(signature);
      }
      
      // Hash the message if needed
      const messageToVerify = needsHashing 
        ? Hash.sha256(message) 
        : (typeof message === 'string' ? message : message.toString('hex'));
      
      // Convert signature to format expected by elliptic
      const signatureObj = {
        r: sig.r,
        s: sig.s
      };
      
      // Verify the signature
      return key.verify(messageToVerify, signatureObj);
    } catch (error) {
      console.error('Signature verification error:', error.message);
      return false;
    }
  }

  /**
   * Recover public key from signature and message
   * @param {string|Buffer} message - Original message
   * @param {string} signature - Signature in compact format
   * @param {boolean} needsHashing - Whether to hash the message first
   * @returns {string|null} - Recovered public key or null if recovery fails
   */
  static recoverPublicKey(message, signature, needsHashing = true) {
    try {
      // Parse signature
      const sig = Signature.fromCompact(signature);
      
      // Hash the message if needed
      const messageToRecover = needsHashing 
        ? Hash.sha256(message) 
        : (typeof message === 'string' ? message : message.toString('hex'));
      
      // Convert signature to format expected by elliptic
      const signatureObj = {
        r: sig.r,
        s: sig.s
      };
      
      // Recover public key
      const recovered = ec.recoverPubKey(
        messageToRecover,
        signatureObj,
        sig.recoveryParam
      );
      
      return recovered.encode('hex');
    } catch (error) {
      console.error('Public key recovery error:', error.message);
      return null;
    }
  }

  /**
   * Batch verify multiple signatures for performance
   * @param {Array} batch - Array of {message, signature, publicKey} objects
   * @param {boolean} needsHashing - Whether to hash the messages first
   * @returns {boolean} - Whether all signatures are valid
   */
  static batchVerify(batch, needsHashing = true) {
    try {
      for (const { message, signature, publicKey } of batch) {
        const isValid = Signature.verifySignature(
          message,
          signature,
          publicKey,
          needsHashing
        );
        
        if (!isValid) {
          return false;
        }
      }
      
      return true;
    } catch (error) {
      console.error('Batch verification error:', error.message);
      return false;
    }
  }

  /**
   * Create a multi-signature for m-of-n multisig transactions
   * @param {string|Buffer} message - Message to sign
   * @param {string[]} privateKeys - Array of private keys in hex
   * @param {number} m - Number of signatures required (m of n)
   * @param {boolean} needsHashing - Whether to hash the message first
   * @returns {object} - Multi-signature object
   */
  static createMultiSignature(message, privateKeys, m, needsHashing = true) {
    if (m > privateKeys.length) {
      throw new Error('M cannot be greater than the number of private keys');
    }
    
    // Hash the message if needed
    const messageToSign = needsHashing 
      ? Hash.sha256(message) 
      : (typeof message === 'string' ? message : message.toString('hex'));
    
    // Generate signatures
    const signatures = privateKeys.map(privateKey => {
      const keyPair = ec.keyFromPrivate(privateKey);
      const publicKey = keyPair.getPublic('hex');
      const signature = keyPair.sign(messageToSign);
      
      return {
        publicKey,
        signature: new Signature(signature, signature.recoveryParam).toDER()
      };
    });
    
    return {
      m,
      signatures,
      message: messageToSign
    };
  }

  /**
   * Verify a multi-signature
   * @param {object} multiSig - Multi-signature object
   * @param {boolean} needsHashing - Whether the message is already hashed
   * @returns {boolean} - Whether the multi-signature is valid
   */
  static verifyMultiSignature(multiSig, needsHashing = false) {
    const { m, signatures, message } = multiSig;
    
    if (signatures.length < m) {
      return false;
    }
    
    let validCount = 0;
    
    for (const { publicKey, signature } of signatures) {
      if (Signature.verifySignature(message, signature, publicKey, needsHashing)) {
        validCount++;
      }
      
      if (validCount >= m) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Serialize signature for storage or transmission
   * @returns {object} - Serialized signature
   */
  serialize() {
    return {
      r: this.r,
      s: this.s,
      recoveryParam: this.recoveryParam
    };
  }

  /**
   * Create signature from serialized data
   * @param {object} data - Serialized signature data
   * @returns {Signature} - Reconstructed signature
   */
  static deserialize(data) {
    return Signature.fromRsHex(data.r, data.s, data.recoveryParam);
  }
}

module.exports = Signature;