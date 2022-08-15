// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.10;

import "../../interfaces/manager/IPositionManager.sol";
import "../../interfaces/hub/IMuffinHubCombined.sol";

abstract contract LensBase {
    IPositionManager public immutable manager;
    IMuffinHubCombined public immutable hub;

    constructor(address _manager) {
        manager = IPositionManager(_manager);
        hub = IMuffinHubCombined(IPositionManager(_manager).hub());
    }
}
