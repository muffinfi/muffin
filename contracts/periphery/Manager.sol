// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "./base/ManagerBase.sol";
import "./base/PositionManager.sol";
import "./base/SwapManager.sol";
import "./base/Multicall.sol";
import "./base/SelfPermit.sol";

contract Manager is ManagerBase, SwapManager, PositionManager, Multicall, SelfPermit {
    constructor(address _hub, address _WETH9) ManagerBase(_hub, _WETH9) {}
}
