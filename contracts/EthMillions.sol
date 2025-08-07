// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title EuroMillions
 * @dev Decentralized EuroMillions lottery on Ethereum
 * @notice This contract handles lottery draws with Chainlink VRF for randomness
 */
contract EuroMillions is VRFConsumerBaseV2, ReentrancyGuard, Ownable, Pausable {
    VRFCoordinatorV2Interface private immutable i_vrfCoordinator;

    // Chainlink VRF Configuration
    uint64 private immutable i_subscriptionId;
    bytes32 private immutable i_keyHash;
    uint32 private constant CALLBACK_GAS_LIMIT = 500000;
    uint16 private constant REQUEST_CONFIRMATIONS = 3;
    uint32 private constant NUM_WORDS = 7; // 5 main numbers + 2 lucky stars

    // Game Configuration
    uint256 public constant TICKET_PRICE = 0.01 ether; // Adjust as needed
    uint256 public constant HOUSE_FEE_PERCENT = 1; // 1% for gas and infrastructure
    uint256 public constant WINNER_PERCENT = 99; // 99% goes to winners

    // Game State
    uint256 public currentDrawId;
    mapping(uint256 => Draw) public draws;
    mapping(uint256 => mapping(address => Ticket[])) public playerTickets;
    mapping(uint256 => uint256) public vrfRequestIdToDraw;

    struct Ticket {
        uint8[5] mainNumbers;
        uint8[2] luckyStars;
        address player;
        uint256 timestamp;
    }

    struct Draw {
        uint256 drawId;
        uint256 totalPrizePool;
        uint256 totalTickets;
        uint8[5] winningMainNumbers;
        uint8[2] winningLuckyStars;
        address[] winners;
        bool isCompleted;
        bool randomnessRequested;
        uint256 drawStartTime;
        uint256 drawEndTime;
        mapping(address => uint256) ticketCounts;
        address[] players;
    }

    // Events
    event TicketPurchased(
        uint256 indexed drawId,
        address indexed player,
        uint8[5] mainNumbers,
        uint8[2] luckyStars,
        uint256 ticketPrice
    );

    event DrawCompleted(
        uint256 indexed drawId,
        uint8[5] winningMainNumbers,
        uint8[2] winningLuckyStars,
        address[] winners,
        uint256 prizePerWinner
    );

    event RandomnessRequested(uint256 indexed drawId, uint256 requestId);
    event DrawStarted(uint256 indexed drawId, uint256 startTime, uint256 endTime);
    event PrizeDistributed(uint256 indexed drawId, address indexed winner, uint256 amount);
    event HouseFeeCollected(uint256 indexed drawId, uint256 amount);

    // Errors
    error InvalidMainNumbers();
    error InvalidLuckyStars();
    error DrawNotActive();
    error DrawAlreadyCompleted();
    error InsufficientPayment();
    error NoWinners();
    error TransferFailed();
    error DrawNotFound();
    error RandomnessAlreadyRequested();

    modifier onlyActiveDraw() {
        if (
            block.timestamp < draws[currentDrawId].drawStartTime || block.timestamp > draws[currentDrawId].drawEndTime
        ) {
            revert DrawNotActive();
        }
        _;
    }

    modifier drawExists(uint256 drawId) {
        if (drawId > currentDrawId) revert DrawNotFound();
        _;
    }

    constructor(uint64 subscriptionId, address vrfCoordinatorV2, bytes32 keyHash) VRFConsumerBaseV2(vrfCoordinatorV2) {
        i_vrfCoordinator = VRFCoordinatorV2Interface(vrfCoordinatorV2);
        i_subscriptionId = subscriptionId;
        i_keyHash = keyHash;

        // Initialize first draw
        _startNewDraw();
    }

    /**
     * @notice Purchase a lottery ticket for the current draw
     * @param mainNumbers Array of 5 numbers between 1-50
     * @param luckyStars Array of 2 numbers between 1-12
     */
    function buyTicket(
        uint8[5] calldata mainNumbers,
        uint8[2] calldata luckyStars
    ) external payable onlyActiveDraw whenNotPaused nonReentrant {
        if (msg.value != TICKET_PRICE) revert InsufficientPayment();

        // Validate main numbers (1-50, no duplicates)
        _validateMainNumbers(mainNumbers);

        // Validate lucky stars (1-12, no duplicates)
        _validateLuckyStars(luckyStars);

        Draw storage currentDraw = draws[currentDrawId];

        // Add to player's tickets
        playerTickets[currentDrawId][msg.sender].push(
            Ticket({mainNumbers: mainNumbers, luckyStars: luckyStars, player: msg.sender, timestamp: block.timestamp})
        );

        // Update draw statistics
        if (currentDraw.ticketCounts[msg.sender] == 0) {
            currentDraw.players.push(msg.sender);
        }
        currentDraw.ticketCounts[msg.sender]++;
        currentDraw.totalTickets++;
        currentDraw.totalPrizePool += msg.value;

        emit TicketPurchased(currentDrawId, msg.sender, mainNumbers, luckyStars, msg.value);
    }

    /**
     * @notice Request randomness for the current draw (only owner)
     */
    function requestDrawRandomness() external onlyOwner {
        Draw storage currentDraw = draws[currentDrawId];

        if (block.timestamp <= currentDraw.drawEndTime) revert DrawNotActive();
        if (currentDraw.randomnessRequested) revert RandomnessAlreadyRequested();
        if (currentDraw.isCompleted) revert DrawAlreadyCompleted();

        currentDraw.randomnessRequested = true;

        uint256 requestId = i_vrfCoordinator.requestRandomWords(
            i_keyHash,
            i_subscriptionId,
            REQUEST_CONFIRMATIONS,
            CALLBACK_GAS_LIMIT,
            NUM_WORDS
        );

        vrfRequestIdToDraw[requestId] = currentDrawId;

        emit RandomnessRequested(currentDrawId, requestId);
    }

    /**
     * @notice Callback function used by VRF Coordinator
     */
    function fulfillRandomWords(uint256 requestId, uint256[] memory randomWords) internal override {
        uint256 drawId = vrfRequestIdToDraw[requestId];
        Draw storage draw = draws[drawId];

        if (draw.isCompleted) return;

        // Generate winning numbers from random words
        uint8[5] memory winningMainNumbers;
        uint8[2] memory winningLuckyStars;

        // Generate 5 unique main numbers (1-50)
        bool[51] memory usedMainNumbers; // index 0 unused, 1-50 for numbers
        for (uint i = 0; i < 5; i++) {
            uint8 number;
            do {
                number = uint8((randomWords[i] % 50) + 1);
            } while (usedMainNumbers[number]);

            usedMainNumbers[number] = true;
            winningMainNumbers[i] = number;
        }

        // Generate 2 unique lucky stars (1-12)
        bool[13] memory usedLuckyStars; // index 0 unused, 1-12 for stars
        for (uint i = 0; i < 2; i++) {
            uint8 star;
            do {
                star = uint8((randomWords[i + 5] % 12) + 1);
            } while (usedLuckyStars[star]);

            usedLuckyStars[star] = true;
            winningLuckyStars[i] = star;
        }

        // Sort arrays for consistency
        _sortMainNumbers(winningMainNumbers);
        _sortLuckyStars(winningLuckyStars);

        draw.winningMainNumbers = winningMainNumbers;
        draw.winningLuckyStars = winningLuckyStars;

        // Find winners and distribute prizes
        _findWinnersAndDistribute(drawId);
    }

    /**
     * @notice Find winners and distribute prizes
     */
    function _findWinnersAndDistribute(uint256 drawId) private {
        Draw storage draw = draws[drawId];
        address[] memory winners = new address[](draw.totalTickets);
        uint256 winnerCount = 0;

        // Check all players and their tickets
        for (uint256 i = 0; i < draw.players.length; i++) {
            address player = draw.players[i];
            Ticket[] storage tickets = playerTickets[drawId][player];

            for (uint256 j = 0; j < tickets.length; j++) {
                if (_isWinningTicket(tickets[j], draw.winningMainNumbers, draw.winningLuckyStars)) {
                    winners[winnerCount] = player;
                    winnerCount++;
                }
            }
        }

        // Resize winners array
        address[] memory finalWinners = new address[](winnerCount);
        for (uint256 i = 0; i < winnerCount; i++) {
            finalWinners[i] = winners[i];
        }

        draw.winners = finalWinners;
        draw.isCompleted = true;

        // Distribute prizes
        if (winnerCount > 0) {
            uint256 houseFee = (draw.totalPrizePool * HOUSE_FEE_PERCENT) / 100;
            uint256 totalWinnings = draw.totalPrizePool - houseFee;
            uint256 prizePerWinner = totalWinnings / winnerCount;

            // Transfer house fee
            (bool success, ) = payable(owner()).call{value: houseFee}("");
            if (!success) revert TransferFailed();
            emit HouseFeeCollected(drawId, houseFee);

            // Distribute prizes to winners
            for (uint256 i = 0; i < winnerCount; i++) {
                (success, ) = payable(finalWinners[i]).call{value: prizePerWinner}("");
                if (!success) revert TransferFailed();
                emit PrizeDistributed(drawId, finalWinners[i], prizePerWinner);
            }

            emit DrawCompleted(drawId, draw.winningMainNumbers, draw.winningLuckyStars, finalWinners, prizePerWinner);
        } else {
            // No winners - rollover to next draw or handle as per rules
            emit DrawCompleted(drawId, draw.winningMainNumbers, draw.winningLuckyStars, finalWinners, 0);
        }

        // Start next draw
        _startNewDraw();
    }

    /**
     * @notice Check if a ticket matches the winning numbers
     */
    function _isWinningTicket(
        Ticket memory ticket,
        uint8[5] memory winningMainNumbers,
        uint8[2] memory winningLuckyStars
    ) private pure returns (bool) {
        // Sort ticket numbers for comparison
        uint8[5] memory sortedMainNumbers = ticket.mainNumbers;
        uint8[2] memory sortedLuckyStars = ticket.luckyStars;
        _sortMainNumbers(sortedMainNumbers);
        _sortLuckyStars(sortedLuckyStars);

        // Check main numbers
        for (uint256 i = 0; i < 5; i++) {
            if (sortedMainNumbers[i] != winningMainNumbers[i]) {
                return false;
            }
        }

        // Check lucky stars
        for (uint256 i = 0; i < 2; i++) {
            if (sortedLuckyStars[i] != winningLuckyStars[i]) {
                return false;
            }
        }

        return true;
    }

    /**
     * @notice Start a new draw
     */
    function _startNewDraw() private {
        currentDrawId++;
        Draw storage newDraw = draws[currentDrawId];

        newDraw.drawId = currentDrawId;
        newDraw.drawStartTime = block.timestamp;
        newDraw.drawEndTime = block.timestamp + 7 days; // 1 week draw period
        newDraw.totalPrizePool = 0;
        newDraw.totalTickets = 0;
        newDraw.isCompleted = false;
        newDraw.randomnessRequested = false;

        emit DrawStarted(currentDrawId, newDraw.drawStartTime, newDraw.drawEndTime);
    }

    /**
     * @notice Validate main numbers
     */
    function _validateMainNumbers(uint8[5] calldata numbers) private pure {
        bool[51] memory used; // index 0 unused, 1-50 for numbers

        for (uint256 i = 0; i < 5; i++) {
            if (numbers[i] < 1 || numbers[i] > 50) revert InvalidMainNumbers();
            if (used[numbers[i]]) revert InvalidMainNumbers(); // Duplicate
            used[numbers[i]] = true;
        }
    }

    /**
     * @notice Validate lucky stars
     */
    function _validateLuckyStars(uint8[2] calldata stars) private pure {
        bool[13] memory used; // index 0 unused, 1-12 for stars

        for (uint256 i = 0; i < 2; i++) {
            if (stars[i] < 1 || stars[i] > 12) revert InvalidLuckyStars();
            if (used[stars[i]]) revert InvalidLuckyStars(); // Duplicate
            used[stars[i]] = true;
        }
    }

    /**
     * @notice Sort main numbers array (bubble sort for small arrays)
     */
    function _sortMainNumbers(uint8[5] memory numbers) private pure {
        for (uint256 i = 0; i < 4; i++) {
            for (uint256 j = 0; j < 4 - i; j++) {
                if (numbers[j] > numbers[j + 1]) {
                    uint8 temp = numbers[j];
                    numbers[j] = numbers[j + 1];
                    numbers[j + 1] = temp;
                }
            }
        }
    }

    /**
     * @notice Sort lucky stars array
     */
    function _sortLuckyStars(uint8[2] memory stars) private pure {
        if (stars[0] > stars[1]) {
            uint8 temp = stars[0];
            stars[0] = stars[1];
            stars[1] = temp;
        }
    }

    // View Functions

    /**
     * @notice Get player tickets for a specific draw
     */
    function getPlayerTickets(
        uint256 drawId,
        address player
    ) external view drawExists(drawId) returns (Ticket[] memory) {
        return playerTickets[drawId][player];
    }

    /**
     * @notice Get draw information
     */
    function getDrawInfo(
        uint256 drawId
    )
        external
        view
        drawExists(drawId)
        returns (
            uint256 totalPrizePool,
            uint256 totalTickets,
            uint8[5] memory winningMainNumbers,
            uint8[2] memory winningLuckyStars,
            bool isCompleted,
            uint256 drawStartTime,
            uint256 drawEndTime
        )
    {
        Draw storage draw = draws[drawId];
        return (
            draw.totalPrizePool,
            draw.totalTickets,
            draw.winningMainNumbers,
            draw.winningLuckyStars,
            draw.isCompleted,
            draw.drawStartTime,
            draw.drawEndTime
        );
    }

    /**
     * @notice Get winners for a specific draw
     */
    function getDrawWinners(uint256 drawId) external view drawExists(drawId) returns (address[] memory) {
        return draws[drawId].winners;
    }

    /**
     * @notice Get current draw status
     */
    function getCurrentDrawStatus()
        external
        view
        returns (uint256 drawId, uint256 totalPrizePool, uint256 totalTickets, uint256 timeLeft, bool isActive)
    {
        Draw storage draw = draws[currentDrawId];
        bool active = block.timestamp >= draw.drawStartTime && block.timestamp <= draw.drawEndTime;
        uint256 timeRemaining = active ? draw.drawEndTime - block.timestamp : 0;

        return (currentDrawId, draw.totalPrizePool, draw.totalTickets, timeRemaining, active);
    }

    // Admin Functions

    /**
     * @notice Emergency pause contract
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause contract
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Emergency withdraw (only if contract is paused and no active draws)
     */
    function emergencyWithdraw() external onlyOwner whenPaused {
        require(draws[currentDrawId].isCompleted, "Active draw exists");

        uint256 balance = address(this).balance;
        (bool success, ) = payable(owner()).call{value: balance}("");
        if (!success) revert TransferFailed();
    }
}
