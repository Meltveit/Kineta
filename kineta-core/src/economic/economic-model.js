/**
 * Economic-Model.js - BNP-koblet økonomisk modell for Kineta blockchain
 * 
 * Integrerer:
 * - Inflasjonsmodellen
 * - BNP-datahåndtering
 * - Blokkbelønningsberegninger
 * - Avgiftssystemet
 * 
 * Dette er hovedmodulen som koordinerer alle økonomiske aspekter av Kineta.
 */

const EventEmitter = require('events');
const InflationModel = require('./inflation');
const GDPOracle = require('./gdp-oracle');
const RewardCalculator = require('./reward');
const FeeManager = require('./fee');

/**
 * Hovedklasse for Kinetas økonomiske modell
 */
class EconomicModel extends EventEmitter {
  /**
   * Initialiser økonomisk modell
   * @param {object} options - Konfigurasjonsvalg
   * @param {object} options.blockchain - Referanse til blokkjeden
   */
  constructor(options = {}) {
    super();
    
    this.blockchain = options.blockchain;
    
    // Initialiser underkomponenter
    this.inflationModel = new InflationModel(options.inflation);
    this.gdpOracle = new GDPOracle({
      ...options.gdpOracle,
      blockchain: this.blockchain
    });
    this.rewardCalculator = new RewardCalculator({
      ...options.reward,
      inflationModel: this.inflationModel
    });
    this.feeManager = new FeeManager({
      ...options.fee,
      blockchain: this.blockchain
    });
    
    // Koble hendelser mellom komponenter
    this.setupEventListeners();
  }

  /**
   * Sett opp hendelseslyttere mellom økonomiske komponenter
   * @private
   */
  setupEventListeners() {
    // GDP Oracle -> Inflation Model
    this.gdpOracle.on('consensusUpdated', (data) => {
      this.inflationModel.updateWithGDPData(data.newValue, data.blockHeight);
    });
    
    // Inflation Model -> Economic Model
    this.inflationModel.on('inflationAdjusted', (data) => {
      this.emit('inflationAdjusted', data);
    });
    
    // Reward Calculator -> Economic Model
    this.rewardCalculator.on('rewardCalculated', (data) => {
      this.emit('rewardCalculated', data);
    });
    
    // Fee Manager -> Economic Model
    this.feeManager.on('feeRatesAdjusted', (data) => {
      this.emit('feeRatesAdjusted', data);
    });
  }

  /**
   * Oppdater økonomisk modell med ny blokkdatа
   * @param {number} blockHeight - Blokkens høyde
   * @param {number} circulating Supply - Sirkulerende forsyning
   * @param {object} mempool - Referanse til mempool
   */
  update(blockHeight, circulatingSupply, mempool) {
    // Oppdater BNP-oracle hvis det er på tide
    if (this.gdpOracle.needsUpdate(blockHeight)) {
      this.gdpOracle.updateBlockchain(blockHeight);
    }
    
    // Juster avgifter basert på nettverksforhold
    this.feeManager.adjustFeeRates(blockHeight, mempool);
  }

  /**
   * Beregn inflasjonsrate basert på BNP-vekst
   * @param {number} gdpGrowth - BNP-vekst (desimal)
   * @returns {number} - Beregnet inflasjonsrate
   */
  calculateInflationRate(gdpGrowth) {
    return this.inflationModel.calculateInflationRate(gdpGrowth);
  }

  /**
   * Beregn blokkbelønning basert på høyde og forsyning
   * @param {number} blockHeight - Blokkens høyde
   * @param {number} currentSupply - Sirkulerende forsyning
   * @returns {object} - Blokkbelønning fordeling
   */
  calculateBlockReward(blockHeight, currentSupply) {
    return this.rewardCalculator.calculateReward(blockHeight, currentSupply);
  }

  /**
   * Beregn transaksjonskostnad
   * @param {object} transaction - Transaksjonsobjekt
   * @param {number} priority - Prioritetsnivå (0-2)
   * @returns {number} - Beregnet avgift
   */
  calculateFee(transaction, priority = 0) {
    return this.feeManager.calculateFee(transaction, priority);
  }

  /**
   * Utvinning og fordeling av blokkbelønning
   * @param {number} blockHeight - Blokkens høyde
   * @param {string} minerAddress - Gruvearbeidernes adresse
   * @param {string} devFundAddress - Utviklingsfondets adresse
   * @param {number} currentSupply - Sirkulerende forsyning
   * @returns {object} - Distribusjonsdetaljer
   */
  distributeBlockReward(blockHeight, minerAddress, devFundAddress, currentSupply) {
    return this.rewardCalculator.distributeBlockReward(
      blockHeight,
      minerAddress,
      devFundAddress,
      currentSupply
    );
  }

  /**
   * Behandle transaksjonsavgifter for en blokk
   * @param {object} block - Blokk med transaksjoner
   * @param {string} minerAddress - Gruvearbeiderens adresse
   * @returns {object} - Avgiftsfordelings-sammendrag
   */
  processBlockFees(block, minerAddress) {
    return this.feeManager.processBlockFees(block, minerAddress);
  }

  /**
   * Behandle utvikleravgift for en transaksjon
   * @param {object} transaction - Transaksjonsobjekt
   * @returns {object|null} - Utvikleravgift-transaksjon eller null
   */
  processDeveloperFee(transaction) {
    return this.feeManager.extractDeveloperFee(transaction);
  }

  /**
   * Send inn BNP-rapport fra pålitelig kilde
   * @param {string} sourceId - Kilde-ID
   * @param {number} gdpGrowth - Årlig BNP-vekst (desimal)
   * @param {string} periodStart - Start på måleperiode (ISO-dato)
   * @param {string} periodEnd - Slutt på måleperiode (ISO-dato)
   * @param {string} signature - Digital signatur på rapporten
   * @param {number} blockHeight - Gjeldende blokkhøyde
   * @returns {boolean} - Om rapporten ble akseptert
   */
  submitGDPReport(sourceId, gdpGrowth, periodStart, periodEnd, signature, blockHeight) {
    return this.gdpOracle.submitGDPReport(
      sourceId,
      gdpGrowth,
      periodStart,
      periodEnd,
      signature,
      blockHeight
    );
  }

  /**
   * Få gjeldende BNP-vekst
   * @returns {number|null} - Gjeldende BNP-vekst eller null
   */
  getCurrentGDPGrowth() {
    return this.gdpOracle.getCurrentGDPGrowth();
  }

  /**
   * Få gjeldende inflasjonsrate
   * @returns {number} - Gjeldende inflasjonsrate
   */
  getCurrentInflationRate() {
    return this.inflationModel.currentInflationRate;
  }

  /**
   * Generer inflasjons-prognose basert på ulike BNP-scenarier
   * @param {number} currentSupply - Gjeldende forsyning
   * @param {number} years - Antall år å forutsi
   * @returns {object} - Inflasjons- og forsyningsprognoser
   */
  generateInflationForecast(currentSupply, years = 5) {
    return this.inflationModel.generateInflationForecast(currentSupply, years);
  }

  /**
   * Projiser fremtidig forsyning basert på inflasjonsmodell
   * @param {number} blocks - Antall blokker å projisere fremover
   * @returns {object} - Projiseringsresultater
   */
  projectFutureSupply(blocks = 1050000) {
    return this.rewardCalculator.projectFutureSupply(blocks);
  }

  /**
   * Estimer transaksjonskostander for ulike prioritetsnivåer
   * @param {number} txAmount - Transaksjonsbeløp
   * @param {number} dataSize - Tilleggsdatastørrelse i bytes
   * @returns {object} - Kostnadsestimater for ulike prioritetsnivåer
   */
  estimateFees(txAmount, dataSize = 0) {
    return this.feeManager.estimateFees(txAmount, dataSize);
  }

  /**
   * Få samlet økonomisk statistikk fra alle moduler
   * @returns {object} - Samlet økonomisk statistikk
   */
  getEconomicStats() {
    return {
      gdp: this.gdpOracle.getGDPStats(),
      inflation: this.inflationModel.getInflationStats(),
      reward: this.rewardCalculator.getRewardStats(),
      fee: this.feeManager.getFeeStats(),
      
      // Sammendrag av nøkkeltall
      summary: {
        currentGDPGrowth: this.getCurrentGDPGrowth(),
        currentInflation: this.getCurrentInflationRate(),
        currentCirculatingSupply: this.rewardCalculator.currentSupply,
        developerFeeRate: this.feeManager.developerFeeRate,
        collectedDeveloperFees: this.feeManager.getTotalDeveloperFees(),
        totalIssuance: this.rewardCalculator.getTotalIssuance()
      }
    };
  }

  /**
   * Serialiser økonomisk modell-tilstand
   * @returns {object} - Serialisert tilstand
   */
  serialize() {
    return {
      inflation: this.inflationModel.serialize(),
      gdpOracle: this.gdpOracle.serialize(),
      rewardCalculator: this.rewardCalculator.serialize(),
      feeManager: this.feeManager.serialize()
    };
  }

  /**
   * Opprett økonomisk modell fra serialisert tilstand
   * @param {object} data - Serialisert økonomisk modell
   * @param {object} blockchain - Blokkjede-referanse
   * @returns {EconomicModel} - Rekonstruert økonomisk modell
   */
  static deserialize(data, blockchain = null) {
    const model = new EconomicModel({ blockchain });
    
    // Deserialiser underkomponenter
    model.inflationModel = InflationModel.deserialize(data.inflation);
    model.gdpOracle = GDPOracle.deserialize(data.gdpOracle, blockchain);
    model.rewardCalculator = RewardCalculator.deserialize(
      data.rewardCalculator, 
      model.inflationModel
    );
    model.feeManager = FeeManager.deserialize(data.feeManager, blockchain);
    
    // Koble hendelser på nytt
    model.setupEventListeners();
    
    return model;
  }
}

module.exports = EconomicModel;