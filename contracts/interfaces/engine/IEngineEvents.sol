// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.8.0;

interface IEngineEvents {
    event Deposit(address indexed recipient, uint256 indexed recipientAccId, address indexed token, uint256 amount);

    event Withdraw(address indexed recipient, uint256 indexed senderAccId, address indexed token, uint256 amount);

    event PoolCreated(address indexed token0, address indexed token1);

    event UpdateTier(bytes32 indexed poolId, uint8 indexed tierId, uint24 sqrtGamma);

    event UpdateTickSpacing(bytes32 indexed poolId, uint8 tickSpacing);

    event UpdateProtocolFee(bytes32 indexed poolId, uint8 protocolFee);

    event CollectProtocol(address indexed recipient, address indexed token, uint256 amount);

    event Mint(
        bytes32 indexed poolId,
        address indexed owner,
        uint256 indexed accId,
        uint8 tierId,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity,
        uint256 amount0,
        uint256 amount1
    );

    event Burn(
        bytes32 indexed poolId,
        address indexed owner,
        uint256 indexed accId,
        uint8 tierId,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity,
        uint256 amount0,
        uint256 amount1,
        uint256 feeAmount0,
        uint256 feeAmount1
    );

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
