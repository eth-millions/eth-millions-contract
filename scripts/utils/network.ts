import { network } from "hardhat";

export interface NetworkInfo {
  name: string;
  chainId: number;
  isLocal: boolean;
  isTestnet: boolean;
  isMainnet: boolean;
  blockExplorer?: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
}

export class NetworkUtils {
  private static readonly NETWORK_INFO: Record<string, NetworkInfo> = {
    hardhat: {
      name: "Hardhat",
      chainId: 31337,
      isLocal: true,
      isTestnet: false,
      isMainnet: false,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    },
    localhost: {
      name: "Localhost",
      chainId: 31337,
      isLocal: true,
      isTestnet: false,
      isMainnet: false,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    },
    sepolia: {
      name: "Sepolia",
      chainId: 11155111,
      isLocal: false,
      isTestnet: true,
      isMainnet: false,
      blockExplorer: "https://sepolia.etherscan.io",
      nativeCurrency: { name: "Sepolia Ether", symbol: "SepoliaETH", decimals: 18 },
    },
    ethereum: {
      name: "Ethereum Mainnet",
      chainId: 1,
      isLocal: false,
      isTestnet: false,
      isMainnet: true,
      blockExplorer: "https://etherscan.io",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    },
  };

  static getCurrentNetwork(): NetworkInfo {
    const currentNetwork = network.name;
    return (
      this.NETWORK_INFO[currentNetwork] || {
        name: currentNetwork,
        chainId: 0,
        isLocal: false,
        isTestnet: false,
        isMainnet: false,
        nativeCurrency: { name: "Unknown", symbol: "UNK", decimals: 18 },
      }
    );
  }

  static isLocalNetwork(): boolean {
    return this.getCurrentNetwork().isLocal;
  }

  static isTestnet(): boolean {
    return this.getCurrentNetwork().isTestnet;
  }

  static isMainnet(): boolean {
    return this.getCurrentNetwork().isMainnet;
  }

  static getBlockExplorerUrl(txHash?: string, address?: string): string {
    const network = this.getCurrentNetwork();
    const baseUrl = network.blockExplorer;

    if (!baseUrl) {
      return "Block explorer not available for this network";
    }

    if (txHash) {
      return `${baseUrl}/tx/${txHash}`;
    }

    if (address) {
      return `${baseUrl}/address/${address}`;
    }

    return baseUrl;
  }
}
