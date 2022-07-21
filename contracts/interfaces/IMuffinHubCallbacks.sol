// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;

interface IMuffinHubCallbacks {
    function muffinDepositCallback(
        address token,
        uint256 amount,
        bytes calldata data
    ) external;

    function muffinMintCallback(
        address token0,
        address token1,
        uint256 amount0,
        uint256 amount1,
        bytes calldata data
    ) external;

    function muffinSwapCallback(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        bytes calldata data
    ) external;
}
