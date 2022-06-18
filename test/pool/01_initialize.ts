import { expect } from 'chai';
import { waffle } from 'hardhat';
import { MockPool } from '../../typechain';
import { BASE_LIQUIDITY, BASE_LIQUIDITY_D8, MAX_SQRT_P, MAX_TICK, MIN_SQRT_P, MIN_TICK } from '../shared/constants';
import { poolTestFixture } from '../shared/fixtures';
import { bn, getLatestBlockTimestamp, setNextBlockTimestamp } from '../shared/utils';

const ONE_X72 = bn(1).shl(72);
const SQRT_GAMMA = 99850;

describe('pool initialize', () => {
  let pool: MockPool;

  beforeEach(async () => {
    ({ pool } = await waffle.loadFixture(poolTestFixture));
  });

  it('invalid sqrt gamma', async () => {
    await expect(pool.initialize(100001, ONE_X72, 1, 0)).to.be.reverted;
  });

  it('invalid sqrt price', async () => {
    await expect(pool.initialize(SQRT_GAMMA, MIN_SQRT_P.sub(1), 1, 0)).to.be.reverted;
    await expect(pool.initialize(SQRT_GAMMA, MAX_SQRT_P.add(1), 1, 0)).to.be.reverted;
  });

  it('initialize pool successfully', async () => {
    // params
    const sqrtP = ONE_X72;
    const sqrtGamma = SQRT_GAMMA;
    const expectedAmt0In = 25600;
    const expectedAmt1In = 25600;

    // set timestamp
    const timestamp = (await getLatestBlockTimestamp()) + 100;
    await setNextBlockTimestamp(timestamp);

    // check pool locked before init
    expect((await pool.pool()).unlocked).eq(false);

    // initialize pool
    const promise = pool.initialize(sqrtGamma, sqrtP, 1, 0);
    await promise;

    // check required token input amounts
    await expect(promise).to.emit(pool, 'InitializeReturns').withArgs(expectedAmt0In, expectedAmt1In);

    // check tier state
    const tier = await pool.getTier(0);
    expect(tier.liquidity).eq(BASE_LIQUIDITY);
    expect(tier.sqrtPrice).eq(sqrtP);
    expect(tier.sqrtGamma).eq(sqrtGamma);
    expect(tier.nextTickAbove).eq(MAX_TICK);
    expect(tier.nextTickBelow).eq(MIN_TICK);

    // check min tick state
    const tickMin = await pool.getTick(0, MIN_TICK);
    expect(tickMin.liquidityLowerD8).eq(BASE_LIQUIDITY_D8);
    expect(tickMin.liquidityUpperD8).eq(0);

    // check max tick state
    const tickMax = await pool.getTick(0, MAX_TICK);
    expect(tickMax.liquidityLowerD8).eq(0);
    expect(tickMax.liquidityUpperD8).eq(BASE_LIQUIDITY_D8);

    // check min and max tick states
    for (const tick of [tickMin, tickMax]) {
      expect(tick.nextBelow).eq(MIN_TICK);
      expect(tick.nextAbove).eq(MAX_TICK);
      expect(tick.feeGrowthOutside0).eq(0);
      expect(tick.feeGrowthOutside1).eq(0);
    }

    // check tick map flags
    await pool.checkTickMap(0, MIN_TICK, true);
    await pool.checkTickMap(0, MAX_TICK, true);
  });
});
