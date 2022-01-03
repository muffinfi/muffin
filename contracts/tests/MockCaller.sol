// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.10;

import "../interfaces/engine/IEngine.sol";
import "../interfaces/IEngineCallbacks.sol";

// prettier-ignore
interface IMockERC20 {
    function mintTo(address to, uint256 amount) external;
    function transfer(address to, uint256 value) external returns (bool success);
    function transferFrom(address from, address to, uint256 value) external returns (bool success);
}

contract MockCaller is IEngineCallbacks {
    function depositCallback(
        address token,
        uint256 amount,
        bytes calldata data
    ) external {
        if (amount > 0) IMockERC20(token).mintTo(msg.sender, amount);
        data; // shhh
    }

    function mintCallback(
        address token0,
        address token1,
        uint256 amount0,
        uint256 amount1,
        bytes calldata data
    ) external {
        if (amount0 > 0) IMockERC20(token0).mintTo(msg.sender, amount0);
        if (amount1 > 0) IMockERC20(token1).mintTo(msg.sender, amount1);
        data; // shhh
    }

    function swapCallback(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        bytes calldata data
    ) external {
        tokenOut; // shhh
        amountOut; // shhh
        address payer = abi.decode(data, (address));
        if (amountIn > 0) IMockERC20(tokenIn).transferFrom(payer, msg.sender, amountIn);
    }

    function flashCallback(
        uint256 feeAmt0,
        uint256 feeAmt1,
        bytes calldata data
    ) external {
        (address token0, address token1, uint amt0, uint amt1) = abi.decode(data, (address, address, uint, uint));
        if (feeAmt0 > 0) IMockERC20(token0).mintTo(msg.sender, uint256(feeAmt0));
        if (feeAmt1 > 0) IMockERC20(token1).mintTo(msg.sender, uint256(feeAmt1));
        if (amt0 > 0) IMockERC20(token0).transfer(msg.sender, amt0);
        if (amt1 > 0) IMockERC20(token1).transfer(msg.sender, amt1);
        data; // shhh
    }

    // -----
    function createPool(
        address engine,
        address token0,
        address token1,
        uint24 sqrtGamma,
        uint128 sqrtPrice,
        uint256 accountId
    ) external {
        IEngine(engine).createPool(token0, token1, sqrtGamma, sqrtPrice, accountId);
    }

    function deposit(
        address engine,
        address recipient,
        uint256 accId,
        address token,
        uint256 amount
    ) external {
        IEngine(engine).deposit(recipient, accId, token, amount, new bytes(0));
    }

    function mint(address engine, IEngine.MintParams calldata params) external {
        IEngine(engine).mint(params);
    }

    function burn(address engine, IEngine.BurnParams calldata params) external {
        IEngine(engine).burn(params);
    }

    function swap(
        address engine,
        address tokenIn,
        address tokenOut,
        uint256 tierChoices,
        int256 amountDesired,
        address recipient,
        uint256 recipientAccId,
        uint256 senderAccId
    ) external {
        IEngine(engine).swap(
            tokenIn,
            tokenOut,
            tierChoices,
            amountDesired,
            recipient,
            recipientAccId,
            senderAccId,
            abi.encode(msg.sender)
        );
    }

    function swapHop(address engine, IEngine.SwapHopParams memory params) external {
        params.data = abi.encode(msg.sender);
        IEngine(engine).swapHop(params);
    }
}
