/**
 * Wallet.js - Wallet functionality for Kineta blockchain
 * 
 * Implements:
 * - Key pair generation
 * - Address generation and validation
 * - HD wallet support (BIP32, BIP39, BIP44)
 * - Transaction signing
 * - Wallet import/export
 * - Wallet encryption
 */

const crypto = require('crypto');
const { ec: EC } = require('elliptic');
const ec = new EC('secp256k1');
const Hash = require('/hash');
const Signature = require('/signature');
const bip39 = require('bip39');
const hdkey = require('hdkey');
const bs58check = require('bs58check');

// Network constants
const NETWORK = {
  MAINNET: {
    pubKeyHash: 0x1E, // Starting with 'K'
    scriptHash: 0x32,
    wif: 0x8E,
    bip32: {
      public: 0x0488b21e,
      private: 0x0488ade4
    },
    bip44: 989 // Using a custom coin type for Kineta
  },
  TESTNET: {
    pubKeyHash: 0x6F, // Starting with 't'
    scriptHash: 0xC4,
    wif: 0xEF,
    bip32: {
      public: 0x043587cf,
      private: 0x04358394
    },
    bip44: 989
  }
};

/**
 * Wallet class for Kineta blockchain
 */
class Wallet {
  /**
   * Create a new wallet
   * @param {object} options - Wallet options
   * @param {string} options.privateKey - Existing private key (optional)
   * @param {string} options.mnemonic - Mnemonic phrase (optional)
   * @param {string} options.seed - HD wallet seed (optional)
   * @param {string} options.network - 'mainnet' or 'testnet' (default: 'mainnet')
   */
  constructor(options = {}) {
    this.network = NETWORK[options.network?.toUpperCase() || 'MAINNET'];
    this.accounts = [];
    
    if (options.privateKey) {
      this.importPrivateKey(options.privateKey);
    } else if (options.mnemonic) {
      this.initFromMnemonic(options.mnemonic);
    } else if (options.seed) {
      this.initFromSeed(options.seed);
    } else {
      this.generateNewAccount();
    }
  }

  /**
   * Generate a new account in the wallet
   * @param {string} name - Account name (optional)
   * @returns {object} - The newly created account
   */
  generateNewAccount(name = 'Account ' + (this.accounts.length + 1)) {
    // Generate a new key pair
    const keyPair = ec.genKeyPair();
    const privateKey = keyPair.getPrivate('hex');
    const publicKey = keyPair.getPublic('hex');
    const address = this.generateAddress(publicKey);
    
    const account = {
      name,
      privateKey,
      publicKey,
      address,
      index: this.accounts.length
    };
    
    this.accounts.push(account);
    return account;
  }

  /**
   * Import an existing private key
   * @param {string} privateKey - Private key in hex format
   * @param {string} name - Account name (optional)
   * @returns {object} - The imported account
   */
  importPrivateKey(privateKey, name = 'Imported Account') {
    // Create key pair from private key
    const keyPair = ec.keyFromPrivate(privateKey);
    const publicKey = keyPair.getPublic('hex');
    const address = this.generateAddress(publicKey);
    
    const account = {
      name,
      privateKey,
      publicKey,
      address,
      index: this.accounts.length,
      imported: true
    };
    
    this.accounts.push(account);
    return account;
  }

  /**
   * Generate an address from a public key
   * @param {string} publicKey - Public key in hex format
   * @returns {string} - Kineta address
   */
  generateAddress(publicKey) {
    // Step 1: Generate SHA-256 hash of the public key
    const pubKeyHash = Hash.sha256(publicKey);
    
    // Step 2: Generate RIPEMD-160 hash of the SHA-256 hash
    const hash160 = Hash.ripemd160(pubKeyHash);
    
    // Step 3: Add network prefix
    const prefixedHash = Buffer.alloc(21);
    prefixedHash[0] = this.network.pubKeyHash;
    Buffer.from(hash160, 'hex').copy(prefixedHash, 1);
    
    // Step 4: Encode with Base58Check
    return bs58check.encode(prefixedHash);
  }

  /**
   * Initialize wallet from a mnemonic phrase (BIP39)
   * @param {string} mnemonic - Mnemonic phrase
   * @param {string} passphrase - Optional BIP39 passphrase
   */
  initFromMnemonic(mnemonic, passphrase = '') {
    // Validate mnemonic
    if (!bip39.validateMnemonic(mnemonic)) {
      throw new Error('Invalid mnemonic phrase');
    }
    
    // Generate seed from mnemonic
    const seed = bip39.mnemonicToSeedSync(mnemonic, passphrase);
    this.hdNode = hdkey.fromMasterSeed(seed);
    this.mnemonic = mnemonic;
    
    // Generate first account
    this.deriveAccount(0);
  }

  /**
   * Initialize wallet from a HD seed
   * @param {string|Buffer} seed - HD wallet seed
   */
  initFromSeed(seed) {
    const seedBuffer = typeof seed === 'string' 
      ? Buffer.from(seed, 'hex') 
      : seed;
    
    this.hdNode = hdkey.fromMasterSeed(seedBuffer);
    
    // Generate first account
    this.deriveAccount(0);
  }

  /**
   * Derive an account from the HD wallet using BIP44
   * @param {number} index - Account index
   * @param {string} name - Account name (optional)
   * @returns {object} - The derived account
   */
  deriveAccount(index, name = 'Account ' + (index + 1)) {
    if (!this.hdNode) {
      throw new Error('HD wallet not initialized');
    }
    
    // BIP44 path: m/purpose'/coin_type'/account'/change/address_index
    // For Kineta: m/44'/989'/index'/0/0
    const path = `m/44'/${this.network.bip44}'/${index}'/0/0`;
    const childNode = this.hdNode.derive(path);
    
    const privateKey = childNode.privateKey.toString('hex');
    
    // Create key pair from private key
    const keyPair = ec.keyFromPrivate(privateKey);
    const publicKey = keyPair.getPublic('hex');
    const address = this.generateAddress(publicKey);
    
    const account = {
      name,
      privateKey,
      publicKey,
      address,
      index,
      path
    };
    
    // Check if account already exists
    const existingIndex = this.accounts.findIndex(a => a.index === index);
    if (existingIndex >= 0) {
      this.accounts[existingIndex] = account;
    } else {
      this.accounts.push(account);
    }
    
    return account;
  }

  /**
   * Generate a new mnemonic phrase (BIP39)
   * @param {number} strength - Entropy strength (128, 160, 192, 224, 256)
   * @returns {string} - Mnemonic phrase
   */
  static generateMnemonic(strength = 256) {
    return bip39.generateMnemonic(strength);
  }

  /**
   * Get account by index
   * @param {number} index - Account index
   * @returns {object|null} - Account or null if not found
   */
  getAccount(index) {
    return this.accounts.find(account => account.index === index) || null;
  }

  /**
   * Get account by address
   * @param {string} address - Account address
   * @returns {object|null} - Account or null if not found
   */
  getAccountByAddress(address) {
    return this.accounts.find(account => account.address === address) || null;
  }

  /**
   * Get default account (first account)
   * @returns {object|null} - Default account or null if no accounts
   */
  getDefaultAccount() {
    return this.accounts.length > 0 ? this.accounts[0] : null;
  }

  /**
   * Sign a message with an account's private key
   * @param {string|Buffer} message - Message to sign
   * @param {number|string} account - Account index or address
   * @param {boolean} needsHashing - Whether to hash the message first
   * @returns {string} - Signature in hex format
   */
  signMessage(message, account = 0, needsHashing = true) {
    // Get account by index or address
    let accountObj;
    if (typeof account === 'number') {
      accountObj = this.getAccount(account);
    } else {
      accountObj = this.getAccountByAddress(account);
    }
    
    if (!accountObj) {
      throw new Error('Account not found');
    }
    
    // Sign message
    const signature = Signature.signMessage(
      message,
      accountObj.privateKey,
      needsHashing
    );
    
    return signature.toDER();
  }

  /**
   * Sign a transaction
   * @param {object} transaction - Transaction to sign
   * @param {number|string} account - Account index or address
   * @returns {object} - Signed transaction
   */
  signTransaction(transaction, account = 0) {
    // Get account by index or address
    let accountObj;
    if (typeof account === 'number') {
      accountObj = this.getAccount(account);
    } else {
      accountObj = this.getAccountByAddress(account);
    }
    
    if (!accountObj) {
      throw new Error('Account not found');
    }
    
    // Ensure transaction is from the correct address
    if (transaction.fromAddress !== accountObj.address) {
      throw new Error('Transaction not from this account');
    }
    
    // Sign transaction
    transaction.signTransaction(accountObj.privateKey);
    
    return transaction;
  }

  /**
   * Validate a Kineta address
   * @param {string} address - Address to validate
   * @param {string} network - 'mainnet' or 'testnet'
   * @returns {boolean} - Whether the address is valid
   */
  static validateAddress(address, network = 'mainnet') {
    try {
      // Decode the address
      const decoded = bs58check.decode(address);
      
      // Check prefix
      const networkObj = NETWORK[network.toUpperCase()];
      return decoded[0] === networkObj.pubKeyHash;
    } catch (error) {
      return false;
    }
  }

  /**
   * Export wallet to an encrypted JSON file
   * @param {string} password - Encryption password
   * @returns {string} - Encrypted wallet JSON
   */
  exportEncrypted(password) {
    // Create wallet data
    const walletData = {
      version: 1,
      network: this.network === NETWORK.MAINNET ? 'mainnet' : 'testnet',
      accounts: this.accounts.map(account => ({
        name: account.name,
        index: account.index,
        address: account.address,
        publicKey: account.publicKey,
        privateKey: account.privateKey,
        path: account.path
      })),
      hdData: this.hdNode ? {
        mnemonic: this.mnemonic,
        seed: this.hdNode.privateKey.toString('hex')
      } : null
    };
    
    // Convert to JSON
    const json = JSON.stringify(walletData);
    
    // Encrypt with password
    const salt = crypto.randomBytes(16);
    const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha512');
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(json, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag().toString('hex');
    
    // Create final encrypted wallet
    const encryptedWallet = {
      version: 1,
      encryption: 'aes-256-gcm',
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      authTag,
      encrypted
    };
    
    return JSON.stringify(encryptedWallet);
  }

  /**
   * Import wallet from an encrypted JSON file
   * @param {string} json - Encrypted wallet JSON
   * @param {string} password - Decryption password
   * @returns {Wallet} - Imported wallet
   */
  static importEncrypted(json, password) {
    // Parse encrypted wallet
    const encryptedWallet = JSON.parse(json);
    
    // Check version
    if (encryptedWallet.version !== 1) {
      throw new Error('Unsupported wallet version');
    }
    
    // Decrypt
    const salt = Buffer.from(encryptedWallet.salt, 'hex');
    const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha512');
    const iv = Buffer.from(encryptedWallet.iv, 'hex');
    const authTag = Buffer.from(encryptedWallet.authTag, 'hex');
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted;
    try {
      decrypted = decipher.update(encryptedWallet.encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
    } catch (error) {
      throw new Error('Incorrect password or corrupted wallet file');
    }
    
    // Parse wallet data
    const walletData = JSON.parse(decrypted);
    
    // Create new wallet
    const wallet = new Wallet({
      network: walletData.network
    });
    
    // Import HD data if present
    if (walletData.hdData) {
      if (walletData.hdData.mnemonic) {
        wallet.initFromMnemonic(walletData.hdData.mnemonic);
      } else if (walletData.hdData.seed) {
        wallet.initFromSeed(walletData.hdData.seed);
      }
    }
    
    // Import accounts
    wallet.accounts = [];
    for (const accountData of walletData.accounts) {
      wallet.accounts.push({
        name: accountData.name,
        privateKey: accountData.privateKey,
        publicKey: accountData.publicKey,
        address: accountData.address,
        index: accountData.index,
        path: accountData.path
      });
    }
    
    return wallet;
  }

  /**
   * Create a watch-only wallet (no private keys)
   * @param {string[]} addresses - Array of addresses to watch
   * @param {string} network - 'mainnet' or 'testnet'
   * @returns {Wallet} - Watch-only wallet
   */
  static createWatchOnly(addresses, network = 'mainnet') {
    const wallet = new Wallet({ network });
    
    // Clear any generated accounts
    wallet.accounts = [];
    
    // Add watch-only accounts
    addresses.forEach((address, index) => {
      if (!Wallet.validateAddress(address, network)) {
        throw new Error(`Invalid address: ${address}`);
      }
      
      wallet.accounts.push({
        name: `Watch ${index + 1}`,
        address,
        index,
        watchOnly: true
      });
    });
    
    return wallet;
  }

  /**
   * Create a wallet with multiple deterministic addresses (HD wallet)
   * @param {number} count - Number of addresses to create
   * @param {string} mnemonic - Optional mnemonic (generates new if not provided)
   * @param {string} network - 'mainnet' or 'testnet'
   * @returns {Wallet} - Wallet with multiple addresses
   */
  static createHDWallet(count = 1, mnemonic = null, network = 'mainnet') {
    // Generate or use provided mnemonic
    const mnemonicPhrase = mnemonic || Wallet.generateMnemonic();
    
    // Create wallet from mnemonic
    const wallet = new Wallet({
      mnemonic: mnemonicPhrase,
      network
    });
    
    // Generate additional accounts
    for (let i = 1; i < count; i++) {
      wallet.deriveAccount(i);
    }
    
    return wallet;
  }

  /**
   * Export private key in WIF format (Wallet Import Format)
   * @param {number|string} account - Account index or address
   * @returns {string} - WIF encoded private key
   */
  exportPrivateKeyWIF(account = 0) {
    // Get account by index or address
    let accountObj;
    if (typeof account === 'number') {
      accountObj = this.getAccount(account);
    } else {
      accountObj = this.getAccountByAddress(account);
    }
    
    if (!accountObj) {
      throw new Error('Account not found');
    }
    
    if (accountObj.watchOnly) {
      throw new Error('Cannot export private key for watch-only account');
    }
    
    // Convert to WIF
    const privKey = Buffer.from(accountObj.privateKey, 'hex');
    
    // Create WIF format with network prefix
    const wifBuffer = Buffer.alloc(privKey.length + 2);
    wifBuffer[0] = this.network.wif;
    privKey.copy(wifBuffer, 1);
    // Add compression flag
    wifBuffer[wifBuffer.length - 1] = 0x01;
    
    return bs58check.encode(wifBuffer);
  }

  /**
   * Import private key in WIF format
   * @param {string} wif - WIF encoded private key
   * @param {string} name - Account name (optional)
   * @returns {object} - The imported account
   */
  importPrivateKeyWIF(wif, name = 'Imported WIF') {
    try {
      // Decode WIF
      const decoded = bs58check.decode(wif);
      
      // Check network
      if (decoded[0] !== this.network.wif) {
        throw new Error('WIF key from different network');
      }
      
      // Extract private key
      let privateKey;
      if (decoded.length === 34) {
        // Compressed
        privateKey = decoded.slice(1, 33).toString('hex');
      } else if (decoded.length === 33) {
        // Uncompressed
        privateKey = decoded.slice(1).toString('hex');
      } else {
        throw new Error('Invalid WIF format');
      }
      
      // Import private key
      return this.importPrivateKey(privateKey, name);
    } catch (error) {
      throw new Error(`Failed to import WIF key: ${error.message}`);
    }
  }

  /**
   * Create a paper wallet for cold storage
   * @param {string} network - 'mainnet' or 'testnet'
   * @returns {object} - Paper wallet info
   */
  static createPaperWallet(network = 'mainnet') {
    // Generate a new key pair
    const keyPair = ec.genKeyPair();
    const privateKey = keyPair.getPrivate('hex');
    const publicKey = keyPair.getPublic('hex');
    
    // Create wallet for address generation
    const tempWallet = new Wallet({ network });
    const address = tempWallet.generateAddress(publicKey);
    
    // Convert private key to WIF
    const privKey = Buffer.from(privateKey, 'hex');
    
    // Create WIF format with network prefix
    const networkObj = NETWORK[network.toUpperCase()];
    const wifBuffer = Buffer.alloc(privKey.length + 2);
    wifBuffer[0] = networkObj.wif;
    privKey.copy(wifBuffer, 1);
    // Add compression flag
    wifBuffer[wifBuffer.length - 1] = 0x01;
    
    const wif = bs58check.encode(wifBuffer);
    
    return {
      address,
      privateKey,
      wif,
      publicKey
    };
  }
}

module.exports = Wallet;