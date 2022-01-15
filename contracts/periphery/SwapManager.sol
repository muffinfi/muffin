// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "../interfaces/engine/IEngine.sol";
import "../libraries/math/Math.sol";
import "./base/ManagerBase.sol";

abstract contract SwapManager is ManagerBase {
    using Math for uint256;

    /// @dev Called by the engine contract
    function swapCallback(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        bytes calldata data
    ) external fromEngine {
        if (amountIn > 0) pay(tokenIn, abi.decode(data, (address)), amountIn);
        tokenOut; // shhh
        amountOut; // shhh
    }

    /**
     * @notice                  Swap `amountIn` of one token for as much as possible of another token
     * @param tokenIn           Address of input token
     * @param tokenOut          Address of output token
     * @param tierChoices       Bitmap to select which tiers are allowed to swap (e.g. 0b111111 to allow all tiers)
     * @param amountIn          Desired input amount
     * @param amountOutMinimum  Minimum output amount
     * @param recipient         Address of the recipient of the output token
     * @param fromAccount       True for using sender's internal account to pay
     * @param toAccount         True for storing output tokens in recipient's internal account
     * @return amountOut        Output amount of the swap
     */
    function exactInSingle(
        address tokenIn,
        address tokenOut,
        uint256 tierChoices,
        uint256 amountIn,
        uint256 amountOutMinimum,
        address recipient,
        bool fromAccount,
        bool toAccount
    ) external payable returns (uint256 amountOut) {
        (, amountOut) = IEngine(engine).swap(
            tokenIn,
            tokenOut,
            tierChoices,
            amountIn.toInt256(),
            toAccount ? address(this) : recipient,
            toAccount ? getAccId(recipient) : 0,
            fromAccount ? getAccId(msg.sender) : 0,
            fromAccount ? new bytes(0) : abi.encode(msg.sender)
        );
        require(amountOut >= amountOutMinimum, "TOO_LITTLE_RECEIVED");
    }

    /**
     * @notice                  Swap `amountIn` of one token for as much as possible of another along the specified path
     * @param path              Multi-hop path
     * @param amountIn          Desired input amount
     * @param amountOutMinimum  Minimum output amount
     * @param recipient         Address of the recipient of the output token
     * @param fromAccount       True for using sender's internal account to pay
     * @param toAccount         True for storing output tokens in recipient's internal account
     * @return amountOut        Output amount of the swap
     */
    function exactIn(
        bytes calldata path,
        uint256 amountIn,
        uint256 amountOutMinimum,
        address recipient,
        bool fromAccount,
        bool toAccount
    ) external payable returns (uint256 amountOut) {
        (, amountOut) = IEngine(engine).swapMultiHop(
            IEngineActions.SwapMultiHopParams({
                path: path,
                amountDesired: amountIn.toInt256(),
                recipient: toAccount ? address(this) : recipient,
                recipientAccId: toAccount ? getAccId(recipient) : 0,
                senderAccId: fromAccount ? getAccId(msg.sender) : 0,
                data: fromAccount ? new bytes(0) : abi.encode(msg.sender)
            })
        );
        require(amountOut >= amountOutMinimum, "TOO_LITTLE_RECEIVED");
    }

    /**
     * @notice                  Swap as little as possible of one token for `amountOut` of another token
     * @param tokenIn           Address of input token
     * @param tokenOut          Address of output token
     * @param tierChoices       Bitmap to select which tiers are allowed to swap (e.g. 0b111111 to allow all tiers)
     * @param amountOut         Desired output amount
     * @param amountInMaximum   Maximum input amount to pay
     * @param recipient         Address of the recipient of the output token
     * @param fromAccount       True for using sender's internal account to pay
     * @param toAccount         True for storing output tokens in recipient's internal account
     * @return amountIn         Input amount of the swap
     */
    function exactOutSingle(
        address tokenIn,
        address tokenOut,
        uint256 tierChoices,
        uint256 amountOut,
        uint256 amountInMaximum,
        address recipient,
        bool fromAccount,
        bool toAccount
    ) external payable returns (uint256 amountIn) {
        (amountIn, ) = IEngine(engine).swap(
            tokenIn,
            tokenOut,
            tierChoices,
            -amountOut.toInt256(),
            toAccount ? address(this) : recipient,
            toAccount ? getAccId(recipient) : 0,
            fromAccount ? getAccId(msg.sender) : 0,
            fromAccount ? new bytes(0) : abi.encode(msg.sender)
        );
        require(amountIn <= amountInMaximum, "TOO_MUCH_REQUESTED");
    }

    /**
     * @notice                  Swap as little as possible of one token for `amountOut` of another along the specified path
     * @param path              Address of output token
     * @param amountOut         Desired output amount
     * @param amountInMaximum   Maximum input amount to pay
     * @param recipient         Address of the recipient of the output token
     * @param fromAccount       True for using sender's internal account to pay
     * @param toAccount         True for storing output tokens in recipient's internal account
     * @return amountIn         Input amount of the swap
     */
    function exactOut(
        bytes calldata path,
        uint256 amountOut,
        uint256 amountInMaximum,
        address recipient,
        bool fromAccount,
        bool toAccount
    ) external payable returns (uint256 amountIn) {
        (, amountOut) = IEngine(engine).swapMultiHop(
            IEngineActions.SwapMultiHopParams({
                path: path,
                amountDesired: -amountOut.toInt256(),
                recipient: toAccount ? address(this) : recipient,
                recipientAccId: toAccount ? getAccId(recipient) : 0,
                senderAccId: fromAccount ? getAccId(msg.sender) : 0,
                data: fromAccount ? new bytes(0) : abi.encode(msg.sender)
            })
        );
        require(amountIn <= amountInMaximum, "TOO_MUCH_REQUESTED");
    }

    // function swap(
    //     address tokenIn,
    //     address tokenOut,
    //     uint256 tierChoices,
    //     bool exactInput,
    //     uint256 amountInDesired,
    //     uint256 amountOutDesired,
    //     address recipient,
    //     bool fromAccount,
    //     bool toAccount
    // ) external payable returns (uint256 amountIn, uint256 amountOut) {
    //     (amountIn, amountOut) = IEngine(engine).swap(
    //         tokenIn,
    //         tokenOut,
    //         tierChoices,
    //         exactInput ? amountInDesired.toInt256() : -amountOutDesired.toInt256(),
    //         toAccount ? address(this) : recipient,
    //         toAccount ? getAccId(recipient) : 0,
    //         fromAccount ? getAccId(msg.sender) : 0,
    //         fromAccount ? new bytes(0) : abi.encode(msg.sender)
    //     );
    //     if (exactInput) {
    //         require(amountOut >= amountOutDesired, "TOO_LITTLE_RECEIVED");
    //     } else {
    //         require(amountIn <= amountInDesired, "TOO_MUCH_REQUESTED");
    //     }
    // }

    // function swapHop(
    //     bytes calldata path,
    //     bool exactInput,
    //     uint256 amountInDesired,
    //     uint256 amountOutDesired,
    //     address recipient,
    //     bool fromAccount,
    //     bool toAccount
    // ) external payable returns (uint256 amountIn, uint256 amountOut) {
    //     (amountIn, amountOut) = IEngine(engine).swapMultiHop(
    //         IEngineActions.SwapMultiHopParams({
    //             path: path,
    //             amountDesired: amountIn.toInt256(),
    //             recipient: toAccount ? address(this) : recipient,
    //             recipientAccId: toAccount ? getAccId(recipient) : 0,
    //             senderAccId: fromAccount ? getAccId(msg.sender) : 0,
    //             data: fromAccount ? new bytes(0) : abi.encode(msg.sender)
    //         })
    //     );
    //     if (exactInput) {
    //         require(amountOut >= amountOutDesired, "TOO_LITTLE_RECEIVED");
    //     } else {
    //         require(amountIn <= amountInDesired, "TOO_MUCH_REQUESTED");
    //     }
    // }
}
