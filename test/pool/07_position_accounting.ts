import { expect } from 'chai';
import { BigNumberish } from 'ethers';
import { waffle } from 'hardhat';
import { PoolsTest } from '../../typechain';
import { poolTestFixture } from '../shared/fixtures';
import { bn, getEvent } from '../shared/utils';

describe('position accounting', () => {
  let pool: PoolsTest;

  beforeEach(async () => {
    ({ pool } = await waffle.loadFixture(poolTestFixture));
    await pool.initialize(99850, bn(1).shl(72), 1, 25);
    await pool.prepareUpdateLiquidity();
    expect((await pool.getTier(0)).tick).eq(0);
  });

  const updateLiquidity = async (tickLower: BigNumberish, tickUpper: BigNumberish, liquidityDeltaD8: BigNumberish) => {
    return await pool.updateLiquidity(pool.address, 1, 0, tickLower, tickUpper, liquidityDeltaD8, false);
  };

  const getPositionFees = async (tickLower: BigNumberish, tickUpper: BigNumberish) => {
    return await pool.getPositionFees(pool.address, 1, 0, tickLower, tickUpper);
  };

  it('underflowed feeGrowthInside is fine', async () => {
    // initialize tick -9000
    await updateLiquidity(-9000, 9000, 4000);

    // increase fee growth global
    await pool.increaseFeeGrowthGlobal(1e9, 1e9);

    // initialize tick -30000
    await updateLiquidity(-30000, -9000, 8000);

    // since we initialize tick -9000 first, its fee growths ouside should be lower than that of tick -30000
    const tickA = await pool.getTick(0, -9000);
    const tickB = await pool.getTick(0, -30000);
    expect(tickB.feeGrowthOutside0).gt(tickA.feeGrowthOutside0);
    expect(tickB.feeGrowthOutside1).gt(tickA.feeGrowthOutside1);

    {
      // check fee growth inside tick range [-30000, -9000] should be underflowed, but this is fine.
      // since tickB.feeGrowthOutside > tickA.feeGrowthOutside,
      // then feeGrowthInside = (tickB.feeGrowthOutside - tickA.feeGrowthOutside) should be smaller than tickB.feeGrowthOutside,
      // unless feeGrowthInside underflowed.
      const [fgInside0, fgInside1] = await pool.getFeeGrowthInside(0, -30000, -9000);
      expect(fgInside0).gt(tickB.feeGrowthOutside0); // it passes iff underflow
      expect(fgInside1).gt(tickB.feeGrowthOutside1); // it passes iff underflow

      // check unclaimed fee amounts earned by the position. they should be zero since no swap after adding liquidity
      const [feeAmt0, feeAmt1] = await getPositionFees(-30000, -9000);
      expect(feeAmt0).eq(0);
      expect(feeAmt1).eq(0);
    }

    // swap to move tier to tick range [-30000, -9000]
    await pool.swap(true, 5_000_000, 0x3f);
    expect((await pool.getTier(0)).tick).within(-30000, -9000);

    {
      // check fee growth inside tick range [-30000, -9000].
      // feeGrowthInside0 should be no underflow now, since some token0 fees are earned below tick -9000 via last swap,
      // but feeGrowthInside1 should still be underflowed.
      const [fgInside0, fgInside1] = await pool.getFeeGrowthInside(0, -30000, -9000);
      const tier = await pool.getTier(0);
      expect(fgInside0).lt(tier.feeGrowthGlobal0);
      expect(fgInside1).gt(tier.feeGrowthGlobal1); // it passes iff underflow

      // check unclaimed fee amounts. even though feeGrowthInside1 is underflowed,
      // the calculated unclaimed fee amounts are no error (i.e. >= 0)
      const [feeAmt0, feeAmt1] = await getPositionFees(-30000, -9000);
      expect(feeAmt0).gt(0);
      expect(feeAmt1).eq(0);
    }

    // directly increase fee growth global, pretending to earn fees inside range [-30000, -9000].
    pool.increaseFeeGrowthGlobal(1e14, 1e14);

    {
      //  now feeGrowthInside1 should be no underflow now
      const [fgInside0, fgInside1] = await pool.getFeeGrowthInside(0, -30000, -9000);
      const tier = await pool.getTier(0);
      expect(fgInside0).lt(tier.feeGrowthGlobal0);
      expect(fgInside1).lt(tier.feeGrowthGlobal1);

      // check unclaimed fee amounts again
      const [feeAmt0, feeAmt1] = await getPositionFees(-30000, -9000);
      expect(feeAmt0).gt(0);
      expect(feeAmt1).gt(0);
    }
  });

  it('overflowing feeGrowthGlobal is fine', async () => {
    await updateLiquidity(-9000, 9000, 4000);

    await pool.increaseFeeGrowthGlobal(bn(10).pow(23), 0);
    const fggT0 = (await pool.getTier(0)).feeGrowthGlobal0;
    const feeAmtT0 = (await getPositionFees(-9000, 9000))[0];

    await pool.increaseFeeGrowthGlobal(bn(10).pow(24), 0);
    const fggT1 = (await pool.getTier(0)).feeGrowthGlobal0;
    const feeAmtT1 = (await getPositionFees(-9000, 9000))[0];

    await pool.increaseFeeGrowthGlobal(bn(10).pow(24), 0);
    const fggT2 = (await pool.getTier(0)).feeGrowthGlobal0;
    const feeAmtT2 = (await getPositionFees(-9000, 9000))[0];

    // showing fee growth global has overflowed
    expect(fggT0.lt(fggT1) && fggT1.gt(fggT2)).to.be.true;

    // at most the position may earn less fees due to overflow of fee growth global
    expect(feeAmtT0.lt(feeAmtT1) && feeAmtT1.gt(feeAmtT2)).to.be.true;
  });

  context('collectAllFees true/false does not affect fees earned', () => {
    it('remove liquidity', async () => {
      const accIdA = 1;
      const accIdB = 2;
      await pool.updateLiquidity(pool.address, accIdA, 0, -100, 100, 500_000, false);
      await pool.updateLiquidity(pool.address, accIdB, 0, -100, 100, 500_000, false);
      await pool.increaseFeeGrowthGlobal(bn(10).pow(16), bn(10).pow(16));
      const positionABefore = await pool.getPosition(pool.address, accIdA, 0, -100, 100);

      // A: not collect all fees
      const txA = await pool.updateLiquidity(pool.address, accIdA, 0, -100, 100, -250000, false);
      const eventA = await getEvent(txA, pool, 'UpdateLiquidityReturns');
      const [feeAmt0A, feeAmt1A] = await pool.getPositionFees(pool.address, accIdA, 0, -100, 100);
      expect(feeAmt0A).eq(eventA.feeAmtOut0);
      expect(feeAmt1A).eq(eventA.feeAmtOut1);
      expect(feeAmt0A).gt(0);
      expect(feeAmt1A).gt(0);

      // B: collect all fees
      const txB = await pool.updateLiquidity(pool.address, accIdB, 0, -100, 100, -250000, true);
      const eventB = await getEvent(txB, pool, 'UpdateLiquidityReturns');
      const [feeAmt0B, feeAmt1B] = await pool.getPositionFees(pool.address, accIdB, 0, -100, 100);
      expect(eventB.feeAmtOut0).gt(0);
      expect(eventB.feeAmtOut1).gt(0);
      expect(feeAmt0B).eq(0);
      expect(feeAmt1B).eq(0);

      // check total fee amounts are the same
      expect(eventB.feeAmtOut0).eq(feeAmt0A.add(eventA.feeAmtOut0));
      expect(eventB.feeAmtOut1).eq(feeAmt1A.add(eventA.feeAmtOut1));

      // check position data changes
      const positionA = await pool.getPosition(pool.address, accIdA, 0, -100, 100);
      const positionB = await pool.getPosition(pool.address, accIdB, 0, -100, 100);
      expect(positionA.feeGrowthInside0Last).lt(positionB.feeGrowthInside0Last);
      expect(positionA.feeGrowthInside1Last).lt(positionB.feeGrowthInside1Last);
      expect(positionA.feeGrowthInside0Last).eq(positionABefore.feeGrowthInside0Last);
      expect(positionA.feeGrowthInside1Last).eq(positionABefore.feeGrowthInside1Last);
    });

    it('add liquidity ', async () => {
      const accIdA = 1;
      const accIdB = 2;
      await pool.updateLiquidity(pool.address, accIdA, 0, -100, 100, 500_000, false);
      await pool.updateLiquidity(pool.address, accIdB, 0, -100, 100, 500_000, false);
      await pool.increaseFeeGrowthGlobal(bn(10).pow(16), bn(10).pow(16));

      // A: not collect all fees
      const txA = await pool.updateLiquidity(pool.address, accIdA, 0, -100, 100, 10000, false);
      const eventA = await getEvent(txA, pool, 'UpdateLiquidityReturns');
      const [feeAmt0A, feeAmt1A] = await pool.getPositionFees(pool.address, accIdA, 0, -100, 100);
      expect(eventA.feeAmtOut0).eq(0);
      expect(eventA.feeAmtOut1).eq(0);
      expect(feeAmt0A).gt(0);
      expect(feeAmt1A).gt(0);

      // B: collect all fees
      const txB = await pool.updateLiquidity(pool.address, accIdB, 0, -100, 100, 10000, true);
      const eventB = await getEvent(txB, pool, 'UpdateLiquidityReturns');
      const [feeAmt0B, feeAmt1B] = await pool.getPositionFees(pool.address, accIdB, 0, -100, 100);
      expect(eventB.feeAmtOut0).gt(0);
      expect(eventB.feeAmtOut1).gt(0);
      expect(feeAmt0B).eq(0);
      expect(feeAmt1B).eq(0);

      expect(eventB.feeAmtOut0).eq(feeAmt0A);
      expect(eventB.feeAmtOut1).eq(feeAmt1A);

      // check position data changes
      const positionA = await pool.getPosition(pool.address, accIdA, 0, -100, 100);
      const positionB = await pool.getPosition(pool.address, accIdB, 0, -100, 100);
      expect(positionA.feeGrowthInside0Last).lt(positionB.feeGrowthInside0Last);
      expect(positionA.feeGrowthInside1Last).lt(positionB.feeGrowthInside1Last);
    });
  });
});
