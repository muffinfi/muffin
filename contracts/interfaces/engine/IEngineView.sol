// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.8.0;

import "../../libraries/Tiers.sol";
import "../../libraries/Ticks.sol";
import "../../libraries/Positions.sol";

interface IEngineView {
    function getPoolBasics(bytes32 poolId) external view returns (uint8 tickSpacing, uint8 protocolFee);

    function getTier(bytes32 poolId, uint8 tierId) external view returns (Tiers.Tier memory);

    function getAllTiers(bytes32 poolId) external view returns (Tiers.Tier[] memory);

    function getTiersCount(bytes32 poolId) external view returns (uint256);

    function getTick(
        bytes32 poolId,
        uint8 tierId,
        int24 tick
    ) external view returns (Ticks.Tick memory);

    function getPosition(
        bytes32 poolId,
        address owner,
        uint256 accId,
        uint8 tierId,
        int24 tickLower,
        int24 tickUpper
    )
        external
        view
        returns (
            uint96 liquidityD8,
            uint80 feeGrowthInside0Last,
            uint80 feeGrowthInside1Last
        );

    function getTickMapBlockMap(bytes32 poolId, uint8 tierId) external view returns (uint256);

    function getTickMapBlock(
        bytes32 poolId,
        uint8 tierId,
        uint256 blockIdx
    ) external view returns (uint256);

    function getTickMapWord(
        bytes32 poolId,
        uint8 tierId,
        uint256 wordIdx
    ) external view returns (uint256);

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

    function getFeeGrowthInside(
        bytes32 poolId,
        uint8 tierId,
        int24 tickLower,
        int24 tickUpper
    ) external view returns (uint80 feeGrowthInside0, uint80 feeGrowthInside1);

    function getSecondsPerLiquidityInside(
        bytes32 poolId,
        uint8 tierId,
        int24 tickLower,
        int24 tickUpper
    ) external view returns (uint96 secondsPerLiquidityInside);
}
