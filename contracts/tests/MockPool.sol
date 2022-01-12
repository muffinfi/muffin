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
        uint256[] tierData
    );

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

    function setSqrtGamma(uint8 tierId, uint24 sqrtGamma) external unlock {
        pool.setSqrtGamma(tierId, sqrtGamma);
    }

    function setProtocolFee(uint8 protocolFee) external unlock {
        pool.setProtocolFee(protocolFee);
    }

    function setTickSpacing(uint8 tickSpacing) external unlock {
        pool.setTickSpacing(tickSpacing);
    }

    function prepareUpdateLiquidity() external {
        pool.tiers[0].feeGrowthGlobal0 = 1 << 40;
        pool.tiers[0].feeGrowthGlobal1 = 1 << 40;
        pool.secondsPerLiquidityCumulative = 1 << 40;
    }

    function increaseFeeGrowthGlobal(uint80 increase0, uint80 increase1) external {
        unchecked {
            pool.tiers[0].feeGrowthGlobal0 += increase0;
            pool.tiers[0].feeGrowthGlobal1 += increase1;
        }
    }

    function updateLiquidity(
        address owner,
        uint256 accId,
        uint8 tierId,
        int24 tickLower,
        int24 tickUpper,
        int96 liquidityDeltaD8,
        bool collectAllFees
    ) external unlock {
        (uint256 amount0, uint256 amount1, uint256 feeAmtOut0, uint256 feeAmtOut1) = pool.updateLiquidity(
            owner,
            accId,
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
        (
            int256 amountA,
            int256 amountB,
            uint256 protocolFeeAmt,
            uint256 amtInDistribution,
            uint256[] memory tierData
        ) = pool.swap(isToken0, amtDesired, tierChoices);

        (int256 amount0, int256 amount1) = isToken0 ? (amountA, amountB) : (amountB, amountA);

        emit SwapReturns(amount0, amount1, protocolFeeAmt, amtInDistribution, tierData);

        reserve0 = amount0 >= 0 ? reserve0 + abs(amount0) : reserve0 - abs(amount0);
        reserve1 = amount1 >= 0 ? reserve1 + abs(amount1) : reserve1 - abs(amount1);
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

    function getTick(uint8 tierId, int24 tick)
        external
        view
        returns (
            uint96 liquidityLowerD8,
            uint96 liquidityUpperD8,
            int24 nextBelow,
            int24 nextAbove,
            uint80 feeGrowthOutside0,
            uint80 feeGrowthOutside1,
            uint96 secondsPerLiquidityOutside
        )
    {
        Ticks.Tick storage t = pool.ticks[tierId][tick];
        return (
            t.liquidityLowerD8,
            t.liquidityUpperD8,
            t.nextBelow,
            t.nextAbove,
            t.feeGrowthOutside0,
            t.feeGrowthOutside1,
            t.secondsPerLiquidityOutside
        );
    }

    function getPosition(
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
        )
    {
        Positions.Position memory p = Positions.get(pool.positions, owner, accId, tierId, tickLower, tickUpper);
        return (p.liquidityD8, p.feeGrowthInside0Last, p.feeGrowthInside1Last);
    }

    function checkTickMap(
        uint8 tierId,
        int24 tick,
        bool set
    ) external view {
        TickMaps.TickMap storage map = pool.tickMaps[tierId];
        (uint256 blockIdx, uint256 wordIdx, uint256 compressed) = TickMaps._indices(tick);

        require(map.blockmap & (1 << blockIdx) > 0 == set);
        require(map.blocks[blockIdx] & (1 << (wordIdx & 0xFF)) > 0 == set);
        require(map.words[wordIdx] & (1 << (compressed & 0xFF)) > 0 == set);
    }

    function getFeeGrowthInside(
        uint8 tierId,
        int24 tickLower,
        int24 tickUpper
    ) external view returns (uint80 feeGrowthInside0, uint80 feeGrowthInside1) {
        return pool._feeGrowthInside(tierId, tickLower, tickUpper);
    }

    // following Position.sol
    function getPositionFees(
        address owner,
        uint256 accId,
        uint8 tierId,
        int24 tickLower,
        int24 tickUpper
    ) external view returns (uint256 feeAmt0, uint256 feeAmt1) {
        Positions.Position memory position = Positions.get(pool.positions, owner, accId, tierId, tickLower, tickUpper);
        (uint80 feeGrowthInside0, uint80 feeGrowthInside1) = pool._feeGrowthInside(tierId, tickLower, tickUpper);
        unchecked {
            uint96 liquidityD8 = position.liquidityD8;
            uint80 feeGrowthDelta0 = feeGrowthInside0 - position.feeGrowthInside0Last;
            uint80 feeGrowthDelta1 = feeGrowthInside1 - position.feeGrowthInside1Last;
            feeAmt0 = (uint256(liquidityD8) * feeGrowthDelta0) >> 56;
            feeAmt1 = (uint256(liquidityD8) * feeGrowthDelta1) >> 56;
        }
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

    function abs(int256 x) internal pure returns (uint256 z) {
        unchecked {
            z = x < 0 ? uint256(-x) : uint256(x);
        }
    }
}
