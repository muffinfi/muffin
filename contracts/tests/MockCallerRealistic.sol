// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.10;

import "../interfaces/hub/IMuffinHub.sol";
import "../interfaces/hub/positions/IMuffinHubPositions.sol";
import "../interfaces/IMuffinHubCallbacks.sol";
import "hardhat/console.sol";

// prettier-ignore
interface IMockERC20 {
    function mintTo(address to, uint256 amount) external;
    function transfer(address to, uint256 value) external returns (bool success);
    function transferFrom(address from, address to, uint256 value) external returns (bool success);
}

contract MockCallerRealistic is IMuffinHubCallbacks {
    address public immutable hub;

    constructor(address _hub) {
        hub = _hub;
    }

    function muffinDepositCallback(
        address token,
        uint256 amount,
        bytes calldata data
    ) external {
        address payer = abi.decode(data, (address));
        if (amount > 0) IMockERC20(token).transferFrom(payer, msg.sender, amount);
    }

    function muffinMintCallback(
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

    function muffinSwapCallback(
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
        IMuffinHub(hub).deposit(recipient, accRefId, token, amount, abi.encode(msg.sender));
    }

    function mint(IMuffinHubPositions.MintParams memory params) external {
        params.data = abi.encode(msg.sender);
        IMuffinHubPositions(hub).mint(params);
    }

    function burn(IMuffinHubPositions.BurnParams calldata params) external {
        IMuffinHubPositions(hub).burn(params);
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
        IMuffinHub(hub).swap(
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

    function swapHop(IMuffinHub.SwapMultiHopParams memory params) external {
        params.data = abi.encode(msg.sender);
        IMuffinHub(hub).swapMultiHop(params);
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
        IMuffinHubPositions(hub).setLimitOrderType(
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
