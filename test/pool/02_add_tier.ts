import { expect } from 'chai';
import { waffle } from 'hardhat';
import { PoolsTest } from '../../typechain';
import { BASE_LIQUIDITY, BASE_LIQUIDITY_D8, MAX_TICK, MIN_TICK } from '../shared/constants';
import { poolTestFixture } from '../shared/fixtures';
import { bn, getLatestBlockTimestamp, setNextBlockTimestamp } from '../shared/utils';

describe('pool add tier', () => {
  let pool: PoolsTest;

  beforeEach(async () => {
    ({ pool } = await waffle.loadFixture(poolTestFixture));
    await pool.initialize(99850, bn(1).shl(72), 1, 25);
  });

  it('cannot be called by non-governance'); // TODO: in engine

  it('invalid sqrt gamma', async () => {
    await expect(pool.addTier(100001)).to.be.reverted;
  });

  it('cannot be more than 6 tiers', async () => {
    await pool.addTier(99990);
    await pool.addTier(99990);
    await pool.addTier(99990);
    await pool.addTier(99990);
    await pool.addTier(99990);
    await expect(pool.addTier(99990)).to.be.reverted;
  });

  it('add tier successfully', async () => {
    // params
    const sqrtGamma = 99990;
    const expectedAmt0In = 25600;
    const expectedAmt1In = 25600;
    const tierId = +(await pool.getTierCount());

    // set timestamp
    const timestamp = (await getLatestBlockTimestamp()) + 100;
    await setNextBlockTimestamp(timestamp);

    // add tier
    const promise = pool.addTier(sqrtGamma);
    await promise;

    // check required token input amounts
    await expect(promise).to.emit(pool, 'ReturnUint256').withArgs('amount0', expectedAmt0In);
    await expect(promise).to.emit(pool, 'ReturnUint256').withArgs('amount1', expectedAmt1In);

    // check tiers length
    expect(await pool.getTierCount()).eq(tierId + 1);

    // check twap last update
    expect((await pool.pool()).tickLastUpdate).eq(timestamp);

    // check tier state
    const tier = await pool.getTier(tierId);
    expect(tier.liquidity).eq(BASE_LIQUIDITY);
    expect(tier.sqrtPrice).eq((await pool.getTier(0)).sqrtPrice);
    expect(tier.sqrtGamma).eq(sqrtGamma);
    expect(tier.nextTickAbove).eq(MAX_TICK);
    expect(tier.nextTickBelow).eq(MIN_TICK);

    // check min tick state
    const tickMin = await pool.getTick(tierId, MIN_TICK);
    expect(tickMin.liquidityLowerD8).eq(BASE_LIQUIDITY_D8);
    expect(tickMin.liquidityUpperD8).eq(0);

    // check max tick state
    const tickMax = await pool.getTick(tierId, MAX_TICK);
    expect(tickMax.liquidityLowerD8).eq(0);
    expect(tickMax.liquidityUpperD8).eq(BASE_LIQUIDITY_D8);

    // check min and max tick states
    for (const tick of [tickMin, tickMax]) {
      expect(tick.nextBelow).eq(MIN_TICK);
      expect(tick.nextAbove).eq(MAX_TICK);
      expect(tick.feeGrowthOutside0).eq(0);
      expect(tick.feeGrowthOutside1).eq(0);
      expect(tick.secondsPerLiquidityOutside).eq(0);
    }

    // check tick map flags
    await pool.checkTickMap(tierId, MIN_TICK, true);
    await pool.checkTickMap(tierId, MAX_TICK, true);
  });
});
