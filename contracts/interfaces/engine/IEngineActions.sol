// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.8.0;

interface IEngineActions {
    function deposit(
        address recipient,
        uint256 recipientAccId,
        address token,
        uint256 amount,
        bytes calldata data
    ) external;

    function withdraw(
        address recipient,
        uint256 senderAccId,
        address token,
        uint256 amount
    ) external;

    function createPool(
        address token0,
        address token1,
        uint24 sqrtGamma,
        uint128 sqrtPrice,
        uint256 senderAccId
    ) external;

    struct MintParams {
        address token0;
        address token1;
        uint8 tierId;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        address recipient;
        uint256 recipientAccId;
        uint256 senderAccId;
        bytes data;
    }

    function mint(MintParams calldata params) external returns (uint256 amount0, uint256 amount1);

    struct BurnParams {
        address token0;
        address token1;
        uint8 tierId;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        uint256 accId;
        bool collectAllFees;
    }

    function burn(BurnParams calldata params)
        external
        returns (
            uint256 amount0,
            uint256 amount1,
            uint256 feeAmount0,
            uint256 feeAmount1
        );

    function flash(
        address token0,
        address token1,
        uint256 amount0,
        uint256 amount1,
        address recipient,
        bytes calldata data
    ) external;

    function swap(
        address tokenIn,
        address tokenOut,
        uint256 tierChoices,
        int256 amountDesired,
        address recipient,
        uint256 recipientAccId,
        uint256 senderAccId,
        bytes calldata data
    ) external returns (uint256 amountIn, uint256 amountOut);

    struct SwapHopParams {
        bytes path;
        int256 amountDesired;
        address recipient;
        uint256 recipientAccId;
        uint256 senderAccId;
        bytes data;
    }

    function swapHop(SwapHopParams calldata p) external returns (uint256 amountIn, uint256 amountOut);
}
