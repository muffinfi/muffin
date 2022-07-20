import { expect } from 'chai';
import { ethers, waffle } from 'hardhat';
import { ILens, Manager, MockERC20 } from '../../typechain';
import { MAX_TIER_CHOICES } from '../shared/constants';
import { managerFixture } from '../shared/fixtures';
import { deploy, toPath } from '../shared/utils';

describe('quote swap', () => {
  let token0: MockERC20;
  let token1: MockERC20;
  let lens: ILens;

  beforeEach(async () => {
    let manager: Manager;
    ({ manager, token0, token1 } = await waffle.loadFixture(managerFixture));
    const _lens = await deploy('Lens', manager.address);
    lens = (await ethers.getContractAt('ILens', _lens.address)) as ILens;
  });

  context('quoteSingle', async () => {
    it('exact in', async () => {
      const result = await lens.quoteSingle(token0.address, token1.address, MAX_TIER_CHOICES, 3);
      expect(result.amountIn).eq(3);
      expect(result.amountOut).eq(1);
      expect(result.gasUsed).gt(0);
    });

    it('exact out', async () => {
      const result = await lens.quoteSingle(token0.address, token1.address, MAX_TIER_CHOICES, -1);
      expect(result.amountIn).eq(3);
      expect(result.amountOut).eq(1);
      expect(result.gasUsed).gt(0);
    });
  });

  context('quote', async () => {
    it('exact in', async () => {
      const path = toPath([token0, token1]);
      const result = await lens.quote(path, 3);
      expect(result.amountIn).eq(3);
      expect(result.amountOut).eq(1);
      expect(result.gasUsed).gt(0);
    });

    it('exact out', async () => {
      const path = toPath([token1, token0]);
      const result = await lens.quote(path, 3);
      expect(result.amountIn).eq(3);
      expect(result.amountOut).eq(1);
      expect(result.gasUsed).gt(0);
    });
  });
});
