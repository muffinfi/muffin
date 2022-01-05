// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.8.0;

interface IEngineEvents {
    /// @dev Emitted when user deposits tokens to an account
    event Deposit(address indexed recipient, uint256 indexed recipientAccId, address indexed token, uint256 amount);

    /// @dev Emitted when user withdraws tokens from an account
    event Withdraw(address indexed recipient, uint256 indexed senderAccId, address indexed token, uint256 amount);

    /// @dev Emitted when a pool is created
    event PoolCreated(address indexed token0, address indexed token1);

    /// @dev Emitted when a new tier is added, or a tier's sqrt gamma is updated
    event UpdateTier(bytes32 indexed poolId, uint8 indexed tierId, uint24 sqrtGamma);

    /// @dev Emitted when a pool's tick spacing is updated
    event UpdateTickSpacing(bytes32 indexed poolId, uint8 tickSpacing);

    /// @dev Emitted when protocol percentage fee is updated
    event UpdateProtocolFee(bytes32 indexed poolId, uint8 protocolFee);

    /// @dev Emitted when protocol fee is collected
    event CollectProtocol(address indexed recipient, address indexed token, uint256 amount);

    /// @dev Emitted when governance address is updated
    event GovernanceUpdated(address governance);

    /// @dev Emitted when liquidity is minted for a given position
    event Mint(
        bytes32 indexed poolId,
        address indexed owner,
        uint256 indexed accId,
        uint8 tierId,
        int24 tickLower,
        int24 tickUpper,
        uint96 liquidityD8,
        uint256 amount0,
        uint256 amount1
    );

    /// @dev Emitted when a position's liquidity is removed
    event Burn(
        bytes32 indexed poolId,
        address indexed owner,
        uint256 indexed accId,
        uint8 tierId,
        int24 tickLower,
        int24 tickUpper,
        uint96 liquidityD8,
        uint256 amount0,
        uint256 amount1,
        uint256 feeAmount0,
        uint256 feeAmount1
    );

    /// @dev Emitted for any swap happened in any pool
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
