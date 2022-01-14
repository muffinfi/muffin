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

    struct DepositData {
        bytes32 action;
        address recipient;
        uint256 accId;
        address token;
        uint256 amount;
    }

    function depositCallback(
        address token,
        uint256 amount,
        bytes calldata _data
    ) external {
        DepositData memory data = abi.decode(_data, (DepositData));
        if (data.action == keccak256("")) {
            IMockERC20(token).mintTo(msg.sender, amount);
        } else if (data.action == keccak256("NO_TOKEN_IN")) {
            // do nothing
        } else if (data.action == keccak256("REENTRANCY_ATTACK")) {
            deposit(data.recipient, data.accId, data.token, data.amount, "");
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
        DepositData memory data = DepositData(keccak256(bytes(action)), recipient, accId, token, amount);
        IEngine(engine).deposit(recipient, accId, token, amount, abi.encode(data));
    }

    // -----

    function mintCallback(
        address token0,
        address token1,
        uint256 amount0,
        uint256 amount1,
        bytes calldata data
    ) external {
        IEngine.MintParams memory params = abi.decode(data, (IEngineActions.MintParams));
        bytes32 action = bytes32(params.data);
        if (params.data.length == 0 || action == keccak256("")) {
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

    function mint(IEngine.MintParams memory params) external {
        params.data = abi.encode(params);
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

    // ----- callbacks -----

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
        (address token0, address token1, uint256 amt0, uint256 amt1) = abi.decode(
            data,
            (address, address, uint256, uint256)
        );
        if (feeAmt0 > 0) IMockERC20(token0).mintTo(msg.sender, uint256(feeAmt0));
        if (feeAmt1 > 0) IMockERC20(token1).mintTo(msg.sender, uint256(feeAmt1));
        if (amt0 > 0) IMockERC20(token0).transfer(msg.sender, amt0);
        if (amt1 > 0) IMockERC20(token1).transfer(msg.sender, amt1);
        data; // shhh
    }
}
