// SPDX-License-Identifier: GPL-3.0-only
pragma solidity >=0.8.0;

import "../../../libraries/Settlement.sol";

interface IMuffinHubPositionsView {
    function getPositionFeeGrowthInside(
        bytes32 poolId,
        address owner,
        uint256 positionRefId,
        uint8 tierId,
        int24 tickLower,
        int24 tickUpper
    ) external view returns (uint80 feeGrowthInside0, uint80 feeGrowthInside1);

    function getPositionSecondsPerLiquidityInside(
        bytes32 poolId,
        address owner,
        uint256 positionRefId,
        uint8 tierId,
        int24 tickLower,
        int24 tickUpper
    ) external view returns (uint96 secondsPerLiquidityInside);

    function getSettlement(
        bytes32 poolId,
        uint8 tierId,
        int24 tick,
        bool isToken0LimitOrder
    )
        external
        view
        returns (
            uint96 liquidityD8,
            uint16 tickSpacing,
            uint32 snapshotId
        );

    function getSettlementSnapshot(
        bytes32 poolId,
        uint8 tierId,
        int24 tick,
        bool isToken0LimitOrder,
        uint32 snapshotId
    ) external view returns (Settlement.Snapshot memory);

    function getLimitOrderTickSpacingMultipliers(bytes32 poolId) external view returns (uint8[6] memory);
}
