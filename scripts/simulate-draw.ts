import { time } from "@nomicfoundation/hardhat-network-helpers";
import { EuroMillionsContract, VRFCoordinatorMock } from "./types";
import { Logger, LogLevel } from "./utils/logger";
import { NetworkUtils } from "./utils/network";
import { ContractManager } from "./utils/contracts";
import { getDeployedContract } from "./interact";

interface SimulationConfig {
  numberOfPlayers: number;
  ticketsPerPlayer: number;
  fastForwardTime: boolean;
  showDetailedResults: boolean;
}

class DrawSimulator {
  private euroMillions!: EuroMillionsContract;
  private vrfMock?: VRFCoordinatorMock;
  private contractManager!: ContractManager;
  private config: SimulationConfig;

  constructor(config: Partial<SimulationConfig> = {}) {
    this.config = {
      numberOfPlayers: 3,
      ticketsPerPlayer: 2,
      fastForwardTime: NetworkUtils.isLocalNetwork(),
      showDetailedResults: true,
      ...config,
    };
  }

  async initialize(): Promise<void> {
    Logger.step("Initializing simulation...");

    const { euroMillions, deployment } = await getDeployedContract();
    this.euroMillions = euroMillions;

    const [signer] = await ethers.getSigners();
    this.contractManager = new ContractManager(signer.provider!, signer);

    // Load VRF mock if on local network
    if (NetworkUtils.isLocalNetwork()) {
      const VRFCoordinatorV2Mock = await ethers.getContractFactory("VRFCoordinatorV2Mock");
      this.vrfMock = VRFCoordinatorV2Mock.attach(deployment.vrfCoordinator) as VRFCoordinatorMock;
    }

    Logger.success("Simulation initialized");
  }

  async runSimulation(): Promise<void> {
    try {
      Logger.info("🎮 Starting EuroMillions Draw Simulation");
      Logger.info("========================================");

      await this.showCurrentDrawStatus();
      await this.simulateTicketPurchases();
      await this.waitForDrawEnd();
      await this.requestAndFulfillRandomness();
      await this.showResults();

      Logger.success("🎉 Simulation completed successfully!");
    } catch (error: any) {
      Logger.error(`Simulation failed: ${error.message}`);
      throw error;
    }
  }

  private async showCurrentDrawStatus(): Promise<void> {
    const status = await this.euroMillions.getCurrentDrawStatus();

    Logger.info("\n📊 Current Draw Information");
    Logger.info("==========================");
    Logger.info(`Draw ID: ${status.drawId}`);
    Logger.info(`Prize Pool: ${ethers.utils.formatEther(status.totalPrizePool)} ETH`);
    Logger.info(`Total Tickets: ${status.totalTickets}`);
    Logger.info(`Time Left: ${status.timeLeft} seconds`);
    Logger.info(`Status: ${status.isActive ? "🟢 Active" : "🔴 Closed"}`);
  }

  private async simulateTicketPurchases(): Promise<void> {
    Logger.step("\n🎫 Simulating ticket purchases...");

    const signers = await ethers.getSigners();
    const players = signers.slice(1, this.config.numberOfPlayers + 1);

    const ticketTemplates = [
      { main: [1, 2, 3, 4, 5], stars: [1, 2] },
      { main: [10, 20, 30, 40, 50], stars: [10, 11] },
      { main: [5, 15, 25, 35, 45], stars: [5, 6] },
      { main: [7, 14, 21, 28, 35], stars: [7, 8] },
      { main: [11, 22, 33, 44, 49], stars: [9, 12] },
      { main: [6, 16, 26, 36, 46], stars: [3, 4] },
    ];

    let totalTicketsPurchased = 0;

    for (let playerIndex = 0; playerIndex < players.length; playerIndex++) {
      const player = players[playerIndex];
      const playerName = `Player${playerIndex + 1}`;

      Logger.info(`\n👤 ${playerName} (${player.address.slice(0, 8)}...)`);

      for (let ticketIndex = 0; ticketIndex < this.config.ticketsPerPlayer; ticketIndex++) {
        const template =
          ticketTemplates[
            (playerIndex * this.config.ticketsPerPlayer + ticketIndex) % ticketTemplates.length
          ];

        // Add some randomization to avoid duplicate tickets
        const mainNumbers = template.main.map((num, idx) => {
          const offset = (playerIndex * 7 + ticketIndex * 3 + idx) % 46;
          return Math.min(50, Math.max(1, num + offset));
        });

        const luckyStars = template.stars.map((star, idx) => {
          const offset = (playerIndex + ticketIndex + idx) % 11;
          return Math.min(12, Math.max(1, star + offset));
        });

        try {
          await this.contractManager.executeWithRetry(async () => {
            const tx = await this.euroMillions
              .connect(player)
              .buyTicket(
                mainNumbers as [number, number, number, number, number],
                luckyStars as [number, number],
                {
                  value: ethers.utils.parseEther("0.01"),
                  gasLimit: 200000,
                }
              );

            await this.contractManager.waitForTransaction(tx.hash);
            totalTicketsPurchased++;

            Logger.info(
              `  🎟️  Ticket ${ticketIndex + 1}: [${mainNumbers.join(", ")}] ⭐ [${luckyStars.join(
                ", "
              )}]`
            );
          });
        } catch (error: any) {
          Logger.warn(`  ❌ Failed to purchase ticket ${ticketIndex + 1}: ${error.message}`);
        }
      }
    }

    Logger.success(`\n✅ Purchased ${totalTicketsPurchased} tickets total`);
  }

  private async waitForDrawEnd(): Promise<void> {
    if (!this.config.fastForwardTime) {
      Logger.info("\n⏰ Waiting for draw to end naturally (this may take up to 7 days)...");
      return;
    }

    Logger.step("\n⏰ Fast-forwarding time to end draw...");

    try {
      await time.increase(7 * 24 * 60 * 60 + 1); // 7 days + 1 second
      Logger.success("✅ Time advanced to end of draw period");
    } catch (error: any) {
      Logger.error(`Failed to advance time: ${error.message}`);
      throw error;
    }
  }

  private async requestAndFulfillRandomness(): Promise<void> {
    Logger.step("\n🎲 Requesting draw randomness...");

    try {
      const [owner] = await ethers.getSigners();

      const requestTx = await this.euroMillions.connect(owner).requestDrawRandomness({
        gasLimit: 150000,
      });

      await this.contractManager.waitForTransaction(requestTx.hash);
      Logger.success("✅ Randomness requested successfully");

      // Fulfill randomness on local networks
      if (this.vrfMock) {
        Logger.step("🎯 Fulfilling randomness with VRF mock...");

        const fulfillTx = await this.vrfMock.fulfillRandomWords(1, this.euroMillions.address, {
          gasLimit: 800000,
        });

        await this.contractManager.waitForTransaction(fulfillTx.hash);
        Logger.success("✅ Randomness fulfilled");
      } else {
        Logger.info("⏳ Waiting for Chainlink VRF to fulfill randomness...");
        Logger.info("This may take several minutes on live networks");
      }
    } catch (error: any) {
      Logger.error(`Failed to process randomness: ${error.message}`);
      throw error;
    }
  }

  private async showResults(): Promise<void> {
    Logger.step("\n🔍 Checking draw results...");

    const status = await this.euroMillions.getCurrentDrawStatus();
    const completedDrawId = status.drawId.sub(1); // Previous draw is the completed one

    try {
      const drawInfo = await this.euroMillions.getDrawInfo(completedDrawId.toNumber());

      if (!drawInfo.isCompleted) {
        Logger.warn("⏳ Draw not yet completed. Results may not be available.");
        return;
      }

      Logger.info("\n🏆 DRAW RESULTS");
      Logger.info("===============");
      Logger.info(`Draw ID: ${completedDrawId.toString()}`);
      Logger.info(
        `Winning Numbers: [${drawInfo.winningMainNumbers.join(
          ", "
        )}] ⭐ [${drawInfo.winningLuckyStars.join(", ")}]`
      );
      Logger.info(`Total Prize Pool: ${ethers.utils.formatEther(drawInfo.totalPrizePool)} ETH`);

      const winners = await this.euroMillions.getDrawWinners(completedDrawId.toNumber());

      if (winners.length > 0) {
        const prizePerWinner = drawInfo.totalPrizePool.mul(99).div(100).div(winners.length);

        Logger.success(`🎉 Winners Found: ${winners.length}`);
        Logger.info(`💰 Prize per winner: ${ethers.utils.formatEther(prizePerWinner)} ETH`);
        Logger.info(
          `💼 House fee: ${ethers.utils.formatEther(drawInfo.totalPrizePool.div(100))} ETH`
        );

        if (this.config.showDetailedResults) {
          Logger.info("\n🏅 Winner Details:");
          winners.forEach((winner, index) => {
            const explorerUrl = NetworkUtils.getBlockExplorerUrl(undefined, winner);
            Logger.info(`  ${index + 1}. ${winner}`);
            if (!NetworkUtils.isLocalNetwork()) {
              Logger.info(`     View on explorer: ${explorerUrl}`);
            }
          });
        }
      } else {
        Logger.warn("😢 No winners this draw - jackpot rolls over!");
      }

      if (this.config.showDetailedResults) {
        await this.showPlayerTicketDetails(completedDrawId.toNumber(), winners);
      }
    } catch (error: any) {
      Logger.error(`Failed to retrieve results: ${error.message}`);
    }
  }

  private async showPlayerTicketDetails(drawId: number, winners: string[]): Promise<void> {
    Logger.info("\n🎫 Player Ticket Analysis:");
    Logger.info("==========================");

    const signers = await ethers.getSigners();
    const players = signers.slice(1, this.config.numberOfPlayers + 1);

    for (let i = 0; i < players.length; i++) {
      const player = players[i];
      const playerName = `Player${i + 1}`;
      const isWinner = winners.includes(player.address);

      try {
        const tickets = await this.euroMillions.getPlayerTickets(drawId, player.address);

        Logger.info(`\n👤 ${playerName} (${player.address.slice(0, 8)}...)`);
        Logger.info(`   Status: ${isWinner ? "🏆 WINNER!" : "❌ No win"}`);
        Logger.info(`   Tickets: ${tickets.length}`);

        tickets.forEach((ticket, ticketIndex) => {
          Logger.info(
            `   ${ticketIndex + 1}. [${ticket.mainNumbers.join(", ")}] ⭐ [${ticket.luckyStars.join(
              ", "
            )}]`
          );
        });
      } catch (error: any) {
        Logger.warn(`   ❌ Could not retrieve tickets for ${playerName}: ${error.message}`);
      }
    }
  }
}

export async function simulateDrawMain(): Promise<void> {
  Logger.setLevel(LogLevel.INFO);

  const simulator = new DrawSimulator({
    numberOfPlayers: 5,
    ticketsPerPlayer: 2,
    showDetailedResults: true,
  });

  try {
    await simulator.initialize();
    await simulator.runSimulation();
  } catch (error: any) {
    Logger.error("Simulation failed:", error.message);
    if (error.stack) {
      Logger.debug("Stack trace:", error.stack);
    }
    process.exit(1);
  }
}

// Export the simulator class for programmatic use
export { DrawSimulator, SimulationConfig };

// Run simulation if this file is executed directly
if (require.main === module) {
  simulateDrawMain()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
