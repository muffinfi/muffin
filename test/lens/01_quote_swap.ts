import { expect } from 'chai';
import { waffle } from 'hardhat';
import { Lens, Manager, MockERC20 } from '../../typechain';
import { MAX_TIER_CHOICES } from '../shared/constants';
import { managerFixture } from '../shared/fixtures';
import { deploy, toPath } from '../shared/utils';

describe('quote swap', () => {
  let token0: MockERC20;
  let token1: MockERC20;
  let lens: Lens;

  beforeEach(async () => {
    let manager: Manager;
    ({ manager, token0, token1 } = await waffle.loadFixture(managerFixture));
    lens = (await deploy('Lens', manager.address)) as Lens;
  });

  context('quoteSingle', async () => {
    it('exact in', async () => {
      const result = await lens.callStatic.quoteSingle(token0.address, token1.address, MAX_TIER_CHOICES, 3);
      expect(result.amountIn).eq(3);
      expect(result.amountOut).eq(1);
      expect(result.gasUsed).gt(0);
    });

    it('exact out', async () => {
      const result = await lens.callStatic.quoteSingle(token0.address, token1.address, MAX_TIER_CHOICES, -1);
      expect(result.amountIn).eq(3);
      expect(result.amountOut).eq(1);
      expect(result.gasUsed).gt(0);
    });
  });

  context('quote', async () => {
    it('exact in', async () => {
      const path = toPath([token0, token1]);
      const result = await lens.callStatic.quote(path, 3);
      expect(result.amountIn).eq(3);
      expect(result.amountOut).eq(1);
      expect(result.gasUsed).gt(0);
    });

    it('exact out', async () => {
      const path = toPath([token1, token0]);
      const result = await lens.callStatic.quote(path, 3);
      expect(result.amountIn).eq(3);
      expect(result.amountOut).eq(1);
      expect(result.gasUsed).gt(0);
    });
  });
});
