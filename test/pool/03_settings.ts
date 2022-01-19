import { expect } from 'chai';
import { waffle } from 'hardhat';
import { MockPool } from '../../typechain';
import { poolTestFixture } from '../shared/fixtures';
import { bn } from '../shared/utils';

describe('pool settings', () => {
  let pool: MockPool;

  beforeEach(async () => {
    ({ pool } = await waffle.loadFixture(poolTestFixture));
    await pool.initialize(99850, bn(1).shl(72), 1, 25);
  });

  context('setTierParameters', () => {
    it('invalid sqrt gamma', async () => {
      await expect(pool.setTierParameters(0, 100001, 0)).to.be.reverted;
    });

    it('invalid tier id', async () => {
      await expect(pool.setTierParameters(1, 99850, 0)).to.be.reverted;
    });

    it('set successfully', async () => {
      await pool.setTierParameters(0, 99000, 0);
      expect((await pool.getTier(0)).sqrtGamma).eq(99000);
    });
  });

  context('setPoolParameters', () => {
    it('invalid tick spacing', async () => {
      await expect(pool.setPoolParameters(0, 255)).to.be.reverted;
    });

    it('set successfully', async () => {
      await pool.setPoolParameters(123, 255);
      expect((await pool.pool()).tickSpacing).eq(123);
      expect((await pool.pool()).protocolFee).eq(255);
    });
  });
});
