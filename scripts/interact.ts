import { network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { EuroMillionsContract } from "./types";
import { DeploymentResult } from "./deploy";
import { ethers } from "ethers";

export async function getDeployedContract(): Promise<{
  euroMillions: EuroMillionsContract;
  deployment: DeploymentResult;
}> {
  const networkName = network.name;
  const deploymentPath = path.join(__dirname, "..", "deployments", `${networkName}.json`);

  if (!fs.existsSync(deploymentPath)) {
    throw new Error(`No deployment found for network: ${networkName}`);
  }

  const deployment: DeploymentResult = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const EuroMillions = await ethers.ContractFactory.getContract("EuroMillions");
  const euroMillions = EuroMillions.attach(deployment.euroMillions) as EuroMillionsContract;

  return { euroMillions, deployment };
}

export async function buyTicket(
  mainNumbers: [number, number, number, number, number],
  luckyStars: [number, number]
): Promise<void> {
  const { euroMillions } = await getDeployedContract();
  const [signer] = await ethers.getSigners();

  console.log(`🎫 Buying ticket: [${mainNumbers.join(", ")}] ⭐ [${luckyStars.join(", ")}]`);

  const tx = await euroMillions.connect(signer).buyTicket(mainNumbers, luckyStars, {
    value: ethers.utils.parseEther("0.01"),
  });

  const receipt = await tx.wait();
  console.log(`✅ Ticket purchased! Transaction: ${receipt.transactionHash}`);
}

export async function getCurrentStatus(): Promise<void> {
  const { euroMillions } = await getDeployedContract();

  const status = await euroMillions.getCurrentDrawStatus();

  console.log("\n📊 Current Draw Status");
  console.log("=====================");
  console.log(`Draw ID: ${status.drawId}`);
  console.log(`Prize Pool: ${ethers.utils.formatEther(status.totalPrizePool)} ETH`);
  console.log(`Total Tickets: ${status.totalTickets}`);
  console.log(`Time Left: ${status.timeLeft} seconds`);
  console.log(`Is Active: ${status.isActive ? "✅" : "❌"}`);
}

// Usage example in main function
async function interactMain(): Promise<void> {
  try {
    await getCurrentStatus();

    // Example ticket purchase
    // await buyTicket([1, 2, 3, 4, 5], [1, 2]);
  } catch (error: any) {
    console.error("❌ Error:", error.message);
  }
}

if (require.main === module) {
  interactMain();
}
