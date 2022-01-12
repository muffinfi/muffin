import { expect } from 'chai';
import { BigNumberish } from 'ethers';
import { waffle } from 'hardhat';
import { MockPool } from '../../typechain';
import { poolTestFixture } from '../shared/fixtures';
import { bn, getEvent, getLatestBlockTimestamp, setNextBlockTimestamp } from '../shared/utils';

describe('pool remove liquidity', () => {
  let pool: MockPool;

  beforeEach(async () => {
    ({ pool } = await waffle.loadFixture(poolTestFixture));
    await pool.initialize(99850, bn(1).shl(72), 1, 25);
    await pool.prepareUpdateLiquidity();
    expect((await pool.getTier(0)).tick).eq(0);
  });

  const mint = async (tickLower: number, tickUpper: number, liquidityD8ToMint: BigNumberish) => {
    return await pool.updateLiquidity(pool.address, 1, 0, tickLower, tickUpper, liquidityD8ToMint, false);
  };

  const burn = async (tickLower: number, tickUpper: number, liquidityD8ToBurn: BigNumberish, collectAllFees: boolean) => {
    return await pool.updateLiquidity(pool.address, 1, 0, tickLower, tickUpper, -liquidityD8ToBurn, collectAllFees);
  };

  context('empty position', () => {
    it('burn zero liquidity ', async () => {
      await burn(0, 100, 0, false);
      await burn(0, 100, 0, true);

      await pool.setTickSpacing(123);
      await burn(0, 100, 0, true); // won't fail even ticks are not divisable by tick spacing
    });

    it('burn some liquidity ', async () => {
      await expect(burn(0, 100, 1, false)).to.be.revertedWith('');
    });
  });

  it('invalid tier id', async () => {
    await expect(pool.updateLiquidity(pool.address, 1, 1, 0, 100, 0, false)).to.be.reverted;
  });

  const commonTests = () => {
    const run = async (liquidityToBurnD8: BigNumberish, expectEmptyTick: [boolean, boolean]) => {
      await testRemoveLiquidity(pool, -90000, 90000, liquidityToBurnD8, expectEmptyTick, false);
    };

    it('empty both ticks; adjacent ticks', async () => {
      await run(4000, [true, true]);
    });

    it('empty both ticks; not adjacent ticks', async () => {
      await mint(0, 300000, 100);
      await run(4000, [true, true]);
    });

    it('no empty ticks', async () => {
      await run(400, [false, false]);
    });

    it('empty lower ticks; adjacent ticks', async () => {
      await mint(90000, 300000, 100);
      await run(4000, [true, false]);
    });

    it('empty lower ticks; not adjacent ticks', async () => {
      await mint(0, 90000, 100);
      await run(4000, [true, false]);
    });

    it('empty upper ticks; adjacent ticks', async () => {
      await mint(-300000, -90000, 100);
      await run(4000, [false, true]);
    });

    it('empty upper ticks; not adjacent ticks', async () => {
      await mint(-90000, 0, 100);
      await run(4000, [false, true]);
    });
  };

  context('in range', () => {
    beforeEach(async () => {
      await mint(-90000, 90000, 4000);
    });

    commonTests();
  });

  context('above range', () => {
    beforeEach(async () => {
      await pool.swap(true, -1_039_000, 0x3f);
      expect((await pool.getTier(0)).tick).gt(90000);
      await mint(-90000, 90000, 4000);
    });

    commonTests();
  });

  context('below range', () => {
    beforeEach(async () => {
      await pool.swap(false, -1_039_000, 0x3f);
      expect((await pool.getTier(0)).tick).lt(-90000);
      await mint(-90000, 90000, 4000);
    });

    commonTests();
  });
});

const testRemoveLiquidity = async (
  pool: MockPool,
  tickLower: number,
  tickUpper: number,
  liquidityToBurnD8: BigNumberish,
  expectEmptyTick: [boolean, boolean],
  collectAllFees: boolean = false,
) => {
  const liquidityDeltaD8 = bn(liquidityToBurnD8).mul(-1);
  const liquidityDelta = liquidityDeltaD8.mul(2 ** 8);
  expect(liquidityDelta).lte(0);

  const tierId = 0;
  const tierBefore = await pool.getTier(tierId);
  const lowerBefore = await pool.getTick(tierId, tickLower);
  const upperBefore = await pool.getTick(tierId, tickUpper);
  const positionBefore = await pool.getPosition(pool.address, 1, tierId, tickLower, tickUpper);

  // calculate expected input amount
  const [amt0Expected, amt1Expected] = await pool.calcAmtsForLiquidityFromTicks(tierId, tickLower, tickUpper, liquidityDeltaD8);

  // earn some fees
  await pool.increaseFeeGrowthGlobal(1e15, 1e15);

  // set timestamp of next block
  const timestamp = (await getLatestBlockTimestamp()) + 100;
  await setNextBlockTimestamp(timestamp);

  // perform remove liquidity
  const tx = await pool.updateLiquidity(pool.address, 1, tierId, tickLower, tickUpper, liquidityDeltaD8, collectAllFees);

  // check twap last update
  expect((await pool.pool()).tickLastUpdate).eq(timestamp);

  // check current liquidity change if in-range
  const tier = await pool.getTier(tierId);
  const inRange = tickLower <= tier.tick && tier.tick < tickUpper;
  expect(tier.liquidity.sub(tierBefore.liquidity)).eq(inRange ? liquidityDelta : 0);

  // check tick map flags
  await pool.checkTickMap(tierId, tickLower, !expectEmptyTick[0]);
  await pool.checkTickMap(tierId, tickUpper, !expectEmptyTick[1]);

  // check ticks' liquidity change
  const lower = await pool.getTick(tierId, tickLower);
  const upper = await pool.getTick(tierId, tickUpper);
  expect(lower.liquidityLowerD8.sub(lowerBefore.liquidityLowerD8)).eq(liquidityDeltaD8);
  expect(lower.liquidityUpperD8.sub(lowerBefore.liquidityUpperD8)).eq(0);
  expect(upper.liquidityLowerD8.sub(upperBefore.liquidityLowerD8)).eq(0);
  expect(upper.liquidityUpperD8.sub(upperBefore.liquidityUpperD8)).eq(liquidityDeltaD8);

  for (const { tick, before, after, shouldEmpty } of [
    { tick: tickLower, before: lowerBefore, after: lower, shouldEmpty: expectEmptyTick[0] },
    { tick: tickUpper, before: upperBefore, after: upper, shouldEmpty: expectEmptyTick[1] },
  ]) {
    if (shouldEmpty) {
      // check whole tick deleted
      expect(after.liquidityLowerD8).eq(0);
      expect(after.liquidityUpperD8).eq(0);
      expect(after.nextBelow).eq(0);
      expect(after.nextAbove).eq(0);
      expect(after.feeGrowthOutside0).eq(0);
      expect(after.feeGrowthOutside1).eq(0);
      expect(after.secondsPerLiquidityOutside).eq(0);

      // check its adjacent ticks have updated their next{Below,Above}
      let tickBelow = before.nextBelow;
      let tickAbove = before.nextAbove;
      let below = await pool.getTick(0, tickBelow);
      let above = await pool.getTick(0, tickAbove);
      if (below.liquidityLowerD8.eq(0) && below.liquidityUpperD8.eq(0)) {
        // the below tick must not be empty tick unless it is the lower tick of the burned position
        expect(tickBelow).eq(tickLower).and.not.eq(tick);
        tickBelow = lowerBefore.nextBelow;
        below = await pool.getTick(0, tickBelow);
      }
      if (above.liquidityLowerD8.eq(0) && above.liquidityUpperD8.eq(0)) {
        // the above tick must not be empty tick unless it is the upper tick of the burned position
        expect(tickAbove).eq(tickUpper).and.not.eq(tick);
        tickAbove = upperBefore.nextAbove;
        above = await pool.getTick(0, tickAbove);
      }
      expect(below.nextAbove).eq(tickAbove);
      expect(above.nextBelow).eq(tickBelow);

      // if this tick is previously the tier's next tick, check tier's next tick has reset to a new tick
      if (tick == tierBefore.nextTickBelow || tick == tierBefore.nextTickAbove) {
        expect(tier.nextTickBelow).not.eq(tick);
        expect(tier.nextTickAbove).not.eq(tick);
      }
    } else {
      // check data unchanged
      expect(after.feeGrowthOutside0).eq(before.feeGrowthOutside0);
      expect(after.feeGrowthOutside1).eq(before.feeGrowthOutside1);
      expect(after.secondsPerLiquidityOutside).eq(before.secondsPerLiquidityOutside);
    }
  }

  // check resulted token input amounts
  const event = await getEvent(tx, pool, 'UpdateLiquidityReturns');
  expect(event.amount0).eq(amt0Expected);
  expect(event.amount1).eq(amt1Expected);
  // only in-range position can earn fees from the `increaseFeeGrowthGlobal` call in the start of the test
  if (inRange) {
    expect(event.feeAmtOut0).gt(0);
    expect(event.feeAmtOut1).gt(0);
  } else {
    expect(event.feeAmtOut0).eq(0);
    expect(event.feeAmtOut1).eq(0);
  }

  // check position data changes
  const position = await pool.getPosition(pool.address, 1, tierId, tickLower, tickUpper);
  expect(position.liquidityD8.sub(positionBefore.liquidityD8)).eq(liquidityDeltaD8);
  if (collectAllFees) {
    expect(position.feeGrowthInside0Last).gt(positionBefore.feeGrowthInside0Last);
    expect(position.feeGrowthInside1Last).gt(positionBefore.feeGrowthInside1Last);
  } else {
    expect(position.feeGrowthInside0Last).eq(positionBefore.feeGrowthInside0Last);
    expect(position.feeGrowthInside1Last).eq(positionBefore.feeGrowthInside1Last);
  }
};
