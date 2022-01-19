// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.10;

import "../interfaces/engine/IEngine.sol";
import "../interfaces/engine/positions/IEnginePositions.sol";
import "../interfaces/IEngineCallbacks.sol";
import "hardhat/console.sol";

// prettier-ignore
interface IMockERC20 {
    function mintTo(address to, uint256 amount) external;
    function transfer(address to, uint256 value) external returns (bool success);
    function transferFrom(address from, address to, uint256 value) external returns (bool success);
}

contract MockCallerRealistic is IEngineCallbacks {
    address public immutable engine;

    constructor(address _engine) {
        engine = _engine;
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
        uint256 accRefId,
        address token,
        uint256 amount
    ) public {
        IEngine(engine).deposit(recipient, accRefId, token, amount, abi.encode(msg.sender));
    }

    function mint(IEnginePositions.MintParams memory params) external {
        params.data = abi.encode(msg.sender);
        IEnginePositions(engine).mint(params);
    }

    function burn(IEnginePositions.BurnParams calldata params) external {
        IEnginePositions(engine).burn(params);
    }

    function swap(
        address tokenIn,
        address tokenOut,
        uint256 tierChoices,
        int256 amountDesired,
        address recipient,
        uint256 recipientAccRefId,
        uint256 senderAccRefId
    ) external {
        IEngine(engine).swap(
            tokenIn,
            tokenOut,
            tierChoices,
            amountDesired,
            recipient,
            recipientAccRefId,
            senderAccRefId,
            abi.encode(msg.sender)
        );
    }

    function swapHop(IEngine.SwapMultiHopParams memory params) external {
        params.data = abi.encode(msg.sender);
        IEngine(engine).swapMultiHop(params);
    }

    function setLimitOrderType(
        address token0,
        address token1,
        uint8 tierId,
        int24 tickLower,
        int24 tickUpper,
        uint256 positionRefId,
        uint8 positionType
    ) external {
        IEnginePositions(engine).setLimitOrderType(
            token0,
            token1,
            tierId,
            tickLower,
            tickUpper,
            positionRefId,
            positionType
        );
    }
}
