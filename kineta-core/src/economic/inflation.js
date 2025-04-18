/**
 * Inflation.js - BNP-koblet inflasjonsmekanisme for Kineta blockchain
 * 
 * Oppdatert for ny økonomisk modell basert på global valuta i omløp (15 billioner EUR)
 */

const EventEmitter = require('events');
const { ECONOMIC_CONSTANTS } = require('./economic-parameters');

/**
 * Inflasjonsmodell for Kineta blockchain
 * Kjerneinflasjonformel: max(0.25%, BNP-vekst + 0.25%)
 */
class InflationModel extends EventEmitter {
  /**
   * Initialiserer inflasjonsmodellen
   * @param {object} options - Konfigurasjonsvalg
   * @param {number} options.baseRate - Minimum inflasjonsrate (standard: 0.25%)
   * @param {number} options.adjustmentBlocks - Antall blokker mellom justeringer (standard: 123000 ≈ 6 måneder)
   * @param {number} options.initialInflation - Startinflasjonsrate (standard: 2%)
   * @param {number} options.maxInflation - Maksimal inflasjonsrate (standard: 10%)
   * @param {number} options.targetBlockTime - Målrettet tid mellom blokker i sekunder (standard: 123)
   */
  constructor(options = {}) {
    super();
    
    // Bruk økonomiske konstanter med mulighet for overstyring
    this.baseRate = options.baseRate !== undefined ? options.baseRate : ECONOMIC_CONSTANTS.INFLATION.MIN_ANNUAL_RATE;
    this.adjustmentBlocks = options.adjustmentBlocks || ECONOMIC_CONSTANTS.INFLATION.ADJUSTMENT_INTERVAL;
    this.initialInflation = options.initialInflation !== undefined ? options.initialInflation : 0.02;
    this.maxInflation = options.maxInflation || 0.10;
    this.targetBlockTime = options.targetBlockTime || ECONOMIC_CONSTANTS.BLOCK_TIME;
    
    // Gjeldende tilstand
    this.currentInflationRate = this.initialInflation;
    this.lastAdjustmentHeight = 0;
    this.gdpGrowthRate = 0;
    this.inflationHistory = [];
    
    // Systemstarttidspunkt
    this.genesisDate = options.genesisDate || ECONOMIC_CONSTANTS.CURRENT_DATE;
    
    // Lagre initialt inflasjonspunkt
    this.recordInflationPoint(0, this.initialInflation);
  }

  /**
   * Beregn inflasjonsrate basert på BNP-vekst
   * @param {number} gdpGrowth - Årlig BNP-vekst (desimal, f.eks. 0,03 for 3%)
   * @returns {number} - Beregnet inflasjonsrate
   */
  calculateInflationRate(gdpGrowth) {
    // Kjerneformel: max(baseRate, gdpGrowth + baseRate)
    // Dette sikrer minimum inflasjon selv med negativ BNP-vekst
    let inflationRate = Math.max(this.baseRate, gdpGrowth + this.baseRate);
    
    // Begrens til maksimal tillatt inflasjon
    inflationRate = Math.min(inflationRate, this.maxInflation);
    
    return inflationRate;
  }

  /**
   * Oppdater inflasjonsmodellen med nye BNP-data
   * @param {number} gdpGrowth - Årlig BNP-vekst (desimal)
   * @param {number} blockHeight - Gjeldende blokkhøyde
   * @returns {boolean} - Om inflasjonsraten ble oppdatert
   */
  updateWithGDPData(gdpGrowth, blockHeight) {
    // Lagre BNP-vekstraten
    this.gdpGrowthRate = gdpGrowth;
    
    // Sjekk om det er tid for en justering
    if (blockHeight < this.lastAdjustmentHeight + this.adjustmentBlocks) {
      return false;
    }
    
    // Beregn ny inflasjonsrate
    const newInflationRate = this.calculateInflationRate(gdpGrowth);
    
    // Hvis inflasjonsraten endres vesentlig (> 0,1%), logg og send hendelse
    const change = Math.abs(newInflationRate - this.currentInflationRate);
    if (change > 0.001) { // 0,1%
      console.log(`Inflasjon justert fra ${(this.currentInflationRate * 100).toFixed(2)}% til ${(newInflationRate * 100).toFixed(2)}% basert på BNP-vekst på ${(gdpGrowth * 100).toFixed(2)}%`);
      
      this.emit('inflationAdjusted', {
        oldRate: this.currentInflationRate,
        newRate: newInflationRate,
        gdpGrowth: gdpGrowth,
        blockHeight: blockHeight,
        changePercent: change * 100,
        date: new Date()
      });
    }
    
    // Oppdater gjeldende inflasjonsrate
    this.currentInflationRate = newInflationRate;
    this.lastAdjustmentHeight = blockHeight;
    
    // Registrer dette inflasjonspunktet
    this.recordInflationPoint(blockHeight, newInflationRate);
    
    return true;
  }

  /**
   * Registrer inflasjonspunkt for historisk sporing
   * @param {number} blockHeight - Blokkhøyde
   * @param {number} inflationRate - Inflasjonsrate
   */
  recordInflationPoint(blockHeight, inflationRate) {
    const dateEstimate = new Date(this.genesisDate.getTime() + (blockHeight * this.targetBlockTime * 1000));
    
    this.inflationHistory.push({
      blockHeight,
      inflationRate,
      timestamp: Date.now(),
      estimatedDate: dateEstimate,
      gdpGrowth: this.gdpGrowthRate
    });
    
    // Begrens historikken for å unngå minneproblemer
    if (this.inflationHistory.length > 100) {
      this.inflationHistory.shift();
    }
  }

  /**
   * Beregn årlig utstedelse basert på nåværende forsyning og inflasjonsrate
   * @param {number} currentSupply - Nåværende sirkulerende forsyning
   * @returns {number} - Årlig utstedelsesbeløp
   */
  calculateAnnualIssuance(currentSupply) {
    return currentSupply * this.currentInflationRate;
  }

  /**
   * Beregn blokkbelønning basert på årlig utstedelse
   * @param {number} currentSupply - Nåværende sirkulerende forsyning
   * @returns {number} - Blokkbelønning
   */
  calculateBlockReward(currentSupply) {
    const annualIssuance = this.calculateAnnualIssuance(currentSupply);
    const blocksPerYear = ECONOMIC_CONSTANTS.BLOCKS_PER_YEAR;
    return annualIssuance / blocksPerYear;
  }

  /**
   * Beregn forventet forsyning etter et gitt antall år
   * @param {number} initialSupply - Startforsyning
   * @param {number} years - Antall år
   * @param {number} inflationRate - Inflasjonsrate (standard: gjeldende rate)
   * @returns {number} - Forventet forsyning etter angitte år
   */
  calculateExpectedSupply(initialSupply, years, inflationRate = this.currentInflationRate) {
    // Bruker renteformelen: A = P(1 + r)^t
    return initialSupply * Math.pow(1 + inflationRate, years);
  }

  /**
   * Hent inflasjonsrate ved en bestemt blokkhøyde
   * @param {number} blockHeight - Blokkhøyde
   * @returns {number} - Inflasjonsrate ved den høyden
   */
  getInflationRateAtHeight(blockHeight) {
    // Hvis forespurt høyde er i fremtiden, returner gjeldende rate
    if (blockHeight >= this.lastAdjustmentHeight) {
      return this.currentInflationRate;
    }
    
    // Søk i inflasjonshistorikk
    for (let i = this.inflationHistory.length - 1; i >= 0; i--) {
      const point = this.inflationHistory[i];
      if (point.blockHeight <= blockHeight) {
        return point.inflationRate;
      }
    }
    
    // Standard til startinflasjon hvis ingen historikk funnet
    return this.initialInflation;
  }

  /**
   * Sjekk om det er tid for inflasjonsjustering
   * @param {number} blockHeight - Gjeldende blokkhøyde
   * @returns {boolean} - Om det er tid for justering
   */
  isAdjustmentTime(blockHeight) {
    return blockHeight >= this.lastAdjustmentHeight + this.adjustmentBlocks;
  }

  /**
   * Hent neste justeringsblokkhøyde
   * @returns {number} - Blokkhøyde for neste justering
   */
  getNextAdjustmentHeight() {
    return this.lastAdjustmentHeight + this.adjustmentBlocks;
  }

  /**
   * Beregn tid til neste justering
   * @param {number} currentHeight - Gjeldende blokkhøyde
   * @returns {object} - Gjenværende tid i blokker og estimert tid
   */
  getTimeUntilNextAdjustment(currentHeight) {
    const blocksRemaining = this.getNextAdjustmentHeight() - currentHeight;
    const secondsRemaining = blocksRemaining * this.targetBlockTime;
    const estimatedDate = new Date(Date.now() + secondsRemaining * 1000);
    
    return {
      blocksRemaining,
      secondsRemaining,
      daysRemaining: secondsRemaining / (24 * 60 * 60),
      estimatedDate
    };
  }

  /**
   * Beregn den effektive inflasjonsraten gitt endringer i nettverkshashrate
   * @param {number} targetBlockTime - Målrettet tid mellom blokker i sekunder
   * @param {number} actualBlockTime - Faktisk gjennomsnittlig tid mellom blokker
   * @returns {number} - Effektiv årlig inflasjonsrate
   */
  calculateEffectiveInflation(targetBlockTime, actualBlockTime) {
    // Hvis blokker utvunnet raskere enn målet, er effektiv inflasjon høyere
    const ratio = targetBlockTime / actualBlockTime;
    return this.currentInflationRate * ratio;
  }

  /**
   * Generer inflasjonsprognose basert på BNP-vekstscenarier
   * @param {number} currentSupply - Nåværende sirkulerende forsyning
   * @param {number} years - Antall år å prognostisere
   * @param {object} scenarios - BNP-vekstscenarier
   * @returns {object} - Inflasjons- og forsyningsprognoser for hvert scenario
   */
  generateInflationForecast(currentSupply, years = 5, scenarios = {
    low: -0.01,
    baseline: 0.02,
    high: 0.04
  }) {
    const forecast = {};
    
    for (const [name, gdpGrowth] of Object.entries(scenarios)) {
      const inflationRate = this.calculateInflationRate(gdpGrowth);
      const yearlySupply = [currentSupply];
      const yearlyInflation = [inflationRate];
      
      let supply = currentSupply;
      for (let i = 1; i <= years; i++) {
        supply = supply * (1 + inflationRate);
        yearlySupply.push(supply);
        yearlyInflation.push(inflationRate);
      }
      
      forecast[name] = {
        gdpGrowth,
        inflationRate,
        yearlySupply,
        yearlyInflation,
        totalIssuance: yearlySupply[years] - currentSupply,
        percentageIncrease: ((yearlySupply[years] / currentSupply) - 1) * 100
      };
    }
    
    return forecast;
  }

  /**
   * Simuler langsiktig inflasjonseffekt gitt BNP-prognoser
   * @param {number} currentSupply - Nåværende forsyning
   * @param {number} years - Antall år å simulere
   * @param {Function} gdpProjectionFunc - Funksjon som returnerer forventet BNP-vekst for et gitt år
   * @returns {object} - Langsiktig inflasjonssimulering
   */
  simulateLongTermInflation(currentSupply, years = 30, gdpProjectionFunc = null) {
    // Standard BNP-prognose hvis ingen er gitt
    const getGdpGrowth = gdpProjectionFunc || ((year) => {
      // Standard antagelse: 2,5% vekst med sykliske svingninger
      return 0.025 + 0.015 * Math.sin(year / 5 * Math.PI);
    });
    
    const simulation = [];
    let simulatedSupply = currentSupply;
    
    for (let year = 1; year <= years; year++) {
      const gdpGrowth = getGdpGrowth(year);
      const inflationRate = this.calculateInflationRate(gdpGrowth);
      const newSupply = simulatedSupply * (1 + inflationRate);
      const yearlyIssuance = newSupply - simulatedSupply;
      
      simulation.push({
        year,
        gdpGrowth,
        inflationRate,
        supply: newSupply,
        yearlyIssuance,
        issuancePercent: (yearlyIssuance / simulatedSupply) * 100
      });
      
      simulatedSupply = newSupply;
    }
    
    return {
      initialSupply: currentSupply,
      finalSupply: simulatedSupply,
      years,
      simulation,
      totalGrowthPercent: ((simulatedSupply / currentSupply) - 1) * 100
    };
  }

  /**
   * Hent inflasjonsstatistikk og historikk
   * @returns {object} - Inflasjonsstatistikk
   */
  getInflationStats() {
    return {
      currentRate: this.currentInflationRate,
      baseRate: this.baseRate,
      gdpGrowthRate: this.gdpGrowthRate,
      lastAdjustmentHeight: this.lastAdjustmentHeight,
      nextAdjustmentHeight: this.getNextAdjustmentHeight(),
      adjustmentInterval: this.adjustmentBlocks,
      inflationHistory: this.inflationHistory,
      maxInflation: this.maxInflation,
      estimatedInflationCurrentYear: this.currentInflationRate * 100,
      historicalAverage: this.calculateAverageInflation()
    };
  }
  
  /**
   * Beregn gjennomsnittlig inflasjonsrate basert på historikk
   * @returns {number} - Gjennomsnittlig inflasjonsrate
   */
  calculateAverageInflation() {
    if (this.inflationHistory.length === 0) {
      return this.initialInflation;
    }
    
    const sum = this.inflationHistory.reduce((total, point) => total + point.inflationRate, 0);
    return sum / this.inflationHistory.length;
  }

  /**
   * Serialiser inflasjonsmodelltilstand
   * @returns {object} - Serialisert tilstand
   */
  serialize() {
    return {
      baseRate: this.baseRate,
      adjustmentBlocks: this.adjustmentBlocks,
      initialInflation: this.initialInflation,
      maxInflation: this.maxInflation,
      targetBlockTime: this.targetBlockTime,
      currentInflationRate: this.currentInflationRate,
      lastAdjustmentHeight: this.lastAdjustmentHeight,
      gdpGrowthRate: this.gdpGrowthRate,
      inflationHistory: this.inflationHistory,
      genesisDate: this.genesisDate.toISOString()
    };
  }

  /**
   * Opprett inflasjonsmodell fra serialisert tilstand
   * @param {object} data - Serialisert inflasjonsmodell
   * @returns {InflationModel} - Rekonstruert inflasjonsmodell
   */
  static deserialize(data) {
    const model = new InflationModel({
      baseRate: data.baseRate,
      adjustmentBlocks: data.adjustmentBlocks,
      initialInflation: data.initialInflation,
      maxInflation: data.maxInflation,
      targetBlockTime: data.targetBlockTime,
      genesisDate: new Date(data.genesisDate)
    });
    
    model.currentInflationRate = data.currentInflationRate;
    model.lastAdjustmentHeight = data.lastAdjustmentHeight;
    model.gdpGrowthRate = data.gdpGrowthRate;
    model.inflationHistory = data.inflationHistory;
    
    return model;
  }
}

module.exports = InflationModel;