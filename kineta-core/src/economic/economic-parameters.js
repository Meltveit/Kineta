/**
 * economic-parameters.js - Oppdaterte økonomiske parametere for Kineta blockchain
 * 
 * Dette er en konfigurasjonsmodul som definerer de økonomiske parametrene
 * for Kineta-blokkjeden, basert på global valuta i omløp.
 */

/**
 * Kineta økonomiske konstanter
 */
const ECONOMIC_CONSTANTS = {
    // Total forsyning basert på global valuta i omløp (15 billioner EUR)
    TOTAL_SUPPLY: 15000000000000, // 15 billioner KIN
  
    // Initial tilgjengelig forsyning ved lansering (0.5% av total)
    INITIAL_SUPPLY: 75000000000, // 75 milliarder KIN (0.5% av total)
  
    // Resterende forsyning som skal utvinnes over tid
    MINABLE_SUPPLY: 14925000000000, // 14.925 billioner KIN (99.5%)
    
    // Fordeling av initial forsyning
    DISTRIBUTION: {
      DEVELOPMENT_FUND: 0.40, // 40% til utviklingsfond (30 milliarder KIN)
      ECOSYSTEM_GROWTH: 0.20, // 20% til økosystemvekst (15 milliarder KIN)
      INITIAL_PARTICIPANTS: 0.30, // 30% til tidlige deltakere (22.5 milliarder KIN)
      RESERVES: 0.10, // 10% til reserver/stabilitet (7.5 milliarder KIN)
    },
    
    // Blokk og mining parametere
    BLOCK_TIME: 123, // 123 sekunder mellom blokker
    BLOCKS_PER_DAY: Math.floor(86400 / 123), // ~702 blokker per dag
    BLOCKS_PER_YEAR: Math.floor(365 * 86400 / 123), // ~256,439 blokker per år
    
    // Emisjonsplan for mining
    EMISSION: {
      INITIAL_BLOCK_REWARD: 58200, // Cirka KIN per blokk initialt for å tilnærme oss 15 billioner over 100 år
      HALVING_INTERVAL: 4204800, // ~16 år mellom halveringer (16*365*86400/123)
      MIN_BLOCK_REWARD: 100, // Minimum blokkbelønning for å sikre nettverk
    },
    
    // Inflasjonsmål
    INFLATION: {
      MIN_ANNUAL_RATE: 0.0025, // 0.25% minimum årlig inflasjon
      TARGET_GROWTH_OFFSET: 0.0025, // BNP-vekst + 0.25%
      ADJUSTMENT_INTERVAL: 123000, // ~6 måneder mellom justeringer
    },
    
    // Avgiftsstruktur
    FEES: {
      DEVELOPER_FEE_RATE: 0.0002, // 0.02% utvikleravgift
      BASE_TX_FEE_RATE: 0.002, // 0.2% basis transaksjonsavgift (endret fra 0.001%)
      MIN_TX_FEE: 0.0001 // 0.0001 KIN minimum transaksjonsavgift
    },
    
    // Vanskelighetsgradjustering
    DIFFICULTY: {
      INITIAL_DIFFICULTY: 4,
      ADJUSTMENT_INTERVAL: 1008, // ~3.5 dager mellom justeringer
      TARGET_BLOCK_TIME: 123, // Ønsket tid mellom blokker
      MAX_ADJUSTMENT_FACTOR: 4 // Maksimal justering i én gang
    },
    
    // Delbarhet
    DECIMALS: 9, // 9 desimaler (0.000000001 KIN = 1 "Pulse")
    
    // Dagens dato
    CURRENT_DATE: new Date('2025-04-17')
  };
  
  /**
   * Beregn blokkbelønning basert på blokkhøyde
   * @param {number} blockHeight - Blokkhøyde
   * @param {number} currentSupply - Nåværende sirkulerende forsyning (opsjonell)
   * @param {number} gdpGrowth - BNP-vekst faktor (opsjonell)
   * @returns {number} - Blokkbelønning i KIN
   */
  function calculateBlockReward(blockHeight, currentSupply = null, gdpGrowth = 0.025) {
    // Beregn gjeldende halvering
    const halving = Math.floor(blockHeight / ECONOMIC_CONSTANTS.EMISSION.HALVING_INTERVAL);
    
    // Beregn basis blokkbelønning basert på halvering
    let reward = ECONOMIC_CONSTANTS.EMISSION.INITIAL_BLOCK_REWARD / Math.pow(2, halving);
    
    // Sikre at vi ikke går under minimum blokkbelønning
    reward = Math.max(reward, ECONOMIC_CONSTANTS.EMISSION.MIN_BLOCK_REWARD);
    
    // Hvis vi har økonomisk modell data, juster med BNP-kobling
    if (currentSupply !== null && gdpGrowth !== null) {
      // Beregn inflasjonsrate basert på BNP-vekst
      const inflationRate = Math.max(
        ECONOMIC_CONSTANTS.INFLATION.MIN_ANNUAL_RATE,
        gdpGrowth + ECONOMIC_CONSTANTS.INFLATION.TARGET_GROWTH_OFFSET
      );
      
      // Beregn ny belønning basert på inflasjonsmål
      const targetAnnualIssuance = currentSupply * inflationRate;
      const targetBlockReward = targetAnnualIssuance / ECONOMIC_CONSTANTS.BLOCKS_PER_YEAR;
      
      // Gradvis juster mot inflasjonsmålet (50% vekt til halvering, 50% til inflasjonsmål)
      reward = (reward + targetBlockReward) / 2;
    }
    
    // Avrund til nærmeste helltall (KIN har 9 desimaler, så dette er det samme som nærmeste "Pulse")
    return Math.floor(reward);
  }
  
  /**
   * Beregn utvikleravgift for en transaksjon
   * @param {number} amount - Transaksjonsbeløp
   * @returns {number} - Utvikleravgift i KIN
   */
  function calculateDeveloperFee(amount) {
    return amount * ECONOMIC_CONSTANTS.FEES.DEVELOPER_FEE_RATE;
  }
  
  /**
   * Beregn transaksjonsavgift basert på transaksjonsstørrelse og nettverksbelastning
   * @param {number} txSizeBytes - Transaksjonsstørrelse i bytes
   * @param {number} amount - Transaksjonsbeløp
   * @param {number} networkLoad - Nettverksbelastning (0-1)
   * @returns {number} - Transaksjonsavgift i KIN
   */
  function calculateTransactionFee(txSizeBytes, amount, networkLoad = 0.5) {
    // Basisavgift basert på beløp (0.2%)
    const baseFee = amount * ECONOMIC_CONSTANTS.FEES.BASE_TX_FEE_RATE;
    
    // Størrelsebasert tillegg
    const sizeFee = txSizeBytes * 0.00001;
    
    // Dynamisk multiplikator basert på nettverksbelastning
    const loadMultiplier = 1 + (networkLoad * 2); // 1-3x multiplikator
    
    // Beregn avgift
    const fee = Math.max(
      (baseFee + sizeFee) * loadMultiplier,
      ECONOMIC_CONSTANTS.FEES.MIN_TX_FEE
    );
    
    return fee;
  }
  
  /**
   * Estimere tid til full utvinning av tokens
   * @returns {object} - Informasjon om estimert utvinningsplan
   */
  function estimateMiningTimeline() {
    let remainingSupply = ECONOMIC_CONSTANTS.MINABLE_SUPPLY;
    let currentBlockHeight = 0;
    let currentBlockReward = ECONOMIC_CONSTANTS.EMISSION.INITIAL_BLOCK_REWARD;
    let yearlyIssuance = [];
    let years = 0;
    
    while (remainingSupply > 0 && years < 200) {
      const blocksThisYear = ECONOMIC_CONSTANTS.BLOCKS_PER_YEAR;
      let yearlyTotal = 0;
      
      for (let i = 0; i < blocksThisYear; i++) {
        currentBlockReward = calculateBlockReward(currentBlockHeight);
        yearlyTotal += currentBlockReward;
        remainingSupply -= currentBlockReward;
        currentBlockHeight++;
        
        if (remainingSupply <= 0) break;
      }
      
      yearlyIssuance.push({
        year: years + 1,
        issuance: yearlyTotal,
        blockReward: currentBlockReward,
        remainingSupply
      });
      
      years++;
    }
    
    return {
      estimatedYearsToMineAll: years,
      projectedDate: new Date(ECONOMIC_CONSTANTS.CURRENT_DATE.getTime() + (years * 365 * 24 * 60 * 60 * 1000)),
      yearlyIssuance
    };
  }
  
  module.exports = {
    ECONOMIC_CONSTANTS,
    calculateBlockReward,
    calculateDeveloperFee,
    calculateTransactionFee,
    estimateMiningTimeline
  };