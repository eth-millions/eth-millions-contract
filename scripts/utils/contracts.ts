import { ethers, Contract } from "ethers";
import { Logger } from "./logger";

export class ContractManager {
  private provider: ethers.providers.Provider;
  private signer: ethers.Signer;

  constructor(provider: ethers.providers.Provider, signer: ethers.Signer) {
    this.provider = provider;
    this.signer = signer;
  }

  async waitForTransaction(
    txHash: string,
    confirmations: number = 1
  ): Promise<ethers.providers.TransactionReceipt> {
    Logger.info(`Waiting for transaction: ${txHash}`);
    Logger.info(`Required confirmations: ${confirmations}`);

    const receipt = await this.provider.waitForTransaction(txHash, confirmations);

    if (receipt.status === 0) {
      throw new Error(`Transaction failed: ${txHash}`);
    }

    Logger.success(`Transaction confirmed: ${txHash}`);
    return receipt;
  }

  async estimateGasWithBuffer(
    contract: Contract,
    methodName: string,
    args: any[],
    bufferPercent: number = 20
  ): Promise<ethers.BigNumber> {
    const estimatedGas = await contract.estimateGas[methodName](...args);
    const gasWithBuffer = estimatedGas.mul(100 + bufferPercent).div(100);

    Logger.debug(`Gas estimate for ${methodName}: ${estimatedGas.toString()}`);
    Logger.debug(`Gas with ${bufferPercent}% buffer: ${gasWithBuffer.toString()}`);

    return gasWithBuffer;
  }

  async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    delayMs: number = 1000
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        Logger.debug(`Executing operation, attempt ${attempt}/${maxRetries}`);
        return await operation();
      } catch (error: any) {
        lastError = error;
        Logger.warn(`Operation failed on attempt ${attempt}: ${error.message}`);

        if (attempt < maxRetries) {
          Logger.info(`Retrying in ${delayMs}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          delayMs *= 2; // Exponential backoff
        }
      }
    }

    throw lastError!;
  }
}
