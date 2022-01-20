// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.10;

import "../interfaces/hub/IMuffinHub.sol";
import "../interfaces/hub/positions/IMuffinHubPositions.sol";
import "../MuffinHub.sol";

// prettier-ignore
interface IMockERC20 {
    function mintTo(address to, uint256 amount) external;
    function transfer(address to, uint256 value) external returns (bool success);
    function transferFrom(address from, address to, uint256 value) external returns (bool success);
}

interface IMockMuffinHub is IMuffinHub, IMuffinHubPositions {
    function addAccountBalance(
        address recipient,
        uint256 recipientAccRefId,
        address token,
        uint256 amount
    ) external;

    function increaseFeeGrowthGlobal(
        bytes32 poolId,
        uint80 increase0,
        uint80 increase1
    ) external;
}

contract MockMuffinHub is MuffinHub {
    constructor(address _positionController) MuffinHub(_positionController) {}

    function addAccountBalance(
        address recipient,
        uint256 recipientAccRefId,
        address token,
        uint256 amount
    ) external {
        IMockERC20(token).mintTo(address(this), amount);
        accounts[token][getAccHash(recipient, recipientAccRefId)] += amount;
    }

    function increaseFeeGrowthGlobal(
        bytes32 poolId,
        uint80 increase0,
        uint80 increase1
    ) external {
        unchecked {
            pools[poolId].tiers[0].feeGrowthGlobal0 += increase0;
            pools[poolId].tiers[0].feeGrowthGlobal1 += increase1;
        }
    }
}
