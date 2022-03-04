import { expect } from 'chai';
import { BigNumberish } from 'ethers';
import { waffle } from 'hardhat';
import { MockPool } from '../../typechain';
import { MAX_SQRT_P, MAX_TICK, MIN_SQRT_P, MIN_TICK } from '../shared/constants';
import { poolTestFixture } from '../shared/fixtures';
import { bn, getEvent } from '../shared/utils';

const Q72 = bn(1).shl(72);

/**
 * These test cases are to test special scenerios about crossing ticks.
 * The normal scenerio is tested within the test cases for swap.
 */
describe('pool cross tick', () => {
  let pool: MockPool;

  beforeEach(async () => {
    ({ pool } = await waffle.loadFixture(poolTestFixture));
  });

  const updateLiquidity = async (tickLower: number, tickUpper: number, liquidityDeltaD8: BigNumberish) => {
    return await pool.updateLiquidity(pool.address, 1, 0, tickLower, tickUpper, liquidityDeltaD8, false);
  };

  const isTickInitialized = async (tick: number) => {
    const t = await pool.getTick(0, tick);
    return !(t.liquidityLowerD8.eq(0) && t.liquidityUpperD8.eq(0));
  };

  it('cross tick when tier price exactly equals tick price', async () => {
    await pool.initialize(99850, Q72, 1, 25);
    {
      // proving that tier's price equals to tick's price
      const tier = await pool.getTier(0);
      expect(tier.sqrtPrice).eq(Q72);
      expect(tier.tick).eq(0);
      expect(await pool.sqrtPriceToTick(Q72)).eq(0);
      expect(await pool.tickToSqrtPrice(0)).eq(Q72);

      expect(tier.liquidity).eq(25600); // base liquidity
      expect(await isTickInitialized(0)).to.be.false; // tick zero is not initialized
    }
    {
      // now we initialize tick zero
      // we expect the tier is in the tick space [0, 1]
      await updateLiquidity(0, 10000, 100);
      expect(await isTickInitialized(0)).to.be.true;
      const tier = await pool.getTier(0);
      expect(tier.liquidity).eq(51200);
      expect(tier.sqrtPrice).eq(Q72);
      expect(tier.tick).eq(0);
      expect(tier.nextTickBelow).eq(0);
      expect(tier.nextTickAbove).eq(10000);
    }
    {
      // perform a swap resulted in zero input and output due to reaching "remaining amount tolerance" in swap function.
      const tx = await pool.swap(true, 1, 0x3f);
      const event = await getEvent(tx, pool, 'SwapReturns');
      expect(event.amount0).eq(0);
      expect(event.amount1).eq(0);

      // zero amount swapped means we should expect zero change in tier's price.
      // however we expect the tier crossed the zero-th tick to the tick space [-1, 0], hence change in tier's liquidity.
      const tier = await pool.getTier(0);
      expect(tier.liquidity).eq(25600);
      expect(tier.sqrtPrice).eq(Q72);
      expect(tier.tick).eq(-1);
      expect(tier.nextTickBelow).eq(MIN_TICK);
      expect(tier.nextTickAbove).eq(0);
    }
    {
      // add or burn liquidity does not affect tier's tick
      await updateLiquidity(0, 10000, -100);
      expect((await pool.getTier(0)).tick).eq(-1);
      expect((await pool.getTier(0)).liquidity).eq(25600);

      await updateLiquidity(0, 10000, 100);
      expect((await pool.getTier(0)).tick).eq(-1);
      expect((await pool.getTier(0)).liquidity).eq(25600);

      await updateLiquidity(-10000, 0, 100);
      expect((await pool.getTier(0)).tick).eq(-1);
      expect((await pool.getTier(0)).liquidity).eq(51200);
    }
  });

  it('never cross max tick', async () => {
    await pool.initialize(99850, MAX_SQRT_P, 1, 25);
    await pool.addTier(99975);
    expect((await pool.getTier(0)).tick).eq(MAX_TICK - 1);
    expect((await pool.getTier(1)).tick).eq(MAX_TICK - 1);

    // perform two swaps and last swap should be zero input output since reached the max price
    await pool.swap(false, 1e8, 0x3f);
    const tx = await pool.swap(false, 1e8, 0x3f);
    const event = await getEvent(tx, pool, 'SwapReturns');
    expect(event.amount0).eq(0);
    expect(event.amount1).eq(0);

    // even though tier's price is max price, tier's tick will never be max tick
    for (const i of [0, 1]) {
      const tier = await pool.getTier(i);
      expect(tier.sqrtPrice).eq(MAX_SQRT_P);
      expect(tier.tick).eq(MAX_TICK - 1);
    }
  });

  it('never cross min tick', async () => {
    await pool.initialize(99850, MIN_SQRT_P, 1, 25);
    await pool.addTier(99975);
    expect((await pool.getTier(0)).tick).eq(MIN_TICK);
    expect((await pool.getTier(1)).tick).eq(MIN_TICK);

    // perform a swap and it should be zero input output since reached the max price
    const tx = await pool.swap(true, 1e8, 0x3f);
    const event = await getEvent(tx, pool, 'SwapReturns');
    expect(event.amount0).eq(0);
    expect(event.amount1).eq(0);

    // even though tier's price is max price, tier's tick will never be max tick
    for (const i of [0, 1]) {
      const tier = await pool.getTier(i);
      expect(tier.sqrtPrice).eq(MIN_SQRT_P);
      expect(tier.tick).eq(MIN_TICK);
    }
  });
});
