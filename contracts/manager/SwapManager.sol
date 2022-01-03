// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "../interfaces/engine/IEngine.sol";
import "../libraries/math/Math.sol";
import "./base/ManagerBase.sol";

abstract contract SwapManager is ManagerBase {
    using Math for uint256;

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

    function exactInSingle(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMinimum,
        uint256 tierChoices,
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
        require(amountOut >= amountOutMinimum);
    }

    function exactIn(
        bytes calldata path,
        uint256 amountIn,
        uint256 amountOutMinimum,
        address recipient,
        bool fromAccount,
        bool toAccount
    ) external payable returns (uint256 amountOut) {
        (, amountOut) = IEngine(engine).swapHop(
            IEngineActions.SwapHopParams({
                path: path,
                amountDesired: amountIn.toInt256(),
                recipient: toAccount ? address(this) : recipient,
                recipientAccId: toAccount ? getAccId(recipient) : 0,
                senderAccId: fromAccount ? getAccId(msg.sender) : 0,
                data: fromAccount ? new bytes(0) : abi.encode(msg.sender)
            })
        );
        require(amountOut >= amountOutMinimum);
    }

    function exactOutSingle(
        address tokenIn,
        address tokenOut,
        uint256 amountOut,
        uint256 amountInMaximum,
        uint256 tierChoices,
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
        require(amountIn <= amountInMaximum);
    }

    function exactOut(
        bytes calldata path,
        uint256 amountOut,
        uint256 amountInMaximum,
        address recipient,
        bool fromAccount,
        bool toAccount
    ) external payable returns (uint256 amountIn) {
        (, amountOut) = IEngine(engine).swapHop(
            IEngineActions.SwapHopParams({
                path: path,
                amountDesired: -amountOut.toInt256(),
                recipient: toAccount ? address(this) : recipient,
                recipientAccId: toAccount ? getAccId(recipient) : 0,
                senderAccId: fromAccount ? getAccId(msg.sender) : 0,
                data: fromAccount ? new bytes(0) : abi.encode(msg.sender)
            })
        );
        require(amountIn <= amountInMaximum);
    }
}