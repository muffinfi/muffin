import { expect } from 'chai';
import { BigNumberish } from 'ethers';
import { waffle } from 'hardhat';
import { MockPool } from '../../typechain';
import { LimitOrderType } from '../shared/constants';
import { poolTestFixture } from '../shared/fixtures';
import { bn } from '../shared/utils';

const tickLower = -1;
const tickUpper = 1;

describe('pool set limit order', () => {
  let pool: MockPool;

  beforeEach(async () => {
    ({ pool } = await waffle.loadFixture(poolTestFixture));
    await pool.initialize(99850, bn(1).shl(72), 1, 25);
    await pool.setTierParameters(0, 99850, 2);

    await updateLiquidity(tickLower, tickUpper, 100);
    await pool.incrementSnapshotIds(0, tickLower, tickUpper);
  });

  const updateLiquidity = async (tickLower: number, tickUpper: number, liquidityDeltaD8: BigNumberish) => {
    return await pool.updateLiquidity(pool.address, 1, 0, tickLower, tickUpper, liquidityDeltaD8, false);
  };

  const setLimitOrderType = async (tickLower: number, tickUpper: number, limitOrderType: number) => {
    return await pool.setLimitOrderType(pool.address, 1, 0, tickLower, tickUpper, limitOrderType);
  };

  const expectResult = async (
    limitOrderType: number,
    settlementSnapshotId: number,
    tickLowerNeedSettle0: boolean,
    tickUpperNeedSettle1: boolean,
    settlementLower: [BigNumberish, number, number],
    settlementUpper: [BigNumberish, number, number],
  ) => {
    const position = await pool.getPosition(pool.address, 1, 0, tickLower, tickUpper);
    expect(position.limitOrderType).eq(limitOrderType);
    expect(position.settlementSnapshotId).eq(settlementSnapshotId);

    expect((await pool.getTick(0, tickLower)).needSettle0).eq(tickLowerNeedSettle0);
    expect((await pool.getTick(0, tickUpper)).needSettle1).eq(tickUpperNeedSettle1);

    const _settlementLower = await pool.getSettlement(0, tickLower, false);
    const _settlementUpper = await pool.getSettlement(0, tickUpper, true);

    expect(_settlementLower.liquidityD8).eq(settlementLower[0]);
    expect(_settlementLower.tickSpacing).eq(settlementLower[1]);
    expect(_settlementLower.nextSnapshotId).eq(settlementLower[2]);

    expect(_settlementUpper.liquidityD8).eq(settlementUpper[0]);
    expect(_settlementUpper.tickSpacing).eq(settlementUpper[1]);
    expect(_settlementUpper.nextSnapshotId).eq(settlementUpper[2]);
  };

  const commonTests = () => {
    it('unset to normal', async () => {
      await setLimitOrderType(tickLower, tickUpper, LimitOrderType.NOT_LIMIT_ORDER);
      await expectResult(LimitOrderType.NOT_LIMIT_ORDER, 0, false, false, [0, 0, 1], [0, 0, 1]);
    });

    it('set to 0->1', async () => {
      await setLimitOrderType(tickLower, tickUpper, LimitOrderType.ZERO_FOR_ONE);
      await expectResult(LimitOrderType.ZERO_FOR_ONE, 1, false, true, [0, 0, 1], [100, 2, 1]);
    });

    it('set to 1->0', async () => {
      await setLimitOrderType(tickLower, tickUpper, LimitOrderType.ONE_FOR_ZERO);
      await expectResult(LimitOrderType.ONE_FOR_ZERO, 1, true, false, [100, 2, 1], [0, 0, 1]);
    });
  };

  context('from normal position', () => {
    it('invalid limit order type', async () => {
      await expect(setLimitOrderType(-1, 1, 100)).to.be.reverted;
    });

    it('limit order disabled', async () => {
      await pool.setTierParameters(0, 99850, 0);
      await expect(setLimitOrderType(-1, 1, LimitOrderType.ZERO_FOR_ONE)).to.be.revertedWith('InvalidTickRangeForLimitOrder()');
    });

    it('position invalid tick range', async () => {
      await pool.setTierParameters(0, 99850, 100);
      await expect(setLimitOrderType(-1, 1, LimitOrderType.ZERO_FOR_ONE)).to.be.revertedWith('InvalidTickRangeForLimitOrder()');
    });

    it('empty position', async () => {
      await expect(setLimitOrderType(-2, 2, LimitOrderType.ZERO_FOR_ONE)).to.be.revertedWith('NoLiquidityForLimitOrder()');
    });

    commonTests();
  });

  context('from 1->0', () => {
    beforeEach(async () => {
      await setLimitOrderType(tickLower, tickUpper, LimitOrderType.ONE_FOR_ZERO);
    });

    commonTests();
  });

  context('from 0->1', () => {
    beforeEach(async () => {
      await setLimitOrderType(tickLower, tickUpper, LimitOrderType.ZERO_FOR_ONE);
    });

    commonTests();
  });

  context('from a limit order', () => {
    it('already settled', async () => {
      // turn position to limit order
      await setLimitOrderType(tickLower, tickUpper, LimitOrderType.ONE_FOR_ZERO);

      // cross tick and settle the position
      await pool.swap(true, 300, 0x3f);
      expect((await pool.getTier(0)).tick).lt(tickLower);

      // note that we got panic error because we makes settlement.liquidityD8 underflow
      await expect(setLimitOrderType(tickLower, tickUpper, LimitOrderType.ZERO_FOR_ONE)).to.be.revertedWith('reverted with panic code 0x11'); // prettier-ignore
      await expect(setLimitOrderType(tickLower, tickUpper, LimitOrderType.ONE_FOR_ZERO)).to.be.revertedWith('reverted with panic code 0x11'); // prettier-ignore
      await expect(setLimitOrderType(tickLower, tickUpper, LimitOrderType.NOT_LIMIT_ORDER)).to.be.revertedWith('reverted with panic code 0x11'); // prettier-ignore

      // add a limit order again for other owner
      await pool.updateLiquidity(pool.address, 2, 0, tickLower, tickUpper, 100, false);
      await pool.setLimitOrderType(pool.address, 2, 0, tickLower, tickUpper, LimitOrderType.ONE_FOR_ZERO);

      // test the first position failed to set order type
      await expect(setLimitOrderType(tickLower, tickUpper, LimitOrderType.ZERO_FOR_ONE)).to.be.revertedWith('PositionAlreadySettled()'); // prettier-ignore
      await expect(setLimitOrderType(tickLower, tickUpper, LimitOrderType.ONE_FOR_ZERO)).to.be.revertedWith('PositionAlreadySettled()'); // prettier-ignore
      await expect(setLimitOrderType(tickLower, tickUpper, LimitOrderType.NOT_LIMIT_ORDER)).to.be.revertedWith('PositionAlreadySettled()'); // prettier-ignore
    });

    it('(special case) tick spacing changed', async () => {
      await setLimitOrderType(tickLower, tickUpper, LimitOrderType.ONE_FOR_ZERO);
      await pool.setTierParameters(0, 99850, 100);

      // only allow unsetting
      await expect(setLimitOrderType(tickLower, tickUpper, LimitOrderType.ZERO_FOR_ONE)).to.be.revertedWith('InvalidTickRangeForLimitOrder()'); // prettier-ignore
      await expect(setLimitOrderType(tickLower, tickUpper, LimitOrderType.ONE_FOR_ZERO)).to.be.revertedWith('InvalidTickRangeForLimitOrder()'); // prettier-ignore
      await setLimitOrderType(tickLower, tickUpper, LimitOrderType.NOT_LIMIT_ORDER);
    });
  });

  context('update liquidity of limit order', () => {
    beforeEach(async () => {
      await setLimitOrderType(tickLower, tickUpper, LimitOrderType.ONE_FOR_ZERO);
    });

    it('add liquidity', async () => {
      await updateLiquidity(tickLower, tickUpper, 100);
      await expectResult(LimitOrderType.ONE_FOR_ZERO, 1, true, false, [100 + 100, 2, 1], [0, 0, 1]);
    });

    it('remove partial liquidity', async () => {
      await updateLiquidity(tickLower, tickUpper, -50);
      await expectResult(LimitOrderType.ONE_FOR_ZERO, 1, true, false, [100 - 50, 2, 1], [0, 0, 1]);
    });

    it('remove all liquidity', async () => {
      await updateLiquidity(tickLower, tickUpper, -100);
      await expectResult(LimitOrderType.NOT_LIMIT_ORDER, 0, false, false, [0, 0, 1], [0, 0, 1]);

      // adding back liquidity won't resume back the previous limit order type
      await updateLiquidity(tickLower, tickUpper, 30);
      await expectResult(LimitOrderType.NOT_LIMIT_ORDER, 0, false, false, [0, 0, 1], [0, 0, 1]);
    });
  });
});
