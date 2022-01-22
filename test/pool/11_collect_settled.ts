import { expect } from 'chai';
import { waffle } from 'hardhat';
import { MockPool } from '../../typechain';
import { BASE_LIQUIDITY, LimitOrderType } from '../shared/constants';
import { poolTestFixture } from '../shared/fixtures';
import { bn, getEvent } from '../shared/utils';

const tickLower = -1;
const tickUpper = 1;

describe('pool collect settled positions', () => {
  let pool: MockPool;

  beforeEach(async () => {
    ({ pool } = await waffle.loadFixture(poolTestFixture));
    await pool.initialize(99850, bn(1).shl(72), 1, 25);
    await pool.setTierParameters(0, 99850, 2);
    await pool.increaseFeeGrowthGlobal(1e15, 1e15);
    await pool.incrementSnapshotIds(0, tickLower, tickUpper);
  });

  beforeEach('prepare limit order', async () => {
    // mint positiion
    await pool.updateLiquidity(pool.address, 1, 0, tickLower, tickUpper, 10000, false);
    // turn position to limit order
    await pool.setLimitOrderType(pool.address, 1, 0, tickLower, tickUpper, LimitOrderType.ONE_FOR_ZERO);
    // accrue some fees
    await pool.increaseFeeGrowthGlobal(1e15, 1e15);
  });

  it('not yet settled', async () => {
    await expect(pool.collectSettled(pool.address, 1, 0, tickLower, tickUpper, 10000, false)).to.be.revertedWith(
      'PositionNotSettled()',
    );
  });

  it('non limit-order position', async () => {
    await pool.updateLiquidity(pool.address, 2, 0, tickLower, tickUpper, 10000, false);
    await expect(pool.collectSettled(pool.address, 2, 0, tickLower, tickUpper, 10000, false)).to.be.revertedWith(
      'PositionNotSettled()',
    );
  });

  it('empty position', async () => {
    await expect(pool.collectSettled(pool.address, 2, 0, tickLower, tickUpper, 0, false)).to.be.revertedWith(
      'PositionNotSettled()',
    );
  });

  context('position settled', async () => {
    beforeEach(async () => {
      // settle position by moving the price crossing tick -1
      await pool.swap(true, 300, 0x3f);
      expect((await pool.getTier(0)).tick).lt(tickLower);
      expect((await pool.getTier(0)).liquidity).eq(BASE_LIQUIDITY);
    });

    const test = async () => {
      const tx = await pool.collectSettled(pool.address, 1, 0, tickLower, tickUpper, 10000, false);

      // compare with prepared numbers
      const event = await getEvent(tx, pool, 'CollectSettledReturns');
      expect(event.amount0).eq(255);
      expect(event.amount1).eq(0);
      expect(event.feeAmtOut0).eq(139);
      expect(event.feeAmtOut1).eq(138);

      // check position emptied and unset from limit order
      const position = await pool.getPosition(pool.address, 1, 0, tickLower, tickUpper);
      expect(position.liquidityD8).eq(0);
      expect(position.limitOrderType).eq(LimitOrderType.NOT_LIMIT_ORDER);
      expect(position.settlementSnapshotId).eq(0);
    };

    it('collect successfully', async () => {
      await test();
    });

    it('will not accrue any more fees', async () => {
      await pool.swap(true, -170, 0x3f);
      expect((await pool.getTier(0)).tick).gte(tickLower).and.lt(tickUpper); // prettier-ignore
      await pool.increaseFeeGrowthGlobal(1e15, 1e15);
      await test();
    });

    it('will not affected by current price', async () => {
      await pool.swap(false, 300, 0x3f);
      await test();
    });

    it('will not affected if ticks are re-initialized', async () => {
      await pool.updateLiquidity(pool.address, 2, 0, tickLower, tickUpper, 10000, false);
      await test();
    });
  });
});
