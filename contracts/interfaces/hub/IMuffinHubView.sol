// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.0;

import "../../libraries/Tiers.sol";
import "../../libraries/Ticks.sol";
import "../../libraries/Positions.sol";

interface IMuffinHubView {
    function isSqrtGammaAllowed(bytes32 poolId, uint24 sqrtGamma) external view returns (bool);

    function getDefaultParameters() external view returns (uint8 tickSpacing, uint8 protocolFee);

    function getPoolParameters(bytes32 poolId) external view returns (uint8 tickSpacing, uint8 protocolFee);

    function getTier(bytes32 poolId, uint8 tierId) external view returns (Tiers.Tier memory);

    function getTiersCount(bytes32 poolId) external view returns (uint256);

    function getTick(
        bytes32 poolId,
        uint8 tierId,
        int24 tick
    ) external view returns (Ticks.Tick memory);

    function getPosition(
        bytes32 poolId,
        address owner,
        uint256 positionRefId,
        uint8 tierId,
        int24 tickLower,
        int24 tickUpper
    ) external view returns (Positions.Position memory);

    function getTWAP(bytes32 poolId)
        external
        view
        returns (
            uint32 lastUpdate,
            int56 tickCumulative,
            int24 tickEma20,
            int24 tickEma40,
            uint96 secondsPerLiquidityCumulative
        );
}
