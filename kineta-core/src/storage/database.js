/**
 * Database.js - Database abstraction for Kineta blockchain
 * 
 * Implements:
 * - LevelDB database interface
 * - Key-value storage operations
 * - Batch operations
 * - Database maintenance
 */

const level = require('level');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

/**
 * Database abstraction for Kineta blockchain
 */
class Database extends EventEmitter {
  /**
   * Initialize database
   * @param {object} options - Configuration options
   * @param {string} options.dataDir - Data directory path
   * @param {string} options.name - Database name
   * @param {boolean} options.createIfMissing - Create database if missing (default: true)
   * @param {boolean} options.errorIfExists - Error if exists (default: false)
   * @param {number} options.cacheSize - LRU cache size (default: 8MB)
   * @param {boolean} options.compression - Use compression (default: true)
   */
  constructor(options = {}) {
    super();
    
    this.dataDir = options.dataDir || './data';
    this.name = options.name || 'kineta-db';
    this.createIfMissing = options.createIfMissing !== undefined ? options.createIfMissing : true;
    this.errorIfExists = options.errorIfExists || false;
    this.cacheSize = options.cacheSize || 8 * 1024 * 1024; // 8MB
    this.compression = options.compression !== undefined ? options.compression : true;
    
    // Database instance
    this.db = null;
    
    // Database statistics
    this.stats = {
      reads: 0,
      writes: 0,
      deletes: 0,
      batches: 0,
      openTime: 0,
      errors: 0
    };
  }

  /**
   * Open the database
   * @returns {Promise} - Resolves when database is opened
   */
  async open() {
    // Make sure data directory exists
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    
    const dbPath = path.join(this.dataDir, this.name);
    const startTime = Date.now();
    
    try {
      this.db = level(dbPath, {
        createIfMissing: this.createIfMissing,
        errorIfExists: this.errorIfExists,
        cacheSize: this.cacheSize,
        compression: this.compression ? 'snappy' : false
      });
      
      this.stats.openTime = Date.now() - startTime;
      
      this.emit('open', {
        name: this.name,
        path: dbPath,
        openTime: this.stats.openTime
      });
      
      return true;
    } catch (error) {
      this.stats.errors++;
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Close the database
   * @returns {Promise} - Resolves when database is closed
   */
  async close() {
    if (!this.db) {
      return true;
    }
    
    try {
      await this.db.close();
      this.db = null;
      
      this.emit('close', {
        name: this.name
      });
      
      return true;
    } catch (error) {
      this.stats.errors++;
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Put a key-value pair in the database
   * @param {string} key - Key
   * @param {string|object} value - Value (objects will be JSON stringified)
   * @returns {Promise} - Resolves when value is stored
   */
  async put(key, value) {
    if (!this.db) {
      throw new Error('Database not open');
    }
    
    try {
      // Stringify objects
      const valueToStore = typeof value === 'object' 
        ? JSON.stringify(value) 
        : value;
      
      await this.db.put(key, valueToStore);
      
      this.stats.writes++;
      this.emit('write', { key });
      
      return true;
    } catch (error) {
      this.stats.errors++;
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Get a value from the database
   * @param {string} key - Key
   * @param {boolean} [parse=true] - Parse JSON result
   * @returns {Promise<any>} - Resolves with value
   */
  async get(key, parse = true) {
    if (!this.db) {
      throw new Error('Database not open');
    }
    
    try {
      const value = await this.db.get(key);
      
      this.stats.reads++;
      this.emit('read', { key });
      
      // Parse JSON if requested and possible
      if (parse && typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch (e) {
          // Not JSON, return as is
          return value;
        }
      }
      
      return value;
    } catch (error) {
      if (error.type === 'NotFoundError') {
        return null;
      }
      
      this.stats.errors++;
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Delete a key from the database
   * @param {string} key - Key to delete
   * @returns {Promise} - Resolves when key is deleted
   */
  async del(key) {
    if (!this.db) {
      throw new Error('Database not open');
    }
    
    try {
      await this.db.del(key);
      
      this.stats.deletes++;
      this.emit('delete', { key });
      
      return true;
    } catch (error) {
      this.stats.errors++;
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Check if a key exists in the database
   * @param {string} key - Key to check
   * @returns {Promise<boolean>} - Resolves with whether key exists
   */
  async has(key) {
    if (!this.db) {
      throw new Error('Database not open');
    }
    
    try {
      await this.db.get(key);
      return true;
    } catch (error) {
      if (error.type === 'NotFoundError') {
        return false;
      }
      
      this.stats.errors++;
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Perform a batch operation
   * @param {Array} operations - Array of operations
   * @returns {Promise} - Resolves when batch is complete
   */
  async batch(operations) {
    if (!this.db) {
      throw new Error('Database not open');
    }
    
    // Convert values to strings
    const processedOps = operations.map(op => {
      if (op.type === 'put' && typeof op.value === 'object') {
        return {
          ...op,
          value: JSON.stringify(op.value)
        };
      }
      return op;
    });
    
    try {
      await this.db.batch(processedOps);
      
      this.stats.batches++;
      this.stats.writes += processedOps.filter(op => op.type === 'put').length;
      this.stats.deletes += processedOps.filter(op => op.type === 'del').length;
      
      this.emit('batch', { operations: processedOps.length });
      
      return true;
    } catch (error) {
      this.stats.errors++;
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Get all keys with a given prefix
   * @param {string} prefix - Key prefix
   * @param {object} options - Options for iteration
   * @param {boolean} options.values - Include values (default: true)
   * @param {boolean} options.parse - Parse values as JSON (default: true)
   * @param {number} options.limit - Maximum number of results (default: Infinity)
   * @param {boolean} options.reverse - Reverse order (default: false)
   * @returns {Promise<Array>} - Resolves with array of keys or key-value pairs
   */
  async getByPrefix(prefix, options = {}) {
    if (!this.db) {
      throw new Error('Database not open');
    }
    
    const includeValues = options.values !== false;
    const parse = options.parse !== false;
    const limit = options.limit || Infinity;
    const reverse = options.reverse || false;
    
    const results = [];
    
    try {
      return new Promise((resolve, reject) => {
        const stream = this.db.createReadStream({
          gte: prefix,
          lt: prefix + '\uFFFF', // End of Unicode range
          limit,
          reverse,
          keys: true,
          values: includeValues
        });
        
        stream.on('data', (data) => {
          // Process data based on options
          if (includeValues) {
            if (parse && typeof data.value === 'string') {
              try {
                data.value = JSON.parse(data.value);
              } catch (e) {
                // Not JSON, keep as is
              }
            }
            results.push(data);
          } else {
            results.push(data.key);
          }
          
          this.stats.reads++;
        });
        
        stream.on('error', (error) => {
          this.stats.errors++;
          this.emit('error', error);
          reject(error);
        });
        
        stream.on('end', () => {
          resolve(results);
        });
      });
    } catch (error) {
      this.stats.errors++;
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Get all keys in a range
   * @param {string} start - Start key (inclusive)
   * @param {string} end - End key (exclusive)
   * @param {object} options - Options for iteration
   * @param {boolean} options.values - Include values (default: true)
   * @param {boolean} options.parse - Parse values as JSON (default: true)
   * @param {number} options.limit - Maximum number of results (default: Infinity)
   * @param {boolean} options.reverse - Reverse order (default: false)
   * @returns {Promise<Array>} - Resolves with array of keys or key-value pairs
   */
  async getRange(start, end, options = {}) {
    if (!this.db) {
      throw new Error('Database not open');
    }
    
    const includeValues = options.values !== false;
    const parse = options.parse !== false;
    const limit = options.limit || Infinity;
    const reverse = options.reverse || false;
    
    const results = [];
    
    try {
      return new Promise((resolve, reject) => {
        const stream = this.db.createReadStream({
          gte: start,
          lt: end,
          limit,
          reverse,
          keys: true,
          values: includeValues
        });
        
        stream.on('data', (data) => {
          // Process data based on options
          if (includeValues) {
            if (parse && typeof data.value === 'string') {
              try {
                data.value = JSON.parse(data.value);
              } catch (e) {
                // Not JSON, keep as is
              }
            }
            results.push(data);
          } else {
            results.push(data.key);
          }
          
          this.stats.reads++;
        });
        
        stream.on('error', (error) => {
          this.stats.errors++;
          this.emit('error', error);
          reject(error);
        });
        
        stream.on('end', () => {
          resolve(results);
        });
      });
    } catch (error) {
      this.stats.errors++;
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Count keys with a prefix
   * @param {string} prefix - Key prefix
   * @returns {Promise<number>} - Resolves with count
   */
  async countByPrefix(prefix) {
    if (!this.db) {
      throw new Error('Database not open');
    }
    
    let count = 0;
    
    try {
      return new Promise((resolve, reject) => {
        const stream = this.db.createKeyStream({
          gte: prefix,
          lt: prefix + '\uFFFF' // End of Unicode range
        });
        
        stream.on('data', () => {
          count++;
        });
        
        stream.on('error', (error) => {
          this.stats.errors++;
          this.emit('error', error);
          reject(error);
        });
        
        stream.on('end', () => {
          resolve(count);
        });
      });
    } catch (error) {
      this.stats.errors++;
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Clear all data in the database
   * @returns {Promise} - Resolves when database is cleared
   */
  async clear() {
    if (!this.db) {
      throw new Error('Database not open');
    }
    
    try {
      // Get all keys
      const keys = await this.getByPrefix('', { values: false });
      
      // Delete all keys in batches
      const batchSize = 1000;
      for (let i = 0; i < keys.length; i += batchSize) {
        const batch = keys.slice(i, i + batchSize).map(key => ({
          type: 'del',
          key
        }));
        
        await this.batch(batch);
      }
      
      this.emit('clear');
      
      return true;
    } catch (error) {
      this.stats.errors++;
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Create a database iterator
   * @param {object} options - Iterator options
   * @returns {object} - Database iterator
   */
  iterator(options = {}) {
    if (!this.db) {
      throw new Error('Database not open');
    }
    
    return this.db.iterator(options);
  }

  /**
   * Get database statistics
   * @returns {object} - Database statistics
   */
  getStats() {
    return {
      ...this.stats,
      name: this.name,
      dataDir: this.dataDir,
      isOpen: this.db !== null
    };
  }

  /**
   * Create a database backup
   * @param {string} backupPath - Backup path
   * @returns {Promise} - Resolves when backup is complete
   */
  async backup(backupPath) {
    if (!this.db) {
      throw new Error('Database not open');
    }
    
    const backupFile = backupPath || path.join(
      this.dataDir,
      `${this.name}-backup-${Date.now()}.json`
    );
    
    try {
      const data = {};
      
      // Get all key-value pairs
      const items = await this.getByPrefix('');
      
      for (const item of items) {
        data[item.key] = item.value;
      }
      
      // Write to file
      fs.writeFileSync(backupFile, JSON.stringify(data, null, 2));
      
      this.emit('backup', { path: backupFile, count: items.length });
      
      return backupFile;
    } catch (error) {
      this.stats.errors++;
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Restore database from backup
   * @param {string} backupPath - Backup path
   * @param {boolean} clear - Clear database before restore (default: true)
   * @returns {Promise} - Resolves when restore is complete
   */
  async restore(backupPath, clear = true) {
    if (!this.db) {
      throw new Error('Database not open');
    }
    
    if (!fs.existsSync(backupPath)) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }
    
    try {
      // Clear database if requested
      if (clear) {
        await this.clear();
      }
      
      // Read backup file
      const data = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
      
      // Restore in batches
      const keys = Object.keys(data);
      const batchSize = 1000;
      
      for (let i = 0; i < keys.length; i += batchSize) {
        const batchKeys = keys.slice(i, i + batchSize);
        const batch = batchKeys.map(key => ({
          type: 'put',
          key,
          value: data[key]
        }));
        
        await this.batch(batch);
      }
      
      this.emit('restore', { path: backupPath, count: keys.length });
      
      return true;
    } catch (error) {
      this.stats.errors++;
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Run database compaction
   * @returns {Promise} - Resolves when compaction is complete
   */
  async compact() {
    if (!this.db) {
      throw new Error('Database not open');
    }
    
    try {
      await this.db.compactRange(null, null);
      
      this.emit('compact');
      
      return true;
    } catch (error) {
      this.stats.errors++;
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Get approximate database size
   * @returns {Promise<number>} - Resolves with size in bytes
   */
  async getSize() {
    if (!this.db) {
      throw new Error('Database not open');
    }
    
    try {
      const stats = await this.db.db.approximateSize(null, null);
      return stats;
    } catch (error) {
      this.stats.errors++;
      this.emit('error', error);
      throw error;
    }
  }
}

module.exports = Database;