// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.10;

import "../../interfaces/hub/IMuffinHub.sol";

import "hardhat/console.sol";

contract Quoter {
    address public immutable hub;

    constructor(address _hub) {
        hub = _hub;
    }

    function swapCallback(
        address,
        address,
        uint256 amountIn,
        uint256 amountOut,
        bytes calldata
    ) external pure {
        assembly {
            let ptr := mload(0x40) // free memory pointer
            mstore(add(ptr, 0), amountIn)
            mstore(add(ptr, 32), amountOut)
            revert(ptr, 64)
        }
    }

    function _parseRevertReason(bytes memory reason) internal pure returns (uint256 amountIn, uint256 amountOut) {
        if (reason.length == 64) return abi.decode(reason, (uint256, uint256));
        assembly {
            revert(add(32, reason), mload(reason))
        }
    }

    function quoteSingle(
        address tokenIn,
        address tokenOut,
        uint256 tierChoices,
        int256 amountDesired
    )
        external
        returns (
            uint256 amountIn,
            uint256 amountOut,
            uint256 gasUsed
        )
    {
        uint256 gasBefore = gasleft();
        try
            IMuffinHub(hub).swap(tokenIn, tokenOut, tierChoices, amountDesired, address(this), 0, 0, new bytes(0))
        {} catch (bytes memory reason) {
            gasUsed = gasBefore - gasleft();
            (amountIn, amountOut) = _parseRevertReason(reason);
        }
    }

    function quote(bytes memory path, int256 amountDesired)
        external
        returns (
            uint256 amountIn,
            uint256 amountOut,
            uint256 gasUsed
        )
    {
        uint256 gasBefore = gasleft();
        try
            IMuffinHub(hub).swapMultiHop(
                IMuffinHubActions.SwapMultiHopParams({
                    path: path,
                    amountDesired: amountDesired,
                    recipient: address(this),
                    recipientAccRefId: 0,
                    senderAccRefId: 0,
                    data: new bytes(0)
                })
            )
        {} catch (bytes memory reason) {
            gasUsed = gasBefore - gasleft();
            (amountIn, amountOut) = _parseRevertReason(reason);
        }
    }

    struct Result {
        bool success;
        bytes returnData;
    }

    function batch(bytes[] calldata data) external returns (uint256 blockNumber, Result[] memory results) {
        blockNumber = block.number;
        results = new Result[](data.length);
        for (uint256 i = 0; i < data.length; i++) {
            (bool success, bytes memory result) = address(this).delegatecall(data[i]);
            results[i] = Result(success, result);
        }
    }
}
