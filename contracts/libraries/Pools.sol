// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "./math/TickMath.sol";
import "./math/SwapMath.sol";
import "./math/EMAMath.sol";
import "./math/Math.sol";
import "./Tiers.sol";
import "./Ticks.sol";
import "./TickMaps.sol";
import "./Positions.sol";

library Pools {
    using Math for uint96;
    using Math for uint128;
    using Tiers for Tiers.Tier;
    using Ticks for Ticks.Tick;
    using TickMaps for TickMaps.TickMap;
    using Positions for Positions.Position;

    error InvalidAmount();
    error InvalidTierChoices();
    error InvalidTick();

    /// @param unlocked     Reentrancy lock
    /// @param tickSpacing  Tick spacing. Only ticks that are multiples of the tick spacing can be used
    /// @param protocolFee  Protocol fee with base 255 (e.g. protocolFee = 51 for 20% protocol fee)
    /// @param tickLastUpdate Timestamp of last tickCumulative update
    /// @param tickCumulative Tick * seconds elapsed
    /// @param tickEma20    Tick 20-min EMA
    /// @param tickEma40    Tick 40-min EMA
    /// @param secondsPerLiquidityCumulative Accumulated seconds per unit of liquidity (UQ8.88)
    /// @param tiers        Array of tiers
    /// @param tickMaps     Bitmap for each tier to store which ticks are initializated (tierId => TickMap)
    /// @param ticks        Mapping of tick states for each tier (tierId => tick => Tick)
    /// @param positions    Mapping of position states (keccak256(encodePacked(owner, accId, tierId, tickLower, tickUpper)) => Position)
    struct Pool {
        bool unlocked;
        uint8 tickSpacing;
        uint8 protocolFee;
        uint32 tickLastUpdate;
        int56 tickCumulative;
        int24 tickEma20;
        int24 tickEma40;
        uint96 secondsPerLiquidityCumulative;
        Tiers.Tier[] tiers;
        mapping(uint256 => TickMaps.TickMap) tickMaps;
        mapping(uint256 => mapping(int24 => Ticks.Tick)) ticks;
        mapping(bytes32 => Positions.Position) positions;
    }

    uint256 internal constant MAX_TIERS = 6;
    uint256 internal constant FEE_GROWTH_RESOLUTION = 64;
    uint256 internal constant SECONDS_PER_LIQUIDITY_RESOLUTION = 80;

    function lock(Pool storage pool) internal {
        require(pool.unlocked);
        pool.unlocked = false;
    }

    function unlock(Pool storage pool) internal {
        pool.unlocked = true;
    }

    function getPoolAndId(
        mapping(bytes32 => Pool) storage pools,
        address token0,
        address token1
    ) internal view returns (Pool storage pool, bytes32 poolId) {
        poolId = keccak256(abi.encode(token0, token1));
        pool = pools[poolId];
    }

    /*===============================================================
     *                       INITIALIZATION
     *==============================================================*/

    function initialize(
        Pool storage pool,
        uint24 sqrtGamma,
        uint128 sqrtPrice,
        uint8 tickSpacing, // assume checked
        uint8 protocolFee // assume checked
    ) external returns (uint256 amount0, uint256 amount1) {
        require(pool.tickSpacing == 0); // ensure not initialized
        require(Constants.MIN_SQRT_P <= sqrtPrice && sqrtPrice < Constants.MAX_SQRT_P);
        require(sqrtGamma == 99850 || sqrtGamma == 99975); // TODO:

        pool.tickSpacing = tickSpacing;
        pool.protocolFee = protocolFee;

        int24 tick = TickMath.sqrtPriceToTick(sqrtPrice);
        (pool.tickLastUpdate, pool.tickEma20, pool.tickEma40) = (uint32(block.timestamp), tick, tick);
        (amount0, amount1) = _addTier(pool, sqrtGamma, sqrtPrice);
    }

    function addTier(Pool storage pool, uint24 sqrtGamma)
        external
        returns (
            uint256 amount0,
            uint256 amount1,
            uint8 tierId
        )
    {
        lock(pool);
        require((tierId = uint8(pool.tiers.length)) > 0);
        _updateTWAP(pool, pool.tiers);
        (amount0, amount1) = _addTier(pool, sqrtGamma, pool.tiers[0].sqrtPrice); // use 1st tier sqrt price as reference
    }

    function _addTier(
        Pool storage pool,
        uint24 sqrtGamma,
        uint128 sqrtPrice
    ) internal returns (uint256 amount0, uint256 amount1) {
        uint256 tierId = pool.tiers.length;
        require(tierId < MAX_TIERS);
        require(sqrtGamma <= 100000);

        // initialize tier
        pool.tiers.push(
            Tiers.Tier({
                liquidity: uint128(Constants.BASE_LIQUIDITY_D8) << 8,
                sqrtPrice: sqrtPrice,
                sqrtGamma: sqrtGamma,
                tick: TickMath.sqrtPriceToTick(sqrtPrice),
                nextTickBelow: Constants.MIN_TICK,
                nextTickAbove: Constants.MAX_TICK,
                feeGrowthGlobal0: 0,
                feeGrowthGlobal1: 0
            })
        );

        // initialize min tick & max tick
        Ticks.Tick storage lower = pool.ticks[tierId][Constants.MIN_TICK];
        Ticks.Tick storage upper = pool.ticks[tierId][Constants.MAX_TICK];
        (lower.liquidityLowerD8, lower.nextBelow, lower.nextAbove) = (
            Constants.BASE_LIQUIDITY_D8,
            Constants.MIN_TICK,
            Constants.MAX_TICK
        );
        (upper.liquidityUpperD8, upper.nextBelow, upper.nextAbove) = (
            Constants.BASE_LIQUIDITY_D8,
            Constants.MIN_TICK,
            Constants.MAX_TICK
        );

        // initialize tick map
        pool.tickMaps[tierId].set(Constants.MIN_TICK);
        pool.tickMaps[tierId].set(Constants.MAX_TICK);

        // calculate tokens to take for full-range base liquidity
        amount0 = UnsafeMath.ceilDiv(uint256(Constants.BASE_LIQUIDITY_D8) << 80, sqrtPrice);
        amount1 = UnsafeMath.ceilDiv(uint256(Constants.BASE_LIQUIDITY_D8) * sqrtPrice, 1 << 64);
    }

    /*===============================================================
     *                           SETTINGS
     *==============================================================*/

    function setSqrtGamma(
        Pool storage pool,
        uint8 tierId,
        uint24 sqrtGamma
    ) internal {
        require(pool.unlocked);
        require(tierId < pool.tiers.length);
        require(sqrtGamma <= 100000);
        pool.tiers[tierId].sqrtGamma = sqrtGamma;
    }

    function setProtocolFee(Pool storage pool, uint8 protocolFee) internal {
        require(pool.unlocked);
        pool.protocolFee = protocolFee;
    }

    function setTickSpacing(Pool storage pool, uint8 tickSpacing) internal {
        require(pool.unlocked);
        require(int24(uint24(tickSpacing)) >= Constants.MIN_TICK_SPACING);
        pool.tickSpacing = tickSpacing;
    }

    /*===============================================================
     *                       TWAP, INCENTIVES
     *==============================================================*/

    uint256 private constant Q64 = 0x10000000000000000;

    function _updateTWAP(Pool storage pool, Tiers.Tier[] memory tiers) internal {
        uint32 lastUpdate = pool.tickLastUpdate;
        int56 tickCum = pool.tickCumulative;
        int24 ema20 = pool.tickEma20;
        int24 ema40 = pool.tickEma40;
        uint96 secsPerLiqCum = pool.secondsPerLiquidityCumulative;
        uint32 timestamp = uint32(block.timestamp);

        unchecked {
            uint32 secs = timestamp - lastUpdate;
            if (secs == 0) return;

            uint256 sumL;
            int256 sumLTick; // sum of liquidity * tick (Q24 * UQ128)
            for (uint256 i; i < tiers.length; i++) {
                Tiers.Tier memory tier = tiers[i];
                sumL += tier.liquidity;
                sumLTick += int256(tier.tick) * int256(uint256(tier.liquidity));
            }
            tickCum += int56((sumLTick * int256(uint256(secs))) / int256(sumL));
            secsPerLiqCum += uint96((uint256(secs) << SECONDS_PER_LIQUIDITY_RESOLUTION) / sumL);

            // calculate tick ema
            (uint256 d40, uint256 d20) = EMAMath.calcDecayFactors(secs);
            ema20 = int24(((sumLTick * int256(Q64 - d20)) / int256(sumL) + ema20 * int256(d20)) >> 64);
            ema40 = int24(((sumLTick * int256(Q64 - d40)) / int256(sumL) + ema40 * int256(d40)) >> 64);
        }

        pool.tickLastUpdate = timestamp;
        pool.tickCumulative = tickCum;
        pool.tickEma20 = ema20;
        pool.tickEma40 = ema40;
        pool.secondsPerLiquidityCumulative = secsPerLiqCum;
    }

    /*===============================================================
     *                            SWAP
     *==============================================================*/

    uint256 private constant Q128 = 0x100000000000000000000000000000000;
    int256 private constant REJECTED = type(int256).max; // represents the tier is rejected for the swap
    int256 private constant AMOUNT_TOLERANCE = 100; // tolerance between the desired and actual swap amounts

    struct SwapCache {
        bool zeroForOne;
        bool exactIn;
        uint8 protocolFee;
        uint256 protocolFeeAmt;
        uint256 priceBoundReached;
        TickMath.Cache tmCache;
        int256[MAX_TIERS] amounts;
    }

    struct TierState {
        uint128 sqrtPTick;
        uint256 amountIn;
        bool crossed;
    }

    /// @notice                 Perform a swap in the pool
    /// @param pool             Pool storage pointer
    /// @param isToken0         True if amtDesired refers to token0
    /// @param amtDesired       Desired swap amount (positive: exact input, negative: exact output)
    /// @param tierChoices      Bitmap to allow which tiers to swap
    /// @return amountA         Pool's tokenA balance change (the token which amtDesired refers to)
    /// @return amountB         Pool's tokenB balance change (the opposite token of tokenA)
    /// @return protocolFeeAmt  Amount of input token as protocol fee
    /// @return amtInDistribution Percentages of input amount routed to each tier (for logging)
    /// @return tierData        Array of tier's liquidity and sqrt price after the swap (for logging)
    function swap(
        Pool storage pool,
        bool isToken0,
        int256 amtDesired,
        uint256 tierChoices
    )
        internal
        returns (
            int256 amountA,
            int256 amountB,
            uint256 protocolFeeAmt,
            uint256 amtInDistribution,
            uint256[] memory tierData
        )
    {
        lock(pool);
        Tiers.Tier[] memory tiers = pool.tiers;
        TierState[MAX_TIERS] memory states;
        unchecked {
            if (amtDesired == 0 || amtDesired == REJECTED) revert InvalidAmount();
            if (tierChoices > 0x3F || tierChoices & ((1 << tiers.length) - 1) == 0) revert InvalidTierChoices();
        }

        _updateTWAP(pool, tiers);

        SwapCache memory cache = SwapCache({
            zeroForOne: isToken0 == (amtDesired > 0),
            exactIn: amtDesired > 0,
            protocolFee: pool.protocolFee,
            protocolFeeAmt: 0,
            priceBoundReached: 0,
            tmCache: TickMath.Cache({tick: type(int24).max, sqrtP: 0}),
            amounts: [int256(0), 0, 0, 0, 0, 0]
        });

        while (true) {
            // calculate the swap amount for each tier
            cache.amounts = amtDesired > 0
                ? SwapMath.calcTierAmtsIn(tiers, isToken0, amtDesired - amountA, tierChoices)
                : SwapMath.calcTierAmtsOut(tiers, isToken0, amtDesired - amountA, tierChoices);

            // compute the swap for each tier
            for (uint256 i; i < tiers.length; i++) {
                (int256 amtAStep, int256 amtBStep) = _swapStep(pool, isToken0, cache, states[i], tiers[i], i);
                amountA += amtAStep;
                amountB += amtBStep;
            }

            // check if we meet the stopping criteria
            int256 amtRemaining = amtDesired - amountA;
            unchecked {
                if (
                    (amtDesired > 0 ? amtRemaining <= AMOUNT_TOLERANCE : amtRemaining >= -AMOUNT_TOLERANCE) ||
                    cache.priceBoundReached == tierChoices & ((1 << tiers.length) - 1)
                ) break;
            }
        }

        protocolFeeAmt = cache.protocolFeeAmt;
        (amtInDistribution, tierData) = _updateTiers(pool, states, tiers, uint256(amtDesired > 0 ? amountA : amountB));
    }

    function _swapStep(
        Pool storage pool,
        bool isToken0,
        SwapCache memory cache,
        TierState memory state,
        Tiers.Tier memory tier,
        uint256 tierId
    ) internal returns (int256 amtAStep, int256 amtBStep) {
        if (cache.amounts[tierId] == REJECTED) return (0, 0);

        // calculate sqrt price of the next tick
        if (state.sqrtPTick == 0)
            state.sqrtPTick = TickMath.tickToSqrtPriceMemoized(
                cache.tmCache,
                cache.zeroForOne ? tier.nextTickBelow : tier.nextTickAbove
            );

        unchecked {
            // calculate input & output amts, new sqrt price, and fee amt for this swap step
            uint256 feeAmtStep;
            (amtAStep, amtBStep, tier.sqrtPrice, feeAmtStep) = SwapMath.computeStep(
                isToken0,
                cache.exactIn,
                cache.amounts[tierId],
                tier.sqrtPrice,
                state.sqrtPTick,
                tier.liquidity,
                tier.sqrtGamma
            );
            if (amtAStep == REJECTED) return (0, 0);

            // cache input amount for later event logging (locally)
            state.amountIn += uint256(cache.exactIn ? amtAStep : amtBStep);

            // update protocol fee amt (locally)
            uint256 protocolFeeAmt = (feeAmtStep * cache.protocolFee) / type(uint8).max;
            cache.protocolFeeAmt += protocolFeeAmt;
            feeAmtStep -= protocolFeeAmt;

            // update fee growth (locally) (realistically assume feeAmtStep < 2**192)
            uint80 feeGrowth = uint80((feeAmtStep << FEE_GROWTH_RESOLUTION) / tier.liquidity);
            if (cache.zeroForOne) {
                tier.feeGrowthGlobal0 += feeGrowth;
            } else {
                tier.feeGrowthGlobal1 += feeGrowth;
            }
        }

        // handle cross tick, which updates a tick state
        if (tier.sqrtPrice == state.sqrtPTick) {
            int24 tickCross = cache.zeroForOne ? tier.nextTickBelow : tier.nextTickAbove;

            // skip crossing tick if reaches the end of the supported price range
            if (tickCross == Constants.MIN_TICK || tickCross == Constants.MAX_TICK) {
                cache.priceBoundReached |= 1 << tierId;
                return (amtAStep, amtBStep);
            }

            // clear cached tick price, so as to calculate a new one in next loop
            state.sqrtPTick = 0;
            state.crossed = true;

            // flip the direction of tick's data (effect)
            Ticks.Tick storage cross = pool.ticks[tierId][tickCross];
            cross.flip(tier.feeGrowthGlobal0, tier.feeGrowthGlobal1, pool.secondsPerLiquidityCumulative);
            unchecked {
                // update tier's liquidity and next ticks (locally)
                (uint128 liqLowerD8, uint128 liqUpperD8) = (cross.liquidityLowerD8, cross.liquidityUpperD8);
                if (cache.zeroForOne) {
                    tier.liquidity = tier.liquidity + (liqUpperD8 << 8) - (liqLowerD8 << 8);
                    tier.nextTickBelow = cross.nextBelow;
                    tier.nextTickAbove = tickCross;
                } else {
                    tier.liquidity = tier.liquidity + (liqLowerD8 << 8) - (liqUpperD8 << 8);
                    tier.nextTickBelow = tickCross;
                    tier.nextTickAbove = cross.nextAbove;
                }
            }
        }
    }

    /// @dev Apply the post-swap data changes from memory to storage, also prepare data for event logging
    function _updateTiers(
        Pool storage pool,
        TierState[MAX_TIERS] memory states,
        Tiers.Tier[] memory tiers,
        uint256 amtIn
    ) internal returns (uint256 amtInDistribution, uint256[] memory tierData) {
        tierData = new uint256[](tiers.length);
        bool noOverflow = amtIn < (1 << 215); // 256 - 41 bits
        unchecked {
            for (uint8 i; i < tiers.length; i++) {
                TierState memory state = states[i];
                // we can safely assume tier data is unchanged when there's zero input amount and no crossing tick,
                // since we would have rejected the tier if such case happened.
                if (state.amountIn > 0 || state.crossed) {
                    Tiers.Tier memory tier = tiers[i];
                    // calculate current tick:
                    // if tier's price is equal to tick's price (let say the tick is T), the tier is expected to be in
                    // the upper tick space [T, T+1]. Only if the tier's next upper crossing tick is T, the tier is in
                    // the lower tick space [T-1, T].
                    tier.tick = TickMath.sqrtPriceToTick(tier.sqrtPrice);
                    if (tier.tick == tier.nextTickAbove) tier.tick--;

                    pool.tiers[i] = tier;

                    // prepare data for logging
                    tierData[i] = (uint256(tier.sqrtPrice) << 128) | tier.liquidity;
                    amtInDistribution |=
                        (noOverflow ? (state.amountIn << 41) / amtIn : state.amountIn / ((amtIn >> 41) + 1)) <<
                        (uint256(i) * 42);
                }
            }
        }
    }

    /*===============================================================
     *                      UPDATE LIQUIDITY
     *==============================================================*/

    /// @notice                 Update a position's liquidity
    /// @dev                    External function. called by DELEGATECALL
    /// @param owner            Address of the position owner
    /// @param accId            Account id of the position owner
    /// @param tierId           Tier index of the position
    /// @param tickLower        Lower tick boundary of the position
    /// @param tickUpper        Upper tick boundary of the position
    /// @param liquidityDeltaD8 Amount of liquidity change, divided by 2^8
    /// @param collectAllFees   True to collect all remaining accrued fees of the position
    function updateLiquidity(
        Pool storage pool,
        address owner,
        uint256 accId,
        uint8 tierId,
        int24 tickLower,
        int24 tickUpper,
        int96 liquidityDeltaD8,
        bool collectAllFees
    )
        external
        returns (
            uint256 amount0,
            uint256 amount1,
            uint256 feeAmtOut0,
            uint256 feeAmtOut1
        )
    {
        lock(pool);
        _updateTWAP(pool, pool.tiers);
        if (
            tickLower >= tickUpper ||
            (Constants.MIN_TICK > tickLower || tickLower >= Constants.MAX_TICK) ||
            (Constants.MIN_TICK >= tickUpper || tickUpper > Constants.MAX_TICK) ||
            (liquidityDeltaD8 > 0 &&
                (tickLower % int24(uint24(pool.tickSpacing)) != 0 || tickUpper % int24(uint24(pool.tickSpacing)) != 0))
        ) revert InvalidTick();

        // -------------------- UPDATE LIQUIDITY --------------------
        {
            // update current liquidity if in-range
            Tiers.Tier storage tier = pool.tiers[tierId];
            if (tickLower <= tier.tick && tier.tick < tickUpper) {
                tier.liquidity = tier.liquidity.addInt128(int128(liquidityDeltaD8) << 8);
            }
        }

        // --------------------- UPDATE TICKS -----------------------
        {
            bool initialized;
            initialized = _updateTick(pool, tierId, tickLower, liquidityDeltaD8, true);
            initialized = _updateTick(pool, tierId, tickUpper, liquidityDeltaD8, false) || initialized;
            if (initialized) {
                Tiers.Tier storage tier = pool.tiers[tierId];
                tier.updateNextTick(tickLower);
                tier.updateNextTick(tickUpper);
            }
        }

        // -------------------- UPDATE POSITION ---------------------
        {
            (uint80 feeGrowthInside0, uint80 feeGrowthInside1) = _feeGrowthInside(pool, tierId, tickLower, tickUpper);
            Positions.Position storage pos = Positions.get(pool.positions, owner, accId, tierId, tickLower, tickUpper);
            (feeAmtOut0, feeAmtOut1) = pos.update(liquidityDeltaD8, feeGrowthInside0, feeGrowthInside1, collectAllFees);
        }

        // -------------------- CLEAN UP TICKS ----------------------
        if (liquidityDeltaD8 < 0) {
            bool deleted;
            deleted = _deleteEmptyTick(pool, tierId, tickLower);
            deleted = _deleteEmptyTick(pool, tierId, tickUpper) || deleted;
            // reset tier's next ticks if any ticks deleted
            if (deleted) {
                Tiers.Tier storage tier = pool.tiers[tierId];
                int24 below = TickMaps.nextBelow(pool.tickMaps[tierId], tier.tick + Constants.MIN_TICK_SPACING);
                int24 above = pool.ticks[tierId][below].nextAbove;
                tier.nextTickBelow = below;
                tier.nextTickAbove = above;
            }
        }

        // -------------------- TOKEN AMOUNTS -----------------------
        // calculate input and output amount for the liquidity change
        if (liquidityDeltaD8 != 0)
            (amount0, amount1) = PoolMath.calcAmtsForLiquidity(
                pool.tiers[tierId].sqrtPrice,
                TickMath.tickToSqrtPrice(tickLower),
                TickMath.tickToSqrtPrice(tickUpper),
                liquidityDeltaD8
            );
    }

    /*===============================================================
     *                    TICKS (UPDATE LIQUIDITY)
     *==============================================================*/

    function _updateTick(
        Pool storage pool,
        uint8 tierId,
        int24 tick,
        int96 liquidityDeltaD8,
        bool isLower
    ) internal returns (bool initialized) {
        mapping(int24 => Ticks.Tick) storage ticks = pool.ticks[tierId];
        Ticks.Tick storage obj = ticks[tick];

        if (obj.liquidityLowerD8 == 0 && obj.liquidityUpperD8 == 0) {
            // initialize tick if adding liquidity to empty tick
            if (liquidityDeltaD8 > 0) {
                TickMaps.TickMap storage tickMap = pool.tickMaps[tierId];
                int24 below = tickMap.nextBelow(tick);
                int24 above = ticks[below].nextAbove;
                obj.nextBelow = below;
                obj.nextAbove = above;
                ticks[below].nextAbove = tick;
                ticks[above].nextBelow = tick;

                tickMap.set(tick);
                initialized = true;
            }

            // assume past fees and reward were generated _below_ the current tick
            Tiers.Tier storage tier = pool.tiers[tierId];
            if (tick <= tier.tick) {
                obj.feeGrowthOutside0 = tier.feeGrowthGlobal0;
                obj.feeGrowthOutside1 = tier.feeGrowthGlobal1;
                obj.secondsPerLiquidityOutside = pool.secondsPerLiquidityCumulative;
            }
        }

        // update liquidity
        if (isLower) {
            obj.liquidityLowerD8 = obj.liquidityLowerD8.addInt96(liquidityDeltaD8);
        } else {
            obj.liquidityUpperD8 = obj.liquidityUpperD8.addInt96(liquidityDeltaD8);
        }
    }

    function _deleteEmptyTick(
        Pool storage pool,
        uint8 tierId,
        int24 tick
    ) internal returns (bool deleted) {
        mapping(int24 => Ticks.Tick) storage ticks = pool.ticks[tierId];
        Ticks.Tick storage obj = ticks[tick];

        if (obj.liquidityLowerD8 == 0 && obj.liquidityUpperD8 == 0) {
            int24 below = obj.nextBelow;
            int24 above = obj.nextAbove;
            ticks[below].nextAbove = above;
            ticks[above].nextBelow = below;

            pool.tickMaps[tierId].unset(tick);
            delete ticks[tick];
            deleted = true;
        }
    }

    /*===============================================================
     *                  FEE GROWTH (UPDATE LIQUIDITY)
     *==============================================================*/

    function _feeGrowthInside(
        Pool storage pool,
        uint8 tierId,
        int24 tickLower,
        int24 tickUpper
    ) internal view returns (uint80 feeGrowthInside0, uint80 feeGrowthInside1) {
        Ticks.Tick storage upper = pool.ticks[tierId][tickUpper];
        Ticks.Tick storage lower = pool.ticks[tierId][tickLower];
        Tiers.Tier storage tier = pool.tiers[tierId];
        int24 tickCurrent = tier.tick;

        unchecked {
            if (tickCurrent < tickLower) {
                // current price below range
                feeGrowthInside0 = lower.feeGrowthOutside0 - upper.feeGrowthOutside0;
                feeGrowthInside1 = lower.feeGrowthOutside1 - upper.feeGrowthOutside1;
            } else if (tickCurrent >= tickUpper) {
                // current price above range
                feeGrowthInside0 = upper.feeGrowthOutside0 - lower.feeGrowthOutside0;
                feeGrowthInside1 = upper.feeGrowthOutside1 - lower.feeGrowthOutside1;
            } else {
                // current price in range
                feeGrowthInside0 = tier.feeGrowthGlobal0 - upper.feeGrowthOutside0 - lower.feeGrowthOutside0;
                feeGrowthInside1 = tier.feeGrowthGlobal1 - upper.feeGrowthOutside1 - lower.feeGrowthOutside1;
            }
        }
    }

    /*===============================================================
     *                        VIEW FUNCTIONS
     *==============================================================*/

    function getFeeGrowthInside(
        Pool storage pool,
        uint8 tierId,
        int24 tickLower,
        int24 tickUpper
    ) external view returns (uint80 feeGrowthInside0, uint80 feeGrowthInside1) {
        return _feeGrowthInside(pool, tierId, tickLower, tickUpper);
    }

    function getSecondsPerLiquidityInside(
        Pool storage pool,
        uint8 tierId,
        int24 tickLower,
        int24 tickUpper
    ) external view returns (uint96 secsPerLiquidityInside) {
        Ticks.Tick storage upper = pool.ticks[tierId][tickUpper];
        Ticks.Tick storage lower = pool.ticks[tierId][tickLower];
        Tiers.Tier storage tier = pool.tiers[tierId];
        int24 tickCurrent = tier.tick;
        unchecked {
            if (tickCurrent < tickLower) {
                // current price below range
                secsPerLiquidityInside = lower.secondsPerLiquidityOutside - upper.secondsPerLiquidityOutside;
            } else if (tickCurrent >= tickUpper) {
                // current price above range
                secsPerLiquidityInside = upper.secondsPerLiquidityOutside - lower.secondsPerLiquidityOutside;
            } else {
                // current price in range
                // calculate latest secondsPerLiquidityCumulative
                uint96 secsPerLiqCum = pool.secondsPerLiquidityCumulative;
                uint32 secs = uint32(block.timestamp) - pool.tickLastUpdate;
                if (secs != 0) {
                    uint256 sumL;
                    for (uint256 i; i < pool.tiers.length; i++) sumL += pool.tiers[i].liquidity;
                    secsPerLiqCum += uint96((uint256(secs) << SECONDS_PER_LIQUIDITY_RESOLUTION) / sumL);
                }
                secsPerLiquidityInside =
                    secsPerLiqCum -
                    upper.secondsPerLiquidityOutside -
                    lower.secondsPerLiquidityOutside;
            }
        }
    }
}
