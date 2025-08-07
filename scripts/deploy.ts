import { ethers, network, run } from "hardhat";
import { Contract, ContractFactory } from "ethers";
import * as fs from "fs";
import * as path from "path";

// Types
interface NetworkConfig {
  vrfCoordinator?: string;
  keyHash: string;
  subscriptionId: number | string;
  callbackGasLimit: number;
  requestConfirmations: number;
}

interface DeploymentResult {
  network: string;
  euroMillions: string;
  vrfCoordinator: string;
  subscriptionId: string;
  deployer: string;
  deployedAt: string;
  gasUsed?: string;
  deploymentCost?: string;
}

interface NetworkConfigs {
  [networkName: string]: NetworkConfig;
}

const networkConfigs: NetworkConfigs = {
  sepolia: {
    vrfCoordinator: "0x8103B0A8A00be2DDC778e6e7eaa21791Cd364625",
    keyHash: "0x474e34a077df58807dbe9c96d3c009b23b3c6d0cce433e59bbf5b34f823bc56c",
    subscriptionId: process.env.SEPOLIA_SUBSCRIPTION_ID || 0,
    callbackGasLimit: 500000,
    requestConfirmations: 3,
  },
  ethereum: {
    vrfCoordinator: "0x271682DEB8C4E0901D1a1550aD2e64D568E69909",
    keyHash: "0x8af398995b04c28e9951adb9721ef74c74f93e6a478f39e7e0777be13527e7ef",
    subscriptionId: process.env.MAINNET_SUBSCRIPTION_ID || 0,
    callbackGasLimit: 500000,
    requestConfirmations: 3,
  },
  hardhat: {
    vrfCoordinator: undefined, // Will be deployed
    keyHash: "0xd89b2bf150e3b9e13446986e571fb9cab24b13cea0a43ea20a6049a85cc807cc",
    subscriptionId: 1,
    callbackGasLimit: 500000,
    requestConfirmations: 3,
  },
  localhost: {
    vrfCoordinator: undefined, // Will be deployed
    keyHash: "0xd89b2bf150e3b9e13446986e571fb9cab24b13cea0a43ea20a6049a85cc807cc",
    subscriptionId: 1,
    callbackGasLimit: 500000,
    requestConfirmations: 3,
  },
};

class DeploymentManager {
  private networkName: string;
  private config: NetworkConfig;
  private deployer: any;
  private deploymentResult: Partial<DeploymentResult>;

  constructor() {
    this.networkName = network.name;
    this.config = networkConfigs[this.networkName] || networkConfigs.hardhat;
    this.deploymentResult = {};
  }

  async initialize(): Promise<void> {
    const signers = await ethers.getSigners();
    this.deployer = signers[0];

    console.log("🚀 EuroMillions Deployment Started");
    console.log("==================================");
    console.log(`Network: ${this.networkName}`);
    console.log(`Deployer: ${this.deployer.address}`);
    console.log(`Balance: ${ethers.utils.formatEther(await this.deployer.getBalance())} ETH`);
    console.log(
      `Gas Price: ${ethers.utils.formatUnits(await this.deployer.getGasPrice(), "gwei")} gwei\n`
    );

    this.deploymentResult = {
      network: this.networkName,
      deployer: this.deployer.address,
      deployedAt: new Date().toISOString(),
    };
  }

  async deployVRFCoordinatorMock(): Promise<{
    contract: Contract;
    subscriptionId: string;
  }> {
    if (!this.isLocalNetwork()) {
      throw new Error("VRF Mock should only be deployed on local networks");
    }

    console.log("📡 Deploying VRF Coordinator Mock...");

    const VRFCoordinatorV2Mock: ContractFactory = await ethers.getContractFactory(
      "VRFCoordinatorV2Mock"
    );

    const vrfCoordinatorMock: Contract = await VRFCoordinatorV2Mock.deploy(0, 0);
    await vrfCoordinatorMock.deployed();

    console.log(`✅ VRF Coordinator Mock deployed: ${vrfCoordinatorMock.address}`);

    // Create and fund subscription
    console.log("🔗 Creating VRF subscription...");
    const createSubTx = await vrfCoordinatorMock.createSubscription();
    const createSubReceipt = await createSubTx.wait();

    const subscriptionId = createSubReceipt.events?.[0]?.args?.subId?.toString();
    if (!subscriptionId) {
      throw new Error("Failed to get subscription ID from transaction receipt");
    }

    const fundAmount = ethers.utils.parseEther("10");
    await vrfCoordinatorMock.fundSubscription(subscriptionId, fundAmount);

    console.log(`✅ Subscription created and funded: ID ${subscriptionId}\n`);

    return {
      contract: vrfCoordinatorMock,
      subscriptionId,
    };
  }

  async deployEuroMillions(vrfCoordinator: string, subscriptionId: string): Promise<Contract> {
    console.log("🎰 Deploying EuroMillions contract...");

    const EuroMillions: ContractFactory = await ethers.getContractFactory("EuroMillions");

    // Estimate gas for deployment
    const deploymentData = EuroMillions.interface.encodeDeploy([
      subscriptionId,
      vrfCoordinator,
      this.config.keyHash,
    ]);

    const gasEstimate = await this.deployer.estimateGas({
      data: deploymentData,
    });

    console.log(`📊 Estimated deployment gas: ${gasEstimate.toString()}`);

    const euroMillions: Contract = await EuroMillions.deploy(
      subscriptionId,
      vrfCoordinator,
      this.config.keyHash,
      {
        gasLimit: gasEstimate.mul(120).div(100), // Add 20% buffer
      }
    );

    const deployTx = euroMillions.deployTransaction;
    console.log(`📝 Deployment transaction: ${deployTx.hash}`);

    await euroMillions.deployed();

    const receipt = await deployTx.wait();
    const deploymentCost = receipt.gasUsed.mul(deployTx.gasPrice || 0);

    console.log(`✅ EuroMillions deployed: ${euroMillions.address}`);
    console.log(`⛽ Gas used: ${receipt.gasUsed.toString()}`);
    console.log(`💰 Deployment cost: ${ethers.utils.formatEther(deploymentCost)} ETH\n`);

    // Store deployment metrics
    this.deploymentResult.gasUsed = receipt.gasUsed.toString();
    this.deploymentResult.deploymentCost = ethers.utils.formatEther(deploymentCost);

    return euroMillions;
  }

  async addConsumerToSubscription(
    vrfCoordinatorAddress: string,
    subscriptionId: string,
    consumerAddress: string
  ): Promise<void> {
    if (!this.isLocalNetwork()) {
      console.log("⚠️  Manual step required: Add contract as VRF consumer");
      return;
    }

    console.log("🔗 Adding EuroMillions as VRF consumer...");

    const VRFCoordinatorV2Mock = await ethers.getContractFactory("VRFCoordinatorV2Mock");
    const vrfCoordinator = VRFCoordinatorV2Mock.attach(vrfCoordinatorAddress);

    const tx = await vrfCoordinator.addConsumer(subscriptionId, consumerAddress);
    await tx.wait();

    console.log("✅ Consumer added to VRF subscription\n");
  }

  async verifyContract(contractAddress: string, constructorArgs: any[]): Promise<void> {
    if (this.isLocalNetwork()) {
      console.log("⚠️  Skipping verification on local network\n");
      return;
    }

    console.log("🔍 Verifying contract on Etherscan...");
    console.log("⏳ Waiting for block confirmations...");

    // Wait for 6 confirmations
    await new Promise((resolve) => setTimeout(resolve, 60000));

    try {
      await run("verify:verify", {
        address: contractAddress,
        constructorArguments: constructorArgs,
      });
      console.log("✅ Contract verified on Etherscan\n");
    } catch (error: any) {
      if (error.message.includes("Already Verified")) {
        console.log("✅ Contract already verified on Etherscan\n");
      } else {
        console.log(`❌ Verification failed: ${error.message}\n`);
      }
    }
  }

  async saveDeploymentInfo(): Promise<void> {
    const deploymentDir = path.join(__dirname, "..", "deployments");

    if (!fs.existsSync(deploymentDir)) {
      fs.mkdirSync(deploymentDir, { recursive: true });
    }

    const filePath = path.join(deploymentDir, `${this.networkName}.json`);
    fs.writeFileSync(filePath, JSON.stringify(this.deploymentResult, null, 2));

    console.log(`💾 Deployment info saved to: ${filePath}`);
  }

  printSummary(): void {
    console.log("\n🎉 Deployment Complete!");
    console.log("========================");
    console.log(`Network: ${this.deploymentResult.network}`);
    console.log(`EuroMillions: ${this.deploymentResult.euroMillions}`);
    console.log(`VRF Coordinator: ${this.deploymentResult.vrfCoordinator}`);
    console.log(`Subscription ID: ${this.deploymentResult.subscriptionId}`);
    console.log(`Deployer: ${this.deploymentResult.deployer}`);

    if (this.deploymentResult.gasUsed) {
      console.log(`Gas Used: ${this.deploymentResult.gasUsed}`);
    }

    if (this.deploymentResult.deploymentCost) {
      console.log(`Deployment Cost: ${this.deploymentResult.deploymentCost} ETH`);
    }

    if (!this.isLocalNetwork()) {
      console.log("\n📋 Next Steps for Live Network:");
      console.log("===============================");
      console.log("1. 🔗 Visit https://vrf.chain.link/");
      console.log("2. 💰 Fund your VRF subscription with LINK tokens");
      console.log("3. 🔧 Add the contract address as a consumer:");
      console.log(`   Contract: ${this.deploymentResult.euroMillions}`);
      console.log(`   Subscription: ${this.deploymentResult.subscriptionId}`);
      console.log("4. 🎮 Test the contract with small amounts first");
    } else {
      console.log("\n🎮 Ready for Local Testing!");
      console.log("===========================");
      console.log("Run: npm run simulate-draw");
      console.log("Or: npm run interact");
    }
  }

  private isLocalNetwork(): boolean {
    return this.networkName === "hardhat" || this.networkName === "localhost";
  }

  updateDeploymentResult(updates: Partial<DeploymentResult>): void {
    this.deploymentResult = { ...this.deploymentResult, ...updates };
  }
}

async function main(): Promise<void> {
  const manager = new DeploymentManager();

  try {
    await manager.initialize();

    let vrfCoordinatorAddress: string;
    let subscriptionId: string;

    // Handle VRF Coordinator deployment/configuration
    if (manager["isLocalNetwork"]()) {
      const { contract, subscriptionId: subId } = await manager.deployVRFCoordinatorMock();
      vrfCoordinatorAddress = contract.address;
      subscriptionId = subId;
    } else {
      const config = networkConfigs[network.name];
      if (!config.vrfCoordinator) {
        throw new Error(`VRF Coordinator address not configured for network: ${network.name}`);
      }
      if (!config.subscriptionId || config.subscriptionId === 0) {
        throw new Error(`VRF Subscription ID not configured for network: ${network.name}`);
      }

      vrfCoordinatorAddress = config.vrfCoordinator;
      subscriptionId = config.subscriptionId.toString();
    }

    // Deploy EuroMillions contract
    const euroMillions = await manager.deployEuroMillions(vrfCoordinatorAddress, subscriptionId);

    // Update deployment result
    manager.updateDeploymentResult({
      euroMillions: euroMillions.address,
      vrfCoordinator: vrfCoordinatorAddress,
      subscriptionId,
    });

    // Add consumer to subscription
    await manager.addConsumerToSubscription(
      vrfCoordinatorAddress,
      subscriptionId,
      euroMillions.address
    );

    // Verify contract
    await manager.verifyContract(euroMillions.address, [
      subscriptionId,
      vrfCoordinatorAddress,
      networkConfigs[network.name].keyHash,
    ]);

    // Save deployment info
    await manager.saveDeploymentInfo();

    // Print summary
    manager.printSummary();
  } catch (error: any) {
    console.error("\n❌ Deployment Failed!");
    console.error("=====================");
    console.error(`Error: ${error.message}`);

    if (error.code) {
      console.error(`Code: ${error.code}`);
    }

    if (error.transaction) {
      console.error(`Transaction Hash: ${error.transaction.hash}`);
    }

    process.exit(1);
  }
}

// Utility functions for TypeScript support
export async function deployToNetwork(networkName: string): Promise<DeploymentResult> {
  // Override network for programmatic deployment
  Object.defineProperty(network, "name", {
    value: networkName,
    writable: false,
  });

  const manager = new DeploymentManager();
  await manager.initialize();

  // ... rest of deployment logic
  // This would be used for programmatic deployments

  return manager["deploymentResult"] as DeploymentResult;
}

export { DeploymentManager, NetworkConfig, DeploymentResult };

// Run deployment if this file is executed directly
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
