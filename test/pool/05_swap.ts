import { expect } from 'chai';
import { BigNumber, BigNumberish, constants } from 'ethers';
import { waffle } from 'hardhat';
import { MockPool } from '../../typechain';
import { MAX_SQRT_P, MAX_TICK, MAX_TIERS, MAX_TIER_CHOICES, MIN_SQRT_P, MIN_TICK } from '../shared/constants';
import { poolTestFixture } from '../shared/fixtures';
import { Awaited, bn, getEvent, getLatestBlockTimestamp, setNextBlockTimestamp, sliceBits, wad } from '../shared/utils';

const Q72 = bn(1).shl(72);
const MaxInt96 = bn(1).shl(95).sub(1);

describe('pool swap', () => {
  let pool: MockPool;

  beforeEach(async () => {
    ({ pool } = await waffle.loadFixture(poolTestFixture));
  });

  const initialize = async (sqrtGamma: number, sqrtPrice: BigNumber) => {
    await pool.initialize(sqrtGamma, sqrtPrice, 1, 25);
    if (sqrtPrice == Q72) {
      expect(await pool.reserve0()).eq(25600);
      expect(await pool.reserve1()).eq(25600);
    }
  };

  const updateLiquidity = async (tierId: number, tickLower: number, tickUpper: number, liquidityDeltaD8: BigNumberish) => {
    return await pool.updateLiquidity(pool.address, 1, tierId, tickLower, tickUpper, liquidityDeltaD8, false);
  };

  describe('test swap stops when reaching end tick', () => {
    beforeEach(async () => {
      await initialize(99850, Q72);
      await pool.addTier(99975);
      expect(await pool.reserve0()).eq(51200);
      expect(await pool.reserve1()).eq(51200);
    });

    const testMinTick = async (fn: () => Promise<any>) => {
      const tx1 = await fn();
      const tx2 = await fn();

      // test big swap
      const event = await getEvent(tx1, pool, 'SwapReturns');
      expect(event.amount0).eq(bn('3695648824284043477764')); // (~3696 wad)
      expect(event.amount1).eq(-51198);
      for (const i of [0, 1]) {
        const tier = await pool.getTier(i);
        expect(tier.tick).eq(MIN_TICK);
        expect(tier.sqrtPrice).eq(MIN_SQRT_P);
      }

      // test another swap after reaching end tick
      const event2 = await getEvent(tx2, pool, 'SwapReturns');
      expect(event2.amount0).eq(0);
      expect(event2.amount1).eq(0);
      for (const i of [0, 1]) {
        const tier = await pool.getTier(i);
        expect(tier.tick).eq(MIN_TICK);
        expect(tier.sqrtPrice).eq(MIN_SQRT_P);
      }
    };

    const testMaxTick = async (fn: () => Promise<any>) => {
      const tx1 = await fn();
      const tx2 = await fn();

      // test big swap
      const event = await getEvent(tx1, pool, 'SwapReturns');
      expect(event.amount0).eq(-51198);
      expect(event.amount1).eq(bn('3695696446154976895833')); // (~3696 wad)
      for (const i of [0, 1]) {
        const tier = await pool.getTier(i);
        expect(tier.tick).eq(MAX_TICK - 1); // never reached MAX_TICK
        expect(tier.sqrtPrice).eq(MAX_SQRT_P);
      }

      // test another swap after reaching end tick
      const event2 = await getEvent(tx2, pool, 'SwapReturns');
      expect(event2.amount0).eq(0);
      expect(event2.amount1).eq(0);
      for (const i of [0, 1]) {
        const tier = await pool.getTier(i);
        expect(tier.tick).eq(MAX_TICK - 1); // never reached MAX_TICK
        expect(tier.sqrtPrice).eq(MAX_SQRT_P);
      }
    };

    it('min tick; exact input', async () => {
      await testMinTick(() => pool.swap(true, wad(5000), MAX_TIER_CHOICES));
    });

    it('min tick; exact output', async () => {
      await testMinTick(() => pool.swap(false, wad(-5000), MAX_TIER_CHOICES));
    });

    it('max tick; exact input', async () => {
      await testMaxTick(() => pool.swap(false, wad(5000), MAX_TIER_CHOICES));
    });

    it('max tick; exact output', async () => {
      await testMaxTick(() => pool.swap(true, wad(-5000), MAX_TIER_CHOICES));
    });
  });

  describe('test very small swap', () => {
    const run = async (isToken: boolean, amountDesired: number, expectedAmounts: [BigNumberish, BigNumberish]) => {
      const tx = await pool.swap(isToken, amountDesired, MAX_TIER_CHOICES);
      const event = await getEvent(tx, pool, 'SwapReturns');
      expect(event.amount0).eq(expectedAmounts[0]);
      expect(event.amount1).eq(expectedAmounts[1]);
    };

    context('token0 exact input', () => {
      beforeEach(async () => {
        await initialize(99850, Q72);
      });

      it('zero amount0 in; reverted', async () => {
        await expect(pool.swap(true, 0, 0x3f)).to.be.revertedWith('InvalidAmount()');
      });

      it('small amount0 in; being treated as zero', async () => {
        await run(true, 1, [0, 0]);
      });

      it('small amount0 in; zero output', async () => {
        await run(true, 2, [2, 0]);
      });

      it('small amount0 in; has output', async () => {
        await run(true, 3, [3, -1]);
      });
    });

    context('token1 exact input', () => {
      beforeEach(async () => {
        await initialize(99850, Q72);
      });

      it('zero amount0 in; reverted', async () => {
        await expect(pool.swap(false, 0, 0x3f)).to.be.revertedWith('InvalidAmount()');
      });

      it('small amount0 in; being treated as zero', async () => {
        await run(false, 1, [0, 0]);
      });

      it('small amount0 in; zero output', async () => {
        await run(false, 2, [0, 2]);
      });

      it('small amount0 in; has output', async () => {
        await run(false, 3, [-1, 3]);
      });
    });

    context('token0 exact output', () => {
      it('small amount0 out', async () => {
        await initialize(99850, bn(1).shl(17)); // token0 very low price
        await run(true, -1, [-1, 2]);
      });

      it('small amount0 out; treated as zero output + large input', async () => {
        await initialize(99850, bn(1).shl(120)); // token0 very high price
        await run(true, -1, [0, '1842932629887344048441']);
      });
    });

    context('token1 exact output', () => {
      it('small amount1 out', async () => {
        await initialize(99850, bn(1).shl(120)); // token0 very high price
        await run(false, -1, [2, -1]);
      });

      it('small amount1 out; treated as zero output + large input', async () => {
        await initialize(99850, bn(1).shl(17)); // token0 very low price
        await run(false, -1, ['925025761032894370399', 0]);
      });
    });
  });

  describe('test max swap amount', () => {
    beforeEach(async () => {
      await initialize(99850, Q72);
      await pool.addTier(99975);
    });

    context('exact input', () => {
      beforeEach('add more liquidity', async () => {
        await updateLiquidity(0, -30000, 30000, MaxInt96);
        await updateLiquidity(1, -30000, 30000, MaxInt96);
      });

      it('max amount0 in', async () => {
        await pool.swap(true, constants.MaxInt256.sub(1), MAX_TIER_CHOICES);
      });

      it('max amount1 in', async () => {
        await pool.swap(false, constants.MaxInt256.sub(1), MAX_TIER_CHOICES);
      });
    });

    context('exact output', () => {
      it('max amount0 out', async () => {
        await pool.swap(true, constants.MinInt256, MAX_TIER_CHOICES);
      });

      it('max amount1 out', async () => {
        await pool.swap(true, constants.MinInt256, MAX_TIER_CHOICES);
      });
    });
  });

  describe('extreme liquidity + extreme sqrt price', () => {
    /**
     * Test cases here are to acknowledge that in some extreme situation the swap can be reverted with
     * overflow or underflow. However, such condition are rare or almost impossible to happen in reality.
     */

    it('low sqrt price + large liquidity + token0 in', async () => {
      await initialize(99850, MIN_SQRT_P);
      await updateLiquidity(0, MIN_TICK, 0, MaxInt96);

      // if res + amt > constants.MaxInt256, tx overflows and reverts
      const tier = await pool.getTier(0);
      const reserve = tier.liquidity
        .mul(Q72.mul(1e10))
        .div(tier.sqrtPrice.mul(99850 * 99850))
        .add(1);
      const amt = constants.MaxInt256.sub(reserve);
      const badAmt = constants.MaxInt256.sub(reserve).add(1);
      expect(badAmt).gt(bn(1).shl(254));

      await expect(pool.swap(true, badAmt, 0x3f)).to.be.reverted;
      await pool.swap(true, amt, 0x3f);
    });

    it('high sqrt price + large liquidity + token1 in', async () => {
      await initialize(99850, MAX_SQRT_P);
      await updateLiquidity(0, 0, MAX_TICK, MaxInt96);

      // if res + amt > constants.MaxInt256, tx overflows and reverts
      const tier = await pool.getTier(0);
      const reserve = tier.liquidity
        .mul(tier.sqrtPrice)
        .div(Q72.mul(99850 * 99850).div(1e10))
        .add(1);
      const amt = constants.MaxInt256.sub(reserve);
      const badAmt = constants.MaxInt256.sub(reserve).add(1);
      expect(badAmt).gt(bn(1).shl(254));

      await expect(pool.swap(false, badAmt, MAX_TIER_CHOICES)).to.be.reverted;
      await pool.swap(false, amt, MAX_TIER_CHOICES);
    });
  });

  it('empty tier choices', async () => {
    await initialize(99850, Q72);
    await expect(pool.swap(true, 100, 0)).to.be.revertedWith('InvalidTierChoices');
    await expect(pool.swap(true, 100, MAX_TIER_CHOICES ^ 0b1)).to.be.revertedWith('InvalidTierChoices');
    await pool.swap(true, 100, 0b000001);
  });

  describe('test with prepared numbers', () => {
    context('single tier', () => {
      context('no cross tick', () => {
        beforeEach(async () => {
          await initialize(99850, Q72);
        });

        it('token0 exact input', async () => {
          await test(pool, true, 10000, -7175, [30], [bn('3398723136391985309830')], [false], [[-776363, 776363]]);
        });

        it('token1 exact input', async () => {
          await test(pool, false, 10000, -7175, [30], [bn('6561506867018487509811')], [false], [[-776363, 776363]]);
        });

        it('token0 exact output', async () => {
          await test(pool, true, -10000, 16461, [50], [bn('7749524484709161376322')], [false], [[-776363, 776363]]);
        });

        it('token1 exact output', async () => {
          await test(pool, false, -10000, 16461, [50], [bn('2877692075498690052096')], [false], [[-776363, 776363]]);
        });
      });

      context('cross tick', () => {
        beforeEach(async () => {
          await initialize(99850, Q72);
          await updateLiquidity(0, -300, 300, 400000);
          await updateLiquidity(0, -3000, 3000, 400000);
        });

        it('token0 exact input', async () => {
          await test(pool, true, 10000000, -9307017, [29979], [bn('4363549126638796369671')], [true], [[-3000, -300]]);
        });

        it('token1 exact input', async () => {
          await test(pool, false, 10000000, -9307017, [29979], [bn('5110689613275579556307')], [true], [[300, 3000]]);
        });

        it('token0 exact output', async () => {
          await test(pool, true, -10000000, 10820082, [32437], [bn('5148386435298012486870')], [true], [[300, 3000]]);
        });

        it('token1 exact output', async () => {
          await test(pool, false, -10000000, 10820082, [32437], [bn('4331598934694138314210')], [true], [[-3000, -300]]);
        });
      });

      context('cross two ticks', () => {
        beforeEach(async () => {
          await initialize(99850, Q72);
          await updateLiquidity(0, -300, 300, 400000);
          await updateLiquidity(0, -3000, 3000, 400000);
        });

        it('token0 exact input', async () => {
          await test(
            pool,
            true,
            18177069 + 10000,
            -15796400,
            [54522],
            [bn('3044253451861908254066')],
            [true],
            [[MIN_TICK, -3000]],
          );
        });

        it('token1 exact input', async () => {
          await test(
            pool,
            false,
            18177069 + 10000,
            -15796400,
            [54522],
            [bn('7325521856562624091456')],
            [true],
            [[3000, MAX_TICK]],
          );
        });
      });
    });

    context('three tier', () => {
      beforeEach(async () => {
        await initialize(99850, Q72);
        await pool.addTier(99925);
        await pool.addTier(99975);

        await updateLiquidity(0, -30000, 30000, 400000);
        await updateLiquidity(1, -3000, 3000, 400000);
        await updateLiquidity(2, -300, 300, 400000);
      });

      it('token0 exact input', async () => {
        await test(
          pool,
          true,
          100000000,
          -61217857,
          [245262, 24916, 786],
          [bn('2628823296289747938935'), bn('2626858499598754174855'), bn('2625538283089573615893')],
          [false, true, true],
          [
            [-30000, 30000],
            [-776363, -3000],
            [-776363, -300],
          ],
        );
      });

      it('token1 exact input', async () => {
        await test(
          pool,
          false,
          100000000,
          -61217857,
          [245262, 24916, 786],
          [bn('8483166301061508544304'), bn('8489511407613696798425'), bn('8493780243908103979644')],
          [false, true, true],
          [
            [-30000, 30000],
            [3000, 776363],
            [300, 776363],
          ],
        );
      });

      it('token0 exact output', async () => {
        await test(
          pool,
          true,
          -50000000,
          69657934,
          [154349, 24905, 782],
          [bn('7089125131966278379183'), bn('7094098270720924913928'), bn('7097598852843307485787')],
          [false, true, true],
          [
            [-30000, 30000],
            [3000, 776363],
            [300, 776363],
          ],
        );
      });

      it('token1 exact output', async () => {
        await test(
          pool,
          false,
          -50000000,
          69657934,
          [154349, 24905, 782],
          [bn('3145768311800862079595'), bn('3143563050228841870854'), bn('3142012624395772258412')],
          [false, true, true],
          [
            [-30000, 30000],
            [-776363, -3000],
            [-776363, -300],
          ],
        );
      });
    });

    context('three tiers, select one tier only', () => {
      beforeEach(async () => {
        await initialize(99850, Q72);
        await pool.addTier(99925);
        await pool.addTier(99975);
      });

      it('token0 exact input', async () => {
        await test(
          pool,
          true,
          10000,
          -7175,
          [30, 0, 0],
          [bn('3398723136391985309830'), Q72, Q72],
          [false, false, false],
          [
            [-776363, 776363],
            [-776363, 776363],
            [-776363, 776363],
          ],
          0b000001,
        );
      });

      it('token1 exact input', async () => {
        await test(
          pool,
          false,
          10000,
          -7175,
          [30, 0, 0],
          [bn('6561506867018487509811'), Q72, Q72],
          [false, false, false],
          [
            [-776363, 776363],
            [-776363, 776363],
            [-776363, 776363],
          ],
          0b000001,
        );
      });

      it('token0 exact output', async () => {
        await test(
          pool,
          true,
          -10000,
          16461,
          [50, 0, 0],
          [bn('7749524484709161376322'), Q72, Q72],
          [false, false, false],
          [
            [-776363, 776363],
            [-776363, 776363],
            [-776363, 776363],
          ],
          0b000001,
        );
      });

      it('token1 exact output', async () => {
        await test(
          pool,
          false,
          -10000,
          16461,
          [50, 0, 0],
          [bn('2877692075498690052096'), Q72, Q72],
          [false, false, false],
          [
            [-776363, 776363],
            [-776363, 776363],
            [-776363, 776363],
          ],
          0b000001,
        );
      });
    });
  });
});

const test = async (
  pool: MockPool,
  isToken0: boolean,
  amtDesired: number,
  expectedAmtOutcome: BigNumberish,
  expectedFeeAmts: BigNumberish[],
  expectedTierSqrtPrices: BigNumberish[],
  expectedToCross: boolean[],
  expectedNextTicks: [number, number][],
  tierChoices: number = MAX_TIER_CHOICES,
) => {
  // load states before state change
  const token0In = isToken0 == amtDesired >= 0;
  const tiersBefore = await pool.getAllTiers();
  const poolStateBefore = await pool.pool();

  // the variable name is vague, but it is used for calculating fee amounts from tick states
  const relatedTickArrsBefore = await Promise.all(
    expectedNextTicks.map((nextTicks, i) =>
      expectedToCross[i] ? getPreviousTickToEndTick(pool, token0In, i, tiersBefore[i], nextTicks[token0In ? 0 : 1]) : [],
    ),
  );

  // set timestamp of next block
  const timestamp = (await getLatestBlockTimestamp()) + 10000;
  await setNextBlockTimestamp(timestamp);

  // perform swap
  const tx = await pool.swap(isToken0, amtDesired, tierChoices);

  // check swap amount0 and amount1
  const event = await getEvent(tx, pool, 'SwapReturns');
  const amt0 = event.amount0 as BigNumber;
  const amt1 = event.amount1 as BigNumber;
  const [amtA, amtB] = isToken0 ? [amt0, amt1] : [amt1, amt0];
  const TOLERANCE = 10;
  if (amtDesired >= 0) {
    expect(amtA).gte(0);
    expect(amtA).gte(Math.max(0, amtDesired - TOLERANCE));
    expect(amtA).lte(amtDesired);
  } else {
    expect(amtA).lt(0);
    expect(amtA).lte(Math.min(0, amtDesired + TOLERANCE));
    expect(amtA).gte(amtDesired);
  }
  expect(amtB).eq(expectedAmtOutcome);

  // check tierData and {input,ouput} amount distribution
  const amtDistBits = Math.floor(256 / MAX_TIERS);
  const amtDistONE = bn(1).shl(amtDistBits - 1);
  for (const [i, tierData] of event.tierData.entries()) {
    const amtInPercent = sliceBits(event.amountInDistribution, i * amtDistBits, amtDistBits);
    const amtOutPercent = sliceBits(event.amountOutDistribution, i * amtDistBits, amtDistBits);
    // fee amt is expected to be zero iff the tier is expected to be rejected in the swap
    if (expectedFeeAmts[i] === 0) {
      expect(amtInPercent).eq(0);
      expect(amtOutPercent).eq(0);
      expect(tierData).eq(0);
    } else {
      expect(amtInPercent).gt(0).and.lte(amtDistONE);
      expect(amtOutPercent).gt(0).and.lte(amtDistONE);
      expect(sliceBits(tierData, 0, 128)).eq((await pool.getTier(i)).liquidity);
      expect(sliceBits(tierData, 128, 128)).eq(expectedTierSqrtPrices[i]);
    }
  }

  // check sum of all {input,ouput} amount percentages ≈ 1
  let totalPercentAmtIn = bn(0);
  let totalPercentAmtOut = bn(0);
  for (let i = 0; i < MAX_TIERS; i++) {
    totalPercentAmtIn = totalPercentAmtIn.add(sliceBits(event.amountInDistribution, i * amtDistBits, amtDistBits));
    totalPercentAmtOut = totalPercentAmtOut.add(sliceBits(event.amountOutDistribution, i * amtDistBits, amtDistBits));
  }
  expect(totalPercentAmtIn).lte(amtDistONE).and.gte(amtDistONE.sub(MAX_TIERS)); // max rounding error
  expect(totalPercentAmtOut).lte(amtDistONE).and.gte(amtDistONE.sub(MAX_TIERS)); // max rounding error

  // check fee growth global changes
  const tiers = await pool.getAllTiers();
  for (const [i, expectedFeeAmt] of expectedFeeAmts.entries()) {
    const fgg0Before = tiersBefore[i].feeGrowthGlobal0;
    const fgg1Before = tiersBefore[i].feeGrowthGlobal1;
    const fgg0 = tiers[i].feeGrowthGlobal0;
    const fgg1 = tiers[i].feeGrowthGlobal1;
    if (expectedFeeAmt == 0) {
      expect(fgg0).eq(fgg0Before);
      expect(fgg1).eq(fgg1Before);
    } else {
      if (token0In) {
        expect(fgg0).gt(fgg0Before); // assume no overflow
        expect(fgg1).eq(fgg1Before);
      } else {
        expect(fgg0).eq(fgg0Before);
        expect(fgg1).gt(fgg1Before); // assume no overflow
      }
    }
  }

  // check tier states
  for (const [i, tier] of tiers.entries()) {
    const tierBefore = tiersBefore[i];

    // check sqrt price after swap
    expect(tier.sqrtPrice).eq(expectedTierSqrtPrices[i]);

    if (expectedToCross[i]) {
      // check liquidity change
      expect(tier.liquidity).not.eq(tierBefore.liquidity);

      // check next ticks change
      expect(tier.nextTickBelow).eq(expectedNextTicks[i][0]);
      expect(tier.nextTickAbove).eq(expectedNextTicks[i][1]);

      // check the direction of next ticks change
      if (token0In) {
        // price goes down
        expect(tier.nextTickBelow).lt(tierBefore.nextTickBelow);
        expect(tier.nextTickAbove).lt(tierBefore.nextTickAbove);
      } else {
        // price goes up
        expect(tier.nextTickBelow).gt(tierBefore.nextTickBelow);
        expect(tier.nextTickAbove).gt(tierBefore.nextTickAbove);
      }
    } else {
      // check data unchanged
      expect(tier.liquidity).eq(tierBefore.liquidity);
      expect(tier.nextTickBelow).eq(tierBefore.nextTickBelow);
      expect(tier.nextTickAbove).eq(tierBefore.nextTickAbove);
    }
  }

  // check fee amount from tier states
  const relatedTickArrs = await Promise.all(
    expectedNextTicks.map((nextTicks, i) =>
      expectedToCross[i] ? getPreviousTickToEndTick(pool, token0In, i, tiersBefore[i], nextTicks[token0In ? 0 : 1]) : [],
    ),
  );
  for (const [i, tier] of tiers.entries()) {
    if (!expectedToCross[i]) continue;

    const tierBefore = tiersBefore[i];
    const feeAmtAccruedByLPs = await getFeeAmtFromTickStates(
      pool,
      token0In,
      i,
      relatedTickArrsBefore[i].slice().reverse(),
      relatedTickArrs[i].slice().reverse(),
      token0In ? tierBefore.feeGrowthGlobal0 : tierBefore.feeGrowthGlobal1,
      token0In ? tier.feeGrowthGlobal0 : tier.feeGrowthGlobal1,
    );
    const protocolFee = (await pool.pool()).protocolFee;
    const feeAmt = feeAmtAccruedByLPs.mul(255).div(255 - protocolFee); // protocol fee
    const roundingErrorTolerance = relatedTickArrs[i].length - 1;
    expect(feeAmt).closeTo(bn(expectedFeeAmts[i]), roundingErrorTolerance);
  }
};

///////////////

type Tier = Awaited<ReturnType<MockPool['functions']['getTier']>>[0];
type Tick = Awaited<ReturnType<MockPool['functions']['getTick']>>[0];

/**
 * Get ticks from start tick to end tick
 */
const getTicks = async (pool: MockPool, tierId: number, startTick: number, endTick: number) => {
  const ticks = [];
  const priceDown = endTick < startTick;
  let nextTick = startTick;
  while (true) {
    const tick = await pool.getTick(tierId, nextTick);
    ticks.push(tick);
    if (nextTick == endTick) break;
    if (!(priceDown ? nextTick > endTick : nextTick < endTick)) throw new Error('moved past end tick');
    nextTick = priceDown ? tick.nextBelow : tick.nextAbove;
  }
  return ticks;
};

/**
 * Get ticks being crossed when the tier goes from "current tick" to the "expected next tick"
 *
 *  expected_next_tick                           current_tick
 *          ↓                                          ↓
 * ---------●------------+----------+-----------+------●------+------->
 *       ticks[4]    ticks[3]    ticks[2]    ticks[1]    ticks[0]
 *
 * "ticks" here is the return value.
 */
const getPreviousTickToEndTick = async (pool: MockPool, token0In: boolean, tierId: number, tierBefore: Tier, endTick: number) => {
  const nextTick = token0In ? tierBefore.nextTickBelow : tierBefore.nextTickAbove;
  const nextTickObj = await pool.getTick(tierId, nextTick);
  const prevTick = token0In ? nextTickObj.nextAbove : nextTickObj.nextBelow;
  return await getTicks(pool, tierId, prevTick, endTick);
};

/**
 * Calculate the amount of fees accrued inside the given ticks,
 * assuming the tier is just swapped to move from "prev_tick" to "current_tick"
 *
 *         current_tick                         prev_tick
 *              ↓                                   ↓
 * -------+-----●-------+----------+----------+-----●------+------->  ticks
 *     ticks[0]        [1]        [2]        [3]        ticks[4]
 *
 * We calculate the feeGrowths inside each tick before and after the trade, and also calculate
 * the liquidity inside each tick, to calculate the total fee amount just accrued.
 */
const getFeeAmtFromTickStates = async (
  pool: MockPool,
  token0In: boolean,
  tierId: number,
  before: Tick[],
  after: Tick[],
  feeGrowthGlobalBefore: BigNumber,
  feeGrowthGlobal: BigNumber,
) => {
  let totalFeeAmt = bn(0);
  let liquidity = (await pool.getTier(tierId)).liquidity;
  const len = before.length;

  for (let i = 0; i < len - 1; i++) {
    let feeGrowthInsideBefore: BigNumber;
    let feeGrowthInsideAfter: BigNumber;

    if (token0In) {
      feeGrowthInsideBefore =
        i == len - 2
          ? feeGrowthGlobalBefore.sub(before[i].feeGrowthOutside0).sub(before[i + 1].feeGrowthOutside0)
          : before[i + 1].feeGrowthOutside0.sub(before[i].feeGrowthOutside0);
      feeGrowthInsideAfter =
        i == 0
          ? feeGrowthGlobal.sub(after[i].feeGrowthOutside0).sub(after[i + 1].feeGrowthOutside0)
          : after[i].feeGrowthOutside0.sub(after[i + 1].feeGrowthOutside0);
    } else {
      feeGrowthInsideBefore =
        i == len - 2
          ? feeGrowthGlobalBefore.sub(before[i].feeGrowthOutside1).sub(before[i + 1].feeGrowthOutside1)
          : before[i + 1].feeGrowthOutside1.sub(before[i].feeGrowthOutside1);
      feeGrowthInsideAfter =
        i == 0
          ? feeGrowthGlobal.sub(after[i].feeGrowthOutside1).sub(after[i + 1].feeGrowthOutside1)
          : after[i].feeGrowthOutside1.sub(after[i + 1].feeGrowthOutside1);
    }

    const FEE_GROWTH_PRECISION = bn(1).shl(64);
    const feeAmt = feeGrowthInsideAfter.sub(feeGrowthInsideBefore).mul(liquidity).div(FEE_GROWTH_PRECISION);
    totalFeeAmt = totalFeeAmt.add(feeAmt);
    if (token0In) {
      liquidity = liquidity.add(after[i + 1].liquidityLowerD8.shl(8)).sub(after[i + 1].liquidityUpperD8.shl(8));
    } else {
      liquidity = liquidity.add(after[i + 1].liquidityUpperD8.shl(8)).sub(after[i + 1].liquidityLowerD8.shl(8));
    }
  }

  return totalFeeAmt;
};
