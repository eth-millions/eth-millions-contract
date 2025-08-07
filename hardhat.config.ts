import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomiclabs/hardhat-etherscan";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";
import "hardhat-contract-sizer";
import { config as dotenvConfig } from "dotenv";

dotenvConfig();

const PRIVATE_KEY: string = process.env.PRIVATE_KEY || "0x" + "11".repeat(32);
const ETHERSCAN_API_KEY: string = process.env.ETHERSCAN_API_KEY || "";
const SEPOLIA_RPC_URL: string = process.env.SEPOLIA_RPC_URL || "";
const MAINNET_RPC_URL: string = process.env.MAINNET_RPC_URL || "";
const COINMARKETCAP_API_KEY: string = process.env.COINMARKETCAP_API_KEY || "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.19",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      gas: 12000000,
      blockGasLimit: 12000000,
      allowUnlimitedContractSize: true,
    },
    localhost: {
      chainId: 31337,
      url: "http://127.0.0.1:8545",
    },
    sepolia: {
      chainId: 11155111,
      url: SEPOLIA_RPC_URL,
      accounts: PRIVATE_KEY !== "0x" + "11".repeat(32) ? [PRIVATE_KEY] : [],
      gas: 6000000,
      gasPrice: 20000000000, // 20 gwei
    },
    ethereum: {
      chainId: 1,
      url: MAINNET_RPC_URL,
      accounts: PRIVATE_KEY !== "0x" + "11".repeat(32) ? [PRIVATE_KEY] : [],
      gas: 6000000,
      gasPrice: 20000000000,
    },
  },
  etherscan: {
    apiKey: ETHERSCAN_API_KEY,
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
    gasPrice: 20,
    coinmarketcap: COINMARKETCAP_API_KEY,
  },
  contractSizer: {
    alphaSort: true,
    disambiguatePaths: false,
    runOnCompile: true,
    strict: true,
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v5",
    alwaysGenerateOverloads: false,
    externalArtifacts: ["externalArtifacts/*.json"],
  },
  mocha: {
    timeout: 200000, // 200 seconds
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
