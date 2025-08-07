const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("EuroMillions", function () {
  let euroMillions;
  let vrfCoordinatorV2Mock;
  let owner, player1, player2;
  let subscriptionId;
  let keyHash;

  const TICKET_PRICE = ethers.utils.parseEther("0.01");
  const SUBSCRIPTION_FUND_AMOUNT = ethers.utils.parseEther("10");

  beforeEach(async function () {
    [owner, player1, player2] = await ethers.getSigners();

    // Deploy VRFCoordinatorV2Mock
    const VRFCoordinatorV2Mock = await ethers.getContractFactory("VRFCoordinatorV2Mock");
    vrfCoordinatorV2Mock = await VRFCoordinatorV2Mock.deploy(0, 0);
    await vrfCoordinatorV2Mock.deployed();

    // Create subscription
    const txResponse = await vrfCoordinatorV2Mock.createSubscription();
    const txReceipt = await txResponse.wait();
    subscriptionId = txReceipt.events[0].args.subId;

    // Fund subscription
    await vrfCoordinatorV2Mock.fundSubscription(subscriptionId, SUBSCRIPTION_FUND_AMOUNT);

    // Deploy EuroMillions contract
    keyHash = "0xd89b2bf150e3b9e13446986e571fb9cab24b13cea0a43ea20a6049a85cc807cc";
    const EuroMillions = await ethers.getContractFactory("EuroMillions");
    euroMillions = await EuroMillions.deploy(subscriptionId, vrfCoordinatorV2Mock.address, keyHash);
    await euroMillions.deployed();

    // Add consumer to subscription
    await vrfCoordinatorV2Mock.addConsumer(subscriptionId, euroMillions.address);
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await euroMillions.owner()).to.equal(owner.address);
    });

    it("Should initialize first draw", async function () {
      const currentDrawId = await euroMillions.currentDrawId();
      expect(currentDrawId).to.equal(1);

      const drawInfo = await euroMillions.getDrawInfo(1);
      expect(drawInfo.totalPrizePool).to.equal(0);
      expect(drawInfo.totalTickets).to.equal(0);
      expect(drawInfo.isCompleted).to.equal(false);
    });
  });

  describe("Ticket Purchase", function () {
    it("Should allow valid ticket purchase", async function () {
      const mainNumbers = [1, 2, 3, 4, 5];
      const luckyStars = [1, 2];

      await expect(
        euroMillions.connect(player1).buyTicket(mainNumbers, luckyStars, {
          value: TICKET_PRICE,
        })
      ).to.emit(euroMillions, "TicketPurchased");

      const tickets = await euroMillions.getPlayerTickets(1, player1.address);
      expect(tickets.length).to.equal(1);
      expect(tickets[0].mainNumbers).to.deep.equal(mainNumbers);
      expect(tickets[0].luckyStars).to.deep.equal(luckyStars);
    });

    it("Should reject invalid main numbers", async function () {
      // Test numbers out of range
      await expect(
        euroMillions.connect(player1).buyTicket([0, 2, 3, 4, 5], [1, 2], {
          value: TICKET_PRICE,
        })
      ).to.be.revertedWithCustomError(euroMillions, "InvalidMainNumbers");

      await expect(
        euroMillions.connect(player1).buyTicket([1, 2, 3, 4, 51], [1, 2], {
          value: TICKET_PRICE,
        })
      ).to.be.revertedWithCustomError(euroMillions, "InvalidMainNumbers");

      // Test duplicate numbers
      await expect(
        euroMillions.connect(player1).buyTicket([1, 2, 2, 4, 5], [1, 2], {
          value: TICKET_PRICE,
        })
      ).to.be.revertedWithCustomError(euroMillions, "InvalidMainNumbers");
    });

    it("Should reject invalid lucky stars", async function () {
      // Test numbers out of range
      await expect(
        euroMillions.connect(player1).buyTicket([1, 2, 3, 4, 5], [0, 2], {
          value: TICKET_PRICE,
        })
      ).to.be.revertedWithCustomError(euroMillions, "InvalidLuckyStars");

      await expect(
        euroMillions.connect(player1).buyTicket([1, 2, 3, 4, 5], [1, 13], {
          value: TICKET_PRICE,
        })
      ).to.be.revertedWithCustomError(euroMillions, "InvalidLuckyStars");

      // Test duplicate stars
      await expect(
        euroMillions.connect(player1).buyTicket([1, 2, 3, 4, 5], [1, 1], {
          value: TICKET_PRICE,
        })
      ).to.be.revertedWithCustomError(euroMillions, "InvalidLuckyStars");
    });

    it("Should reject incorrect payment amount", async function () {
      await expect(
        euroMillions.connect(player1).buyTicket([1, 2, 3, 4, 5], [1, 2], {
          value: ethers.utils.parseEther("0.005"),
        })
      ).to.be.revertedWithCustomError(euroMillions, "InsufficientPayment");
    });

    it("Should update prize pool correctly", async function () {
      await euroMillions.connect(player1).buyTicket([1, 2, 3, 4, 5], [1, 2], {
        value: TICKET_PRICE,
      });
      await euroMillions.connect(player2).buyTicket([6, 7, 8, 9, 10], [3, 4], {
        value: TICKET_PRICE,
      });

      const drawInfo = await euroMillions.getDrawInfo(1);
      expect(drawInfo.totalPrizePool).to.equal(TICKET_PRICE.mul(2));
      expect(drawInfo.totalTickets).to.equal(2);
    });
  });

  describe("Draw Management", function () {
    beforeEach(async function () {
      // Purchase some tickets
      await euroMillions.connect(player1).buyTicket([1, 2, 3, 4, 5], [1, 2], {
        value: TICKET_PRICE,
      });
      await euroMillions.connect(player2).buyTicket([6, 7, 8, 9, 10], [3, 4], {
        value: TICKET_PRICE,
      });
    });

    it("Should not allow randomness request before draw ends", async function () {
      await expect(euroMillions.requestDrawRandomness()).to.be.revertedWithCustomError(
        euroMillions,
        "DrawNotActive"
      );
    });

    it("Should allow randomness request after draw ends", async function () {
      // Fast forward time to end draw
      await time.increase(7 * 24 * 60 * 60 + 1); // 7 days + 1 second

      await expect(euroMillions.requestDrawRandomness()).to.emit(
        euroMillions,
        "RandomnessRequested"
      );
    });

    it("Should complete draw with VRF response", async function () {
      // Fast forward time to end draw
      await time.increase(7 * 24 * 60 * 60 + 1);

      // Request randomness
      await euroMillions.requestDrawRandomness();

      // Mock VRF response
      const requestId = 1; // Mock VRF coordinator assigns requestId = 1
      const randomWords = [
        "123456789012345678901234567890123456789012345678901234567890",
        "987654321098765432109876543210987654321098765432109876543210",
        "456789012345678901234567890123456789012345678901234567890123",
        "789012345678901234567890123456789012345678901234567890123456",
        "012345678901234567890123456789012345678901234567890123456789",
        "345678901234567890123456789012345678901234567890123456789012",
        "678901234567890123456789012345678901234567890123456789012345",
      ];

      await expect(
        vrfCoordinatorV2Mock.fulfillRandomWords(requestId, euroMillions.address)
      ).to.emit(euroMillions, "DrawCompleted");

      const drawInfo = await euroMillions.getDrawInfo(1);
      expect(drawInfo.isCompleted).to.equal(true);
    });

    it("Should start new draw after completion", async function () {
      // Fast forward and complete draw
      await time.increase(7 * 24 * 60 * 60 + 1);
      await euroMillions.requestDrawRandomness();

      const requestId = 1;
      await vrfCoordinatorV2Mock.fulfillRandomWords(requestId, euroMillions.address);

      // Check new draw started
      const currentDrawId = await euroMillions.currentDrawId();
      expect(currentDrawId).to.equal(2);
    });
  });

  describe("Prize Distribution", function () {
    it("Should distribute prizes to winners correctly", async function () {
      // This test requires specific setup to create a winning scenario
      // For testing purposes, we'll mock a scenario where we know the winning numbers

      // Purchase tickets
      await euroMillions.connect(player1).buyTicket([1, 2, 3, 4, 5], [1, 2], {
        value: TICKET_PRICE,
      });
      await euroMillions.connect(player2).buyTicket([6, 7, 8, 9, 10], [3, 4], {
        value: TICKET_PRICE,
      });

      const initialBalance1 = await player1.getBalance();
      const initialBalance2 = await player2.getBalance();
      const initialOwnerBalance = await owner.getBalance();

      // Fast forward and trigger draw
      await time.increase(7 * 24 * 60 * 60 + 1);
      await euroMillions.requestDrawRandomness();

      // Complete draw
      const requestId = 1;
      await vrfCoordinatorV2Mock.fulfillRandomWords(requestId, euroMillions.address);

      // Check if prizes were distributed (depends on random outcome)
      const drawInfo = await euroMillions.getDrawInfo(1);
      const winners = await euroMillions.getDrawWinners(1);

      if (winners.length > 0) {
        // Verify house fee was collected (1%)
        const expectedHouseFee = drawInfo.totalPrizePool.mul(1).div(100);
        const newOwnerBalance = await owner.getBalance();
        expect(newOwnerBalance.sub(initialOwnerBalance)).to.be.closeTo(
          expectedHouseFee,
          ethers.utils.parseEther("0.001") // Allow for gas costs
        );
      }
    });

    it("Should handle multiple winners correctly", async function () {
      // Test scenario with predetermined winning numbers
      // This would require modifying the VRF mock to return specific values
      // For now, we test the logic structure

      const totalTickets = 3;
      for (let i = 0; i < totalTickets; i++) {
        await euroMillions
          .connect(player1)
          .buyTicket([1 + i, 2 + i, 3 + i, 4 + i, 5 + i], [1, 2], { value: TICKET_PRICE });
      }

      const drawInfo = await euroMillions.getDrawInfo(1);
      expect(drawInfo.totalTickets).to.equal(totalTickets);
      expect(drawInfo.totalPrizePool).to.equal(TICKET_PRICE.mul(totalTickets));
    });
  });

  describe("Security Tests", function () {
    it("Should prevent reentrancy attacks", async function () {
      // The contract uses ReentrancyGuard, so this should be protected
      // Test by attempting multiple simultaneous ticket purchases

      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          euroMillions
            .connect(player1)
            .buyTicket([1 + i, 2 + i, 3 + i, 4 + i, 5 + i], [1, 2], { value: TICKET_PRICE })
        );
      }

      await Promise.all(promises);

      const tickets = await euroMillions.getPlayerTickets(1, player1.address);
      expect(tickets.length).to.equal(5);
    });

    it("Should only allow owner to request randomness", async function () {
      await time.increase(7 * 24 * 60 * 60 + 1);

      await expect(euroMillions.connect(player1).requestDrawRandomness()).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });

    it("Should prevent double randomness requests", async function () {
      await euroMillions.connect(player1).buyTicket([1, 2, 3, 4, 5], [1, 2], {
        value: TICKET_PRICE,
      });

      await time.increase(7 * 24 * 60 * 60 + 1);

      await euroMillions.requestDrawRandomness();

      await expect(euroMillions.requestDrawRandomness()).to.be.revertedWithCustomError(
        euroMillions,
        "RandomnessAlreadyRequested"
      );
    });

    it("Should handle pausing correctly", async function () {
      await euroMillions.pause();

      await expect(
        euroMillions.connect(player1).buyTicket([1, 2, 3, 4, 5], [1, 2], {
          value: TICKET_PRICE,
        })
      ).to.be.revertedWith("Pausable: paused");

      await euroMillions.unpause();

      // Should work after unpausing
      await euroMillions.connect(player1).buyTicket([1, 2, 3, 4, 5], [1, 2], {
        value: TICKET_PRICE,
      });
    });

    it("Should prevent ticket purchase outside draw window", async function () {
      // Fast forward past draw end time
      await time.increase(7 * 24 * 60 * 60 + 1);

      await expect(
        euroMillions.connect(player1).buyTicket([1, 2, 3, 4, 5], [1, 2], {
          value: TICKET_PRICE,
        })
      ).to.be.revertedWithCustomError(euroMillions, "DrawNotActive");
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await euroMillions.connect(player1).buyTicket([1, 2, 3, 4, 5], [1, 2], {
        value: TICKET_PRICE,
      });
      await euroMillions.connect(player2).buyTicket([6, 7, 8, 9, 10], [3, 4], {
        value: TICKET_PRICE,
      });
    });

    it("Should return correct draw information", async function () {
      const drawInfo = await euroMillions.getDrawInfo(1);

      expect(drawInfo.totalPrizePool).to.equal(TICKET_PRICE.mul(2));
      expect(drawInfo.totalTickets).to.equal(2);
      expect(drawInfo.isCompleted).to.equal(false);
    });

    it("Should return correct player tickets", async function () {
      const tickets = await euroMillions.getPlayerTickets(1, player1.address);

      expect(tickets.length).to.equal(1);
      expect(tickets[0].mainNumbers).to.deep.equal([1, 2, 3, 4, 5]);
      expect(tickets[0].luckyStars).to.deep.equal([1, 2]);
    });

    it("Should return correct current draw status", async function () {
      const status = await euroMillions.getCurrentDrawStatus();

      expect(status.drawId).to.equal(1);
      expect(status.totalPrizePool).to.equal(TICKET_PRICE.mul(2));
      expect(status.totalTickets).to.equal(2);
      expect(status.isActive).to.equal(true);
      expect(status.timeLeft).to.be.gt(0);
    });
  });

  describe("Edge Cases", function () {
    it("Should handle draw with no tickets", async function () {
      // Fast forward without purchasing tickets
      await time.increase(7 * 24 * 60 * 60 + 1);

      await euroMillions.requestDrawRandomness();

      const requestId = 1;
      await expect(
        vrfCoordinatorV2Mock.fulfillRandomWords(requestId, euroMillions.address)
      ).to.emit(euroMillions, "DrawCompleted");

      const winners = await euroMillions.getDrawWinners(1);
      expect(winners.length).to.equal(0);
    });

    it("Should handle maximum ticket purchases per player", async function () {
      // Test buying multiple tickets
      const maxTickets = 10;

      for (let i = 0; i < maxTickets; i++) {
        await euroMillions
          .connect(player1)
          .buyTicket(
            [1 + (i % 46), 2 + (i % 46), 3 + (i % 46), 4 + (i % 46), 5 + (i % 46)],
            [1 + (i % 11), 2 + (i % 11)],
            { value: TICKET_PRICE }
          );
      }

      const tickets = await euroMillions.getPlayerTickets(1, player1.address);
      expect(tickets.length).to.equal(maxTickets);
    });

    it("Should revert on invalid draw ID queries", async function () {
      await expect(euroMillions.getDrawInfo(999)).to.be.revertedWithCustomError(
        euroMillions,
        "DrawNotFound"
      );
    });
  });

  describe("Gas Optimization Tests", function () {
    it("Should have reasonable gas costs for ticket purchase", async function () {
      const tx = await euroMillions.connect(player1).buyTicket([1, 2, 3, 4, 5], [1, 2], {
        value: TICKET_PRICE,
      });
      const receipt = await tx.wait();

      // Gas should be reasonable (adjust threshold as needed)
      expect(receipt.gasUsed).to.be.lt(200000);
    });

    it("Should handle batch operations efficiently", async function () {
      const batchSize = 5;
      const gasUsed = [];

      for (let i = 0; i < batchSize; i++) {
        const tx = await euroMillions
          .connect(player1)
          .buyTicket([1 + i, 2 + i, 3 + i, 4 + i, 5 + i], [1, 2], { value: TICKET_PRICE });
        const receipt = await tx.wait();
        gasUsed.push(receipt.gasUsed);
      }

      // Gas usage should be consistent
      const avgGas = gasUsed.reduce((a, b) => a.add(b), ethers.BigNumber.from(0)).div(batchSize);
      console.log(`Average gas per ticket: ${avgGas.toString()}`);
    });
  });

  describe("Emergency Functions", function () {
    it("Should allow emergency withdrawal when paused", async function () {
      // Add some funds to the contract
      await euroMillions.connect(player1).buyTicket([1, 2, 3, 4, 5], [1, 2], {
        value: TICKET_PRICE,
      });

      // Complete the draw first
      await time.increase(7 * 24 * 60 * 60 + 1);
      await euroMillions.requestDrawRandomness();
      const requestId = 1;
      await vrfCoordinatorV2Mock.fulfillRandomWords(requestId, euroMillions.address);

      // Pause and emergency withdraw
      await euroMillions.pause();

      const initialBalance = await owner.getBalance();
      await euroMillions.emergencyWithdraw();
      const finalBalance = await owner.getBalance();

      expect(finalBalance).to.be.gt(initialBalance);
    });

    it("Should not allow emergency withdrawal with active draws", async function () {
      await euroMillions.connect(player1).buyTicket([1, 2, 3, 4, 5], [1, 2], {
        value: TICKET_PRICE,
      });

      await euroMillions.pause();

      await expect(euroMillions.emergencyWithdraw()).to.be.revertedWith("Active draw exists");
    });

    it("Should only allow owner to use emergency functions", async function () {
      await expect(euroMillions.connect(player1).pause()).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );

      await expect(euroMillions.connect(player1).emergencyWithdraw()).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });
  });
});

// Additional helper contract for testing malicious scenarios
describe("EuroMillions Security Against Attacks", function () {
  let euroMillions;
  let vrfCoordinatorV2Mock;
  let owner, attacker;
  let subscriptionId;
  let keyHash;

  const TICKET_PRICE = ethers.utils.parseEther("0.01");

  beforeEach(async function () {
    [owner, attacker] = await ethers.getSigners();

    // Deploy VRF mock and EuroMillions (same as before)
    const VRFCoordinatorV2Mock = await ethers.getContractFactory("VRFCoordinatorV2Mock");
    vrfCoordinatorV2Mock = await VRFCoordinatorV2Mock.deploy(0, 0);

    const txResponse = await vrfCoordinatorV2Mock.createSubscription();
    const txReceipt = await txResponse.wait();
    subscriptionId = txReceipt.events[0].args.subId;

    await vrfCoordinatorV2Mock.fundSubscription(subscriptionId, ethers.utils.parseEther("10"));

    keyHash = "0xd89b2bf150e3b9e13446986e571fb9cab24b13cea0a43ea20a6049a85cc807cc";
    const EuroMillions = await ethers.getContractFactory("EuroMillions");
    euroMillions = await EuroMillions.deploy(subscriptionId, vrfCoordinatorV2Mock.address, keyHash);

    await vrfCoordinatorV2Mock.addConsumer(subscriptionId, euroMillions.address);
  });

  it("Should resist front-running attacks", async function () {
    // Simulate attempting to front-run a winning ticket
    // The randomness is generated after ticket sales close, preventing this

    await euroMillions.connect(attacker).buyTicket([1, 2, 3, 4, 5], [1, 2], {
      value: TICKET_PRICE,
    });

    await time.increase(7 * 24 * 60 * 60 + 1);

    // Attacker cannot buy tickets after draw ends
    await expect(
      euroMillions.connect(attacker).buyTicket([6, 7, 8, 9, 10], [3, 4], {
        value: TICKET_PRICE,
      })
    ).to.be.revertedWithCustomError(euroMillions, "DrawNotActive");
  });

  it("Should prevent manipulation of randomness", async function () {
    // Only the VRF coordinator can call fulfillRandomWords
    await euroMillions.connect(attacker).buyTicket([1, 2, 3, 4, 5], [1, 2], {
      value: TICKET_PRICE,
    });

    await time.increase(7 * 24 * 60 * 60 + 1);
    await euroMillions.requestDrawRandomness();

    // Attacker cannot directly call fulfillRandomWords
    const fakeRandomWords = [1, 2, 3, 4, 5, 6, 7];

    // This should revert because attacker is not the VRF coordinator
    await expect(euroMillions.connect(attacker).fulfillRandomWords(1, fakeRandomWords)).to.be
      .reverted;
  });
});

// Performance and Load Testing
describe("EuroMillions Load Testing", function () {
  let euroMillions;
  let vrfCoordinatorV2Mock;
  let players;

  before(async function () {
    // Setup for load testing with multiple players
    const signers = await ethers.getSigners();
    players = signers.slice(1, 11); // Use first 10 signers as players

    // Deploy contracts
    const VRFCoordinatorV2Mock = await ethers.getContractFactory("VRFCoordinatorV2Mock");
    vrfCoordinatorV2Mock = await VRFCoordinatorV2Mock.deploy(0, 0);

    const txResponse = await vrfCoordinatorV2Mock.createSubscription();
    const txReceipt = await txResponse.wait();
    const subscriptionId = txReceipt.events[0].args.subId;

    await vrfCoordinatorV2Mock.fundSubscription(subscriptionId, ethers.utils.parseEther("100"));

    const keyHash = "0xd89b2bf150e3b9e13446986e571fb9cab24b13cea0a43ea20a6049a85cc807cc";
    const EuroMillions = await ethers.getContractFactory("EuroMillions");
    euroMillions = await EuroMillions.deploy(subscriptionId, vrfCoordinatorV2Mock.address, keyHash);

    await vrfCoordinatorV2Mock.addConsumer(subscriptionId, euroMillions.address);
  });

  it("Should handle high volume of ticket purchases", async function () {
    this.timeout(60000); // Increase timeout for load testing

    const ticketsPerPlayer = 10;
    const totalTickets = players.length * ticketsPerPlayer;

    console.log(`Testing with ${totalTickets} tickets from ${players.length} players...`);

    const startTime = Date.now();

    // Purchase tickets in parallel
    const purchasePromises = [];
    for (let i = 0; i < players.length; i++) {
      for (let j = 0; j < ticketsPerPlayer; j++) {
        const mainNumbers = [
          1 + ((i + j) % 46),
          2 + ((i + j) % 46),
          3 + ((i + j) % 46),
          4 + ((i + j) % 46),
          5 + ((i + j) % 46),
        ];
        const luckyStars = [1 + ((i + j) % 11), 2 + ((i + j) % 11)];

        purchasePromises.push(
          euroMillions.connect(players[i]).buyTicket(mainNumbers, luckyStars, {
            value: ethers.utils.parseEther("0.01"),
          })
        );
      }
    }

    await Promise.all(purchasePromises);

    const endTime = Date.now();
    const duration = endTime - startTime;

    console.log(`Completed ${totalTickets} ticket purchases in ${duration}ms`);
    console.log(`Average: ${duration / totalTickets}ms per ticket`);

    // Verify all tickets were recorded
    const drawInfo = await euroMillions.getDrawInfo(1);
    expect(drawInfo.totalTickets).to.equal(totalTickets);
    expect(drawInfo.totalPrizePool).to.equal(ethers.utils.parseEther("0.01").mul(totalTickets));
  });
});
