import { expect } from 'chai';
import { BigNumberish } from 'ethers';
import { waffle } from 'hardhat';
import { MockPool } from '../../typechain';
import { BASE_LIQUIDITY, BASE_LIQUIDITY_D8, LimitOrderType, MAX_TICK, MIN_TICK } from '../shared/constants';
import { poolTestFixture } from '../shared/fixtures';
import { bn } from '../shared/utils';

const tickLower = -1;
const tickUpper = 1;

describe('pool settle positions', () => {
  let pool: MockPool;

  beforeEach(async () => {
    ({ pool } = await waffle.loadFixture(poolTestFixture));
    await pool.initialize(99850, bn(1).shl(72), 1, 25);
    await pool.prepareUpdateLiquidity();
    await pool.setTierParameters(0, 99850, 2);
    await pool.incrementSnapshotIds(0, tickLower, tickUpper);
    await pool.updateLiquidity(pool.address, 1, 0, tickLower, tickUpper, 10000, false);
  });

  const updateLiquidity = async (refId: number, tickLower: number, tickUpper: number, liquidityDeltaD8: BigNumberish) => {
    return await pool.updateLiquidity(pool.address, refId, 0, tickLower, tickUpper, liquidityDeltaD8, false);
  };

  context('price going down', () => {
    beforeEach(async () => {
      await pool.setLimitOrderType(pool.address, 1, 0, tickLower, tickUpper, LimitOrderType.ONE_FOR_ZERO);
      await pool.increaseFeeGrowthGlobal(1e14, 1e14);
    });

    it('no clear start, no clear end', async () => {
      await updateLiquidity(2, MIN_TICK, tickLower, BASE_LIQUIDITY_D8);
      await updateLiquidity(2, tickLower, tickUpper, BASE_LIQUIDITY_D8);
      await updateLiquidity(2, tickUpper, MAX_TICK, BASE_LIQUIDITY_D8);
      await testSettle(TickKind.Lower, false, false);
    });

    it('clear start, no clear end', async () => {
      await updateLiquidity(2, MIN_TICK, tickLower, BASE_LIQUIDITY_D8);
      await updateLiquidity(2, tickLower, MAX_TICK, BASE_LIQUIDITY_D8);
      await testSettle(TickKind.Lower, true, false);
    });

    it('no clear start, clear end', async () => {
      await updateLiquidity(2, MIN_TICK, tickUpper, BASE_LIQUIDITY_D8);
      await updateLiquidity(2, tickUpper, MAX_TICK, BASE_LIQUIDITY_D8);
      await testSettle(TickKind.Lower, false, true);
    });

    it('clear start, clear end', async () => {
      await updateLiquidity(2, MIN_TICK, MAX_TICK, BASE_LIQUIDITY_D8);
      await testSettle(TickKind.Lower, true, true);
    });
  });

  context('price going up', () => {
    beforeEach(async () => {
      await pool.setLimitOrderType(pool.address, 1, 0, tickLower, tickUpper, LimitOrderType.ZERO_FOR_ONE);
      await pool.increaseFeeGrowthGlobal(1e14, 1e14);
    });

    it('no clear start, no clear end', async () => {
      await updateLiquidity(2, MIN_TICK, tickLower, BASE_LIQUIDITY_D8);
      await updateLiquidity(2, tickLower, tickUpper, BASE_LIQUIDITY_D8);
      await updateLiquidity(2, tickUpper, MAX_TICK, BASE_LIQUIDITY_D8);
      await testSettle(TickKind.Upper, false, false);
    });

    it('clear start, no clear end', async () => {
      await updateLiquidity(2, MIN_TICK, tickUpper, BASE_LIQUIDITY_D8);
      await updateLiquidity(2, tickUpper, MAX_TICK, BASE_LIQUIDITY_D8);
      await testSettle(TickKind.Upper, true, false);
    });

    it('no clear start, clear end', async () => {
      await updateLiquidity(2, MIN_TICK, tickLower, BASE_LIQUIDITY_D8);
      await updateLiquidity(2, tickLower, MAX_TICK, BASE_LIQUIDITY_D8);
      await testSettle(TickKind.Upper, false, true);
    });

    it('clear start, clear end', async () => {
      await updateLiquidity(2, MIN_TICK, MAX_TICK, BASE_LIQUIDITY_D8);
      await testSettle(TickKind.Upper, true, true);
    });
  });

  enum TickKind {
    Lower,
    Upper,
  }

  const testSettle = async (tickKind: TickKind, expectTickStartDeleted: boolean, expectTickEndDeleted: boolean) => {
    const origSnapshoId = 1;

    // show we're at tick zero
    expect((await pool.getTier(0)).sqrtPrice).eq(bn(1).shl(72));

    // make the tier go pass tick -1 or 1
    if (tickKind === TickKind.Lower) {
      await pool.swap(true, 300, 0x3f);
      expect((await pool.getTier(0)).tick).lt(tickLower);
      expect((await pool.getTier(0)).liquidity).eq(BASE_LIQUIDITY.mul(2));
    } else {
      await pool.swap(false, 300, 0x3f);
      expect((await pool.getTier(0)).tick).gte(tickUpper);
      expect((await pool.getTier(0)).liquidity).eq(BASE_LIQUIDITY.mul(2));
    }

    // check needSettle flag on tick state
    const needSettle =
      tickKind === TickKind.Lower
        ? (await pool.getTick(0, tickLower)).needSettle0
        : (await pool.getTick(0, tickUpper)).needSettle1;
    expect(needSettle).eq(false);

    // check settlement state being reset
    // prettier-ignore
    const settlement =
      tickKind === TickKind.Lower
        ? await pool.getSettlement(0, tickLower, false)
        : await pool.getSettlement(0, tickUpper, true);
    expect(settlement.liquidityD8).eq(0);
    expect(settlement.tickSpacing).eq(0);
    expect(settlement.nextSnapshotId).eq(origSnapshoId + 1);

    // check data snapshot has been done
    const snapshot =
      tickKind === TickKind.Lower
        ? await pool.getSettlementSnapshot(0, tickLower, false, origSnapshoId)
        : await pool.getSettlementSnapshot(0, tickUpper, true, origSnapshoId);
    expect(snapshot.feeGrowthInside0).gt(0);
    expect(snapshot.feeGrowthInside1).gt(0);
    expect(snapshot.secondsPerLiquidityInside).gt(0);

    const end = await pool.getTick(0, tickKind === TickKind.Lower ? tickLower : tickUpper);
    const start = await pool.getTick(0, tickKind === TickKind.Lower ? tickUpper : tickLower);
    const tier = await pool.getTier(0);

    // check if starting tick deleted
    if (expectTickStartDeleted) {
      expect(start.nextAbove).eq(0);
      expect(start.nextBelow).eq(0);
    } else {
      expect(start.nextAbove).not.eq(0);
      expect(start.nextBelow).not.eq(0);
    }

    // check if ending tick deleted, and hence if tier's next tick is updated
    if (expectTickEndDeleted) {
      expect(end.nextAbove).eq(0);
      expect(end.nextBelow).eq(0);
      if (tickKind === TickKind.Lower) {
        expect(tier.nextTickAbove).eq(expectTickStartDeleted ? MAX_TICK : tickUpper);
      } else {
        expect(tier.nextTickBelow).eq(expectTickStartDeleted ? MIN_TICK : tickLower);
      }
    } else {
      expect(end.nextAbove).not.eq(0);
      expect(end.nextBelow).not.eq(0);
      if (tickKind === TickKind.Lower) {
        expect(tier.nextTickAbove).eq(tickLower);
      } else {
        expect(tier.nextTickBelow).eq(tickUpper);
      }
    }

    // check if no liquidity change after swapping back
    if (tickKind === TickKind.Lower) {
      await pool.swap(true, -300, 0x3f);
      expect((await pool.getTier(0)).tick).gt(tickLower);
      expect((await pool.getTier(0)).liquidity).eq(BASE_LIQUIDITY.mul(2));
    } else {
      await pool.swap(false, -300, 0x3f);
      expect((await pool.getTier(0)).tick).lte(tickUpper);
      expect((await pool.getTier(0)).liquidity).eq(BASE_LIQUIDITY.mul(2));
    }
  };
});
