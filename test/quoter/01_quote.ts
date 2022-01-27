import { expect } from 'chai';
import { solidityPack } from 'ethers/lib/utils';
import { ethers, waffle } from 'hardhat';
import { IMockMuffinHub, IQuoter, MockERC20 } from '../../typechain';
import { managerFixture } from '../shared/fixtures';
import { deploy } from '../shared/utils';

describe('manager swap manager', () => {
  let token0: MockERC20;
  let token1: MockERC20;
  let quoter: IQuoter;

  beforeEach(async () => {
    let hub: IMockMuffinHub;
    ({ hub, token0, token1 } = await waffle.loadFixture(managerFixture));
    const _quoter = await deploy('Quoter', hub.address);
    quoter = (await ethers.getContractAt('IQuoter', _quoter.address)) as IQuoter;
  });

  context('quoteSingle', async () => {
    it('exact in', async () => {
      const result = await quoter.quoteSingle(token0.address, token1.address, 0x3f, 3);
      expect(result.amountIn).eq(3);
      expect(result.amountOut).eq(1);
      expect(result.gasUsed).gt(0);
    });

    it('exact out', async () => {
      const result = await quoter.quoteSingle(token0.address, token1.address, 0x3f, -1);
      expect(result.amountIn).eq(3);
      expect(result.amountOut).eq(1);
      expect(result.gasUsed).gt(0);
    });
  });

  context('quote', async () => {
    const toPath = (tokens: MockERC20[]) => {
      const types = [];
      const values = [];
      for (const token of tokens) {
        types.push('address');
        types.push('uint8');
        values.push(token.address);
        values.push(0b111111);
      }
      types.pop();
      values.pop();
      return solidityPack(types, values);
    };

    it('exact in', async () => {
      const path = toPath([token0, token1]);
      const result = await quoter.quote(path, 3);
      expect(result.amountIn).eq(3);
      expect(result.amountOut).eq(1);
      expect(result.gasUsed).gt(0);
    });

    it('exact out', async () => {
      const path = toPath([token1, token0]);
      const result = await quoter.quote(path, 3);
      expect(result.amountIn).eq(3);
      expect(result.amountOut).eq(1);
      expect(result.gasUsed).gt(0);
    });
  });
});
