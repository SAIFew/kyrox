// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title TestUSDC
/// @notice 6-decimal settlement token for the KYROX Base Sepolia testnet.
/// @dev Supply is created only by the welcome and daily faucets and by the
/// allowlisted exchange. There is no unrestricted mint path.
contract TestUSDC is ERC20, AccessControl {
    /// @notice Role allowed to mint and burn on behalf of the exchange.
    bytes32 public constant EXCHANGE_ROLE = keccak256("KYROX_EXCHANGE_ROLE");

    uint8 public constant DECIMALS = 6;
    uint256 public constant WELCOME_AMOUNT = 1_000e6;
    uint256 public constant DAILY_AMOUNT = 100e6;
    uint256 public constant DAILY_PERIOD = 1 days;

    mapping(address account => bool claimed) public welcomeClaimed;
    mapping(address account => uint256 timestamp) public lastDailyClaimAt;

    event WelcomeClaimed(address indexed account, uint256 amount);
    event DailyClaimed(address indexed account, uint256 amount, uint256 nextClaimAt);
    event ExchangeMint(address indexed to, uint256 amount);
    event ExchangeBurn(address indexed from, uint256 amount);

    error AlreadyClaimedWelcome(address account);
    error DailyClaimTooSoon(address account, uint256 nextClaimAt);
    error ZeroAddress();
    error ZeroAmount();
    error BurnFromNotSelf(address from);

    constructor(address admin) ERC20("KYROX Test USD", "tUSDC") {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @inheritdoc ERC20
    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }

    /// @notice One-time onboarding grant of 1,000 tUSDC.
    function claimWelcome() external returns (uint256 amount) {
        if (welcomeClaimed[msg.sender]) revert AlreadyClaimedWelcome(msg.sender);
        welcomeClaimed[msg.sender] = true;
        amount = WELCOME_AMOUNT;
        _mint(msg.sender, amount);
        emit WelcomeClaimed(msg.sender, amount);
    }

    /// @notice 100 tUSDC per rolling 24-hour period, per address.
    function claimDaily() external returns (uint256 amount) {
        uint256 nextClaimAt = lastDailyClaimAt[msg.sender] + DAILY_PERIOD;
        if (lastDailyClaimAt[msg.sender] != 0 && block.timestamp < nextClaimAt) {
            revert DailyClaimTooSoon(msg.sender, nextClaimAt);
        }
        lastDailyClaimAt[msg.sender] = block.timestamp;
        amount = DAILY_AMOUNT;
        _mint(msg.sender, amount);
        emit DailyClaimed(msg.sender, amount, block.timestamp + DAILY_PERIOD);
    }

    /// @notice Exchange-only mint. Used when a user sells stock for tUSDC.
    function mintByExchange(address to, uint256 amount) external onlyRole(EXCHANGE_ROLE) {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        _mint(to, amount);
        emit ExchangeMint(to, amount);
    }

    /// @notice Exchange-only burn. Used when a user buys stock with tUSDC.
    function burnByExchange(address from, uint256 amount) external onlyRole(EXCHANGE_ROLE) {
        if (from != msg.sender) revert BurnFromNotSelf(from);
        if (amount == 0) revert ZeroAmount();
        _burn(from, amount);
        emit ExchangeBurn(from, amount);
    }
}
