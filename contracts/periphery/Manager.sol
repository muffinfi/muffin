// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "./base/ManagerBase.sol";
import "./PositionManager.sol";
import "./SwapManager.sol";
import "./base/Multicall.sol";
import "./base/SelfPermit.sol";

contract Manager is ManagerBase, SwapManager, PositionManager, Multicall, SelfPermit {
    constructor(address _engine, address _WETH9) ManagerBase(_engine, _WETH9) {}
}
