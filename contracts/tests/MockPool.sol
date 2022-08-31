// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.10;

import "../libraries/Pools.sol";

contract MockPool {
    using Pools for Pools.Pool;

    Pools.Pool public pool;
    uint256 public reserve0;
    uint256 public reserve1;

    event InitializeReturns(uint256 amount0, uint256 amount1);

    event AddTierReturns(uint256 amount0, uint256 amount1);

    event UpdateLiquidityReturns(uint256 amount0, uint256 amount1, uint256 feeAmtOut0, uint256 feeAmtOut1);

    event SwapReturns(
        int256 amount0,
        int256 amount1,
        uint256 protocolFeeAmt,
        uint256 amountInDistribution,
        uint256 amountOutDistribution,
        uint256[] tierData
    );

    event CollectSettledReturns(uint256 amount0, uint256 amount1, uint256 feeAmtOut0, uint256 feeAmtOut1);

    modifier unlock() {
        _;
        pool.unlock();
    }

    function initialize(
        uint24 sqrtGamma,
        uint128 sqrtPrice,
        uint8 tickSpacing,
        uint8 protocolFee
    ) external unlock {
        (uint256 amount0, uint256 amount1) = pool.initialize(sqrtGamma, sqrtPrice, tickSpacing, protocolFee);
        emit InitializeReturns(amount0, amount1);
        reserve0 += amount0;
        reserve1 += amount1;
    }

    function addTier(uint24 sqrtGamma) external unlock {
        (uint256 amount0, uint256 amount1, ) = pool.addTier(sqrtGamma);
        emit AddTierReturns(amount0, amount1);
        reserve0 += amount0;
        reserve1 += amount1;
    }

    function setTierParameters(
        uint8 tierId,
        uint24 sqrtGamma,
        uint8 limitOrderTickSpacingMultiplier
    ) external unlock {
        pool.setTierParameters(tierId, sqrtGamma, limitOrderTickSpacingMultiplier);
    }

    function setPoolParameters(uint8 tickSpacing, uint8 protocolFee) external unlock {
        pool.setPoolParameters(tickSpacing, protocolFee);
    }

    function prepareUpdateLiquidity() external {
        pool.tiers[0].feeGrowthGlobal0 = 1 << 40;
        pool.tiers[0].feeGrowthGlobal1 = 1 << 40;
    }

    function increaseFeeGrowthGlobal(uint80 increase0, uint80 increase1) external {
        unchecked {
            pool.tiers[0].feeGrowthGlobal0 += increase0;
            pool.tiers[0].feeGrowthGlobal1 += increase1;
        }
    }

    function updateLiquidity(
        address owner,
        uint256 positionRefId,
        uint8 tierId,
        int24 tickLower,
        int24 tickUpper,
        int96 liquidityDeltaD8,
        bool collectAllFees
    ) external unlock {
        (uint256 amount0, uint256 amount1, uint256 feeAmtOut0, uint256 feeAmtOut1) = pool.updateLiquidity(
            owner,
            positionRefId,
            tierId,
            tickLower,
            tickUpper,
            liquidityDeltaD8,
            collectAllFees
        );

        emit UpdateLiquidityReturns(amount0, amount1, feeAmtOut0, feeAmtOut1);

        if (liquidityDeltaD8 >= 0) {
            reserve0 += amount0;
            reserve1 += amount1;
        } else {
            reserve0 -= amount0;
            reserve1 -= amount1;
        }
        reserve0 -= feeAmtOut0;
        reserve1 -= feeAmtOut1;
    }

    function swap(
        bool isToken0,
        int256 amtDesired,
        uint256 tierChoices
    ) external unlock {
        Pools.SwapResult memory result = pool.swap(isToken0, amtDesired, tierChoices, 0);

        emit SwapReturns(
            result.amount0,
            result.amount1,
            result.protocolFeeAmt,
            result.amountInDistribution,
            result.amountOutDistribution,
            result.tierData
        );

        int256 amount0 = result.amount0;
        int256 amount1 = result.amount1;
        reserve0 = amount0 >= 0 ? reserve0 + abs(amount0) : reserve0 - abs(amount0);
        reserve1 = amount1 >= 0 ? reserve1 + abs(amount1) : reserve1 - abs(amount1);
    }

    function incrementSnapshotIds(
        uint8 tierId,
        int24 tickLower,
        int24 tickUpper
    ) external {
        pool.settlements[tierId][tickLower][0].nextSnapshotId++;
        pool.settlements[tierId][tickUpper][1].nextSnapshotId++;
    }

    function setLimitOrderType(
        address owner,
        uint256 positionRefId,
        uint8 tierId,
        int24 tickLower,
        int24 tickUpper,
        uint8 limitOrderType
    ) external {
        pool.setLimitOrderType(owner, positionRefId, tierId, tickLower, tickUpper, limitOrderType);
    }

    function collectSettled(
        address owner,
        uint256 positionRefId,
        uint8 tierId,
        int24 tickLower,
        int24 tickUpper,
        uint96 liquidityD8,
        bool collectAllFees
    ) external {
        (uint256 amount0, uint256 amount1, uint256 feeAmtOut0, uint256 feeAmtOut1) = pool.collectSettled(
            owner,
            positionRefId,
            tierId,
            tickLower,
            tickUpper,
            liquidityD8,
            collectAllFees
        );
        emit CollectSettledReturns(amount0, amount1, feeAmtOut0, feeAmtOut1);

        reserve0 = reserve0 - amount0 - feeAmtOut0;
        reserve1 = reserve1 - amount1 - feeAmtOut1;
    }

    // --- cheatcode ---

    function addTierWithSqrtPrice(uint24 sqrtGamma, uint128 sqrtPrice) external unlock {
        (uint256 amount0, uint256 amount1) = pool._addTier(sqrtGamma, sqrtPrice);
        emit AddTierReturns(amount0, amount1);
        reserve0 += amount0;
        reserve1 += amount1;
    }

    function setTick(
        uint8 tierId,
        int24 tick,
        uint96 liquidityLowerD8,
        uint96 liquidityUpperD8,
        int24 nextBelow,
        int24 nextAbove
    ) external {
        Ticks.Tick storage t = pool.ticks[tierId][tick];
        t.liquidityLowerD8 = liquidityLowerD8;
        t.liquidityUpperD8 = liquidityUpperD8;
        t.nextBelow = nextBelow;
        t.nextAbove = nextAbove;
    }

    function setTier(
        uint8 tierId,
        uint128 liquidity,
        int24 nextTickBelow,
        int24 nextTickAbove
    ) external {
        Tiers.Tier storage tier = pool.tiers[tierId];
        tier.liquidity = liquidity;
        tier.nextTickBelow = nextTickBelow;
        tier.nextTickAbove = nextTickAbove;
    }

    function setReserve(uint256 _reserve0, uint256 _reserve1) external {
        reserve0 = _reserve0;
        reserve1 = _reserve1;
    }

    // ---

    function getTier(uint8 tierId) external view returns (Tiers.Tier memory) {
        return pool.tiers[tierId];
    }

    function getAllTiers() external view returns (Tiers.Tier[] memory) {
        return pool.tiers;
    }

    function getTierCount() external view returns (uint256 count) {
        return pool.tiers.length;
    }

    function getTick(uint8 tierId, int24 tick) external view returns (Ticks.Tick memory) {
        return pool.ticks[tierId][tick];
    }

    function getPosition(
        address owner,
        uint256 positionRefId,
        uint8 tierId,
        int24 tickLower,
        int24 tickUpper
    ) external view returns (Positions.Position memory) {
        return Positions.get(pool.positions, owner, positionRefId, tierId, tickLower, tickUpper);
    }

    function checkTickMap(
        uint8 tierId,
        int24 tick,
        bool set
    ) external view {
        TickMaps.TickMap storage map = pool.tickMaps[tierId];
        (uint256 blockIdx, uint256 wordIdx, uint256 compressed) = TickMaps._indices(tick);

        require(map.blockMap & (1 << blockIdx) > 0 == set);
        require(map.blocks[blockIdx] & (1 << (wordIdx & 0xFF)) > 0 == set);
        require(map.words[wordIdx] & (1 << (compressed & 0xFF)) > 0 == set);
    }

    function getFeeGrowthInside(
        uint8 tierId,
        int24 tickLower,
        int24 tickUpper
    ) external view returns (uint80 feeGrowthInside0, uint80 feeGrowthInside1) {
        return pool._getFeeGrowthInside(tierId, tickLower, tickUpper);
    }

    /// @dev for unsettled position
    function getPositionFees(
        address owner,
        uint256 positionRefId,
        uint8 tierId,
        int24 tickLower,
        int24 tickUpper
    ) external view returns (uint256 feeAmt0, uint256 feeAmt1) {
        Positions.Position memory position = Positions.get(
            pool.positions,
            owner,
            positionRefId,
            tierId,
            tickLower,
            tickUpper
        );
        (uint80 feeGrowthInside0, uint80 feeGrowthInside1) = pool._getFeeGrowthInside(tierId, tickLower, tickUpper);
        unchecked {
            uint96 liquidityD8 = position.liquidityD8;
            uint80 feeGrowthDelta0 = feeGrowthInside0 - position.feeGrowthInside0Last;
            uint80 feeGrowthDelta1 = feeGrowthInside1 - position.feeGrowthInside1Last;
            feeAmt0 = (uint256(liquidityD8) * feeGrowthDelta0) >> 56;
            feeAmt1 = (uint256(liquidityD8) * feeGrowthDelta1) >> 56;
        }
    }

    function getSettlement(
        uint8 tierId,
        int24 tick,
        bool zeroForOne
    )
        external
        view
        returns (
            uint96 liquidityD8,
            uint16 tickSpacing,
            uint32 nextSnapshotId
        )
    {
        Settlement.Info storage settlement = pool.settlements[tierId][tick][zeroForOne ? 1 : 0];
        return (settlement.liquidityD8, settlement.tickSpacing, settlement.nextSnapshotId);
    }

    function getSettlementSnapshot(
        uint8 tierId,
        int24 tick,
        bool zeroForOne,
        uint32 snapshotId
    ) external view returns (Settlement.Snapshot memory) {
        Settlement.Info storage settlement = pool.settlements[tierId][tick][zeroForOne ? 1 : 0];
        return settlement.snapshots[snapshotId];
    }

    function getLimitOrderTickSpacingMultiplier(uint8 tierId) external view returns (uint8) {
        return pool.limitOrderTickSpacingMultipliers[tierId];
    }

    // ----- helpers -----

    function calcAmtsForLiquidityFromTicks(
        uint8 tierId,
        int24 tickLower,
        int24 tickUpper,
        int96 liquidityDeltaD8
    ) external view returns (uint256 amt0, uint256 amt1) {
        uint128 sqrtPrice = pool.tiers[tierId].sqrtPrice;
        return
            PoolMath.calcAmtsForLiquidity(
                sqrtPrice,
                TickMath.tickToSqrtPrice(tickLower),
                TickMath.tickToSqrtPrice(tickUpper),
                liquidityDeltaD8
            );
    }

    function tickToSqrtPrice(int24 tick) external pure returns (uint128 sqrtPrice) {
        return TickMath.tickToSqrtPrice(tick);
    }

    function sqrtPriceToTick(uint128 sqrtPrice) external pure returns (int24 tick) {
        return TickMath.sqrtPriceToTick(sqrtPrice);
    }

    function abs(int256 x) internal pure returns (uint256 z) {
        unchecked {
            z = x < 0 ? uint256(-x) : uint256(x);
        }
    }
}
