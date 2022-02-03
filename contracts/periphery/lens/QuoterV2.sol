// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.10;

import "../../interfaces/hub/IMuffinHub.sol";
import "../../libraries/utils/PathLib.sol";
import "../../libraries/Pools.sol";
import "../../MuffinHub.sol";
import "./Quoter.sol";

contract QuoterV2 is Quoter {
    using PathLib for bytes;

    constructor(address _hub) Quoter(_hub) {}

    struct Hop {
        uint256 amountIn;
        uint256 amountOut;
        uint256 protocolFeeAmt;
        uint256[] tierAmountsIn;
        uint256[] tierData;
    }

    function simulateSingle(
        address tokenIn,
        address tokenOut,
        uint256 tierChoices,
        int256 amountDesired
    ) external view returns (Hop memory hop) {
        bytes32 poolId = tokenIn < tokenOut
            ? keccak256(abi.encode(tokenIn, tokenOut))
            : keccak256(abi.encode(tokenOut, tokenIn));
        return _swap(poolId, (amountDesired > 0) == (tokenIn < tokenOut), amountDesired, tierChoices);
    }

    function simulate(bytes calldata path, int256 amountDesired)
        external
        view
        returns (
            uint256 amountIn,
            uint256 amountOut,
            Hop[] memory hops
        )
    {
        if (path.invalid()) revert MuffinHub.InvalidSwapPath();

        bool exactIn = amountDesired > 0;
        bytes32[] memory poolIds = new bytes32[](path.hopCount());
        hops = new Hop[](poolIds.length);

        unchecked {
            int256 amtDesired = amountDesired;
            for (uint256 i; i < poolIds.length; i++) {
                (address tokenIn, address tokenOut, uint256 tierChoices) = path.decodePool(i, exactIn);

                poolIds[i] = tokenIn < tokenOut
                    ? keccak256(abi.encode(tokenIn, tokenOut))
                    : keccak256(abi.encode(tokenOut, tokenIn));

                // For an "exact output" swap, it's possible to not receive the full desired output amount. therefore, in
                // the 2nd (and following) swaps, we request more token output so as to ensure we get enough tokens to pay
                // for the previous swa The extra token is not refunded and thus results in a very small extra cost.
                hops[i] = _swap(
                    poolIds[i],
                    (amtDesired > 0) == (tokenIn < tokenOut),
                    (exactIn || i == 0) ? amtDesired : amtDesired - Pools.SWAP_AMOUNT_TOLERANCE,
                    tierChoices
                );
                (uint256 amtIn, uint256 amtOut) = (hops[i].amountIn, hops[i].amountOut);

                if (exactIn) {
                    if (i == 0) amountIn = amtIn;
                    amtDesired = int256(amtOut);
                } else {
                    if (i == 0) amountOut = amtOut;
                    else if (amtOut < uint256(-amtDesired)) revert MuffinHub.NotEnoughIntermediateOutput();
                    amtDesired = -int256(amtIn);
                }
            }
            if (exactIn) {
                amountOut = uint256(amtDesired);
            } else {
                amountIn = uint256(-amtDesired);
            }
        }
        // emulate pool locks
        require(!QuickSort.sortAndHasDuplicate(poolIds), "POOL_REPEATED");
    }

    ////////////////////////////////////////////////////////////////////////

    uint256 internal constant MAX_TIERS = 6;
    int256 internal constant REJECTED = type(int256).max;

    function _swap(
        bytes32 poolId,
        bool isToken0,
        int256 amtDesired,
        uint256 tierChoices
    ) internal view returns (Hop memory hop) {
        int256 amountA;
        int256 amountB;

        Tiers.Tier[] memory tiers = hub.getAllTiers(poolId);
        Pools.TierState[MAX_TIERS] memory states;

        unchecked {
            if (amtDesired == 0 || amtDesired == REJECTED) revert Pools.InvalidAmount();
            if (tierChoices > 0x3F || tierChoices & ((1 << tiers.length) - 1) == 0) revert Pools.InvalidTierChoices();
        }

        Pools.SwapCache memory cache = Pools.SwapCache({
            zeroForOne: isToken0 == (amtDesired > 0),
            exactIn: amtDesired > 0,
            protocolFee: 0,
            protocolFeeAmt: 0,
            priceBoundReached: 0,
            tmCache: TickMath.Cache({tick: type(int24).max, sqrtP: 0}),
            amounts: [int256(0), 0, 0, 0, 0, 0]
        });
        (, cache.protocolFee) = hub.getPoolParameters(poolId);

        while (true) {
            // calculate the swap amount for each tier
            cache.amounts = amtDesired > 0
                ? SwapMath.calcTierAmtsIn(tiers, isToken0, amtDesired - amountA, tierChoices)
                : SwapMath.calcTierAmtsOut(tiers, isToken0, amtDesired - amountA, tierChoices);

            // compute the swap for each tier
            for (uint256 i; i < tiers.length; i++) {
                (int256 amtAStep, int256 amtBStep) = _swapStep(poolId, isToken0, cache, states[i], tiers[i], i);
                amountA += amtAStep;
                amountB += amtBStep;
            }

            // check if we meet the stopping criteria
            int256 amtRemaining = amtDesired - amountA;
            unchecked {
                if (
                    (
                        amtDesired > 0
                            ? amtRemaining <= Pools.SWAP_AMOUNT_TOLERANCE
                            : amtRemaining >= -Pools.SWAP_AMOUNT_TOLERANCE
                    ) || cache.priceBoundReached == tierChoices & ((1 << tiers.length) - 1)
                ) break;
            }
        }

        hop.protocolFeeAmt = cache.protocolFeeAmt;
        (hop.tierAmountsIn, hop.tierData) = _computeTicksAndRelevantData(
            states,
            tiers,
            uint256(amtDesired > 0 ? amountA : amountB)
        );
        (hop.amountIn, hop.amountOut) = amtDesired > 0
            ? (uint256(amountA), uint256(-amountB))
            : (uint256(amountB), uint256(-amountA));
    }

    function _swapStep(
        bytes32 poolId,
        bool isToken0,
        Pools.SwapCache memory cache,
        Pools.TierState memory state,
        Tiers.Tier memory tier,
        uint256 tierId
    ) internal view returns (int256 amtAStep, int256 amtBStep) {
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
            uint80 feeGrowth = uint80((feeAmtStep << 64) / tier.liquidity);
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
            Ticks.Tick memory cross = hub.getTick(poolId, uint8(tierId), tickCross);
            // cross.flip(tier.feeGrowthGlobal0, tier.feeGrowthGlobal1, pool.secondsPerLiquidityCumulative);
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

            // // settle single-sided positions (i.e. filled limit orders) if neccessary
            // if (cache.zeroForOne ? cross.needSettle0 : cross.needSettle1)
            //     Settlement.settle(
            //         pool.settlements[tierId],
            //         pool.ticks[tierId],
            //         pool.tickMaps[tierId],
            //         tier,
            //         tickCross,
            //         cache.zeroForOne
            //     );
        }
    }

    function _computeTicksAndRelevantData(
        Pools.TierState[MAX_TIERS] memory states,
        Tiers.Tier[] memory tiers,
        uint256 amountIn
    ) internal pure returns (uint256[] memory tierAmountsIn, uint256[] memory tierData) {
        tierData = new uint256[](tiers.length);
        tierAmountsIn = new uint256[](tiers.length);
        unchecked {
            for (uint8 i; i < tiers.length; i++) {
                Pools.TierState memory state = states[i];
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

                    // pool.tiers[i] = tier;

                    // prepare data for logging
                    tierData[i] = (uint256(tier.sqrtPrice) << 128) | tier.liquidity;
                    if (amountIn > 0) {
                        tierAmountsIn[i] = state.amountIn;
                    }
                }
            }
        }
    }
}

/// @dev https://gist.github.com/subhodi/b3b86cc13ad2636420963e692a4d896f
library QuickSort {
    function sortAndHasDuplicate(bytes32[] memory data) internal pure returns (bool) {
        unchecked {
            sort(data);
            for (uint256 i = 1; i < data.length; i++) if (data[i - 1] == data[i]) return true;
            return false;
        }
    }

    function sort(bytes32[] memory data) internal pure {
        unchecked {
            require(data.length > 0);
            require(data.length <= uint256(type(int256).max));
            _quickSort(data, int256(0), int256(data.length - 1));
        }
    }

    function _quickSort(
        bytes32[] memory arr,
        int256 left,
        int256 right
    ) internal pure {
        unchecked {
            int256 i = left;
            int256 j = right;
            if (i == j) return;
            bytes32 pivot = arr[uint256(left + (right - left) / 2)];
            while (i <= j) {
                while (arr[uint256(i)] < pivot) i++;
                while (pivot < arr[uint256(j)]) j--;
                if (i <= j) {
                    (arr[uint256(i)], arr[uint256(j)]) = (arr[uint256(j)], arr[uint256(i)]);
                    i++;
                    j--;
                }
            }
            if (left < j) _quickSort(arr, left, j);
            if (i < right) _quickSort(arr, i, right);
        }
    }
}
