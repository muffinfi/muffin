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

contract MockCaller is IMuffinHubCallbacks {
    address public immutable hub;

    constructor(address _hub) {
        hub = _hub;
    }

    function muffinDepositCallback(
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
            (address recipient, uint256 accRefId, , ) = abi.decode(params, (address, uint256, address, uint256));
            deposit(recipient, accRefId, token, amount, "");
        } else {
            revert("unknown action");
        }
    }

    function deposit(
        address recipient,
        uint256 accRefId,
        address token,
        uint256 amount,
        string memory action
    ) public {
        bytes memory data = abi.encode(keccak256(bytes(action)), abi.encode(recipient, accRefId, token, amount));
        IMuffinHub(hub).deposit(recipient, accRefId, token, amount, data);
    }

    // -----

    function muffinMintCallback(
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

    function mint(IMuffinHubPositions.MintParams calldata params) external {
        IMuffinHubPositions(hub).mint(params);
    }

    // -----

    function burn(IMuffinHubPositions.BurnParams calldata params) external {
        IMuffinHubPositions(hub).burn(params);
    }

    // -----

    function muffinSwapCallback(
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
        uint256 recipientAccRefId,
        uint256 senderAccRefId,
        bytes32 callbackAction
    ) external {
        IMuffinHub(hub).swap(
            tokenIn,
            tokenOut,
            tierChoices,
            amountDesired,
            recipient,
            recipientAccRefId,
            senderAccRefId,
            abi.encode(callbackAction)
        );
    }

    function swapMultiHop(IMuffinHub.SwapMultiHopParams memory params) external {
        IMuffinHub(hub).swapMultiHop(params);
    }
}
