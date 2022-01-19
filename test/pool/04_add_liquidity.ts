import { expect } from 'chai';
import { BigNumber, BigNumberish } from 'ethers';
import { waffle } from 'hardhat';
import { MockPool } from '../../typechain';
import { MAX_TICK, MIN_TICK } from '../shared/constants';
import { poolTestFixture } from '../shared/fixtures';
import { bn, getEvent, getLatestBlockTimestamp, setNextBlockTimestamp } from '../shared/utils';

describe('pool add liquidity', () => {
  let pool: MockPool;

  beforeEach(async () => {
    ({ pool } = await waffle.loadFixture(poolTestFixture));
    await pool.initialize(99850, bn(1).shl(72), 1, 25);
    await pool.prepareUpdateLiquidity();
    expect((await pool.getTier(0)).tick).eq(0);
  });

  const updateLiquidity = async (
    tickLower: number,
    tickUpper: number,
    liquidityDeltaD8: BigNumberish,
    collectAllFees: boolean,
  ) => {
    return await pool.updateLiquidity(pool.address, 1, 0, tickLower, tickUpper, liquidityDeltaD8, collectAllFees);
  };

  it('invalid tick inputs', async () => {
    await expect(updateLiquidity(0, 0, 1, false)).to.be.reverted; // lower tick == upper tick
    await expect(updateLiquidity(MAX_TICK, MIN_TICK, 1, false)).to.be.reverted; // lower tick > upper tick
    await expect(updateLiquidity(MIN_TICK - 1, MAX_TICK, 1, false)).to.be.reverted; // lower tick too low
    await expect(updateLiquidity(MIN_TICK, MAX_TICK + 1, 1, false)).to.be.reverted; // upper tick too high

    await pool.setPoolParameters(200, 25);
    const minTick = Math.ceil(MIN_TICK / 200) * 200;
    const maxTick = Math.floor(MAX_TICK / 200) * 200;
    await expect(updateLiquidity(minTick + 1, maxTick, 1, false)).to.be.reverted; // lower tick not divisible by tick spacing
    await expect(updateLiquidity(minTick, maxTick + 1, 1, false)).to.be.reverted; // upper tick not divisible by tick spacing
  });

  context('add to uninitialized ticks', () => {
    it('current tick in range', async () => {
      await testAddLiquidity(pool, bn(1000), -10000, +10000, { nextBelow: MIN_TICK, nextAbove: 10000 }, { nextBelow: -10000, nextAbove: MAX_TICK }); // prettier-ignore
    });

    it('current tick above range', async () => {
      await testAddLiquidity(pool, bn(1000), -10000, -5000, { nextBelow: MIN_TICK, nextAbove: -5000 }, { nextBelow: -10000, nextAbove: MAX_TICK }); // prettier-ignore
    });

    it('current tick below range', async () => {
      await testAddLiquidity(pool, bn(1000), 5000, +10000, { nextBelow: MIN_TICK, nextAbove: 10000 }, { nextBelow: 5000, nextAbove: MAX_TICK }); // prettier-ignore
    });
  });

  it('combined test', async () => {
    await testAddLiquidity(pool, bn(1000), -10000, 10000, { nextBelow: MIN_TICK, nextAbove: 10000 }, { nextBelow: -10000, nextAbove: MAX_TICK }); // prettier-ignore
    await testAddLiquidity(pool, bn(1000), -10000, 10000, { nextBelow: MIN_TICK, nextAbove: 10000 }, { nextBelow: -10000, nextAbove: MAX_TICK }); // prettier-ignore
    await testAddLiquidity(pool, bn(1000), -10000, 80000, { nextBelow: MIN_TICK, nextAbove: 10000 }, { nextBelow: 10000, nextAbove: MAX_TICK }); // prettier-ignore
    await testAddLiquidity(pool, bn(1000), -80000, 10000, { nextBelow: MIN_TICK, nextAbove: -10000 }, { nextBelow: -10000, nextAbove: 80000 }); // prettier-ignore
    await testAddLiquidity(pool, bn(1000), -80000, -5000, { nextBelow: MIN_TICK, nextAbove: -10000 }, { nextBelow: -10000, nextAbove: 10000 }); // prettier-ignore
    await testAddLiquidity(pool, bn(1000), 100, 5000, { nextBelow: -5000, nextAbove: 5000 }, { nextBelow: 100, nextAbove: 10000 }); // prettier-ignore
    await testAddLiquidity(pool, bn(1000), 0, 100, { nextBelow: -5000, nextAbove: 100 }, { nextBelow: 0, nextAbove: 5000 }); // prettier-ignore
    await testAddLiquidity(pool, bn(1000), -80000, 80000, { nextBelow: MIN_TICK, nextAbove: -10000 }, { nextBelow: 10000, nextAbove: MAX_TICK }); // prettier-ignore
  });
});

const testAddLiquidity = async (
  pool: MockPool,
  liquidityDeltaD8: BigNumber,
  tickLower: number,
  tickUpper: number,
  expectedTickLower: { nextBelow: number; nextAbove: number },
  expectedTickUpper: { nextBelow: number; nextAbove: number },
) => {
  const tierId = 0;
  const liquidityDelta = liquidityDeltaD8.shl(8);
  const tierBefore = await pool.getTier(tierId);
  const lowerBefore = await pool.getTick(tierId, tickLower);
  const upperBefore = await pool.getTick(tierId, tickUpper);
  const positionBefore = await pool.getPosition(pool.address, 1, tierId, tickLower, tickUpper);

  // calculate expected input amount
  const [amt0Expected, amt1Expected] = await pool.calcAmtsForLiquidityFromTicks(tierId, tickLower, tickUpper, liquidityDeltaD8);

  // check input params are sensible
  expect(liquidityDeltaD8).gt(0);

  // set timestamp of next block
  const timestamp = (await getLatestBlockTimestamp()) + 100;
  await setNextBlockTimestamp(timestamp);

  // perform add liquidity
  const tx = await pool.updateLiquidity(pool.address, 1, tierId, tickLower, tickUpper, liquidityDeltaD8, false);

  // check twap last update
  expect((await pool.pool()).tickLastUpdate).eq(timestamp);

  // check current liquidity change if in-range
  const tier = await pool.getTier(tierId);
  const inRange = tickLower <= tier.tick && tier.tick < tickUpper;
  expect(tier.liquidity.sub(tierBefore.liquidity)).eq(inRange ? liquidityDelta : 0);

  // check tick map flags
  await pool.checkTickMap(tierId, tickLower, true);
  await pool.checkTickMap(tierId, tickUpper, true);

  // check ticks' liquidity change
  const lower = await pool.getTick(tierId, tickLower);
  const upper = await pool.getTick(tierId, tickUpper);
  expect(lower.liquidityLowerD8.sub(lowerBefore.liquidityLowerD8)).eq(liquidityDeltaD8);
  expect(lower.liquidityUpperD8.sub(lowerBefore.liquidityUpperD8)).eq(0);
  expect(upper.liquidityLowerD8.sub(upperBefore.liquidityLowerD8)).eq(0);
  expect(upper.liquidityUpperD8.sub(upperBefore.liquidityUpperD8)).eq(liquidityDeltaD8);

  // check tick's initialization, if any
  for (const { tick, before, after, nextTicks } of [
    { tick: tickLower, before: lowerBefore, after: lower, nextTicks: expectedTickLower },
    { tick: tickUpper, before: upperBefore, after: upper, nextTicks: expectedTickUpper },
  ]) {
    if (before.liquidityLowerD8.eq(0) && before.liquidityUpperD8.eq(0)) {
      if (tick <= tier.tick) {
        expect(after.feeGrowthOutside0).eq(tier.feeGrowthGlobal0);
        expect(after.feeGrowthOutside1).eq(tier.feeGrowthGlobal0);
        expect(after.secondsPerLiquidityOutside).eq((await pool.pool()).secondsPerLiquidityCumulative);
      } else {
        expect(after.feeGrowthOutside0).eq(0);
        expect(after.feeGrowthOutside1).eq(0);
        expect(after.secondsPerLiquidityOutside).eq(0);
      }
    } else {
      expect(after.feeGrowthOutside0).eq(before.feeGrowthOutside0);
      expect(after.feeGrowthOutside1).eq(before.feeGrowthOutside1);
      expect(after.secondsPerLiquidityOutside).eq(before.secondsPerLiquidityOutside);
    }

    // check tick's next ticks below and above
    expect(after.nextBelow).eq(nextTicks.nextBelow);
    expect(after.nextAbove).eq(nextTicks.nextAbove);
    expect((await pool.getTick(tierId, nextTicks.nextBelow)).nextAbove).eq(tick);
    expect((await pool.getTick(tierId, nextTicks.nextAbove)).nextBelow).eq(tick);
  }

  // check resulting token input amounts
  const event = await getEvent(tx, pool, 'UpdateLiquidityReturns');
  expect(event.amount0).eq(amt0Expected);
  expect(event.amount1).eq(amt1Expected);
  expect(event.feeAmtOut0).eq(0);
  expect(event.feeAmtOut1).eq(0);

  // check position
  const position = await pool.getPosition(pool.address, 1, tierId, tickLower, tickUpper);
  expect(position.liquidityD8.sub(positionBefore.liquidityD8)).eq(liquidityDeltaD8);
  expect(position.feeGrowthInside0Last).eq(0);
  expect(position.feeGrowthInside1Last).eq(0);
};
