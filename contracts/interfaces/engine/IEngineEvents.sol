// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.8.0;

interface IEngineEvents {
    /// @notice Emitted when user deposits tokens to an account
    event Deposit(address indexed recipient, uint256 indexed recipientAccRefId, address indexed token, uint256 amount);

    /// @notice Emitted when user withdraws tokens from an account
    event Withdraw(address indexed recipient, uint256 indexed senderAccRefId, address indexed token, uint256 amount);

    /// @notice Emitted when a pool is created
    event PoolCreated(address indexed token0, address indexed token1);

    /// @notice Emitted when a new tier is added, or a tier's sqrt gamma is updated
    event UpdateTier(bytes32 indexed poolId, uint8 indexed tierId, uint24 sqrtGamma);

    /// @notice Emitted when a pool's tick spacing is updated
    event UpdateTickSpacing(bytes32 indexed poolId, uint8 tickSpacing);

    /// @notice Emitted when protocol percentage fee is updated
    event UpdateProtocolFee(bytes32 indexed poolId, uint8 protocolFee);

    /// @notice Emitted when protocol fee is collected
    event CollectProtocol(address indexed recipient, address indexed token, uint256 amount);

    /// @notice Emitted when governance address is updated
    event GovernanceUpdated(address governance);

    /// @notice Emitted when liquidity is minted for a given position
    event Mint(
        bytes32 indexed poolId,
        address indexed owner,
        uint256 indexed positionRefId,
        uint8 tierId,
        int24 tickLower,
        int24 tickUpper,
        uint96 liquidityD8,
        uint256 amount0,
        uint256 amount1
    );

    /// @notice Emitted when a position's liquidity is removed and collected
    /// @param amount0 Token0 amount from the burned liquidity
    /// @param amount1 Token1 amount from the burned liquidity
    /// @param feeAmount0 Token0 fee collected from the position
    /// @param feeAmount0 Token1 fee collected from the position
    event Burn(
        bytes32 indexed poolId,
        address indexed owner,
        uint256 indexed positionRefId,
        uint8 tierId,
        int24 tickLower,
        int24 tickUpper,
        uint96 liquidityD8,
        uint256 amount0,
        uint256 amount1,
        uint256 feeAmount0,
        uint256 feeAmount1
    );

    /// @notice Emitted when a settled position's liquidity is collected
    event CollectSettled(
        bytes32 indexed poolId,
        address indexed owner,
        uint256 indexed positionRefId,
        uint8 tierId,
        int24 tickLower,
        int24 tickUpper,
        uint96 liquidityD8,
        uint256 amount0,
        uint256 amount1,
        uint256 feeAmount0,
        uint256 feeAmount1
    );

    /// @notice Emitted when a position's limit order type is updated
    event SetLimitOrderType(
        bytes32 indexed poolId,
        address indexed owner,
        uint256 indexed positionRefId,
        uint8 tierId,
        int24 tickLower,
        int24 tickUpper,
        uint8 limitOrderType
    );

    /// @notice Emitted for any swap happened in any pool
    /// @param amountInDistribution Percentages of input token amount routed to each tier. Each value takes 42 bits (Q1.41)
    /// @param tierData Array of tier's liquidity (0-127th bits) and sqrt price (128-255th bits) after the swap
    event Swap(
        bytes32 indexed poolId,
        address indexed sender,
        address indexed recipient,
        int256 amount0,
        int256 amount1,
        uint256 amountInDistribution,
        uint256[] tierData
    );
}
