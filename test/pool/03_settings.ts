import { expect } from 'chai';
import { waffle } from 'hardhat';
import { PoolsTest } from '../../typechain';
import { poolTestFixture } from '../shared/fixtures';
import { bn } from '../shared/utils';

describe('pool settings', () => {
  let pool: PoolsTest;

  beforeEach(async () => {
    ({ pool } = await waffle.loadFixture(poolTestFixture));
    await pool.initialize(99850, bn(1).shl(72), 1, 25);
  });

  context('setSqrtGamma', () => {
    it('invalid sqrt gamma', async () => {
      await expect(pool.setSqrtGamma(0, 100001)).to.be.reverted;
    });

    it('invalid tier id', async () => {
      await expect(pool.setSqrtGamma(1, 99850)).to.be.reverted;
    });

    it('set successfully', async () => {
      await pool.setSqrtGamma(0, 99000);
      expect((await pool.getTier(0)).sqrtGamma).eq(99000);
    });
  });

  context('setProtocolFee', () => {
    it('set successfully', async () => {
      await pool.setProtocolFee(255);
      expect((await pool.pool()).protocolFee).eq(255);
    });
  });

  context('setTickSpacing', () => {
    it('invalid tick spacing', async () => {
      await expect(pool.setTickSpacing(0)).to.be.reverted;
    });

    it('set successfully', async () => {
      await pool.setTickSpacing(123);
      expect((await pool.pool()).tickSpacing).eq(123);
    });
  });
});
