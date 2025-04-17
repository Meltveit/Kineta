/**
 * Swagger routes for Kineta API
 * 
 * Implements:
 * - API documentation with Swagger UI
 * - OpenAPI specification
 */

const express = require('express');
const swaggerUi = require('swagger-ui-express');
const path = require('path');
const fs = require('fs');

/**
 * Create Swagger documentation routes
 * @returns {Router} - Express router
 */
module.exports = function() {
  const router = express.Router();
  
  // Generate OpenAPI specification
  const swaggerSpec = generateSwaggerSpec();
  
  // Serve Swagger UI
  router.use('/', swaggerUi.serve);
  router.get('/', swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Kineta API Documentation',
    customfavIcon: '/favicon.ico'
  }));
  
  // Serve OpenAPI specification as JSON
  router.get('/swagger.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });
  
  return router;
};

/**
 * Generate OpenAPI specification
 * @returns {object} - OpenAPI specification
 */
function generateSwaggerSpec() {
  return {
    openapi: '3.0.0',
    info: {
      title: 'Kineta Blockchain API',
      version: '1.0.0',
      description: 'API for interacting with the Kineta blockchain',
      contact: {
        name: 'Kineta Development Team',
        url: 'https://kineta.io',
        email: 'support@kineta.io'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: '/api/v1',
        description: 'API Version 1'
      }
    ],
    tags: [
      {
        name: 'blockchain',
        description: 'Blockchain operations'
      },
      {
        name: 'transactions',
        description: 'Transaction operations'
      },
      {
        name: 'addresses',
        description: 'Address operations'
      },
      {
        name: 'node',
        description: 'Node operations'
      },
      {
        name: 'stats',
        description: 'Statistics and metrics'
      }
    ],
    components: {
      schemas: {
        Block: {
          type: 'object',
          properties: {
            hash: {
              type: 'string',
              description: 'Block hash'
            },
            height: {
              type: 'integer',
              description: 'Block height'
            },
            previousHash: {
              type: 'string',
              description: 'Previous block hash'
            },
            timestamp: {
              type: 'integer',
              description: 'Block timestamp'
            },
            nonce: {
              type: 'integer',
              description: 'Block nonce'
            },
            difficulty: {
              type: 'number',
              description: 'Mining difficulty'
            },
            merkleRoot: {
              type: 'string',
              description: 'Merkle root of transactions'
            },
            transactions: {
              type: 'array',
              description: 'List of transactions in this block',
              items: {
                $ref: '#/components/schemas/Transaction'
              }
            }
          }
        },
        Transaction: {
          type: 'object',
          properties: {
            hash: {
              type: 'string',
              description: 'Transaction hash'
            },
            fromAddress: {
              type: 'string',
              description: 'Sender address'
            },
            toAddress: {
              type: 'string',
              description: 'Recipient address'
            },
            amount: {
              type: 'number',
              description: 'Transaction amount'
            },
            fee: {
              type: 'number',
              description: 'Transaction fee'
            },
            timestamp: {
              type: 'integer',
              description: 'Transaction timestamp'
            },
            signature: {
              type: 'object',
              description: 'Transaction signature'
            },
            blockHeight: {
              type: 'integer',
              description: 'Block height where this transaction was included'
            },
            blockHash: {
              type: 'string',
              description: 'Block hash where this transaction was included'
            }
          }
        },
        Address: {
          type: 'object',
          properties: {
            address: {
              type: 'string',
              description: 'Wallet address'
            },
            balance: {
              type: 'number',
              description: 'Current balance'
            },
            transactions: {
              type: 'array',
              description: 'List of transactions for this address',
              items: {
                $ref: '#/components/schemas/Transaction'
              }
            }
          }
        },
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: 'Error message'
            },
            code: {
              type: 'integer',
              description: 'Error code'
            },
            details: {
              type: 'array',
              description: 'Detailed error information',
              items: {
                type: 'object'
              }
            }
          }
        },
        SuccessResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              description: 'Indicates if the request was successful'
            },
            data: {
              type: 'object',
              description: 'Response data'
            }
          }
        }
      },
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key'
        }
      }
    },
    paths: {
      '/blockchain/info': {
        get: {
          tags: ['blockchain'],
          summary: 'Get blockchain information',
          responses: {
            '200': {
              description: 'Successful response',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/SuccessResponse'
                  }
                }
              }
            },
            '500': {
              description: 'Server error',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/Error'
                  }
                }
              }
            }
          }
        }
      },
      '/blockchain/height': {
        get: {
          tags: ['blockchain'],
          summary: 'Get current blockchain height',
          responses: {
            '200': {
              description: 'Successful response',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/SuccessResponse'
                  }
                }
              }
            }
          }
        }
      },
      '/blockchain/blocks/{height}': {
        get: {
          tags: ['blockchain'],
          summary: 'Get block by height',
          parameters: [
            {
              name: 'height',
              in: 'path',
              required: true,
              schema: {
                type: 'integer'
              },
              description: 'Block height'
            }
          ],
          responses: {
            '200': {
              description: 'Successful response',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/SuccessResponse'
                  }
                }
              }
            },
            '404': {
              description: 'Block not found',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/Error'
                  }
                }
              }
            }
          }
        }
      },
      '/blockchain/blocks/hash/{hash}': {
        get: {
          tags: ['blockchain'],
          summary: 'Get block by hash',
          parameters: [
            {
              name: 'hash',
              in: 'path',
              required: true,
              schema: {
                type: 'string'
              },
              description: 'Block hash'
            }
          ],
          responses: {
            '200': {
              description: 'Successful response',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/SuccessResponse'
                  }
                }
              }
            },
            '404': {
              description: 'Block not found',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/Error'
                  }
                }
              }
            }
          }
        }
      },
      '/transactions/{hash}': {
        get: {
          tags: ['transactions'],
          summary: 'Get transaction by hash',
          parameters: [
            {
              name: 'hash',
              in: 'path',
              required: true,
              schema: {
                type: 'string'
              },
              description: 'Transaction hash'
            }
          ],
          responses: {
            '200': {
              description: 'Successful response',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/SuccessResponse'
                  }
                }
              }
            },
            '404': {
              description: 'Transaction not found',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/Error'
                  }
                }
              }
            }
          }
        }
      },
      '/transactions': {
        post: {
          tags: ['transactions'],
          summary: 'Submit a new transaction',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['fromAddress', 'toAddress', 'amount'],
                  properties: {
                    fromAddress: {
                      type: 'string',
                      description: 'Sender address'
                    },
                    toAddress: {
                      type: 'string',
                      description: 'Recipient address'
                    },
                    amount: {
                      type: 'number',
                      description: 'Transaction amount'
                    },
                    fee: {
                      type: 'number',
                      description: 'Transaction fee (optional)'
                    },
                    signature: {
                      type: 'string',
                      description: 'Transaction signature'
                    }
                  }
                }
              }
            }
          },
          responses: {
            '201': {
              description: 'Transaction submitted successfully',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/SuccessResponse'
                  }
                }
              }
            },
            '400': {
              description: 'Invalid transaction',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/Error'
                  }
                }
              }
            }
          }
        }
      },
      '/addresses/{address}/balance': {
        get: {
          tags: ['addresses'],
          summary: 'Get address balance',
          parameters: [
            {
              name: 'address',
              in: 'path',
              required: true,
              schema: {
                type: 'string'
              },
              description: 'Wallet address'
            }
          ],
          responses: {
            '200': {
              description: 'Successful response',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/SuccessResponse'
                  }
                }
              }
            },
            '400': {
              description: 'Invalid address format',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/Error'
                  }
                }
              }
            }
          }
        }
      },
      '/node/info': {
        get: {
          tags: ['node'],
          summary: 'Get node information',
          responses: {
            '200': {
              description: 'Successful response',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/SuccessResponse'
                  }
                }
              }
            }
          }
        }
      },
      '/stats/all': {
        get: {
          tags: ['stats'],
          summary: 'Get all statistics',
          responses: {
            '200': {
              description: 'Successful response',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/SuccessResponse'
                  }
                }
              }
            }
          }
        }
      }
      // More paths can be added...
    }
  };
}