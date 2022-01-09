// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.8.0;

interface IEngineActions {
    /// @notice                 Deposit token into recipient's account
    /// @param recipient        Recipient's address
    /// @param recipientAccId   Recipient's account id
    /// @param token            Address of the token to deposit
    /// @param amount           Token amount to deposit
    /// @param data             Arbitrary data that is passed to callback function
    function deposit(
        address recipient,
        uint256 recipientAccId,
        address token,
        uint256 amount,
        bytes calldata data
    ) external;

    /// @notice                 Withdraw token from sender's account and send to recipient's address
    /// @param recipient        Recipient's address
    /// @param senderAccId      Id of sender's account, i.e. the account to withdraw token from
    /// @param token            Address of the token to withdraw
    /// @param amount           Token amount to withdraw
    function withdraw(
        address recipient,
        uint256 senderAccId,
        address token,
        uint256 amount
    ) external;

    /// @notice                 Create pool
    /// @param token0           Address of token0 of the pool
    /// @param token1           Address of token1 of the pool
    /// @param sqrtGamma        Sqrt(1 - percentage swap fee of the tier) (precision: 1e5)
    /// @param sqrtPrice        Sqrt price of token0 denominated in token1 (UQ56.72)
    /// @param senderAccId      Sender's account id, for paying the base liquidity
    function createPool(
        address token0,
        address token1,
        uint24 sqrtGamma,
        uint128 sqrtPrice,
        uint256 senderAccId
    ) external;

    /// @notice                 Parameters for the mint function
    /// @param token0           Address of token0 of the pool
    /// @param token1           Address of token1 of the pool
    /// @param tierId           Position's tier index of the
    /// @param tickLower        Position's lower tick boundary
    /// @param tickUpper        Position's upper tick boundary
    /// @param liquidityD8      Amount of liquidity to mint, divided by 2^8
    /// @param recipient        Recipient's address
    /// @param recipientAccId   Recipient's account id
    /// @param senderAccId      Sender's account id
    /// @param data             Arbitrary data that is passed to callback function
    struct MintParams {
        address token0;
        address token1;
        uint8 tierId;
        int24 tickLower;
        int24 tickUpper;
        uint96 liquidityD8;
        address recipient;
        uint256 recipientAccId;
        uint256 senderAccId;
        bytes data;
    }

    /// @notice                 Add liquidity to a position
    /// @param params           MintParams struct
    /// @return amount0         Token0 amount to pay by the sender
    /// @return amount1         Token1 amount to pay by the sender
    function mint(MintParams calldata params) external returns (uint256 amount0, uint256 amount1);

    /// @notice                 Parameters for the burn function
    /// @param token0           Address of token0 of the pool
    /// @param token1           Address of token1 of the pool
    /// @param tierId           Tier index of the position
    /// @param tickLower        Lower tick boundary of the position
    /// @param tickUpper        Upper tick boundary of the position
    /// @param liquidityD8      Amount of liquidity to burn, divided by 2^8
    /// @param accId            Position owner's account id
    /// @param collectAllFees   True to collect all accrued fees of the position
    struct BurnParams {
        address token0;
        address token1;
        uint8 tierId;
        int24 tickLower;
        int24 tickUpper;
        uint96 liquidityD8;
        uint256 accId;
        bool collectAllFees;
    }

    /// @notice                 Remove liquidity from a position
    /// @dev                    When removing partial liquidity and params.collectAllFees is set to false, partial fees are sent
    ///                         to position owner's account proportionally to the amount of liquidity removed.
    /// @param params           BurnParams struct
    /// @return amount0         Amount of token0 sent to the position owner account
    /// @return amount1         Amount of token1 sent to the position owner account
    /// @return feeAmount0      Amount of token0 fee sent to the position owner account
    /// @return feeAmount1      Amount of token1 fee sent to the position owner account
    function burn(BurnParams calldata params)
        external
        returns (
            uint256 amount0,
            uint256 amount1,
            uint256 feeAmount0,
            uint256 feeAmount1
        );

    /// @notice                 Swap one token for another
    /// @param tokenIn          Input token address
    /// @param tokenOut         Output token address
    /// @param tierChoices      Bitmap to select which tiers are allowed to swap
    /// @param amountDesired    Desired swap amount (positive: input, negative: output)
    /// @param recipient        Recipient's address
    /// @param recipientAccId   Recipient's account id
    /// @param senderAccId      Sender's account id
    /// @param data             Arbitrary data that is passed to callback function
    /// @return amountIn        Input token amount
    /// @return amountOut       Output token amount
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

    /// @notice                 Parameters for the multi-hop swap function
    /// @param path             Multi-hop path. encodePacked(address tokenA, uint8 tierChoices, address tokenB, uint8 tierChoices ...)
    /// @param amountDesired    Desired swap amount (positive: input, negative: output)
    /// @param recipient        Recipient's address
    /// @param recipientAccId   Recipient's account id
    /// @param senderAccId      Sender's account id
    /// @param data             Arbitrary data that is passed to callback function
    struct SwapMultiHopParams {
        bytes path;
        int256 amountDesired;
        address recipient;
        uint256 recipientAccId;
        uint256 senderAccId;
        bytes data;
    }

    /// @notice                 Swap one token for another along the specified path
    /// @param params           SwapMultiHopParams struct
    /// @return amountIn        Input token amount
    /// @return amountOut       Output token amount
    function swapMultiHop(SwapMultiHopParams calldata params) external returns (uint256 amountIn, uint256 amountOut);
}
