// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.8.0;

import "../../libraries/Tiers.sol";
import "../../libraries/Ticks.sol";

interface IMuffinHubView {
    function getDefaultParameters() external view returns (uint8 tickSpacing, uint8 protocolFee);

    function getPoolParameters(bytes32 poolId) external view returns (uint8 tickSpacing, uint8 protocolFee);

    function getTier(bytes32 poolId, uint8 tierId) external view returns (Tiers.Tier memory);

    function getAllTiers(bytes32 poolId) external view returns (Tiers.Tier[] memory);

    function getTiersCount(bytes32 poolId) external view returns (uint256);

    function getTick(
        bytes32 poolId,
        uint8 tierId,
        int24 tick
    ) external view returns (Ticks.Tick memory);

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

    function getLimitOrderTickSpacingMultipliers(bytes32 poolId) external view returns (uint8[6] memory);
}
