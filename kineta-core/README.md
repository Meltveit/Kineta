# Kineta - GDP-linked Cryptocurrency

Kineta is a revolutionary cryptocurrency with a built-in GDP-linked inflation mechanism designed to create long-term stability and economic relevance.

## Key Features

- **GDP-linked Inflation**: Automatically adjusts to follow global economic growth (minimum 0.25% annual inflation)
- **Economic Stability**: Designed to avoid deflationary spirals while maintaining value during growth periods
- **Sustainable Mining**: Guaranteed positive block rewards through all economic conditions
- **Low Fees**: 0.02% developer fee to support ongoing development
- **Robust Architecture**: Built with a modular JavaScript/Node.js codebase

## Technical Specifications

- **Block Time**: 123 seconds
- **Initial Supply**: 123,456,789 KIN
- **Divisibility**: 9 decimal places (smallest unit: 0.000000001 KIN or "Pulse")
- **Consensus**: Proof of Work with dynamic difficulty adjustment
- **Adjustment Period**: Every 123,000 blocks (approximately 6 months)
- **Network**: P2P with automatic peer discovery and management

## Architecture

Kineta is built with a modular design, comprising several key components:

- **Core**: Blockchain, blocks, transactions, and memory pool management
- **Crypto**: Cryptographic functions including wallet, hashing, and digital signatures
- **Consensus**: Proof of Work mining, difficulty adjustment, and validation
- **Economic**: GDP oracle, inflation model, reward calculation, and fee management
- **Network**: P2P networking, node management, and blockchain synchronization
- **Storage**: Database abstraction and blockchain storage
- **API**: RESTful API server with comprehensive endpoints

## Getting Started

### Prerequisites

- Node.js 14.0.0 or higher
- NPM 6.0.0 or higher

### Installation

```bash
# Clone the repository
git clone https://github.com/kineta/kineta-core.git
cd kineta-core

# Install dependencies
npm install
```

### Running a Node

```bash
# Start a node using the default configuration
npm start

# Or with a custom configuration
NODE_ENV=production npm start
```

### Configuration

Edit the configuration files in the `config` directory to customize your node:

- **default.json**: Default configuration for development
- **production.json**: Production configuration (create this file as needed)

## API Documentation

When running a node with the API enabled, you can access the Swagger documentation at:

```
http://localhost:3000/docs
```

The API provides comprehensive endpoints for interacting with the blockchain:

- **/blockchain**: Blockchain and block information
- **/transactions**: Transaction submission and queries
- **/addresses**: Address information and balances
- **/node**: Node status and management
- **/stats**: Statistical information

## Consensus Algorithm

Kineta uses a Proof of Work (PoW) consensus algorithm with a dynamic difficulty adjustment mechanism that targets a 123-second block time. The difficulty is adjusted every 1,008 blocks (approximately 3.5 days) with safeguards to prevent extreme difficulty swings.

## Economic Model

The fundamental innovation of Kineta is its GDP-linked inflation model:

```
Annual inflation rate = max(0.25%, GDP growth + 0.25%)
```

This ensures:
- A minimum positive inflation rate of 0.25% even during economic downturns
- The currency grows with the global economy during periods of economic expansion
- Block rewards adjust dynamically to maintain the targeted inflation rate

## Development

### Project Structure

```
kineta-core/
├── src/
│   ├── core/               # Core blockchain components
│   ├── crypto/             # Cryptographic functions
│   ├── consensus/          # Consensus mechanism
│   ├── economic/           # Economic mechanisms
│   ├── network/            # Network layer
│   ├── storage/            # Data storage
│   └── api/                # API server
├── config/                 # Configuration files
├── examples/               # Example code
└── docs/                   # Documentation
```

### Testing

```bash
# Run all tests
npm test

# Run specific test
npm test -- --testPathPattern=blockchain
```

### Contributing

We welcome contributions to Kineta! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details on how to contribute.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contact

- Website: [kineta.io](https://kineta.io)
- Email: [info@kineta.io](mailto:info@kineta.io)
- GitHub: [github.com/kineta/kineta-core](https://github.com/kineta/kineta-core)