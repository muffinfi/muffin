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

contract MockCaller is IEngineCallbacks {
    IEngine public immutable engine;

    constructor(address _engine) {
        engine = IEngine(_engine);
    }

    function depositCallback(
        address token,
        uint256 amount,
        bytes calldata _data
    ) external {
        (bytes32 action, bytes memory params) = abi.decode(_data, (bytes32, bytes));
        if (action == keccak256("")) {
            IMockERC20(token).mintTo(msg.sender, amount);
        } else if (action == keccak256("NO_TOKEN_IN")) {
            // do nothing
        } else if (action == keccak256("REENTRANCY_ATTACK")) {
            (address recipient, uint256 accId, , ) = abi.decode(params, (address, uint256, address, uint256));
            deposit(recipient, accId, token, amount, "");
        } else {
            revert("unknown action");
        }
    }

    function deposit(
        address recipient,
        uint256 accId,
        address token,
        uint256 amount,
        string memory action
    ) public {
        bytes memory data = abi.encode(keccak256(bytes(action)), abi.encode(recipient, accId, token, amount));
        IEngine(engine).deposit(recipient, accId, token, amount, data);
    }

    // -----

    function mintCallback(
        address token0,
        address token1,
        uint256 amount0,
        uint256 amount1,
        bytes calldata data
    ) external {
        bytes32 action = bytes32(data);
        if (data.length == 0 || action == keccak256("")) {
            if (amount0 > 0) IMockERC20(token0).mintTo(msg.sender, amount0);
            if (amount1 > 0) IMockERC20(token1).mintTo(msg.sender, amount1);
        } else if (action == keccak256("NO_TOKEN0_IN")) {
            if (amount1 > 0) IMockERC20(token1).mintTo(msg.sender, amount1);
        } else if (action == keccak256("NO_TOKEN1_IN")) {
            if (amount0 > 0) IMockERC20(token0).mintTo(msg.sender, amount0);
        } else {
            revert("unknown action");
        }
    }

    function mint(IEngine.MintParams calldata params) external {
        IEngine(engine).mint(params);
    }

    // -----

    function burn(IEngine.BurnParams calldata params) external {
        IEngine(engine).burn(params);
    }

    // -----

    function swapCallback(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        bytes calldata data
    ) external {
        bytes32 action = abi.decode(data, (bytes32));
        if (action == keccak256("")) {
            IMockERC20(tokenIn).mintTo(msg.sender, amountIn);
        } else if (action == keccak256("NO_TOKEN_IN")) {
            // do nothing
        } else {
            revert("unknown action");
        }
        tokenOut; // shhh
        amountOut; // shhh
    }

    function swap(
        address tokenIn,
        address tokenOut,
        uint256 tierChoices,
        int256 amountDesired,
        address recipient,
        uint256 recipientAccId,
        uint256 senderAccId,
        bytes32 callbackAction
    ) external {
        IEngine(engine).swap(
            tokenIn,
            tokenOut,
            tierChoices,
            amountDesired,
            recipient,
            recipientAccId,
            senderAccId,
            abi.encode(callbackAction)
        );
    }

    function swapMultiHop(IEngine.SwapMultiHopParams memory params) external {
        IEngine(engine).swapMultiHop(params);
    }
}
