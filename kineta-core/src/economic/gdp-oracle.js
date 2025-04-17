/**
 * GDP-Oracle.js - BNP-datahåndtering for Kineta blockchain
 * 
 * Implementerer:
 * - Innhenting av BNP-data fra pålitelige kilder
 * - Verifisering av datakilder
 * - Konsensusmekanisme for BNP-verdier
 * - Tilstandslagring og historikk
 */

const crypto = require('crypto');
const EventEmitter = require('events');
const { ec: EC } = require('elliptic');
const ec = new EC('secp256k1');

// Kilder definert med offentlige nøkler for verifikasjon
const DEFAULT_TRUSTED_SOURCES = {
  // IMF - International Monetary Fund
  'imf': {
    name: 'International Monetary Fund',
    publicKey: '04a5c13e04cd5e5348805e18cd52df732989f1ce97e2dda6a499570cef2a4ad2cc86dd95c2c756a9d41176062a5a8f3b92515c77183e53eb0678c290452a07ea58',
    weight: 1.0
  },
  // WorldBank - World Bank
  'worldbank': {
    name: 'World Bank',
    publicKey: '042ca80163764dd27202e3b7246bbebde9fc7a3fb95ef3f38a26e5c4c0bf2d70ef84349af773fc70fb5afc9c646e4dd61e5e490af4e7d988c7ecd97c0e8f799d26',
    weight: 1.0
  },
  // OECD - Organisation for Economic Co-operation and Development
  'oecd': {
    name: 'OECD',
    publicKey: '0448625ce1878fc4b02c27ebccd7c23c5c5f9e3fbe3b752ab68bd3d911b595a09ca32b29f11b4f3953c8559fa49ef422906b9615afe59acdcb4404dafbb232dc58',
    weight: 1.0
  },
  // UN - United Nations
  'un': {
    name: 'United Nations',
    publicKey: '04b5f7de922e969e2741041d7cd0a93e25f4a23c5cf4b887aa06aa87b253f7e0e2e6c1c9c3abfe1f2687b31d9a7dd5d1faaf6c459475dd87e2139607372ecec9da',
    weight: 0.8
  },
  // FED - Federal Reserve
  'fed': {
    name: 'Federal Reserve',
    publicKey: '0471c3dc5c8ee36e4dd91f9ed92f38e2c23cbf5ccf34b02f26b6a99e3a5eb7cde6af9675ccd20acd5a50f18abdf8102a75e2ce9c7c3ff65fe0c67f6586ce2cc242',
    weight: 0.8
  }
};

/**
 * GDP Oracle for Kineta blockchain
 * Handles GDP data collection, verification, and consensus
 */
class GDPOracle extends EventEmitter {
  /**
   * Initialize a new GDP Oracle
   * @param {object} options - Configuration options
   * @param {object} options.trustedSources - Map of trusted sources (default: DEFAULT_TRUSTED_SOURCES)
   * @param {number} options.updateInterval - Update interval in blocks (default: 123000)
   * @param {number} options.consensusThreshold - Percentage threshold for consensus (default: 0.67)
   * @param {number} options.maxReportAge - Max age of reports in ms (default: 30 days)
   * @param {object} options.blockchain - Blockchain reference (optional)
   */
  constructor(options = {}) {
    super();
    
    this.trustedSources = options.trustedSources || DEFAULT_TRUSTED_SOURCES;
    this.updateInterval = options.updateInterval || 123000; // ~6 months with 123s blocks
    this.consensusThreshold = options.consensusThreshold || 0.67; // 67% for consensus
    this.maxReportAge = options.maxReportAge || 30 * 24 * 60 * 60 * 1000; // 30 days
    this.blockchain = options.blockchain || null;
    
    // Internal state
    this.gdpReports = [];
    this.currentConsensus = null;
    this.lastUpdateHeight = 0;
    this.gdpHistory = [];
  }

  /**
   * Submit a GDP growth report from a trusted source
   * @param {string} sourceId - Source identifier
   * @param {number} gdpGrowth - Annual GDP growth rate (decimal)
   * @param {string} periodStart - Start of measurement period (ISO date)
   * @param {string} periodEnd - End of measurement period (ISO date)
   * @param {string} signature - Digital signature of the report
   * @param {number} blockHeight - Current block height
   * @returns {boolean} - Whether the report was accepted
   */
  submitGDPReport(sourceId, gdpGrowth, periodStart, periodEnd, signature, blockHeight) {
    // Check if source is trusted
    const source = this.trustedSources[sourceId];
    if (!source) {
      console.error(`Unknown GDP data source: ${sourceId}`);
      return false;
    }
    
    // Create report object
    const report = {
      sourceId,
      sourceName: source.name,
      gdpGrowth,
      periodStart,
      periodEnd,
      signature,
      timestamp: Date.now(),
      blockHeight
    };
    
    // Verify signature
    if (!this.verifyReport(report)) {
      console.error(`Invalid signature for GDP report from ${sourceId}`);
      return false;
    }
    
    // Add report to collection
    this.gdpReports.push(report);
    
    // Sort reports by timestamp (newest first)
    this.gdpReports.sort((a, b) => b.timestamp - a.timestamp);
    
    // Remove outdated reports
    this.pruneOldReports();
    
    // Check if consensus can be reached
    const consensus = this.calculateConsensus();
    if (consensus !== null) {
      const oldConsensus = this.currentConsensus;
      this.currentConsensus = consensus;
      
      // Record in history if consensus changed
      if (oldConsensus === null || Math.abs(oldConsensus - consensus) > 0.0001) {
        this.recordGDPPoint(blockHeight, consensus);
        
        this.emit('consensusUpdated', {
          oldValue: oldConsensus,
          newValue: consensus,
          blockHeight
        });
      }
    }
    
    this.emit('reportAdded', report);
    
    return true;
  }

  /**
   * Verify the signature of a GDP report
   * @param {object} report - GDP report
   * @returns {boolean} - Whether the signature is valid
   */
  verifyReport(report) {
    try {
      const source = this.trustedSources[report.sourceId];
      if (!source) return false;
      
      // Create message to verify
      const message = this.createReportMessage(report);
      
      // Verify signature
      const key = ec.keyFromPublic(source.publicKey, 'hex');
      const signatureObj = this.parseSignature(report.signature);
      
      return key.verify(crypto.createHash('sha256').update(message).digest('hex'), signatureObj);
    } catch (error) {
      console.error('Error verifying GDP report:', error.message);
      return false;
    }
  }

  /**
   * Parse signature string to object
   * @param {string} signature - Signature string (hex)
   * @returns {object} - Signature object for verification
   */
  parseSignature(signature) {
    // Expected format: r (64 chars) + s (64 chars)
    if (signature.length !== 128) {
      throw new Error('Invalid signature format');
    }
    
    return {
      r: signature.substring(0, 64),
      s: signature.substring(64, 128)
    };
  }

  /**
   * Create message string for report verification
   * @param {object} report - GDP report
   * @returns {string} - Message string
   */
  createReportMessage(report) {
    return `${report.sourceId}:${report.gdpGrowth}:${report.periodStart}:${report.periodEnd}`;
  }

  /**
   * Remove reports older than maxReportAge
   */
  pruneOldReports() {
    const now = Date.now();
    this.gdpReports = this.gdpReports.filter(report => 
      now - report.timestamp < this.maxReportAge
    );
  }

  /**
   * Calculate consensus GDP growth rate from all reports
   * @returns {number|null} - Consensus GDP growth or null if no consensus
   */
  calculateConsensus() {
    if (this.gdpReports.length === 0) {
      return null;
    }
    
    // Group reports by source (use most recent from each source)
    const sourceReports = {};
    for (const report of this.gdpReports) {
      if (!sourceReports[report.sourceId] || 
          report.timestamp > sourceReports[report.sourceId].timestamp) {
        sourceReports[report.sourceId] = report;
      }
    }
    
    // Need at least 3 sources for consensus
    const reports = Object.values(sourceReports);
    if (reports.length < 3) {
      return null;
    }
    
    // Calculate weighted median
    const weightedReports = reports.map(report => ({
      gdpGrowth: report.gdpGrowth,
      weight: this.trustedSources[report.sourceId].weight
    }));
    
    // Sort by GDP growth value
    weightedReports.sort((a, b) => a.gdpGrowth - b.gdpGrowth);
    
    // Calculate total weight
    const totalWeight = weightedReports.reduce((sum, r) => sum + r.weight, 0);
    
    // Find weighted median
    let cumulativeWeight = 0;
    for (const report of weightedReports) {
      cumulativeWeight += report.weight;
      if (cumulativeWeight >= totalWeight / 2) {
        return report.gdpGrowth;
      }
    }
    
    // Fallback to simple average if weighted median fails
    const sum = reports.reduce((total, report) => total + report.gdpGrowth, 0);
    return sum / reports.length;
  }

  /**
   * Get current consensus GDP growth rate
   * @returns {number|null} - Current consensus or null if none
   */
  getCurrentGDPGrowth() {
    return this.currentConsensus;
  }

  /**
   * Record GDP data point for historical tracking
   * @param {number} blockHeight - Block height
   * @param {number} gdpGrowth - GDP growth rate
   */
  recordGDPPoint(blockHeight, gdpGrowth) {
    this.gdpHistory.push({
      blockHeight,
      gdpGrowth,
      timestamp: Date.now(),
      reports: this.gdpReports.slice(0, 10) // Store up to 10 reports
    });
    
    // Limit history size to prevent memory issues
    if (this.gdpHistory.length > 50) {
      this.gdpHistory.shift();
    }
    
    this.lastUpdateHeight = blockHeight;
  }

  /**
   * Check if blockchain needs GDP update
   * @param {number} blockHeight - Current block height
   * @returns {boolean} - Whether update is needed
   */
  needsUpdate(blockHeight) {
    return blockHeight >= this.lastUpdateHeight + this.updateInterval;
  }

  /**
   * Update blockchain with latest GDP data if needed
   * @param {number} blockHeight - Current block height
   * @returns {boolean} - Whether update was performed
   */
  updateBlockchain(blockHeight) {
    if (!this.blockchain || !this.needsUpdate(blockHeight)) {
      return false;
    }
    
    const gdpGrowth = this.getCurrentGDPGrowth();
    if (gdpGrowth === null) {
      return false;
    }
    
    // Update the economic model (if implemented on blockchain)
    if (this.blockchain.economicModel && 
        typeof this.blockchain.economicModel.updateWithGDPData === 'function') {
      return this.blockchain.economicModel.updateWithGDPData(gdpGrowth, blockHeight);
    }
    
    return false;
  }

  /**
   * Add a trusted source
   * @param {string} sourceId - Source identifier
   * @param {object} sourceInfo - Source information
   * @returns {boolean} - Whether the source was added
   */
  addTrustedSource(sourceId, sourceInfo) {
    if (this.trustedSources[sourceId]) {
      return false;
    }
    
    this.trustedSources[sourceId] = sourceInfo;
    return true;
  }

  /**
   * Remove a trusted source
   * @param {string} sourceId - Source identifier
   * @returns {boolean} - Whether the source was removed
   */
  removeTrustedSource(sourceId) {
    if (!this.trustedSources[sourceId]) {
      return false;
    }
    
    delete this.trustedSources[sourceId];
    
    // Remove reports from this source
    this.gdpReports = this.gdpReports.filter(report => report.sourceId !== sourceId);
    
    // Recalculate consensus
    const consensus = this.calculateConsensus();
    if (consensus !== null) {
      this.currentConsensus = consensus;
    }
    
    return true;
  }

  /**
   * Generate a test signature for a GDP report (development only)
   * @param {string} sourceId - Source identifier
   * @param {number} gdpGrowth - GDP growth rate
   * @param {string} periodStart - Start of measurement period
   * @param {string} periodEnd - End of measurement period
   * @param {string} privateKey - Private key for signing
   * @returns {string} - Signature in hex format
   */
  static generateTestSignature(sourceId, gdpGrowth, periodStart, periodEnd, privateKey) {
    const message = `${sourceId}:${gdpGrowth}:${periodStart}:${periodEnd}`;
    const messageHash = crypto.createHash('sha256').update(message).digest('hex');
    
    const keyPair = ec.keyFromPrivate(privateKey);
    const signature = keyPair.sign(messageHash);
    
    return signature.r.toString('hex') + signature.s.toString('hex');
  }

  /**
   * Get next update block height
   * @returns {number} - Block height of next update
   */
  getNextUpdateHeight() {
    return this.lastUpdateHeight + this.updateInterval;
  }

  /**
   * Get GDP oracle statistics and history
   * @returns {object} - GDP oracle statistics
   */
  getGDPStats() {
    return {
      currentConsensus: this.currentConsensus,
      lastUpdateHeight: this.lastUpdateHeight,
      nextUpdateHeight: this.getNextUpdateHeight(),
      updateInterval: this.updateInterval,
      reportsCount: this.gdpReports.length,
      sourcesCount: Object.keys(this.trustedSources).length,
      gdpHistory: this.gdpHistory
    };
  }

  /**
   * Serialize GDP oracle state
   * @returns {object} - Serialized state
   */
  serialize() {
    return {
      trustedSources: this.trustedSources,
      updateInterval: this.updateInterval,
      consensusThreshold: this.consensusThreshold,
      maxReportAge: this.maxReportAge,
      gdpReports: this.gdpReports,
      currentConsensus: this.currentConsensus,
      lastUpdateHeight: this.lastUpdateHeight,
      gdpHistory: this.gdpHistory
    };
  }

  /**
   * Create GDP oracle from serialized state
   * @param {object} data - Serialized GDP oracle
   * @param {object} blockchain - Blockchain reference
   * @returns {GDPOracle} - Reconstructed GDP oracle
   */
  static deserialize(data, blockchain = null) {
    const oracle = new GDPOracle({
      trustedSources: data.trustedSources,
      updateInterval: data.updateInterval,
      consensusThreshold: data.consensusThreshold,
      maxReportAge: data.maxReportAge,
      blockchain
    });
    
    oracle.gdpReports = data.gdpReports;
    oracle.currentConsensus = data.currentConsensus;
    oracle.lastUpdateHeight = data.lastUpdateHeight;
    oracle.gdpHistory = data.gdpHistory;
    
    return oracle;
  }
}

module.exports = GDPOracle;