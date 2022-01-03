// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "./FullMath.sol";
import "./PoolMath.sol";
import "./Math.sol";
import "../Tiers.sol";

library SwapMath {
    using Math for uint256;
    using Math for int256;

    int256 private constant REJECTED = type(int256).max;
    uint256 private constant Q72 = 0x1000000000000000000;
    int256 private constant MAX_UINT_DIV_1E10 = 0x6df37f675ef6eadf5ab9a2072d44268d97df837e6748956e5c6c2117;

    /// @dev calculate the optimized input amount for each tier using lagragian multiplier.
    function calcTierAmtsIn(
        bool isToken0,
        int256 amount,
        Tiers.Tier[] memory tiers,
        uint256 tierChoices
    ) internal pure returns (int256[] memory amts) {
        assert(amount > 0);

        amts = new int256[](tiers.length);
        uint256[] memory lsg = new uint256[](tiers.length); // array of liquidity divided by sqrt gamma (UQ128)
        uint256[] memory res = new uint256[](tiers.length); // array of token reserve divided by gamma (UQ200)
        uint256 num; //    numerator of sqrt lambda (sum of UQ128)
        uint256 denom; //  denominator of sqrt lambda (sum of UQ200 + amount)

        unchecked {
            for (uint256 i; i < tiers.length; i++) {
                // reject unselectd tiers
                if (tierChoices & (1 << i) == 0) {
                    amts[i] = REJECTED;
                    continue;
                }

                // calculate num and denom of sqrt lamdba (lagrange multiplier)
                Tiers.Tier memory t = tiers[i];
                uint256 liquidity = uint256(t.liquidity);
                uint24 sqrtGamma = t.sqrtGamma;
                num += (lsg[i] = UnsafeMath.ceilDiv(liquidity * 1e5, sqrtGamma));
                denom += (res[i] = isToken0
                    ? UnsafeMath.ceilDiv(liquidity * Q72 * 1e10, uint256(t.sqrtPrice) * sqrtGamma * sqrtGamma)
                    : UnsafeMath.ceilDiv(liquidity * t.sqrtPrice, (Q72 * sqrtGamma * sqrtGamma) / 1e10));
            }
        }
        denom += uint256(amount);

        unchecked {
            // calculate input amts, then reject the tiers with negative input amts.
            // repeat until all input amts are non-negative
            bool neverOverflow = (denom * num) / denom == num && denom * num <= uint256(type(int256).max);
            for (uint256 i; i < tiers.length; ) {
                if (amts[i] != REJECTED) {
                    if (
                        (amts[i] = neverOverflow
                            ? int256((denom * lsg[i]) / num).sub(int256(res[i]))
                            : FullMath.mulDiv(denom, lsg[i], num).toInt256().sub(int256(res[i]))) < 0
                    ) {
                        amts[i] = REJECTED;
                        num -= lsg[i];
                        denom -= res[i];
                        i = 0;
                        continue;
                    }
                }
                i++;
            }
        }
    }

    /// @dev calculate the optimized output amount for each tier using lagragian multiplier.
    function calcTierAmtsOut(
        bool isToken0,
        int256 amount,
        Tiers.Tier[] memory tiers,
        uint256 tierChoices
    ) internal pure returns (int256[] memory amts) {
        assert(amount < 0);

        amts = new int256[](tiers.length);
        uint256[] memory lsg = new uint256[](tiers.length); // array of liquidity divided by sqrt fee (UQ128)
        uint256[] memory res = new uint256[](tiers.length); // array of token reserve (UQ200)
        uint256 num; //   numerator of sqrt lambda (sum of UQ128)
        int256 denom; //  denominator of sqrt lambda (sum of UQ200 - amount)

        unchecked {
            for (uint256 i; i < tiers.length; i++) {
                // reject unselectd tiers
                if (tierChoices & (1 << i) == 0) {
                    amts[i] = REJECTED;
                    continue;
                }

                // calculate num and denom of sqrt lamdba (lagrange multiplier)
                Tiers.Tier memory t = tiers[i];
                uint256 liquidity = uint256(t.liquidity);
                num += (lsg[i] = (liquidity * 1e5) / t.sqrtGamma);
                denom += int256(res[i] = isToken0 ? (liquidity << 72) / t.sqrtPrice : (liquidity * t.sqrtPrice) >> 72);
            }
        }
        denom += amount;

        unchecked {
            // calculate output amts, then reject the tiers with positive output amts.
            // repeat until all output amts are non-positive
            for (uint256 i; i < tiers.length; ) {
                if (amts[i] != REJECTED) {
                    if ((amts[i] = _ceilMulDiv(denom, lsg[i], num).sub(int256(res[i]))) > 0) {
                        amts[i] = REJECTED;
                        num -= lsg[i];
                        denom -= int256(res[i]);
                        i = 0;
                        continue;
                    }
                }
                i++;
            }
        }
    }

    function _ceilMulDiv(
        int256 x,
        uint256 y,
        uint256 denom
    ) internal pure returns (int256 z) {
        unchecked {
            z = x < 0
                ? -FullMath.mulDiv(uint256(-x), y, denom).toInt256()
                : FullMath.mulDivRoundingUp(uint256(x), y, denom).toInt256();
        }
    }

    /// @dev Calculate a single swap step. We process the swap as much as possible until the tier's price hits the next tick.
    /// @param isToken0     True if "amount" refers to token0
    /// @param exactIn      True if the swap is specified with an input token amount (instead of an output)
    /// @param amount       The swap amount (positive: token in; negative token out)
    /// @param sqrtP        The sqrt price currently
    /// @param sqrtPTick    The sqrt price of the next crossing tick
    /// @param liquidity    The current liqudity amount
    /// @param sqrtGamma    The sqrt of (1 - percentage swap fee) (precision: 1e5)
    /// @return amtA        The delta of the pool's tokenA balance (tokenA means token0 if `isToken0` is true, vice versa)
    /// @return amtB        The delta of the pool's tokenB balance (tokenB means the opposite token of tokenA)
    /// @return sqrtPNew    The new sqrt price after the swap
    /// @return feeAmt      The fee amount charged for this swap
    function computeStep(
        bool isToken0,
        bool exactIn,
        int256 amount,
        uint128 sqrtP,
        uint128 sqrtPTick,
        uint128 liquidity,
        uint24 sqrtGamma
    )
        internal
        pure
        returns (
            int256 amtA,
            int256 amtB,
            uint128 sqrtPNew,
            uint256 feeAmt
        )
    {
        unchecked {
            amtA = amount;
            int256 amtInExclFee; // i.e. input amt excluding fee

            // calculate amt needed to reach to the tick
            int256 amtTick = isToken0
                ? PoolMath.calcAmt0FromSqrtP(sqrtP, sqrtPTick, liquidity)
                : PoolMath.calcAmt1FromSqrtP(sqrtP, sqrtPTick, liquidity);

            // calculate percentage fee (precision: 1e10)
            uint256 gamma = uint256(sqrtGamma) * sqrtGamma;

            if (exactIn) {
                // amtA: the input amt (positive)
                // amtB: the output amt (negative)

                // calculate input amt excluding fee
                amtInExclFee = amtA < MAX_UINT_DIV_1E10
                    ? int256((uint256(amtA) * gamma) / 1e10)
                    : int256(FullMath.mulDiv(uint256(amtA), gamma, 1e10));

                // check if crossing tick
                if (amtInExclFee < amtTick) {
                    // no cross tick: calculate new sqrt price after swap
                    sqrtPNew = isToken0
                        ? PoolMath.calcSqrtPFromAmt0(sqrtP, liquidity, amtInExclFee)
                        : PoolMath.calcSqrtPFromAmt1(sqrtP, liquidity, amtInExclFee);
                } else {
                    // cross tick: replace new sqrt price and input amt
                    sqrtPNew = sqrtPTick;
                    amtInExclFee = amtTick;

                    // re-calculate input amt _including_ fee
                    amtA = amtInExclFee < MAX_UINT_DIV_1E10
                        ? UnsafeMath.ceilDiv(uint256(amtInExclFee) * 1e10, gamma).toInt256()
                        : FullMath.mulDivRoundingUp(uint256(amtInExclFee), 1e10, gamma).toInt256();
                }

                // calculate output amt
                amtB = isToken0
                    ? PoolMath.calcAmt1FromSqrtP(sqrtP, sqrtPNew, liquidity)
                    : PoolMath.calcAmt0FromSqrtP(sqrtP, sqrtPNew, liquidity);

                // calculate fee amt
                feeAmt = uint256(amtA - amtInExclFee);
            } else {
                // amtA: the output amt (negative)
                // amtB: the input amt (positive)

                // check if crossing tick
                if (amtA > amtTick) {
                    // no cross tick: calculate new sqrt price after swap
                    sqrtPNew = isToken0
                        ? PoolMath.calcSqrtPFromAmt0(sqrtP, liquidity, amtA)
                        : PoolMath.calcSqrtPFromAmt1(sqrtP, liquidity, amtA);
                } else {
                    // cross tick: replace new sqrt price and output amt
                    sqrtPNew = sqrtPTick;
                    amtA = amtTick;
                }

                // calculate input amt excluding fee
                amtInExclFee = isToken0
                    ? PoolMath.calcAmt1FromSqrtP(sqrtP, sqrtPNew, liquidity)
                    : PoolMath.calcAmt0FromSqrtP(sqrtP, sqrtPNew, liquidity);

                // calculate input amt
                amtB = amtInExclFee < MAX_UINT_DIV_1E10
                    ? UnsafeMath.ceilDiv(uint256(amtInExclFee) * 1e10, gamma).toInt256()
                    : FullMath.mulDivRoundingUp(uint256(amtInExclFee), 1e10, gamma).toInt256();

                // calculate fee amt
                feeAmt = uint256(amtB - amtInExclFee);
            }

            // reject tier if zero input amt and not crossing tick
            if (amtInExclFee == 0 && sqrtPNew != sqrtPTick) {
                amtA = REJECTED;
                amtB = 0;
                sqrtPNew = sqrtP;
                feeAmt = 0;
            }
        }
    }
}