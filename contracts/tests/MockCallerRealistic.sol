// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.10;

import "../interfaces/engine/IEngine.sol";
import "../interfaces/IEngineCallbacks.sol";
import "hardhat/console.sol";

// prettier-ignore
interface IMockERC20 {
    function mintTo(address to, uint256 amount) external;
    function transfer(address to, uint256 value) external returns (bool success);
    function transferFrom(address from, address to, uint256 value) external returns (bool success);
}

contract MockCallerRealistic is IEngineCallbacks {
    IEngine public immutable engine;

    constructor(address _engine) {
        engine = IEngine(_engine);
    }

    function depositCallback(
        address token,
        uint256 amount,
        bytes calldata data
    ) external {
        address payer = abi.decode(data, (address));
        if (amount > 0) IMockERC20(token).transferFrom(payer, msg.sender, amount);
    }

    function mintCallback(
        address token0,
        address token1,
        uint256 amount0,
        uint256 amount1,
        bytes calldata data
    ) external {
        address payer = abi.decode(data, (address));
        if (amount0 > 0) IMockERC20(token0).transferFrom(payer, msg.sender, amount0);
        if (amount1 > 0) IMockERC20(token1).transferFrom(payer, msg.sender, amount1);
    }

    function swapCallback(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        bytes calldata data
    ) external {
        address payer = abi.decode(data, (address));
        if (amountIn > 0) IMockERC20(tokenIn).transferFrom(payer, msg.sender, amountIn);
        tokenOut; // shhh
        amountOut; // shhh
    }

    function deposit(
        address recipient,
        uint256 accId,
        address token,
        uint256 amount
    ) public {
        IEngine(engine).deposit(recipient, accId, token, amount, abi.encode(msg.sender));
    }

    function mint(IEngine.MintParams memory params) external {
        params.data = abi.encode(msg.sender);
        IEngine(engine).mint(params);
    }

    function burn(IEngine.BurnParams calldata params) external {
        IEngine(engine).burn(params);
    }

    function swap(
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

    function swapHop(IEngine.SwapMultiHopParams memory params) external {
        params.data = abi.encode(msg.sender);
        IEngine(engine).swapMultiHop(params);
    }
}
